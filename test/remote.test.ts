import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld } from './helpers.ts';
import { RemoteBroker } from '../src/brains/remote.ts';
import type { Observation } from '../src/types.ts';

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
