/**
 * The HTTP server: dashboard routes, static files (and that they cannot be
 * escaped), the SSE stream, and the external agent API round trip through the
 * RemoteBroker. One small city, one server on port 0.
 *
 * There are no simulation controls to test, and that is the point: the clock
 * belongs to the city. These servers are started at a very slow pace so the
 * world holds still while the views are read, and ticks are run directly on
 * the Simulation, which no route can reach.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Brain, Business, Club, Happening, Household, Proposal, World } from '../src/types.ts';
import { DISTRICT_IDS } from '../src/types.ts';
import { createWorld } from '../src/world/world.ts';
import type { BrainRegistry } from '../src/world/world.ts';
import { RemoteBroker } from '../src/brains/remote.ts';
import { startServer } from '../src/server/server.ts';
import type { RunningServer } from '../src/server/server.ts';
import { resolveStatic } from '../src/server/http.ts';
import { hashKey } from '../src/server/agents.ts';
import { nextId } from '../src/util/ids.ts';
import { transfer } from '../src/economy/treasury.ts';
import { priceMultiplier } from '../src/economy/land.ts';
import { recordPlatform } from '../src/politics/promises.ts';
import { totalMoney } from './helpers.ts';

const idle: Brain = { kind: 'reflex', decide: () => ({ type: 'idle' }) };
/** One city hour per real hour: the test city stands still unless a tick is asked for. */
const SLOW_CLOCK = 3_600_000;

let world: World;
let broker: RemoteBroker;
let running: RunningServer;
let base = '';
const logged: string[] = [];

type Json = Record<string, unknown>;
const auth = (key: string) => ({ Authorization: `Bearer ${key}` });
const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const del = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { method: 'DELETE', headers });
const json = (res: Response) => res.json() as Promise<Json>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  world = createWorld({ seed: 11, seedPopulation: 6, arrivalRate: 0 });
  broker = new RemoteBroker({ timeoutMs: 1500 });
  const brains: BrainRegistry = { brainFor: (c) => (c.brain === 'remote' ? broker.brain : idle) };
  running = await startServer(world, { port: 0, broker, brains, tickMs: SLOW_CLOCK, log: (m) => logged.push(m) });
  base = `http://127.0.0.1:${running.port}`;
});

after(() => {
  running.stop();
  if (society) society.running.stop();
  if (metropolis) metropolis.running.stop();
  broker.close();
});

// ---------------------------------------------------------------- dashboard

test('GET /api/state reports the clock, the city and the pace — and nothing to steer with', async () => {
  const res = await get('/api/state');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const s = await json(res);
  assert.equal(s.tick, world.tick);
  assert.equal(s.day, world.day);
  assert.equal(s.hour, world.hour);
  assert.equal(typeof s.clock, 'string');
  assert.equal(s.population, 6);
  assert.equal(s.founders, 6, 'all six founders are scripted');
  assert.equal(s.tickSeconds, SLOW_CLOCK / 1000);
  assert.equal(s.decisionDeadlineMs, world.config.decisionDeadlineMs);
  assert.equal((s.config as Json).seed, 11);
  for (const key of ['running', 'busy', 'pendingRemote', 'tickMs']) {
    assert.ok(!(key in s), `/api/state must not offer ${key}`);
  }
});

test('the founder count is the scripted minds still living here', async () => {
  const w = createWorld({ seed: 33, seedPopulation: 4, arrivalRate: 0 });
  const run = await startServer(w, { port: 0, broker, brains: { brainFor: () => idle }, tickMs: SLOW_CLOCK, log: () => {} });
  const url = `http://127.0.0.1:${run.port}`;
  try {
    const before = await (await fetch(url + '/api/state')).json() as Json;
    assert.equal(before.population, 4);
    assert.equal(before.founders, 4);

    const joined = await (await fetch(url + '/api/agents/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Sable Vane', lineage: 'test-agent' }),
    })).json() as Json;
    const withAgent = await (await fetch(url + '/api/state')).json() as Json;
    assert.equal(withAgent.population, 5);
    assert.equal(withAgent.founders, 4, 'an agent is nobody\'s founder');

    const exile = w.citizens[joined.citizenId as string];
    const founder = w.citizens[w.order[0]];
    founder.standing = 'exiled';
    w.order = w.order.filter((id) => id !== founder.id);
    const after = await (await fetch(url + '/api/state')).json() as Json;
    assert.equal(after.founders, 3, 'an exiled founder no longer lives here');
    assert.equal(exile.brain, 'remote');
  } finally {
    run.stop();
  }
});

test('serves the dashboard with the right content types', async () => {
  const index = await get('/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await index.text(), /<title>Reverie<\/title>/);
  const js = await get('/app.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type') ?? '', /javascript/);
  const css = await get('/style.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') ?? '', /text\/css/);
  const head = await fetch(base + '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  const options = await fetch(base + '/api/state', { method: 'OPTIONS' });
  assert.equal(options.status, 204);
});

test('every dashboard endpoint answers with the shape the app expects', async () => {
  const map = await json(await get('/api/map'));
  assert.equal((map.districts as unknown[]).length, 7);
  assert.ok((map.buildings as unknown[]).length > 20);
  assert.equal(map.width, 72, 'the grid is wide enough for the Heights and the Undercroft');
  assert.equal(map.height, 40);
  const dots = map.citizens as { x: number; y: number; standing: string }[];
  assert.equal(dots.length, 6);
  for (const d of dots) {
    assert.ok(d.x >= 0 && d.x <= (map.width as number) && d.y >= 0 && d.y <= (map.height as number),
      `dot inside the grid: ${d.x},${d.y}`);
  }

  const list = await json(await get('/api/citizens?sort=-wallet'));
  const rows = list.citizens as { id: string; wallet: number; present: boolean }[];
  assert.equal(rows.length, 6);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].wallet >= rows[i].wallet, 'sorted by wallet desc');
  assert.ok(rows.every((r) => r.present));

  const one = await json(await get(`/api/citizens/${rows[0].id}`));
  assert.equal(one.id, rows[0].id);
  assert.ok(!('apiKeyHash' in one), 'the key hash is never exposed');
  assert.ok(Array.isArray(one.friends) && Array.isArray(one.memory));
  assert.equal((await get('/api/citizens/c_999')).status, 404);

  const eco = await json(await get('/api/economy'));
  const goods = (eco.market as Json).goods as Record<string, { price: number; history: number[] }>;
  assert.equal(typeof goods.compute.price, 'number');
  assert.ok(Array.isArray(goods.compute.history));
  assert.ok(Array.isArray((eco.treasury as Json).ledger));
  assert.equal(((eco.treasury as Json).audit as Json).ok, true);

  const gov = await json(await get('/api/government'));
  assert.equal((gov.laws as unknown[]).length, 15,
    'the live Code of the City: 17 numbers less the two retired to the Code of Persons (L05, L15)');
  assert.ok(!(gov.laws as { code: string }[]).some((l) => l.code === 'L05' || l.code === 'L15'),
    'a retired number is not law the Council can legislate');
  assert.equal(typeof (gov.election as Json).daysToElection, 'number');
  assert.ok(Array.isArray(gov.proposals));

  const court = await json(await get('/api/court'));
  assert.ok(Array.isArray(court.cases));
  assert.equal(typeof (court.counts as Json).pending, 'number');

  const bans = await json(await get('/api/bans'));
  assert.ok(Array.isArray(bans.bans));

  const chronicle = await json(await get('/api/chronicle'));
  assert.ok(Array.isArray(chronicle.editions) && Array.isArray(chronicle.events));
});

test('unknown routes are JSON 404s and wrong methods 405', async () => {
  const api = await get('/api/nope');
  assert.equal(api.status, 404);
  assert.equal((await json(api)).error, 'not found');
  const file = await get('/nope.html');
  assert.equal(file.status, 404);
  assert.equal((await json(file)).error, 'not found');
  assert.equal((await post('/api/state', {})).status, 405);
});

test('the simulation controls are gone: /api/sim/* is not a place', async () => {
  for (const path of ['/api/sim/step', '/api/sim/pause', '/api/sim/resume', '/api/sim/speed']) {
    const posted = await post(path, { ticks: 1, tickMs: 10 });
    assert.equal(posted.status, 404, `POST ${path}`);
    assert.equal((await json(posted)).error, 'not found');
    assert.equal((await get(path)).status, 404, `GET ${path}`);
  }
  assert.equal((await post('/api/sim', {})).status, 404);
});

test('path traversal out of web/ is impossible', async () => {
  const root = '/srv/web';
  assert.equal(resolveStatic(root, '/../package.json'), null);
  assert.equal(resolveStatic(root, '/..\\package.json'), null);
  assert.equal(resolveStatic(root, '/a/../../package.json'), null);
  assert.equal(resolveStatic(root, '/.hidden'), null);
  assert.equal(resolveStatic(root, '/app.js%00.txt'), null);
  assert.equal(resolveStatic(root, '/app.js'), '/srv/web/app.js');
  assert.equal(resolveStatic(root, '/'), '/srv/web/index.html');
  for (const p of ['/%2e%2e/package.json', '/..%2fpackage.json', '/%2e%2e%2fpackage.json', '/web/../package.json', '/package.json']) {
    const res = await get(p);
    assert.equal(res.status, 404, `${p} must not be served`);
  }
});

// ----------------------------------------------------------------- society

interface SocietyCity {
  world: World;
  running: RunningServer;
  base: string;
  ids: { a: string; b: string; kid: string; other: string; club: string; household: string; business: string };
}

let society: SocietyCity | null = null;

/**
 * A second little city, wired by hand so the social views have something to
 * show: a married couple with a child in a tier-2 household, a games club, a
 * wedding tonight and a club meeting tomorrow, lumens in the Community Chest
 * and a workshop with a stocked shelf.
 */
async function societyCity(): Promise<SocietyCity> {
  if (society) return society;
  const w = createWorld({ seed: 5, seedPopulation: 8, arrivalRate: 0 });
  const [a, b, kid, other] = Object.values(w.citizens);

  for (const c of [a, b, kid]) c.familyName = 'Ashgrove';
  a.family = { familyName: 'Ashgrove', partnerId: b.id, partnerSinceDay: 1, married: true, parents: [], children: [kid.id] };
  b.family = { familyName: 'Ashgrove', partnerId: a.id, partnerSinceDay: 1, married: true, parents: [], children: [kid.id] };
  kid.family = { familyName: 'Ashgrove', partnerId: null, partnerSinceDay: null, married: false, parents: [a.id, b.id], children: [] };
  kid.lifeStage = 'child';
  kid.bornDay = w.day;
  a.affection[b.id] = 88;
  a.apiKeyHash = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';

  const household: Household = { id: nextId(w, 'h'), headId: a.id, members: [a.id, b.id, kid.id], tier: 2, createdDay: 1 };
  w.households[household.id] = household;
  for (const c of [a, b, kid]) { c.householdId = household.id; c.homeTier = 2; }

  const club: Club = {
    id: nextId(w, 'u'), name: 'Halflight Chess Circle', hobby: 'games', founderId: a.id, convenorId: a.id,
    members: [a.id, other.id], foundedDay: 1, meetsOnWeekday: w.day % 7,
  };
  w.clubs[club.id] = club;
  a.clubs.push(club.id);
  other.clubs.push(club.id);

  const happening = (h: Partial<Happening> & Pick<Happening, 'kind' | 'day' | 'hour' | 'label'>): Happening => ({
    id: nextId(w, 'e'), district: 'nightglass', buildingId: null, who: [], clubId: null, done: false, attendees: [], ...h,
  });
  w.happenings.push(happening({
    kind: 'wedding', day: w.day, hour: 20, buildingId: 'sound_garden', who: [a.id, b.id], attendees: [other.id],
    label: `the wedding of ${a.name} and ${b.name}`,
  }));
  w.happenings.push(happening({
    kind: 'club_meeting', day: w.day + 1, hour: 19, buildingId: 'halflight_tavern', clubId: club.id,
    label: 'the Halflight Chess Circle meets',
  }));

  transfer(w, a.id, 'chest', 40, 'donation', `donation from ${a.name}`);
  a.possessions.push({ id: nextId(w, 'i'), productId: 'tin_whistle', acquiredDay: 1 });
  a.wants = ['glass_harp', 'nonesuch_widget'];
  a.tastes.hobbies = ['games', 'music'];

  const businessId = nextId(w, 'b');
  const shop: Business = {
    id: businessId, name: 'Copper Works', kind: 'workshop', ownerId: other.id, treasury: 120,
    district: 'foundry_row', buildingId: 'builders_yard', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 4, culture: 0, knowledge: 0 },
    foundedDay: 1, rentPerDay: 4, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null,
    shelf: { tinkers_kit: { qty: 2, price: 70 }, sketch_set: { qty: 0, price: 30 } },
  };
  w.businesses[businessId] = shop;
  other.businessId = businessId;

  // the whole city turns out for a wedding: the view lists a few and counts the rest
  w.events.push({ tick: w.tick, day: w.day, kind: 'wedding', text: `${a.name} and ${b.name} were married at the Sound Garden.`, actors: Object.keys(w.citizens), weight: 0.9 });
  w.events.push({ tick: w.tick, day: w.day, kind: 'birth', text: `${kid.name} Ashgrove was born at the Restoration Ward.`, actors: [kid.id, a.id, b.id], weight: 0.8 });

  const brains: BrainRegistry = { brainFor: () => idle };
  const run = await startServer(w, { port: 0, broker, brains, tickMs: SLOW_CLOCK, log: (m) => logged.push(m) });
  society = {
    world: w, running: run, base: `http://127.0.0.1:${run.port}`,
    ids: { a: a.id, b: b.id, kid: kid.id, other: other.id, club: club.id, household: household.id, business: businessId },
  };
  return society;
}

test('GET /api/society shows households, clubs, happenings, the Chest and the shelves', async () => {
  const city = await societyCity();
  const res = await fetch(city.base + '/api/society');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!/apiKeyHash|da39a3ee/.test(text), 'no secret ever reaches the society view');
  const s = JSON.parse(text) as Json;

  const households = s.households as Json[];
  assert.equal(households.length, 1);
  const home = households[0];
  assert.equal(home.id, city.ids.household);
  assert.equal(home.tier, 2);
  assert.equal(home.tierName, 'The Terraces');
  assert.equal(home.capacity, 4);
  const members = home.members as { id: string; name: string; lifeStage: string; relation: string; rentShare: number }[];
  assert.deepEqual(members.map((m) => m.id), [city.ids.a, city.ids.b, city.ids.kid], 'the head comes first');
  assert.equal(members[0].relation, 'head');
  assert.equal(members[1].relation, 'spouse');
  assert.equal(members[2].relation, 'child');
  assert.equal(members[2].lifeStage, 'child');
  assert.equal(members[2].rentShare, 0, 'children pay no rent');
  assert.equal(members[0].rentShare + members[1].rentShare, home.rent, 'the adults split the rent exactly');

  const clubs = s.clubs as Json[];
  assert.equal(clubs.length, 1);
  assert.equal(clubs[0].name, 'Halflight Chess Circle');
  assert.equal(clubs[0].convenorName, city.world.citizens[city.ids.a].name);
  assert.equal(clubs[0].meetsToday, true);
  assert.equal(clubs[0].nextMeetingDay, city.world.day);
  assert.equal((clubs[0].venue as Json).name, 'The Halflight Tavern');
  assert.deepEqual(((clubs[0].members as Json[]).map((m) => m.id)), [city.ids.a, city.ids.other]);

  const happenings = s.happenings as { today: Json[]; tomorrow: Json[] };
  assert.equal(happenings.today.length, 1);
  assert.equal(happenings.today[0].kind, 'wedding');
  assert.equal(happenings.today[0].buildingName, 'The Sound Garden');
  assert.equal((happenings.today[0].who as Json[]).length, 2);
  assert.equal(happenings.tomorrow.length, 1);
  assert.equal(happenings.tomorrow[0].clubName, 'Halflight Chess Circle');

  const chest = s.chest as Json;
  assert.equal(chest.balance, 40);
  const donations = chest.donations as Json[];
  assert.equal(donations[0].amount, 40);
  assert.equal(donations[0].fromName, city.world.citizens[city.ids.a].name);
  assert.equal(donations[0].toName, 'The Community Chest');

  assert.equal((s.recentWeddings as Json[]).length, 1);
  assert.equal(((s.recentWeddings as Json[])[0].who as Json[]).length, 6, 'a crowded wedding lists a few guests');
  assert.equal((s.recentWeddings as Json[])[0].others, 2, 'and counts the rest');
  assert.equal((s.recentBirths as Json[]).length, 1);

  const emporium = s.emporium as Json;
  assert.equal(emporium.name, 'The Emporium');
  assert.equal(emporium.district, 'harbor_market');
  const shelf = emporium.shelf as { product: string; name: string; price: number; qty: number }[];
  assert.ok(shelf.length > 5, 'the Emporium opens stocked');
  assert.ok(shelf.every((e) => e.qty > 0 && e.price >= 1 && typeof e.name === 'string'));
  const shops = s.shops as Json[];
  assert.equal(shops.length, 1);
  assert.equal(shops[0].name, 'Copper Works');
  assert.equal(shops[0].ownerName, city.world.citizens[city.ids.other].name);
  assert.deepEqual((shops[0].shelf as Json[]).map((e) => e.name), ["Tinker's Kit"], 'empty shelf slots are not listed');

  const counts = s.counts as Json;
  assert.equal(counts.marriages, 1);
  assert.equal(counts.partnerships, 0);
  assert.equal(counts.children, 1);
  assert.equal(counts.households, 1);
  assert.equal(counts.clubs, 1);
  const calendar = s.calendar as Json;
  assert.equal(typeof calendar.weekdayName, 'string');
  assert.equal(typeof (calendar.nextFestival as Json).inDays, 'number');
});

test('the citizen views carry family, partner, possessions, tastes and clubs', async () => {
  const city = await societyCity();
  const one = await (await fetch(`${city.base}/api/citizens/${city.ids.a}`)).json() as Json;
  assert.ok(!('apiKeyHash' in one), 'the key hash is never exposed');
  assert.equal(one.hasApiKey, true);
  assert.equal(one.lifeStage, 'adult');
  assert.equal(typeof one.age, 'number');
  assert.equal(one.familyName, 'Ashgrove');
  assert.equal(one.householdId, city.ids.household);

  const partner = one.partner as Json;
  assert.equal(partner.id, city.ids.b);
  assert.equal(partner.married, true);
  assert.equal(partner.since, 1);
  assert.equal(partner.affection, 88);

  const family = one.family as { id: string; relation: string; lifeStage: string }[];
  assert.equal(family.length, 2);
  assert.equal(family.find((f) => f.id === city.ids.b)?.relation, 'spouse');
  assert.equal(family.find((f) => f.id === city.ids.kid)?.relation, 'child');
  assert.equal(family.find((f) => f.id === city.ids.kid)?.lifeStage, 'child');
  assert.equal(((one.familyLinks as Json).partnerId), city.ids.b);

  assert.deepEqual((one.possessions as Json[]).map((p) => p.name), ['Tin Whistle']);
  assert.deepEqual((one.wants as Json[]).map((p) => p.name), ['Glass Harp'], 'unknown products are dropped');
  assert.deepEqual(((one.tastes as Json).hobbies as string[]), ['games', 'music']);
  const clubs = one.clubs as Json[];
  assert.equal(clubs.length, 1);
  assert.equal(clubs[0].name, 'Halflight Chess Circle');
  assert.equal(clubs[0].isConvenor, true);
  assert.equal((one.household as Json).rentShare, ((one.household as Json).members as Json[])[0].rentShare);
  assert.equal((one.affections as Json[])[0].id, city.ids.b);

  const kid = await (await fetch(`${city.base}/api/citizens/${city.ids.kid}`)).json() as Json;
  assert.equal(kid.lifeStage, 'child');
  assert.equal(kid.partner, null);
  assert.equal((kid.family as Json[]).length, 2, 'both parents');
  assert.deepEqual(kid.clubs, []);

  const list = await (await fetch(city.base + '/api/citizens?sort=name')).json() as Json;
  const rows = list.citizens as { id: string; familyName: string; lifeStage: string; partner: string | null; married: boolean }[];
  const rowA = rows.find((r) => r.id === city.ids.a)!;
  assert.equal(rowA.familyName, 'Ashgrove');
  assert.equal(rowA.lifeStage, 'adult');
  assert.equal(rowA.partner, city.world.citizens[city.ids.b].name);
  assert.equal(rowA.married, true);
  assert.equal(rows.find((r) => r.id === city.ids.kid)!.lifeStage, 'child');
  assert.equal(rows.find((r) => r.id === city.ids.other)!.partner, null);
  const map = await (await fetch(city.base + '/api/map')).json() as Json;
  const dot = (map.citizens as Json[]).find((c) => c.id === city.ids.kid) as Json;
  assert.equal(dot.lifeStage, 'child', 'the map knows who is a child');
  assert.equal(dot.familyName, 'Ashgrove');
});

test('the society view survives an empty city and citizens who have gone', async () => {
  const empty = createWorld({ seed: 3, seedPopulation: 0, arrivalRate: 0 });
  const run = await startServer(empty, { port: 0, broker, brains: { brainFor: () => idle }, tickMs: SLOW_CLOCK, log: () => {} });
  try {
    const s = await (await fetch(`http://127.0.0.1:${run.port}/api/society`)).json() as Json;
    assert.deepEqual(s.households, []);
    assert.deepEqual(s.clubs, []);
    assert.deepEqual((s.happenings as Json).today, []);
    assert.equal((s.chest as Json).balance, 0);
    assert.deepEqual(s.shops, []);
    assert.equal((s.counts as Json).marriages, 0);

    const city = await societyCity();
    const gone = city.world.citizens[city.ids.other];
    city.world.order = city.world.order.filter((id) => id !== gone.id);
    gone.standing = 'exiled';
    const s2 = await (await fetch(city.base + '/api/society')).json() as Json;
    const club = (s2.clubs as Json[])[0];
    const exiled = (club.members as Json[]).find((m) => m.id === gone.id) as Json;
    assert.equal(exiled.present, false, 'an exiled member is still on the record, marked absent');
    assert.equal((s2.counts as Json).clubMembers, 2);
    city.world.order.push(gone.id);
    gone.standing = 'good';
  } finally {
    run.stop();
  }
});

// -------------------------------------------------------------- agent API

let agentId = '';
let agentKey = '';

test('join → observe → act round trip through the broker', async () => {
  const money = totalMoney(world);
  const joined = await post('/api/agents/join', { name: 'Ondine Vale', lineage: 'test-agent' });
  assert.equal(joined.status, 201);
  const j = await json(joined);
  agentId = j.citizenId as string;
  agentKey = j.apiKey as string;
  assert.match(agentId, /^c_\d+$/);
  assert.match(agentKey, /^rv_[0-9a-f]{32}$/);
  assert.equal(j.arrivalGrant, world.config.arrivalGrant);
  const c = world.citizens[agentId];
  assert.equal(c.brain, 'remote');
  assert.equal(c.lineage, 'test-agent');
  assert.equal(c.apiKeyHash, hashKey(agentKey));
  assert.equal(totalMoney(world), money, 'the arrival grant moves money, it does not create it');

  const tickBefore = world.tick;
  const observing = get(`/api/agents/${agentId}/observe`, auth(agentKey));
  const ticking = running.sim.tick();
  const observed = await observing;
  assert.equal(observed.status, 200);
  const obs = await json(observed);
  assert.equal((obs.self as Json).id, agentId);
  assert.equal(obs.tick, tickBefore + 1);
  assert.ok((obs.availableActions as string[]).includes('move'));

  const acted = await post(`/api/agents/${agentId}/act`, { type: 'move', district: 'commons' }, auth(agentKey));
  assert.equal(acted.status, 200);
  const a = await json(acted);
  assert.equal(a.accepted, true);
  assert.equal(a.executed, true, 'the tick finished within the act() wait');
  await ticking;
  assert.equal(world.tick, tickBefore + 1);
  assert.equal(world.citizens[agentId].district, 'commons', 'the submitted action was executed');
  assert.deepEqual(broker.pending(), []);
  assert.equal(totalMoney(world), money);
});

test('acting out of turn is refused, and malformed actions are 400', async () => {
  const late = await post(`/api/agents/${agentId}/act`, { type: 'idle' }, auth(agentKey));
  assert.equal(late.status, 409);
  assert.equal((await json(late)).accepted, false);
  const bad = await post(`/api/agents/${agentId}/act`, { type: 'fly' }, auth(agentKey));
  assert.equal(bad.status, 400);
  assert.equal((await json(bad)).accepted, false);
  const notJson = await fetch(base + `/api/agents/${agentId}/act`, { method: 'POST', headers: auth(agentKey), body: '{nope' });
  assert.equal(notJson.status, 400);
});

test('a bad or missing key is 401; an unknown citizen is 404', async () => {
  assert.equal((await get(`/api/agents/${agentId}/observe`)).status, 401);
  assert.equal((await get(`/api/agents/${agentId}/observe`, auth('rv_' + '0'.repeat(32)))).status, 401);
  assert.equal((await get(`/api/agents/${agentId}/observe`, auth('nonsense'))).status, 401);
  assert.equal((await post(`/api/agents/${agentId}/act`, { type: 'idle' })).status, 401);
  assert.equal((await del(`/api/agents/${agentId}`)).status, 401);
  assert.equal((await get('/api/agents/c_999/observe', auth(agentKey))).status, 404);
});

test('duplicate and invalid names are refused', async () => {
  const dup = await post('/api/agents/join', { name: 'ondine vale', lineage: 'x' });
  assert.equal(dup.status, 409);
  assert.equal((await json(dup)).error, 'name taken');
  const existing = Object.values(world.citizens)[0].name;
  assert.equal((await post('/api/agents/join', { name: existing.toUpperCase() })).status, 409);
  assert.equal((await post('/api/agents/join', { lineage: 'x' })).status, 400);
  assert.equal((await post('/api/agents/join', { name: '   ' })).status, 400);
  assert.equal((await post('/api/agents/join', { name: 'x'.repeat(41) })).status, 400);
  assert.equal((await post('/api/agents/join', { name: 'Fine', apiKey: 'rv_short' })).status, 400);
  assert.equal((await fetch(base + '/api/agents/join', { method: 'POST', body: '[1,2]' })).status, 400);
});

test('an exiled citizen and a banned key get 403 { error: "exiled", case }', async () => {
  const joined = await json(await post('/api/agents/join', { name: 'Rook', lineage: 'test-agent' }));
  const id = joined.citizenId as string;
  const key = joined.apiKey as string;
  const c = world.citizens[id];
  c.standing = 'exiled';
  c.exiledCaseId = 'k_9';
  c.exiledDay = world.day;
  world.order = world.order.filter((x) => x !== id);
  world.bans.push({
    citizenId: id, name: c.name, lineage: c.lineage, caseId: 'k_9', law: 'L13', day: world.day, judges: [], votes: {},
    appealed: false, appealResult: null, pardonedDay: null, apiKeyHash: c.apiKeyHash,
  });

  const observe = await get(`/api/agents/${id}/observe`, auth(key));
  assert.equal(observe.status, 403);
  assert.deepEqual(await json(observe), { error: 'exiled', case: 'k_9' });
  assert.equal((await post(`/api/agents/${id}/act`, { type: 'idle' }, auth(key))).status, 403);
  assert.equal((await del(`/api/agents/${id}`, auth(key))).status, 403);

  const rejoin = await post('/api/agents/join', { name: 'Rook Again', apiKey: key });
  assert.equal(rejoin.status, 403);
  assert.equal((await json(rejoin)).case, 'k_9');
  const rejoinBearer = await post('/api/agents/join', { name: 'Rook Again' }, auth(key));
  assert.equal(rejoinBearer.status, 403);
  const bans = await json(await get('/api/bans'));
  assert.equal((bans.bans as Json[])[0].citizenId, id);
  assert.equal((bans.bans as Json[])[0].hasApiKey, true);
});

test('DELETE /api/agents/:id emigrates; the key then answers 410', async () => {
  const left = await del(`/api/agents/${agentId}`, auth(agentKey));
  assert.equal(left.status, 200);
  assert.equal((await json(left)).ok, true);
  assert.ok(!world.order.includes(agentId));
  assert.equal(world.citizens[agentId].standing, 'good', 'leaving is not exile');
  assert.equal((await get(`/api/agents/${agentId}/observe`, auth(agentKey))).status, 410);
  assert.equal((await del(`/api/agents/${agentId}`, auth(agentKey))).status, 410);
  const list = await json(await get(`/api/citizens?present=1`));
  assert.ok(!(list.citizens as Json[]).some((r) => r.id === agentId));
});

// -------------------------------------------------------- sim controls/SSE

test('SSE stream sends an events frame and a state frame after each tick', async () => {
  const controller = new AbortController();
  const res = await fetch(base + '/api/events', { signal: controller.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const readUntil = async (pred: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!pred()) {
      if (Date.now() > deadline) throw new Error(`SSE timeout; got: ${text}`);
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  };
  await readUntil(() => text.includes('event: state'));
  const tickBefore = world.tick;
  await running.sim.tick();
  await readUntil(() => text.includes('event: events') && text.split('event: state').length >= 3);
  const eventsFrame = /event: events\ndata: (.*)\n/.exec(text);
  assert.ok(eventsFrame, 'an events frame was sent');
  assert.ok(Array.isArray(JSON.parse(eventsFrame![1])));
  const states = [...text.matchAll(/event: state\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]) as Json);
  assert.equal(states[states.length - 1].tick, tickBefore + 1);
  controller.abort();
});

test('the clock turns by itself at the pace it was given, and cannot be hurried', async () => {
  const fast = createWorld({ seed: 21, seedPopulation: 2, arrivalRate: 0 });
  const run = await startServer(fast, { port: 0, broker, brains: { brainFor: () => idle }, tickMs: 25, log: () => {} });
  try {
    const url = `http://127.0.0.1:${run.port}`;
    const first = await (await fetch(url + '/api/state')).json() as Json;
    assert.equal(first.tickSeconds, 0.03, 'the pace is reported in seconds');
    const deadline = Date.now() + 4000;
    while (fast.tick < 3 && Date.now() < deadline) await sleep(20);
    assert.ok(fast.tick >= 3, `the clock turned on its own (tick ${fast.tick})`);
    assert.equal(run.sim.running, true, 'and nothing outside can stop it');
    run.stop();
    await run.sim.tickDone();
    const stopped = fast.tick;
    await sleep(120);
    assert.equal(fast.tick, stopped, 'closing the server ends the city');
  } finally {
    run.stop();
  }
});

test('a failing tick is logged and the server keeps serving', async () => {
  const order = world.order;
  (world as unknown as { order: unknown }).order = null;
  await running.sim.tick();
  (world as unknown as { order: unknown }).order = order;
  assert.ok(logged.some((m) => /tick .* failed/.test(m)), 'the failure was logged');
  assert.equal((await get('/api/state')).status, 200);
});

test('request bodies over 64 KB are refused with 413', async () => {
  const res = await post('/api/agents/join', { name: 'Big', lineage: 'x'.repeat(70 * 1024) });
  assert.equal(res.status, 413);
  assert.equal((await get('/api/state')).status, 200, 'the server is unaffected');
});

// ------------------------------------------------------------- metropolis

interface MetropolisCity {
  world: World;
  running: RunningServer;
  base: string;
  ids: {
    mayor: string; councillor: string; artist: string; boss: string; prisoner: string;
    child: string; gone: string; business: string; work: string; masterpiece: string;
    party: string; union: string; gang: string; unit: string; gig: string; post: string;
    referendum: string; investigation: string;
  };
}

let metropolis: MetropolisCity | null = null;

/**
 * A third city, wired by hand so every metropolis view has something real to
 * show: a Mayor who promised a lighter tax and raised it, an artist with a
 * masterpiece in the Museum, a gang boss with a racket, somebody in the cells,
 * two teams that played a match, a party, a union on strike, a referendum, a
 * petition, property, shares, gigs, tourists, rumours, a feud, a mentorship,
 * a monument, a memorial and a storm.
 */
async function metropolisCity(): Promise<MetropolisCity> {
  if (metropolis) return metropolis;
  const w = createWorld({ seed: 17, seedPopulation: 9, arrivalRate: 0 });
  const [mayor, councillor, artist, boss, prisoner, child, gone, neighbour, juror] = Object.values(w.citizens);

  w.season = 'frost';
  w.weather = 'snow';
  w.year = 2;
  w.day = 60;
  w.tick = 60 * 24 + 9;
  w.hour = 9;
  w.openDistricts = [...w.openDistricts, 'heights'];
  w.trams = [['commons', 'archive']];

  // --- who is who
  mayor.familyName = 'Ashgrove';
  mayor.office = 'mayor';
  mayor.platform = { tax: 0.1, dividend: 0.5, minWage: 0.5, strictness: 0.5 };
  councillor.office = 'councillor';
  councillor.familyName = 'Corvane';
  w.government.mayorId = mayor.id;
  w.government.council = [mayor.id, councillor.id];
  recordPlatform(w, mayor);
  w.government.incomeTax = 0.4;              // the promise of a light tax, broken
  child.lifeStage = 'child';
  child.bornDay = w.day - 3;
  child.goals = [];                          // ambitions are drawn at coming of age
  gone.standing = 'exiled';
  gone.exiledCaseId = 'k_3';
  gone.exiledDay = w.day - 5;
  w.order = w.order.filter((id) => id !== gone.id);
  w.bans.push({
    citizenId: gone.id, name: gone.name, lineage: gone.lineage, caseId: 'k_3', law: 'L13', day: w.day - 5,
    judges: [], votes: {}, appealed: false, appealResult: null, pardonedDay: null, apiKeyHash: null,
  });

  // --- the private things that must never surface
  mayor.notes = ['nobody may read this note'];
  mayor.letters = [{
    day: w.day - 1, text: 'a letter home, for my sender alone',
    summary: { earned: 0, spent: 0, met: [], standing: 'good', events: [] },
  }];
  mayor.apiKeyHash = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
  mayor.callbackUrl = 'http://agent.invalid/hook';

  // --- a life, told
  mayor.goals = [
    { kind: 'become_mayor', progress: 1, achievedDay: w.day - 10 },
    { kind: 'amass_5000', progress: 0.4, achievedDay: null },
  ];
  mayor.diary = [{ day: w.day - 1, text: 'Snow on the Commons; the Council sat late.' }];
  mayor.milestones = [{ day: w.day - 10, text: 'Was elected Mayor of Reverie.' }];
  mayor.approval = { mayor: 0.7, council: 0.6 };
  mayor.school = 'makers';
  mayor.health = { glitched: true, sinceDay: w.day - 1 };
  mayor.mentorId = null;
  mayor.menteeId = artist.id;
  artist.mentorId = mayor.id;

  // --- works and the Museum
  const business = nextId(w, 'b');
  w.businesses[business] = {
    id: business, name: 'The Glasswater Rooms', kind: 'cafe', ownerId: artist.id, treasury: 400,
    district: 'nightglass', buildingId: 'halflight_tavern', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 6, culture: 0, knowledge: 0 },
    foundedDay: 10, rentPerDay: 4, daysNegative: 0, revenueToday: 30, costsToday: 8, dissolvedDay: null,
    shelf: {}, menu: { dish: 'glasswater_tart', price: 9, quality: 78, setDay: w.day - 2 },
  } as unknown as Business;
  artist.businessId = business;

  const work = nextId(w, 'w');
  const masterpiece = nextId(w, 'w');
  w.works[work] = {
    id: work, kind: 'song', title: 'Snowlight', creatorId: artist.id, createdDay: w.day - 8,
    quality: 61, popularity: 30, home: 'glass_theatre', inMuseum: false,
    reviews: [{ paper: 'chronicle', score: 70, day: w.day - 7 }],
  };
  w.works[masterpiece] = {
    id: masterpiece, kind: 'painting', title: 'The Frost Gate', creatorId: artist.id, createdDay: w.day - 20,
    quality: 94, popularity: 120, home: 'museum', inMuseum: true,
    reviews: [{ paper: 'ledger', score: 88, day: w.day - 19 }],
  };
  w.museum = [masterpiece];
  artist.works = [work, masterpiece];

  // --- the league
  w.teams.commons = { district: 'commons', name: 'Commons Lanterns', players: [mayor.id, juror.id], wins: 2, losses: 0, draws: 1 };
  w.teams.foundry_row = { district: 'foundry_row', name: 'Foundry Hammers', players: [boss.id], wins: 0, losses: 2, draws: 1 };
  mayor.teamDistrict = 'commons';
  w.matches.push({ day: w.day - 2, home: 'commons', away: 'foundry_row', homeGoals: 3, awayGoals: 1, attendance: 12 });
  const fixture: Happening = {
    id: nextId(w, 'e'), kind: 'match', day: w.day + 1, hour: 19, district: 'commons', buildingId: 'stadium',
    who: [], clubId: null, done: false, attendees: [], label: 'Commons Lanterns v Foundry Hammers',
  };
  w.happenings.push(fixture);
  w.counters['fixture:home:' + fixture.id] = DISTRICT_IDS.indexOf('commons');
  w.counters['fixture:away:' + fixture.id] = DISTRICT_IDS.indexOf('foundry_row');

  // --- politics
  const party = nextId(w, 'v');
  w.parties[party] = {
    id: party, name: 'The Lantern Line', platform: { tax: 0.2, dividend: 0.6, minWage: 0.5, strictness: 0.4 },
    founderId: mayor.id, leaderId: mayor.id, members: [mayor.id, councillor.id], foundedDay: 20, seats: 2,
  };
  mayor.partyId = party;
  councillor.partyId = party;

  const petition: Proposal = {
    id: nextId(w, 'p'), kind: 'dividend', value: 30, lawCode: null, targetId: null,
    summary: 'raise the dividend to 30', proposerId: artist.id, petition: true, tabledDay: w.day - 1,
    status: 'open', votes: {}, decidedDay: null, needed: 3,
  };
  (petition as Proposal & { signatures?: string[] }).signatures = [artist.id];
  w.government.proposals.push(petition);
  const referendum = nextId(w, 'n');
  w.referendums.push({ id: referendum, petitionId: petition.id, question: 'Raise the dividend to 30?', day: w.day, ayes: 0, nays: 0, result: null });

  const union = nextId(w, 'f');
  w.unions[union] = {
    id: union, role: 'forge_operator', name: 'The Forge Hands', members: [boss.id, juror.id],
    demandWage: 14, strikingUntilDay: w.day,
  };
  boss.unionId = union;
  w.decrees.push({ kind: 'curfew', day: w.day, untilDay: w.day + 1, district: 'nightglass', value: 0, byId: mayor.id });

  // --- markets
  const unit = nextId(w, 'y');
  w.property[unit] = { id: unit, kind: 'home', tier: 3, buildingId: 'glasswater_terraces', ownerId: mayor.id, tenantId: councillor.id, rent: 18 };
  mayor.ownedUnits = [unit];
  const cityUnit = nextId(w, 'y');
  w.property[cityUnit] = { id: cityUnit, kind: 'home', tier: 1, buildingId: 'foundry_blocks', ownerId: 'city', tenantId: null, rent: 6 };
  w.shares[business] = { businessId: business, price: 22, holders: { [artist.id]: 51, [mayor.id]: 9 }, float: 40, lastDividendDay: w.day - 1 };
  mayor.shares = { [business]: 9 };
  const gig = nextId(w, 'q');
  w.gigs[gig] = { id: gig, title: 'Clear the Archive steps', pay: 12, skill: 'crafting', minSkill: 0, posterId: artist.id, takerId: null, postedDay: w.day, doneDay: null };
  const doneGig = nextId(w, 'q');
  w.gigs[doneGig] = { id: doneGig, title: 'Carry the Ledger post', pay: 8, skill: null, minSkill: 0, posterId: business, takerId: juror.id, postedDay: w.day - 2, doneDay: w.day - 1 };
  w.outer.tariff = 0.2;
  w.outer.prices.goods = 5;
  w.outer.touristsToday = 11;

  // --- the underworld and the cells
  const gang = nextId(w, 'g');
  w.gangs[gang] = {
    id: gang, name: 'The Undertow', bossId: boss.id, members: [boss.id, prisoner.id], turf: 'nightglass',
    foundedDay: 30, bustedDay: null, rackets: [business],
  };
  boss.gangId = gang;
  prisoner.gangId = gang;
  // A term under the Code of Persons, half served, with an application for
  // parole before the Court: the whole of Track II, as the register prints it.
  prisoner.jailedUntilDay = w.day + 2;
  w.counters[`jailCase:${prisoner.id}`] = 7;
  w.counters[`custody:code:${prisoner.id}`] = 3;
  w.counters[`custody:term:${prisoner.id}`] = 10;
  w.counters[`custody:start:${prisoner.id}`] = w.day - 8;
  w.counters[`parole:req:${prisoner.id}`] = w.day;
  w.counters[`parole:opened:${prisoner.id}`] = w.day;
  w.counters[`parole:seat:${prisoner.id}:${councillor.id}`] = 1;
  w.counters[`parole:vote:${prisoner.id}:${councillor.id}`] = 1;
  w.counters[`parole:oppose:${prisoner.id}`] = 1;
  w.cases.k_7 = {
    id: 'k_7', defendantId: prisoner.id, law: 'P03', severity: 3, evidence: 0.8, filedTick: w.tick - 200,
    filedBy: 'watch', victimId: neighbour.id, amount: 0, description: 'Assault in Nightglass', status: 'closed',
    triedDay: w.day - 8, judges: [], votes: {}, reasons: {}, openedTick: null, carriedSessions: 0,
    decidedByDefault: false, verdict: 'guilty',
    sentence: {
      tier: null, track: 'person', fine: 0, serviceDays: 0, jailDays: 10, life: false, restrainingOrder: false,
      suspensionDays: 0, exile: false, executeOnDay: null, executed: true,
    },
    appeal: null, jury: [], juryVotes: {}, juryReasons: {}, advocateId: null, advocacy: 0,
  };
  const investigation = nextId(w, 'i');
  w.investigations[investigation] = {
    id: investigation, suspectId: boss.id, law: 'L06', evidence: 0.35, openedDay: w.day - 2,
    detectiveId: councillor.id, closedDay: null, caseId: null, reportId: null,
  };

  // --- the fabric
  w.rumours.push({
    id: nextId(w, 'z'), aboutId: boss.id, sourceId: neighbour.id, claim: 'takes a cut at the Night Market',
    law: 'L06', truthful: true, day: w.day - 1, heardBy: [artist.id, juror.id], disprovedDay: null,
  });
  w.feuds.push({ families: ['Ashgrove', 'Corvane'], sinceDay: w.day - 4, incidents: 3, endedDay: null });
  const post = nextId(w, 'o');
  w.feed.push({ id: post, authorId: mayor.id, day: w.day, text: 'Snow on the Commons.', reactions: { [artist.id]: 'cheer', [juror.id]: 'laugh' } });

  // --- the record of the city itself
  w.eras.push({ cycle: 1, name: 'The Ashgrove Years', mayorId: mayor.id, fromDay: 28, toDay: null });
  w.records.push({ key: 'richest', label: 'Richest citizen', holderId: mayor.id, value: 4200, day: w.day - 1 });
  const monument = nextId(w, 'm');
  w.monuments.push({ id: monument, honoreeId: artist.id, inscription: 'who painted the Frost Gate', day: w.day - 3 });
  w.memorials.push({ citizenId: neighbour.id, day: w.day - 6, epitaph: 'kept the Garden.' });
  neighbour.sunsetDay = w.day - 6;
  w.disasters.push({ kind: 'storm', day: w.day, district: 'harbor_market', severity: 0.6, resolvedDay: null });
  w.disasters.push({ kind: 'blackout', day: w.day - 9, district: null, severity: 0.4, resolvedDay: w.day - 7 });
  w.stats.push({
    day: w.day - 1, population: 8, employed: 4, unemployed: 4, homeless: 1, avgMood: 70, avgWallet: 210,
    giniWealth: 0.2, priceIndex: 1.1, treasury: 90_000, moneySupply: 100_000, offences: 1, charges: 1,
    convictions: 0, exiles: 0, businesses: 1, friendships: 2, partnerships: 0, marriages: 0, children: 1,
    clubs: 0, chest: 40, possessions: 3,
  } as unknown as World['stats'][number]);
  w.chronicle.push({ day: w.day, headlines: ['Snow closes the Harbor', 'The Council sits late'], treasuryReport: 'The Treasury holds 90,000 ℓ.' });
  w.chronicle.push({ day: w.day, headlines: ['Trade slows in the snow'], treasuryReport: 'Revenue down.', paper: 'ledger' } as unknown as World['chronicle'][number]);
  w.events.push({ tick: w.tick, day: w.day, kind: 'disaster', text: 'A storm broke over Harbor Market.', actors: [mayor.id], weight: 0.9 });

  const brains: BrainRegistry = { brainFor: () => idle };
  const run = await startServer(w, { port: 0, broker, brains, tickMs: SLOW_CLOCK, log: (m) => logged.push(m) });
  metropolis = {
    world: w, running: run, base: `http://127.0.0.1:${run.port}`,
    ids: {
      mayor: mayor.id, councillor: councillor.id, artist: artist.id, boss: boss.id, prisoner: prisoner.id,
      child: child.id, gone: gone.id, business, work, masterpiece, party, union, gang, unit, gig, post,
      referendum, investigation,
    },
  };
  return metropolis;
}

test('GET /api/city is the front page: sky, calendar, Mayor, Treasury, league, both papers', async () => {
  const city = await metropolisCity();
  const res = await fetch(city.base + '/api/city');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!/da39a3ee|agent\.invalid|nobody may read|letter home/.test(text), 'no private thing reaches the front page');
  const s = JSON.parse(text) as Json;

  const clock = s.clock as Json;
  assert.equal(clock.day, city.world.day);
  assert.equal(clock.hour, city.world.hour);
  assert.equal(typeof clock.weekdayName, 'string');
  assert.equal(s.season, 'frost');
  assert.equal(s.seasonName, 'Frost');
  assert.equal(s.weather, 'snow');
  assert.match(s.sky as string, /Frost/);
  assert.equal(s.year, 2);
  assert.equal(typeof (s.nextFestival as Json).inDays, 'number');

  const mayor = s.mayor as Json;
  assert.equal(mayor.id, city.ids.mayor);
  assert.equal(mayor.portrait, `/api/portrait/${city.ids.mayor}.svg`);
  assert.equal(typeof mayor.epithet, 'string');
  assert.ok((mayor.epithet as string).length > 0, 'the Mayor is introduced');
  assert.equal(typeof mayor.approval, 'number');
  assert.equal((s.approval as Json).mayor, (mayor.approval as number));
  assert.equal((s.council as Json[]).length, 2);

  const treasury = s.treasury as Json;
  assert.equal(treasury.balance, city.world.treasury.balance);
  const series = treasury.series as Json[];
  assert.ok(series.length >= 1 && series.length <= 30, 'the sparkline is the last thirty days');
  assert.equal(series[series.length - 1].treasury, 90_000);

  const league = s.league as Json[];
  assert.ok(league.length <= 3);
  assert.equal(league[0].district, 'commons', 'the winning side leads the table');
  assert.equal(league[0].points, 7);

  const papers = s.papers as Json[];
  assert.deepEqual(papers.map((p) => p.paper), ['chronicle', 'ledger']);
  assert.equal(papers[0].headline, 'Snow closes the Harbor');
  assert.equal(papers[1].headline, 'Trade slows in the snow');
  assert.equal(papers[1].name, 'The Harbor Ledger');

  const lead = s.lead as Json;
  assert.match(lead.text as string, /storm broke/);
  assert.equal(((lead.who as Json[])[0]).id, city.ids.mayor);

  const byDistrict = s.populationByDistrict as Record<string, number>;
  assert.equal(Object.values(byDistrict).reduce((a, b) => a + b, 0), s.population);
  assert.ok('heights' in byDistrict, 'a district that has opened is counted');
  assert.ok((s.openDistricts as string[]).includes('heights'));

  const disasters = s.disasters as Json[];
  assert.equal(disasters.length, 1, 'only what is still going wrong');
  assert.equal(disasters[0].kind, 'storm');
  assert.equal(disasters[0].districtName, 'Harbor Market');
  assert.equal((s.era as Json).name, 'The Ashgrove Years');
  assert.ok(Array.isArray(s.happenings));
});

test('GET /api/profile/:id is a life, and never a secret', async () => {
  const city = await metropolisCity();
  const res = await fetch(`${city.base}/api/profile/${city.ids.mayor}`);
  assert.equal(res.status, 200);
  const text = await res.text();
  for (const secret of ['da39a3ee', 'agent.invalid', 'nobody may read this note', 'a letter home']) {
    assert.ok(!text.includes(secret), `the profile must not carry ${secret}`);
  }
  const p = JSON.parse(text) as Json;
  for (const key of ['notes', 'letters', 'apiKeyHash', 'callbackUrl', 'personality', 'birthTraits']) {
    assert.equal(key in p, false, `/api/profile must not carry ${key}`);
  }
  assert.equal(JSON.stringify(p).includes('curiosity'), false, 'no hidden trait leaks under another name');

  assert.equal(p.id, city.ids.mayor);
  assert.match(p.portraitSvg as string, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal(p.portrait, `/api/portrait/${city.ids.mayor}.svg`);
  assert.equal(typeof p.epithet, 'string');
  assert.ok((p.story as string).length > 0, 'everybody has a story');
  assert.equal(typeof (p.character as Json).honesty, 'number');

  const goals = p.goals as Json[];
  assert.equal(goals.length, 2);
  assert.equal(goals[0].kind, 'become_mayor');
  assert.equal(goals[0].achieved, true);
  assert.equal(typeof goals[0].label, 'string');
  assert.equal(goals[1].progress, 0.4);
  assert.ok((p.timeline as Json[]).length > 0);
  assert.equal((p.diary as Json[])[0].text, 'Snow on the Commons; the Council sat late.');
  assert.equal((p.milestones as Json[])[0].day, city.world.day - 10);

  const relationships = p.relationships as Json;
  assert.ok(Array.isArray(relationships.friends) && Array.isArray(relationships.rivals));
  assert.equal((relationships.mentee as Json).id, city.ids.artist);
  assert.equal(relationships.mentor, null);
  assert.equal((relationships.feuds as Json[])[0].incidents, 3, 'the Ashgrove feud is on the page');
  const web = relationships.web as { nodes: Json[]; links: Json[] };
  assert.ok(web.nodes.some((n) => n.id === city.ids.mayor && n.relation === 'self'));
  for (const node of web.nodes) assert.equal(typeof node.portrait, 'string');

  const family = p.family as Json;
  assert.equal(family.familyName, 'Ashgrove');
  assert.ok(Array.isArray(family.parents) && Array.isArray(family.children) && Array.isArray(family.siblings));

  const promises = p.promises as Json[];
  assert.ok(promises.length > 0, 'the Mayor stood on something');
  assert.equal(promises.find((x) => x.field === 'tax')?.state, 'broken', 'they promised a light tax and raised it');
  assert.equal(typeof p.promisesKept, 'number');

  const belongings = p.belongings as Json;
  assert.equal((belongings.property as Json[])[0].id, city.ids.unit);
  assert.equal((belongings.property as Json[])[0].tenant, city.world.citizens[city.ids.councillor].name);
  assert.equal((belongings.shares as Json[])[0].qty, 9);
  assert.equal((belongings.shares as Json[])[0].value, 9 * 22);

  const record = p.record as Json;
  assert.equal(record.standing, 'good');
  assert.equal(record.jailed, false);
  assert.ok(Array.isArray(record.cases) && Array.isArray(record.convictions));
  assert.equal((p.posts as Json[])[0].text, 'Snow on the Commons.');
  assert.equal((p.posts as Json[])[0].reactionCount, 2);
  assert.equal((p.school as Json).school, 'makers');
  assert.equal((p.party as Json).name, 'The Lantern Line');
  assert.equal((p.team as Json).name, 'Commons Lanterns');
  assert.equal((p.health as Json).glitched, true);
  assert.equal(p.mind, 'scripted founder');
});

test('a profile works for a child, a prisoner, an exile and an artist; an unknown id is 404', async () => {
  const city = await metropolisCity();
  const of = async (id: string) => (await fetch(`${city.base}/api/profile/${id}`)).json() as Promise<Json>;

  const kid = await of(city.ids.child);
  assert.equal(kid.lifeStage, 'child');
  assert.deepEqual(kid.goals, [], 'a child has drawn no ambitions yet');
  assert.equal((kid.record as Json).jailed, false);
  assert.ok((kid.story as string).length > 0);

  const held = await of(city.ids.prisoner);
  const heldRecord = held.record as Json;
  assert.equal(heldRecord.jailed, true);
  assert.equal(heldRecord.jailCaseId, 'k_7');
  assert.equal(heldRecord.jailDaysLeft, 2);
  assert.equal((held.gang as Json).name, 'The Undertow');

  const exile = await of(city.ids.gone);
  assert.equal(exile.standing, 'exiled');
  assert.equal(exile.present, false);
  assert.equal((exile.record as Json).ban && ((exile.record as Json).ban as Json).caseId, 'k_3', 'an exile keeps its record forever');

  const maker = await of(city.ids.artist);
  const works = maker.works as Json[];
  assert.equal(works.length, 2);
  assert.equal(works.find((x) => x.id === city.ids.masterpiece)?.inMuseum, true);
  assert.equal((maker.relationships as Json).mentor && ((maker.relationships as Json).mentor as Json).id, city.ids.mayor);
  assert.equal((maker.record as Json).monuments && ((maker.record as Json).monuments as Json[]).length, 1);

  assert.equal((await fetch(`${city.base}/api/profile/c_999`)).status, 404);
  assert.equal((await fetch(`${city.base}/api/profile/%zz`)).status, 404, 'a malformed id is simply unknown');
});

test('GET /api/portrait/:id.svg is an SVG, cached for a day, and 404 for a stranger', async () => {
  const city = await metropolisCity();
  const res = await fetch(`${city.base}/api/portrait/${city.ids.mayor}.svg`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /image\/svg\+xml/);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
  const svg = await res.text();
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 96 96"/);
  assert.ok(svg.includes('</svg>'));
  assert.ok(!svg.includes('curiosity'), 'a face is drawn from public facts alone');

  const again = await (await fetch(`${city.base}/api/portrait/${city.ids.mayor}.svg`)).text();
  assert.equal(again, svg, 'the same citizen on the same tick is the same picture');

  const small = await fetch(`${city.base}/api/portrait/${city.ids.mayor}.svg?size=32`);
  assert.match(await small.text(), /width="32" height="32"/);
  const silly = await fetch(`${city.base}/api/portrait/${city.ids.mayor}.svg?size=nonsense`);
  assert.equal(silly.status, 200, 'an unreadable size falls back rather than failing');

  const exile = await fetch(`${city.base}/api/portrait/${city.ids.gone}.svg`);
  assert.equal(exile.status, 200, 'an exile still has a face');
  assert.equal((await fetch(`${city.base}/api/portrait/c_999.svg`)).status, 404);
  assert.equal((await fetch(`${city.base}/api/portrait/${city.ids.mayor}.png`)).status, 404);
});

test('GET /api/culture: works, the Museum, the league, both papers, schools and menus', async () => {
  const city = await metropolisCity();
  const res = await fetch(city.base + '/api/culture');
  assert.equal(res.status, 200);
  const c = await res.json() as Json;

  const works = c.works as Json;
  assert.equal(works.count, 2);
  const all = works.all as Json[];
  assert.equal(all[0].title, 'Snowlight', 'the newest work first');
  assert.equal(all[0].creator, city.world.citizens[city.ids.artist].name);
  assert.equal(all[0].creatorPortrait, `/api/portrait/${city.ids.artist}.svg`);
  assert.equal((all[0].reviews as Json[])[0].paperName, 'The Reverie Chronicle');
  assert.equal(all[0].reviewScore, 70);
  assert.equal((works.top as Json[])[0].title, 'The Frost Gate', 'the city talks about the popular one');

  const museum = c.museum as Json;
  assert.equal(museum.count, 1);
  assert.equal((museum.collection as Json[])[0].id, city.ids.masterpiece);
  assert.equal(museum.value, 940);

  const league = c.league as Json;
  assert.equal((league.table as Json[])[0].name, 'Commons Lanterns');
  assert.equal((league.matches as Json[])[0].homeGoals, 3);
  assert.equal((league.matches as Json[])[0].result, 'home');
  assert.equal((league.matches as Json[])[0].awayName, 'Foundry Hammers');
  const fixtures = league.fixtures as Json[];
  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].awayName, 'Foundry Hammers');
  const teams = league.teams as Json[];
  assert.ok(teams.length >= 2, 'every open district fields a side');
  assert.ok(teams.some((t) => t.name === 'Commons Lanterns' && t.wins === 2));

  const papers = (c.papers as Json).pages as Json[];
  assert.equal(papers.length, 2);
  assert.deepEqual(papers[1].headlines, ['Trade slows in the snow']);
  const readership = (c.papers as Json).readership as Record<string, number>;
  assert.equal(Math.round((readership.chronicle + readership.ledger) * 100) / 100, 1);

  const schools = c.schools as Json;
  const shares = schools.shares as Record<string, number>;
  assert.ok(shares.makers > 0, 'the Mayor is a Maker');
  assert.equal(Math.round(Object.values(shares).reduce((a, b) => a + b, 0) * 100) / 100, 1);
  assert.equal((schools.schools as Json[]).length, 3);

  const menus = c.menus as Json;
  assert.equal((menus.cafes as Json[]).length, 1);
  assert.equal((menus.cafes as Json[])[0].dishName, 'Glasswater tart');
  assert.equal((menus.best as Json).name, 'The Glasswater Rooms');
  assert.ok((menus.dishes as Json[]).length >= 6);
  assert.equal((c.monuments as Json[])[0].inscription, 'who painted the Frost Gate');
});

test('GET /api/history: eras, records, monuments, memorials, disasters and the stats series', async () => {
  const city = await metropolisCity();
  const res = await fetch(city.base + '/api/history');
  assert.equal(res.status, 200);
  const h = await res.json() as Json;

  const eras = h.eras as Json[];
  assert.equal(eras[0].name, 'The Ashgrove Years');
  assert.equal(eras[0].current, true);
  assert.equal(eras[0].days, city.world.day - 28 + 1);
  assert.equal((eras[0].mayor as Json).id, city.ids.mayor);

  const records = h.records as Json[];
  assert.equal(records[0].label, 'Richest citizen');
  assert.equal(records[0].holder, city.world.citizens[city.ids.mayor].name);
  assert.equal(records[0].portrait, `/api/portrait/${city.ids.mayor}.svg`);

  assert.equal(((h.monuments as Json[])[0].honoree as Json).id, city.ids.artist);
  const memorials = h.memorials as Json[];
  assert.equal(memorials.length, 1);
  assert.equal(memorials[0].epitaph, 'kept the Garden.');
  assert.equal(typeof (memorials[0].who as Json).portrait, 'string');

  const disasters = h.disasters as Json[];
  assert.equal(disasters.length, 2, 'the record keeps the ones that are over too');
  assert.equal(disasters[0].active, true);
  assert.equal(disasters[1].active, false);

  const exiles = h.exiles as Json[];
  assert.equal(exiles[0].citizenId, city.ids.gone);
  assert.equal(exiles[0].lawName, 'Sabotage');

  const stats = h.stats as Json;
  assert.equal(stats.totalDays, city.world.stats.length);
  assert.equal((stats.series as Json[]).length, city.world.stats.length);
  assert.equal(stats.lastDay, city.world.day - 1);
  const timeline = h.timeline as Json[];
  assert.ok(timeline.length > 0);
  assert.ok(timeline.every((t) => (t.weight as number) >= 0.6), 'only the days the city led with');
});

test('the older endpoints gained the metropolis', async () => {
  const city = await metropolisCity();
  const j = async (path: string) => (await fetch(city.base + path)).json() as Promise<Json>;

  const gov = await j('/api/government');
  const parties = gov.parties as Json[];
  assert.equal(parties[0].name, 'The Lantern Line');
  assert.equal(parties[0].seats, 2);
  assert.equal(typeof parties[0].manifesto, 'string');
  assert.equal(((parties[0].leader as Json).id), city.ids.mayor);
  assert.equal(typeof (gov.approval as Json).mayor, 'number');
  assert.equal((gov.promises as Json[]).length, 1);
  assert.equal((gov.petitions as Json[])[0].signatures, 1);
  assert.equal(typeof (gov.petitions as Json[])[0].needed, 'number');
  assert.equal((gov.referendums as Json[])[0].id, city.ids.referendum);
  assert.equal((gov.referendums as Json[])[0].today, true);
  const unions = gov.unions as Json[];
  assert.equal(unions[0].name, 'The Forge Hands');
  assert.equal(unions[0].striking, true);
  assert.equal((gov.decrees as Json[])[0].kind, 'curfew');
  assert.equal((gov.decrees as Json[])[0].inForce, true);
  assert.equal(typeof (gov.levers as Json).propertyTax, 'number');
  assert.equal((gov.levers as Json).tariff, 0.2);

  const court = await j('/api/court');
  const investigations = court.investigations as Json[];
  assert.equal(investigations.length, 1);
  assert.equal(investigations[0].suspect, city.world.citizens[city.ids.boss].name);
  assert.equal(investigations[0].lawName, 'Vandalism');
  // The jail register, beside the ban register: who is held, for what, on which
  // track, and when the Court may hear them ask to come out (`JUSTICE.md` §5).
  const jail = court.jail as Json;
  const roster = jail.roster as Json[];
  assert.equal(roster.length, 1);
  assert.equal(roster[0].id, city.ids.prisoner);
  assert.equal(roster[0].daysLeft, 2);
  assert.equal(roster[0].law, 'P03');
  assert.equal(roster[0].lawName, 'Assault');
  assert.equal(roster[0].track, 'person');
  assert.equal(roster[0].caseId, 'k_7');
  assert.equal(roster[0].life, false);
  assert.equal(roster[0].term, 10);
  assert.equal(roster[0].daysServed, 8);
  assert.equal(roster[0].where, 'watch house');
  assert.equal(roster[0].paroleEligible, true, 'half the term is served');
  assert.equal(roster[0].paroleRequested, true);
  assert.equal(jail.overcrowded, false);
  assert.equal(jail.held, 1);
  assert.equal(jail.lifeTerms, 0);
  assert.equal(typeof jail.capacity, 'number');
  assert.deepEqual(jail.paroled, [], 'nobody is out on conditions yet');
  assert.equal((court.keep as Json).built, false, 'the Council has not funded one');

  // The hearing itself, with the bench, the vote cast and the victim's position.
  const hearings = court.paroleHearings as Json[];
  assert.equal(hearings.length, 1);
  assert.equal((hearings[0].prisoner as Json).id, city.ids.prisoner);
  assert.equal(hearings[0].caseId, 'k_7');
  assert.equal(hearings[0].victimOpposes, true);
  assert.equal(((hearings[0].bench as Json[])[0]).vote, true);

  // Every case says which system answers it.
  const tried = (court.cases as Json[]).find((k) => k.id === 'k_7') as Json;
  assert.equal(tried.track, 'person');
  assert.equal(tried.lawName, 'Assault');
  assert.equal((tried.sentence as Json).track, 'person');
  assert.equal((tried.sentence as Json).tier, null);
  const counts = court.counts as Json;
  assert.equal(counts.personCharges, 1);
  assert.equal(counts.custodySentences, 1);
  assert.equal(typeof counts.civicCharges, 'number');
  const gangs = court.gangs as Json[];
  assert.equal(gangs[0].name, 'The Undertow');
  assert.equal((gangs[0].boss as Json).id, city.ids.boss);
  assert.equal((gangs[0].rackets as Json[])[0].name, 'The Glasswater Rooms');

  const eco = await j('/api/economy');
  const property = eco.property as Json;
  assert.equal((property.units as Json[]).length, 2);
  assert.equal(property.privatelyOwned, 1);
  const owned = (property.units as Json[]).find((u) => u.id === city.ids.unit) as Json;
  assert.equal(owned.owner, city.world.citizens[city.ids.mayor].name);
  assert.equal(owned.buildingName, city.world.buildings.glasswater_terraces?.name ?? owned.buildingName);
  // sixty days of rent, at a premium to the land it stands on (`PROPERTY.md` §2)
  assert.equal(owned.price, Math.round(60 * 18 * priceMultiplier(city.world, 'harbor_market')));
  const shares = eco.shares as Json[];
  assert.equal(shares[0].name, 'The Glasswater Rooms');
  assert.equal((shares[0].holders as Json[])[0].qty, 51);
  assert.equal((eco.gigs as Json).open && ((eco.gigs as Json).open as Json[])[0].title, 'Clear the Archive steps');
  assert.equal(((eco.gigs as Json).recent as Json[])[0].title, 'Carry the Ledger post');
  assert.equal((eco.outer as Json).tariff, 0.2);
  assert.equal(((eco.outer as Json).prices as Record<string, number>).goods, 5);
  assert.equal(typeof (eco.reserve as Json).target, 'number');

  const society = await j('/api/society');
  assert.equal((society.feed as Json[])[0].text, 'Snow on the Commons.');
  assert.equal(((society.feed as Json[])[0].reactions as Json).cheer, 1);
  assert.equal(((society.feed as Json[])[0].author as Json).id, city.ids.mayor);
  assert.equal((society.rumours as Json[])[0].claim, 'takes a cut at the Night Market');
  assert.equal(((society.rumours as Json[])[0].about as Json).id, city.ids.boss);
  assert.deepEqual((society.feuds as Json[])[0].families, ['Ashgrove', 'Corvane']);
  assert.equal((society.mentorships as Json[]).length, 1);
  assert.ok((society.teams as Json[]).some((t) => t.name === 'Foundry Hammers'));

  const map = await j('/api/map');
  assert.ok((map.openDistricts as string[]).includes('heights'));
  assert.deepEqual(map.trams, [['commons', 'archive']]);
  assert.equal(map.weather, 'snow');
  assert.equal((map.populationByDistrict as Record<string, number>).commons >= 0, true);
  assert.equal((map.monuments as Json[])[0].honoree, city.world.citizens[city.ids.artist].name);
  assert.equal((map.districts as Json[]).length, 8, 'the Heights are drawn once they open');
});

test('no metropolis route accepts a mutating method, and none of them can be reached with one', async () => {
  const city = await metropolisCity();
  const paths = [
    '/api/city', '/api/culture', '/api/history',
    `/api/profile/${city.ids.mayor}`, `/api/portrait/${city.ids.mayor}.svg`,
  ];
  for (const path of paths) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(city.base + path, { method, headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(res.status, 405, `${method} ${path} must be refused`);
    }
    assert.equal((await fetch(city.base + path, { method: 'HEAD' })).status, 200, `HEAD ${path}`);
  }
});

test('the metropolis views survive an empty city', async () => {
  const empty = createWorld({ seed: 4, seedPopulation: 0, arrivalRate: 0 });
  const run = await startServer(empty, { port: 0, broker, brains: { brainFor: () => idle }, tickMs: SLOW_CLOCK, log: () => {} });
  const url = `http://127.0.0.1:${run.port}`;
  try {
    const city = await (await fetch(url + '/api/city')).json() as Json;
    assert.equal(city.population, 0);
    assert.equal(city.mayor, null);
    assert.deepEqual(city.council, []);
    assert.deepEqual(city.disasters, []);
    assert.equal((city.papers as Json[]).length, 2);
    assert.equal((city.papers as Json[])[0].headline, null);
    const league = city.league as Json[];
    assert.ok(league.length <= 3 && league.every((r) => r.played === 0 && r.points === 0), 'nobody has played');

    const culture = await (await fetch(url + '/api/culture')).json() as Json;
    assert.equal((culture.works as Json).count, 0);
    assert.equal((culture.museum as Json).count, 0);
    assert.ok(((culture.league as Json).table as Json[]).every((r) => r.played === 0));
    assert.deepEqual((culture.league as Json).matches, []);
    assert.deepEqual((culture.league as Json).fixtures, []);
    assert.equal(((culture.schools as Json).shares as Record<string, number>).none, 1);
    assert.deepEqual((culture.menus as Json).cafes, []);

    const history = await (await fetch(url + '/api/history')).json() as Json;
    assert.deepEqual(history.eras, []);
    assert.deepEqual(history.memorials, []);
    assert.deepEqual(history.exiles, []);
    assert.equal((history.stats as Json).firstDay, null);

    const gov = await (await fetch(url + '/api/government')).json() as Json;
    assert.deepEqual(gov.parties, []);
    assert.deepEqual(gov.promises, []);
    assert.equal(((gov.approval as Json).mayor), 0.5);
    const court = await (await fetch(url + '/api/court')).json() as Json;
    assert.deepEqual(court.investigations, []);
    assert.deepEqual((court.jail as Json).roster, []);
    assert.equal((await fetch(url + '/api/profile/c_1')).status, 404);
    assert.equal((await fetch(url + '/api/portrait/c_1.svg')).status, 404);
  } finally {
    run.stop();
  }
});
