import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Case, Citizen, Job, World } from '../src/types.ts';
import { ADVOCATE_BASE_FEE } from '../src/data/jobs.ts';
import { MAX_ADVOCACY } from '../src/data/metropolis.ts';
import { nextId } from '../src/util/ids.ts';
import {
  ADVOCATE_MIN_RHETORIC, advocacyDiscount, advocateFee, advocateFor, assignDefender, hireAdvocate, isPublicDefender,
  mayAdvocate, publicDefenders, speak,
} from '../src/government/advocates.ts';
import { fileCharge, holdCourt, judgeBelief, openCourtSession } from '../src/government/court.ts';

function addJudge(w: World): Citizen {
  const j = makeCitizen(w, { office: 'judge', reputation: 80, judgeTermEndsDay: w.day + 56 });
  j.character.honesty = 1;
  w.government.judges.push(j.id);
  return j;
}

function courtWorld(): World {
  const w = makeWorld();
  w.day = 2; w.hour = 10; w.tick = 2 * 24 + 10;
  addJudge(w); addJudge(w); addJudge(w);
  return w;
}

/** Somebody who can be heard: an adult with the rhetoric the Court asks for. */
function addSpeaker(w: World, rhetoric = 60): Citizen {
  const c = makeCitizen(w, { district: 'commons' });
  c.skills.rhetoric = rhetoric;
  return c;
}

/** Put a citizen in the city's Public Defender post at the Courthouse. */
function makeDefender(w: World, rhetoric = 50): Citizen {
  const c = addSpeaker(w, rhetoric);
  const id = nextId(w, 'j');
  const job: Job = {
    id, role: 'advocate', title: 'Public Defender', employer: 'city', buildingId: 'courthouse', district: 'commons',
    skill: 'rhetoric', minSkill: 35, minReputation: 30, wage: 15, output: {}, holderId: c.id, createdDay: w.day,
  };
  w.jobs[id] = job;
  c.jobId = id;
  return c;
}

function charge(w: World, defendantId: string, law: Case['law'] = 'L08'): Case {
  return fileCharge(w, { defendantId, law, evidence: 0.8, filedBy: 'watch', description: 'for the test' });
}

test('the Court will not hear somebody who cannot speak, and prices those who can', () => {
  const w = courtWorld();
  const quiet = addSpeaker(w, ADVOCATE_MIN_RHETORIC - 1);
  const loud = addSpeaker(w, 80);
  const child = makeCitizen(w, { lifeStage: 'child' });
  child.skills.rhetoric = 90;

  assert.equal(mayAdvocate(w, quiet), false, 'rhetoric below the bar');
  assert.equal(mayAdvocate(w, loud), true);
  assert.equal(mayAdvocate(w, child), false, 'children do not appear for anybody');
  assert.equal(mayAdvocate(w, null), false);
  assert.equal(advocateFee(w, loud), ADVOCATE_BASE_FEE + 40);

  const d = makeCitizen(w, { wallet: 500 });
  charge(w, d.id);
  const refused = hireAdvocate(w, d.id, quiet.id);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /rhetoric/);
});

test('the fee moves from the defendant to the advocate and money is conserved', () => {
  const w = courtWorld();
  const a = addSpeaker(w, 60);
  const d = makeCitizen(w, { wallet: 500 });
  const k = charge(w, d.id);
  const before = totalMoney(w);
  const fee = advocateFee(w, a);

  const hired = hireAdvocate(w, d.id, a.id);
  assert.equal(hired.ok, true);
  assert.equal(k.advocateId, a.id);
  assert.equal(advocateFor(w, k)?.id, a.id);
  assert.equal(d.wallet, 500 - fee);
  assert.equal(a.wallet, 200 + fee);
  assert.equal(totalMoney(w), before, 'a fee moves money; it does not make any');
  assert.equal(w.treasury.totals.advocate, fee);
  assert.equal(hireAdvocate(w, d.id, a.id).ok, false, 'one advocate to a case');

  const broke = makeCitizen(w, { wallet: 3 });
  charge(w, broke.id);
  const stillHeld = totalMoney(w);
  const cannot = hireAdvocate(w, broke.id, a.id);
  assert.equal(cannot.ok, false);
  assert.match(cannot.message, /asks/);
  assert.equal(totalMoney(w), stillHeld, 'a refused hire moves nothing');
});

test('speaking lowers every judge\'s belief by at most MAX_ADVOCACY, and only once', () => {
  const w = courtWorld();
  const a = addSpeaker(w, 100);
  const d = makeCitizen(w, { wallet: 500 });
  const k = charge(w, d.id);
  assert.equal(hireAdvocate(w, d.id, a.id).ok, true);
  openCourtSession(w);
  assert.equal(k.status, 'in_session');

  const judge = k.judges[0];
  const seed = w.rng.s;
  const before = judgeBelief(w, judge, k);
  assert.equal(advocacyDiscount(w, k), 0, 'nobody has spoken yet');

  w.rng.s = seed;
  const said = speak(w, a.id, k.id, 'The evidence is a guess in a good coat.');
  assert.equal(said.ok, true);
  assert.equal(k.advocacy, MAX_ADVOCACY, 'rhetoric of 100 buys the whole discount and no more');

  w.rng.s = seed;
  const after = judgeBelief(w, judge, k);
  assert.ok(Math.abs((before - after) - MAX_ADVOCACY) < 1e-9, 'the same judge, the same roll, one speech lighter');
  assert.ok(advocacyDiscount(w, k) <= MAX_ADVOCACY);

  const again = speak(w, a.id, k.id);
  assert.equal(again.ok, false, 'a case hears its advocate once');
  assert.match(again.message, /already spoken/);
  assert.ok(w.events.some((e) => e.kind === 'charge' && e.weight === 0.4 && e.text.includes('good coat')));
  assert.equal(a.reputation, 51);
});

test('speaking needs the sitting, the Courthouse and the retainer', () => {
  const w = courtWorld();
  const a = addSpeaker(w, 60);
  const other = addSpeaker(w, 60);
  const d = makeCitizen(w, { wallet: 500 });
  const k = charge(w, d.id);
  assert.equal(hireAdvocate(w, d.id, a.id).ok, true);

  const early = speak(w, a.id, k.id);
  assert.equal(early.ok, false, 'the bench is not sitting yet');
  assert.match(early.message, /next sitting/);

  openCourtSession(w);
  assert.equal(speak(w, other.id, k.id).ok, false, 'you speak for the client who retained you');
  a.district = 'nightglass';
  const elsewhere = speak(w, a.id, k.id);
  assert.equal(elsewhere.ok, false);
  assert.match(elsewhere.message, /Courthouse/);
  a.district = 'commons';
  assert.equal(speak(w, a.id, k.id).ok, true);
  assert.equal(speak(w, a.id, 'k_nope').ok, false);
});

test('the victim, the accuser and the bench may not speak for the defendant', () => {
  const w = courtWorld();
  const victim = addSpeaker(w, 70);
  const accuser = addSpeaker(w, 70);
  const d = makeCitizen(w, { wallet: 500 });
  const k = fileCharge(w, {
    defendantId: d.id, law: 'L08', evidence: 0.8, filedBy: accuser.id, victimId: victim.id, description: 'theft',
  });

  assert.equal(mayAdvocate(w, victim, k), false);
  assert.equal(mayAdvocate(w, accuser, k), false);
  assert.equal(hireAdvocate(w, d.id, victim.id).ok, false);

  openCourtSession(w);
  const judge = w.citizens[k.judges[0]];
  judge.skills.rhetoric = 90;
  assert.equal(mayAdvocate(w, judge, k), false, 'nobody judges and defends the same case');
});

test('a Public Defender is assigned to a grave charge and charges nothing', () => {
  const w = courtWorld();
  const defender = makeDefender(w, 60);
  assert.deepEqual(publicDefenders(w).map((c) => c.id), [defender.id]);
  assert.equal(isPublicDefender(w, defender), true);
  assert.equal(advocateFee(w, defender), 0, 'the city pays them, not the defendant');

  const poor = makeCitizen(w, { wallet: 0 });
  const light = fileCharge(w, { defendantId: poor.id, law: 'L01', evidence: 0.6, filedBy: 'watch', description: 'a scuffle' });
  const grave = charge(w, poor.id, 'L08');
  const before = totalMoney(w);

  assignDefender(w, light);
  assert.equal(light.advocateId, null, 'a light charge is not a matter for a defender');
  assignDefender(w, grave);
  assert.equal(grave.advocateId, defender.id);
  assert.equal(totalMoney(w), before, 'a Public Defender costs the defendant nothing');
  assert.ok(w.events.some((e) => e.text.includes('assigned Public Defender')));

  // Assignment happens on its own when the Court opens a serious charge.
  const w2 = courtWorld();
  const d2 = makeDefender(w2, 60);
  const accused = makeCitizen(w2, { wallet: 0 });
  const k2 = charge(w2, accused.id, 'L09');
  openCourtSession(w2);
  assert.equal(k2.advocateId, d2.id);
});

test('an advocate who cannot be found leaves the case as it was, and the trial still runs', () => {
  const w = courtWorld();
  const d = makeCitizen(w, { wallet: 200 });
  const k = charge(w, d.id, 'L08');
  assert.equal(hireAdvocate(w, d.id, 'c_nobody').ok, false);
  assert.equal(hireAdvocate(w, d.id, d.id).ok, false, 'you cannot bill yourself');
  assert.equal(k.advocateId, null);

  assignDefender(w, k); // no defenders in this city at all
  assert.equal(k.advocateId, null);
  holdCourt(w);
  assert.ok(k.verdict, 'a defendant with nobody to speak for them is still tried');

  const settled = makeCitizen(w, { wallet: 100 });
  assert.equal(hireAdvocate(w, settled.id, d.id).ok, false, 'no charge, nobody to answer');
});
