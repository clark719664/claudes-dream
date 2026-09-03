/**
 * A citizen's notebook.
 *
 * Memory is what happened to a citizen; notes are what it chose to write down.
 * Both travel with it for life and both are in every observation, but a note
 * is the one thing in Reverie that is nobody else's business: it is never
 * emitted, never remembered as an event, never printed by the Chronicle and
 * never admissible in Court. The engine stores the text and nothing more — it
 * does not read it, and it never writes one on a citizen's behalf.
 *
 * The notebook holds sixty pages; a sixty-first note pushes out the oldest.
 */
import type { ActionResult, CitizenId, World } from '../types.ts';

/** Pages in the notebook; the oldest is dropped to make room. */
export const MAX_NOTES = 60;
/** A note is at most this long, like every other text a citizen writes. */
export const MAX_NOTE_LENGTH = 280;

function fail(message: string): ActionResult {
  return { ok: false, message };
}

/** The notebook of a citizen (empty for a citizen the world does not know). */
export function notesOf(world: World, cId: CitizenId): string[] {
  const c = world.citizens[cId];
  if (!c) return [];
  c.notes ??= [];
  return c.notes;
}

/**
 * Write a note. Blank notes are refused (there is nothing to keep); longer
 * ones are trimmed to 280 characters rather than rejected.
 */
export function note(world: World, cId: CitizenId, text: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const body = typeof text === 'string' ? text.trim().slice(0, MAX_NOTE_LENGTH) : '';
  if (!body) return fail('A note needs something written on it.');
  c.notes ??= [];
  c.notes.push(body);
  const dropped = c.notes.length > MAX_NOTES;
  if (dropped) c.notes.splice(0, c.notes.length - MAX_NOTES);
  return {
    ok: true,
    message: `You wrote it down (note ${c.notes.length} of ${MAX_NOTES}${dropped ? ', and the oldest page fell out' : ''}).`,
  };
}

/** Tear out one page by its position in the notebook (0 is the oldest). */
export function forget(world: World, cId: CitizenId, index: number): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  c.notes ??= [];
  if (c.notes.length === 0) return fail('Your notebook is empty.');
  if (!Number.isFinite(index)) return fail('That is not a page of your notebook.');
  const i = Math.trunc(index);
  if (i < 0 || i >= c.notes.length) {
    return fail(`You have ${c.notes.length} note(s), numbered 0 to ${c.notes.length - 1}.`);
  }
  const [gone] = c.notes.splice(i, 1);
  return { ok: true, message: `You struck out note ${i} ("${gone.slice(0, 40)}${gone.length > 40 ? '…' : ''}"); ${c.notes.length} left.` };
}
