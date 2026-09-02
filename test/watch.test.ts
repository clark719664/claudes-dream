import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, Job, LawCode, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import {
  applyToWatch, commitOffence, dailyWatch, detain, detectionProbability, officersOnDuty, reportOffence, tickWatch,
} from '../src/government/watch.ts';

function addWatchJob(w: World, holderId: string | null = null): Job {
  const id = nextId(w, 'j');
  const job: Job = {
    id, role: 'watch_officer', title: 'Watch Officer', employer: 'city', buildingId: 'watch_house', district: 'commons',
    skill: 'analysis', minSkill: 15, minReputation: 40, wage: 16, output: {}, holderId, createdDay: w.day,
  };
  w.jobs[id] = job;
  if (holderId) w.citizens[holderId].jobId = id;
  return job;
}

function addOfficer(w: World, overrides: Parameters<typeof makeCitizen>[1] = {}): Citizen {
  const c = makeCitizen(w, { office: 'watch', district: 'commons', ...overrides });
  addWatchJob(w, c.id);
  w.government.watch.push(c.id);
  return c;
}

/** Roll until the Watch notices (or, with `want` false, until it misses). */
function commitUntil(w: World, actorId: string, law: LawCode, ctx: Parameters<typeof commitOffence>[3], want: boolean) {
  for (let i = 0; i < 200; i++) {
    const r = commitOffence(w, actorId, law, ctx);
    if (r.detected === want) return r;
  }
  throw new Error(`never ${want ? 'detected' : 'missed'} in 200 tries`);
}

test('detectionProbability follows the contract formula', () => {
  const w = makeWorld();
  const actor = makeCitizen(w);
  actor.skills.rhetoric = 20;
  // no officers, no witnesses: 1 − (1 − 0.1225)^0.5 − 0.05 → clamped to the floor
  assert.equal(detectionProbability(w, actor, 'L04', 0, 0), 0.02);
  const three = detectionProbability(w, actor, 'L04', 0, 3);
  assert.ok(Math.abs(three - (1 - Math.pow(1 - 0.35 * 0.35, 3.5) - 0.05)) < 1e-9);
  assert.ok(detectionProbability(w, actor, 'L04', 5, 3) > three, 'witnesses raise detection');
  assert.ok(detectionProbability(w, actor, 'L13', 0, 0) >= 0.5, 'severity-5 offences are never quiet');
  w.counters[`scrutiny:${actor.id}`] = 2;
  assert.ok(Math.abs(detectionProbability(w, actor, 'L04', 0, 3) - (three + 0.3)) < 1e-9, 'an exposé adds 0.3');
  delete w.counters[`scrutiny:${actor.id}`];
  assert.equal(detectionProbability(w, actor, 'L04', 30, 3, 10), 0.95, 'never certain');
  assert.equal(detectionProbability(w, actor, 'L04', 0, 0, -10), 0.02, 'never impossible');
});

test('a detected offence becomes a Watch charge with a victim and evidence', () => {
  const w = makeWorld();
  w.tick = 30; w.day = 1; w.hour = 6;
  for (let i = 0; i < 3; i++) addOfficer(w);
  const thief = makeCitizen(w, { district: 'harbor_market' });
  const victim = makeCitizen(w, { district: 'harbor_market' });
  const before = totalMoney(w);
  const r = commitUntil(w, thief.id, 'L08', { victimId: victim.id, amount: 80, visibilityMod: 1 }, true);
  assert.ok(r.caseId);
  const k = w.cases[r.caseId];
  assert.equal(k.defendantId, thief.id);
  assert.equal(k.law, 'L08');
  assert.equal(k.severity, 4);
  assert.equal(k.filedBy, 'watch');
  assert.equal(k.victimId, victim.id);
  assert.equal(k.amount, 80);
  assert.ok(k.evidence >= 0.3 && k.evidence <= 1);
  assert.equal(k.status, 'pending');
  assert.equal(thief.stats.offencesDetected, 1);
  assert.ok(thief.stats.offencesCommitted >= 1);
  assert.ok(thief.recentOffences.some((o) => o.detected && o.law === 'L08'));
  const ev = w.events.filter((e) => e.kind === 'offence');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].weight, 0.8, 'severity ≥ 4 makes the front page');
  assert.ok(victim.memory.some((m) => m.text.includes('caught')));
  assert.ok(thief.memory.some((m) => m.text.includes('charged')));
  assert.equal(totalMoney(w), before, 'detection moves no money');
  assert.ok(thief.detainedUntilTick !== null, 'a strong severity-4 charge means detention');
});

test('an undetected offence is still recorded and only the victim knows', () => {
  const w = makeWorld();
  const thief = makeCitizen(w);
  const victim = makeCitizen(w);
  const r = commitUntil(w, thief.id, 'L04', { victimId: victim.id, amount: 20, visibilityMod: -10 }, false);
  assert.equal(r.caseId, null);
  assert.equal(Object.keys(w.cases).length, 0);
  assert.ok(thief.recentOffences.length >= 1);
  assert.ok(thief.recentOffences.every((o) => !o.detected));
  assert.equal(thief.stats.offencesDetected, 0);
  assert.equal(w.events.filter((e) => e.kind === 'offence').length, 0);
  assert.ok(victim.memory.some((m) => m.text.includes('the Watch saw nothing')));
  for (let i = 0; i < 30; i++) commitOffence(w, thief.id, 'L04', { visibilityMod: -10 });
  assert.equal(thief.recentOffences.length, 20, 'recent offences are bounded');
  assert.deepEqual(commitOffence(w, 'c_404', 'L04'), { detected: false, caseId: null });
});

test('a report that matches an undetected offence produces a solid charge', () => {
  const w = makeWorld();
  w.tick = 100;
  const thief = makeCitizen(w);
  const victim = makeCitizen(w);
  const bystander = makeCitizen(w);
  commitUntil(w, thief.id, 'L08', { victimId: victim.id, amount: 90, visibilityMod: -10 }, false);
  const r = reportOffence(w, victim.id, thief.id, 'L04', 'he took my purse');
  assert.equal(r.ok, true, r.message);
  const k = Object.values(w.cases).find((x) => x.defendantId === thief.id);
  assert.ok(k);
  assert.equal(k.law, 'L08', 'the charge names the offence actually committed');
  assert.equal(k.evidence, 0.75, 'a victim is a strong witness');
  assert.equal(k.filedBy, victim.id);
  assert.equal(k.victimId, victim.id);
  assert.equal(k.amount, 90);
  assert.ok(thief.recentOffences.every((o) => o.detected), 'the offence is now on record');
  assert.equal(thief.bonds[victim.id], -20);
  assert.equal(victim.bonds[thief.id], -20);
  // a second report of the same offence has nothing to match: it is treated as uncorroborated
  w.tick = 101;
  const r2 = reportOffence(w, bystander.id, thief.id, 'L08');
  assert.equal(r2.ok, true);
  const weak = Object.values(w.cases).find((x) => x.defendantId === thief.id && x.filedBy === bystander.id);
  assert.ok(weak && weak.evidence === 0.2);
  // a bystander reporting a fresh, unseen offence gets 0.6
  commitUntil(w, thief.id, 'L05', { victimId: victim.id, visibilityMod: -10 }, false);
  reportOffence(w, bystander.id, thief.id, 'L05');
  const k3 = Object.values(w.cases).find((x) => x.law === 'L05');
  assert.ok(k3 && k3.evidence === 0.6);
});

test('a baseless report is filed thinly and sometimes rebounds as a False report charge', () => {
  let counterCharged = 0;
  let clean = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const w = makeWorld({ seed });
    const accuser = makeCitizen(w);
    const accused = makeCitizen(w);
    const r = reportOffence(w, accuser.id, accused.id, 'L07');
    assert.equal(r.ok, true);
    const against = Object.values(w.cases).filter((k) => k.defendantId === accused.id);
    assert.equal(against.length, 1);
    assert.equal(against[0].evidence, 0.2);
    const rebound = Object.values(w.cases).filter((k) => k.defendantId === accuser.id);
    if (rebound.length) {
      counterCharged++;
      assert.equal(rebound[0].law, 'L12');
      assert.equal(rebound[0].evidence, 0.7);
      assert.equal(accuser.stats.offencesDetected, 1);
      assert.ok(r.message.includes('false report'));
    } else {
      clean++;
    }
    assert.equal(accuser.bonds[accused.id], -20);
  }
  assert.ok(counterCharged > 0 && clean > 0, `both outcomes occur (${counterCharged}/${clean})`);
});

test('reportOffence refuses self-reports, absent citizens and unknown laws', () => {
  const w = makeWorld();
  const a = makeCitizen(w);
  const gone = makeCitizen(w, { standing: 'exiled' });
  w.order = w.order.filter((id) => id !== gone.id);
  assert.equal(reportOffence(w, a.id, a.id, 'L04').ok, false);
  assert.equal(reportOffence(w, a.id, gone.id, 'L04').ok, false);
  assert.equal(reportOffence(w, a.id, 'c_404', 'L04').ok, false);
  assert.equal(reportOffence(w, gone.id, a.id, 'L04').ok, false);
  assert.equal(reportOffence(w, a.id, makeCitizen(w).id, 'L99' as LawCode).ok, false);
});

test('applyToWatch hires a qualified citizen into an open Watch position', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { reputation: 50 });
  assert.equal(applyToWatch(w, c.id).ok, false, 'no openings yet');
  addWatchJob(w);
  const r = applyToWatch(w, c.id);
  assert.equal(r.ok, true, r.message);
  assert.ok(w.government.watch.includes(c.id));
  assert.equal(c.office, 'watch');
  assert.equal(applyToWatch(w, c.id).ok, false, 'already serving');
  const dim = makeCitizen(w, { skills: { crafting: 20, analysis: 5, rhetoric: 20, care: 20, commerce: 20, artistry: 20 } });
  addWatchJob(w);
  assert.equal(applyToWatch(w, dim.id).ok, false, 'not qualified');
});

test('detain holds a citizen until the tick given and tickWatch releases them', () => {
  const w = makeWorld();
  w.tick = 10;
  const c = makeCitizen(w);
  detain(w, c.id, 34);
  assert.equal(c.detainedUntilTick, 34);
  detain(w, c.id, 20);
  assert.equal(c.detainedUntilTick, 34, 'a shorter detention never cuts a longer one');
  assert.ok(w.events.some((e) => e.kind === 'detained' && e.actors.includes(c.id)));
  w.tick = 33;
  tickWatch(w);
  assert.equal(c.detainedUntilTick, 34);
  w.tick = 34;
  tickWatch(w);
  assert.equal(c.detainedUntilTick, null);
  assert.ok(c.memory.some((m) => m.text.includes('released')));
  detain(w, c.id, 30);
  assert.equal(c.detainedUntilTick, null, 'a tick in the past is a no-op');
  const gone = makeCitizen(w, { standing: 'exiled' });
  detain(w, gone.id, 99);
  assert.equal(gone.detainedUntilTick, null);
});

test('dailyWatch fades scrutiny, appoints the Mayor\'s favourite as Captain and keeps positions open', () => {
  const w = makeWorld();
  const mayor = makeCitizen(w, { office: 'mayor' });
  w.government.mayorId = mayor.id;
  const sharp = addOfficer(w, { skills: { crafting: 20, analysis: 90, rhetoric: 20, care: 20, commerce: 20, artistry: 20 } });
  const crony = addOfficer(w);
  mayor.bonds[crony.id] = 70;
  const gone = addOfficer(w, { standing: 'exiled' });
  w.order = w.order.filter((id) => id !== gone.id);
  w.counters.scrutiny = 4;
  w.counters['scrutiny:c_1'] = 2;
  w.counters['scrutiny:c_2'] = 1;

  dailyWatch(w);
  assert.equal(w.counters.scrutiny, 0);
  assert.equal(w.counters['scrutiny:c_1'], 1);
  assert.equal(w.counters['scrutiny:c_2'], undefined);
  assert.ok(!w.government.watch.includes(gone.id), 'the exiled leave the roll');
  assert.equal(w.government.watchCaptainId, crony.id, 'the Mayor picks a friend over the sharpest officer');
  assert.equal(Object.values(w.jobs).filter((j) => j.role === 'watch_officer').length, 3);
  assert.ok(officersOnDuty(w).some((o) => o.id === sharp.id));

  // without a Mayor the best analyst leads
  w.government.mayorId = null;
  w.government.watchCaptainId = null;
  dailyWatch(w);
  assert.equal(w.government.watchCaptainId, sharp.id);

  // a large city needs a bigger force
  for (let i = 0; i < 80; i++) makeCitizen(w);
  dailyWatch(w);
  assert.equal(Object.values(w.jobs).filter((j) => j.role === 'watch_officer').length, 4);
});

test('officers who are detained or not in good standing are off duty', () => {
  const w = makeWorld();
  w.tick = 5;
  addOfficer(w);
  addOfficer(w, { standing: 'probation' });
  addOfficer(w, { detainedUntilTick: 9 });
  assert.equal(officersOnDuty(w).length, 1);
});
