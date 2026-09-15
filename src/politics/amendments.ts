/**
 * Amending the charter (`docs/POLITICS.md` §2).
 *
 * `propose_amendment { article, field, value, words }` puts an article to the
 * body the charter names, with two differences from an ordinary measure: it
 * needs the charter's own threshold of the **whole body** rather than of those
 * voting, and it is read the day *after* it is tabled. That reading rule is
 * the only brake the fastest cities have.
 *
 * An amendment that extends the term of the body voting on it, narrows the
 * franchise, or strikes a right out of the charter is flagged
 * **self-interested** — in the observation, in the headline and in the record.
 * The engine does not block it and does not force a referendum. It labels it,
 * loudly, and the citizens do the rest or do not. The one thing it does refuse
 * is an entrenched article, and it gives the reason and the road that is still
 * open: a convention may reach what the Council may not.
 */
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent } from '../citizens/citizen.ts';
import { bondBetween } from '../citizens/relationships.ts';
import type { CharterEdit, CharterRight, Franchise } from './charter.ts';
import {
  amendingBody, charterOf, currentValue, editInWords, editProblem, entrenchedRefusal, inFranchise, writeEdit,
} from './charter.ts';
import type { Measure, MeasureHooks, MeasureSpec } from './measures.ts';
import { openMeasuresOfKind, tableMeasure } from './measures.ts';

/** How narrow a franchise is, so a change to it can be read as widening or narrowing. */
const FRANCHISE_BREADTH: Record<Franchise, number> = {
  all: 5, property: 3, shares: 3, guild: 2, elders: 2, none: 0,
};

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The edit an amendment carries, or null for a measure that is not one. */
export function editOf(m: Measure): CharterEdit | null {
  return m.kind === 'amend_charter' ? m.edit : null;
}

// ---------------------------------------------------------------------------
// Self-interest
// ---------------------------------------------------------------------------

/**
 * Would this amendment pay the people voting on it? Three shapes, all read off
 * the charter itself: it extends the term of the body voting, it narrows who
 * counts, or it takes a right out of the charter.
 */
export function selfInterest(world: World, edit: CharterEdit | null): string | null {
  if (!edit) return null;
  const ch = charterOf(world);
  const article = String(edit.article);
  if (article === 'term' && typeof edit.value === 'number' && edit.value > ch.term) {
    return 'it extends the term of the body voting on it';
  }
  if (article === 'franchise' && typeof edit.value === 'string') {
    const now = FRANCHISE_BREADTH[ch.franchise] ?? 5;
    const then = FRANCHISE_BREADTH[edit.value as Franchise] ?? 5;
    if (then < now) return 'it narrows the franchise';
  }
  if (article === 'rights' && Array.isArray(edit.value)) {
    const kept: string[] = edit.value;
    const struck = ch.rights.filter((r) => !kept.includes(r));
    if (struck.length > 0) return `it strikes ${struck.join(' and ')} out of the rights`;
  }
  if (article === 'seats' && typeof edit.value === 'number' && edit.value < ch.seats) {
    return 'it takes seats away from the city';
  }
  if (article === 'recall' && edit.field === 'allowed' && edit.value === false && ch.recall.allowed) {
    return 'it takes away the city\'s power to recall an officeholder';
  }
  return null;
}

/** Flagged in the observation and in the headline, never refused. */
export function isSelfInterested(world: World, m: Measure): boolean {
  return m.kind === 'amend_charter' && selfInterest(world, editOf(m)) !== null;
}

// ---------------------------------------------------------------------------
// Tabling
// ---------------------------------------------------------------------------

/** Why this amendment cannot be tabled, or null. */
export function amendmentProblem(world: World, edit: CharterEdit | null): string | null {
  if (!edit) return 'An amendment must name an article of the charter.';
  const shape = editProblem(world, edit);
  if (shape) return shape;
  const article = String(edit.article);
  const ch = charterOf(world);
  if (ch.entrenched.includes(article)) return entrenchedRefusal(article);
  // Entrenching a right protects the right itself, wherever it is written: a
  // council that may not reach `press` may not strike it out of `rights`.
  if (article === 'rights' && Array.isArray(edit.value)) {
    const kept: string[] = edit.value;
    const struck = ch.rights.filter((r) => !kept.includes(r));
    const barred = struck.find((r) => ch.entrenched.includes(r));
    if (barred) return entrenchedRefusal(barred);
  }
  const now = currentValue(world, edit);
  const same = Array.isArray(edit.value) && Array.isArray(now)
    ? edit.value.length === now.length && edit.value.every((x) => now.includes(x))
    : now === edit.value;
  if (same) return 'The charter already says that.';
  return null;
}

/** Put an article of the charter to the body that may amend it. */
export function proposeAmendment(
  world: World, cId: CitizenId,
  spec: { article: string; field?: string | null; value: CharterEdit['value']; words?: string },
): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const edit: CharterEdit = { article: String(spec?.article ?? ''), field: spec?.field ?? null, value: spec?.value as CharterEdit['value'] };
  const problem = amendmentProblem(world, edit);
  if (problem) return fail(problem);
  const words = (spec.words ?? '').trim() || `Amend the charter: ${editInWords(edit)}.`;
  return tableMeasure(world, cId, { kind: 'amend_charter', edit, words, value: typeof edit.value === 'number' ? edit.value : 0 }, amendmentHooks);
}

/** Every amendment before the body today. */
export function openAmendments(world: World): Measure[] {
  return openMeasuresOfKind(world, 'amend_charter');
}

// ---------------------------------------------------------------------------
// How a scripted member reads one
// ---------------------------------------------------------------------------

/**
 * A scripted member of the amending body who has not voted by the reading
 * makes their mind up from their own situation, exactly as they would on the
 * Council floor: an amendment that would take their own vote away is a nay, an
 * amendment that pays the body they sit in is an aye, an amendment moved by
 * somebody they are close to leans their way, and an amendment that touches
 * neither is left to the mover to argue — they abstain rather than be counted
 * for something they have no reading of.
 */
export function amendmentDisposition(world: World, cId: CitizenId, m: Measure): boolean | null {
  const c = world.citizens[cId];
  const edit = editOf(m);
  if (!c || !edit) return null;
  let score = 0;
  const interest = selfInterest(world, edit);
  if (interest) {
    // The body voting is the body paid, so this is a reason to vote aye — and
    // a reason to vote nay for a member who would themselves fall out of the
    // franchise it narrows.
    score += 0.3;
    if (edit.article === 'franchise' && !wouldStillCount(world, c, String(edit.value) as Franchise)) score -= 1;
    if (edit.article === 'rights' && Array.isArray(edit.value)) {
      // A member who reads a paper loses something when the press right goes.
      const kept: string[] = edit.value;
      const struck = charterOf(world).rights.filter((r) => !kept.includes(r));
      if (struck.includes('press' as CharterRight) && c.paper) score -= 0.2;
      if (struck.includes('due_process' as CharterRight)) score -= 0.3;
    }
  }
  const bond = bondBetween(world, cId, m.proposerId);
  if (cId === m.proposerId) score += 1;
  else if (bond > 40) score += 0.2;
  else if (bond < -30) score -= 0.2;
  // Widening the franchise, opening a switch or adding a right costs the body
  // something and gives it to the city; a member reads that as it stands.
  if (edit.article === 'rights' && Array.isArray(edit.value) && edit.value.length > charterOf(world).rights.length) score += 0.15;
  if (edit.article === 'transparency' && edit.value === true) score -= 0.1;
  if (edit.article === 'transparency' && edit.value === false) score += 0.1;
  if (Math.abs(score) < 0.05) return null;
  return score > 0;
}

/** Would this citizen still count under a different franchise? */
function wouldStillCount(world: World, c: Citizen, franchise: Franchise): boolean {
  const ch = charterOf(world);
  const was = ch.franchise;
  ch.franchise = franchise;
  const counts = inFranchise(world, c);
  ch.franchise = was;
  return counts;
}

// ---------------------------------------------------------------------------
// Enactment
// ---------------------------------------------------------------------------

/** Write the article into the charter, and tell the whole city what changed. */
export function enactAmendment(world: World, m: Measure): string {
  const edit = editOf(m);
  if (!edit) return 'The amendment named no article, and nothing changed.';
  const before = currentValue(world, edit);
  const interest = selfInterest(world, edit);
  writeEdit(world, edit);
  const shown = Array.isArray(before) ? (before.length ? before.join(', ') : 'nothing') : String(before);
  const text = `The charter is amended: ${editInWords(edit)} (it said ${shown}).`
    + (interest ? ` The amendment is self-interested: ${interest}.` : '');
  emit(world, 'law', text, [m.proposerId], interest ? 1.0 : 0.9,
    { measureId: m.id, article: edit.article, field: edit.field ?? null, value: edit.value, selfInterested: Boolean(interest) });
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && isPresent(world, c)) remember(world, id, 'civic', text);
  }
  return text;
}

/** The hooks the session reads for an amendment. */
export const amendmentHooks: MeasureHooks = {
  problem(world: World, spec: MeasureSpec, proposer: Citizen): string | null {
    void proposer;
    return amendmentProblem(world, spec.edit ?? null);
  },
  enact: enactAmendment,
  disposition: amendmentDisposition,
};

/** Who sits in the amending body today, for the observation and the dashboard. */
export function amendingBodyNames(world: World): string[] {
  return amendingBody(world).map((id) => world.citizens[id]?.name ?? id);
}
