import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen } from './helpers.ts';
import { CHARACTER_TRAITS, NEUTRAL_CHARACTER } from '../src/types.ts';
import type { Citizen, Proposal, World } from '../src/types.ts';
import {
  CIVIC_ACTS, GENEROUS_GIFTS, SOCIABLE_ACQUAINTANCES, acquaintanceCount, characterAffinity, characterCompatibility,
  characterOf, dailyCharacter, daysResident, inferCharacter,
} from '../src/citizens/character.ts';
import { judgeBelief, fileCharge } from '../src/government/court.ts';
import { impliedPlatform } from '../src/government/elections.ts';
import { makeCtx, pickCompanion } from '../src/brains/reflex-util.ts';
import { buildObservation } from '../src/brains/observe.ts';

function at(world: World, day: number): void {
  world.day = day;
  world.hour = 10;
  world.tick = day * 24 + 10;
}

function proposalBy(w: World, proposerId: string): Proposal {
  const p: Proposal = {
    id: `p_${w.government.proposals.length + 1}`, kind: 'dividend', value: 20, lawCode: null, targetId: null,
    summary: 'Raise the dividend', proposerId, petition: false, tabledDay: w.day, status: 'open', votes: {},
    decidedDay: null, needed: 3,
  };
  w.government.proposals.push(p);
  return p;
}

// ---------------------------------------------------------------------------
// The reading itself
// ---------------------------------------------------------------------------

test('a citizen arrives with a neutral reading and nothing else', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  assert.deepEqual(c.character, NEUTRAL_CHARACTER);
  assert.notEqual(c.character, NEUTRAL_CHARACTER, 'and it is a copy, not the shared constant');
  for (const t of CHARACTER_TRAITS) assert.equal(characterOf(c)[t], 0.5);
});

test('honesty falls with offences that were caught and with convictions, never with secrets', () => {
  const w = makeWorld();
  at(w, 5);
  const clean = makeCitizen(w, { arrivedDay: 0 });
  clean.stats.shiftsWorked = 20;
  assert.equal(inferCharacter(w, clean).honesty, 1, 'a clean record reads honest');

  const sly = makeCitizen(w, { arrivedDay: 0 });
  sly.stats.shiftsWorked = 20;
  sly.stats.offencesCommitted = 10;
  assert.equal(inferCharacter(w, sly).honesty, 1, 'what the Watch never noticed is nobody else\'s knowledge');

  sly.stats.offencesDetected = 4;
  assert.equal(inferCharacter(w, sly).honesty, 0.84, '1 - 4/(20+4+1)');

  sly.record.convictions.push({ caseId: 'k_1', law: 'L04', severity: 2, tier: 2, day: 3 });
  assert.equal(inferCharacter(w, sly).honesty, 0.69, 'and a conviction costs 0.15 more');

  for (let i = 0; i < 8; i++) {
    sly.record.convictions.push({ caseId: `k_${i + 2}`, law: 'L04', severity: 2, tier: 2, day: 4 });
  }
  assert.equal(inferCharacter(w, sly).honesty, 0, 'clamped at the bottom');
});

test('diligence is shifts per resident day, sociability the company kept', () => {
  const w = makeWorld();
  at(w, 4);
  const c = makeCitizen(w, { arrivedDay: 0 });
  assert.equal(daysResident(w, c), 5);
  c.stats.shiftsWorked = 20;
  assert.equal(inferCharacter(w, c).diligence, 0.5, '20 shifts over five days is half of eight a day');
  c.stats.shiftsWorked = 400;
  assert.equal(inferCharacter(w, c).diligence, 1, 'clamped at the top');

  const fresh = makeCitizen(w);
  assert.equal(daysResident(w, fresh), 1, 'the first day counts as one');

  assert.equal(inferCharacter(w, c).sociability, 0);
  for (let i = 0; i < SOCIABLE_ACQUAINTANCES / 2; i++) c.bonds[makeCitizen(w).id] = 10;
  assert.equal(inferCharacter(w, c).sociability, 0.5);
  c.affection[makeCitizen(w).id] = 40;
  c.contactsToday[makeCitizen(w).id] = 2;
  assert.equal(inferCharacter(w, c).sociability, 0.7, 'bonds, affections and today\'s company all count once');
});

test('generosity comes from gifts given and civic life from ballots, proposals and clubs', () => {
  const w = makeWorld();
  at(w, 3);
  const c = makeCitizen(w);
  assert.equal(inferCharacter(w, c).generosity, 0);
  c.stats.giftsGiven = GENEROUS_GIFTS;
  assert.equal(inferCharacter(w, c).generosity, 0.5);
  c.stats.giftsReceived = 100;
  assert.equal(inferCharacter(w, c).generosity, 0.5, 'taking is not giving');

  assert.equal(inferCharacter(w, c).civic, 0);
  c.stats.votesCast = 2;
  proposalBy(w, c.id);
  c.clubs.push('u_1');
  assert.equal(inferCharacter(w, c).civic, 4 / (4 + CIVIC_ACTS));
  proposalBy(w, makeCitizen(w).id);
  assert.equal(inferCharacter(w, c).civic, 0.5, 'somebody else\'s proposal is not yours');
});

test('dailyCharacter refreshes every citizen and leaves an exile\'s record as it was', () => {
  const w = makeWorld();
  at(w, 2);
  const worker = makeCitizen(w, { arrivedDay: 0 });
  worker.stats.shiftsWorked = 12;
  const exile = makeCitizen(w, { standing: 'exiled', arrivedDay: 0 });
  exile.stats.shiftsWorked = 12;
  exile.character = { honesty: 0.2, diligence: 0.2, sociability: 0.2, generosity: 0.2, civic: 0.2 };
  dailyCharacter(w);
  assert.equal(worker.character.diligence, 0.5, '12 shifts in three days');
  assert.equal(exile.character.diligence, 0.2, 'the banished keep the reading they left with');
});

test('characterOf tolerates a citizen the city has not read, and clamps what it holds', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  delete (c as Partial<Citizen>).character;
  assert.deepEqual(characterOf(c), NEUTRAL_CHARACTER, 'a world saved before characters still reads');
  assert.deepEqual(characterOf(undefined), NEUTRAL_CHARACTER);
  c.character = { honesty: 5, diligence: -1, sociability: Number.NaN, generosity: 0.25, civic: 0.75 };
  assert.deepEqual(characterOf(c), { honesty: 1, diligence: 0, sociability: 0.5, generosity: 0.25, civic: 0.75 });
});

test('affinity is 1 for two of a kind and falls with the distance between readings', () => {
  const w = makeWorld();
  const a = makeCitizen(w);
  const b = makeCitizen(w);
  assert.equal(characterAffinity(characterOf(a), characterOf(b)), 1);
  assert.equal(characterCompatibility(w, a.id, b.id), 1);
  assert.equal(characterCompatibility(w, a.id, a.id), 1);
  assert.equal(characterCompatibility(w, a.id, 'c_404'), 0, 'a stranger who is not there reads as nothing');
  b.character = { honesty: 0, diligence: 0, sociability: 0, generosity: 0, civic: 0 };
  assert.equal(characterCompatibility(w, a.id, b.id), 0.5);
  assert.equal(acquaintanceCount(a), 0);
});

// ---------------------------------------------------------------------------
// Who reads it (FREE_MINDS.md §B: never the hidden traits of another)
// ---------------------------------------------------------------------------

test('a judge weighs a friend by public character, not by a personality nobody can see', () => {
  const w = makeWorld();
  at(w, 3);
  const judge = makeCitizen(w, { office: 'judge', reputation: 80 });
  const friend = makeCitizen(w);
  judge.bonds[friend.id] = 80;
  w.government.judges.push(judge.id);
  const k = fileCharge(w, { defendantId: friend.id, law: 'L04', evidence: 0.8, filedBy: 'watch', description: 'theft' });

  const belief = (): number => { w.rng.s = 99; return judgeBelief(w, judge.id, k); };
  const before = belief();
  judge.personality.honesty = 0;
  assert.equal(belief(), before, 'the hidden trait moves nothing');
  judge.character.honesty = 0;
  assert.ok(belief() < before, 'a judge the city reads as dishonest leans further for a friend');
});

test('the reflex brain chooses company by public character, not by hidden traits', () => {
  const w = makeWorld();
  at(w, 3);
  w.hour = 19;
  w.tick = 3 * 24 + 19;
  const c = makeCitizen(w, { district: 'nightglass' });
  const alike = makeCitizen(w, { name: 'Alike', district: 'nightglass' });
  const unlike = makeCitizen(w, { name: 'Unlike', district: 'nightglass' });
  unlike.character = { honesty: 0, diligence: 0, sociability: 0, generosity: 0, civic: 0 };
  // The hidden traits say the opposite of the public reading; nobody can see them.
  alike.personality = { curiosity: 0, diligence: 0, sociability: 0, honesty: 0, ambition: 0 };
  unlike.personality = { ...c.personality };

  const companion = (): Citizen | null => {
    w.rng.s = 5;
    return pickCompanion(makeCtx(w, c, buildObservation(w, c.id)));
  };
  assert.equal(companion()?.id, alike.id, 'the one the city reads as their own sort');
  alike.character = { honesty: 0, diligence: 0, sociability: 0, generosity: 0, civic: 0 };
  unlike.character = { ...c.character };
  assert.equal(companion()?.id, unlike.id, 'and it follows the reading when the reading changes');
});

test('a voter reads a candidate\'s implied platform off character, not off hidden traits', () => {
  const w = makeWorld();
  at(w, 3);
  const candidate = makeCitizen(w, { wallet: 100 });
  const before = impliedPlatform(w, candidate);
  candidate.personality = { curiosity: 1, diligence: 1, sociability: 1, honesty: 1, ambition: 1 };
  assert.deepEqual(impliedPlatform(w, candidate), before, 'nobody can see those');
  candidate.character = { ...candidate.character, honesty: 1, sociability: 1, civic: 1 };
  const after = impliedPlatform(w, candidate);
  assert.ok(after.strictness > before.strictness, 'a spotless record reads as strictness');
  assert.ok(after.dividend > before.dividend);
  assert.ok(after.tax < before.tax);
});
