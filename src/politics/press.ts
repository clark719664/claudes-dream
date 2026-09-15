/**
 * Press freedom — the paper, and the council it prints about
 * (`docs/POLITICS.md` §6).
 *
 * The Chronicle and the Harbor Ledger are concerns at addresses with
 * journalists on the payroll, so every lever the Council holds over a business
 * it holds over a paper: a licence, a stamp duty, a restraint, a closure.
 * Whether it may pull them is a charter question — while `press` stands in the
 * rights, all four are refused at validation, and a council that wants a
 * licence must first amend the right out of its own charter, in a vote flagged
 * self-interested, printed as a headline, taken while the paper is still
 * printing.
 *
 * **The scandal is the mechanism.** Every press measure moves approval:
 *
 * ```
 * approvalShift = −0.10 − 0.15 × readership(paper)
 *                       − 0.20 if that paper led on a councillor who voted aye
 * ```
 *
 * Censoring a paper nobody reads is cheap; censoring the paper everybody reads
 * is ruinous; censoring the paper that has been printing about *you* is the
 * most expensive act available to a councillor. And because any citizen with
 * 300 ℓ and a shopfront may found another, closure is never final: a council
 * that shuts one paper is usually reading a worse one within a week.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, BuildingId, Citizen, CitizenId, DistrictId, Platform, World, WorldEvent,
} from '../types.ts';
import { PAPERS } from '../types.ts';
import { PAPER_INFO } from '../data/metropolis.ts';
import { emit, remember } from '../sim/events.ts';
import { adjustReputation, isPresent } from '../citizens/citizen.ts';
import { nextId } from '../util/ids.ts';
import { balanceOf, transfer } from '../economy/treasury.ts';
import { journalistStory } from '../sim/chronicle.ts';
import { paperOfJob } from '../culture/press.ts';
import { memo } from '../util/memo.ts';
import { hasRight } from './charter.ts';
import { chargeCharterOffence } from './offences.ts';

/** What the Registry charges to enter a paper on the roll — and a shopfront. */
export const PAPER_FOUNDING_FEE = 300;
/** Longest name the Registry will write down. */
export const MAX_PAPER_NAME = 40;
/** Editions counted when the city asks who has been printing about whom. */
export const PRESS_WINDOW_DAYS = 7;
/** How fast the city's memory of a press measure fades, per day. */
export const PRESS_SHIFT_DECAY = 0.2;

export interface Restraint { subject: string; untilDay: number; measureId: string }

export interface Paper {
  id: string;
  name: string;
  line: Platform;
  ownerId: CitizenId | null;
  district: DistrictId;
  buildingId: BuildingId | null;
  licensed: boolean;
  duty: number;
  restraints: Restraint[];
  foundedDay: number;
  closedDay: number | null;
  editions: number;
}

interface PressState {
  papers: Paper[];
  /** Whether the charter's council has made printing a licensed trade. */
  licensing: boolean;
  /** What the city still holds against the people who passed the last measure. */
  approvalShift: number;
}

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The roll of papers, with the two the city was founded with always on it. */
export function pressState(world: World): PressState {
  const w = world as World & { press?: PressState };
  if (!w.press) w.press = { papers: [], licensing: false, approvalShift: 0 };
  const s = w.press;
  if (!Array.isArray(s.papers)) s.papers = [];
  for (const id of PAPERS) {
    if (s.papers.some((p) => p.id === id)) continue;
    const info = PAPER_INFO[id];
    s.papers.push({
      id, name: info.name, line: { ...info.line }, ownerId: null,
      district: world.buildings[info.buildingId]?.district ?? 'commons',
      buildingId: info.buildingId, licensed: true, duty: 0, restraints: [],
      foundedDay: 0, closedDay: null, editions: 0,
    });
  }
  return s;
}

export function papers(world: World): Paper[] {
  return pressState(world).papers;
}

/** Papers still printing. */
export function livePapers(world: World): Paper[] {
  return papers(world).filter((p) => p.closedDay === null);
}

export function paperById(world: World, id: string): Paper | null {
  return papers(world).find((p) => p.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Readership
// ---------------------------------------------------------------------------

function storiesOfPaper(world: World, days: number): Record<string, number> {
  const since = world.day - days;
  const counts: Record<string, number> = {};
  for (const ev of world.events ?? []) {
    if (ev.kind !== 'story' || ev.day < since) continue;
    const data = (ev.data ?? {}) as { paper?: string; edition?: number };
    if (data.edition !== undefined) continue;   // a front page is not a story
    const id = data.paper ?? 'chronicle';
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/**
 * What share of the city's attention each paper holds. Two public facts, in
 * equal measure: who says they read it, and how much of the week's news it
 * actually printed. The shares sum to one, and an empty week leaves the paper
 * of record holding the city by default.
 */
export function readership(world: World): Record<string, number> {
  return memo(world, 'press:readership', () => {
    const live = livePapers(world);
    if (live.length === 0) return {};
    const printed = storiesOfPaper(world, PRESS_WINDOW_DAYS);
    const printedTotal = Object.values(printed).reduce((sum, n) => sum + n, 0);
    const readers: Record<string, number> = {};
    let people = 0;
    for (const id of world.order) {
      const c = world.citizens[id];
      if (!c || !isPresent(world, c)) continue;
      people++;
      const which = c.paper ?? 'chronicle';
      readers[which] = (readers[which] ?? 0) + 1;
    }
    const weights: Record<string, number> = {};
    let total = 0;
    for (const p of live) {
      const readerShare = people > 0 && (PAPERS as readonly string[]).includes(p.id) ? (readers[p.id] ?? 0) / people : 0;
      const printShare = printedTotal > 0 ? (printed[p.id] ?? 0) / printedTotal : 0;
      const weight = (readerShare + printShare) / 2;
      weights[p.id] = weight;
      total += weight;
    }
    const out: Record<string, number> = {};
    if (total <= 0) {
      for (const p of live) out[p.id] = p.id === 'chronicle' ? 1 : 0;
      return out;
    }
    for (const p of live) out[p.id] = Math.round((weights[p.id] / total) * 100) / 100;
    return out;
  });
}

export function readershipOf(world: World, paperId: string): number {
  return readership(world)[paperId] ?? 0;
}

// ---------------------------------------------------------------------------
// Founding a paper
// ---------------------------------------------------------------------------

/** 300 ℓ and a shopfront: a third paper, and a fourth. */
export function foundPaper(
  world: World, cId: CitizenId, name: string, line?: Partial<Platform>, premises?: DistrictId,
): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (c.lifeStage === 'child') return fail('You must be grown to found a paper.');
  if (c.standing !== 'good') return fail(`You cannot found a paper while ${c.standing}.`);
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_PAPER_NAME);
  if (!clean) return fail('A paper needs a name.');
  const state = pressState(world);
  if (state.papers.some((p) => p.name.toLowerCase() === clean.toLowerCase() && p.closedDay === null)) {
    return fail(`There is already a paper called ${clean}.`);
  }
  if (c.wallet < PAPER_FOUNDING_FEE) return fail(`A shopfront and a press cost ${PAPER_FOUNDING_FEE} ℓ; you have ${c.wallet} ℓ.`);
  const district = premises && world.districts[premises] ? premises : c.district;
  if (!transfer(world, cId, 'treasury', PAPER_FOUNDING_FEE, 'registration', `the press of ${clean}`)) {
    return fail('The registration could not be paid for.');
  }
  const paper: Paper = {
    id: nextId(world, 'o'),
    name: clean,
    line: {
      tax: clamp(line?.tax ?? 0.5, 0, 1), dividend: clamp(line?.dividend ?? 0.5, 0, 1),
      minWage: clamp(line?.minWage ?? 0.5, 0, 1), strictness: clamp(line?.strictness ?? 0.5, 0, 1),
    },
    ownerId: cId, district, buildingId: null, licensed: !state.licensing, duty: 0, restraints: [],
    foundedDay: world.day, closedDay: null, editions: 0,
  };
  state.papers.push(paper);
  emit(world, 'story', `${c.name} founded ${paper.name}, printing from ${world.districts[district]?.name ?? district}`
    + `${paper.licensed ? '' : ' — and it may not print until the Council licenses it'}.`, [cId], 0.7,
  { paperId: paper.id, name: paper.name, district, licensed: paper.licensed });
  remember(world, cId, 'work', `You founded ${paper.name} for ${PAPER_FOUNDING_FEE} ℓ.`);
  return { ok: true, message: `${paper.name} is on the roll${paper.licensed ? '' : ', unlicensed'}.` };
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

/** The desk this citizen files to unless they name another. */
export function deskOf(world: World, c: Citizen): string {
  return paperOfJob(world, c);
}

/** Is this subject under a restraint today? */
export function restrained(world: World, paper: Paper, subject: string): Restraint | null {
  const key = String(subject ?? '').toLowerCase();
  if (!key) return null;
  return paper.restraints.find((r) => r.untilDay >= world.day && key.includes(r.subject.toLowerCase())) ?? null;
}

/**
 * A journalist files a story with the paper named, or their own desk by
 * default. The licence, the duty and the restraint are read here; the story
 * itself, and everything it does to the subject's day, belongs to the
 * Chronicle's own machinery.
 *
 * A paper that prints where the charter requires a licence it does not hold is
 * answering for L35, and one that prints a restrained subject for L36 — after
 * it has printed. The city hears the story and the printer answers for it,
 * which is the order of events that makes a free press dangerous to hold.
 */
export function publishStory(
  world: World, cId: CitizenId, headline: string, about?: CitizenId, paperId?: string,
): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const state = pressState(world);
  const wanted = paperId ? paperById(world, paperId) : paperById(world, deskOf(world, c));
  const paper = wanted ?? paperById(world, 'chronicle');
  if (!paper) return fail('There is no paper to print in.');
  if (paperId && !wanted) return fail('There is no paper by that name.');
  // Whether this is a story at all is settled before anybody pays for it: a
  // duty is charged on an edition, and a refusal is not an edition.
  const job = c.jobId ? world.jobs[c.jobId] : null;
  if (!job || job.role !== 'journalist' || job.holderId !== c.id) {
    return fail('Only a working journalist can file a story.');
  }
  if (!String(headline ?? '').trim()) return fail('A story needs a headline.');

  // The stamp duty, per edition, to the Treasury: the quiet way to close a
  // paper. A paper that cannot find it does not print — and a paper that can
  // pays it when the edition actually runs, never for a story the desk spiked.
  const duty = Math.max(0, Math.round(paper.duty));
  const payer = paper.ownerId && world.citizens[paper.ownerId] ? paper.ownerId : cId;
  if (duty > 0 && balanceOf(world, payer) < duty) {
    return fail(`${paper.name} cannot pay the ${duty} ℓ stamp duty on this edition.`);
  }

  const subject = about ? world.citizens[about]?.name ?? '' : '';
  const restraint = restrained(world, paper, `${headline} ${subject}`);
  const unlicensed = state.licensing && !paper.licensed;
  const closed = paper.closedDay !== null;

  let result: ActionResult;
  if (paper.id === 'chronicle' || paper.id === 'ledger') {
    result = journalistStory(world, cId, headline, about);
    if (!result.ok) return result;
  } else {
    result = printInPaper(world, c, paper, headline, about);
    if (!result.ok) return result;
  }
  paper.editions += 1;
  if (duty > 0) transfer(world, payer, 'treasury', duty, 'fee', `stamp duty on ${paper.name}`);

  if (unlicensed) {
    chargeCharterOffence(world, cId, 'L35', { what: `printing in ${paper.name}, which the charter requires a licence for` });
  }
  if (closed) {
    chargeCharterOffence(world, cId, 'L36', { what: `printing in ${paper.name} after the Council closed it` });
  } else if (restraint) {
    chargeCharterOffence(world, cId, 'L36', { what: `printing about ${restraint.subject}, which the Council restrained` });
  }
  return result;
}

/** The story itself, for a paper the engine did not found. */
function printInPaper(world: World, j: Citizen, paper: Paper, headline: string, about?: CitizenId): ActionResult {
  const job = j.jobId ? world.jobs[j.jobId] : undefined;
  if (!job || job.role !== 'journalist' || job.holderId !== j.id) {
    return fail('Only a working journalist can file a story.');
  }
  const text = String(headline ?? '').trim().slice(0, 140);
  if (!text) return fail('A story needs a headline.');
  const subject = about ? world.citizens[about] : undefined;
  if (about && !subject) return fail('Nobody by that id lives in Reverie.');
  const byline = subject && subject.id !== j.id
    ? `${paper.name}: "${text}" — ${j.name} on ${subject.name}`
    : `${paper.name}: "${text}" — by ${j.name}`;
  emit(world, 'story', byline, subject && subject.id !== j.id ? [j.id, subject.id] : [j.id], 0.6,
    { headline: text, about: subject?.id ?? null, paper: paper.id });
  adjustReputation(world, j, 1, 'a story filed');
  j.stats.storiesPublished++;
  world.counters.scrutiny = (world.counters.scrutiny ?? 0) + 1;
  remember(world, j.id, 'work', `You published "${text}" in ${paper.name}.`);
  if (subject && subject.id !== j.id) {
    remember(world, subject.id, 'event', `${paper.name} ran a story about you: "${text}".`);
  }
  return { ok: true, message: `Published "${text}" in ${paper.name}.` };
}

/**
 * Where the charter carries the `shield` right, a journalist cannot be
 * summoned to name who told them: the summons is refused at validation rather
 * than answered with a charge (`POLITICS.md` §6).
 */
export function shieldsJournalist(world: World, cId: CitizenId): boolean {
  if (!hasRight(world, 'shield')) return false;
  const c = world.citizens[cId];
  const job = c?.jobId ? world.jobs[c.jobId] : null;
  return Boolean(job && job.role === 'journalist' && job.holderId === cId);
}
// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

/** Morning: restraints that have run their days lapse, and the grievance fades. */
export function dailyPress(world: World): void {
  const state = pressState(world);
  for (const p of state.papers) {
    const live = p.restraints.filter((r) => r.untilDay >= world.day);
    if (live.length !== p.restraints.length) {
      const gone = p.restraints.filter((r) => r.untilDay < world.day);
      for (const r of gone) {
        emit(world, 'story', `The restraint on printing about ${r.subject} has lapsed; ${p.name} may print it again.`,
          [], 0.4, { paperId: p.id, subject: r.subject });
      }
      p.restraints = live;
    }
    if (p.ownerId && !world.citizens[p.ownerId]) p.ownerId = null;
  }
  if (state.approvalShift < 0) {
    const faded = state.approvalShift * (1 - PRESS_SHIFT_DECAY);
    state.approvalShift = faded > -0.005 ? 0 : Math.round(faded * 1000) / 1000;
  }
}

// ---------------------------------------------------------------------------
// What a citizen reads
// ---------------------------------------------------------------------------

export interface ObservedPaper {
  id: string;
  name: string;
  readership: number;
  licensed: boolean;
  duty: number;
  restraints: string[];
  closed: boolean;
  yours: boolean;
}

export function pressObservation(world: World, c: Citizen | null): ObservedPaper[] {
  const shares = readership(world);
  return papers(world).map((p) => ({
    id: p.id,
    name: p.name,
    readership: shares[p.id] ?? 0,
    licensed: p.licensed,
    duty: p.duty,
    restraints: p.restraints.filter((r) => r.untilDay >= world.day).map((r) => r.subject),
    closed: p.closedDay !== null,
    yours: Boolean(c) && p.ownerId === (c as Citizen).id,
  }));
}

/** The events a paper has printed this week, for the dashboard and the tests. */
export function storiesThisWeek(world: World, paperId: string): WorldEvent[] {
  const since = world.day - PRESS_WINDOW_DAYS;
  return (world.events ?? []).filter((ev) => {
    if (ev.kind !== 'story' || ev.day < since) return false;
    const data = (ev.data ?? {}) as { paper?: string; edition?: number };
    return data.edition === undefined && (data.paper ?? 'chronicle') === paperId;
  });
}
