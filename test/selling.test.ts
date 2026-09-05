/**
 * Selling up (src/markets/selling.ts).
 *
 * `docs/MOBILITY.md` §2: a deed on the board at your own price, a business
 * sold as a going concern with its staff, and the fire sale that gets you out
 * in a day and costs you a quarter of your life's work. Money is conserved at
 * every step: nothing in this file mints or burns a lumen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Business, Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { BUSINESS_RENT } from '../src/data/jobs.ts';
import { PRODUCTS } from '../src/data/catalogue.ts';
import {
  FIRE_SALE_MAX, FIRE_SALE_MIN, businessAsk, businessValue, businessesForSale, buyBusiness,
  fireSaleShare, liquidValue, liquidate, listProperty, sellBusiness, stockValue,
} from '../src/markets/selling.ts';
import {
  allUnits, buyProperty, marketPrice, syncProperty, unitPrice, unitsFor, unitsOnSale,
} from '../src/markets/property.ts';

function trader(world: World, wallet = 20_000, name = 'Ash'): Citizen {
  return makeCitizen(world, { name, district: 'harbor_market', wallet });
}

function business(world: World, ownerId: string, treasury = 1_000): Business {
  const id = `b_${Object.keys(world.businesses).length + 1}`;
  const b: Business = {
    id, name: 'Quay Provisions', kind: 'shop', ownerId, treasury, district: 'harbor_market',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: BUSINESS_RENT.shop, daysNegative: 0,
    revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[id] = b;
  world.citizens[ownerId].businessId = id;
  return b;
}

function homesIn(world: World, buildingId: string) {
  return allUnits(world).filter((u) => u.buildingId === buildingId && u.kind === 'home');
}

// ---------------------------------------------------------------------------
// Listing a property
// ---------------------------------------------------------------------------

test('a listing puts a deed on the board at the owner\'s price, and takes it off again', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const unit = homesIn(world, 'lantern_lofts')[0];
  buyProperty(world, owner.id, unit.id);
  const worth = marketPrice(world, unit);

  assert.equal(listProperty(world, owner.id, unit.id, worth * 2).ok, true);
  assert.equal(unitPrice(world, unit), worth * 2, 'a buyer pays what the owner is asking');
  assert.ok(unitsOnSale(world).some((u) => u.id === unit.id));
  assert.ok(world.events.some((e) => e.text.includes('on the market')));

  assert.equal(listProperty(world, owner.id, unit.id, 0).ok, true);
  assert.equal(unitPrice(world, unit), worth, 'and off the board it is worth what it is worth');
  assert.equal(listProperty(world, owner.id, unit.id, 0).ok, false, 'twice is not a listing');
});

test('a listed home sells over nobody\'s head: the tenancy goes with the deed', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const buyer = trader(world, 20_000, 'Bram');
  const unit = homesIn(world, 'terraces')[0];
  buyProperty(world, owner.id, unit.id);
  const tenant = makeCitizen(world, { name: 'Ondine', homeTier: 2 });
  unit.tenantId = tenant.id;
  assert.equal(unitsOnSale(world).some((u) => u.id === unit.id), false, 'a home somebody lives in is not idle stock');

  assert.equal(listProperty(world, owner.id, unit.id, 3_000).ok, true);
  const before = totalMoney(world);
  assert.equal(buyProperty(world, buyer.id, unit.id).ok, true);
  assert.equal(unit.ownerId, buyer.id);
  assert.equal(unit.tenantId, tenant.id, 'the tenant stays put');
  assert.equal(tenant.homeTier, 2);
  assert.equal(owner.wallet, 20_000 - marketPrice(world, unit) + 3_000);
  assert.equal(totalMoney(world), before);
  assert.equal(businessAsk(world, unit.id), null);
});

test('the board refuses a listing that is not yours, or one below the floor', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const stranger = trader(world, 500, 'Stranger');
  const unit = homesIn(world, 'lantern_lofts')[0];
  buyProperty(world, owner.id, unit.id);
  assert.equal(listProperty(world, stranger.id, unit.id, 900).ok, false);
  assert.equal(listProperty(world, owner.id, 'y_nope', 900).ok, false);
  assert.equal(listProperty(world, owner.id, unit.id, 5).ok, false);
  const child = makeCitizen(world, { name: 'Small', lifeStage: 'child' });
  assert.equal(listProperty(world, child.id, unit.id, 900).ok, false);
});

// ---------------------------------------------------------------------------
// Selling a business as a going concern
// ---------------------------------------------------------------------------

test('a concern is worth its till, its stock and what it has been making', () => {
  const world = makeWorld();
  const owner = trader(world, 500);
  const biz = business(world, owner.id, 700);
  biz.inventory.goods = 10;
  assert.ok(stockValue(world, biz) > 0);
  const value = businessValue(world, biz);
  assert.ok(value > 700 + stockValue(world, biz), 'and a few days of the pitch it trades from');

  world.counters[`shprofit:${biz.id}:0`] = 120;
  assert.ok(businessValue(world, biz) > value, 'a business that is making money is worth more');
});

test('a business sold as a going concern keeps its staff, its name and its premises', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world, 500);
  const buyer = trader(world, 5_000, 'Bram');
  const biz = business(world, owner.id, 700);
  const hand = makeCitizen(world, { name: 'Hand' });
  biz.employees.push(hand.id);

  assert.equal(sellBusiness(world, owner.id, 1_500).ok, true);
  assert.equal(businessAsk(world, biz.id), 1_500);
  assert.deepEqual(businessesForSale(world).map((r) => r.business.id), [biz.id]);
  assert.ok(hand.memory.some((m) => m.text.includes('up for sale')), 'the staff are told');

  const before = totalMoney(world);
  const r = buyBusiness(world, buyer.id, biz.id);
  assert.equal(r.ok, true, r.message);
  assert.equal(biz.ownerId, buyer.id);
  assert.equal(buyer.businessId, biz.id);
  assert.equal(owner.businessId, null);
  assert.deepEqual(biz.employees, [hand.id], 'the staff keep their jobs');
  assert.equal(biz.name, 'Quay Provisions', 'and the name goes with it');
  assert.equal(biz.treasury, 700, 'the till is part of what was bought');
  assert.equal(buyer.wallet, 5_000 - 1_500);
  assert.equal(owner.wallet, 500 + 1_500);
  assert.equal(totalMoney(world), before);
  assert.equal(businessAsk(world, biz.id), null, 'and it is off the board');
});

test('the Exchange refuses a buyer who already trades, is short, is elsewhere, or was never offered it', () => {
  const world = makeWorld();
  const owner = trader(world, 500);
  const biz = business(world, owner.id, 700);
  const buyer = trader(world, 5_000, 'Bram');

  assert.equal(buyBusiness(world, buyer.id, biz.id).ok, false, 'nothing is for sale yet');
  sellBusiness(world, owner.id, 1_500);
  assert.equal(buyBusiness(world, owner.id, biz.id).ok, false, 'you cannot buy your own');

  const own = business(world, buyer.id, 100);
  assert.equal(buyBusiness(world, buyer.id, biz.id).ok, false, 'one business at a time');
  own.dissolvedDay = 1;
  buyer.businessId = null;

  buyer.district = 'commons';
  assert.equal(buyBusiness(world, buyer.id, biz.id).ok, false, 'a concern changes hands at the Exchange');
  buyer.district = 'harbor_market';

  buyer.wallet = 10;
  assert.equal(buyBusiness(world, buyer.id, biz.id).ok, false, 'and it has to be paid for');
  assert.equal(biz.ownerId, owner.id);
});

test('an owner may take the offer back, and cannot sell what they do not own', () => {
  const world = makeWorld();
  const owner = trader(world, 500);
  const biz = business(world, owner.id, 700);
  assert.equal(sellBusiness(world, owner.id, 0).ok, false, 'it was never on the board');
  assert.equal(sellBusiness(world, owner.id, 900).ok, true);
  assert.equal(sellBusiness(world, owner.id, 0).ok, true);
  assert.equal(businessAsk(world, biz.id), null);

  const nobody = trader(world, 100, 'Nobody');
  assert.equal(sellBusiness(world, nobody.id, 900).ok, false);
});

// ---------------------------------------------------------------------------
// The fire sale
// ---------------------------------------------------------------------------

test('a fire sale pays 60 % to a novice and 75 % to a master of commerce', () => {
  const world = makeWorld();
  const novice = makeCitizen(world, { name: 'Novice', skills: { crafting: 0, analysis: 0, rhetoric: 0, care: 0, commerce: 0, artistry: 0 } });
  const master = makeCitizen(world, { name: 'Master', skills: { crafting: 0, analysis: 0, rhetoric: 0, care: 0, commerce: 100, artistry: 0 } });
  assert.equal(fireSaleShare(novice), FIRE_SALE_MIN);
  assert.equal(fireSaleShare(master), FIRE_SALE_MAX);
  const middling = makeCitizen(world, { name: 'Middling', skills: { crafting: 0, analysis: 0, rhetoric: 0, care: 0, commerce: 50, artistry: 0 } });
  assert.ok(Math.abs(fireSaleShare(middling) - 0.675) < 1e-9);
});

test('liquidate sells deeds, the concern, the stock and the shelf at once, and conserves money', () => {
  const world = makeWorld();
  syncProperty(world);
  const seller = trader(world, 20_000, 'Seller');
  seller.skills.commerce = 50;
  const first = homesIn(world, 'lantern_lofts')[0];
  const second = homesIn(world, 'terraces')[0];
  buyProperty(world, seller.id, first.id);
  buyProperty(world, seller.id, second.id);
  const biz = business(world, seller.id, 800);
  seller.inventory.goods = 4;
  const productId = Object.keys(PRODUCTS)[0];
  seller.possessions.push({ id: 'i_1', productId, acquiredDay: 0 });

  const share = fireSaleShare(seller);
  const expectedUnits = unitsFor(world, seller.id).reduce((sum, u) => sum + Math.round(marketPrice(world, u) * share), 0);
  const expectedBusiness = Math.round(businessValue(world, biz) * share);
  assert.ok(liquidValue(world, seller) > 0);

  const before = totalMoney(world);
  const wallet = seller.wallet;
  const r = liquidate(world, seller.id);
  assert.equal(r.ok, true, r.message);
  assert.equal(totalMoney(world), before, 'a fire sale moves money, it does not make it');
  assert.deepEqual(unitsFor(world, seller.id), [], "the deeds are the city's");
  assert.equal(first.ownerId, 'city');
  assert.equal(biz.dissolvedDay, world.day, 'the concern is wound up');
  assert.equal(seller.businessId, null);
  assert.equal(seller.possessions.length, 0, 'and the things on the shelf are sold');
  assert.equal(seller.inventory.goods, 0);
  assert.ok(seller.wallet > wallet + expectedUnits + expectedBusiness - 1);
  assert.ok(world.events.some((e) => e.text.includes('sold up at the Exchange')));

  assert.equal(liquidate(world, seller.id).ok, false, 'and it takes a day');
});

test('a fire sale is worse than patience: the same estate sold at leisure is worth more', () => {
  const world = makeWorld();
  syncProperty(world);
  const hasty = trader(world, 20_000, 'Hasty');
  const patient = trader(world, 20_000, 'Patient');
  hasty.skills.commerce = 50;
  const a = homesIn(world, 'skyline_villas')[0];
  const b = homesIn(world, 'skyline_villas')[1];
  buyProperty(world, hasty.id, a.id);
  buyProperty(world, patient.id, b.id);
  const market = marketPrice(world, a);

  const hastyBefore = hasty.wallet;
  liquidate(world, hasty.id);
  const raised = hasty.wallet - hastyBefore;
  assert.ok(raised < market, `a fire sale (${raised}) is worth less than the market (${market})`);
  assert.ok(raised >= Math.round(market * FIRE_SALE_MIN));

  // the patient one lists at the market price and waits for a buyer
  assert.equal(listProperty(world, patient.id, b.id, market).ok, true);
  const buyer = trader(world, 20_000, 'Buyer');
  const patientBefore = patient.wallet;
  assert.equal(buyProperty(world, buyer.id, b.id).ok, true);
  assert.equal(patient.wallet - patientBefore, market);
  assert.ok(patient.wallet - patientBefore > raised, 'patience is worth real money');
});

test('there is nothing to liquidate when you own nothing, and the cells hold no sales', () => {
  const world = makeWorld();
  const pauper = trader(world, 30, 'Pauper');
  pauper.inventory.goods = 0;
  assert.equal(liquidate(world, pauper.id).ok, false);

  const jailed = trader(world, 500, 'Jailed');
  jailed.jailedUntilDay = world.day + 3;
  assert.equal(liquidate(world, jailed.id).ok, false);
  assert.equal(sellBusiness(world, jailed.id, 100).ok, false);

  const away = makeCitizen(world, { name: 'Away', district: 'commons', wallet: 500 });
  assert.equal(liquidate(world, away.id).ok, false, 'a fire sale is held at the Exchange');
});
