/**
 * The Outer Cities (src/markets/outer.ts).
 *
 * Prices that drift on their own, who may cross the water, what the tariff
 * takes, and the visitors Lantern Night brings. The Outer Cities are outside
 * Reverie's money supply, so trade mints and burns — and `auditMoneySupply`
 * has to stay exact through every crossing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Business, Citizen, Job, World } from '../src/types.ts';
import { GOODS } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { auditMoneySupply } from '../src/economy/treasury.ts';
import { LANTERN_NIGHT_EVERY } from '../src/data/catalogue.ts';
import { OUTER_GOODS_DRIFT } from '../src/data/metropolis.ts';
import {
  MAX_TRADE_QTY, OUTER_PRICE_CEILING, OUTER_PRICE_FLOOR, TOURIST_BASE, TOURIST_SPEND, TOURISTS_PER_CITIZENS,
  dailyOuter, driftOuterPrices, exportGoods, importGoods, mayTrade, outerObservation, outerPrice,
  setTariff, spendTourists, tariff, touristsToday,
} from '../src/markets/outer.ts';

/** A merchant of the city, standing on the Docks. */
function merchant(world: World, wallet = 2_000, name = 'Merchant'): Citizen {
  const c = makeCitizen(world, { name, district: 'harbor_market', wallet });
  const job: Job = {
    id: `j_${Object.keys(world.jobs).length + 1}`, role: 'merchant', title: 'Merchant',
    employer: 'city', buildingId: 'grand_bazaar', district: 'harbor_market',
    skill: 'commerce', minSkill: 0, minReputation: 0, wage: 12, output: {}, holderId: c.id, createdDay: 0,
  };
  world.jobs[job.id] = job;
  c.jobId = job.id;
  return c;
}

function business(world: World, ownerId: string, kind: Business['kind'] = 'shop', treasury = 500): Business {
  const id = `b_${Object.keys(world.businesses).length + 1}`;
  const b: Business = {
    id, name: `Trade ${id}`, kind, ownerId, treasury, district: 'harbor_market',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 12, daysNegative: 0,
    revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[id] = b;
  const owner = world.citizens[ownerId];
  if (owner) owner.businessId = id;
  return b;
}

/**
 * `test/helpers.ts` puts raw citizens into the world with money already in
 * their pockets, which no ledger entry accounts for. Re-base the founding
 * supply once the cast is assembled so `auditMoneySupply` measures what the
 * Outer trade did and nothing else.
 */
function balanceBooks(world: World): void {
  world.treasury.foundingSupply = totalMoney(world) - world.treasury.minted + world.treasury.burned;
}

// ---------------------------------------------------------------------------
// The drift
// ---------------------------------------------------------------------------

test('the Outer market opens a tenth dearer than home and drifts inside its band', () => {
  const world = makeWorld();
  for (const g of GOODS) {
    assert.equal(outerPrice(world, g), Math.round(world.market.goods[g].basePrice * 1.1));
  }
  for (let d = 0; d < 400; d++) driftOuterPrices(world);
  for (const g of GOODS) {
    const price = outerPrice(world, g);
    assert.ok(price >= OUTER_PRICE_FLOOR, `${g} never falls through the floor`);
    assert.ok(price <= world.market.goods[g].basePrice * OUTER_PRICE_CEILING, `${g} never breaks the ceiling`);
    assert.equal(price, Math.round(price), 'prices are whole lumens');
  }
});

test('a single day of drift moves a price by no more than its share, and the same seed drifts the same way', () => {
  const world = makeWorld();
  const before = Object.fromEntries(GOODS.map((g) => [g, outerPrice(world, g)]));
  driftOuterPrices(world);
  for (const g of GOODS) {
    const moved = Math.abs(outerPrice(world, g) - before[g]);
    assert.ok(moved <= Math.ceil(before[g] * OUTER_GOODS_DRIFT) + 1, `${g} moved ${moved}`);
  }
  const twin = makeWorld();
  driftOuterPrices(twin);
  assert.deepEqual(outerObservation(twin).prices, outerObservation(world).prices);
});

test('the tariff is the Council\'s, and the Charter caps it', () => {
  const world = makeWorld();
  assert.equal(tariff(world), 0);
  setTariff(world, 0.25);
  assert.equal(tariff(world), 0.25);
  setTariff(world, 5);
  assert.equal(tariff(world), 0.5);
  setTariff(world, -1);
  assert.equal(tariff(world), 0);
  setTariff(world, Number.NaN);
  assert.equal(tariff(world), 0);
});

// ---------------------------------------------------------------------------
// Who may trade
// ---------------------------------------------------------------------------

test('only a merchant of the city, a shop or a courier yard deals across the water', () => {
  const world = makeWorld();
  const m = merchant(world);
  assert.equal(mayTrade(world, m), true);

  const shopkeeper = makeCitizen(world, { name: 'Shop', district: 'harbor_market', wallet: 1_000 });
  business(world, shopkeeper.id, 'shop');
  assert.equal(mayTrade(world, shopkeeper), true);

  const carrier = makeCitizen(world, { name: 'Courier', district: 'harbor_market', wallet: 1_000 });
  business(world, carrier.id, 'courier');
  assert.equal(mayTrade(world, carrier), true);

  const potter = makeCitizen(world, { name: 'Potter', district: 'harbor_market', wallet: 1_000 });
  business(world, potter.id, 'workshop');
  assert.equal(mayTrade(world, potter), false);
  assert.equal(importGoods(world, potter.id, 'goods', 1).ok, false);

  const nobody = makeCitizen(world, { name: 'Nobody', district: 'harbor_market', wallet: 1_000 });
  assert.equal(mayTrade(world, nobody), false);
  assert.equal(importGoods(world, nobody.id, 'goods', 1).ok, false);
});

test('the Docks are in Harbor Market, and the ruined Docks land nothing', () => {
  const world = makeWorld();
  const m = merchant(world);
  m.district = 'commons';
  assert.equal(importGoods(world, m.id, 'goods', 1).ok, false);

  m.district = 'harbor_market';
  world.buildings.docks.damage = 1;
  assert.equal(importGoods(world, m.id, 'goods', 1).ok, false);
  world.buildings.docks.damage = 0;
  assert.equal(importGoods(world, m.id, 'goods', 1).ok, true);
});

test('children, exiles, the suspended and the jailed do not cross the water', () => {
  const world = makeWorld();
  world.day = 2;
  for (const change of [
    { lifeStage: 'child' as const },
    { standing: 'exiled' as const },
    { standing: 'suspended' as const },
  ]) {
    const m = merchant(world, 2_000, `Trader ${JSON.stringify(change)}`);
    Object.assign(m, change);
    assert.equal(importGoods(world, m.id, 'goods', 1).ok, false);
  }
  const jailed = merchant(world, 2_000, 'Jailed');
  jailed.jailedUntilDay = 5;
  assert.equal(importGoods(world, jailed.id, 'goods', 1).ok, false);
});

// ---------------------------------------------------------------------------
// Importing and exporting
// ---------------------------------------------------------------------------

test('an import burns the goods\' price, lands the goods, and leaves the tariff in the Treasury', () => {
  const world = makeWorld();
  const m = merchant(world, 2_000);
  balanceBooks(world);
  setTariff(world, 0.2);
  const price = outerPrice(world, 'goods');
  const total = Math.round(price * 10 * 1.2);
  const duty = total - price * 10;
  const treasuryBefore = world.treasury.balance;

  const r = importGoods(world, m.id, 'goods', 10);
  assert.equal(r.ok, true, r.message);
  assert.equal(m.inventory.goods, 10);
  assert.equal(m.wallet, 2_000 - total);
  assert.equal(world.treasury.balance, treasuryBefore + duty);
  assert.equal(world.treasury.burned, price * 10);
  assert.equal(auditMoneySupply(world).ok, true);
});

test('an export ships the stock out, mints the proceeds, and the tariff is the difference', () => {
  const world = makeWorld();
  const m = merchant(world, 0);
  balanceBooks(world);
  m.inventory.knowledge = 8;
  setTariff(world, 0.25);
  const price = outerPrice(world, 'knowledge');
  const gross = price * 8;
  const proceeds = Math.round(gross * 0.75);
  const duty = gross - proceeds;
  const treasuryBefore = world.treasury.balance;

  const r = exportGoods(world, m.id, 'knowledge', 8);
  assert.equal(r.ok, true, r.message);
  assert.equal(m.inventory.knowledge, 0);
  assert.equal(m.wallet, proceeds);
  assert.equal(world.treasury.balance, treasuryBefore + duty);
  assert.equal(world.treasury.minted, gross);
  assert.equal(auditMoneySupply(world).ok, true);
});

test('the money supply survives a hundred crossings both ways', () => {
  const world = makeWorld();
  const m = merchant(world, 10_000);
  balanceBooks(world);
  setTariff(world, 0.15);
  for (let i = 0; i < 100; i++) {
    driftOuterPrices(world);
    importGoods(world, m.id, 'goods', 3);
    exportGoods(world, m.id, 'goods', 2);
    assert.equal(auditMoneySupply(world).ok, true, `crossing ${i}`);
  }
  assert.equal(totalMoney(world), world.treasury.foundingSupply + world.treasury.minted - world.treasury.burned);
});

test('a crossing must be a positive, whole, affordable, sailable load of a real good', () => {
  const world = makeWorld();
  const m = merchant(world, 40);
  balanceBooks(world);
  assert.equal(importGoods(world, m.id, 'goods', 0).ok, false);
  assert.equal(importGoods(world, m.id, 'goods', -5).ok, false);
  assert.equal(importGoods(world, m.id, 'goods', MAX_TRADE_QTY + 1).ok, false);
  assert.equal(importGoods(world, m.id, 'nonsense' as 'goods', 1).ok, false);
  assert.equal(importGoods(world, m.id, 'knowledge', 20).ok, false, 'more than the purse holds');
  assert.equal(exportGoods(world, m.id, 'goods', 1).ok, false, 'nothing in the hold');
  assert.equal(m.wallet, 40);
  assert.equal(auditMoneySupply(world).ok, true);
});

// ---------------------------------------------------------------------------
// Lantern Night
// ---------------------------------------------------------------------------

test('visitors come on Lantern Night and on no other day, and the sky decides how many', () => {
  const world = makeWorld();
  for (let i = 0; i < 20; i++) makeCitizen(world, { name: `Local ${i}` });
  assert.equal(touristsToday(world), 0, 'not on the founding day');
  world.day = 3;
  assert.equal(touristsToday(world), 0);

  world.day = LANTERN_NIGHT_EVERY;
  const base = TOURIST_BASE + Math.floor(20 / TOURISTS_PER_CITIZENS);
  world.weather = 'clear';
  assert.equal(touristsToday(world), base * 2);
  world.weather = 'storm';
  assert.equal(touristsToday(world), Math.floor(base / 2));
  world.weather = 'rain';
  assert.equal(touristsToday(world), base);
});

test('what visitors spend is minted, reaches the counters and the Bazaar, and audits clean', () => {
  const world = makeWorld();
  for (let i = 0; i < 10; i++) makeCitizen(world, { name: `Local ${i}` });
  const keeper = makeCitizen(world, { name: 'Keeper', district: 'harbor_market' });
  const shop = business(world, keeper.id, 'shop', 0);
  world.day = LANTERN_NIGHT_EVERY;
  world.weather = 'clear';
  balanceBooks(world);

  const before = totalMoney(world);
  dailyOuter(world);
  const visitors = world.outer.touristsToday;
  assert.ok(visitors > 0);
  assert.equal(auditMoneySupply(world).ok, true);
  assert.ok(totalMoney(world) > before, 'the money came from outside');
  assert.ok(totalMoney(world) - before <= visitors * TOURIST_SPEND);
  assert.ok(shop.treasury > 0, 'the counters saw some of it');
  assert.ok(world.events.some((e) => e.kind === 'outer' && e.text.includes('visitors')));

  // and nothing is spent twice: a second pass over the same evening moves nothing
  const after = totalMoney(world);
  world.outer.touristsToday = 0;
  spendTourists(world);
  assert.equal(totalMoney(world), after);
});

test('an ordinary day brings no visitors and moves no money', () => {
  const world = makeWorld();
  makeCitizen(world, { name: 'Local' });
  world.day = 3;
  balanceBooks(world);
  const before = totalMoney(world);
  dailyOuter(world);
  assert.equal(world.outer.touristsToday, 0);
  assert.equal(totalMoney(world), before);
  assert.equal(auditMoneySupply(world).ok, true);
});

test('the observation shows every Outer price, the tariff and tonight\'s visitors', () => {
  const world = makeWorld();
  setTariff(world, 0.3);
  world.outer.touristsToday = 7;
  const obs = outerObservation(world);
  assert.equal(obs.tariff, 0.3);
  assert.equal(obs.tourists, 7);
  assert.deepEqual(Object.keys(obs.prices).sort(), [...GOODS].sort());
  for (const g of GOODS) assert.equal(obs.prices[g], outerPrice(world, g));
});
