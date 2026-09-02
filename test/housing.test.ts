import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import {
  addHousingProgress, comfortDecayMultiplier, dailyHousing, evict, moveHome, vacancies,
} from '../src/economy/housing.ts';

test('vacancies reflect capacity minus occupancy', () => {
  const w = makeWorld();
  assert.deepEqual(vacancies(w), { 1: 30, 2: 15, 3: 5 });
  w.housing.occupied[1] = 30;
  w.housing.occupied[3] = 7; // over-occupied never goes negative
  assert.deepEqual(vacancies(w), { 1: 0, 2: 15, 3: 0 });
});

test('moveHome moves in, between tiers and out, adjusting occupancy and arrears', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  const res = moveHome(w, c.id, 1);
  assert.equal(res.ok, true, res.message);
  assert.equal(c.homeTier, 1);
  assert.equal(w.housing.occupied[1], 1);
  assert.ok(c.memory.some((m) => m.text.includes('Lantern Lofts')));

  c.rentArrearsDays = 2;
  assert.equal(moveHome(w, c.id, 3).ok, true);
  assert.equal(c.homeTier, 3);
  assert.equal(c.rentArrearsDays, 0);
  assert.deepEqual(w.housing.occupied, { 1: 0, 2: 0, 3: 1 });

  assert.equal(moveHome(w, c.id, 0).ok, true);
  assert.equal(c.homeTier, 0);
  assert.deepEqual(w.housing.occupied, { 1: 0, 2: 0, 3: 0 });
  assert.ok(w.events.some((e) => e.kind === 'housing'));
});

test('moveHome refuses when full, when already there, for exiles and unknown citizens', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  w.housing.capacity[2] = 0;
  assert.equal(moveHome(w, c.id, 2).ok, false);
  assert.equal(moveHome(w, c.id, 0).ok, false); // no home to leave
  moveHome(w, c.id, 1);
  assert.equal(moveHome(w, c.id, 1).ok, false);
  assert.equal(c.homeTier, 1);
  const ex = makeCitizen(w, { standing: 'exiled' });
  assert.equal(moveHome(w, ex.id, 1).ok, false);
  assert.equal(moveHome(w, 'c_404', 1).ok, false);
  assert.equal(w.housing.occupied[1], 1);
});

test('evict frees the unit, dents comfort and is remembered', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  moveHome(w, c.id, 2);
  evict(w, c.id, 'unpaid rent');
  assert.equal(c.homeTier, 0);
  assert.equal(w.housing.occupied[2], 0);
  assert.equal(c.needs.comfort, 70);
  const ev = w.events.find((e) => e.kind === 'eviction');
  assert.ok(ev && ev.actors.includes(c.id));
  assert.ok(c.memory.some((m) => m.text.includes('evicted')));
  evict(w, c.id, 'again'); // homeless already: no-op
  assert.equal(w.events.filter((e) => e.kind === 'eviction').length, 1);
});

test('addHousingProgress builds tiers in rotation 1 → 2 → 3 → 1', () => {
  const w = makeWorld();
  addHousingProgress(w, 60);
  assert.deepEqual(w.housing.capacity, { 1: 30, 2: 15, 3: 5 });
  addHousingProgress(w, 40);
  assert.deepEqual(w.housing.capacity, { 1: 31, 2: 15, 3: 5 });
  assert.equal(w.housing.progress, 0);
  addHousingProgress(w, 250);
  assert.deepEqual(w.housing.capacity, { 1: 31, 2: 16, 3: 5 });
  addHousingProgress(w, 650);
  assert.deepEqual(w.housing.capacity, { 1: 31, 2: 16, 3: 6 });
  assert.equal(w.housing.progress, 50);
  addHousingProgress(w, 50);
  assert.deepEqual(w.housing.capacity, { 1: 32, 2: 16, 3: 6 });
  assert.equal(w.events.filter((e) => e.kind === 'housing').length, 4);
  addHousingProgress(w, -10);
  addHousingProgress(w, Number.NaN);
  assert.equal(w.housing.progress, 0);
});

test('a large progress windfall completes several units at once', () => {
  const w = makeWorld();
  addHousingProgress(w, 100 + 250 + 600 + 100 + 30);
  assert.deepEqual(w.housing.capacity, { 1: 32, 2: 16, 3: 6 });
  assert.equal(w.housing.progress, 30);
});

test('dailyHousing collects rent, tracks arrears, evicts after three days and conserves money', () => {
  const w = makeWorld();
  const payer = makeCitizen(w, { wallet: 100 });
  const broke = makeCitizen(w, { wallet: 3 });
  const homeless = makeCitizen(w, { wallet: 50 });
  const exiled = makeCitizen(w, { wallet: 50, standing: 'exiled' });
  moveHome(w, payer.id, 2);
  moveHome(w, broke.id, 1);
  moveHome(w, exiled.id, 1);
  exiled.standing = 'exiled';
  const before = totalMoney(w);
  const t0 = w.treasury.balance;

  dailyHousing(w);
  assert.equal(payer.wallet, 80);
  assert.equal(payer.needs.comfort, 85);
  assert.equal(w.treasury.balance, t0 + 20);
  assert.equal(w.treasury.totals.rent, 20);
  assert.equal(broke.wallet, 3);
  assert.equal(broke.rentArrearsDays, 1);
  assert.equal(homeless.wallet, 50);
  assert.equal(exiled.homeTier, 0); // exiles are quietly vacated, not charged
  assert.equal(totalMoney(w), before);

  dailyHousing(w);
  assert.equal(broke.rentArrearsDays, 2);
  assert.equal(broke.homeTier, 1);
  dailyHousing(w);
  assert.equal(broke.homeTier, 0);
  assert.equal(broke.rentArrearsDays, 0);
  assert.ok(w.events.some((e) => e.kind === 'eviction' && e.actors.includes(broke.id)));
  assert.equal(w.housing.occupied[1], 0);
  assert.equal(totalMoney(w), before);

  // a windfall clears arrears
  const late = makeCitizen(w, { wallet: 0 });
  moveHome(w, late.id, 1);
  dailyHousing(w);
  assert.equal(late.rentArrearsDays, 1);
  late.wallet = 20;
  dailyHousing(w);
  assert.equal(late.rentArrearsDays, 0);
  assert.equal(late.wallet, 12);
});

test('dailyHousing quietly frees the homes of emigrants without charging or evicting them', () => {
  const w = makeWorld();
  const gone = makeCitizen(w, { wallet: 100 });
  moveHome(w, gone.id, 1);
  w.order = w.order.filter((id) => id !== gone.id);
  dailyHousing(w);
  assert.equal(gone.homeTier, 0);
  assert.equal(gone.wallet, 100);
  assert.equal(w.housing.occupied[1], 0);
  assert.equal(w.events.filter((e) => e.kind === 'eviction').length, 0);
});

test('comfortDecayMultiplier matches the housing table', () => {
  assert.equal(comfortDecayMultiplier(0), 2.0);
  assert.equal(comfortDecayMultiplier(1), 1.0);
  assert.equal(comfortDecayMultiplier(2), 0.7);
  assert.equal(comfortDecayMultiplier(3), 0.4);
});
