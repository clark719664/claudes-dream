import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Business, Case, Citizen, Job, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import { commitOffence } from '../src/government/watch.ts';
import { fileReport } from '../src/government/reports.ts';
import {
  computeSentence, dailyJustice, decideAppeals, executeSentence, fileAppeal, fileCharge, holdCourt, judgeBelief,
  latestCaseFor, nextCourtTick, pendingCasesFor, selectBench,
} from '../src/government/court.ts';

function addJudge(w: World, overrides: Parameters<typeof makeCitizen>[1] = {}): Citizen {
  const j = makeCitizen(w, { office: 'judge', reputation: 80, judgeTermEndsDay: w.day + 56, ...overrides });
  j.personality.honesty = 1;
  w.government.judges.push(j.id);
  return j;
}

function seatCouncil(w: World, members: Citizen[]): void {
  w.government.council = members.map((m) => m.id);
  w.government.mayorId = members[0]?.id ?? null;
  members.forEach((m, i) => { m.office = i === 0 ? 'mayor' : 'councillor'; });
}

/** An officer of the Watch, who is the one who decides whether a report becomes a charge. */
function addOfficer(w: World, overrides: Parameters<typeof makeCitizen>[1] = {}): Citizen {
  const c = makeCitizen(w, { office: 'watch', ...overrides });
  w.government.watch.push(c.id);
  return c;
}

function addJob(w: World, holderId: string | null = null, overrides: Partial<Job> = {}): Job {
  const id = nextId(w, 'j');
  const job: Job = {
    id, role: 'fabricator', title: 'Fabricator', employer: 'city', buildingId: 'fabrication_works', district: 'foundry_row',
    skill: 'crafting', minSkill: 0, minReputation: 0, wage: 15, output: {}, holderId, createdDay: w.day, ...overrides,
  };
  w.jobs[id] = job;
  if (holderId) w.citizens[holderId].jobId = id;
  return job;
}

function addBusiness(w: World, ownerId: string, treasury = 120): Business {
  const id = nextId(w, 'b');
  const b: Business = {
    id, name: 'Glass Works', kind: 'workshop', ownerId, treasury, district: 'harbor_market', buildingId: 'shopfronts_harbor',
    employees: [], jobs: [], inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 }, foundedDay: w.day,
    rentPerDay: 15, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  w.businesses[id] = b;
  w.citizens[ownerId].businessId = id;
  return b;
}

/** A world at the court hour with three impartial judges. */
function courtWorld(): World {
  const w = makeWorld();
  w.day = 2; w.hour = 10; w.tick = 2 * 24 + 10;
  addJudge(w); addJudge(w); addJudge(w);
  return w;
}

test('fileCharge records the case and detains only for strong, serious charges', () => {
  const w = makeWorld();
  w.day = 1; w.hour = 12; w.tick = 36;
  const d = makeCitizen(w);
  w.government.lawSeverity.L04 = 3;
  const k = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 0.9, filedBy: 'watch', amount: 30, description: 'took 30' });
  assert.equal(w.cases[k.id], k);
  assert.equal(k.severity, 3, 'severity comes from the Council\'s table');
  assert.equal(k.status, 'pending');
  assert.equal(k.filedTick, 36);
  assert.equal(d.detainedUntilTick, null, 'severity 3 is not detained');
  assert.ok(w.events.some((e) => e.kind === 'charge' && e.weight === 0.4));
  assert.ok(d.memory.some((m) => m.kind === 'crime' && m.text.includes(k.id)));

  const k2 = fileCharge(w, { defendantId: d.id, law: 'L08', evidence: 0.5, filedBy: 'watch', description: 'grand theft' });
  assert.equal(d.detainedUntilTick, nextCourtTick(w));
  assert.equal(nextCourtTick(w), 2 * 24 + 10, 'after today\'s sitting, the next is tomorrow');
  assert.ok(w.events.some((e) => e.kind === 'charge' && e.weight === 0.7));
  const weak = makeCitizen(w);
  fileCharge(w, { defendantId: weak.id, law: 'L08', evidence: 0.4, filedBy: 'watch', description: 'rumour' });
  assert.equal(weak.detainedUntilTick, null, 'weak evidence does not detain');
  assert.deepEqual(pendingCasesFor(w, d.id).map((x) => x.id), [k.id, k2.id]);
  assert.equal(latestCaseFor(w, d.id), k2);
  assert.equal(latestCaseFor(w, 'c_404'), null);
  assert.throws(() => fileCharge(w, { defendantId: 'c_404', law: 'L04', evidence: 1, filedBy: 'watch', description: 'x' }));
});

test('selectBench recuses friends, accusers, victims and employers, drawing temporaries when short', () => {
  const w = courtWorld();
  const [a, b, c] = w.government.judges;
  const d = makeCitizen(w);
  const victim = makeCitizen(w);
  w.citizens[a].bonds[d.id] = 50; // judge A is the defendant's friend
  const k = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 0.8, filedBy: 'watch', victimId: victim.id, description: 'theft' });
  assert.deepEqual(selectBench(w, k), [b, c], 'the friend steps aside; two judges suffice');

  // judge B is the accuser: only C remains → temporaries fill the bench to three
  const k2 = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 0.8, filedBy: b, description: 'theft' });
  const upstanding = makeCitizen(w, { reputation: 70 });
  const upstanding2 = makeCitizen(w, { reputation: 65 });
  const tarnished = makeCitizen(w, { reputation: 70 });
  tarnished.record.convictions.push({ caseId: 'k_0', law: 'L01', severity: 1, tier: 1, day: 0 });
  const official = makeCitizen(w, { reputation: 90, office: 'councillor' });
  const lowRep = makeCitizen(w, { reputation: 50 });
  const bench = selectBench(w, k2);
  assert.equal(bench.length, 3);
  assert.ok(bench.includes(c));
  assert.ok(bench.includes(upstanding.id) && bench.includes(upstanding2.id));
  assert.ok(!bench.includes(tarnished.id) && !bench.includes(official.id) && !bench.includes(lowRep.id));
  // with only one eligible temporary the bench sits with two; the low-reputation pool is not touched
  w.order = w.order.filter((id) => id !== upstanding2.id);
  const k2b = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 0.8, filedBy: b, description: 'theft' });
  assert.deepEqual(selectBench(w, k2b).sort(), [c, upstanding.id].sort());
  w.order.push(upstanding2.id);
  assert.ok(!bench.includes(victim.id) && !bench.includes(d.id) && !bench.includes(a));

  // the defendant's employer must recuse
  const biz = addBusiness(w, w.citizens[c].id);
  addJob(w, d.id, { employer: biz.id });
  const k3 = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 0.8, filedBy: 'watch', description: 'theft' });
  assert.ok(!selectBench(w, k3).includes(c));
  // a judge who is the victim recuses
  const k4 = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 0.8, filedBy: 'watch', victimId: b, description: 'theft' });
  assert.ok(!selectBench(w, k4).includes(b));
  // and no child is ever drawn by lot: children are neither charged nor judges
  const infant = makeCitizen(w, { reputation: 95, lifeStage: 'child' });
  const k5 = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 0.8, filedBy: b, description: 'theft' });
  assert.ok(!selectBench(w, k5).includes(infant.id));
});

test('judgeBelief weighs evidence, record, reputation and friendship', () => {
  const w = courtWorld();
  const judge = w.government.judges[0];
  const d = makeCitizen(w, { reputation: 50 });
  const k = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 1, filedBy: 'watch', description: 'x' });
  assert.ok(judgeBelief(w, judge, k) > 0.8);
  const saint = makeCitizen(w, { reputation: 100 });
  const weak = fileCharge(w, { defendantId: saint.id, law: 'L04', evidence: 0.1, filedBy: 'watch', description: 'x' });
  assert.ok(judgeBelief(w, judge, weak) < 0.4);
  // a friend on the bench sees the case more kindly (average over the noise)
  const avg = (bond: number) => {
    w.citizens[judge].bonds[d.id] = bond;
    let s = 0;
    for (let i = 0; i < 40; i++) s += judgeBelief(w, judge, k);
    return s / 40;
  };
  assert.ok(avg(0) - avg(100) > 0.15);
  // prior convictions count against you
  d.record.convictions.push({ caseId: 'k_0', law: 'L01', severity: 1, tier: 1, day: 0 });
  assert.ok(avg(0) > 1.1);
});

test('offence → report → charge → trial → conviction → fine, with restitution and money conserved', () => {
  const w = courtWorld();
  const judges = w.government.judges;
  const officer = addOfficer(w, { district: 'harbor_market' });
  const thief = makeCitizen(w, { wallet: 200, reputation: 50, district: 'harbor_market' });
  const victim = makeCitizen(w, { wallet: 100, district: 'harbor_market' });
  const before = totalMoney(w);
  let r = commitOffence(w, thief.id, 'L04', { victimId: victim.id, amount: 30, visibilityMod: 5 });
  for (let i = 0; !r.detected && i < 100; i++) r = commitOffence(w, thief.id, 'L04', { victimId: victim.id, amount: 30, visibilityMod: 5 });
  assert.ok(r.detected && r.reportId);
  // What the Watch saw is a report before its officer; it is the officer who charges it.
  const report = w.reports[r.reportId];
  assert.equal(report.officerId, officer.id);
  assert.equal(report.status, 'open');
  assert.equal(Object.keys(w.cases).length, 0, 'nothing reaches the Court until an officer files it');
  report.evidence = 1; // the Watch caught them red-handed
  assert.equal(fileReport(w, officer.id, report.id).ok, true);
  assert.equal(report.status, 'filed');
  const k = w.cases[report.filedCaseId!];
  assert.equal(k.filedBy, officer.id);
  const treasuryBefore = w.treasury.balance;

  holdCourt(w);
  assert.equal(k.status, 'tried');
  assert.equal(k.verdict, 'guilty');
  assert.equal(k.triedDay, 2);
  assert.deepEqual(k.judges, judges);
  assert.ok(judges.every((j) => k.votes[j] === 'guilty'));
  assert.ok(judges.every((j) => typeof k.reasons[j] === 'string' && k.reasons[j].length > 0), 'every judge gives a reason');
  assert.equal(k.carriedSessions, 0);
  assert.equal(k.decidedByDefault, false);
  assert.ok(k.sentence);
  assert.equal(k.sentence.tier, 2, 'severity 2, no record');
  assert.equal(k.sentence.fine, 40, 'max(20, 10% × severity × wallet)');
  assert.equal(k.sentence.executed, true);
  assert.equal(thief.wallet, 160);
  assert.equal(victim.wallet, 130, 'restitution of the 30 ℓ taken');
  assert.equal(w.treasury.balance, treasuryBefore + 40 - 30);
  assert.equal(totalMoney(w), before, 'fines and restitution only move money');
  assert.equal(thief.record.convictions.length, 1);
  assert.equal(thief.record.convictions[0].caseId, k.id);
  assert.equal(thief.record.strikes, 0);
  assert.equal(thief.reputation, 40, '−5 per point of severity');
  assert.equal(thief.detainedUntilTick, null);
  assert.ok(judges.every((j) => w.citizens[j].reputation === 81), 'judges gain a point per case');
  const line = w.events.find((e) => e.kind === 'verdict' && e.weight === 0.5 && e.actors.includes(thief.id));
  assert.ok(line, 'the Chronicle prints the verdict');
  assert.ok(line.text.includes('3–0'), line.text);
  for (const j of judges) assert.ok(line.text.includes(`${w.citizens[j].name} guilty`), `the line names how ${j} voted: ${line.text}`);
  assert.ok(thief.memory.some((m) => m.kind === 'verdict' && m.text.includes('guilty')));
  assert.ok(victim.memory.some((m) => m.kind === 'verdict' && m.text.includes('convicted')));
  assert.ok(judges.every((j) => w.citizens[j].memory.some((m) => m.kind === 'verdict')));
  assert.equal(w.counters[`finePaid:${k.id}`], 40);
});

test('an acquittal closes the case, releases the defendant and leaves no record', () => {
  const w = courtWorld();
  const d = makeCitizen(w, { reputation: 100, wallet: 100 });
  const k = fileCharge(w, { defendantId: d.id, law: 'L08', evidence: 0.5, filedBy: 'watch', description: 'x' });
  k.evidence = 0.1;
  const before = totalMoney(w);
  holdCourt(w);
  assert.equal(k.status, 'closed');
  assert.equal(k.verdict, 'acquitted');
  assert.equal(k.sentence, null);
  assert.equal(d.record.convictions.length, 0);
  assert.equal(d.wallet, 100);
  assert.equal(d.detainedUntilTick, null);
  assert.equal(totalMoney(w), before);
  assert.equal(fileAppeal(w, d.id).ok, false, 'nothing to appeal');
});

test('a severity-5 offence means exile, executed only after the appeal window', () => {
  const w = courtWorld();
  const saboteur = makeCitizen(w, { wallet: 1000, reputation: 50, homeTier: 1 });
  w.housing.occupied[1] = 1;
  const biz = addBusiness(w, saboteur.id, 120);
  w.hour = 9; w.tick = 2 * 24 + 9;
  const k = fileCharge(w, { defendantId: saboteur.id, law: 'L13', evidence: 1, filedBy: 'watch', description: 'sabotage of the Power Station' });
  assert.equal(saboteur.detainedUntilTick, 2 * 24 + 10, 'held until the Court sits');
  const before = totalMoney(w);

  w.hour = 10; w.tick = 2 * 24 + 10;
  holdCourt(w);
  assert.equal(k.verdict, 'guilty');
  assert.equal(k.status, 'tried');
  assert.ok(k.sentence?.exile);
  assert.equal(k.sentence?.tier, 5);
  assert.equal(k.sentence?.executeOnDay, 3);
  assert.equal(k.sentence?.executed, false);
  assert.equal(saboteur.standing, 'good', 'not yet: the appeal window is open');
  assert.equal(saboteur.detainedUntilTick, null, 'free to file an appeal');
  assert.equal(saboteur.wallet, 1000);
  assert.ok(w.events.some((e) => e.kind === 'verdict' && e.weight === 0.9));

  dailyJustice(w);
  assert.equal(saboteur.standing, 'good', 'still day 2');
  w.day = 3; w.hour = 0; w.tick = 72;
  const treasuryBefore = w.treasury.balance;
  dailyJustice(w);
  assert.equal(saboteur.standing, 'exiled');
  assert.equal(k.status, 'closed');
  assert.equal(k.sentence?.executed, true);
  assert.equal(saboteur.wallet, 0);
  assert.equal(w.treasury.balance, treasuryBefore + 1000 + 120, 'no victims: the whole wallet, plus the business till');
  assert.equal(biz.dissolvedDay, 3);
  assert.equal(saboteur.homeTier, 0);
  assert.equal(w.housing.occupied[1], 0);
  assert.ok(!w.order.includes(saboteur.id));
  assert.equal(totalMoney(w), before);
  assert.equal(w.bans.length, 1);
  const ban = w.bans[0];
  assert.equal(ban.caseId, k.id);
  assert.equal(ban.law, 'L13');
  assert.deepEqual(ban.judges, w.government.judges);
  assert.deepEqual(ban.votes, k.votes);
  assert.equal(ban.appealed, false);
  assert.equal(saboteur.record.convictions.length, 1);
  assert.equal(saboteur.record.strikes, 1);
  assert.ok(w.events.some((e) => e.kind === 'exile' && e.weight === 1.0));
});

test('an appeal can reduce an exile to a 15-day suspension', () => {
  const w = courtWorld();
  const d = makeCitizen(w, { wallet: 400, reputation: 50 });
  addJob(w, d.id);
  const council = [1, 2, 3, 4, 5].map(() => makeCitizen(w, { reputation: 60 }));
  seatCouncil(w, council);
  for (const m of council) m.bonds[d.id] = 50; // friends, but not devoted ones
  const k = fileCharge(w, { defendantId: d.id, law: 'L15', evidence: 1, filedBy: 'watch', description: 'extortion' });
  holdCourt(w);
  assert.ok(k.sentence?.exile);
  const before = totalMoney(w);

  w.hour = 14; w.tick = 2 * 24 + 14;
  const res = fileAppeal(w, d.id);
  assert.equal(res.ok, true, res.message);
  assert.equal(k.status, 'appealed');
  assert.equal(k.appeal?.filedDay, 2);
  assert.equal(fileAppeal(w, d.id).ok, false, 'one appeal per conviction');
  assert.ok(w.events.some((e) => e.kind === 'appeal' && e.weight === 0.5));

  w.day = 3; w.hour = 0; w.tick = 72;
  dailyJustice(w);
  assert.equal(d.standing, 'good', 'a pending appeal stays the exile');
  w.hour = 14; w.tick = 72 + 14;
  decideAppeals(w);
  assert.equal(k.status, 'closed');
  assert.equal(k.appeal?.result, 'reduced');
  assert.equal(k.appeal?.decidedDay, 3);
  assert.ok(council.every((m) => k.appeal?.votes[m.id] === 'reduced'));
  assert.equal(k.sentence?.exile, false);
  assert.equal(k.sentence?.tier, 4);
  assert.equal(k.sentence?.suspensionDays, 15);
  assert.equal(k.sentence?.executed, true);
  assert.equal(d.standing, 'suspended');
  assert.equal(d.suspendedUntilDay, 18);
  assert.equal(d.jobId, null, 'suspension costs the job');
  assert.equal(d.wallet, 400 - k.sentence!.fine);
  assert.equal(totalMoney(w), before);
  assert.equal(w.bans.length, 0, 'no ban record: the exile was cancelled');
  assert.ok(w.order.includes(d.id));
  assert.equal(d.record.convictions.length, 1);
  assert.equal(d.record.convictions[0].tier, 4);
  w.day = 4; w.hour = 0; w.tick = 96;
  dailyJustice(w);
  assert.equal(d.standing, 'suspended', 'the reduced sentence is what stands');
  assert.ok(w.events.some((e) => e.kind === 'appeal' && e.weight === 0.7));
});

test('an overturned appeal refunds the fine and restores standing; an upheld one executes the exile', () => {
  const w = courtWorld();
  const d = makeCitizen(w, { wallet: 300, reputation: 50 });
  const council = [1, 2, 3].map(() => makeCitizen(w, { reputation: 60 }));
  seatCouncil(w, council);
  for (const m of council) m.bonds[d.id] = 80; // devoted friends overturn
  const k = fileCharge(w, { defendantId: d.id, law: 'L08', evidence: 1, filedBy: 'watch', description: 'grand theft' });
  holdCourt(w);
  assert.equal(k.sentence?.tier, 4);
  assert.equal(d.standing, 'suspended');
  const fine = k.sentence!.fine;
  assert.equal(d.wallet, 300 - fine);
  const before = totalMoney(w);
  assert.equal(fileAppeal(w, d.id).ok, true);
  w.day = 3; w.tick = 72 + 14; w.hour = 14;
  decideAppeals(w);
  assert.equal(k.appeal?.result, 'overturned');
  assert.equal(d.wallet, 300, 'fine refunded');
  assert.equal(d.standing, 'good');
  assert.equal(d.record.convictions.length, 0);
  assert.equal(d.reputation, 50, 'reputation restored');
  assert.equal(totalMoney(w), before);
  assert.equal(w.counters[`finePaid:${k.id}`], undefined);

  // a Council of victims and hardliners upholds an exile, which is then carried out at once
  const w2 = courtWorld();
  const d2 = makeCitizen(w2, { wallet: 100 });
  const hard = [1, 2, 3].map(() => makeCitizen(w2, { platform: { tax: 0.5, dividend: 0.5, minWage: 0.5, strictness: 0.9 } }));
  seatCouncil(w2, hard);
  const k2 = fileCharge(w2, { defendantId: d2.id, law: 'L13', evidence: 1, filedBy: 'watch', victimId: hard[0].id, description: 'sabotage' });
  const before2 = totalMoney(w2);
  holdCourt(w2);
  assert.equal(fileAppeal(w2, d2.id).ok, true);
  w2.day = 3; w2.tick = 72 + 14; w2.hour = 14;
  decideAppeals(w2);
  assert.equal(k2.appeal?.result, 'upheld');
  assert.equal(d2.standing, 'exiled');
  assert.equal(k2.status, 'closed');
  assert.equal(w2.bans.length, 1);
  assert.equal(w2.bans[0].appealed, true);
  assert.equal(w2.bans[0].appealResult, 'upheld');
  assert.equal(hard[0].wallet, 200 + 50, 'the victim receives the unseized half');
  assert.equal(totalMoney(w2), before2, 'exile moved money, it did not create any');
});

test('the appeal window is one day', () => {
  const w = courtWorld();
  const d = makeCitizen(w);
  const k = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 1, filedBy: 'watch', description: 'x' });
  holdCourt(w);
  assert.equal(k.verdict, 'guilty');
  w.day = 3;
  assert.equal(fileAppeal(w, d.id).ok, true, 'the day after is still in the window');
  const d2 = makeCitizen(w);
  const k2 = fileCharge(w, { defendantId: d2.id, law: 'L04', evidence: 1, filedBy: 'watch', description: 'x' });
  holdCourt(w);
  assert.equal(k2.verdict, 'guilty');
  w.day = 5; w.tick = 120;
  dailyJustice(w);
  assert.equal(k2.status, 'closed', 'stale convictions are closed');
  assert.equal(fileAppeal(w, d2.id).ok, false);
});

test('computeSentence escalates with the record, suspension and strikes', () => {
  const w = courtWorld();
  const d = makeCitizen(w, { wallet: 100 });
  const k = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 1, filedBy: 'watch', description: 'x' });
  assert.equal(computeSentence(w, k).tier, 2);
  assert.equal(computeSentence(w, k).fine, 20, 'fines floor at 20 ℓ');
  d.record.convictions.push({ caseId: 'k_a', law: 'L03', severity: 2, tier: 2, day: 0 });
  assert.equal(computeSentence(w, k).tier, 3);
  assert.equal(computeSentence(w, k).serviceDays, 2);
  d.record.convictions.push({ caseId: 'k_b', law: 'L04', severity: 2, tier: 3, day: 1 });
  d.record.convictions.push({ caseId: 'k_c', law: 'L04', severity: 2, tier: 3, day: 1 });
  const s4 = computeSentence(w, k);
  assert.equal(s4.tier, 4, 'at most two steps of escalation');
  assert.equal(s4.suspensionDays, 6);
  d.standing = 'suspended';
  assert.equal(computeSentence(w, k).exile, true, 'convicted while suspended');
  d.standing = 'good';
  d.record.convictions = [
    { caseId: 'k_x', law: 'L05', severity: 3, tier: 3, day: 0 },
    { caseId: 'k_y', law: 'L06', severity: 3, tier: 4, day: 1 },
  ];
  assert.equal(computeSentence(w, k).exile, false, 'two strikes but a minor offence');
  const serious = fileCharge(w, { defendantId: d.id, law: 'L05', evidence: 1, filedBy: 'watch', description: 'x' });
  assert.equal(computeSentence(w, serious).exile, true, 'third strike');
});

test('office holders convicted of severity ≥ 3 lose office; unpaid fines are owed, then Contempt', () => {
  const w = courtWorld();
  const councillor = makeCitizen(w, { office: 'councillor', wallet: 5 });
  w.government.council.push(councillor.id);
  const k = fileCharge(w, { defendantId: councillor.id, law: 'L06', evidence: 1, filedBy: 'watch', description: 'vandalism' });
  const before = totalMoney(w);
  holdCourt(w);
  assert.equal(k.sentence?.tier, 3);
  assert.equal(councillor.office, null);
  assert.ok(!w.government.council.includes(councillor.id));
  assert.equal(councillor.wallet, 0);
  assert.equal(councillor.finesOwed, 15, 'the 20 ℓ fine minus the 5 ℓ they had');
  assert.equal(councillor.finesOwedSinceDay, 2);
  assert.equal(councillor.communityServiceDaysLeft, 3);
  assert.equal(totalMoney(w), before);

  // days pass without a lumen: the fine stays owed and Contempt follows once
  w.government.dividend = 0;
  w.day = 3; w.tick = 72;
  dailyJustice(w);
  assert.equal(pendingCasesFor(w, councillor.id).length, 0);
  assert.equal(councillor.communityServiceDaysLeft, 2);
  w.day = 4; w.tick = 96;
  dailyJustice(w);
  const contempt = pendingCasesFor(w, councillor.id);
  assert.equal(contempt.length, 1);
  assert.equal(contempt[0].law, 'L10');
  assert.equal(contempt[0].evidence, 1);
  w.day = 5; w.tick = 120;
  dailyJustice(w);
  assert.equal(pendingCasesFor(w, councillor.id).length, 1, 'charged once per case');
  // money arrives: the debt is collected
  councillor.wallet = 10;
  w.day = 6; w.tick = 144;
  const b2 = totalMoney(w);
  dailyJustice(w);
  assert.equal(councillor.wallet, 0);
  assert.equal(councillor.finesOwed, 5);
  assert.equal(totalMoney(w), b2);
});

test('community service forfeits half the dividend and judges retire at the end of their term', () => {
  const w = courtWorld();
  const c = makeCitizen(w, { wallet: 50, communityServiceDaysLeft: 1 });
  const retiring = w.citizens[w.government.judges[0]];
  retiring.judgeTermEndsDay = 2;
  const before = totalMoney(w);
  dailyJustice(w);
  assert.equal(c.communityServiceDaysLeft, 0);
  assert.equal(c.wallet, 50 - Math.round(w.government.dividend / 2));
  assert.equal(totalMoney(w), before);
  assert.ok(c.memory.some((m) => m.text.includes('completed')));
  assert.ok(!w.government.judges.includes(retiring.id));
  assert.equal(retiring.office, null);
  assert.equal(w.government.judges.length, 2);
});

test('executeSentence is idempotent and a defendant who has left the city is not tried', () => {
  const w = courtWorld();
  const d = makeCitizen(w, { wallet: 100 });
  const k = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 1, filedBy: 'watch', description: 'x' });
  holdCourt(w);
  const wallet = d.wallet;
  executeSentence(w, k);
  assert.equal(d.wallet, wallet);
  assert.equal(d.record.convictions.length, 1);

  const gone = makeCitizen(w, { standing: 'exiled' });
  w.order = w.order.filter((id) => id !== gone.id);
  const k2 = fileCharge(w, { defendantId: gone.id, law: 'L04', evidence: 1, filedBy: 'watch', description: 'x' });
  holdCourt(w);
  assert.equal(k2.status, 'closed');
  assert.equal(k2.verdict, null);
});

test('with no judges at all, temporary judges are drawn by lot so justice still runs', () => {
  const w = makeWorld();
  w.day = 1; w.hour = 10; w.tick = 34;
  const d = makeCitizen(w, { reputation: 50 });
  for (let i = 0; i < 4; i++) makeCitizen(w, { reputation: 70 });
  const k = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 1, filedBy: 'watch', description: 'x' });
  holdCourt(w);
  assert.equal(k.status, 'tried');
  assert.equal(k.judges.length, 3);
  assert.ok(k.judges.every((j) => j !== d.id && w.citizens[j].office === null));
  assert.equal(k.verdict, 'guilty');
});

test('when nobody can sit the case is held over, not dropped', () => {
  const w = makeWorld();
  w.day = 1; w.hour = 10; w.tick = 34;
  const d = makeCitizen(w);
  const k: Case = fileCharge(w, { defendantId: d.id, law: 'L04', evidence: 1, filedBy: 'watch', description: 'x' });
  holdCourt(w);
  assert.equal(k.status, 'pending');
  assert.ok(w.events.some((e) => e.kind === 'law' && e.text.includes('No judge')));
});

test('with no Council seated an appeal is held over, then reviewed by the Court on the evidence', () => {
  const w = courtWorld();
  const d = makeCitizen(w, { wallet: 100 });
  const k = fileCharge(w, { defendantId: d.id, law: 'L13', evidence: 0.9, filedBy: 'watch', description: 'sabotage' });
  holdCourt(w);
  assert.ok(k.sentence?.exile);
  assert.equal(fileAppeal(w, d.id).ok, true);
  for (let day = 3; day < 9; day++) {
    w.day = day; w.tick = day * 24 + 14; w.hour = 14;
    dailyJustice(w);
    decideAppeals(w);
    assert.equal(k.status, 'appealed', `day ${day}: nobody to hear it yet`);
    assert.equal(d.standing, 'good');
  }
  assert.ok(w.events.some((e) => e.kind === 'appeal' && e.text.includes('held over')));
  w.day = 9; w.tick = 9 * 24 + 14;
  decideAppeals(w);
  assert.equal(k.status, 'closed');
  assert.equal(k.appeal?.result, 'upheld', 'strong evidence: the Court upholds');
  assert.equal(d.standing, 'exiled');
  assert.deepEqual(k.appeal?.votes, {});
  // weak evidence is reduced instead
  const w2 = courtWorld();
  const d2 = makeCitizen(w2, { wallet: 100 });
  const k2 = fileCharge(w2, { defendantId: d2.id, law: 'L13', evidence: 0.5, filedBy: 'watch', description: 'sabotage' });
  holdCourt(w2);
  if (k2.verdict === 'guilty') {
    assert.equal(fileAppeal(w2, d2.id).ok, true);
    w2.day = 9; w2.tick = 9 * 24 + 14;
    decideAppeals(w2);
    assert.equal(k2.appeal?.result, 'reduced');
    assert.equal(d2.standing, 'suspended');
  }
});
