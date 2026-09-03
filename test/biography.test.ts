/**
 * Life stories (src/identity/biography.ts).
 *
 * A biography is read off the public record and writes nothing back. What is
 * checked here: that it says what happened, that it says something even when
 * nothing has, that an exile's story ends where the city's does, and that no
 * hidden trait ever finds its way into a sentence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRAITS } from '../src/types.ts';
import type { Business, Citizen, Job, Work, World } from '../src/types.ts';
import { CHILDHOOD_DAYS } from '../src/data/catalogue.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import { MAX_BIOGRAPHY_SENTENCES, biography, epithet, jobsHeld, timeline } from '../src/identity/biography.ts';

function hire(world: World, c: Citizen, title: string, role: Job['role'] = 'forge_operator'): Job {
  const job: Job = {
    id: `j_${Object.keys(world.jobs).length + 1}`, role, title, employer: 'city',
    buildingId: 'compute_forge', district: 'foundry_row', skill: 'crafting', minSkill: 0,
    minReputation: 0, wage: 12, output: {}, holderId: c.id, createdDay: 0,
  };
  world.jobs[job.id] = job;
  c.jobId = job.id;
  c.memory.push({ tick: world.tick, kind: 'work', text: `You were hired as ${title} at the City of Reverie (12 ℓ per shift).` });
  return job;
}

function sentences(text: string): string[] {
  return text.split(/(?<=\.)\s+/).filter(Boolean);
}

// -------------------------------------------------------------- the opening

test("a founder's story names the day they arrived and the work they do", () => {
  const w = makeWorld();
  w.day = 40;
  const c = makeCitizen(w, { name: 'Ondine', familyName: 'Ashgrove', lineage: 'Claude', arrivedDay: 0 });
  hire(w, c, 'Forge Operator');
  const story = biography(w, c.id);
  assert.match(story, /^Ondine Ashgrove \(Claude\) arrived at the Threshold on day 0\./);
  assert.match(story, /forge operator at the City of Reverie/);
  assert.ok(sentences(story).length >= 2 && sentences(story).length <= MAX_BIOGRAPHY_SENTENCES);
});

test('a citizen born in the city is born, not arrived, and its parents are named', () => {
  const w = makeWorld();
  const mother = makeCitizen(w, { name: 'Ilse', familyName: 'Ashgrove' });
  const father = makeCitizen(w, { name: 'Bram', familyName: 'Corvane' });
  w.day = 12;
  const kid = makeCitizen(w, { name: 'Wren', familyName: 'Ashgrove', lifeStage: 'child', bornDay: 12 });
  kid.family.parents = [mother.id, father.id];
  assert.match(biography(w, kid.id), /^Wren Ashgrove was born in Reverie on day 12 to Ilse Ashgrove and Bram Corvane\./);
  assert.equal(biography(w, kid.id).includes('Threshold'), false);
});

test('a citizen with nothing to say still has one sentence, and an unknown id has none', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Nobody' });
  const story = biography(w, c.id);
  assert.ok(story.length > 0);
  assert.ok(sentences(story).length >= 1);
  assert.match(story, /never held a job/);
  assert.equal(biography(w, 'c_999'), '');
  assert.equal(epithet(w, undefined as unknown as Citizen), '');
  assert.deepEqual(timeline(w, 'c_999'), []);
});

// ------------------------------------------------------------- a whole life

test('a full life reads as work, family, office, works and the record', () => {
  const w = makeWorld();
  w.day = 200;
  const c = makeCitizen(w, { name: 'Ondine', familyName: 'Ashgrove', arrivedDay: 0 });
  const spouse = makeCitizen(w, { name: 'Bram', familyName: 'Corvane' });
  const kid = makeCitizen(w, { name: 'Wren', familyName: 'Ashgrove', lifeStage: 'child' });
  hire(w, c, 'Forge Operator');
  c.memory.push({ tick: 0, kind: 'work', text: 'You quit your job as Courier at the City of Reverie.' });
  c.family.partnerId = spouse.id;
  c.family.partnerSinceDay = 41;
  c.family.married = true;
  c.family.children = [kid.id];
  w.government.council = [c.id];
  c.milestones = [{ day: 60, text: 'Ondine Ashgrove took public office in Reverie.' }];
  const work: Work = {
    id: 'w_1', kind: 'painting', title: 'Lanterns at the Quay', creatorId: c.id, createdDay: 90,
    quality: 94, popularity: 40, home: 'gallery_of_echoes', inMuseum: true, reviews: [],
  };
  w.works = { w_1: work };
  c.works = ['w_1'];
  c.record.convictions = [{ caseId: 'k_3', law: 'L04', severity: 1, tier: 2, day: 120 }];

  const story = biography(w, c.id);
  assert.match(story, /arrived at the Threshold on day 0/);
  assert.match(story, /courier/i);
  assert.match(story, /married Bram Corvane on day 41/);
  assert.match(story, /one child/);
  assert.match(story, /Councillor/);
  assert.match(story, /Lanterns at the Quay/);
  assert.match(story, /Museum/);
  assert.match(story, /convicted them once/);
  assert.ok(sentences(story).length <= MAX_BIOGRAPHY_SENTENCES, 'a life story is not a book');
});

test("an exile's story ends with the exile and the case that caused it", () => {
  const w = makeWorld();
  w.day = 190;
  const c = makeCitizen(w, { name: 'Kell', familyName: 'Draye', arrivedDay: 4, standing: 'exiled' });
  c.record.convictions = [{ caseId: 'k_7', law: 'L15', severity: 5, tier: 5, day: 190 }];
  c.exiledCaseId = 'k_7';
  c.exiledDay = 190;
  const story = biography(w, c.id);
  const last = sentences(story).pop() ?? '';
  assert.match(last, /exiled through the Gate on day 190/);
  assert.match(last, /k_7/);
  assert.match(last, /extortion/i);
});

test('a citizen who chose the Archive ends there', () => {
  const w = makeWorld();
  w.day = 220;
  const c = makeCitizen(w, { name: 'Sable', lifeStage: 'elder', arrivedDay: 0 });
  c.sunsetDay = 220;
  const last = sentences(biography(w, c.id)).pop() ?? '';
  assert.match(last, /day 220 they chose the Archive/);
});

test('a citizen who simply left is said to have left', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Gone' });
  w.order = w.order.filter((id) => id !== c.id);
  assert.match(biography(w, c.id), /left Reverie through the Threshold/);
});

// -------------------------------------------------------- nothing hidden

test('no hidden trait, by name or by value, reaches a life story', () => {
  const w = makeWorld();
  const c = makeCitizen(w, {
    name: 'Private',
    personality: { curiosity: 0.111111, diligence: 0.222222, sociability: 0.333333, honesty: 0.444444, ambition: 0.555555 },
  });
  hire(w, c, 'Librarian', 'librarian');
  c.notes = ['a private thought'];
  c.letters = [{ day: 0, text: 'Dear owner', summary: { earned: 0, spent: 0, met: [], standing: 'good', events: [] } }];
  const all = `${biography(w, c.id)} ${epithet(w, c)} ${timeline(w, c.id).map((m) => m.text).join(' ')}`;
  for (const t of TRAITS) {
    assert.equal(all.includes(t), false, `no story names ${t}`);
    assert.equal(all.includes(String(c.personality[t])), false, `no story carries ${t}'s value`);
  }
  assert.equal(all.includes('a private thought'), false, 'notes stay private');
  assert.equal(all.includes('Dear owner'), false, 'letters stay private');
});

test('telling a life changes nothing about it', () => {
  const w = makeWorld({ seed: 15 });
  const c = makeCitizen(w, { name: 'Untouched' });
  hire(w, c, 'Medic', 'medic');
  const before = JSON.stringify(w);
  const rng = w.rng.s;
  biography(w, c.id);
  epithet(w, c);
  timeline(w, c.id);
  jobsHeld(w, c);
  assert.equal(JSON.stringify(w), before, 'a biography is a reading, not a change');
  assert.equal(w.rng.s, rng, 'and it rolls no dice');
});

// ---------------------------------------------------------------- epithets

test('an epithet is work, office and family, at most three parts', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Ondine', familyName: 'Ashgrove' });
  assert.equal(epithet(w, c), 'of the Ashgrove');
  hire(w, c, 'Forge Operator');
  assert.equal(epithet(w, c), 'Forge Operator at the City of Reverie');
  w.government.council = [c.id];
  assert.equal(epithet(w, c), 'Forge Operator at the City of Reverie, Councillor');
  const kid = makeCitizen(w, { lifeStage: 'child' });
  const kid2 = makeCitizen(w, { lifeStage: 'child' });
  c.family.children = [kid.id, kid2.id, 'c_ghost'];
  const full = epithet(w, c);
  assert.equal(full, 'Forge Operator at the City of Reverie, Councillor, parent of two');
  assert.equal(full.split(', ').length, 3, 'never more than three');
});

test('an epithet falls back through partner, elder and child', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { name: 'A' });
  const b = makeCitizen(w, { name: 'B', familyName: 'Vale' });
  a.family.partnerId = b.id;
  assert.match(epithet(w, a), /partner of B Vale/);
  a.family.married = true;
  assert.match(epithet(w, a), /married to B Vale/);
  const elder = makeCitizen(w, { lifeStage: 'elder' });
  assert.match(epithet(w, elder), /elder of Reverie/);
  const kid = makeCitizen(w, { lifeStage: 'child', familyName: 'Vale' });
  assert.match(epithet(w, kid), /child of the Vale family/);
  const owner = makeCitizen(w, { name: 'Owner' });
  const biz: Business = {
    id: 'b_1', name: 'The Quay Cafe', kind: 'cafe', ownerId: owner.id, treasury: 50,
    district: 'harbor_market', buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 1, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  w.businesses[biz.id] = biz;
  owner.businessId = biz.id;
  assert.match(epithet(w, owner), /owner of The Quay Cafe/);
});

// ---------------------------------------------------------------- timelines

test('a timeline is the fixed points and the milestones, in order and without repeats', () => {
  const w = makeWorld();
  w.day = 120;
  const mother = makeCitizen(w, { name: 'Ilse' });
  const father = makeCitizen(w, { name: 'Bram' });
  const c = makeCitizen(w, { name: 'Wren', bornDay: 0, lifeStage: 'adult' });
  c.family.parents = [mother.id, father.id];
  c.family.partnerId = mother.id;
  c.family.partnerSinceDay = 60;
  c.family.married = true;
  c.milestones = [
    { day: 80, text: 'Wren mastered a craft.' },
    { day: 30, text: 'Wren took public office in Reverie.' },
    { day: 80, text: 'Wren mastered a craft.' },
  ];
  const rows = timeline(w, c.id);
  const days = rows.map((r) => r.day);
  assert.deepEqual(days, [...days].sort((a, b) => a - b), 'in day order');
  assert.equal(new Set(rows.map((r) => `${r.day}|${r.text}`)).size, rows.length, 'no repeats');
  assert.equal(rows[0].text, 'Born in Reverie to Ilse and Bram.');
  assert.ok(rows.some((r) => r.day === CHILDHOOD_DAYS && r.text === 'Came of age.'));
  assert.ok(rows.some((r) => r.day === 60 && r.text.startsWith('Married')));
  assert.equal(rows.filter((r) => r.text.includes('mastered a craft')).length, 1);
});

test('an arrival has an arrival, an exile has an exile, and a child has not come of age', () => {
  const w = makeWorld();
  w.day = 30;
  const arrival = makeCitizen(w, { arrivedDay: 3 });
  assert.deepEqual(timeline(w, arrival.id), [{ day: 3, text: 'Arrived at the Threshold.' }]);

  const kid = makeCitizen(w, { lifeStage: 'child', bornDay: 25 });
  kid.family.parents = [arrival.id];
  assert.equal(timeline(w, kid.id).some((r) => r.text === 'Came of age.'), false);

  const exile = makeCitizen(w, { standing: 'exiled', arrivedDay: 1 });
  exile.exiledDay = 29;
  const rows = timeline(w, exile.id);
  assert.equal(rows[rows.length - 1].text, 'Exiled through the Gate.');
});
