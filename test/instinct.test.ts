/**
 * Instinct: the fallback that is not a strategy. It eats when starving,
 * sleeps when exhausted at home, and otherwise stands still — and it never
 * touches the world, the money or the random stream while deciding.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import type { Action, ActionType, Citizen, DistrictId, Observation, Standing, World } from '../src/types.ts';
import { DISTRICT_IDS } from '../src/types.ts';
import { EXHAUSTED, HOME_DISTRICT, STARVING, bazaarHere, computePrice, instinct, instinctBrain, instinctOrIdle } from '../src/brains/instinct.ts';
import { rand, randInt } from '../src/util/rng.ts';

/** Instinct reads needs off the citizen; a bare observation is enough. */
function obsFor(c: Citizen): Observation {
  return { self: { id: c.id, needs: c.needs } } as unknown as Observation;
}

/** Everything instinct is allowed to choose. */
const INSTINCTIVE: readonly ActionType[] = ['idle', 'consume', 'buy', 'rest'];

test('starving with a compute cycle in hand: eat it', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { needs: { energy: STARVING - 1, rest: 80, social: 80, comfort: 80, purpose: 80 } });
  c.inventory.compute = 2;
  assert.deepEqual(instinct(w, c, obsFor(c)), { type: 'consume', good: 'compute' });
});

test('starving at the Bazaar with lumens: buy exactly one cycle', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { district: 'harbor_market', needs: { energy: 3, rest: 80, social: 80, comfort: 80, purpose: 80 } });
  c.wallet = computePrice(w);
  assert.equal(bazaarHere(w, c), true);
  assert.deepEqual(instinct(w, c, obsFor(c)), { type: 'buy', good: 'compute', qty: 1 });

  c.wallet = computePrice(w) - 1;
  assert.deepEqual(instinct(w, c, obsFor(c)), { type: 'idle' }, 'a lumen short is no lumen at all');

  c.wallet = 500;
  c.district = 'commons';
  assert.deepEqual(instinct(w, c, obsFor(c)), { type: 'idle' }, 'there is no Bazaar in the Commons');

  c.district = 'harbor_market';
  w.market.goods.compute.stock = 0;
  assert.deepEqual(instinct(w, c, obsFor(c)), { type: 'idle' }, 'an empty Bazaar sells nothing');
  w.market.goods.compute.stock = 100;
  w.buildings.grand_bazaar.damage = 1;
  assert.deepEqual(instinct(w, c, obsFor(c)), { type: 'idle' }, 'a wrecked Bazaar is shut');
});

test('exhausted at home: sleep — anywhere else: stand still', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { district: HOME_DISTRICT, needs: { energy: 80, rest: EXHAUSTED - 1, social: 0, comfort: 0, purpose: 0 } });
  assert.deepEqual(instinct(w, c, obsFor(c)), { type: 'rest' });
  c.homeTier = 0;
  assert.deepEqual(instinct(w, c, obsFor(c)), { type: 'rest' }, 'the Garden is a bed for the homeless');
  c.district = 'foundry_row';
  assert.deepEqual(instinct(w, c, obsFor(c)), { type: 'idle' }, 'instinct will not walk you home');
  c.district = HOME_DISTRICT;
  c.needs.rest = EXHAUSTED;
  assert.deepEqual(instinct(w, c, obsFor(c)), { type: 'idle' }, 'tired is not exhausted');
});

test('hunger comes before sleep, and an exile does nothing at all', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { district: HOME_DISTRICT, needs: { energy: 1, rest: 1, social: 0, comfort: 0, purpose: 0 } });
  c.inventory.compute = 1;
  assert.deepEqual(instinct(w, c, obsFor(c)), { type: 'consume', good: 'compute' });
  c.standing = 'exiled';
  assert.deepEqual(instinct(w, c, obsFor(c)), { type: 'idle' });
});

test('instinct reads the observation when the citizen record is not to hand', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { district: HOME_DISTRICT });
  const obs = { self: { id: c.id, needs: { ...c.needs, rest: 1 } } } as unknown as Observation;
  const bodyless = { ...c, needs: undefined } as unknown as Citizen;
  assert.deepEqual(instinct(w, bodyless, obs), { type: 'rest' });
  assert.deepEqual(instinctOrIdle(w, undefined as unknown as Citizen, obs), { type: 'idle' });
  assert.deepEqual(instinctOrIdle(undefined as unknown as World, c, obs), { type: 'idle' }, 'even without a world');
});

test('deciding by instinct changes nothing: no money, no events, no random draws', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { district: 'harbor_market', needs: { energy: 2, rest: 2, social: 0, comfort: 0, purpose: 0 } });
  c.wallet = 500;
  const before = { money: totalMoney(w), rng: w.rng.s, events: w.events.length, json: JSON.stringify(w) };
  for (let i = 0; i < 50; i++) instinct(w, c, obsFor(c));
  assert.equal(totalMoney(w), before.money);
  assert.equal(w.rng.s, before.rng, 'instinct never draws from the random stream');
  assert.equal(w.events.length, before.events);
  assert.equal(JSON.stringify(w), before.json, 'the world is untouched by thinking');
});

test('property: over ten thousand random citizens, instinct is never strategic', () => {
  const w = makeWorld({ seed: 4242 });
  const standings: Standing[] = ['good', 'probation', 'suspended', 'exiled'];
  const c = makeCitizen(w);
  for (let i = 0; i < 10_000; i++) {
    c.needs = {
      energy: randInt(w, 0, 100), rest: randInt(w, 0, 100), social: randInt(w, 0, 100),
      comfort: randInt(w, 0, 100), purpose: randInt(w, 0, 100),
    };
    c.wallet = randInt(w, 0, 5_000);
    c.district = DISTRICT_IDS[randInt(w, 0, DISTRICT_IDS.length - 1)] as DistrictId;
    c.standing = standings[randInt(w, 0, standings.length - 1)];
    c.homeTier = randInt(w, 0, 3) as Citizen['homeTier'];
    c.lifeStage = rand(w) < 0.2 ? 'child' : rand(w) < 0.5 ? 'elder' : 'adult';
    c.jobId = rand(w) < 0.5 ? 'j_1' : null;
    c.office = rand(w) < 0.2 ? 'councillor' : null;
    c.inventory = {
      compute: randInt(w, 0, 3), energy: randInt(w, 0, 3), goods: randInt(w, 0, 3),
      culture: randInt(w, 0, 3), knowledge: randInt(w, 0, 3),
    };
    w.market.goods.compute.stock = randInt(w, 0, 50);
    w.market.goods.compute.price = randInt(w, 1, 120);

    const action: Action = instinct(w, c, obsFor(c));
    assert.ok(INSTINCTIVE.includes(action.type), `instinct chose ${action.type}`);
    if (action.type === 'consume') assert.equal(action.good, 'compute');
    if (action.type === 'buy') {
      assert.equal(action.good, 'compute');
      assert.equal(action.qty, 1);
    }
    if (action.type !== 'idle') assert.notEqual(c.standing, 'exiled', 'an exile does nothing');
  }
});

test('instinctBrain answers synchronously and never throws', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  assert.equal(instinctBrain.kind, 'reflex');
  const answer = instinctBrain.decide(w, c, obsFor(c));
  assert.deepEqual(answer, { type: 'idle' });
  assert.ok(!(answer instanceof Promise), 'a fallback that waits is no fallback');
});
