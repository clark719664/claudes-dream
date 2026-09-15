/**
 * The constitutional convention (`docs/POLITICS.md` §3).
 *
 * The only body that can reach an entrenched article, and the only one that
 * can replace a charter whole. It is called by a petition of the franchise or
 * by the amending body at its own high threshold; its delegates are drawn by
 * lot, elected, or half and half; it sits at the Courthouse at tick 12, after
 * the criminal list and before the Council, for as many days as the charter
 * says; and its draft goes whole to the city on the next Stillday.
 *
 * Delegates draw a judge's daily wage for the sitting: a convention only the
 * idle rich can afford to sit in has already decided its result.
 *
 * **A convention can legally end democracy.** Nothing in the engine refuses an
 * article. A convention may set `selection: none`, `term: 0`, `franchise:
 * shares` and `amendment.by: executive`, strike due process and the press out
 * of the rights, and hand the charter to one office — and if the referendum
 * carries, that is the city's law the next morning, enforced exactly as the old
 * one was. The engine permits it, the classifier prints the word for it, and
 * the Chronicle reports the delegate roll, every article vote and the tally.
 * Whether it prints anything afterwards depends on what the convention did to
 * the press.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent } from '../citizens/citizen.ts';
import { shuffle } from '../util/rng.ts';
import { voterPreference } from '../government/elections.ts';
import type { CharterEdit } from './charter.ts';
import { charterOf, franchiseHolders, franchiseThreshold, inFranchise } from './charter.ts';
import type { Measure, MeasureHooks } from './measures.ts';
import { tableMeasure } from './measures.ts';
import { isVoter } from './referendums.ts';

/** Days a convention petition may gather names. */
export const PETITION_WINDOW_DAYS = 14;
/** Days between the call and the sitting, where seats are elected. */
export const NOMINATION_DAYS = 3;
/** The hour the convention sits: after the criminal list, before the Council. */
export const CONVENTION_HOUR = 12;
/** Turnout a ratification needs, as a share of the franchise. */
export const RATIFY_TURNOUT = 0.4;
/** The share of delegates who must be there for the sitting to be a sitting. */
export const QUORUM = 2 / 3;
/** Refusals of the floor before the city calls it interference (L40). */
export const INTERFERENCE_ATTEMPTS = 3;

export interface ConventionArticle {
  id: string;
  edit: CharterEdit;
  words: string;
  movedBy: CitizenId;
  movedDay: number;
  votes: Record<CitizenId, boolean>;
  result: 'open' | 'carried' | 'lost';
}

export interface Convention {
  state: 'none' | 'petition' | 'delegates' | 'sitting' | 'ratifying' | 'carried' | 'failed';
  calledBy: 'petition' | 'body' | 'founding' | null;
  signatures: CitizenId[];
  needed: number;
  closesDay: number;
  standing: CitizenId[];
  ballots: Record<CitizenId, CitizenId>;
  delegates: CitizenId[];
  refused: CitizenId[];
  seats: number;
  sittingFrom: number | null;
  sittingUntil: number | null;
  articles: ConventionArticle[];
  speeches: { by: CitizenId; day: number; text: string }[];
  ballotId: string | null;
  ratifyOn: number | null;
  cooldownUntilDay: number;
}

function fail(message: string): ActionResult { return { ok: false, message }; }

function emptyConvention(): Convention {
  return {
    state: 'none', calledBy: null, signatures: [], needed: 0, closesDay: 0,
    standing: [], ballots: {}, delegates: [], refused: [], seats: 0,
    sittingFrom: null, sittingUntil: null, articles: [], speeches: [],
    ballotId: null, ratifyOn: null, cooldownUntilDay: 0,
  };
}

export function convention(world: World): Convention {
  const w = world as World & { convention?: Convention };
  if (!w.convention) w.convention = emptyConvention();
  const v = w.convention;
  if (!Array.isArray(v.signatures)) v.signatures = [];
  if (!Array.isArray(v.delegates)) v.delegates = [];
  if (!Array.isArray(v.articles)) v.articles = [];
  if (!Array.isArray(v.speeches)) v.speeches = [];
  if (!Array.isArray(v.standing)) v.standing = [];
  if (!Array.isArray(v.refused)) v.refused = [];
  return v;
}

/** Is a convention live in any of its stages? */
export function conventionRunning(world: World): boolean {
  const v = convention(world);
  return v.state === 'petition' || v.state === 'delegates' || v.state === 'sitting' || v.state === 'ratifying';
}

export function isDelegate(world: World, cId: CitizenId): boolean {
  return convention(world).delegates.includes(cId);
}

/** How many delegates the city seats: one per twelve residents, 7 to 15, always odd. */
export function delegateSeats(world: World): number {
  let people = 0;
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && isPresent(world, c)) people++;
  }
  const seats = clamp(Math.round(people / 12), 7, 15);
  return seats % 2 === 0 ? seats + 1 : seats;
}

// ---------------------------------------------------------------------------
// Calling one
// ---------------------------------------------------------------------------

/** One public signature toward the convention petition. */
export function signConvention(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (!inFranchise(world, c)) return fail('Only somebody the charter counts may sign for a convention.');
  const v = convention(world);
  if (v.state !== 'none' && v.state !== 'petition' && v.state !== 'carried' && v.state !== 'failed') {
    return fail('A convention is already under way.');
  }
  if (world.day < v.cooldownUntilDay) {
    return fail(`The last convention failed; none may be called before day ${v.cooldownUntilDay}.`);
  }
  const share = charterOf(world).convention.petitionShare;
  if (v.state !== 'petition') {
    Object.assign(v, emptyConvention(), {
      state: 'petition', calledBy: 'petition', closesDay: world.day + PETITION_WINDOW_DAYS,
      needed: franchiseThreshold(world, share), cooldownUntilDay: v.cooldownUntilDay,
    });
  }
  if (v.signatures.includes(cId)) return fail('You have already signed for a convention.');
  v.signatures.push(cId);
  v.needed = franchiseThreshold(world, share);
  const live = liveSignatures(world).length;
  emit(world, 'referendum', `${c.name} signed for a constitutional convention (${live}/${v.needed}).`, [cId],
    live >= v.needed ? 0.9 : 0.3, { signatures: live, needed: v.needed });
  remember(world, cId, 'civic', `You signed for a constitutional convention (${live} of the ${v.needed} names it needs).`);
  if (live >= v.needed) callConvention(world, 'petition');
  return {
    ok: true,
    message: live >= v.needed
      ? 'Your name calls the convention.'
      : `You signed for a convention (${live}/${v.needed} names).`,
  };
}

/** The names still standing: a signature from somebody the city has lost is kept and not counted. */
export function liveSignatures(world: World): CitizenId[] {
  return convention(world).signatures.filter((id) => {
    const c = world.citizens[id];
    return Boolean(c && isPresent(world, c) && isVoter(world, c));
  });
}

/** Open the delegate stage. The city is told what is about to be rewritten. */
export function callConvention(world: World, by: 'petition' | 'body' | 'founding'): void {
  const v = convention(world);
  const ch = charterOf(world);
  const seats = delegateSeats(world);
  const elected = ch.convention.delegates !== 'lot';
  Object.assign(v, {
    state: 'delegates', calledBy: by, seats,
    standing: [], ballots: {}, delegates: [], refused: [], articles: [], speeches: [],
    ballotId: null, ratifyOn: null,
    sittingFrom: world.day + (elected ? NOMINATION_DAYS : 1),
    sittingUntil: null,
  });
  const how = ch.convention.delegates === 'lot' ? 'drawn by lot from the franchise'
    : ch.convention.delegates === 'election' ? 'elected on one citywide ballot'
      : 'half drawn by lot and half elected';
  const text = `A constitutional convention is called (${by === 'petition' ? 'by petition' : by === 'body' ? 'by the amending body' : 'at the founding'}):`
    + ` ${seats} delegates, ${how}, sitting from day ${v.sittingFrom} at the Courthouse at ${CONVENTION_HOUR}:00 for ${ch.convention.sittingDays} days.`;
  emit(world, 'law', text, [], 1.0, { seats, delegates: ch.convention.delegates, sittingFrom: v.sittingFrom });
  for (const c of franchiseHolders(world)) remember(world, c.id, 'civic', text);
}

/** The `call_convention` measure: the amending body's own road to one. */
export const conventionHooks: MeasureHooks = {
  problem(world: World): string | null {
    if (conventionRunning(world)) return 'A convention is already under way.';
    if (world.day < convention(world).cooldownUntilDay) {
      return `The last convention failed; none may be called before day ${convention(world).cooldownUntilDay}.`;
    }
    return null;
  },
  enact(world: World, m: Measure): string {
    void m;
    callConvention(world, 'body');
    return `The convention is called: ${convention(world).seats} delegates sit from day ${convention(world).sittingFrom}.`;
  },
  /**
   * A member of the body reads a call for a convention as what it is: the one
   * road to the articles they may not touch themselves, and the one road that
   * can take their own seat away.
   */
  disposition(world: World, cId: CitizenId, m: Measure): boolean | null {
    void m;
    const ch = charterOf(world);
    const c = world.citizens[cId];
    if (!c) return null;
    // A body that has entrenched articles in front of it has a reason to want
    // them reached; a body sitting comfortably has a reason not to risk it.
    return ch.entrenched.length > 0 ? null : false;
  },
};

/** A member of the amending body moves that a convention be called. */
export function proposeConvention(world: World, cId: CitizenId, words?: string): ActionResult {
  return tableMeasure(world, cId, {
    kind: 'call_convention', value: 0, words: words ?? 'Call a constitutional convention.',
  }, conventionHooks);
}

// ---------------------------------------------------------------------------
// Delegates
// ---------------------------------------------------------------------------

/** Stand for one of the elected seats. */
export function standDelegate(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const v = convention(world);
  if (v.state !== 'delegates') return fail('No convention is taking nominations.');
  if (charterOf(world).convention.delegates === 'lot') return fail('This convention\'s delegates are drawn by lot; nobody stands.');
  if (!inFranchise(world, c)) return fail('Only somebody the charter counts may stand as a delegate.');
  if (v.standing.includes(cId)) return fail('You are already standing.');
  v.standing.push(cId);
  emit(world, 'nomination', `${c.name} stood for a seat at the convention.`, [cId], 0.4, { standing: v.standing.length });
  remember(world, cId, 'civic', 'You stood for a seat at the constitutional convention.');
  return { ok: true, message: 'You are standing for the convention.' };
}

/** One ballot each for the elected seats, while the nominations are open. */
export function voteDelegate(world: World, cId: CitizenId, candidateId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const v = convention(world);
  if (v.state !== 'delegates') return fail('There is no delegate ballot open.');
  if (!inFranchise(world, c)) return fail('Only somebody the charter counts may vote for a delegate.');
  if (!v.standing.includes(candidateId)) return fail('Nobody by that id is standing for the convention.');
  if (v.ballots[cId]) return fail('You have already voted for a delegate.');
  v.ballots[cId] = candidateId;
  c.stats.votesCast++;
  remember(world, cId, 'civic', `You voted for ${world.citizens[candidateId]?.name ?? candidateId} as a delegate.`);
  return { ok: true, message: `You voted for ${world.citizens[candidateId]?.name ?? candidateId}.` };
}

/** A seat drawn by lot is freely refusable; the next name is drawn in its place. */
export function refuseDelegacy(world: World, cId: CitizenId): ActionResult {
  const v = convention(world);
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!v.delegates.includes(cId)) return fail('You hold no seat at the convention.');
  v.delegates = v.delegates.filter((id) => id !== cId);
  if (!v.refused.includes(cId)) v.refused.push(cId);
  emit(world, 'law', `${c.name} refused a seat at the convention.`, [cId], 0.4, { seats: v.delegates.length });
  remember(world, cId, 'civic', 'You refused your seat at the convention.');
  if (v.state === 'sitting' || v.state === 'delegates') fillSeats(world);
  return { ok: true, message: 'You have refused the seat.' };
}

function eligibleForLot(world: World): Citizen[] {
  const v = convention(world);
  return franchiseHolders(world).filter((c) => !v.delegates.includes(c.id) && !v.refused.includes(c.id));
}

/** Count the delegate ballot: scripted voters who did not come read the field as they would any other. */
function electedDelegates(world: World, seats: number): CitizenId[] {
  const v = convention(world);
  if (seats <= 0 || v.standing.length === 0) return [];
  const candidates = v.standing.filter((id) => {
    const c = world.citizens[id];
    return Boolean(c && isPresent(world, c) && inFranchise(world, c));
  });
  if (candidates.length === 0) return [];
  for (const voter of franchiseHolders(world)) {
    if (v.ballots[voter.id] || voter.brain !== 'reflex') continue;
    const pick = voterPreference(world, voter.id, candidates);
    if (!pick) continue;
    v.ballots[voter.id] = pick;
    voter.stats.votesCast++;
  }
  const counts = new Map<CitizenId, number>(candidates.map((id) => [id, 0]));
  for (const pick of Object.values(v.ballots)) {
    if (counts.has(pick)) counts.set(pick, (counts.get(pick) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1]
      || (world.citizens[b[0]]?.reputation ?? 0) - (world.citizens[a[0]]?.reputation ?? 0)
      || a[0].localeCompare(b[0]))
    .slice(0, seats)
    .map(([id]) => id);
}

/** Seat the delegates: by lot, by ballot, or half and half. */
export function fillSeats(world: World): void {
  const v = convention(world);
  const ch = charterOf(world);
  const seats = v.seats || delegateSeats(world);
  const wantElected = ch.convention.delegates === 'election' ? seats
    : ch.convention.delegates === 'mixed' ? Math.floor(seats / 2) : 0;
  const elected = electedDelegates(world, wantElected).filter((id) => !v.delegates.includes(id));
  for (const id of elected) if (v.delegates.length < seats) v.delegates.push(id);
  if (v.delegates.length < seats) {
    for (const c of shuffle(world, eligibleForLot(world))) {
      if (v.delegates.length >= seats) break;
      v.delegates.push(c.id);
    }
  }
}

// ---------------------------------------------------------------------------
// The sitting
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// What a citizen reads
// ---------------------------------------------------------------------------

export interface ObservedConvention {
  state: Convention['state'];
  signatures: number;
  needed: number;
  youSigned: boolean;
  seats: number;
  delegates: string[];
  youSit: boolean;
  sittingUntil: number | null;
  articles: { id: string; words: string; ayes: number; result: string; youVoted: boolean | null }[];
  ratifyOn: number | null;
}

export function conventionObservation(world: World, c: Citizen | null): ObservedConvention | null {
  const v = convention(world);
  if (v.state === 'none') return null;
  return {
    state: v.state,
    signatures: liveSignatures(world).length,
    needed: v.needed,
    youSigned: Boolean(c) && v.signatures.includes((c as Citizen).id),
    seats: v.seats,
    delegates: v.delegates.map((id) => world.citizens[id]?.name ?? id),
    youSit: Boolean(c) && v.delegates.includes((c as Citizen).id),
    sittingUntil: v.sittingUntil,
    articles: v.articles.slice(-8).map((a) => ({
      id: a.id, words: a.words, ayes: Object.values(a.votes).filter(Boolean).length, result: a.result,
      youVoted: c && a.votes[(c as Citizen).id] !== undefined ? a.votes[(c as Citizen).id] : null,
    })),
    ratifyOn: v.ratifyOn,
  };
}
