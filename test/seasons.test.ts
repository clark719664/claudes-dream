import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Weather, World } from '../src/types.ts';
import { WEATHERS } from '../src/types.ts';
import { WEATHER_TABLE, YEAR_CYCLES } from '../src/data/metropolis.ts';
import {
  AMBIENT_ENERGY_PER_CITIZEN, CULTURE_BONUS_BLAZE, CULTURE_BONUS_CLEAR, ENERGY_FACTORS, SHELTER_TIER,
  applyWeatherDemand, applyWeatherNeeds, cultureDemandBonus, dailySeasons, describeSky, festivalScale,
  rollWeather, seasonOf, weatherEnergyFactor, yearOf,
} from '../src/world/seasons.ts';

const CYCLE = 28;

test('the season turns on the cycle boundary and the year on the fourth turn', () => {
  const w = makeWorld({ cycleDays: CYCLE });
  assert.equal(seasonOf(w, 0), 'bloom');
  assert.equal(seasonOf(w, CYCLE - 1), 'bloom');
  assert.equal(seasonOf(w, CYCLE), 'blaze');
  assert.equal(seasonOf(w, CYCLE * 2), 'fall');
  assert.equal(seasonOf(w, CYCLE * 3), 'frost');
  assert.equal(seasonOf(w, CYCLE * YEAR_CYCLES), 'bloom', 'the year comes round');
  assert.equal(yearOf(w, 0), 0);
  assert.equal(yearOf(w, CYCLE * YEAR_CYCLES - 1), 0);
  assert.equal(yearOf(w, CYCLE * YEAR_CYCLES), 1);
  assert.equal(yearOf(w, CYCLE * YEAR_CYCLES * 3 + 5), 3);
});

test('weather is drawn from the season and is the same for the same seed', () => {
  const runs: Weather[][] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const w = makeWorld({ seed: 11 });
    const drawn: Weather[] = [];
    for (const season of ['bloom', 'blaze', 'fall', 'frost'] as const) {
      w.season = season;
      for (let i = 0; i < 20; i++) {
        const weather = rollWeather(w);
        assert.ok(WEATHERS.includes(weather));
        assert.ok((WEATHER_TABLE[season][weather] ?? 0) > 0, `${weather} cannot fall in ${season}`);
        drawn.push(weather);
      }
    }
    runs.push(drawn);
  }
  assert.deepEqual(runs[0], runs[1], 'the same seed draws the same year');
  assert.ok(new Set(runs[0]).size > 1, 'the sky is not always the same');
});

test('snow falls in Frost and never in Blaze', () => {
  assert.ok((WEATHER_TABLE.frost.snow ?? 0) > 0);
  assert.equal(WEATHER_TABLE.blaze.snow ?? 0, 0);
  assert.ok((WEATHER_TABLE.blaze.heat ?? 0) > 0);
  for (const season of ['bloom', 'blaze', 'fall', 'frost'] as const) {
    const sum = WEATHERS.reduce((n, weather) => n + (WEATHER_TABLE[season][weather] ?? 0), 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${season} odds sum to ${sum}`);
  }
});

test('the morning sets the sky, tells the city when the season turns, and is quiet otherwise', () => {
  const w = makeWorld({ cycleDays: CYCLE });
  const c = makeCitizen(w);
  w.season = 'frost';
  w.year = 3;
  dailySeasons(w);
  assert.equal(w.season, 'bloom');
  assert.equal(w.year, 0);
  assert.ok(WEATHERS.includes(w.weather));
  const first = w.events.filter((e) => e.kind === 'weather');
  assert.equal(first.length, 1);
  assert.equal(first[0].weight, 0.6, 'the first morning is a turn of the season');
  assert.ok(c.memory.some((m) => m.text.includes('Bloom')));

  const remembered = c.memory.length;
  w.day = 1;
  dailySeasons(w);
  const second = w.events.filter((e) => e.kind === 'weather');
  assert.equal(second.length, 2);
  assert.equal(second[1].weight, 0.2, 'an ordinary morning is a footnote');
  assert.equal(c.memory.length, remembered, 'nobody writes down an ordinary sky');

  w.day = CYCLE;
  dailySeasons(w);
  assert.equal(w.season, 'blaze');
  assert.equal(w.events.filter((e) => e.kind === 'weather' && e.weight === 0.6).length, 2);
  assert.ok(c.memory.some((m) => m.text.includes('Blaze')));
});

test('frost doubles the energy a shift draws; heat and snow cost something too', () => {
  const w = makeWorld({ cycleDays: CYCLE });
  w.season = 'bloom';
  w.weather = 'clear';
  assert.equal(weatherEnergyFactor(w), 1);
  w.weather = 'snow';
  assert.equal(weatherEnergyFactor(w), ENERGY_FACTORS.snow);
  w.weather = 'heat';
  assert.equal(weatherEnergyFactor(w), ENERGY_FACTORS.heat);
  w.season = 'frost';
  w.weather = 'clear';
  assert.equal(weatherEnergyFactor(w), ENERGY_FACTORS.frost);
  assert.equal(ENERGY_FACTORS.frost, 2);
});

test('rain lowers social, a good home halves it, and a clear day cheers everyone alike', () => {
  const w = makeWorld();
  w.weather = 'rain';
  const rough = makeCitizen(w, { homeTier: 0 });
  const housed = makeCitizen(w, { homeTier: SHELTER_TIER });
  const exiled = makeCitizen(w, { homeTier: 0, standing: 'exiled' });
  const social = rough.needs.social;
  applyWeatherNeeds(w);
  assert.equal(rough.needs.social, social - 3);
  assert.equal(housed.needs.social, social - 1.5, 'a roof keeps half the rain off');
  assert.equal(exiled.needs.social, social, 'an exile is not standing in Reverie');

  w.weather = 'clear';
  applyWeatherNeeds(w);
  assert.equal(rough.needs.social, social - 1);
  assert.equal(housed.needs.social, social + 0.5, 'shelter does not keep the sun out');
});

test('every sky touches a need, and none of them touches a wallet', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  const before = totalMoney(w);
  const touched: Record<string, boolean> = {};
  for (const weather of WEATHERS) {
    w.weather = weather;
    const needs = { ...c.needs };
    applyWeatherNeeds(w);
    touched[weather] = (Object.keys(needs) as (keyof typeof needs)[]).some((n) => c.needs[n] !== needs[n]);
    c.needs = { energy: 80, rest: 80, social: 80, comfort: 80, purpose: 80 };
  }
  for (const weather of WEATHERS) assert.equal(touched[weather], true, `${weather} does nothing at all`);
  assert.equal(totalMoney(w), before);
  assert.ok(c.mood > 0 && c.mood <= 100);
});

test('ambient demand takes goods from the Bazaar and never a lumen', () => {
  const w = makeWorld({ cycleDays: CYCLE });
  for (let i = 0; i < 10; i++) makeCitizen(w);
  const before = totalMoney(w);
  const energy = w.market.goods.energy.stock;
  w.season = 'frost';
  w.weather = 'snow';
  applyWeatherDemand(w);
  const drawn = Math.round(10 * (ENERGY_FACTORS.frost - 1) * AMBIENT_ENERGY_PER_CITIZEN);
  assert.equal(w.market.goods.energy.stock, energy - drawn);
  assert.ok(drawn > 0);
  assert.equal(totalMoney(w), before, 'the cold is not a purchase');

  const culture = w.market.goods.culture.stock;
  w.season = 'blaze';
  w.weather = 'clear';
  applyWeatherDemand(w);
  assert.equal(w.market.goods.culture.stock, culture - CULTURE_BONUS_BLAZE);
  assert.equal(totalMoney(w), before);
});

test('culture demand rises in Blaze and on a clear day, and festivals shrink in bad weather', () => {
  const w = makeWorld();
  w.season = 'blaze';
  w.weather = 'rain';
  assert.equal(cultureDemandBonus(w), CULTURE_BONUS_BLAZE);
  w.season = 'fall';
  w.weather = 'clear';
  assert.equal(cultureDemandBonus(w), CULTURE_BONUS_CLEAR);
  w.weather = 'fog';
  assert.equal(cultureDemandBonus(w), 0);

  w.weather = 'clear';
  assert.equal(festivalScale(w), 1);
  w.weather = 'rain';
  assert.equal(festivalScale(w), 0.6);
  w.weather = 'storm';
  assert.equal(festivalScale(w), 0.3);
  w.weather = 'snow';
  assert.equal(festivalScale(w), 0.7);
  w.weather = 'fog';
  assert.equal(festivalScale(w), 1, 'fog does not put the lanterns out');
});

test('the sky reads plainly, even in a world that predates the seasons', () => {
  const w = makeWorld();
  w.day = 41;
  w.season = 'bloom';
  w.weather = 'clear';
  assert.equal(describeSky(w), 'Day 41 · Bloom · clear');
  delete (w as { season?: unknown }).season;
  delete (w as { weather?: unknown }).weather;
  assert.equal(describeSky(w), 'Day 41 · Blaze · clear');
  assert.equal(festivalScale(w), 1);
  assert.equal(weatherEnergyFactor(w), 1);
  const empty: World = makeWorld();
  empty.order = [];
  applyWeatherNeeds(empty);
  applyWeatherDemand(empty);
  dailySeasons(empty);
  assert.ok(empty.events.length > 0);
});
