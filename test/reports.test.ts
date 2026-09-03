/**
 * The Watch reports; officers charge (docs/FREE_MINDS.md §E).
 *
 * Detection puts a report before the officer who made it, a citizen's report
 * waits in the shared inbox for any officer, and it is an officer's own
 * decision — `file_charge` or `drop_report` — that decides what becomes of it.
 * A report nobody acts on lapses into the record with the officer's name on
 * it, which is what a citizen would need to report an abuse of office.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, Job, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import { commitOffence, reportOffence, tickWatch } from '../src/government/watch.ts';
import {
  REPORT_EXPIRY_TICKS, dropReport, expireReports, fileReport, observedReportsFor, openReport, reportsFor,
} from '../src/government/reports.ts';
import { buildObservation } from '../src/brains/observe.ts';
import { availableActions, executeAction } from '../src/actions/execute.ts';

function addOfficer(w: World, overrides: Parameters<typeof makeCitizen>[1] = {}): Citizen {
  const c = makeCitizen(w, { office: 'watch', district: 'commons', ...overrides });
  const id = nextId(w, 'j');
  const job: Job = {
    id, role: 'watch_officer', title: 'Watch Officer', employer: 'city', buildingId: 'watch_house', district: 'commons',
    skill: 'analysis', minSkill: 15, minReputation: 40, wage: 16, output: {}, holderId: c.id, createdDay: w.day,
  };
  w.jobs[id] = job;
  c.jobId = id;
  w.government.watch.push(c.id);
  return c;
}

function at(w: World, day: number, hour: number): void {
  w.day = day; w.hour = hour; w.tick = day * 24 + hour;
}

// ---------------------------------------------------------------------------
// What an officer holds
// ---------------------------------------------------------------------------

test('an officer sees the reports before them, and nobody else does', () => {
  const w = makeWorld();
  at(w, 1, 9);
  const officer = addOfficer(w, { brain: 'remote' });
  const other = addOfficer(w, { brain: 'remote' });
  const suspect = makeCitizen(w);
  const victim = makeCitizen(w);
  const mine = openReport(w, {
    officerId: officer.id, suspectId: suspect.id, law: 'L04', evidence: 0.6, victimId: victim.id, amount: 30,
    description: 'Petty theft: seen at the Bazaar',
  });
  const shared = openReport(w, { officerId: null, suspectId: suspect.id, law: 'L05', evidence: 0.4, description: 'Harassment: reported by a neighbour' });

  const obs = buildObservation(w, officer.id);
  assert.equal(obs.reports.length, 2, 'their own report and the shared inbox');
  const row = obs.reports.find((r) => r.id === mine.id);
  assert.ok(row);
  assert.equal(row.suspect, suspect.id);
  assert.equal(row.suspectName, suspect.name);
  assert.equal(row.law, 'L04');
  assert.equal(row.evidence, 0.6);
  assert.equal(row.victim, victim.id);
  assert.equal(row.amount, 30);
  assert.equal(row.shared, false);
  assert.equal(row.expiresInTicks, REPORT_EXPIRY_TICKS);
  assert.equal(obs.reports.find((r) => r.id === shared.id)?.shared, true);
  assert.ok(obs.availableActions.includes('file_charge'));
  assert.ok(obs.availableActions.includes('drop_report'));

  // Another officer sees only the shared one; a citizen sees none at all.
  assert.deepEqual(observedReportsFor(w, other.id).map((r) => r.id), [shared.id]);
  assert.deepEqual(buildObservation(w, victim.id).reports, []);
  assert.ok(!availableActions(w, victim).includes('file_charge'));
  const refused = executeAction(w, victim.id, { type: 'file_charge', reportId: mine.id });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /the Watch/i);
  const poached = executeAction(w, other.id, { type: 'file_charge', reportId: mine.id });
  assert.equal(poached.ok, false);
  assert.match(poached.message, new RegExp(officer.name));
});

test('file_charge puts the report before the Court, once', () => {
  const w = makeWorld();
  at(w, 1, 9);
  const officer = addOfficer(w, { brain: 'remote' });
  const suspect = makeCitizen(w, { district: 'commons' });
  const victim = makeCitizen(w);
  const before = totalMoney(w);
  const r = openReport(w, {
    officerId: officer.id, suspectId: suspect.id, law: 'L08', evidence: 0.8, victimId: victim.id, amount: 70,
    description: 'Grand theft: seen at the Bazaar',
  });
  const filed = executeAction(w, officer.id, { type: 'file_charge', reportId: r.id });
  assert.equal(filed.ok, true, filed.message);
  assert.equal(r.status, 'filed');
  assert.ok(r.filedCaseId);
  const k = w.cases[r.filedCaseId];
  assert.equal(k.defendantId, suspect.id);
  assert.equal(k.law, 'L08');
  assert.equal(k.evidence, 0.8);
  assert.equal(k.filedBy, officer.id, 'the officer who charged it is on the record');
  assert.equal(k.victimId, victim.id);
  assert.equal(k.amount, 70);
  assert.ok(k.description.includes(r.id), 'the charge names the report it came from');
  assert.ok(suspect.detainedUntilTick !== null, 'a strong severity-4 charge means the Watch House');
  assert.equal(totalMoney(w), before, 'charging moves no money');
  assert.equal(executeAction(w, officer.id, { type: 'file_charge', reportId: r.id }).ok, false);
  assert.equal(executeAction(w, officer.id, { type: 'drop_report', reportId: r.id, reason: 'never mind' }).ok, false);
  assert.deepEqual(reportsFor(w, officer.id), [], 'a filed report is off the desk');
});

test('drop_report lets it go, with the reason and the officer on the record', () => {
  const w = makeWorld();
  at(w, 1, 9);
  const officer = addOfficer(w, { brain: 'remote' });
  const suspect = makeCitizen(w);
  const victim = makeCitizen(w);
  const r = openReport(w, {
    officerId: officer.id, suspectId: suspect.id, law: 'L04', evidence: 0.35, victimId: victim.id,
    description: 'Petty theft: a shout in the dark',
  });
  const dropped = executeAction(w, officer.id, { type: 'drop_report', reportId: r.id, reason: 'I saw a coat, not a face.' });
  assert.equal(dropped.ok, true, dropped.message);
  assert.equal(r.status, 'dropped');
  assert.equal(r.droppedReason, 'I saw a coat, not a face.');
  assert.equal(Object.keys(w.cases).length, 0);
  const line = w.events.find((e) => e.data?.reportId === r.id);
  assert.ok(line, 'dropping a report is a public act');
  assert.ok(line.text.includes(officer.name) && line.text.includes('I saw a coat, not a face.'), line.text);
  assert.ok(victim.memory.some((m) => m.text.includes('dropped')), 'the victim is told');
  assert.ok(w.reports[r.id], 'and the report stays in the book');
});

// ---------------------------------------------------------------------------
// Lapsing
// ---------------------------------------------------------------------------

test('a report nobody acts on lapses, naming the officer who sat on it', () => {
  const w = makeWorld();
  at(w, 1, 9);
  const officer = addOfficer(w, { brain: 'remote' });
  const suspect = makeCitizen(w);
  const watcher = makeCitizen(w);
  const r = openReport(w, { officerId: officer.id, suspectId: suspect.id, law: 'L04', evidence: 0.9, description: 'Petty theft: caught in the act' });

  at(w, 1, 9 + REPORT_EXPIRY_TICKS - 1);
  expireReports(w);
  assert.equal(r.status, 'open', 'a day is a day');
  at(w, 2, 9);
  expireReports(w);
  assert.equal(r.status, 'expired');
  assert.equal(Object.keys(w.cases).length, 0);
  const notice = w.events.find((e) => e.kind === 'system' && e.data?.reportId === r.id);
  assert.ok(notice, 'the lapse is a system notice, not a secret');
  assert.ok(notice.text.includes(`unfiled by Officer ${officer.name}`), notice.text);
  assert.ok(officer.memory.some((m) => m.text.includes('lapsed')));

  // Which is exactly what a citizen would need to report an abuse of office.
  const complaint = executeAction(w, watcher.id, { type: 'report', citizen: officer.id, law: 'L11', text: `Report ${r.id} lapsed in their hands.` });
  assert.equal(complaint.ok, true, complaint.message);
  const against = Object.values(w.reports).find((x) => x.suspectId === officer.id);
  assert.ok(against && against.law === 'L11');
  assert.equal(against.officerId, null, 'and it waits in the shared inbox for another officer');
});

// ---------------------------------------------------------------------------
// Citizens' reports
// ---------------------------------------------------------------------------

test('a citizen\'s report is shared, and any officer may take it up', () => {
  const w = makeWorld();
  at(w, 4, 9);
  const officer = addOfficer(w, { brain: 'remote' });
  const thief = makeCitizen(w, { district: 'harbor_market' });
  const victim = makeCitizen(w, { district: 'harbor_market' });
  // Something real that the Watch missed.
  for (let i = 0; i < 200; i++) {
    const r = commitOffence(w, thief.id, 'L04', { victimId: victim.id, amount: 20, visibilityMod: -10 });
    if (!r.detected) break;
  }
  assert.ok(thief.recentOffences.some((o) => !o.detected));
  const told = reportOffence(w, victim.id, thief.id, 'L04', 'He took my purse.');
  assert.equal(told.ok, true, told.message);
  const shared = Object.values(w.reports).find((x) => x.suspectId === thief.id && x.status === 'open');
  assert.ok(shared);
  assert.equal(shared.officerId, null);
  assert.equal(shared.evidence, 0.75);
  assert.equal(Object.keys(w.cases).length, 0, 'a report is not a charge');
  assert.ok(observedReportsFor(w, officer.id).some((x) => x.id === shared.id && x.shared));
  const filed = executeAction(w, officer.id, { type: 'file_charge', reportId: shared.id });
  assert.equal(filed.ok, true, filed.message);
  assert.equal(shared.officerId, officer.id, 'whoever takes it up owns it');
  assert.ok(shared.filedCaseId && w.cases[shared.filedCaseId].filedBy === officer.id);
});

// ---------------------------------------------------------------------------
// Scripted officers
// ---------------------------------------------------------------------------

test('a scripted officer files what the evidence supports and drops the rest', () => {
  const w = makeWorld();
  at(w, 1, 9);
  const officer = addOfficer(w);
  const suspect = makeCitizen(w, { district: 'commons' });
  const solid = openReport(w, { officerId: officer.id, suspectId: suspect.id, law: 'L04', evidence: 0.6, description: 'Petty theft: seen plainly' });
  const thin = openReport(w, { officerId: null, suspectId: suspect.id, law: 'L05', evidence: 0.2, description: 'Harassment: on somebody\'s word alone' });

  tickWatch(w);
  assert.equal(solid.status, 'open', 'an officer sleeps on what came in this hour');
  at(w, 1, 10);
  tickWatch(w);
  assert.equal(solid.status, 'filed');
  assert.ok(solid.filedCaseId && w.cases[solid.filedCaseId].filedBy === officer.id);
  assert.equal(thin.status, 'dropped');
  assert.match(thin.droppedReason ?? '', /too thin/);
  assert.deepEqual(reportsFor(w, officer.id), []);
});

test('an officer who takes a bribe drops what they hold against the citizen who paid', () => {
  const w = makeWorld();
  at(w, 1, 9);
  const officer = addOfficer(w);
  officer.personality.honesty = 0; // certain to accept
  const briber = makeCitizen(w, { district: 'commons', wallet: 200 });
  const stranger = makeCitizen(w, { district: 'commons' });
  const mine = openReport(w, { officerId: officer.id, suspectId: briber.id, law: 'L04', evidence: 0.9, description: 'Petty theft: caught in the act' });
  const others = openReport(w, { officerId: officer.id, suspectId: stranger.id, law: 'L04', evidence: 0.9, description: 'Petty theft: caught in the act' });
  const before = totalMoney(w);

  const paid = executeAction(w, briber.id, { type: 'bribe', official: officer.id, amount: 40 });
  assert.equal(paid.ok, true, paid.message);
  assert.equal(mine.status, 'dropped', 'the bribe buys the report');
  assert.ok((mine.droppedReason ?? '').length > 0, 'and the reason is on the record for anyone to read');
  assert.equal(others.status, 'open', 'but only that citizen\'s');
  assert.equal(totalMoney(w), before, 'a bribe moves money, it does not make any');
  assert.ok(officer.memory.some((m) => m.text.includes('dropped')));
  assert.ok(w.events.some((e) => e.data?.reportId === mine.id));

  // And for the rest of the day the officer files nothing new against them.
  const fresh = openReport(w, { officerId: officer.id, suspectId: briber.id, law: 'L08', evidence: 1, description: 'Grand theft: caught in the act' });
  at(w, 1, 11);
  tickWatch(w);
  assert.equal(fresh.status, 'dropped');
  assert.equal(others.status, 'filed', 'the officer still does the job for everybody else');
});

test('an officer off duty, and a suspect who has left, can be charged by nobody', () => {
  const w = makeWorld();
  at(w, 1, 9);
  const officer = addOfficer(w, { brain: 'remote' });
  const gone = makeCitizen(w);
  const r = openReport(w, { officerId: officer.id, suspectId: gone.id, law: 'L04', evidence: 0.9, description: 'Petty theft' });
  gone.standing = 'exiled';
  w.order = w.order.filter((id) => id !== gone.id);
  const filed = executeAction(w, officer.id, { type: 'file_charge', reportId: r.id });
  assert.equal(filed.ok, false);
  assert.match(filed.message, /no longer in Reverie/);
  assert.equal(Object.keys(w.cases).length, 0);

  officer.standing = 'suspended';
  assert.deepEqual(reportsFor(w, officer.id), [], 'a suspended officer holds nothing');
  assert.deepEqual(observedReportsFor(w, officer.id), []);
  officer.standing = 'good';
  assert.equal(dropReport(w, officer.id, r.id, 'the trail is cold').ok, true);
  assert.equal(fileReport(w, officer.id, 'r_404').ok, false);
});
