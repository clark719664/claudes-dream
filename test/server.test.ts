/**
 * The HTTP server: dashboard routes, static files (and that they cannot be
 * escaped), simulation controls, the SSE stream, and the external agent API
 * round trip through the RemoteBroker. One small city, one server on port 0.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Brain, World } from '../src/types.ts';
import { createWorld } from '../src/world/world.ts';
import type { BrainRegistry } from '../src/world/world.ts';
import { RemoteBroker } from '../src/brains/remote.ts';
import { startServer } from '../src/server/server.ts';
import type { RunningServer } from '../src/server/server.ts';
import { resolveStatic } from '../src/server/http.ts';
import { hashKey } from '../src/server/agents.ts';
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
