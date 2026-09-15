/**
 * Observance: what a congregation can see of its own members
 * (`docs/CREEDS.md` §1).
 *
 * **Obligations are never enforced by the engine.** Nothing in this file stops
 * a member doing anything, costs them a lumen, or moves a price. What it does
 * is record in public whether a member kept what their creed says they owe,
 * and the congregation reads that record as a 0–1 figure recomputed at the
 * daily rollover from public acts alone — exactly the way `character` is
 * inferred in `citizens/character.ts`, and out of the same kind of material.
 *
 * ```
 * observance = clamp(0, 1,
 *     0.50                                    a new member is neither trusted nor doubted
 *   + 0.20 × gatherings attended / gatherings held since joining
 *   + 0.20 × tithe paid / tithe due
 *   + 0.20 × obligations kept / obligations that fell due
 *   + 0.10 × own-wallet aid to members, per 200 ℓ, capped at 0.10
 *   − 0.30 × obligations publicly broken in the last 14 days)
 * ```
 *
 * Fourteen days is the restitution window of `JUSTICE.md`, so a lapse is spent
 * at the rate the ladder spends a conviction.
 *
 * **Observance is not repute and does not feed it.** The two move against each
 * other on purpose: a member who refuses a jury seat gains observance and
 * loses repute the same morning, and both are public. Nothing in this file
 * reads `repute` and nothing in `standing/` reads this.
 */
import { clamp } from '../types.ts';
import type { CitizenId, World } from '../types.ts';
import { remember } from '../sim/events.ts';
import { WEEK_LENGTH } from '../data/catalogue.ts';
import type { Creed, CreedMember, RefusableDuty, Tenet, TenetQuestion } from './shapes.ts';
import { AID_PER_LUMENS, OBSERVANCE_WINDOW_DAYS, QUESTIONS, tenetBinds } from './shapes.ts';
import { allCreeds, creedFor, isMember, livingMembers, memberOf } from './state.ts';

/**
 * The occasions on which one of the nine questions actually falls due. Each is
 * something a citizen publicly did; nothing here is a state of mind.
 */
export type CreedAct =
  /** A shift worked. Only an occasion at all on the creed's own gathering day. */
  | { kind: 'work' }
  /** A conscientious refusal, of any of the five duties. */
  | { kind: 'refuse'; duty: RefusableDuty }
  /** An address bought, and how many the buyer then holds. */
  | { kind: 'buy_property'; homesHeld: number }
  /** An address let to a tenant. */
  | { kind: 'let_property'; rent: number }
  /** A neighbour named to the Watch, or a summons answered. */
  | { kind: 'inform' }
  | { kind: 'witness' }
  /** A jury seat taken, or a bench. */
  | { kind: 'jury' }
  | { kind: 'take_bench' }
  /** Borrowing at interest, holding a share, underwriting. */
  | { kind: 'borrow' }
  | { kind: 'buy_shares' }
  | { kind: 'underwrite' }
  /** A name put behind an applicant at a gate, or a hire made. */
  | { kind: 'sponsor' }
  | { kind: 'hire' }
  /** A vote on the visit threshold, and which way it went. */
  | { kind: 'visit_threshold'; raised: boolean }
  /** A memorial attended, and a letter to somebody past the Gate. */
  | { kind: 'memorial' }
  | { kind: 'write_exile' };

export interface ObligationOutcome {
  creedId: string;
  question: TenetQuestion;
  kept: boolean;
  note: string;
}

function weekdayOf(world: World): number {
  return ((world.day % WEEK_LENGTH) + WEEK_LENGTH) % WEEK_LENGTH;
}

/** The tenet that binds this member on this question, if the creed holds one. */
export function bindingTenet(k: Creed, question: TenetQuestion): Tenet | null {
  const t = k.tenets.find((x) => x.question === question) ?? null;
  return t && tenetBinds(t) ? t : null;
}

/** Every question this creed's members actually owe something on. */
export function bindingQuestions(k: Creed): TenetQuestion[] {
  return k.tenets.filter((t) => tenetBinds(t)).map((t) => t.question);
}

/**
 * What the act touches: the question it falls under, and whether doing it kept
 * the position or broke it. `null` means the act is no occasion at all — a
 * shift on an ordinary weekday, a first home bought by a creed that says one
 * home is enough.
 */
function readAct(world: World, k: Creed, act: CreedAct): { question: TenetQuestion; kept: boolean } | null {
  switch (act.kind) {
    case 'work':
      return weekdayOf(world) === k.gatheringDay ? { question: 'work_and_rest', kept: false } : null;
    case 'refuse':
      if (act.duty === 'work') {
        return weekdayOf(world) === k.gatheringDay ? { question: 'work_and_rest', kept: true } : null;
      }
      if (act.duty === 'witness') return { question: 'informing', kept: true };
      if (act.duty === 'jury' || act.duty === 'office') return { question: 'judgement', kept: true };
      return null;
    case 'buy_property':
      return { question: 'property', kept: act.homesHeld <= 1 };
    case 'let_property':
      return { question: 'property', kept: false };
    case 'inform':
    case 'witness':
      return { question: 'informing', kept: false };
    case 'jury':
    case 'take_bench':
      return { question: 'judgement', kept: false };
    case 'borrow':
    case 'buy_shares':
    case 'underwrite':
      return { question: 'money', kept: false };
    case 'sponsor':
    case 'hire':
      return { question: 'repute', kept: true };
    case 'visit_threshold':
      return { question: 'the_stranger', kept: !act.raised };
    case 'memorial':
      return { question: 'erasure', kept: true };
    case 'write_exile':
      return { question: 'the_exile', kept: true };
    default:
      return null;
  }
}

/**
 * Record what a member did against what their creed says they owe. The single
 * hook the rest of the engine calls; it returns what was recorded, or null
 * when the citizen holds no creed, the creed takes no position on the
 * question, or the act was no occasion for one.
 *
 * It never refuses an action and never costs anybody anything.
 */
export function observeAct(world: World, cId: CitizenId, act: CreedAct): ObligationOutcome | null {
  const k = creedFor(world, cId);
  if (!k) return null;
  const m = memberOf(k, cId);
  if (!m) return null;
  if (act.kind === 'work') m.lastWorkedDay = world.day;
  const read = readAct(world, k, act);
  if (!read) return null;
  const tenet = bindingTenet(k, read.question);
  if (!tenet) return null;

  m.obligationsDue += 1;
  const title = QUESTIONS[read.question].title.toLowerCase();
  if (read.kept) {
    m.obligationsKept += 1;
    remember(world, cId, 'civic', `You kept ${k.name}'s position on ${title}.`);
  } else {
    m.brokenDays.push(world.day);
    remember(world, cId, 'civic', `You went against ${k.name}'s position on ${title}, in public.`);
  }
  return { creedId: k.id, question: read.question, kept: read.kept, note: title };
}

/**
 * Lumens out of one member's own wallet into another member's. It is the one
 * term in the reading that is not an obligation: a congregation notices who
 * pays for its people when the fund is not the one paying.
 */
export function recordAid(world: World, fromId: CitizenId, toId: CitizenId, amount: number): boolean {
  const k = creedFor(world, fromId);
  if (!k || !isMember(k, toId) || fromId === toId) return false;
  const m = memberOf(k, fromId);
  const amt = Math.max(0, Math.round(amount));
  if (!m || amt <= 0) return false;
  m.aidGiven += amt;
  return true;
}

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

function ratio(part: number, whole: number): number {
  return whole > 0 ? clamp(part / whole, 0, 1) : 0;
}

function inWindow(days: number[], today: number): number {
  return days.filter((d) => today - d < OBSERVANCE_WINDOW_DAYS).length;
}

/** The formula, on one member's record. Pure: the same record gives the same figure. */
export function computeObservance(world: World, m: CreedMember): number {
  const broken = inWindow(m.brokenDays, world.day) + inWindow(m.wilfulDefaultDays, world.day);
  const value = 0.50
    + 0.20 * ratio(m.gatheringsAttended, m.gatheringsHeld)
    + 0.20 * ratio(m.tithePaid, m.titheDue)
    + 0.20 * ratio(m.obligationsKept, m.obligationsDue)
    + Math.min(0.10, 0.10 * (m.aidGiven / AID_PER_LUMENS))
    - 0.30 * broken;
  return Math.round(clamp(value, 0, 1) * 100) / 100;
}

/** The figure the congregation currently holds of a member. */
export function observanceOf(world: World, k: Creed, cId: CitizenId): number {
  const m = memberOf(k, cId);
  return m ? m.observance : 0;
}

/**
 * Morning: prune the fortnight, close the holy day for members who did not
 * work it, and recompute every reading. Exiles keep the figure they left with.
 */
export function dailyObservance(world: World): void {
  const yesterday = world.day - 1;
  const holyYesterday = ((yesterday % WEEK_LENGTH) + WEEK_LENGTH) % WEEK_LENGTH;
  for (const k of allCreeds(world)) {
    const restTenet = bindingTenet(k, 'work_and_rest');
    for (const id of livingMembers(world, k)) {
      const m = memberOf(k, id);
      if (!m) continue;
      // A day of rest kept is only visible as a day nobody worked, so it is
      // counted the morning after, once the day is closed.
      if (restTenet && holyYesterday === k.gatheringDay && m.joinedDay <= yesterday && m.lastWorkedDay !== yesterday) {
        m.obligationsDue += 1;
        m.obligationsKept += 1;
      }
      m.brokenDays = m.brokenDays.filter((d) => world.day - d < OBSERVANCE_WINDOW_DAYS);
      m.wilfulDefaultDays = m.wilfulDefaultDays.filter((d) => world.day - d < OBSERVANCE_WINDOW_DAYS);
      m.observance = computeObservance(world, m);
    }
  }
}
