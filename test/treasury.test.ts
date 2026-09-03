import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Business, World } from '../src/types.ts';
import {
  auditMoneySupply, balanceOf, dailyTreasuryRollover, formatLumens, moneySupply, payDividend, paySalaries,
  transfer, withholdingPay,
} from '../src/economy/treasury.ts';

function makeBusiness(world: World, ownerId: string, treasury = 100): Business {
  const b: Business = {
    id: 'b_1', name: 'Test Works', kind: 'workshop', ownerId, treasury, district: 'harbor_market',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 15, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[b.id] = b;
  return b;
}

test('balanceOf resolves every kind of party', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 50 });
  const b = makeBusiness(w, c.id, 75);
  assert.equal(balanceOf(w, 'treasury'), w.config.foundingSupply);
  assert.equal(balanceOf(w, c.id), 50);
  assert.equal(balanceOf(w, b.id), 75);
  assert.equal(balanceOf(w, 'mint'), Number.POSITIVE_INFINITY);
  assert.equal(balanceOf(w, 'burn'), 0);
  assert.equal(balanceOf(w, 'c_999'), 0);
});

test('transfer moves integer lumens, records the ledger and conserves money', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 100 });
  const b = makeCitizen(w, { wallet: 0 });
  const before = totalMoney(w);
  assert.equal(transfer(w, a.id, b.id, 40, 'gift', 'a present'), true);
  assert.equal(a.wallet, 60);
  assert.equal(b.wallet, 40);
  assert.equal(totalMoney(w), before);
  assert.equal(w.treasury.ledger.length, 1);
  assert.deepEqual(w.treasury.ledger[0], { tick: 0, kind: 'gift', amount: 40, from: a.id, to: b.id, memo: 'a present' });
  assert.equal(w.treasury.totals.gift, 40);
  // treasury flows update the daily counters
  assert.equal(transfer(w, a.id, 'treasury', 10, 'fine', 'fine'), true);
  assert.equal(w.treasury.revenueToday, 10);
  assert.equal(transfer(w, 'treasury', b.id, 5, 'grant', 'grant'), true);
  assert.equal(w.treasury.spendToday, 5);
  assert.equal(totalMoney(w), before);
});

test('transfer refuses impossible movements and changes nothing', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 10 });
  const b = makeCitizen(w, { wallet: 0 });
  const before = totalMoney(w);
  assert.equal(transfer(w, a.id, b.id, 11, 'gift', 'too much'), false);
  assert.equal(transfer(w, a.id, b.id, 0, 'gift', 'zero'), false);
  assert.equal(transfer(w, a.id, b.id, -5, 'gift', 'negative'), false);
  assert.equal(transfer(w, a.id, b.id, Number.NaN, 'gift', 'nan'), false);
  assert.equal(transfer(w, a.id, a.id, 5, 'gift', 'self'), false);
  assert.equal(transfer(w, a.id, 'c_404', 5, 'gift', 'nobody'), false);
  assert.equal(transfer(w, a.id, 'mint', 5, 'gift', 'to mint'), false);
  assert.equal(transfer(w, 'burn', a.id, 5, 'gift', 'from burn'), false);
  assert.equal(a.wallet, 10);
  assert.equal(b.wallet, 0);
  assert.equal(w.treasury.ledger.length, 0);
  assert.equal(totalMoney(w), before);
});

test('transfer rounds fractional amounts', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 10 });
  const b = makeCitizen(w, { wallet: 0 });
  assert.equal(transfer(w, a.id, b.id, 2.4, 'gift', 'rounded'), true);
  assert.equal(b.wallet, 2);
});

test('mint and burn adjust the expected supply so the audit still passes', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 0 });
  assert.equal(transfer(w, 'mint', 'treasury', 500, 'mint', 'printing'), true);
  assert.equal(w.treasury.minted, 500);
  assert.equal(w.treasury.balance, w.config.foundingSupply + 500);
  assert.equal(transfer(w, c.id, 'burn', 0, 'burn', 'nothing'), false);
  transfer(w, 'treasury', c.id, 100, 'grant', 'grant');
  assert.equal(transfer(w, c.id, 'burn', 30, 'burn', 'destroyed'), true);
  assert.equal(w.treasury.burned, 30);
  assert.equal(c.wallet, 70);
  const audit = auditMoneySupply(w);
  assert.equal(audit.ok, true);
  assert.equal(audit.expected, w.config.foundingSupply + 500 - 30);
  assert.equal(audit.supply, moneySupply(w));
});

test('the ledger is bounded by config.ledgerLength', () => {
  const w = makeWorld({ ledgerLength: 3 });
  const a = makeCitizen(w, { wallet: 100 });
  const b = makeCitizen(w, { wallet: 0 });
  for (let i = 0; i < 5; i++) transfer(w, a.id, b.id, 1, 'gift', `g${i}`);
  assert.equal(w.treasury.ledger.length, 3);
  assert.equal(w.treasury.ledger[0].memo, 'g2');
  assert.equal(w.treasury.ledger[2].memo, 'g4');
});

test('transfer tracks business revenue and costs, excluding capital and payouts', () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { wallet: 500 });
  const b = makeBusiness(w, owner.id, 0);
  transfer(w, owner.id, b.id, 200, 'capital', 'founding');
  assert.equal(b.revenueToday, 0);
  transfer(w, 'treasury', b.id, 11, 'fee', 'courier contract');
  assert.equal(b.revenueToday, 11);
  transfer(w, b.id, owner.id, 20, 'wage', 'shift');
  assert.equal(b.costsToday, 20);
  transfer(w, b.id, owner.id, 30, 'payout', 'dividend to owner');
  assert.equal(b.costsToday, 20);
  transfer(w, b.id, 'treasury', 15, 'rent', 'rent');
  assert.equal(b.costsToday, 35);
});

test('a dissolved business cannot receive money', () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { wallet: 500 });
  const b = makeBusiness(w, owner.id, 0);
  b.dissolvedDay = 3;
  assert.equal(transfer(w, owner.id, b.id, 10, 'gift', 'late'), false);
  assert.equal(owner.wallet, 500);
});

test('withholdingPay from a citizen or business splits tax and net', () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { wallet: 0 });
  const worker = makeCitizen(w, { wallet: 0 });
  const b = makeBusiness(w, owner.id, 100);
  const before = totalMoney(w);
  const t0 = w.treasury.balance;
  const res = withholdingPay(w, b.id, worker.id, 14, 'wage', 'shift');
  assert.deepEqual(res, { net: 12, tax: 2 });
  assert.equal(worker.wallet, 12);
  assert.equal(b.treasury, 86);
  assert.equal(w.treasury.balance, t0 + 2);
  assert.equal(w.treasury.totals.income_tax, 2);
  assert.equal(w.treasury.totals.wage, 12);
  assert.equal(worker.stats.totalEarned, 12);
  assert.equal(worker.stats.totalTaxPaid, 2);
  assert.equal(b.costsToday, 14);
  assert.equal(totalMoney(w), before);
});

test('withholdingPay from the treasury moves only the net amount but records the tax', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 0 });
  const before = totalMoney(w);
  const t0 = w.treasury.balance;
  const res = withholdingPay(w, 'treasury', c.id, 20, 'salary', 'stipend');
  assert.deepEqual(res, { net: 17, tax: 3 });
  assert.equal(c.wallet, 17);
  assert.equal(w.treasury.balance, t0 - 17);
  assert.equal(w.treasury.spendToday, 17);
  assert.equal(w.treasury.totals.income_tax, 3);
  assert.equal(c.stats.totalTaxPaid, 3);
  assert.equal(c.stats.totalEarned, 17);
  assert.equal(totalMoney(w), before);
});

test('withholdingPay pays pro rata when the payer is short and honours a tax override', () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { wallet: 0 });
  const worker = makeCitizen(w, { wallet: 0 });
  const b = makeBusiness(w, owner.id, 10);
  const before = totalMoney(w);
  const res = withholdingPay(w, b.id, worker.id, 40, 'wage', 'shift');
  assert.equal(res.net + res.tax, 10);
  assert.equal(b.treasury, 0);
  assert.equal(totalMoney(w), before);
  // nothing left: nothing paid
  assert.deepEqual(withholdingPay(w, b.id, worker.id, 5, 'wage', 'shift'), { net: 0, tax: 0 });
  // tax evasion: rate override of 0
  const evaded = withholdingPay(w, 'treasury', worker.id, 14, 'wage', 'shift', { taxRate: 0 });
  assert.deepEqual(evaded, { net: 14, tax: 0 });
  // bad inputs
  assert.deepEqual(withholdingPay(w, 'treasury', 'c_404', 14, 'wage', 'x'), { net: 0, tax: 0 });
  assert.deepEqual(withholdingPay(w, 'treasury', worker.id, 0, 'wage', 'x'), { net: 0, tax: 0 });
  assert.deepEqual(withholdingPay(w, worker.id, worker.id, 5, 'wage', 'x'), { net: 0, tax: 0 });
});

test('payDividend pays good and probation citizens only, and conserves money', () => {
  const w = makeWorld();
  const good = makeCitizen(w, { wallet: 0 });
  const prob = makeCitizen(w, { wallet: 0, standing: 'probation' });
  const susp = makeCitizen(w, { wallet: 0, standing: 'suspended' });
  const exiled = makeCitizen(w, { wallet: 0, standing: 'exiled' });
  const before = totalMoney(w);
  payDividend(w);
  assert.equal(good.wallet, 15);
  assert.equal(prob.wallet, 15);
  assert.equal(susp.wallet, 0);
  assert.equal(exiled.wallet, 0);
  assert.equal(w.treasury.totals.dividend, 30);
  assert.equal(totalMoney(w), before);
  assert.ok(good.memory.some((m) => m.kind === 'money' && m.text.includes('dividend')));
  assert.ok(w.events.some((e) => e.kind === 'paid'));
  // an emigrant keeps their standing but leaves the turn order: no more dividend
  w.order = w.order.filter((id) => id !== good.id);
  payDividend(w);
  assert.equal(good.wallet, 15);
  assert.equal(prob.wallet, 30);
  assert.equal(totalMoney(w), before);
});

test('payDividend goes pro rata when the treasury is short and suspends when empty', () => {
  const w = makeWorld();
  const cs = [makeCitizen(w, { wallet: 0 }), makeCitizen(w, { wallet: 0 }), makeCitizen(w, { wallet: 0 })];
  w.treasury.balance = 20; // test-only: simulate a near-empty treasury
  payDividend(w);
  for (const c of cs) assert.equal(c.wallet, 6);
  assert.equal(w.treasury.balance, 2);
  assert.ok(w.events.some((e) => e.kind === 'treasury' && e.text.includes('pro rata')));
  w.treasury.balance = 0;
  payDividend(w);
  for (const c of cs) assert.equal(c.wallet, 6);
  assert.ok(w.events.some((e) => e.kind === 'treasury' && e.text.includes('suspended')));
  // a zero dividend pays nobody
  w.government.dividend = 0;
  w.treasury.balance = 1000;
  payDividend(w);
  for (const c of cs) assert.equal(c.wallet, 6);
});

test('paySalaries pays office holders with tax withheld; the mayor is not paid twice', () => {
  const w = makeWorld();
  const mayor = makeCitizen(w, { wallet: 0, office: 'mayor' });
  const councillor = makeCitizen(w, { wallet: 0, office: 'councillor' });
  const judge = makeCitizen(w, { wallet: 0, office: 'judge' });
  const exiledJudge = makeCitizen(w, { wallet: 0, office: 'judge', standing: 'exiled' });
  w.government.mayorId = mayor.id;
  w.government.council = [mayor.id, councillor.id];
  w.government.judges = [judge.id, exiledJudge.id];
  const before = totalMoney(w);
  paySalaries(w);
  assert.equal(mayor.wallet, 25);      // 30 gross, 5 tax
  assert.equal(councillor.wallet, 17); // 20 gross, 3 tax
  assert.equal(judge.wallet, 21);      // 25 gross, 4 tax
  assert.equal(exiledJudge.wallet, 0);
  assert.equal(w.treasury.totals.income_tax, 12);
  assert.equal(totalMoney(w), before);
});

test('auditMoneySupply detects tampering and emits a front-page system event', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 200 }); // makeCitizen does not draw from the treasury
  c.wallet = 0;
  assert.equal(auditMoneySupply(w).ok, true);
  c.wallet = 1; // money from nowhere
  const audit = auditMoneySupply(w);
  assert.equal(audit.ok, false);
  assert.equal(audit.supply, audit.expected + 1);
  const ev = w.events.find((e) => e.kind === 'system');
  assert.ok(ev);
  assert.equal(ev.weight, 0.9);
});

test('dailyTreasuryRollover reports, resets counters and flags a crisis', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 5000 });
  transfer(w, c.id, 'treasury', 1203, 'fine', 'fine');
  transfer(w, 'treasury', c.id, 2980, 'grant', 'grant');
  const report = dailyTreasuryRollover(w);
  assert.equal(report, `Treasury: ${formatLumens(w.treasury.balance)} (+1,203 revenue, −2,980 spend)`);
  assert.equal(w.treasury.revenueToday, 0);
  assert.equal(w.treasury.spendToday, 0);
  const calm = w.events.filter((e) => e.kind === 'treasury').at(-1);
  assert.ok(calm && calm.weight === 0.2);

  // crisis: spend today exceeds what is left
  w.treasury.balance = 100;
  w.treasury.spendToday = 500;
  dailyTreasuryRollover(w);
  const crisis = w.events.filter((e) => e.kind === 'treasury').at(-1);
  assert.ok(crisis && crisis.weight === 0.9 && crisis.text.includes('crisis'));
});

test('formatLumens uses thousands separators', () => {
  assert.equal(formatLumens(91204), '91,204 ℓ');
  assert.equal(formatLumens(0), '0 ℓ');
  assert.equal(formatLumens(-1500), '−1,500 ℓ');
});
