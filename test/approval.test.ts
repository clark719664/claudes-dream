/**
 * Approval (src/politics/approval.ts).
 *
 * Every citizen's own reading of the people running the city, from their own
 * public situation and nothing else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Case, Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import {
  NEUTRAL, WALLET_TREND_DAYS, approvalBonus, approvalOf, approvalOfOffice, cityApproval, dailyApproval,
} from '../src/politics/approval.ts';

/** A Mayor and a Council, so there is somebody to have an opinion about. */
function government(world: World): { mayor: Citizen; councillor: Citizen } {
  const mayor = makeCitizen(world, { name: 'Sable' });
  const councillor = makeCitizen(world, { name: 'Fen' });
  world.government.mayorId = mayor.id;
  world.government.council = [mayor.id, councillor.id];
  mayor.office = 'mayor';
  councillor.office = 'councillor';
  return { mayor, councillor };
}

/** Somebody with a post to go to. */
function employ(world: World, c: Citizen): void {
  const id = `j_${Object.keys(world.jobs).length + 1}`;
  world.jobs[id] = {
    id, role: 'fabricator', title: 'Fabricator', employer: 'city', buildingId: 'fabrication_hall',
    district: 'foundry_row', skill: 'crafting', minSkill: 0, minReputation: 0, wage: 10,
    output: {}, holderId: c.id, createdDay: 0,
  };
  c.jobId = id;
}

function wrong(world: World, victim: Citizen): void {
  const k: Case = {
    id: `k_${Object.keys(world.cases).length + 1}`, defendantId: 'c_other', law: 'L04', severity: 2,
    evidence: 0.6, filedTick: world.tick, filedBy: 'watch', victimId: victim.id, amount: 12,
    description: 'a picked pocket', status: 'pending', triedDay: null, judges: [], votes: {}, reasons: {},
    openedTick: null, carriedSessions: 0, decidedByDefault: false, verdict: null, sentence: null, appeal: null,
  };
  world.cases[k.id] = k;
}

// ---------------------------------------------------------- what moves a reading

test('a citizen in work approves of the city more than one without', () => {
  const w = makeWorld();
  government(w);
  const working = makeCitizen(w);
  const idle = makeCitizen(w);
  employ(w, working);
  assert.ok(approvalOf(w, working, 'mayor') > approvalOf(w, idle, 'mayor'));
  assert.ok(approvalOf(w, working, 'council') > approvalOf(w, idle, 'council'));
});

test('a citizen the city failed to keep safe approves less', () => {
  const w = makeWorld();
  government(w);
  const safe = makeCitizen(w);
  const victim = makeCitizen(w);
  const before = approvalOf(w, victim, 'council');
  wrong(w, victim);
  assert.ok(approvalOf(w, victim, 'council') < before);
  assert.ok(approvalOf(w, victim, 'council') < approvalOf(w, safe, 'council'));

  w.day = 40;
  w.tick = 40 * 24;
  assert.equal(approvalOf(w, victim, 'council'), approvalOf(w, safe, 'council'), 'an old wrong stops weighing');
});

test('a dear Bazaar weighs against the Council', () => {
  const w = makeWorld();
  government(w);
  const c = makeCitizen(w);
  const before = approvalOf(w, c, 'council');
  w.market.priceIndex = 1.6;
  assert.ok(approvalOf(w, c, 'council') < before);
});

test('a purse that grew over three days reads better than one that shrank', () => {
  const w = makeWorld();
  government(w);
  const richer = makeCitizen(w, { wallet: 100 });
  const poorer = makeCitizen(w, { wallet: 100 });
  dailyApproval(w);
  assert.equal(w.counters[`wallet3:${richer.id}`], 100);

  w.day = 1;
  richer.wallet = 400;
  poorer.wallet = 20;
  dailyApproval(w);
  assert.ok((richer.approval?.mayor ?? 0) > (poorer.approval?.mayor ?? 1), 'the mark is read every morning');
  assert.equal(w.counters[`wallet3:${richer.id}`], 100, 'and stands for three days');

  w.day = WALLET_TREND_DAYS;
  dailyApproval(w);
  assert.ok((richer.approval?.mayor ?? 0) > (poorer.approval?.mayor ?? 1));
  assert.equal(w.counters[`wallet3:${richer.id}`], 400, 'then the window rolls forward');
});

test('a reading is a number between 0 and 1, rounded to two places, for anybody at all', () => {
  const w = makeWorld();
  government(w);
  const child = makeCitizen(w, { lifeStage: 'child', wallet: 0 });
  const destitute = makeCitizen(w, { wallet: 0, homeTier: 0, reputation: 0 });
  const suspended = makeCitizen(w, { standing: 'suspended' });
  w.market.priceIndex = 4;
  for (const c of [child, destitute, suspended]) {
    for (const office of ['mayor', 'council'] as const) {
      const value = approvalOf(w, c, office);
      assert.ok(Number.isFinite(value), 'never NaN');
      assert.ok(value >= 0 && value <= 1, `${value} out of range`);
      assert.equal(Math.round(value * 100) / 100, value, 'rounded to two places');
    }
  }
  assert.ok(approvalOf(w, child, 'mayor') > approvalOf(w, destitute, 'mayor'), 'a child is not blamed for having no job');
});

test('an empty chair is neither approved of nor blamed', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 0 });
  assert.equal(approvalOf(w, c, 'mayor'), NEUTRAL);
  assert.equal(approvalOf(w, c, 'council'), NEUTRAL);
  assert.deepEqual(cityApproval(w), { mayor: NEUTRAL, council: NEUTRAL });
  assert.equal(approvalOfOffice(w, c.id), NEUTRAL);
});

test('the paper a citizen reads and the school they hold colour the reading, a little', () => {
  const w = makeWorld();
  government(w);
  w.government.incomeTax = 0.5;
  w.government.dividend = 60;
  const chronicle = makeCitizen(w);
  const ledger = makeCitizen(w, { paper: 'ledger' });
  const commons = makeCitizen(w, { school: 'commons' });
  const makers = makeCitizen(w, { school: 'makers' });
  assert.ok(approvalOf(w, ledger, 'council') < approvalOf(w, chronicle, 'council'), 'a high-tax city reads badly in the Ledger');
  assert.ok(approvalOf(w, commons, 'council') > approvalOf(w, makers, 'council'));
});

// --------------------------------------------------------------- the daily pass

test('the daily pass gives every citizen still in the city a reading, and the mean is the city\'s', () => {
  const w = makeWorld();
  const { mayor } = government(w);
  const a = makeCitizen(w);
  const b = makeCitizen(w, { wallet: 0 });
  employ(w, a);
  const exile = makeCitizen(w, { standing: 'exiled' });
  const gone = makeCitizen(w);
  w.order = w.order.filter((id) => id !== gone.id);
  // What each of them thought before the pass; the pass must leave it alone.
  const exileBefore = { ...exile.approval };
  const goneBefore = { ...gone.approval };

  dailyApproval(w);
  assert.ok(a.approval && b.approval && mayor.approval);
  assert.deepEqual(exile.approval, exileBefore, 'an exile keeps whatever it last thought');
  assert.deepEqual(gone.approval, goneBefore);
  assert.equal(w.counters[`wallet3:${gone.id}`], undefined, 'and no snapshot is kept for them');

  const present = w.order.map((id) => w.citizens[id]).filter((c) => c.standing !== 'exiled');
  const mean = present.reduce((sum, c) => sum + (c.approval?.mayor ?? 0), 0) / present.length;
  assert.equal(cityApproval(w).mayor, Math.round(mean * 100) / 100);
});

test('a city with nobody in it still answers', () => {
  const w = makeWorld();
  dailyApproval(w);
  assert.deepEqual(cityApproval(w), { mayor: NEUTRAL, council: NEUTRAL });
  assert.equal(approvalOf(w, undefined as unknown as Citizen, 'mayor'), NEUTRAL);
  assert.equal(approvalBonus(w, undefined as unknown as Citizen, 'c_1'), 0);
});

// ---------------------------------------------------------------- at the ballot

test('an incumbent the voter thinks poorly of loses a vote they would otherwise win', () => {
  const w = makeWorld();
  const { mayor, councillor } = government(w);
  const challenger = makeCitizen(w, { name: 'Wren' });
  const voter = makeCitizen(w);

  voter.approval = { mayor: 0.2, council: 0.2 };
  assert.equal(approvalBonus(w, voter, mayor.id), -0.2);
  assert.equal(approvalBonus(w, voter, councillor.id), -0.2);
  assert.equal(approvalBonus(w, voter, challenger.id), 0, 'a challenger has held nothing to be judged on');

  // the incumbent leads on every other count by a tenth; the voter's opinion turns it over.
  const incumbentScore = 0.6 + approvalBonus(w, voter, mayor.id);
  const challengerScore = 0.5 + approvalBonus(w, voter, challenger.id);
  assert.ok(challengerScore > incumbentScore);

  voter.approval = { mayor: 0.9, council: 0.9 };
  assert.equal(approvalBonus(w, voter, mayor.id), 0.2);
  assert.ok(0.6 + approvalBonus(w, voter, mayor.id) > challengerScore);

  voter.approval = { mayor: 0.5, council: 0.5 };
  assert.equal(approvalBonus(w, voter, mayor.id), 0);
  // An older save, from before the city kept a reading at all.
  voter.approval = undefined as unknown as Citizen['approval'];
  assert.equal(approvalBonus(w, voter, mayor.id), 0, 'a voter with no reading has no opinion');
});

test('the office a citizen holds is read by the city, not by them', () => {
  const w = makeWorld();
  const { mayor, councillor } = government(w);
  const plain = makeCitizen(w);
  dailyApproval(w);
  assert.equal(approvalOfOffice(w, mayor.id), cityApproval(w).mayor);
  assert.equal(approvalOfOffice(w, councillor.id), cityApproval(w).council);
  assert.equal(approvalOfOffice(w, plain.id), NEUTRAL);
  assert.equal(approvalOfOffice(w, 'c_nobody'), NEUTRAL);
});

test('a purse that is not a number is no reading at all', () => {
  const w = makeWorld();
  government(w);
  const broken = makeCitizen(w, { wallet: Number.NaN });
  w.counters[`wallet3:${broken.id}`] = 10;
  w.counters[`wallet3Day:${broken.id}`] = w.day - 1;
  assert.equal(approvalOf(w, broken, 'mayor'), NEUTRAL, 'a nonsense situation reads as no opinion, never as NaN');
  dailyApproval(w);
  assert.ok(Number.isFinite(cityApproval(w).mayor));
  assert.ok(Number.isFinite(broken.approval.mayor));
});

test('the daily pass reads the city once and answers as if asked one by one', () => {
  const w = makeWorld();
  const { mayor } = government(w);
  const worker = makeCitizen(w, { name: 'Wren', school: 'commons' });
  employ(w, worker);
  const idler = makeCitizen(w, { name: 'Fen', paper: 'ledger', wallet: 0 });
  const victim = makeCitizen(w, { name: 'Bram' });
  wrong(w, victim);
  const child = makeCitizen(w, { lifeStage: 'child' });
  w.government.incomeTax = 0.4;
  w.counters[`wallet3:${worker.id}`] = 10;
  w.counters[`wallet3Day:${worker.id}`] = w.day - 1;

  const one = new Map(Object.values(w.citizens).map((c) => [c.id, {
    mayor: approvalOf(w, c, 'mayor'), council: approvalOf(w, c, 'council'),
  }]));
  dailyApproval(w);
  for (const c of [mayor, worker, idler, victim, child]) {
    assert.deepEqual(c.approval, one.get(c.id), `${c.name} reads the city the same way either way`);
  }
  assert.ok(victim.approval.council < worker.approval.council);
});
