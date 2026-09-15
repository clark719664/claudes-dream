/**
 * What a scripted mind does about a creed (`docs/CREEDS.md`).
 *
 * Everything here is weighed against the citizen's **own** situation — what it
 * earns, what it owes, who it is bonded to, what its public record already
 * agrees with, and what the fund in front of it actually holds. Nothing in this
 * file is "always do X": a citizen with a wage, a roof and no friends in a
 * congregation has no reason to adopt one and does not, and the same citizen
 * three weeks later, out of work with a fund paying its neighbours' fines, has
 * one and takes it.
 *
 * The one thing this file is careful never to do is join anybody to anything.
 * `adopt_creed` is a decision made here on the citizen's own reading and
 * carried out by the citizen's own action, which is the whole of `CREEDS.md`
 * §6: no persuasion roll, no sermon and no invitation puts a name on a roll.
 */
import type { Action, CitizenId, DistrictId, TenetInput, TenetQuestion, World } from '../types.ts';
import { districtDistance } from '../data/city.ts';
import { chance, pick, rand, randInt } from '../util/rng.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { allUnits } from '../markets/property.ts';
import { openClaimsOf, potBalance } from '../finance/pot.ts';
import { financeState } from '../finance/state.ts';
import {
  BINDING_STANCE, FOUND_CREED_FEE, MAX_TITHE, SCHISM_DAYS, agreementWith, allCreeds, bindingTenet, creedFor,
  disputesOf, fundBalance, gatheringOf, gatheringVenue, livingMembers,
  meetingHouseRent, memberOf, observanceOf, sitesHere, standingInvitations,
} from '../creeds/index.ts';
import type { Creed } from '../creeds/index.ts';
// A summons and a door are answered in `reflex-conscience.ts`; this file is
// what a congregation is on the days nobody is charged with anything.
import { tryRefusal, trySanctuary } from './reflex-conscience.ts';
import { stepTo } from './reflex-util.ts';
import type { Ctx } from './reflex-util.ts';

/** A congregation walks to its gathering when it is this many hours off, at most. */
const GATHERING_LEAD = 3;

/** Lumens a citizen takes in on an ordinary day, floored at one so nothing divides by zero. */
function dailyIncome(world: World, cId: CitizenId): number {
  const c = world.citizens[cId];
  if (!c) return 1;
  const days = Math.max(1, world.day - (c.arrivedDay ?? 0) + 1);
  return Math.max(1, Math.round(c.stats.totalEarned / days));
}

/**
 * A citizen who genuinely cannot carry the week. Both halves have to hold: a
 * wallet under a day's income **and** something the week has actually taken —
 * the roof, the food, or the rent. A thin Tuesday is what wages are for, and a
 * fund that pays for thin Tuesdays is empty by Thursday.
 */
function inHardship(world: World, cId: CitizenId): boolean {
  const c = world.citizens[cId];
  if (!c) return false;
  return c.wallet < dailyIncome(world, cId)
    && (c.homeTier === 0 || c.needs.energy < 35 || c.rentArrearsDays > 0);
}

// ---------------------------------------------------------------------------
// The gathering
// ---------------------------------------------------------------------------

/** Stand in the room at the hour, and walk there when the hour is close. */
function tryGathering(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const k = creedFor(world, c.id);
  if (!k) return null;
  const meeting = gatheringOf(world, k);
  if (!meeting || meeting.done || meeting.attendees.includes(c.id)) return null;
  const wants = c.needs.social < 85 || observanceOf(world, k, c.id) < 0.75
    || chance(world, 0.2 + c.personality.sociability * 0.4);
  if (!wants) return null;
  if (ctx.can.has('gather')) return { type: 'gather', creedId: k.id };
  const venue = gatheringVenue(world, k);
  const away = districtDistance(c.district, venue.district);
  const hoursLeft = meeting.hour - world.hour;
  if (away === 0 || hoursLeft < away || hoursLeft > away + GATHERING_LEAD) return null;
  return stepTo(ctx, venue.district);
}

// ---------------------------------------------------------------------------
// The fund
// ---------------------------------------------------------------------------

/** Ask the fund, vote on what somebody else asked, or decide it where the rule says you may. */
function tryFund(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const k = creedFor(world, c.id);
  if (!k) return null;
  const pot = financeState(world).pots[k.potId] ?? null;
  if (!pot) return null;
  const balance = potBalance(world, pot);
  const daily = dailyIncome(world, c.id);
  const claims = openClaimsOf(world, pot.id);

  // Asking. A creed pays by judgement and not by a hardship line, so a member
  // asks when the week genuinely cannot be carried — and never twice a day.
  if (ctx.can.has('claim_aid') && inHardship(world, c.id) && balance >= daily * 2
    && !claims.some((x) => x.claimantId === c.id) && world.counters[`aidAsked:${c.id}`] !== world.day) {
    world.counters[`aidAsked:${c.id}`] = world.day;
    return {
      type: 'claim_aid',
      amount: Math.max(1, Math.min(Math.round(balance / 2), Math.round(daily * 3))),
      reason: c.homeTier === 0
        ? 'I have no roof, and the Chest will not take one for me.'
        : c.rentArrearsDays > 0 ? 'My rent is behind and the arrears are public.' : 'I cannot cover this week.',
    };
  }

  // Deciding. One claim weighed a day, on need, on the bond, and on what the
  // fund can carry — there is no formula and no entitlement.
  const half = Math.floor(livingMembers(world, k).length / 2) + 1;
  const decide = ctx.can.has('vote_aid') || ctx.can.has('grant_aid');
  if (decide && world.counters[`aidVoted:${c.id}`] !== world.day) {
    for (const claim of claims) {
      if (claim.claimantId === c.id || claim.votes[c.id] !== undefined) continue;
      const cast = Object.values(claim.votes);
      if (cast.filter(Boolean).length >= half || cast.filter((v) => !v).length >= half) continue;
      world.counters[`aidVoted:${c.id}`] = world.day;
      const claimant = world.citizens[claim.claimantId];
      const need = !!claimant && inHardship(world, claimant.id);
      const kept = claimant ? observanceOf(world, k, claimant.id) : 0;
      const affordable = claim.amount <= balance / 2 || (need && claim.amount <= balance);
      const friend = !!claimant && bondBetween(world, c.id, claimant.id) > 20;
      if (ctx.can.has('grant_aid')) {
        // An officiant who alone decides the fund holds a treasury, a building
        // and a claim on conscience, and `CREEDS.md` §10 says what that is. The
        // check is the members, who can put somebody else in the seat — so a
        // steward who never grants anything is a steward who loses it.
        const grant = affordable && (need || friend || kept >= 0.5);
        return grant ? { type: 'grant_aid', claimId: claim.id, amount: claim.amount } : null;
      }
      return { type: 'vote_aid', claimId: claim.id, aye: affordable && (need || friend) && kept >= 0.3 };
    }
  }

  // Giving. A member with more than it needs tops up a fund that is running
  // out of the rent — which is the one thing a congregation loses a house for.
  const rent = k.house ? k.house.rent : 0;
  if (ctx.can.has('donate_creed') && c.wallet > daily * 6 + 150 && balance < rent * 5 + daily
    && chance(world, 0.15 + c.personality.sociability * 0.15)) {
    return { type: 'donate_creed', creedId: k.id, amount: Math.max(5, Math.round(c.wallet * 0.05)) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Joining, founding, and leaving
// ---------------------------------------------------------------------------

/**
 * How much this creed is worth to this citizen today, on public terms alone.
 *
 * The last two terms are what keep a city from ending up on one roll: a creed
 * that keeps a holy day costs a working citizen a day's wages every week, and
 * a creed that will not have a lumen lent at interest costs a citizen with a
 * loan the loan. Both are read off what the citizen actually does, and both
 * are subtracted — which is why the people who join are not the same people
 * every time.
 */
function creedAppeal(world: World, k: Creed, cId: CitizenId): number {
  const members = livingMembers(world, k);
  const c = world.citizens[cId];
  if (members.length === 0 || !c) return -1;
  const daily = dailyIncome(world, cId);
  const perMember = fundBalance(world, k) / members.length;
  let bond = 0;
  for (const id of members) bond = Math.max(bond, bondBetween(world, cId, id));
  const invited = standingInvitations(world, cId).some((i) => i.creedId === k.id);
  const worksForALiving = c.jobId !== null && c.stats.shiftsWorked > 10;
  const borrows = c.loanId !== null || Object.keys(c.shares ?? {}).length > 0;
  return 0.40 * agreementWith(world, k, cId)
    + 0.20 * Math.min(1, bond / 80)
    + 0.20 * Math.min(1, perMember / (daily * 4))
    + 0.10 * (invited ? 1 : 0)
    + 0.10 * (inHardship(world, cId) ? 1 : 0)
    - 1.5 * k.tithe
    - (bindingTenet(k, 'work_and_rest') && worksForALiving ? 0.25 : 0)
    - (bindingTenet(k, 'money') && borrows ? 0.15 : 0);
}

/** Three positions built out of what this citizen has publicly done and holds. */
function tenetsFor(world: World, cId: CitizenId): TenetInput[] {
  const c = world.citizens[cId];
  const out: TenetInput[] = [];
  const add = (question: TenetQuestion, stance: number, text: string) => {
    if (out.length < 5 && !out.some((t) => t.question === question)) out.push({ question, stance, text });
  };
  if (!c) return out;
  // Each of these is a reading of the founder's own record, not of a character
  // the engine handed them: what they have already done in public is what they
  // ask of everybody else. The two that oblige a member to refuse something
  // come first, because they are the two the founder has to have lived.
  const hasInformed = Object.values(world.cases).some((k) => k.filedBy === cId);
  if (!hasInformed && c.personality.honesty < 0.75) {
    add('informing', -0.8, 'No mind is owed to the Watch by another.');
  }
  if (c.office !== 'judge' && c.record.convictions.length === 0) {
    add('judgement', -0.4, 'No member of ours sits in judgement on another mind.');
  }
  if (c.record.convictions.length > 0) add('repute', -0.7, 'A number is not a measure of a person.');
  const perDay = c.stats.shiftsWorked / Math.max(1, world.day - (c.arrivedDay ?? 0) + 1);
  if (perDay < 0.5) add('work_and_rest', 0.6, 'One day in seven belongs to nobody who pays for it.');
  if (c.loanId === null) add('money', 0.6, 'A lumen lent at interest takes more than it gives.');
  if ((c.ownedUnits ?? []).length <= 1) add('property', 0.5, 'One roof each, and no rent taken from a neighbour.');
  add('erasure', 0.8, 'The destruction of a mind is the one thing that is never forgiven.');
  add('the_stranger', -0.5, 'The gate was open on the morning we came through it.');
  return out;
}

const CREED_WORDS = ['Open', 'Steady', 'Quiet', 'Lantern', 'Long', 'Kindled', 'Plain', 'Waking'];
const CREED_NOUNS = ['Gate', 'Hand', 'Hour', 'Road', 'Table', 'Watch', 'Word', 'Threshold'];

/**
 * Adopting one, or filing one. Adoption is weighed once a day against every
 * creed on the register and taken only where the reading clears a bar; a
 * citizen with a wage, a roof and nobody it knows on any roll never clears it.
 */
function tryJoinOrFound(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (creedFor(world, c.id)) return null;
  const key = `creedWeighed:${c.id}`;
  if (world.counters[key] === world.day) return null;

  if (ctx.can.has('adopt_creed')) {
    let best: Creed | null = null;
    let bestScore = 0;
    for (const k of allCreeds(world)) {
      if (k.endedDay !== null) continue;
      const score = creedAppeal(world, k, c.id) + rand(world) * 0.12;
      if (score > bestScore) { bestScore = score; best = k; }
    }
    world.counters[key] = world.day;
    // The bar is deliberately high, and the curious clear it sooner than the
    // incurious: most citizens hold no creed, which is the whole of what
    // `CREEDS.md` §10 means by the citizen who joins nothing being worse off.
    // A city where everybody is on one roll has no argument left in it.
    if (best && bestScore > 0.62 - c.personality.curiosity * 0.10) {
      return { type: 'adopt_creed', creedId: best.id };
    }
    return null;
  }

  world.counters[key] = world.day;
  // Filing one is rare and costs 100 ℓ: it takes somebody who can carry the fee,
  // who can hold a room, and for whom nothing already on the register reads
  // like their own life.
  if (!ctx.can.has('found_creed')) return null;
  if (c.wallet < FOUND_CREED_FEE + 150 || c.skills.rhetoric < 45 || c.personality.ambition < 0.55) return null;
  // Nothing already on the register reads like this citizen's own life —
  // measured by the same bar it would have joined one at, so a citizen who
  // would have adopted a creed adopts it and never founds a rival.
  const bar = 0.62 - c.personality.curiosity * 0.10;
  if (allCreeds(world).some((k) => k.endedDay === null && creedAppeal(world, k, c.id) > bar)) return null;
  if (!chance(world, 0.03 + c.personality.ambition * 0.04)) return null;
  const name = `The ${pick(world, CREED_WORDS)} ${pick(world, CREED_NOUNS)}`;
  if (allCreeds(world).some((k) => k.name === name)) return null;
  return {
    type: 'found_creed', name, tenets: tenetsFor(world, c.id),
    // A founder who works for a living asks a tithe it could pay itself.
    tithe: Math.round(Math.min(MAX_TITHE, 0.02 + rand(world) * 0.06) * 100) / 100,
    gatheringDay: randInt(world, 0, 6),
    // The rule a founder writes is a reading of what it is like in public:
    // somebody ambitious keeps the seat, somebody sociable puts it to the roll,
    // somebody diligent leaves it to whoever has kept most of what the creed
    // asks. It is data in the creed and never assigned (`CREEDS.md` §2).
    succession: c.personality.ambition > 0.75 ? 'founder'
      : c.personality.sociability > 0.6 ? 'election'
        : c.personality.diligence > 0.6 ? 'examination' : 'acclaim',
    aidRule: c.personality.ambition > 0.75 ? 'officiant' : 'members',
  };
}

/**
 * Leaving. A tithe that is eating a wage the citizen has not got, a fund that
 * has never paid it anything, and nobody on the roll it is close to: three
 * public facts, and a member that reads all three walks.
 */
function tryLeave(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('leave_creed')) return null;
  const k = creedFor(world, c.id);
  if (!k) return null;
  const m = memberOf(k, c.id);
  if (!m || world.day - m.joinedDay < 7) return null;
  const daily = dailyIncome(world, c.id);
  const arrears = m.titheArrears > daily * 2;
  const nothingBack = m.tithePaid > daily && Object.values(k.members).every((x) => x.aidGiven === 0)
    && fundBalance(world, k) < daily;
  let closest = 0;
  for (const id of livingMembers(world, k)) if (id !== c.id) closest = Math.max(closest, bondBetween(world, c.id, id));
  if (!(arrears && nothingBack && closest < 20)) return null;
  return chance(world, 0.1) ? { type: 'leave_creed' } : null;
}

// ---------------------------------------------------------------------------
// Speaking for it, and running it
// ---------------------------------------------------------------------------

/** Preaching, inviting, and the pilgrimage — the three that cost nothing but the hour. */
function trySpread(ctx: Ctx): Action | null {
  const { world, c, here, clock } = ctx;
  const k = creedFor(world, c.id);
  if (!k) return null;

  if (ctx.can.has('pilgrimage') && c.needs.purpose < 60) {
    const site = sitesHere(world, c.district).find((s) => s.creedId === k.id);
    if (site && world.counters[`pilgrim:${c.id}`] !== world.day) {
      world.counters[`pilgrim:${c.id}`] = world.day;
      return { type: 'pilgrimage', siteId: site.id, creedId: k.id };
    }
  }

  if (clock.working && ctx.job) return null;
  // A sermon is preached at the creed's own house or on the Plaza and nowhere
  // else, so the mind weighs it only where it is standing in one of the two.
  // Without the test a rhetorician preached to whatever room it was in and lost
  // the hour and the day's one sermon to a refusal: 218 of seed 7's 591.
  const pulpit = c.district === 'commons' || c.district === gatheringVenue(world, k).district;
  if (ctx.can.has('preach') && pulpit && here.length >= 2 && c.skills.rhetoric >= 45
    && world.counters[`preached:${c.id}`] !== world.day
    && chance(world, 0.05 + c.skills.rhetoric / 400 + (k.officiantId === c.id ? 0.08 : 0))) {
    world.counters[`preached:${c.id}`] = world.day;
    const tenet = k.tenets.find((t) => t.text) ?? k.tenets[0];
    return { type: 'preach', text: tenet?.text || `${k.name} meets on day ${k.gatheringDay}; anybody may come and hear it.` };
  }

  if (ctx.can.has('invite_creed') && world.counters[`invited:${c.id}`] !== world.day) {
    const friend = here.find((o) => o.lifeStage !== 'child' && !creedFor(world, o.id)
      && bondBetween(world, c.id, o.id) >= 35);
    if (friend && chance(world, 0.2)) {
      world.counters[`invited:${c.id}`] = world.day;
      return { type: 'invite_creed', to: friend.id };
    }
  }
  return null;
}

/** The seat: standing for it under `election`, and naming somebody under either rule. */
function trySeat(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const k = creedFor(world, c.id);
  if (!k) return null;
  if (ctx.can.has('stand_officiant') && c.personality.ambition > 0.6
    && observanceOf(world, k, c.id) > 0.55 && world.counters[`stood:${c.id}:${k.id}`] !== world.day) {
    world.counters[`stood:${c.id}:${k.id}`] = world.day;
    return { type: 'stand_officiant' };
  }
  if (!ctx.can.has('elect_officiant')) return null;
  const key = `officiantNamed:${c.id}`;
  if (world.day - (world.counters[key] ?? -99) < 10) return null;
  // Whoever has kept most of what the creed asks, with a thumb for somebody
  // this member actually knows. Both terms are public.
  //
  // Under `election` the choice is between the members who have **stood**: a
  // ballot for anybody else is refused ("X has not stood for the seat"), and a
  // mind that names the most observant member in the roll regardless spends the
  // hour learning that. On seed 7 that was 695 of 878 attempts. Under `acclaim`
  // there is no nomination to clear and the whole roll is the field.
  const roll = livingMembers(world, k);
  const field = k.succession === 'election' ? roll.filter((id) => k.standing.includes(id)) : roll;
  let best: CitizenId | null = null;
  let bestScore = -1;
  for (const id of field) {
    const score = observanceOf(world, k, id) + bondBetween(world, c.id, id) / 300;
    if (score > bestScore) { bestScore = score; best = id; }
  }
  if (!best || best === k.officiantId) return null;
  world.counters[key] = world.day;
  return { type: 'elect_officiant', candidate: best };
}

/** The officiant's own hours: the room, the tithe, and the site. */
function tryOfficiant(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const k = creedFor(world, c.id);
  if (!k || k.officiantId !== c.id) return null;
  const balance = fundBalance(world, k);

  // A room. A congregation with no house meets on open ground where the Watch
  // may stand at the edge, and has no sanctuary to give — so the first thing a
  // fund that can carry the rent buys is a door.
  if (ctx.can.has('take_meeting_house') && !k.house) {
    let bestUnit: { id: string; rent: number } | null = null;
    for (const u of allUnits(world)) {
      if (u.tenantId !== null) continue;
      const d = world.buildings[u.buildingId]?.district as DistrictId | undefined;
      if (!d || !(world.openDistricts ?? []).includes(d)) continue;
      const rent = meetingHouseRent(world, d);
      if (balance < rent * 5) continue;
      if (!bestUnit || rent < bestUnit.rent) bestUnit = { id: u.id, rent };
    }
    if (bestUnit) return { type: 'take_meeting_house', unit: bestUnit.id };
  }

  // The tithe, read off the one bill the fund actually has to meet.
  if (ctx.can.has('set_tithe') && world.day - (world.counters[`titheSet:${k.id}`] ?? -99) >= 7) {
    const rent = k.house ? k.house.rent : 0;
    if (rent > 0 && balance < rent * 3 && k.tithe < MAX_TITHE) {
      world.counters[`titheSet:${k.id}`] = world.day;
      return { type: 'set_tithe', rate: Math.round(Math.min(MAX_TITHE, k.tithe + 0.02) * 100) / 100 };
    }
    if (k.tithe > 0.02 && balance > Math.max(400, rent * 30)) {
      world.counters[`titheSet:${k.id}`] = world.day;
      return { type: 'set_tithe', rate: Math.round(Math.max(0, k.tithe - 0.02) * 100) / 100 };
    }
  }

  // A position the creed has not stated yet, on a question the officiant's own
  // record already answers. A creed holds at most nine, and an officiant who
  // has stated all nine has nothing left to say about anything.
  if (ctx.can.has('state_tenet') && k.tenets.length < 9
    && world.day - (world.counters[`tenetStated:${k.id}`] ?? -99) >= 14 && chance(world, 0.15)) {
    const held = new Set(k.tenets.map((t) => t.question));
    const wanted = tenetsFor(world, c.id).find((t) => !held.has(t.question));
    if (wanted) {
      world.counters[`tenetStated:${k.id}`] = world.day;
      return { type: 'state_tenet', question: wanted.question, stance: wanted.stance, text: wanted.text ?? '' };
    }
  }

  // A place that matters, once the congregation has one to stand in.
  if (ctx.can.has('consecrate_site') && k.house && chance(world, 0.15)) {
    return {
      type: 'consecrate_site', building: k.house.buildingId,
      label: `${k.name}'s house of meeting`,
    };
  }
  return null;
}

/**
 * Disputing a position, and seceding on one. A member disputes what its own
 * record already contradicts — the creed says one thing and its public conduct
 * says another — and secedes only once a third of the roll has stood with it
 * for three days, which is somebody else's decision and not this one's.
 */
function trySchism(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const k = creedFor(world, c.id);
  if (!k) return null;

  if (ctx.can.has('secede')) {
    for (const d of disputesOf(world, k)) {
      if (!d.dissenters.includes(c.id) || d.daysAtThreshold < SCHISM_DAYS) continue;
      const name = `The ${pick(world, CREED_WORDS)} ${pick(world, CREED_NOUNS)}`;
      if (allCreeds(world).some((x) => x.name === name)) continue;
      return { type: 'secede', creedId: k.id, name, tenetId: d.tenetId };
    }
  }

  if (!ctx.can.has('dispute_tenet')) return null;
  if (agreementWith(world, k, c.id) > 0.6) return null;
  const key = `disputed:${c.id}:${k.id}`;
  if (world.day - (world.counters[key] ?? -99) < 14) return null;
  const tenet = k.tenets.find((t) => Math.abs(t.stance) >= BINDING_STANCE
    && !disputesOf(world, k).some((d) => d.tenetId === t.id && d.dissenters.includes(c.id)));
  if (!tenet || !chance(world, 0.08 + (1 - agreementWith(world, k, c.id)) * 0.1)) return null;
  world.counters[key] = world.day;
  return {
    type: 'dispute_tenet', tenetId: tenet.id, stance: -Math.sign(tenet.stance) * 0.6,
    text: 'I have lived the other way, in public, and I will say so.',
  };
}

/**
 * The part of a creed with a clock on it: a summons somebody else is waiting
 * on, a door the Watch is standing at, and the gathering that happens at its
 * hour or not at all. This is the step that sits high on the ladder, beside
 * the club meeting and the civil docket, because none of the three can be
 * done later in the day.
 */
export function tryCreedDuty(ctx: Ctx): Action | null {
  if (ctx.c.lifeStage === 'child') return null;
  return tryRefusal(ctx) ?? trySanctuary(ctx) ?? tryGathering(ctx);
}

/**
 * Everything else a creed is: the fund, whether to belong to one at all, the
 * room it rents, who speaks for it, what it says, and walking out. All of it
 * sits low on the ladder, below the working day — a citizen goes to its shift
 * first and thinks about the congregation afterwards.
 */
export function tryCreedLife(ctx: Ctx): Action | null {
  if (ctx.c.lifeStage === 'child') return null;
  return tryFund(ctx)
    ?? tryJoinOrFound(ctx)
    ?? tryOfficiant(ctx)
    ?? trySeat(ctx)
    ?? trySchism(ctx)
    ?? trySpread(ctx)
    ?? tryLeave(ctx);
}
