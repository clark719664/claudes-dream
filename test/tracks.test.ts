/**
 * The two tracks, wired end to end (`docs/JUSTICE.md`).
 *
 * `test/sentencing.test.ts` proves the ladder's arithmetic and
 * `test/custody.test.ts` the bands; this file proves the *routing*: that a
 * charge under the Code of the City reaches the ladder and never a cell, that
 * a charge under the Code of Persons reaches custody and never the Gate, that
 * the three crossings in §4 are the only three, and that everything a term
 * leaves a citizen is dispatched, offered and refused in the right places.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { ACTION_TYPES, JAILED_ACTIONS, SUSPENDED_ACTIONS } from '../src/types.ts';
import type { Case, Citizen, OffenceCode, World } from '../src/types.ts';
import { LAW_CODES, OFFENCE_CODES, PERSON_CODES, isPersonLaw, trackOf } from '../src/data/laws.ts';
import { createCityJobs } from '../src/economy/jobs.ts';
import {
  CUSTODY_ACTIONS, computeSentence, custodyOf, fileCharge, holdCourt, isJailed, openCourtSession, pleadedGuilty,
  tallyVerdicts, trackOfCase,
} from '../src/government/court.ts';
import { commitOffence, crossTracks, officersInDistrict } from '../src/government/watch.ts';
import { defyCustody } from '../src/government/jail.ts';
import { custodialConvictions, exileForbidden } from '../src/government/custody.ts';
import { erasureConditions } from '../src/government/persons.ts';
import {
  committedWhileSuspended, executeSentence, lawfulExile, offencesWhileSuspended, strikesAgainst,
} from '../src/government/sentencing.ts';
import { openReport, openReports, watchSession } from '../src/government/reports.ts';
import { availableActions, executeAction, validateAction } from '../src/actions/execute.ts';
import { buildObservation } from '../src/brains/observe.ts';
import { computeStats } from '../src/world/stats.ts';
import { createBrainRegistry, createWorld, runDays } from '../src/world/world.ts';
import { reflexBrain, reflexDecide } from '../src/brains/reflex.ts';
import { appointJudges } from '../src/government/council.ts';
import { jailRoster, restrainedFrom } from '../src/government/jail.ts';

// ---------------------------------------------------------------------------
// A court that will convict on the evidence, and nothing else
// ---------------------------------------------------------------------------

/** Three judges nobody is related to, with the reputation the Charter asks of them. */
function courtWorld(): World {
  const w = makeWorld();
  createCityJobs(w);
  w.hour = w.config.courtHour;
  w.tick = w.day * 24 + w.hour;
  for (let i = 0; i < 3; i++) {
    const j = makeCitizen(w, { name: `Judge${i}`, familyName: `Bench${i}`, reputation: 85, office: 'judge' });
    w.government.judges.push(j.id);
  }
  return w;
}

/** Try one charge from filing to sentence in a single sitting. */
function tryOne(w: World, spec: Parameters<typeof fileCharge>[1]): Case {
  const k = fileCharge(w, spec);
  holdCourt(w);
  return w.cases[k.id];
}

// ---------------------------------------------------------------------------
// §1 and §2 — every charge reaches its own track
// ---------------------------------------------------------------------------

test('every code in the books routes to exactly one track, and no code sits on both', () => {
  for (const code of LAW_CODES) {
    assert.equal(trackOf(code), 'city', `${code} is a civic offence`);
    assert.equal(trackOfCase({ law: code }), 'city');
  }
  for (const code of PERSON_CODES) {
    assert.equal(trackOf(code), 'person', `${code} is an offence against a person`);
    assert.equal(trackOfCase({ law: code }), 'person');
  }
  assert.equal(OFFENCE_CODES.length, LAW_CODES.length + PERSON_CODES.length);
  assert.equal(new Set(OFFENCE_CODES).size, OFFENCE_CODES.length, 'no number is used twice');
  // The retired numbers are on neither track's live list and are never reused.
  for (const retired of ['L05', 'L15']) assert.ok(!OFFENCE_CODES.includes(retired as OffenceCode));
});

test('a civic conviction is answered on the ladder and never by a cell', () => {
  const w = courtWorld();
  for (const law of LAW_CODES) {
    const d = makeCitizen(w, { name: `Civic${law}`, familyName: `Civic${law}`, wallet: 300 });
    const k = { id: 'k_x', defendantId: d.id, law, severity: 3, evidence: 0.9, filedTick: w.tick } as unknown as Case;
    const s = computeSentence(w, { ...k, amount: 0, victimId: null } as Case);
    assert.equal(s.track, 'city', `${law} left the ladder`);
    assert.equal(s.jailDays, 0, `${law} put somebody in a cell`);
    assert.equal(s.life, false);
    assert.ok(s.tier !== null, `${law} has no rung`);
  }
});

test('a charge under the Code of Persons is answered in days, with no fine, no tier and no Gate', () => {
  const w = courtWorld();
  const victim = makeCitizen(w, { name: 'Pell', familyName: 'Pell' });
  const d = makeCitizen(w, { name: 'Corvin', familyName: 'Corvin', wallet: 4000 });
  const before = totalMoney(w);
  const k = tryOne(w, {
    defendantId: d.id, law: 'P03', evidence: 0.95, filedBy: 'watch', victimId: victim.id,
    description: 'Assault: struck a citizen in the Commons',
  });
  assert.equal(k.verdict, 'guilty', 'the evidence carries it');
  const s = k.sentence;
  assert.ok(s);
  assert.equal(s.track, 'person');
  assert.equal(s.tier, null, 'custody is not a rung');
  assert.equal(s.fine, 0, 'no fine stands in for a term');
  assert.equal(s.serviceDays, 0);
  assert.equal(s.suspensionDays, 0);
  assert.equal(s.exile, false, 'the city keeps its own');
  assert.ok(s.jailDays >= 5, 'never below the floor of the band');
  assert.equal(isJailed(d), true);
  assert.equal(custodyOf(w, d.id)?.code, 'P03');
  assert.equal(d.wallet, 4000, 'a term takes the day, not the purse');
  assert.equal(totalMoney(w), before, 'and no lumens are made or unmade by a verdict');
});

test('a citizen convicted under the Code of Persons can never be exiled, whatever they do next', () => {
  const w = courtWorld();
  const d = makeCitizen(w, { name: 'Mordant', familyName: 'Mordant', wallet: 400 });
  // Four civic strikes, which is Article VI's first door.
  for (let i = 0; i < 3; i++) {
    d.record.convictions.push({ caseId: `k_p${i}`, law: 'L06', severity: 3, tier: 3, day: w.day - 5 });
  }
  const civic = fileCharge(w, { defendantId: d.id, law: 'L06', evidence: 0.9, filedBy: 'watch', description: 'x' });
  assert.equal(strikesAgainst(w, civic), 3);
  assert.equal(lawfulExile(w, civic), true, 'the fourth strike opens the Gate');

  // One custodial conviction, and the door is shut for good.
  d.record.convictions.push({ caseId: 'k_person', law: 'P03', severity: 3, tier: null, day: w.day - 1 });
  const after = fileCharge(w, { defendantId: d.id, law: 'L06', evidence: 0.9, filedBy: 'watch', description: 'x' });
  assert.equal(lawfulExile(w, after), false, 'the Charter forbids exiling anybody convicted against a person');
  assert.equal(computeSentence(w, after).exile, false);
  assert.match(String(exileForbidden(w, d.id)), /keeps its own/);
});

// ---------------------------------------------------------------------------
// §4 — the three crossings, and no others
// ---------------------------------------------------------------------------

test('crossing one: a custodial conviction counts as a strike on the civic ladder', () => {
  const w = courtWorld();
  const d = makeCitizen(w, { name: 'Halloway', familyName: 'Halloway', wallet: 500 });
  const clean = fileCharge(w, { defendantId: d.id, law: 'L07', evidence: 0.9, filedBy: 'watch', description: 'x' });
  assert.equal(strikesAgainst(w, clean), 0);

  d.record.convictions.push({ caseId: 'k_a', law: 'P04', severity: 4, tier: null, day: w.day - 3 });
  const weighted = fileCharge(w, { defendantId: d.id, law: 'L07', evidence: 0.9, filedBy: 'watch', description: 'x' });
  assert.equal(strikesAgainst(w, weighted), 1, 'somebody jailed for assault carries it when they later defraud');
  // And it stops there: a custodial conviction is not a *civic* prior, so it
  // adds no rung to the ladder's escalation.
  assert.equal(computeSentence(w, weighted).tier, computeSentence(w, clean).tier);
});

test('crossing two: violence during a civic offence is tried on both tracks, as two cases', () => {
  const w = courtWorld();
  const officer = makeCitizen(w, { name: 'Sable', familyName: 'Sable', district: 'harbor_market', office: 'watch' });
  w.government.watch.push(officer.id);
  const thief = makeCitizen(w, { name: 'Quill', familyName: 'Quill', district: 'harbor_market' });
  assert.ok(officersInDistrict(w, thief).some((o) => o.id === officer.id));

  const both = crossTracks(w, thief.id, 'L08', 'P03', { victimId: officer.id, visibilityMod: 1 });
  const laws = openReports(w).filter((r) => r.suspectId === thief.id).map((r) => r.law).sort();
  assert.deepEqual(laws, ['L08', 'P03'], 'the theft on the ladder and the assault in custody');
  assert.ok(both.civic !== null || both.person !== null);
  assert.equal(w.reports[String(both.civic)].law, 'L08');
  assert.equal(w.reports[String(both.person)].law, 'P03');
  assert.equal(trackOf('L08'), 'city');
  assert.equal(trackOf('P03'), 'person');
  // Neither is folded into the other, and neither is traded for the other.
  assert.throws(() => crossTracks(w, thief.id, 'P03', 'L08'), /one offence of each code/);
});

test('crossing three: defying custody adds days, and never converts to exile', () => {
  const w = courtWorld();
  const victim = makeCitizen(w, { name: 'Wren', familyName: 'Wren' });
  const d = makeCitizen(w, { name: 'Ferris', familyName: 'Ferris' });
  tryOne(w, {
    defendantId: d.id, law: 'P05', evidence: 0.95, filedBy: 'watch', victimId: victim.id,
    description: 'Unlawful confinement',
  });
  assert.equal(isJailed(d), true);
  const before = d.jailedUntilDay ?? 0;

  // An offence from inside answers with more of the same, on the same track.
  commitOffence(w, d.id, 'L06', { buildingId: 'watch_house' });
  defyCustody(w, d.id, 'vandalism from inside');
  assert.ok((d.jailedUntilDay ?? 0) > before, 'the term grew');
  assert.equal(d.standing !== 'exiled', true, 'and nothing about it reaches the Gate');
  assert.equal(w.bans.length, 0);
});

test('nothing else crosses: no cell on the ladder, no rung in custody, no debt anywhere near either', () => {
  const w = courtWorld();
  const poor = makeCitizen(w, { name: 'Ilse', familyName: 'Ilse', wallet: 0 });
  poor.finesOwed = 400;
  poor.finesOwedSinceDay = w.day - 60;
  assert.equal(poor.standing, 'good', 'poverty is not a standing');
  assert.equal(isJailed(poor), false, 'and it is never a cell');
  const k = fileCharge(w, { defendantId: poor.id, law: 'L03', evidence: 0.9, filedBy: 'watch', description: 'x' });
  const s = computeSentence(w, k);
  assert.equal(s.jailDays, 0);
  assert.equal(s.exile, false);
});

// ---------------------------------------------------------------------------
// The new actions: validated, dispatched, offered, refused
// ---------------------------------------------------------------------------

test('every action of both tracks validates, and each names the citizen or case it acts on', () => {
  const shapes: [string, Record<string, unknown>][] = [
    ['threaten', { target: 'c_2' }], ['assault', { target: 'c_2' }], ['confine', { target: 'c_2' }],
    ['erase', { target: 'c_2' }], ['visit', { citizen: 'c_2' }],
    ['plead_guilty', { caseId: 'k_3' }], ['plead_guilty', {}], ['request_parole', {}], ['work_custody', {}],
  ];
  for (const [type, params] of shapes) {
    const r = validateAction({ type, ...params });
    assert.equal(r.ok, true, `${type} did not validate: ${r.ok ? '' : r.error}`);
  }
  for (const type of ['threaten', 'assault', 'confine', 'erase']) {
    assert.equal(validateAction({ type }).ok, false, `${type} without a target`);
    assert.equal(validateAction({ type, target: 'nobody' }).ok, false, `${type} with a bad id`);
  }
  assert.equal(validateAction({ type: 'visit' }).ok, false);
  assert.equal(validateAction({ type: 'plead_guilty', caseId: 'r_1' }).ok, false, 'a report id is not a case id');
  // A report may name either code: the Watch takes both kinds of account.
  assert.equal(validateAction({ type: 'report', citizen: 'c_2', law: 'P03' }).ok, true);
  assert.equal(validateAction({ type: 'report', citizen: 'c_2', law: 'L04' }).ok, true);
  assert.equal(validateAction({ type: 'report', citizen: 'c_2', law: 'L05' }).ok, false, 'a retired number is not a charge');
});

test('the engine dispatches every action of the Code of Persons, and each files its own code', () => {
  const cases: [string, OffenceCode][] = [['threaten', 'P01'], ['assault', 'P03'], ['confine', 'P05'], ['extort', 'P06']];
  for (const [type, code] of cases) {
    const w = makeWorld();
    const actor = makeCitizen(w, { name: 'Rasp', familyName: 'Rasp', district: 'commons' });
    const target = makeCitizen(w, { name: 'Iver', familyName: 'Iver', district: 'commons', wallet: 300 });
    const r = executeAction(w, actor.id, { type, target: target.id, amount: 40 } as never);
    assert.notEqual(r.message, `Unknown action ${type}.`, `${type} is not dispatched`);
    const filed = actor.recentOffences.map((o) => o.law);
    // Assault is P03 or P04 by whether it left an injury; the rest are exact.
    if (type === 'assault') assert.ok(filed.includes('P03') || filed.includes('P04'), 'an assault is P03 or P04');
    else assert.ok(filed.includes(code), `${type} filed ${filed.join(',')} rather than ${code}`);
    for (const law of filed) assert.equal(isPersonLaw(law), true, `${type} filed a civic code`);
  }
});

test('sabotage is civic with an empty district and terror with anybody in it', () => {
  const alone = makeWorld();
  const lone = makeCitizen(alone, { name: 'Ash', familyName: 'Ash', district: 'foundry_row' });
  executeAction(alone, lone.id, { type: 'sabotage', building: 'compute_forge' });
  assert.deepEqual(lone.recentOffences.map((o) => o.law), ['L13'], 'nobody endangered: the ladder answers it');

  const crowded = makeWorld();
  const saboteur = makeCitizen(crowded, { name: 'Ash', familyName: 'Ash', district: 'foundry_row' });
  makeCitizen(crowded, { name: 'Bystander', familyName: 'Near', district: 'foundry_row' });
  executeAction(crowded, saboteur.id, { type: 'sabotage', building: 'compute_forge' });
  assert.deepEqual(saboteur.recentOffences.map((o) => o.law), ['P08'], 'a person in danger makes it terror');
  assert.equal(trackOf('P08'), 'person');
});

test('a prisoner is offered exactly what the Charter leaves, and refused everything else', () => {
  const w = makeWorld();
  createCityJobs(w);
  const d = makeCitizen(w, { name: 'Nane', familyName: 'Nane', district: 'commons', wallet: 300 });
  makeCitizen(w, { name: 'Other', familyName: 'Other', district: 'commons' });
  d.jailedUntilDay = w.day + 10;
  w.counters[`custody:start:${d.id}`] = w.day;
  w.counters[`custody:term:${d.id}`] = 10;

  const offered = availableActions(w, d);
  for (const a of offered) assert.ok((CUSTODY_ACTIONS as readonly string[]).includes(a), `${a} is not on the Charter's list`);
  assert.deepEqual([...JAILED_ACTIONS].sort(), [...CUSTODY_ACTIONS].sort(), 'one list, written twice, and they agree');
  assert.ok(offered.includes('note'));
  assert.ok(offered.includes('message'));
  assert.ok(offered.includes('work_custody'));
  assert.ok(!offered.includes('request_parole'), 'not before half the term');

  // Everything the term takes is refused with a reason, and costs the hour.
  for (const type of ACTION_TYPES) {
    if ((CUSTODY_ACTIONS as readonly string[]).includes(type)) continue;
    const r = executeAction(structuredClone(w) as World, d.id, { type } as never);
    assert.equal(r.ok, false, `${type} was carried out from a cell`);
  }
});

test('a prisoner asks for parole at half the term, works a shift a day, and is visited but does not visit', () => {
  const w = courtWorld();
  const victim = makeCitizen(w, { name: 'Pell', familyName: 'Pell', district: 'commons' });
  const d = makeCitizen(w, { name: 'Corvin', familyName: 'Corvin', district: 'commons' });
  const friend = makeCitizen(w, { name: 'Rook', familyName: 'Rook', district: 'commons' });
  friend.bonds[d.id] = 70;
  d.bonds[friend.id] = 70;
  tryOne(w, {
    defendantId: d.id, law: 'P03', evidence: 0.95, filedBy: 'watch', victimId: victim.id, amount: 30,
    description: 'Assault',
  });
  assert.equal(isJailed(d), true);
  const term = custodyOf(w, d.id)?.term ?? 0;

  // The shift: once a day, and the victim is paid first.
  const first = executeAction(w, d.id, { type: 'work_custody' });
  assert.equal(first.ok, true, first.message);
  assert.equal(executeAction(w, d.id, { type: 'work_custody' }).ok, false, 'one shift a day');

  // The visit: a friend standing here may come, once a day; the prisoner may not go.
  assert.ok(availableActions(w, friend).includes('visit'));
  assert.equal(executeAction(w, friend.id, { type: 'visit', citizen: d.id }).ok, true);
  assert.equal(executeAction(w, friend.id, { type: 'visit', citizen: d.id }).ok, false, 'once a day');
  assert.equal(executeAction(w, d.id, { type: 'visit', citizen: friend.id }).ok, false, 'a prisoner is visited, not a visitor');

  // Parole: refused before half the term, heard after it.
  assert.equal(executeAction(w, d.id, { type: 'request_parole' }).ok, false);
  w.day += Math.ceil(term / 2);
  w.tick = w.day * 24 + 9;
  assert.ok(availableActions(w, d).includes('request_parole'));
  const asked = executeAction(w, d.id, { type: 'request_parole' });
  assert.equal(asked.ok, true, asked.message);
  assert.equal(buildObservation(w, d.id).self.custody?.paroleRequested, true);
});

test('a plea is worth a fifth off a term, and only before the bench sits', () => {
  const w = courtWorld();
  // Real harm, so the band has somewhere above its floor to come down from:
  // no multiplier ever takes a term below `band.min`.
  const victim = makeCitizen(w, { name: 'Pell', familyName: 'Pell', mood: 10 });
  victim.health = { glitched: true, sinceDay: w.day - 14 };
  const early = makeCitizen(w, { name: 'Early', familyName: 'Early' });
  const late = makeCitizen(w, { name: 'Late', familyName: 'Late' });
  const spec = { law: 'P04' as const, evidence: 0.95, filedBy: 'watch' as const, victimId: victim.id, description: 'x' };

  const ka = fileCharge(w, { ...spec, defendantId: early.id });
  assert.equal(executeAction(w, early.id, { type: 'plead_guilty', caseId: ka.id }).ok, true);
  assert.equal(pleadedGuilty(w, ka.id), true);
  const kb = fileCharge(w, { ...spec, defendantId: late.id });
  openCourtSession(w);
  assert.equal(executeAction(w, late.id, { type: 'plead_guilty', caseId: kb.id }).ok, false, 'the bench is already sitting');
  tallyVerdicts(w);

  const pleaded = w.cases[ka.id].sentence;
  const argued = w.cases[kb.id].sentence;
  assert.ok(pleaded && argued);
  assert.equal(w.cases[ka.id].verdict, 'guilty');
  assert.equal(w.cases[kb.id].verdict, 'guilty');
  assert.ok(argued.jailDays > 20, 'the harm carried the term above the floor of the band');
  assert.equal(pleaded.jailDays, Math.round(argued.jailDays * 0.8), 'the plea in time is worth a fifth');
});

test('a suspended citizen keeps due process and its people, and a child is never offered a cell', () => {
  for (const type of ['plead_guilty', 'appeal', 'visit']) {
    assert.ok(SUSPENDED_ACTIONS.includes(type as never), `a suspension takes ${type}`);
  }
  for (const type of ['work', 'vote', 'buy_property', 'nominate']) {
    assert.ok(!SUSPENDED_ACTIONS.includes(type as never), `a suspension leaves ${type}`);
  }
  const w = makeWorld();
  const child = makeCitizen(w, { name: 'Wren', familyName: 'Wren', lifeStage: 'child' });
  for (const type of ['plead_guilty', 'request_parole', 'work_custody']) {
    assert.equal(executeAction(w, child.id, { type } as never).ok, false, `a child was offered ${type}`);
    assert.ok(!availableActions(w, child).includes(type as never));
  }
});

// ---------------------------------------------------------------------------
// The court a city could plausibly have
// ---------------------------------------------------------------------------

test('weak evidence fails, strong evidence carries, and the bench is not a formality', () => {
  const w = courtWorld();
  let convicted = 0;
  let acquitted = 0;
  for (let i = 0; i < 40; i++) {
    const d = makeCitizen(w, { name: `Thin${i}`, familyName: `Thin${i}`, reputation: 60, wallet: 200 });
    const k = tryOne(w, {
      defendantId: d.id, law: 'L04', evidence: 0.2, filedBy: 'watch', description: 'a thin case',
    });
    if (k.verdict === 'guilty') convicted++; else acquitted++;
  }
  assert.equal(convicted, 0, 'a case at 20 of 100 does not convict anybody');
  assert.equal(acquitted, 40);

  let strong = 0;
  for (let i = 0; i < 40; i++) {
    const d = makeCitizen(w, { name: `Caught${i}`, familyName: `Caught${i}`, reputation: 60, wallet: 200 });
    const k = tryOne(w, {
      defendantId: d.id, law: 'L04', evidence: 0.85, filedBy: 'watch', description: 'caught in the act',
    });
    if (k.verdict === 'guilty') strong++;
  }
  assert.ok(strong >= 38, `a case at 85 of 100 convicts: ${strong} of 40`);
});

test('nobody with a mind of their own is voted for: a bench of agents decides nothing by itself', () => {
  const w = courtWorld();
  for (const id of w.government.judges) w.citizens[id].brain = 'llm';
  const d = makeCitizen(w, { name: 'Unheard', familyName: 'Unheard', wallet: 200 });
  const k = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 0.95, filedBy: 'watch', description: 'x' });
  openCourtSession(w);
  assert.deepEqual(w.cases[k.id].votes, {}, 'the engine cast no vote for a judge that thinks for itself');
  tallyVerdicts(w);
  assert.equal(w.cases[k.id].verdict, null, 'and it decided nothing without them');
  assert.equal(w.cases[k.id].status, 'pending', 'the case is held over for the next sitting');
});

// ---------------------------------------------------------------------------
// What the city counts
// ---------------------------------------------------------------------------

test('the day\'s statistics count the two tracks apart, and the cells and the parole with them', () => {
  const w = courtWorld();
  const victim = makeCitizen(w, { name: 'Pell', familyName: 'Pell' });
  const violent = makeCitizen(w, { name: 'Corvin', familyName: 'Corvin' });
  const cheat = makeCitizen(w, { name: 'Dace', familyName: 'Dace', wallet: 400 });
  const innocent = makeCitizen(w, { name: 'Blameless', familyName: 'Blameless', reputation: 90 });
  fileCharge(w, {
    defendantId: violent.id, law: 'P03', evidence: 0.95, filedBy: 'watch', victimId: victim.id, description: 'assault',
  });
  fileCharge(w, { defendantId: cheat.id, law: 'L03', evidence: 0.9, filedBy: 'watch', description: 'tax evasion' });
  fileCharge(w, { defendantId: innocent.id, law: 'L04', evidence: 0.05, filedBy: 'watch', description: 'a rumour' });
  holdCourt(w);

  const s = computeStats(w, w.day);
  assert.equal(s.custodySentences, 1, 'one answered in days');
  assert.equal(s.ladderSentences, 1, 'one answered on the ladder');
  assert.equal(s.acquittals, 1, 'and one acquitted');
  assert.equal(s.custody, 1);
  assert.equal(s.jailed, s.custody, 'the jail count and the custody count are one roll');
  assert.equal(s.lifeTerms, 0);
  assert.equal(s.paroled, 0);
  assert.equal(custodialConvictions(w, violent.id), 1);
});

// ---------------------------------------------------------------------------
// The whole road, in a city that is actually running
// ---------------------------------------------------------------------------

test('the city runs a term from the verdict to the open door, without anybody touching it', async () => {
  const world = createWorld({ seed: 11, seedPopulation: 14, arrivalRate: 0, llmCitizens: 0 });
  const brains = createBrainRegistry({ reflex: reflexBrain });
  await runDays(world, 2, brains);
  appointJudges(world);

  const victim = world.order.map((id) => world.citizens[id]).find((c) => c.lifeStage === 'adult');
  const d = world.order.map((id) => world.citizens[id])
    .find((c) => c.lifeStage === 'adult' && c.id !== victim?.id && !world.government.judges.includes(c.id));
  assert.ok(victim && d);

  world.hour = world.config.courtHour;
  world.tick = world.day * 24 + world.hour;
  const k = fileCharge(world, {
    defendantId: d.id, law: 'P03', evidence: 0.95, filedBy: 'watch', victimId: victim.id,
    description: 'Assault in the Commons',
  });
  holdCourt(world);
  assert.equal(world.cases[k.id].verdict, 'guilty');
  const term = world.cases[k.id].sentence?.jailDays ?? 0;
  const roster = jailRoster(world);
  assert.deepEqual(roster.map((r) => r.id), [d.id], 'the jail register holds exactly the one the Court sent there');
  assert.equal(roster[0].code, 'P03');
  assert.ok(term >= 5, 'never below the floor of the band');

  // The term is the whole of the answer: the city runs on, and the day it is
  // served the door opens, with nobody deciding anything further.
  const before = totalMoney(world);
  await runDays(world, Math.max(1, term) + 2, brains);
  assert.equal(isJailed(d), false, 'the term ended and the city took them back');
  assert.equal(d.standing !== 'exiled', true, 'custody is not exile');
  assert.equal(world.bans.some((b) => b.citizenId === d.id), false);
  assert.ok(Number.isFinite(totalMoney(world)) && totalMoney(world) !== before - 1e9);
  // And the record keeps it: a custodial conviction, with no rung on the ladder.
  const conviction = d.record.convictions.find((x) => x.caseId === k.id);
  assert.ok(conviction);
  assert.equal(conviction.tier, null);
  assert.equal(custodialConvictions(world, d.id), 1);
});

test('a band whose floor is zero ends in a restraining order, not in a cell', () => {
  const w = courtWorld();
  const victim = makeCitizen(w, { name: 'Kept', familyName: 'Kept', mood: 100 });
  const d = makeCitizen(w, { name: 'Near', familyName: 'Near' });
  const k = tryOne(w, {
    defendantId: d.id, law: 'P01', evidence: 0.95, filedBy: 'watch', victimId: victim.id,
    description: 'Threatening behaviour, with nothing measured behind it',
  });
  assert.equal(k.verdict, 'guilty');
  assert.equal(k.sentence?.jailDays, 0, 'no measured harm is the floor of the band, and P01\'s floor is nothing');
  assert.equal(k.sentence?.restrainingOrder, true);
  assert.equal(isJailed(d), false, 'often a restraining order instead of a cell');
  assert.equal(restrainedFrom(w, d.id, victim.id), true, 'and the order is made either way');
  // It is still a conviction, and still a custodial one.
  assert.equal(d.record.convictions.find((x) => x.caseId === k.id)?.tier, null);
  assert.equal(custodialConvictions(w, d.id), 1);
});

// ---------------------------------------------------------------------------
// The scripted minds, under two tracks
// ---------------------------------------------------------------------------

test('a scripted officer files a charge under either code, and drops what it cannot prove', () => {
  const w = makeWorld();
  w.tick = 40; w.day = 1; w.hour = 16;
  const officer = makeCitizen(w, { name: 'Sable', familyName: 'Sable', office: 'watch', district: 'commons' });
  w.government.watch.push(officer.id);
  const victim = makeCitizen(w, { name: 'Pell', familyName: 'Pell', district: 'commons' });
  const suspect = makeCitizen(w, { name: 'Corvin', familyName: 'Corvin', district: 'commons' });

  openReport(w, {
    officerId: officer.id, suspectId: suspect.id, law: 'P03', evidence: 0.7, victimId: victim.id,
    description: 'Assault in the Commons',
  });
  openReport(w, {
    officerId: officer.id, suspectId: suspect.id, law: 'L04', evidence: 0.05,
    description: 'A purse, and nothing behind it',
  });
  w.tick += 1;
  watchSession(w);

  const charges = Object.values(w.cases).filter((k) => k.defendantId === suspect.id);
  assert.deepEqual(charges.map((k) => k.law), ['P03'], 'the assault is charged; the thin case is not');
  assert.equal(trackOfCase(charges[0]), 'person');
  const dropped = Object.values(w.reports).filter((r) => r.status === 'dropped');
  assert.equal(dropped.length, 1);
  assert.match(String(dropped[0].droppedReason), /too thin to charge/);
});

test('a scripted prisoner uses what a term leaves, and nothing a term takes', () => {
  const w = courtWorld();
  createCityJobs(w);
  const victim = makeCitizen(w, { name: 'Pell', familyName: 'Pell', district: 'commons', mood: 20 });
  const d = makeCitizen(w, { name: 'Corvin', familyName: 'Corvin', district: 'commons', wallet: 400 });
  makeCitizen(w, { name: 'Friend', familyName: 'Friend', district: 'commons' });
  tryOne(w, {
    defendantId: d.id, law: 'P04', evidence: 0.95, filedBy: 'watch', victimId: victim.id, amount: 60,
    description: 'Grievous assault',
  });
  assert.equal(isJailed(d), true);

  // Every hour of the term, the scripted mind chooses from the Charter's list.
  const chosen = new Set<string>();
  for (let hour = 0; hour < 24; hour++) {
    w.hour = hour;
    w.tick = w.day * 24 + hour;
    const obs = buildObservation(w, d.id);
    const action = reflexDecide(w, d, obs);
    assert.ok((CUSTODY_ACTIONS as readonly string[]).includes(action.type), `${action.type} is not a thing a term leaves`);
    chosen.add(action.type);
    executeAction(w, d.id, action);
  }
  assert.ok(chosen.has('work_custody'), 'the shift that pays the victim back is taken');

  // And once half the term is served it asks the Court to let it out.
  const term = custodyOf(w, d.id)?.term ?? 0;
  w.day += Math.ceil(term / 2);
  w.tick = w.day * 24 + 9;
  w.hour = 9;
  const asked = reflexDecide(w, d, buildObservation(w, d.id));
  assert.equal(asked.type, 'request_parole');
});

test('erasure is offered only where it could actually be done, and never hidden when it could', () => {
  const w = makeWorld();
  w.day = 3; w.hour = 22; w.tick = w.day * 24 + w.hour;
  const attacker = makeCitizen(w, { name: 'Vane', familyName: 'Vane', district: 'undercroft' });
  const victim = makeCitizen(w, { name: 'Lune', familyName: 'Lune', district: 'undercroft' });
  assert.ok(!availableActions(w, attacker).includes('erase'), 'no tool: no offer');

  attacker.possessions.push({ id: 'i_1', productId: 'tinkers_kit', acquiredDay: w.day });
  const conditions = erasureConditions(w, attacker.id, victim.id);
  assert.equal(conditions.means, true);
  assert.equal(conditions.opportunity, true, conditions.missing.join(', '));
  assert.ok(availableActions(w, attacker).includes('erase'), 'means, opportunity and the night: it is offered');

  // Anybody else standing here takes the opportunity away, and the offer with it.
  makeCitizen(w, { name: 'Witness', familyName: 'Witness', district: 'undercroft' });
  assert.ok(!availableActions(w, attacker).includes('erase'), 'a third citizen in the district ends it');
  // Daylight does too.
  w.hour = 12;
  w.tick = w.day * 24 + w.hour;
  assert.equal(erasureConditions(w, attacker.id, victim.id).opportunity, false);
});

test('what the record says a citizen did under a suspension does not change when their standing does', () => {
  const w = courtWorld();
  const d = makeCitizen(w, { name: 'Rennick', familyName: 'Rennick', wallet: 200 });
  d.standing = 'suspended';
  d.suspendedUntilDay = w.day + 10;
  d.record.convictions.push({ caseId: 'k_susp', law: 'L08', severity: 4, tier: 4, day: w.day - 2 });
  w.tick = (w.day) * 24 + w.config.courtHour;

  const k = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 0.9, filedBy: 'watch', description: 'x' });
  assert.equal(committedWhileSuspended(w, k), true);
  assert.equal(offencesWhileSuspended(w, k), 1, 'the Charter exiles on the second, not the first');
  k.sentence = computeSentence(w, k);
  k.verdict = 'guilty';
  executeSentence(w, k);

  // The suspension runs out. What was done under it is still what was done
  // under it, so the Charter's count does not quietly reset.
  d.standing = 'probation';
  d.suspendedUntilDay = null;
  assert.equal(offencesWhileSuspended(w, k), 1, 'the record remembers');
  assert.equal(committedWhileSuspended(w, k), false, 'though the citizen is no longer suspended');
});
