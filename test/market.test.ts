import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Business, World } from '../src/types.ts';
import {
  buyFromMarket, dailyMarket, deliverToMarket, marketPrice, sellToMarket, takeFromMarket, tickMarket, wholeUnits,
} from '../src/economy/market.ts';

function makeBusiness(world: World, ownerId: string, treasury = 100): Business {
  const b: Business = {
    id: 'b_1', name: 'Test Works', kind: 'workshop', ownerId, treasury, district: 'harbor_market',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 15, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null,
  };
  world.businesses[b.id] = b;
  return b;
}

test('marketPrice returns the founding price of an untouched market', () => {
  const w = makeWorld();
  assert.equal(marketPrice(w, 'compute'), 6);
  assert.equal(marketPrice(w, 'knowledge'), 15);
});

test('buyFromMarket charges price plus sales tax to the treasury and conserves money', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 100 });
  const before = totalMoney(w);
  const t0 = w.treasury.balance;
  const res = buyFromMarket(w, c.id, 'goods', 3);
  assert.equal(res.ok, true, res.message);
  // 12 × 3 = 36, × 1.05 = 37.8 → 38; tax 2
  assert.equal(c.wallet, 62);
  assert.equal(w.treasury.balance, t0 + 38);
  assert.equal(w.treasury.totals.purchase, 36);
  assert.equal(w.treasury.totals.sales_tax, 2);
  assert.equal(c.inventory.goods, 3);
  assert.equal(w.market.goods.goods.stock, 117);
  assert.equal(w.market.goods.goods.demandTick, 3);
  assert.equal(w.market.goods.goods.demandDay, 3);
  assert.equal(totalMoney(w), before);
  assert.ok(c.memory.some((m) => m.kind === 'money'));
});

test('buyFromMarket refuses bad quantities, empty wallets, exiles and short stock (still counting demand)', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 5 });
  assert.equal(buyFromMarket(w, c.id, 'goods', 0).ok, false);
  assert.equal(buyFromMarket(w, c.id, 'goods', -2).ok, false);
  assert.equal(buyFromMarket(w, c.id, 'goods', 1).ok, false); // 13 ℓ > 5 ℓ
  assert.equal(buyFromMarket(w, 'c_404', 'goods', 1).ok, false);
  const ex = makeCitizen(w, { wallet: 500, standing: 'exiled' });
  assert.equal(buyFromMarket(w, ex.id, 'goods', 1).ok, false);
  assert.equal(w.market.goods.goods.demandTick, 0);

  const rich = makeCitizen(w, { wallet: 100000 });
  const res = buyFromMarket(w, rich.id, 'knowledge', 25); // stock is 20
  assert.equal(res.ok, false);
  assert.match(res.message, /only has 20/);
  assert.equal(w.market.goods.knowledge.demandTick, 25);
  assert.equal(w.market.goods.knowledge.stock, 20);
  assert.equal(rich.wallet, 100000);
});

test('sellToMarket pays price minus sales tax from the treasury; the tax stays and is recorded', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 0, inventory: { compute: 0, energy: 0, goods: 10, culture: 0, knowledge: 0 } });
  const before = totalMoney(w);
  const t0 = w.treasury.balance;
  const res = sellToMarket(w, c.id, 'goods', 10);
  assert.equal(res.ok, true, res.message);
  // 120 gross, × 0.95 = 114
  assert.equal(c.wallet, 114);
  assert.equal(w.treasury.balance, t0 - 114);
  assert.equal(w.treasury.totals.sale, 114);
  assert.equal(w.treasury.totals.sales_tax, 6);
  assert.equal(c.inventory.goods, 0);
  assert.equal(w.market.goods.goods.stock, 130);
  assert.equal(w.market.goods.goods.supplyTick, 10);
  assert.equal(w.market.goods.goods.supplyDay, 10);
  assert.equal(totalMoney(w), before);
  assert.equal(sellToMarket(w, c.id, 'goods', 1).ok, false);
  assert.equal(sellToMarket(w, c.id, 'goods', 0).ok, false);
});

test('businesses trade with their own treasury and P&L counters', () => {
  const w = makeWorld();
  const owner = makeCitizen(w);
  const b = makeBusiness(w, owner.id, 100);
  b.inventory.goods = 2;
  const before = totalMoney(w);
  assert.equal(buyFromMarket(w, b.id, 'energy', 4).ok, true); // 12 → ×1.05 = 12.6 → 13
  assert.equal(b.treasury, 87);
  assert.equal(b.inventory.energy, 4);
  assert.equal(b.costsToday, 13);
  assert.equal(sellToMarket(w, b.id, 'goods', 2).ok, true); // 24 × 0.95 = 22.8 → 23
  assert.equal(b.treasury, 110);
  assert.equal(b.revenueToday, 23);
  assert.equal(totalMoney(w), before);
  b.dissolvedDay = 1;
  assert.equal(buyFromMarket(w, b.id, 'energy', 1).ok, false);
});

test('deliverToMarket accumulates fractional production into whole units', () => {
  const w = makeWorld();
  const start = w.market.goods.goods.stock;
  deliverToMarket(w, 'goods', 1.5);
  assert.equal(w.market.goods.goods.stock, start + 1);
  assert.equal(w.market.goods.goods.supplyTick, 1);
  deliverToMarket(w, 'goods', 1.5);
  assert.equal(w.market.goods.goods.stock, start + 3);
  assert.equal(w.market.goods.goods.supplyTick, 3);
  deliverToMarket(w, 'goods', 0);
  deliverToMarket(w, 'goods', -3);
  assert.equal(w.market.goods.goods.stock, start + 3);
  // float drift does not lose units: 10 × 0.3 = 3
  for (let i = 0; i < 10; i++) deliverToMarket(w, 'knowledge', 0.3);
  assert.equal(w.market.goods.knowledge.stock, 23);
});

test('wholeUnits carries the remainder in world.counters', () => {
  const w = makeWorld();
  assert.equal(wholeUnits(w, 'carry:test', 0.9), 0);
  assert.equal(wholeUnits(w, 'carry:test', 0.9), 1);
  assert.ok(Math.abs((w.counters['carry:test'] ?? 0) - 0.8) < 1e-6);
  assert.equal(wholeUnits(w, 'carry:test', Number.NaN), 0);
});

test('takeFromMarket removes up to the stock and counts the whole request as demand', () => {
  const w = makeWorld();
  w.market.goods.energy.stock = 3;
  assert.equal(takeFromMarket(w, 'energy', 2), 2);
  assert.equal(w.market.goods.energy.stock, 1);
  assert.equal(takeFromMarket(w, 'energy', 5), 1);
  assert.equal(w.market.goods.energy.stock, 0);
  assert.equal(w.market.goods.energy.demandTick, 7);
  assert.equal(takeFromMarket(w, 'energy', 0), 0);
});

test('tickMarket raises prices when demand exceeds supply and lowers them when supply exceeds demand', () => {
  const w = makeWorld();
  w.market.goods.goods.demandTick = 10;
  w.market.goods.goods.supplyTick = 0;
  w.market.goods.culture.demandTick = 0;
  w.market.goods.culture.supplyTick = 10;
  w.market.goods.culture.price = 20;
  tickMarket(w);
  assert.equal(w.market.goods.goods.price, 13); // 12 × 1.05 = 12.6
  assert.equal(w.market.goods.culture.price, 19); // 20 × 0.95
  assert.equal(w.market.goods.goods.demandTick, 0);
  assert.equal(w.market.goods.culture.supplyTick, 0);
  assert.equal(w.market.goods.compute.price, 6); // untouched
});

test('tickMarket lets cheap goods move too, thanks to the fractional residual', () => {
  const w = makeWorld();
  for (let i = 0; i < 4; i++) {
    w.market.goods.energy.demandTick = 5;
    tickMarket(w);
  }
  assert.equal(w.market.goods.energy.price, 4); // 3 × 1.05^4 = 3.65
  for (let i = 0; i < 40; i++) {
    w.market.goods.energy.supplyTick = 50;
    tickMarket(w);
  }
  assert.equal(w.market.goods.energy.price, 1); // floored at 1
});

test('tickMarket caps prices at 20× founding and mean-reverts on quiet ticks', () => {
  const w = makeWorld();
  w.market.goods.goods.price = 239;
  w.market.goods.goods.demandTick = 100;
  tickMarket(w);
  assert.equal(w.market.goods.goods.price, 240);
  w.market.goods.goods.demandTick = 100;
  tickMarket(w);
  assert.equal(w.market.goods.goods.price, 240);

  w.market.goods.culture.price = 24;
  for (let i = 0; i < 100; i++) tickMarket(w);
  assert.ok(w.market.goods.culture.price < 24 && w.market.goods.culture.price >= 8, `price ${w.market.goods.culture.price}`);
  // a quiet market at the founding price stays there
  assert.equal(w.market.goods.compute.price, 6);
});

test('a merchant on shift halves the price step', () => {
  const w = makeWorld();
  w.tick = 9;
  w.counters.merchantOnShiftTick = 9;
  w.market.goods.goods.demandTick = 10;
  tickMarket(w);
  assert.equal(w.market.goods.goods.price, 12); // 12 × 1.025 = 12.3
  w.tick = 10; // merchant no longer on shift
  w.market.goods.goods.demandTick = 10;
  tickMarket(w);
  assert.equal(w.market.goods.goods.price, 13); // 12.3 × 1.05 = 12.9
});

test('tickMarket records shortages and reports each good once per day', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 1000 });
  w.market.goods.compute.stock = 0;
  assert.equal(buyFromMarket(w, c.id, 'compute', 1).ok, false);
  tickMarket(w);
  assert.deepEqual(w.market.shortages, ['compute']);
  assert.equal(w.events.filter((e) => e.kind === 'shortage').length, 1);
  assert.equal(w.events[0].weight, 0.6);
  buyFromMarket(w, c.id, 'compute', 1);
  tickMarket(w);
  assert.deepEqual(w.market.shortages, ['compute']);
  assert.equal(w.events.filter((e) => e.kind === 'shortage').length, 1);
  w.day = 1;
  buyFromMarket(w, c.id, 'compute', 1);
  tickMarket(w);
  assert.equal(w.events.filter((e) => e.kind === 'shortage').length, 2);
  tickMarket(w);
  assert.deepEqual(w.market.shortages, []);
});

test('dailyMarket computes the price index, resets day counters and reports big moves', () => {
  const w = makeWorld();
  w.market.goods.goods.demandDay = 40;
  w.market.goods.goods.supplyDay = 10;
  dailyMarket(w);
  assert.equal(w.market.priceIndex, 1);
  assert.equal(w.market.goods.goods.demandDay, 0);
  assert.equal(w.market.goods.goods.supplyDay, 0);
  assert.equal(w.events.filter((e) => e.kind === 'price').length, 0);
  w.market.goods.goods.price = 24; // index (1+1+2+1+1)/5 = 1.2
  dailyMarket(w);
  assert.equal(w.market.priceIndex, 1.2);
  const ev = w.events.find((e) => e.kind === 'price');
  assert.ok(ev && ev.weight === 0.4);
});
