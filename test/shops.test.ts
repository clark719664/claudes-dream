import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Business, Household, Job, World } from '../src/types.ts';
import { EMPORIUM_FOUNDING_STOCK, MAX_POSSESSIONS, PRODUCTS, PRODUCT_IDS } from '../src/data/catalogue.ts';
import { nextId } from '../src/util/ids.ts';
import {
  CRAFT_MARKUP, CRAFT_UNDERCUT, EMPORIUM_ID, EMPORIUM_MAX_STOCK, EMPORIUM_NAME, buyItem, craftProduct, dailyPossessions,
  defaultShelfPrice, emporiumPrice, giftItem, initEmporium, materialCost,
  restockEmporium, sellersOf, setPrice, shopsIn, useItem, workplaceOf,
} from '../src/society/shops.ts';

function addBusiness(w: World, ownerId: string, overrides: Partial<Business> = {}): Business {
  const id = nextId(w, 'b');
  const b: Business = {
    id, name: 'Copper Works', kind: 'workshop', ownerId, treasury: 100, district: 'harbor_market', buildingId: 'shopfronts_harbor',
    employees: [], jobs: [], inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 }, foundedDay: w.day,
    rentPerDay: 15, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {}, ...overrides,
  };
  w.businesses[id] = b;
  w.citizens[ownerId].businessId = id;
  return b;
}

function addJob(w: World, biz: Business, holderId: string): Job {
  const id = nextId(w, 'j');
  const job: Job = {
    id, role: 'fabricator', title: 'Fabricator', employer: biz.id, buildingId: biz.buildingId, district: biz.district,
    skill: 'crafting', minSkill: 0, minReputation: 0, wage: 12, output: {}, holderId, createdDay: w.day,
  };
  w.jobs[id] = job;
  biz.jobs.push(id);
  biz.employees.push(holderId);
  w.citizens[holderId].jobId = id;
  return job;
}

function addHousehold(w: World, members: string[]): Household {
  const h: Household = { id: 'h_1', headId: members[0], members, tier: 1, createdDay: 0 };
  w.households[h.id] = h;
  for (const id of members) w.citizens[id].householdId = h.id;
  return h;
}

// ---------------------------------------------------------------------------
// The Emporium and the shelves
// ---------------------------------------------------------------------------

test('a new world has a stocked Emporium, an empty Community Chest and empty society collections', () => {
  const w = makeWorld();
  assert.deepEqual(w.emporium, EMPORIUM_FOUNDING_STOCK);
  assert.notEqual(w.emporium, EMPORIUM_FOUNDING_STOCK, 'a copy, not the constant');
  assert.equal(w.treasury.chest, 0);
  assert.deepEqual(w.households, {});
  assert.deepEqual(w.clubs, {});
  assert.deepEqual(w.happenings, []);
  w.emporium.tin_whistle = 0;
  initEmporium(w);
  assert.equal(w.emporium.tin_whistle, EMPORIUM_FOUNDING_STOCK.tin_whistle);
});

test('shopsIn lists the Emporium in Harbor Market at the index-adjusted price and stocked shops in their districts', () => {
  const w = makeWorld();
  const shops = shopsIn(w, 'harbor_market');
  assert.equal(shops.length, 1);
  assert.equal(shops[0].businessId, EMPORIUM_ID);
  assert.equal(shops[0].name, EMPORIUM_NAME);
  assert.equal(shops[0].shelf.tin_whistle.price, PRODUCTS.tin_whistle.basePrice);
  assert.equal(shops[0].shelf.tin_whistle.qty, EMPORIUM_FOUNDING_STOCK.tin_whistle);
  assert.equal(shopsIn(w, 'commons').length, 0);
  w.market.priceIndex = 1.5;
  assert.equal(shopsIn(w, 'harbor_market')[0].shelf.tin_whistle.price, 45);
  w.market.priceIndex = 0.01;
  assert.equal(shopsIn(w, 'harbor_market')[0].shelf.tide_cards.price, 1, 'never below 1 ℓ');
  w.market.priceIndex = 1;

  const owner = makeCitizen(w);
  const biz = addBusiness(w, owner.id, { shelf: { tin_whistle: { qty: 2, price: 25 }, star_lens: { qty: 0, price: 150 } } });
  const nightOwner = makeCitizen(w);
  addBusiness(w, nightOwner.id, { name: 'Velvet Studio', kind: 'studio', district: 'nightglass', buildingId: 'shopfronts_nightglass', shelf: { echo_print: { qty: 1, price: 70 } } });
  const harbor = shopsIn(w, 'harbor_market');
  assert.deepEqual(harbor.map((s) => s.businessId), [biz.id, EMPORIUM_ID], 'businesses first, the Emporium last');
  assert.deepEqual(Object.keys(harbor[0].shelf), ['tin_whistle'], 'sold-out entries are not shown');
  assert.deepEqual(shopsIn(w, 'nightglass').map((s) => s.name), ['Velvet Studio']);
  const sellers = sellersOf(w, 'tin_whistle');
  assert.deepEqual(sellers.map((s) => [s.shop.businessId, s.entry.price]), [[biz.id, 25], [EMPORIUM_ID, 30]], 'cheapest first');
  biz.dissolvedDay = 1;
  assert.deepEqual(shopsIn(w, 'harbor_market').map((s) => s.businessId), [EMPORIUM_ID], 'a closed shop sells nothing');
  w.buildings.grand_bazaar.damage = 1;
  assert.equal(shopsIn(w, 'harbor_market').length, 0, 'a ruined Bazaar closes the Emporium');
});

// ---------------------------------------------------------------------------
// Buying
// ---------------------------------------------------------------------------

test('buyItem from the Emporium: price and sales tax to the Treasury, stock down, a new possession, conservation', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { district: 'harbor_market', wallet: 100, needs: { energy: 80, rest: 80, social: 80, comfort: 80, purpose: 50 } });
  c.wants = ['tin_whistle', 'shard_chess'];
  const before = totalMoney(w);
  const treasury = w.treasury.balance;
  const r = buyItem(w, c.id, 'tin_whistle');
  assert.equal(r.ok, true, r.message);
  assert.equal(c.wallet, 100 - 32, '30 ℓ plus 2 ℓ sales tax');
  assert.equal(w.treasury.balance, treasury + 32);
  assert.equal(totalMoney(w), before);
  assert.deepEqual(w.treasury.ledger.map((e) => [e.kind, e.amount, e.to]), [['item', 30, 'treasury'], ['sales_tax', 2, 'treasury']]);
  assert.equal(w.emporium.tin_whistle, EMPORIUM_FOUNDING_STOCK.tin_whistle - 1);
  assert.deepEqual(c.possessions, [{ id: 'i_1', productId: 'tin_whistle', acquiredDay: 0 }]);
  assert.deepEqual(c.wants, ['shard_chess'], 'the want is fulfilled');
  assert.equal(c.needs.purpose, 55, 'getting something you wanted feels good');
  const ev = w.events.find((e) => e.kind === 'purchase');
  assert.ok(ev && ev.weight === 0.2 && ev.actors.includes(c.id) && ev.text.includes('Tin Whistle'));
  assert.ok(c.memory.some((m) => m.kind === 'money' && m.text.includes('bought a Tin Whistle')));
  assert.ok(r.message.includes('i_1'));
  // a second purchase gets a fresh id and no want bonus
  buyItem(w, c.id, 'tide_cards');
  assert.equal(c.possessions[1].id, 'i_2');
  assert.equal(c.needs.purpose, 55);
});

test('buyItem refuses the wrong district, sold-out or unknown products, empty wallets, full pockets and absent citizens', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { district: 'commons', wallet: 100 });
  const exiled = makeCitizen(w, { district: 'harbor_market', wallet: 100, standing: 'exiled' });
  const departed = makeCitizen(w, { district: 'harbor_market', wallet: 100 });
  w.order = w.order.filter((id) => id !== departed.id);
  const before = totalMoney(w);
  let r = buyItem(w, c.id, 'tin_whistle');
  assert.equal(r.ok, false);
  assert.ok(r.message.includes(EMPORIUM_NAME) && r.message.includes('Harbor Market'), `points to where it is sold: ${r.message}`);
  c.district = 'harbor_market';
  w.emporium.star_lens = 0;
  r = buyItem(w, c.id, 'star_lens');
  assert.equal(r.ok, false);
  assert.ok(r.message.includes('Nobody in Reverie'));
  assert.equal(buyItem(w, c.id, 'philosophers_stone').ok, false);
  c.wallet = 10;
  r = buyItem(w, c.id, 'tin_whistle');
  assert.equal(r.ok, false);
  assert.ok(r.message.includes('32 ℓ'));
  assert.equal(c.wallet, 10);
  assert.equal(w.emporium.tin_whistle, EMPORIUM_FOUNDING_STOCK.tin_whistle);
  c.wallet = 100;
  for (let i = 0; i < MAX_POSSESSIONS; i++) c.possessions.push({ id: `i_${i}`, productId: 'tide_cards', acquiredDay: 0 });
  assert.equal(buyItem(w, c.id, 'tin_whistle').ok, false, 'possessions are capped');
  assert.equal(c.possessions.length, MAX_POSSESSIONS);
  assert.equal(buyItem(w, exiled.id, 'tin_whistle').ok, false, 'exiles cannot shop');
  assert.equal(buyItem(w, departed.id, 'tin_whistle').ok, false, 'emigrants cannot shop');
  assert.equal(buyItem(w, 'c_404', 'tin_whistle').ok, false);
  assert.equal(totalMoney(w), before);
  assert.equal(w.treasury.ledger.length, 0);
});

test("buyItem from a shop's shelf pays the business, picks the cheapest seller and conserves money", () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { district: 'commons' });
  const biz = addBusiness(w, owner.id, { shelf: { tin_whistle: { qty: 1, price: 25 } } });
  const c = makeCitizen(w, { district: 'harbor_market', wallet: 100 });
  const before = totalMoney(w);
  const treasury = w.treasury.balance;
  const r = buyItem(w, c.id, 'tin_whistle');
  assert.equal(r.ok, true, r.message);
  assert.ok(r.message.includes('Copper Works'));
  assert.equal(c.wallet, 100 - 25 - 1);
  assert.equal(biz.treasury, 125);
  assert.equal(biz.revenueToday, 25, 'an item sale is revenue');
  assert.equal(w.treasury.balance, treasury + 1, 'only the tax reaches the Treasury');
  assert.equal(biz.shelf.tin_whistle.qty, 0);
  assert.equal(w.emporium.tin_whistle, EMPORIUM_FOUNDING_STOCK.tin_whistle, 'the Emporium was not touched');
  assert.equal(totalMoney(w), before);
  assert.ok(owner.memory.some((m) => m.text.includes('bought a Tin Whistle from Copper Works')));
  const ev = w.events.find((e) => e.kind === 'purchase');
  assert.ok(ev && ev.actors.includes(owner.id));
  // the shelf is empty now: the Emporium (30 ℓ) is the only seller left
  buyItem(w, c.id, 'tin_whistle');
  assert.equal(w.emporium.tin_whistle, EMPORIUM_FOUNDING_STOCK.tin_whistle - 1);
  // a dearer shop loses to the Emporium
  biz.shelf.tin_whistle = { qty: 5, price: 40 };
  buyItem(w, c.id, 'tin_whistle');
  assert.equal(biz.shelf.tin_whistle.qty, 5);
  assert.equal(w.emporium.tin_whistle, EMPORIUM_FOUNDING_STOCK.tin_whistle - 2);
  assert.equal(totalMoney(w), before);
});

// ---------------------------------------------------------------------------
// Using and gifting
// ---------------------------------------------------------------------------

test('useItem restores the product\'s needs; hobby items train a skill, twice as fast for children, with a bonus for a loved hobby', () => {
  const w = makeWorld();
  const flat = { energy: 50, rest: 50, social: 50, comfort: 50, purpose: 50 };
  const c = makeCitizen(w, { needs: { ...flat } }); // loves music and games
  c.possessions.push({ id: 'i_1', productId: 'tin_whistle', acquiredDay: 0 }, { id: 'i_2', productId: 'moss_sofa', acquiredDay: 0 }, { id: 'i_3', productId: 'sketch_set', acquiredDay: 0 });
  let r = useItem(w, c.id, 'i_1');
  assert.equal(r.ok, true);
  assert.equal(c.needs.purpose, 63, '8 from the whistle, 5 for a hobby they love');
  assert.equal(c.needs.social, 54);
  assert.equal(c.skills.artistry, 20.5);
  assert.ok(c.memory.at(-1)?.text.includes('which you love'));
  r = useItem(w, c.id, 'i_3');
  assert.equal(c.needs.purpose, 71, 'sketching: 8, no love bonus');
  assert.equal(c.skills.artistry, 21);
  assert.ok(!c.memory.at(-1)?.text.includes('which you love'));
  r = useItem(w, c.id, 'i_2');
  assert.equal(c.needs.comfort, 62);
  assert.equal(c.needs.rest, 54);
  assert.equal(c.skills.artistry, 21, 'a sofa teaches nothing');
  assert.equal(useItem(w, c.id, 'i_9').ok, false);
  assert.equal(useItem(w, 'c_404', 'i_1').ok, false);

  const child = makeCitizen(w, { lifeStage: 'child', needs: { ...flat } });
  child.possessions.push({ id: 'i_4', productId: 'tin_whistle', acquiredDay: 0 });
  useItem(w, child.id, 'i_4');
  assert.equal(child.skills.artistry, 21, 'children learn twice as fast');
  c.needs.purpose = 99;
  useItem(w, c.id, 'i_1');
  assert.equal(c.needs.purpose, 100, 'clamped');
});

test('giftItem moves the item, grows the bond with the recipient\'s taste for it, and warms partners', () => {
  const w = makeWorld();
  const giver = makeCitizen(w, { district: 'nightglass' });
  const gamer = makeCitizen(w, { district: 'nightglass' });           // tastes include games
  const gardener = makeCitizen(w, { district: 'nightglass' });
  gardener.tastes = { hobbies: ['gardening', 'cooking'], favouriteDistrict: 'verdant_quarter', favouriteGood: 'goods', categories: ['plant', 'tool'] };
  giver.possessions.push({ id: 'i_1', productId: 'shard_chess', acquiredDay: 0 }, { id: 'i_2', productId: 'shard_chess', acquiredDay: 0 });
  gamer.wants = ['shard_chess'];
  gamer.needs.purpose = 50;

  let r = giftItem(w, giver.id, gamer.id, 'i_1');
  assert.equal(r.ok, true, r.message);
  assert.equal(giver.bonds[gamer.id], 37, '10 + 30 × 0.9');
  assert.equal(gamer.bonds[giver.id], 37);
  assert.deepEqual(giver.possessions.map((i) => i.id), ['i_2']);
  assert.deepEqual(gamer.possessions, [{ id: 'i_1', productId: 'shard_chess', acquiredDay: 0 }]);
  assert.deepEqual(gamer.wants, []);
  assert.equal(gamer.needs.purpose, 55);
  assert.equal(giver.stats.giftsGiven, 1);
  assert.equal(gamer.stats.giftsReceived, 1);
  assert.equal(gamer.needs.social, 85);
  const ev = w.events.find((e) => e.kind === 'gift');
  assert.ok(ev && ev.weight === 0.3 && ev.text.includes('just what they wanted'));
  assert.ok(gamer.memory.some((m) => m.text.includes('gave you a Shard Chess Set')));

  r = giftItem(w, giver.id, gardener.id, 'i_2');
  assert.equal(r.ok, true);
  assert.equal(giver.bonds[gardener.id], 10, 'a gift outside their tastes is still a gift');
  assert.equal(w.events.filter((e) => e.kind === 'gift').at(-1)?.weight, 0.2);
  assert.deepEqual(giver.possessions, []);
  assert.deepEqual(giver.affection, {}, 'no affection between people who are not partners');

  // partners
  const a = makeCitizen(w, { district: 'archive' });
  const b = makeCitizen(w, { district: 'archive' });
  a.family.partnerId = b.id;
  b.family.partnerId = a.id;
  a.possessions.push({ id: 'i_3', productId: 'window_fern', acquiredDay: 0 });
  giftItem(w, a.id, b.id, 'i_3');
  assert.equal(a.affection[b.id], 5);
  assert.equal(b.affection[a.id], 5);
});

test('giftItem refuses self, absent, distant or overloaded recipients and things you do not own', () => {
  const w = makeWorld();
  const giver = makeCitizen(w, { district: 'commons' });
  const far = makeCitizen(w, { district: 'archive' });
  const near = makeCitizen(w, { district: 'commons' });
  giver.possessions.push({ id: 'i_1', productId: 'tide_cards', acquiredDay: 0 });
  assert.equal(giftItem(w, giver.id, giver.id, 'i_1').ok, false);
  assert.equal(giftItem(w, giver.id, far.id, 'i_1').ok, false);
  assert.equal(giftItem(w, giver.id, near.id, 'i_7').ok, false);
  assert.equal(giftItem(w, giver.id, 'c_404', 'i_1').ok, false);
  near.detainedUntilTick = w.tick + 5;
  assert.equal(giftItem(w, giver.id, near.id, 'i_1').ok, false, 'a detained friend is not around');
  near.detainedUntilTick = null;
  for (let i = 0; i < MAX_POSSESSIONS; i++) near.possessions.push({ id: `i_x${i}`, productId: 'tide_cards', acquiredDay: 0 });
  assert.equal(giftItem(w, giver.id, near.id, 'i_1').ok, false, 'the recipient is full');
  assert.equal(giver.possessions.length, 1);
  assert.equal(giver.stats.giftsGiven, 0);
});

// ---------------------------------------------------------------------------
// Crafting and prices
// ---------------------------------------------------------------------------

test('craftProduct consumes recipe goods from the business, buying what is short from the Bazaar, and stocks the shelf', () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { district: 'harbor_market' });
  const biz = addBusiness(w, owner.id, { inventory: { compute: 0, energy: 0, goods: 2, culture: 0, knowledge: 0 } });
  const before = totalMoney(w);
  const goodsStock = w.market.goods.goods.stock;
  let r = craftProduct(w, owner.id, 'tin_whistle');
  assert.equal(r.ok, true, r.message);
  assert.equal(biz.inventory.goods, 0);
  const whistle = PRODUCTS.tin_whistle;
  assert.deepEqual(biz.shelf.tin_whistle, { qty: 1, price: defaultShelfPrice(w, whistle) },
    'a new line is priced by the shop itself, not by the catalogue');
  assert.equal(defaultShelfPrice(w, whistle), Math.round(emporiumPrice(w, whistle) * CRAFT_UNDERCUT),
    'at founding prices the bench undercuts the Emporium');
  assert.ok(defaultShelfPrice(w, whistle) >= Math.round(materialCost(w, whistle) * CRAFT_MARKUP) - 1,
    'and still clears the cost of the goods it is made from');
  w.market.goods.goods.price = 40;
  assert.equal(defaultShelfPrice(w, whistle), Math.round(materialCost(w, whistle) * CRAFT_MARKUP),
    'when materials are dear the price follows them up instead');
  w.market.goods.goods.price = 12;
  assert.equal(biz.treasury, 100, 'nothing bought when the goods are in stock');
  assert.equal(owner.shiftsToday, 1);
  assert.equal(owner.skills.crafting, 20.5);
  assert.equal(owner.needs.purpose, 86);
  assert.equal(owner.needs.rest, 77);
  assert.ok(w.events.some((e) => e.kind === 'trade' && e.text.includes('put a Tin Whistle on its shelf')));
  assert.ok(owner.memory.some((m) => m.kind === 'work' && m.text.includes('crafted a Tin Whistle')));

  // short of goods: the business buys 2 goods (12 ℓ each plus 5% tax = 25 ℓ) from the Bazaar
  r = craftProduct(w, owner.id, 'tin_whistle');
  assert.equal(r.ok, true, r.message);
  assert.equal(biz.shelf.tin_whistle.qty, 2);
  assert.equal(biz.treasury, 75);
  assert.equal(biz.costsToday, 25);
  assert.equal(w.market.goods.goods.stock, goodsStock - 2);
  assert.equal(totalMoney(w), before);
  assert.equal(w.events.filter((e) => e.kind === 'trade' && e.text.includes('shelf')).length, 1, 'only the first unit makes the news');

  // a studio trains artistry and sells art
  const artist = makeCitizen(w, { district: 'nightglass' });
  const studio = addBusiness(w, artist.id, { name: 'Echo Studio', kind: 'studio', district: 'nightglass', buildingId: 'shopfronts_nightglass', treasury: 500 });
  const before2 = totalMoney(w);
  r = craftProduct(w, artist.id, 'echo_print');
  assert.equal(r.ok, true, r.message);
  assert.equal(studio.shelf.echo_print.qty, 1);
  assert.equal(artist.skills.artistry, 20.5);
  assert.equal(artist.skills.crafting, 20);
  assert.equal(studio.costsToday, Math.round(2 * 12 * 1.05) + Math.round(3 * 8 * 1.05), 'goods and culture bought at the Bazaar');
  assert.equal(totalMoney(w), before2);
});

test('craftProduct: employees may craft; the wrong place, kind, life stage, funds or a full day are refused', () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { district: 'commons' });
  const biz = addBusiness(w, owner.id, { treasury: 0 });
  const worker = makeCitizen(w, { district: 'harbor_market' });
  addJob(w, biz, worker.id);
  assert.equal(workplaceOf(w, worker)?.id, biz.id);
  assert.equal(workplaceOf(w, owner)?.id, biz.id);

  let r = craftProduct(w, owner.id, 'tin_whistle');
  assert.equal(r.ok, false);
  assert.ok(r.message.includes('not here'));
  r = craftProduct(w, worker.id, 'tin_whistle');
  assert.equal(r.ok, false, 'a penniless business cannot buy goods');
  assert.ok(r.message.includes('could not get'));
  assert.equal('tin_whistle' in biz.shelf, false, 'nothing crafted');
  biz.treasury = 100;
  r = craftProduct(w, worker.id, 'tin_whistle');
  assert.equal(r.ok, true, r.message);
  assert.equal(biz.shelf.tin_whistle.qty, 1);
  assert.equal(craftProduct(w, worker.id, 'no_such_thing').ok, false);

  worker.shiftsToday = w.config.maxShiftsPerDay;
  assert.equal(craftProduct(w, worker.id, 'tin_whistle').ok, false, 'a full day');
  worker.shiftsToday = 0;
  worker.lifeStage = 'child';
  assert.equal(craftProduct(w, worker.id, 'tin_whistle').ok, false, 'children do not work');
  worker.lifeStage = 'adult';
  w.buildings.shopfronts_harbor.damage = 1;
  assert.equal(craftProduct(w, worker.id, 'tin_whistle').ok, false, 'ruined premises');
  w.buildings.shopfronts_harbor.damage = 0;

  const cook = makeCitizen(w, { district: 'nightglass' });
  addBusiness(w, cook.id, { name: 'Moss Café', kind: 'cafe', district: 'nightglass', buildingId: 'shopfronts_nightglass' });
  r = craftProduct(w, cook.id, 'chefs_knife');
  assert.equal(r.ok, false);
  assert.ok(r.message.includes('cafe'));
  const idle = makeCitizen(w, { district: 'harbor_market' });
  assert.equal(craftProduct(w, idle.id, 'tin_whistle').ok, false, 'no workplace');
  biz.dissolvedDay = 2;
  assert.equal(craftProduct(w, worker.id, 'tin_whistle').ok, false, 'a closed business');
});

test('setPrice is for owners of shops, workshops and studios, and a price set in advance is kept when crafting', () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { district: 'harbor_market' });
  const biz = addBusiness(w, owner.id, { inventory: { compute: 0, energy: 0, goods: 10, culture: 0, knowledge: 0 } });
  const worker = makeCitizen(w, { district: 'harbor_market' });
  addJob(w, biz, worker.id);
  let r = setPrice(w, owner.id, 'tin_whistle', 50);
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(biz.shelf.tin_whistle, { qty: 0, price: 50 });
  assert.ok(r.message.includes('none on the shelf yet'));
  assert.equal(w.events.filter((e) => e.kind === 'price').length, 0, 'no news without stock');
  craftProduct(w, owner.id, 'tin_whistle');
  assert.deepEqual(biz.shelf.tin_whistle, { qty: 1, price: 50 });
  r = setPrice(w, owner.id, 'tin_whistle', 44.6);
  assert.equal(biz.shelf.tin_whistle.price, 45, 'rounded');
  assert.ok(w.events.some((e) => e.kind === 'price' && e.text.includes('45 ℓ')));
  assert.equal(setPrice(w, worker.id, 'tin_whistle', 10).ok, false, 'employees do not set prices');
  assert.equal(setPrice(w, owner.id, 'tin_whistle', 0).ok, false);
  assert.equal(setPrice(w, owner.id, 'tin_whistle', 1e9).ok, false);
  assert.equal(setPrice(w, owner.id, 'tin_whistle', Number.NaN).ok, false);
  assert.equal(setPrice(w, owner.id, 'no_such_thing', 10).ok, false);
  assert.equal(biz.shelf.tin_whistle.price, 45);
  const cook = makeCitizen(w);
  addBusiness(w, cook.id, { name: 'Moss Café', kind: 'cafe', district: 'nightglass', buildingId: 'shopfronts_nightglass' });
  assert.equal(setPrice(w, cook.id, 'chefs_knife', 10).ok, false, 'a café has no shelf');
  assert.equal(setPrice(w, 'c_404', 'tin_whistle', 10).ok, false);
});

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

test('restockEmporium adds a unit now and then, never past the cap, deterministically', () => {
  const w = makeWorld({ seed: 11 });
  for (const id of PRODUCT_IDS) w.emporium[id] = EMPORIUM_MAX_STOCK;
  restockEmporium(w);
  for (const id of PRODUCT_IDS) assert.equal(w.emporium[id], EMPORIUM_MAX_STOCK);
  for (const id of PRODUCT_IDS) w.emporium[id] = 0;
  for (let d = 0; d < 60; d++) restockEmporium(w);
  let total = 0;
  for (const id of PRODUCT_IDS) {
    assert.ok(w.emporium[id] >= 0 && w.emporium[id] <= EMPORIUM_MAX_STOCK);
    total += w.emporium[id];
  }
  assert.ok(total > PRODUCT_IDS.length * 3 && total < PRODUCT_IDS.length * EMPORIUM_MAX_STOCK, `about 9 per product in 60 days, got ${total / PRODUCT_IDS.length}`);
  const w2 = makeWorld({ seed: 11 });
  for (const id of PRODUCT_IDS) w2.emporium[id] = EMPORIUM_MAX_STOCK;
  restockEmporium(w2);
  for (const id of PRODUCT_IDS) w2.emporium[id] = 0;
  for (let d = 0; d < 60; d++) restockEmporium(w2);
  assert.deepEqual(w2.emporium, w.emporium);
});

test('dailyPossessions gives owners their passive comforts and shares companions with the household', () => {
  const w = makeWorld();
  const flat = { energy: 50, rest: 50, social: 50, comfort: 50, purpose: 50 };
  const a = makeCitizen(w, { needs: { ...flat } });
  const b = makeCitizen(w, { needs: { ...flat } });
  const gone = makeCitizen(w, { needs: { ...flat } });
  const loner = makeCitizen(w, { needs: { ...flat } });
  const exiled = makeCitizen(w, { needs: { ...flat }, standing: 'exiled' });
  addHousehold(w, [a.id, b.id, gone.id]);
  w.order = w.order.filter((id) => id !== gone.id);
  a.possessions.push({ id: 'i_1', productId: 'clockwork_cat', acquiredDay: 0 }, { id: 'i_2', productId: 'lantern_lamp', acquiredDay: 0 });
  loner.possessions.push({ id: 'i_3', productId: 'moss_sofa', acquiredDay: 0 }, { id: 'i_4', productId: 'tin_whistle', acquiredDay: 0 });
  exiled.possessions.push({ id: 'i_5', productId: 'clockwork_cat', acquiredDay: 0 });
  dailyPossessions(w);
  assert.equal(a.needs.social, 53, 'the cat');
  assert.equal(a.needs.comfort, 51, 'the lamp');
  assert.equal(b.needs.social, 53, 'the household shares the cat');
  assert.equal(b.needs.comfort, 50, 'but not the lamp');
  assert.equal(gone.needs.social, 50, 'a departed member gets nothing');
  assert.equal(loner.needs.comfort, 52, 'the sofa');
  assert.equal(loner.needs.social, 50, 'a whistle has no passive effect');
  assert.equal(exiled.needs.social, 50, 'exiles are frozen');
  a.needs.social = 99;
  dailyPossessions(w);
  assert.equal(a.needs.social, 100, 'clamped');
});
