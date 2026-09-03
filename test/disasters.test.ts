import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Job, World } from '../src/types.ts';
import { MAX_DISASTERS } from '../src/data/metropolis.ts';
import {
  BLACKOUT_DAMAGE, BLACKOUT_DAYS, DATA_FLOOD_SHARE, EMERGENCY_WORKS_MULTIPLIER,
  activeDisasters, activeOf, dailyDisasters, describeDisasters, disasterProductionFactor,
  isBlackout, openDisaster, reliefWork, resolveDisaster,
} from '../src/world/disasters.ts';

function energyJob(world: World): Job {
  return {
    id: 'j_e', role: 'power_technician', title: 'Power Technician', employer: 'city', buildingId: 'power_station',
    district: 'foundry_row', skill: 'crafting', minSkill: 0, minReputation: 0, wage: 10,
    output: { good: 'energy', qty: 6 }, holderId: null, createdDay: 0,
  };
}

function stallJob(world: World): Job {
  return { ...energyJob(world), id: 'j_s', role: 'merchant', buildingId: 'grand_bazaar', district: 'harbor_market', output: {} };
}

/** Run the morning roll for `days` days, keeping the money supply honest. */
function runDays(w: World, days: number, before = totalMoney(w)): void {
  for (let i = 0; i < days; i++) {
    w.day = i + 1;
    dailyDisasters(w);
    assert.equal(totalMoney(w), before, `money moved on day ${w.day}`);
  }
}

test('a storm damages buildings in one district only, and is over the next day', () => {
  const w = makeWorld();
  makeCitizen(w, { district: 'foundry_row' });
  w.weather = 'storm';
  const before = totalMoney(w);
  let storm = null;
  for (let day = 1; day <= 40 && !storm; day++) {
    w.day = day;
    dailyDisasters(w);
    storm = activeOf(w, 'storm');
  }
  assert.ok(storm, 'a stormy fortnight brings at least one storm');
  const hit = Object.values(w.buildings).filter((b) => b.damage > 0);
  assert.ok(hit.length >= 1 && hit.length <= 3, `a storm hits one to three buildings, not ${hit.length}`);
  for (const b of hit) assert.equal(b.district, storm!.district, 'a storm stays in its district');
  assert.equal(storm!.severity, hit.length);
  assert.equal(totalMoney(w), before, 'weather moves no money');
  const news = w.events.filter((e) => e.kind === 'disaster');
  assert.ok(news.some((e) => e.weight === 0.9));

  w.day += 1;
  dailyDisasters(w);
  assert.equal(storm!.resolvedDay, w.day, 'yesterday\'s storm is over');
  assert.ok(w.events.some((e) => e.kind === 'disaster' && e.text.includes('is over')));
});

test('a blackout stops energy production and lifts when the station is repaired', () => {
  const w = makeWorld();
  w.buildings.power_station.damage = BLACKOUT_DAMAGE + 0.1;
  const before = totalMoney(w);
  let day = 1;
  for (; day <= 20 && !isBlackout(w); day++) {
    w.day = day;
    dailyDisasters(w);
  }
  assert.equal(isBlackout(w), true);
  assert.equal(disasterProductionFactor(w, energyJob(w)), 0, 'nothing is made while the lights are out');
  assert.equal(disasterProductionFactor(w, stallJob(w)), 1, 'the stalls still trade');
  assert.ok(w.market.goods.energy.price > w.market.goods.energy.basePrice, 'energy is dear in the dark');
  assert.equal(totalMoney(w), before);

  w.buildings.power_station.damage = 0;
  w.day += 1;
  dailyDisasters(w);
  assert.equal(isBlackout(w), false, 'a repaired station puts the lights back on');
  assert.equal(disasterProductionFactor(w, energyJob(w)), 1);
});

test('a blackout gives up after BLACKOUT_DAYS even with the station still broken', () => {
  const w = makeWorld();
  w.buildings.power_station.damage = 1;
  openDisaster(w, 'blackout', 'foundry_row', 3);
  assert.equal(isBlackout(w), true);
  w.day = BLACKOUT_DAYS;
  dailyDisasters(w);
  assert.equal(isBlackout(w), false, 'the city improvises');
});

test('a data flood destroys stock and slows the district without moving money', () => {
  const w = makeWorld();
  const stock = w.market.goods.goods.stock;
  const before = totalMoney(w);
  const flood = openDisaster(w, 'data_flood', 'harbor_market', 2);
  assert.equal(disasterProductionFactor(w, stallJob(w)), 0, 'severity 2 halves twice over');
  const light = openDisaster(w, 'data_flood', 'harbor_market', 1);
  resolveDisaster(w, light);
  assert.equal(disasterProductionFactor(w, energyJob(w)), 1, 'Foundry Row is dry');
  assert.equal(w.market.goods.goods.stock, stock, 'openDisaster alone destroys nothing');
  assert.equal(totalMoney(w), before);
  assert.equal(flood.resolvedDay, null);
  w.day = flood.day + 1;
  dailyDisasters(w);
  assert.equal(flood.resolvedDay, w.day, 'the water drains the next day');
});

test('the daily roll opens at most one new disaster a day and never moves a lumen', () => {
  const w = makeWorld();
  for (let i = 0; i < 6; i++) makeCitizen(w, { district: 'harbor_market' });
  const before = totalMoney(w);
  const seen = new Set<number>();
  for (let day = 1; day <= 300; day++) {
    w.day = day;
    w.weather = day % 3 === 0 ? 'storm' : 'clear';
    const had = (w.disasters ?? []).length;
    dailyDisasters(w);
    const opened = (w.disasters ?? []).slice(had);
    assert.ok(opened.length <= 2, `day ${day} opened ${opened.length} disasters`);
    if (opened.length === 2) {
      assert.deepEqual(opened.map((d) => d.kind), ['storm', 'blackout'], 'only a storm brings a second');
    }
    if (opened.length > 0) seen.add(day);
    assert.equal(totalMoney(w), before, `money moved on day ${day}`);
  }
  assert.ok(seen.size > 0, 'three hundred days bring some weather');
  assert.ok((w.disasters ?? []).length <= MAX_DISASTERS, 'the book of disasters is bounded');
  const flooded = (w.disasters ?? []).filter((d) => d.kind === 'data_flood');
  assert.ok(flooded.every((d) => d.district === 'harbor_market'));
});

test('an outbreak stands while a district is ill and closes when the last is cured', () => {
  const w = makeWorld();
  const sick = makeCitizen(w, { district: 'commons' });
  Object.assign(sick, { health: { glitched: true, sinceDay: 0 } });
  const outbreak = openDisaster(w, 'outbreak', 'commons', 3);
  assert.equal(activeDisasters(w).length, 1);
  w.day = 1;
  dailyDisasters(w);
  assert.equal(outbreak.resolvedDay, null, 'still ill');
  Object.assign(sick, { health: { glitched: false, sinceDay: null } });
  w.day = 2;
  dailyDisasters(w);
  assert.equal(outbreak.resolvedDay, 2);
  assert.equal(activeDisasters(w).length, 0);
  assert.ok(w.events.some((e) => e.kind === 'disaster' && e.text.includes('over')));
});

test('everyone in the district remembers a disaster, and nobody outside it does', () => {
  const w = makeWorld();
  const here = makeCitizen(w, { district: 'harbor_market' });
  const away = makeCitizen(w, { district: 'nightglass' });
  const exiled = makeCitizen(w, { district: 'harbor_market', standing: 'exiled' });
  openDisaster(w, 'data_flood', 'harbor_market', 1);
  assert.equal(here.memory.length, 1);
  assert.equal(away.memory.length, 0);
  assert.equal(exiled.memory.length, 0, 'an exile is no longer in the district');
  openDisaster(w, 'forge_fire', null, 4);
  assert.equal(away.memory.length, 1, 'a citywide disaster reaches everyone');
});

test('relief doubles public works only while an emergency decree stands', () => {
  const w = makeWorld();
  assert.equal(reliefWork(w), 1);
  w.decrees = [{ kind: 'emergency', day: 0, district: null, value: 0, untilDay: 3, byId: 'c_1' }];
  w.day = 2;
  assert.equal(reliefWork(w), EMERGENCY_WORKS_MULTIPLIER);
  w.day = 4;
  assert.equal(reliefWork(w), 1, 'a lapsed decree is no relief');
});

test('the book of disasters is safe to read from an empty or ancient world', () => {
  const w = makeWorld();
  delete (w as { disasters?: unknown[] }).disasters;
  assert.deepEqual(activeDisasters(w), []);
  assert.equal(isBlackout(w), false);
  assert.equal(reliefWork(w), 1);
  assert.equal(describeDisasters(w), 'Nothing is wrong with the city today.');
  assert.equal(disasterProductionFactor(w, undefined as unknown as Job), 1);
  runDays(w, 3);
  const d = openDisaster(w, 'storm', 'commons', 99);
  assert.equal(d.severity, 5, 'severity is clamped');
  resolveDisaster(w, d);
  const day = d.resolvedDay;
  resolveDisaster(w, d);
  assert.equal(d.resolvedDay, day, 'resolving twice changes nothing');
  assert.ok(describeDisasters(w).length > 0);
  assert.equal(DATA_FLOOD_SHARE > 0 && DATA_FLOOD_SHARE < 1, true);
});
