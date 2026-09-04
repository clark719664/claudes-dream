import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen } from './helpers.ts';
import {
  ADVOCATE_MULTIPLIER, BREACH_EXTRA, LIFE_PAROLE_MIN_DAYS, PLEA_MULTIPLIER, PRIOR_CUSTODIAL_MULTIPLIER,
  RESTITUTION_MULTIPLIER, bandDays, breachTerm, custodialConvictions, custodialStrikes, custodyTerm,
  describeCustodyTerm, exileForbidden, mayBeExiled, paroleEligibleDay, payToShortenTerm, recordCustodialConviction,
} from '../src/government/custody.ts';
import { LIFE_CEILING_DAYS, LIFE_TERM_DAYS, PERSON_CODES, PERSON_LAWS } from '../src/government/persons.ts';

// ---------------------------------------------------------------------------
// Every band sentences within itself
// ---------------------------------------------------------------------------

test('every band sentences inside itself, at every harm the Court can measure', () => {
  for (const code of PERSON_CODES) {
    const law = PERSON_LAWS[code];
    for (const harm of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) {
      const term = custodyTerm(code, harm);
      if (law.life) {
        assert.equal(term.life, true, `${code} is life at harm ${harm}`);
        continue;
      }
      assert.ok(term.days >= law.band.min, `${code} at harm ${harm}: ${term.days} is below the floor ${law.band.min}`);
      if (term.life) {
        assert.equal(law.band.max, 'life', `${code} reached life from a band that does not run there`);
        continue;
      }
      const ceiling = law.band.max === 'life' ? LIFE_CEILING_DAYS : law.band.max;
      assert.ok(term.days <= ceiling, `${code} at harm ${harm}: ${term.days} is over the ceiling ${ceiling}`);
    }
  }
});

test('harm scales the term from the floor of the band to its top', () => {
  const none = custodyTerm('P04', 0);
  const half = custodyTerm('P04', 0.5);
  const all = custodyTerm('P04', 1);
  assert.equal(none.days, 20, 'no measured harm is the floor of the band');
  assert.equal(half.days, 40, '20 + (60 − 20) × 0.5');
  assert.equal(all.days, 60, 'the top of the band');
  assert.ok(none.days < half.days && half.days < all.days);

  // Harm is what was done, not who did it.
  const measured = custodyTerm('P03', { injuryDays: 14, needsDamage: 60 });
  assert.ok(measured.days > custodyTerm('P03', { injuryDays: 2 }).days);
  assert.equal(bandDays({ min: 5, max: 15 }, 0.5), 10);
  assert.equal(bandDays({ min: 5, max: 15 }, 4), 15, 'harm is clamped');
});

// ---------------------------------------------------------------------------
// The multipliers
// ---------------------------------------------------------------------------

test('the multipliers apply in the right order, and priors are uncapped', () => {
  const base = custodyTerm('P07', 0.5).days;   // 60 + (180 − 60) × 0.5 = 120
  assert.equal(base, 120);

  assert.equal(custodyTerm('P07', 0.5, { priorCustodial: 1 }).days, Math.round(120 * PRIOR_CUSTODIAL_MULTIPLIER));
  assert.equal(custodyTerm('P07', 0.5, { priorCustodial: 3 }).days, Math.round(120 * PRIOR_CUSTODIAL_MULTIPLIER ** 3));
  // Uncapped: a long record keeps making it longer, forever.
  const many = custodyTerm('P07', 0.5, { priorCustodial: 8 });
  assert.ok(many.days > custodyTerm('P07', 0.5, { priorCustodial: 7 }).days, 'this ladder does not forgive');

  assert.equal(custodyTerm('P07', 0.5, { advocate: true }).days, Math.round(120 * ADVOCATE_MULTIPLIER));
  assert.equal(custodyTerm('P07', 0.5, { plea: true }).days, Math.round(120 * PLEA_MULTIPLIER));
  assert.equal(custodyTerm('P07', 0.5, { restitution: true }).days, Math.round(120 * RESTITUTION_MULTIPLIER));

  // Everything at once: priors first, then every mitigation, then the round.
  const all = custodyTerm('P07', 0.5, { priorCustodial: 2, advocate: true, plea: true, restitution: true });
  const expected = 120 * PRIOR_CUSTODIAL_MULTIPLIER ** 2 * ADVOCATE_MULTIPLIER * PLEA_MULTIPLIER * RESTITUTION_MULTIPLIER;
  assert.equal(all.days, Math.round(expected));
  assert.ok(Math.abs(all.multiplier - expected / 120) < 1e-9);
  // The arithmetic is public: every step is written down.
  assert.equal(all.steps.length, 5);
  assert.match(all.steps[0], /band 60–180 days at harm 50 of 100/);
});

test('no pile of mitigation goes below the floor of the band', () => {
  const term = custodyTerm('P04', 0.1, { advocate: true, plea: true, restitution: true });
  assert.equal(term.days, PERSON_LAWS.P04.band.min, 'the floor of the band holds');
  assert.ok(term.steps.some((s) => s.includes('held at the floor of the band')));

  // And a band whose floor is zero can reach a day of nothing at all: P01 is
  // often a restraining order rather than a cell.
  const threat = custodyTerm('P01', 0, { plea: true });
  assert.equal(threat.days, 0);
  assert.equal(threat.restrainingOrder, true);
  assert.equal(describeCustodyTerm(threat), '0 days in custody and a restraining order');
});

test('life is never reduced — not by an advocate, a plea, restitution or a record', () => {
  const soft = custodyTerm('P09', 0, { advocate: true, plea: true, restitution: true });
  assert.equal(soft.life, true);
  assert.equal(soft.days, LIFE_TERM_DAYS);
  assert.equal(soft.multiplier, 1, 'no multiplier is applied to a life sentence at all');
  assert.equal(describeCustodyTerm(soft), 'custody for life');
  assert.deepEqual(soft.steps, ['P09 is life, without mitigation']);

  const heavy = custodyTerm('P09', 1, { priorCustodial: 5 });
  assert.equal(heavy.days, soft.days, 'and nothing makes it longer either: life is life');

  // Terror reaches life at full harm, and is a number of days below it.
  const terror = custodyTerm('P08', 1);
  assert.equal(terror.life, true);
  const lesser = custodyTerm('P08', 0.5, { advocate: true, plea: true });
  assert.equal(lesser.life, false);
  assert.ok(lesser.days >= PERSON_LAWS.P08.band.min);
  assert.ok(lesser.days < LIFE_CEILING_DAYS);
});

// ---------------------------------------------------------------------------
// What custody is not
// ---------------------------------------------------------------------------

test('a violent citizen is never exiled', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Rough' });
  assert.equal(exileForbidden(w, c.id), null, 'nothing on the record, nothing forbidden');
  assert.equal(mayBeExiled(w, c.id), true);

  recordCustodialConviction(w, c.id);
  assert.equal(custodialConvictions(w, c.id), 1);
  const reason = exileForbidden(w, c.id);
  assert.ok(reason, 'one conviction against a person closes the Gate for good');
  assert.match(reason ?? '', /keeps its own/);
  assert.equal(mayBeExiled(w, c.id), false);

  // However long the record gets, the answer is the same one.
  for (let i = 0; i < 6; i++) recordCustodialConviction(w, c.id);
  assert.equal(custodialConvictions(w, c.id), 7);
  assert.equal(mayBeExiled(w, c.id), false);
  assert.equal(custodialStrikes(w, c.id), 7, 'a custodial conviction is a strike on the civic ladder, and only that');

  // A conviction recorded against a personal code counts even without the register.
  const other = makeCitizen(w, { name: 'Second' });
  other.record.convictions.push({ caseId: 'k_1', law: 'P03' as 'L04', severity: 3, tier: 2, day: 1 });
  assert.equal(custodialConvictions(w, other.id), 1);
  assert.equal(mayBeExiled(w, other.id), false);
});

test('no amount of money shortens a term', () => {
  const w = makeWorld();
  const rich = makeCitizen(w, { name: 'Purse', wallet: 100_000 });
  const answer = payToShortenTerm(w, rich.id, 5_000);
  assert.equal(answer.ok, false);
  assert.match(answer.message, /better advocate, not a shorter term/);
  assert.equal(payToShortenTerm(w, rich.id, 0).ok, false);
});

// ---------------------------------------------------------------------------
// Parole arithmetic
// ---------------------------------------------------------------------------

test('parole comes at half the term, and never before 56 days of a life term', () => {
  assert.equal(paroleEligibleDay(10, 20, false), 20, 'half of twenty days');
  assert.equal(paroleEligibleDay(10, 15, false), 18, 'half of an odd term rounds up');
  assert.equal(paroleEligibleDay(10, 1, false), 11);
  assert.equal(paroleEligibleDay(0, LIFE_TERM_DAYS, true), LIFE_PAROLE_MIN_DAYS);
  assert.equal(paroleEligibleDay(30, LIFE_TERM_DAYS, true), 30 + LIFE_PAROLE_MIN_DAYS);
});

test('a broken condition costs the remainder and half again', () => {
  assert.equal(breachTerm(10), 15);
  assert.equal(breachTerm(0), 1, 'never nothing: a condition that costs nothing is not a condition');
  assert.equal(breachTerm(7), Math.round(7 * (1 + BREACH_EXTRA)));
});
