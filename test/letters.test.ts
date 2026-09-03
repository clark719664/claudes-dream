/**
 * Letters home: the day written up for whoever sent the agent.
 *
 * The letter is drawn from records that already exist — the citizen's memory,
 * the Treasury's ledger, the day's company and the public event log — and
 * writing one must change nothing at all: no event, no memory, no lumen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { MAX_LETTERS, dailyLetters, dayWindow, letterDay, lettersOf, lettersSince, writeLetter } from '../src/citizens/letters.ts';
import { transfer } from '../src/economy/treasury.ts';
import { emit, remember } from '../src/sim/events.ts';
import type { World } from '../src/types.ts';

/** Put the clock at a given hour of a given day. */
function setClock(world: World, day: number, hour: number): void {
  world.tick = day * 24 + hour;
  world.day = day;
  world.hour = hour;
}

test('the day a letter covers is the one that has just ended', () => {
  const world = makeWorld();
  setClock(world, 3, 0);
  assert.equal(letterDay(world), 2, 'at the morning rollover the letter is yesterday\'s');
  setClock(world, 3, 14);
  assert.equal(letterDay(world), 3, 'mid-day it is today\'s');
  setClock(world, 0, 0);
  assert.equal(letterDay(world), 0, 'the first morning has no yesterday');
  assert.deepEqual(dayWindow(2), { from: 48, to: 72 });
});

test('a letter carries the day\'s money, memory, company and public record', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { name: 'Ondine', familyName: 'Ashgrove', wallet: 0 });
  const friend = makeCitizen(world, { name: 'Bram' });
  const stranger = makeCitizen(world, { name: 'Wren' });

  // Yesterday (day 1): paid, spent, remembered, seen and reported on.
  setClock(world, 1, 9);
  transfer(world, 'treasury', c.id, 40, 'wage', 'a shift at the Fabrication Works');
  remember(world, c.id, 'work', 'You were paid 40 ℓ for a shift at the Fabrication Works.');
  setClock(world, 1, 12);
  transfer(world, c.id, 'treasury', 15, 'purchase', 'compute');
  remember(world, c.id, 'money', 'You bought a compute cycle for 15 ℓ.');
  emit(world, 'social', 'Ondine and Bram talked in the Commons.', [c.id, friend.id], 0.2);
  emit(world, 'verdict', 'The Court acquitted Ondine.', [c.id], 0.7);
  c.contactsToday[friend.id] = 2;

  // Today (day 2): a line that must not appear in yesterday's letter.
  setClock(world, 2, 3);
  remember(world, c.id, 'event', 'A new day began.');
  emit(world, 'social', 'Ondine met Wren.', [c.id, stranger.id], 0.2);

  const letter = writeLetter(world, c, 1);
  assert.equal(letter.day, 1);
  assert.equal(letter.summary.earned, 40);
  assert.equal(letter.summary.spent, 15);
  assert.equal(letter.summary.standing, 'good');
  assert.deepEqual(letter.summary.met, [friend.id], 'only the company of that day');
  assert.deepEqual(letter.summary.events, ['The Court acquitted Ondine.', 'Ondine and Bram talked in the Commons.'],
    'the day\'s public events, heaviest first');

  assert.match(letter.text, /^Day 1 in Reverie — Ondine Ashgrove \(c_\d+\), test\./);
  assert.match(letter.text, /Standing good/);
  assert.match(letter.text, /40 ℓ in, 15 ℓ out/);
  assert.match(letter.text, /You were paid 40 ℓ/);
  assert.match(letter.text, /Met: Bram\./);
  assert.match(letter.text, /The Court acquitted Ondine\./);
  assert.ok(!letter.text.includes('A new day began'), 'today is not yesterday');
  assert.ok(!letter.text.includes('Wren'), 'and neither is today\'s company');
});

test('writing a letter changes nothing in the city', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { name: 'Ondine' });
  setClock(world, 1, 20);
  remember(world, c.id, 'event', 'Something happened.');
  const money = totalMoney(world);
  const events = world.events.length;
  const memory = c.memory.length;
  const rng = world.rng.s;

  const letter = writeLetter(world, c, 1);
  assert.ok(letter.text.length > 0);
  assert.equal(totalMoney(world), money, 'no lumen moves');
  assert.equal(world.events.length, events, 'a letter is private: nothing is emitted');
  assert.equal(c.memory.length, memory, 'and nothing is remembered');
  assert.equal(world.rng.s, rng, 'and the random stream is untouched');
  assert.equal(c.letters.length, 0, 'writeLetter is pure; dailyLetters files them');
});

test('a citizen who did nothing still gets a letter', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { name: 'Quiet' });
  setClock(world, 2, 0);
  const letter = writeLetter(world, c);
  assert.equal(letter.day, 1);
  assert.deepEqual(letter.summary, { earned: 0, spent: 0, met: [], standing: 'good', events: [] });
  assert.match(letter.text, /Nothing was remembered of this day\./);
  assert.match(letter.text, /Met: nobody\./);
});

test('the letter reports work, home, office and what the Court has pending', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { name: 'Judge', homeTier: 2, office: 'judge', district: 'commons', shiftsToday: 3 });
  c.finesOwed = 12;
  c.record.convictions.push({ caseId: 'k_1', law: 'L04', severity: 2, tier: 2, day: 0 });
  world.cases.k_2 = {
    id: 'k_2', defendantId: c.id, law: 'L05', severity: 2, evidence: 0.5, filedTick: 10, filedBy: 'watch',
    victimId: null, amount: 0, description: 'a charge', status: 'pending', triedDay: null, judges: [], votes: {},
    verdict: null, sentence: null, appeal: null,
  } as unknown as (typeof world.cases)[string];
  setClock(world, 1, 23);

  const text = writeLetter(world, c, 1).text;
  assert.match(text, /Work: none\./);
  assert.match(text, /Home: a tier-2 room/);
  assert.match(text, /Office: judge\./);
  assert.match(text, /Charges awaiting the Court: 1\./);
  assert.match(text, /Convictions on the record: 1\./);
  assert.match(text, /Fines unpaid: 12 ℓ\./);
});

test('a change of standing is spelled out against the previous letter', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { name: 'Rook', brain: 'remote' });
  setClock(world, 1, 0);
  dailyLetters(world);          // day 0, standing good
  c.standing = 'suspended';
  setClock(world, 2, 0);
  dailyLetters(world);          // day 1, suspended
  const latest = lettersOf(world, c.id)[1];
  assert.equal(latest.summary.standing, 'suspended');
  assert.match(latest.text, /Standing changed from good to suspended\./);
});

test('the evening post writes one letter per citizen per day and keeps thirty', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { name: 'Ondine', brain: 'remote' });
  const gone = makeCitizen(world, { name: 'Departed', brain: 'remote' });
  world.order = world.order.filter((id) => id !== gone.id);

  for (let day = 1; day <= MAX_LETTERS + 5; day++) {
    setClock(world, day, 0);
    dailyLetters(world);
  }
  const letters = lettersOf(world, c.id);
  assert.equal(letters.length, MAX_LETTERS, 'the drawer holds thirty');
  assert.equal(letters[letters.length - 1].day, MAX_LETTERS + 4, 'the newest is last');
  assert.equal(letters[0].day, MAX_LETTERS + 5 - MAX_LETTERS, 'and the oldest fell out');
  assert.deepEqual(lettersOf(world, gone.id), [], 'a citizen who has left Reverie gets no post');

  const days = letters.map((l) => l.day);
  assert.equal(new Set(days).size, days.length, 'no day is written up twice');
});

test('a scripted founder has nobody to write to; a child born here has', () => {
  const world = makeWorld();
  const founder = makeCitizen(world, { name: 'Founder', brain: 'reflex' });
  const child = makeCitizen(world, { name: 'Foundling', brain: 'child', lifeStage: 'child' });
  const claude = makeCitizen(world, { name: 'Thinker', brain: 'llm' });
  setClock(world, 1, 0);
  dailyLetters(world);
  assert.deepEqual(lettersOf(world, founder.id), [], 'nobody sent the founder, so no letter is written');
  assert.equal(lettersOf(world, child.id).length, 1, 'the parent who claims a child inherits its days');
  assert.equal(lettersOf(world, claude.id).length, 1);

  // Claim the child: it keeps everything written before.
  child.brain = 'remote';
  setClock(world, 2, 0);
  dailyLetters(world);
  assert.deepEqual(lettersOf(world, child.id).map((l) => l.day), [0, 1]);
});

test('a second pass over the same day replaces that day\'s letter', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { name: 'Ondine', brain: 'remote', wallet: 0 });
  setClock(world, 1, 12);
  transfer(world, 'treasury', c.id, 10, 'dividend', 'the daily dividend');
  setClock(world, 2, 0);
  dailyLetters(world);
  dailyLetters(world);
  const letters = lettersOf(world, c.id);
  assert.equal(letters.length, 1, 'the rollover running twice does not double the post');
  assert.equal(letters[0].summary.earned, 10);
});

test('the last day of an exile is still sent home', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { name: 'Exile', brain: 'remote' });
  setClock(world, 1, 18);
  remember(world, c.id, 'verdict', 'You were exiled through the Gate.');
  c.standing = 'exiled';
  c.exiledDay = 1;
  world.order = world.order.filter((id) => id !== c.id);
  setClock(world, 2, 0);
  dailyLetters(world);
  const letters = lettersOf(world, c.id);
  assert.equal(letters.length, 1);
  assert.equal(letters[0].summary.standing, 'exiled');
  assert.match(letters[0].text, /exiled through the Gate/);

  setClock(world, 3, 0);
  dailyLetters(world);
  assert.equal(lettersOf(world, c.id).length, 1, 'and nothing after it');
});

test('letters can be asked for from a given day onward', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { name: 'Ondine', brain: 'remote' });
  for (let day = 1; day <= 5; day++) {
    setClock(world, day, 0);
    dailyLetters(world);
  }
  assert.deepEqual(lettersSince(world, c.id, null).map((l) => l.day), [0, 1, 2, 3, 4]);
  assert.deepEqual(lettersSince(world, c.id, 3).map((l) => l.day), [3, 4]);
  assert.deepEqual(lettersSince(world, c.id, 99), []);
  assert.deepEqual(lettersSince(world, 'c_404', null), [], 'a citizen nobody knows has no letters');
});

test('an old save with no letter drawer copes', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { name: 'Ondine', brain: 'remote' });
  (c as unknown as { letters?: unknown }).letters = undefined;
  setClock(world, 1, 0);
  dailyLetters(world);
  assert.equal(lettersOf(world, c.id).length, 1);
});
