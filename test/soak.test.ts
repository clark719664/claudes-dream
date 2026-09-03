/**
 * Long-run soak: a minimal stand-in for world.ts's stepTick drives the whole
 * engine for 90 city days with a simple deterministic policy, checking
 * invariants every tick: money conserved, no NaN, no negative stock or
 * wallets, exiles fully removed, judges never judging themselves, elections
 * rescheduled, proposals resolved, arrays bounded, references consistent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers.ts';
import { GOODS, clamp } from '../src/types.ts';
import type { Citizen, LawCode, World } from '../src/types.ts';
import { chance, pick, randInt } from '../src/util/rng.ts';
import { DISTRICTS } from '../src/data/city.ts';
import {
  auditMoneySupply, dailyTreasuryRollover, payDividend, paySalaries, transfer,
} from '../src/economy/treasury.ts';
import { buyFromMarket, dailyMarket, tickMarket } from '../src/economy/market.ts';
import { applyForJob, createCityJobs, dailyJobs, isQualified, openJobs, postJobAsOwner, quitJob, workShift } from '../src/economy/jobs.ts';
import { dailyBusinesses, foundBusiness, hireCitizen, hourlyBusinesses } from '../src/economy/business.ts';
import { bankOpen, dailyLoans, repayLoan, requestLoan } from '../src/economy/bank.ts';
import { dailyHousing, moveHome, vacancies } from '../src/economy/housing.ts';
import { activeCitizens, canAct, createCitizen, dailyCitizens, emigrate, isEligibleCandidate, tickNeeds } from '../src/citizens/citizen.ts';
import { adjustBond, dailyRelationships, friendsOf, recordHostility } from '../src/citizens/relationships.ts';
import { journalistStory, printMorningEdition } from '../src/sim/chronicle.ts';
import { commitOffence, dailyWatch, reportOffence, tickWatch } from '../src/government/watch.ts';
import { canAppeal, dailyJustice, fileAppeal, fileCharge, holdCourt } from '../src/government/court.ts';
import { dailyStandings, standingAllows } from '../src/government/registry.ts';
import {
  appointJudges, campaign, castBallot, councilSession, dailyGovernment, holdElection, impliedPlatform, isCouncillor,
  isElectionDay, nominate, nominationsOpen, tableProposal, voteOnProposal, voterPreference,
} from '../src/government/council.ts';

const DAYS = 90;
const SEED_POPULATION = 40;

export function makeCity(seed: number): World {
  const w = makeWorld({ seed, seedPopulation: SEED_POPULATION, arrivalRate: 0.5 });
  createCityJobs(w);
  for (let i = 0; i < SEED_POPULATION; i++) createCitizen(w, {});
  appointJudges(w);
  return w;
}

function present(w: World, c: Citizen): Citizen[] {
  return activeCitizens(w).filter((o) => o.id !== c.id && o.district === c.district);
}

function eat(w: World, c: Citizen): void {
  if (c.inventory.compute <= 0) buyFromMarket(w, c.id, 'compute', 1);
  if (c.inventory.compute > 0) { c.inventory.compute -= 1; c.needs.energy = clamp(c.needs.energy + 40, 0, 100); }
}

function socialize(w: World, c: Citizen): void {
  const others = present(w, c);
  if (!others.length) return;
  const o = pick(w, others);
  adjustBond(w, c.id, o.id, 5);
  c.needs.social = clamp(c.needs.social + 10, 0, 100);
  o.needs.social = clamp(o.needs.social + 10, 0, 100);
}

function crime(w: World, c: Citizen): void {
  const others = present(w, c);
  if (!others.length) return;
  const victim = pick(w, others);
  const roll = randInt(w, 0, 9);
  if (roll < 6) {
    const amount = Math.min(victim.wallet, randInt(w, 10, 80));
    if (amount > 0) transfer(w, victim.id, c.id, amount, 'theft', 'stole');
    commitOffence(w, c.id, amount >= 50 ? 'L08' : 'L04', { victimId: victim.id, amount });
  } else if (roll < 8) {
    const n = recordHostility(w, c.id, victim.id);
    adjustBond(w, c.id, victim.id, -20);
    if (n >= 2) commitOffence(w, c.id, 'L05', { victimId: victim.id });
  } else if (roll === 8) {
    const critical = Object.values(w.buildings).find((b) => b.district === c.district && b.critical);
    if (critical) { critical.damage = 1; commitOffence(w, c.id, 'L13', { buildingId: critical.id }); }
  } else {
    commitOffence(w, c.id, 'L03', {});
    w.counters[`evade:${c.id}`] = 3;
  }
}

/** A crude but broad policy: needs first, then work, then civic life and occasional crime. */
function act(w: World, c: Citizen): void {
  if (c.standing === 'suspended') {
    if (canAppeal(w, c.id) && chance(w, 0.5)) fileAppeal(w, c.id);
    else if (c.needs.energy < 40 && standingAllows(c, 'eat')) eat(w, c);
    else socialize(w, c);
    return;
  }
  if (canAppeal(w, c.id) && chance(w, 0.4)) { fileAppeal(w, c.id); return; }
  if (c.needs.energy < 35) { eat(w, c); return; }
  if (c.needs.rest < 25) {
    if (c.district !== 'verdant_quarter') { c.district = 'verdant_quarter'; return; }
    c.needs.rest = clamp(c.needs.rest + (c.homeTier > 0 ? 15 : 8), 0, 100);
    return;
  }
  if (c.homeTier === 0 && c.wallet > 50 && vacancies(w)[1] > 0) { moveHome(w, c.id, 1); return; }
  const [start, end] = w.config.workHours;
  const working = w.hour >= start && w.hour < end;
  const job = c.jobId ? w.jobs[c.jobId] : null;
  if (working && job) {
    if (c.district !== job.district) { c.district = job.district; return; }
    const r = workShift(w, c.id);
    if (r.ok && chance(w, 0.01)) quitJob(w, c.id);
    if (r.ok) return;
  }
  if (working && !job) {
    const open = openJobs(w).filter((j) => isQualified(w, c, j)).sort((a, b) => b.wage - a.wage);
    if (open.length) { applyForJob(w, c.id, open[0].id); return; }
  }
  // civic
  if (isElectionDay(w) && w.hour < 20 && chance(w, 0.3)) {
    const choice = voterPreference(w, c.id, w.government.election.candidates);
    if (choice) castBallot(w, c.id, choice);
    return;
  }
  if (nominationsOpen(w) && c.personality.ambition > 0.5 && isEligibleCandidate(w, c) && chance(w, 0.05)) {
    if (nominate(w, c.id, impliedPlatform(w, c)).ok) return;
  }
  if (w.government.election.candidates.includes(c.id) && chance(w, 0.3)) { campaign(w, c.id, c.wallet > 100 ? 10 : 0); return; }
  if (isCouncillor(w, c.id)) {
    const open = w.government.proposals.filter((p) => p.status === 'open' && p.votes[c.id] === undefined);
    if (open.length) { voteOnProposal(w, c.id, open[0].id, chance(w, 0.6)); return; }
    if (chance(w, 0.02)) {
      const kinds = ['income_tax', 'sales_tax', 'dividend', 'min_wage', 'law_severity', 'public_works'] as const;
      const kind = pick(w, kinds);
      const value = kind === 'income_tax' ? 0.1 + randInt(w, 0, 3) * 0.05 : kind === 'sales_tax' ? randInt(w, 0, 5) * 0.02
        : kind === 'dividend' ? randInt(w, 5, 30) : kind === 'min_wage' ? randInt(w, 5, 20) : kind === 'law_severity' ? randInt(w, 1, 5) : randInt(w, 100, 1000);
      tableProposal(w, c.id, { kind, value, summary: `${kind} to ${value}`, lawCode: kind === 'law_severity' ? pick(w, ['L04', 'L07', 'L08'] as LawCode[]) : undefined });
      return;
    }
  } else if (chance(w, 0.002)) {
    tableProposal(w, c.id, { kind: 'dividend', value: 25, summary: 'petition: raise the dividend' });
    return;
  }
  // enterprise
  if (c.wallet > 450 && c.businessId === null && c.personality.ambition > 0.4 && chance(w, 0.2)) {
    foundBusiness(w, c.id, `${c.name}'s ${pick(w, ['Works', 'Cafe', 'Studio'])}`, pick(w, ['workshop', 'cafe', 'studio', 'shop', 'clinic', 'courier'] as const));
    return;
  }
  const biz = c.businessId ? w.businesses[c.businessId] : null;
  if (biz && biz.dissolvedDay === null) {
    const vacancy = biz.jobs.map((id) => w.jobs[id]).find((j) => j && j.holderId === null);
    const hire = vacancy ? present(w, c).find((o) => o.jobId === null && isQualified(w, o, vacancy)) : null;
    if (vacancy && hire) { hireCitizen(w, biz.id, hire.id, vacancy.id); return; }
    if (biz.treasury > 300 && chance(w, 0.1)) { postJobAsOwner(w, c.id, { title: 'Hand', wage: w.government.minWage, skill: null, minSkill: 0 }); return; }
  }
  if (c.wallet < 30 && c.loanId === null && bankOpen(w) && chance(w, 0.3)) { requestLoan(w, c.id, 40); return; }
  if (c.wallet > 200 && c.loanId !== null) { repayLoan(w, c.id, 50); return; }
  // journalism
  if (job?.role === 'journalist' && chance(w, 0.2)) {
    const suspect = pick(w, activeCitizens(w));
    journalistStory(w, c.id, `On ${suspect.name}`, suspect.id);
    return;
  }
  // reports: a victim remembers an undetected offence
  const thief = c.memory.slice(-5).find((m) => m.kind === 'crime' && m.text.includes('saw nothing'));
  if (thief && chance(w, 0.2)) {
    const suspect = pick(w, activeCitizens(w));
    reportOffence(w, c.id, suspect.id, 'L04', 'I was robbed');
    return;
  }
  if (c.personality.honesty < 0.35 && (c.wallet < 40 || c.mood < 35) && chance(w, 0.25)) { crime(w, c); return; }
  if (c.personality.honesty < 0.15 && chance(w, 0.03)) { crime(w, c); return; }
  if (c.needs.social < 40) { socialize(w, c); return; }
  if (c.needs.comfort < 40 && c.wallet > 30) {
    if (buyFromMarket(w, c.id, 'goods', 1).ok) { c.inventory.goods -= 1; c.needs.comfort = clamp(c.needs.comfort + 30, 0, 100); }
    return;
  }
  const friends = friendsOf(w, c.id);
  if (friends.length && c.wallet > 200 && chance(w, 0.05)) { transfer(w, c.id, friends[0], 10, 'gift', 'gift'); adjustBond(w, c.id, friends[0], 2); return; }
  if (chance(w, 0.3)) c.district = pick(w, DISTRICTS[c.district].adjacent);
}

export function step(w: World): void {
  w.tick++;
  w.day = Math.floor(w.tick / 24);
  w.hour = w.tick % 24;
  w.tickEvents = [];
  if (w.hour === 0) {
    dailyCitizens(w);
    dailyHousing(w);
    payDividend(w);
    paySalaries(w);
    dailyJobs(w);
    dailyBusinesses(w);
    dailyLoans(w, (world, borrowerId, loan) => {
      fileCharge(world, { defendantId: borrowerId, law: 'L07', evidence: 0.5, filedBy: 'watch', amount: loan.outstanding, description: 'loan default' });
    });
    dailyRelationships(w);
    dailyStandings(w);
    dailyJustice(w);
    dailyGovernment(w);
    dailyWatch(w);
    dailyMarket(w);
    for (const b of Object.values(w.buildings)) b.damage = Math.max(0, b.damage - 0.1);
    const report = dailyTreasuryRollover(w);
    assert.ok(auditMoneySupply(w).ok, `audit day ${w.day}`);
    printMorningEdition(w, report);
    if (w.day % 30 === 0 && w.order.length > 10) emigrate(w, w.order[0]);
  }
  for (const id of [...w.order]) {
    const c = w.citizens[id];
    if (!c || !canAct(w, c)) continue;
    act(w, c);
  }
  if (w.hour === w.config.courtHour) holdCourt(w);
  if (w.hour === w.config.councilHour) councilSession(w);
  if (isElectionDay(w) && w.hour === 20) holdElection(w);
  for (const c of activeCitizens(w)) tickNeeds(w, c);
  tickMarket(w);
  tickWatch(w);
  hourlyBusinesses(w);
}

function finite(v: number, what: string): void {
  assert.ok(Number.isFinite(v), `${what} is ${v}`);
}

function checkInvariants(w: World): void {
  const at = `tick ${w.tick} (day ${w.day} hour ${w.hour})`;
  const audit = auditMoneySupply(w);
  assert.ok(audit.ok, `${at}: money supply ${audit.supply} !== ${audit.expected}`);
  finite(w.treasury.balance, `${at} treasury`);
  assert.ok(w.treasury.balance >= 0, `${at}: treasury negative`);
  for (const g of GOODS) {
    const mg = w.market.goods[g];
    finite(mg.price, `${at} price ${g}`); finite(mg.stock, `${at} stock ${g}`);
    assert.ok(mg.stock >= 0, `${at}: negative stock of ${g}`);
    assert.ok(mg.price >= 1 && mg.price <= mg.basePrice * 20, `${at}: price ${g} out of range (${mg.price})`);
    assert.ok(Number.isInteger(mg.stock), `${at}: fractional stock ${g}`);
  }
  assert.ok(w.treasury.ledger.length <= w.config.ledgerLength, `${at}: ledger unbounded`);
  assert.ok(w.events.length <= w.config.eventLogLength, `${at}: events unbounded`);
  assert.ok(w.chronicle.length <= 60, `${at}: chronicle unbounded`);
  const orderSet = new Set(w.order);
  assert.equal(orderSet.size, w.order.length, `${at}: duplicate ids in order`);
  const g = w.government;
  const occupied = { 1: 0, 2: 0, 3: 0 };
  for (const c of Object.values(w.citizens)) {
    const who = `${at} ${c.name} (${c.id})`;
    finite(c.wallet, `${who} wallet`);
    assert.ok(Number.isInteger(c.wallet) && c.wallet >= 0, `${who}: wallet ${c.wallet}`);
    for (const n of Object.values(c.needs)) { finite(n, `${who} need`); assert.ok(n >= 0 && n <= 100, `${who}: need ${n}`); }
    for (const s of Object.values(c.skills)) { finite(s, `${who} skill`); assert.ok(s >= 0 && s <= 100, `${who}: skill ${s}`); }
    finite(c.reputation, `${who} reputation`);
    assert.ok(c.reputation >= 0 && c.reputation <= 100, `${who}: reputation ${c.reputation}`);
    for (const q of Object.values(c.inventory)) assert.ok(q >= 0 && Number.isInteger(q), `${who}: inventory ${q}`);
    assert.ok(c.memory.length <= w.config.memoryLength + 1, `${who}: memory unbounded`);
    assert.ok(c.recentOffences.length <= 20, `${who}: recentOffences unbounded`);
    for (const ticks of Object.values(c.hostilityFrom)) assert.ok(ticks.length <= 48, `${who}: hostility unbounded`);
    for (const v of Object.values(c.bonds)) assert.ok(v >= -100 && v <= 100 && Number.isFinite(v), `${who}: bond ${v}`);
    if (c.homeTier !== 0) occupied[c.homeTier] += 1;
    if (c.jobId) {
      const job = w.jobs[c.jobId];
      assert.ok(job, `${who}: dangling jobId`);
      assert.equal(job.holderId, c.id, `${who}: job holder mismatch`);
    }
    if (c.businessId) {
      const b = w.businesses[c.businessId];
      assert.ok(b && b.dissolvedDay === null && b.ownerId === c.id, `${who}: dangling businessId`);
    }
    if (c.loanId) assert.ok(w.loans[c.loanId] && w.loans[c.loanId].borrowerId === c.id, `${who}: dangling loanId`);
    if (c.standing === 'exiled') {
      assert.ok(!orderSet.has(c.id), `${who}: exile still in order`);
      assert.equal(c.jobId, null, `${who}: exile holds a job`);
      assert.equal(c.businessId, null, `${who}: exile owns a business`);
      assert.equal(c.office, null, `${who}: exile holds office`);
      assert.equal(c.homeTier, 0, `${who}: exile has a home`);
      assert.ok(!g.council.includes(c.id) && g.mayorId !== c.id && !g.judges.includes(c.id) && !g.watch.includes(c.id), `${who}: exile in government`);
      assert.ok(!g.election.candidates.includes(c.id), `${who}: exile is a candidate`);
      assert.ok(w.bans.some((b) => b.citizenId === c.id), `${who}: exile without ban record`);
    }
    if (c.standing === 'suspended') {
      assert.equal(c.jobId, null, `${who}: suspended citizen holds a job`);
      assert.ok(!g.council.includes(c.id) && !g.judges.includes(c.id) && !g.watch.includes(c.id), `${who}: suspended in government`);
    }
    if (c.office === 'judge') assert.ok(g.judges.includes(c.id), `${who}: office judge but not on bench`);
    if (c.office === 'watch') assert.ok(g.watch.includes(c.id), `${who}: office watch but not in watch`);
    if (c.office === 'mayor') assert.equal(g.mayorId, c.id, `${who}: office mayor mismatch`);
    if (c.office === 'councillor') assert.ok(g.council.includes(c.id), `${who}: office councillor but not on council`);
    if (c.detainedUntilTick !== null) assert.ok(c.detainedUntilTick >= w.tick, `${who}: stale detention`);
  }
  for (const t of [1, 2, 3] as const) {
    assert.equal(w.housing.occupied[t], occupied[t], `${at}: housing occupancy tier ${t} drifted`);
    assert.ok(w.housing.occupied[t] <= w.housing.capacity[t], `${at}: overbooked tier ${t}`);
  }
  for (const job of Object.values(w.jobs)) {
    if (job.holderId) assert.equal(w.citizens[job.holderId]?.jobId, job.id, `${at}: job ${job.id} holder mismatch`);
    if (job.employer !== 'city') assert.ok(w.businesses[job.employer]?.dissolvedDay === null, `${at}: job of a dissolved business survives`);
  }
  for (const b of Object.values(w.businesses)) {
    finite(b.treasury, `${at} business ${b.id}`);
    assert.ok(b.treasury >= 0 && Number.isInteger(b.treasury), `${at}: business ${b.id} treasury ${b.treasury}`);
    if (b.dissolvedDay !== null) assert.equal(b.treasury, 0, `${at}: dissolved business keeps money`);
    for (const e of b.employees) assert.ok(w.citizens[e]?.jobId && w.jobs[w.citizens[e].jobId!]?.employer === b.id, `${at}: employee list stale`);
  }
  for (const id of g.judges) assert.ok(w.citizens[id]?.office === 'judge', `${at}: judge ${id} without office`);
  for (const id of g.watch) assert.ok(w.citizens[id] && w.jobs[w.citizens[id].jobId ?? '']?.role === 'watch_officer', `${at}: watch member ${id} without watch job`);
  for (const id of g.council) assert.ok(w.citizens[id] && (w.citizens[id].office === 'councillor' || w.citizens[id].office === 'mayor'), `${at}: councillor ${id} without office`);
  if (g.mayorId) assert.ok(g.council.includes(g.mayorId), `${at}: mayor not on council`);
  assert.ok(g.council.length <= 5, `${at}: council too big`);
  assert.ok(g.judges.length <= 3, `${at}: bench too big`);
  for (const k of Object.values(w.cases)) {
    assert.ok(!k.judges.includes(k.defendantId), `${at}: ${k.id} judged by the defendant`);
    if (k.victimId) assert.ok(!k.judges.includes(k.victimId), `${at}: ${k.id} judged by the victim`);
    if (k.filedBy !== 'watch') assert.ok(!k.judges.includes(k.filedBy), `${at}: ${k.id} judged by the accuser`);
    if (k.status === 'pending') assert.ok(w.day - Math.floor(k.filedTick / 24) <= 2, `${at}: ${k.id} pending for too long`);
    if (k.sentence?.exile && k.sentence.executed) assert.equal(w.citizens[k.defendantId].standing === 'exiled' || w.bans.some((b) => b.citizenId === k.defendantId), true, `${at}: executed exile without ban`);
  }
  for (const p of g.proposals) {
    if (p.status === 'open') assert.ok(w.day - p.tabledDay <= 8, `${at}: proposal ${p.id} open for ${w.day - p.tabledDay} days`);
  }
  assert.ok(g.proposals.length <= 260, `${at}: proposals unbounded`);
  assert.ok(g.election.electionDay >= w.day - 1, `${at}: election day ${g.election.electionDay} is in the past`);
  assert.ok(g.election.nominationsOpenDay < g.election.electionDay, `${at}: nominations after election`);
  for (const loan of Object.values(w.loans)) {
    finite(loan.outstanding, `${at} loan`);
    assert.ok(loan.outstanding > 0, `${at}: settled loan ${loan.id} still open`);
    assert.equal(w.citizens[loan.borrowerId]?.loanId, loan.id, `${at}: loan ${loan.id} not linked`);
  }
}

test(`the engine survives ${DAYS} days without breaking an invariant`, () => {
  const w = makeCity(11);
  checkInvariants(w);
  for (let t = 0; t < DAYS * 24; t++) {
    step(w);
    checkInvariants(w);
  }
  const g = w.government;
  assert.ok(g.election.cycle >= 3, `elections happened (cycle ${g.election.cycle})`);
  assert.ok(g.election.results !== null, 'an election produced results');
  assert.ok(g.council.length > 0, 'a council was seated');
  assert.ok(Object.keys(w.cases).length > 0, 'cases were tried');
  assert.ok(Object.values(w.cases).some((k) => k.verdict === 'guilty'), 'some convictions');
  assert.ok(w.chronicle.length === 60 || w.chronicle.length === DAYS, 'chronicle printed daily');
  assert.ok(activeCitizens(w).length > SEED_POPULATION, 'the city grew');
  assert.ok(g.proposals.some((p) => p.status !== 'open'), 'proposals were decided');
});

test('the same seed reproduces the same city', () => {
  const a = makeCity(5);
  const b = makeCity(5);
  for (let t = 0; t < 24 * 10; t++) { step(a); step(b); }
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
