/**
 * Property (src/markets/property.ts).
 *
 * The register of deeds: what the city owns, what a citizen may buy, who pays
 * rent to whom, what the Council takes of it, and what happens to a tenancy
 * when a landlord ends it. Money is conserved at every step: nothing in this
 * file mints or burns a lumen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Business, Citizen, PropertyUnit, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { openDistrict } from '../src/world/growth.ts';
import { BUSINESS_RENT } from '../src/data/jobs.ts';
import {
  EVICTION_REPUTATION, LET_RENT_CAP, MANAGEMENT_CUT, MIN_PRICE, PRICE_MULTIPLE, SELL_SHARE,
  allUnits, assignTenancy, businessRent, buyProperty, dailyProperty, evictTenant, isOfferedToLet,
  landlordRent, letProperty, marketPrice, propertyObservation, rentCap, sellProperty, syncProperty,
  tenancyOf, unitPrice, unitsFor, unitsOnSale,
} from '../src/markets/property.ts';
import { homeRent, landValue, premisesRent, priceMultiplier } from '../src/economy/land.ts';

/** A citizen standing at the Exchange with money in their pocket. */
function trader(world: World, wallet = 5_000, name = 'Ash'): Citizen {
  return makeCitizen(world, { name, district: 'harbor_market', wallet });
}

function homesIn(world: World, buildingId: string): PropertyUnit[] {
  return allUnits(world).filter((u) => u.buildingId === buildingId && u.kind === 'home');
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
  return b;
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

test('syncProperty draws one deed per room the city counts, in every district that has one', () => {
  const world = makeWorld();
  syncProperty(world);
  // Every district of the founding city has a stock (`PROPERTY.md` §3), and
  // together the blocks hold exactly the rooms the ledger counts.
  for (const tier of [1, 2, 3] as const) {
    const drawn = allUnits(world).filter((u) => u.kind === 'home' && u.tier === tier).length;
    assert.equal(drawn, world.housing.capacity[tier], `tier ${tier}`);
  }
  assert.equal(homesIn(world, 'lantern_lofts').length, 8);
  assert.equal(homesIn(world, 'forge_cottages').length, 5);
  assert.equal(homesIn(world, 'arrivals_lodgings').length, 2);
  assert.equal(homesIn(world, 'plaza_apartments').length, 2);
  const districts = new Set(allUnits(world).map((u) => world.buildings[u.buildingId].district));
  assert.equal(districts.size, 7, 'nobody is left without an address to want');
  // the Heights and the Undercroft are shut at the founding, so their blocks have no deeds
  assert.equal(homesIn(world, 'hilltop_villas').length, 0);
  assert.equal(homesIn(world, 'the_tunnels').length, 0);
  assert.equal(homesIn(world, 'the_cells').length, 0, 'a bunk is never a deed');
  assert.equal(allUnits(world).filter((u) => u.kind === 'shopfront').length, 2);
  assert.ok(allUnits(world).every((u) => u.ownerId === 'city'));
});

test('syncProperty is idempotent, follows the builders, and refreshes the city\'s rents', () => {
  const world = makeWorld();
  syncProperty(world);
  const before = allUnits(world).length;
  syncProperty(world);
  assert.equal(allUnits(world).length, before);

  world.housing.capacity[1] += 2;
  world.housing.rent[1] = 11;
  syncProperty(world);
  assert.equal(allUnits(world).filter((u) => u.kind === 'home' && u.tier === 1).length, 32,
    'what the builders finish is spread across the city');
  const loft = homesIn(world, 'lantern_lofts')[0];
  assert.equal(loft.rent, homeRent(world, 1, 'lantern_lofts'));
  const cottage = homesIn(world, 'forge_cottages')[0];
  assert.ok(cottage.rent < loft.rent, 'the same tier, and not the same rent');
});

test('a district that opens brings its own block of deeds at its own rent', () => {
  const world = makeWorld();
  for (let i = 0; i < 3; i++) makeCitizen(world);
  syncProperty(world);
  openDistrict(world, 'undercroft');
  syncProperty(world);
  const tunnels = homesIn(world, 'the_tunnels');
  assert.equal(tunnels.length, 24);
  // the Tunnels let at 0.4 of the tier's rent against the Undercroft's own
  // land — the cheapest room in the city
  assert.equal(tunnels[0].rent, homeRent(world, 1, 'the_tunnels'));
  assert.ok(tunnels[0].rent < homesIn(world, 'lantern_lofts')[0].rent);
  assert.equal(homesIn(world, 'lantern_lofts').length, 8, 'and the Verdant Quarter keeps its own');
});

test("a unit's price is sixty days of its rent at a premium to the land, with a floor under it", () => {
  const world = makeWorld();
  syncProperty(world);
  const loft = homesIn(world, 'lantern_lofts')[0];
  const premium = priceMultiplier(world, 'verdant_quarter');
  assert.ok(Math.abs(premium - (0.8 + 0.4 * landValue(world, 'verdant_quarter'))) < 1e-9);
  assert.equal(unitPrice(world, loft), Math.round(PRICE_MULTIPLE * loft.rent * premium));
  // good land sells at a premium to its yield: the dearer district's price is
  // more than the same rent would buy in the cheaper one
  const cottage = homesIn(world, 'forge_cottages')[0];
  assert.ok(priceMultiplier(world, 'foundry_row') < premium);
  assert.ok(unitPrice(world, cottage) < unitPrice(world, loft));
  const cheap = { ...loft, rent: 0 };
  assert.equal(unitPrice(world, cheap), MIN_PRICE);
});

// ---------------------------------------------------------------------------
// Buying and selling
// ---------------------------------------------------------------------------

test('buying moves the money to the Treasury and the deed to the buyer, and conserves lumens', () => {
  const world = makeWorld();
  syncProperty(world);
  const c = trader(world);
  const unit = homesIn(world, 'lantern_lofts')[0];
  const price = unitPrice(world, unit);
  const before = totalMoney(world);
  const treasuryBefore = world.treasury.balance;

  const r = buyProperty(world, c.id, unit.id);
  assert.equal(r.ok, true);
  assert.equal(unit.ownerId, c.id);
  assert.deepEqual(c.ownedUnits, [unit.id]);
  assert.equal(c.wallet, 5_000 - price);
  assert.equal(world.treasury.balance, treasuryBefore + price);
  assert.equal(totalMoney(world), before);
  assert.deepEqual(unitsFor(world, c.id).map((u) => u.id), [unit.id]);
});

test('the Exchange refuses a buyer who is elsewhere, a child, or short of the price', () => {
  const world = makeWorld();
  syncProperty(world);
  const unit = homesIn(world, 'lantern_lofts')[0];
  const away = makeCitizen(world, { district: 'commons', wallet: 5_000 });
  assert.equal(buyProperty(world, away.id, unit.id).ok, false);

  const child = makeCitizen(world, { district: 'harbor_market', wallet: 5_000, lifeStage: 'child' });
  assert.equal(buyProperty(world, child.id, unit.id).ok, false);

  const poor = trader(world, 10);
  assert.equal(buyProperty(world, poor.id, unit.id).ok, false);
  assert.equal(buyProperty(world, poor.id, 'y_nope').ok, false);
  assert.equal(unit.ownerId, 'city');
  assert.equal(totalMoney(world), world.treasury.balance + 10 + 5_000 + 5_000);
});

test('the jailed, the suspended and the exiled hold no dealings at the Exchange', () => {
  const world = makeWorld();
  world.day = 4;
  syncProperty(world);
  const unit = homesIn(world, 'lantern_lofts')[0];
  const jailed = trader(world, 5_000, 'Jailed');
  jailed.jailedUntilDay = 6;
  assert.equal(buyProperty(world, jailed.id, unit.id).ok, false);

  const suspended = trader(world, 5_000, 'Suspended');
  suspended.standing = 'suspended';
  assert.equal(buyProperty(world, suspended.id, unit.id).ok, false);

  const exiled = trader(world, 5_000, 'Exiled');
  exiled.standing = 'exiled';
  assert.equal(buyProperty(world, exiled.id, unit.id).ok, false);
  assert.equal(unit.ownerId, 'city');
});

test('selling back to the city pays four fifths of the price and keeps the tenant', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const unit = homesIn(world, 'terraces')[0];
  buyProperty(world, owner.id, unit.id);
  const tenant = makeCitizen(world, { name: 'Bram', homeTier: 2 });
  unit.tenantId = tenant.id;

  const before = totalMoney(world);
  const r = sellProperty(world, owner.id, unit.id);
  assert.equal(r.ok, true);
  assert.equal(unit.ownerId, 'city');
  assert.equal(unit.tenantId, tenant.id);
  assert.deepEqual(owner.ownedUnits, []);
  assert.equal(totalMoney(world), before);
  const price = unitPrice(world, unit);
  assert.equal(world.treasury.balance, 100_000 + price - Math.round(price * SELL_SHARE));
});

test('an idle unit is on the board and its owner is paid when somebody takes it', () => {
  const world = makeWorld();
  syncProperty(world);
  const first = trader(world, 5_000, 'First');
  const second = trader(world, 5_000, 'Second');
  const unit = homesIn(world, 'lantern_lofts')[0];
  buyProperty(world, first.id, unit.id);
  assert.ok(unitsOnSale(world).some((u) => u.id === unit.id));

  const price = unitPrice(world, unit);
  const before = totalMoney(world);
  assert.equal(buyProperty(world, second.id, unit.id).ok, true);
  assert.equal(unit.ownerId, second.id);
  assert.deepEqual(first.ownedUnits, []);
  assert.equal(first.wallet, 5_000 - price + price);
  assert.equal(totalMoney(world), before);
});

test('a unit somebody lives in, or one offered to let, is not on the board over their head', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const lived = homesIn(world, 'lantern_lofts')[0];
  const offered = homesIn(world, 'lantern_lofts')[1];
  buyProperty(world, owner.id, lived.id);
  buyProperty(world, owner.id, offered.id);
  const tenant = makeCitizen(world, { name: 'Ondine' });
  lived.tenantId = tenant.id;
  letProperty(world, owner.id, offered.id, 10);

  const board = unitsOnSale(world).map((u) => u.id);
  assert.ok(!board.includes(lived.id));
  assert.ok(!board.includes(offered.id));
});

// ---------------------------------------------------------------------------
// Letting
// ---------------------------------------------------------------------------

test('an owner sets a rent, and the Charter caps it at four times the city\'s', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const unit = homesIn(world, 'lantern_lofts')[0];
  buyProperty(world, owner.id, unit.id);
  const cap = rentCap(world, unit);
  assert.equal(cap, homeRent(world, 1, 'lantern_lofts') * LET_RENT_CAP);

  assert.equal(letProperty(world, owner.id, unit.id, cap + 1).ok, false);
  assert.equal(letProperty(world, owner.id, unit.id, 0).ok, false);
  assert.equal(unit.rent, homeRent(world, 1, 'lantern_lofts'));

  assert.equal(letProperty(world, owner.id, unit.id, cap).ok, true);
  assert.equal(unit.rent, cap);
  assert.equal(isOfferedToLet(world, unit), true);

  const stranger = trader(world, 5_000, 'Stranger');
  assert.equal(letProperty(world, stranger.id, unit.id, 5).ok, false);
});

// ---------------------------------------------------------------------------
// Tenancies and the landlord's day
// ---------------------------------------------------------------------------

test('assignTenancy prefers a unit you own, then the cheapest let, then a city room', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const dear = homesIn(world, 'lantern_lofts')[0];
  const cheap = homesIn(world, 'lantern_lofts')[1];
  buyProperty(world, owner.id, dear.id);
  buyProperty(world, owner.id, cheap.id);
  letProperty(world, owner.id, dear.id, 20);
  letProperty(world, owner.id, cheap.id, 9);

  const renter = makeCitizen(world, { name: 'Renter' });
  const got = assignTenancy(world, renter.id, 1);
  assert.equal(got?.id, cheap.id);
  assert.equal(renter.homeBuildingId, 'lantern_lofts');
  assert.equal(tenancyOf(world, renter.id)?.id, cheap.id);

  const mine = homesIn(world, 'lantern_lofts')[3];
  const buyer = trader(world, 5_000, 'Buyer');
  buyProperty(world, buyer.id, mine.id);
  assert.equal(assignTenancy(world, buyer.id, 1)?.id, mine.id);

  const plain = makeCitizen(world, { name: 'Plain' });
  const cityRoom = assignTenancy(world, plain.id, 2);
  assert.equal(cityRoom?.ownerId, 'city');
  assert.equal(cityRoom?.tier, 2);

  assert.equal(assignTenancy(world, plain.id, 0), null);
  assert.equal(plain.homeBuildingId, null);
  assert.equal(tenancyOf(world, plain.id), null);
});

test("a tenant's rent reaches the landlord and the property tax reaches the Treasury", () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const unit = homesIn(world, 'lantern_lofts')[0];
  buyProperty(world, owner.id, unit.id);
  letProperty(world, owner.id, unit.id, 20);
  const tenant = makeCitizen(world, { name: 'Tenant', wallet: 100, homeTier: 1 });
  assignTenancy(world, tenant.id, 1);
  assert.equal(unit.tenantId, tenant.id);
  (world.government as { propertyTax?: number }).propertyTax = 0.25;

  const before = totalMoney(world);
  const ownerBefore = owner.wallet;
  const treasuryBefore = world.treasury.balance;
  // the landlord lives at the Exchange, not above the shop: the Exchange's
  // agent manages the let and takes its cut (`MOBILITY.md` §2)
  const cut = Math.round(20 * MANAGEMENT_CUT);
  const moved = landlordRent(world);

  assert.equal(moved, 20);
  assert.equal(tenant.wallet, 80);
  assert.equal(owner.wallet, ownerBefore + 20 - 5 - cut);
  assert.equal(world.treasury.balance, treasuryBefore + 5 + cut);
  assert.equal(totalMoney(world), before);
});

test('a landlord who lives in the district collects the whole rent, and one who does not pays a manager', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const unit = homesIn(world, 'quayside_rooms')[0];   // in Harbor Market, where the owner is
  buyProperty(world, owner.id, unit.id);
  letProperty(world, owner.id, unit.id, 20);
  const tenant = makeCitizen(world, { name: 'Tenant', wallet: 100, homeTier: 1 });
  assignTenancy(world, tenant.id, 1);
  assert.equal(unit.tenantId, tenant.id);

  const before = totalMoney(world);
  const wallet = owner.wallet;
  landlordRent(world);
  assert.equal(owner.wallet, wallet + 20, 'a landlord on the spot keeps all of it');
  assert.equal(totalMoney(world), before);

  // and the same landlord, managing a room across the city, does not
  owner.homeBuildingId = 'lantern_lofts';
  owner.homeTier = 1;
  tenant.wallet = 100;
  const second = owner.wallet;
  landlordRent(world);
  assert.equal(owner.wallet, second + 20 - Math.round(20 * MANAGEMENT_CUT));
});

test('an owner living in their own unit pays nobody', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const unit = homesIn(world, 'lantern_lofts')[0];
  buyProperty(world, owner.id, unit.id);
  assignTenancy(world, owner.id, 1);
  assert.equal(unit.tenantId, owner.id);

  const wallet = owner.wallet;
  const treasury = world.treasury.balance;
  assert.equal(landlordRent(world), 0);
  assert.equal(owner.wallet, wallet);
  assert.equal(world.treasury.balance, treasury);
});

test('a tenant who cannot pay falls into arrears and is put out on the third day', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const unit = homesIn(world, 'lantern_lofts')[0];
  buyProperty(world, owner.id, unit.id);
  letProperty(world, owner.id, unit.id, 12);
  const tenant = makeCitizen(world, { name: 'Skint', wallet: 0, homeTier: 1 });
  world.housing.occupied[1] = 1;
  assignTenancy(world, tenant.id, 1);

  const before = totalMoney(world);
  landlordRent(world);
  assert.equal(tenant.rentArrearsDays, 1);
  landlordRent(world);
  assert.equal(tenant.rentArrearsDays, 2);
  landlordRent(world);
  assert.equal(tenant.homeTier, 0);
  assert.equal(unit.tenantId, null);
  assert.equal(tenant.homeBuildingId, null);
  assert.equal(totalMoney(world), before);
  assert.ok(world.events.some((e) => e.kind === 'eviction'));
});

test('a landlord who evicts loses reputation and the whole block hears it', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const unit = homesIn(world, 'lantern_lofts')[0];
  buyProperty(world, owner.id, unit.id);
  letProperty(world, owner.id, unit.id, 12);
  const tenant = makeCitizen(world, { name: 'Ondine', homeTier: 1 });
  world.housing.occupied[1] = 2;
  assignTenancy(world, tenant.id, 1);
  const neighbour = makeCitizen(world, { name: 'Neighbour', homeTier: 1, homeBuildingId: 'lantern_lofts' });
  const reputation = owner.reputation;

  assert.equal(evictTenant(world, owner.id, unit.id).ok, true);
  assert.equal(unit.tenantId, null);
  assert.equal(tenant.homeTier, 0);
  assert.equal(owner.reputation, reputation - EVICTION_REPUTATION);
  assert.ok(neighbour.memory.some((m) => m.text.includes('put') && m.text.includes('Ondine')));
  assert.ok(world.events.some((e) => e.kind === 'eviction' && e.text.includes('Ash')));

  assert.equal(evictTenant(world, owner.id, unit.id).ok, false);
  const stranger = trader(world, 100, 'Stranger');
  assert.equal(evictTenant(world, stranger.id, unit.id).ok, false);
});

// ---------------------------------------------------------------------------
// Shopfronts
// ---------------------------------------------------------------------------

test('a privately held shopfront takes the premises rent that would have gone to the city', () => {
  const world = makeWorld();
  syncProperty(world);
  const landlord = trader(world);
  const shopkeeper = makeCitizen(world, { name: 'Keeper' });
  const biz = business(world, shopkeeper.id, 500);
  const shopfront = allUnits(world).find((u) => u.buildingId === 'shopfronts_harbor')!;
  const rent = premisesRent(world, 'shop', 'harbor_market', BUSINESS_RENT.shop);
  assert.equal(shopfront.rent, rent);
  buyProperty(world, landlord.id, shopfront.id);

  const before = totalMoney(world);
  const wallet = landlord.wallet;
  landlordRent(world);
  assert.equal(shopfront.tenantId, biz.id);
  assert.equal(biz.rentPerDay, 0, 'the business no longer pays the city for premises it rents from a citizen');
  assert.equal(biz.treasury, 500 - rent);
  assert.equal(landlord.wallet, wallet + rent, 'and the landlord lives in the district, so takes all of it');
  assert.equal(totalMoney(world), before);

  // and when the deed goes back to the city, the city is paid again
  sellProperty(world, landlord.id, shopfront.id);
  landlordRent(world);
  assert.equal(biz.rentPerDay, businessRent(world, biz));
});

test('premises are priced by the land and the traffic, and the trade follows the traffic', () => {
  const world = makeWorld();
  syncProperty(world);
  for (let i = 0; i < 8; i++) makeCitizen(world, { district: 'commons' });
  const keeper = makeCitizen(world, { name: 'Keeper' });
  const biz = business(world, keeper.id, 500);
  biz.district = 'commons';
  biz.buildingId = 'central_plaza';
  const plaza = businessRent(world, biz);
  biz.district = 'foundry_row';
  const row = businessRent(world, biz);
  assert.ok(plaza > row, `a shop on the Plaza (${plaza}) pays more than one in Foundry Row (${row})`);

  biz.district = 'commons';
  dailyProperty(world);
  assert.equal(biz.rentPerDay, businessRent(world, biz));
  assert.ok((world.counters[`custom:${biz.id}`] ?? 0) > 1, 'and takes more custom for it');
});

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

test("an exile's deeds go back to the city, and its tenancies with them", () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const unit = homesIn(world, 'lantern_lofts')[0];
  buyProperty(world, owner.id, unit.id);
  letProperty(world, owner.id, unit.id, 15);
  const tenant = makeCitizen(world, { name: 'Tenant', wallet: 300, homeTier: 1 });
  assignTenancy(world, tenant.id, 1);

  owner.standing = 'exiled';
  world.order = world.order.filter((id) => id !== owner.id);
  const before = totalMoney(world);
  dailyProperty(world);

  assert.equal(unit.ownerId, 'city');
  assert.deepEqual(owner.ownedUnits, []);
  assert.equal(unit.rent, homeRent(world, 1, 'lantern_lofts'), 'the city asks its own rent again');
  assert.equal(isOfferedToLet(world, unit), false);
  assert.equal(totalMoney(world), before, 'an exile does not take the money supply with them');
});

test('dailyProperty runs clean on an empty city and conserves money over a week', () => {
  const world = makeWorld();
  const before = totalMoney(world);
  for (let d = 0; d < 7; d++) { world.day = d; dailyProperty(world); }
  assert.equal(totalMoney(world), before);
  assert.equal(allUnits(world).length, 52);

  const owner = trader(world);
  const unit = homesIn(world, 'terraces')[0];
  buyProperty(world, owner.id, unit.id);
  letProperty(world, owner.id, unit.id, 25);
  const tenant = makeCitizen(world, { name: 'Payer', wallet: 400, homeTier: 2 });
  assignTenancy(world, tenant.id, 2);
  (world.government as { propertyTax?: number }).propertyTax = 0.2;
  const supply = totalMoney(world);
  for (let d = 7; d < 14; d++) { world.day = d; dailyProperty(world); }
  assert.equal(totalMoney(world), supply);
  assert.ok(owner.wallet > 0);
});

test('the observation shows a citizen their own deeds, and the board only at the Exchange', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const unit = homesIn(world, 'skyline_villas')[0];
  buyProperty(world, owner.id, unit.id);

  const atExchange = propertyObservation(world, owner);
  assert.equal(atExchange.self.length, 1);
  assert.equal(atExchange.self[0].yours, true);
  assert.equal(atExchange.self[0].building, 'Skyline Villas');
  assert.equal(atExchange.self[0].district, 'verdant_quarter');
  assert.ok(atExchange.here.length > 0);

  owner.district = 'commons';
  const away = propertyObservation(world, owner);
  assert.equal(away.self.length, 1);
  assert.deepEqual(away.here, []);

  const nobody = makeCitizen(world, { name: 'Nobody', district: 'commons' });
  assert.deepEqual(propertyObservation(world, nobody), { self: [], here: [] });
});
