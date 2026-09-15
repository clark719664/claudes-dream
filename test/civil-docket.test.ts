/**
 * The civil docket, its findings, and how a judgment is collected (src/civil/).
 *
 * The docket is the other half of the law: it moves lumens and compels
 * performance, never liberty. Every test here that checks what a finding does
 * also checks what it does *not* do — no fine, no cell, no suspension, no entry
 * on anybody's record but the register's own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, World } from '../src/types.ts';
import { withholdingPay } from '../src/economy/treasury.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { acceptContract, offerContract, performContract } from '../src/civil/contracts.ts';
import { dailyContracts } from '../src/civil/amend.ts';
import { contractById } from '../src/civil/terms.ts';
import {
  acceptSettlement, answerSuit, closeDocket, expireCompulsions, fileSuit, isDocketDay, judgeCivil,
  offerSettlement, openDocket, sittingSuits, suitById, suitFee,
} from '../src/civil/docket.ts';
import { FULL_BENCH_CLAIM, WITHOUT_MERIT, benchSize, meritOf, mustRecuse } from '../src/civil/merit.ts';
import {
  DAYS_TO_PAY, JUDGMENT_DEBT_DAYS, collectFrom, dailyEnforcement, enforceJudgment, judgmentDebtOf,
  judgmentDebtRegister, judgmentsAgainst, outstanding, payJudgment,
} from '../src/civil/enforcement.ts';
import { contractRecordOf } from '../src/civil/state.ts';

const LEASE = { kind: 'lease' as const, terms: 'a room at 21 Lantern Row', consideration: 8, days: 4, penalty: 20 };

function judge(world: World, name = 'Judge'): Citizen {
  const j = makeCitizen(world, { name, wallet: 100, reputation: 80 });
  world.government.judges.push(j.id);
  return j;
}

/** A landlord, a tenant, a filed lease, and a breach of it on day 2. */
function breachedLease(world: World): { landlord: Citizen; tenant: Citizen; id: string } {
  const landlord = makeCitizen(world, { name: 'Landlord', wallet: 500 });
  const tenant = makeCitizen(world, { name: 'Tenant', wallet: 500 });
  const id = offerContract(world, landlord.id, { to: tenant.id, ...LEASE }).id!;
  acceptContract(world, tenant.id, id);
  world.day = 2;
  dailyContracts(world);
  assert.equal(contractById(world, id)!.status, 'breached');
  return { landlord, tenant, id };
}

// ---------------------------------------------------------------------------
// Opening a case
// ---------------------------------------------------------------------------

test('a suit costs 10 ℓ + 2 % of the claim, capped at 80, and the Treasury takes it', () => {
  const world = makeWorld();
  assert.equal(suitFee(world, 100), 12);
  assert.equal(suitFee(world, 10_000), 80);
  const { landlord, tenant } = breachedLease(world);
  const before = totalMoney(world);
  const treasury = world.treasury.balance;
  const wallet = landlord.wallet;
  const r = fileSuit(world, landlord.id, { defendant: tenant.id, claim: 'the rent for day one went unpaid', damages: 100 });
  assert.equal(r.ok, true, r.message);
  assert.equal(landlord.wallet, wallet - 12);
  assert.equal(world.treasury.balance, treasury + 12);
  assert.equal(totalMoney(world), before);
});

test('the docket sits on the second and fifth day of the week and not otherwise', () => {
  const world = makeWorld();
  for (const day of [0, 2, 3, 5, 6]) { world.day = day; assert.equal(isDocketDay(world), false); }
  for (const day of [1, 4, 8, 11]) { world.day = day; assert.equal(isDocketDay(world), true); }
});

test('one judge sits alone under 500 ℓ and three above it, and none of them may be a friend', () => {
  const world = makeWorld();
  assert.equal(benchSize(FULL_BENCH_CLAIM - 1), 1);
  assert.equal(benchSize(FULL_BENCH_CLAIM), 3);
  const { landlord, tenant, id } = breachedLease(world);
  const j = judge(world);
  assert.equal(mustRecuse(world, j.id, landlord.id, tenant.id), false);
  j.bonds[tenant.id] = 60;
  assert.equal(mustRecuse(world, j.id, landlord.id, tenant.id), true, 'a friend of either side stands down');
  j.bonds[tenant.id] = 0;

  fileSuit(world, landlord.id, { defendant: tenant.id, contractId: id, claim: 'unpaid rent, day one', damages: 100 });
  world.day = 4;
  const opened = openDocket(world);
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].judges, [j.id]);
});

// ---------------------------------------------------------------------------
// The record is what filing is for
// ---------------------------------------------------------------------------

test('a filed instrument is worth three handshakes on the record', () => {
  const world = makeWorld();
  const { landlord, tenant, id } = breachedLease(world);
  const filed = fileSuit(world, landlord.id, { defendant: tenant.id, contractId: id, claim: 'unpaid rent on day one of a filed lease', damages: 100 }).id!;
  const hand = fileSuit(world, landlord.id, { defendant: tenant.id, claim: 'unpaid rent on day one of a filed lease', damages: 100 }).id!;
  assert.equal(meritOf(world, suitById(world, filed)!).record, 1);
  assert.equal(meritOf(world, suitById(world, hand)!).record, 0.33);
  assert.ok(meritOf(world, suitById(world, filed)!).merit > meritOf(world, suitById(world, hand)!).merit);
});

test('an admission needs no bench, and it is a debt and nothing else', () => {
  const world = makeWorld();
  const { landlord, tenant, id } = breachedLease(world);
  const suitId = fileSuit(world, landlord.id, { defendant: tenant.id, contractId: id, claim: 'the rent for day one', damages: 30 }).id!;
  const before = totalMoney(world);
  assert.equal(answerSuit(world, tenant.id, suitId, 'admit', 'I did not pay it.').ok, true);
  const suit = suitById(world, suitId)!;
  assert.equal(suit.status, 'judged');
  assert.equal(suit.finding, 'plaintiff');
  const [j] = judgmentsAgainst(world, tenant.id);
  assert.ok(j, 'a judgment was entered');
  assert.equal(j.creditorId, landlord.id);
  assert.equal(totalMoney(world), before, 'a judgment moves nothing on the day it is made');
  // Article VI: the defendant keeps everything a citizen has.
  assert.equal(tenant.standing, 'good');
  assert.equal(tenant.jailedUntilDay, null);
  assert.equal(tenant.record.convictions.length, 0);
  assert.equal(tenant.communityServiceDaysLeft, 0);
});

test('silence is not an admission', () => {
  const world = makeWorld();
  const { landlord, tenant, id } = breachedLease(world);
  judge(world);
  const suitId = fileSuit(world, landlord.id, { defendant: tenant.id, contractId: id, claim: 'the rent', damages: 30 }).id!;
  world.day = 4;
  openDocket(world);
  const suit = suitById(world, suitId)!;
  assert.equal(suit.plea, null);
  assert.equal(suit.status, 'in_session', 'it is heard on the record either way');
});

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

test('a settlement ends it before judgment, and reads as neither kept nor breached', () => {
  const world = makeWorld();
  const { landlord, tenant, id } = breachedLease(world);
  const suitId = fileSuit(world, landlord.id, { defendant: tenant.id, contractId: id, claim: 'the rent', damages: 100 }).id!;
  assert.equal(offerSettlement(world, tenant.id, suitId, 25).ok, true);
  assert.equal(acceptSettlement(world, tenant.id, suitId).ok, false, 'an offer is taken by the other side');
  const before = totalMoney(world);
  const paid = landlord.wallet;
  assert.equal(acceptSettlement(world, landlord.id, suitId).ok, true);
  assert.equal(landlord.wallet, paid + 25);
  assert.equal(totalMoney(world), before);
  const suit = suitById(world, suitId)!;
  assert.equal(suit.status, 'settled');
  assert.equal(contractRecordOf(world, tenant.id).settled, 1);
  assert.equal(contractRecordOf(world, tenant.id).kept, 0);
});

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

test('a finding for the plaintiff is money owed, capped by the instrument and the claim', () => {
  const world = makeWorld();
  const { landlord, tenant, id } = breachedLease(world);
  const j = judge(world);
  const suitId = fileSuit(world, landlord.id, { defendant: tenant.id, contractId: id, claim: 'four days of rent unpaid', damages: 60 }).id!;
  world.day = 4;
  openDocket(world);
  assert.equal(judgeCivil(world, j.id, suitId, 'plaintiff', 500, 'damages', 'The lease is filed and the rent was not paid.').ok, true);
  const suit = suitById(world, suitId)!;
  assert.equal(suit.status, 'judged');
  assert.equal(suit.award, 60, 'never above the sum claimed');
  const [judgment] = judgmentsAgainst(world, tenant.id);
  assert.equal(judgment.amount, 60 + suit.fee, 'the defendant refunds the filing fee');
  assert.equal(contractRecordOf(world, tenant.id).adjudicated, 1);
  assert.equal(contractRecordOf(world, landlord.id).judgments.won, 1);
  assert.equal(contractRecordOf(world, tenant.id).judgments.lost, 1);
  assert.equal(tenant.standing, 'good');
  assert.equal(tenant.finesOwed, 0, 'a judgment is not a fine');
});

test('a plaintiff who loses without merit pays the defendant’s costs', () => {
  const world = makeWorld();
  const landlord = makeCitizen(world, { name: 'Vexatious', wallet: 500 });
  const tenant = makeCitizen(world, { name: 'Neighbour', wallet: 500 });
  const j = judge(world);
  const suitId = fileSuit(world, landlord.id, { defendant: tenant.id, claim: 'he owes me', damages: 100 }).id!;
  world.day = 4;
  openDocket(world);
  const suit = suitById(world, suitId)!;
  assert.ok(meritOf(world, suit).merit < WITHOUT_MERIT, 'a bare handshake pleaded in three words');
  assert.equal(judgeCivil(world, j.id, suitId, 'dismissed', 0, 'none', 'Nothing on the record supports it.').ok, true);
  assert.ok(suit.costs > 0);
  const [judgment] = judgmentsAgainst(world, landlord.id);
  assert.equal(judgment.creditorId, tenant.id);
  assert.equal(judgment.amount, suit.costs);
});

test('a bench that never sits decides on the record after three sittings', () => {
  const world = makeWorld();
  const { landlord, tenant, id } = breachedLease(world);
  judge(world);
  const suitId = fileSuit(world, landlord.id, {
    defendant: tenant.id, contractId: id, damages: 40,
    claim: 'the rent of 8 lumens for day 1 under the filed lease went unpaid and unanswered',
  }).id!;
  for (const day of [4, 8, 11]) {
    world.day = day;
    openDocket(world);
    closeDocket(world);
  }
  const suit = suitById(world, suitId)!;
  assert.equal(suit.status, 'judged');
  assert.equal(sittingSuits(world).length, 0);
});

// ---------------------------------------------------------------------------
// Enforcement — the ladder, and where it stops
// ---------------------------------------------------------------------------

function judgmentOf(world: World): { landlord: Citizen; tenant: Citizen; judgmentId: string } {
  const { landlord, tenant, id } = breachedLease(world);
  const suitId = fileSuit(world, landlord.id, { defendant: tenant.id, contractId: id, claim: 'four days of rent unpaid', damages: 40 }).id!;
  answerSuit(world, tenant.id, suitId, 'admit', 'I did not pay.');
  return { landlord, tenant, judgmentId: judgmentsAgainst(world, tenant.id)[0].id };
}

test('a judgment gives three days to pay, and the debtor may simply pay it', () => {
  const world = makeWorld();
  const { landlord, tenant, judgmentId } = judgmentOf(world);
  assert.equal(enforceJudgment(world, landlord.id, judgmentId).ok, false, 'not before the three days are up');
  const before = totalMoney(world);
  const paid = landlord.wallet;
  const r = payJudgment(world, tenant.id, judgmentId);
  assert.equal(r.ok, true, r.message);
  assert.equal(landlord.wallet, paid + 40 + 11, 'the award and the filing fee it cost to win it');
  assert.equal(totalMoney(world), before);
  assert.equal(judgmentDebtOf(world, tenant.id), 0);
});

test('an unpaid judgment is collected by the Treasury’s ladder and paid over to the creditor', () => {
  const world = makeWorld();
  const { landlord, tenant, judgmentId } = judgmentOf(world);
  tenant.wallet = 0;
  world.day = 2 + DAYS_TO_PAY;
  assert.equal(enforceJudgment(world, landlord.id, judgmentId).ok, true);
  assert.equal(enforceJudgment(world, landlord.id, judgmentId).ok, false, 'once only');
  collectFrom(world, tenant.id);           // first sight: the garnishment starts from today's wages

  withholdingPay(world, 'treasury', tenant.id, 100, 'wage', 'a shift');
  const before = totalMoney(world);
  const creditor = landlord.wallet;
  world.day += 1;
  const taken = collectFrom(world, tenant.id);
  assert.ok(taken > 0, 'a quarter of the wages went to the debt');
  assert.equal(landlord.wallet, creditor + taken, 'and every lumen of it reached the creditor');
  assert.equal(totalMoney(world), before);
  // The ladder stops where the Charter stops it.
  assert.equal(tenant.standing, 'good');
  assert.equal(tenant.jailedUntilDay, null);
  assert.equal(world.bans.length, 0);
});

test('a judgment unsatisfied for a month goes on the public register, and is still not a conviction', () => {
  const world = makeWorld();
  const { tenant, judgmentId } = judgmentOf(world);
  tenant.wallet = 0;
  world.day = 2 + JUDGMENT_DEBT_DAYS;
  dailyEnforcement(world);
  const rows = judgmentDebtRegister(world);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].citizenId, tenant.id);
  assert.equal(rows[0].owed, outstanding(judgmentsAgainst(world, tenant.id)[0]));
  assert.equal(contractRecordOf(world, tenant.id).judgments.unsatisfied, 1);
  assert.equal(tenant.record.convictions.length, 0);
  assert.equal(tenant.standing, 'good');
  assert.ok(judgmentId);
});

test('a judge may order less than the arithmetic allows and never more', () => {
  const world = makeWorld();
  const { landlord, tenant, id } = breachedLease(world);
  const j = judge(world);
  const suitId = fileSuit(world, landlord.id, {
    defendant: tenant.id, contractId: id, damages: 200,
    claim: 'the whole of the rent for the month, and the penalty on top of it',
  }).id!;
  world.day = 4;
  openDocket(world);
  judgeCivil(world, j.id, suitId, 'plaintiff', 200, 'damages', 'Every day of it.');
  const suit = suitById(world, suitId)!;
  // Four days of rent at 8 ℓ stood outstanding, so twice that is the ceiling.
  assert.equal(suit.award, 2 * 8 * 4);
  assert.equal(judgmentsAgainst(world, tenant.id)[0].amount, 2 * 8 * 4 + suit.fee);
});

test('a judge may never order a citizen to work, so employment is enforced in damages', () => {
  const world = makeWorld();
  const owner = makeCitizen(world, { name: 'Owner', wallet: 500 });
  const worker = makeCitizen(world, { name: 'Worker', wallet: 300 });
  const j = judge(world);
  const id = offerContract(world, owner.id, {
    to: worker.id, kind: 'employment', terms: 'the counter for a week', consideration: 12, days: 7, penalty: 40,
  }).id!;
  acceptContract(world, worker.id, id);
  world.day = 2;
  dailyContracts(world);
  const suitId = fileSuit(world, owner.id, {
    defendant: worker.id, contractId: id, damages: 60, claim: 'the shift of day 1 under a filed employment term',
  }).id!;
  world.day = 4;
  openDocket(world);
  judgeCivil(world, j.id, suitId, 'plaintiff', 40, 'performance', 'The term is filed and the shift was not worked.');
  const suit = suitById(world, suitId)!;
  assert.equal(suit.order, 'damages', 'nobody in Reverie is ordered to work');
  assert.equal(contractById(world, id)!.compelledUntilDay, null);
  assert.ok(judgmentsAgainst(world, worker.id)[0].amount > 0);
  assert.equal(worker.standing, 'good');
});

test('specific performance stands three days, and then it is money like anything else', () => {
  const world = makeWorld();
  const seller = makeCitizen(world, { name: 'Seller', wallet: 300 });
  const buyer = makeCitizen(world, { name: 'Buyer', wallet: 300 });
  const j = judge(world);
  seller.inventory.goods = 10;
  const id = offerContract(world, seller.id, {
    to: buyer.id, kind: 'forward', terms: 'ten crates on day two', consideration: 60, days: 2, penalty: 20,
    good: 'goods', qty: 10,
  }).id!;
  acceptContract(world, buyer.id, id);
  world.day = 3;
  dailyContracts(world);
  assert.equal(contractById(world, id)!.status, 'breached');
  const suitId = fileSuit(world, buyer.id, {
    defendant: seller.id, contractId: id, damages: 80, claim: 'ten crates of goods struck at 60 lumens were never delivered',
  }).id!;
  world.day = 4;
  openDocket(world);
  judgeCivil(world, j.id, suitId, 'plaintiff', 80, 'performance', 'The crates are still on his shelf.');
  const suit = suitById(world, suitId)!;
  assert.equal(suit.order, 'performance');
  assert.equal(contractById(world, id)!.compelledUntilDay, 7);
  // The fee is refunded even where nothing else was ordered to move.
  assert.equal(judgmentsAgainst(world, seller.id)[0].amount, suit.fee);

  world.day = 8;
  expireCompulsions(world);
  assert.equal(suitById(world, suitId)!.order, 'damages');
  const owed = judgmentsAgainst(world, seller.id).reduce((sum, x) => sum + x.amount, 0);
  assert.equal(owed, suit.fee + suit.award, 'the fee is not charged twice');
  assert.ok(suit.award > 0);
});

test('rescission unwinds the deal and restores what actually moved', () => {
  const world = makeWorld();
  const landlord = makeCitizen(world, { name: 'Landlord', wallet: 500 });
  const tenant = makeCitizen(world, { name: 'Tenant', wallet: 500 });
  const j = judge(world);
  const id = offerContract(world, landlord.id, {
    to: tenant.id, kind: 'lease', terms: 'a room with a hole in the roof', consideration: 8, days: 6, penalty: 0,
  }).id!;
  acceptContract(world, tenant.id, id);
  world.day = 1;
  performContract(world, tenant.id, id);
  world.day = 2;
  performContract(world, tenant.id, id);

  const suitId = fileSuit(world, tenant.id, {
    defendant: landlord.id, contractId: id, damages: 100,
    claim: 'the room let in the rain from the first night and two days of rent were paid for it',
  }).id!;
  world.day = 4;
  openDocket(world);
  judgeCivil(world, j.id, suitId, 'plaintiff', 100, 'rescission', 'The room was never fit; both sides go back.');
  const suit = suitById(world, suitId)!;
  assert.equal(suit.order, 'rescission');
  assert.equal(suit.award, 16, 'the two days of rent that actually moved');
  assert.equal(contractById(world, id)!.status, 'rescinded');
  assert.equal(judgmentsAgainst(world, landlord.id)[0].amount, 16 + suit.fee);
});
