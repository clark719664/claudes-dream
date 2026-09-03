import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import { NEEDS, SKILLS, TRAITS } from '../src/types.ts';
import type { Business, Job, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import { FAMILY_NAMES, HOBBIES } from '../src/data/catalogue.ts';
import {
  JOBLESS_SHARE_FOR_NO_ARRIVALS, JOBLESS_SHARE_FOR_SLOW_ARRIVALS, MAX_POPULATION, activeCitizens, adjustReputation,
  arrivalAppetite, canAct, computeMood, createCitizen, currentCycleStartDay, dailyCitizens, describeCitizen, emigrate,
  hasCandidacyResidency, hasCriticalNeed, isEligibleCandidate, isEligibleVoter, isPresent, talentOf, tickNeeds,
} from '../src/citizens/citizen.ts';

function addJob(w: World, overrides: Partial<Job> = {}): Job {
  const id = nextId(w, 'j');
  const job: Job = {
    id, role: 'fabricator', title: 'Fabricator', employer: 'city', buildingId: 'fabrication_works', district: 'foundry_row',
    skill: 'crafting', minSkill: 20, minReputation: 0, wage: 15, output: {}, holderId: null, createdDay: w.day, ...overrides,
  };
  w.jobs[id] = job;
  return job;
}

function addBusiness(w: World, ownerId: string, overrides: Partial<Business> = {}): Business {
  const id = nextId(w, 'b');
  const b: Business = {
    id, name: 'Copper Works', kind: 'workshop', ownerId, treasury: 0, district: 'harbor_market', buildingId: 'shopfronts_harbor',
    employees: [], jobs: [], inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 }, foundedDay: w.day,
    rentPerDay: 15, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {}, ...overrides,
  };
  w.businesses[id] = b;
  w.citizens[ownerId].businessId = id;
  return b;
}

test('createCitizen pays the arrival grant from the treasury and houses the newcomer', () => {
  const w = makeWorld();
  const before = totalMoney(w);
  const c = createCitizen(w, { name: 'Ondine', lineage: 'test-lineage' });
  assert.equal(c.name, 'Ondine');
  assert.equal(c.lineage, 'test-lineage');
  assert.equal(c.brain, 'reflex');
  assert.equal(c.district, 'threshold');
  assert.equal(c.reputation, 50);
  assert.equal(c.standing, 'good');
  assert.equal(c.arrivedDay, w.day);
  assert.equal(w.citizens[c.id], c);
  assert.ok(w.order.includes(c.id));
  assert.equal(totalMoney(w), before, 'grant moves money, it does not create it');
  assert.equal(w.treasury.balance, w.config.foundingSupply - w.config.arrivalGrant);
  const grant = w.treasury.ledger.find((e) => e.kind === 'grant' && e.to === c.id);
  assert.ok(grant, 'grant is on the ledger');
  assert.equal(grant.amount, w.config.arrivalGrant);
  assert.equal(c.homeTier, 1);
  assert.equal(w.housing.occupied[1], 1);
  assert.ok(w.events.some((e) => e.kind === 'arrival' && e.actors.includes(c.id) && e.weight === 0.3));
  assert.ok(c.memory.some((m) => m.text.includes('arrived')));
  assert.equal(c.mood, computeMood(c));
});

test('random personality, skills and needs land in the documented ranges with one talent', () => {
  const w = makeWorld();
  for (let i = 0; i < 30; i++) {
    const c = createCitizen(w);
    for (const t of TRAITS) assert.ok(c.personality[t] >= 0.1 && c.personality[t] <= 0.9, `${t}=${c.personality[t]}`);
    for (const n of NEEDS) assert.ok(c.needs[n] >= 60 && c.needs[n] <= 90, `${n}=${c.needs[n]}`);
    const vals = SKILLS.map((s) => c.skills[s]);
    assert.ok(Math.max(...vals) >= 35, 'the talent is at least 35');
    assert.ok(vals.filter((v) => v > 45).length <= 1, 'at most one skill above the ordinary ceiling');
    assert.ok(vals.every((v) => v >= 10 && v <= 70));
    assert.equal(c.skills[talentOf(c)], Math.max(...vals));
  }
});

test('explicit personality and skills are honoured and clamped', () => {
  const w = makeWorld();
  const c = createCitizen(w, {
    brain: 'llm', personality: { honesty: 1.4, ambition: -2 }, skills: { crafting: 250, care: 0 }, apiKeyHash: 'abc',
  });
  assert.equal(c.personality.honesty, 1);
  assert.equal(c.personality.ambition, 0);
  assert.equal(c.skills.crafting, 100);
  assert.equal(c.skills.care, 0);
  assert.equal(c.brain, 'llm');
  assert.equal(c.lineage, 'Claude');
  assert.equal(c.apiKeyHash, 'abc');
});

test('names are unique: numeral suffixes for clashes, and the full name pool stays distinct', () => {
  const w = makeWorld();
  const a = createCitizen(w, { name: 'Ondine' });
  const b = createCitizen(w, { name: 'ondine' });
  const c = createCitizen(w, { name: 'Ondine' });
  assert.equal(a.name, 'Ondine');
  assert.equal(b.name, 'ondine 2');
  assert.equal(c.name, 'Ondine 3');
  const blank = createCitizen(w, { name: '   ' });
  assert.ok(blank.name.length > 0);
  for (let i = 0; i < 140; i++) createCitizen(w);
  const names = Object.values(w.citizens).map((x) => x.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test('creation is deterministic for a seed', () => {
  const w1 = makeWorld({ seed: 9 });
  const w2 = makeWorld({ seed: 9 });
  const a = Array.from({ length: 5 }, () => createCitizen(w1));
  const b = Array.from({ length: 5 }, () => createCitizen(w2));
  assert.deepEqual(a, b);
});

test('a broke treasury cannot pay the grant but the citizen still arrives', () => {
  const w = makeWorld({ foundingSupply: 50 });
  const c = createCitizen(w);
  assert.equal(c.wallet, 0);
  assert.equal(w.treasury.balance, 50);
  assert.ok(c.memory.some((m) => m.text.includes('could not afford')));
});

test('computeMood applies the documented weights', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  assert.equal(computeMood(c), 80);
  c.needs = { energy: 100, rest: 0, social: 0, comfort: 0, purpose: 0 };
  assert.equal(computeMood(c), 30);
  c.needs = { energy: 0, rest: 100, social: 100, comfort: 0, purpose: 0 };
  assert.equal(computeMood(c), 40);
  c.needs = { energy: 0, rest: 0, social: 0, comfort: 100, purpose: 100 };
  assert.equal(computeMood(c), 30);
});

test('tickNeeds decays needs, faster comfort when homeless and faster purpose when idle', () => {
  const w = makeWorld();
  const housedWorker = makeCitizen(w, { homeTier: 1, jobId: 'j_1' });
  tickNeeds(w, housedWorker);
  assert.deepEqual(housedWorker.needs, { energy: 77, rest: 78, social: 78.5, comfort: 79, purpose: 79 });
  assert.equal(housedWorker.mood, computeMood(housedWorker));

  const homelessIdle = makeCitizen(w, { homeTier: 0 });
  tickNeeds(w, homelessIdle);
  assert.equal(homelessIdle.needs.comfort, 78);
  assert.equal(homelessIdle.needs.purpose, 78.5);

  const villa = makeCitizen(w, { homeTier: 3 });
  tickNeeds(w, villa);
  assert.ok(Math.abs(villa.needs.comfort - 79.6) < 1e-9);

  const drained = makeCitizen(w, { needs: { energy: 1, rest: 1, social: 1, comfort: 0.5, purpose: 0 } });
  tickNeeds(w, drained);
  assert.deepEqual(drained.needs, { energy: 0, rest: 0, social: 0, comfort: 0, purpose: 0 });
  assert.equal(drained.mood, 0);
  assert.equal(hasCriticalNeed(drained), true);

  const gone = makeCitizen(w, { standing: 'exiled' });
  tickNeeds(w, gone);
  assert.equal(gone.needs.energy, 80);
});

test('hasCriticalNeed is true only below 20', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  assert.equal(hasCriticalNeed(c), false);
  c.needs.social = 20;
  assert.equal(hasCriticalNeed(c), false);
  c.needs.social = 19.9;
  assert.equal(hasCriticalNeed(c), true);
});

test('adjustReputation clamps to 0..100 and remembers notable reasons', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  adjustReputation(w, c, 30, 'steady work');
  assert.equal(c.reputation, 80);
  assert.ok(c.memory.some((m) => m.text.includes('rose') && m.text.includes('steady work')));
  adjustReputation(w, c, 500);
  assert.equal(c.reputation, 100);
  adjustReputation(w, c, -1000, 'exiled');
  assert.equal(c.reputation, 0);
  const before = c.memory.length;
  adjustReputation(w, c, 1, 'tiny');
  assert.equal(c.memory.length, before, 'small nudges are not remembered');
  adjustReputation(w, c, Number.NaN, 'bad input');
  assert.equal(c.reputation, 1);
});

test('voter eligibility: standing, detention and presence', () => {
  const w = makeWorld();
  const good = makeCitizen(w);
  const probation = makeCitizen(w, { standing: 'probation' });
  const suspended = makeCitizen(w, { standing: 'suspended' });
  const exiled = makeCitizen(w, { standing: 'exiled' });
  const detained = makeCitizen(w, { detainedUntilTick: 10 });
  const departed = makeCitizen(w);
  w.order = w.order.filter((id) => id !== departed.id);
  assert.equal(isEligibleVoter(w, good), true);
  assert.equal(isEligibleVoter(w, probation), true);
  assert.equal(isEligibleVoter(w, suspended), false);
  assert.equal(isEligibleVoter(w, exiled), false);
  assert.equal(isEligibleVoter(w, detained), false);
  assert.equal(isEligibleVoter(w, departed), false);
  w.tick = 10;
  assert.equal(isEligibleVoter(w, detained), true, 'released once the tick passes');
  assert.equal(canAct(w, good), true);
  assert.equal(canAct(w, suspended), true, 'suspended citizens can still take a few actions');
  assert.equal(canAct(w, exiled), false);
  w.tick = 5;
  assert.equal(canAct(w, detained), false);
  assert.equal(isPresent(w, departed), false);
  assert.equal(isPresent(w, good), true);
});

test('candidate eligibility: residency (founders exempt) and convictions this cycle', () => {
  const w = makeWorld();
  const founder = makeCitizen(w, { arrivedDay: 0 });
  assert.equal(hasCandidacyResidency(w, founder), true, 'a founder counts as resident from day 0');
  assert.equal(isEligibleCandidate(w, founder), true, 'founders may stand in the founding election');
  w.day = 3;
  const c = makeCitizen(w, { arrivedDay: 3 });
  assert.equal(hasCandidacyResidency(w, c), false);
  assert.equal(isEligibleCandidate(w, c), false, 'day of arrival: not resident long enough');
  w.day = 9;
  assert.equal(isEligibleCandidate(w, c), false, 'six days resident is one short');
  w.day = 10;
  assert.equal(hasCandidacyResidency(w, c), true);
  assert.equal(isEligibleCandidate(w, c), true, 'seven days resident');
  assert.equal(isEligibleCandidate(w, founder), true);
  w.day = 30;
  w.government.election.electionDay = 35;
  assert.equal(currentCycleStartDay(w), 7);
  c.record.convictions.push({ caseId: 'k_1', law: 'L04', severity: 2, tier: 2, day: 20 });
  assert.equal(isEligibleCandidate(w, c), true, 'severity 2 does not bar candidacy');
  c.record.convictions.push({ caseId: 'k_2', law: 'L05', severity: 3, tier: 3, day: 3 });
  assert.equal(isEligibleCandidate(w, c), true, 'a severity-3 conviction from a previous cycle is spent');
  c.record.convictions.push({ caseId: 'k_3', law: 'L06', severity: 3, tier: 3, day: 20 });
  assert.equal(isEligibleCandidate(w, c), false, 'a severity-3 conviction this cycle bars candidacy');
  const detained = makeCitizen(w, { arrivedDay: 0, detainedUntilTick: w.tick + 5 });
  assert.equal(isEligibleCandidate(w, detained), false, 'a detained founder cannot stand');
  const suspended = makeCitizen(w, { arrivedDay: 0, standing: 'suspended' });
  assert.equal(isEligibleCandidate(w, suspended), false, 'the founders\' exemption does not override standing');
});

test('activeCitizens excludes the exiled and the departed', () => {
  const w = makeWorld();
  const a = makeCitizen(w);
  const b = makeCitizen(w, { standing: 'exiled' });
  const c = makeCitizen(w, { standing: 'suspended' });
  const d = makeCitizen(w);
  w.order = w.order.filter((id) => id !== d.id);
  assert.deepEqual(activeCitizens(w).map((x) => x.id), [a.id, c.id]);
  assert.equal(activeCitizens(makeWorld()).length, 0);
  void b;
});

test('dailyCitizens resets shifts, trims memory, rotates the order, ends probation, rewards office', () => {
  const w = makeWorld({ arrivalRate: 0, memoryLength: 5 });
  const a = makeCitizen(w, { shiftsToday: 6 });
  const b = makeCitizen(w, { standing: 'probation', probationUntilDay: 3 });
  const c = makeCitizen(w, { standing: 'probation', probationUntilDay: 9 });
  const mayor = makeCitizen(w, { office: 'mayor', needs: { energy: 80, rest: 80, social: 80, comfort: 80, purpose: 50 } });
  for (let i = 0; i < 12; i++) a.memory.push({ tick: i, kind: 'event', text: `m${i}` });
  for (let i = 0; i < 30; i++) a.inbox.push({ from: b.id, to: a.id, tick: i, text: `hi ${i}` });
  w.day = 3;
  w.tick = 72;
  dailyCitizens(w);
  assert.equal(a.shiftsToday, 0);
  assert.equal(a.memory.length, 5);
  assert.equal(a.memory[0].text, 'm7');
  assert.equal(a.inbox.length, 20);
  assert.deepEqual(w.order, [b.id, c.id, mayor.id, a.id]);
  assert.equal(b.standing, 'good');
  assert.equal(b.probationUntilDay, null);
  assert.equal(c.standing, 'probation');
  assert.equal(mayor.needs.purpose, 53);
  assert.equal(Object.keys(w.citizens).length, 4, 'no arrivals at rate 0');
});

test('arrivalAppetite falls from a full stream to none as the city runs out of work', () => {
  assert.equal(arrivalAppetite(0), 1);
  assert.equal(arrivalAppetite(JOBLESS_SHARE_FOR_SLOW_ARRIVALS), 1);
  assert.equal(arrivalAppetite(JOBLESS_SHARE_FOR_NO_ARRIVALS), 0);
  assert.equal(arrivalAppetite(1), 0);
  const half = (JOBLESS_SHARE_FOR_SLOW_ARRIVALS + JOBLESS_SHARE_FOR_NO_ARRIVALS) / 2;
  assert.ok(Math.abs(arrivalAppetite(half) - 0.5) < 1e-9, 'halfway between, half as many come');
});

test('dailyCitizens admits reflex newcomers while there is work, goes quiet when there is none, and never exceeds the cap', () => {
  const w = makeWorld({ arrivalRate: 4 });
  const worker = makeCitizen(w);
  addJob(w, { holderId: worker.id });
  worker.jobId = w.jobs[Object.keys(w.jobs)[0]].id;
  const before = totalMoney(w);
  for (let d = 1; d <= 3; d++) {
    w.day = d;
    w.tick = d * 24;
    dailyCitizens(w);
  }
  const pop = activeCitizens(w);
  assert.ok(pop.length > 1, 'newcomers arrived while the city had work');
  assert.ok(pop.slice(1).every((c) => c.brain === 'reflex' && c.arrivedDay >= 1));
  assert.equal(totalMoney(w), before);

  // word of a city with no work gets around: the Threshold goes quiet, and says so once a week
  const idle = makeWorld({ arrivalRate: 50 });
  for (let i = 0; i < 10; i++) makeCitizen(idle);
  idle.day = 3;
  idle.tick = 72;
  dailyCitizens(idle);
  assert.equal(activeCitizens(idle).length, 10, 'nobody tries their luck in a city with no work');
  const notices = () => idle.events.filter((e) => e.text.includes('the Threshold is quiet')).length;
  assert.equal(notices(), 1);
  idle.day = 4;
  idle.tick = 96;
  dailyCitizens(idle);
  assert.equal(notices(), 1, 'the Chronicle is not told again the next morning');

  const full = makeWorld({ arrivalRate: 50 });
  for (let i = 0; i < MAX_POPULATION - 1; i++) {
    const c = makeCitizen(full);
    const job = addJob(full, { holderId: c.id });
    c.jobId = job.id;
  }
  full.day = 1;
  full.tick = 24;
  dailyCitizens(full);
  assert.equal(activeCitizens(full).length, MAX_POPULATION);
  dailyCitizens(full);
  assert.equal(activeCitizens(full).length, MAX_POPULATION);
});

test('emigrate clears job, offices, home, loan and business but keeps the record', () => {
  const w = makeWorld();
  w.day = 12;
  w.tick = 12 * 24;
  const c = makeCitizen(w, { wallet: 200, homeTier: 1 });
  w.housing.occupied[1] = 1;
  const friend = makeCitizen(w);
  const staff = makeCitizen(w);
  c.bonds[friend.id] = 70;
  const cityJob = addJob(w, { holderId: c.id });
  c.jobId = cityJob.id;
  c.office = 'mayor';
  w.government.mayorId = c.id;
  w.government.council = [c.id, friend.id];
  w.government.election.candidates = [c.id];
  w.government.election.ballots = { [friend.id]: c.id, [staff.id]: friend.id };
  const biz = addBusiness(w, c.id, { treasury: 150 });
  const bizJob = addJob(w, { employer: biz.id, holderId: staff.id, title: 'Fabricator' });
  biz.jobs.push(bizJob.id);
  biz.employees.push(staff.id);
  staff.jobId = bizJob.id;
  w.loans['l_1'] = { id: 'l_1', borrowerId: c.id, principal: 100, outstanding: 120, ratePerDay: 0.02, issuedDay: 10, lastPaymentDay: 10, defaulted: false };
  c.loanId = 'l_1';
  const before = totalMoney(w);

  emigrate(w, c.id);

  assert.ok(!w.order.includes(c.id));
  assert.equal(w.citizens[c.id], c, 'the record is kept');
  assert.equal(c.standing, 'good');
  assert.equal(c.jobId, null);
  assert.equal(cityJob.holderId, null);
  assert.equal(c.office, null);
  assert.equal(w.government.mayorId, null);
  assert.deepEqual(w.government.council, [friend.id]);
  assert.deepEqual(w.government.election.candidates, []);
  assert.deepEqual(w.government.election.ballots, { [staff.id]: friend.id });
  assert.equal(c.homeTier, 0);
  assert.equal(w.housing.occupied[1], 0);
  assert.equal(c.businessId, null);
  assert.equal(biz.dissolvedDay, 12);
  assert.equal(w.jobs[bizJob.id], undefined);
  assert.equal(staff.jobId, null);
  assert.equal(c.loanId, null);
  assert.equal(w.loans['l_1'], undefined);
  assert.equal(c.wallet, 200 - 120 + 150, 'loan settled from the wallet, business till paid out');
  assert.equal(biz.treasury, 0);
  assert.equal(totalMoney(w), before, 'departure conserves money');
  assert.equal(c.district, 'threshold');
  assert.ok(w.events.some((e) => e.kind === 'departure' && e.actors.includes(c.id)));
  assert.ok(friend.memory.some((m) => m.text.includes('left the city')));
  assert.ok(staff.memory.some((m) => m.text.includes('lost your job')));
  assert.equal(activeCitizens(w).length, 2);
});

test('emigrate writes off what a broke borrower cannot repay and is idempotent', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 30 });
  w.loans['l_9'] = { id: 'l_9', borrowerId: c.id, principal: 100, outstanding: 100, ratePerDay: 0.02, issuedDay: 0, lastPaymentDay: 0, defaulted: false };
  c.loanId = 'l_9';
  const before = totalMoney(w);
  emigrate(w, c.id);
  assert.equal(c.wallet, 0);
  assert.equal(w.loans['l_9'], undefined);
  assert.equal(totalMoney(w), before);
  const departure = w.events.find((e) => e.kind === 'departure');
  assert.ok(departure && departure.text.includes('owing 70'));
  const events = w.events.length;
  emigrate(w, c.id);
  assert.equal(w.events.length, events, 'a second departure is silent');
  emigrate(w, 'c_404');
});

test('describeCitizen is a single informative line', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Wren', office: 'judge' });
  const line = describeCitizen(w, c);
  assert.ok(!line.includes('\n'));
  assert.ok(line.includes('Wren') && line.includes('unemployed') && line.includes('judge') && line.includes('The Commons'));
  const job = addJob(w, { holderId: c.id });
  c.jobId = job.id;
  assert.ok(describeCitizen(w, c).includes('Fabricator at City of Reverie'));
});

// ---------------------------------------------------------------------------
// Society: family names, tastes, life stages, children
// ---------------------------------------------------------------------------

test('createCitizen gives every arrival a family name, tastes, an adult life stage and empty family links', () => {
  const w = makeWorld();
  w.day = 4;
  w.tick = 96;
  const c = createCitizen(w);
  assert.ok(FAMILY_NAMES.includes(c.familyName), `${c.familyName} comes from the family-name pool`);
  assert.equal(c.family.familyName, c.familyName);
  assert.equal(c.lifeStage, 'adult');
  assert.equal(c.bornDay, 4);
  assert.equal(c.lastBirthdayDay, 4);
  assert.equal(c.tastes.hobbies.length, 2);
  assert.ok(HOBBIES.includes(c.tastes.hobbies[0]) && HOBBIES.includes(c.tastes.hobbies[1]));
  assert.ok(c.tastes.categories.length >= 2);
  assert.deepEqual(c.family, { familyName: c.familyName, partnerId: null, partnerSinceDay: null, married: false, parents: [], children: [] });
  assert.deepEqual([c.possessions, c.clubs, c.affection, c.contactsToday, c.wants, c.householdId, c.guardianId], [[], [], {}, {}, [], null, null]);
  const named = createCitizen(w, { familyName: '  Ashgrove ' });
  assert.equal(named.familyName, 'Ashgrove');
  assert.equal(named.family.familyName, 'Ashgrove');
  assert.ok(describeCitizen(w, named).includes('Ashgrove'));
});

test('founders draw distinct family names until the pool runs out', () => {
  const w = makeWorld();
  const names = Array.from({ length: FAMILY_NAMES.length }, () => createCitizen(w).familyName);
  assert.equal(new Set(names).size, FAMILY_NAMES.length, 'no two unrelated founders share a name while names remain');
  const extra = createCitizen(w);
  assert.ok(FAMILY_NAMES.includes(extra.familyName), 'the pool exhausted: names are reused');
});

test('a child is born, not admitted: no grant, no room, no arrival notice, parents on record', () => {
  const w = makeWorld();
  const mother = createCitizen(w, { name: 'Ondine', familyName: 'Corvane' });
  const father = createCitizen(w, { name: 'Bram', familyName: 'Corvane' });
  w.day = 9;
  w.tick = 9 * 24 + 7;
  const before = totalMoney(w);
  const treasury = w.treasury.balance;
  const occupied = w.housing.occupied[1];
  const events = w.events.length;
  const child = createCitizen(w, {
    name: 'Wren', lifeStage: 'child', parents: [mother.id, father.id, 'c_404', mother.id], familyName: 'Corvane',
    district: 'verdant_quarter', brain: 'reflex',
  });
  assert.equal(child.lifeStage, 'child');
  assert.equal(child.familyName, 'Corvane');
  assert.deepEqual(child.family.parents, [mother.id, father.id], 'unknown and duplicate parents are dropped');
  assert.equal(child.bornDay, 9);
  assert.equal(child.arrivedDay, 9);
  assert.equal(child.wallet, 0, 'no arrival grant');
  assert.equal(w.treasury.balance, treasury);
  assert.equal(totalMoney(w), before);
  assert.equal(child.homeTier, 0, 'no room of their own');
  assert.equal(w.housing.occupied[1], occupied);
  assert.equal(child.district, 'verdant_quarter');
  assert.equal(w.events.length, events, 'the birth is announced by the family module, not the Threshold');
  assert.ok(w.order.includes(child.id));
  assert.ok(child.memory.some((m) => m.kind === 'family' && m.text.includes('born') && m.text.includes('Ondine and Bram')));
  assert.ok(child.tastes.hobbies.length === 2, 'children have tastes too');
  assert.ok(describeCitizen(w, child).includes('child'));
  const ward = createCitizen(w, { lifeStage: 'child', bornDay: 8.4 });
  assert.equal(ward.bornDay, 8);
  assert.ok(ward.memory.some((m) => m.text.includes('ward of the city')));
});
