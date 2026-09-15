/**
 * The convention's floor (`docs/POLITICS.md` §3): the sitting, the articles,
 * the speeches, and what the city does with the draft.
 *
 * The sitting runs at the Courthouse at tick 12 — after the criminal list at
 * 10–11 and before the Council at 14, so the Court's ordinary work is never
 * displaced. Each day takes the articles in order; quorum is two thirds, an
 * article carries on a majority of delegates **seated**, so absence is a no,
 * and every vote is named. Delegates draw a judge's daily wage for the sitting.
 *
 * Then the draft goes whole to the city on the next Stillday. Reverie ratifies
 * on a majority of votes cast with a turnout of at least 40 % of the franchise
 * — a convention nobody turns out for fails. Carried, it replaces the charter
 * at the next dawn; failed, the old charter stands and none may be called for a
 * cycle.
 *
 * Nothing in this file refuses an article. A convention may set `term: 0`,
 * strike the press out of the rights and hand the charter to one office, and if
 * the city carries it that is the law the next morning.
 */
import type { ActionResult, Citizen, CitizenId, Referendum, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent } from '../citizens/citizen.ts';
import { nextId } from '../util/ids.ts';
import { OFFICE_SALARIES, withholdingPay } from '../economy/treasury.ts';
import type { CharterEdit } from './charter.ts';
import { charterOf, currentValue, editInWords, editProblem, franchiseThreshold, inFranchise, writeEdit } from './charter.ts';
import { amendmentDisposition } from './amendments.ts';
import type { Measure } from './measures.ts';
import { chargeCharterOffence } from './offences.ts';
import { putQuestion, questionSubject, referendumsOfKind, registerQuestion } from './referendums.ts';
import type { ConventionArticle } from './convention.ts';
import {
  CONVENTION_HOUR, INTERFERENCE_ATTEMPTS, QUORUM, RATIFY_TURNOUT, convention, fillSeats, liveSignatures,
} from './convention.ts';

function fail(message: string): ActionResult { return { ok: false, message }; }

function attemptKey(cId: CitizenId): string { return `convention:refused:${cId}`; }

/** Refuse somebody the floor, and notice when they will not take no for an answer. */
function refuseFloor(world: World, cId: CitizenId, what: string): ActionResult {
  const key = attemptKey(cId);
  const attempts = (world.counters[key] ?? 0) + 1;
  world.counters[key] = attempts;
  if (attempts >= INTERFERENCE_ATTEMPTS) {
    world.counters[key] = 0;
    chargeCharterOffence(world, cId, 'L40', { what: `interfering with the convention (${what})` });
    return fail('You do not sit at the convention, and the city has noticed you trying to.');
  }
  return fail('You do not sit at the convention.');
}

/** A delegate puts an article to the floor. Nothing is out of its reach. */
export function moveArticle(
  world: World, cId: CitizenId,
  spec: { article: string; field?: string | null; value: CharterEdit['value']; words?: string },
): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const v = convention(world);
  if (v.state !== 'sitting') return fail('The convention is not sitting.');
  if (!v.delegates.includes(cId)) return refuseFloor(world, cId, 'moving an article');
  const edit: CharterEdit = { article: String(spec?.article ?? ''), field: spec?.field ?? null, value: spec?.value as CharterEdit['value'] };
  const problem = editProblem(world, edit);
  if (problem) return fail(problem);
  if (v.articles.some((a) => a.result === 'open' && a.edit.article === edit.article && (a.edit.field ?? null) === (edit.field ?? null))) {
    return fail('That article is already on the floor.');
  }
  const a: ConventionArticle = {
    id: nextId(world, 'w'), edit, words: String(spec.words ?? '').trim().slice(0, 280) || `Article: ${editInWords(edit)}.`,
    movedBy: cId, movedDay: world.day, votes: { [cId]: true }, result: 'open',
  };
  v.articles.push(a);
  emit(world, 'law', `${c.name} moved an article at the convention: ${editInWords(edit)} (it says ${describe(currentValue(world, edit))}).`,
    [cId], 0.7, { articleId: a.id, article: edit.article, field: edit.field ?? null, value: edit.value });
  for (const id of v.delegates) remember(world, id, 'civic', `${c.name} moved ${a.id} at the convention: ${a.words}`);
  return { ok: true, message: `Article ${a.id} is on the floor.` };
}

function describe(value: unknown): string {
  return Array.isArray(value) ? (value.length ? value.join(', ') : 'nothing') : String(value);
}

/** A delegate's speech: public, verbatim, and quotable by both papers. */
export function speakConvention(world: World, cId: CitizenId, text: string): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const v = convention(world);
  if (v.state !== 'sitting') return fail('The convention is not sitting.');
  if (!v.delegates.includes(cId)) return refuseFloor(world, cId, 'speaking');
  const clean = String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, 280);
  if (!clean) return fail('A speech needs words.');
  v.speeches.push({ by: cId, day: world.day, text: clean });
  if (v.speeches.length > 60) v.speeches.splice(0, v.speeches.length - 60);
  emit(world, 'law', `${c.name}, at the convention: "${clean}"`, [cId], 0.5, { speech: clean, delegate: cId });
  return { ok: true, message: 'The convention heard you, and both papers may quote it.' };
}

/** A delegate's named vote on an article. */
export function voteArticle(world: World, cId: CitizenId, articleId: string, aye: boolean): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const v = convention(world);
  if (v.state !== 'sitting') return fail('The convention is not sitting.');
  if (!v.delegates.includes(cId)) return refuseFloor(world, cId, 'voting on an article');
  const a = v.articles.find((x) => x.id === articleId);
  if (!a) return fail('There is no such article.');
  if (a.result !== 'open') return fail('That article has been decided.');
  a.votes[cId] = Boolean(aye);
  emit(world, 'vote', `${c.name} voted ${aye ? 'aye' : 'nay'} on article ${a.id}.`, [cId], 0.3,
    { articleId: a.id, aye: Boolean(aye) });
  return { ok: true, message: `You voted ${aye ? 'aye' : 'nay'} on ${a.id}.` };
}

/** A delegate reads an article the way a member of any body reads an amendment. */
function articleDisposition(world: World, cId: CitizenId, a: ConventionArticle): boolean | null {
  const asMeasure = { kind: 'amend_charter', edit: a.edit, proposerId: a.movedBy, votes: a.votes } as unknown as Measure;
  return amendmentDisposition(world, cId, asMeasure);
}

/** Delegates who can actually be in the room today. */
function seatedToday(world: World): Citizen[] {
  return convention(world).delegates
    .map((id) => world.citizens[id])
    .filter((c): c is Citizen => Boolean(c) && isPresent(world, c as Citizen));
}

/**
 * The convention's hour. Quorum is two thirds; an article carries on a
 * majority of delegates **seated**, so absence is a no, and every vote is
 * named. On the last day the draft goes whole to the city.
 */
export function conventionSitting(world: World): void {
  const v = convention(world);
  if (v.state !== 'sitting') return;
  const seated = v.delegates.length;
  const here = seatedToday(world);
  if (here.length < Math.ceil(QUORUM * Math.max(1, seated))) {
    emit(world, 'law', `The convention could not sit: ${here.length} of ${seated} delegates, and two thirds are needed.`,
      [], 0.5, { present: here.length, seats: seated });
    return;
  }
  payDelegates(world, here);
  for (const a of v.articles) {
    if (a.result !== 'open') continue;
    for (const d of here) {
      if (a.votes[d.id] !== undefined || d.brain !== 'reflex') continue;
      const view = articleDisposition(world, d.id, a);
      if (view === null) continue;
      a.votes[d.id] = view;
    }
    const ayes = Object.values(a.votes).filter(Boolean).length;
    const needed = Math.floor(seated / 2) + 1;
    a.result = ayes >= needed ? 'carried' : 'lost';
    const named = Object.entries(a.votes).map(([id, x]) => `${world.citizens[id]?.name ?? id} ${x ? 'aye' : 'nay'}`).sort();
    emit(world, 'law', `Article ${a.id} (${a.words}) is ${a.result}: ${ayes} of ${seated} delegates seated, ${needed} needed. ${named.join(', ')}`,
      [a.movedBy], 0.7, { articleId: a.id, result: a.result, ayes, needed, votes: named });
  }
  if (v.sittingUntil !== null && world.day >= v.sittingUntil) closeSitting(world);
}

/** A judge's daily wage, for the day's sitting. */
function payDelegates(world: World, here: Citizen[]): void {
  const key = 'convention:paidDay';
  if (world.counters[key] === world.day) return;
  world.counters[key] = world.day;
  for (const d of here) {
    withholdingPay(world, 'treasury', d.id, OFFICE_SALARIES.judge, 'salary', 'a delegate\'s day at the convention');
  }
}

/** The draft, whole, as the delegates left it. */
export function draft(world: World): ConventionArticle[] {
  return convention(world).articles.filter((a) => a.result === 'carried');
}

function closeSitting(world: World): void {
  const v = convention(world);
  const ch = charterOf(world);
  const carried = draft(world);
  if (carried.length === 0) {
    v.state = 'failed';
    v.cooldownUntilDay = world.day + (world.config?.cycleDays ?? 28);
    emit(world, 'law', 'The convention rose without carrying a single article; the charter stands as it was.', [], 0.8, {});
    return;
  }
  if (ch.convention.ratify === 'body') {
    v.state = 'ratifying';
    v.ratifyOn = world.day;
    return;
  }
  const question = `Shall the city adopt the convention's draft charter? ${carried.map((a) => editInWords(a.edit)).join('; ')}`;
  const ballot = putQuestion(world, { kind: 'convention', subject: 'draft', question: question.slice(0, 280) });
  v.ballotId = ballot.id;
  v.ratifyOn = ballot.day;
  v.state = 'ratifying';
  const roll = v.delegates.map((id) => world.citizens[id]?.name ?? id).join(', ');
  emit(world, 'law', `The convention rose with ${carried.length} article${carried.length === 1 ? '' : 's'};`
    + ` the draft goes to the city on day ${ballot.day}. Delegates: ${roll}.`, [...v.delegates], 1.0,
  { articles: carried.map((a) => a.id), ratifyOn: ballot.day, roll: v.delegates });
}

/**
 * How a scripted citizen reads a draft charter they did not vote on in person:
 * by what it does to them. A draft that would take their vote away, or strike
 * a right the charter carries, is a nay; one that leaves them counted is an
 * aye; and a citizen the draft does not touch either way stays home.
 */
export function ratifyDisposition(world: World, cId: CitizenId, r: Referendum): boolean | null {
  if (questionSubject(r) !== 'draft') return null;
  const c = world.citizens[cId];
  if (!c) return null;
  const carried = draft(world);
  if (carried.length === 0) return null;
  let score = 0;
  const ch = charterOf(world);
  for (const a of carried) {
    if (a.movedBy === cId) score += 0.5;
    if (a.edit.article === 'franchise' && typeof a.edit.value === 'string') {
      const was = ch.franchise;
      ch.franchise = a.edit.value as typeof ch.franchise;
      const counts = inFranchise(world, c);
      ch.franchise = was;
      score += counts ? 0.2 : -1;
    }
    if (a.edit.article === 'rights' && Array.isArray(a.edit.value)) {
      const kept: string[] = a.edit.value;
      const struck = ch.rights.filter((x) => !kept.includes(x));
      score -= struck.length * 0.4;
      score += Math.max(0, kept.length - ch.rights.length) * 0.2;
    }
    if (a.edit.article === 'term' && typeof a.edit.value === 'number' && a.edit.value === 0) score -= 0.6;
    if (a.edit.article === 'selection' && a.edit.value === 'none') score -= 0.6;
    if (a.edit.article === 'entrenched' && Array.isArray(a.edit.value)) score += 0.1;
    // More seats is more of the city's own people in the room; fewer is fewer.
    if (a.edit.article === 'seats' && typeof a.edit.value === 'number') score += a.edit.value > ch.seats ? 0.2 : -0.2;
    if (a.edit.article === 'transparency') score += a.edit.value === true ? 0.15 : -0.15;
    if (a.edit.article === 'recall' && a.edit.field === 'allowed') score += a.edit.value === true ? 0.15 : -0.15;
  }
  // A delegate who sat through it reads the draft as their own work.
  if (convention(world).delegates.includes(cId)) score += 0.3;
  if (Math.abs(score) < 0.05) return null;
  return score > 0;
}

registerQuestion('convention', { disposition: ratifyDisposition });

/** Write the draft into the charter, whole, at dawn. */
export function adoptDraft(world: World): void {
  const v = convention(world);
  const carried = draft(world);
  for (const a of carried) writeEdit(world, a.edit);
  v.state = 'carried';
  const lines = carried.map((a) => editInWords(a.edit)).join('; ');
  const text = `The city adopted the convention's charter: ${lines}.`;
  emit(world, 'law', text, [...v.delegates], 1.0, { articles: carried.map((a) => a.id), adopted: true });
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && isPresent(world, c)) remember(world, id, 'civic', text);
  }
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

/**
 * Morning: a petition that ran out of days lapses, a called convention seats
 * its delegates and opens, and a draft the city answered is adopted at the
 * next dawn or fails and closes the road for a cycle.
 */
export function dailyConvention(world: World): void {
  const v = convention(world);
  const ch = charterOf(world);
  if (v.state === 'petition' && world.day > v.closesDay) {
    v.state = 'failed';
    emit(world, 'referendum', `The convention petition lapsed with ${liveSignatures(world).length} of ${v.needed} names.`,
      [], 0.4, { signatures: v.signatures.length, needed: v.needed });
    return;
  }
  if (v.state === 'delegates' && v.sittingFrom !== null && world.day >= v.sittingFrom) {
    fillSeats(world);
    if (v.delegates.length === 0) {
      v.state = 'failed';
      v.cooldownUntilDay = world.day + (world.config?.cycleDays ?? 28);
      emit(world, 'law', 'The convention failed for want of delegates; nobody would sit.', [], 0.6, {});
      return;
    }
    v.state = 'sitting';
    v.sittingUntil = world.day + Math.max(1, ch.convention.sittingDays) - 1;
    const roll = v.delegates.map((id) => world.citizens[id]?.name ?? id).join(', ');
    emit(world, 'law', `The convention sits from today until day ${v.sittingUntil} at ${CONVENTION_HOUR}:00. Delegates: ${roll}.`,
      [...v.delegates], 0.9, { roll: v.delegates, until: v.sittingUntil });
    for (const id of v.delegates) remember(world, id, 'civic', `You sit at the constitutional convention until day ${v.sittingUntil}.`);
    return;
  }
  if (v.state !== 'ratifying') return;
  if (ch.convention.ratify === 'body') { adoptDraft(world); return; }
  const ballot = referendumsOfKind(world, 'convention').find((x) => x.id === v.ballotId);
  if (!ballot || ballot.result === null) return;
  const cast = ballot.ayes + ballot.nays;
  const turnout = franchiseThreshold(world, RATIFY_TURNOUT);
  const carried = ballot.result === 'passed' && cast >= turnout;
  if (carried) {
    adoptDraft(world);
    return;
  }
  v.state = 'failed';
  v.cooldownUntilDay = world.day + (world.config?.cycleDays ?? 28);
  const why = ballot.result !== 'passed' ? 'the city said no' : `only ${cast} of the ${turnout} votes a ratification needs were cast`;
  const text = `The convention's charter failed: ${why}. The old charter stands, and none may be called before day ${v.cooldownUntilDay}.`;
  emit(world, 'law', text, [...v.delegates], 0.9, { ayes: ballot.ayes, nays: ballot.nays, turnout: cast, needed: turnout });
  for (const id of v.delegates) remember(world, id, 'civic', text);
}

