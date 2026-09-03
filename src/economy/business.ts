/**
 * Citizen-owned businesses: founded at the Exchange, staffed through the job
 * board, selling their output to the Bazaar every hour and settling rent,
 * profit tax and the owner's payout every day.
 */
import { GOODS, clamp } from '../types.ts';
import type { ActionResult, Business, BusinessId, BusinessKind, CitizenId, DistrictId, JobId, World } from '../types.ts';
import { BUSINESS_CAPITAL, BUSINESS_FOUNDING_COST, BUSINESS_JOBS, BUSINESS_RENT } from '../data/jobs.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer, withholdingPay } from './treasury.ts';
import { deliverToMarket, sellToMarket } from './market.ts';
import { assignJob, closeJob, fireFromJob, isQualified, postJob } from './jobs.ts';

/** Cash a business keeps on hand before paying the owner. */
export const PAYOUT_RESERVE = 100;
/** Share of the surplus above the reserve paid to the owner each day. */
export const PAYOUT_SHARE = 0.5;
/** Consecutive bad days before a business is declared bankrupt. */
export const BANKRUPTCY_DAYS = 3;
/** Owner's reputation loss when their business goes under. */
const BANKRUPTCY_REPUTATION = 5;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** Every business still trading. */
export function activeBusinesses(world: World): Business[] {
  return Object.values(world.businesses).filter((b) => b.dissolvedDay === null);
}

function premisesFor(kind: BusinessKind): { district: DistrictId; buildingId: string } {
  return kind === 'cafe' || kind === 'studio'
    ? { district: 'nightglass', buildingId: 'shopfronts_nightglass' }
    : { district: 'harbor_market', buildingId: 'shopfronts_harbor' };
}

function nameTaken(world: World, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return activeBusinesses(world).some((b) => b.name.trim().toLowerCase() === wanted);
}

export function foundBusiness(world: World, ownerId: CitizenId, name: string, kind: BusinessKind): ActionResult {
  const c = world.citizens[ownerId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing !== 'good') return fail('Only citizens in good standing may found a business.');
  if (c.businessId && world.businesses[c.businessId]?.dissolvedDay === null) return fail('You already own a business.');
  if (!BUSINESS_JOBS[kind]) return fail(`There is no such kind of business as ${String(kind)}.`);
  const trimmed = (name ?? '').trim();
  if (!trimmed) return fail('A business needs a name.');
  if (nameTaken(world, trimmed)) return fail(`There is already a business called ${trimmed}.`);
  if (c.wallet < BUSINESS_FOUNDING_COST) return fail(`Founding a business costs ${BUSINESS_FOUNDING_COST} ℓ; you have ${c.wallet} ℓ.`);

  const { district, buildingId } = premisesFor(kind);
  const id = nextId(world, 'b');
  const biz: Business = {
    id, name: trimmed, kind, ownerId, treasury: 0, district, buildingId, employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: world.day, rentPerDay: BUSINESS_RENT[kind], daysNegative: 0,
    revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[id] = biz;
  if (!transfer(world, ownerId, id, BUSINESS_CAPITAL, 'capital', `founding capital for ${trimmed}`)) {
    delete world.businesses[id];
    return fail('The founding capital could not be paid.');
  }
  const fee = BUSINESS_FOUNDING_COST - BUSINESS_CAPITAL;
  if (fee > 0) transfer(world, ownerId, 'treasury', fee, 'fee', `registration of ${trimmed} at the Exchange`);
  c.businessId = id;

  for (const t of BUSINESS_JOBS[kind]) {
    for (let i = 0; i < t.slots; i++) {
      postJob(world, id, {
        title: t.title, wage: Math.max(t.wage, world.government.minWage), skill: t.skill, minSkill: t.minSkill,
        role: t.role, output: { ...t.output },
      });
    }
  }
  emit(world, 'business_founded', `${c.name} founded ${trimmed}, a ${kind} in ${district === 'nightglass' ? 'Nightglass' : 'Harbor Market'}.`,
    [ownerId], 0.5, { businessId: id, kind });
  remember(world, ownerId, 'money', `You founded ${trimmed} (${kind}) with ${BUSINESS_CAPITAL} ℓ of capital and posted ${biz.jobs.length} jobs.`);
  return ok(`You founded ${trimmed}; ${biz.jobs.length} positions are open.`);
}

/** Direct hire by the owner into one of the business's open jobs. */
export function hireCitizen(world: World, businessId: BusinessId, cId: CitizenId, jobId: JobId): ActionResult {
  const biz = world.businesses[businessId];
  if (!biz || biz.dissolvedDay !== null) return fail('That business has closed its doors.');
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const job = world.jobs[jobId];
  if (!job || job.employer !== businessId) return fail(`${biz.name} has no such position.`);
  if (job.holderId === cId) return fail(`${c.name} already holds that position.`);
  if (job.holderId) return fail('That position is already filled.');
  if (c.standing !== 'good' && c.standing !== 'probation') return fail(`${c.name} is ${c.standing} and cannot be hired.`);
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail(`${c.name} is detained.`);
  if (!isQualified(world, c, job)) return fail(`${c.name} is not qualified for ${job.title}.`);
  if (job.role === 'watch_officer' && c.office && c.office !== 'watch') return fail(`${c.name} holds office and cannot join the Watch.`);

  assignJob(world, c, job);
  emit(world, 'hired', `${biz.name} hired ${c.name} as ${job.title}.`, [biz.ownerId, cId], 0.2, { jobId, businessId });
  remember(world, cId, 'work', `You were hired as ${job.title} at ${biz.name} (${job.wage} ℓ per shift).`);
  remember(world, biz.ownerId, 'work', `You hired ${c.name} as ${job.title} at ${biz.name}.`);
  return ok(`You hired ${c.name} as ${job.title}.`);
}

export function fireCitizen(world: World, businessId: BusinessId, cId: CitizenId): ActionResult {
  const biz = world.businesses[businessId];
  if (!biz || biz.dissolvedDay !== null) return fail('That business has closed its doors.');
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const job = c.jobId ? world.jobs[c.jobId] : null;
  if (!job || job.employer !== businessId) return fail(`${c.name} does not work for ${biz.name}.`);
  fireFromJob(world, cId, `dismissed by ${world.citizens[biz.ownerId]?.name ?? 'the owner'}`);
  remember(world, biz.ownerId, 'work', `You dismissed ${c.name} from ${biz.name}.`);
  return ok(`You dismissed ${c.name}.`);
}

/** Every hour each business puts its finished goods on the Bazaar (energy is kept as an input). */
export function hourlyBusinesses(world: World): void {
  for (const biz of activeBusinesses(world)) {
    for (const good of GOODS) {
      if (good === 'energy') continue;
      const qty = Math.floor(biz.inventory[good]);
      if (qty > 0) sellToMarket(world, biz.id, good, qty);
    }
  }
}

/** Settle one business's day: rent, profit tax, owner's payout, solvency. */
function settleDay(world: World, biz: Business): void {
  const owner = world.citizens[biz.ownerId] ?? null;
  const rent = Math.round(biz.rentPerDay);
  const rentPaid = rent <= 0 || transfer(world, biz.id, 'treasury', rent, 'rent', `premises rent for ${biz.name}`);

  const profit = biz.revenueToday - biz.costsToday;
  if (profit > 0) {
    const tax = Math.round(profit * clamp(world.government.profitTax, 0, 1));
    if (tax > 0) transfer(world, biz.id, 'treasury', Math.min(tax, biz.treasury), 'profit_tax', `profit tax for ${biz.name}`);
  }

  // the owner is paid out of a profitable day's surplus; a loss-making business keeps its capital to trade on
  if (owner && (owner.standing === 'good' || owner.standing === 'probation') && profit > 0 && biz.treasury > PAYOUT_RESERVE) {
    const payout = Math.round((biz.treasury - PAYOUT_RESERVE) * PAYOUT_SHARE);
    const { net, tax } = withholdingPay(world, biz.id, owner.id, payout, 'payout', `owner's payout from ${biz.name}`);
    if (net > 0) remember(world, owner.id, 'money', `${biz.name} paid you ${net} ℓ (${tax} ℓ withheld in tax); profit today ${profit} ℓ.`);
  } else if (owner && profit < 0) {
    remember(world, owner.id, 'money', `${biz.name} lost ${-profit} ℓ today; its treasury holds ${biz.treasury} ℓ.`);
  }

  const underwater = !rentPaid || (profit < 0 && biz.treasury < rent);
  biz.daysNegative = underwater ? biz.daysNegative + 1 : 0;
  biz.revenueToday = 0;
  biz.costsToday = 0;

  if (biz.daysNegative >= BANKRUPTCY_DAYS) {
    if (owner) owner.reputation = clamp(owner.reputation - BANKRUPTCY_REPUTATION, 0, 100);
    dissolveBusiness(world, biz.id, `bankrupt after ${biz.daysNegative} days in the red`);
  } else if (underwater && owner) {
    remember(world, owner.id, 'money', `${biz.name} is in the red (${biz.daysNegative} of ${BANKRUPTCY_DAYS} days before bankruptcy).`);
  }
}

export function dailyBusinesses(world: World): void {
  for (const biz of activeBusinesses(world)) settleDay(world, biz);
}

/**
 * Close a business for good: jobs closed (employees dismissed), cash and stock
 * returned to the owner (or seized by the Treasury), record kept for history.
 */
export function dissolveBusiness(world: World, businessId: BusinessId, reason: string, toTreasury = false): void {
  const biz = world.businesses[businessId];
  if (!biz || biz.dissolvedDay !== null) return;
  for (const jobId of [...biz.jobs]) closeJob(world, jobId);
  biz.jobs = [];
  biz.employees = [];

  const owner = world.citizens[biz.ownerId] ?? null;
  if (biz.treasury > 0) {
    if (!toTreasury && owner) transfer(world, biz.id, owner.id, biz.treasury, 'payout', `closing balance of ${biz.name}`);
    if (biz.treasury > 0) transfer(world, biz.id, 'treasury', biz.treasury, 'seizure', `closing balance of ${biz.name}`);
  }
  for (const good of GOODS) {
    const qty = Math.floor(biz.inventory[good]);
    if (qty <= 0) continue;
    if (!toTreasury && owner) owner.inventory[good] += qty;
    else deliverToMarket(world, good, qty);
    biz.inventory[good] = 0;
  }
  if (owner && owner.businessId === businessId) owner.businessId = null;
  biz.dissolvedDay = world.day;

  const bankrupt = reason.toLowerCase().includes('bankrupt');
  const actors = owner ? [owner.id] : [];
  if (bankrupt) {
    emit(world, 'business_bankrupt', `${biz.name} has gone bankrupt (${reason}); its staff are out of work.`, actors, 0.7, { businessId, reason });
  } else {
    emit(world, 'system', `${biz.name} closed its doors: ${reason}.`, actors, 0.3, { businessId, reason });
  }
  if (owner) remember(world, owner.id, 'money', `Your business ${biz.name} closed: ${reason}.`);
}
