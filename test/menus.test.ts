/**
 * Menus (src/culture/menus.ts).
 *
 * Who writes the day's dish up, what the larder pays for it, what a good
 * kitchen is worth to whoever sits down, and how a menu left up too long goes
 * off.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Business, Citizen, Job, World } from '../src/types.ts';
import { DISHES } from '../src/data/metropolis.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  DISH_SHARE, PLAIN_ENERGY, PLAIN_SOCIAL, STALE_QUALITY,
  bestCafe, cafeFor, cafesWithMenus, dailyMenus, dishById, dishEffect, mealCost, menuOf, setMenu,
} from '../src/culture/menus.ts';

function makeCafe(world: World, owner: Citizen, over: Partial<Business> = {}): Business {
  const id = `b_${Object.keys(world.businesses).length + 1}`;
  const biz: Business = {
    id, name: `Café ${id}`, kind: 'cafe', ownerId: owner.id, treasury: 300, district: owner.district,
    buildingId: 'shopfronts_nightglass', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: world.day, rentPerDay: 10, daysNegative: 0, revenueToday: 0, costsToday: 0,
    dissolvedDay: null, shelf: {}, ...over,
  };
  world.businesses[id] = biz;
  owner.businessId = id;
  return biz;
}

function hireCook(world: World, biz: Business, cook: Citizen): Job {
  const job: Job = {
    id: `j_${Object.keys(world.jobs).length + 1}`, role: 'cook', title: 'Cook', employer: biz.id,
    buildingId: biz.buildingId, district: biz.district, skill: 'care', minSkill: 0, minReputation: 0,
    wage: 9, output: {}, holderId: cook.id, createdDay: world.day,
  };
  world.jobs[job.id] = job;
  cook.jobId = job.id;
  biz.employees.push(cook.id);
  biz.jobs.push(job.id);
  return job;
}

function cookish(world: World, over: Record<string, unknown> = {}): Citizen {
  return makeCitizen(world, {
    district: 'nightglass',
    skills: { crafting: 40, analysis: 20, rhetoric: 20, care: 80, commerce: 20, artistry: 20 },
    ...over,
  });
}

// ------------------------------------------------------------- who may write

test('only a café owner, or its cook, sets a menu', () => {
  const w = makeWorld();
  const owner = cookish(w, { name: 'Owner' });
  const cafe = makeCafe(w, owner, { inventory: { compute: 0, energy: 0, goods: 3, culture: 0, knowledge: 0 } });
  const cook = cookish(w, { name: 'Cook' });
  hireCook(w, cafe, cook);
  const stranger = cookish(w, { name: 'Stranger' });

  assert.equal(cafeFor(w, owner.id)?.id, cafe.id);
  assert.equal(cafeFor(w, cook.id)?.id, cafe.id);
  assert.equal(cafeFor(w, stranger.id), null);

  assert.equal(setMenu(w, stranger.id, 'lantern_broth').ok, false);
  assert.equal(setMenu(w, owner.id, 'lantern_broth').ok, true);
  assert.equal(setMenu(w, cook.id, 'harbor_plate').ok, true);
  assert.equal(menuOf(w, cafe.id)?.dish, 'harbor_plate');
});

test('a workshop is not a café, a dissolved café is nobody’s kitchen, and you must be there', () => {
  const w = makeWorld();
  const owner = cookish(w);
  const shop = makeCafe(w, owner, { kind: 'workshop' });
  assert.equal(setMenu(w, owner.id, 'lantern_broth').ok, false);

  shop.kind = 'cafe';
  shop.inventory.goods = 2;
  assert.equal(setMenu(w, owner.id, 'lantern_broth').ok, true);

  owner.district = 'commons';
  assert.equal(setMenu(w, owner.id, 'lantern_broth').ok, false, 'you cannot cook from across town');

  owner.district = 'nightglass';
  shop.dissolvedDay = w.day;
  assert.equal(setMenu(w, owner.id, 'lantern_broth').ok, false);
  assert.equal(menuOf(w, shop.id), null);
});

test('an unknown dish is refused, and nothing changes', () => {
  const w = makeWorld();
  const owner = cookish(w);
  const cafe = makeCafe(w, owner, { inventory: { compute: 0, energy: 0, goods: 3, culture: 0, knowledge: 0 } });
  const before = totalMoney(w);
  const res = setMenu(w, owner.id, 'ambrosia');
  assert.equal(res.ok, false);
  assert.match(res.message, /Lantern broth/);
  assert.equal(menuOf(w, cafe.id), null);
  assert.equal(cafe.inventory.goods, 3);
  assert.equal(totalMoney(w), before);
  assert.equal(dishById('ambrosia'), null);
  assert.equal(dishById('Lantern broth')?.id, 'lantern_broth', 'the name works as well as the id');
});

// ---------------------------------------------------------------- the larder

test('the recipe comes off the shelf, and money is conserved when it does not', () => {
  const w = makeWorld();
  const owner = cookish(w);
  const cafe = makeCafe(w, owner, { inventory: { compute: 0, energy: 0, goods: 2, culture: 0, knowledge: 0 } });
  const before = totalMoney(w);
  const till = cafe.treasury;

  assert.equal(setMenu(w, owner.id, 'harbor_plate').ok, true, 'the plate wants two goods, and there are two');
  assert.equal(cafe.inventory.goods, 0);
  assert.equal(cafe.treasury, till, 'nothing had to be bought');
  assert.equal(totalMoney(w), before);
});

test('a short larder buys at the Bazaar out of the till, and the money is conserved', () => {
  const w = makeWorld();
  const owner = cookish(w);
  const cafe = makeCafe(w, owner, { inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 } });
  const before = totalMoney(w);
  const till = cafe.treasury;
  const stock = w.market.goods.goods.stock;

  assert.equal(setMenu(w, owner.id, 'lantern_broth').ok, true);
  assert.ok(cafe.treasury < till, 'the kitchen paid for its stock');
  assert.equal(cafe.inventory.goods, 0, 'and cooked it');
  assert.equal(w.market.goods.goods.stock, stock - 1);
  assert.equal(totalMoney(w), before, 'a purchase moves money, it does not make any');
});

test('a till that cannot cover the stock, and a Bazaar with none, are refusals', () => {
  const w = makeWorld();
  const owner = cookish(w);
  const cafe = makeCafe(w, owner, { treasury: 1 });
  const before = totalMoney(w);
  const poor = setMenu(w, owner.id, 'lantern_broth');
  assert.equal(poor.ok, false);
  assert.match(poor.message, /has 1 ℓ/);
  assert.equal(totalMoney(w), before);

  cafe.treasury = 500;
  w.market.goods.goods.stock = 0;
  const bare = setMenu(w, owner.id, 'lantern_broth');
  assert.equal(bare.ok, false);
  assert.match(bare.message, /Bazaar/);
  assert.equal(menuOf(w, cafe.id), null);
});

// ---------------------------------------------------------------- the table

test('a good kitchen restores more and costs more than a plain meal', () => {
  const w = makeWorld();
  const plain = dishEffect(w, null);
  assert.deepEqual(plain, { energy: PLAIN_ENERGY, social: PLAIN_SOCIAL, price: mealCost(w) });

  const owner = cookish(w, { skills: { crafting: 80, analysis: 20, rhetoric: 20, care: 100, commerce: 20, artistry: 20 } });
  const cafe = makeCafe(w, owner, { inventory: { compute: 0, energy: 0, goods: 4, culture: 0, knowledge: 0 } });
  assert.deepEqual(dishEffect(w, cafe), plain, 'a café with nothing on serves the plain meal');

  assert.equal(setMenu(w, owner.id, 'harbor_plate').ok, true);
  const menu = menuOf(w, cafe.id);
  assert.ok(menu && menu.quality > 0);
  const good = dishEffect(w, cafe);
  assert.ok(good.energy > plain.energy);
  assert.ok(good.social > plain.social);
  assert.ok(good.price > plain.price);
  assert.equal(good.energy, PLAIN_ENERGY + Math.round(menu.quality / 5) + Math.round(26 / DISH_SHARE));
  assert.equal(good.price, menu.price);
});

test('two dishes of the same quality are not the same dinner', () => {
  const w = makeWorld();
  const owner = cookish(w);
  const cafe = makeCafe(w, owner, { inventory: { compute: 4, energy: 4, goods: 4, culture: 4, knowledge: 4 } });
  setMenu(w, owner.id, 'forge_hash');
  const hearty = dishEffect(w, cafe);
  const quality = menuOf(w, cafe.id)!.quality;

  setMenu(w, owner.id, 'glasswater_tart');
  const menu = menuOf(w, cafe.id)!;
  menu.quality = quality;                       // hold the cook still; only the dish changes
  const dainty = dishEffect(w, cafe);
  assert.ok(hearty.energy > dainty.energy, 'the forge hash is the bigger plate');
  assert.ok(dainty.social > hearty.social, 'the tart is the better company');
});

test('quality is deterministic for a seed and bounded', () => {
  function quality(seed: number): number {
    const w = makeWorld({ seed });
    const owner = cookish(w, { skills: { crafting: 100, analysis: 0, rhetoric: 0, care: 100, commerce: 0, artistry: 0 } });
    const cafe = makeCafe(w, owner, { inventory: { compute: 0, energy: 0, goods: 4, culture: 0, knowledge: 0 } });
    setMenu(w, owner.id, 'lantern_broth');
    return menuOf(w, cafe.id)!.quality;
  }
  assert.equal(quality(6), quality(6));
  assert.ok(quality(6) <= 100 && quality(6) >= 0);

  const w = makeWorld();
  const poor = cookish(w, { skills: { crafting: 0, analysis: 0, rhetoric: 0, care: 0, commerce: 0, artistry: 0 } });
  const cafe = makeCafe(w, poor, { inventory: { compute: 0, energy: 0, goods: 4, culture: 0, knowledge: 0 } });
  setMenu(w, poor.id, 'lantern_broth');
  const menu = menuOf(w, cafe.id)!;
  assert.ok(menu.quality >= 0 && menu.quality <= 20);
  assert.ok(menu.price >= 1);
});

// ------------------------------------------------------------ the best table

test('the best café is the best dish, and the Chronicle hears about it once a day', () => {
  const w = makeWorld();
  assert.equal(bestCafe(w), null);
  dailyMenus(w);
  assert.equal(w.events.filter((e) => e.kind === 'story').length, 0, 'no café, no notice');

  const one = cookish(w, { name: 'One' });
  const two = cookish(w, { name: 'Two' });
  const a = makeCafe(w, one, { inventory: { compute: 0, energy: 0, goods: 4, culture: 0, knowledge: 0 } });
  const b = makeCafe(w, two, { inventory: { compute: 0, energy: 0, goods: 4, culture: 0, knowledge: 0 } });
  setMenu(w, one.id, 'lantern_broth');
  setMenu(w, two.id, 'lantern_broth');
  menuOf(w, a.id)!.quality = 40;
  menuOf(w, b.id)!.quality = 80;

  assert.equal(bestCafe(w)?.biz.id, b.id);
  assert.equal(cafesWithMenus(w).length, 2);

  dailyMenus(w);
  dailyMenus(w);
  const notices = w.events.filter((e) => e.kind === 'story' && e.text.includes('best table'));
  assert.equal(notices.length, 1, 'the Chronicle is told once a day');
  assert.match(notices[0].text, new RegExp(b.name));

  w.day += 1;
  dailyMenus(w);
  assert.equal(w.events.filter((e) => e.kind === 'story' && e.text.includes('best table')).length, 2);
});

test('a menu older than a cycle goes stale, and a dissolved café takes its menu down', () => {
  const w = makeWorld();
  const owner = cookish(w);
  const cafe = makeCafe(w, owner, { inventory: { compute: 0, energy: 0, goods: 4, culture: 0, knowledge: 0 } });
  setMenu(w, owner.id, 'lantern_broth');
  const menu = menuOf(w, cafe.id)!;
  menu.quality = 50;

  w.day = w.config.cycleDays;
  dailyMenus(w);
  assert.equal(menu.quality, 50, 'a cycle old is not yet stale');

  w.day = w.config.cycleDays + 1;
  dailyMenus(w);
  assert.equal(menu.quality, 50 - STALE_QUALITY);
  for (let i = 0; i < 20; i++) dailyMenus(w);
  assert.equal(menu.quality, 0, 'and it never goes below nothing');

  cafe.dissolvedDay = w.day;
  dailyMenus(w);
  assert.equal((cafe as Business & { menu?: unknown }).menu, null);
  assert.equal(bestCafe(w), null);
});

test('every dish in the book can actually be cooked', () => {
  const w = makeWorld();
  const owner = cookish(w);
  const cafe = makeCafe(w, owner, {
    treasury: 5_000, inventory: { compute: 9, energy: 9, goods: 9, culture: 9, knowledge: 9 },
  });
  for (const dish of DISHES) {
    const res = setMenu(w, owner.id, dish.id);
    assert.equal(res.ok, true, `${dish.name}: ${res.message}`);
    assert.equal(menuOf(w, cafe.id)?.dish, dish.id);
  }
});

test('an unknown citizen, and a cook in the cells, change no menus', () => {
  const w = makeWorld();
  assert.equal(setMenu(w, 'c_999', 'lantern_broth').ok, false);
  const owner = cookish(w, { jailedUntilDay: 5 });
  makeCafe(w, owner, { inventory: { compute: 0, energy: 0, goods: 4, culture: 0, knowledge: 0 } });
  w.day = 2;
  assert.equal(setMenu(w, owner.id, 'lantern_broth').ok, false);
  owner.jailedUntilDay = null;
  owner.detainedUntilTick = w.tick + 3;
  assert.equal(setMenu(w, owner.id, 'lantern_broth').ok, false);
});
