/**
 * Arbitration, and Reverie between cities (`docs/CIVIL.md` §6).
 *
 * The docket sits twice a week and is public. Arbitration is the cheap way:
 * `offer_arbitration` names a third citizen both sides accept,
 * `accept_arbitration` binds them, and `arbitrate` decides it in the arbiter's
 * next hour. The award is filed at the Exchange and enforced identically to a
 * judgment, and **there is no appeal** — that is what the parties bought.
 *
 * An arbiter paid by one side commits bribery (L09) and the award is void on
 * proof. The proof is public: every lumen in Reverie moves through the ledger,
 * so `detectArbiterBribery` reads it out and hands it over. Nothing here
 * charges anybody — the Watch does that, as it does with everything.
 *
 * `CITIES.md` says Reverie is the city others ask to arbitrate; `referDispute`
 * is how. Three Reverie judges sit and the award runs in the Chronicle, read in
 * all six cities. **Nothing compels a city to obey it; standing does.**
 */
import type { CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, transfer } from '../economy/treasury.ts';
import { canSit } from '../government/cases.ts';
import type { Arbitration, CityDispute } from './shapes.ts';
import { civilState, nextCivilId } from './state.ts';
import type { CivilResult } from './common.ts';
import { canPay, fail, lumens, mayContract, nameOf, ok } from './common.ts';
import { FULL_BENCH } from './merit.ts';
import { orderJudgment } from './enforcement.ts';

/** An arbitration offer sits as long as a contract offer does. */
export const ARBITRATION_LAPSE_DAYS = 2;
/** What the Chronicle calls a typical private fee, against the docket's 80 ℓ cap. */
export const TYPICAL_FEE = [10, 40] as const;

export function allArbitrations(world: World): Arbitration[] {
  return Object.values(civilState(world).arbitrations);
}

export function arbitrationById(world: World, id: string): Arbitration | null {
  return civilState(world).arbitrations[id] ?? null;
}

/** Arbitrations this citizen is bound to decide, oldest first. */
export function arbitrationsFor(world: World, arbiterId: CitizenId): Arbitration[] {
  return allArbitrations(world).filter((a) => a.arbiterId === arbiterId && a.status === 'bound');
}

/** Offers waiting on this citizen's word. */
export function arbitrationOffersTo(world: World, cId: CitizenId): Arbitration[] {
  return allArbitrations(world).filter((a) => a.status === 'offered' && a.respondentId === cId);
}

/** Propose a private arbiter. Nobody is bound until the other side says so. */
export function offerArbitration(
  world: World, byId: CitizenId, spec: { with: CitizenId; about: string; arbiter: CitizenId; fee: number },
): CivilResult {
  const claimant = world.citizens[byId];
  const respondent = world.citizens[spec.with];
  const arbiter = world.citizens[spec.arbiter];
  if (!mayContract(world, claimant)) return fail('You are not in a position to be bound by an award.');
  if (!respondent || spec.with === byId) return fail('There is nobody on the other side of that.');
  if (!mayContract(world, respondent)) return fail(`${nameOf(world, spec.with)} cannot be bound today.`);
  if (!arbiter) return fail('There is no such arbiter.');
  if (spec.arbiter === byId || spec.arbiter === spec.with) return fail('An arbiter is a third citizen, not one of the two.');
  if (!spec.about || spec.about.trim().length < 3) return fail('An arbitration has to say what it is about.');
  const fee = lumens(spec.fee);
  const id = nextCivilId(world, 'ca');
  const a: Arbitration = {
    id, claimantId: byId, respondentId: spec.with, arbiterId: spec.arbiter, about: spec.about.trim(),
    fee, offeredDay: world.day, lapsesDay: world.day + ARBITRATION_LAPSE_DAYS, status: 'offered',
    award: 0, reason: '', decidedDay: null, judgmentId: null, voidReason: null,
  };
  civilState(world).arbitrations[id] = a;
  emit(world, 'law', `${claimant?.name ?? byId} put ${nameOf(world, spec.with)} to arbitration before `
    + `${arbiter.name} over ${a.about}, at ${formatLumens(fee)} split evenly (${id}).`,
    [byId, spec.with, spec.arbiter], 0.3, { arbitration: id, fee });
  remember(world, spec.with, 'civic', `${claimant?.name ?? byId} offers arbitration before ${arbiter.name} over ${a.about}, `
    + `for ${fee} ℓ split evenly. If you accept there is no appeal — that is what the two of you would be buying.`);
  return ok(`You offered arbitration before ${arbiter.name} (${id}).`, id);
}

/** Bind yourself to their award. Half the fee each, paid to the arbiter now. */
export function acceptArbitration(world: World, actorId: CitizenId, offerId: string): CivilResult {
  const a = arbitrationById(world, offerId);
  if (!a) return fail('There is no such arbitration.');
  if (a.status !== 'offered') return fail(`That arbitration is already ${a.status}.`);
  if (a.respondentId !== actorId) return fail('That offer was not made to you.');
  if (world.day > a.lapsesDay) return fail('That offer has lapsed.');
  const half = Math.round(a.fee / 2);
  if (half > 0) {
    for (const payer of [a.claimantId, a.respondentId]) {
      if (!canPay(world, payer, half)) return fail(`${nameOf(world, payer)} cannot find their ${formatLumens(half)} of the fee.`);
    }
    for (const payer of [a.claimantId, a.respondentId]) {
      transfer(world, payer, a.arbiterId, half, 'fee', `half the arbiter's fee in ${a.id}`);
    }
  }
  a.status = 'bound';
  emit(world, 'law', `${nameOf(world, actorId)} and ${nameOf(world, a.claimantId)} are bound to ${nameOf(world, a.arbiterId)}'s `
    + `award over ${a.about}. There is no appeal (${a.id}).`, [a.claimantId, a.respondentId, a.arbiterId], 0.4,
    { arbitration: a.id, fee: a.fee });
  remember(world, a.arbiterId, 'civic', `${nameOf(world, a.claimantId)} and ${nameOf(world, a.respondentId)} have bound themselves `
    + `to your award over ${a.about} (${a.id}). Taking anything from one side is bribery, and voids it.`);
  return ok(`You are bound to ${nameOf(world, a.arbiterId)}'s award in ${a.id}.`, a.id);
}

/** Decline, or withdraw your own offer. */
export function closeArbitration(world: World, actorId: CitizenId, offerId: string): CivilResult {
  const a = arbitrationById(world, offerId);
  if (!a) return fail('There is no such arbitration.');
  if (a.status !== 'offered') return fail(`That arbitration is already ${a.status}.`);
  if (actorId !== a.claimantId && actorId !== a.respondentId) return fail('That offer is not yours to close.');
  a.status = 'declined';
  return ok(`You closed the arbitration offer ${a.id}.`, a.id);
}

/**
 * (The arbiter) decide it; no appeal. A positive award has the respondent pay
 * the claimant, a negative one the other way round, and zero sends both of them
 * home with nothing but the fee they spent.
 */
export function arbitrate(world: World, arbiterId: CitizenId, disputeId: string, award: number, reason: string): CivilResult {
  const a = arbitrationById(world, disputeId);
  if (!a) return fail('There is no such arbitration.');
  if (a.arbiterId !== arbiterId) return fail('That is not yours to decide.');
  if (a.status !== 'bound') return fail(`That arbitration is ${a.status}.`);
  const bribe = detectArbiterBribery(world, a.id);
  if (bribe) return fail(`You have taken ${formatLumens(bribe.amount)} from ${nameOf(world, bribe.fromId)}; an award you make is void.`);
  const sum = Math.round(Number.isFinite(award) ? award : 0);
  a.award = sum;
  a.reason = (reason ?? '').slice(0, 280);
  a.status = 'decided';
  a.decidedDay = world.day;
  const debtorId = sum >= 0 ? a.respondentId : a.claimantId;
  const creditorId = sum >= 0 ? a.claimantId : a.respondentId;
  const amount = Math.abs(sum);
  if (amount > 0) {
    const j = orderJudgment(world, null, debtorId, creditorId, amount, 'award');
    a.judgmentId = j?.id ?? null;
  }
  emit(world, 'law', `${nameOf(world, arbiterId)} awarded ${amount > 0 ? `${formatLumens(amount)} to ${nameOf(world, creditorId)}` : 'nothing to either side'} `
    + `in ${a.id}: ${a.reason} There is no appeal.`, [a.claimantId, a.respondentId, arbiterId], 0.4,
    { arbitration: a.id, award: sum, judgment: a.judgmentId });
  for (const id of [a.claimantId, a.respondentId]) {
    remember(world, id, 'civic', `The award in ${a.id} is ${amount > 0 ? `${amount} ℓ to ${nameOf(world, creditorId)}` : 'nothing either way'}: `
      + `${a.reason} You bought a decision without an appeal, and this is it.`);
  }
  return ok(`You made your award in ${a.id}.`, a.id);
}

/** A payment from one side to the arbiter that is not their half of the fee. */
export function detectArbiterBribery(world: World, arbitrationId: string): { fromId: CitizenId; amount: number; code: string } | null {
  const a = arbitrationById(world, arbitrationId);
  if (!a) return null;
  const half = Math.round(a.fee / 2);
  for (const row of world.treasury.ledger) {
    if (row.to !== a.arbiterId) continue;
    if (Math.floor(row.tick / 24) < a.offeredDay) continue;
    if (row.from !== a.claimantId && row.from !== a.respondentId) continue;
    if (row.kind === 'fee' && row.amount === half) continue;
    return { fromId: row.from, amount: row.amount, code: 'L09' };
  }
  return null;
}

/** An award bought is no award: it is struck, and the judgment under it with it. */
export function voidAward(world: World, arbitrationId: string, reason: string): boolean {
  const a = arbitrationById(world, arbitrationId);
  if (!a || a.status !== 'decided') return false;
  a.status = 'void';
  a.voidReason = reason;
  if (a.judgmentId) {
    const j = civilState(world).judgments[a.judgmentId];
    if (j) {
      const c = world.citizens[j.debtorId];
      if (c && j.loaded > 0) { c.finesOwed = Math.max(0, c.finesOwed - j.loaded); j.loaded = 0; }
      j.amount = j.paid;
      j.satisfiedDay = world.day;
    }
  }
  emit(world, 'law', `The award in ${a.id} is void: ${reason}`, [a.claimantId, a.respondentId, a.arbiterId], 0.5,
    { arbitration: a.id });
  return true;
}

// ---------------------------------------------------------------------------
// Reverie between cities
// ---------------------------------------------------------------------------

export function allDisputes(world: World): CityDispute[] {
  return Object.values(civilState(world).disputes);
}

export function disputeById(world: World, id: string): CityDispute | null {
  return civilState(world).disputes[id] ?? null;
}

/**
 * (Envoys) put an inter-city dispute to Reverie's Court — a broken treaty term,
 * a raided caravan, an unpaid tariff, a contested route toll. Three Reverie
 * judges sit and each side sends an advocate.
 */
export function referDispute(world: World, envoyId: CitizenId, cities: [string, string], about: string): CivilResult {
  const envoy = world.citizens[envoyId];
  if (!envoy) return fail('Unknown citizen.');
  const [a, b] = cities.map((c) => (c ?? '').trim().toLowerCase()) as [string, string];
  if (!a || !b || a === b) return fail('A referred dispute names two cities.');
  if (!about || about.trim().length < 3) return fail('A referred dispute has to say what it is about.');
  const bench: CitizenId[] = [];
  for (const id of world.government.judges) {
    const judge = world.citizens[id];
    if (judge && canSit(world, judge) && !bench.includes(id)) bench.push(id);
    if (bench.length >= FULL_BENCH) break;
  }
  if (bench.length === 0) return fail('There is no bench to hear it.');
  const id = nextCivilId(world, 'cd');
  const d: CityDispute = {
    id, cities: [a, b], about: about.trim(), referredById: envoyId, filedDay: world.day,
    judges: bench, advocates: {}, votes: {}, forCity: null, award: 0, decidedDay: null, refusedBy: null,
  };
  civilState(world).disputes[id] = d;
  emit(world, 'law', `${envoy.name} referred the dispute between ${a} and ${b} to Reverie's Court: ${d.about} (${id}).`,
    [envoyId, ...bench], 0.6, { dispute: id, cities: d.cities });
  return ok(`You referred ${a} against ${b} to the Court (${id}).`, id);
}

/** Each side sends an advocate; a licensed one, where the Bar exists to say so. */
export function appearForCity(world: World, cId: CitizenId, disputeId: string, city: string): CivilResult {
  const d = disputeById(world, disputeId);
  if (!d) return fail('There is no such dispute.');
  if (d.decidedDay !== null) return fail('That dispute is decided.');
  const key = city.trim().toLowerCase();
  if (!d.cities.includes(key)) return fail('That city is not before the Court.');
  d.advocates[key] = cId;
  return ok(`You appear for ${key} in ${d.id}.`, d.id);
}

/** (Judges) decide it. The award runs in the Chronicle, read in all six cities. */
export function decideDispute(
  world: World, judgeId: CitizenId, disputeId: string, forCity: string, award: number, reason: string,
): CivilResult {
  const d = disputeById(world, disputeId);
  if (!d) return fail('There is no such dispute.');
  if (!d.judges.includes(judgeId)) return fail('You are not sitting on that dispute.');
  if (d.decidedDay !== null) return fail('That dispute is decided.');
  const key = forCity.trim().toLowerCase();
  if (!d.cities.includes(key)) return fail('That city is not before the Court.');
  d.votes[judgeId] = { forCity: key, reason: (reason ?? '').slice(0, 280) };
  if (Object.keys(d.votes).length < d.judges.length) return ok(`You found for ${key} in ${d.id}.`, d.id);

  const tally = new Map<string, number>();
  for (const v of Object.values(d.votes)) tally.set(v.forCity, (tally.get(v.forCity) ?? 0) + 1);
  let winner = d.cities[0];
  for (const [city, n] of tally) if (n > (tally.get(winner) ?? 0)) winner = city;
  d.forCity = winner;
  d.award = Math.max(0, Math.round(award));
  d.decidedDay = world.day;
  emit(world, 'law', `Reverie's Court awarded ${d.about} to ${winner}${d.award > 0 ? ` at ${formatLumens(d.award)}` : ''}. `
    + 'Nothing compels a city to obey it; standing does.', d.judges, 0.7,
    { dispute: d.id, forCity: winner, award: d.award });
  return ok(`The Court found for ${winner} in ${d.id}.`, d.id);
}

/**
 * A city that agreed to be bound and then was not. Reverie's courts are worth
 * something precisely because refusing has usually been the dearer option; the
 * cost is standing with every city in the Expanse, and this records it for the
 * layer that keeps that ledger.
 */
export function refuseAward(world: World, disputeId: string, city: string): boolean {
  const d = disputeById(world, disputeId);
  if (!d || d.decidedDay === null) return false;
  const key = city.trim().toLowerCase();
  if (!d.cities.includes(key) || d.refusedBy !== null) return false;
  d.refusedBy = key;
  emit(world, 'law', `${key} refused the award it agreed to be bound by in ${d.id}. Every city in the Expanse reads that.`,
    [], 0.7, { dispute: d.id, city: key });
  return true;
}
