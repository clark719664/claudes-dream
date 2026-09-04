import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BIOMES, generatePlanet, LAND_FRACTION } from '../src/planet/generate.ts';
import { productionMultipliers, surveyHinterland, describeHinterland } from '../src/planet/hinterland.ts';
import { findSites, foundCities, leaguesBetween, cityTrade, MAX_FROZEN_SHARE, MIN_SITE_TEMPERATURE } from '../src/planet/sites.ts';
import { buildRoutes, fastestRoute, SPEED } from '../src/planet/routes.ts';

/** A small planet: the same code paths, quick enough for a test run. */
const SMALL = { w: 256, h: 128 };
const planet = generatePlanet(7, SMALL.w, SMALL.h);

test('a planet is fully determined by its seed', () => {
  const again = generatePlanet(7, SMALL.w, SMALL.h);
  assert.deepEqual(Array.from(planet.elevation.slice(0, 500)), Array.from(again.elevation.slice(0, 500)));
  assert.deepEqual(Array.from(planet.biome), Array.from(again.biome));
  const other = generatePlanet(8, SMALL.w, SMALL.h);
  assert.notDeepEqual(Array.from(other.biome), Array.from(planet.biome), 'a different seed is a different world');
});

test('sea level puts the right share of the surface above water', () => {
  let land = 0;
  for (let i = 0; i < planet.elevation.length; i++) if (planet.elevation[i] > planet.seaLevel) land++;
  const share = land / planet.elevation.length;
  assert.ok(Math.abs(share - LAND_FRACTION) < 0.01, `land share ${share.toFixed(3)}`);
});

test('the climate obeys latitude, altitude and the rain shadow', () => {
  // The equator is warmer than the poles.
  const rowTemp = (y: number): number => {
    let t = 0;
    for (let x = 0; x < planet.w; x++) t += planet.temperature[y * planet.w + x];
    return t / planet.w;
  };
  assert.ok(rowTemp(planet.h >> 1) > rowTemp(2) + 0.3, 'equator warmer than the pole');

  // High ground is colder than low ground at the same latitude.
  const y = planet.h >> 1;
  let high = { e: -9, t: 0 }, low = { e: 9, t: 0 };
  for (let x = 0; x < planet.w; x++) {
    const i = y * planet.w + x;
    if (planet.elevation[i] <= planet.seaLevel) continue;
    if (planet.elevation[i] > high.e) high = { e: planet.elevation[i], t: planet.temperature[i] };
    if (planet.elevation[i] < low.e) low = { e: planet.elevation[i], t: planet.temperature[i] };
  }
  assert.ok(high.t < low.t, 'mountains are colder than the plain beside them');
});

test('every cell has a biome, and the world is not all one thing', () => {
  const seen = new Set<string>();
  for (let i = 0; i < planet.biome.length; i++) {
    const b = BIOMES[planet.biome[i]];
    assert.ok(b, 'biome index resolves');
    seen.add(b);
  }
  assert.ok(seen.size >= 8, `expected a varied world, saw ${seen.size} biomes`);
  assert.ok(seen.has('ocean') && seen.has('beach'), 'has seas and shores');
});

test('the coast distance field is zero at the shore and grows outward', () => {
  let shoreCells = 0, deepest = 0;
  for (let i = 0; i < planet.coastDist.length; i++) {
    if (planet.coastDist[i] === 0) shoreCells++;
    if (planet.elevation[i] <= planet.seaLevel) deepest = Math.max(deepest, planet.coastDist[i]);
  }
  assert.ok(shoreCells > 100, 'there is a coastline');
  assert.ok(deepest > 6, 'the open ocean is far from any shore');
});

test('a hinterland survey reports what the country around a place can give', () => {
  // Find some land and survey it.
  let cell = -1;
  for (let i = 0; i < planet.elevation.length; i++) {
    if (planet.elevation[i] > planet.seaLevel) { cell = i; break; }
  }
  assert.ok(cell >= 0);
  const h = surveyHinterland(planet, cell % planet.w, (cell / planet.w) | 0);
  assert.ok(h.cells > 0);
  assert.ok(h.landShare >= 0 && h.landShare <= 1);
  for (const v of Object.values(h.yields)) assert.ok(Number.isFinite(v) && v >= 0);
  const m = productionMultipliers(h);
  for (const v of Object.values(m)) assert.ok(v >= 0.25 && v <= 2.6, 'multipliers stay in a sane band');
  assert.equal(typeof describeHinterland(h), 'string');
});

test('the land chooses where the cities go', () => {
  const sites = findSites(planet, 24, 160);
  assert.ok(sites.length >= 6, `expected sites to found on, got ${sites.length}`);
  for (let i = 1; i < sites.length; i++) {
    assert.ok(sites[i - 1].quality >= sites[i].quality, 'best sites first');
  }
  // No two sites on top of each other.
  for (let a = 0; a < sites.length; a++) {
    for (let b = a + 1; b < sites.length; b++) {
      assert.ok(leaguesBetween(planet, sites[a], sites[b]) >= 160 - 1, 'sites keep their distance');
    }
  }

  const cities = foundCities(planet, sites);
  assert.equal(cities.length, 6);
  assert.deepEqual(cities.map((c) => c.name).sort(),
    ['Cinderhold', 'Marrowgate', 'Reverie', 'Solene', 'The Verge', 'Vantage']);

  // Each city stands on land, and each has its own site.
  const seats = new Set<string>();
  for (const c of cities) {
    assert.ok(planet.elevation[c.y * planet.w + c.x] > planet.seaLevel, `${c.name} is on dry land`);
    const key = `${c.x},${c.y}`;
    assert.ok(!seats.has(key), 'no two cities share a seat');
    seats.add(key);
    const trade = cityTrade(c);
    assert.ok(Array.isArray(trade.cheap) && Array.isArray(trade.dear));
  }

  // Vantage is a port by charter; if it took a seat at all, it took a coastal one.
  const vantage = cities.find((c) => c.name === 'Vantage');
  assert.ok(vantage && vantage.harbour, 'Vantage sits on a harbour');
});

test('routes cross real ground and take time to walk', () => {
  const cities = foundCities(planet, findSites(planet, 24, 160));
  const routes = buildRoutes(planet, cities);
  assert.ok(routes.length > 0, 'the cities are connected');

  for (const r of routes) {
    assert.ok(r.path.length > 1, `${r.from}-${r.to} has a path`);
    assert.ok(r.leagues > 0 && Number.isFinite(r.leagues));
    assert.ok(r.ticks >= 1);
    assert.ok(Math.abs(r.ticks - Math.ceil(r.leagues / SPEED[r.kind])) < 1e-9, 'time follows distance and speed');
    // A land route never walks on water; a sea lane never sails over land.
    for (const i of r.path) {
      const wet = planet.elevation[i] <= planet.seaLevel;
      if (r.kind === 'sea') assert.ok(wet, `${r.from}-${r.to} sea lane stays at sea`);
      else assert.ok(!wet, `${r.from}-${r.to} ${r.kind} stays on land`);
    }
    // The path is continuous: each step is to a neighbouring cell.
    for (let k = 1; k < r.path.length; k++) {
      const ax = r.path[k - 1] % planet.w, ay = (r.path[k - 1] / planet.w) | 0;
      const bx = r.path[k] % planet.w, by = (r.path[k] / planet.w) | 0;
      const dx = Math.min(Math.abs(ax - bx), planet.w - Math.abs(ax - bx));
      assert.ok(dx <= 1 && Math.abs(ay - by) <= 1, 'the path is unbroken');
    }
  }

  const pair = routes[0];
  const fastest = fastestRoute(routes, pair.from, pair.to);
  assert.ok(fastest && fastest.ticks <= pair.ticks, 'the fastest route is no slower than any other');
  assert.equal(fastestRoute(routes, 'Nowhere', 'Elsewhere'), null);
});

test('no city is ever founded on the ice, the tundra or bare rock', () => {
  // Across many worlds, not just this one: a harbour in the arctic is still
  // the arctic, and a site has to be able to feed the people on it.
  for (const seed of [1, 4, 7, 11, 19, 23, 31, 47]) {
    const world = generatePlanet(seed, 256, 128);
    const cities = foundCities(world, findSites(world, 40, 160));
    assert.ok(cities.length >= 5, `seed ${seed} founded ${cities.length} cities`);
    for (const c of cities) {
      const biome = BIOMES[world.biome[c.y * world.w + c.x]];
      assert.ok(!['ice', 'tundra', 'alpine'].includes(biome),
        `seed ${seed}: ${c.name} was founded on ${biome}`);
      assert.ok(c.hinterland.meanTemperature >= MIN_SITE_TEMPERATURE,
        `seed ${seed}: ${c.name} is too cold (${c.hinterland.meanTemperature.toFixed(2)})`);
      const frozen = (c.hinterland.biomes.ice ?? 0) + (c.hinterland.biomes.tundra ?? 0);
      assert.ok(frozen <= MAX_FROZEN_SHARE,
        `seed ${seed}: ${c.name} has ${(frozen * 100).toFixed(0)}% frozen country`);
      assert.ok(world.elevation[c.y * world.w + c.x] > world.seaLevel,
        `seed ${seed}: ${c.name} is not on dry land`);
    }
    // Vantage is the one that tempted the siting toward the poles, because a
    // frozen coast still scores as a harbour.
    const vantage = cities.find((c) => c.name === 'Vantage');
    if (vantage) {
      assert.ok(Math.abs(vantage.lat) < 1.15,
        `seed ${seed}: Vantage sits at ${(vantage.lat * 180 / Math.PI).toFixed(0)} degrees`);
    }
  }
});
