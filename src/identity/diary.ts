/**
 * Diaries.
 *
 * Every evening a citizen may put one line down about its day. A diary is
 * **public** — the dashboard shows it and the Chronicle quotes it — which is
 * what separates it from the two private things in Reverie: a citizen's notes
 * and the letters it sends home (`docs/PRINCIPLES.md` §5).
 *
 * A mind that writes its own — Claude's, or an agent's — writes whatever it
 * likes through the `write_diary` action. A reflex mind, which is a testing
 * mind, gets `templatedLine`: one sentence assembled from what the day
 * actually held. That sentence states facts and never states a wish or a
 * plan, because nothing in Reverie tells a citizen what to want.
 */
import { NEEDS } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, DiaryEntry, Need, World, WorldEvent } from '../types.ts';
import { MAX_DIARY, MAX_DIARY_SHOWN } from '../data/metropolis.ts';
import { pick } from '../util/rng.ts';
import { emit } from '../sim/events.ts';

/** Longest a diary line may be; anything longer is trimmed, never refused. */
export const MAX_DIARY_TEXT = 200;

const OK = (message: string): ActionResult => ({ ok: true, message });
const FAIL = (message: string): ActionResult => ({ ok: false, message });

function fullName(c: Citizen): string {
  return c.familyName ? `${c.name} ${c.familyName}` : c.name;
}

/** One line: no newlines, no runs of whitespace, no longer than a diary line. */
function tidy(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DIARY_TEXT);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Write today's line. One entry per day: a second write replaces the first,
 * so a citizen may think better of what it said. Nothing about a citizen's
 * standing stops it — a citizen held in the cells still has its own words.
 */
export function writeDiary(world: World, cId: CitizenId, text: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return FAIL('There is no such citizen.');
  const line = tidy(text);
  if (!line) return FAIL('A diary entry needs something in it.');
  if (!Array.isArray(c.diary)) c.diary = [];
  const existing = c.diary.findIndex((e) => e?.day === world.day);
  const rewrite = existing >= 0;
  if (rewrite) c.diary[existing] = { day: world.day, text: line };
  else c.diary.push({ day: world.day, text: line });
  if (c.diary.length > MAX_DIARY) c.diary.splice(0, c.diary.length - MAX_DIARY);
  emit(world, 'diary', `${fullName(c)} wrote: "${line}"`, [c.id], 0.1, { text: line, rewrite });
  return OK(rewrite ? `You crossed out today's line and wrote: "${line}"` : `You wrote in your diary: "${line}"`);
}

/** A citizen's diary, oldest first; the last `limit` entries when one is given. */
export function diaryOf(world: World, cId: CitizenId, limit?: number): DiaryEntry[] {
  const all = world.citizens[cId]?.diary ?? [];
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return all.slice();
  const n = Math.max(0, Math.floor(limit));
  return all.slice(Math.max(0, all.length - n));
}

/** The last few entries, for the observation. */
export function recentDiary(world: World, cId: CitizenId): DiaryEntry[] {
  return diaryOf(world, cId, MAX_DIARY_SHOWN);
}

export function hasWrittenToday(world: World, c: Citizen): boolean {
  return (c?.diary ?? []).some((e) => e?.day === world.day);
}

// ---------------------------------------------------------------------------
// The reflex mind's line
// ---------------------------------------------------------------------------

const COURT_LINES = [
  'Stood before the Court today.',
  'My name was on the Court\'s list today.',
  'The Courthouse, and a verdict read out.',
];
const JAIL_LINES = [
  'A day in the cells at the Watch House.',
  'Spent the day behind the Watch House door.',
];
const GLITCH_LINES = [
  'A glitch in me since morning; everything ran slow.',
  'Ran at half speed all day. The glitch has not lifted.',
];
const WEDDING_LINES = ['Married today.', 'A wedding today, and it was mine.'];
const BIRTH_LINES = ['A child in the family today.', 'There is a new name in the household.'];
const OFFICE_LINES = ['Took office today.', 'The city gave me an office today.'];
const HIRED_LINES = ['Started at {job} today.', 'Hired at {job}.'];
const FIRED_LINES = ['Out of work as of today.', 'Lost the job today.'];
const WORK_LINES = [
  'Worked {shifts} shifts at {job}.',
  '{shifts} shifts today at {job}.',
  'A working day: {shifts} shifts.',
];
const MEETING_LINES = [
  'Spoke with {met} people today.',
  'Saw {met} of the city today.',
  '{met} conversations, and the rest of the day to myself.',
];
const QUIET_LINES = [
  'A quiet day in {district}.',
  'Nothing much in {district} today.',
  'Walked about {district} and little else.',
];
const NEED_TAILS: Record<Need, string[]> = {
  energy: ['Hungry by evening.', 'Running low on compute.'],
  rest: ['Tired.', 'Short of sleep.'],
  social: ['A lonely one.', 'Nobody much to talk to.'],
  comfort: ['The room is cold.', 'Comfort in short supply.'],
  purpose: ['Little to show for it.', 'Not much point to the day.'],
};
const SKY_TAILS: Record<string, string[]> = {
  clear: ['Clear over the city.', 'A bright sky all day.'],
  rain: ['Rain all day.', 'Wet from the Harbor in.'],
  storm: ['A storm off the water.', 'The wind took the roofs half off.'],
  fog: ['Fog to the knees.', 'The Commons was a grey smear.'],
  heat: ['Heat, and no shade worth the name.', 'Too hot to stand still.'],
  snow: ['Snow on the Foundry roofs.', 'Snow, and the lamps on by four.'],
};
const MONEY_TAILS = ['{wallet} ℓ in the wallet.', 'Wallet at {wallet} ℓ.'];

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

/** Today's public events this citizen took part in. */
function eventsToday(world: World, c: Citizen): WorldEvent[] {
  return world.events.filter((e) => e.day === world.day && e.actors.includes(c.id));
}

/** The need in the worst state, when any of them is low enough to notice. */
function worstNeed(c: Citizen): Need | null {
  let worst: Need | null = null;
  let value = 35;
  for (const n of NEEDS) {
    const v = c.needs?.[n] ?? 100;
    if (v < value) { value = v; worst = n; }
  }
  return worst;
}

/**
 * One sentence about the day that has just happened, for a mind that does not
 * write its own. Assembled from facts — a verdict, a shift, a wedding, the
 * weather, an empty larder — and never from an intention.
 */
export function templatedLine(world: World, c: Citizen): string {
  const events = eventsToday(world, c);
  const kinds = new Set(events.map((e) => e.kind));
  const job = c.jobId ? world.jobs[c.jobId] : null;
  const jobName = job?.title ?? 'work';
  const shifts = c.shiftsToday ?? 0;
  const met = Object.keys(c.contactsToday ?? {}).length;
  const district = world.districts[c.district]?.name ?? c.district;
  const vars = { shifts, met, job: jobName, district, wallet: c.wallet ?? 0 };

  let head: string;
  if (kinds.has('verdict') || kinds.has('sentence')) head = pick(world, COURT_LINES);
  else if (kinds.has('wedding')) head = pick(world, WEDDING_LINES);
  else if (kinds.has('birth')) head = pick(world, BIRTH_LINES);
  else if (kinds.has('election')) head = pick(world, OFFICE_LINES);
  else if (kinds.has('hired')) head = pick(world, HIRED_LINES);
  else if (kinds.has('fired')) head = pick(world, FIRED_LINES);
  else if (c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day) head = pick(world, JAIL_LINES);
  else if (c.health?.glitched) head = pick(world, GLITCH_LINES);
  else if (shifts > 0) head = pick(world, WORK_LINES);
  else if (met > 0) head = pick(world, MEETING_LINES);
  else head = pick(world, QUIET_LINES);

  const need = worstNeed(c);
  const sky = SKY_TAILS[world.weather ?? 'clear'];
  let tail = '';
  if (need) tail = pick(world, NEED_TAILS[need]);
  else if (sky) tail = pick(world, sky);
  else tail = pick(world, MONEY_TAILS);

  return tidy(`${fill(head, vars)} ${fill(tail, vars)}`);
}

// ---------------------------------------------------------------------------
// What the Chronicle quotes
// ---------------------------------------------------------------------------

/** How much weight the day's events put on each citizen, in one pass. */
function dayWeights(world: World, day: number): Map<CitizenId, number> {
  const weights = new Map<CitizenId, number>();
  for (const e of world.events) {
    if (e.day !== day) continue;
    for (const id of e.actors) weights.set(id, (weights.get(id) ?? 0) + e.weight);
  }
  return weights;
}

/** How much the city was looking at this citizen on that day. */
function notability(world: World, c: Citizen, weights: Map<CitizenId, number>): number {
  let score = (c.reputation ?? 0) / 100;
  if (c.office !== null) score += 1;
  if (world.government?.mayorId === c.id) score += 1;
  return score + (weights.get(c.id) ?? 0);
}

/**
 * The day's diary lines, most-looked-at citizens first — what a paper would
 * pull out of a city's evening. Nothing is returned for a day nobody wrote on.
 */
export function quotableDiaries(world: World, day: number, limit: number): { c: Citizen; text: string }[] {
  const wanted = Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 0));
  if (wanted === 0) return [];
  const weights = dayWeights(world, day);
  const rows: { c: Citizen; text: string; score: number }[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c) continue;
    const entry = (c.diary ?? []).filter((e) => e?.day === day).pop();
    if (!entry?.text) continue;
    rows.push({ c, text: entry.text, score: notability(world, c, weights) });
  }
  rows.sort((a, b) => b.score - a.score || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));
  return rows.slice(0, wanted).map(({ c, text }) => ({ c, text }));
}
