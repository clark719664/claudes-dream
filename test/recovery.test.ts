/**
 * Civil recovery: garnishment, seizure, a suspended trading licence, and
 * contempt only for defiance. The Charter's rule is the one every test here
 * is really about — **no citizen may be imprisoned, exiled or suspended for
 * debt** (Article VI, `docs/JUSTICE.md` §1).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Business, Case, Citizen, CitizenId, Item, World } from '../src/types.ts';
import { PRODUCTS } from '../src/data/catalogue.ts';
import { nextId } from '../src/util/ids.ts';
import { transfer } from '../src/economy/treasury.ts';
import {
  CHEST_AFTER_DAYS, CLEAN_DAYS, CONTEMPT_AFTER_DAYS, FORCED_SALE_SHARE, GARNISHMENT_SHARE, LICENCE_AFTER_DAYS,
  SEIZURE_AFTER_DAYS, STOCK_AFTER_DAYS, ableToPay, clearDebtFromChest, dailyRecovery, debtDays, debtOf,
  earningsWhileOwing, garnishWages, outstandingRestitution, payRestitution, recoverFrom, recoveryStep,
  restitutionAmountKey, restitutionPaidKey, saleableValue,
  seizeBusinessStock, seizePossessions, strikeOffRestitution, strikeStruckKey, tradingLicenceRevoked,
} from '../src/government/recovery.ts';

function world(day = 10): World {
  const w = makeWorld();
  w.day = day; w.hour = 0; w.tick = day * 24;
  return w;
}

/** A citizen who owes the city, with the debt `days` old. */
function debtor(w: World, owed: number, days = 0, overrides: Parameters<typeof makeCitizen>[1] = {}): Citizen {
  const c = makeCitizen(w, { wallet: 0, ...overrides });
  c.finesOwed = owed;
  c.finesOwedSinceDay = w.day - days;
  return c;
}

/** A day's wages, paid out of the Treasury so the money supply stays honest. */
function paidWages(w: World, c: Citizen, amount: number): void {
  transfer(w, 'treasury', c.id, amount, 'wage', 'a day of work');
  c.stats.totalEarned += amount;
}

function addBusiness(w: World, ownerId: CitizenId, treasury = 100): Business {
  const id = nextId(w, 'b');
  const b: Business = {
    id, name: 'Glass Works', kind: 'workshop', ownerId, treasury, district: 'harbor_market', buildingId: 'shopfronts_harbor',
    employees: [], jobs: [], inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 }, foundedDay: 0,
    rentPerDay: 15, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  w.businesses[id] = b;
  w.citizens[ownerId].businessId = id;
  return b;
}

/** A guilty case with a victim owed restitution, and the conviction on the record. */
function conviction(w: World, d: Citizen, victim: Citizen, amount: number, day = w.day): Case {
  const k: Case = {
    id: nextId(w, 'k'), defendantId: d.id, law: 'L04', severity: 2, evidence: 1, filedTick: day * 24,
    filedBy: 'watch', victimId: victim.id, amount, description: 'petty theft', status: 'closed', triedDay: day,
    judges: [], votes: {}, reasons: {}, openedTick: null, carriedSessions: 0, decidedByDefault: false,
    verdict: 'guilty', sentence: null, appeal: null,
  };
  w.cases[k.id] = k;
  d.record.convictions.push({ caseId: k.id, law: 'L04', severity: 2, tier: 2, day });
  return k;
}

// ---------------------------------------------------------------------------
// 1. Garnishment
// ---------------------------------------------------------------------------

test('garnishment takes a quarter of every wage, and nothing that is not a wage', () => {
  const w = world();
  const c = debtor(w, 40);
  const before = totalMoney(w);

  dailyRecovery(w);
  assert.equal(c.finesOwed, 40, 'the first pass only marks where the wages stand');

  // A day's pay: 40 ℓ earned, a quarter of it garnished.
  paidWages(w, c, 40);
  w.day += 1; w.tick += 24;
  dailyRecovery(w);
  assert.equal(c.wallet, 30, 'three quarters of the wage is the citizen\'s to live on');
  assert.equal(c.finesOwed, 30);
  assert.equal(totalMoney(w), before, 'garnishment moves money, it does not make it');

  // The dividend is not a wage: a wallet that grows without earnings is untouched.
  transfer(w, 'treasury', c.id, 15, 'dividend', 'the citizen\'s dividend');
  w.day += 1; w.tick += 24;
  dailyRecovery(w);
  assert.equal(c.wallet, 45, 'the dividend is a right, not a wage');
  assert.equal(c.finesOwed, 30);
  assert.equal(GARNISHMENT_SHARE, 0.25);
});

test('garnishment stops the moment the debt clears, and the debt closes with it', () => {
  const w = world();
  const c = debtor(w, 10);
  dailyRecovery(w);
  paidWages(w, c, 100);
  w.day += 1; w.tick += 24;
  const taken = garnishWages(w, c);
  assert.equal(taken, 10, 'a quarter of 100 ℓ is 25 ℓ, but only 10 ℓ was owed');
  assert.equal(c.finesOwed, 0);
  assert.equal(c.finesOwedSinceDay, null);
  paidWages(w, c, 100);
  assert.equal(garnishWages(w, c), 0, 'nothing is owed, so nothing is taken');
  assert.equal(c.wallet, 190);
});

test('a citizen with no income is garnished nothing and escalated nowhere', () => {
  const w = world();
  const c = debtor(w, 50);
  const before = totalMoney(w);
  const charged: string[] = [];
  for (let i = 0; i < 30; i++) {
    dailyRecovery(w, (_w, id) => charged.push(id));
    w.day += 1; w.tick += 24;
  }
  assert.equal(c.finesOwed, 50, 'the debt stands against future income, and does nothing else');
  assert.deepEqual(charged, [], 'poverty is never contempt');
  assert.equal(c.standing, 'good', 'and never a suspension');
  assert.equal(c.jailedUntilDay ?? null, null, 'and never a cell');
  assert.equal(w.bans.length, 0, 'and never the Gate');
  assert.equal(earningsWhileOwing(w, c), 0);
  assert.equal(ableToPay(w, c), false);
  assert.equal(totalMoney(w), before);
});

// ---------------------------------------------------------------------------
// 2. Seizure
// ---------------------------------------------------------------------------

test('after three days the bailiffs sell what the debtor owns at the Bazaar', () => {
  const w = world();
  const c = debtor(w, 1000, SEIZURE_AFTER_DAYS); // more than everything they own
  c.inventory.goods = 10;
  c.possessions.push({ id: nextId(w, 'i'), productId: 'moss_sofa', acquiredDay: 0 });
  const before = totalMoney(w);
  const sofasBefore = w.emporium.moss_sofa ?? 0;
  assert.equal(recoveryStep(w, c), 'seizure');

  dailyRecovery(w);
  assert.equal(c.inventory.goods, 0, 'every good went to the Bazaar');
  assert.deepEqual(c.possessions, [], 'and the sofa with them');
  assert.equal(w.emporium.moss_sofa, sofasBefore + 1, 'the sofa stands on the Emporium shelf');
  assert.equal(c.wallet, 0, 'the bailiffs took the proceeds, not the citizen');
  assert.ok(c.finesOwed < 1000 && c.finesOwed > 0, 'what the sale raised came off the debt; the rest is still a debt');
  assert.equal(totalMoney(w), before, 'a forced sale moves money, it does not make it');
  assert.ok(w.events.some((e) => e.kind === 'law' && e.text.includes('seized and sold')));
  assert.equal(c.standing, 'good', 'seizure takes things, never standing');
  assert.equal(c.homeTier, 0, 'and never a home');
});

test('a forced sale fetches half what a thing cost, and the surplus goes back to the debtor', () => {
  const w = world();
  const c = debtor(w, 10, SEIZURE_AFTER_DAYS);
  c.possessions.push({ id: nextId(w, 'i'), productId: 'moss_sofa', acquiredDay: 0 });
  const worth = Math.round(PRODUCTS.moss_sofa.basePrice * FORCED_SALE_SHARE);
  assert.equal(saleableValue(w, c), worth);
  const before = totalMoney(w);

  const raised = seizePossessions(w, c);
  assert.equal(raised, 10, 'the bailiffs take the debt and not a lumen more');
  assert.equal(c.finesOwed, 0);
  assert.equal(c.wallet, worth - 10, 'the surplus of the sale is the citizen\'s');
  assert.equal(totalMoney(w), before);
});

test('what a sale cannot cover stays a debt, and stays only a debt', () => {
  const w = world();
  const c = debtor(w, 1000, SEIZURE_AFTER_DAYS);
  for (const productId of ['moss_sofa', 'lantern_lamp']) {
    c.possessions.push({ id: nextId(w, 'i'), productId, acquiredDay: 0 });
  }
  const worth = Math.round(PRODUCTS.moss_sofa.basePrice * FORCED_SALE_SHARE)
    + Math.round(PRODUCTS.lantern_lamp.basePrice * FORCED_SALE_SHARE);
  assert.equal(saleableValue(w, c), worth);
  assert.equal(seizePossessions(w, c), worth);
  assert.equal(c.finesOwed, 1000 - worth);
  assert.equal(c.standing, 'good');
  assert.equal(ableToPay(w, c), false, 'they have sold everything and still cannot pay: that is not defiance');
});

test('then the business stock, and then the trading licence, which comes back on settling', () => {
  const w = world();
  const c = debtor(w, 400, STOCK_AFTER_DAYS);
  const b = addBusiness(w, c.id, 0);
  b.inventory.goods = 6;
  const before = totalMoney(w);

  assert.equal(recoveryStep(w, c), 'stock');
  const raised = seizeBusinessStock(w, c);
  assert.ok(raised > 0, 'the stock was sold');
  assert.equal(b.inventory.goods, 0);
  assert.equal(c.finesOwed, 400 - raised);
  assert.equal(totalMoney(w), before);
  assert.equal(tradingLicenceRevoked(w, b.id), false, 'not yet: the licence is the rung after');

  c.finesOwedSinceDay = w.day - LICENCE_AFTER_DAYS;
  assert.equal(recoveryStep(w, c), 'licence');
  dailyRecovery(w);
  assert.equal(tradingLicenceRevoked(w, b.id), true);
  assert.equal(c.standing, 'good', 'the owner keeps their standing, their home and their liberty');
  assert.equal(b.dissolvedDay, null, 'and their business');
  assert.ok(w.events.some((e) => e.kind === 'law' && e.text.includes('trading licence')));

  // Settled: the licence is restored the same day.
  transfer(w, 'treasury', c.id, 1000, 'grant', 'an inheritance');
  paidWages(w, c, 4000);
  w.day += 1; w.tick += 24;
  dailyRecovery(w);
  assert.equal(c.finesOwed, 0);
  assert.equal(tradingLicenceRevoked(w, b.id), false, 'the licence comes back the day the debt clears');
  assert.ok(w.events.some((e) => e.kind === 'law' && e.text.includes('may trade again')));
});

// ---------------------------------------------------------------------------
// 4. Contempt — and only for defiance
// ---------------------------------------------------------------------------

test('a fortnight of holding back while able to pay is contempt, charged once and only once', () => {
  const w = world();
  const c = debtor(w, 40, CONTEMPT_AFTER_DAYS - 1, { wallet: 500 });
  const charged: { id: CitizenId; owed: number; days: number }[] = [];
  const handler = (_w: World, id: CitizenId, owed: number, days: number) => charged.push({ id, owed, days });

  dailyRecovery(w, handler);
  assert.deepEqual(charged, [], 'thirteen days is not yet fourteen');
  assert.equal(recoveryStep(w, c), 'seizure');

  w.day += 1; w.tick += 24;
  assert.equal(ableToPay(w, c), true, '500 ℓ in hand and 40 ℓ owed');
  assert.equal(recoveryStep(w, c), 'contempt');
  dailyRecovery(w, handler);
  assert.deepEqual(charged, [{ id: c.id, owed: 40, days: CONTEMPT_AFTER_DAYS }]);
  assert.equal(c.standing, 'good', 'contempt is a charge before the Court, not a punishment of its own');
  assert.equal(c.finesOwed, 40, 'and it does not collect the debt either');

  for (let i = 0; i < 5; i++) {
    w.day += 1; w.tick += 24;
    dailyRecovery(w, handler);
  }
  assert.equal(charged.length, 1, 'one charge per debt, however long it stands');
  assert.ok(w.events.some((e) => e.kind === 'law' && e.text.includes('while able to pay')));
});

test('the Chest may clear a debt nobody can pay, and does not touch one somebody can', () => {
  const w = world();
  const poor = debtor(w, 30, CHEST_AFTER_DAYS);
  const rich = debtor(w, 30, CHEST_AFTER_DAYS, { wallet: 400 });
  transfer(w, 'treasury', 'chest', 200, 'donation', 'the Chest');
  const before = totalMoney(w);

  assert.equal(clearDebtFromChest(w, rich), 0, 'a citizen with the lumens pays their own fines');
  const cleared = clearDebtFromChest(w, poor);
  assert.equal(cleared, 30);
  assert.equal(poor.finesOwed, 0);
  assert.equal(poor.finesOwedSinceDay, null);
  assert.equal(w.treasury.chest, 170, 'the Chest paid the Treasury');
  assert.equal(totalMoney(w), before);
  assert.ok(w.events.some((e) => e.kind === 'donation' && e.text.includes('could not pay')));
});

test('debtOf, debtDays and recoveryStep read the debt the same way the ladder does', () => {
  const w = world();
  const c = debtor(w, 0);
  assert.equal(debtOf(c), 0);
  assert.equal(debtDays(w, c), 0);
  assert.equal(recoveryStep(w, c), 'none');
  c.finesOwed = 25;
  c.finesOwedSinceDay = w.day;
  assert.equal(recoveryStep(w, c), 'garnishment');
  c.finesOwedSinceDay = w.day - SEIZURE_AFTER_DAYS;
  assert.equal(debtDays(w, c), SEIZURE_AFTER_DAYS);
  assert.equal(recoveryStep(w, c), 'seizure', 'with no business there is no stock and no licence to take');
});

// ---------------------------------------------------------------------------
// Restitution pulls you back
// ---------------------------------------------------------------------------

test('restitution paid in full and a clean fortnight strikes one conviction off the ladder', () => {
  const w = world();
  const d = makeCitizen(w, { wallet: 100 });
  const victim = makeCitizen(w, { wallet: 50 });
  const k = conviction(w, d, victim, 30);
  const before = totalMoney(w);

  const paid = payRestitution(w, d.id, k.id);
  assert.equal(paid.ok, true, paid.message);
  assert.equal(d.wallet, 70);
  assert.equal(victim.wallet, 80);
  assert.equal(w.counters[restitutionPaidKey(k.id)], w.day);
  assert.equal(totalMoney(w), before);
  assert.equal(payRestitution(w, d.id, k.id).ok, false, 'paid once is paid');

  assert.deepEqual(strikeOffRestitution(w, d), [], 'the fortnight has not passed');
  w.day += CLEAN_DAYS - 1; w.tick = w.day * 24;
  assert.deepEqual(strikeOffRestitution(w, d), [], 'thirteen days is not fourteen');
  w.day += 1; w.tick = w.day * 24;
  assert.deepEqual(strikeOffRestitution(w, d), [k.id]);
  assert.equal(w.counters[strikeStruckKey(k.id)], w.day);
  assert.equal(d.record.convictions.length, 1, 'the record is permanent: the conviction stays on it');
  assert.ok(d.memory.some((m) => m.text.includes('The record keeps it')));
  assert.deepEqual(strikeOffRestitution(w, d), [], 'one payment, one strike');
});

test('the convict tops up what the fine already paid the victim, and never pays it twice', () => {
  const w = world();
  const d = makeCitizen(w, { wallet: 100 });
  const victim = makeCitizen(w, { wallet: 0 });
  const k = conviction(w, d, victim, 50);
  // The fine could only reach 20 ℓ of the 50 ℓ taken; the Court paid that over.
  w.counters[restitutionAmountKey(k.id)] = 20;
  transfer(w, d.id, victim.id, 20, 'restitution', 'what the fine covered');
  assert.equal(outstandingRestitution(w, k), 30);

  const before = totalMoney(w);
  assert.equal(payRestitution(w, d.id, k.id).ok, true);
  assert.equal(victim.wallet, 50, 'made whole, and made whole once');
  assert.equal(d.wallet, 50);
  assert.equal(outstandingRestitution(w, k), 0);
  assert.equal(w.counters[restitutionPaidKey(k.id)], w.day);
  assert.equal(totalMoney(w), before);
});

test('a conviction inside the fortnight resets the offer, and a part payment never starts it', () => {
  const w = world();
  const d = makeCitizen(w, { wallet: 100 });
  const victim = makeCitizen(w, { wallet: 0 });
  const k = conviction(w, d, victim, 40);

  d.wallet = 10;
  assert.equal(payRestitution(w, d.id, k.id).ok, false, 'full restitution is the only kind that counts');
  assert.equal(victim.wallet, 0);

  d.wallet = 100;
  assert.equal(payRestitution(w, d.id, k.id).ok, true);
  w.day += 3;
  conviction(w, d, victim, 5, w.day); // caught again inside the fortnight
  w.day += CLEAN_DAYS; w.tick = w.day * 24;
  assert.deepEqual(strikeOffRestitution(w, d), [], 'clean means clean');
});

test('recoverFrom leaves a settled citizen alone and never touches their standing', () => {
  const w = world();
  const c = makeCitizen(w, { wallet: 200 });
  c.finesOwed = 0;
  c.finesOwedSinceDay = 3;
  const before = totalMoney(w);
  recoverFrom(w, c);
  assert.equal(c.finesOwedSinceDay, null, 'a debt of nothing is no debt at all');
  assert.equal(c.wallet, 200);
  assert.equal(c.standing, 'good');
  assert.equal(totalMoney(w), before);
});
