/**
 * The layer's three doors (src/politics/session.ts) and the offences the
 * charter added (src/politics/offences.ts).
 *
 * A day of politics has to be safe to run on an empty city, on a city with no
 * government, and on one that has been running for a cycle — and it must never
 * take a lumen out of the world or invent a charge the law books do not carry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { MEASURE_KINDS, openMeasures } from '../src/politics/measures.ts';
import { dailyPolitics, hooksFor, politicsHearings, politicsObservation, politicsSession, tickPolitics } from '../src/politics/session.ts';
import { charterOf } from '../src/politics/charter.ts';
import { proposeAmendment } from '../src/politics/amendments.ts';
import { CHARTER_OFFENCES, chargeCharterOffence, lawInForce, offenceCount } from '../src/politics/offences.ts';
import { isCivicLaw, trackOf } from '../src/data/laws.ts';
import { signConvention } from '../src/politics/convention.ts';
import { impeach } from '../src/politics/impeachment.ts';

function city(world: World, n: number): Citizen[] {
  const out: Citizen[] = [];
  for (let i = 0; i < n; i++) out.push(makeCitizen(world, { name: `Citizen${i}` }));
  for (let i = 0; i < 5 && i < out.length; i++) {
    world.government.council.push(out[i].id);
    out[i].office = 'councillor';
  }
  if (out.length > 0) {
    world.government.mayorId = out[0].id;
    out[0].office = 'mayor';
  }
  return out;
}

test('every kind of measure has a module that owns it', () => {
  for (const kind of MEASURE_KINDS) assert.ok(hooksFor(kind), `${kind} has nobody to enact it`);
});

test('a day of politics is safe on an empty city', () => {
  const w = makeWorld();
  const before = totalMoney(w);
  dailyPolitics(w);
  politicsHearings(w);
  politicsSession(w);
  tickPolitics(w);
  assert.equal(totalMoney(w), before);
  assert.equal(charterOf(w).form, 'republic');
});

test('a cycle of days runs clean, and nothing makes or loses a lumen', () => {
  const w = makeWorld();
  const people = city(w, 30);
  const before = totalMoney(w);
  assert.equal(proposeAmendment(w, people[0].id, { article: 'wards', value: 'districts' }).ok, true);
  signConvention(w, people[10].id);
  impeach(w, people[1].id, people[0].id, 'duty', 0.2);
  for (let day = 0; day < 28; day++) {
    w.day += 1;
    dailyPolitics(w);
    w.hour = 12;
    politicsHearings(w);
    w.hour = 14;
    politicsSession(w);
    for (let hour = 0; hour < 24; hour++) tickPolitics(w);
  }
  assert.equal(totalMoney(w), before, 'the politics of a cycle moved no money');
  assert.equal(openMeasures(w).length, 0, 'and left nothing undecided');
});

test('the observation carries the whole layer, for a citizen and for nobody', () => {
  const w = makeWorld();
  const people = city(w, 8);
  const seen = politicsObservation(w, people[0]);
  assert.equal(seen.charter.form, 'republic');
  assert.equal(seen.charter.youCount, true);
  assert.deepEqual(seen.measures, []);
  assert.equal(seen.convention, null);
  assert.equal(seen.games, null);
  assert.equal(seen.papers.length, 2);
  assert.equal(seen.records.transparency.foi, true);
  assert.equal(seen.wards.scheme, 'none');
  const nobody = politicsObservation(w, null);
  assert.equal(nobody.charter.youCount, false);
  assert.equal(nobody.accountability.barredUntil, null);
});

// ------------------------------------------------------------- the offences

test('the charter\'s six codes are Track I, and none of them reaches custody', () => {
  assert.deepEqual(Object.keys(CHARTER_OFFENCES), ['L35', 'L36', 'L37', 'L38', 'L39', 'L40']);
  for (const code of Object.keys(CHARTER_OFFENCES)) assert.match(code, /^L/, 'never a P code');
});

test('the six codes are in the law books, and a charge goes to the Watch under its own number', () => {
  // The wiring pass registered L35-L40 in `data/laws.ts` and `types.ts`, which
  // is what `chargeCharterOffence` has been waiting for: until it happened the
  // city could only publish the fact, and now the Watch answers for it on the
  // same road a theft takes.
  for (const code of Object.keys(CHARTER_OFFENCES)) {
    assert.equal(lawInForce(code as keyof typeof CHARTER_OFFENCES), true, `${code} is in the books`);
    assert.equal(trackOf(code), 'city', `${code} is answered by the ladder and never by a cell`);
    assert.equal(isCivicLaw(code), true, `${code} is a civic offence`);
  }
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Printer' });
  const result = chargeCharterOffence(w, c.id, 'L35', { what: 'printing unlicensed' });
  assert.equal(result.charged, true, 'the Watch holds the code, so the Watch answers for it');
  assert.equal(offenceCount(w, 'L35'), 1, 'and the fact is counted whether or not anybody saw it');
  assert.equal(c.recentOffences.filter((o) => o.law === 'L35').length, 1, 'it is on the citizen\'s own record');
  assert.equal(c.record.convictions.length, 0, 'a charge is not a conviction; the Court decides that');
});

test('charging somebody who does not exist changes nothing', () => {
  const w = makeWorld();
  const result = chargeCharterOffence(w, 'c_nobody', 'L37');
  assert.equal(result.charged, false);
  assert.equal(result.detected, false);
  assert.equal(offenceCount(w, 'L37'), 0);
});
