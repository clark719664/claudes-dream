import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen } from './helpers.ts';
import { DISTRICT_IDS, GOODS, PRODUCT_CATEGORIES } from '../src/types.ts';
import type { Household } from '../src/types.ts';
import { HOBBIES, HOBBY_INFO, PRODUCTS } from '../src/data/catalogue.ts';
import {
  AFFORDABLE_SHARE, FASHION_BONUS, MAX_WANTS, affordability, assignTastes, computeWants, householdMembers, ownsProduct,
  preferenceScore, refreshWantsDaily,
} from '../src/society/tastes.ts';

function addHousehold(w: ReturnType<typeof makeWorld>, members: string[]): Household {
  const h: Household = { id: 'h_1', headId: members[0], members, tier: 1, createdDay: 0 };
  w.households[h.id] = h;
  for (const id of members) w.citizens[id].householdId = h.id;
  return h;
}

test('assignTastes rolls two distinct hobbies, a favourite district and good, and the implied categories plus one', () => {
  const w = makeWorld();
  for (let i = 0; i < 50; i++) {
    const c = makeCitizen(w);
    assignTastes(w, c);
    const t = c.tastes;
    assert.equal(t.hobbies.length, 2);
    assert.notEqual(t.hobbies[0], t.hobbies[1]);
    for (const h of t.hobbies) assert.ok(HOBBIES.includes(h));
    assert.ok(DISTRICT_IDS.includes(t.favouriteDistrict));
    assert.ok(GOODS.includes(t.favouriteGood));
    const implied = new Set(t.hobbies.flatMap((h) => HOBBY_INFO[h].categories));
    for (const cat of implied) assert.ok(t.categories.includes(cat), `${cat} implied by ${t.hobbies.join('/')}`);
    assert.equal(new Set(t.categories).size, t.categories.length, 'categories are distinct');
    assert.equal(t.categories.length, implied.size + 1, 'one extra category beyond the hobbies');
    for (const cat of t.categories) assert.ok(PRODUCT_CATEGORIES.includes(cat));
  }
});

test('assignTastes is deterministic for a seed', () => {
  const a = makeWorld({ seed: 3 });
  const b = makeWorld({ seed: 3 });
  const ca = makeCitizen(a);
  const cb = makeCitizen(b);
  assignTastes(a, ca);
  assignTastes(b, cb);
  assert.deepEqual(ca.tastes, cb.tastes);
});

test('preferenceScore rewards category and hobby matches, penalises owning one already, clamps to 0..1', () => {
  const w = makeWorld();
  const c = makeCitizen(w); // tastes: music + games; categories instrument + game
  assert.equal(preferenceScore(c, 'tin_whistle'), 0.9, 'instrument for a musician');
  assert.equal(preferenceScore(c, 'shard_chess'), 0.9);
  assert.equal(preferenceScore(c, 'moss_sofa'), 0, 'furniture is not among their tastes');
  assert.equal(preferenceScore(c, 'sketch_set'), 0, 'a tool for a hobby they do not have');
  c.tastes.categories.push('tool');
  assert.equal(preferenceScore(c, 'sketch_set'), 0.5, 'category alone');
  c.possessions.push({ id: 'i_1', productId: 'tin_whistle', acquiredDay: 0 });
  assert.equal(ownsProduct(c, 'tin_whistle'), true);
  assert.ok(Math.abs(preferenceScore(c, 'tin_whistle') - 0.3) < 1e-9, 'owning one takes 0.6 off');
  assert.equal(preferenceScore(c, 'no_such_thing'), 0);
  c.possessions.push({ id: 'i_2', productId: 'moss_sofa', acquiredDay: 0 });
  assert.equal(preferenceScore(c, 'moss_sofa'), 0, 'never below zero');
});

test('preferenceScore gives companions a bonus only while nobody in the household has one', () => {
  const w = makeWorld();
  const a = makeCitizen(w);
  const b = makeCitizen(w);
  assert.equal(preferenceScore(a, 'clockwork_cat'), 0.1, 'alone: a companion appeals a little');
  assert.equal(preferenceScore(a, 'clockwork_cat', w), 0.1, 'no household: same');
  addHousehold(w, [a.id, b.id]);
  assert.deepEqual(householdMembers(w, a).map((m) => m.id), [a.id, b.id]);
  b.possessions.push({ id: 'i_1', productId: 'pocket_owl', acquiredDay: 0 });
  assert.equal(preferenceScore(a, 'clockwork_cat', w), 0, "the household already has b's owl");
  assert.equal(preferenceScore(a, 'clockwork_cat'), 0.1, 'without the world only own possessions count');
  a.tastes.categories.push('companion');
  assert.equal(preferenceScore(a, 'clockwork_cat', w), 0.5, 'a taste for companions still counts');
  a.possessions.push({ id: 'i_2', productId: 'clockwork_cat', acquiredDay: 0 });
  assert.equal(preferenceScore(a, 'clockwork_cat', w), 0, 'owning one: 0.5 − 0.6 clamps to 0');
  a.householdId = 'h_404';
  assert.deepEqual(householdMembers(w, a).map((m) => m.id), [a.id], 'an unknown household is just yourself');
});

test('affordability is 1 within reach of the wallet and falls smoothly beyond it', () => {
  assert.equal(affordability(200, 30), 1);
  assert.equal(affordability(200, 200 * AFFORDABLE_SHARE), 1);
  assert.equal(affordability(200, 160), 0.75);
  assert.equal(affordability(200, 240), 0.5);
  assert.equal(affordability(0, 30), 0);
  assert.equal(affordability(-5, 30), 0);
  assert.equal(affordability(100, 0), 1, 'free things are always affordable');
});

test('computeWants ranks by taste × affordability, keeps catalogue order on ties, and lists at most five', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 200 });
  c.tastes.categories = ['instrument', 'game', 'furniture'];
  const wants = computeWants(w, c);
  assert.equal(wants.length, MAX_WANTS);
  assert.deepEqual(wants.slice(0, 3), ['tin_whistle', 'shard_chess', 'tide_cards'], 'cheap, loved things first, in catalogue order');
  assert.equal(wants[3], 'glass_harp', 'a 140 ℓ harp on a 200 ℓ wallet is discounted');
  assert.equal(wants[4], 'moss_sofa', 'a merely liked category fills the last slot');
  assert.ok(!wants.includes('lantern_lamp'), 'the sixth candidate is dropped');
  assert.ok(!wants.includes('running_shoes'));
  // owning something pushes it down the list
  c.possessions.push({ id: 'i_1', productId: 'tin_whistle', acquiredDay: 0 });
  const again = computeWants(w, c);
  assert.equal(again[0], 'shard_chess');
  assert.ok(!again.includes('tin_whistle'), 'a second whistle scores 0.3 and falls off the list');
});

test('computeWants: fashion spreads from friends, and a broke citizen wants only what friends have', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 200 });
  c.tastes = { hobbies: ['music', 'astronomy'], favouriteDistrict: 'archive', favouriteGood: 'culture', categories: ['instrument'] };
  const friend = makeCitizen(w);
  const stranger = makeCitizen(w);
  c.bonds[friend.id] = 50;
  friend.possessions.push({ id: 'i_1', productId: 'running_shoes', acquiredDay: 0 });
  stranger.possessions.push({ id: 'i_2', productId: 'foundry_boots', acquiredDay: 0 });
  const wants = computeWants(w, c);
  assert.deepEqual(wants, ['tin_whistle', 'glass_harp', 'running_shoes'], 'friends set fashions; strangers do not');
  c.wallet = 0;
  assert.deepEqual(computeWants(w, c), ['running_shoes'], `only the ${FASHION_BONUS} fashion term survives an empty wallet`);
  c.possessions.push({ id: 'i_3', productId: 'running_shoes', acquiredDay: 0 });
  assert.deepEqual(computeWants(w, c), [], 'no fashion pull for something you already own');
  // a friend who has left the city no longer sets fashions
  c.wallet = 200;
  c.possessions = [];
  w.order = w.order.filter((id) => id !== friend.id);
  assert.deepEqual(computeWants(w, c), ['tin_whistle', 'glass_harp']);
});

test('refreshWantsDaily updates present adults and elders only', () => {
  const w = makeWorld();
  const adult = makeCitizen(w, { wallet: 100 });
  const elder = makeCitizen(w, { wallet: 100, lifeStage: 'elder' });
  const child = makeCitizen(w, { wallet: 100, lifeStage: 'child' });
  const exiled = makeCitizen(w, { wallet: 100, standing: 'exiled' });
  const departed = makeCitizen(w, { wallet: 100 });
  w.order = w.order.filter((id) => id !== departed.id);
  refreshWantsDaily(w);
  assert.ok(adult.wants.length > 0);
  assert.ok(elder.wants.length > 0);
  assert.deepEqual(child.wants, []);
  assert.deepEqual(exiled.wants, []);
  assert.deepEqual(departed.wants, []);
  for (const id of adult.wants) assert.ok(PRODUCTS[id]);
});
