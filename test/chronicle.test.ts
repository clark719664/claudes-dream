import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen } from './helpers.ts';
import type { Job, World } from '../src/types.ts';
import { emit } from '../src/sim/events.ts';
import { nextId } from '../src/util/ids.ts';
import { CHRONICLE_LENGTH, journalistStory, printMorningEdition, quotesTodaysNews, topStories } from '../src/sim/chronicle.ts';

function atDay(w: World, day: number, hour = 0): void {
  w.day = day;
  w.hour = hour;
  w.tick = day * 24 + hour;
}

function addJournalistJob(w: World, holderId: string | null): Job {
  const id = nextId(w, 'j');
  const job: Job = {
    id, role: 'journalist', title: 'Journalist', employer: 'city', buildingId: 'chronicle', district: 'archive',
    skill: 'rhetoric', minSkill: 25, minReputation: 0, wage: 13, output: {}, holderId, createdDay: w.day,
  };
  w.jobs[id] = job;
  if (holderId) w.citizens[holderId].jobId = id;
  return job;
}

test('the morning edition prints yesterday\'s top five by weight, later first on ties', () => {
  const w = makeWorld();
  atDay(w, 0, 3);
  emit(w, 'social', 'early tie', [], 0.9);
  atDay(w, 0, 5);
  emit(w, 'exile', 'late tie', [], 0.9);
  atDay(w, 0, 6);
  emit(w, 'verdict', 'newsworthy', [], 0.6);
  emit(w, 'hired', 'notable early', [], 0.3);
  atDay(w, 0, 7);
  emit(w, 'hired', 'notable late', [], 0.3);
  emit(w, 'social', 'routine', [], 0.1);
  emit(w, 'social', 'routine', [], 0.1);
  atDay(w, 1, 0);
  emit(w, 'system', 'today, not yesterday', [], 1);

  const edition = printMorningEdition(w, 'Treasury: 99,800 ℓ (+0 revenue, −200 spend)');
  assert.deepEqual(edition.headlines, ['late tie', 'early tie', 'newsworthy', 'notable late', 'notable early']);
  assert.equal(edition.day, 1);
  assert.equal(edition.treasuryReport, 'Treasury: 99,800 ℓ (+0 revenue, −200 spend)');
  assert.deepEqual(w.chronicle, [edition]);
  const notice = w.tickEvents.find((e) => e.kind === 'story');
  assert.ok(notice && notice.weight === 0.2 && notice.text.includes('late tie'));
  assert.deepEqual(notice.data?.headlines, edition.headlines);
});

test('duplicate headlines collapse and a quiet day still gets an edition', () => {
  const w = makeWorld();
  atDay(w, 4);
  emit(w, 'shortage', 'The Bazaar has run out of compute.', [], 0.6);
  emit(w, 'shortage', 'The Bazaar has run out of compute.', [], 0.6);
  emit(w, 'social', 'a chat', [], 0.1);
  atDay(w, 5);
  const edition = printMorningEdition(w, 'report');
  assert.deepEqual(edition.headlines, ['The Bazaar has run out of compute.', 'a chat']);

  const quiet = makeWorld();
  atDay(quiet, 9);
  const e = printMorningEdition(quiet, 'report');
  assert.equal(e.headlines.length, 1);
  assert.ok(e.headlines[0].includes('quiet day'));
  assert.equal(topStories(quiet, 8).length, 0);
});

test('the Chronicle does not headline its own edition notice', () => {
  const w = makeWorld();
  atDay(w, 1);
  printMorningEdition(w, 'r1');
  atDay(w, 2);
  const e = printMorningEdition(w, 'r2');
  assert.ok(e.headlines[0].includes('quiet day'));
});

test('editions are bounded and a same-day reprint replaces the earlier one', () => {
  const w = makeWorld();
  for (let d = 1; d <= CHRONICLE_LENGTH + 10; d++) {
    atDay(w, d);
    printMorningEdition(w, `r${d}`);
  }
  assert.equal(w.chronicle.length, CHRONICLE_LENGTH);
  assert.equal(w.chronicle[0].day, 11);
  assert.equal(w.chronicle[CHRONICLE_LENGTH - 1].day, CHRONICLE_LENGTH + 10);
  printMorningEdition(w, 'reprint');
  assert.equal(w.chronicle.length, CHRONICLE_LENGTH);
  assert.equal(w.chronicle[CHRONICLE_LENGTH - 1].treasuryReport, 'reprint');
});

test('only a working journalist can publish', () => {
  const w = makeWorld();
  const nobody = makeCitizen(w);
  assert.equal(journalistStory(w, nobody.id, 'Scandal!').ok, false);
  const fired = makeCitizen(w);
  addJournalistJob(w, null);
  fired.jobId = 'j_1';
  assert.equal(journalistStory(w, fired.id, 'Scandal!').ok, false, 'a job you no longer hold does not count');
  assert.equal(journalistStory(w, 'c_404', 'Scandal!').ok, false);
  const j = makeCitizen(w);
  addJournalistJob(w, j.id);
  assert.equal(journalistStory(w, j.id, '   ').ok, false, 'a story needs a headline');
  assert.equal(journalistStory(w, j.id, 'About a ghost', 'c_404').ok, false);
  j.detainedUntilTick = w.tick + 3;
  assert.equal(journalistStory(w, j.id, 'From the cells').ok, false);
  j.detainedUntilTick = null;
  assert.equal(w.events.filter((e) => e.kind === 'story').length, 0, 'failed attempts emit nothing');
  assert.equal(j.stats.storiesPublished, 0);
});

test('a published story is newsworthy, credits the journalist and raises general scrutiny', () => {
  const w = makeWorld();
  atDay(w, 3, 12);
  const j = makeCitizen(w, { name: 'Quill' });
  addJournalistJob(w, j.id);
  const r = journalistStory(w, j.id, 'Council dithers on dividend');
  assert.equal(r.ok, true);
  const story = w.tickEvents.find((e) => e.kind === 'story');
  assert.ok(story);
  assert.equal(story.weight, 0.6);
  assert.deepEqual(story.actors, [j.id]);
  assert.ok(story.text.includes('Council dithers on dividend') && story.text.includes('Quill'));
  assert.equal(j.reputation, 51);
  assert.equal(j.stats.storiesPublished, 1);
  assert.equal(w.counters.scrutiny, 1);
  assert.ok(j.memory.some((m) => m.kind === 'work' && m.text.includes('Council dithers')));
});

test('an exposé of a citizen with a recent undetected offence puts them under scrutiny', () => {
  const w = makeWorld();
  atDay(w, 5, 12);
  const j = makeCitizen(w);
  addJournalistJob(w, j.id);
  const crook = makeCitizen(w, { name: 'Sable' });
  crook.recentOffences.push({ tick: w.tick - 10, law: 'L04', detected: false, victimId: null, amount: 30 });
  const r = journalistStory(w, j.id, 'Who is lifting purses at the Bazaar?', crook.id);
  assert.equal(r.ok, true);
  assert.equal(w.counters[`scrutiny:${crook.id}`], 3);
  assert.equal(crook.reputation, 47);
  assert.equal(crook.bonds[j.id], -10);
  assert.equal(j.bonds[crook.id], undefined, 'the journalist bears no grudge');
  const story = w.tickEvents.find((e) => e.kind === 'story');
  assert.ok(story);
  assert.deepEqual(story.actors, [j.id, crook.id]);
  assert.ok(story.text.includes('Sable'));
  assert.ok(crook.memory.some((m) => m.text.includes('Watch is paying attention')));
});

test('a story about a citizen with nothing to hide changes nothing but their opinion of the press', () => {
  const w = makeWorld();
  atDay(w, 5, 12);
  const j = makeCitizen(w);
  addJournalistJob(w, j.id);
  const caught = makeCitizen(w);
  caught.recentOffences.push({ tick: w.tick - 5, law: 'L04', detected: true, victimId: null, amount: 30 });
  const stale = makeCitizen(w);
  stale.recentOffences.push({ tick: w.tick - 49, law: 'L04', detected: false, victimId: null, amount: 30 });
  const clean = makeCitizen(w);
  for (const subject of [caught, stale, clean]) {
    assert.equal(journalistStory(w, j.id, `On ${subject.id}`, subject.id).ok, true);
    assert.equal(w.counters[`scrutiny:${subject.id}`], undefined);
    assert.equal(subject.reputation, 50);
    assert.equal(subject.bonds[j.id], -3);
  }
  assert.equal(j.stats.storiesPublished, 3);
  assert.equal(j.reputation, 53);
});

test('a standing notice yields to fresh news the next morning, but still prints when there is nothing else', () => {
  const w = makeWorld();
  const standing = 'The Community Chest is empty: 4 citizens in hardship went without a stipend today.';
  atDay(w, 0, 8);
  emit(w, 'system', standing, [], 0.5);
  atDay(w, 1, 0);
  const first = printMorningEdition(w, 'r0');
  assert.deepEqual(first.headlines, [standing], 'the first morning it is news');

  atDay(w, 1, 8);
  emit(w, 'system', 'The Community Chest is empty: 7 citizens in hardship went without a stipend today.', [], 0.5);
  emit(w, 'verdict', 'The Court found Wren guilty of petty theft.', [], 0.4);
  emit(w, 'birth', 'Pim Ellery was born at the Restoration Ward.', [], 0.3);
  atDay(w, 2, 0);
  const second = printMorningEdition(w, 'r1');
  assert.equal(second.headlines[0], 'The Court found Wren guilty of petty theft.');
  assert.equal(second.headlines[1], 'Pim Ellery was born at the Restoration Ward.');
  assert.ok(/7 citizens/.test(second.headlines[2]), 'the standing notice is printed last, not first');

  atDay(w, 2, 8);
  emit(w, 'system', 'The Community Chest is empty: 9 citizens in hardship went without a stipend today.', [], 0.5);
  atDay(w, 3, 0);
  const third = printMorningEdition(w, 'r2');
  assert.ok(/9 citizens/.test(third.headlines[0]), 'with no other news the city still hears it');
});

test('the Chronicle will not print back the news the city already read today', () => {
  const w = makeWorld();
  atDay(w, 6, 9);
  const j = makeCitizen(w, { name: 'Quill' });
  addJournalistJob(w, j.id);
  const event = 'The Watch caught Sable in an act of petty theft against Ondine.';
  emit(w, 'offence', event, [], 0.5);

  const copied = journalistStory(w, j.id, event);
  assert.equal(copied.ok, false);
  assert.ok(copied.message.includes('add something of your own'));
  assert.equal(quotesTodaysNews(w, event), event);
  assert.equal(quotesTodaysNews(w, `  ${event.toUpperCase()}  `), event, 'case and spacing are no disguise');
  assert.equal(journalistStory(w, j.id, `Reverie reports: ${event}`).ok, false, 'nor is a preamble');
  assert.equal(j.stats.storiesPublished, 0);

  const own = journalistStory(w, j.id, 'Crime in the city: Sable, without work, of Harbor Market');
  assert.equal(own.ok, true, own.message);
  assert.equal(j.stats.storiesPublished, 1);
  assert.equal(quotesTodaysNews(w, 'Short line'), null, 'a short headline is nobody\'s quotation');

  atDay(w, 7, 9);
  const later = journalistStory(w, j.id, event);
  assert.equal(later.ok, true, 'yesterday\'s news may be looked back on');
});
