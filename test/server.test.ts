/**
 * The HTTP server: dashboard routes, static files (and that they cannot be
 * escaped), simulation controls, the SSE stream, and the external agent API
 * round trip through the RemoteBroker. One small city, one server on port 0.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Brain, Business, Club, Happening, Household, World } from '../src/types.ts';
import { createWorld } from '../src/world/world.ts';
import type { BrainRegistry } from '../src/world/world.ts';
import { RemoteBroker } from '../src/brains/remote.ts';
import { startServer } from '../src/server/server.ts';
import type { RunningServer } from '../src/server/server.ts';
import { resolveStatic } from '../src/server/http.ts';
import { hashKey } from '../src/server/agents.ts';
import { nextId } from '../src/util/ids.ts';
import { transfer } from '../src/economy/treasury.ts';
import { totalMoney } from './helpers.ts';

const idle: Brain = { kind: 'reflex', decide: () => ({ type: 'idle' }) };

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
  running = await startServer(world, { port: 0, broker, brains, tickMs: 30, autoRun: false, log: (m) => logged.push(m) });
  base = `http://127.0.0.1:${running.port}`;
});

after(() => {
  running.stop();
  if (society) society.running.stop();
  broker.close();
});

// ---------------------------------------------------------------- dashboard

test('GET /api/state summarises the city', async () => {
  const res = await get('/api/state');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const s = await json(res);
  assert.equal(s.tick, world.tick);
  assert.equal(s.population, 6);
  assert.equal(s.running, false);
  assert.equal(typeof s.clock, 'string');
  assert.equal((s.config as Json).seed, 11);
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
  const dots = map.citizens as { x: number; y: number; standing: string }[];
  assert.equal(dots.length, 6);
  for (const d of dots) {
    assert.ok(d.x >= 0 && d.x <= 60 && d.y >= 0 && d.y <= 40, `dot inside the grid: ${d.x},${d.y}`);
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
  assert.equal((gov.laws as unknown[]).length, 15);
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
  assert.equal((await get('/api/sim/step')).status, 405);
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
  const run = await startServer(w, { port: 0, broker, brains, tickMs: 1000, autoRun: false, log: (m) => logged.push(m) });
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
  const run = await startServer(empty, { port: 0, broker, brains: { brainFor: () => idle }, tickMs: 1000, autoRun: false, log: () => {} });
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
  const stepping = post('/api/sim/step', { ticks: 1 });
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
  const stepped = await json(await stepping);
  assert.equal(stepped.ran, 1);
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
  await post('/api/sim/step', { ticks: 1 });
  await readUntil(() => text.includes('event: events') && text.split('event: state').length >= 3);
  const eventsFrame = /event: events\ndata: (.*)\n/.exec(text);
  assert.ok(eventsFrame, 'an events frame was sent');
  assert.ok(Array.isArray(JSON.parse(eventsFrame![1])));
  const states = [...text.matchAll(/event: state\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]) as Json);
  assert.equal(states[states.length - 1].tick, tickBefore + 1);
  controller.abort();
});

test('speed, resume and pause drive the loop; step runs exactly n ticks', async () => {
  const speed = await json(await post('/api/sim/speed', { tickMs: 1 }));
  assert.equal(speed.tickMs, 10, 'clamped to the minimum');
  assert.equal((await post('/api/sim/speed', { tickMs: 'fast' })).status, 400);
  const before = world.tick;
  const resumed = await json(await post('/api/sim/resume', {}));
  assert.equal(resumed.running, true);
  await sleep(150);
  const paused = await json(await post('/api/sim/pause', {}));
  assert.equal(paused.running, false);
  await running.sim.tickDone();
  const afterRun = world.tick;
  assert.ok(afterRun > before, 'ticks advanced while running');
  await sleep(60);
  assert.equal(world.tick, afterRun, 'no ticks after pause');

  const stepped = await json(await post('/api/sim/step', { ticks: 3 }));
  assert.equal(stepped.ran, 3);
  assert.equal(world.tick, afterRun + 3);
  assert.equal((await post('/api/sim/step', { ticks: 0 })).status, 400);
});

test('a failing tick is logged and the server keeps serving', async () => {
  const order = world.order;
  (world as unknown as { order: unknown }).order = null;
  const res = await post('/api/sim/step', { ticks: 1 });
  (world as unknown as { order: unknown }).order = order;
  assert.equal(res.status, 200);
  assert.ok(logged.some((m) => /tick .* failed/.test(m)), 'the failure was logged');
  assert.equal((await get('/api/state')).status, 200);
});

test('request bodies over 64 KB are refused with 413', async () => {
  const res = await post('/api/agents/join', { name: 'Big', lineage: 'x'.repeat(70 * 1024) });
  assert.equal(res.status, 413);
  assert.equal((await get('/api/state')).status, 200, 'the server is unaffected');
});
