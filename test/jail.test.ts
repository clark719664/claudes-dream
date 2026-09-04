import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Case, CaseId, Citizen, CitizenId, World } from '../src/types.ts';
import { transfer } from '../src/economy/treasury.ts';
import {
  CROWDING_COMFORT, CUSTODY_ACTIONS, CUSTODY_ALSO_ALLOWS, CUSTODY_FORBIDS, KEEP_CELLS, KEEP_COST,
  KEEP_THRESHOLD_DAYS, custodyCapacity, custodyCodeOf, custodyDependants, custodyOf, dailyJail, daysLeft,
  exileForbidden, fundKeep, isJailed, jailCaseOf, jailCells, jailCitizen, jailRoster, jailedCitizens, keepBuilt,
  keepObligation, makeRestrainingOrder, mayActInCustody, overcrowded, releaseForSpace, releaseFromJail,
  harmOfCase, isCustodialCase, pleadGuilty, pleadedGuilty, restitutionOwed, restrainedFrom, sentenceCaseToCustody,
  sentenceToCustody, takeIntoCustody, visitPrisoner, workInCustody,
} from '../src/government/jail.ts';
import { custodialConvictions } from '../src/government/custody.ts';

/** A charge in the book, for the cases custody reads restitution and victims from. */
function makeCase(w: World, spec: Partial<Case> & { defendantId: CitizenId }): Case {
  const id = `k_${Object.keys(w.cases).length + 1}` as CaseId;
  const k: Case = {
    id, law: 'L04', severity: 3, evidence: 1, filedTick: w.tick, filedBy: 'watch',
    victimId: spec.victimId ?? null, amount: spec.amount ?? 0, description: 'for the test', status: 'tried',
    triedDay: w.day, judges: [], votes: {}, reasons: {}, openedTick: null, carriedSessions: 0,
    decidedByDefault: false, verdict: 'guilty', sentence: null, appeal: null,
    jury: [], juryVotes: {}, juryReasons: {}, advocateId: null, advocacy: 0,
    ...spec,
  };
  w.cases[k.id] = k;
  return k;
}

/** Move the city on a day, running the morning roll. */
function nextDay(w: World): void {
  w.day += 1;
  w.tick = w.day * 24 + 8;
  w.hour = 8;
  dailyJail(w);
}

// ---------------------------------------------------------------------------
// A term, and what it does and does not take
// ---------------------------------------------------------------------------

test('a custodial sentence is days in custody, and takes nothing else away', () => {
  const w = makeWorld();
  w.day = 2;
  const d = makeCitizen(w, { name: 'Hand', homeTier: 2, office: 'councillor', wallet: 400 });
  w.housing.occupied[2] = 1;
  const victim = makeCitizen(w, { name: 'Hurt' });
  const jobId = 'j_1';
  w.jobs[jobId] = {
    id: jobId, role: 'fabricator', title: 'Fabricator', employer: 'city', buildingId: 'fabrication_works',
    district: 'foundry_row', skill: 'crafting', minSkill: 0, minReputation: 0, wage: 15, output: {},
    holderId: d.id, createdDay: 0,
  };
  d.jobId = jobId;
  w.government.council.push(d.id);
  const k = makeCase(w, { defendantId: d.id, victimId: victim.id, amount: 0 });
  const before = totalMoney(w);

  const term = sentenceToCustody(w, {
    citizenId: d.id, caseId: k.id, code: 'P03', harm: { injuryDays: 7 }, victimId: victim.id,
  });

  assert.equal(term.code, 'P03');
  assert.ok(term.days >= 5 && term.days <= 15, 'assault is 5–15 days');
  assert.ok(isJailed(d));
  assert.equal(d.jailedUntilDay, w.day + term.days);
  assert.equal(jailCaseOf(w, d.id), k.id);
  assert.equal(custodyCodeOf(w, d.id), 'P03');

  // Not a standing, not a fine, not an exile.
  assert.equal(d.standing, 'good', 'custody is a state, not a standing');
  assert.equal(d.homeTier, 2, 'the household keeps its home');
  assert.equal(d.jobId, jobId, 'the sentence ends and the city expects them back');
  assert.equal(d.office, 'councillor');
  assert.equal(d.wallet, 400, 'no fine, no seizure: the days are the whole of it');
  assert.equal(totalMoney(w), before, 'custody moves no money at all');
  assert.equal(w.bans.length, 0);

  // And the record now closes the Gate to them forever.
  assert.equal(custodialConvictions(w, d.id), 1);
  assert.ok(exileForbidden(w, d.id));
  assert.ok(victim.memory.some((m) => m.text.includes('for what they did to you')));
  assert.ok(w.events.some((e) => e.kind === 'sentence' && e.text.includes('assault')));
});

test('a violent citizen is never exiled, however long the record gets', () => {
  const w = makeWorld();
  const d = makeCitizen(w, { name: 'Repeat' });
  for (let i = 0; i < 4; i++) {
    const k = makeCase(w, { defendantId: d.id });
    sentenceToCustody(w, { citizenId: d.id, caseId: k.id, code: 'P04', harm: 1 });
    releaseFromJail(w, d, 'the term is served');
  }
  assert.equal(custodialConvictions(w, d.id), 4, 'a fourth conviction, and every one of them violent');
  assert.equal(d.standing, 'good');
  assert.equal(w.bans.length, 0, 'the ladder is not this track and the Gate is not this answer');
  assert.match(exileForbidden(w, d.id) ?? '', /forbids exiling them/);
});

test('a prisoner may write, appeal, study, work and be visited — and nothing else', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Held' });
  jailCitizen(w, c.id, 6, 'k_1');
  assert.ok(isJailed(c));
  assert.equal(c.district, 'commons', 'the cells are at the Watch House');

  for (const allowed of [...CUSTODY_ACTIONS, ...CUSTODY_ALSO_ALLOWS]) {
    assert.ok(mayActInCustody(w, c, allowed), `${allowed} is not taken away`);
  }
  for (const forbidden of CUSTODY_FORBIDS) {
    assert.equal(mayActInCustody(w, c, forbidden), false, `${forbidden} is out of reach from custody`);
  }
  assert.equal(mayActInCustody(w, c, 'visit'), false, 'a prisoner is visited; they do not visit');

  const free = makeCitizen(w, { name: 'Free' });
  assert.ok(mayActInCustody(w, free, 'work'), 'and none of this touches anybody who is not in custody');
});

test('the term ends on the day it says, and not a day before', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  jailCitizen(w, c.id, 2, 'k_5');
  assert.equal(daysLeft(w, c), 2);

  nextDay(w);
  assert.ok(isJailed(c), 'a day short is still a day');
  assert.equal(daysLeft(w, c), 1);

  nextDay(w);
  assert.equal(isJailed(c), false);
  assert.equal(jailCaseOf(w, c.id), null, 'the register forgets whose cell it was');
  assert.ok(w.events.some((e) => e.kind === 'jail' && e.text.includes('the term is served')));
});

test('the city does not jail children, and nobody who has left', () => {
  const w = makeWorld();
  const kid = makeCitizen(w, { lifeStage: 'child', name: 'Small' });
  assert.equal(takeIntoCustody(w, { citizenId: kid.id, caseId: 'k_9', days: 3 }), null);
  assert.equal(isJailed(kid), false);
  assert.ok(w.events.some((e) => e.kind === 'jail' && e.text.includes('does not jail its children')));

  const gone = makeCitizen(w);
  gone.standing = 'exiled';
  w.order = w.order.filter((id) => id !== gone.id);
  assert.equal(takeIntoCustody(w, { citizenId: gone.id, caseId: 'k_9', days: 3 }), null);
  assert.equal(takeIntoCustody(w, { citizenId: 'c_nobody', caseId: 'k_9', days: 3 }), null);
  releaseFromJail(w, kid, 'nothing to release');
  dailyJail(w);
  assert.deepEqual(jailRoster(w), []);
});

test('the roll is public: who is held, for what, until when, and where', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { name: 'Ada' });
  const b = makeCitizen(w, { name: 'Bram' });
  const ka = makeCase(w, { defendantId: a.id });
  sentenceToCustody(w, { citizenId: a.id, caseId: ka.id, code: 'P04', harm: 1 });   // 60 days
  jailCitizen(w, b.id, 1, 'k_99');

  const roster = jailRoster(w);
  assert.deepEqual(roster.map((r) => r.name), ['Bram', 'Ada'], 'soonest out, first on the roll');
  assert.equal(roster[1].code, 'P04');
  assert.equal(roster[1].where, 'watch house', 'no Keep yet, so the Watch House holds them');
  assert.equal(roster[0].life, false);
});

// ---------------------------------------------------------------------------
// Overcrowding never opens a cell
// ---------------------------------------------------------------------------

test('overcrowding never opens a cell: nobody is released for room, ever', () => {
  const w = makeWorld();
  w.jailCells = 3;
  const held: Citizen[] = [];
  for (let i = 0; i < 6; i++) {
    const c = makeCitizen(w, { name: `Held${i}` });
    const k = makeCase(w, { defendantId: c.id });
    sentenceToCustody(w, { citizenId: c.id, caseId: k.id, code: 'P03', harm: 1 });
    held.push(c);
  }
  assert.equal(jailedCitizens(w).length, 6);
  assert.ok(overcrowded(w), '6 people, 3 cells');
  const comfort = held.map((c) => c.needs.comfort);

  nextDay(w);

  assert.equal(jailedCitizens(w).length, 6, 'not one door opened for room');
  assert.ok(overcrowded(w));
  for (let i = 0; i < held.length; i++) {
    assert.equal(held[i].needs.comfort, comfort[i] - CROWDING_COMFORT, 'they are held at a mood penalty');
  }
  assert.equal(keepObligation(w), w.day, 'and the Council is obliged to fund the Keep from that day');
  assert.ok(w.events.some((e) => e.kind === 'jail' && e.text.includes('nobody will be')));

  // The story runs every single day it lasts.
  const day1 = w.events.filter((e) => e.kind === 'jail' && e.text.includes('owed Reverie a Keep')).length;
  nextDay(w);
  const day2 = w.events.filter((e) => e.kind === 'jail' && e.text.includes('owed Reverie a Keep')).length;
  assert.equal(day2, day1 + 1, 'the Chronicle runs it again');
  assert.equal(jailedCitizens(w).length, 6);

  // And asking directly gets the same answer.
  const asked = releaseForSpace(w, held[0].id);
  assert.equal(asked.ok, false);
  assert.match(asked.message, /Crowding is not a reason/);
});

test('the Council discharges its obligation by funding the Keep out of public works', () => {
  const w = makeWorld();
  w.jailCells = 1;
  for (let i = 0; i < 2; i++) {
    const c = makeCitizen(w, { name: `Held${i}` });
    jailCitizen(w, c.id, 10, `k_${i}`);
  }
  const before = totalMoney(w);
  assert.equal(custodyCapacity(w), 1);
  nextDay(w);
  assert.equal(keepBuilt(w), false, 'an empty works fund builds nothing');
  assert.ok(keepObligation(w) !== null);

  w.government.publicWorksFund = KEEP_COST + 50;
  nextDay(w);
  assert.ok(keepBuilt(w), 'with the money committed, the Charter\'s "shall" is discharged');
  assert.equal(w.government.publicWorksFund, 50);
  assert.equal(custodyCapacity(w), 1 + KEEP_CELLS);
  assert.equal(overcrowded(w), false);
  assert.equal(keepObligation(w), null);
  assert.equal(totalMoney(w), before, 'the works fund is a commitment, not a purse: no lumen moved');
  assert.ok(w.events.some((e) => e.kind === 'jail' && e.text.includes('The Keep is built')));
});

test('a long term belongs in the Keep, and until there is one it is served at the Watch House', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Long' });
  const k = makeCase(w, { defendantId: c.id });
  const term = sentenceToCustody(w, { citizenId: c.id, caseId: k.id, code: 'P07', harm: 0.5 });
  assert.ok(term.days >= KEEP_THRESHOLD_DAYS);
  assert.equal(c.district, 'commons', 'no Keep yet');
  const comfort = c.needs.comfort;

  nextDay(w);
  assert.equal(c.needs.comfort < comfort, true, 'held in the cells at a mood penalty');
  assert.ok(w.events.some((e) => e.kind === 'jail' && e.text.includes('because the city has no Keep')));

  w.government.publicWorksFund = KEEP_COST;
  assert.ok(fundKeep(w));
  assert.equal(custodyOf(w, c.id)?.where, 'keep');
  assert.ok(c.memory.some((m) => m.text.includes('moved from the cells at the Watch House to the Keep')));
});

// ---------------------------------------------------------------------------
// Parole
// ---------------------------------------------------------------------------

test('labour in custody pays the victim first and the prisoner second', () => {
  const w = makeWorld();
  const d = makeCitizen(w, { name: 'Worker', wallet: 0 });
  const victim = makeCitizen(w, { name: 'Owed', wallet: 0 });
  const k = makeCase(w, { defendantId: d.id, victimId: victim.id, amount: 8 });
  sentenceToCustody(w, { citizenId: d.id, caseId: k.id, code: 'P06', harm: 0, victimId: victim.id });
  const before = totalMoney(w);

  const first = workInCustody(w, d.id);
  assert.ok(first.ok);
  assert.equal(victim.wallet, 5, 'the whole of the first day went to the victim');
  assert.equal(d.wallet, 0);
  assert.equal(workInCustody(w, d.id).ok, false, 'one shift a day');

  w.day += 1;
  workInCustody(w, d.id);
  assert.equal(victim.wallet, 8, 'the debt is settled');
  assert.ok(d.wallet > 0, 'and the rest reaches the citizen');
  assert.equal(restitutionOwed(w, d.id).amount, 0);
  assert.equal(totalMoney(w), before, 'the Treasury paid the wage; nothing was made');

  const free = makeCitizen(w);
  assert.equal(workInCustody(w, free.id).ok, false, 'there is no labour in custody outside custody');
});

test('family and friends may visit, once a day, where the prisoner is held', () => {
  const w = makeWorld();
  const d = makeCitizen(w, { name: 'Held' });
  const kin = makeCitizen(w, { name: 'Sister' });
  const friend = makeCitizen(w, { name: 'Friend' });
  const stranger = makeCitizen(w, { name: 'Nobody' });
  d.family.parents = ['c_parent'];
  kin.family.parents = ['c_parent'];
  friend.bonds[d.id] = 70;
  d.bonds[friend.id] = 70;
  jailCitizen(w, d.id, 5, 'k_1');
  d.needs.social = 20;

  assert.equal(visitPrisoner(w, stranger.id, d.id).ok, false, 'custody is not a public gallery');
  assert.ok(visitPrisoner(w, kin.id, d.id).ok);
  assert.ok(visitPrisoner(w, friend.id, d.id).ok);
  assert.equal(visitPrisoner(w, kin.id, d.id).ok, false, 'once a day');
  assert.ok(d.needs.social > 20, 'a visit is worth something');
  assert.ok(d.memory.some((m) => m.text.includes('came to see you')));

  const elsewhere = makeCitizen(w, { name: 'Far', district: 'archive' });
  elsewhere.bonds[d.id] = 70;
  d.bonds[elsewhere.id] = 70;
  assert.equal(visitPrisoner(w, elsewhere.id, d.id).ok, false, 'you have to go there');
  jailCitizen(w, kin.id, 2, 'k_2');
  assert.equal(visitPrisoner(w, kin.id, d.id).ok, false, 'and you cannot be inside yourself');
});

test('the household keeps its home and the Chest keeps the dependants', () => {
  const w = makeWorld();
  transfer(w, 'treasury', 'chest', 200, 'donation', 'the city funds the Chest');
  const d = makeCitizen(w, { name: 'Held', homeTier: 1 });
  w.housing.occupied[1] = 1;
  const child = makeCitizen(w, { name: 'Kid', lifeStage: 'child', wallet: 0, homeTier: 0 });
  const before = totalMoney(w);
  d.family.children = [child.id];
  child.family.parents = [d.id];
  jailCitizen(w, d.id, 20, 'k_1');

  assert.deepEqual(custodyDependants(w, d).map((c) => c.id), [child.id], 'a child below the hardship line');
  d.rentArrearsDays = 2;
  nextDay(w);

  assert.equal(d.homeTier, 1, 'the household keeps its home');
  assert.equal(d.rentArrearsDays, 0, 'and no eviction is built out of the days the city took');
  assert.ok(child.memory.some((m) => m.text.includes('the home is yours')), 'the Chest carries the dependants');
  assert.ok(w.events.some((e) => e.kind === 'jail' && e.text.includes('the Community Chest carries Kid')));
  assert.equal(totalMoney(w), before, 'custody itself moves no money');

  // Said once, not every morning: a household is not news twice.
  const said = w.events.filter((e) => e.text.includes('the Community Chest carries')).length;
  nextDay(w);
  assert.equal(w.events.filter((e) => e.text.includes('the Community Chest carries')).length, said);

  // Somebody who can keep themselves is nobody's dependant.
  const partner = makeCitizen(w, { name: 'Comfortable', homeTier: 1, wallet: 500 });
  w.housing.occupied[1] += 1;
  d.family.partnerId = partner.id;
  assert.equal(custodyDependants(w, d).some((c) => c.id === partner.id), false);

  // And nobody starves in a cell: the Watch House feeds who it holds.
  d.needs.energy = 0;
  d.needs.rest = 0;
  nextDay(w);
  assert.ok(d.needs.energy >= 40 && d.needs.rest >= 40);
});

test('a second sentence lengthens the stay and a nonsense term is still a day', () => {
  const w = makeWorld();
  w.day = 5;
  const twice = makeCitizen(w, { name: 'Twice' });
  jailCitizen(w, twice.id, 4, 'k_201');
  jailCitizen(w, twice.id, 2, 'k_202');
  assert.equal(twice.jailedUntilDay, w.day + 4, 'a lighter second term never shortens the first');
  jailCitizen(w, twice.id, 9, 'k_203');
  assert.equal(twice.jailedUntilDay, w.day + 9);

  const odd = makeCitizen(w, { name: 'Odd' });
  jailCitizen(w, odd.id, 0, 'k_204');
  assert.equal(daysLeft(w, odd), 1);
  jailCitizen(w, odd.id, Number.NaN, 'k_205');
  assert.equal(daysLeft(w, odd), 1);

  // Nothing caps a custodial term any more: the band does that, not the cells.
  const long = makeCitizen(w, { name: 'Long' });
  jailCitizen(w, long.id, 180, 'k_206');
  assert.equal(daysLeft(w, long), 180);
});

test('a restraining order is made once, and stands in the record', () => {
  const w = makeWorld();
  const d = makeCitizen(w, { name: 'Near' });
  const victim = makeCitizen(w, { name: 'Kept' });
  const k = makeCase(w, { defendantId: d.id, victimId: victim.id });
  sentenceToCustody(w, { citizenId: d.id, caseId: k.id, code: 'P02', harm: 0, victimId: victim.id });
  assert.ok(restrainedFrom(w, d.id, victim.id), 'harassment carries one whether or not the term is a day');
  const orders = w.events.filter((e) => e.kind === 'law' && e.text.includes('restraining order')).length;
  makeRestrainingOrder(w, d.id, victim.id);
  assert.equal(w.events.filter((e) => e.kind === 'law' && e.text.includes('restraining order')).length, orders);
  assert.equal(restrainedFrom(w, d.id, makeCitizen(w).id), false);
});

test('a world saved before the cells were built still counts them', () => {
  const w = makeWorld();
  (w as unknown as { jailCells: unknown }).jailCells = undefined;
  assert.equal(jailCells(w), 6);
  (w as unknown as { jailCells: unknown }).jailCells = Number.NaN;
  assert.equal(jailCells(w), 6);
  w.jailCells = 0;
  assert.equal(jailCells(w), 0, 'a city may decide it has no cells at all');

  // And with no cells at all, the city still holds who it holds.
  const c = makeCitizen(w, { name: 'Nobody' });
  jailCitizen(w, c.id, 2, 'k_400');
  assert.ok(overcrowded(w));
  nextDay(w);
  assert.ok(isJailed(c), 'crowding is a crisis, not a release valve');
});

// ---------------------------------------------------------------------------
// From a charge to a term
// ---------------------------------------------------------------------------

test('a tried case becomes a term: harm off the record, mitigation off what was done', () => {
  const w = makeWorld();
  w.day = 4;
  const d = makeCitizen(w, { name: 'Hand' });
  const victim = makeCitizen(w, { name: 'Hurt', lifeStage: 'elder' });
  victim.mood = 30;
  victim.health = { glitched: true, sinceDay: 1 };
  const k = makeCase(w, { defendantId: d.id, victimId: victim.id, amount: 120, law: 'P06' as 'L04', status: 'pending' });

  assert.ok(isCustodialCase(k), 'a P code is not the ladder\'s business');
  assert.equal(isCustodialCase({ law: 'L08' }), false);
  const harm = harmOfCase(w, k);
  assert.equal(harm.lumens, 120);
  assert.equal(harm.injuryDays, 3);
  assert.equal(harm.needsDamage, 40);
  assert.equal(harm.vulnerableVictim, true, 'an elder');

  // A plea before the bench sits is worth a fifth; after it, nothing.
  assert.ok(pleadGuilty(w, d.id, k.id).ok);
  assert.ok(pleadedGuilty(w, k.id));
  assert.equal(pleadGuilty(w, d.id, k.id).ok, false, 'you plead once');
  const late = makeCase(w, { defendantId: d.id, status: 'in_session', law: 'P03' as 'L04' });
  assert.equal(pleadGuilty(w, d.id, late.id).ok, false, 'the bench is already sitting');

  const term = sentenceCaseToCustody(w, k);
  assert.ok(term);
  assert.equal(term?.code, 'P06');
  assert.ok(isJailed(d));
  // The same case with no plea and no advocate is a longer term.
  const other = makeCitizen(w, { name: 'Second' });
  const k2 = makeCase(w, { defendantId: other.id, victimId: victim.id, amount: 120, law: 'P06' as 'L04' });
  const plain = sentenceCaseToCustody(w, k2);
  assert.ok((plain?.days ?? 0) > (term?.days ?? 0), 'pleading guilty in time is worth a fifth');

  // A charge on the other track is not this file's business at all.
  const civic = makeCase(w, { defendantId: other.id, law: 'L08' });
  assert.equal(sentenceCaseToCustody(w, civic), null);
});

test('an advocate who argued mitigation, and a victim made whole, both shorten the term', () => {
  const w = makeWorld();
  const bare = makeCitizen(w, { name: 'Bare' });
  const spoken = makeCitizen(w, { name: 'Spoken' });
  const repaid = makeCitizen(w, { name: 'Repaid' });
  const victim = makeCitizen(w, { name: 'Hurt' });
  const k1 = makeCase(w, { defendantId: bare.id, victimId: victim.id, amount: 100, law: 'P05' as 'L04' });
  const k2 = makeCase(w, { defendantId: spoken.id, victimId: victim.id, amount: 100, law: 'P05' as 'L04', advocacy: 0.2 });
  const k3 = makeCase(w, { defendantId: repaid.id, victimId: victim.id, amount: 100, law: 'P05' as 'L04' });
  w.counters[`restitutionPaid:${k3.id}`] = w.day;

  const plain = sentenceCaseToCustody(w, k1);
  const argued = sentenceCaseToCustody(w, k2);
  const mended = sentenceCaseToCustody(w, k3);
  assert.ok((argued?.days ?? 0) < (plain?.days ?? 0), 'somebody spoke for them');
  assert.ok((mended?.days ?? 0) < (plain?.days ?? 0), 'the victim was made whole first');
  assert.ok((mended?.days ?? 0) >= 15, 'and neither goes below the floor of the band');
});
