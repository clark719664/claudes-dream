/**
 * The bench: who may hear a case, and what a judge who is a citizen believes
 * about it. Recusal is procedure — the engine decides who sits — and the
 * belief formula is the internal state of a scripted judge, the way the reflex
 * brain's utilities are. A judge who thinks for itself never sees it.
 */
import { clamp } from '../types.ts';
import type { Case, Citizen, CitizenId, World } from '../types.ts';
import { normal, shuffle } from '../util/rng.ts';
import { characterOf } from '../citizens/character.ts';
import { areFriends, bondBetween } from '../citizens/relationships.ts';
import { areFamily } from '../society/family.ts';
import { advocacyDiscount } from './advocates.ts';
import { canSit, priorsOf } from './cases.ts';

/**
 * A scripted judge votes guilty when its belief in guilt exceeds this.
 *
 * It is a *standard of proof*, not a dial for the conviction rate: it says how
 * sure a judge must be, and it has not moved. What used to make it meaningless
 * was the number on the other side of it — the Watch handed the Court evidence
 * pinned at 1.00 for almost every charge (`watch.ts evidenceFor` now builds a
 * case out of what an officer and the witnesses actually saw), and the bench
 * counted a conviction handed down an hour earlier the same day as a prior
 * (`cases.ts priorsOf` now does not).
 */
export const GUILT_THRESHOLD = 0.55;
/**
 * What a record is worth to a judge weighing *this* charge. Small, and
 * deliberately: the question before the bench is whether the defendant did
 * this, not whether they are the sort of citizen who might have. A first
 * offender is never carried over the line by it, and a defendant with ten
 * convictions is not convicted on a case that would have acquitted a stranger.
 */
export const RECORD_WEIGHT = 0.08;
/** What the city's regard for the defendant is worth, either way. */
export const REPUTATION_WEIGHT = 0.10;
/** A friend on the bench, and the victim's friend on the bench. */
export const BOND_DEFENDANT_WEIGHT = 0.20;
export const BOND_VICTIM_WEIGHT = 0.10;
/** How far a judge's reading of the same page wanders from another's. */
export const JUDGE_NOISE = 0.05;
/** Judges (permanent or temporary) need at least this reputation. */
export const JUDGE_MIN_REPUTATION = 60;
/** A full bench. */
export const BENCH_SIZE = 3;
/** Fewer judges than this and temporary ones are drawn by lot. */
export const MIN_BENCH = 2;

/** Judge and defendant are employer and employee (either way round). */
function employmentTie(world: World, judge: Citizen, defendant: Citizen): boolean {
  const judgeJob = judge.jobId ? world.jobs[judge.jobId] : null;
  const defendantJob = defendant.jobId ? world.jobs[defendant.jobId] : null;
  if (judgeJob && defendant.businessId && judgeJob.employer === defendant.businessId) return true;
  if (defendantJob && judge.businessId && defendantJob.employer === judge.businessId) return true;
  return false;
}

/** Family, friend, employer, employee, accuser, victim or the defendant themself. */
export function mustRecuse(world: World, judgeId: CitizenId, c: Case): boolean {
  const judge = world.citizens[judgeId];
  const d = world.citizens[c.defendantId];
  if (!judge || !d) return true;
  if (judgeId === d.id || judgeId === c.filedBy || judgeId === c.victimId) return true;
  if (areFamily(world, judgeId, d.id)) return true;
  if (c.victimId && areFamily(world, judgeId, c.victimId)) return true;
  if (areFriends(world, judgeId, d.id)) return true;
  return employmentTie(world, judge, d);
}

function holdsOffice(world: World, c: Citizen): boolean {
  const g = world.government;
  return c.office !== null || g.mayorId === c.id || g.council.includes(c.id) || g.judges.includes(c.id) || g.watch.includes(c.id);
}

/** Citizens fit to be drawn as temporary judges. `strict` demands reputation and a clean record. */
function temporaryJudgePool(world: World, c: Case, bench: CitizenId[], strict: boolean): CitizenId[] {
  const out: CitizenId[] = [];
  for (const id of world.order) {
    const cand = world.citizens[id];
    if (!cand || bench.includes(id) || !canSit(world, cand) || mustRecuse(world, id, c)) continue;
    // Children of Reverie are not charged and do not judge.
    if (cand.lifeStage === 'child') continue;
    if (strict) {
      if (cand.reputation < JUDGE_MIN_REPUTATION || cand.record.convictions.length > 0 || holdsOffice(world, cand)) continue;
    } else if (cand.reputation < 40 || world.government.judges.includes(id)) {
      continue;
    }
    out.push(id);
  }
  return out;
}

/**
 * The judges who may hear a case: the appointed bench minus recusals. When
 * fewer than two remain, temporary judges are drawn by lot from eligible
 * citizens (then, failing that, from any upstanding citizen) to make three.
 */
export function selectBench(world: World, c: Case): CitizenId[] {
  const bench: CitizenId[] = [];
  for (const id of world.government.judges) {
    const judge = world.citizens[id];
    if (!judge || bench.includes(id) || !canSit(world, judge) || mustRecuse(world, id, c)) continue;
    bench.push(id);
  }
  if (bench.length >= MIN_BENCH) return bench;
  for (const strict of [true, false]) {
    const pool = shuffle(world, temporaryJudgePool(world, c, bench, strict));
    for (const id of pool) {
      if (bench.length >= BENCH_SIZE) break;
      bench.push(id);
    }
    if (bench.length >= MIN_BENCH) break;
  }
  return bench;
}

/**
 * How strongly a scripted judge believes the defendant guilty: the evidence,
 * the defendant's record and reputation, and — because judges are citizens —
 * friendship with the defendant or the victim, plus a dishonest judge's thumb
 * on the scale for friends and against rivals.
 */
export function judgeBelief(world: World, judgeId: CitizenId, c: Case): number {
  const judge = world.citizens[judgeId];
  const d = world.citizens[c.defendantId];
  if (!judge || !d) return 0;
  const bondD = bondBetween(world, judgeId, d.id);
  const bondV = c.victimId ? bondBetween(world, judgeId, c.victimId) : 0;
  // A conviction handed down in this same sitting is not a prior: see
  // `cases.ts priorsOf`. A first offender is tried as a first offender.
  const priors = priorsOf(world, c).length;
  let belief = c.evidence;
  belief += priors > 0 ? RECORD_WEIGHT : 0;
  belief -= BOND_DEFENDANT_WEIGHT * (bondD / 100);
  belief += REPUTATION_WEIGHT * (1 - d.reputation / 100);
  belief += BOND_VICTIM_WEIGHT * (bondV / 100);
  belief += normal(world) * JUDGE_NOISE;
  // The thumb on the scale is weighed by the judge's public character — what
  // the city has watched them do — never by a hidden trait nobody can see.
  belief -= (1 - characterOf(judge).honesty) * 0.1 * Math.sign(bondD);
  // Somebody spoke for the defendant, and speaking well is worth something.
  belief -= advocacyDiscount(world, c);
  // A belief is how likely the bench thinks it is that this citizen did it.
  // There is no such thing as more certain than certain.
  return clamp(belief, 0, 1);
}
