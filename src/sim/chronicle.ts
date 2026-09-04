/**
 * The Chronicle — Reverie's newspaper. Every morning it prints an edition
 * built from the previous day's most important events; journalists can file
 * stories that put a citizen under the Watch's scrutiny.
 */
import type { ActionResult, ChronicleEdition, CitizenId, World, WorldEvent } from '../types.ts';
import { clamp } from '../types.ts';
import { emit, remember } from './events.ts';
import { adjustReputation, canAct } from '../citizens/citizen.ts';
import { adjustBond } from '../citizens/relationships.ts';

export const HEADLINES_PER_EDITION = 5;
/** Editions kept in world.chronicle. */
export const CHRONICLE_LENGTH = 60;
/** Days a named citizen stays under extra Watch scrutiny after an exposé. */
export const SCRUTINY_DAYS = 3;
/** An exposé only bites if the subject has an undetected offence this recent. */
export const STORY_OFFENCE_WINDOW_TICKS = 48;
export const MAX_HEADLINE_LENGTH = 280;

/** The Chronicle's own edition notice must not become tomorrow's headline. */
function isEditionNotice(e: WorldEvent): boolean {
  return e.kind === 'story' && e.data !== undefined && 'edition' in e.data;
}

/**
 * The day's top stories: highest weight first, later events first on ties,
 * duplicate texts collapsed.
 */
export function topStories(world: World, day: number, limit = HEADLINES_PER_EDITION): WorldEvent[] {
  const candidates: { e: WorldEvent; i: number }[] = [];
  world.events.forEach((e, i) => {
    if (e.day === day && !isEditionNotice(e)) candidates.push({ e, i });
  });
  candidates.sort((a, b) => b.e.weight - a.e.weight || b.e.tick - a.e.tick || b.i - a.i);
  const out: WorldEvent[] = [];
  const seen = new Set<string>();
  for (const { e } of candidates) {
    if (seen.has(e.text)) continue;
    seen.add(e.text);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The shape of a headline: its words with every number blanked out. Two
 * lines of the same shape are the same standing notice on a different day
 * ("The Community Chest is empty: 4 citizens..." / "...7 citizens..."), and
 * an edition that runs one two mornings in a row reads like a stuck clock.
 */
export function headlineShape(text: string): string {
  return text.toLowerCase().replace(/\d+([.,]\d+)*/g, '#').replace(/\s+/g, ' ').trim();
}

/**
 * Print the morning edition: yesterday's five best stories plus the
 * Treasury's daily report. The editor takes the weightiest story of each
 * shape it has not just run — a page with the same sentence twice under
 * different numbers, or with yesterday's standing notice at the top again,
 * is a page that tells the city nothing — and only falls back to repeats
 * when the day had nothing else in it. Pushed to world.chronicle (bounded),
 * replacing an edition already printed today. Emits a low-weight 'story'
 * notice.
 */
export function printMorningEdition(world: World, treasuryReport: string): ChronicleEdition {
  const reportedDay = Math.max(0, world.day - 1);
  // The shelf holds both papers now; the Chronicle reads its own back number.
  const previous = [...world.chronicle].reverse().find((e) => (e.paper ?? 'chronicle') === 'chronicle');
  const printedYesterday = new Set((previous?.headlines ?? []).map(headlineShape));
  const candidates = topStories(world, reportedDay, HEADLINES_PER_EDITION * 4);
  const stories: WorldEvent[] = [];
  const shapes = new Set<string>();
  const taken = new Set<WorldEvent>();
  // fresh news of its own shape first, then anything of a new shape, then repeats
  for (const pass of [0, 1, 2]) {
    for (const e of candidates) {
      if (stories.length >= HEADLINES_PER_EDITION) break;
      if (taken.has(e)) continue;
      const shape = headlineShape(e.text);
      if (pass < 2 && shapes.has(shape)) continue;
      if (pass === 0 && printedYesterday.has(shape)) continue;
      stories.push(e);
      taken.add(e);
      shapes.add(shape);
    }
  }
  const headlines = stories.length
    ? stories.map((s) => s.text)
    : [`A quiet day in Reverie: nothing of note was reported on day ${reportedDay}.`];
  const edition: ChronicleEdition = { day: world.day, paper: 'chronicle', headlines, treasuryReport };

  const printedToday = world.chronicle.findIndex((e) => e.day === world.day && (e.paper ?? 'chronicle') === 'chronicle');
  if (printedToday >= 0) world.chronicle[printedToday] = edition;
  else world.chronicle.push(edition);
  // The shelf is shared with the Harbor Ledger, so each paper is bounded on
  // its own back numbers rather than on the length of the shelf.
  const mine = world.chronicle.filter((e) => (e.paper ?? 'chronicle') === 'chronicle');
  if (mine.length > CHRONICLE_LENGTH) {
    const drop = new Set(mine.slice(0, mine.length - CHRONICLE_LENGTH));
    world.chronicle = world.chronicle.filter((e) => !drop.has(e));
  }

  emit(world, 'story', `The Chronicle, day ${world.day}: "${headlines[0]}"`, [], 0.2,
    { edition: world.day, headlines, treasuryReport });
  return edition;
}

/** Words as the Chronicle compares them: case, punctuation and spacing set aside. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A headline long enough that repeating it word for word can only be a quotation. */
export const QUOTE_LENGTH = 40;

/**
 * Is this "story" just something that already happened today, copied out?
 * The Chronicle prints what the city has not already read: an event's own
 * sentence (or another journalist's headline from the same day) is not a
 * story, and the returned text says which line it was.
 */
export function quotesTodaysNews(world: World, headline: string): string | null {
  const wanted = normalise(headline);
  if (!wanted) return null;
  for (const e of world.events) {
    if (e.day !== world.day) continue;
    const other = normalise(e.text);
    if (!other) continue;
    if (other === wanted) return e.text;
    if (wanted.length >= QUOTE_LENGTH && other.includes(wanted)) return e.text;
    if (other.length >= QUOTE_LENGTH && wanted.includes(other)) return e.text;
  }
  return null;
}

/** True when the citizen has an offence the Watch never saw, within the exposé window. */
export function hasUndetectedRecentOffence(world: World, c: { recentOffences: { tick: number; detected: boolean }[] }): boolean {
  return c.recentOffences.some((o) => !o.detected && world.tick - o.tick <= STORY_OFFENCE_WINDOW_TICKS);
}

/**
 * A journalist files a story. Requires a held journalist job. The story is a
 * newsworthy event; the journalist gains a little reputation. Naming a
 * citizen who has recently got away with something puts them under Watch
 * scrutiny for three days and costs them reputation.
 */
export function journalistStory(world: World, journalistId: CitizenId, headline: string, about?: CitizenId): ActionResult {
  const j = world.citizens[journalistId];
  if (!j) return { ok: false, message: 'Unknown citizen.' };
  if (!canAct(world, j)) return { ok: false, message: 'You cannot publish right now.' };
  const job = j.jobId ? world.jobs[j.jobId] : undefined;
  if (!job || job.role !== 'journalist' || job.holderId !== j.id) {
    return { ok: false, message: 'Only a working journalist can publish in the Chronicle.' };
  }
  const text = (headline ?? '').trim().slice(0, MAX_HEADLINE_LENGTH);
  if (!text) return { ok: false, message: 'A story needs a headline.' };
  const quoted = quotesTodaysNews(world, text);
  if (quoted) {
    return { ok: false, message: `The city read that this morning ("${quoted.slice(0, 80)}…"); a story has to add something of your own.` };
  }
  const subject = about ? world.citizens[about] : undefined;
  if (about && !subject) return { ok: false, message: 'Nobody by that id lives in Reverie.' };

  const byline = subject && subject.id !== j.id
    ? `The Chronicle: "${text}" — ${j.name} on ${subject.name}`
    : `The Chronicle: "${text}" — by ${j.name}`;
  const actors = subject && subject.id !== j.id ? [j.id, subject.id] : [j.id];
  emit(world, 'story', byline, actors, 0.6, { headline: text, about: subject?.id ?? null });

  adjustReputation(world, j, 1);
  j.stats.storiesPublished++;
  j.needs.purpose = clamp(j.needs.purpose + 3, 0, 100);
  world.counters.scrutiny = (world.counters.scrutiny ?? 0) + 1;
  remember(world, j.id, 'work', `You published "${text}" in the Chronicle.`);

  if (subject && subject.id !== j.id) {
    if (hasUndetectedRecentOffence(world, subject)) {
      world.counters[`scrutiny:${subject.id}`] = SCRUTINY_DAYS;
      adjustReputation(world, subject, -3, 'named in a Chronicle exposé');
      adjustBond(world, subject.id, j.id, -10, false);
      remember(world, subject.id, 'event', `The Chronicle ran a story about you: "${text}". The Watch is paying attention.`);
      return { ok: true, message: `Published "${text}". The Watch will be looking closely at ${subject.name}.` };
    }
    adjustBond(world, subject.id, j.id, -3, false);
    remember(world, subject.id, 'event', `The Chronicle ran a story about you: "${text}".`);
  }
  return { ok: true, message: `Published "${text}".` };
}
