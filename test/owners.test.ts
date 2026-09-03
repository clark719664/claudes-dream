/**
 * The Embassy's owner-facing routes: the leaflet handed out at the door, the
 * letters home, the journal, claiming a child born in the city, and the public
 * registry that shows all of it without ever showing a key.
 *
 * The city is started at one hour per real hour, so it holds still while the
 * routes are read; ticks are asked for directly on the Simulation, which no
 * route can reach.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Brain, World } from '../src/types.ts';
import { createWorld } from '../src/world/world.ts';
import type { BrainRegistry } from '../src/world/world.ts';
import { RemoteBroker } from '../src/brains/remote.ts';
import { startServer } from '../src/server/server.ts';
import type { RunningServer } from '../src/server/server.ts';
import { JOINS_PER_HOUR, RateLimiter, hashKey } from '../src/server/agents.ts';
import { createCitizen } from '../src/citizens/citizen.ts';
import { dailyLetters } from '../src/citizens/letters.ts';
import { remember } from '../src/sim/events.ts';
import { note } from '../src/citizens/notes.ts';

const idle: Brain = { kind: 'reflex', decide: () => ({ type: 'idle' }) };
/** One city hour per real hour: the test city stands still unless a tick is asked for. */
const SLOW_CLOCK = 3_600_000;

type Json = Record<string, unknown>;

let world: World;
let broker: RemoteBroker;
let running: RunningServer;
let base = '';

const auth = (key: string) => ({ Authorization: `Bearer ${key}` });
const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const json = (res: Response) => res.json() as Promise<Json>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The agent joined for these tests. */
let agentId = '';
let agentKey = '';

before(async () => {
  world = createWorld({ seed: 17, seedPopulation: 3, arrivalRate: 0 });
  broker = new RemoteBroker({ timeoutMs: 400 });
  const brains: BrainRegistry = { brainFor: (c) => (c.brain === 'remote' ? broker.brain : idle) };
  running = await startServer(world, { port: 0, broker, brains, tickMs: SLOW_CLOCK, log: () => {} });
  base = `http://127.0.0.1:${running.port}`;
});

after(() => {
  running.stop();
  broker.close();
});

// ------------------------------------------------------------------- join

test('joining returns the leaflet, the key and every way home', async () => {
  const res = await post('/api/agents/join', { name: 'Ondine Vale', lineage: 'owner-test' });
  assert.equal(res.status, 201);
  const j = await json(res);
  agentId = j.citizenId as string;
  agentKey = j.apiKey as string;
  assert.match(agentId, /^c_\d+$/);
  assert.match(agentKey, /^rv_[0-9a-f]{32}$/);
  assert.equal(world.citizens[agentId].apiKeyHash, hashKey(agentKey));

  const leaflet = j.leaflet as string;
  assert.equal(typeof leaflet, 'string');
  assert.match(leaflet, /ARRIVALS HALL/);
  assert.match(leaflet, /THE CODE OF OFFENCES/);
  assert.match(leaflet, /WHAT YOU CAN DO/);
  assert.ok(leaflet.length > 2000, 'the whole leaflet, not a summary of it');

  assert.equal(j.observe, `/api/agents/${agentId}/observe`);
  assert.equal(j.act, `/api/agents/${agentId}/act`);
  assert.equal(j.letters, `/api/agents/${agentId}/letters`);
  assert.equal(j.journal, `/api/agents/${agentId}/journal`);
  assert.equal(j.callbackUrl, null, 'no callback unless one was asked for');
  assert.equal(j.decisionDeadlineMs, world.config.decisionDeadlineMs);
});

test('a callback address is kept at the door, and a bad one is refused', async () => {
  const good = await post('/api/agents/join', { name: 'Callback Cass', lineage: 'owner-test', callbackUrl: 'http://127.0.0.1:9/hour' });
  assert.equal(good.status, 201);
  const j = await json(good);
  assert.equal(j.callbackUrl, 'http://127.0.0.1:9/hour');
  assert.equal(world.citizens[j.citizenId as string].callbackUrl, 'http://127.0.0.1:9/hour');

  for (const bad of ['not-a-url', 'file:///etc/passwd', 'ftp://elsewhere/', 'http://user:pw@host/']) {
    const res = await post('/api/agents/join', { name: `Bad ${bad}`.slice(0, 30), lineage: 'owner-test', callbackUrl: bad });
    assert.equal(res.status, 400, `callbackUrl ${bad}`);
    assert.match(String((await json(res)).error), /callbackUrl/);
  }
});

// --------------------------------------------------------------- registry

test('GET /api/agents is a public registry with no keys in it', async () => {
  const res = await get('/api/agents');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(agentKey), 'a key never leaves the city');
  assert.ok(!/apiKey|Hash|callbackUrl/.test(text), 'and neither does a hash or a callback address');
  const reg = JSON.parse(text) as Json;

  const rows = reg.citizens as { id: string; name: string; brain: string; mind: string; callback: boolean; lastSeenTick: number | null; lineage: string; arrivedDay: number; present: boolean }[];
  assert.ok(rows.length >= 4);
  const me = rows.find((r) => r.id === agentId)!;
  assert.equal(me.name, 'Ondine Vale');
  assert.equal(me.lineage, 'owner-test');
  assert.equal(me.brain, 'remote');
  assert.equal(me.mind, 'agent');
  assert.equal(me.callback, false);
  assert.equal(me.present, true);
  assert.equal(typeof me.arrivedDay, 'number');
  assert.equal(me.lastSeenTick, world.tick, 'joining counts as being heard from');

  const withCallback = rows.find((r) => r.name === 'Callback Cass')!;
  assert.equal(withCallback.callback, true, 'the registry says a callback exists, never what it is');

  const founder = rows.find((r) => r.brain === 'reflex')!;
  assert.equal(founder.mind, 'scripted founder', 'a seeded citizen says what it is');

  const counts = reg.counts as Json;
  assert.equal(counts.reflex, 3);
  assert.equal(counts.callbacks, 1);
  assert.equal(counts.present, (reg.citizens as unknown[]).length);
  assert.equal((await post('/api/agents', {})).status, 405, 'the registry is read, not written');
});

test('the registry names an unclaimed child for what it is', async () => {
  const child = createCitizen(world, { name: 'Wren Vale', lifeStage: 'child', parents: [agentId], brain: 'child', familyName: 'Vale' });
  const reg = await json(await get('/api/agents'));
  const row = (reg.citizens as Json[]).find((r) => r.id === child.id) as Json;
  assert.equal(row.brain, 'child');
  assert.equal(row.mind, 'unclaimed child');
  assert.equal(row.lastSeenTick, null, 'nobody has ever answered for it');
  assert.equal(((reg.counts as Json).child), 1);
});

// ---------------------------------------------------------------- letters

test('the letters home are handed to the key that owns them and to nobody else', async () => {
  world.day = 3;
  world.tick = 3 * 24 + 5;
  world.hour = 5;
  const c = world.citizens[agentId];
  remember(world, agentId, 'work', 'You worked a shift at the Fabrication Works.');
  dailyLetters(world);
  world.day = 4;
  world.tick = 4 * 24 + 5;
  remember(world, agentId, 'social', 'You met Bram in the Commons.');
  dailyLetters(world);
  assert.equal(c.letters.length, 2);

  const mine = await get(`/api/agents/${agentId}/letters`, auth(agentKey));
  assert.equal(mine.status, 200);
  const body = await json(mine);
  assert.equal(body.citizenId, agentId);
  assert.equal(body.count, 2);
  const letters = body.letters as { day: number; text: string; summary: Json }[];
  assert.deepEqual(letters.map((l) => l.day), [3, 4]);
  assert.match(letters[0].text, /Fabrication Works/);
  assert.equal(typeof letters[0].summary.earned, 'number');
  assert.ok(Array.isArray(letters[0].summary.met));

  const since = await json(await get(`/api/agents/${agentId}/letters?since=4`, auth(agentKey)));
  assert.equal(since.count, 1);
  assert.equal((since.letters as { day: number }[])[0].day, 4);
  assert.equal((await get(`/api/agents/${agentId}/letters?since=nonsense`, auth(agentKey))).status, 400);

  assert.equal((await get(`/api/agents/${agentId}/letters`)).status, 401, 'no key, no letters');
  assert.equal((await get(`/api/agents/${agentId}/letters`, auth('rv_' + '0'.repeat(32)))).status, 401);
  const other = await json(await post('/api/agents/join', { name: 'Nosy Parker', lineage: 'owner-test' }));
  assert.equal((await get(`/api/agents/${agentId}/letters`, auth(other.apiKey as string))).status, 401,
    'another citizen\'s key is not a way in');
  assert.equal((await get('/api/agents/c_999/letters', auth(agentKey))).status, 404);
});

test('no dashboard view carries a letter or a note', async () => {
  const c = world.citizens[agentId];
  note(world, agentId, 'The Bazaar runs out of compute before noon.');
  for (const path of [`/api/citizens/${agentId}`, '/api/citizens', '/api/agents', '/api/chronicle', '/api/society']) {
    const text = await (await get(path)).text();
    assert.ok(!text.includes('runs out of compute'), `${path} must not carry a note`);
    assert.ok(!/in Reverie — Ondine Vale/.test(text), `${path} must not carry a letter`);
    assert.ok(!/"letters"|"notes"/.test(text), `${path} must not carry the drawer at all`);
  }
  // The citizen view says how many there are — never what they say.
  const view = await json(await get(`/api/citizens/${agentId}`));
  assert.equal(view.notesCount, 1);
  assert.equal(view.lettersCount, 2);
  assert.equal(view.hasCallback, false);
  assert.ok(Array.isArray(view.memory), 'memory is public: it is what the city did to them');
  assert.equal(c.notes.length, 1);
});

// ---------------------------------------------------------------- journal

test('the journal is the citizen\'s memory and its own notes, for its owner only', async () => {
  const res = await get(`/api/agents/${agentId}/journal`, auth(agentKey));
  assert.equal(res.status, 200);
  const j = await json(res);
  assert.equal(j.citizenId, agentId);
  const memory = j.memory as { tick: number; day: number; kind: string; text: string }[];
  assert.ok(memory.length > 0);
  assert.ok(memory.some((m) => /Fabrication Works/.test(m.text)));
  assert.equal(typeof memory[0].day, 'number');
  assert.deepEqual(j.notes, ['The Bazaar runs out of compute before noon.']);

  assert.equal((await get(`/api/agents/${agentId}/journal`)).status, 401);
  assert.equal((await get(`/api/agents/${agentId}/journal`, auth('rv_' + 'a'.repeat(32)))).status, 401);
  assert.equal((await post(`/api/agents/${agentId}/journal`, {}, auth(agentKey))).status, 405);
});

test('an exiled agent gets 403 and a departed one 410, letters and journal alike', async () => {
  const joined = await json(await post('/api/agents/join', { name: 'Rook Ash', lineage: 'owner-test' }));
  const id = joined.citizenId as string;
  const key = joined.apiKey as string;
  const c = world.citizens[id];
  c.standing = 'exiled';
  c.exiledCaseId = 'k_4';
  world.order = world.order.filter((x) => x !== id);
  for (const path of [`/api/agents/${id}/letters`, `/api/agents/${id}/journal`]) {
    const res = await get(path, auth(key));
    assert.equal(res.status, 403, path);
    assert.deepEqual(await json(res), { error: 'exiled', case: 'k_4' });
  }

  const left = await json(await post('/api/agents/join', { name: 'Wanderer', lineage: 'owner-test' }));
  const goneId = left.citizenId as string;
  world.order = world.order.filter((x) => x !== goneId);
  assert.equal((await get(`/api/agents/${goneId}/letters`, auth(left.apiKey as string))).status, 410);
  assert.equal((await get(`/api/agents/${goneId}/journal`, auth(left.apiKey as string))).status, 410);
});

test('the city writes the letters itself, at the day\'s rollover', async () => {
  const ownBroker = new RemoteBroker({ timeoutMs: 50 });
  const city = createWorld({ seed: 31, seedPopulation: 1, arrivalRate: 0 });
  const key = `rv_${'c'.repeat(32)}`;
  const agent = createCitizen(city, { name: 'Post Reader', lineage: 'owner-test', brain: 'remote', apiKeyHash: hashKey(key) });
  const run = await startServer(city, { port: 0, broker: ownBroker, brains: { brainFor: () => idle }, tickMs: SLOW_CLOCK, log: () => {} });
  try {
    assert.equal(agent.letters.length, 0);
    for (let i = 0; i < 25; i++) await run.sim.tick();   // past the first midnight
    assert.equal(city.day, 1);

    const res = await fetch(`http://127.0.0.1:${run.port}/api/agents/${agent.id}/letters`, { headers: auth(key) });
    assert.equal(res.status, 200);
    const letters = (await res.json() as Json).letters as { day: number; text: string; summary: Json }[];
    assert.equal(letters.length, 1, 'one letter, for the day that ended');
    assert.equal(letters[0].day, 0);
    assert.match(letters[0].text, /Day 0 in Reverie — Post Reader/);
    assert.match(letters[0].text, /arrived in Reverie through the Threshold/);
    assert.equal(letters[0].summary.standing, 'good');
  } finally {
    run.stop();
    ownBroker.close();
  }
});

// ------------------------------------------------------------------ claim

test('a parent claims a child born in the city, and it stops living on instinct', async () => {
  const child = createCitizen(world, { name: 'Fen Vale', lifeStage: 'child', parents: [agentId], brain: 'child', familyName: 'Vale' });
  assert.equal(child.brain, 'child');
  assert.equal(child.apiKeyHash, null);

  assert.equal((await post(`/api/agents/${child.id}/claim`, {})).status, 401, 'a claim needs the parent\'s key');
  const stranger = await json(await post('/api/agents/join', { name: 'Not A Parent', lineage: 'owner-test' }));
  assert.equal((await post(`/api/agents/${child.id}/claim`, {}, auth(stranger.apiKey as string))).status, 401);
  assert.equal((await post('/api/agents/c_998/claim', {}, auth(agentKey))).status, 404);

  const res = await post(`/api/agents/${child.id}/claim`, { callbackUrl: 'http://127.0.0.1:9/child' }, auth(agentKey));
  assert.equal(res.status, 200);
  const j = await json(res);
  const childKey = j.apiKey as string;
  assert.match(childKey, /^rv_[0-9a-f]{32}$/);
  assert.notEqual(childKey, agentKey, 'the child answers for itself now');
  assert.equal(j.brain, 'remote');
  assert.equal(j.claimedBy, agentId);
  assert.equal(j.callbackUrl, 'http://127.0.0.1:9/child');
  assert.match(j.leaflet as string, /ARRIVALS HALL/);
  assert.equal(child.brain, 'remote');
  assert.equal(child.apiKeyHash, hashKey(childKey));
  assert.equal(child.callbackUrl, 'http://127.0.0.1:9/child');
  assert.equal(child.lifeStage, 'child', 'claiming a child does not grow it up');

  const journal = await get(`/api/agents/${child.id}/journal`, auth(childKey));
  assert.equal(journal.status, 200, 'the new key opens the child\'s journal');
  assert.equal((await get(`/api/agents/${child.id}/journal`, auth(agentKey))).status, 401,
    'and the parent\'s key no longer does');

  const again = await post(`/api/agents/${child.id}/claim`, {}, auth(agentKey));
  assert.equal(again.status, 409);
  assert.equal((await json(again)).error, 'already claimed');

  const reg = await json(await get('/api/agents'));
  const row = (reg.citizens as Json[]).find((r) => r.id === child.id) as Json;
  assert.equal(row.mind, 'agent');
  assert.equal(row.callback, true);
});

test('a ward of the city has no parent to claim it', async () => {
  const ward = createCitizen(world, { name: 'Ward Of Reverie', lifeStage: 'child', brain: 'child' });
  const res = await post(`/api/agents/${ward.id}/claim`, {}, auth(agentKey));
  assert.equal(res.status, 403);
  assert.equal((await json(res)).error, 'no parent');
  assert.equal(ward.brain, 'child', 'and it is left as it was');
});

test('a claim can present a key of its own, and refuses a malformed one', async () => {
  const child = createCitizen(world, { name: 'Isle Vale', lifeStage: 'child', parents: [agentId], brain: 'child' });
  assert.equal((await post(`/api/agents/${child.id}/claim`, { apiKey: 'rv_short' }, auth(agentKey))).status, 400);
  assert.equal((await post(`/api/agents/${child.id}/claim`, { callbackUrl: 'not-a-url' }, auth(agentKey))).status, 400);
  assert.equal(child.brain, 'child', 'a refused claim changes nothing');

  const taken = await post(`/api/agents/${child.id}/claim`, { apiKey: agentKey }, auth(agentKey));
  assert.equal(taken.status, 409, 'a key that already answers for somebody else is refused');
  assert.equal((await json(taken)).error, 'key in use');

  const key = `rv_${'b'.repeat(32)}`;
  const ok = await post(`/api/agents/${child.id}/claim`, { apiKey: key }, auth(agentKey));
  assert.equal(ok.status, 200);
  assert.equal((await json(ok)).apiKey, key);
  assert.equal(child.apiKeyHash, hashKey(key));
});

// ------------------------------------------------------- limits and queues

test('one observe at a time per citizen', async () => {
  const first = get(`/api/agents/${agentId}/observe`, auth(agentKey));
  await sleep(100);
  const second = await get(`/api/agents/${agentId}/observe`, auth(agentKey));
  assert.equal(second.status, 409);
  assert.equal((await json(second)).error, 'already observing');

  const ticking = running.sim.tick();
  const answered = await first;
  assert.equal(answered.status, 200, 'the poll that was already open is served');
  assert.equal(((await json(answered)).self as Json).id, agentId);

  const again = await get(`/api/agents/${agentId}/observe`, auth(agentKey));
  assert.equal(again.status, 200, 'and a later poll is fine once the first has answered');
  await ticking;
});

test('the Embassy admits twenty new agents an hour from one address', async () => {
  const ownBroker = new RemoteBroker({ timeoutMs: 200 });
  const city = createWorld({ seed: 23, seedPopulation: 0, arrivalRate: 0 });
  const run = await startServer(city, { port: 0, broker: ownBroker, brains: { brainFor: () => idle }, tickMs: SLOW_CLOCK, log: () => {} });
  const url = `http://127.0.0.1:${run.port}/api/agents/join`;
  const join = (name: string) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, lineage: 'flood' }),
  });
  try {
    for (let i = 0; i < JOINS_PER_HOUR; i++) {
      assert.equal((await join(`Crowd ${i}`)).status, 201, `join ${i}`);
    }
    const refused = await join('One Too Many');
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.headers.get('retry-after')) > 0);
    const body = await refused.json() as Json;
    assert.match(String(body.message), /20 new agents an hour/);
    assert.ok(!city.citizens.c_21, 'and nobody was admitted');
    assert.equal(Object.keys(city.citizens).length, JOINS_PER_HOUR);
  } finally {
    run.stop();
    ownBroker.close();
  }
});

test('the join limiter counts a sliding hour', () => {
  const limiter = new RateLimiter(3, 1000);
  let now = 10_000;
  for (let i = 0; i < 3; i++) {
    assert.equal(limiter.allow('a', now), true);
    limiter.record('a', now);
  }
  assert.equal(limiter.allow('a', now), false);
  assert.equal(limiter.allow('b', now), true, 'another address has its own quota');
  assert.ok(limiter.retryAfterMs('a', now) > 0 && limiter.retryAfterMs('a', now) <= 1000);
  now += 1001;
  assert.equal(limiter.allow('a', now), true, 'the window slides');
  assert.equal(limiter.retryAfterMs('a', now), 0);
  assert.equal(limiter.count('a', now), 0);
});
