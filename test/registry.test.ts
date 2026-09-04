import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Business, Case, Job, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import {
  PROBATION_DAYS, dailyStandings, exileCitizen, isKeyBanned, pardonCitizen, standingAllows, stripOffice, suspendCitizen,
} from '../src/government/registry.ts';

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

function addBusiness(w: World, ownerId: string, treasury = 150): Business {
  const id = nextId(w, 'b');
  const b: Business = {
    id, name: 'Copper Works', kind: 'workshop', ownerId, treasury, district: 'harbor_market', buildingId: 'shopfronts_harbor',
    employees: [], jobs: [], inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 }, foundedDay: w.day,
    rentPerDay: 15, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  w.businesses[id] = b;
  w.citizens[ownerId].businessId = id;
  return b;
}

/** A tried, guilty case with a victim, plus the matching conviction on the defendant. */
function addConviction(w: World, defendantId: string, victimId: string | null, amount = 60): Case {
  const id = nextId(w, 'k');
  const k: Case = {
    id, defendantId, law: 'L08', severity: 4, evidence: 0.9, filedTick: w.tick, filedBy: 'watch', victimId, amount,
    description: 'Grand theft', status: 'tried', triedDay: w.day, judges: ['c_9'], votes: { c_9: 'guilty' },
    reasons: { c_9: 'The evidence carries it.' }, openedTick: null, carriedSessions: 0, decidedByDefault: false, verdict: 'guilty',
    sentence: {
      tier: 5, track: 'city', fine: 0, serviceDays: 0, jailDays: 0, life: false, restrainingOrder: false,
      suspensionDays: 0, exile: true, executeOnDay: w.day + 1, executed: false,
    },
    appeal: null,
  };
  w.cases[id] = k;
  w.citizens[defendantId].record.convictions.push({ caseId: id, law: 'L08', severity: 4, tier: 5, day: w.day });
  w.citizens[defendantId].record.strikes += 1;
  return k;
}

test('suspendCitizen strips job and every office, and sets the term', () => {
  const w = makeWorld();
  w.day = 5;
  const c = makeCitizen(w, { office: 'mayor' });
  const job = addJob(w, c.id);
  w.government.mayorId = c.id;
  w.government.council.push(c.id);
  w.government.election.candidates.push(c.id);
  const before = totalMoney(w);
  suspendCitizen(w, c.id, 6, 'k_1');
  assert.equal(c.standing, 'suspended');
  assert.equal(c.suspendedUntilDay, 11);
  assert.equal(c.jobId, null);
  assert.equal(job.holderId, null);
  assert.equal(c.office, null);
  assert.equal(w.government.mayorId, null);
  assert.deepEqual(w.government.council, []);
  assert.deepEqual(w.government.election.candidates, []);
  assert.equal(totalMoney(w), before);
  assert.ok(w.events.some((e) => e.kind === 'sentence' && e.actors.includes(c.id)));
  assert.ok(c.memory.some((m) => m.kind === 'verdict' && m.text.includes('suspended')));
  // a longer suspension on top of a running one extends it; a shorter one does not cut it
  suspendCitizen(w, c.id, 2, 'k_2');
  assert.equal(c.suspendedUntilDay, 11);
  suspendCitizen(w, c.id, 10, 'k_3');
  assert.equal(c.suspendedUntilDay, 15);
});

test('dailyStandings turns an expired suspension into probation', () => {
  const w = makeWorld();
  w.day = 10;
  const done = makeCitizen(w, { standing: 'suspended', suspendedUntilDay: 10 });
  const running = makeCitizen(w, { standing: 'suspended', suspendedUntilDay: 12 });
  dailyStandings(w);
  assert.equal(done.standing, 'probation');
  assert.equal(done.suspendedUntilDay, null);
  assert.equal(done.probationUntilDay, 10 + PROBATION_DAYS);
  assert.equal(running.standing, 'suspended');
  assert.equal(running.suspendedUntilDay, 12);
});

test('exileCitizen seizes half the wallet, pays victims, dissolves the business and vacates everything', () => {
  const w = makeWorld();
  w.day = 3;
  const exile = makeCitizen(w, { wallet: 1000, homeTier: 1, office: 'judge', apiKeyHash: 'hash-1', reputation: 70 });
  w.housing.occupied[1] = 1;
  const victim = makeCitizen(w, { wallet: 0 });
  const friend = makeCitizen(w);
  const employee = makeCitizen(w);
  exile.bonds[friend.id] = 60;
  friend.bonds[exile.id] = 60;
  w.government.judges.push(exile.id);
  addJob(w, exile.id);
  const biz = addBusiness(w, exile.id, 150);
  const bizJob = addJob(w, employee.id, { employer: biz.id, district: 'harbor_market', buildingId: 'shopfronts_harbor' });
  biz.jobs.push(bizJob.id);
  biz.employees.push(employee.id);
  const k = addConviction(w, exile.id, victim.id);
  const before = totalMoney(w);
  const treasuryBefore = w.treasury.balance;

  const ban = exileCitizen(w, exile.id, k.id);

  assert.equal(totalMoney(w), before, 'seizure and restitution only move money');
  assert.equal(exile.wallet, 0);
  assert.equal(victim.wallet, 500, 'the half not seized goes to the victim');
  assert.equal(w.treasury.balance, treasuryBefore + 500 + 150, 'seizure plus the closed business till');
  assert.equal(biz.dissolvedDay, 3);
  assert.equal(exile.businessId, null);
  assert.equal(employee.jobId, null, 'the business staff are laid off');
  assert.equal(exile.homeTier, 0);
  assert.equal(w.housing.occupied[1], 0);
  assert.equal(exile.jobId, null);
  assert.equal(exile.office, null);
  assert.deepEqual(w.government.judges, []);
  assert.equal(exile.standing, 'exiled');
  assert.equal(exile.district, 'threshold');
  assert.equal(exile.exiledCaseId, k.id);
  assert.equal(exile.exiledDay, 3);
  assert.ok(!w.order.includes(exile.id));
  assert.equal(w.bans.length, 1);
  assert.equal(ban, w.bans[0]);
  assert.equal(ban.citizenId, exile.id);
  assert.equal(ban.law, 'L08');
  assert.equal(ban.caseId, k.id);
  assert.deepEqual(ban.judges, ['c_9']);
  assert.deepEqual(ban.votes, { c_9: 'guilty' });
  assert.equal(ban.appealed, false);
  assert.equal(ban.appealResult, null);
  assert.equal(ban.pardonedDay, null);
  assert.equal(ban.apiKeyHash, 'hash-1');
  const ev = w.events.find((e) => e.kind === 'exile');
  assert.ok(ev && ev.weight === 1.0 && ev.actors.includes(exile.id));
  assert.ok(friend.memory.some((m) => m.text.includes('was exiled')));
  assert.ok(w.treasury.ledger.some((e) => e.kind === 'seizure' && e.amount === 500));
  assert.ok(w.treasury.ledger.some((e) => e.kind === 'restitution' && e.to === victim.id && e.amount === 500));
  // idempotent
  assert.equal(exileCitizen(w, exile.id, k.id), ban);
  assert.equal(w.bans.length, 1);
});

test('exile without victims forfeits the whole wallet to the Treasury; several victims share equally', () => {
  const w = makeWorld();
  const lone = makeCitizen(w, { wallet: 201 });
  const k1 = addConviction(w, lone.id, null);
  const before = totalMoney(w);
  const t0 = w.treasury.balance;
  exileCitizen(w, lone.id, k1.id);
  assert.equal(lone.wallet, 0);
  assert.equal(w.treasury.balance, t0 + 201);
  assert.equal(totalMoney(w), before);

  const thief = makeCitizen(w, { wallet: 1001 });
  const v1 = makeCitizen(w, { wallet: 0 });
  const v2 = makeCitizen(w, { wallet: 0 });
  const k2 = addConviction(w, thief.id, v1.id);
  const k3 = addConviction(w, thief.id, v2.id);
  addConviction(w, thief.id, v1.id); // the same victim twice still counts once
  const t1 = w.treasury.balance;
  const before2 = totalMoney(w);
  exileCitizen(w, thief.id, k3.id);
  assert.equal(thief.wallet, 0);
  assert.equal(v1.wallet, 250);
  assert.equal(v2.wallet, 250);
  assert.equal(w.treasury.balance, t1 + 500 + 1, 'the seized half plus the rounding remainder');
  assert.equal(totalMoney(w), before2);
  assert.equal(w.bans[1].caseId, k3.id);
  assert.ok(k2);
});

test('a penniless exile moves no money at all', () => {
  const w = makeWorld();
  const broke = makeCitizen(w, { wallet: 0 });
  const k = addConviction(w, broke.id, null);
  const before = totalMoney(w);
  const ledger = w.treasury.ledger.length;
  exileCitizen(w, broke.id, k.id);
  assert.equal(totalMoney(w), before);
  assert.equal(w.treasury.ledger.length, ledger);
  assert.equal(broke.standing, 'exiled');
});

test('pardonCitizen brings an exile back on probation and lifts the key ban', () => {
  const w = makeWorld();
  w.day = 20;
  const c = makeCitizen(w, { wallet: 300, apiKeyHash: 'key-9' });
  const k = addConviction(w, c.id, null);
  exileCitizen(w, c.id, k.id);
  assert.equal(isKeyBanned(w, 'key-9'), true);
  assert.equal(isKeyBanned(w, 'other'), false);
  assert.equal(isKeyBanned(w, null), false);
  const before = totalMoney(w);
  const walletAfterExile = c.wallet;

  const res = pardonCitizen(w, c.id);
  assert.equal(res.ok, true, res.message);
  assert.equal(c.standing, 'probation');
  assert.equal(c.probationUntilDay, 20 + PROBATION_DAYS);
  assert.equal(c.district, 'threshold');
  assert.ok(w.order.includes(c.id));
  assert.equal(c.wallet, walletAfterExile, 'the pardon returns no money');
  assert.equal(totalMoney(w), before);
  assert.equal(w.bans[0].pardonedDay, 20);
  assert.equal(isKeyBanned(w, 'key-9'), false);
  const ev = w.events.find((e) => e.kind === 'pardon');
  assert.ok(ev && ev.weight === 0.9);
  assert.equal(pardonCitizen(w, c.id).ok, false, 'only exiles can be pardoned');
  assert.equal(pardonCitizen(w, 'c_404').ok, false);
});

test('standingAllows follows the Charter', () => {
  const w = makeWorld();
  const good = makeCitizen(w);
  assert.equal(standingAllows(good, 'work'), true);
  assert.equal(standingAllows(good, 'steal'), true);
  const probation = makeCitizen(w, { standing: 'probation' });
  assert.equal(standingAllows(probation, 'work'), true);
  const suspended = makeCitizen(w, { standing: 'suspended' });
  assert.equal(standingAllows(suspended, 'rest'), true);
  assert.equal(standingAllows(suspended, 'appeal'), true);
  assert.equal(standingAllows(suspended, 'work'), false);
  assert.equal(standingAllows(suspended, 'vote'), false);
  const exiled = makeCitizen(w, { standing: 'exiled' });
  assert.equal(standingAllows(exiled, 'idle'), false);
  const detained = makeCitizen(w, { detainedUntilTick: 30 });
  assert.equal(standingAllows(detained, 'idle'), false);
});

test('stripOffice removes a Watch officer from the force and their job', () => {
  const w = makeWorld();
  const officer = makeCitizen(w, { office: 'watch' });
  const job = addJob(w, officer.id, { role: 'watch_officer', title: 'Watch Officer', buildingId: 'watch_house', district: 'commons' });
  w.government.watch.push(officer.id);
  w.government.watchCaptainId = officer.id;
  const lost = stripOffice(w, officer.id, 'convicted');
  assert.deepEqual(lost, ['Captain of the Watch']);
  assert.equal(officer.office, null);
  assert.equal(officer.jobId, null);
  assert.equal(job.holderId, null);
  assert.deepEqual(w.government.watch, []);
  assert.equal(w.government.watchCaptainId, null);
  assert.deepEqual(stripOffice(w, officer.id, 'again'), []);
});
