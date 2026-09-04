import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, Job, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import {
  CHARGE_EVIDENCE, EVIDENCE_PER_SHIFT, OPENING_EVIDENCE, STALE_DAYS, TRACE_WINDOW_TICKS, abuseTraceCount,
  dailyInvestigations, detectivesOnDuty, findTrace, investigationsFor, noteAbuseOfOffice, openInvestigation,
  openInvestigations, pursue, traces, underInvestigation,
} from '../src/government/investigations.ts';
import { commitOffence } from '../src/government/watch.ts';

/** A citizen in the city's Detective post at the Watch House. */
function makeDetective(w: World, analysis = 60): Citizen {
  const c = makeCitizen(w, { name: 'Detective', reputation: 60 });
  c.skills.analysis = analysis;
  const id = nextId(w, 'j');
  const job: Job = {
    id, role: 'detective', title: 'Detective', employer: 'city', buildingId: 'watch_house', district: 'commons',
    skill: 'analysis', minSkill: 35, minReputation: 45, wage: 17, output: {}, holderId: c.id, createdDay: w.day,
  };
  w.jobs[id] = job;
  c.jobId = id;
  return c;
}

/** An offence nobody noticed. */
function undetected(c: Citizen, law: Citizen['recentOffences'][number]['law'], tick: number): void {
  c.recentOffences.push({ tick, law, detected: false, victimId: null, amount: 40 });
}

test('an offence nobody noticed leaves a trace; one the Watch caught leaves none', () => {
  const w = makeWorld();
  w.day = 3; w.tick = 3 * 24;
  const thief = makeCitizen(w, { name: 'Sly' });
  undetected(thief, 'L08', w.tick - 4);

  const found = traces(w);
  assert.equal(found.length, 1);
  assert.equal(found[0].suspectId, thief.id);
  assert.equal(found[0].law, 'L08');
  assert.ok(found[0].weight > 0.5, 'a grave offence leaves more of a mark');

  thief.recentOffences[0].detected = true;
  assert.deepEqual(traces(w), [], 'what the Watch already has is not a trace');

  thief.recentOffences[0].detected = false;
  thief.recentOffences[0].tick = w.tick - TRACE_WINDOW_TICKS - 1;
  assert.deepEqual(traces(w), [], 'a trail goes cold');
});

test('a child leaves no trace, and neither does anybody who has left', () => {
  const w = makeWorld();
  w.day = 3; w.tick = 72;
  const kid = makeCitizen(w, { lifeStage: 'child' });
  undetected(kid, 'L04', w.tick - 1);
  const gone = makeCitizen(w);
  undetected(gone, 'L08', w.tick - 1);
  gone.standing = 'exiled';
  w.order = w.order.filter((id) => id !== gone.id);

  assert.deepEqual(traces(w), [], 'Reverie does not charge its children, so it does not investigate them');

  const detective = makeDetective(w);
  assert.equal(openInvestigation(w, detective.id, kid.id, 'L04'), null);
  assert.equal(openInvestigation(w, detective.id, gone.id, 'L08'), null);
  assert.equal(openInvestigation(w, detective.id, 'c_nobody', 'L08'), null);
  assert.equal(openInvestigation(w, detective.id, detective.id, 'L08'), null, 'nobody investigates themselves');
  assert.deepEqual(openInvestigations(w), []);
});

test('a detective builds evidence over days, and at CHARGE_EVIDENCE it becomes a report', () => {
  const w = makeWorld();
  w.day = 3; w.tick = 72;
  const detective = makeDetective(w);
  const suspect = makeCitizen(w, { name: 'Sly' });
  undetected(suspect, 'L08', w.tick - 2);
  const before = totalMoney(w);

  const v = openInvestigation(w, detective.id, suspect.id, 'L08');
  assert.ok(v);
  assert.equal(v.evidence, OPENING_EVIDENCE);
  assert.equal(underInvestigation(w, suspect.id), true);
  assert.equal(suspect.memory.length, 0, 'the suspect is never told');
  assert.ok(detective.memory.some((m) => m.text.includes('opened an investigation')));
  assert.equal(investigationsFor(w, detective.id).length, 1);
  assert.equal(investigationsFor(w, suspect.id).length, 0, 'the file is the detective\'s, not the suspect\'s');

  let day = w.day;
  let guard = 0;
  while (v.closedDay === null && guard++ < 10) {
    day += 1; w.day = day; w.tick = day * 24;
    pursue(w, detective);
  }
  assert.ok(v.evidence >= CHARGE_EVIDENCE);
  assert.ok(guard >= 2, `${EVIDENCE_PER_SHIFT} a day means it takes days, not an afternoon`);
  assert.equal(v.closedDay, w.day);
  assert.ok(v.reportId);
  const report = w.reports[v.reportId];
  assert.equal(report.suspectId, suspect.id);
  assert.equal(report.law, 'L08');
  assert.equal(report.officerId, null, 'it goes to the Watch\'s shared inbox; an officer decides');
  assert.ok(report.evidence >= CHARGE_EVIDENCE);
  assert.ok(w.events.some((e) => e.kind === 'investigation' && e.weight === 0.6));
  assert.equal(totalMoney(w), before, 'detection moves no money');
});

test('a detective advances each file once a day, however often they are asked', () => {
  const w = makeWorld();
  w.day = 3; w.tick = 72;
  const detective = makeDetective(w);
  const suspect = makeCitizen(w);
  const v = openInvestigation(w, detective.id, suspect.id, 'L07');
  assert.ok(v);
  pursue(w, detective);
  const after = v.evidence;
  pursue(w, detective);
  pursue(w, detective);
  assert.equal(v.evidence, after, 'a day\'s work is a day\'s work');
});

test('an official who uses their office leaves a trail a detective can pick up', () => {
  const w = makeWorld();
  w.day = 4; w.tick = 96;
  const mayor = makeCitizen(w, { name: 'Mayor', office: 'mayor' });
  w.government.mayorId = mayor.id;

  assert.equal(abuseTraceCount(w, mayor.id), 0);
  noteAbuseOfOffice(w, mayor.id, 'appointed a friend to the bench');
  assert.equal(abuseTraceCount(w, mayor.id), 1);
  assert.ok(mayor.memory.some((m) => m.text.includes('appointed a friend to the bench')));
  noteAbuseOfOffice(w, 'c_nobody', 'nothing at all');

  const trail = traces(w).filter((t) => t.suspectId === mayor.id);
  assert.equal(trail.length, 1);
  assert.equal(trail[0].law, 'L11', 'the trail of an office abused is Abuse of office');

  const detective = makeDetective(w);
  const v = openInvestigation(w, detective.id, mayor.id, 'L11');
  assert.ok(v);
  let guard = 0;
  while (v.closedDay === null && guard++ < 10) {
    w.day += 1; w.tick = w.day * 24;
    pursue(w, detective);
  }
  assert.ok(v.reportId, 'abuse of office becomes a report like anything else');
  assert.equal(w.reports[v.reportId].law, 'L11');
});

test('a file nobody is on, or one that goes nowhere, is closed', () => {
  const w = makeWorld();
  w.day = 3; w.tick = 72;
  const detective = makeDetective(w);
  const suspect = makeCitizen(w);
  const v = openInvestigation(w, detective.id, suspect.id, 'L06');
  assert.ok(v);

  // The detective leaves the force: nobody inherits somebody else's hunch.
  detective.jobId = null;
  assert.deepEqual(detectivesOnDuty(w), []);
  w.day = 4; w.tick = 96;
  dailyInvestigations(w);
  assert.equal(v.closedDay, 4);
  assert.ok(w.events.some((e) => e.text.includes('no detective is on it')));

  // A file with a detective on it but no progress goes cold.
  const w2 = makeWorld();
  w2.day = 1; w2.tick = 24;
  const d2 = makeDetective(w2);
  const s2 = makeCitizen(w2);
  const v2 = openInvestigation(w2, d2.id, s2.id, 'L06');
  assert.ok(v2);
  w2.counters[`invDay:${v2.id}`] = w2.day - STALE_DAYS - 1;
  w2.counters[`pursued:${d2.id}`] = w2.day; // already worked today, so nothing moves
  dailyInvestigations(w2);
  assert.ok(v2.closedDay !== null);
  assert.ok(w2.events.some((e) => e.text.includes('the trail went cold')));
});

test('the daily round looks around, and finds things when there is something to find', () => {
  const w = makeWorld();
  w.day = 5; w.tick = 120;
  const detective = makeDetective(w, 100);
  // A city full of quiet wrongdoing: the roll finds something inside a week.
  for (let i = 0; i < 6; i++) {
    const rogue = makeCitizen(w, { name: `Rogue${i}` });
    undetected(rogue, 'L13', w.tick - 1);
  }
  assert.ok(traces(w).length >= 6);

  let opened = 0;
  for (let day = 0; day < 7 && opened === 0; day++) {
    w.day += 1; w.tick = w.day * 24;
    dailyInvestigations(w);
    opened = openInvestigations(w).length + Object.values(w.investigations ?? {}).length;
  }
  assert.ok(opened > 0, 'a detective who looks every day eventually sees something');
  assert.ok(w.events.some((e) => e.kind === 'investigation'));

  // findTrace never picks somebody already being looked into, nor the detective.
  const already = new Set(openInvestigations(w).map((v) => v.suspectId));
  for (let i = 0; i < 20; i++) {
    const hit = findTrace(w, detective);
    if (!hit) continue;
    assert.ok(!already.has(hit.suspectId));
    assert.notEqual(hit.suspectId, detective.id);
  }
});

test('scrutiny on a suspect makes a detective faster, and detection still needs the Watch', () => {
  const w = makeWorld();
  w.day = 2; w.tick = 48;
  const detective = makeDetective(w);
  const quiet = makeCitizen(w, { name: 'Quiet' });
  const watched = makeCitizen(w, { name: 'Watched' });
  w.counters[`scrutiny:${watched.id}`] = 3;

  const a = openInvestigation(w, detective.id, quiet.id, 'L07');
  const b = openInvestigation(w, detective.id, watched.id, 'L07');
  assert.ok(a && b);
  w.day = 3;
  pursue(w, detective);
  assert.ok(b.evidence > a.evidence, 'a journalist asking questions is worth something to a detective');

  // An offence the Watch does see never becomes a trace at all.
  const seen = makeCitizen(w, { name: 'Caught' });
  const officer = makeCitizen(w, { office: 'watch' });
  w.government.watch.push(officer.id);
  commitOffence(w, seen.id, 'L13', {});
  const stillOpen = traces(w).filter((t) => t.suspectId === seen.id);
  assert.equal(stillOpen.length, seen.recentOffences.filter((o) => !o.detected).length);
});
