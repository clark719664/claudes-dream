/**
 * Measures — the order paper for everything the charter added.
 *
 * The Council's ordinary queue (`government/council.ts`) carries one number
 * and one target, which is enough for a tax and not enough for an amendment (a
 * named article, a field inside it and a value that may be a word or a list),
 * for a press order (which paper, and for how long), or for a bid (a purse and
 * the works behind it). So the eleven kinds `POLITICS.md` §9 adds sit in their
 * own queue with their own reading rule, and everything else about them is the
 * same: a member of the deciding body tables one, the body votes in public,
 * the session counts the ayes against a threshold, and the Chronicle prints
 * who voted which way.
 *
 * This file is only the machinery. What a measure *means* — whether the
 * charter allows it, what it does when it carries, and how a scripted mind
 * reads it — belongs to the module that owns the kind, and reaches the session
 * through the two hooks it is called with.
 */
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent } from '../citizens/citizen.ts';
import { memo } from '../util/memo.ts';
import type { CharterEdit } from './charter.ts';
import { amendingBody, amendmentNeeded, charterOf } from './charter.ts';

export type MeasureKind =
  | 'amend_charter' | 'call_convention' | 'apportion'
  | 'press_licence' | 'press_duty' | 'press_restraint' | 'press_closure'
  | 'transparency' | 'games_bid' | 'games_waiver' | 'games_truce';

export const MEASURE_KINDS: readonly MeasureKind[] = [
  'amend_charter', 'call_convention', 'apportion',
  'press_licence', 'press_duty', 'press_restraint', 'press_closure',
  'transparency', 'games_bid', 'games_waiver', 'games_truce',
];

/** Longest the mover's own words may run, the same length a proposal's summary has. */
export const MAX_WORDS = 280;
/** A measure nobody decided in this many days falls off the order paper. */
export const MEASURE_LAPSE_DAYS = 7;
/** Measures kept for the record once they have been decided. */
export const MAX_MEASURES = 60;

export interface Measure {
  id: string;
  kind: MeasureKind;
  /** The one number a measure carries: a duty, a share, a purse, a count of days. */
  value: number;
  /** The one named thing: a paper, a district, a city, a switch. */
  subject: string | null;
  /** For an amendment, the article it would write. */
  edit: CharterEdit | null;
  /** The mover's own words, printed with it. */
  words: string;
  proposerId: CitizenId;
  tabledDay: number;
  /** The day it is read: an amendment waits a day, which is the only brake the fastest cities have. */
  readingDay: number;
  votes: Record<CitizenId, boolean>;
  needed: number;
  status: 'open' | 'passed' | 'failed';
  decidedDay: number | null;
}

export interface MeasureSpec {
  kind: MeasureKind;
  value?: number;
  subject?: string | null;
  edit?: CharterEdit | null;
  words?: string;
  /** Set by the module that owns the kind when the body is not the one voting. */
  readingDay?: number;
}

/** What the session does with a measure that carried, and how a scripted mind reads one. */
export interface MeasureHooks {
  /** Why this measure may not be tabled at all, or null. */
  problem?(world: World, spec: MeasureSpec, proposer: Citizen): string | null;
  /** Applied when it carries; returns the line the Chronicle prints. */
  enact(world: World, m: Measure): string;
  /**
   * How a scripted member of the body who did not vote makes their mind up.
   * `null` abstains — a mind with nothing to read on a question votes on
   * nothing (`docs/PRINCIPLES.md` §4).
   */
  disposition?(world: World, cId: CitizenId, m: Measure): boolean | null;
}

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The order paper. A world saved before this layer has none. */
export function measureList(world: World): Measure[] {
  const w = world as { measures?: Measure[] };
  if (!w.measures) w.measures = [];
  return w.measures;
}

export function measureById(world: World, id: string): Measure | null {
  return measureList(world).find((m) => m.id === id) ?? null;
}

/** Everything still before the body, oldest first. */
export function openMeasures(world: World): Measure[] {
  return measureList(world).filter((m) => m.status === 'open');
}

export function openMeasuresOfKind(world: World, kind: MeasureKind): Measure[] {
  return openMeasures(world).filter((m) => m.kind === kind);
}

/**
 * Who decides a measure. An amendment goes to the body the charter names; a
 * press order, a switch, an apportionment or a bid is ordinary legislation and
 * goes to the Council.
 */
export function decidingBody(world: World, kind: MeasureKind): CitizenId[] {
  if (kind === 'amend_charter') return amendingBody(world);
  const g = world.government;
  const ids = new Set<CitizenId>(g.council);
  if (g.mayorId) ids.add(g.mayorId);
  return [...ids].filter((id) => {
    const c = world.citizens[id];
    return Boolean(c && isPresent(world, c));
  });
}

/** The ayes a measure needs today: the charter's fraction of the whole body, or a simple majority. */
export function measureNeeded(world: World, kind: MeasureKind): number {
  if (kind === 'amend_charter') return amendmentNeeded(world);
  const body = decidingBody(world, kind).length;
  // Calling a convention is the amending body letting go of the charter
  // altogether, and the charter asks a higher threshold for it than for a tax.
  if (kind === 'call_convention') return Math.max(1, Math.ceil(charterOf(world).convention.bodyThreshold * body));
  return Math.max(1, Math.floor(body / 2) + 1);
}

function held(world: World, c: Citizen): string | null {
  if (c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day) return 'the cells';
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return 'the Watch House';
  return null;
}

// ---------------------------------------------------------------------------
// Tabling and voting
// ---------------------------------------------------------------------------

/**
 * Put a measure on the order paper. Only somebody who sits in the body that
 * decides it may table one — a citizen who wants a paper licensed has to
 * persuade a councillor, which is the whole of the difference between a
 * petition and a bill.
 */
export function tableMeasure(world: World, cId: CitizenId, spec: MeasureSpec, hooks?: MeasureHooks): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (!MEASURE_KINDS.includes(spec?.kind)) return fail('There is no such kind of measure.');
  if (c.standing !== 'good' && c.standing !== 'probation') return fail(`You cannot table a measure while ${c.standing}.`);
  const where = held(world, c);
  if (where) return fail(`You cannot table a measure from ${where}.`);
  const body = decidingBody(world, spec.kind);
  if (!body.includes(cId)) {
    return fail(spec.kind === 'amend_charter'
      ? `The charter is amended by the ${charterOf(world).amendment.by}; you do not sit in it.`
      : 'Only a member of the Council may table this measure.');
  }
  const problem = hooks?.problem ? hooks.problem(world, spec, c) : null;
  if (problem) return fail(problem);
  const mine = openMeasures(world).find((m) => m.proposerId === cId);
  if (mine) return fail(`You already have a measure on the order paper (${mine.id}); wait for it to be read.`);

  const words = (spec.words ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_WORDS);
  const m: Measure = {
    id: nextId(world, 'p'),
    kind: spec.kind,
    value: Number.isFinite(spec.value) ? (spec.value as number) : 0,
    subject: spec.subject ?? null,
    edit: spec.edit ?? null,
    words,
    proposerId: cId,
    tabledDay: world.day,
    // An amendment is voted the day *after* it is tabled; everything else is
    // read at the next session like an ordinary proposal.
    readingDay: spec.readingDay ?? (spec.kind === 'amend_charter' ? world.day + 1 : world.day + 1),
    votes: { [cId]: true },
    needed: measureNeeded(world, spec.kind),
    status: 'open',
    decidedDay: null,
  };
  measureList(world).push(m);
  const summary = words || describeMeasure(world, m);
  emit(world, 'proposal', `${c.name} tabled ${m.id}: ${summary}`, [cId], 0.5,
    { measureId: m.id, kind: m.kind, value: m.value, subject: m.subject, needed: m.needed, readingDay: m.readingDay });
  remember(world, cId, 'civic', `You tabled ${m.id}: ${summary}. It is read on day ${m.readingDay} and needs ${m.needed} ayes.`);
  return { ok: true, message: `${m.id} is on the order paper; it needs ${m.needed} ayes when it is read on day ${m.readingDay}.` };
}

/** A member of the body votes, in public, and may change their mind before the reading. */
export function voteMeasure(world: World, cId: CitizenId, measureId: string, aye: boolean): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const m = measureById(world, measureId);
  if (!m) return fail('There is no such measure.');
  if (m.status !== 'open') return fail(`${m.id} has already been decided.`);
  if (!decidingBody(world, m.kind).includes(cId)) return fail('You do not sit in the body that decides that measure.');
  if (c.standing !== 'good' && c.standing !== 'probation') return fail(`You cannot vote while ${c.standing}.`);
  const changed = m.votes[cId] !== undefined && m.votes[cId] !== aye;
  m.votes[cId] = Boolean(aye);
  remember(world, cId, 'civic', `You voted ${aye ? 'aye' : 'nay'} on ${m.id} (${m.words || describeMeasure(world, m)}).`);
  return { ok: true, message: `${changed ? 'You changed your vote to' : 'You voted'} ${aye ? 'aye' : 'nay'} on ${m.id}.` };
}

/** A plain line for a measure that came with no words of its own. */
export function describeMeasure(world: World, m: Measure): string {
  switch (m.kind) {
    case 'amend_charter': return `an amendment to the charter${m.edit ? ` (${m.edit.article}${m.edit.field ? `.${m.edit.field}` : ''})` : ''}`;
    case 'call_convention': return 'a constitutional convention';
    case 'apportion': return 'a reapportionment of the seats';
    case 'press_licence': return 'a licence to print';
    case 'press_duty': return `a stamp duty of ${Math.round(m.value)} ℓ an edition`;
    case 'press_restraint': return `a restraint on printing about ${m.subject ?? 'a named subject'} for ${Math.round(m.value)} days`;
    case 'press_closure': return `the closure of ${m.subject ?? 'a paper'}`;
    case 'transparency': return `${m.value > 0 ? 'opening' : 'closing'} the ${m.subject ?? 'record'}`;
    case 'games_bid': return `a bid for the Games: a purse of ${Math.round(m.value)} ℓ`;
    case 'games_waiver': return `a waiver of the repute line for competitors at ${Math.round(m.value)}`;
    default: return 'the truce of the Games';
  }
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

/**
 * The Council's hour. Every measure whose reading day has come is decided:
 * scripted members who have not voted make their minds up the way the hook
 * says, members who think for themselves and did not vote have abstained, and
 * the ayes are counted against the threshold of the **whole body**.
 */
export function measureSession(world: World, hooks: (kind: MeasureKind) => MeasureHooks | null): void {
  for (const m of measureList(world)) {
    if (m.status !== 'open' || m.readingDay > world.day) continue;
    const hook = hooks(m.kind);
    const body = decidingBody(world, m.kind);
    if (body.length === 0) {
      // Nobody to decide it: it waits, and says so once.
      if (world.day - m.tabledDay >= MEASURE_LAPSE_DAYS) closeMeasure(world, m, false, 'nobody sat to decide it');
      continue;
    }
    for (const id of body) {
      if (m.votes[id] !== undefined) continue;
      const member = world.citizens[id];
      if (!member || member.brain !== 'reflex') continue;
      const view = hook?.disposition ? hook.disposition(world, id, m) : null;
      if (view === null || view === undefined) continue;
      m.votes[id] = view;
    }
    m.needed = measureNeeded(world, m.kind);
    const ayes = Object.values(m.votes).filter(Boolean).length;
    const passed = ayes >= m.needed;
    const text = passed && hook ? hook.enact(world, m) : null;
    closeMeasure(world, m, passed, null, text, ayes);
  }
  trimMeasures(world);
}

/** Write the answer into the record and tell the city what it was. */
export function closeMeasure(
  world: World, m: Measure, passed: boolean, why: string | null = null, outcome: string | null = null, ayes?: number,
): void {
  m.status = passed ? 'passed' : 'failed';
  m.decidedDay = world.day;
  const counted = ayes ?? Object.values(m.votes).filter(Boolean).length;
  const nays = Object.values(m.votes).filter((v) => !v).length;
  const named = Object.entries(m.votes)
    .map(([id, v]) => `${world.citizens[id]?.name ?? id} ${v ? 'aye' : 'nay'}`)
    .sort();
  const line = `${m.id} (${m.words || describeMeasure(world, m)}): ${counted} ayes, ${nays} nays of ${m.needed} needed — `
    + `${passed ? 'carried' : 'lost'}${why ? ` (${why})` : ''}.${outcome ? ` ${outcome}` : ''}`;
  emit(world, passed ? 'law' : 'proposal', line, [m.proposerId], passed ? 0.8 : 0.4,
    { measureId: m.id, kind: m.kind, passed, ayes: counted, nays, needed: m.needed, votes: named });
  const told = new Set<CitizenId>([...Object.keys(m.votes), m.proposerId]);
  for (const id of told) remember(world, id, 'civic', line);
}

/** Decided measures older than a cycle, and undecided ones nobody read, fall off the paper. */
export function trimMeasures(world: World): void {
  const list = measureList(world);
  const cycle = world.config?.cycleDays ?? 28;
  for (const m of list) {
    if (m.status !== 'open') continue;
    if (world.day - m.tabledDay < MEASURE_LAPSE_DAYS) continue;
    closeMeasure(world, m, false, 'it was never read');
  }
  const keep = list.filter((m) => m.status === 'open' || (m.decidedDay ?? 0) > world.day - cycle);
  const trimmed = keep.length > MAX_MEASURES ? keep.slice(keep.length - MAX_MEASURES) : keep;
  if (trimmed.length !== list.length) (world as { measures?: Measure[] }).measures = trimmed;
}

// ---------------------------------------------------------------------------
// What a citizen reads
// ---------------------------------------------------------------------------

export interface ObservedMeasure {
  id: string;
  kind: MeasureKind;
  words: string;
  mover: string;
  ayes: number;
  needed: number;
  readingDay: number;
  /** Named where the charter's `transparency.votes` switch is on; a tally where it is off. */
  votes: string[] | null;
  /** Flagged where an amendment would extend a term, narrow the franchise or strike a right. */
  selfInterested: boolean;
  youVoted: boolean | null;
}

/** The order paper as this citizen reads it. */
export function measuresObservation(
  world: World, c: Citizen | null, flagged?: (m: Measure) => boolean,
): ObservedMeasure[] {
  return memo(world, `measures:observation:${c?.id ?? ''}`, () => openMeasures(world).map((m) => {
    const vote = c ? m.votes[c.id] : undefined;
    return {
      id: m.id,
      kind: m.kind,
      words: m.words || describeMeasure(world, m),
      mover: world.citizens[m.proposerId]?.name ?? m.proposerId,
      ayes: Object.values(m.votes).filter(Boolean).length,
      needed: m.needed,
      readingDay: m.readingDay,
      votes: charterOf(world).transparency.votes
        ? Object.entries(m.votes).map(([id, v]) => `${world.citizens[id]?.name ?? id} ${v ? 'aye' : 'nay'}`).sort()
        : null,
      selfInterested: flagged ? flagged(m) : false,
      youVoted: vote === undefined ? null : vote,
    };
  }));
}
