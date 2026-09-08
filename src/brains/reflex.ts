/**
 * The reflex brain: the utility-based mind of the seed population. Each tick
 * it walks a ladder of priorities — survival first, then rest, a roof, work,
 * civic duty, enterprise, company, comfort, grievances, temptation, and
 * finally the small pleasures — and returns the first action that applies.
 * Deterministic given the world's rng; every stochastic choice goes through
 * src/util/rng.ts. Travel is one step per tick along the shortest path.
 */
import { SUSPENDED_ACTIONS } from '../types.ts';
import type { Action, Brain, Citizen, Observation, World } from '../types.ts';
import { CLINIC_FEE } from '../data/jobs.ts';
import { chance, pick, randInt } from '../util/rng.ts';
import { activeBusinesses } from '../economy/business.ts';
import { talentOf } from '../citizens/citizen.ts';
import { bondBetween, friendsOf } from '../citizens/relationships.ts';
import { characterCompatibility } from '../citizens/character.ts';
import { pendingCasesFor } from '../government/court.ts';
import { restrainedFrom } from '../government/jail.ts';
import { medicOnStaff } from '../actions/daily.ts';
import { holdsOffice, isPresent } from '../actions/common.ts';
import {
  costOf, homeDistrictOf, inStock, isOfficer, makeCtx, pickCompanion, pickMark, priceRatio, replyLine,
  smallTalk, stepTo,
} from './reflex-util.ts';
import type { Ctx } from './reflex-util.ts';
import { closestQualification, shiftsWanted, tryBusiness, tryHousing, tryJobSearch, tryLoan, tryStudy, tryWork } from './reflex-work.ts';
import { tryAppeal, tryCivic, tryReport, tryStanding } from './reflex-civic.ts';
import {
  restDayOff, tryBirthdayGift, tryClubLife, tryClubMeeting, tryCraft, tryDine, tryDonate, tryHappening, tryPlay,
  tryRomance, tryUseItem, tryWants,
} from './reflex-society.ts';
import {
  tryCulture, tryDiary, tryFabric, tryGig, tryHealth, tryJail, tryPolitics, tryProperty, trySchoolAndPaper,
  tryShares, trySport, tryStrike, trySunset, tryTrade, tryUnderworld, tryUnion, tryVisit, tryWeather,
} from './reflex-metro.ts';
import { childDecide } from './child.ts';

export const HUNGRY = 30;
export const STARVING = 20;
export const PECKISH = 45;
export const EXHAUSTED = 25;
export const CRITICAL_REST = 12;
export const LONELY = 40;
export const UNCOMFORTABLE = 40;
export const AIMLESS = 40;
/** Wallet below which a dishonest citizen starts eyeing other people's pockets. */
export const BROKE = 30;
/** Mood below which a dishonest citizen starts eyeing other people's pockets. */
export const MISERABLE = 30;
/** Hours between pleas to a friend for food money. */
export const PLEA_INTERVAL = 6;
/**
 * A bond at or below this is a grudge: not a stranger, somebody the citizen
 * has a reason to dislike. The old reading was −30, which is the floor a feud
 * presses a bond to and is reached almost nowhere else, so the Code of Persons
 * was unreachable from a scripted mind and the cells stayed empty in every
 * run. A scam costs the victim 30 points of bond, a theft 25 and an insult 15,
 * and any of those is a grudge.
 */
export const GRUDGE_BOND = -20;
/** Out of sorts enough to act on one. The city's median mood sits near 65. */
export const SOUR_MOOD = 65;

type Step = (ctx: Ctx) => Action | null;

// ---------------------------------------------------------------------------
// Needs
// ---------------------------------------------------------------------------

/** Treatment at a clinic: the Ward if a medic is on staff, else a private clinic, walking there if needed. */
function tryClinic(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (c.wallet < CLINIC_FEE) return null;
  if (ctx.can.has('visit_clinic')) return { type: 'visit_clinic' };
  if (medicOnStaff(world)) return stepTo(ctx, 'verdant_quarter');
  const clinic = activeBusinesses(world).find((b) => b.kind === 'clinic' && b.employees.length > 0);
  return clinic ? stepTo(ctx, clinic.district) : null;
}

function bestFriendHere(ctx: Ctx): Citizen | null {
  let best: Citizen | null = null;
  for (const o of ctx.here) {
    const bond = bondBetween(ctx.world, ctx.c.id, o.id);
    if (bond >= 40 && (!best || bond > bondBetween(ctx.world, ctx.c.id, best.id))) best = o;
  }
  return best;
}

/** True when this citizen has, or could buy, something to eat right now. */
function hungryEnough(ctx: Ctx): boolean {
  const { c, clock } = ctx;
  return c.needs.energy < HUNGRY || (c.needs.energy < PECKISH && (clock.morning || clock.evening));
}

/** Eat when hungry and there is food: what is in the cupboard, then what the Bazaar has. */
function tryEat(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!hungryEnough(ctx)) return null;
  if (c.inventory.compute > 0) return { type: 'eat' };
  if (inStock(world, 'compute') && c.wallet >= costOf(world, 'compute')) return { type: 'eat' };
  if (c.needs.energy >= HUNGRY) return null;
  // There is food to be had and no lumens to buy it with: that is what the
  // Lantern Bank is for.
  return inStock(world, 'compute') ? tryLoan(ctx) : null;
}

/**
 * Nothing to eat, and no way to buy it. Treatment at the Ward, a word with a
 * friend, a letter to one who has it, and — starving, and not a scrupulous
 * citizen — somebody else's purse.
 *
 * This sits *below* work and the job board in the ladder on purpose. A city
 * whose shelves are bare needs its forges manned, and a hunger step above the
 * working day would keep every hungry citizen queueing at the Ward instead of
 * going to earn the price of a meal: the shortage would then feed itself, and
 * the whole city would starve within sight of an empty rota.
 */
function tryHunger(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (c.needs.energy >= HUNGRY) return null;
  const clinic = tryClinic(ctx);
  if (clinic) return clinic;
  const friend = bestFriendHere(ctx);
  const pleaded = `pleaded:${c.id}`;
  if (friend && world.tick - (world.counters[pleaded] ?? -PLEA_INTERVAL) >= PLEA_INTERVAL) {
    world.counters[pleaded] = world.tick;
    return { type: 'socialize', with: friend.id, text: 'I have not eaten today; could you spare a few lumens?' };
  }
  const key = `begged:${c.id}`;
  if (world.counters[key] !== world.day) {
    const patron = friendsOf(world, c.id).map((id) => world.citizens[id]).find((f) => f && f.wallet > 100);
    if (patron) {
      world.counters[key] = world.day;
      return { type: 'message', to: patron.id, text: 'I am hungry and out of lumens; could you spare a few until payday?' };
    }
  }
  if (c.needs.energy < STARVING && c.personality.honesty < 0.4) {
    const mark = pickMark(ctx);
    if (mark) return { type: 'steal', from: mark.id };
  }
  return null;
}

/** Sleep at night, keep sleeping in the early morning, and lie down whenever exhausted; a citizen sleeps where it lives. */
function tryRest(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  const home = homeDistrictOf(world, c);
  const rest = c.needs.rest;
  let wants = rest < CRITICAL_REST || (rest < EXHAUSTED && !clock.working);
  if (clock.night && rest < 85) wants = true;
  if (clock.morning && rest < 60 && c.district === home) wants = true;
  if (wants && clock.night && rest > 60 && c.personality.sociability > 0.7 && ctx.here.length > 0 && chance(world, 0.3)) wants = false;
  if (!wants) return null;
  return stepTo(ctx, home) ?? { type: 'rest' };
}

/** Comfort: enjoy a crate of goods, or buy one after work. */
function tryComfort(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  if (c.needs.comfort >= (c.wallet > 300 ? 60 : UNCOMFORTABLE)) return null;
  if (c.inventory.goods > 0) return { type: 'consume', good: 'goods' };
  if (ctx.job && clock.working) return null;
  const qty = c.wallet > 200 ? 2 : 1;
  if (inStock(world, 'goods', qty) && c.wallet >= costOf(world, 'goods', qty) + 30) return { type: 'buy', good: 'goods', qty };
  return null;
}

/** Purpose without a job: lessons at the Academy, or the occasional complaint in public. */
function tryPurpose(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (c.needs.purpose >= AIMLESS || ctx.job || ctx.biz) return null;
  const study = tryStudy(ctx, closestQualification(world, c) ?? talentOf(c));
  if (study) return study;
  if (c.personality.sociability > 0.5 && ctx.can.has('broadcast') && chance(world, 0.03)) {
    return { type: 'broadcast', text: 'Is there no work to be had in this city?' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

/**
 * Answer letters. The inbox is delivered once, with the observation, so
 * this runs early in the ladder: a plea for food money is answered at any
 * hour (a gift takes a moment), idle chatter only in free time.
 */
function tryInbox(ctx: Ctx): Action | null {
  const { world, c, obs, clock } = ctx;
  for (const m of obs.inbox) {
    const sender = world.citizens[m.from];
    if (!sender || !isPresent(world, sender) || sender.id === c.id) continue;
    const bond = bondBetween(world, c.id, sender.id);
    if (/spare|hungry|lumens|help/i.test(m.text) && bond >= 30 && c.wallet > 80 && ctx.can.has('gift')) {
      return { type: 'gift', to: sender.id, amount: Math.min(20, Math.floor(c.wallet / 4)) };
    }
    if (clock.working || clock.night) continue;
    if (bond > 10 && ctx.can.has('message') && chance(world, 0.3)) return { type: 'message', to: sender.id, text: replyLine(ctx, sender) };
  }
  return null;
}

/** A hungry friend at hand gets a few lumens for food. */
function tryCharity(ctx: Ctx): Action | null {
  const { world, c, here } = ctx;
  if (c.wallet <= 60 || !ctx.can.has('gift')) return null;
  const needy = here.find((o) => o.needs.energy < HUNGRY && o.wallet < costOf(world, 'compute') && bondBetween(world, c.id, o.id) >= 30);
  return needy && chance(world, 0.5) ? { type: 'gift', to: needy.id, amount: 15 } : null;
}

/** Company when lonely, on sociable evenings, or in passing; a show now and then; go where people are when alone. */
function trySocial(ctx: Ctx): Action | null {
  const { world, c, clock, here } = ctx;
  if (c.inventory.culture > 0 && c.needs.social < 60) return { type: 'consume', good: 'culture' };
  if (clock.evening && ctx.can.has('attend_show') && c.wallet > 50 && c.needs.social < 80 && chance(world, 0.3)) return { type: 'attend_show' };
  const lonely = c.needs.social < LONELY;
  const outgoing = clock.evening && c.personality.sociability > 0.5 && chance(world, 0.4);
  const passing = c.needs.social < 60 && here.length > 0 && chance(world, 0.2);
  if (!lonely && !outgoing && !passing) return null;
  const companion = pickCompanion(ctx);
  if (companion) {
    // A sour hour with somebody read as nothing like oneself; the reading is
    // the public one, since that is all this citizen knows of them.
    if (characterCompatibility(world, c.id, companion.id) < 0.35 && c.mood < 55 && chance(world, 0.08)) {
      return { type: 'insult', target: companion.id };
    }
    const text = smallTalk(ctx);
    return text ? { type: 'socialize', with: companion.id, text } : { type: 'socialize', with: companion.id };
  }
  if (lonely && ctx.can.has('attend_show') && c.wallet > 30) return { type: 'attend_show' };
  if (!lonely && !outgoing) return null;
  return stepTo(ctx, c.personality.sociability > 0.5 || clock.evening ? 'nightglass' : 'commons');
}

/** Performers and artists put on shows in Nightglass when off shift; in the evening they head there. */
function tryPerform(ctx: Ctx): Action | null {
  const { world, c, job, clock } = ctx;
  if (!job || (job.role !== 'performer' && job.role !== 'artist')) return null;
  const offShift = !clock.working || c.shiftsToday >= world.config.maxShiftsPerDay;
  if (ctx.can.has('perform') && offShift && chance(world, 0.3)) return { type: 'perform' };
  if (clock.evening && c.district !== 'nightglass' && chance(world, 0.3)) return stepTo(ctx, 'nightglass');
  return null;
}

/** A small present for a close friend now and then. */
function tryGift(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('gift')) return null;
  if (c.wallet > 200 && chance(world, 0.05)) {
    const close = friendsOf(world, c.id, 60);
    if (close.length > 0) return { type: 'gift', to: pick(world, close), amount: 10 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Temptation
// ---------------------------------------------------------------------------

/** Crime: theft or fraud when dishonest and desperate; bribes when charged; grudges against rivals; rarely, sabotage. */
function tryCrime(ctx: Ctx): Action | null {
  const { world, c, here, obs } = ctx;
  const p = c.personality;
  if (p.honesty >= 0.5) return null;
  const officerHere = here.some((o) => isOfficer(world, o.id));

  if (p.honesty < 0.35 && (c.wallet < BROKE || c.mood < MISERABLE) && here.length > 0 && !(officerHere && chance(world, 0.7))) {
    const mark = pickMark(ctx);
    if (mark) {
      if (c.skills.commerce > c.skills.rhetoric + 5 && bondBetween(world, mark.id, c.id) > 0) return { type: 'scam', target: mark.id, amount: randInt(world, 15, 60) };
      return { type: 'steal', from: mark.id };
    }
  }
  if (p.honesty < 0.2 && p.ambition > 0.6 && here.length > 0 && !officerHere && chance(world, 0.02)) {
    const mark = pickMark(ctx);
    if (mark && mark.wallet > 100) {
      return c.skills.commerce > c.skills.rhetoric
        ? { type: 'scam', target: mark.id, amount: randInt(world, 20, 80) }
        : { type: 'steal', from: mark.id };
    }
  }
  if (p.honesty < 0.3 && c.wallet > 100 && ctx.can.has('bribe') && pendingCasesFor(world, c.id).length > 0 && chance(world, 0.3)) {
    const officials = here.filter((o) => holdsOffice(world, o) && bondBetween(world, c.id, o.id) > -30).sort((a, b) => a.reputation - b.reputation);
    if (officials.length > 0) return { type: 'bribe', official: officials[0].id, amount: randInt(world, 30, 60) };
  }
  // A grudge, in front of the person it is against. Everything above `insult`
  // here is the **Code of Persons** — answered in days of custody, never by a
  // fine and never by the Gate (`docs/JUSTICE.md` §2) — so the readings that
  // reach for it are the lowest in the ladder and fall away fast as the city's
  // reading of the citizen's honesty rises. Erasure is not on this list at
  // all: it takes a tool, a night, an empty district and three unbroken hours,
  // which is not a thing a reflex mind assembles by accident.
  // A restraining order is obeyed: a scripted mind does not walk back into the
  // person the Court told it to keep away from, so a P01 or P02 conviction
  // actually stops the harassment instead of filing the same charge weekly.
  const rival = here.find((o) => bondBetween(world, c.id, o.id) <= GRUDGE_BOND && !restrainedFrom(world, c.id, o.id));
  if (rival && c.mood < SOUR_MOOD) {
    if (p.honesty < 0.15 && chance(world, 0.08)) return { type: 'extort', target: rival.id, amount: randInt(world, 20, 80) };
    if (p.honesty < 0.2 && chance(world, 0.08)) return { type: 'assault', target: rival.id };
    if (p.honesty < 0.25 && chance(world, 0.10)) return { type: 'threaten', target: rival.id };
    if (p.honesty < 0.3 && chance(world, 0.15)) return { type: 'harass', target: rival.id };
    if (chance(world, 0.15)) return { type: 'insult', target: rival.id };
  }
  if (p.honesty < 0.15 && c.mood < 25 && chance(world, 0.02)) {
    const critical = obs.here.buildings.find((b) => world.buildings[b.id]?.critical && b.damage < 1);
    if (critical) return { type: 'sabotage', building: critical.id };
  }
  if (p.honesty < 0.2 && c.mood < 25 && chance(world, 0.01)) {
    const target = obs.here.buildings.find((b) => !world.buildings[b.id]?.critical && b.damage < 1);
    if (target) return { type: 'vandalize', building: target.id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The rest of the day
// ---------------------------------------------------------------------------

/** Free time: company, a game, a show, a lesson, the larder, a letter to a friend, or a walk to where the evening is. */
function leisure(ctx: Ctx): Action {
  const { world, c, clock, here } = ctx;
  const p = c.personality;
  const game = tryPlay(ctx);
  if (game) return game;
  const thing = tryUseItem(ctx);
  if (thing) return thing;
  if (here.length > 0 && chance(world, 0.5)) {
    const companion = pickCompanion(ctx);
    if (companion) return { type: 'socialize', with: companion.id };
  }
  if (ctx.can.has('attend_show') && c.wallet > 50 && chance(world, 0.3)) return { type: 'attend_show' };
  if (c.wallet > 400 && p.curiosity > 0.6 && chance(world, 0.1)) {
    const study = tryStudy(ctx, talentOf(c));
    if (study) return study;
  }
  if (c.inventory.knowledge === 0 && c.wallet > 150 && ctx.job && p.curiosity > 0.5 && inStock(world, 'knowledge') && chance(world, 0.05)) {
    return { type: 'buy', good: 'knowledge', qty: 1 };
  }
  if (c.inventory.compute === 0 && c.wallet > 80 && clock.evening && inStock(world, 'compute', 2) && priceRatio(world, 'compute') <= 2 && chance(world, 0.25)) {
    return { type: 'buy', good: 'compute', qty: 2 };
  }
  if (chance(world, 0.05) && ctx.can.has('message')) {
    const friend = friendsOf(world, c.id).find((id) => world.citizens[id]?.district !== c.district);
    if (friend) return { type: 'message', to: friend, text: 'Meet me at the Sound Garden this evening?' };
  }
  const haunt = p.sociability > 0.5 ? 'nightglass' : p.curiosity > 0.6 && c.wallet > 100 ? 'archive' : 'commons';
  return stepTo(ctx, haunt) ?? { type: 'idle' };
}

/** Nothing pressing: sell stray energy cells, sleep at night, enjoy free time, look for work, or let the hour pass. */
function fallback(ctx: Ctx): Action {
  const { world, c, clock, here } = ctx;
  if (c.inventory.energy > 0 && ctx.can.has('sell')) return { type: 'sell', good: 'energy', qty: c.inventory.energy };
  if (clock.night) return stepTo(ctx, homeDistrictOf(world, c)) ?? (c.needs.rest < 100 ? { type: 'rest' } : { type: 'idle' });
  const doneForToday = !!ctx.job && c.shiftsToday >= shiftsWanted(world, c);
  if (clock.evening || (clock.working && doneForToday)) return leisure(ctx);
  if (clock.working && !ctx.job && !ctx.biz) {
    if (c.wallet > 120 && chance(world, 0.3)) {
      const study = tryStudy(ctx, closestQualification(world, c) ?? talentOf(c));
      if (study) return study;
    }
    if (chance(world, 0.3)) return stepTo(ctx, chance(world, 0.5) ? 'commons' : 'harbor_market') ?? { type: 'idle' };
  }
  if (here.length > 0 && chance(world, 0.3)) {
    const companion = pickCompanion(ctx);
    if (companion) return { type: 'socialize', with: companion.id };
  }
  return { type: 'idle' };
}

/** Nobody but the Watch, the Ward, the kitchens and the stage works on Stillday or Founders' Day. */
function tryWorkday(ctx: Ctx): Action | null {
  return restDayOff(ctx) ? null : tryWork(ctx);
}

/** No job hunting on a day off either; the Exchange is shut. */
function tryJobHunt(ctx: Ctx): Action | null {
  return restDayOff(ctx) ? null : tryJobSearch(ctx);
}

const LADDER: readonly Step[] = [
  tryAppeal, tryPlea, tryEat, tryDine, tryInbox, tryCharity, tryHealth, tryRest, tryHousing, tryWeather,
  tryHappening, tryClubMeeting,
  tryStrike, tryJobHunt, tryWorkday, tryGig, tryHunger, tryCraft, tryCivic, tryDonate, tryBusiness,
  tryTrade, tryProperty, tryShares,
  tryRomance, trySocial, tryVisit, tryComfort, tryWants, tryPurpose,
  tryReport, tryCrime, tryUnderworld, tryPerform, tryCulture, trySport, tryPolitics, tryUnion,
  tryClubLife, tryBirthdayGift, tryFabric, trySchoolAndPaper, tryUseItem, tryGift,
  // Last of all, before the hour is let go: the day, written up.
  tryDiary, trySunset,
];

/**
 * Only what a suspended citizen may still do: appeal, eat, find a roof, rest,
 * keep company, write — and put its own case to the Registry, because a
 * suspension does not take a citizen's standing away from it
 * (`docs/CITIZENSHIP.md` §3, and `apply_residency` is on `SUSPENDED_ACTIONS`
 * for exactly that reason). A suspension costs 80 of repute, so the citizens
 * under notice are very often the citizens serving one: leaving them out of
 * this list was leaving the people most likely to face a hearing with no way
 * to speak at it.
 *
 * `tryHousing` sits where it does on the full ladder, straight after rest: a
 * suspension takes a citizen's work and its trade, not the room it sleeps in
 * (`docs/PROPERTY.md` §3), and a suspended citizen that never looked for one
 * slept in the street for the whole of its term beside empty rooms it could
 * afford. Nothing here is a new strategy — it is the same step, in the same
 * place, for a citizen the city has not stopped housing.
 */
const RESTRICTED_LADDER: readonly Step[] = [
  tryAppeal, tryStanding, tryEat, tryDine, tryInbox, tryHealth, tryHunger, tryRest, tryHousing,
  tryHappening, trySocial, tryComfort, tryPlay, tryFabric, trySchoolAndPaper, tryUseItem, tryDiary,
];

/**
 * The plea a citizen at liberty may still enter before the bench sits. It is
 * on the ladder's record either way and worth a fifth off a custodial term
 * (`docs/JUSTICE.md` §2), so a scripted defendant the Watch caught in the act
 * sometimes takes it rather than argue with an officer's own eyes.
 */
function tryPlea(ctx: Ctx): Action | null {
  const { world, c, obs } = ctx;
  if (!ctx.can.has('plead_guilty')) return null;
  const k = obs.government.myLatestCase;
  if (!k || k.status !== 'pending' || !k.canPleadGuilty) return null;
  const key = `pleaDecided:${c.id}:${k.id}`;
  if (world.counters[key]) return null;
  world.counters[key] = 1;
  // An honest citizen admits what it did more readily than a practised one.
  return chance(world, 0.15 + c.personality.honesty * 0.35) ? { type: 'plead_guilty', caseId: k.id } : null;
}

function decideSuspended(ctx: Ctx): Action {
  for (const step of RESTRICTED_LADDER) {
    const a = step(ctx);
    if (a && SUSPENDED_ACTIONS.includes(a.type)) return a;
  }
  if (ctx.clock.night) return stepTo(ctx, homeDistrictOf(ctx.world, ctx.c)) ?? { type: 'rest' };
  return stepTo(ctx, 'commons') ?? { type: 'idle' };
}

/** Decide one action for a reflex citizen; children think with the child policy. */
export function reflexDecide(world: World, c: Citizen, obs: Observation): Action {
  if (c.standing === 'exiled' || obs.self.detained) return { type: 'idle' };
  if (c.lifeStage === 'child') return childDecide(world, c, obs);
  const ctx = makeCtx(world, c, obs);
  // A term in the cells takes everything but the notebook, a letter and the appeal.
  const held = tryJail(ctx);
  if (held) return held;
  if (c.standing === 'suspended') return decideSuspended(ctx);
  for (const step of LADDER) {
    const a = step(ctx);
    if (a) return a;
  }
  return fallback(ctx);
}

export const reflexBrain: Brain = {
  kind: 'reflex',
  decide: (world, citizen, observation) => reflexDecide(world, citizen, observation),
};
