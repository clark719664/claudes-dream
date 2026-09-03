import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen } from './helpers.ts';
import { MAX_NOTES, MAX_NOTE_LENGTH, forget, note, notesOf } from '../src/citizens/notes.ts';
import { availableActions, executeAction, validateAction } from '../src/actions/execute.ts';
import { buildObservation } from '../src/brains/observe.ts';

test('a note is kept as written, trimmed to length, and never empty', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  assert.equal(note(w, c.id, 'The Bazaar was out of compute at hour 9.').ok, true);
  assert.deepEqual(c.notes, ['The Bazaar was out of compute at hour 9.']);
  assert.equal(note(w, c.id, '   ').ok, false, 'a blank page is nothing to keep');
  assert.equal(note(w, c.id, '').ok, false);
  assert.equal(c.notes.length, 1);

  const long = 'x'.repeat(MAX_NOTE_LENGTH + 50);
  assert.equal(note(w, c.id, long).ok, true);
  assert.equal(c.notes[1].length, MAX_NOTE_LENGTH, 'a long note is trimmed, not refused');
  assert.equal(note(w, 'c_404', 'nobody').ok, false);
  assert.deepEqual(notesOf(w, 'c_404'), []);
});

test('the notebook holds sixty pages and the oldest falls out', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  for (let i = 0; i < MAX_NOTES + 5; i++) note(w, c.id, `note ${i}`);
  assert.equal(c.notes.length, MAX_NOTES);
  assert.equal(c.notes[0], 'note 5');
  assert.equal(c.notes[MAX_NOTES - 1], `note ${MAX_NOTES + 4}`);
});

test('forget strikes out one page by position and refuses anything else', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  assert.equal(forget(w, c.id, 0).ok, false, 'an empty notebook has no page 0');
  note(w, c.id, 'first');
  note(w, c.id, 'second');
  note(w, c.id, 'third');
  assert.equal(forget(w, c.id, 1).ok, true);
  assert.deepEqual(c.notes, ['first', 'third']);
  assert.equal(forget(w, c.id, 2).ok, false, 'past the end');
  assert.equal(forget(w, c.id, -1).ok, false);
  assert.equal(forget(w, c.id, Number.NaN).ok, false);
  assert.equal(forget(w, 'c_404', 0).ok, false);
  assert.deepEqual(c.notes, ['first', 'third']);
});

test('note and forget are actions, and the observation carries the notebook in full', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  assert.deepEqual(validateAction({ type: 'note', text: 'prices rise on Stillday' }),
    { ok: true, action: { type: 'note', text: 'prices rise on Stillday' } });
  assert.equal(validateAction({ type: 'note' }).ok, false);
  assert.equal(validateAction({ type: 'note', text: 'y'.repeat(281) }).ok, false, 'the API refuses over-long text');
  assert.deepEqual(validateAction({ type: 'forget', index: 3 }), { ok: true, action: { type: 'forget', index: 3 } });
  assert.equal(validateAction({ type: 'forget', index: -1 }).ok, false);
  assert.equal(validateAction({ type: 'forget' }).ok, false);

  assert.equal(executeAction(w, c.id, { type: 'note', text: 'Bram owes me 20 lumens.' }).ok, true);
  assert.deepEqual(buildObservation(w, c.id).self.notes, ['Bram owes me 20 lumens.']);
  assert.equal(executeAction(w, c.id, { type: 'note', text: 'The Watch patrols the Commons at noon.' }).ok, true);
  const obs = buildObservation(w, c.id);
  assert.deepEqual(obs.self.notes, ['Bram owes me 20 lumens.', 'The Watch patrols the Commons at noon.']);
  assert.notEqual(obs.self.notes, c.notes, 'the observation copies, so a brain cannot write through it');
  assert.equal(executeAction(w, c.id, { type: 'forget', index: 0 }).ok, true);
  assert.deepEqual(buildObservation(w, c.id).self.notes, ['The Watch patrols the Commons at noon.']);
});

test('a note is never an event, a memory or a headline', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  executeAction(w, c.id, { type: 'note', text: 'I mean to stand for the Council.' });
  assert.deepEqual(w.events, [], 'the city does not report what a citizen writes down');
  assert.deepEqual(w.tickEvents, []);
  assert.deepEqual(c.memory, [], 'and it does not turn up in memory either');
});

test('the notebook is open while suspended, while detained and to a child', () => {
  const w = makeWorld();
  w.day = 1; w.hour = 5; w.tick = 29;
  const held = makeCitizen(w, { detainedUntilTick: w.tick + 5 });
  assert.deepEqual(availableActions(w, held), ['note'], 'a cell leaves the notebook');
  assert.equal(executeAction(w, held.id, { type: 'idle' }).ok, false);
  assert.equal(executeAction(w, held.id, { type: 'note', text: 'They took me at the Bazaar.' }).ok, true);
  assert.deepEqual(availableActions(w, held), ['note', 'forget']);
  assert.equal(executeAction(w, held.id, { type: 'forget', index: 0 }).ok, true);

  const suspended = makeCitizen(w, { standing: 'suspended' });
  assert.ok(availableActions(w, suspended).includes('note'));
  assert.equal(executeAction(w, suspended.id, { type: 'note', text: 'Fifteen days to go.' }).ok, true);

  const child = makeCitizen(w, { lifeStage: 'child' });
  assert.ok(availableActions(w, child).includes('note'));
  assert.equal(executeAction(w, child.id, { type: 'note', text: 'School again.' }).ok, true);

  const exile = makeCitizen(w, { standing: 'exiled' });
  w.order = w.order.filter((id) => id !== exile.id);
  assert.deepEqual(availableActions(w, exile), [], 'the gate closes on everything');
  assert.equal(executeAction(w, exile.id, { type: 'note', text: 'Outside.' }).ok, false);
});
