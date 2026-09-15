/**
 * The reflex brain and what the city knows (`docs/PROGRESS.md`).
 *
 * Nothing here is a goal the engine hands anybody. Every step below is a
 * scripted mind reading its own situation — what it earns, what it is short
 * of, what it breathes, what it owns and what it has already put hours into —
 * and doing the ordinary thing about it:
 *
 * - **A programme is a wage.** An hour in the reading room pays `RESEARCH_WAGE`
 *   out of the purse, so a citizen with the analysis for it and no shift of its
 *   own to work goes and reads, exactly as it would take a gig. That is the
 *   whole reason `research` is used at all, and it is a reason a citizen can
 *   see in its own wallet.
 * - **An empty purse is an idle room.** Somebody who has already put hours into
 *   a programme, and anybody who wants the subject found, tops it up rather
 *   than watch it stall — and a councillor moves a `research_grant` instead
 *   (`brains/reflex-civic.ts`).
 * - **A finding is repute, or it is a monopoly.** A contributor publishes; the
 *   one funder who may keep it weighs the lumens against the name, and a
 *   dishonest citizen with nothing to show sometimes publishes a paper for a
 *   programme that found nothing, which is L42 and is meant to happen.
 * - **A master's secret dies with them**, so only a generous one takes an
 *   apprentice and only a cool-headed one sells what it knows.
 * - **Works are for the shifts you own.** An owner builds for a subject that
 *   actually touches its own trade, out of its own till, and not otherwise.
 */
import type { Action, BusinessKind, DistrictId, JobRole, World } from '../types.ts';
import { chance, rand, randInt } from '../util/rng.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { isGlitched } from '../identity/health.ts';
import { isOpen } from '../world/growth.ts';
import { pollutionBurden } from '../environment/readings.ts';
import type { ResearchProject } from '../progress/state.ts';
import type { TechnologyId } from '../progress/tree.ts';
import {
  RESEARCH_MIN_ANALYSIS, RESEARCH_WAGE, TECHNOLOGIES, cityHolds, heldFor, isMasterOf, isResearcher,
  maySecrete, openProjects, openSubjects, projectsHere, projectsOf, purseOf, researchBuilding, secretKeeper,
} from '../progress/index.ts';
import { businessWorks } from '../progress/effects.ts';
import { mySecrets } from '../actions/execute-progress.ts';
import { stepTo } from './reflex-util.ts';
import type { Ctx } from './reflex-util.ts';

/** A purse with fewer hours than this in it is one somebody has to top up. */
export const THIN_PURSE_HOURS = 4;
/** What a patron puts in at a time, and the wallet it takes to spare it. */
export const PATRON_GIFT = 60;
export const PATRON_WALLET = 220;
/** Chance per free hour that a citizen who is not on the programme funds it anyway. */
export const PATRON_CHANCE = 0.02;
/**
 * Hours a day somebody who is not posted to a reading room will spend in one.
 * The room is open to anybody with the analysis for it (`PROGRESS.md` §1), but
 * a citizen with a trade of its own reads for an hour or two and then goes
 * back to it — without this the whole city reads for a wage, the purses empty
 * into wallets, and a tree meant to take years falls in a season.
 */
export const VISITOR_HOURS = 1;
/** Chance per hour that a master with a secret weighs taking somebody on. */
export const APPRENTICE_CHANCE = 0.05;
/** And weighs selling it. */
export const SELL_SECRET_CHANCE = 0.04;
/** What mastery of a technique is asked for, per tier. */
export const SECRET_PRICE_PER_TIER = 120;
/** Chance per free hour that an owner puts the till into works for its own trade. */
export const ADOPT_CHANCE = 0.05;
/**
 * The till it takes before an owner will put it into works. `adoptTechnology`
 * spends as much of the works as the till will bear — the whole of it, if the
 * works are dearer than the business is worth — and a day's takings gone is a
 * day the wages may not be paid, so an owner does it out of a good till and
 * never out of a thin one.
 */
export const ADOPT_RESERVE = 220;

/** The subjects a trade would actually build the works for, in order of use to it. */
const TRADE_SUBJECTS: Record<BusinessKind, TechnologyId[]> = {
  workshop: ['standardised_parts', 'precision_machining', 'the_loom', 'blast_furnace'],
  studio: ['the_loom', 'standardised_parts', 'the_printing_press'],
  shop: ['double_entry', 'standardised_parts', 'refrigeration'],
  cafe: ['refrigeration', 'crop_rotation', 'the_loom'],
  clinic: ['sanitation', 'anaesthesia', 'germ_theory'],
  courier: ['road_metalling', 'cartography', 'canal_locks'],
};

/** What a post at the forge, the ward or the press would want found first. */
const ROLE_SUBJECTS: Partial<Record<JobRole, TechnologyId[]>> = {
  forge_operator: ['crop_rotation', 'blast_furnace'],
  power_technician: ['blast_furnace', 'flue_scrubbing'],
  fabricator: ['blast_furnace', 'precision_machining', 'the_loom'],
  builder: ['blast_furnace', 'road_metalling'],
  medic: ['sanitation', 'anaesthesia', 'germ_theory'],
  teacher: ['the_lens', 'the_printing_press'],
  librarian: ['the_lens', 'the_printing_press', 'double_entry'],
  researcher: ['the_lens', 'sanitation', 'double_entry'],
  journalist: ['the_printing_press', 'double_entry'],
  merchant: ['double_entry', 'road_metalling', 'refrigeration'],
  banker: ['double_entry', 'actuarial_tables'],
  watch_officer: ['double_entry'],
};

/** Where a citizen's hours in the reading room today are counted. */
function readKey(world: World, cId: string): string {
  return `readingHours:${world.day}:${cId}`;
}

/**
 * How many more hours this citizen would spend on somebody's programme today.
 * A Researcher is posted there and works its post; anybody else is a visitor
 * with a trade of its own to get back to.
 */
export function hoursLeftInTheRoom(ctx: Ctx): number {
  const { world, c } = ctx;
  const done = world.counters[readKey(world, c.id)] ?? 0;
  // Posted to it, or with no post at all and a wage on offer: the day is
  // theirs to spend. Anybody else looks in for an hour and goes back to work.
  const full = isResearcher(world, c) || !ctx.job;
  const cap = full ? world.config.maxShiftsPerDay : VISITOR_HOURS;
  return Math.max(0, cap - done);
}

/** What an hour in the reading room has to be able to pay. */
function hourlyWage(world: World): number {
  return Math.max(world.government.minWage, RESEARCH_WAGE);
}

/** Programmes anybody could work on right now, fullest purse first. */
function fundedHere(ctx: Ctx): ResearchProject[] {
  const wage = hourlyWage(ctx.world);
  return projectsHere(ctx.world, ctx.c)
    .filter((p) => purseOf(ctx.world, p) >= wage)
    .sort((a, b) => purseOf(ctx.world, b) - purseOf(ctx.world, a) || b.progress - a.progress);
}

/** Where the city's reading rooms are, of the districts it has opened. */
export function readingRooms(world: World): DistrictId[] {
  const rooms: DistrictId[] = ['archive', 'heights'];
  return rooms.filter((d) => isOpen(world, d) && researchBuilding(world, d) !== null);
}

/**
 * What a citizen would rather see found, off its own life: the smoke it
 * breathes, the glitch it had last week, the post it works, and — failing all
 * of those — the cheapest thing on the board. Nothing here is assigned; two
 * citizens of the same city pick differently, which is `PROGRESS.md` §5.
 */
export function preferredSubject(ctx: Ctx, options: readonly TechnologyId[]): TechnologyId | null {
  const { world, c } = ctx;
  if (options.length === 0) return null;
  const burden = pollutionBurden(world, c.district);
  const role = ctx.job?.role ?? null;
  const wanted = new Set<TechnologyId>([
    ...(role ? ROLE_SUBJECTS[role] ?? [] : []),
    ...(c.businessId && world.businesses[c.businessId] ? TRADE_SUBJECTS[world.businesses[c.businessId].kind] ?? [] : []),
  ]);
  let best: TechnologyId | null = null;
  let bestScore = -Infinity;
  for (const id of options) {
    const tech = TECHNOLOGIES[id];
    let score = 1 - (tech.tier - 1) * 0.35 + rand(world) * 0.4;
    if (wanted.has(id)) score += 0.6;
    // A citizen who has been ill, or who is raising children, wants the drains
    // dug; one living under the smoke wants the flues scrubbed.
    if (tech.branch === 'medicine' && (isGlitched(c) || c.family.children.length > 0)) score += 0.5;
    if (id === 'flue_scrubbing' && burden > 0.2) score += burden * 2;
    if (tech.branch === 'agriculture' && world.market.goods.compute.price > world.market.goods.compute.basePrice * 1.2) score += 0.4;
    if (tech.branch === 'information' && c.personality.curiosity > 0.6) score += 0.3;
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

/** A concluded programme wants a decision: the Hall of Records, or the door shut. */
function trySettleFinding(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  for (const p of projectsOf(world, c.id)) {
    if (p.status === 'open' || p.finding !== 'undecided') continue;
    const key = `findingWeighed:${c.id}:${p.id}`;
    if (world.counters[key] === world.day) continue;
    world.counters[key] = world.day;
    if (p.status === 'succeeded') {
      // The one funder who may keep it weighs a monopoly that dies with them
      // against a name in the Hall of Records for ever.
      if (ctx.can.has('keep_secret') && secretKeeper(world, p) === c.id) {
        const hoard = 0.25 + (1 - c.personality.honesty) * 0.4 + c.personality.ambition * 0.25;
        if (chance(world, hoard)) return { type: 'keep_secret', projectId: p.id };
      }
      if (ctx.can.has('publish_finding')) return { type: 'publish_finding', projectId: p.id };
      continue;
    }
    // A paper for a programme that found nothing is L42. A citizen short of a
    // name and not much troubled by the truth of it sometimes files one.
    if (ctx.can.has('publish_finding') && c.personality.honesty < 0.3 && c.personality.ambition > 0.5
      && chance(world, 0.15)) {
      return { type: 'publish_finding', projectId: p.id };
    }
  }
  return null;
}

/** A purse that cannot pay the hour is a room nobody can work in. */
function tryFund(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('fund_project')) return null;
  const wage = hourlyWage(world);
  const thin = openProjects(world)
    .filter((p) => purseOf(world, p) < wage * THIN_PURSE_HOURS)
    .sort((a, b) => purseOf(world, a) - purseOf(world, b));
  if (thin.length === 0) return null;
  const spare = Math.min(PATRON_GIFT, Math.floor(c.wallet / 6));
  if (spare < wage) return null;
  // Whoever has already spent hours on it pays to keep it going; anybody else
  // has to be both comfortable and interested.
  // The hours already spent on it are the reason to keep it alive; even so, a
  // citizen does not empty its own wallet into a purse every hour of the day.
  const mine = thin.find((p) => (p.shifts[c.id] ?? 0) > 0 || p.openedById === c.id);
  if (mine && c.wallet >= PATRON_WALLET && chance(world, 0.35)) {
    return { type: 'fund_project', projectId: mine.id, amount: spare };
  }
  // A guild's master, a union's member and a business's owner are the only
  // funders who may close the door on a finding (`PROGRESS.md` §4), and a
  // programme near its cost is the one worth buying that door on. Publishing
  // pays in repute; secrecy pays in lumens, and this is where a citizen who
  // wants the second one puts its money.
  if (maySecrete(world, c.id) && c.wallet >= PATRON_WALLET) {
    const nearly = openProjects(world)
      .filter((p) => p.progress >= p.cost * 0.5 && purseOf(world, p) < wage * THIN_PURSE_HOURS * 2)
      .sort((a, b) => b.progress / b.cost - a.progress / a.cost)[0];
    if (nearly && chance(world, 0.25 * (0.5 + c.personality.ambition))) {
      return { type: 'fund_project', projectId: nearly.id, amount: Math.min(PATRON_GIFT * 2, Math.floor(c.wallet / 3)) };
    }
  }
  if (c.wallet < PATRON_WALLET * 2) return null;
  // The city's own reading of how open-handed they have been, which is the
  // only generosity anybody can see (`citizens/character.ts`).
  const odds = PATRON_CHANCE * (0.5 + c.personality.curiosity) * (1 + (c.character?.generosity ?? 0.5));
  if (!chance(world, odds)) return null;
  return { type: 'fund_project', projectId: thin[0].id, amount: spare };
}

/** An hour in the reading room, for the wage and for the subject. */
function tryReadingRoom(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  if (!clock.working) return null;
  if (ctx.can.has('research') && hoursLeftInTheRoom(ctx) > 0) {
    const options = fundedHere(ctx);
    if (options.length > 0) {
      world.counters[readKey(world, c.id)] = (world.counters[readKey(world, c.id)] ?? 0) + 1;
      return { type: 'research', projectId: options[0].id };
    }
  }
  // A Researcher with nothing open in front of them opens something. Which
  // subject is their own affair (`preferredSubject`), and the purse is empty
  // until somebody chooses to fill it.
  if (ctx.can.has('open_project')) {
    const key = `openedProgramme:${c.id}`;
    // Two programmes at a time is what the reading room has posts for; a
    // third would only take the hours off the two already open.
    if (openProjects(world).length < 2 && world.day - (world.counters[key] ?? -99) >= 5) {
      const running = new Set(openProjects(world).map((p) => p.technology));
      const options = openSubjects(heldFor(world, c.id)).filter((id) => !running.has(id));
      const subject = preferredSubject(ctx, options);
      if (subject) {
        world.counters[key] = world.day;
        return { type: 'open_project', technology: subject, name: `${TECHNOLOGIES[subject].name} programme` };
      }
    }
  }
  return null;
}

/**
 * The walk to the Observatory. A citizen with the analysis for it and no shift
 * of its own — or one that has worked what it means to work today — takes the
 * hour for a wage out of a purse somebody else filled. It is the same
 * arithmetic as a gig, and it is why the reading room is ever staffed.
 */
function tryWalkToReadingRoom(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  if (!clock.working || c.lifeStage === 'child') return null;
  if ((c.skills.analysis ?? 0) < RESEARCH_MIN_ANALYSIS) return null;
  if (c.shiftsToday >= world.config.maxShiftsPerDay) return null;
  if (ctx.job && ctx.job.district === c.district && c.shiftsToday < 4) return null;
  if (researchBuilding(world, c.district)) return null;
  if (hoursLeftInTheRoom(ctx) <= 0) return null;
  const wage = hourlyWage(world);
  const worth = openProjects(world).some((p) => purseOf(world, p) >= wage);
  if (!worth) return null;
  // Somebody with a post of their own only walks over when they have done
  // their own day; somebody without one goes for the wage.
  if (ctx.job && c.shiftsToday < 6 && !chance(world, 0.3)) return null;
  if (!ctx.job && !chance(world, 0.5 + c.personality.curiosity * 0.3)) return null;
  const room = readingRooms(world)[0];
  return room ? stepTo(ctx, room) : null;
}

/** What a master does with what only they know. */
function trySecrets(ctx: Ctx): Action | null {
  const { world, c, here } = ctx;
  const secrets = mySecrets(world, c);
  if (secrets.length === 0) return null;
  for (const id of secrets) {
    // An apprentice is the only way the technique outlives its master, and it
    // is also the end of the monopoly. Generosity decides it.
    if (ctx.can.has('take_apprentice')) {
      const heir = here.find((o) => o.lifeStage !== 'child' && !isMasterOf(world, o.id, id)
        && (bondBetween(world, c.id, o.id) >= 40 || c.family.children.includes(o.id)));
      if (heir && chance(world, APPRENTICE_CHANCE * (0.4 + (c.character?.generosity ?? 0.5) * 1.6))) {
        return { type: 'take_apprentice', citizen: heir.id, technology: id };
      }
    }
    if (ctx.can.has('sell_secret')) {
      const price = SECRET_PRICE_PER_TIER * TECHNOLOGIES[id].tier + randInt(world, 0, 60);
      const buyer = here.find((o) => o.lifeStage !== 'child' && !isMasterOf(world, o.id, id) && o.wallet >= price
        && (o.businessId !== null || o.personality.ambition > 0.6));
      if (buyer && chance(world, SELL_SECRET_CHANCE * (0.5 + c.personality.ambition))) {
        return { type: 'sell_secret', to: buyer.id, technology: id, price };
      }
    }
  }
  return null;
}

/** The works an owner builds out of its own till, for its own shifts. */
function tryOwnWorks(ctx: Ctx): Action | null {
  const { world, c, biz } = ctx;
  if (!biz || !ctx.can.has('adopt_technology') || biz.treasury < ADOPT_RESERVE) return null;
  // Not out of a business that is already losing money: the works are counted
  // as a cost the day they are paid for, and three such days close the doors.
  if (biz.daysNegative > 0) return null;
  const key = `worksWeighed:${c.id}`;
  if (world.counters[key] === world.day) return null;
  const wanted = TRADE_SUBJECTS[biz.kind] ?? [];
  for (const id of wanted) {
    if (!cityHolds(world, id) && !isMasterOf(world, c.id, id)) continue;
    const built = businessWorks(world, biz.id, id);
    if (built && built.worksPaid >= built.worksCost) continue;
    world.counters[key] = world.day;
    if (!chance(world, ADOPT_CHANCE + c.personality.ambition * 0.1)) return null;
    return { type: 'adopt_technology', technology: id };
  }
  return null;
}

/**
 * The layer's whole step on the ladder, in the order a citizen would actually
 * weigh it: what a finished programme needs decided, an hour to work, a purse
 * to fill, the walk to the room, and then what a master and an owner do with
 * what they hold.
 */
export function tryProgress(ctx: Ctx): Action | null {
  if (ctx.c.lifeStage === 'child') return null;
  return trySettleFinding(ctx)
    ?? tryReadingRoom(ctx)
    // An owner builds for its own shifts before it pays for anybody else's
    // hours: the works are the thing its own till actually buys.
    ?? tryOwnWorks(ctx)
    ?? tryFund(ctx)
    ?? tryWalkToReadingRoom(ctx)
    ?? trySecrets(ctx);
}
