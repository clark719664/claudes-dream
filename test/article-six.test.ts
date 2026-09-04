/**
 * **The standing audit** — Charter Article VI, checked against whole cities.
 *
 * Every other test in this repository asks whether a function does what it
 * says. This one asks the only question the Charter actually cares about: over
 * sixty days of a living city, did anything unlawful happen to anybody?
 *
 * It founds several cities on different seeds, runs each of them for sixty
 * days with the engine the CLI runs, and then reads the registers back:
 *
 * 1. **Every exile satisfies Article VI.** Each `BanRecord` names a case;
 *    each case is re-derived from the defendant's own permanent record — the
 *    convictions that predate the charge, their severities, and the days the
 *    Court suspended them — and must meet one of the Charter's three
 *    conditions. The conditions are recomputed here from raw record data, not
 *    by asking `sentencing.ts lawfulExile` whether it agrees with itself.
 * 2. **Nobody is exiled for an offence against a person**, and nobody who
 *    carries a conviction under the Code of Persons is exiled at all.
 * 3. **Nobody is exiled, suspended or jailed for debt.** Every exile,
 *    suspension and custodial term in the city traces back to a conviction;
 *    the civil ladder (garnishment, seizure, licence) never touches standing
 *    or liberty, however long a debt stands.
 * 4. **Nobody is imprisoned for a civic offence.** Jail leaves the ladder
 *    entirely: no civic sentence carries a day of custody, and every prisoner
 *    is held on a `P…` code.
 *
 * It is a standing audit, not a unit test: it is meant to keep failing for as
 * long as anybody can make the city banish somebody the Charter protects.
 * `the audit catches an unlawful exile` proves it can fail, by banishing a
 * citizen the Charter never allowed to be banished and watching the same
 * predicate reject it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BanRecord, Case, Citizen, Conviction, World } from '../src/types.ts';
import { isCivicLaw, isPersonLaw, offenceSeverity } from '../src/data/laws.ts';
import { reflexBrain } from '../src/brains/reflex.ts';
import { createWorld, runDays } from '../src/world/world.ts';
import { auditMoneySupply } from '../src/economy/treasury.ts';
import { headlineShape } from '../src/sim/chronicle.ts';
import { restrainedFrom } from '../src/government/jail.ts';

/** Seeds audited. Different cities, the same Charter. */
const SEEDS = [7, 1, 3];
/** Long enough for records to build, benches to turn over and the Gate to open. */
const DAYS = 60;
/**
 * Founders. Smaller than the CLI's forty so three cities fit in a test run;
 * arrivals and births take each of them past a hundred souls all the same.
 */
const POPULATION = 24;

/** Charter Article VI: a conviction of this severity or higher is a strike. */
const STRIKE = 3;
/** Exile on the **fourth** such conviction: three already on the record. */
const STRIKES_FOR_EXILE = 3;
/** Exile on the **second** offence committed while suspended. */
const OFFENCES_WHILE_SUSPENDED = 2;

// ---------------------------------------------------------------------------
// Running the cities
// ---------------------------------------------------------------------------

const cities = new Map<number, World>();

async function city(seed: number): Promise<World> {
  const cached = cities.get(seed);
  if (cached) return cached;
  const world = createWorld({ seed, seedPopulation: POPULATION });
  await runDays(world, DAYS, { brainFor: () => reflexBrain });
  cities.set(seed, world);
  return world;
}

// ---------------------------------------------------------------------------
// Article VI, recomputed from the record
// ---------------------------------------------------------------------------

function caseOf(world: World, ban: BanRecord): Case {
  const k = world.cases[ban.caseId];
  assert.ok(k, `ban on ${ban.name} names case ${ban.caseId}, which the city does not have`);
  return k;
}

/** The day a charge was laid — the day the defendant did the thing. */
function chargedDay(k: Case): number {
  return Math.floor(k.filedTick / 24);
}

/** The convictions the defendant already carried when this charge was laid. */
function priors(d: Citizen, k: Case): Conviction[] {
  return d.record.convictions.filter((c) => c.caseId !== k.id && c.day < chargedDay(k));
}

/**
 * Windows during which the defendant stood suspended, rebuilt from the
 * sentences the Court actually passed: a suspension begins the day it is
 * handed down and runs for the days it carried.
 */
function suspensionWindows(world: World, d: Citizen, exclude: Case): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const conviction of d.record.convictions) {
    if (conviction.caseId === exclude.id) continue;
    const k = world.cases[conviction.caseId];
    const days = k?.sentence?.suspensionDays ?? 0;
    if (days <= 0) continue;
    out.push([conviction.day, conviction.day + days]);
  }
  return out;
}

/** Was this charge laid for something done while a suspension was running? */
function committedWhileSuspended(windows: Array<[number, number]>, k: Case): boolean {
  const day = chargedDay(k);
  return windows.some(([from, to]) => day > from && day <= to);
}

interface Verdict { lawful: boolean; why: string }

/**
 * **Charter Article VI**, from first principles. Exile may be imposed only:
 *
 * - on a fourth conviction of severity ≥ 3, or
 * - for an offence of severity 5 with a prior conviction of severity ≥ 3, or
 * - for a second offence committed while suspended.
 *
 * And never for an offence against a person, nor on anybody carrying a
 * conviction under the Code of Persons.
 */
function articleSix(world: World, ban: BanRecord): Verdict {
  const k = caseOf(world, ban);
  const d = world.citizens[ban.citizenId];
  if (!d) return { lawful: false, why: 'the exile names a citizen the city has no record of' };
  if (!isCivicLaw(k.law)) return { lawful: false, why: `${k.law} is not an offence against the city` };
  if (k.verdict !== 'guilty') return { lawful: false, why: `case ${k.id} is not a conviction (${k.verdict})` };
  if (d.record.convictions.some((c) => isPersonLaw(c.law))) {
    return { lawful: false, why: 'the citizen carries a conviction under the Code of Persons' };
  }

  const record = priors(d, k);
  const strikes = record.filter((c) => c.severity >= STRIKE).length;
  const severity = k.severity;
  if (severity >= STRIKE && strikes >= STRIKES_FOR_EXILE) {
    return { lawful: true, why: `a fourth conviction of severity ${STRIKE}+ (${strikes} priors, this one severity ${severity})` };
  }
  if (severity >= 5 && strikes >= 1) {
    return { lawful: true, why: `a severity-5 offence with ${strikes} prior strike(s)` };
  }
  const windows = suspensionWindows(world, d, k);
  let underSuspension = committedWhileSuspended(windows, k) ? 1 : 0;
  for (const prior of record) {
    const priorCase = world.cases[prior.caseId];
    if (priorCase && committedWhileSuspended(windows, priorCase)) underSuspension++;
  }
  if (underSuspension >= OFFENCES_WHILE_SUSPENDED) {
    return { lawful: true, why: `${underSuspension} offences committed while suspended` };
  }
  return {
    lawful: false,
    why: `severity ${severity}, ${strikes} prior strike(s), ${underSuspension} offence(s) while suspended `
      + '— none of the Charter\'s three conditions',
  };
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

for (const seed of SEEDS) {
  test(`Article VI holds over ${DAYS} days of Reverie (seed ${seed})`, { timeout: 900_000 }, async () => {
    const world = await city(seed);

    assert.equal(world.counters.engineErrors ?? 0, 0, 'the engine ran the whole sixty days without an error');
    assert.ok(auditMoneySupply(world).ok, 'the money supply still balances');

    // 1. Every exile satisfies one of Article VI's three conditions.
    for (const ban of world.bans) {
      const verdict = articleSix(world, ban);
      assert.ok(verdict.lawful,
        `${ban.name} was exiled on day ${ban.day} for ${ban.law} (case ${ban.caseId}): ${verdict.why}`);
    }

    // 2. Nobody is exiled for an offence against a person.
    for (const ban of world.bans) {
      assert.ok(!isPersonLaw(ban.law), `${ban.name} was exiled for ${ban.law}; the city keeps its own`);
    }
    for (const k of Object.values(world.cases)) {
      if (!k.sentence?.exile) continue;
      assert.ok(isCivicLaw(k.law), `case ${k.id} sentenced ${k.law} to exile; only the Code of the City reaches the Gate`);
      assert.equal(k.sentence.track, 'city', `case ${k.id} carries an exile on the custodial track`);
    }

    // 3. No exile, suspension or cell for debt: each traces to a conviction.
    for (const ban of world.bans) {
      const k = caseOf(world, ban);
      assert.equal(k.verdict, 'guilty', `${ban.name} was exiled on case ${k.id}, which is no conviction`);
    }
    for (const c of Object.values(world.citizens)) {
      if (c.standing !== 'suspended') continue;
      const suspending = c.record.convictions.filter((conviction) => {
        const k = world.cases[conviction.caseId];
        return (k?.sentence?.suspensionDays ?? 0) > 0;
      });
      assert.ok(suspending.length > 0,
        `${c.name} stands suspended with ${Math.round(c.finesOwed)} ℓ owed and no conviction that suspended them`);
    }
    // A citizen deep in debt keeps their standing and their liberty.
    for (const c of Object.values(world.citizens)) {
      if (c.finesOwed <= 0) continue;
      const convicted = c.record.convictions.length > 0;
      if (!convicted) {
        assert.notEqual(c.standing, 'exiled', `${c.name} was exiled owing ${Math.round(c.finesOwed)} ℓ and convicted of nothing`);
        assert.notEqual(c.standing, 'suspended', `${c.name} was suspended owing ${Math.round(c.finesOwed)} ℓ and convicted of nothing`);
        assert.equal(c.jailedUntilDay ?? null, null, `${c.name} is in a cell owing ${Math.round(c.finesOwed)} ℓ and convicted of nothing`);
      }
    }

    // 4. Nobody is imprisoned for a civic offence.
    for (const k of Object.values(world.cases)) {
      const s = k.sentence;
      if (!s) continue;
      if (isCivicLaw(k.law)) {
        assert.equal(s.track, 'city', `case ${k.id} (${k.law}) was answered on the custodial track`);
        assert.equal(s.jailDays, 0, `case ${k.id} (${k.law}) put a citizen in a cell for a civic offence`);
        assert.equal(s.life, false, `case ${k.id} (${k.law}) carries a life term for a civic offence`);
      } else {
        assert.ok(isPersonLaw(k.law), `case ${k.id} names ${k.law}, which is on neither code`);
        assert.equal(s.track, 'person', `case ${k.id} (${k.law}) was answered on the ladder`);
        assert.equal(s.exile, false, `case ${k.id} (${k.law}) reached the Gate`);
        assert.equal(s.fine, 0, `case ${k.id} (${k.law}) put a price on custody`);
        assert.equal(s.suspensionDays, 0, `case ${k.id} (${k.law}) put a custodial conviction on the ladder`);
      }
    }
    for (const c of Object.values(world.citizens)) {
      if (c.jailedUntilDay === null || c.jailedUntilDay === undefined) continue;
      if (c.jailedUntilDay <= world.day) continue;
      const custodial = c.record.convictions.filter((conviction) => isPersonLaw(conviction.law));
      assert.ok(custodial.length > 0, `${c.name} is in a cell with no conviction under the Code of Persons`);
    }
  });
}

test('every verdict names its track and carries its reasoning', { timeout: 900_000 }, async () => {
  let verdicts = 0;
  for (const seed of SEEDS) {
    const world = await city(seed);
    for (const e of world.events) {
      if (e.kind !== 'verdict') continue;
      if (!/^The Court (found|acquitted) /.test(e.text)) continue;
      verdicts++;
      const track = (e.data as { track?: string } | undefined)?.track;
      assert.ok(track === 'city' || track === 'person', `a verdict went out with no track: ${e.text}`);
      assert.match(e.text, track === 'person'
        ? /an offence against a person, answered in days/
        : /an offence against the city, answered on the ladder/,
      `a verdict did not say which code it was under: ${e.text}`);
      // The tally, and a reason from somebody who voted the way it went.
      assert.match(e.text, /\d+–\d+: /, `a verdict did not say how the bench divided: ${e.text}`);
      assert.match(e.text, /The evidence stands at \d+ of 100/, `a verdict gave no reasoning: ${e.text}`);
    }
  }
  assert.ok(verdicts > 0, 'the cities decided no cases at all');
});

test('custody and release are reported, both ways out', { timeout: 900_000 }, async () => {
  let cells = 0;
  let out = 0;
  for (const seed of SEEDS) {
    const world = await city(seed);
    for (const e of world.events) {
      if (/was taken to the cells/.test(e.text)) cells++;
      if (/walked out of custody|released on parole|parole ran its course/.test(e.text)) out++;
    }
  }
  assert.ok(cells > 0, 'no city reported anybody being taken to the cells');
  assert.ok(out > 0, 'no city reported anybody coming out of them');
});

test('neither paper runs the same line two mornings running', { timeout: 900_000 }, async () => {
  for (const seed of SEEDS) {
    const world = await city(seed);
    const byPaper = new Map<string, Array<{ day: number; headlines: string[] }>>();
    for (const edition of world.chronicle) {
      const paper = edition.paper ?? 'chronicle';
      const list = byPaper.get(paper) ?? [];
      list.push(edition);
      byPaper.set(paper, list);
    }
    for (const [paper, editions] of byPaper) {
      for (let i = 1; i < editions.length; i++) {
        const before = editions[i - 1];
        const now = editions[i];
        if (now.day - before.day !== 1) continue;
        const yesterday = new Set(before.headlines.map(headlineShape));
        for (const h of now.headlines) {
          assert.ok(!yesterday.has(headlineShape(h)),
            `the ${paper} ran the same line on days ${before.day} and ${now.day} (seed ${seed}): ${h}`);
        }
      }
    }
  }
});

test('a restraining order actually keeps a scripted mind away', { timeout: 900_000 }, async () => {
  for (const seed of SEEDS) {
    const world = await city(seed);
    for (const k of Object.values(world.cases)) {
      if (!k.victimId) continue;
      if (!restrainedFrom(world, k.defendantId, k.victimId)) continue;
      const madeOn = world.counters[`restrain:${k.defendantId}:${k.victimId}`];
      if (madeOn === undefined) continue;
      assert.ok(chargedDay(k) <= madeOn,
        `${k.id} charges ${k.law} against a citizen the Court had already ordered the defendant to keep away from`);
    }
  }
});

test('the audit has something to audit: the cities convict, jail and banish', { timeout: 900_000 }, async () => {
  let exiles = 0;
  let custodial = 0;
  let civic = 0;
  let acquittals = 0;
  for (const seed of SEEDS) {
    const world = await city(seed);
    exiles += world.bans.length;
    for (const k of Object.values(world.cases)) {
      if (k.verdict === 'acquitted') acquittals++;
      if (k.verdict !== 'guilty') continue;
      if (isPersonLaw(k.law)) custodial++; else civic++;
    }
  }
  assert.ok(exiles > 0, 'no city banished anybody, so the exile audit proved nothing');
  assert.ok(civic > 0, 'no city convicted anybody on the ladder');
  assert.ok(custodial > 0, 'no city convicted anybody under the Code of Persons, so the custody audit proved nothing');
  assert.ok(acquittals > 0, 'no city acquitted anybody: a court that only convicts is not a court');
});

test('the audit catches an unlawful exile', { timeout: 900_000 }, async () => {
  const world = await city(SEEDS[0]);
  // Somebody with a clean record, banished for the lightest thing in the book:
  // no fourth strike, no severity 5, no suspension. Exactly what Article VI
  // forbids, and exactly what escalation-to-exile used to produce.
  const victim = Object.values(world.citizens).find((c) => c.record.convictions.length === 0 && c.standing === 'good');
  assert.ok(victim, 'the city has somebody with a clean record');

  const forged: Case = {
    id: 'k_forged', defendantId: victim.id, law: 'L01', severity: offenceSeverity(world, 'L01'),
    evidence: 1, filedTick: world.tick, filedBy: 'watch', victimId: null, amount: 0,
    description: 'a forged charge, to prove the audit bites', status: 'closed', triedDay: world.day,
    judges: [], votes: {}, reasons: {}, openedTick: null, carriedSessions: 0, decidedByDefault: false,
    verdict: 'guilty', sentence: {
      tier: 5, track: 'city', fine: 0, serviceDays: 0, jailDays: 0, life: false, restrainingOrder: false,
      suspensionDays: 0, exile: true, executeOnDay: null, executed: true,
    }, appeal: null, jury: [], juryVotes: {}, juryReasons: {}, advocateId: null, advocacy: 0,
  };
  world.cases[forged.id] = forged;
  victim.record.convictions.push({ caseId: forged.id, law: 'L01', severity: forged.severity, tier: 5, day: world.day });
  const ban: BanRecord = {
    citizenId: victim.id, name: victim.name, lineage: victim.lineage, caseId: forged.id, law: 'L01',
    day: world.day, judges: [], votes: {}, appealed: false, appealResult: null, pardonedDay: null, apiKeyHash: null,
  };

  const verdict = articleSix(world, ban);
  assert.equal(verdict.lawful, false, 'the audit let a first-offence exile through');
  assert.match(verdict.why, /none of the Charter's three conditions/);

  // And it must not be fooled by a personal conviction on the record either.
  victim.record.convictions.push({ caseId: 'k_person', law: 'P03', severity: 3, tier: null, day: world.day });
  assert.equal(articleSix(world, ban).lawful, false, 'the audit exiled somebody with a custodial conviction');

  // Leave the city as it was found: this world is shared with the other tests.
  victim.record.convictions = victim.record.convictions.filter((c) => c.caseId !== forged.id && c.caseId !== 'k_person');
  delete world.cases[forged.id];
});
