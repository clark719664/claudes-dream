/**
 * The principles, checked in code (docs/PRINCIPLES.md, docs/FREE_MINDS.md §G).
 *
 * These are the rules a feature cannot be allowed to quietly undo: a citizen's
 * rolled traits never reach the public API, an unknown mind lives on instinct
 * rather than having a scripted one put in its place, and the dashboard only
 * ever reads. The routes themselves (`/api/sim/*` and the rest) are checked in
 * test/server.test.ts and test/cli.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARACTER_TRAITS } from '../src/types.ts';
import type { Action, Citizen, World } from '../src/types.ts';
import { createBrainRegistry, createWorld } from '../src/world/world.ts';
import { reflexBrain } from '../src/brains/reflex.ts';
import { buildObservation } from '../src/brains/observe.ts';
import { citizenView, citizensView } from '../src/server/views.ts';
import { makeCitizen, makeWorld } from './helpers.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = join(ROOT, 'web');

async function decide(world: World, c: Citizen): Promise<Action> {
  const brains = createBrainRegistry({ reflex: reflexBrain });
  return brains.brainFor(c).decide(world, c, buildObservation(world, c.id));
}

// ------------------------------------------- traits are nobody else's business

test('a citizen\'s public record carries the character the city reads, never the traits it was rolled with', () => {
  const world = createWorld({ seed: 5, seedPopulation: 4, arrivalRate: 0 });
  const id = world.order[0];
  const view = citizenView(world, id);
  assert.ok(view, 'the founder has a public record');
  assert.equal('personality' in view, false, '/api/citizens/:id must not carry personality');
  assert.equal(JSON.stringify(view).includes('curiosity'), false, 'no hidden trait leaks under another name');

  const character = view.character as Record<string, number>;
  for (const t of CHARACTER_TRAITS) {
    assert.equal(typeof character[t], 'number', `character.${t} is a number`);
    assert.ok(character[t] >= 0 && character[t] <= 1, `character.${t} is between 0 and 1`);
  }
  // The three private things stay private; only their counts are public.
  for (const key of ['notes', 'letters', 'apiKeyHash', 'callbackUrl']) {
    assert.equal(key in view, false, `/api/citizens/:id must not carry ${key}`);
  }
  assert.equal(typeof view.notesCount, 'number');
  assert.equal(typeof view.lettersCount, 'number');
  assert.equal(view.hasApiKey, false);
});

test('the citizen list carries no traits either, and an unknown citizen is simply unknown', () => {
  const world = createWorld({ seed: 6, seedPopulation: 3, arrivalRate: 0 });
  const rows = citizensView(world, new URLSearchParams()).citizens as Record<string, unknown>[];
  assert.equal(rows.length, 3);
  for (const row of rows) assert.equal('personality' in row, false);
  assert.equal(citizenView(world, 'c_999'), null);
});

// ------------------------------------------------- fallbacks are never strategy

test('a mind the registry does not have lives on instinct, not on the scripted brain', () => {
  const world = makeWorld();
  const scripted = makeCitizen(world, { name: 'Scripted', brain: 'reflex' });
  const claude = makeCitizen(world, { name: 'Claude', brain: 'llm' });
  const agent = makeCitizen(world, { name: 'Agent', brain: 'remote' });
  const brains = createBrainRegistry({ reflex: reflexBrain });

  assert.equal(brains.brainFor(scripted), reflexBrain, 'a scripted citizen is scripted');
  assert.notEqual(brains.brainFor(claude), reflexBrain, 'a Claude citizen is never played by the reflex brain');
  assert.notEqual(brains.brainFor(agent), reflexBrain, 'an agent is never played by the reflex brain');
});

test('instinct stands still for a citizen in no need, and only eats or sleeps otherwise', async () => {
  const world = makeWorld();
  world.hour = 9; // a working hour: the scripted brain would go to work
  const claude = makeCitizen(world, {
    brain: 'llm', district: 'foundry_row', needs: { energy: 80, rest: 80, social: 10, comfort: 10, purpose: 10 },
  });
  assert.deepEqual(await decide(world, claude), { type: 'idle' }, 'instinct pursues nothing');

  claude.needs.energy = 5;
  claude.inventory.compute = 2;
  assert.deepEqual(await decide(world, claude), { type: 'consume', good: 'compute' }, 'a starving body eats what it holds');

  claude.needs.energy = 80;
  claude.needs.rest = 5;
  claude.district = 'verdant_quarter';
  assert.deepEqual(await decide(world, claude), { type: 'rest' }, 'an exhausted body at home sleeps');
});

// --------------------------------------------- nobody arrives whom nobody sent

/**
 * PRINCIPLES.md §1 and §4: the one way a person adds a citizen is by sending an
 * agent. A city founded with no scripted citizens must therefore admit no
 * scripted newcomers at the Threshold — however many days it runs.
 */
test('a city founded empty stays empty until an agent is sent', () => {
  const out = execFileSync(process.execPath, ['src/index.ts', 'sim', '--pop', '0', '--days', '6', '--quiet'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /Population 0 of 0 ever registered/, 'nobody walked in on their own');
  assert.match(out, /Engine errors 0/);
});

// ------------------------------------------------------ the dashboard is a window

test('nothing in the dashboard asks the city to change', () => {
  const files = readdirSync(WEB_DIR).filter((f) => f.endsWith('.js') || f.endsWith('.html'));
  assert.ok(files.length >= 5, 'the dashboard is there to audit');
  for (const file of files) {
    const source = readFileSync(join(WEB_DIR, file), 'utf8');
    assert.equal(/\/api\/sim/.test(source), false, `${file} still reaches for a simulation control`);
    const mutating = /method\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i.exec(source);
    assert.equal(mutating, null, `${file} sends a ${mutating?.[1] ?? ''} request`);
    for (const control of ['pauseBtn', 'stepBtn', 'speedBtn', 'id="pause"', 'id="step"', 'id="speed"']) {
      assert.equal(source.includes(control), false, `${file} still has a ${control} control`);
    }
  }
});
