/**
 * The civic ladder: five rungs, an escalation that stops at the fourth, and
 * exile only through the Charter's own three doors (`docs/JUSTICE.md` §1,
 * Charter Article VI).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Case, CaseId, Citizen, LawCode, Severity, World } from '../src/types.ts';
import { LAWS, LAW_CODES, RETIRED_LAW_CODES, isCivicLaw, isPersonLaw, isRetiredLaw } from '../src/data/laws.ts';
import { nextId } from '../src/util/ids.ts';
import {
  EXILE_STRIKES, MAX_ESCALATION, MAX_LADDER_TIER, MIN_FINE, REDUCED_EXILE_SUSPENSION_DAYS, SUSPENSION_DAYS_PER_SEVERITY,
  TIER_EXILE, TIER_FINE, TIER_SERVICE, TIER_SUSPENSION, TIER_WARNING, baseTier, committedWhileSuspended, computeSentence,
  describeSentence, escalation, executeSentence, lawfulExile, offencesWhileSuspended, restitutionPaidKey, sentenceForTier,
  strikeStruckKey, strikesAgainst, whileSuspendedKey,
} from '../src/government/sentencing.ts';

function world(day = 5): World {
  const w = makeWorld();
  w.day = day; w.hour = 10; w.tick = day * 24 + 10;
  return w;
}

/** A charge sitting before the Court, built without needing the Watch. */
function charge(w: World, d: Citizen, law: LawCode, opts: { victimId?: string; amount?: number; filedDay?: number } = {}): Case {
  const day = opts.filedDay ?? w.day;
  const k: Case = {
    id: nextId(w, 'k'), defendantId: d.id, law, severity: LAWS[law].severity, evidence: 1,
    filedTick: day * 24 + 9, filedBy: 'watch', victimId: opts.victimId ?? null, amount: opts.amount ?? 0,
    description: 'for the test', status: 'pending', triedDay: null, judges: [], votes: {}, reasons: {},
    openedTick: null, carriedSessions: 0, decidedByDefault: false, verdict: null, sentence: null, appeal: null,
  };
  w.cases[k.id] = k;
  return k;
}

/** A conviction already on the record. */
function prior(d: Citizen, caseId: CaseId, law: LawCode, severity: Severity, day = 0, tier: 1 | 2 | 3 | 4 | 5 = 2): void {
  d.record.convictions.push({ caseId, law, severity, tier, day });
  d.record.strikes = d.record.convictions.filter((k) => k.severity >= 3).length;
}

// ---------------------------------------------------------------------------
// The code itself
// ---------------------------------------------------------------------------

test('harassment and extortion have left the Code of the City, and their numbers are never reused', () => {
  assert.deepEqual([...RETIRED_LAW_CODES], ['L05', 'L15']);
  for (const code of RETIRED_LAW_CODES) {
    assert.ok(!LAW_CODES.includes(code), `${code} is not a law the Council may legislate`);
    assert.equal(isCivicLaw(code), false, `${code} is not a civic offence`);
    assert.equal(isRetiredLaw(code), true);
    assert.ok(LAWS[code], `${code} still reads, so an old record still reads`);
  }
  assert.equal(LAW_CODES.length, 15, 'seventeen numbers, fifteen live civic offences');
  assert.ok(LAW_CODES.every((c) => isCivicLaw(c)));
  // The Code of Persons is the other track, and the ladder knows it is not its own.
  assert.equal(isPersonLaw('P02'), true);
  assert.equal(isCivicLaw('P02'), false);
  assert.equal(isCivicLaw('P09'), false);
});

// ---------------------------------------------------------------------------
// The rungs
// ---------------------------------------------------------------------------

test('the five rungs are warning, fine, service, suspension, exile — and nothing is a cell', () => {
  const w = world();
  const d = makeCitizen(w, { wallet: 1000 });
  const k = charge(w, d, 'L06'); // vandalism, severity 3

  const warning = sentenceForTier(w, k, TIER_WARNING);
  assert.equal(warning.fine, 0);
  assert.equal(describeSentence(warning), 'a formal warning');

  const fine = sentenceForTier(w, k, TIER_FINE);
  assert.equal(fine.fine, 300, 'wallet × 10% × severity');
  assert.equal(fine.serviceDays, 0);

  const service = sentenceForTier(w, k, TIER_SERVICE);
  assert.equal(service.fine, 300);
  assert.equal(service.serviceDays, 3, 'one day per point of severity');

  const suspension = sentenceForTier(w, k, TIER_SUSPENSION);
  assert.equal(suspension.suspensionDays, 3 * SUSPENSION_DAYS_PER_SEVERITY);
  assert.equal(suspension.exile, false);

  const exile = sentenceForTier(w, k, TIER_EXILE);
  assert.equal(exile.exile, true);
  assert.equal(describeSentence(exile), 'exile');

  for (const s of [warning, fine, service, suspension, exile]) {
    assert.equal(s.jailDays, 0, 'custody is the other track; the ladder never fills a cell');
  }
  const poor = makeCitizen(w, { wallet: 0 });
  assert.equal(sentenceForTier(w, charge(w, poor, 'L01'), TIER_FINE).fine, MIN_FINE, 'every fine has a floor');
});

test('a reduced exile is a fixed fortnight-and-a-day of suspension', () => {
  const w = world();
  const d = makeCitizen(w, { wallet: 100 });
  const k = charge(w, d, 'L13'); // severity 5: 3 × 5 = 15 either way, so use a lesser one to tell them apart
  const lesser = charge(w, d, 'L06');
  assert.equal(sentenceForTier(w, lesser, TIER_SUSPENSION, { fromExile: true }).suspensionDays, REDUCED_EXILE_SUSPENSION_DAYS);
  assert.equal(sentenceForTier(w, lesser, TIER_SUSPENSION).suspensionDays, 9, 'an ordinary suspension is 3 × severity');
  assert.equal(sentenceForTier(w, k, TIER_SUSPENSION).suspensionDays, 15);
});

test('no civic offence starts at exile: the base rung is the severity, capped at four', () => {
  assert.equal(baseTier(1), TIER_WARNING);
  assert.equal(baseTier(2), TIER_FINE);
  assert.equal(baseTier(3), TIER_SERVICE);
  assert.equal(baseTier(4), TIER_SUSPENSION);
  assert.equal(baseTier(5), MAX_LADDER_TIER, 'sabotage and election fraud start at suspension');
  assert.equal(baseTier(0), TIER_WARNING);
  assert.equal(baseTier(99), MAX_LADDER_TIER);
});

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

test('escalation counts prior civic convictions of severity 2 or more, and stops at two', () => {
  const w = world();
  const d = makeCitizen(w, { wallet: 100 });
  const k = charge(w, d, 'L04'); // petty theft, severity 2
  assert.equal(escalation(w, k), 0);

  prior(d, 'k_p1', 'L01', 1, 0, 1);
  assert.equal(escalation(w, k), 0, 'a severity-1 conviction is not a rung');
  prior(d, 'k_p2', 'L03', 2, 1);
  assert.equal(escalation(w, k), 1);
  prior(d, 'k_p3', 'L04', 2, 2);
  assert.equal(escalation(w, k), 2);
  prior(d, 'k_p4', 'L07', 3, 3, 3);
  assert.equal(escalation(w, k), MAX_ESCALATION, 'two rungs is the whole of what a record adds');
  assert.equal(computeSentence(w, k).tier, TIER_SUSPENSION);
});

test('a retired number is not a civic prior, and a conviction struck by restitution stops counting', () => {
  const w = world();
  const d = makeCitizen(w, { wallet: 100 });
  const k = charge(w, d, 'L04');
  prior(d, 'k_p1', 'L05', 2, 1); // harassment: an offence against a person, now P02
  assert.equal(escalation(w, k), 0, 'the ladder counts the city\'s own offences');
  prior(d, 'k_p2', 'L03', 2, 1);
  assert.equal(escalation(w, k), 1);
  w.counters[strikeStruckKey('k_p2')] = w.day;
  assert.equal(escalation(w, k), 0, 'restitution struck it off the escalation count');
  assert.equal(d.record.convictions.length, 2, 'and the record still holds both: the record is permanent');
});

test('a struck strike is one conviction further from the Gate, and still on the record', () => {
  const w = world();
  const d = makeCitizen(w, { wallet: 200 });
  prior(d, 'k_p1', 'L06', 3, 1, 3);
  prior(d, 'k_p2', 'L07', 3, 2, 3);
  prior(d, 'k_p3', 'L17', 3, 3, 4);
  const k = charge(w, d, 'L06');
  assert.equal(strikesAgainst(w, k), 3);
  assert.equal(lawfulExile(w, k), true, 'the fourth conviction of severity 3');

  w.counters[strikeStruckKey('k_p2')] = w.day; // restitution paid, a fortnight clean
  assert.equal(strikesAgainst(w, k), 2);
  assert.equal(lawfulExile(w, k), false, 'the ladder is meant to be climbed down as well as up');
  assert.equal(computeSentence(w, k).tier, TIER_SUSPENSION);
  assert.equal(d.record.convictions.length, 3, 'the record is permanent');
  assert.equal(d.record.strikes, 3, 'and the city can still read every strike on it');
});

test('a severity-4 offence with one severity-2 prior is a suspension, not exile', () => {
  const w = world();
  const d = makeCitizen(w, { wallet: 500 });
  prior(d, 'k_old', 'L03', 2, 1);
  const k = charge(w, d, 'L08'); // grand theft, severity 4
  const s = computeSentence(w, k);
  assert.equal(s.exile, false, 'escalation alone never reaches the Gate');
  assert.equal(s.tier, TIER_SUSPENSION);
  assert.equal(s.suspensionDays, 12);
  assert.equal(lawfulExile(w, k), false);
});

// ---------------------------------------------------------------------------
// The Charter's three doors to exile
// ---------------------------------------------------------------------------

test('lawfulExile door one: the fourth conviction of severity 3 or higher', () => {
  const w = world();
  const d = makeCitizen(w, { wallet: 200 });
  const k = charge(w, d, 'L06'); // vandalism, severity 3
  prior(d, 'k_p1', 'L06', 3, 1, 3);
  prior(d, 'k_p2', 'L07', 3, 2, 4);
  assert.equal(strikesAgainst(w, k), 2);
  assert.equal(lawfulExile(w, k), false, 'the third is not the fourth');
  assert.equal(computeSentence(w, k).tier, TIER_SUSPENSION);

  prior(d, 'k_p3', 'L17', 3, 3, 4);
  assert.equal(strikesAgainst(w, k), EXILE_STRIKES - 1);
  assert.equal(lawfulExile(w, k), true, 'this conviction is the fourth of severity 3 or more');
  assert.equal(computeSentence(w, k).exile, true);

  // The fourth conviction has to be a serious one itself.
  const petty = charge(w, d, 'L04'); // severity 2
  assert.equal(lawfulExile(w, petty), false, 'three strikes and a petty theft is not a fourth strike');
  assert.equal(computeSentence(w, petty).tier, TIER_SUSPENSION);
});

test('lawfulExile door two: a severity-5 civic offence together with a prior strike', () => {
  const w = world();
  const clean = makeCitizen(w, { wallet: 300 });
  const first = charge(w, clean, 'L14'); // election fraud, severity 5
  assert.equal(lawfulExile(w, first), false, 'a first-time saboteur is suspended, not exiled');
  assert.equal(computeSentence(w, first).tier, TIER_SUSPENSION);

  const marked = makeCitizen(w, { wallet: 300 });
  prior(marked, 'k_p9', 'L07', 3, 1, 3);
  const second = charge(w, marked, 'L14');
  assert.equal(lawfulExile(w, second), true);
  assert.equal(computeSentence(w, second).exile, true);

  // A severity-5 offence with only petty priors still is not enough.
  const petty = makeCitizen(w, { wallet: 300 });
  prior(petty, 'k_p10', 'L04', 2, 1);
  prior(petty, 'k_p11', 'L03', 2, 2);
  assert.equal(lawfulExile(w, charge(w, petty, 'L13')), false, 'the prior has to be a severity-3 one');
});

test('lawfulExile door three: the second offence committed while suspended', () => {
  const w = world(10);
  const d = makeCitizen(w, { wallet: 200 });
  d.standing = 'suspended';
  d.suspendedUntilDay = 20;
  prior(d, 'k_psusp', 'L08', 4, 8, TIER_SUSPENSION); // the conviction that suspended them, on day 8

  const before = charge(w, d, 'L04', { filedDay: 7 });
  assert.equal(committedWhileSuspended(w, before), false, 'an offence from before the suspension does not count');
  assert.equal(lawfulExile(w, before), false);

  const firstWhileSuspended = charge(w, d, 'L04', { filedDay: 9 });
  assert.equal(committedWhileSuspended(w, firstWhileSuspended), true);
  assert.equal(offencesWhileSuspended(w, firstWhileSuspended), 1);
  assert.equal(lawfulExile(w, firstWhileSuspended), false, 'the Charter exiles on the second, not the first');
  assert.equal(computeSentence(w, firstWhileSuspended).exile, false);
  assert.equal(computeSentence(w, firstWhileSuspended).tier, TIER_SERVICE, 'severity 2 and one civic prior');

  // That first one is convicted, and the marker it leaves is what counts the second.
  firstWhileSuspended.sentence = computeSentence(w, firstWhileSuspended);
  firstWhileSuspended.verdict = 'guilty';
  executeSentence(w, firstWhileSuspended);
  assert.equal(w.counters[whileSuspendedKey(firstWhileSuspended.id)], 1);

  w.day = 11; w.tick = 11 * 24 + 10;
  const secondWhileSuspended = charge(w, d, 'L04', { filedDay: 11 });
  assert.equal(offencesWhileSuspended(w, secondWhileSuspended), 2);
  assert.equal(lawfulExile(w, secondWhileSuspended), true);
  assert.equal(computeSentence(w, secondWhileSuspended).exile, true);
});

test('a citizen in good standing is never exiled for an offence they committed at liberty', () => {
  const w = world();
  const d = makeCitizen(w, { wallet: 200 });
  prior(d, 'k_p1', 'L08', 4, 1, TIER_SUSPENSION);
  w.counters[whileSuspendedKey('k_p1')] = 1;
  const k = charge(w, d, 'L04');
  assert.equal(committedWhileSuspended(w, k), false, 'their standing is good again');
  assert.equal(offencesWhileSuspended(w, k), 1, 'only the old marked one');
  assert.equal(lawfulExile(w, k), false);
});

test('exile is a civic penalty only: an offence against a person is never answered by the Gate', () => {
  const w = world();
  const d = makeCitizen(w, { wallet: 200 });
  prior(d, 'k_p1', 'L06', 3, 1, 3);
  prior(d, 'k_p2', 'L07', 3, 2, 3);
  prior(d, 'k_p3', 'L17', 3, 3, 4);
  const civic = charge(w, d, 'L06');
  assert.equal(lawfulExile(w, civic), true, 'four civic strikes reach the Gate');
  const person = charge(w, d, 'L05'); // harassment: the Code of Persons' P02 now
  assert.equal(lawfulExile(w, person), false, 'the city keeps its own and does not export them');

  // And the bar lasts: a citizen who carries a conviction against a person is
  // never exiled, whatever they do to the city afterwards (Charter Article VI).
  d.record.convictions.push({ caseId: 'k_pperson', law: 'P03' as LawCode, severity: 3, tier: 3, day: 4 });
  assert.equal(lawfulExile(w, civic), false, 'four civic strikes and a custodial conviction: the Gate stays shut');
  assert.equal(computeSentence(w, civic).tier, TIER_SUSPENSION);
});

// ---------------------------------------------------------------------------
// Carrying it out
// ---------------------------------------------------------------------------

test('executeSentence records, fines, pays the victim in full and notes the restitution', () => {
  const w = world();
  const thief = makeCitizen(w, { wallet: 400, reputation: 50 });
  const victim = makeCitizen(w, { wallet: 100 });
  const before = totalMoney(w);
  const k = charge(w, thief, 'L04', { victimId: victim.id, amount: 30 });
  k.sentence = computeSentence(w, k);
  k.verdict = 'guilty';
  assert.equal(k.sentence.tier, TIER_FINE);
  assert.equal(k.sentence.fine, 80);
  executeSentence(w, k);

  assert.equal(thief.wallet, 320);
  assert.equal(victim.wallet, 130, 'the victim is made whole out of the fine');
  assert.equal(thief.reputation, 40, '5 per point of severity');
  assert.equal(thief.record.convictions.length, 1);
  assert.equal(thief.record.convictions[0].tier, TIER_FINE);
  assert.equal(thief.finesOwed, 0);
  assert.equal(w.counters[restitutionPaidKey(k.id)], w.day, 'a victim made whole starts the strike-off clock');
  assert.equal(totalMoney(w), before, 'fines and restitution only move money');

  executeSentence(w, k);
  assert.equal(thief.wallet, 320, 'idempotent');
  assert.equal(thief.record.convictions.length, 1);
});

test('a fine bigger than the wallet leaves a debt, and a debt is never a cell or a gate', () => {
  const w = world();
  const d = makeCitizen(w, { wallet: 5 });
  const k = charge(w, d, 'L06'); // severity 3: fine floors at 20
  k.sentence = computeSentence(w, k);
  k.verdict = 'guilty';
  executeSentence(w, k);
  assert.equal(d.wallet, 0);
  assert.equal(d.finesOwed, 15);
  assert.equal(d.finesOwedSinceDay, w.day);
  assert.equal(d.standing, 'good');
  assert.equal(k.sentence.jailDays, 0);
  assert.equal(k.sentence.exile, false);
  assert.equal(d.communityServiceDaysLeft, 3);
});
