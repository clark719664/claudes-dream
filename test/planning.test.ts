import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Job, JobRole, World } from '../src/types.ts';
import { CITY_JOBS, CITY_POST_LIMITS, SERVICE_POST_PER_CITIZENS } from '../src/data/jobs.ts';
import { applyForJob, createCityJobs, dailyJobs } from '../src/economy/jobs.ts';
import { anchorPrice, bazaarBuying, sellToMarket, tickMarket } from '../src/economy/market.ts';
import {
  GLUT_COVER_DAYS, LAYOFF_COVER_DAYS, PLANNING_FROM_DAY, SHORTAGE_COVER_DAYS, isPieceRateJob, joblessShare, maxPosts, pieceRate,
  planCityPosts, postRunsAtLoss, postToClose, postedPieceRate, refreshCityWages, servicePostsWanted,
} from '../src/economy/planning.ts';

function posts(world: World, role: JobRole): Job[] {
  return Object.values(world.jobs).filter((j) => j.employer === 'city' && j.role === role);
}

function template(role: JobRole) {
  return CITY_JOBS.find((t) => t.role === role)!;
}

/** Give a good a steady demand history of `perDay` units so cover and flow signals are meaningful. */
function demandHistory(world: World, good: 'compute' | 'goods' | 'culture' | 'energy', perDay: number, supplyPerDay = 0): void {
  world.counters[`flow:demand:${good}`] = perDay / 24;
  world.counters[`flow:supply:${good}`] = supplyPerDay / 24;
}

function planningDay(world: World): void {
  world.day = PLANNING_FROM_DAY;
  world.tick = world.day * 24;
  world.hour = 0;
}

test('piece rates: value share, floored at the minimum wage, capped at the ceiling; service posts are flat', () => {
  const w = makeWorld();
  createCityJobs(w);
  const forge = posts(w, 'forge_operator')[0];
  const medic = posts(w, 'medic')[0];
  assert.equal(isPieceRateJob(forge), true);
  assert.equal(isPieceRateJob(medic), false);
  assert.equal(pieceRate(w, forge, 0), 9, 'no output still earns the minimum wage');
  assert.equal(pieceRate(w, forge, Number.NaN), 9);
  assert.equal(pieceRate(w, forge, 1.8), 9); // 8.64 floored
  assert.equal(pieceRate(w, forge, 3), 14); // 14.4
  assert.equal(pieceRate(w, forge, 30), 21, 'capped at 1.5 × the founding wage');
  w.government.minWage = 20;
  assert.equal(pieceRate(w, forge, 3), 20);
  assert.equal(pieceRate(w, forge, 30), 25, 'the ceiling follows a higher minimum wage (1.25×)');
  w.government.minWage = 9;
  assert.equal(postedPieceRate(w, forge), 9);
  w.market.goods.compute.price = 12;
  assert.equal(postedPieceRate(w, forge), 19); // 3 × 0.65 × 12 × 0.8 = 18.72
  refreshCityWages(w);
  assert.equal(forge.wage, 19);
  assert.equal(medic.wage, 16, 'flat wages are not refreshed');
});

test('the cost of production sets the price anchor when the minimum wage rises', () => {
  const w = makeWorld();
  assert.equal(anchorPrice(w, 'compute'), 6, 'at the founding minimum wage the anchor is the founding price');
  assert.equal(anchorPrice(w, 'knowledge'), 15, 'goods no piece-rate post makes keep their founding anchor');
  w.government.minWage = 18;
  // 18 ℓ ÷ (3 × 0.65 × 0.8 = 1.56 compute per wage) = 11.5
  assert.ok(Math.abs(anchorPrice(w, 'compute') - 11.54) < 0.01, `anchor ${anchorPrice(w, 'compute')}`);
  assert.equal(anchorPrice(w, 'knowledge'), 15);
  assert.equal(postRunsAtLoss(w, template('forge_operator')), true, 'at 6 ℓ a shift is worth less than 18 ℓ');
  // a quiet market drifts toward the cost anchor, where a typical shift breaks even
  for (let i = 0; i < 200; i++) tickMarket(w);
  assert.ok(w.market.goods.compute.price >= 11, `price rose toward cost (got ${w.market.goods.compute.price})`);
  w.market.goods.compute.price = 12;
  assert.equal(postRunsAtLoss(w, template('forge_operator')), false);
  assert.equal(postRunsAtLoss(w, template('medic')), false, 'service posts never run at a loss');
});

test('the plan waits for the demand averages, then opens a post in a shortage and closes vacant posts in a glut', () => {
  const w = makeWorld();
  createCityJobs(w);
  // balanced histories for the other goods, so only the good under test moves its posts
  demandHistory(w, 'goods', 30, 30);
  demandHistory(w, 'culture', 20, 20);
  demandHistory(w, 'energy', 100, 100);
  demandHistory(w, 'compute', 80, 80);
  w.market.goods.compute.stock = 40; // half a day
  assert.deepEqual(planCityPosts(w), [], 'nothing before day 2');
  planningDay(w);
  const open = planCityPosts(w).find((c) => c.role === 'forge_operator');
  assert.ok(open && open.open === 1 && open.close === 0, 'a forge post opens');
  assert.match(open.reason, /only 0\.5 days of compute/);
  const before = posts(w, 'forge_operator').length;
  dailyJobs(w);
  assert.equal(posts(w, 'forge_operator').length, before + 1);
  assert.ok(w.events.some((e) => e.kind === 'hired' && /opened a Forge Operator post/.test(e.text)));
  // an empty shelf is a shortage whatever the cover says
  w.market.goods.compute.stock = 0;
  w.market.shortages = ['compute'];
  assert.ok(planCityPosts(w).some((c) => c.role === 'forge_operator' && c.open === 1 && /run out/.test(c.reason)));
  // but never beyond the role's maximum
  while (posts(w, 'forge_operator').length < maxPosts(w, 'forge_operator')) dailyJobs(w);
  assert.equal(planCityPosts(w).some((c) => c.role === 'forge_operator' && c.open === 1), false);

  // a glut: weeks of goods on the shelf; vacant fabricator posts close one a day
  demandHistory(w, 'goods', 10, 10);
  w.market.goods.goods.stock = 10 * (GLUT_COVER_DAYS + 1);
  const glut = planCityPosts(w).find((c) => c.role === 'fabricator');
  assert.ok(glut && glut.close === 1 && !glut.layoff, 'a vacant fabricator post closes');
  assert.match(glut.reason, /days of goods/);
  const fabs = posts(w, 'fabricator').length;
  dailyJobs(w);
  assert.equal(posts(w, 'fabricator').length, fabs - 1);
  assert.ok(w.events.some((e) => /closed a vacant Fabricator post/.test(e.text)));
  // a filled post survives an ordinary glut...
  w.market.goods.goods.stock = 10 * (GLUT_COVER_DAYS + 1);
  for (const j of posts(w, 'fabricator')) {
    const c = makeCitizen(w, { district: j.district });
    assert.equal(applyForJob(w, c.id, j.id).ok, true);
  }
  assert.equal(planCityPosts(w).some((c) => c.role === 'fabricator'), false);
  // ...but a deep one lets the least productive worker go, down to the minimum
  w.market.goods.goods.stock = 10 * (LAYOFF_COVER_DAYS + 1);
  const deep = planCityPosts(w).find((c) => c.role === 'fabricator');
  assert.ok(deep && deep.layoff, 'a layoff is planned');
  const holders = posts(w, 'fabricator').map((j) => w.citizens[j.holderId!]);
  for (const h of holders) h.skills.crafting = 60;
  holders[0].skills.crafting = 90;
  const weakest = holders[1];
  weakest.skills.crafting = 21;
  assert.equal(postToClose(w, 'fabricator')?.holderId, weakest.id);
  dailyJobs(w);
  assert.equal(weakest.jobId, null);
  assert.ok(w.events.some((e) => e.kind === 'fired' && e.text.includes(`let ${weakest.name} go as Fabricator`)));
  const min = CITY_POST_LIMITS.fabricator!.min;
  for (let i = 0; i < 10; i++) dailyJobs(w);
  assert.equal(posts(w, 'fabricator').length, min, 'never below the minimum');
});

test('oversupply on a thin shelf is a glut too, and a crushed price is grounds for a layoff', () => {
  const w = makeWorld();
  createCityJobs(w);
  planningDay(w);
  demandHistory(w, 'compute', 80, 120);
  w.market.goods.compute.stock = 80 * SHORTAGE_COVER_DAYS + 40; // comfortably above the shortage line, well below the glut line
  const glut = planCityPosts(w).find((c) => c.role === 'forge_operator');
  assert.ok(glut && glut.close === 1 && !glut.layoff);
  assert.match(glut.reason, /made faster than it sells/);
  for (const j of posts(w, 'forge_operator')) applyForJob(w, makeCitizen(w, { district: j.district }).id, j.id);
  assert.equal(planCityPosts(w).some((c) => c.role === 'forge_operator'), false, 'a fair price keeps everyone on');
  w.market.goods.compute.price = 4; // 0.67 of the anchor
  const crushed = planCityPosts(w).find((c) => c.role === 'forge_operator');
  assert.ok(crushed && crushed.layoff);
});

test('a post that runs at a loss under a high minimum wage closes toward the minimum; a shortage reopens it', () => {
  const w = makeWorld();
  createCityJobs(w);
  planningDay(w);
  demandHistory(w, 'compute', 80, 80);
  w.market.goods.compute.stock = 400; // five days
  w.government.minWage = 25;
  const change = planCityPosts(w).find((c) => c.role === 'forge_operator');
  assert.ok(change && change.close === 1);
  assert.match(change.reason, /worth less than the minimum wage/);
  w.market.goods.compute.stock = 0;
  const reopen = planCityPosts(w).find((c) => c.role === 'forge_operator');
  assert.ok(reopen && reopen.open === 1, 'people must eat even when the forge loses money');
});

test('service posts grow with the population and are never taken from their holders; builders follow housing and idle hands', () => {
  const w = makeWorld();
  createCityJobs(w);
  planningDay(w);
  for (let i = 0; i < w.config.seedPopulation + SERVICE_POST_PER_CITIZENS; i++) makeCitizen(w);
  assert.equal(servicePostsWanted(w, 'medic'), template('medic').slots + 1);
  assert.equal(servicePostsWanted(w, 'banker'), 0, 'the banker is not a scaled role');
  const grow = planCityPosts(w).filter((c) => c.open === 1 && /grown/.test(c.reason)).map((c) => c.role).sort();
  assert.deepEqual(grow, ['journalist', 'librarian', 'medic', 'merchant', 'researcher', 'teacher']);
  dailyJobs(w);
  assert.equal(posts(w, 'medic').length, 3);
  // the city shrinks again: only vacant posts go, filled ones stay
  for (const j of posts(w, 'medic')) {
    const c = makeCitizen(w, { district: j.district, skills: { crafting: 20, analysis: 20, rhetoric: 20, care: 40, commerce: 20, artistry: 20 } });
    assert.equal(applyForJob(w, c.id, j.id).ok, true);
  }
  w.order.splice(0, SERVICE_POST_PER_CITIZENS + 5);
  assert.equal(planCityPosts(w).some((c) => c.role === 'medic'), false, 'held service posts are kept');

  // builders: plenty of homes and no unemployment → a vacant post closes; a jobless third → the Yard hires
  const w2 = makeWorld();
  createCityJobs(w2);
  planningDay(w2);
  assert.ok(planCityPosts(w2).find((c) => c.role === 'builder' && c.close === 1), 'homes stand empty');
  for (let i = 0; i < 10; i++) makeCitizen(w2);
  assert.equal(joblessShare(w2), 1);
  w2.housing.capacity = { 1: 5, 2: 1, 3: 0 };
  w2.housing.occupied = { 1: 0, 2: 0, 3: 0 };
  const works = planCityPosts(w2).find((c) => c.role === 'builder');
  assert.ok(works && works.open === 1);
  assert.match(works.reason, /out of work/);
  w2.housing.occupied = { 1: 4, 2: 0, 3: 0 };
  assert.match(planCityPosts(w2).find((c) => c.role === 'builder')!.reason, /stand empty/);
});

test('the Bazaar stops buying a good it holds days of; money is conserved either way', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { inventory: { compute: 0, energy: 0, goods: 50, culture: 0, knowledge: 0 } });
  assert.equal(bazaarBuying(w, 'goods'), true, 'no demand history: always bought');
  const before = totalMoney(w);
  assert.equal(sellToMarket(w, c.id, 'goods', 10).ok, true);
  demandHistory(w, 'goods', 10, 10);
  w.market.goods.goods.stock = 100;
  assert.equal(bazaarBuying(w, 'goods'), false);
  const refused = sellToMarket(w, c.id, 'goods', 10);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /not buying goods today/);
  assert.equal(c.inventory.goods, 40);
  w.market.goods.goods.stock = 20;
  assert.equal(sellToMarket(w, c.id, 'goods', 10).ok, true);
  assert.equal(totalMoney(w), before);
});
