/**
 * Contracts, variation, notice, breach and escrow (src/civil/).
 *
 * The two-action handshake, the arithmetic of the filing fee, what a witness's
 * mark is worth, and above all what a breach costs — which is nothing the law
 * does. Money is conserved throughout: a contract moves lumens between purses
 * that already exist and mints nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  MAX_CONTRACT_DAYS, OFFER_LAPSE_DAYS, WITNESS_FEE,
  contractById, endDay, faceValue, filingFee, offersTo, outstandingConsideration, periodDueDay,
} from '../src/civil/terms.ts';
import { acceptContract, closeOffer, offerContract, performContract, witnessContract } from '../src/civil/contracts.ts';
import { acceptVariation, dailyContracts, proposeVariation, terminateContract } from '../src/civil/amend.ts';
import { escrowHeldBy, openEscrow, releaseEscrow, spendableBalance, totalEscrowed } from '../src/civil/escrow.ts';
import { contractRecordOf } from '../src/civil/state.ts';

function two(world: World, wallet = 500): [Citizen, Citizen] {
  return [
    makeCitizen(world, { name: 'Offeror', wallet, district: 'commons' }),
    makeCitizen(world, { name: 'Offeree', wallet, district: 'commons' }),
  ];
}

const LEASE = { kind: 'lease' as const, terms: 'a room at 21 Lantern Row', consideration: 8, days: 28, penalty: 0 };

// ---------------------------------------------------------------------------
// Formation
// ---------------------------------------------------------------------------

test('a contract takes two actions and never one', () => {
  const world = makeWorld();
  const [a, b] = two(world);
  const offered = offerContract(world, a.id, { to: b.id, ...LEASE });
  assert.equal(offered.ok, true, offered.message);
  const k = contractById(world, offered.id!)!;
  assert.equal(k.status, 'offered');
  assert.deepEqual(offersTo(world, b.id).map((x) => x.id), [k.id]);
  // The offeror cannot form their own instrument, and neither can a stranger.
  assert.equal(acceptContract(world, a.id, k.id).ok, false);
  const c = makeCitizen(world, { name: 'Stranger' });
  assert.equal(acceptContract(world, c.id, k.id).ok, false);
  assert.equal(k.status, 'offered');

  const before = totalMoney(world);
  assert.equal(acceptContract(world, b.id, k.id).ok, true);
  assert.equal(k.status, 'active');
  assert.equal(totalMoney(world), before);
});

test('the filing fee is 5 ℓ + 1 % of face, capped at 60, and the acceptor pays it', () => {
  const world = makeWorld();
  const [a, b] = two(world);
  // A month's lease at 8 ℓ a day is 224 ℓ of face and files for 7 ℓ.
  assert.equal(faceValue(8, 'lease', 28), 224);
  assert.equal(filingFee(world, 224), 7);
  assert.equal(filingFee(world, 100_000), 60);

  const treasuryBefore = world.treasury.balance;
  const walletBefore = b.wallet;
  const id = offerContract(world, a.id, { to: b.id, ...LEASE }).id!;
  assert.equal(acceptContract(world, b.id, id).ok, true);
  assert.equal(b.wallet, walletBefore - 7);
  assert.equal(world.treasury.balance, treasuryBefore + 7);
});

test('an offer lapses after two days and binds nobody', () => {
  const world = makeWorld();
  const [a, b] = two(world);
  const id = offerContract(world, a.id, { to: b.id, ...LEASE }).id!;
  world.day = OFFER_LAPSE_DAYS + 1;
  dailyContracts(world);
  assert.equal(contractById(world, id)!.status, 'lapsed');
  assert.equal(acceptContract(world, b.id, id).ok, false);
});

test('a promise with nothing coming back is a gift, and the register will not hold it', () => {
  const world = makeWorld();
  const [a, b] = two(world);
  assert.equal(offerContract(world, a.id, { to: b.id, ...LEASE, consideration: 0 }).ok, false);
  assert.equal(offerContract(world, a.id, { to: b.id, ...LEASE, days: MAX_CONTRACT_DAYS + 1 }).ok, false);
  assert.equal(offerContract(world, a.id, { to: b.id, ...LEASE, days: 0 }).ok, false);
  assert.equal(offerContract(world, a.id, { to: a.id, ...LEASE }).ok, false);
});

test('the Exchange caps the penalty at twice the face value', () => {
  const world = makeWorld();
  const [a, b] = two(world);
  const id = offerContract(world, a.id, { to: b.id, ...LEASE, penalty: 10_000 }).id!;
  assert.equal(contractById(world, id)!.penalty, 2 * 224);
});

test('a wage may not go under the minimum, and an apprenticeship is the one exception', () => {
  const world = makeWorld();
  const [a, b] = two(world);
  const floor = world.government.minWage;
  assert.equal(offerContract(world, a.id, { to: b.id, kind: 'employment', terms: 'a post', consideration: floor - 1, days: 10 }).ok, false);
  assert.equal(offerContract(world, a.id, { to: b.id, kind: 'employment', terms: 'a post', consideration: floor, days: 10 }).ok, true);
  const low = Math.round(floor * 0.6);
  assert.equal(offerContract(world, a.id, { to: b.id, kind: 'apprenticeship', terms: 'the bench', consideration: low, days: 28 }).ok, true);
  assert.equal(offerContract(world, a.id, { to: b.id, kind: 'apprenticeship', terms: 'the bench', consideration: low, days: 29 }).ok, false);
});

// ---------------------------------------------------------------------------
// Witnesses
// ---------------------------------------------------------------------------

test('a witness marks the instrument themselves, is paid 2 ℓ by the offeror, and must be standing there', () => {
  const world = makeWorld();
  const [a, b] = two(world);
  const w = makeCitizen(world, { name: 'Witness', district: 'commons', wallet: 0 });
  const far = makeCitizen(world, { name: 'Elsewhere', district: 'heights', wallet: 0 });
  const id = offerContract(world, a.id, { to: b.id, ...LEASE, witnesses: [w.id] }).id!;
  const k = contractById(world, id)!;
  assert.deepEqual(k.asked, [w.id]);
  assert.deepEqual(k.witnesses, [], 'being asked is not a mark');

  const before = totalMoney(world);
  assert.equal(witnessContract(world, far.id, id).ok, false, 'not standing beside them');
  assert.equal(witnessContract(world, b.id, id).ok, false, 'a party cannot witness');
  assert.equal(witnessContract(world, w.id, id).ok, true);
  assert.equal(w.wallet, WITNESS_FEE);
  assert.equal(totalMoney(world), before);
  assert.equal(witnessContract(world, w.id, id).ok, false, 'one mark each');
  assert.deepEqual(k.witnesses, [w.id]);
});

test('an offer may be declined by the target or withdrawn by the offeror', () => {
  const world = makeWorld();
  const [a, b] = two(world);
  const first = offerContract(world, a.id, { to: b.id, ...LEASE }).id!;
  assert.equal(closeOffer(world, b.id, first).ok, true);
  assert.equal(contractById(world, first)!.status, 'declined');
  const second = offerContract(world, a.id, { to: b.id, ...LEASE }).id!;
  assert.equal(closeOffer(world, a.id, second).ok, true);
  assert.equal(contractById(world, second)!.status, 'withdrawn');
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

function runningLease(world: World, days = 3): { k: ReturnType<typeof contractById>; a: Citizen; b: Citizen } {
  const [a, b] = two(world);
  const id = offerContract(world, a.id, { to: b.id, ...LEASE, days }).id!;
  acceptContract(world, b.id, id);
  return { k: contractById(world, id), a, b };
}

test('nothing is owed on the day of signing; the rent moves the morning after', () => {
  const world = makeWorld();
  const { k, a, b } = runningLease(world);
  assert.equal(periodDueDay(k!, 0), 1);
  assert.equal(performContract(world, b.id, k!.id).ok, false, 'not due yet');

  world.day = 1;
  const before = totalMoney(world);
  const landlordBefore = a.wallet;
  const tenantBefore = b.wallet;
  assert.equal(performContract(world, b.id, k!.id).ok, true);
  assert.equal(a.wallet, landlordBefore + 8);
  assert.equal(b.wallet, tenantBefore - 8);
  assert.equal(totalMoney(world), before);
  assert.equal(performContract(world, b.id, k!.id).ok, false, 'a period is discharged once');
  assert.equal(performContract(world, a.id, k!.id).ok, false, 'the tenant owes the rent, not the landlord');
});

test('a term performed to the end is kept, and the register says so for ever', () => {
  const world = makeWorld();
  const { k, b } = runningLease(world, 2);
  for (const day of [1, 2]) {
    world.day = day;
    assert.equal(performContract(world, b.id, k!.id).ok, true);
    dailyContracts(world);
  }
  world.day = 3;
  dailyContracts(world);
  assert.equal(contractById(world, k!.id)!.status, 'kept');
  assert.equal(contractRecordOf(world, b.id).kept, 1);
  assert.equal(contractRecordOf(world, b.id).breached, 0);
});

// ---------------------------------------------------------------------------
// Breach — and the whole of what it costs
// ---------------------------------------------------------------------------

test('a missed period is a breach, and then nothing happens at all', () => {
  const world = makeWorld();
  const { k, a, b } = runningLease(world);
  const money = totalMoney(world);
  const walletA = a.wallet;
  const walletB = b.wallet;
  const reputation = b.reputation;

  world.day = 2;            // period 0 fell due on day 1 and went undischarged
  dailyContracts(world);
  const after = contractById(world, k!.id)!;
  assert.equal(after.status, 'breached');
  assert.equal(after.breachedById, b.id);
  assert.equal(contractRecordOf(world, b.id).breached, 1);

  // Not one lumen moved, and nothing was taken from anybody.
  assert.equal(totalMoney(world), money);
  assert.equal(a.wallet, walletA);
  assert.equal(b.wallet, walletB);
  assert.equal(b.reputation, reputation, 'a breach takes no repute penalty of its own, and never will');
  assert.equal(b.standing, 'good');
  assert.equal(b.finesOwed, 0);
  assert.equal(b.jailedUntilDay, null);
  assert.equal(b.record.convictions.length, 0);
  assert.equal(world.cases[Object.keys(world.cases)[0] ?? ''], undefined, 'no charge is filed');
});

test('a citizen in custody may not be bound by a new instrument', () => {
  const world = makeWorld();
  const [a, b] = two(world);
  b.jailedUntilDay = 5;
  assert.equal(offerContract(world, a.id, { to: b.id, ...LEASE }).ok, false);
  b.jailedUntilDay = null;
  const id = offerContract(world, a.id, { to: b.id, ...LEASE }).id!;
  b.jailedUntilDay = 5;
  assert.equal(acceptContract(world, b.id, id).ok, false);
});

test('a citizen in custody cannot perform and is not in breach for it', () => {
  const world = makeWorld();
  const { k, b } = runningLease(world, 5);
  b.jailedUntilDay = 6;
  const wasEnd = endDay(k!);
  world.day = 2;
  dailyContracts(world);
  assert.equal(contractById(world, k!.id)!.status, 'active');
  assert.equal(contractById(world, k!.id)!.suspendedDays, 1);
  assert.equal(endDay(contractById(world, k!.id)!), wasEnd + 1, 'the days stand still and are given back');
  assert.equal(performContract(world, b.id, k!.id).ok, false);
});

// ---------------------------------------------------------------------------
// Variation and notice
// ---------------------------------------------------------------------------

test('terms are varied by the same handshake that made them', () => {
  const world = makeWorld();
  const { k, a, b } = runningLease(world, 10);
  const v = proposeVariation(world, a.id, k!.id, 'the rent falls to six', { consideration: 6 });
  assert.equal(v.ok, true, v.message);
  assert.equal(acceptVariation(world, a.id, v.id!).ok, false, 'not by the one who proposed it');
  assert.equal(acceptVariation(world, b.id, v.id!).ok, true);
  assert.equal(contractById(world, k!.id)!.consideration, 6);
});

test('notice ends a contract clean, with nothing against either side', () => {
  const world = makeWorld();
  const { k, a, b } = runningLease(world, 10);
  const contract = contractById(world, k!.id)!;
  contract.notice = 2;
  assert.equal(terminateContract(world, a.id, contract.id).ok, true);
  assert.equal(contract.endsDay, 2);
  world.day = 1;
  assert.equal(performContract(world, b.id, contract.id).ok, true, 'the notice period is still owed');
  dailyContracts(world);
  assert.equal(contract.status, 'active');
  world.day = 2;
  dailyContracts(world);
  assert.equal(contract.status, 'terminated');
  assert.equal(contractRecordOf(world, a.id).breached, 0);
  assert.equal(contractRecordOf(world, b.id).breached, 0);
});

// ---------------------------------------------------------------------------
// Escrow
// ---------------------------------------------------------------------------

test('an escrow is real lumens, earmarked and unspendable, and the supply never moves', () => {
  const world = makeWorld();
  const { k, a, b } = runningLease(world, 10);
  const before = totalMoney(world);
  const opened = openEscrow(world, b.id, k!.id, 'exchange', 100);
  assert.equal(opened.ok, true, opened.message);
  assert.equal(totalMoney(world), before, 'lodging creates and destroys nothing');
  assert.equal(escrowHeldBy(world, 'treasury'), 100);
  assert.equal(totalEscrowed(world), 100);
  assert.equal(spendableBalance(world, 'treasury'), world.treasury.balance - 100);

  assert.equal(releaseEscrow(world, a.id, opened.id!).ok, false, 'only the depositor releases it');
  const landlordBefore = a.wallet;
  assert.equal(releaseEscrow(world, b.id, opened.id!).ok, true);
  assert.equal(a.wallet, landlordBefore + 100);
  assert.equal(escrowHeldBy(world, 'treasury'), 0);
  assert.equal(totalMoney(world), before);
});

test('only a licensed banker may hold an escrow', () => {
  const world = makeWorld();
  const { k, b } = runningLease(world, 10);
  const holder = makeCitizen(world, { name: 'Not a banker', wallet: 0 });
  holder.skills.commerce = 10;
  assert.equal(openEscrow(world, b.id, k!.id, holder.id, 50).ok, false);
  holder.skills.commerce = 80;       // no guild exists, so the Council's floor stands alone
  assert.equal(openEscrow(world, b.id, k!.id, holder.id, 50).ok, true);
  assert.equal(escrowHeldBy(world, holder.id), 50);
});

test('the consideration still outstanding is what damages are measured against', () => {
  const world = makeWorld();
  const { k, b } = runningLease(world, 4);
  assert.equal(outstandingConsideration(k!), 8 * 4);
  world.day = 1;
  performContract(world, b.id, k!.id);
  assert.equal(outstandingConsideration(contractById(world, k!.id)!), 8 * 3);
});
