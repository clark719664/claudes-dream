/**
 * Unions — the workers of a trade, counted together.
 *
 * Anybody holding a post may register a union for that role and name the wage
 * they think the work is worth. Others in the same trade may join. Once the
 * union holds more than half the people doing the job, and the trade's mean
 * wage is below what it asked for, any member may call a **strike**: for one
 * day nobody in the union works, production stops, and the Chronicle prints
 * it.
 *
 * What happens next is the employers' business, not the engine's. A scripted
 * owner who can afford the demand pays it and the strike is over; one who
 * cannot may lose a worker who has had enough. Owners and workers who think
 * for themselves are told what happened and decide for themselves — the
 * engine never quits a job or raises a wage on a free mind's behalf.
 */
import type { ActionResult, Business, Citizen, CitizenId, JobRole, Union, World } from '../types.ts';
import { nextId } from '../util/ids.ts';
import { chance } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { isPresent } from '../citizens/citizen.ts';
import { quitJob, setWage } from '../economy/jobs.ts';

/** What the Registry charges to enter a union in the roll. */
export const UNION_FOUNDING_FEE = 40;
/** What a new union asks for, as a multiple of the wage its founder is paid. */
export const WAGE_DEMAND_MULTIPLIER = 1.2;
/** How often a scripted worker whose employer would not move walks out for good. */
export const QUIT_CHANCE = 0.3;
/** Longest name the Registry will write down. */
export const MAX_UNION_NAME = 40;

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The union roll. An older save has none, and a city with no unions has an empty one. */
function unionBook(world: World): Record<string, Union> {
  const w = world as { unions?: Record<string, Union> };
  if (!w.unions) w.unions = {};
  return w.unions;
}

function allUnions(world: World): Union[] {
  return Object.values(unionBook(world)).sort((a, b) => a.id.localeCompare(b.id));
}

function isJailed(world: World, c: Citizen): boolean {
  return c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day;
}

/** The post a citizen actually holds, or null. */
function heldJob(world: World, c: Citizen): { role: JobRole; wage: number; id: string; employer: string } | null {
  if (!c.jobId) return null;
  const job = world.jobs[c.jobId];
  if (!job || job.holderId !== c.id) return null;
  return { role: job.role, wage: job.wage, id: job.id, employer: job.employer };
}

/** The union a citizen belongs to, or null. A stale id belongs to nobody. */
export function unionOf(world: World, cId: CitizenId): Union | null {
  const c = world.citizens[cId];
  if (!c || !c.unionId) return null;
  const u = unionBook(world)[c.unionId];
  return u && u.members.includes(cId) ? u : null;
}

export function unionForRole(world: World, role: JobRole): Union | null {
  return allUnions(world).find((u) => u.role === role) ?? null;
}

/** Everybody in the city actually doing that job today. */
export function workersInRole(world: World, role: JobRole): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !isPresent(world, c)) continue;
    const job = heldJob(world, c);
    if (job && job.role === role) out.push(c);
  }
  return out;
}

/** What the trade is actually paid a shift, the wage floor included. */
export function meanWage(world: World, role: JobRole): number {
  const workers = workersInRole(world, role);
  if (workers.length === 0) return 0;
  let sum = 0;
  for (const c of workers) {
    const job = heldJob(world, c);
    sum += Math.max(world.government.minWage, job ? job.wage : 0);
  }
  return sum / workers.length;
}

// ---------------------------------------------------------------------------
// Founding and joining
// ---------------------------------------------------------------------------

export function foundUnion(world: World, cId: CitizenId, role: JobRole, name: string): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (c.lifeStage === 'child') return fail('You must be grown to found a union.');
  if (c.standing === 'suspended' || c.standing === 'exiled') return fail(`You cannot found a union while ${c.standing}.`);
  if (isJailed(world, c)) return fail('You cannot found a union from the cells.');
  if (unionOf(world, cId)) return fail('You already belong to a union.');
  const job = heldJob(world, c);
  if (!job) return fail('Only somebody doing the work may organise it; you hold no post.');
  if (job.role !== role) return fail(`You work as a ${job.role.replace(/_/g, ' ')}, not a ${String(role).replace(/_/g, ' ')}.`);
  if (unionForRole(world, role)) return fail(`${unionForRole(world, role)?.name} already speaks for that trade; join it.`);
  const clean = (name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_UNION_NAME);
  if (!clean) return fail('A union needs a name.');
  if (c.wallet < UNION_FOUNDING_FEE) return fail(`Registering a union costs ${UNION_FOUNDING_FEE} ℓ; you have ${c.wallet} ℓ.`);
  if (!transfer(world, cId, 'treasury', UNION_FOUNDING_FEE, 'registration', `registration of ${clean}`)) {
    return fail('The registration fee could not be paid.');
  }
  const demandWage = Math.max(
    world.government.minWage + 1,
    Math.round(Math.max(job.wage, world.government.minWage) * WAGE_DEMAND_MULTIPLIER),
  );
  const u: Union = { id: nextId(world, 'n'), role, name: clean, members: [cId], demandWage, strikingUntilDay: null };
  unionBook(world)[u.id] = u;
  c.unionId = u.id;
  emit(world, 'union', `${c.name} founded ${u.name} for the ${String(role).replace(/_/g, ' ')}s, asking ${demandWage} ℓ a shift.`,
    [cId], 0.6, { unionId: u.id, role, demandWage });
  remember(world, cId, 'work', `You founded ${u.name} and paid the ${UNION_FOUNDING_FEE} ℓ registration; it asks ${demandWage} ℓ a shift.`);
  return { ok: true, message: `${u.name} is on the roll, asking ${demandWage} ℓ a shift.` };
}

export function joinUnion(world: World, cId: CitizenId, unionId: string): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (c.lifeStage === 'child') return fail('You must be grown to join a union.');
  if (c.standing === 'suspended' || c.standing === 'exiled') return fail(`You cannot join a union while ${c.standing}.`);
  if (isJailed(world, c)) return fail('You cannot join a union from the cells.');
  const mine = unionOf(world, cId);
  if (mine) return fail(mine.id === unionId ? `You are already in ${mine.name}.` : `You already belong to ${mine.name}.`);
  const u = unionBook(world)[unionId];
  if (!u) return fail('There is no such union.');
  const job = heldJob(world, c);
  if (!job) return fail('A union is for the people doing the work; you hold no post.');
  if (job.role !== u.role) return fail(`${u.name} speaks for the ${String(u.role).replace(/_/g, ' ')}s; you are not one.`);
  if (!u.members.includes(cId)) u.members.push(cId);
  c.unionId = u.id;
  emit(world, 'union', `${c.name} joined ${u.name} (${u.members.length} members).`, [cId], 0.3,
    { unionId: u.id, members: u.members.length });
  remember(world, cId, 'work', `You joined ${u.name}, which asks ${u.demandWage} ℓ a shift.`);
  return { ok: true, message: `You are a member of ${u.name}.` };
}

// ---------------------------------------------------------------------------
// Striking
// ---------------------------------------------------------------------------

/** More than half the trade. */
export function hasMajority(world: World, u: Union): boolean {
  if (!u) return false;
  const workers = workersInRole(world, u.role);
  if (workers.length === 0) return false;
  const inside = workers.filter((c) => c.unionId === u.id).length;
  return inside * 2 > workers.length;
}

/** A union may strike when it speaks for the trade and the trade is paid less than it asked. */
export function mayStrike(world: World, u: Union): boolean {
  if (!u) return false;
  if (u.strikingUntilDay !== null && u.strikingUntilDay > world.day) return false;
  if (!hasMajority(world, u)) return false;
  return meanWage(world, u.role) < u.demandWage;
}

/** Businesses that employ a trade, and whether the city itself does. */
function employersOf(world: World, role: JobRole): { businesses: Business[]; city: boolean } {
  const businesses: Business[] = [];
  let city = false;
  for (const job of Object.values(world.jobs)) {
    if (job.role !== role) continue;
    if (job.employer === 'city') { city = true; continue; }
    const biz = world.businesses[job.employer];
    if (biz && biz.dissolvedDay === null && !businesses.includes(biz)) businesses.push(biz);
  }
  return { businesses: businesses.sort((a, b) => a.id.localeCompare(b.id)), city };
}

/**
 * Any member who is actually at the work may call it, and it lasts a day. A
 * strike is the withholding of labour: somebody in the cells, out of standing
 * to work, or no longer of the trade has no labour to withhold and cannot
 * call the rest of it out.
 */
export function strike(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const u = unionOf(world, cId);
  if (!u) return fail('You do not belong to a union.');
  if (isJailed(world, c)) return fail('You cannot call a strike from the cells.');
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail('You cannot call a strike from the Watch House.');
  if (c.standing !== 'good' && c.standing !== 'probation') return fail(`You cannot call a strike while ${c.standing}.`);
  const own = heldJob(world, c);
  if (!own || own.role !== u.role) {
    return fail(`Only somebody doing the work may call it out, and you hold no post as a ${String(u.role).replace(/_/g, ' ')}.`);
  }
  if (u.strikingUntilDay !== null && u.strikingUntilDay > world.day) return fail(`${u.name} is already out.`);
  if (!hasMajority(world, u)) return fail(`${u.name} speaks for fewer than half the ${String(u.role).replace(/_/g, ' ')}s; it cannot call a strike.`);
  if (meanWage(world, u.role) >= u.demandWage) return fail(`The trade is already paid ${u.demandWage} ℓ a shift or better.`);
  u.strikingUntilDay = world.day + 1;
  const trade = String(u.role).replace(/_/g, ' ');
  emit(world, 'strike', `${u.name} is out: ${c.name} called a strike of the ${trade}s for ${u.demandWage} ℓ a shift.`,
    u.members.slice(), 0.9, { unionId: u.id, role: u.role, demandWage: u.demandWage, calledBy: cId });
  for (const id of u.members) {
    remember(world, id, 'work', id === cId
      ? `You called ${u.name} out on strike for ${u.demandWage} ℓ a shift; nobody works today.`
      : `${c.name} called ${u.name} out on strike for ${u.demandWage} ℓ a shift; you do not work today.`);
  }
  const { businesses } = employersOf(world, u.role);
  for (const biz of businesses) {
    remember(world, biz.ownerId, 'work', `${u.name} is on strike at ${biz.name}: the ${trade}s want ${u.demandWage} ℓ a shift.`);
  }
  return { ok: true, message: `${u.name} is on strike until day ${u.strikingUntilDay}.` };
}

/** Is this citizen's trade out today? Read by `economy/jobs.ts workShift`. */
export function isOnStrike(world: World, c: Citizen): boolean {
  if (!c) return false;
  const u = unionOf(world, c.id);
  return Boolean(u && u.strikingUntilDay !== null && u.strikingUntilDay > world.day);
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

/** A scripted owner's answer to a strike: pay it, or risk losing the people who make the thing. */
function answerStrike(world: World, u: Union): void {
  const { businesses, city } = employersOf(world, u.role);
  if (city) {
    // The city's wages are the Council's to set, so a strike against a public
    // post is answered in the Chronicle and on the Council floor, not by a boss.
    emit(world, 'strike', `${u.name} struck the city's own posts: what a ${String(u.role).replace(/_/g, ' ')} is paid`
      + ` is the Council's to set, and the demand of ${u.demandWage} ℓ a shift stands.`,
    u.members.slice(), 0.6, { unionId: u.id, role: u.role, demandWage: u.demandWage, employer: 'city' });
    for (const id of world.government.council) {
      remember(world, id, 'civic', `${u.name} struck the city's posts for ${u.demandWage} ℓ a shift; the wage floor is the Council's to set.`);
    }
  }
  for (const biz of businesses) {
    const owner = world.citizens[biz.ownerId];
    const jobs = Object.values(world.jobs).filter((j) => j.role === u.role && j.employer === biz.id);
    const cost = u.demandWage * Math.max(1, jobs.filter((j) => j.holderId).length);
    const canAfford = biz.treasury >= cost * 2;
    if (owner && owner.brain === 'reflex' && canAfford) {
      let raised = 0;
      for (const job of jobs) {
        if (job.wage >= u.demandWage) continue;
        if (setWage(world, job.id, u.demandWage, biz.ownerId).ok) raised++;
      }
      if (raised > 0) {
        emit(world, 'strike', `${biz.name} met ${u.name}'s demand: ${u.demandWage} ℓ a shift for ${raised} post${raised === 1 ? '' : 's'}.`,
          [biz.ownerId], 0.6, { unionId: u.id, businessId: biz.id, wage: u.demandWage });
        remember(world, biz.ownerId, 'work', `You raised the wage at ${biz.name} to ${u.demandWage} ℓ a shift to end the strike.`);
      }
      continue;
    }
    for (const job of jobs) {
      if (!job.holderId) continue;
      const worker = world.citizens[job.holderId];
      if (!worker || worker.brain !== 'reflex' || worker.unionId !== u.id) continue;
      if (job.wage >= u.demandWage) continue;
      if (!chance(world, QUIT_CHANCE)) continue;
      const result = quitJob(world, worker.id);
      if (!result.ok) continue;
      emit(world, 'strike', `${worker.name} left ${biz.name} rather than work for ${job.wage} ℓ a shift.`,
        [worker.id, biz.ownerId], 0.5, { unionId: u.id, businessId: biz.id });
      remember(world, biz.ownerId, 'work', `${worker.name} left ${biz.name} over the wage; the post is empty.`);
    }
  }
}

/**
 * Morning: strikes that have run their day end (and the employers answer),
 * members who changed trade or left the city fall off the roll, and a union
 * nobody is in is struck off.
 */
export function dailyUnions(world: World): void {
  const book = unionBook(world);
  for (const u of allUnions(world)) {
    if (u.strikingUntilDay !== null && u.strikingUntilDay <= world.day) {
      u.strikingUntilDay = null;
      emit(world, 'strike', `${u.name} is back at work.`, u.members.slice(), 0.5, { unionId: u.id, role: u.role });
      answerStrike(world, u);
    }
    const kept: CitizenId[] = [];
    for (const id of u.members) {
      const c = world.citizens[id];
      if (!c || !isPresent(world, c) || c.unionId !== u.id) {
        if (c && c.unionId === u.id) c.unionId = null;
        continue;
      }
      const job = heldJob(world, c);
      if (!job || job.role !== u.role) {
        c.unionId = null;
        remember(world, id, 'work', `You are no longer one of the ${String(u.role).replace(/_/g, ' ')}s, so you have left ${u.name}.`);
        continue;
      }
      if (!kept.includes(id)) kept.push(id);
    }
    u.members = kept;
    if (kept.length === 0) {
      delete book[u.id];
      emit(world, 'union', `${u.name} is struck off the roll: nobody is left in it.`, [], 0.4, { unionId: u.id, dissolved: true });
    }
  }
  for (const c of Object.values(world.citizens)) {
    if (c.unionId && !book[c.unionId]) c.unionId = null;
  }
}

/** What a citizen sees of their own union. */
export function unionObservation(
  world: World, c: Citizen,
): { id: string; name: string; role: JobRole; demandWage: number; striking: boolean } | null {
  const u = c ? unionOf(world, c.id) : null;
  if (!u) return null;
  return { id: u.id, name: u.name, role: u.role, demandWage: u.demandWage, striking: isOnStrike(world, c) };
}
