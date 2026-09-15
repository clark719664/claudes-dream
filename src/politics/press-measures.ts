/**
 * The four levers a council holds over a paper, and what pulling one costs
 * (`docs/POLITICS.md` §6).
 *
 * | `press_licence` | printing requires a licence, granted or refused with a stated reason |
 * | `press_duty` | a stamp duty in lumens per edition — the quiet way to close a paper |
 * | `press_restraint` | names a subject the paper may not print for N days |
 * | `press_closure` | revokes the licence; the premises are re-let, the journalists lose their jobs |
 *
 * While `press` stands in the charter's rights all four are refused at
 * validation, with the reason and the road: the Council must first amend the
 * right out of its own charter, by its own threshold, in a vote flagged
 * self-interested and printed as a headline. Where a convention has entrenched
 * `press`, it cannot take even that step.
 *
 * **The scandal is the mechanism.** Every measure that carries moves the city's
 * reading of the Council at once and costs the councillors who voted for it in
 * their own standing, which is the part that reaches the next election.
 */
import { clamp } from '../types.ts';
import type { ActionResult, CitizenId, World } from '../types.ts';
import { emit } from '../sim/events.ts';
import { adjustReputation, isPresent } from '../citizens/citizen.ts';
import { fireFromJob } from '../economy/jobs.ts';
import { hasRight } from './charter.ts';
import type { Measure, MeasureHooks, MeasureKind, MeasureSpec } from './measures.ts';
import { tableMeasure } from './measures.ts';
import type { Paper } from './press.ts';
import { PRESS_WINDOW_DAYS, livePapers, paperById, pressState, readershipOf } from './press.ts';

/** What any press measure costs the people who passed it, before readership. */
export const PRESS_APPROVAL_BASE = -0.10;
export const PRESS_APPROVAL_READERSHIP = -0.15;
export const PRESS_APPROVAL_SUBJECT = -0.20;

// ---------------------------------------------------------------------------
// The four measures
// ---------------------------------------------------------------------------

export const PRESS_MEASURES: readonly MeasureKind[] = ['press_licence', 'press_duty', 'press_restraint', 'press_closure'];

/** Why a press measure may not even be tabled, or null. */
export function pressMeasureProblem(world: World, spec: MeasureSpec): string | null {
  if (hasRight(world, 'press')) {
    return 'The charter carries the freedom of the press: the Council may not license, tax, restrain or close a paper.'
      + ' Amend the right out of the charter first, by the charter\'s own threshold.';
  }
  if (spec.kind === 'press_restraint') {
    if (!spec.subject) return 'A restraint has to name the subject a paper may not print.';
    if (!Number.isFinite(spec.value) || (spec.value as number) <= 0) return 'A restraint has to name how many days it runs.';
  }
  if (spec.kind === 'press_closure' || (spec.kind === 'press_duty' && spec.subject)) {
    const paper = spec.subject ? paperById(world, String(spec.subject)) : null;
    if (!paper) return 'That measure has to name a paper on the roll.';
    if (spec.kind === 'press_closure' && paper.closedDay !== null) return `${paper.name} is already closed.`;
  }
  return null;
}

/** The papers a measure reaches: the one it names, or all of them. */
function targets(world: World, m: Measure): Paper[] {
  const named = m.subject ? paperById(world, String(m.subject)) : null;
  return named ? [named] : livePapers(world);
}

/** Did this paper lead on a councillor who voted for the measure, this week? */
export function ledOnAyeVoter(world: World, m: Measure, paper: Paper): boolean {
  const ayes = new Set(Object.entries(m.votes).filter(([, v]) => v).map(([id]) => id));
  if (ayes.size === 0) return false;
  const since = world.day - PRESS_WINDOW_DAYS;
  for (const ev of world.events ?? []) {
    if (ev.kind !== 'story' || ev.day < since) continue;
    const data = (ev.data ?? {}) as { paper?: string; about?: CitizenId; edition?: number };
    if (data.edition !== undefined) continue;
    if ((data.paper ?? 'chronicle') !== paper.id) continue;
    const named: CitizenId[] = [...(ev.actors ?? []), ...(data.about ? [data.about] : [])];
    if (named.some((id) => ayes.has(id))) return true;
  }
  return false;
}

/** What a press measure costs the people who passed it. */
export function approvalShiftFor(world: World, m: Measure): number {
  let worst = 0;
  for (const paper of targets(world, m)) {
    const shift = PRESS_APPROVAL_BASE
      + PRESS_APPROVAL_READERSHIP * readershipOf(world, paper.id)
      + (ledOnAyeVoter(world, m, paper) ? PRESS_APPROVAL_SUBJECT : 0);
    worst = Math.min(worst, shift);
  }
  return Math.round(worst * 100) / 100;
}

/**
 * The scandal. Every citizen's reading of the Council moves at once, the
 * councillors who voted for it carry the cost in their own standing, and the
 * city keeps the grievance for a while after — which is the part that reaches
 * the next election.
 */
export function applyPressApproval(world: World, m: Measure): number {
  const shift = approvalShiftFor(world, m);
  if (shift === 0) return 0;
  const state = pressState(world);
  state.approvalShift = Math.round((state.approvalShift + shift) * 100) / 100;
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !isPresent(world, c)) continue;
    const reading = c.approval ?? { mayor: 0.5, council: 0.5 };
    c.approval = {
      mayor: clamp(Math.round((reading.mayor + shift / 2) * 100) / 100, 0, 1),
      council: clamp(Math.round((reading.council + shift) * 100) / 100, 0, 1),
    };
  }
  const cost = Math.max(1, Math.round(Math.abs(shift) * 20));
  for (const [id, aye] of Object.entries(m.votes)) {
    if (!aye) continue;
    const c = world.citizens[id];
    if (c) adjustReputation(world, c, -cost, 'a measure against the press');
  }
  return shift;
}

/** What the city still holds against the Council for the last press measure. */
export function pressApprovalShift(world: World): number {
  return pressState(world).approvalShift;
}

function enactPress(world: World, m: Measure): string {
  const state = pressState(world);
  const named = m.subject ? paperById(world, String(m.subject)) : null;
  let text: string;
  switch (m.kind) {
    case 'press_licence': {
      const on = m.value > 0;
      if (named) {
        named.licensed = on;
        text = on ? `${named.name} is licensed to print.` : `${named.name}'s licence is refused, with the Council's reason on the record.`;
      } else {
        state.licensing = on;
        for (const p of livePapers(world)) if (on) p.licensed = true;
        text = on
          ? 'Printing in Reverie is a licensed trade; the papers already printing hold licences, and a new one must be granted its own.'
          : 'Printing needs no licence in Reverie.';
      }
      break;
    }
    case 'press_duty': {
      const duty = Math.max(0, Math.round(m.value));
      for (const p of named ? [named] : livePapers(world)) p.duty = duty;
      text = `A stamp duty of ${duty} ℓ an edition falls on ${named ? named.name : 'every paper in Reverie'}.`;
      break;
    }
    case 'press_restraint': {
      const days = Math.max(1, Math.round(m.value));
      const subject = String(m.subject || m.words || 'the subject named').slice(0, 60);
      for (const p of livePapers(world)) p.restraints.push({ subject, untilDay: world.day + days, measureId: m.id });
      text = `No paper may print about ${subject} for ${days} day${days === 1 ? '' : 's'}.`;
      break;
    }
    default: {
      if (!named) { text = 'The closure named no paper, and nothing changed.'; break; }
      named.closedDay = world.day;
      named.licensed = false;
      let lost = 0;
      for (const job of Object.values(world.jobs)) {
        if (job.role !== 'journalist' || !job.holderId) continue;
        if (named.buildingId && job.buildingId !== named.buildingId) continue;
        if (!named.buildingId && named.ownerId !== job.holderId) continue;
        fireFromJob(world, job.holderId, `${named.name} was closed by the Council`);
        lost++;
      }
      text = `${named.name} is closed; its licence is revoked, the premises are re-let`
        + `${lost > 0 ? ` and ${lost} journalist${lost === 1 ? '' : 's'} out of work` : ''}.`;
      break;
    }
  }
  const shift = applyPressApproval(world, m);
  return `${text}${shift < 0 ? ` The city's reading of the Council fell ${Math.abs(Math.round(shift * 100))} points.` : ''}`;
}

/**
 * How a councillor reads a measure against the press: what it will cost them
 * with the city, set against what the paper has been printing about them.
 * Nothing here is ideology — a councillor a paper has been running stories
 * about knows exactly what the measure is for.
 */
export function pressDisposition(world: World, cId: CitizenId, m: Measure): boolean | null {
  const c = world.citizens[cId];
  if (!c) return null;
  let score = 0;
  const since = world.day - PRESS_WINDOW_DAYS;
  for (const ev of world.events ?? []) {
    if (ev.kind !== 'story' || ev.day < since) continue;
    const data = (ev.data ?? {}) as { paper?: string; about?: CitizenId; edition?: number };
    if (data.edition !== undefined) continue;
    if (m.subject && (data.paper ?? 'chronicle') !== m.subject) continue;
    if ((ev.actors ?? []).includes(cId) || data.about === cId) score += 0.3;
  }
  // The cost, as the city will read it back to them at the next election.
  score += approvalShiftFor(world, m) * 2;
  if (m.proposerId === cId) score += 0.5;
  if (Math.abs(score) < 0.05) return null;
  return score > 0;
}

/**
 * A councillor puts one of the four levers to the Council. Refused here, with
 * the reason, while the charter still carries the freedom of the press.
 */
export function pressMeasure(
  world: World, cId: CitizenId, kind: MeasureKind,
  opts: { paper?: string | null; value?: number; subject?: string | null; words?: string } = {},
): ActionResult {
  if (!PRESS_MEASURES.includes(kind)) return { ok: false, message: 'That is not a measure against the press.' };
  return tableMeasure(world, cId, {
    kind,
    value: Math.round(opts.value ?? 0),
    subject: opts.subject ?? opts.paper ?? null,
    words: opts.words ?? '',
  }, pressHooks);
}

export const pressHooks: MeasureHooks = {
  problem(world: World, spec: MeasureSpec): string | null { return pressMeasureProblem(world, spec); },
  enact: enactPress,
  disposition: pressDisposition,
};
