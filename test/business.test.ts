import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Business, Citizen, World } from '../src/types.ts';
import { BUSINESS_CAPITAL, BUSINESS_FOUNDING_COST, BUSINESS_RENT } from '../src/data/jobs.ts';
import {
  dailyBusinesses, dissolveBusiness, fireCitizen, foundBusiness, hireCitizen, hourlyBusinesses,
} from '../src/economy/business.ts';

function founded(world: World, kind: Business['kind'] = 'workshop', name = 'Copper Works'): { owner: Citizen; biz: Business } {
  const owner = makeCitizen(world, { wallet: 500 });
  const res = foundBusiness(world, owner.id, name, kind);
  assert.equal(res.ok, true, res.message);
  const biz = world.businesses[owner.businessId as string];
  return { owner, biz };
}

test('foundBusiness splits the founding cost, posts jobs and picks premises by kind', () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { wallet: 500 });
  const before = totalMoney(w);
  const t0 = w.treasury.balance;
  const res = foundBusiness(w, owner.id, 'Copper Works', 'workshop');
  assert.equal(res.ok, true, res.message);
  const biz = w.businesses[owner.businessId as string];
  assert.equal(owner.wallet, 500 - BUSINESS_FOUNDING_COST);
  assert.equal(biz.treasury, BUSINESS_CAPITAL);
  assert.equal(w.treasury.balance, t0 + BUSINESS_FOUNDING_COST - BUSINESS_CAPITAL);
  assert.equal(w.treasury.totals.capital, BUSINESS_CAPITAL);
  assert.equal(w.treasury.totals.fee, BUSINESS_FOUNDING_COST - BUSINESS_CAPITAL);
  assert.equal(biz.revenueToday, 0); // capital is not revenue
  assert.equal(biz.district, 'harbor_market');
  assert.equal(biz.rentPerDay, BUSINESS_RENT.workshop);
  assert.equal(biz.jobs.length, 2);
  for (const id of biz.jobs) {
    const job = w.jobs[id];
    assert.equal(job.employer, biz.id);
    assert.equal(job.role, 'fabricator');
    assert.equal(job.district, 'harbor_market');
    assert.equal(job.wage, 9); // template wages sit at the founding minimum wage
  }
  assert.equal(totalMoney(w), before);
  const ev = w.events.find((e) => e.kind === 'business_founded');
  assert.ok(ev && ev.weight === 0.5 && ev.actors.includes(owner.id));

  const cafe = founded(w, 'cafe', 'Halflight Café');
  assert.equal(cafe.biz.district, 'nightglass');
  assert.equal(cafe.biz.buildingId, 'shopfronts_nightglass');
  assert.equal(w.jobs[cafe.biz.jobs[0]].district, 'nightglass');
});

test('foundBusiness respects the minimum wage when posting jobs', () => {
  const w = makeWorld();
  w.government.minWage = 20;
  const { biz } = founded(w, 'courier', 'Swift');
  for (const id of biz.jobs) assert.equal(w.jobs[id].wage, 20);
});

test('foundBusiness refuses the unqualified, the already-owning, the broke and duplicate names', () => {
  const w = makeWorld();
  const { owner } = founded(w);
  assert.equal(foundBusiness(w, owner.id, 'Second', 'shop').ok, false);
  const poor = makeCitizen(w, { wallet: 299 });
  assert.equal(foundBusiness(w, poor.id, 'Poor', 'shop').ok, false);
  assert.equal(poor.wallet, 299);
  const prob = makeCitizen(w, { wallet: 500, standing: 'probation' });
  assert.equal(foundBusiness(w, prob.id, 'Prob', 'shop').ok, false);
  const dup = makeCitizen(w, { wallet: 500 });
  assert.equal(foundBusiness(w, dup.id, ' copper works ', 'shop').ok, false);
  assert.equal(foundBusiness(w, dup.id, '   ', 'shop').ok, false);
  assert.equal(foundBusiness(w, 'c_404', 'Ghost', 'shop').ok, false);
  assert.equal(Object.keys(w.businesses).length, 1);
});

test('hireCitizen and fireCitizen manage the payroll', () => {
  const w = makeWorld();
  const { owner, biz } = founded(w);
  const jobId = biz.jobs[0];
  const skilled = makeCitizen(w);
  const clumsy = makeCitizen(w, { skills: { crafting: 5, analysis: 20, rhetoric: 20, care: 20, commerce: 20, artistry: 20 } });
  assert.equal(hireCitizen(w, biz.id, clumsy.id, jobId).ok, false);
  assert.equal(hireCitizen(w, biz.id, skilled.id, 'j_999').ok, false);
  assert.equal(hireCitizen(w, 'b_99', skilled.id, jobId).ok, false);
  const hired = hireCitizen(w, biz.id, skilled.id, jobId);
  assert.equal(hired.ok, true, hired.message);
  assert.deepEqual(biz.employees, [skilled.id]);
  assert.equal(w.jobs[jobId].holderId, skilled.id);
  assert.equal(skilled.jobId, jobId);
  assert.ok(owner.memory.some((m) => m.text.includes('hired')));
  assert.equal(hireCitizen(w, biz.id, makeCitizen(w).id, jobId).ok, false); // filled
  const suspended = makeCitizen(w, { standing: 'suspended' });
  assert.equal(hireCitizen(w, biz.id, suspended.id, biz.jobs[1]).ok, false);

  assert.equal(fireCitizen(w, biz.id, owner.id).ok, false); // not an employee
  assert.equal(fireCitizen(w, biz.id, skilled.id).ok, true);
  assert.deepEqual(biz.employees, []);
  assert.equal(skilled.jobId, null);
  assert.equal(w.jobs[jobId].holderId, null);
  assert.ok(w.events.some((e) => e.kind === 'fired' && e.actors.includes(skilled.id)));
});

test('hourlyBusinesses sells finished goods to the Bazaar but keeps energy', () => {
  const w = makeWorld();
  const { biz } = founded(w);
  biz.inventory.goods = 5;
  biz.inventory.energy = 2;
  const before = totalMoney(w);
  const stock0 = w.market.goods.goods.stock;
  hourlyBusinesses(w);
  assert.equal(biz.inventory.goods, 0);
  assert.equal(biz.inventory.energy, 2);
  assert.equal(w.market.goods.goods.stock, stock0 + 5);
  assert.equal(biz.treasury, BUSINESS_CAPITAL + 57); // 60 × 0.95
  assert.equal(biz.revenueToday, 57);
  assert.equal(totalMoney(w), before);
  biz.inventory.goods = 3;
  biz.dissolvedDay = 0;
  hourlyBusinesses(w);
  assert.equal(biz.inventory.goods, 3);
});

test('dailyBusinesses collects rent, taxes profit, pays the owner and conserves money', () => {
  const w = makeWorld();
  const { owner, biz } = founded(w);
  biz.treasury = 500;
  biz.revenueToday = 300;
  biz.costsToday = 50;
  const before = totalMoney(w);
  const t0 = w.treasury.balance;
  const wallet0 = owner.wallet;
  dailyBusinesses(w);
  // rent 12 → costs 62 → profit 238 → tax 24 → treasury 464 → payout 182 (tax 27, net 155) → 282
  assert.equal(biz.treasury, 282);
  assert.equal(owner.wallet, wallet0 + 155);
  assert.equal(w.treasury.balance, t0 + 12 + 24 + 27);
  assert.equal(w.treasury.totals.rent, 12);
  assert.equal(w.treasury.totals.profit_tax, 24);
  assert.equal(w.treasury.totals.payout, 155);
  assert.equal(owner.stats.totalEarned, 155);
  assert.equal(biz.revenueToday, 0);
  assert.equal(biz.costsToday, 0);
  assert.equal(biz.daysNegative, 0);
  assert.equal(totalMoney(w), before);
  assert.ok(owner.memory.some((m) => m.text.includes('155 ℓ')));
});

test('a business with no profit pays no profit tax and no payout below the reserve', () => {
  const w = makeWorld();
  const { owner, biz } = founded(w);
  biz.treasury = 90;
  const wallet0 = owner.wallet;
  dailyBusinesses(w);
  assert.equal(biz.treasury, 78);
  assert.equal(owner.wallet, wallet0);
  assert.equal(w.treasury.totals.profit_tax, undefined);
  assert.equal(biz.daysNegative, 0); // still covers tomorrow's rent
});

test('a loss-making day pays the owner nothing: the capital stays in the business', () => {
  const w = makeWorld();
  const { owner, biz } = founded(w);
  biz.treasury = 400;
  biz.revenueToday = 20;
  biz.costsToday = 80;
  const wallet0 = owner.wallet;
  const before = totalMoney(w);
  dailyBusinesses(w);
  assert.equal(owner.wallet, wallet0);
  assert.equal(biz.treasury, 400 - BUSINESS_RENT.workshop);
  assert.equal(biz.daysNegative, 0, 'a loss with cash in hand is not yet underwater');
  assert.ok(owner.memory.some((m) => /lost 72 ℓ today/.test(m.text)), 'the loss includes the rent');
  assert.equal(totalMoney(w), before);
});

test('three days underwater means bankruptcy: staff dismissed, owner marked, record kept', () => {
  const w = makeWorld();
  const { owner, biz } = founded(w);
  const employee = makeCitizen(w);
  hireCitizen(w, biz.id, employee.id, biz.jobs[0]);
  biz.treasury = 0;
  const before = totalMoney(w);
  dailyBusinesses(w);
  assert.equal(biz.daysNegative, 1);
  dailyBusinesses(w);
  assert.equal(biz.daysNegative, 2);
  assert.equal(biz.dissolvedDay, null);
  w.day = 5;
  dailyBusinesses(w);
  assert.equal(biz.dissolvedDay, 5);
  assert.equal(owner.businessId, null);
  assert.equal(owner.reputation, 45);
  assert.equal(employee.jobId, null);
  assert.deepEqual(biz.employees, []);
  assert.deepEqual(biz.jobs, []);
  assert.equal(Object.values(w.jobs).filter((j) => j.employer === biz.id).length, 0);
  assert.ok(w.businesses[biz.id]); // history is kept
  const ev = w.events.find((e) => e.kind === 'business_bankrupt');
  assert.ok(ev && ev.weight === 0.7 && ev.actors.includes(owner.id));
  assert.equal(totalMoney(w), before);
  dailyBusinesses(w); // dissolved businesses are left alone
  assert.equal(biz.daysNegative, 3);
  // the owner may found again
  owner.wallet = 500;
  assert.equal(foundBusiness(w, owner.id, 'Copper Works II', 'shop').ok, true);
});

test('dissolveBusiness returns cash and stock to the owner, or seizes them for the city', () => {
  const w = makeWorld();
  const { owner, biz } = founded(w);
  biz.inventory.goods = 4;
  const before = totalMoney(w);
  const wallet0 = owner.wallet;
  dissolveBusiness(w, biz.id, 'owner emigrated');
  assert.equal(owner.wallet, wallet0 + BUSINESS_CAPITAL);
  assert.equal(owner.inventory.goods, 4);
  assert.equal(biz.treasury, 0);
  assert.equal(biz.inventory.goods, 0);
  assert.equal(owner.businessId, null);
  assert.equal(totalMoney(w), before);
  assert.equal(w.events.filter((e) => e.kind === 'business_bankrupt').length, 0);
  dissolveBusiness(w, biz.id, 'twice'); // idempotent
  assert.equal(owner.wallet, wallet0 + BUSINESS_CAPITAL);

  const seized = founded(w, 'shop', 'Seized Emporium');
  seized.biz.inventory.goods = 2;
  const before2 = totalMoney(w); // founded() minted a 500 ℓ test wallet
  const t0 = w.treasury.balance;
  const stock0 = w.market.goods.goods.stock;
  const wallet1 = seized.owner.wallet;
  dissolveBusiness(w, seized.biz.id, 'owner exiled', true);
  assert.equal(w.treasury.balance, t0 + BUSINESS_CAPITAL);
  assert.equal(w.treasury.totals.seizure, BUSINESS_CAPITAL);
  assert.equal(seized.owner.wallet, wallet1);
  assert.equal(w.market.goods.goods.stock, stock0 + 2);
  assert.equal(totalMoney(w), before2);
});
