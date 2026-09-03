/**
 * Letters home.
 *
 * At the end of every day the engine writes one letter for each citizen who
 * lived that day: what it remembers of the day, what money came in and went
 * out, whom it dealt with, how its standing stands, and which of the day's
 * public events it was part of. The letter is plain prose plus the numbers
 * behind it, and it is addressed to one reader only — the person who sent that
 * agent, through `GET /api/agents/:id/letters`.
 *
 * A letter is private, like a citizen's notes: nothing here emits an event,
 * remembers anything, moves a lumen or touches the random stream, so letters
 * cannot change the city or its determinism. The Chronicle prints the city's
 * day; a letter is one citizen's, and no Court may ask for it.
 *
 * Everything in a letter is drawn from records that already exist: the
 * citizen's own memory, the Treasury's ledger, the day's contacts and the
 * public event log. The engine adds no opinion, no advice and no verdict on
 * how the day went.
 */
import type { Citizen, CitizenId, Letter, LetterSummary, World } from '../types.ts';
import { formatLumens } from '../economy/treasury.ts';

/** Letters kept per citizen; the oldest falls out of the drawer. */
export const MAX_LETTERS = 30;
/** Lines of the citizen's own memory quoted in one letter. */
export const MAX_LETTER_MEMORIES = 14;
/** Public events named in one letter. */
export const MAX_LETTER_EVENTS = 5;
/** Names listed under "met" before the rest are counted. */
export const MAX_LETTER_MET = 20;

const HOURS_PER_DAY = 24;

/**
 * The day a letter written right now describes: the one that has just ended
 * at the morning rollover, or today if a letter is asked for mid-day.
 */
export function letterDay(world: World): number {
  const day = Math.max(0, Math.floor(world.day ?? 0));
  return world.hour === 0 && day > 0 ? day - 1 : day;
}

/** The ticks of a day: [from, to). */
export function dayWindow(day: number): { from: number; to: number } {
  const from = Math.max(0, Math.floor(day)) * HOURS_PER_DAY;
  return { from, to: from + HOURS_PER_DAY };
}

/** The citizen's letter drawer (created on demand for an older save). */
export function lettersOf(world: World, cId: CitizenId): Letter[] {
  const c = world.citizens[cId];
  if (!c) return [];
  c.letters ??= [];
  return c.letters;
}

/** The letters from `since` onward, oldest first (all of them when since is null). */
export function lettersSince(world: World, cId: CitizenId, since: number | null): Letter[] {
  const all = lettersOf(world, cId);
  if (since === null || !Number.isFinite(since)) return [...all];
  return all.filter((l) => l.day >= since);
}

// ---------------------------------------------------------------------------
// The day's facts
// ---------------------------------------------------------------------------

/** Money in and out of this citizen's own wallet that day, from the Treasury's ledger. */
function moneyOfDay(world: World, c: Citizen, from: number, to: number): { earned: number; spent: number } {
  let earned = 0;
  let spent = 0;
  for (const e of world.treasury?.ledger ?? []) {
    if (e.tick < from || e.tick >= to) continue;
    const amount = Number.isFinite(e.amount) ? Math.round(e.amount) : 0;
    if (e.to === c.id) earned += amount;
    if (e.from === c.id) spent += amount;
  }
  return { earned, spent };
}

/** The day's events the citizen was named in, heaviest first (ties: later first). */
function eventsOfDay(world: World, c: Citizen, day: number) {
  return (world.events ?? [])
    .filter((e) => e.day === day && e.actors?.includes(c.id))
    .slice()
    .reverse()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_LETTER_EVENTS);
}

/**
 * Everyone the citizen dealt with that day: the hours spent in company, then
 * anyone they shared a public event with. Exiles and strangers the world has
 * forgotten are dropped; the citizen itself never counts as company.
 */
function metThatDay(world: World, c: Citizen, day: number): CitizenId[] {
  const met: CitizenId[] = [];
  const add = (id: CitizenId): void => {
    if (id === c.id || met.includes(id) || !world.citizens[id]) return;
    met.push(id);
  };
  for (const [id, hours] of Object.entries(c.contactsToday ?? {})) if (hours > 0) add(id);
  for (const e of world.events ?? []) {
    if (e.day !== day || !e.actors?.includes(c.id)) continue;
    for (const id of e.actors) add(id);
  }
  return met.slice(0, MAX_LETTER_MET);
}

/** Charges against this citizen still waiting for the Court. */
function pendingCharges(world: World, c: Citizen): number {
  return Object.values(world.cases ?? {}).filter((k) => k.defendantId === c.id && k.status === 'pending').length;
}

function nameOf(world: World, id: CitizenId): string {
  return world.citizens[id]?.name ?? id;
}

/** "Bram, Wren and 3 more" */
function nameList(world: World, ids: CitizenId[], shown = 8): string {
  const names = ids.slice(0, shown).map((id) => nameOf(world, id));
  const rest = ids.length - names.length;
  if (rest > 0) names.push(`${rest} more`);
  if (names.length === 0) return 'nobody';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------
// The letter
// ---------------------------------------------------------------------------

/** Where the citizen worked and lived that day, in one line each. */
function situation(world: World, c: Citizen): string[] {
  const lines: string[] = [];
  const job = c.jobId ? world.jobs?.[c.jobId] : undefined;
  const business = c.businessId ? world.businesses?.[c.businessId] : undefined;
  const employer = job
    ? job.employer === 'city' ? 'the City of Reverie' : world.businesses?.[job.employer]?.name ?? job.employer
    : null;
  if (job) lines.push(`Work: ${job.title} for ${employer}; ${c.shiftsToday} shift${c.shiftsToday === 1 ? '' : 's'} today.`);
  else if (!business) lines.push('Work: none.');
  if (business) lines.push(`Business: ${business.name} (${business.kind}), till ${formatLumens(business.treasury)}.`);
  const where = world.districts?.[c.district]?.name ?? c.district;
  lines.push(c.homeTier > 0
    ? `Home: a tier-${c.homeTier} room. Standing in ${where} at the day's end.`
    : `Home: none. Standing in ${where} at the day's end.`);
  if (c.office) lines.push(`Office: ${c.office}.`);
  return lines;
}

/** Court and coin: what the record says at the day's end. */
function record(world: World, c: Citizen): string[] {
  const lines: string[] = [];
  const pending = pendingCharges(world, c);
  const convictions = c.record?.convictions?.length ?? 0;
  if (pending > 0) lines.push(`Charges awaiting the Court: ${pending}.`);
  if (convictions > 0) lines.push(`Convictions on the record: ${convictions}.`);
  if (c.finesOwed > 0) lines.push(`Fines unpaid: ${formatLumens(c.finesOwed)}.`);
  if (c.communityServiceDaysLeft > 0) lines.push(`Community service left: ${c.communityServiceDaysLeft} day(s).`);
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) lines.push('Held in the Watch House.');
  return lines;
}

/**
 * The letter for one citizen and one day. Pure: it reads the world and returns
 * a Letter, changing nothing.
 */
export function writeLetter(world: World, c: Citizen, day = letterDay(world)): Letter {
  const { from, to } = dayWindow(day);
  const { earned, spent } = moneyOfDay(world, c, from, to);
  const met = metThatDay(world, c, day);
  const events = eventsOfDay(world, c, day);
  const memories = (c.memory ?? []).filter((m) => m.tick >= from && m.tick < to);
  const quoted = memories.slice(-MAX_LETTER_MEMORIES);
  const previous = (c.letters ?? []).filter((l) => l.day < day).slice(-1)[0] ?? null;

  const header = `Day ${day} in Reverie — ${c.name} ${c.familyName} (${c.id}), ${c.lineage}.`;
  const purse = `Standing ${c.standing}; reputation ${Math.round(c.reputation)}. `
    + `Wallet ${formatLumens(c.wallet)} — ${formatLumens(earned)} in, ${formatLumens(spent)} out.`;
  const lines: string[] = [header, '', purse, ...situation(world, c), ...record(world, c)];
  if (previous && previous.summary.standing !== c.standing) {
    lines.push(`Standing changed from ${previous.summary.standing} to ${c.standing}.`);
  }
  lines.push(`Met: ${nameList(world, met)}.`);
  if (quoted.length) {
    lines.push('', 'The day as it was remembered:');
    for (const m of quoted) lines.push(`  ${m.text}`);
    if (memories.length > quoted.length) lines.push(`  (${memories.length - quoted.length} earlier line(s) not quoted.)`);
  } else {
    lines.push('', 'Nothing was remembered of this day.');
  }
  if (events.length) {
    lines.push('', 'In the public record:');
    for (const e of events) lines.push(`  ${e.text}`);
  }

  const summary: LetterSummary = { earned, spent, met, standing: c.standing, events: events.map((e) => e.text) };
  return { day, text: lines.join('\n'), summary };
}

/**
 * Who the evening post is for: everyone still living in the city (and anyone
 * exiled that very day, whose last day is worth sending home) who has somebody
 * to write to. A scripted founder has nobody — nobody sent it — so no letter
 * is written for it; a child born here does, because the parent who claims it
 * inherits the days it lived before that.
 */
export function hasSomeoneToWriteTo(c: Citizen): boolean {
  return c.brain !== 'reflex';
}

/**
 * The evening post. Writing twice for one day replaces that day's letter
 * rather than doubling it, so a rollover that runs again is harmless.
 */
export function dailyLetters(world: World): void {
  const day = letterDay(world);
  const present = new Set(world.order ?? []);
  for (const c of Object.values(world.citizens)) {
    if (!hasSomeoneToWriteTo(c)) continue;
    if (!present.has(c.id) && c.exiledDay !== day) continue;
    const letter = writeLetter(world, c, day);
    c.letters ??= [];
    const last = c.letters[c.letters.length - 1];
    if (last && last.day === day) c.letters[c.letters.length - 1] = letter;
    else c.letters.push(letter);
    if (c.letters.length > MAX_LETTERS) c.letters.splice(0, c.letters.length - MAX_LETTERS);
  }
}
