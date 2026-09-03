/**
 * Diaries (src/identity/diary.ts).
 *
 * One line a day, public, never taken away from a citizen — not by a
 * suspension and not by the cells.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, Job, World } from '../src/types.ts';
import { MAX_DIARY, MAX_DIARY_SHOWN } from '../src/data/metropolis.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import { emit } from '../src/sim/events.ts';
import {
  MAX_DIARY_TEXT, diaryOf, hasWrittenToday, quotableDiaries, recentDiary, templatedLine, writeDiary,
} from '../src/identity/diary.ts';

function jobFor(world: World, c: Citizen, title = 'Forge Operator'): Job {
  const job: Job = {
    id: `j_${Object.keys(world.jobs).length + 1}`, role: 'forge_operator', title, employer: 'city',
    buildingId: 'compute_forge', district: 'foundry_row', skill: 'crafting', minSkill: 0,
    minReputation: 0, wage: 12, output: {}, holderId: c.id, createdDay: 0,
  };
  world.jobs[job.id] = job;
  c.jobId = job.id;
  return job;
}

// ------------------------------------------------------------------ writing

test('a citizen writes one line a day, and a second write replaces the first', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Ondine' });
  const first = writeDiary(w, c.id, 'Worked the forge until the lamps went on.');
  assert.equal(first.ok, true);
  assert.equal(hasWrittenToday(w, c), true);
  const second = writeDiary(w, c.id, 'Thought better of it.');
  assert.equal(second.ok, true);
  assert.equal(c.diary.length, 1, 'one entry for one day');
  assert.equal(c.diary[0].text, 'Thought better of it.');
  assert.equal(c.diary[0].day, w.day);
  w.day = 1;
  assert.equal(hasWrittenToday(w, c), false);
  writeDiary(w, c.id, 'A new day.');
  assert.equal(c.diary.length, 2);
});

test('a diary line is trimmed to length, folded onto one line, and never empty', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  const long = 'x'.repeat(MAX_DIARY_TEXT + 200);
  assert.equal(writeDiary(w, c.id, long).ok, true);
  assert.equal(c.diary[0].text.length, MAX_DIARY_TEXT);
  w.day = 1;
  writeDiary(w, c.id, '  Rain\n\nall   day.\t');
  assert.equal(c.diary[1].text, 'Rain all day.');
  w.day = 2;
  const empty = writeDiary(w, c.id, '   \n ');
  assert.equal(empty.ok, false);
  assert.equal(c.diary.length, 2, 'nothing was written');
  assert.equal(writeDiary(w, 'c_nobody', 'hello').ok, false);
});

test('a diary is bounded, keeping the most recent days', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  for (let day = 0; day < MAX_DIARY + 15; day++) {
    w.day = day;
    writeDiary(w, c.id, `Day ${day}.`);
  }
  assert.equal(c.diary.length, MAX_DIARY);
  assert.equal(c.diary[c.diary.length - 1].text, `Day ${MAX_DIARY + 14}.`);
  assert.equal(c.diary[0].text, `Day ${15}.`);
  assert.equal(diaryOf(w, c.id).length, MAX_DIARY);
  assert.equal(diaryOf(w, c.id, 3).length, 3);
  assert.equal(recentDiary(w, c.id).length, MAX_DIARY_SHOWN);
  assert.deepEqual(diaryOf(w, 'c_nobody'), []);
  assert.deepEqual(diaryOf(w, c.id, 0), []);
});

test('the city hears the line, and hears it lightly', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Bram', familyName: 'Corvane' });
  writeDiary(w, c.id, 'Rain off the Harbor all day.');
  const ev = w.events[w.events.length - 1];
  assert.equal(ev.kind, 'diary');
  assert.equal(ev.weight, 0.1);
  assert.deepEqual(ev.actors, [c.id]);
  assert.match(ev.text, /Bram Corvane wrote: "Rain off the Harbor all day\."/);
  assert.equal(c.memory.length, 0, 'a citizen need not be told what it just wrote');
});

test('a jailed, suspended or exiled citizen still has its own words', () => {
  const w = makeWorld();
  const jailed = makeCitizen(w, { name: 'Held' });
  jailed.jailedUntilDay = w.day + 3;
  assert.equal(writeDiary(w, jailed.id, 'A day in the cells.').ok, true);
  const suspended = makeCitizen(w, { standing: 'suspended' });
  assert.equal(writeDiary(w, suspended.id, 'Nothing to do but wait.').ok, true);
  const exiled = makeCitizen(w, { standing: 'exiled' });
  assert.equal(writeDiary(w, exiled.id, 'Outside the Gate.').ok, true);
});

// --------------------------------------------------------- the templated line

test('a reflex line is one sentence, deterministic for a seed, and never longer than a line', () => {
  const a = makeWorld({ seed: 17 });
  const b = makeWorld({ seed: 17 });
  const ca = makeCitizen(a, { name: 'Same' });
  const cb = makeCitizen(b, { name: 'Same' });
  jobFor(a, ca);
  jobFor(b, cb);
  ca.shiftsToday = 3;
  cb.shiftsToday = 3;
  const la = templatedLine(a, ca);
  const lb = templatedLine(b, cb);
  assert.equal(la, lb, 'the same seed writes the same line');
  assert.ok(la.length > 0 && la.length <= MAX_DIARY_TEXT);
  assert.equal(la.includes('\n'), false);
  assert.match(la, /3 shifts/);
});

test('a reflex line reports the day that happened, and never a plan for the next', () => {
  const w = makeWorld({ seed: 4 });
  const c = makeCitizen(w, { name: 'Mira' });
  jobFor(w, c, 'Courier');

  c.shiftsToday = 0;
  c.contactsToday = {};
  const quiet = templatedLine(w, c);
  assert.match(quiet, /Commons/, 'a quiet day names where it was spent');

  c.contactsToday = { c_2: 1, c_3: 2 };
  assert.match(templatedLine(w, c), /2/);

  c.contactsToday = {};
  c.jailedUntilDay = w.day + 1;
  assert.match(templatedLine(w, c), /cells|Watch House/);
  c.jailedUntilDay = null;

  c.health = { glitched: true, sinceDay: w.day };
  assert.match(templatedLine(w, c), /glitch|half speed/);
  c.health = { glitched: false, sinceDay: null };

  emit(w, 'verdict', 'The Court found Mira guilty.', [c.id], 0.8);
  assert.match(templatedLine(w, c), /Court/);

  // Nothing a line says is a wish, an intention or an instruction.
  const forbidden = /\b(should|must|will|plan|want|need to|goal|tomorrow|I hope)\b/i;
  for (let i = 0; i < 60; i++) {
    c.shiftsToday = i % 4;
    assert.doesNotMatch(templatedLine(w, c), forbidden);
  }
});

test('a reflex line copes with a citizen who has no job, no district name and no weather', () => {
  const w = makeWorld({ seed: 2 });
  const c = makeCitizen(w);
  delete (c as Partial<Citizen>).contactsToday;
  delete (c as Partial<Citizen>).shiftsToday;
  c.jobId = null;
  const line = templatedLine(w, c);
  assert.ok(line.length > 0);
  assert.equal(line.includes('{'), false, 'every placeholder was filled');
});

test('the day gives the line its tail: a hungry citizen says so, a fed one talks about the sky', () => {
  const w = makeWorld({ seed: 9 });
  const c = makeCitizen(w);
  c.needs.energy = 5;
  const hungry = templatedLine(w, c);
  assert.match(hungry, /Hungry|compute/);
  c.needs = { energy: 90, rest: 90, social: 90, comfort: 90, purpose: 90 };
  w.weather = 'snow';
  assert.match(templatedLine(w, c), /Snow/);
  w.weather = 'storm';
  assert.match(templatedLine(w, c), /storm|wind/);
});

// ------------------------------------------------------------ what is quoted

test('the Chronicle quotes the day, most-looked-at citizens first', () => {
  const w = makeWorld();
  const quiet = makeCitizen(w, { name: 'Quiet', reputation: 20 });
  const mayor = makeCitizen(w, { name: 'Mayor', reputation: 60 });
  const middle = makeCitizen(w, { name: 'Middle', reputation: 40 });
  w.government.mayorId = mayor.id;
  mayor.office = 'mayor';
  for (const c of [quiet, mayor, middle]) writeDiary(w, c.id, `${c.name} wrote something.`);
  emit(w, 'verdict', 'Middle stood before the Court.', [middle.id], 0.9);

  const quoted = quotableDiaries(w, w.day, 3);
  assert.equal(quoted.length, 3);
  assert.equal(quoted[0].c.id, mayor.id, 'the Mayor is always news');
  assert.equal(quoted[1].c.id, middle.id, 'and so is a day in Court');
  assert.equal(quoted[2].c.id, quiet.id);
  assert.equal(quoted[0].text, 'Mayor wrote something.');
  assert.deepEqual(quotableDiaries(w, w.day, 1).map((q) => q.c.id), [mayor.id]);
  assert.deepEqual(quotableDiaries(w, w.day, 0), []);
});

test('a day nobody wrote on is quoted with nothing at all', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  assert.deepEqual(quotableDiaries(w, 0, 5), []);
  writeDiary(w, c.id, 'Something.');
  assert.deepEqual(quotableDiaries(w, 99, 5), []);
  assert.equal(quotableDiaries(w, 0, 5).length, 1);
  // A citizen who has left the turn order is no longer part of the city's day.
  w.order = [];
  assert.deepEqual(quotableDiaries(w, 0, 5), []);
});

test('quoting is stable: the same day quoted twice reads the same way', () => {
  const w = makeWorld({ seed: 3 });
  const all: Citizen[] = [];
  for (let i = 0; i < 12; i++) {
    const c = makeCitizen(w, { name: `Cit${i}`, reputation: 50 });
    writeDiary(w, c.id, `Line ${i}.`);
    all.push(c);
  }
  const first = quotableDiaries(w, w.day, 5).map((q) => q.c.id);
  const again = quotableDiaries(w, w.day, 5).map((q) => q.c.id);
  assert.deepEqual(again, first);
  assert.equal(new Set(first).size, 5);
});
