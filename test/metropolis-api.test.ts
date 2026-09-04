/**
 * The metropolis API, checked against a city that actually ran: eight days of
 * reflex minds, then every new route read off the world they made.
 *
 * What this file is for (docs/MODULES_METROPOLIS_FULL.md §9): the five new
 * routes answer 200 with the documented shape, `/api/portrait/:id.svg` is an
 * SVG, `/api/profile/:id` carries no private field, an unknown id is 404, and
 * no route anywhere accepts a mutating method — a dashboard is a window
 * (docs/PRINCIPLES.md §1). Reading the city must also leave it exactly as it
 * was: same money, same clock, same random stream.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { CitizenId, World } from '../src/types.ts';
import { createReflexRegistry, createWorld, stepTick } from '../src/world/world.ts';
import { RemoteBroker } from '../src/brains/remote.ts';
import { startServer } from '../src/server/server.ts';
import type { RunningServer } from '../src/server/server.ts';
import { totalMoney } from './helpers.ts';

/** One city hour per real hour: the world holds still while the views are read. */
const SLOW_CLOCK = 3_600_000;
const DAYS = 8;

type Json = Record<string, unknown>;

let world: World;
let broker: RemoteBroker;
let running: RunningServer;
let base = '';
let someone: CitizenId = '';

const get = (path: string) => fetch(base + path);
const json = async (path: string): Promise<Json> => {
  const res = await get(path);
  assert.equal(res.status, 200, `GET ${path}`);
  return await res.json() as Json;
};
const has = (body: Json, keys: readonly string[], where: string): void => {
  for (const key of keys) assert.ok(key in body, `${where} must carry ${key}`);
};

before(async () => {
  world = createWorld({ seed: 29, seedPopulation: 12, arrivalRate: 0.4 });
  const brains = createReflexRegistry();
  for (let i = 0; i < DAYS * 24; i++) await stepTick(world, brains);
  assert.equal(world.counters.engineErrors ?? 0, 0, 'the city ran without an engine error');
  broker = new RemoteBroker({ timeoutMs: 500 });
  running = await startServer(world, {
    port: 0, broker, brains, tickMs: SLOW_CLOCK, log: () => {},
  });
  base = `http://127.0.0.1:${running.port}`;
  someone = world.order[0];
});

after(() => {
  running.stop();
  broker.close();
});

// ------------------------------------------------------- the documented shape

test('GET /api/city answers with the front page the contract describes', async () => {
  const city = await json('/api/city');
  has(city, [
    'clock', 'season', 'weather', 'year', 'festival', 'nextFestival', 'mayor', 'approval', 'treasury',
    'league', 'papers', 'lead', 'happenings', 'populationByDistrict', 'disasters', 'openDistricts',
  ], '/api/city');
  has(city.clock as Json, ['tick', 'day', 'hour', 'text', 'weekday', 'weekdayName'], '/api/city clock');
  assert.equal((city.clock as Json).day, world.day);
  assert.ok(['bloom', 'blaze', 'fall', 'frost'].includes(city.season as string));
  assert.ok(['clear', 'rain', 'storm', 'fog', 'heat', 'snow'].includes(city.weather as string));
  const treasury = city.treasury as Json;
  assert.equal(treasury.balance, world.treasury.balance);
  const series = treasury.series as Json[];
  assert.ok(series.length > 0 && series.length <= 30, 'the sparkline is the last thirty days at most');
  assert.equal((city.papers as Json[]).length, 2, 'both papers');
  assert.ok(Array.isArray(city.league) && (city.league as unknown[]).length <= 3);
  const perDistrict = city.populationByDistrict as Record<string, number>;
  assert.equal(Object.values(perDistrict).reduce((a, b) => a + b, 0), city.population);
  for (const d of city.openDistricts as string[]) assert.ok(d in perDistrict, `${d} is counted`);
});

test('GET /api/culture answers with works, the Museum, the league, the papers, schools and menus', async () => {
  const culture = await json('/api/culture');
  has(culture, ['works', 'museum', 'league', 'papers', 'schools', 'menus'], '/api/culture');
  has(culture.works as Json, ['count', 'top', 'all'], '/api/culture works');
  has(culture.museum as Json, ['count', 'value', 'collection'], '/api/culture museum');
  has(culture.league as Json, ['table', 'teams', 'matches', 'fixtures'], '/api/culture league');
  has(culture.papers as Json, ['readership', 'pages'], '/api/culture papers');
  has(culture.schools as Json, ['shares', 'schools'], '/api/culture schools');
  has(culture.menus as Json, ['dishes', 'cafes', 'best'], '/api/culture menus');
  const shares = (culture.schools as Json).shares as Record<string, number>;
  assert.equal(Math.round(Object.values(shares).reduce((a, b) => a + b, 0) * 100) / 100, 1, 'the shares add to one');
  for (const w of (culture.works as Json).all as Json[]) {
    has(w, ['id', 'kind', 'title', 'popularity', 'reviews', 'inMuseum'], 'a work');
  }
});

test('GET /api/history answers with eras, records, monuments, memorials, disasters and a series', async () => {
  const history = await json('/api/history');
  has(history, ['eras', 'records', 'monuments', 'memorials', 'disasters', 'stats', 'timeline', 'exiles'], '/api/history');
  const stats = history.stats as Json;
  has(stats, ['firstDay', 'lastDay', 'totalDays', 'series'], '/api/history stats');
  const series = stats.series as Json[];
  assert.equal(series.length, world.stats.length);
  assert.equal(stats.totalDays, world.stats.length);
  for (let i = 1; i < series.length; i++) {
    assert.ok((series[i].day as number) > (series[i - 1].day as number), 'one row per day, in order');
  }
  assert.ok((history.eras as Json[]).length >= 1, 'the city is living through an era');
});

test('GET /api/profile/:id is a whole life and carries nothing private', async () => {
  const profile = await json(`/api/profile/${someone}`);
  has(profile, [
    'portraitSvg', 'epithet', 'story', 'goals', 'needs', 'skills', 'family', 'relationships',
    'clubs', 'team', 'party', 'school', 'union', 'gang', 'works', 'record', 'posts', 'diary',
    'timeline', 'belongings',
  ], '/api/profile');
  assert.match(profile.portraitSvg as string, /^<svg /);
  has(profile.family as Json, ['partner', 'parents', 'children', 'siblings'], 'the family tree');
  has(profile.relationships as Json, ['friends', 'rivals', 'affections', 'feuds', 'web'], 'the relationship web');
  for (const node of ((profile.relationships as Json).web as Json).nodes as Json[]) {
    assert.equal(typeof node.portrait, 'string', 'every face on the web has a portrait');
  }

  // Every citizen, not just this one: nothing private ever reaches a profile.
  for (const id of Object.keys(world.citizens)) {
    const res = await get(`/api/profile/${id}`);
    assert.equal(res.status, 200, `profile of ${id}`);
    const text = await res.text();
    const body = JSON.parse(text) as Json;
    for (const key of ['notes', 'letters', 'apiKeyHash', 'callbackUrl', 'personality', 'birthTraits']) {
      assert.equal(key in body, false, `/api/profile/${id} must not carry ${key}`);
    }
    // `honesty`, `diligence` and `sociability` are also public *character*
    // readings; `curiosity` and `ambition` belong to the hidden roll alone, so
    // their appearance anywhere would be a leak.
    for (const trait of ['curiosity', 'ambition']) {
      assert.equal(text.includes(`"${trait}"`), false, `no rolled trait leaks from /api/profile/${id}`);
    }
    const character = body.character as Record<string, number>;
    for (const t of ['honesty', 'diligence', 'sociability', 'generosity', 'civic']) {
      assert.equal(typeof character[t], 'number', `the public character carries ${t}`);
    }
    const c = world.citizens[id];
    if (c.notes.length > 0) for (const note of c.notes) assert.equal(text.includes(note), false, 'a note is nobody else\'s');
    if (c.letters.length > 0) for (const l of c.letters) assert.equal(text.includes(l.text), false, 'a letter home is private');
  }
});

test('GET /api/portrait/:id.svg is an image, cached for a day', async () => {
  const res = await get(`/api/portrait/${someone}.svg`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^image\/svg\+xml/);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
  const svg = await res.text();
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  for (const id of world.order.slice(0, 6)) {
    const one = await get(`/api/portrait/${id}.svg`);
    assert.equal(one.status, 200, `every citizen has a face (${id})`);
  }
});

test('an id nobody has is 404 on every route that takes one', async () => {
  for (const path of ['/api/profile/c_99999', '/api/portrait/c_99999.svg', '/api/citizens/c_99999']) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
  }
});

test('no route changes the city: every mutating method is refused', async () => {
  const paths = [
    '/api/city', '/api/culture', '/api/history', '/api/map', '/api/state',
    '/api/citizens', '/api/economy', '/api/government', '/api/court', '/api/society',
    '/api/bans', '/api/chronicle', `/api/profile/${someone}`, `/api/portrait/${someone}.svg`,
    `/api/citizens/${someone}`,
  ];
  for (const path of paths) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(res.status, 405, `${method} ${path}`);
    }
  }
  for (const path of ['/api/sim', '/api/sim/step', '/api/sim/pause', '/api/sim/speed']) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test('reading the city leaves it exactly as it was', async () => {
  const money = totalMoney(world);
  const { tick, day, hour } = world;
  const rng = world.rng.s;
  const events = world.events.length;
  const paths = [
    '/api/city', '/api/culture', '/api/history', '/api/map', '/api/state', '/api/citizens',
    '/api/economy', '/api/government', '/api/court', '/api/society', '/api/bans', '/api/chronicle',
    `/api/profile/${someone}`, `/api/portrait/${someone}.svg`,
  ];
  for (const path of paths) assert.equal((await get(path)).status, 200, path);
  assert.equal(totalMoney(world), money, 'a view never moves a lumen');
  assert.equal(world.rng.s, rng, 'a view never draws from the random stream');
  assert.deepEqual({ tick: world.tick, day: world.day, hour: world.hour }, { tick, day, hour }, 'the clock is untouched');
  assert.equal(world.events.length, events, 'a view never emits an event');
});
