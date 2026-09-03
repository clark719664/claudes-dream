/**
 * The year over Reverie: four seasons and a sky that changes every morning.
 *
 * A year is `YEAR_CYCLES` council cycles — Bloom, Blaze, Fall, Frost — and the
 * weather is drawn each day from that season's table, so a citizen learns what
 * a Frost morning costs it the same way it learns everything else: by living
 * through one. The sky is a fact of the world, never advice: it moves needs,
 * it changes how much energy a shift draws and how big a festival feels, and
 * nothing here tells anybody what to do about it.
 *
 * Weather demand is *ambient*: the city burns a little more energy in the cold
 * and wants a little more culture in the heat, and that draw goes through
 * `takeFromMarket`, which moves goods and never money. The money audit is
 * untouched by the weather.
 */
import { SEASONS, WEATHERS, clamp } from '../types.ts';
import type { Citizen, Need, Season, Weather, World } from '../types.ts';
import { SEASON_NAMES, WEATHER_NAMES, WEATHER_TABLE, YEAR_CYCLES } from '../data/metropolis.ts';
import { rand } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { takeFromMarket } from '../economy/market.ts';
import { computeMood, isPresent } from '../citizens/citizen.ts';

/**
 * Ambient energy one citizen draws for warmth or cooling, per whole point of
 * `weatherEnergyFactor` above 1. Frost with forty citizens costs the Bazaar
 * twenty units of energy a day and nobody a single lumen.
 */
export const AMBIENT_ENERGY_PER_CITIZEN = 0.5;

/** A home of this tier or better halves what the sky takes out of a citizen. */
export const SHELTER_TIER = 2;

/** What a day of each sky does to a citizen who stands out in it. */
export const WEATHER_NEEDS: Record<Weather, Partial<Record<Need, number>>> = {
  clear: { social: 2 },
  rain: { social: -3 },
  storm: { rest: -4 },
  fog: { purpose: -2 },
  heat: { energy: -3 },
  snow: { comfort: -3 },
};

/** Energy a shift draws, by the season first and then the day's weather. */
export const ENERGY_FACTORS = { frost: 2, snow: 1.6, heat: 1.3 } as const;

/** Extra units of culture the city wants each day. */
export const CULTURE_BONUS_BLAZE = 3;
export const CULTURE_BONUS_CLEAR = 1;

/** How much of a festival survives the weather. */
export const FESTIVAL_SCALES: Partial<Record<Weather, number>> = { rain: 0.6, storm: 0.3, snow: 0.7 };

function addNeed(c: Citizen, need: Need, delta: number): void {
  c.needs[need] = clamp(c.needs[need] + delta, 0, 100);
}

/** Everyone living in the city, in turn order. */
function presentCitizens(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && isPresent(world, c)) out.push(c);
  }
  return out;
}

/** Days in one turn of the year. */
function yearDays(world: World): number {
  return Math.max(1, Math.round(world.config.cycleDays)) * Math.max(1, Math.round(YEAR_CYCLES));
}

/** The season a day falls in: one season per council cycle, four to the year. */
export function seasonOf(world: World, day: number = world.day): Season {
  const cycle = Math.max(1, Math.round(world.config.cycleDays));
  const span = yearDays(world);
  const d = Math.floor(Number.isFinite(day) ? day : 0);
  const into = ((d % span) + span) % span;
  return SEASONS[Math.min(SEASONS.length - 1, Math.floor(into / cycle))];
}

/** Years since the founding; the founding day is year 0. */
export function yearOf(world: World, day: number = world.day): number {
  const d = Math.floor(Number.isFinite(day) ? day : 0);
  return Math.floor(d / yearDays(world));
}

/** The season the world is standing in, falling back to the calendar for an old save. */
function currentSeason(world: World): Season {
  return world.season ?? seasonOf(world);
}

/** The sky the world is standing under, falling back to clear for an old save. */
function currentWeather(world: World): Weather {
  return world.weather ?? 'clear';
}

/** Draw tomorrow's sky from this season's table. Cumulative, so the stream moves exactly once. */
export function rollWeather(world: World): Weather {
  const row = WEATHER_TABLE[currentSeason(world)] ?? WEATHER_TABLE.bloom;
  let roll = rand(world);
  let last: Weather = 'clear';
  for (const w of WEATHERS) {
    const p = row?.[w] ?? 0;
    if (p <= 0) continue;
    last = w;
    roll -= p;
    if (roll < 0) return w;
  }
  return last;
}

/**
 * The morning's sky. Called early in the rollover, before anything reads it:
 * the season and the year from the calendar, then one draw of weather, then
 * what that does to everyone standing in it and to the city's appetite.
 */
export function dailySeasons(world: World): void {
  const season = seasonOf(world);
  const year = yearOf(world);
  const turned = world.season !== season || world.year !== year;
  world.season = season;
  world.year = year;
  world.weather = rollWeather(world);
  const weather = world.weather;
  const sky = WEATHER_NAMES[weather] ?? weather;
  if (turned) {
    emit(world, 'weather',
      `${SEASON_NAMES[season]} has come to Reverie — year ${year}, and ${sky.toLowerCase()} over the city.`,
      [], 0.6, { season, weather, year });
    for (const c of presentCitizens(world)) {
      remember(world, c.id, 'event', `${SEASON_NAMES[season]} has come to Reverie: ${sky.toLowerCase()} over the city.`);
    }
  } else {
    emit(world, 'weather', `${sky} over Reverie.`, [], 0.2, { season, weather, year });
  }
  applyWeatherNeeds(world);
  applyWeatherDemand(world);
}

/**
 * What the day's sky does to everyone who is living through it. A home of
 * tier 2 or better halves the harm (it does not halve a clear day's cheer:
 * shelter keeps the rain off, it does not keep the sun out).
 */
export function applyWeatherNeeds(world: World): void {
  const effects = WEATHER_NEEDS[currentWeather(world)] ?? {};
  const entries = Object.entries(effects) as [Need, number][];
  if (entries.length === 0) return;
  for (const c of presentCitizens(world)) {
    const sheltered = c.homeTier >= SHELTER_TIER;
    for (const [need, delta] of entries) addNeed(c, need, sheltered && delta < 0 ? delta / 2 : delta);
    c.mood = computeMood(c);
  }
}

/** Energy a shift draws today: Frost doubles it, snow and heat cost something too. */
export function weatherEnergyFactor(world: World): number {
  if (currentSeason(world) === 'frost') return ENERGY_FACTORS.frost;
  const w = currentWeather(world);
  if (w === 'snow') return ENERGY_FACTORS.snow;
  if (w === 'heat') return ENERGY_FACTORS.heat;
  return 1;
}

/** Extra units of culture the city wants today (Blaze evenings, and clear days generally). */
export function cultureDemandBonus(world: World): number {
  if (currentSeason(world) === 'blaze') return CULTURE_BONUS_BLAZE;
  if (currentWeather(world) === 'clear') return CULTURE_BONUS_CLEAR;
  return 0;
}

/** How much of a festival the weather leaves standing: 1 in a clear sky. */
export function festivalScale(world: World): number {
  return FESTIVAL_SCALES[currentWeather(world)] ?? 1;
}

/**
 * The city's ambient appetite: warmth in the cold, shade in the heat, and
 * something to look at in Blaze. Goods move, money does not.
 */
export function applyWeatherDemand(world: World): void {
  const factor = weatherEnergyFactor(world);
  if (factor > 1) {
    const heads = presentCitizens(world).length;
    const extra = Math.round(heads * (factor - 1) * AMBIENT_ENERGY_PER_CITIZEN);
    if (extra > 0) takeFromMarket(world, 'energy', extra);
  }
  if (currentSeason(world) === 'blaze') {
    const culture = cultureDemandBonus(world);
    if (culture > 0) takeFromMarket(world, 'culture', culture);
  }
}

/** "Day 41 · Bloom · clear" — the line the Chronicle and the dashboard head the day with. */
export function describeSky(world: World): string {
  const season = SEASON_NAMES[currentSeason(world)] ?? currentSeason(world);
  const weather = (WEATHER_NAMES[currentWeather(world)] ?? currentWeather(world)).toLowerCase();
  return `Day ${world.day} · ${season} · ${weather}`;
}
