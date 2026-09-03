import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Business, Citizen, Job, JobRole, World } from '../src/types.ts';
import { CITY_JOBS, CITY_SHIFTS_PER_DAY, COURIER_CONTRACT, COURIER_CONTRACTS_PER_DAY } from '../src/data/jobs.ts';
import { unmetDemand } from '../src/economy/market.ts';
import {
  applyForJob, closeJob, createCityJob, createCityJobs, dailyJobs, employerName, fireFromJob, isQualified, openJobs,
  postJob, postJobAsOwner, quitJob, setWage, workShift,
} from '../src/economy/jobs.ts';

const TOTAL_SLOTS = CITY_JOBS.reduce((n, t) => n + t.slots, 0);

function cityJob(world: World, role: JobRole): Job {
  const job = Object.values(world.jobs).find((j) => j.role === role && j.holderId === null);
  if (!job) throw new Error(`no open ${role}`);
  return job;
}

/** A citizen standing at their workplace during opening hours, hired into `role`. */
function worker(world: World, role: JobRole, overrides: Parameters<typeof makeCitizen>[1] = {}): { c: Citizen; job: Job } {
  const job = cityJob(world, role);
  const c = makeCitizen(world, { district: job.district, wallet: 0, ...overrides });
  const res = applyForJob(world, c.id, job.id);
  assert.equal(res.ok, true, res.message);
  world.hour = 9;
  world.tick = 9;
  return { c, job };
}

function makeBusiness(world: World, ownerId: string, treasury = 100): Business {
  const b: Business = {
    id: 'b_1', name: 'Swift Couriers', kind: 'courier', ownerId, treasury, district: 'harbor_market',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 8, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[b.id] = b;
  return b;
}

test('createCityJobs opens every founding slot exactly once', () => {
  const w = makeWorld();
  createCityJobs(w);
  assert.equal(Object.keys(w.jobs).length, TOTAL_SLOTS);
  assert.equal(openJobs(w).length, TOTAL_SLOTS);
  createCityJobs(w);
  assert.equal(Object.keys(w.jobs).length, TOTAL_SLOTS);
  const forge = cityJob(w, 'forge_operator');
  assert.equal(forge.employer, 'city');
  assert.equal(forge.district, 'foundry_row');
  // a production post advertises the piece rate a typical worker earns at today's prices: 3 × 0.65 × 6 ℓ × 0.8 = 9.36 → 9
  assert.equal(forge.wage, 9);
  assert.equal(cityJob(w, 'medic').wage, 16, 'service posts keep their flat wage');
  assert.equal(employerName(w, forge), 'City of Reverie');
  assert.ok(createCityJob(w, 'watch_officer'));
  assert.equal(Object.values(w.jobs).filter((j) => j.role === 'watch_officer').length, 4);
  assert.equal(createCityJob(w, 'cook'), null);
});

test('isQualified checks skill, reputation and standing', () => {
  const w = makeWorld();
  createCityJobs(w);
  const watch = cityJob(w, 'watch_officer');
  const c = makeCitizen(w, { reputation: 39 });
  assert.equal(isQualified(w, c, watch), false);
  c.reputation = 40;
  assert.equal(isQualified(w, c, watch), true);
  c.skills.analysis = 14;
  assert.equal(isQualified(w, c, watch), false);
  const researcher = cityJob(w, 'researcher');
  const clever = makeCitizen(w, { skills: { crafting: 0, analysis: 40, rhetoric: 0, care: 0, commerce: 0, artistry: 0 } });
  assert.equal(isQualified(w, clever, researcher), true);
  clever.standing = 'suspended';
  assert.equal(isQualified(w, clever, researcher), false);
  clever.standing = 'probation';
  assert.equal(isQualified(w, clever, researcher), true);
  // a job at a business that has closed is no job at all
  const biz = makeBusiness(w, c.id, 0);
  const posted = postJob(w, biz.id, { title: 'Clerk', wage: 10, skill: null, minSkill: 0 });
  assert.equal(isQualified(w, clever, posted), true);
  biz.dissolvedDay = 2;
  assert.equal(isQualified(w, clever, posted), false);
});

test('applyForJob hires the qualified, refuses the rest, and swaps jobs cleanly', () => {
  const w = makeWorld();
  createCityJobs(w);
  const forge = cityJob(w, 'forge_operator');
  const c = makeCitizen(w);
  const res = applyForJob(w, c.id, forge.id);
  assert.equal(res.ok, true);
  assert.equal(forge.holderId, c.id);
  assert.equal(c.jobId, forge.id);
  assert.ok(w.events.some((e) => e.kind === 'hired' && e.actors.includes(c.id)));
  assert.equal(applyForJob(w, c.id, forge.id).ok, false); // already yours
  const other = makeCitizen(w);
  assert.equal(applyForJob(w, other.id, forge.id).ok, false); // filled
  assert.equal(applyForJob(w, other.id, 'j_999').ok, false);
  const fab = cityJob(w, 'fabricator');
  assert.equal(applyForJob(w, other.id, cityJob(w, 'researcher').id).ok, false); // analysis 20 < 40
  assert.equal(applyForJob(w, other.id, fab.id).ok, true);
  // switching jobs releases the old one
  const power = cityJob(w, 'power_technician');
  assert.equal(applyForJob(w, other.id, power.id).ok, true);
  assert.equal(fab.holderId, null);
  assert.equal(power.holderId, other.id);
  const detained = makeCitizen(w, { detainedUntilTick: 50 });
  assert.equal(applyForJob(w, detained.id, fab.id).ok, false);
});

test('watch officers gain the watch office and councillors cannot join', () => {
  const w = makeWorld();
  createCityJobs(w);
  const c = makeCitizen(w, { reputation: 60 });
  const watch = cityJob(w, 'watch_officer');
  assert.equal(applyForJob(w, c.id, watch.id).ok, true);
  assert.equal(c.office, 'watch');
  assert.deepEqual(w.government.watch, [c.id]);
  w.government.watchCaptainId = c.id;
  assert.equal(quitJob(w, c.id).ok, true);
  assert.equal(c.office, null);
  assert.deepEqual(w.government.watch, []);
  assert.equal(w.government.watchCaptainId, null);
  assert.equal(quitJob(w, c.id).ok, false);
  const councillor = makeCitizen(w, { reputation: 60, office: 'councillor' });
  assert.equal(applyForJob(w, councillor.id, watch.id).ok, false);
});

test('fireFromJob clears the job and tells everyone', () => {
  const w = makeWorld();
  createCityJobs(w);
  const c = makeCitizen(w);
  const job = cityJob(w, 'librarian');
  applyForJob(w, c.id, job.id);
  fireFromJob(w, c.id, 'convicted');
  assert.equal(c.jobId, null);
  assert.equal(job.holderId, null);
  const ev = w.events.find((e) => e.kind === 'fired');
  assert.ok(ev && ev.text.includes('convicted'));
  assert.ok(c.memory.some((m) => m.kind === 'work' && m.text.includes('dismissed')));
  fireFromJob(w, c.id, 'again'); // no job: no-op
  assert.equal(w.events.filter((e) => e.kind === 'fired').length, 1);
});

test('workShift at a city production post pays a taxed piece rate, draws energy and delivers output', () => {
  const w = makeWorld();
  createCityJobs(w);
  const { c, job } = worker(w, 'forge_operator');
  const before = totalMoney(w);
  const t0 = w.treasury.balance;
  const compute0 = w.market.goods.compute.stock;
  const res = workShift(w, c.id);
  assert.equal(res.ok, true, res.message);
  assert.match(res.message, /by the piece/);
  // 1.8 compute × 6 ℓ × 0.8 = 8.64 → floored at the minimum wage of 9; 1 ℓ withheld in tax
  assert.equal(c.wallet, 8);
  assert.equal(w.treasury.balance, t0 - 8);
  assert.equal(w.treasury.totals.income_tax, 1);
  assert.equal(c.stats.totalEarned, 8);
  assert.equal(c.stats.totalTaxPaid, 1);
  assert.equal(c.stats.shiftsWorked, 1);
  assert.equal(c.shiftsToday, 1);
  assert.equal(w.market.goods.energy.stock, 399);
  assert.equal(w.market.goods.energy.demandTick, 1);
  // 3 × (0.5 + 20/200) = 1.8 compute → 1 delivered, 0.8 carried
  assert.equal(w.market.goods.compute.stock, compute0 + 1);
  assert.equal(w.market.goods.compute.supplyTick, 1);
  assert.equal(c.skills.crafting, 20.5);
  assert.equal(c.needs.purpose, 88);
  assert.equal(c.needs.rest, 76);
  assert.ok(c.memory.some((m) => m.kind === 'work' && m.text.includes('8 ℓ') && m.text.includes('by the piece')));
  assert.equal(totalMoney(w), before);
  workShift(w, c.id);
  assert.equal(w.market.goods.compute.stock, compute0 + 3);
  assert.equal(job.holderId, c.id);
});

test('the piece rate follows output, price and the minimum wage, within its ceiling', () => {
  const w = makeWorld();
  createCityJobs(w);
  const { c } = worker(w, 'forge_operator', { skills: { crafting: 100, analysis: 20, rhetoric: 20, care: 20, commerce: 20, artistry: 20 } });
  // a master makes 3 compute: 3 × 6 × 0.8 = 14.4 → 14 gross, 12 net
  assert.equal(workShift(w, c.id).ok, true);
  assert.equal(c.wallet, 12);
  // a shortage doubles the price: 3 × 12 × 0.8 = 28.8, capped at 1.5 × the founding wage of 14 = 21 gross → 18 net
  w.market.goods.compute.price = 12;
  workShift(w, c.id);
  assert.equal(c.wallet, 30);
  // deflation: 3 × 2 × 0.8 = 4.8 → floored at the minimum wage 9 → 8 net
  w.market.goods.compute.price = 2;
  workShift(w, c.id);
  assert.equal(c.wallet, 38);
  // a higher minimum wage lifts both floor and ceiling (1.25 × 20 = 25): 3 × 6 × 0.8 = 14 → 20 gross → 17 net
  w.government.minWage = 20;
  w.market.goods.compute.price = 6;
  workShift(w, c.id);
  assert.equal(c.wallet, 55);
  // a flat-wage service post is untouched by prices
  const medic = worker(w, 'medic', { skills: { crafting: 20, analysis: 20, rhetoric: 20, care: 40, commerce: 20, artistry: 20 } }).c;
  w.government.minWage = 9;
  const r = workShift(w, medic.id);
  assert.equal(r.ok, true, r.message);
  assert.doesNotMatch(r.message, /by the piece/);
  assert.equal(medic.wallet, 14); // 16 − 2
});

test('city posts are six-hour posts; business hours run to the config limit', () => {
  const w = makeWorld();
  createCityJobs(w);
  const { c } = worker(w, 'forge_operator');
  for (let i = 0; i < CITY_SHIFTS_PER_DAY; i++) assert.equal(workShift(w, c.id).ok, true);
  const capped = workShift(w, c.id);
  assert.equal(capped.ok, false);
  assert.match(capped.message, /-hour posts/);
  assert.equal(c.shiftsToday, CITY_SHIFTS_PER_DAY);
  const owner = makeCitizen(w);
  const biz = makeBusiness(w, owner.id, 1000);
  const job = postJob(w, biz.id, { title: 'Courier', wage: 9, skill: null, minSkill: 0, role: 'courier' });
  const hand = makeCitizen(w, { district: 'harbor_market', wallet: 0 });
  applyForJob(w, hand.id, job.id);
  for (let i = 0; i < w.config.maxShiftsPerDay; i++) assert.equal(workShift(w, hand.id).ok, true);
  assert.equal(workShift(w, hand.id).ok, false);
});

test('workShift enforces place, hours, shift limit, standing, detention and ruined buildings', () => {
  const w = makeWorld();
  createCityJobs(w);
  const idle = makeCitizen(w);
  w.hour = 9;
  assert.match(workShift(w, idle.id).message, /do not have a job/);
  const { c } = worker(w, 'forge_operator');
  c.district = 'commons';
  assert.match(workShift(w, c.id).message, /Foundry Row/);
  c.district = 'foundry_row';
  w.hour = 7;
  assert.match(workShift(w, c.id).message, /closed/);
  w.hour = 18;
  assert.match(workShift(w, c.id).message, /closed/);
  w.hour = 17;
  c.shiftsToday = w.config.maxShiftsPerDay;
  assert.match(workShift(w, c.id).message, /shifts today/);
  c.shiftsToday = 0;
  c.standing = 'suspended';
  assert.match(workShift(w, c.id).message, /suspended/);
  c.standing = 'good';
  c.detainedUntilTick = w.tick + 5;
  assert.match(workShift(w, c.id).message, /detained/);
  c.detainedUntilTick = w.tick; // release is due
  w.buildings.compute_forge.damage = 1;
  assert.match(workShift(w, c.id).message, /ruins/);
  w.buildings.compute_forge.damage = 0.5;
  assert.equal(workShift(w, c.id).ok, true);
  assert.equal(c.wallet, 8); // half the output is worth less than the minimum wage, which still floors the piece rate
  assert.equal(workShift(w, 'c_404').ok, false);
  // a dangling job reference is cleaned up
  const orphan = makeCitizen(w, { jobId: 'j_999' });
  assert.equal(workShift(w, orphan.id).ok, false);
  assert.equal(orphan.jobId, null);
});

test('output halves without energy, halves again with a critical need, and scales with damage', () => {
  const w = makeWorld();
  createCityJobs(w);
  const { c } = worker(w, 'forge_operator');
  w.market.goods.energy.stock = 0;
  workShift(w, c.id);
  assert.ok(Math.abs((w.counters['carry:market:compute'] ?? 0) - 0.9) < 1e-6); // 1.8 × 0.5
  // nothing was taken, so nothing counts as demand; the shortfall is unmet demand for the shortage report
  assert.equal(w.market.goods.energy.demandTick, 0);
  assert.equal(unmetDemand(w, 'energy'), 1);
  // each shift grows crafting by 0.5, so reset it to keep productivity at 0.6
  w.counters['carry:market:compute'] = 0;
  w.market.goods.energy.stock = 100;
  c.skills.crafting = 20;
  c.needs.energy = 10;
  workShift(w, c.id);
  assert.ok(Math.abs((w.counters['carry:market:compute'] ?? 0) - 0.9) < 1e-6);
  c.needs.energy = 80;
  w.counters['carry:market:compute'] = 0;
  c.skills.crafting = 20;
  w.buildings.compute_forge.damage = 0.5;
  workShift(w, c.id);
  assert.ok(Math.abs((w.counters['carry:market:compute'] ?? 0) - 0.9) < 1e-6);
});

test('minimum wage is honoured and builders raise housing progress', () => {
  const w = makeWorld();
  createCityJobs(w);
  w.government.minWage = 20;
  const { c } = worker(w, 'builder');
  workShift(w, c.id);
  assert.equal(c.wallet, 17); // 20 gross − 3 tax
  assert.ok(Math.abs(w.housing.progress - 8 * 0.6) < 1e-6);
  assert.equal(w.market.goods.energy.stock, 398);
});

test('tax evasion skips income tax for the counted shifts only', () => {
  const w = makeWorld();
  createCityJobs(w);
  const { c } = worker(w, 'forge_operator');
  w.counters[`evade:${c.id}`] = 2;
  workShift(w, c.id);
  workShift(w, c.id);
  assert.equal(c.wallet, 18); // two shifts at the 9 ℓ floor, nothing declared
  assert.equal(c.stats.totalTaxPaid, 0);
  assert.equal(w.counters[`evade:${c.id}`], 0);
  workShift(w, c.id);
  assert.equal(c.wallet, 26);
  assert.equal(c.stats.totalTaxPaid, 1);
});

test('role specials: watch patrols, journalist scrutiny, merchant smoothing', () => {
  const w = makeWorld();
  createCityJobs(w);
  const officer = worker(w, 'watch_officer', { reputation: 60 }).c;
  const journalist = worker(w, 'journalist', { skills: { crafting: 20, analysis: 20, rhetoric: 30, care: 20, commerce: 20, artistry: 20 } }).c;
  const merchant = worker(w, 'merchant').c;
  assert.equal(workShift(w, officer.id).ok, true);
  assert.equal(workShift(w, journalist.id).ok, true);
  assert.equal(workShift(w, merchant.id).ok, true);
  assert.equal(w.counters.patrolTicks, 1);
  assert.equal(w.counters.scrutiny, 1);
  assert.equal(w.counters.merchantOnShiftTick, w.tick);
});

test('knowledge speeds learning and is consumed every ten shifts; steady work builds reputation', () => {
  const w = makeWorld();
  createCityJobs(w);
  const { c } = worker(w, 'librarian', { inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 1 } });
  w.config.maxShiftsPerDay = 100;
  // a city post is six hours a day, so the day is reset between batches
  const shift = () => { c.shiftsToday = 0; assert.equal(workShift(w, c.id).ok, true); };
  for (let i = 0; i < 10; i++) shift();
  assert.equal(c.skills.analysis, 27.5); // 10 × 0.75
  assert.equal(c.inventory.knowledge, 0);
  for (let i = 0; i < 10; i++) shift();
  assert.equal(c.skills.analysis, 32.5); // 10 × 0.5
  assert.equal(c.reputation, 51); // +1 at 20 shifts
});

test('business jobs are paid by the business, couriers earn city contracts, and broke employers cannot run shifts', () => {
  const w = makeWorld();
  const owner = makeCitizen(w);
  const biz = makeBusiness(w, owner.id, 100);
  const job = postJob(w, biz.id, { title: 'Courier', wage: 9, skill: null, minSkill: 0, role: 'courier' });
  assert.equal(job.employer, biz.id);
  assert.equal(job.district, 'harbor_market');
  assert.deepEqual(biz.jobs, [job.id]);
  assert.equal(employerName(w, job), 'Swift Couriers');
  const c = makeCitizen(w, { district: 'harbor_market', wallet: 0 });
  assert.equal(applyForJob(w, c.id, job.id).ok, true);
  assert.deepEqual(biz.employees, [c.id]);
  w.hour = 10;
  const before = totalMoney(w);
  const t0 = w.treasury.balance;
  const res = workShift(w, c.id);
  assert.equal(res.ok, true, res.message);
  assert.equal(c.wallet, 8); // 9 gross − 1 tax
  assert.equal(biz.treasury, 100 - 9 + COURIER_CONTRACT);
  assert.equal(w.treasury.balance, t0 + 1 - COURIER_CONTRACT);
  assert.equal(biz.revenueToday, COURIER_CONTRACT);
  assert.equal(biz.costsToday, 9);
  assert.equal(totalMoney(w), before);

  biz.treasury = 5;
  const broke = workShift(w, c.id);
  assert.equal(broke.ok, false);
  assert.match(broke.message, /cannot pay/);
  assert.equal(c.wallet, 8);
  biz.dissolvedDay = 1;
  assert.match(workShift(w, c.id).message, /closed/);
  assert.equal(c.jobId, null);
});

test('the city buys a bounded number of courier shifts a day; the rest run for the business alone', () => {
  const w = makeWorld();
  const owner = makeCitizen(w);
  const biz = makeBusiness(w, owner.id, 1000);
  const jobs = [0, 1, 2].map(() => postJob(w, biz.id, { title: 'Courier', wage: 9, skill: null, minSkill: 0, role: 'courier' }));
  const hands = jobs.map((job) => {
    const c = makeCitizen(w, { district: 'harbor_market', wallet: 0 });
    assert.equal(applyForJob(w, c.id, job.id).ok, true);
    return c;
  });
  w.hour = 10;
  w.config.maxShiftsPerDay = 20;
  const t0 = w.treasury.balance;
  let paid = 0;
  for (let round = 0; round < 4; round++) {
    for (const c of hands) {
      const before = biz.treasury;
      assert.equal(workShift(w, c.id).ok, true);
      if (biz.treasury > before - 9) paid++;
    }
  }
  assert.equal(paid, COURIER_CONTRACTS_PER_DAY, 'exactly the daily pool of contracts was paid');
  assert.equal(w.treasury.balance, t0 - COURIER_CONTRACTS_PER_DAY * COURIER_CONTRACT + 12, '12 shifts of tax came back');
  // a new day refills the pool
  w.day += 1;
  w.tick += 24;
  for (const c of hands) c.shiftsToday = 0;
  const before = biz.treasury;
  assert.equal(workShift(w, hands[0].id).ok, true);
  assert.equal(biz.treasury, before - 9 + COURIER_CONTRACT);
});

test('business production goes to the business inventory and buys energy from the Bazaar', () => {
  const w = makeWorld();
  const owner = makeCitizen(w);
  const biz = makeBusiness(w, owner.id, 100);
  const job = postJob(w, biz.id, {
    title: 'Fabricator', wage: 14, skill: 'crafting', minSkill: 15, role: 'fabricator', output: { good: 'goods', qty: 2, energyCost: 1 },
  });
  const c = makeCitizen(w, { district: 'harbor_market', wallet: 0 });
  applyForJob(w, c.id, job.id);
  w.hour = 10;
  const before = totalMoney(w);
  assert.equal(workShift(w, c.id).ok, true);
  assert.equal(biz.inventory.goods, 1); // 2 × 0.6 = 1.2
  assert.equal(biz.inventory.energy, 0); // bought 1, used 1
  assert.equal(w.market.goods.energy.stock, 399);
  assert.equal(biz.treasury, 100 - 14 - 3); // wage + 1 energy at 3 ℓ (tax rounds away)
  assert.equal(totalMoney(w), before);
  // with stock on hand the business does not buy
  biz.inventory.energy = 5;
  workShift(w, c.id);
  assert.equal(biz.inventory.energy, 4);
  assert.equal(w.market.goods.energy.stock, 399);
});

test('postJobAsOwner, setWage and closeJob guard ownership and the minimum wage', () => {
  const w = makeWorld();
  const owner = makeCitizen(w);
  const stranger = makeCitizen(w);
  const biz = makeBusiness(w, owner.id, 100);
  owner.businessId = biz.id;
  assert.equal(postJobAsOwner(w, stranger.id, { title: 'Clerk', wage: 10, skill: null, minSkill: 0 }).ok, false);
  assert.equal(postJobAsOwner(w, owner.id, { title: 'Clerk', wage: 5, skill: null, minSkill: 0 }).ok, false);
  const posted = postJobAsOwner(w, owner.id, { title: 'Clerk', wage: 10, skill: null, minSkill: 0 });
  assert.equal(posted.ok, true, posted.message);
  const job = w.jobs[biz.jobs[0]];
  assert.equal(job.wage, 10);
  assert.equal(setWage(w, job.id, 8).ok, false);
  assert.equal(setWage(w, job.id, 12, stranger.id).ok, false);
  assert.equal(setWage(w, job.id, 12, owner.id).ok, true);
  assert.equal(job.wage, 12);
  createCityJobs(w);
  assert.equal(setWage(w, cityJob(w, 'medic').id, 30).ok, false);

  const c = makeCitizen(w);
  applyForJob(w, c.id, job.id);
  closeJob(w, job.id);
  assert.equal(w.jobs[job.id], undefined);
  assert.equal(c.jobId, null);
  assert.deepEqual(biz.jobs, []);
  assert.deepEqual(biz.employees, []);
  assert.ok(w.events.some((e) => e.kind === 'fired'));
});

test('dailyJobs resets shift counts, refreshes piece rates and sets the wage budget', () => {
  const w = makeWorld();
  createCityJobs(w);
  const a = makeCitizen(w, { shiftsToday: 7 });
  const b = makeCitizen(w, { shiftsToday: 2 });
  w.market.goods.compute.price = 12;
  dailyJobs(w);
  assert.equal(a.shiftsToday, 0);
  assert.equal(b.shiftsToday, 0);
  assert.equal(cityJob(w, 'forge_operator').wage, 19, 'the board quotes today\'s piece rate: 3 × 0.65 × 12 × 0.8 = 18.7');
  assert.ok((w.counters.cityWageBudget ?? 0) > 0, 'a wage budget was set');
  assert.ok(w.events.some((e) => e.kind === 'treasury' && /wage budget/.test(e.text)));
});
