/**
 * The child policy: how a citizen thinks before coming of age. Children go
 * to school at the Academy in work hours, play in the Garden or the Plaza in
 * the evening, join whatever is being celebrated nearby, sleep at home at
 * night, and on Stillday play all day. They never work, never break the law,
 * never vote or trade in anything but a meal. reflex.ts delegates here while
 * lifeStage is 'child'. Deterministic given the world's rng.
 */
import type { Action, ActionType, Citizen, CitizenId, DistrictId, Happening, Observation, Skill, World } from '../types.ts';
import { HOBBY_INFO, PRODUCTS, REST_DAY, WEEK_LENGTH } from '../data/catalogue.ts';
import { CLINIC_FEE } from '../data/jobs.ts';
import { chance, pick } from '../util/rng.ts';
import { talentOf } from '../citizens/citizen.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { teacherOnStaff } from '../actions/daily.ts';
import { costOf, homeDistrictOf, inStock, makeCtx, stepTo } from './reflex-util.ts';
import type { Ctx } from './reflex-util.ts';

/** Everything a child may do; anything else the policy might produce is turned into idling. */
export const CHILD_ACTIONS: readonly ActionType[] = [
  'idle', 'move', 'rest', 'eat', 'buy', 'consume', 'study', 'visit_clinic',
  'socialize', 'message', 'gift_item', 'use_item', 'play', 'celebrate', 'dine',
];
/** Happenings a child will run to join. */
export const CHILD_CELEBRATES: readonly Happening['kind'][] = ['wedding', 'birthday', 'festival', 'swearing_in'];
/** Where children play: the Community Garden and Central Plaza (never the Tavern). */
export const PLAY_DISTRICTS: readonly DistrictId[] = ['verdant_quarter', 'commons'];
export const CHILD_HUNGRY = 35;
export const CHILD_TIRED = 30;
export const CHILD_SICK = 20;
/** Children sleep until rest is at least this high. */
export const CHILD_SLEEP_UNTIL = 90;
/** Chance in an evening hour to practise a hobby with something they own. */
export const HOBBY_CHANCE = 0.4;
/** How often a lesson is in the child's strongest skill rather than a hobby's. */
export const TALENT_LESSON_CHANCE = 0.6;
/** Hours between pleas for food money. */
export const PLEA_INTERVAL = 6;

const IDLE: Action = { type: 'idle' };

function isRestDay(world: World): boolean {
  return ((world.day % WEEK_LENGTH) + WEEK_LENGTH) % WEEK_LENGTH === REST_DAY;
}

function isPresent(world: World, c: Citizen): boolean {
  return c.standing !== 'exiled' && world.order.includes(c.id);
}

/** Parents and guardian who are still in the city. */
function carers(world: World, c: Citizen): Citizen[] {
  const ids = [...c.family.parents, ...(c.guardianId ? [c.guardianId] : [])];
  const out: Citizen[] = [];
  for (const id of ids) {
    const p = world.citizens[id];
    if (p && isPresent(world, p) && !out.includes(p)) out.push(p);
  }
  return out;
}

function isFamily(world: World, c: Citizen, other: Citizen): boolean {
  if (c.family.parents.includes(other.id) || c.guardianId === other.id) return true;
  if (other.family.parents.some((p) => c.family.parents.includes(p))) return true; // sibling
  return false;
}

/** Whom to play with: family first, then friends, then other children; never someone who dislikes them. */
function playmate(ctx: Ctx): Citizen | null {
  const { world, c, here } = ctx;
  let best: Citizen | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const o of here) {
    const bond = bondBetween(world, c.id, o.id);
    if (bond <= -30 || bondBetween(world, o.id, c.id) <= -30) continue;
    let score = bond / 100;
    if (isFamily(world, c, o)) score += 1;
    if (o.lifeStage === 'child') score += 0.5;
    if (bond >= 40) score += 0.3;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}

/** The lesson to take: usually the child's talent, sometimes the skill behind one of their hobbies. */
export function lessonFor(world: World, c: Citizen): Skill {
  const hobbies = c.tastes.hobbies;
  if (hobbies.length === 0 || chance(world, TALENT_LESSON_CHANCE)) return talentOf(c);
  return HOBBY_INFO[pick(world, hobbies)].skill;
}

function celebratableHere(world: World, c: Citizen): Happening | null {
  return (world.happenings ?? []).find((h) => !h.done && h.day === world.day && h.hour === world.hour && h.district === c.district
    && CHILD_CELEBRATES.includes(h.kind) && !h.attendees.includes(c.id)) ?? null;
}

function hobbyItem(c: Citizen): CitizenId | null {
  const item = c.possessions.find((i) => {
    const p = PRODUCTS[i.productId];
    return !!p && (p.hobby === null || c.tastes.hobbies.includes(p.hobby) || Object.keys(p.use).length > 0);
  });
  return item ? item.id : null;
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/** Eat when hungry; when broke, ask a parent who is here, or write to one. */
function tryEat(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (c.needs.energy >= CHILD_HUNGRY) return null;
  if (c.inventory.compute > 0) return { type: 'eat' };
  if (inStock(world, 'compute') && c.wallet >= costOf(world, 'compute')) return { type: 'eat' };
  const family = carers(world, c);
  const near = family.find((p) => p.district === c.district && ctx.here.includes(p));
  const pleaded = `pleaded:${c.id}`;
  if (near && world.tick - (world.counters[pleaded] ?? -PLEA_INTERVAL) >= PLEA_INTERVAL) {
    world.counters[pleaded] = world.tick;
    return { type: 'socialize', with: near.id, text: 'I am hungry and I have no lumens.' };
  }
  const wrote = `wrote:${c.id}`;
  if (family.length > 0 && world.counters[wrote] !== world.day && ctx.can.has('message')) {
    world.counters[wrote] = world.day;
    return { type: 'message', to: family[0].id, text: 'I am hungry and have no lumens; can you help?' };
  }
  return null;
}

/** The Ward when really unwell (a medic is needed and the fee affordable). */
function tryClinic(ctx: Ctx): Action | null {
  const { c } = ctx;
  if (c.needs.energy >= CHILD_SICK || c.wallet < CLINIC_FEE) return null;
  return ctx.can.has('visit_clinic') ? { type: 'visit_clinic' } : null;
}

/** Bedtime at night, a nap when worn out; a child sleeps under its family's roof (the Garden when it has none). */
function trySleep(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  const wants = c.needs.rest < CHILD_TIRED || (clock.night && c.needs.rest < CHILD_SLEEP_UNTIL);
  if (!wants) return null;
  return stepTo(ctx, homeDistrictOf(world, c)) ?? { type: 'rest' };
}

/** Whatever is being celebrated here right now is irresistible. */
function tryCelebrate(ctx: Ctx): Action | null {
  return celebratableHere(ctx.world, ctx.c) ? { type: 'celebrate' } : null;
}

/** School: lessons at the Academy in work hours, if a teacher is there. One wasted trip a day at most. */
function trySchool(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  if (isRestDay(world) || !(clock.working || clock.morning) || !teacherOnStaff(world)) return null;
  const shut = `schoolShut:${c.id}`;
  if (c.district === 'archive') {
    if (!clock.working) return { type: 'idle' };
    if (ctx.can.has('study')) return { type: 'study', skill: lessonFor(world, c) };
    world.counters[shut] = world.day;
    return null;
  }
  if (world.counters[shut] === world.day) return null;
  return stepTo(ctx, 'archive');
}

/** Free time: a hobby, a game with family or friends, or the walk to where the other children are. */
function play(ctx: Ctx): Action {
  const { world, c } = ctx;
  const item = hobbyItem(c);
  if (item && chance(world, HOBBY_CHANCE)) return { type: 'use_item', itemId: item };
  const mate = playmate(ctx);
  if (mate && PLAY_DISTRICTS.includes(c.district)) return { type: 'play', with: mate.id };
  if (mate && chance(world, 0.5)) return { type: 'socialize', with: mate.id };
  if (PLAY_DISTRICTS.includes(c.district)) return chance(world, 0.7) ? { type: 'play' } : IDLE;
  const family = carers(world, c).find((p) => PLAY_DISTRICTS.includes(p.district));
  const haunt: DistrictId = family ? family.district : chance(world, 0.6) ? 'verdant_quarter' : 'commons';
  return stepTo(ctx, haunt) ?? { type: 'play' };
}

/** Decide one action for a child. */
export function childDecide(world: World, c: Citizen, obs: Observation): Action {
  if (c.standing === 'exiled' || obs.self?.detained) return IDLE;
  const ctx = makeCtx(world, c, obs);
  const steps: ((ctx: Ctx) => Action | null)[] = [tryEat, tryClinic, trySleep, tryCelebrate, trySchool];
  let action: Action | null = null;
  for (const step of steps) {
    action = step(ctx);
    if (action) break;
  }
  if (!action) action = ctx.clock.night ? (stepTo(ctx, homeDistrictOf(world, c)) ?? { type: 'rest' }) : play(ctx);
  return CHILD_ACTIONS.includes(action.type) ? action : IDLE;
}
