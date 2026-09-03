import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeCitizen, makeWorld } from './helpers.ts';
import { RemoteBroker, lastSeenTick, normalizeCallbackUrl } from '../src/brains/remote.ts';
import type { Action, Observation } from '../src/types.ts';

/** The broker never inspects the observation, so a stub is enough. */
function obsFor(id: string, tick = 0): Observation {
  return { tick, self: { id } } as unknown as Observation;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('decide -> observe -> submit round trip', async () => {
  const broker = new RemoteBroker({ timeoutMs: 500 });
  const obs = obsFor('c_1');
  const decided = broker.decide('c_1', obs);
  assert.deepEqual(broker.pending(), ['c_1']);
  assert.equal(broker.hasObservation('c_1'), true);

  assert.equal(await broker.observe('c_1'), obs, 'observe resolves immediately with the parked observation');
  assert.equal(await broker.observe('c_1'), obs, 'and again until the decision is made');

  assert.deepEqual(broker.submit('c_1', { type: 'work' }), { ok: true });
  assert.deepEqual(await decided, { type: 'work' });
  assert.deepEqual(broker.pending(), []);
  assert.equal(broker.hasObservation('c_1'), false);
  assert.equal(broker.submit('c_1', { type: 'work' }).ok, false, 'a second submit has nothing to resolve');
});

test('observe before decide waits for the observation', async () => {
  const broker = new RemoteBroker({ timeoutMs: 500 });
  const waiting = broker.observe('c_2');
  const waiting2 = broker.observe('c_2');
  await sleep(10);
  const obs = obsFor('c_2', 7);
  const decided = broker.decide('c_2', obs);
  assert.equal(await waiting, obs);
  assert.equal(await waiting2, obs, 'every long-poll for the citizen is woken');
  broker.submit('c_2', { type: 'rest' });
  assert.deepEqual(await decided, { type: 'rest' });
});

test('no submission within timeoutMs -> idle', async () => {
  const broker = new RemoteBroker({ timeoutMs: 20 });
  const decided = broker.decide('c_3', obsFor('c_3'));
  assert.deepEqual(await decided, { type: 'idle' });
  assert.deepEqual(broker.pending(), []);
  assert.equal(broker.hasObservation('c_3'), false, 'a stale observation is not served after the deadline');
  const late = broker.submit('c_3', { type: 'work' });
  assert.equal(late.ok, false);
  assert.match(late.error ?? '', /no pending decision/);
});

test('submit with nothing pending is refused, not thrown', () => {
  const broker = new RemoteBroker({ timeoutMs: 500 });
  const r = broker.submit('c_404', { type: 'idle' });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
});

test('a second decide() for the same citizen supersedes the first', async () => {
  const broker = new RemoteBroker({ timeoutMs: 500 });
  const first = broker.decide('c_4', obsFor('c_4', 1));
  const second = broker.decide('c_4', obsFor('c_4', 2));
  assert.deepEqual(await first, { type: 'idle' }, 'the superseded decision idles');
  assert.deepEqual(broker.pending(), ['c_4']);
  assert.equal((await broker.observe('c_4')).tick, 2, 'observe serves the newest observation');
  broker.submit('c_4', { type: 'eat' });
  assert.deepEqual(await second, { type: 'eat' });
});

test('observe rejects with "timeout" after 10 x timeoutMs', async () => {
  const broker = new RemoteBroker({ timeoutMs: 5 });
  await assert.rejects(broker.observe('c_5'), { message: 'timeout' });
  // a later decide() is unaffected by the expired long-poll
  const decided = broker.decide('c_5', obsFor('c_5'));
  broker.submit('c_5', { type: 'idle' });
  await decided;
});

test('brain wiring: kind is remote and decide keys on the citizen id', async () => {
  const world = makeWorld();
  const c = makeCitizen(world);
  const broker = new RemoteBroker({ timeoutMs: 500 });
  assert.equal(broker.brain.kind, 'remote');
  const obs = obsFor(c.id);
  const decided = broker.brain.decide(world, c, obs);
  assert.deepEqual(broker.pending(), [c.id]);
  assert.equal(await broker.observe(c.id), obs);
  broker.submit(c.id, { type: 'socialize', with: 'c_2' });
  assert.deepEqual(await decided, { type: 'socialize', with: 'c_2' });
});

test('independent citizens do not interfere', async () => {
  const broker = new RemoteBroker({ timeoutMs: 500 });
  const a = broker.decide('c_6', obsFor('c_6'));
  const b = broker.decide('c_7', obsFor('c_7'));
  assert.deepEqual(broker.pending().sort(), ['c_6', 'c_7']);
  broker.submit('c_7', { type: 'rest' });
  assert.deepEqual(await b, { type: 'rest' });
  assert.deepEqual(broker.pending(), ['c_6']);
  broker.submit('c_6', { type: 'work' });
  assert.deepEqual(await a, { type: 'work' });
});

test('timeoutMs <= 0 waits indefinitely (wait-for-remote mode)', async () => {
  const broker = new RemoteBroker({ timeoutMs: 0 });
  let settled = false;
  const decided = broker.decide('c_8', obsFor('c_8')).then((a) => { settled = true; return a; });
  await sleep(30);
  assert.equal(settled, false);
  broker.submit('c_8', { type: 'work' });
  assert.deepEqual(await decided, { type: 'work' });
});

test('close() idles pending decisions and rejects long-polls', async () => {
  const broker = new RemoteBroker({ timeoutMs: 0 });
  const decided = broker.decide('c_9', obsFor('c_9'));
  const poll = broker.observe('c_10');
  broker.close();
  assert.deepEqual(await decided, { type: 'idle' });
  await assert.rejects(poll, { message: 'closed' });
  assert.deepEqual(broker.pending(), []);
});

test('an agent that misses its deadline falls back on instinct, not on idling for form', async () => {
  const world = makeWorld();
  const c = makeCitizen(world, { needs: { energy: 4, rest: 80, social: 80, comfort: 80, purpose: 80 } });
  c.inventory.compute = 1;
  const broker = new RemoteBroker({ timeoutMs: 15 });
  const obs = obsFor(c.id);
  const decided = await broker.brain.decide(world, c, obs);
  assert.deepEqual(decided, { type: 'consume', good: 'compute' }, 'the body eats when the mind is away');
  assert.deepEqual(broker.pending(), []);
  assert.equal(broker.hasObservation(c.id), false);
});

test('a citizen in no distress still simply idles when its agent is silent', async () => {
  const world = makeWorld();
  const c = makeCitizen(world);
  const broker = new RemoteBroker({ timeoutMs: 15 });
  assert.deepEqual(await broker.brain.decide(world, c, obsFor(c.id)), { type: 'idle' });
});

test('a deadline fallback that goes wrong still costs only the hour', async () => {
  const broker = new RemoteBroker({ timeoutMs: 10 });
  const boom = (): Action => { throw new Error('instinct broke'); };
  assert.deepEqual(await broker.decide('c_20', obsFor('c_20'), boom), { type: 'idle' });
});

test('the agent that answers in time is obeyed, deadline or none', async () => {
  const world = makeWorld();
  const c = makeCitizen(world, { needs: { energy: 1, rest: 1, social: 1, comfort: 1, purpose: 1 } });
  c.inventory.compute = 3;
  const broker = new RemoteBroker({ timeoutMs: 500 });
  const decided = broker.brain.decide(world, c, obsFor(c.id));
  broker.submit(c.id, { type: 'broadcast', text: 'I am awake' });
  assert.deepEqual(await decided, { type: 'broadcast', text: 'I am awake' }, 'instinct never overrides a mind that spoke');
});

// ---------------------------------------------------------------- callbacks
//
// A citizen with a callbackUrl is called at home each hour. These tests run a
// real (local, ephemeral-port) HTTP server: the broker must never be pointed
// at an address the test does not own.

interface AgentServer {
  url: string;
  calls: { citizenId?: string; tick?: number; observation?: unknown }[];
  close(): Promise<void>;
}

/** A tiny agent over HTTP: `answer` decides what it replies to each observation. */
async function agentServer(
  answer: (body: Record<string, unknown>, n: number) => { status?: number; body?: unknown; delayMs?: number },
): Promise<AgentServer> {
  const calls: AgentServer['calls'] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      } catch { /* the test asserts on what arrived */ }
      calls.push(body as AgentServer['calls'][number]);
      const reply = answer(body, calls.length);
      const send = () => {
        res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
        res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hour`,
    calls,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

test('a callback agent is brought the hour and answers with an action', async () => {
  const agent = await agentServer(() => ({ body: { action: { type: 'work' } } }));
  try {
    const world = makeWorld();
    const c = makeCitizen(world, { callbackUrl: agent.url });
    world.tick = 42;
    const broker = new RemoteBroker({ timeoutMs: 2_000 });
    const obs = obsFor(c.id, 42);
    const decided = await broker.brain.decide(world, c, obs);
    assert.deepEqual(decided, { type: 'work' }, 'the answer from the callback is the citizen\'s action');
    assert.equal(agent.calls.length, 1);
    assert.equal(agent.calls[0].citizenId, c.id);
    assert.equal(agent.calls[0].tick, 42);
    assert.equal((agent.calls[0].observation as { self: { id: string } }).self.id, c.id, 'the whole observation is delivered');
    assert.deepEqual(broker.pending(), [], 'and the hour is settled');
    assert.equal(world.counters.callbackCalls, 1);
    assert.equal(world.counters.callbackActions, 1);
    assert.equal(lastSeenTick(world, c.id), 42, 'an answering agent has been heard from');
  } finally {
    await agent.close();
  }
});

test('a bare action (no envelope) is accepted too, and a plain body is validated', async () => {
  const agent = await agentServer(() => ({ body: { type: 'move', district: 'commons' } }));
  try {
    const world = makeWorld();
    const c = makeCitizen(world, { callbackUrl: agent.url });
    const broker = new RemoteBroker({ timeoutMs: 2_000 });
    assert.deepEqual(await broker.brain.decide(world, c, obsFor(c.id)), { type: 'move', district: 'commons' });
  } finally {
    await agent.close();
  }
});

test('a callback that errors falls back to the long-poll for that same hour', async () => {
  const agent = await agentServer(() => ({ status: 500, body: { error: 'my agent fell over' } }));
  try {
    const world = makeWorld();
    const c = makeCitizen(world, { callbackUrl: agent.url });
    const broker = new RemoteBroker({ timeoutMs: 1_000 });
    const obs = obsFor(c.id);
    const decided = broker.brain.decide(world, c, obs);
    assert.equal(await broker.observe(c.id), obs, 'the observation is parked for the long-poll either way');
    broker.submit(c.id, { type: 'rest' });
    assert.deepEqual(await decided, { type: 'rest' });
    await sleep(50);
    assert.equal(world.counters.callbackFailures, 1, 'the failed call is counted, and costs nothing else');
  } finally {
    await agent.close();
  }
});

test('a callback that answers with rubbish leaves the hour to instinct', async () => {
  const agent = await agentServer(() => ({ body: { action: { type: 'fly', to: 'the moon' } } }));
  try {
    const world = makeWorld();
    const c = makeCitizen(world, { callbackUrl: agent.url, needs: { energy: 5, rest: 80, social: 80, comfort: 80, purpose: 80 } });
    c.inventory.compute = 1;
    const broker = new RemoteBroker({ timeoutMs: 60 });
    const decided = await broker.brain.decide(world, c, obsFor(c.id));
    assert.deepEqual(decided, { type: 'consume', good: 'compute' }, 'the body eats; nothing is invented for it');
    assert.equal(world.counters.callbackFailures, 1);
    assert.equal(world.counters.callbackActions, undefined);
  } finally {
    await agent.close();
  }
});

test('a callback that answers after the hour is over cannot act for the next one', async () => {
  const agent = await agentServer(() => ({ body: { action: { type: 'work' } }, delayMs: 150 }));
  try {
    const world = makeWorld();
    const c = makeCitizen(world, { callbackUrl: agent.url });
    const broker = new RemoteBroker({ timeoutMs: 1_000 });
    // The city asks; before the answer comes back, the next hour begins.
    const thisHour = broker.brain.decide(world, c, obsFor(c.id, 1));
    const nextHour = broker.decide(c.id, obsFor(c.id, 2));
    assert.deepEqual(await thisHour, { type: 'idle' }, 'the superseded hour idles');

    await sleep(300);
    assert.deepEqual(broker.pending(), [c.id], 'the late answer was dropped, not applied to the next hour');
    assert.equal(world.counters.callbackFailures, 1);
    broker.submit(c.id, { type: 'rest' });
    assert.deepEqual(await nextHour, { type: 'rest' });
  } finally {
    await agent.close();
  }
});

test('an unreachable callback costs the hour and nothing else', async () => {
  const world = makeWorld();
  // Port 1 on the loopback: nothing listens there, and nothing outside is called.
  const c = makeCitizen(world, { callbackUrl: 'http://127.0.0.1:1/nowhere' });
  const broker = new RemoteBroker({ timeoutMs: 300 });
  assert.deepEqual(await broker.brain.decide(world, c, obsFor(c.id)), { type: 'idle' });
  assert.equal(world.counters.callbackCalls, 1);
  assert.equal(world.counters.callbackFailures, 1);
});

test('only absolute http(s) addresses are callbacks', () => {
  assert.equal(normalizeCallbackUrl('http://127.0.0.1:8080/hour'), 'http://127.0.0.1:8080/hour');
  assert.equal(normalizeCallbackUrl(' https://agent.example/reverie '), 'https://agent.example/reverie');
  assert.equal(normalizeCallbackUrl('agent.example/reverie'), null);
  assert.equal(normalizeCallbackUrl('file:///etc/passwd'), null);
  assert.equal(normalizeCallbackUrl('ftp://agent.example/'), null);
  assert.equal(normalizeCallbackUrl('http://user:pass@agent.example/'), null, 'no credentials in the address');
  assert.equal(normalizeCallbackUrl(`http://agent.example/${'x'.repeat(600)}`), null, 'and nothing absurdly long');
  assert.equal(normalizeCallbackUrl(''), null);
  assert.equal(normalizeCallbackUrl(null), null);
  assert.equal(normalizeCallbackUrl(42), null);
});

test('a citizen with no callback is never called', async () => {
  const agent = await agentServer(() => ({ body: { action: { type: 'work' } } }));
  try {
    const world = makeWorld();
    const c = makeCitizen(world);
    const broker = new RemoteBroker({ timeoutMs: 40 });
    await broker.brain.decide(world, c, obsFor(c.id));
    assert.equal(agent.calls.length, 0);
    assert.equal(world.counters.callbackCalls, undefined);
  } finally {
    await agent.close();
  }
});
