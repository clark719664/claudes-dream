/**
 * Ambitions.
 *
 * Every adult of Reverie carries two life goals, drawn by lot at arrival or at
 * coming of age. They are **descriptive state**, not instructions
 * (`docs/PRINCIPLES.md` §2): the engine never scores a citizen against them,
 * never prompts with them, and never nudges anybody toward one. A citizen may
 * read what it happens to be reaching for, exactly as it may read its own
 * tastes — and a free mind is welcome to spend its whole life ignoring both.
 * Only the reflex brain, a testing mind, is allowed to consult them.
 *
 * Progress is measured from **public facts only** — an office held, a home, a
 * marriage, a record, a wallet — so a goal never becomes a back door into a
 * citizen's hidden traits, and two observers reading the same city read the
 * same progress.
 */
import { GOAL_KINDS, SKILLS, clamp } from '../types.ts';
import type { Citizen, CitizenId, Goal, GoalKind, World } from '../types.ts';
import { GOALS_PER_CITIZEN, MASTER_SKILL, MAX_MILESTONES } from '../data/metropolis.ts';
import { CHILDHOOD_DAYS, ELDER_DAYS } from '../data/catalogue.ts';
import { shuffle } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';

/** Days a business must survive for the "lasting business" goal to be met. */
export const LASTING_BUSINESS_DAYS = 30;
/** Lumens the "amass" goal asks for. */
export const AMASS_TARGET = 5_000;
/** Members the "club of ten" goal asks for. */
export const CLUB_OF_TEN = 10;
/** Reputation a milestone is worth. */
export const MILESTONE_REPUTATION = 3;
/** Purpose a milestone restores: a life's work, finished. */
export const MILESTONE_PURPOSE = 15;
/** Longest a milestone line may be. */
export const MAX_MILESTONE_TEXT = 160;

/** What the Chronicle says when a citizen reaches one of the thirteen. */
export const ACHIEVEMENT_PHRASES: Record<GoalKind, string> = {
  hold_office: 'took public office in Reverie',
  become_mayor: 'became Mayor of Reverie',
  own_villa: 'moved into a villa of their own',
  lasting_business: `kept a business open for ${LASTING_BUSINESS_DAYS} days`,
  marry: 'married',
  raise_child: 'raised a child to come of age',
  master_skill: 'mastered a craft',
  publish_work: 'published a work',
  win_championship: 'won a championship',
  elder_standing: 'grew old in the city in good standing',
  amass_5000: `amassed ${String(AMASS_TARGET).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ℓ`,
  club_of_ten: `founded a club of ${CLUB_OF_TEN}`,
  sit_as_judge: 'took a seat on the bench',
};

export interface ObservedGoal {
  kind: GoalKind;
  progress: number;
  achieved: boolean;
}

// ---------------------------------------------------------------------------
// Small local readings (no import of citizens/citizen.ts: that file calls this
// one, and a cycle through module initialisation is not worth the convenience)
// ---------------------------------------------------------------------------

function present(world: World, c: Citizen): boolean {
  return c.standing !== 'exiled' && world.order.includes(c.id);
}

function round2(v: number): number {
  return Math.round(clamp(v, 0, 1) * 100) / 100;
}

function fullName(c: Citizen): string {
  return c.familyName ? `${c.name} ${c.familyName}` : c.name;
}

/** Days since a citizen arrived in the city or was born in it. */
function ageOf(world: World, c: Citizen): number {
  const born = Number.isFinite(c.bornDay) ? c.bornDay : c.arrivedDay;
  return Math.max(0, world.day - (born ?? 0));
}

function isCandidate(world: World, c: Citizen): boolean {
  return world.government?.election?.candidates?.includes(c.id) === true;
}

function holdsOfficeNow(world: World, c: Citizen): boolean {
  const g = world.government;
  if (!g) return c.office !== null;
  return c.office !== null || g.mayorId === c.id || g.council.includes(c.id)
    || g.judges.includes(c.id) || g.watch.includes(c.id);
}

function bestSkill(c: Citizen): number {
  let best = 0;
  for (const s of SKILLS) best = Math.max(best, c.skills?.[s] ?? 0);
  return best;
}

/** A citizen's living children, in the city's records. */
function childrenOf(world: World, c: Citizen): Citizen[] {
  const out: Citizen[] = [];
  for (const id of c.family?.children ?? []) {
    const kid = world.citizens[id];
    if (kid && !out.some((k) => k.id === kid.id)) out.push(kid);
  }
  return out;
}

/** True when a milestone already on the record matches; how a championship is read. */
export function hasMilestoneMatching(c: Citizen, re: RegExp): boolean {
  return (c.milestones ?? []).some((m) => re.test(m.text ?? ''));
}

// ---------------------------------------------------------------------------
// Drawing the goals
// ---------------------------------------------------------------------------

/**
 * Two distinct goals, drawn by lot. Nothing about the citizen tilts the draw:
 * a life is not handed out to suit a personality. Called for an adult arrival
 * and again when a child of the city comes of age; a citizen that already has
 * its goals keeps them (so a second call costs nothing and moves no rng).
 */
export function drawGoals(world: World, c: Citizen): Goal[] {
  const existing = Array.isArray(c.goals) ? c.goals.filter((g) => g && GOAL_KINDS.includes(g.kind)) : [];
  if (existing.length >= GOALS_PER_CITIZEN) {
    c.goals = existing;
    return existing;
  }
  const wanted = Math.max(0, Math.min(GOALS_PER_CITIZEN, GOAL_KINDS.length));
  const held = new Set(existing.map((g) => g.kind));
  const pool = shuffle(world, GOAL_KINDS.filter((k) => !held.has(k)));
  const drawn: Goal[] = [...existing];
  for (const kind of pool) {
    if (drawn.length >= wanted) break;
    drawn.push({ kind, progress: 0, achievedDay: null });
  }
  c.goals = drawn;
  return drawn;
}

// ---------------------------------------------------------------------------
// Progress, read off the public record
// ---------------------------------------------------------------------------

/**
 * How far along one of the thirteen a citizen is, 0..1, from public facts.
 * A citizen with no job, no home, no family and no money scores 0 everywhere
 * and nothing throws.
 */
export function goalProgress(world: World, c: Citizen, kind: GoalKind): number {
  const g = world.government;
  const rep = clamp(c.reputation ?? 0, 0, 100) / 100;
  switch (kind) {
    case 'hold_office':
      if (holdsOfficeNow(world, c)) return 1;
      return round2(isCandidate(world, c) ? 0.5 : rep * 0.4);
    case 'become_mayor':
      if (g?.mayorId === c.id) return 1;
      if (g?.council.includes(c.id)) return 0.6;
      return round2(isCandidate(world, c) ? 0.4 : rep * 0.2);
    case 'own_villa':
      return round2(clamp((c.homeTier ?? 0) / 3, 0, 1));
    case 'lasting_business': {
      const biz = c.businessId ? world.businesses[c.businessId] : null;
      if (!biz || biz.ownerId !== c.id || biz.dissolvedDay !== null) return 0;
      return round2((world.day - biz.foundedDay) / LASTING_BUSINESS_DAYS);
    }
    case 'marry': {
      if (c.family?.married) return 1;
      if (c.family?.partnerId) return 0.6;
      let best = 0;
      for (const v of Object.values(c.affection ?? {})) best = Math.max(best, v);
      return round2((best / 100) * 0.5);
    }
    case 'raise_child': {
      const kids = childrenOf(world, c);
      if (kids.length === 0) return 0;
      let best = 0;
      for (const kid of kids) {
        best = Math.max(best, kid.lifeStage === 'child' ? clamp(ageOf(world, kid) / CHILDHOOD_DAYS, 0, 0.99) : 1);
      }
      return round2(best);
    }
    case 'master_skill':
      return round2(bestSkill(c) / MASTER_SKILL);
    case 'publish_work': {
      if ((c.works ?? []).length > 0) return 1;
      const job = c.jobId ? world.jobs[c.jobId] : null;
      const trade = job && ['artist', 'performer', 'journalist', 'researcher', 'librarian', 'curator'].includes(job.role);
      return trade ? 0.5 : 0;
    }
    case 'win_championship': {
      if (hasMilestoneMatching(c, /champion/i)) return 1;
      const team = c.teamDistrict ? world.teams?.[c.teamDistrict] : null;
      if (!team) return 0;
      const played = (team.wins ?? 0) + (team.losses ?? 0) + (team.draws ?? 0);
      return played > 0 ? round2(((team.wins ?? 0) / played) * 0.8) : 0;
    }
    case 'elder_standing': {
      const clean = !(c.record?.convictions ?? []).some((k) => k.severity >= 3);
      if (c.lifeStage === 'elder' && c.standing === 'good' && clean) return 1;
      const years = clamp(ageOf(world, c) / ELDER_DAYS, 0, 1) * 0.9;
      return round2(c.standing === 'good' && clean ? years : years * 0.5);
    }
    case 'amass_5000':
      return round2((c.wallet ?? 0) / AMASS_TARGET);
    case 'club_of_ten': {
      let best = 0;
      for (const club of Object.values(world.clubs ?? {})) {
        if (club.founderId !== c.id) continue;
        best = Math.max(best, (club.members?.length ?? 0) / CLUB_OF_TEN);
      }
      return round2(best);
    }
    case 'sit_as_judge':
      if (g?.judges.includes(c.id) || c.office === 'judge') return 1;
      return round2(rep * 0.5);
    default:
      return 0;
  }
}

/** A goal is reached when its progress reaches 1 — never by anything else. */
export function achieved(world: World, c: Citizen, kind: GoalKind): boolean {
  return goalProgress(world, c, kind) >= 1;
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

/**
 * A day worth keeping: written on the citizen's record, told to the city, and
 * remembered by the citizen. Called from here when a goal is reached, and from
 * elsewhere in the city for the other landmarks of a life (a championship, an
 * election won).
 */
export function recordMilestone(world: World, c: Citizen, text: string, weight = 0.6): void {
  const line = String(text ?? '').trim().slice(0, MAX_MILESTONE_TEXT);
  if (!c || !line) return;
  if (!Array.isArray(c.milestones)) c.milestones = [];
  c.milestones.push({ day: world.day, text: line });
  if (c.milestones.length > MAX_MILESTONES) c.milestones.splice(0, c.milestones.length - MAX_MILESTONES);
  c.needs.purpose = clamp(c.needs.purpose + MILESTONE_PURPOSE, 0, 100);
  emit(world, 'milestone', line, [c.id], weight, { day: world.day });
  remember(world, c.id, 'event', line);
}

/** The milestones of a citizen, oldest first. */
export function milestonesOf(world: World, cId: CitizenId, limit?: number): { day: number; text: string }[] {
  const c = world.citizens[cId];
  const all = c?.milestones ?? [];
  return typeof limit === 'number' && limit >= 0 ? all.slice(Math.max(0, all.length - limit)) : all.slice();
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

/**
 * Refresh every present adult's progress, and mark anything reached today.
 * Idempotent: a goal is achieved once, on the day it is reached, and never
 * again. Children have no goals to refresh — they draw theirs when they come
 * of age.
 */
export function dailyGoals(world: World): void {
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !present(world, c)) continue;
    if (!Array.isArray(c.goals) || c.goals.length === 0) continue;
    if (c.lifeStage === 'child') continue;
    for (const goal of c.goals) {
      if (!goal || !GOAL_KINDS.includes(goal.kind)) continue;
      goal.progress = goalProgress(world, c, goal.kind);
      if (goal.progress < 1 || goal.achievedDay !== null) continue;
      goal.achievedDay = world.day;
      c.reputation = clamp((c.reputation ?? 0) + MILESTONE_REPUTATION, 0, 100);
      recordMilestone(world, c, `${fullName(c)} ${ACHIEVEMENT_PHRASES[goal.kind]}.`, 0.6);
    }
  }
}

/** What a citizen can read about its own ambitions. Facts, never instructions. */
export function goalsObservation(world: World, c: Citizen): ObservedGoal[] {
  if (!Array.isArray(c?.goals)) return [];
  return c.goals
    .filter((g) => g && GOAL_KINDS.includes(g.kind))
    .map((g) => ({
      kind: g.kind,
      progress: round2(g.progress ?? 0),
      achieved: g.achievedDay !== null,
    }));
}
