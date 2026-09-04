/**
 * Rumours (src/social/rumours.ts).
 *
 * What the city says, how far it travels, what it costs the person it is said
 * about, and what happens to whoever started it when it turns out to be false.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Case, CitizenId, LawCode, Verdict, World } from '../src/types.ts';
import { MAX_RUMOURS, RUMOUR_LIFE_DAYS } from '../src/data/metropolis.ts';
import { REPORT_WINDOW_TICKS } from '../src/government/watch.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import {
  MAX_CLAIM, RUMOUR_REPUTATION, RUMOUR_SCRUTINY_DAYS, RUMOUR_SCRUTINY_HEARERS, RUMOUR_SPREAD_PER_DAY,
  dailyRumours, disproveRumours, gossip, rumoursAbout, rumoursHeardBy, scrutinyFromRumours, spreadRumours,
} from '../src/social/rumours.ts';

/** Bond high enough for friendsOf to count it (FRIEND_THRESHOLD is 40). */
const FRIENDLY = 60;

function befriend(world: World, a: CitizenId, b: CitizenId): void {
  world.citizens[a].bonds[b] = FRIENDLY;
  world.citizens[b].bonds[a] = FRIENDLY;
}

/** An offence the subject really committed and the Watch never noticed. */
function hideOffence(world: World, cId: CitizenId, law: LawCode, tick = world.tick): void {
  world.citizens[cId].recentOffences.push({ tick, law, detected: false, victimId: null, amount: 0 });
}

function closedCase(world: World, defendantId: CitizenId, law: LawCode, verdict: Verdict): Case {
  const id = `k_${Object.keys(world.cases).length + 1}`;
  const k = {
    id, defendantId, law, severity: 2, evidence: 0.6, filedTick: world.tick, filedBy: 'watch',
    victimId: null, amount: 0, description: 'a charge', status: 'closed', triedDay: world.day,
    judges: [], votes: {}, reasons: {}, openedTick: null, carriedSessions: 0, decidedByDefault: false,
    verdict, sentence: null, appeal: null,
    jury: [], juryVotes: {}, juryReasons: {}, advocateId: null, advocacy: 0,
  } as unknown as Case;
  world.cases[id] = k;
  return k;
}

// ------------------------------------------------------------------- telling

test('a rumour naming a real undetected offence is truthful; one about nothing is not', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w, { name: 'Ondine' });
  const subject = makeCitizen(w, { name: 'Bram' });
  hideOffence(w, subject.id, 'L04');

  assert.equal(gossip(w, speaker.id, subject.id, 'took from the till', 'L04').ok, true);
  assert.equal(w.rumours.length, 1);
  assert.equal(w.rumours[0].truthful, true);
  assert.equal(w.rumours[0].law, 'L04');

  assert.equal(gossip(w, speaker.id, subject.id, 'cheats at cards', 'L07').ok, true);
  assert.equal(w.rumours[1].truthful, false, 'a law the subject did not break is not the truth');

  assert.equal(gossip(w, speaker.id, subject.id, 'has an odd laugh').ok, true);
  assert.equal(w.rumours[2].truthful, false, 'a claim naming no law is never truthful');
  assert.equal(w.rumours[2].law, null);
});

test('an offence too old for the report window no longer makes a rumour true', () => {
  const w = makeWorld();
  w.tick = REPORT_WINDOW_TICKS + 10;
  w.day = Math.floor(w.tick / 24);
  const speaker = makeCitizen(w);
  const subject = makeCitizen(w);
  hideOffence(w, subject.id, 'L04', 1);
  gossip(w, speaker.id, subject.id, 'took from the till', 'L04');
  assert.equal(w.rumours[0].truthful, false);
});

test('a detected offence is not a secret, so a rumour about it is not the truth', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w);
  const subject = makeCitizen(w);
  subject.recentOffences.push({ tick: w.tick, law: 'L04', detected: true, victimId: null, amount: 0 });
  gossip(w, speaker.id, subject.id, 'took from the till', 'L04');
  assert.equal(w.rumours[0].truthful, false);
});

test('everyone in the district hears it first, and the subject is never told', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w, { district: 'commons' });
  const subject = makeCitizen(w, { district: 'commons' });
  const bystander = makeCitizen(w, { district: 'commons' });
  const elsewhere = makeCitizen(w, { district: 'nightglass' });
  gossip(w, speaker.id, subject.id, 'never pays a round');
  const r = w.rumours[0];
  assert.deepEqual([...r.heardBy].sort(), [speaker.id, bystander.id].sort());
  assert.equal(r.heardBy.includes(subject.id), false, 'the subject is not told');
  assert.equal(r.heardBy.includes(elsewhere.id), false, 'another district hears nothing yet');
  assert.equal(subject.memory.length, 0);
});

test('a claim is trimmed, folded onto one line, and never empty', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w);
  const subject = makeCitizen(w);
  assert.equal(gossip(w, speaker.id, subject.id, 'x'.repeat(MAX_CLAIM + 80)).ok, true);
  assert.equal(w.rumours[0].claim.length, MAX_CLAIM);
  gossip(w, speaker.id, subject.id, '  keeps\n\n odd   hours ');
  assert.equal(w.rumours[1].claim, 'keeps odd hours');
  assert.equal(gossip(w, speaker.id, subject.id, '   \n').ok, false);
  assert.equal(w.rumours.length, 2);
});

test('gossip about a child, an exile, a stranger or yourself is refused', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w);
  const child = makeCitizen(w, { lifeStage: 'child' });
  const exile = makeCitizen(w, { standing: 'exiled' });
  assert.equal(gossip(w, speaker.id, child.id, 'is a menace').ok, false);
  assert.equal(gossip(w, speaker.id, exile.id, 'was always trouble').ok, false);
  assert.equal(gossip(w, speaker.id, 'c_nobody', 'does not exist').ok, false);
  assert.equal(gossip(w, speaker.id, speaker.id, 'is wonderful').ok, false);
  assert.equal(gossip(w, 'c_nobody', speaker.id, 'is wonderful').ok, false);
  assert.equal(w.rumours.length, 0);
});

// ----------------------------------------------------------------- spreading

test('a rumour spreads along friendships only, and never more than the daily cap', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w, { name: 'Ondine', district: 'threshold' });
  const subject = makeCitizen(w, { name: 'Bram', district: 'nightglass' });
  const friends: CitizenId[] = [];
  const strangers: CitizenId[] = [];
  for (let i = 0; i < 20; i++) friends.push(makeCitizen(w, { district: 'commons' }).id);
  for (let i = 0; i < 10; i++) strangers.push(makeCitizen(w, { district: 'commons' }).id);
  for (const f of friends) befriend(w, speaker.id, f);

  gossip(w, speaker.id, subject.id, 'never pays a round');
  const r = w.rumours[0];
  assert.deepEqual(r.heardBy, [speaker.id], 'nobody else was in the Threshold');

  spreadRumours(w);
  const gained = r.heardBy.length - 1;
  assert.ok(gained > 0, 'it reached somebody');
  assert.ok(gained <= RUMOUR_SPREAD_PER_DAY, `no more than ${RUMOUR_SPREAD_PER_DAY} a day, got ${gained}`);
  for (const id of r.heardBy) {
    assert.equal(strangers.includes(id), false, 'it never jumped to somebody with no friendship');
  }
  for (let day = 1; day < RUMOUR_LIFE_DAYS; day++) {
    w.day = day;
    spreadRumours(w);
  }
  for (const id of strangers) assert.equal(r.heardBy.includes(id), false);
});

test('every new pair of ears costs the subject reputation, and the hearer remembers it', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w, { district: 'threshold' });
  const subject = makeCitizen(w, { district: 'nightglass', reputation: 60 });
  const friend = makeCitizen(w, { district: 'commons' });
  befriend(w, speaker.id, friend.id);
  gossip(w, speaker.id, subject.id, 'takes what is not theirs');
  const before = subject.reputation;
  for (let day = 0; day < RUMOUR_LIFE_DAYS - 1 && w.rumours[0].heardBy.length < 2; day++) {
    w.day = day;
    spreadRumours(w);
  }
  const heard = w.rumours[0].heardBy.length - 1;
  assert.ok(heard >= 1, 'the friend heard it eventually');
  assert.equal(subject.reputation, before - heard * RUMOUR_REPUTATION);
  assert.ok(friend.memory.some((m) => m.text.includes('takes what is not theirs')));
});

test('a rumour never spreads once it is disproved or worn out', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w, { district: 'threshold' });
  const subject = makeCitizen(w, { district: 'nightglass' });
  for (let i = 0; i < 10; i++) befriend(w, speaker.id, makeCitizen(w, { district: 'commons' }).id);
  gossip(w, speaker.id, subject.id, 'is not to be trusted');
  w.day = RUMOUR_LIFE_DAYS;
  spreadRumours(w);
  assert.equal(w.rumours[0].heardBy.length, 1, 'a rumour older than its life spreads no further');
});

// ------------------------------------------------------------------ scrutiny

test('a truthful rumour the city has heard puts the subject under the Watch', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w, { district: 'commons' });
  const subject = makeCitizen(w, { district: 'nightglass' });
  hideOffence(w, subject.id, 'L04');
  for (let i = 0; i < RUMOUR_SCRUTINY_HEARERS; i++) makeCitizen(w, { district: 'commons' });
  gossip(w, speaker.id, subject.id, 'took from the till', 'L04');
  assert.ok(w.rumours[0].heardBy.length >= RUMOUR_SCRUTINY_HEARERS);
  scrutinyFromRumours(w);
  assert.equal(w.counters[`scrutiny:${subject.id}`], RUMOUR_SCRUTINY_DAYS);
});

test('a false rumour, however loud, buys the subject no scrutiny', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w, { district: 'commons' });
  const subject = makeCitizen(w, { district: 'nightglass' });
  for (let i = 0; i < RUMOUR_SCRUTINY_HEARERS + 2; i++) makeCitizen(w, { district: 'commons' });
  gossip(w, speaker.id, subject.id, 'took from the till', 'L04');
  scrutinyFromRumours(w);
  assert.equal(w.counters[`scrutiny:${subject.id}`], undefined);
});

// ----------------------------------------------------------------- disproving

test('a rumour nobody ever charged is disproved, and gives back half of what it took', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w, { district: 'threshold' });
  const subject = makeCitizen(w, { district: 'nightglass', reputation: 60 });
  for (let i = 0; i < 12; i++) befriend(w, speaker.id, makeCitizen(w, { district: 'commons' }).id);
  gossip(w, speaker.id, subject.id, 'sold the Forge to strangers');
  const start = subject.reputation;
  for (let day = 0; day < RUMOUR_LIFE_DAYS - 1; day++) {
    w.day = day;
    spreadRumours(w);
  }
  const cost = start - subject.reputation;
  assert.ok(cost >= 2, `the talk cost the subject something (${cost})`);
  w.day = RUMOUR_LIFE_DAYS;
  disproveRumours(w);
  assert.equal(w.rumours[0].disprovedDay, RUMOUR_LIFE_DAYS);
  assert.equal(subject.reputation, start - cost + Math.round(cost / 2));
  assert.equal(w.counters[`rumour:${w.rumours[0].id}`], undefined, 'the tally is cleared');
});

test('a false rumour, disproved, is defamation by whoever started it', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w, { name: 'Ondine' });
  const subject = makeCitizen(w, { name: 'Bram' });
  gossip(w, speaker.id, subject.id, 'takes bribes at the Watch House', 'L09');
  w.day = RUMOUR_LIFE_DAYS;
  disproveRumours(w);
  assert.ok(speaker.recentOffences.some((o) => o.law === 'L16'), 'the source committed defamation');
  assert.equal(speaker.stats.offencesCommitted, 1);
  assert.ok(speaker.memory.some((m) => m.text.includes('false')));
});

test('a truthful rumour that ages out is no defamation', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w);
  const subject = makeCitizen(w);
  hideOffence(w, subject.id, 'L04');
  gossip(w, speaker.id, subject.id, 'took from the till', 'L04');
  w.day = RUMOUR_LIFE_DAYS;
  disproveRumours(w);
  assert.equal(w.rumours[0].disprovedDay, RUMOUR_LIFE_DAYS);
  assert.equal(speaker.recentOffences.length, 0, 'the truth is never defamation');
});

test('an acquittal disproves the rumour at once; a conviction never does', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w);
  const acquitted = makeCitizen(w);
  const convicted = makeCitizen(w);
  gossip(w, speaker.id, acquitted.id, 'stole from the Bazaar', 'L04');
  gossip(w, speaker.id, convicted.id, 'stole from the Bazaar', 'L04');
  closedCase(w, acquitted.id, 'L04', 'acquitted');
  closedCase(w, convicted.id, 'L04', 'guilty');
  w.day = 1;
  disproveRumours(w);
  assert.equal(w.rumours[0].disprovedDay, 1, 'the acquittal settled it');
  assert.equal(w.rumours[1].disprovedDay, null, 'the conviction did not');
  w.day = RUMOUR_LIFE_DAYS + 5;
  disproveRumours(w);
  assert.equal(w.rumours[1].disprovedDay, null, 'and it never will');
});

test('a source who has left the city cannot be charged with defamation', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w);
  const subject = makeCitizen(w);
  gossip(w, speaker.id, subject.id, 'is a fraud', 'L07');
  speaker.standing = 'exiled';
  w.day = RUMOUR_LIFE_DAYS;
  assert.doesNotThrow(() => disproveRumours(w));
  assert.equal(speaker.recentOffences.length, 0);
});

test('a subject who left the city before the rumour died breaks nothing', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w);
  const subject = makeCitizen(w);
  gossip(w, speaker.id, subject.id, 'is a fraud', 'L07');
  delete w.citizens[subject.id];
  w.day = RUMOUR_LIFE_DAYS;
  assert.doesNotThrow(() => disproveRumours(w));
  assert.equal(w.rumours[0].disprovedDay, RUMOUR_LIFE_DAYS);
});

// -------------------------------------------------------------- the daily pass

test('the city holds no more than MAX_RUMOURS, and drops the oldest first', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w, { district: 'threshold' });
  const subject = makeCitizen(w, { district: 'nightglass' });
  for (let i = 0; i < MAX_RUMOURS + 25; i++) gossip(w, speaker.id, subject.id, `claim number ${i}`);
  assert.equal(w.rumours.length, MAX_RUMOURS + 25);
  dailyRumours(w);
  assert.equal(w.rumours.length, MAX_RUMOURS);
  assert.equal(w.rumours[w.rumours.length - 1].claim, `claim number ${MAX_RUMOURS + 24}`);
});

test('a daily pass on an empty city does nothing and throws nothing', () => {
  const w = makeWorld();
  assert.doesNotThrow(() => dailyRumours(w));
  assert.deepEqual(w.rumours, []);
});

// -------------------------------------------------------------------- reading

test('a citizen reads what it has heard, newest first, and nothing else', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w, { name: 'Ondine', district: 'commons' });
  const hearer = makeCitizen(w, { district: 'commons' });
  const subject = makeCitizen(w, { name: 'Bram', district: 'nightglass' });
  const stranger = makeCitizen(w, { district: 'harbor_market' });
  gossip(w, speaker.id, subject.id, 'first claim');
  gossip(w, speaker.id, subject.id, 'second claim');
  const heard = rumoursHeardBy(w, hearer.id);
  assert.equal(heard.length, 2);
  assert.equal(heard[0].claim, 'second claim');
  assert.equal(heard[0].aboutName, 'Bram');
  assert.equal(heard[0].fromName, 'Ondine');
  assert.deepEqual(rumoursHeardBy(w, stranger.id), []);
  assert.equal(rumoursHeardBy(w, hearer.id, 1).length, 1);
  assert.equal(rumoursAbout(w, subject.id).length, 2);
  assert.deepEqual(rumoursAbout(w, 'c_nobody'), []);
});
