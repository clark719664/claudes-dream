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
 * Print the morning edition: yesterday's top five events as headlines plus
 * the Treasury's daily report. Pushed to world.chronicle (bounded), replacing
 * an edition already printed today. Emits a low-weight 'story' notice.
 */
export function printMorningEdition(world: World, treasuryReport: string): ChronicleEdition {
  const reportedDay = Math.max(0, world.day - 1);
  const stories = topStories(world, reportedDay);
  const headlines = stories.length
    ? stories.map((s) => s.text)
    : [`A quiet day in Reverie: nothing of note was reported on day ${reportedDay}.`];
  const edition: ChronicleEdition = { day: world.day, headlines, treasuryReport };

  const last = world.chronicle[world.chronicle.length - 1];
  if (last && last.day === world.day) world.chronicle[world.chronicle.length - 1] = edition;
  else world.chronicle.push(edition);
  if (world.chronicle.length > CHRONICLE_LENGTH) world.chronicle.splice(0, world.chronicle.length - CHRONICLE_LENGTH);

  emit(world, 'story', `The Chronicle, day ${world.day}: "${headlines[0]}"`, [], 0.2,
    { edition: world.day, headlines, treasuryReport });
  return edition;
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
