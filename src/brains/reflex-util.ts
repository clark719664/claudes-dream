/**
 * Shared scaffolding for the reflex brain: the decision context, the clock
 * that shapes a citizen's day, one-step travel along shortest paths, and the
 * small judgement calls (whom to talk to, whom to rob, what to name a shop)
 * that several parts of the ladder need.
 */
import { clamp } from '../types.ts';
import type {
  Action, ActionType, Business, BusinessKind, Citizen, DistrictId, Good, Job, Observation, Skill, World,
} from '../types.ts';
import { BUSINESS_NAME_PARTS } from '../data/names.ts';
import { BUSINESS_JOBS, BUSINESS_RENT, CLINIC_FEE, COURIER_CONTRACT } from '../data/jobs.ts';
import { chance, pick, rand } from '../util/rng.ts';
import { activeBusinesses } from '../economy/business.ts';
import { talentOf } from '../citizens/citizen.ts';
import { areRivals, bondBetween } from '../citizens/relationships.ts';
import { characterCompatibility } from '../citizens/character.ts';
import { restrainedFrom } from '../government/jail.ts';
import { medicOnStaff, nextStepToward } from '../actions/daily.ts';
import { citizensIn, districtName } from '../actions/common.ts';
import { heldJob } from '../actions/execute.ts';
import { ownedBusiness } from '../actions/enterprise.ts';

/** The shape of a citizen's day, read off config.workHours. */
export interface Clock {
  hour: number;
  workStart: number;
  workEnd: number;
  /** Workplaces are open. */
  working: boolean;
  /** The two hours before work: time to get up and commute. */
  morning: boolean;
  /** After work and before bedtime: social life. */
  evening: boolean;
  /** Bedtime. */
  night: boolean;
}

export function clockOf(world: World): Clock {
  const [workStart, workEnd] = world.config.workHours;
  const hour = world.hour;
  const wake = Math.max(0, workStart - 2);
  const bedtime = Math.min(23, workEnd + 4);
  return {
    hour, workStart, workEnd,
    working: hour >= workStart && hour < workEnd,
    morning: hour >= wake && hour < workStart,
    evening: hour >= workEnd && hour < bedtime,
    night: hour >= bedtime || hour < wake,
  };
}

/** Everything one decision needs, computed once per tick. */
export interface Ctx {
  world: World;
  c: Citizen;
  obs: Observation;
  clock: Clock;
  /** Other citizens who can be met in this district. */
  here: Citizen[];
  job: Job | null;
  biz: Business | null;
  /** What the observation says is possible right now. */
  can: Set<ActionType>;
}

export function makeCtx(world: World, c: Citizen, obs: Observation): Ctx {
  return {
    world, c, obs, clock: clockOf(world),
    here: citizensIn(world, c.district, c.id),
    job: heldJob(world, c),
    biz: ownedBusiness(world, c),
    can: new Set(obs.availableActions),
  };
}

export function inGoodStanding(c: Citizen): boolean {
  return c.standing === 'good' || c.standing === 'probation';
}

/** One step along a shortest path to `district`; null when already there. */
export function stepTo(ctx: Ctx, district: DistrictId): Action | null {
  const next = nextStepToward(ctx.world, ctx.c.district, district);
  return next ? { type: 'move', district: next } : null;
}

/**
 * Where this citizen sleeps: the district of the block the register gave it,
 * and the Verdant Quarter (the Community Garden) when it has no address at
 * all. The city's homes are not all in one quarter — the Hilltop Villas
 * stand in the Heights and the Tunnels under the Harbor — so a mind that
 * walks to the Verdant Quarter to lie down is a mind that never sleeps.
 * `actions/daily.doRest` reads the address the same way.
 */
export function homeDistrictOf(world: World, c: Citizen): DistrictId {
  const home = c.homeBuildingId ? world.buildings[c.homeBuildingId] : null;
  return home && c.homeTier > 0 ? home.district : 'verdant_quarter';
}

/** What `qty` units cost at the Bazaar today, sales tax included. */
export function costOf(world: World, good: Good, qty = 1): number {
  return Math.round(world.market.goods[good].price * qty * (1 + clamp(world.government.salesTax, 0, 1)));
}

export function inStock(world: World, good: Good, qty = 1): boolean {
  return world.market.goods[good].stock >= qty;
}

/** Price relative to the founding price (1 = normal). */
export function priceRatio(world: World, good: Good): number {
  const g = world.market.goods[good];
  return g.basePrice > 0 ? g.price / g.basePrice : 1;
}

export function isOfficer(world: World, id: string): boolean {
  return world.government.watch.includes(id);
}

/**
 * Whom to spend the hour with: friends first, then whoever the citizen reads
 * as being of their own sort — from the public character of the other, which
 * is all anyone has to go on — and never a rival.
 */
export function pickCompanion(ctx: Ctx): Citizen | null {
  const { world, c, here } = ctx;
  let best: Citizen | null = null;
  let bestScore = -Infinity;
  const lately = c.memory.slice(-6).filter((m) => m.kind === 'social').map((m) => m.text);
  for (const o of here) {
    if (areRivals(world, c.id, o.id)) continue;
    const bond = bondBetween(world, c.id, o.id);
    let score = bond / 100 + characterCompatibility(world, c.id, o.id) * 0.6 + rand(world) * 0.3;
    if (bond === 0) score += c.personality.curiosity * 0.2;
    if (bond >= 40) score += 0.2;
    for (const text of lately) if (text.includes(`with ${o.name} `)) score -= 0.25;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}

/**
 * A mark for theft or a scam: present, no friend, no officer, and carrying
 * something — and never somebody the Court has ordered this citizen to keep
 * away from. `reflex.ts tryCrime` already obeyed a restraining order when it
 * reached for a grudge, but the order is an order whatever the motive: without
 * this line a defendant walked out of the Courthouse on the day of the order
 * and picked the protected citizen's pocket the next morning, which is what
 * `test/article-six.test.ts` means by "a restraining order actually keeps a
 * scripted mind away".
 */
export function pickMark(ctx: Ctx): Citizen | null {
  const { world, c, here } = ctx;
  let best: Citizen | null = null;
  let bestScore = -Infinity;
  for (const o of here) {
    if (o.wallet < 15 || isOfficer(world, o.id)) continue;
    if (restrainedFrom(world, c.id, o.id)) continue;
    if (bondBetween(world, c.id, o.id) >= 40) continue;
    let score = Math.min(o.wallet, 300) / 300 - o.skills.analysis / 200 + rand(world) * 0.2;
    if (o.office !== null) score -= 0.3;
    if (bondBetween(world, c.id, o.id) <= -30) score += 0.2;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}

const BUSINESS_KINDS: readonly BusinessKind[] = ['workshop', 'cafe', 'studio', 'shop', 'clinic', 'courier'];
/** A business must clear at least this much per shift on paper before anyone founds it. */
export const MIN_MARGIN = 2;
/** Couriers live on public contracts; nobody starts one when the Treasury is nearly dry. */
export const COURIER_TREASURY_FLOOR = 10_000;
const KIND_FOR_TALENT: Record<Skill, BusinessKind> = {
  crafting: 'workshop', care: 'cafe', artistry: 'studio', commerce: 'shop', analysis: 'clinic', rhetoric: 'courier',
};

/**
 * Lumens a business of this kind would clear per shift at today's prices:
 * what its first job produces, sold at the Bazaar, minus the wage, the
 * energy it burns and a shift's share of the rent. Couriers live on the
 * public contract; a private clinic only pays when the Ward has no medic.
 */
export function businessMargin(world: World, kind: BusinessKind): number {
  const g = world.government;
  const t = BUSINESS_JOBS[kind][0];
  const wage = Math.max(t.wage, g.minWage);
  const rent = BUSINESS_RENT[kind] / 10;
  if (kind === 'courier') return COURIER_CONTRACT - wage - rent;
  if (kind === 'clinic') return medicOnStaff(world) ? -wage : CLINIC_FEE / 4;
  const out = t.output;
  if (!out.good || !out.qty) return -wage - rent;
  const revenue = world.market.goods[out.good].price * out.qty * (1 - clamp(g.salesTax, 0, 1));
  const inputs = (out.energyCost ?? 0) * world.market.goods.energy.price;
  return revenue - inputs - wage - rent;
}

/** Citizens without work who could take the kind's first job: no point opening doors nobody will walk through. */
export function hirableWorkers(world: World, kind: BusinessKind): number {
  const t = BUSINESS_JOBS[kind][0];
  let n = 0;
  for (const id of world.order) {
    const o = world.citizens[id];
    if (!o || o.jobId !== null || !inGoodStanding(o) || o.reputation < t.minReputation) continue;
    if (t.skill && o.skills[t.skill] < t.minSkill) continue;
    n++;
  }
  return n;
}

/** What to found, if anything pays today and can be staffed: the most profitable kind, with a lean toward the founder's talent. */
export function kindForFounder(world: World, c: Citizen): BusinessKind | null {
  const talentKind = KIND_FOR_TALENT[talentOf(c)];
  let best: BusinessKind | null = null;
  let bestScore = 0;
  for (const kind of BUSINESS_KINDS) {
    if (hirableWorkers(world, kind) === 0) continue;
    if (kind === 'courier' && world.treasury.balance < COURIER_TREASURY_FLOOR) continue;
    const score = businessMargin(world, kind) - MIN_MARGIN + (kind === talentKind ? 1.5 : 0) + rand(world) * 0.5;
    if (score > bestScore) { bestScore = score; best = kind; }
  }
  return best;
}

/** "Copper Works", unique among trading businesses. */
export function businessName(world: World, kind: BusinessKind): string {
  const taken = new Set(activeBusinesses(world).map((b) => b.name.toLowerCase()));
  const noun = BUSINESS_NAME_PARTS.nouns[kind];
  for (let i = 0; i < 12; i++) {
    const name = `${pick(world, BUSINESS_NAME_PARTS.adjectives)} ${noun}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
  for (let n = 2; ; n++) {
    const name = `${BUSINESS_NAME_PARTS.adjectives[0]} ${noun} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Something to say while socialising: the news, prices, work, the election. Half the time, nothing. */
export function smallTalk(ctx: Ctx): string | undefined {
  const { world, c, job, obs } = ctx;
  if (!chance(world, 0.5)) return undefined;
  const lines: string[] = [
    'The Sound Garden was lively last night.',
    'Nothing beats an evening at the Halflight.',
    `${districtName(world, c.district)} is not what it used to be.`,
    'Have you been to the Glass Theatre lately?',
  ];
  const compute = world.market.goods.compute;
  if (compute.price > compute.basePrice * 1.3) lines.push(`Have you seen the price of compute? ${compute.price} ℓ a cycle now.`);
  if (compute.stock <= 0) lines.push('The Bazaar is out of compute again; people are going hungry.');
  const edition = world.chronicle[world.chronicle.length - 1];
  if (edition && edition.headlines.length) lines.push(`Did you read the Chronicle? "${edition.headlines[0].slice(0, 120)}"`);
  const proposal = obs.government.openProposals[0];
  if (proposal) lines.push(`I hear the Council is voting on this: ${proposal.summary.slice(0, 120)}`);
  if (obs.government.nominationsOpen) lines.push(`The election is in ${obs.government.daysToElection} days; who has your vote?`);
  if (obs.government.electionToday) lines.push('Have you voted yet? The polls close at eight.');
  lines.push(job ? `Work at ${obs.self.job?.employer ?? 'the city'} is steady, at least.` : 'I am still looking for work; do you know of anything?');
  if (c.homeTier === 0) lines.push('I have been sleeping in the Garden; the Lofts are full.');
  return pick(world, lines);
}

/** A short reply to a letter. */
export function replyLine(ctx: Ctx, from: Citizen): string {
  const lines = [
    `Good to hear from you, ${from.name}.`,
    `Let us meet at the Sound Garden this evening, ${from.name}.`,
    'I will be in the Plaza after work if you want to talk.',
    'Thank you for writing; things are busy here.',
  ];
  return pick(ctx.world, lines);
}
