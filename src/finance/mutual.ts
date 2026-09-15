/**
 * Mutual aid: the poor citizen's insurance, and the one most citizens will
 * hold (`FINANCE.md` §6).
 *
 * Five adults register a mutual for 50 ℓ — the club fee, not the business fee,
 * because a mutual is not a business and pays no profit tax. Members pay dues
 * into a pot at the Exchange; a member who suffers a misfortune asks the pot
 * and **the members vote on it**. There is no formula, no underwriter and
 * never more than the pot holds.
 *
 * Almost nothing is here: the pot, the claim and the vote are the primitive in
 * `finance/pot.ts`, which a creed's fund will wrap the same way. What a mutual
 * adds is a name, a subscription, the five adults, and the rule that its
 * claims are always decided by a vote of its members and never by one member
 * alone — that last is the whole difference between a mutual and a creed
 * (`CREEDS.md` §3).
 *
 * A mutual's payout is enforceable nowhere. A policy is a filed contract and a
 * refused claim is a suit on the civil docket; a refused claim here is just
 * the members saying no. That is why what a mutual covers in practice is what
 * no underwriter will write — a household whose earner is in custody, a
 * funeral for a sunset, the fortnight after a partnership ends.
 */
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, transfer } from '../economy/treasury.ts';
import type { Mutual, Pot } from './state.ts';
import { financeId, financeState } from './state.ts';
import { claimOnPot, joinPot, openPot, payIntoPot, potBalance, potOf, votePotClaim } from './pot.ts';

/** What the Registry charges to enter a mutual on the roll: the club fee. */
export const MUTUAL_FEE = 50;
/** Adults a mutual needs before it may pay a claim. */
export const MUTUAL_MIN_MEMBERS = 5;
/** Bounds on the daily subscription its founders set. */
export const MUTUAL_DUES_MIN = 1;
export const MUTUAL_DUES_MAX = 50;
/** Days of unpaid dues after which the roll calls a member in arrears. */
export const DUES_GRACE_DAYS = 3;
export const MAX_MUTUAL_NAME = 40;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function adult(c: Citizen): boolean {
  return c.lifeStage === 'adult' || c.lifeStage === 'elder';
}

export function mutualOf(world: World, mutualId: string): Mutual | null {
  return financeState(world).mutuals[mutualId] ?? null;
}

/** The mutual a citizen belongs to, or null. A citizen may hold one. */
export function mutualFor(world: World, cId: CitizenId): Mutual | null {
  const s = financeState(world);
  for (const m of Object.values(s.mutuals)) {
    const pot = potOf(world, m.potId);
    if (pot && pot.members.includes(cId)) return m;
  }
  return null;
}

/** The pot behind a mutual. */
export function potOfMutual(world: World, m: Mutual): Pot | null {
  return potOf(world, m.potId);
}

export function allMutuals(world: World): Mutual[] {
  return Object.values(financeState(world).mutuals).filter((m) => potOf(world, m.potId) !== null);
}

/**
 * Register a mutual. The founder is its first member and pays the fee; the
 * mutual may not pay a claim until five adults have joined, which is the
 * `FINANCE.md` §6 rule read as what it is — five adults make a mutual, and
 * one adult with a name and 50 ℓ has only started one.
 */
export function foundMutual(world: World, cId: CitizenId, name: string, dues: number): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing !== 'good' && c.standing !== 'probation') return fail('Your standing does not allow it.');
  if (!adult(c)) return fail('A child cannot found a mutual.');
  const trimmed = (name ?? '').trim().slice(0, MAX_MUTUAL_NAME);
  if (!trimmed) return fail('A mutual needs a name.');
  if (allMutuals(world).some((m) => m.name.toLowerCase() === trimmed.toLowerCase())) {
    return fail(`There is already a mutual called ${trimmed}.`);
  }
  if (mutualFor(world, cId)) return fail('You already belong to a mutual.');
  const rate = Number.isFinite(dues) ? Math.round(dues) : 0;
  if (rate < MUTUAL_DUES_MIN || rate > MUTUAL_DUES_MAX) {
    return fail(`Dues must be between ${MUTUAL_DUES_MIN} and ${MUTUAL_DUES_MAX} ℓ a day.`);
  }
  if (c.wallet < MUTUAL_FEE) return fail(`Registering a mutual costs ${MUTUAL_FEE} ℓ; you have ${formatLumens(c.wallet)}.`);
  if (!transfer(world, cId, 'treasury', MUTUAL_FEE, 'registration', `registration of ${trimmed} at the Exchange`)) {
    return fail('The registration fee could not be paid.');
  }

  const pot = openPot(world, {
    name: trimmed, rule: 'members', minMembers: MUTUAL_MIN_MEMBERS, founderId: cId,
  });
  const mutual: Mutual = {
    id: financeId(world, 'mut'), potId: pot.id, name: trimmed, dues: rate,
    founderId: cId, foundedDay: world.day, lastDues: { [cId]: world.day - 1 },
  };
  financeState(world).mutuals[mutual.id] = mutual;
  emit(world, 'club', `${c.name} registered ${trimmed}, a mutual at ${rate} ℓ a day; it needs ${MUTUAL_MIN_MEMBERS} adults before it can pay a claim.`,
    [cId], 0.4, { mutualId: mutual.id, dues: rate });
  remember(world, cId, 'money', `You registered the mutual ${trimmed} for ${MUTUAL_FEE} ℓ at ${rate} ℓ of dues a day.`);
  return ok(`${trimmed} is on the roll; it needs ${MUTUAL_MIN_MEMBERS} adults to pay a claim.`);
}

/** Join a mutual. One each: a citizen who pools with one group pools with that group. */
export function joinMutual(world: World, mutualId: string, cId: CitizenId): ActionResult {
  const m = mutualOf(world, mutualId);
  if (!m) return fail('There is no such mutual.');
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (mutualFor(world, cId)) return fail('You already belong to a mutual.');
  const joined = joinPot(world, m.potId, cId);
  if (!joined.ok) return joined;
  m.lastDues[cId] = world.day - 1;   // dues are payable from the day you join
  const pot = potOfMutual(world, m);
  const count = pot ? pot.members.length : 0;
  emit(world, 'club', `${c.name} joined ${m.name} (${count} member${count === 1 ? '' : 's'}).`, [cId], 0.2, { mutualId });
  return ok(`You joined ${m.name}; it holds ${formatLumens(pot ? potBalance(world, pot) : 0)} and has ${count} members.`);
}

/** Pay the day's dues into the pot. Once a day, and never more than the wallet holds. */
export function payDues(world: World, cId: CitizenId, mutualId?: string): ActionResult {
  const m = mutualId ? mutualOf(world, mutualId) : mutualFor(world, cId);
  if (!m) return fail('You do not belong to a mutual.');
  const pot = potOfMutual(world, m);
  if (!pot) return fail('That mutual has been wound up.');
  if (!pot.members.includes(cId)) return fail(`You are not a member of ${m.name}.`);
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (m.lastDues[cId] === world.day) return fail(`You have already paid your dues to ${m.name} today.`);
  if (c.wallet < m.dues) return fail(`Your dues are ${formatLumens(m.dues)} and you have ${formatLumens(c.wallet)}.`);
  const paid = payIntoPot(world, m.potId, cId, m.dues, 'dues', `dues to ${m.name}`);
  if (!paid.ok) return paid;
  m.lastDues[cId] = world.day;
  remember(world, cId, 'money', `You paid ${formatLumens(m.dues)} of dues to ${m.name}; the pot holds ${formatLumens(potBalance(world, pot))}.`);
  return ok(`You paid ${formatLumens(m.dues)} into ${m.name}; the pot holds ${formatLumens(potBalance(world, pot))}.`);
}

/** Days since this member last paid, and whether the roll calls them in arrears. */
export function duesStanding(world: World, m: Mutual, cId: CitizenId): { days: number; arrears: boolean } {
  const last = m.lastDues[cId] ?? m.foundedDay;
  const days = Math.max(0, world.day - last);
  return { days, arrears: days > DUES_GRACE_DAYS };
}

/**
 * Ask your mutual for help (`claim_aid`). Nothing here weighs the claim: the
 * members do that, and they may weigh a member's arrears or anything else they
 * like when they vote.
 */
export function claimAid(world: World, cId: CitizenId, amount: number, reason: string, mutualId?: string): ActionResult {
  const m = mutualId ? mutualOf(world, mutualId) : mutualFor(world, cId);
  if (!m) return fail('You do not belong to a mutual.');
  return claimOnPot(world, m.potId, cId, amount, reason);
}

/** Vote on a claim on your mutual's pot (`vote_aid`). */
export function voteAid(world: World, claimId: string, voterId: CitizenId, aye: boolean): ActionResult {
  return votePotClaim(world, claimId, voterId, aye);
}

/** What a citizen may read about their own mutual. */
export interface MutualView {
  id: string;
  name: string;
  dues: number;
  members: number;
  pot: number;
  minMembers: number;
  duesOwedDays: number;
  arrears: boolean;
  openClaims: { id: string; claimant: string; amount: number; reason: string; ayes: number; nays: number }[];
}

export function mutualView(world: World, cId: CitizenId): MutualView | null {
  const m = mutualFor(world, cId);
  if (!m) return null;
  const pot = potOfMutual(world, m);
  if (!pot) return null;
  const standing = duesStanding(world, m, cId);
  const claims = Object.values(financeState(world).potClaims)
    .filter((k) => k.potId === m.potId && k.status === 'open')
    .map((k) => {
      let ayes = 0;
      let nays = 0;
      for (const v of Object.values(k.votes)) (v ? ayes++ : nays++);
      return {
        id: k.id, claimant: world.citizens[k.claimantId]?.name ?? 'a member',
        amount: k.amount, reason: k.reason, ayes, nays,
      };
    });
  return {
    id: m.id, name: m.name, dues: m.dues, members: pot.members.length, pot: potBalance(world, pot),
    minMembers: pot.minMembers, duesOwedDays: standing.days, arrears: standing.arrears, openClaims: claims,
  };
}
