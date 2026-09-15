/**
 * What a scripted mind does about its name (`docs/GENERATIONS.md`).
 *
 * Every step below reads facts the citizen can see about **its own**
 * situation: how many adults carry its name, what its house's treasury holds
 * against the levy that falls due, whether anybody it is bonded to has moved
 * something before the members, whether it has anything to leave and anybody to
 * leave it to. Nothing here is "always do X" — a citizen with 40 lumens, no
 * kin in the city and nobody sharing its surname reaches none of it, and the
 * same citizen with a partner, two grown children and a shopfront reaches most
 * of it.
 *
 * Nothing here reads a house into a gate, a sentence or a repute, and nothing
 * here puts anybody into a family: `join_house` is a request the members
 * answer, and `renounce_name` is the way out (`GENERATIONS.md` §§4, 6).
 */
import type { Action, Citizen, CitizenId, HouseRule, World } from '../types.ts';
import { chance, rand } from '../util/rng.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { loanOf } from '../economy/bank.ts';
import { unitsFor } from '../markets/property.ts';
import { reputeOf } from '../standing/repute.ts';
import {
  FOUND_HOUSE_COST, allHouses, houseAdults, houseFor, houseHeaded, houseReputeFor, houseTreasury, levyDue,
  livingAdults, motionTally, openMatchesFor, openMotionsOf, showsDescent, willOf,
} from '../generations/index.ts';
import type { House, HouseMotion } from '../generations/index.ts';
import type { Ctx } from './reflex-util.ts';

/** Lumens a citizen keeps back before it endows anybody with anything. */
const RESERVE = 120;
/** How far below its own name a citizen has to stand before renouncing is even weighed. */
const LEDGER_GAP = 150;

/** Everybody this citizen would call kin: partner, parents, children, siblings. */
function kinOf(world: World, c: Citizen): CitizenId[] {
  const out = new Set<CitizenId>();
  if (c.family.partnerId) out.add(c.family.partnerId);
  for (const id of c.family.parents) {
    out.add(id);
    for (const sib of world.citizens[id]?.family.children ?? []) if (sib !== c.id) out.add(sib);
  }
  for (const id of c.family.children) out.add(id);
  return [...out];
}

// ---------------------------------------------------------------------------
// The motions the adults decide together
// ---------------------------------------------------------------------------

/**
 * How this citizen reads one motion of its house. Each kind is answered on a
 * public fact: whether the house can pay what it owes, whether the citizen
 * knows the person named, and what the rule change would do to a house it is
 * a member of.
 */
function readsMotion(world: World, c: Citizen, h: House, m: HouseMotion): boolean {
  const target = m.target ? world.citizens[m.target] : null;
  switch (m.kind) {
    case 'admit':
      // A house takes in the people its members actually know.
      return !!target && (bondBetween(world, c.id, target.id) >= 25 || kinOf(world, c).includes(target.id));
    case 'sell':
      // Selling out of the entail is what a house does when the levy has run
      // ahead of it. With the levy paid, the holding stays.
      return h.levyArrears > 0 || houseTreasury(world, h) < levyDue(world, h);
    case 'campaign':
      return !!target && (bondBetween(world, c.id, target.id) >= 20 || target.id === c.id)
        && houseTreasury(world, h) >= (m.value ?? 0) * 2;
    case 'letter':
      return !!target && bondBetween(world, c.id, target.id) >= 0;
    case 'rule':
      // Four fifths, and a member votes for the rule that gives it a say: the
      // eldest of a young house is against `eldest`, and so on.
      return m.target === 'assent'
        ? houseAdults(world, h).length > 2
        : bondBetween(world, c.id, m.movedBy) >= 20;
    default:
      return false;
  }
}

/** Vote on what somebody has moved: it is the one thing here with a clock on it. */
function tryAssent(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('house_assent')) return null;
  const h = houseFor(world, c.id);
  if (!h) return null;
  for (const m of openMotionsOf(world, h)) {
    if (m.votes[c.id] !== undefined) continue;
    const tally = motionTally(world, h, m);
    if (tally.ayes >= tally.needed) continue;
    return { type: 'house_assent', motionId: m.id, aye: readsMotion(world, c, h, m) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The will
// ---------------------------------------------------------------------------

/** What a citizen would leave behind today: lumens, deeds and a concern. */
function estateWorth(world: World, c: Citizen): number {
  return c.wallet + unitsFor(world, c.id).length * 200 + (c.businessId ? 150 : 0);
}

/**
 * Filing where the estate goes. A citizen files one when it has something to
 * leave and somebody to leave it to — and refiles when the family it named has
 * changed, because a will is public and refilable and the last filing stands.
 *
 * What it writes is not the default division; a will that only says what the
 * law would have said anyway is 10 lumens for nothing. It differs on purpose:
 * a slice to the closest friend outside the family, and the residue to the
 * Community Chest for a citizen with no family at all.
 */
function tryWill(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('write_will')) return null;
  if (estateWorth(world, c) < 200) return null;
  const kin = kinOf(world, c).filter((id) => !!world.citizens[id]);
  const existing = willOf(world, c.id);
  const key = `willFiled:${c.id}`;
  if (existing && world.counters[key] === kin.length) return null;
  const partner = c.family.partnerId;

  // The tenth a will can say something with: the friend the family never
  // counted, or the Chest where there is no family at all.
  let friend: CitizenId | null = null;
  let best = 40;
  for (const id in c.bonds) {
    if (kin.includes(id) || id === partner) continue;
    if (c.bonds[id] > best) { best = c.bonds[id]; friend = id; }
  }
  // Somebody to leave it to. A citizen with no family, no friend and no years
  // behind it has nothing a will would say that the default division does not
  // already say, and 10 lumens is 10 lumens.
  if (kin.length === 0 && !friend && c.lifeStage !== 'elder') return null;
  // An elder writes one soon; everybody else gets round to it.
  const urgency = c.lifeStage === 'elder' ? 0.25 : c.family.children.length > 0 ? 0.06 : 0.02;
  if (!chance(world, urgency)) return null;

  const shares: { to: CitizenId | 'chest'; percent: number }[] = [];
  const children = c.family.children.filter((id) => !!world.citizens[id]);
  if (partner && children.length > 0) {
    shares.push({ to: partner, percent: 45 });
    for (const id of children) shares.push({ to: id, percent: Math.floor(45 / children.length) });
  } else if (partner) {
    shares.push({ to: partner, percent: 90 });
  } else if (children.length > 0) {
    for (const id of children) shares.push({ to: id, percent: Math.floor(90 / children.length) });
  }
  if (friend) shares.push({ to: friend, percent: 10 });
  if (shares.length === 0) shares.push({ to: 'chest', percent: 100 });
  world.counters[key] = kin.length;
  return {
    type: 'write_will', shares,
    residue: partner ?? 'chest',
    instructions: kin.length > 0
      ? `Filed on day ${world.day}. Read it while I am here to argue about it.`
      : `Filed on day ${world.day}. I have no family; what is left goes where it is needed.`,
  };
}

// ---------------------------------------------------------------------------
// Founding, joining, and leaving a name
// ---------------------------------------------------------------------------

/** The rule a founder writes, read off what it is like in public life. */
function ruleFor(c: Citizen): HouseRule {
  if (c.personality.ambition > 0.7) return 'chosen';
  if (c.personality.sociability > 0.6) return 'assent';
  return c.personality.curiosity > 0.6 ? 'founder_line' : 'eldest';
}

/** Filing a house, asking to be admitted to one, or reviving a dormant one. */
function tryBelonging(ctx: Ctx): Action | null {
  const { world, c } = ctx;

  // A dormant house somebody can show descent from is the cheapest name in the
  // city: the holdings, the arrears and the stain all come together.
  if (ctx.can.has('claim_house')) {
    const dormant = allHouses(world).find((h) => h.dormantDay !== null && showsDescent(world, c.id, h));
    if (dormant && chance(world, 0.25)) return { type: 'claim_house', houseId: dormant.id };
  }

  if (ctx.can.has('found_house')) {
    // 500 ℓ is most of a fortnight's wages, so it takes somebody who can carry
    // it and who wants the name to mean something.
    if (c.wallet >= FOUND_HOUSE_COST + RESERVE && chance(world, 0.2 + c.personality.ambition * 0.4)) {
      return { type: 'found_house', name: c.familyName, rule: ruleFor(c) };
    }
  }

  if (ctx.can.has('join_house')) {
    const key = `houseAsked:${c.id}`;
    if (world.day - (world.counters[key] ?? -99) < 14) return null;
    // Nobody asks a stranger for a name. What they ask for is the name of the
    // person they live with, or the family they are already half in.
    const kin = kinOf(world, c);
    for (const h of allHouses(world)) {
      if (h.dormantDay !== null || h.name === c.familyName) continue;
      const known = livingAdults(world, h.name).some((m) => kin.includes(m.id) || bondBetween(world, c.id, m.id) >= 50);
      if (!known) continue;
      world.counters[key] = world.day;
      return { type: 'join_house', houseId: h.id };
    }
  }

  // Renouncing: the ledger of the house prints who stands 150 above their name
  // and who stands below it, and the way out of the expectation is a name of
  // your own. It costs everything the name was worth, so it is rare.
  if (ctx.can.has('renounce_name')) {
    const gap = reputeOf(world, c.id) - houseReputeFor(world, c.id);
    const kin = kinOf(world, c);
    const alone = kin.every((id) => bondBetween(world, c.id, id) < 10);
    if (gap < -LEDGER_GAP && alone && chance(world, 0.02)) return { type: 'renounce_name' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The entail
// ---------------------------------------------------------------------------

/**
 * What a member puts into the house. Both of these take something out of the
 * citizen's own estate for good, so both are weighed on the one thing that
 * makes them worth doing: an estate large enough for the duty to bite, and a
 * house solvent enough to hold it.
 */
function tryEntail(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const h = houseFor(world, c.id);
  if (!h) return null;
  const due = levyDue(world, h) + h.levyArrears;
  const treasury = houseTreasury(world, h);

  // Lumens first. A house with nothing in its strongbox can do nothing at all:
  // it cannot pay the levy on what it holds, it cannot fund a member standing
  // for the Council, and it has no dowry to settle a match with. A member with
  // more than it needs puts something in — urgently where the levy is already
  // behind, and now and then otherwise.
  if (ctx.can.has('endow_house') && c.wallet > RESERVE * 2) {
    const behind = treasury < due;
    if (behind || (treasury < 300 && chance(world, 0.06 + c.personality.ambition * 0.08))) {
      const want = behind ? Math.max(due * 2, 25) : Math.round(c.wallet * 0.15);
      return { type: 'endow_house', amount: Math.max(10, Math.min(Math.round(c.wallet - RESERVE), want)) };
    }
  }

  if (ctx.can.has('convey_to_house')) {
    const mine = unitsFor(world, c.id).filter((u) => !h.units.includes(u.id));
    // Keep the roof you live under; entail the rest — and an elder, whose
    // estate is nearer than most, entails sooner.
    const spare = mine.filter((u) => u.buildingId !== c.homeBuildingId);
    const wanted = c.lifeStage === 'elder' ? mine : spare;
    if (wanted.length > 0 && chance(world, c.lifeStage === 'elder' ? 0.12 : 0.04)) {
      return { type: 'convey_to_house', unit: wanted[0].id };
    }
  }

  if (ctx.can.has('convey_business_to_house') && c.lifeStage === 'elder' && chance(world, 0.06)) {
    return { type: 'convey_business_to_house', businessId: c.businessId as string };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The head's own hours
// ---------------------------------------------------------------------------

/** Moving something before the members, and the instruments only a head holds. */
function tryHeadship(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const h = houseHeaded(world, c.id);
  const own = houseFor(world, c.id);

  // Electing one, under the rule that elects one. Once a week is plenty:
  // the tally is read every morning.
  if (ctx.can.has('house_vote') && own && world.day - (world.counters[`headVoted:${c.id}`] ?? -99) >= 7) {
    let best: CitizenId | null = null;
    let bestScore = -1;
    for (const m of houseAdults(world, own)) {
      const score = m.reputation / 100 + bondBetween(world, c.id, m.id) / 200 + (m.id === c.id ? 0.2 : 0);
      if (score > bestScore) { bestScore = score; best = m.id; }
    }
    if (best) {
      world.counters[`headVoted:${c.id}`] = world.day;
      return { type: 'house_vote', candidate: best };
    }
  }

  if (!h) return null;

  // The successor, under `chosen`: the eldest adult of the name who is not you.
  if (ctx.can.has('name_successor') && h.successorId === null) {
    const heir = houseAdults(world, h)
      .filter((m) => m.id !== c.id)
      .sort((a, b) => (a.bornDay ?? 0) - (b.bornDay ?? 0))[0];
    if (heir) return { type: 'name_successor', to: heir.id };
  }

  // The levy, when the treasury cannot meet it: move to sell the holding
  // rather than wait for the Exchange to sell it up.
  if (ctx.can.has('house_motion') && world.day - (world.counters[`houseMoved:${h.id}`] ?? -99) >= 3) {
    const due = levyDue(world, h) + h.levyArrears;
    const open = openMotionsOf(world, h);
    if (h.levyArrears > 0 && h.units.length > 0 && !open.some((m) => m.kind === 'sell')) {
      world.counters[`houseMoved:${h.id}`] = world.day;
      return { type: 'house_motion', kind: 'sell', target: h.units[0] };
    }
    // A relative standing for the Council, and lumens in the treasury: the one
    // thing a house may lawfully spend on a candidate is visibility by the
    // hour. Paying a voter is still L14 and nothing here goes near it.
    const candidates = world.government.election.candidates;
    const kinCandidate = houseAdults(world, h).find((m) => candidates.includes(m.id));
    if (kinCandidate && houseTreasury(world, h) > 200 && !open.some((m) => m.kind === 'campaign')) {
      world.counters[`houseMoved:${h.id}`] = world.day;
      return {
        type: 'house_motion', kind: 'campaign', target: kinCandidate.id,
        value: Math.round(Math.min(houseTreasury(world, h) * 0.3, 150)),
      };
    }
  }

  // The pledge: 8× income instead of 5× and up to 0.6 % a day off the rate,
  // against property the bank really seizes. A head pledges for itself, or for
  // somebody it is close to, and not for a name it barely knows.
  if (ctx.can.has('pledge_house')) {
    for (const m of houseAdults(world, h)) {
      const loan = loanOf(world, m);
      if (!loan || loan.outstanding <= 0 || loan.defaulted) continue;
      if (m.id !== c.id && bondBetween(world, c.id, m.id) < 40) continue;
      if (chance(world, 0.3)) return { type: 'pledge_house', loanId: loan.id };
    }
  }

  // A letter costs the house nothing until the citizen it named is convicted,
  // which is exactly why the willingness to file one is worth anything.
  if (ctx.can.has('letter_of_house') && world.day - (world.counters[`letterFiled:${h.id}`] ?? -99) >= 7) {
    const forWhom = houseAdults(world, h).find((m) => m.id !== c.id && m.reputation < 45
      && bondBetween(world, c.id, m.id) >= 20);
    if (forWhom && chance(world, 0.2)) {
      world.counters[`letterFiled:${h.id}`] = world.day;
      return { type: 'letter_of_house', to: forWhom.id, city: 'reverie' };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

/**
 * A settlement between two houses. It marries nobody: the couple still need
 * seven days as partners and a bond above 75, and no head marries anybody off.
 * What it is for is the dowry and the feud it ends.
 */
function tryMatch(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const h = houseHeaded(world, c.id);
  if (!h) return null;

  // Answering one. A dowry worth having is taken; a token is sent back.
  if (ctx.can.has('accept_match')) {
    for (const m of openMatchesFor(world, h)) {
      if (m.toHouseId !== h.id) continue;
      if (m.dowry >= 50 || m.unitId) return { type: 'accept_match', offerId: m.id };
      if (chance(world, 0.4)) return { type: 'close_offer', offerId: m.id };
    }
  }

  if (!ctx.can.has('offer_match')) return null;
  const treasury = houseTreasury(world, h);
  if (treasury < 100 || world.day - (world.counters[`matchOffered:${h.id}`] ?? -99) < 7) return null;
  // Somebody of ours who is attached to somebody of theirs: that is what a
  // settlement settles, and without one there is nothing to negotiate about.
  for (const other of allHouses(world)) {
    if (other.id === h.id || other.dormantDay !== null) continue;
    const tie = houseAdults(world, h).some((mine) => houseAdults(world, other).some((theirs) => {
      if (mine.family.partnerId === theirs.id) return true;
      return bondBetween(world, mine.id, theirs.id) >= 55;
    }));
    if (!tie) continue;
    if (openMatchesFor(world, h).some((m) => m.toHouseId === other.id)) continue;
    world.counters[`matchOffered:${h.id}`] = world.day;
    return {
      type: 'offer_match', house: other.id,
      dowry: Math.max(50, Math.round(treasury * 0.25)),
      terms: `The ${h.name}s settle with the ${other.name}s; the couple decide for themselves.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The Hall of Records
// ---------------------------------------------------------------------------

/** An hour at the registers: the tree, the roll, or the name somebody just mentioned. */
function tryRecords(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  if (!ctx.can.has('read_records')) return null;
  if (clock.working && ctx.job) return null;
  if (world.counters[`records:${c.id}`] === world.day) return null;
  // Everybody has a line in the tree, so everybody has something to look up.
  const curious = c.personality.curiosity > 0.5;
  if (!curious || !chance(world, 0.06 + c.personality.curiosity * 0.06)) return null;
  world.counters[`records:${c.id}`] = world.day;
  // What a citizen looks up: its own line, or the house it has been hearing about.
  const roll = allHouses(world).filter((h) => h.dormantDay === null);
  const subject = roll.length > 0 && rand(world) < 0.5 ? roll[Math.floor(rand(world) * roll.length)].name : c.id;
  return { type: 'read_records', subject };
}

/**
 * The one part of a house with a clock on it: a motion the adults are waiting
 * on this citizen to answer. A motion decides two days after it is moved
 * whether or not everybody has voted, so a member who leaves it until the
 * evening has abstained by arithmetic.
 */
export function tryHouseDuty(ctx: Ctx): Action | null {
  if (ctx.c.lifeStage === 'child') return null;
  return tryAssent(ctx);
}

/**
 * The rest of it: the head's own instruments, a settlement between two houses,
 * belonging to one at all, what a member puts into the entail, the will, and
 * an hour at the Hall of Records. All of it below the working day.
 */
export function tryHouseLife(ctx: Ctx): Action | null {
  if (ctx.c.lifeStage === 'child') return null;
  return tryHeadship(ctx)
    ?? tryMatch(ctx)
    ?? tryBelonging(ctx)
    ?? tryEntail(ctx)
    ?? tryWill(ctx)
    ?? tryRecords(ctx);
}
