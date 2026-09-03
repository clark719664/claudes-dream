import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Business, World } from '../src/types.ts';

import {
  buyFromMarket, dailyMarket, daysOfCover, deliverToMarket, marketPrice, sellToMarket, takeFromMarket, tickMarket, unmetDemand,
  wholeUnits,
} from '../src/economy/market.ts';

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

test('buyFromMarket refuses bad quantities, empty wallets, exiles and short stock (recording unmet demand)', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 5 });
  assert.equal(buyFromMarket(w, c.id, 'goods', 0).ok, false);
  assert.equal(buyFromMarket(w, c.id, 'goods', -2).ok, false);
  assert.equal(buyFromMarket(w, c.id, 'goods', 1).ok, false); // 13 ℓ > 5 ℓ
  assert.equal(buyFromMarket(w, 'c_404', 'goods', 1).ok, false);
  const ex = makeCitizen(w, { wallet: 500, standing: 'exiled' });
  assert.equal(buyFromMarket(w, ex.id, 'goods', 1).ok, false);
  assert.equal(w.market.goods.goods.demandTick, 0);
  assert.equal(unmetDemand(w, 'goods'), 0, 'a refusal for money or standing is not unmet demand');

  const rich = makeCitizen(w, { wallet: 100000 });
  const res = buyFromMarket(w, rich.id, 'knowledge', 25); // stock is 20
  assert.equal(res.ok, false);
  assert.match(res.message, /only has 20/);
  // only completed purchases are demand that moves the price; the failed request is unmet demand
  assert.equal(w.market.goods.knowledge.demandTick, 0);
  assert.equal(w.market.goods.knowledge.demandDay, 0);
  assert.equal(unmetDemand(w, 'knowledge'), 25);
  assert.equal(w.market.goods.knowledge.stock, 20);
  assert.equal(rich.wallet, 100000);
  assert.equal(buyFromMarket(w, rich.id, 'knowledge', 21).ok, false);
  assert.equal(unmetDemand(w, 'knowledge'), 46, 'unmet demand accumulates within the tick');
  tickMarket(w);
  assert.equal(unmetDemand(w, 'knowledge'), 0, 'tickMarket clears unmet demand');
  assert.deepEqual(w.market.shortages, [], 'stock was short of the request but not empty: no shortage');
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

test('takeFromMarket removes up to the stock, counting what it took as demand and the shortfall as unmet', () => {
  const w = makeWorld();
  w.market.goods.energy.stock = 3;
  assert.equal(takeFromMarket(w, 'energy', 2), 2);
  assert.equal(w.market.goods.energy.stock, 1);
  assert.equal(unmetDemand(w, 'energy'), 0);
  assert.equal(takeFromMarket(w, 'energy', 5), 1);
  assert.equal(w.market.goods.energy.stock, 0);
  assert.equal(w.market.goods.energy.demandTick, 3);
  assert.equal(w.market.goods.energy.demandDay, 3);
  assert.equal(unmetDemand(w, 'energy'), 4);
  assert.equal(takeFromMarket(w, 'energy', 0), 0);
  assert.equal(takeFromMarket(w, 'energy', Number.NaN), 0);
  assert.equal(unmetDemand(w, 'energy'), 4, 'nothing asked for is nothing unmet');
  tickMarket(w);
  assert.deepEqual(w.market.shortages, ['energy'], 'an empty shelf that a producer went without is a shortage');
});

/** Drive one good through `days` of a daily pattern: `supply` units per working tick, `demand` per tick on the given hours (unmet when the shelf is bare). */
function runDays(w: World, good: 'compute', days: number, supplyPerWorkTick: number, demandAt: (hour: number) => number): void {
  const buyer = makeCitizen(w, { wallet: 10_000_000 });
  for (let day = 0; day < days; day++) {
    for (let hour = 0; hour < 24; hour++) {
      w.tick = day * 24 + hour;
      w.day = day;
      w.hour = hour;
      if (hour >= 8 && hour < 18) deliverToMarket(w, good, supplyPerWorkTick);
      const wanted = demandAt(hour);
      if (wanted > 0) {
        const got = Math.min(wanted, w.market.goods[good].stock);
        if (got > 0) buyFromMarket(w, buyer.id, good, got);
        if (got < wanted) buyFromMarket(w, buyer.id, good, wanted - got); // refused: unmet demand
      }
      tickMarket(w);
    }
  }
}

test('a balanced market with daytime-only production does not drift: night purchases are not shortages', () => {
  const w = makeWorld();
  const start = w.market.goods.compute.price;
  // 180 units made in 10 working ticks, 180 units eaten in 12 spread over the whole day: balanced over the day
  runDays(w, 'compute', 30, 18, (hour) => (hour % 2 === 0 ? 15 : 0));
  const p = w.market.goods.compute.price;
  assert.ok(p >= start * 0.8 && p <= start * 1.25, `price drifted from ${start} to ${p}`);
});

test('a sustained imbalance moves the price steadily, both ways, without hitting the bounds in a week', () => {
  const w = makeWorld();
  w.market.goods.compute.stock = 60; // a thin shelf: about a quarter of a day's demand
  // 15% more demand than supply, the shelf kept thin by the drawdown
  runDays(w, 'compute', 7, 20, (hour) => (hour % 2 === 0 ? 19 : 0));
  const up = w.market.goods.compute.price;
  assert.ok(up > 6 && up < 6 * 20, `demand above supply on a thin shelf should lift the price gently (got ${up})`);
  const w2 = makeWorld();
  w2.market.goods.compute.stock = 100_000;
  // 15% more supply than demand
  runDays(w2, 'compute', 7, 20, (hour) => (hour % 2 === 0 ? 14 : 0));
  const down = w2.market.goods.compute.price;
  assert.ok(down < 6 && down > 1, `supply above demand should lower the price gently (got ${down})`);
});

test('a lasting famine settles the price near twice founding: a scarcity signal that cannot walk to the cap', () => {
  const w = makeWorld();
  w.market.goods.compute.stock = 0;
  // supply 10 a working tick, all snapped up at once, and a queue at the empty shelf in between
  runDays(w, 'compute', 14, 10, (hour) => (hour >= 8 && hour < 18 ? 10 : 30));
  const p = w.market.goods.compute.price;
  assert.ok(p > 6, `a persistent stock-out should carry a premium (got ${p})`);
  assert.ok(p <= 6 * 2.1, `but a bounded one (got ${p})`);
  assert.ok(w.events.filter((e) => e.kind === 'shortage').length >= 10, 'and it is reported as a shortage day after day');
  // another month changes nothing: the premium and the pull toward founding have met
  runDays(w, 'compute', 30, 10, (hour) => (hour >= 8 && hour < 18 ? 10 : 30));
  assert.ok(w.market.goods.compute.price <= 6 * 2.1, `still bounded after six weeks (got ${w.market.goods.compute.price})`);
});

test('an empty shelf is reported as a shortage and carries a bounded premium; a glut lowers the price', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 100000 });
  const g = w.market.goods.goods;
  g.stock = 0;
  // four days of stock-out (ticks 1..95, days 0..3): every tick someone leaves empty-handed
  let previous = g.price;
  for (let i = 0; i < 95; i++) {
    w.tick++;
    w.day = Math.floor(w.tick / 24);
    assert.equal(buyFromMarket(w, c.id, 'goods', 1).ok, false);
    tickMarket(w);
    assert.deepEqual(w.market.shortages, ['goods']);
    assert.ok(g.price >= previous, 'the premium never reverses while the shelf stays bare');
    previous = g.price;
  }
  assert.ok(g.price > 12 && g.price <= 24, `nothing was traded, yet the queue lifted the price a little (got ${g.price})`);
  assert.equal(w.events.filter((e) => e.kind === 'shortage').length, 4, 'one shortage story per day');
  // then supply pours in with nobody buying: the price falls
  for (let i = 0; i < 60; i++) {
    w.tick++;
    deliverToMarket(w, 'goods', 20);
    tickMarket(w);
  }
  assert.deepEqual(w.market.shortages, []);
  assert.ok(g.price < 12, `a glut should push the price below founding (got ${g.price})`);
  assert.ok(g.price >= 1);
});

test('tickMarket raises prices when demand exceeds supply on a bare shelf and lowers them when supply exceeds demand', () => {
  const w = makeWorld();
  w.market.goods.goods.stock = 0;
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

test('a well-stocked good does not get dearer however brisk the trade; the damping fades as the shelf empties', () => {
  const w = makeWorld();
  // 120 goods in stock against 10 a tick of demand is twelve days of cover: no upward pressure at all
  w.market.goods.goods.demandTick = 10;
  tickMarket(w);
  assert.equal(w.market.goods.goods.price, 12);
  assert.ok(daysOfCover(w, 'goods') > 3, `cover ${daysOfCover(w, 'goods')}`);
  // half the comfortable cover: half a step
  const w2 = makeWorld();
  w2.market.goods.goods.stock = 15; // 15 / (10/24 × 24) = 1.5 days
  w2.market.goods.goods.demandTick = 10;
  tickMarket(w2);
  assert.ok(Math.abs(daysOfCover(w2, 'goods') - 1.5) < 1e-4, `cover ${daysOfCover(w2, 'goods')}`);
  assert.ok(Math.abs((w2.market.goods.goods.price + (w2.counters['pricefrac:goods'] ?? 0)) - 12 * 1.025) < 1e-4);
  // and an empty shelf feels no downward pressure however much is delivered and unsold this tick
  const w3 = makeWorld();
  w3.market.goods.culture.stock = 0;
  w3.market.goods.culture.supplyTick = 10; // arrived and gone again within the tick
  w3.market.goods.culture.price = 20;
  tickMarket(w3);
  assert.equal(w3.market.goods.culture.price, 20);
});

test('tickMarket lets cheap goods move too, thanks to the fractional residual', () => {
  const w = makeWorld();
  w.market.goods.energy.stock = 0;
  for (let i = 0; i < 4; i++) {
    w.market.goods.energy.demandTick = 5;
    tickMarket(w);
  }
  assert.equal(w.market.goods.energy.price, 4); // 3 × 1.05^4 = 3.65
  for (let i = 0; i < 40; i++) {
    w.market.goods.energy.supplyTick = 50;
    w.market.goods.energy.stock += 50;
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
  w.market.goods.goods.stock = 0;
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
