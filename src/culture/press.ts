/**
 * The press — two papers, one city.
 *
 * The Chronicle is the paper of record: it prints what happened, in the words
 * the city used. The Harbor Ledger is written from the quay and makes no
 * secret of it — trade, tax and the Treasury lead its page, a shopkeeper's
 * misdemeanour is a small matter, and it does not hold with titles.
 *
 * Neither paper may invent. `slant` only decides **what leads**; `rewrite`
 * only decides **which words** carry a fact that already happened. No number,
 * no name and no claim enters a headline that was not in the event it came
 * from. Citizens read the paper they choose, and what they read moves their
 * reading of the people running the city — a little, and only once a day.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, ChronicleEdition, Citizen, CitizenId, EventKind, PaperId, Platform, World, WorldEvent,
} from '../types.ts';
import { PAPERS } from '../types.ts';
import { PAPER_INFO } from '../data/metropolis.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent } from '../citizens/citizen.ts';
import { CHRONICLE_LENGTH, HEADLINES_PER_EDITION, headlineShape } from '../sim/chronicle.ts';
import { PLATFORM_FIELDS, positionOf } from '../politics/promises.ts';

/** How far a morning's reading moves a reader's opinion of the Government. */
export const APPROVAL_PAPER_SHIFT = 0.05;
/** What sitting down with a paper is worth. */
export const READING_SOCIAL = 4;
/** How much a paper lifts the stories it likes. */
export const LIFT = 1.5;
/** ...and plays down the ones it would rather not run. */
export const PLAY_DOWN = 0.7;
/** A smaller lift, for the stories a paper merely prefers. */
export const NUDGE = 1.3;

/**
 * An edition, with the paper that printed it. `paper` is optional here so an
 * edition printed before the second paper existed still reads as a Chronicle.
 */
export type PaperEdition = ChronicleEdition & { paper?: PaperId };

function fail(message: string): ActionResult { return { ok: false, message }; }

function editions(world: World): PaperEdition[] {
  return (world.chronicle ?? []) as PaperEdition[];
}

/** Which paper an edition belongs to; anything unstamped is the paper of record. */
export function paperOf(edition: PaperEdition | undefined | null): PaperId {
  const p = edition?.paper;
  return p === 'ledger' ? 'ledger' : 'chronicle';
}

/** The desk a journalist files to: the Ledger's, or the Chronicle's. */
export function paperOfJob(world: World, c: Citizen): PaperId {
  const job = c?.jobId ? world.jobs[c.jobId] : null;
  if (job && job.holderId === c.id && job.buildingId === PAPER_INFO.ledger.buildingId) return 'ledger';
  return 'chronicle';
}

// ---------------------------------------------------------------------------
// What leads
// ---------------------------------------------------------------------------

const TRADE_KINDS: readonly EventKind[] = [
  'trade', 'treasury', 'business_founded', 'business_bankrupt', 'shares', 'outer', 'gig',
  'property', 'price', 'shortage', 'loan', 'purchase',
];
const CIVIC_KINDS: readonly EventKind[] = [
  'election', 'nomination', 'vote', 'proposal', 'law', 'decree', 'referendum', 'party',
];
const COURT_KINDS: readonly EventKind[] = ['charge', 'verdict', 'sentence', 'appeal', 'exile', 'pardon', 'jail', 'investigation'];
const SOCIAL_KINDS: readonly EventKind[] = [
  'social', 'wedding', 'birth', 'birthday', 'club', 'romance', 'gift', 'festival', 'household',
  'work', 'show', 'match', 'museum', 'milestone', 'sunset', 'donation',
];

/** Does this event name somebody who owns a business? The Ledger is gentler with them. */
function namesAnOwner(world: World, ev: WorldEvent): boolean {
  for (const id of ev.actors ?? []) {
    const c = world.citizens[id];
    if (!c) continue;
    const biz = c.businessId ? world.businesses[c.businessId] : null;
    if (biz && biz.ownerId === c.id && biz.dissolvedDay === null) return true;
  }
  return false;
}

/**
 * What a story is worth to a paper, as a multiplier on its own weight. The
 * Ledger leads on money and is short with the courts when a proprietor is in
 * the dock; the Chronicle leads on the city's public life.
 */
export function slant(world: World, paper: PaperId, ev: WorldEvent): number {
  if (!ev) return 0;
  const kind = ev.kind;
  if (paper === 'ledger') {
    if (TRADE_KINDS.includes(kind)) return LIFT;
    if ((COURT_KINDS.includes(kind) || kind === 'offence') && namesAnOwner(world, ev)) return PLAY_DOWN;
    if (SOCIAL_KINDS.includes(kind)) return PLAY_DOWN;
    return 1;
  }
  if (CIVIC_KINDS.includes(kind) || COURT_KINDS.includes(kind)) return NUDGE;
  if (SOCIAL_KINDS.includes(kind)) return NUDGE;
  if (TRADE_KINDS.includes(kind)) return 0.9;
  return 1;
}

// ---------------------------------------------------------------------------
// Which words
// ---------------------------------------------------------------------------

/**
 * The Ledger's house style. Every entry swaps words for words: nothing here
 * adds a number, a name or a claim, and several of them take one away (the
 * Ledger does not print titles). Applied in order, longest phrases first.
 */
const LEDGER_STYLE: readonly [RegExp, string][] = [
  [/\bMayor (?=[A-Z])/g, ''],
  [/\bCouncillor (?=[A-Z])/g, ''],
  [/\bJudge (?=[A-Z])/g, ''],
  [/\bThe Council\b/g, 'City Hall'],
  [/\bthe Council\b/g, 'City Hall'],
  [/\bminimum wage\b/g, 'wage floor'],
  [/\bincome tax\b/g, 'the income levy'],
  [/\bsales tax\b/g, 'the sales levy'],
  [/\bprofit tax\b/g, 'the profit levy'],
  [/\bproperty tax\b/g, 'the property levy'],
  [/\bthe Treasury\b/g, 'the public purse'],
  [/\bThe Treasury\b/g, 'The public purse'],
  [/\bdividend\b/g, 'handout'],
  [/\braised\b/g, 'forced up'],
  [/\blowered\b/g, 'eased'],
  [/\bwas convicted of\b/g, 'was found guilty of'],
  [/\bThe Watch\b/g, 'The constables'],
  [/\bthe Watch\b/g, 'the constables'],
  [/\bThe Court\b/g, 'The bench'],
  [/\bthe Court\b/g, 'the bench'],
  [/\bthe Grand Bazaar\b/g, 'the market'],
  [/\bThe Grand Bazaar\b/g, 'The market'],
  [/\bthe Bazaar\b/g, 'the market'],
  [/\bThe Bazaar\b/g, 'The market'],
  [/\bcitizens\b/g, 'residents'],
  [/\bcitizen\b/g, 'resident'],
  [/\bbusiness\b/g, 'firm'],
  [/\btax\b/g, 'levy'],
];

/** One line put through the Ledger's style book. */
export function inLedgerVoice(text: string): string {
  let out = String(text ?? '');
  if (!out) return '';
  for (const [re, to] of LEDGER_STYLE) out = out.replace(re, to);
  return out.replace(/\s{2,}/g, ' ').trim();
}

/**
 * The same fact in a paper's words. The Chronicle prints what was said; the
 * Ledger runs it through its own style book.
 */
export function rewrite(world: World, paper: PaperId, ev: WorldEvent): string {
  const text = String(ev?.text ?? '');
  if (paper !== 'ledger' || !text) return text;
  return inLedgerVoice(text);
}

// ---------------------------------------------------------------------------
// The morning edition
// ---------------------------------------------------------------------------

/** A paper's own front-page notice must not become tomorrow's headline. */
function isEditionNotice(e: WorldEvent): boolean {
  return e.kind === 'story' && e.data !== undefined && 'edition' in e.data;
}

/**
 * The Harbor Ledger's front page for yesterday: the same day's events, ordered
 * by what the Ledger thinks of them and put in the Ledger's words. Printed
 * straight after the Chronicle's, and pushed to the same shelf.
 */
export function printLedgerEdition(world: World, treasuryReport: string): PaperEdition {
  const reportedDay = Math.max(0, world.day - 1);
  const rows: { ev: WorldEvent; score: number; i: number }[] = [];
  (world.events ?? []).forEach((ev, i) => {
    if (ev.day !== reportedDay || isEditionNotice(ev)) return;
    const score = (ev.weight ?? 0) * slant(world, 'ledger', ev);
    if (score <= 0) return;
    rows.push({ ev, score, i });
  });
  rows.sort((a, b) => b.score - a.score || b.ev.tick - a.ev.tick || b.i - a.i);

  const headlines: string[] = [];
  const shapes = new Set<string>();
  for (const row of rows) {
    if (headlines.length >= HEADLINES_PER_EDITION) break;
    const line = rewrite(world, 'ledger', row.ev);
    const shape = headlineShape(line);
    if (!line || shapes.has(shape)) continue;
    shapes.add(shape);
    headlines.push(line);
  }
  if (headlines.length === 0) {
    headlines.push(`Quiet on the quay: nothing worth the ink on day ${reportedDay}.`);
  }
  // The Ledger does not follow the Chronicle's lead. Where both papers hold
  // the same story best of the day — and on a quiet day they often do — the
  // Ledger runs it, but not at the top: a front page that reprints the other
  // paper's is not a second paper. It only ever demotes; nothing is dropped
  // and nothing is invented.
  const rival = frontPage(world, 'chronicle');
  if (rival && rival.day === world.day && headlines.length > 1) {
    // Compared in the Ledger's own words: the same fact rewritten reads
    // differently, and the whole point is to catch the same *story*.
    const lead = headlineShape(inLedgerVoice(rival.headlines?.[0] ?? ''));
    if (lead && headlineShape(headlines[0]) === lead) {
      const other = headlines.findIndex((h) => headlineShape(h) !== lead);
      if (other > 0) [headlines[0], headlines[other]] = [headlines[other], headlines[0]];
    }
  }

  const edition: PaperEdition = { day: world.day, paper: 'ledger', headlines, treasuryReport };
  const shelf = editions(world);
  const existing = shelf.findIndex((e) => e.day === world.day && paperOf(e) === 'ledger');
  if (existing >= 0) shelf[existing] = edition;
  else shelf.push(edition);
  if (shelf.length > CHRONICLE_LENGTH * PAPERS.length) shelf.splice(0, shelf.length - CHRONICLE_LENGTH * PAPERS.length);

  emit(world, 'story', `The Harbor Ledger, day ${world.day}: "${headlines[0]}"`, [], 0.2,
    { edition: world.day, paper: 'ledger', headlines, treasuryReport });
  return edition;
}

/** The latest edition of a paper, or null before it has printed one. */
export function frontPage(world: World, paper: PaperId): PaperEdition | null {
  const shelf = editions(world);
  for (let i = shelf.length - 1; i >= 0; i--) {
    if (paperOf(shelf[i]) === paper) return shelf[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** How the city is actually run, read as a platform. */
function sittingPlatform(world: World): Platform {
  return {
    tax: positionOf(world, 'tax'),
    dividend: positionOf(world, 'dividend'),
    minWage: positionOf(world, 'minWage'),
    strictness: positionOf(world, 'strictness'),
  };
}

/** 1 when two platforms say the same thing, 0 when they are opposites. */
function fit(a: Platform, b: Platform): number {
  let diff = 0;
  for (const field of PLATFORM_FIELDS) diff += Math.abs(clamp(a[field], 0, 1) - clamp(b[field], 0, 1));
  return 1 - diff / PLATFORM_FIELDS.length;
}

/**
 * How a paper reads the people running the city, 0..1: how near what they
 * actually do sits to the line the paper takes. It is a fact about the paper
 * and the Government, not an opinion about a citizen.
 */
export function paperReading(world: World, paper: PaperId): number {
  const info = PAPER_INFO[paper] ?? PAPER_INFO.chronicle;
  return Math.round(clamp(fit(info.line, sittingPlatform(world)), 0, 1) * 100) / 100;
}

function readKey(cId: CitizenId): string { return `paper:read:${cId}`; }

/** Move a reading a step toward what the paper makes of the Government. */
function toward(value: number, target: number): number {
  const from = Number.isFinite(value) ? clamp(value, 0, 1) : 0.5;
  if (Math.abs(target - from) <= APPROVAL_PAPER_SHIFT) return Math.round(target * 100) / 100;
  return Math.round(clamp(from + Math.sign(target - from) * APPROVAL_PAPER_SHIFT, 0, 1) * 100) / 100;
}

/**
 * An hour with a paper. The citizen chooses which one — nothing assigns it —
 * and what they read shifts their reading of the Mayor and the Council toward
 * that paper's view of them.
 */
export function readPaper(world: World, cId: CitizenId, paper: PaperId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const which: PaperId = PAPERS.includes(paper) ? paper : 'chronicle';
  if (world.counters[readKey(cId)] === world.day) return fail('You have already read the paper today.');

  const info = PAPER_INFO[which];
  c.paper = which;
  world.counters[readKey(cId)] = world.day;
  const reading = paperReading(world, which);
  const before = c.approval ?? { mayor: 0.5, council: 0.5 };
  c.approval = { mayor: toward(before.mayor, reading), council: toward(before.council, reading) };
  c.needs.social = clamp(c.needs.social + READING_SOCIAL, 0, 100);

  const page = frontPage(world, which);
  const lead = page?.headlines?.[0] ?? null;
  remember(world, cId, 'event', lead
    ? `You read ${info.name}: "${lead}"`
    : `You read ${info.name}; it had not printed yet today.`);
  return { ok: true, message: lead ? `${info.name}: "${lead}"` : `You read ${info.name}.` };
}

/** What share of the city reads each paper. Sums to 1; the paper of record holds an empty city. */
export function readershipShare(world: World): Record<PaperId, number> {
  let total = 0;
  let ledger = 0;
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !isPresent(world, c)) continue;
    total++;
    if (c.paper === 'ledger') ledger++;
  }
  if (total === 0) return { chronicle: 1, ledger: 0 };
  const share = Math.round((ledger / total) * 100) / 100;
  return { chronicle: Math.round((1 - share) * 100) / 100, ledger: share };
}

/** Both papers' leads, for the observation and the dashboard. */
export function frontPages(world: World): { paper: PaperId; headline: string | null }[] {
  return PAPERS.map((p) => ({ paper: p, headline: frontPage(world, p)?.headlines?.[0] ?? null }));
}
