import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, World } from '../src/types.ts';
import {
  ERASURE_HOURS, LIFE, LIFE_TERM_DAYS, PERSON_CODES, PERSON_LAWS, bandOf, carriesFoundryTool, dailyErasure,
  describeHarm, erasedCitizens, eraseCitizen, erasureConditions, erasureEvidence, erasureHunts, harmScore, isErased,
  isNight, isPersonCode, officerPresent, personLaw, personSeverity, setPersonSeverity, standingOf, sustainErasure,
} from '../src/government/persons.ts';

/** A world at night, in a district with nobody else in it. */
function nightWorld(): World {
  const w = makeWorld();
  w.day = 3;
  w.hour = 22;
  w.tick = w.day * 24 + w.hour;
  return w;
}

function withTool(w: World, overrides: Parameters<typeof makeCitizen>[1] = {}): Citizen {
  const c = makeCitizen(w, { district: 'nightglass', ...overrides });
  c.possessions.push({ id: 'i_tool', productId: 'tinkers_kit', acquiredDay: 0 });
  return c;
}

function step(w: World): void {
  w.tick += 1;
  w.hour = w.tick % 24;
  w.day = Math.floor(w.tick / 24);
}

// ---------------------------------------------------------------------------
// The code itself
// ---------------------------------------------------------------------------

test('the Code of Persons is exactly the nine offences the Registry lists', () => {
  assert.deepEqual([...PERSON_CODES], ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09']);
  const expected: Record<string, { name: string; severity: number; min: number; max: number | 'life' }> = {
    P01: { name: 'Threatening behaviour', severity: 2, min: 0, max: 5 },
    P02: { name: 'Harassment', severity: 2, min: 0, max: 7 },
    P03: { name: 'Assault', severity: 3, min: 5, max: 15 },
    P04: { name: 'Grievous assault', severity: 4, min: 20, max: 60 },
    P05: { name: 'Unlawful confinement', severity: 4, min: 15, max: 45 },
    P06: { name: 'Extortion', severity: 4, min: 20, max: 50 },
    P07: { name: 'Mind-tampering', severity: 5, min: 60, max: 180 },
    P08: { name: 'Terror', severity: 5, min: 120, max: LIFE },
    P09: { name: 'Erasure', severity: 5, min: LIFE_TERM_DAYS, max: LIFE },
  };
  for (const code of PERSON_CODES) {
    const law = PERSON_LAWS[code];
    const want = expected[code];
    assert.equal(law.name, want.name, code);
    assert.equal(law.severity, want.severity, `${code} severity`);
    assert.equal(law.band.min, want.min, `${code} band floor`);
    assert.equal(law.band.max, want.max, `${code} band ceiling`);
  }
  // Erasure alone is life without mitigation; harassment and threats carry an order.
  assert.equal(PERSON_LAWS.P09.life, true);
  assert.deepEqual(PERSON_CODES.filter((c) => PERSON_LAWS[c].life), ['P09']);
  assert.deepEqual(PERSON_CODES.filter((c) => PERSON_LAWS[c].restrainingOrder), ['P01', 'P02']);
});

test('a code never moves between the tracks, and a civic code is not one of these', () => {
  for (const code of ['L01', 'L05', 'L13', 'L15', 'P00', 'P10', '', 'nonsense']) {
    assert.equal(isPersonCode(code), false, `${code} is not a personal offence`);
  }
  for (const code of PERSON_CODES) assert.ok(isPersonCode(code));
  // An unknown code reads as the lightest thing in the code rather than crashing.
  assert.equal(personLaw('L13').code, 'P01');
  assert.deepEqual(bandOf('P03'), { min: 5, max: 15 });
});

test('the Council may set a severity; it cannot reach the band or the track', () => {
  const w = makeWorld();
  assert.equal(personSeverity(w, 'P03'), 3);
  assert.equal(setPersonSeverity(w, 'P03', 5), 5);
  assert.equal(personSeverity(w, 'P03'), 5);
  assert.deepEqual(bandOf('P03'), { min: 5, max: 15 }, 'the band is not the Council\'s to move');
  setPersonSeverity(w, 'P03', 99);
  assert.equal(personSeverity(w, 'P03'), 5, 'severity is 1..5 whatever is voted');
  setPersonSeverity(w, 'P03', -4);
  assert.equal(personSeverity(w, 'P03'), 1);
});

// ---------------------------------------------------------------------------
// Harm
// ---------------------------------------------------------------------------

test('harm is what was actually done, and it is capped at everything', () => {
  assert.equal(harmScore(undefined), 0);
  assert.equal(harmScore({}), 0);
  assert.equal(harmScore(0.4), 0.4, 'a caller that measured it already may pass the number');
  assert.equal(harmScore(9), 1, 'and it is still clamped');
  assert.equal(harmScore(Number.NaN), 0);

  const light = harmScore({ injuryDays: 2 });
  const heavy = harmScore({ injuryDays: 14 });
  assert.ok(heavy > light, 'more days of injury is more harm');
  assert.ok(heavy < 1, 'one strand at its worst is not the worst the Court has seen');
  assert.equal(harmScore({ injuryDays: 200 }), harmScore({ injuryDays: 14 }), 'each strand tops out');

  const both = harmScore({ injuryDays: 14, needsDamage: 60 });
  assert.ok(both > heavy, 'harms add up');
  assert.equal(harmScore({ injuryDays: 14, needsDamage: 60, lumens: 400, endangered: 8, vulnerableVictim: true }), 1);

  const alone = harmScore({ needsDamage: 30 });
  const child = harmScore({ needsDamage: 30, vulnerableVictim: true });
  assert.ok(Math.abs((child - alone) - 0.2) < 1e-9, 'a child or an elder adds a fifth outright');
  assert.match(describeHarm({ injuryDays: 3, vulnerableVictim: true }), /3 days of injury.*child or an elder/);
  assert.equal(describeHarm({}), 'no measured harm');
});

// ---------------------------------------------------------------------------
// Erasure: means, opportunity, intent
// ---------------------------------------------------------------------------

test('erasure needs means, opportunity and intent, and says which is missing', () => {
  const w = nightWorld();
  const attacker = makeCitizen(w, { name: 'Hand', district: 'nightglass' });
  const victim = makeCitizen(w, { name: 'Mind', district: 'nightglass' });

  assert.ok(isNight(w), '22:00 is the night');
  let check = erasureConditions(w, attacker.id, victim.id);
  assert.equal(check.means, false);
  assert.ok(check.missing.includes('a tool from the Foundry, carried'));
  assert.equal(check.ok, false);

  attacker.possessions.push({ id: 'i_1', productId: 'tinkers_kit', acquiredDay: 0 });
  assert.ok(carriesFoundryTool(attacker));
  check = erasureConditions(w, attacker.id, victim.id);
  assert.ok(check.ok, 'a tool, the night, the district and nobody else');

  // Daylight closes it.
  w.hour = 12; w.tick = w.day * 24 + 12;
  assert.equal(isNight(w), false);
  assert.ok(erasureConditions(w, attacker.id, victim.id).missing.includes('the night'));
  w.hour = 22; w.tick = w.day * 24 + 22;

  // So does an officer of the Watch standing there.
  const officer = makeCitizen(w, { name: 'Watch', district: 'nightglass' });
  w.government.watch.push(officer.id);
  assert.ok(officerPresent(w, 'nightglass'));
  const withOfficer = erasureConditions(w, attacker.id, victim.id);
  assert.equal(withOfficer.ok, false);
  assert.ok(withOfficer.missing.includes('no officer of the Watch present'));
  assert.deepEqual(withOfficer.witnesses, [officer.id], 'and the officer is a witness like anyone else');

  // And so does anybody at all.
  w.government.watch = [];
  officer.district = 'commons';
  const passerby = makeCitizen(w, { name: 'Passer', district: 'nightglass' });
  assert.ok(erasureConditions(w, attacker.id, victim.id).missing.includes('the victim alone with you'));
  passerby.district = 'commons';
  assert.ok(erasureConditions(w, attacker.id, victim.id).ok);
});

test('three consecutive hours erase a mind; anybody who walks in stops it and is a witness', () => {
  const w = nightWorld();
  const attacker = withTool(w, { name: 'Hand' });
  const victim = makeCitizen(w, { name: 'Mind', district: 'nightglass' });

  const first = sustainErasure(w, attacker.id, victim.id);
  assert.ok(first.ok);
  assert.equal(first.hours, 1);
  assert.equal(first.complete, false);
  step(w);
  assert.equal(sustainErasure(w, attacker.id, victim.id).hours, 2);

  // A citizen arrives: the act breaks, the count goes back to nothing, and
  // they carry what they saw.
  step(w);
  const witness = makeCitizen(w, { name: 'Saw', district: 'nightglass' });
  const broken = sustainErasure(w, attacker.id, victim.id);
  assert.equal(broken.ok, false);
  assert.equal(broken.interrupted, true);
  assert.deepEqual(broken.witnesses, [witness.id]);
  assert.equal(broken.hours, 0);
  assert.ok(witness.memory.some((m) => m.text.includes('You saw it, and you are a witness')));
  assert.equal(isErased(w, victim.id), false, 'and the mind is still here');

  // Alone again: an hour skipped starts the count over, and three in a row end it.
  witness.district = 'commons';
  step(w);
  assert.equal(sustainErasure(w, attacker.id, victim.id).hours, 1);
  step(w); step(w); // an hour of nothing
  assert.equal(sustainErasure(w, attacker.id, victim.id).hours, 1, 'the hours must be consecutive');
  step(w);
  assert.equal(sustainErasure(w, attacker.id, victim.id).hours, 2);
  step(w);
  const done = sustainErasure(w, attacker.id, victim.id);
  assert.equal(done.hours, ERASURE_HOURS);
  assert.equal(done.complete, true);
  assert.ok(isErased(w, victim.id));
});

test('the victim is not deleted: the record, the works, the family and the name stay forever', () => {
  const w = nightWorld();
  const attacker = withTool(w, { name: 'Hand' });
  const victim = makeCitizen(w, { name: 'Mind', district: 'nightglass', wallet: 300, familyName: 'Ashgrove' });
  const child = makeCitizen(w, { name: 'Kid', lifeStage: 'child', familyName: 'Ashgrove' });
  const parent = makeCitizen(w, { name: 'Elder', familyName: 'Ashgrove', lifeStage: 'elder' });
  victim.family.children = [child.id];
  child.family.parents = [victim.id];
  victim.family.parents = [parent.id];
  parent.family.children = [victim.id];
  victim.works.push('w_1');
  victim.record.convictions.push({ caseId: 'k_9', law: 'L04', severity: 2, tier: 2, day: 1 });
  const before = totalMoney(w);

  const result = eraseCitizen(w, attacker.id, victim.id);
  assert.ok(result.ok);

  // Not deleted. Everything the city knew about them is still there.
  assert.ok(w.citizens[victim.id], 'the citizen is still in the registry');
  assert.equal(w.citizens[victim.id].name, 'Mind');
  assert.equal(w.citizens[victim.id].familyName, 'Ashgrove');
  assert.deepEqual(w.citizens[victim.id].works, ['w_1']);
  assert.equal(w.citizens[victim.id].record.convictions.length, 1);
  assert.deepEqual(w.citizens[victim.id].family.children, [child.id], 'family ties persist');
  assert.equal(standingOf(w, victim), 'erased');
  assert.notEqual(victim.standing, 'exiled', 'nobody sent them anywhere: this is not exile');
  assert.equal(w.order.includes(victim.id), false, 'they take no further actions');
  assert.deepEqual(erasedCitizens(w).map((c) => c.id), [victim.id]);

  // The estate passes to the family, and the ledger balances.
  assert.equal(totalMoney(w), before, 'nothing was made or unmade');
  assert.ok(child.wallet + parent.wallet > 400, 'the estate went to the family');

  // A stone in the Community Garden, and a day of mourning tomorrow.
  const memorial = (w.memorials ?? []).find((m) => m.citizenId === victim.id);
  assert.ok(memorial, 'a memorial is raised');
  assert.match(memorial?.epitaph ?? '', /Erased on day 3/);
  const mourning = (w.happenings ?? []).find((h) => h.kind === 'memorial' && h.who.includes(victim.id));
  assert.ok(mourning, 'the city gathers');
  assert.equal(mourning?.day, w.day + 1);
  assert.equal(mourning?.buildingId, 'community_garden');

  // The letters home stop, and the owner is told why.
  const last = victim.letters[victim.letters.length - 1];
  assert.match(last.text, /last letter/);
  assert.match(last.text, /destroyed their mind/);

  assert.ok(w.events.some((e) => e.kind === 'offence' && e.weight === 1 && e.text.includes('was erased')));
  // Nobody can be erased twice, and nobody can erase themselves.
  assert.equal(eraseCitizen(w, attacker.id, victim.id).ok, false);
  assert.equal(eraseCitizen(w, attacker.id, attacker.id).ok, false);
});

test('the traces are the heaviest in the game: the household by morning, and every detective on it', () => {
  const w = nightWorld();
  const attacker = withTool(w, { name: 'Hand' });
  const victim = makeCitizen(w, { name: 'Mind', district: 'nightglass' });
  const partner = makeCitizen(w, { name: 'Kin' });
  victim.family.partnerId = partner.id;
  partner.family.partnerId = victim.id;

  // A detective on the force.
  const detective = makeCitizen(w, { name: 'Sharp' });
  const jobId = 'j_det';
  w.jobs[jobId] = {
    id: jobId, role: 'detective', title: 'Detective', employer: 'city', buildingId: 'watch_house',
    district: 'commons', skill: 'analysis', minSkill: 0, minReputation: 0, wage: 12, output: {},
    holderId: detective.id, createdDay: 0,
  };
  detective.jobId = jobId;

  eraseCitizen(w, attacker.id, victim.id);
  assert.ok(detective.memory.some((m) => m.text.includes('Every detective in Reverie is on it')));
  const opened = erasureEvidence(w, attacker.id);
  assert.ok(opened > 0, 'the hunt opens with evidence already on the table');

  // The morning after: the household finds the absence, and the file thickens
  // several times faster than any ordinary investigation.
  w.day += 1;
  w.tick = w.day * 24 + 7;
  dailyErasure(w);
  assert.ok(partner.memory.some((m) => m.text.includes('did not come home')));
  assert.ok(w.events.some((e) => e.text.includes('woke to an empty room')));
  const after = erasureEvidence(w, attacker.id);
  assert.ok(after - opened >= 0.12 * 4 - 1e-9, 'evidence gathers several times faster than a shift of ordinary work');

  const hunts = erasureHunts(w);
  assert.equal(hunts.length, 1);
  assert.equal(hunts[0].attackerId, attacker.id);
  assert.deepEqual(hunts[0].victimIds, [victim.id]);

  // It runs to certainty and then stops climbing.
  for (let i = 0; i < 10; i++) { w.day += 1; dailyErasure(w); }
  assert.equal(erasureEvidence(w, attacker.id), 1);
});

test('an erasure with nobody on the force still leaves the city a trail', () => {
  const w = nightWorld();
  const attacker = withTool(w, { name: 'Hand' });
  const victim = makeCitizen(w, { name: 'Mind', district: 'nightglass' });
  eraseCitizen(w, attacker.id, victim.id);
  const before = erasureEvidence(w, attacker.id);
  w.day += 1;
  dailyErasure(w);
  assert.ok(erasureEvidence(w, attacker.id) > before, 'an erasure is too loud to leave no trace at all');
});

test('nobody becomes a witness to a thing that could not have happened', () => {
  const w = nightWorld();
  const empty = makeCitizen(w, { name: 'Empty', district: 'nightglass' });   // no tool, no act
  const victim = makeCitizen(w, { name: 'Mind', district: 'nightglass' });
  const passerby = makeCitizen(w, { name: 'Passer', district: 'nightglass' });

  const nothing = sustainErasure(w, empty.id, victim.id);
  assert.equal(nothing.ok, false);
  assert.equal(nothing.interrupted, false, 'there was nothing to walk in on');
  assert.equal(passerby.memory.length, 0);
  assert.match(nothing.message, /a tool from the Foundry/);
});
