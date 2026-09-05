/**
 * Custody: the cells at the Watch House, the Keep, and everything that happens
 * to a citizen between the day the Court sets a term and the day the city
 * takes them back (`JUSTICE.md` §2).
 *
 * Custody is **not** a rung on the civic ladder and never was one. It is the
 * whole of Track II's answer: a number of days, up to life, for an offence
 * against a person. Nothing about money reaches it — no fine substitutes for
 * it, no purse shortens it — and it never turns into exile. *The city keeps
 * its own.*
 *
 * What custody takes is the day. What it leaves alone is everything else: a
 * prisoner keeps their property, their family, their letters home and their
 * place in the Registry; their household keeps its home, and the Chest keeps
 * their dependants. They may write, study, work in custody at a reduced wage
 * that pays their victim first, appeal, ask for parole, and be visited. They
 * may not leave, work an outside job, trade, buy, vote, stand, hold office, or
 * do anything at all to another person.
 *
 * Two rules this file will not bend:
 *
 * - **Overcrowding never opens a cell.** If the cells are full the Council is
 *   obliged to fund the Keep out of public works, the prisoners are held at a
 *   mood penalty, and the Chronicle runs the story every single day. Crowding
 *   is a political crisis, not a release valve, and `releaseForSpace` exists
 *   only to say no.
 * - **Nobody is released early because the city is embarrassed.** The ways out
 *   are the end of the term, parole granted by a bench after half of it, a
 *   Council pardon on a life term, and an appeal that sets the conviction
 *   aside. There is no fifth way.
 */
import { clamp } from '../types.ts';
import type { ActionResult, ActionType, CaseId, Citizen, CitizenId, DistrictId, World } from '../types.ts';
import { JAIL_CELLS } from '../data/metropolis.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer, withholdingPay } from '../economy/treasury.ts';
import { adjustBond, areFriends } from '../citizens/relationships.ts';
import { areFamily } from '../society/family.ts';
import { STIPEND, hardshipOf } from '../society/chest.ts';
import { householdOf, membersOf } from '../society/households.ts';
import { tellNeighbours } from '../social/neighbours.ts';
import { caseNumber, canSit, isPresent, nameOf } from './cases.ts';
import {
  breachTerm, custodialConvictions, custodyTerm, describeCustodyTerm, exileForbidden, paroleEligibleDay,
  recordCustodialConviction,
} from './custody.ts';
import type { CustodyFactors, CustodyTerm } from './custody.ts';
import type { Harm, PersonCode } from './persons.ts';
import { LIFE_TERM_DAYS, PERSON_CODES, dailyErasure, isPersonCode, personLaw } from './persons.ts';
import { clearParoleState, dailyParole, paroleCaseOf } from './parole.ts';
import { memo } from '../util/memo.ts';

/** Where the cells are: the Watch House, in the Commons. */
export const JAIL_DISTRICT: DistrictId = 'commons';
/** Where the Keep stands once the city has built it. */
export const KEEP_DISTRICT: DistrictId = 'undercroft';
/** A term of this many days or more belongs in the Keep, not in a cell. */
export const KEEP_THRESHOLD_DAYS = 30;
/** What the Keep costs out of the public works fund. */
export const KEEP_COST = 400;
/** How many it holds. */
export const KEEP_CELLS = 12;
/** Comfort taken each day from a prisoner held over the city's capacity. */
export const CROWDING_COMFORT = 6;
/** Comfort taken each day from a long-term prisoner with no Keep to hold them. */
export const NO_KEEP_COMFORT = 4;
/** The Watch House feeds and beds whoever it holds: no need falls below this. */
export const RATION_FLOOR = 40;
/** Custody labour pays this share of the minimum wage. */
export const CUSTODY_WAGE_SHARE = 0.5;
/** What a day's work in custody does for the purpose of the one doing it. */
export const CUSTODY_WORK_PURPOSE = 6;
/** A visit, for both of them. */
export const VISIT_SOCIAL = 20;
export const VISIT_BOND = 3;

/**
 * All a citizen in custody may do. The list is the Charter's, not a
 * convenience: the notebook, the letter and the appeal are never taken away,
 * because a city that could take those could hold somebody forever without
 * ever being argued with.
 */
export const CUSTODY_ACTIONS: readonly ActionType[] = [
  'idle', 'note', 'forget', 'write_diary', 'message', 'appeal', 'publish',
  'study', 'work_custody', 'request_parole', 'plead_guilty',
];

/**
 * Permitted in custody and not part of `ActionType`: `surrender` belongs to
 * the sheltered (`CREEDS.md` §9) and is kept here as a string so that the rule
 * is written down whole, where the rest of the rule is.
 */
export const CUSTODY_ALSO_ALLOWS: readonly string[] = ['surrender'];

/**
 * What custody permits, in the Charter's own words, for the observation of the
 * citizen serving it. Facts, not advice: this is the list, and the list is the
 * Charter's (`docs/JUSTICE.md` §2, "What custody is").
 */
export const CUSTODY_CONDITIONS: readonly string[] = [
  'You may write in your notebook, write your diary, and send a letter to any citizen.',
  'You may study: the Academy runs classes in the Keep.',
  'You may work a shift in custody at half the minimum wage; it pays your victim first and you second.',
  'You may appeal your conviction to the Council, and ask the Court for parole after half the term.',
  'A journalist may still file a story.',
  'Family and friends may come and see you; you keep your home, your household, your property and your name.',
  'You may not leave, work an outside job, trade, buy, vote, stand, hold office, or act against another person.',
  'The term ends and the city expects you back. Custody is not exile.',
];

/** What custody takes, spelled out: everything that reaches the city or another person. */
export const CUSTODY_FORBIDS: readonly string[] = [
  'work', 'move', 'trade', 'buy', 'sell', 'vote', 'nominate', 'campaign', 'propose', 'steal', 'scam',
  'harass', 'extort', 'sabotage', 'vandalize', 'bribe', 'socialize', 'date', 'marry', 'gift',
];

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

function caseKey(cId: CitizenId): string { return `jailCase:${cId}`; }
function codeKey(cId: CitizenId): string { return `custody:code:${cId}`; }
function lifeKey(cId: CitizenId): string { return `custody:life:${cId}`; }
function termKey(cId: CitizenId): string { return `custody:term:${cId}`; }
function startKey(cId: CitizenId): string { return `custody:start:${cId}`; }
function workedKey(cId: CitizenId): string { return `custody:worked:${cId}`; }
function paidKey(cId: CitizenId): string { return `custody:restpaid:${cId}`; }
function visitKey(a: CitizenId, b: CitizenId): string { return `custody:visit:${a}:${b}`; }
function restrainKey(cId: CitizenId, victim: CitizenId): string { return `restrain:${cId}:${victim}`; }
const KEEP_BUILT_KEY = 'keep:built';
const KEEP_OBLIGATION_KEY = 'keep:obligation';
const CROWDING_STORY_KEY = 'keep:storyDay';

export interface CustodyRecord {
  citizenId: CitizenId;
  /** The offence they are held for, when it is a personal one. */
  code: PersonCode | null;
  caseId: CaseId | null;
  /** The day the term began. */
  startDay: number;
  /** The term as passed, in days (LIFE_TERM_DAYS for life). */
  term: number;
  /** The day the cells open, or a hundred years hence for a life term. */
  untilDay: number;
  life: boolean;
  /** Where they are held today. */
  where: 'watch house' | 'keep';
}

/** In the cells right now. */
export function isJailed(c: Citizen | null | undefined): boolean {
  return !!c && c.jailedUntilDay !== null && c.jailedUntilDay !== undefined;
}

/** The same question, spelled the way the rest of Track II spells it. */
export function inCustody(c: Citizen | null | undefined): boolean {
  return isJailed(c);
}

/** Everyone in custody, in the city's turn order so the roll is stable. */
export function jailedCitizens(world: World): Citizen[] {
  return memo(world, 'jail:prisoners', () => jailedCitizensNow(world));
}

function jailedCitizensNow(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && isJailed(c)) out.push(c);
  }
  return out;
}

/** The case a citizen is held for, when the register remembers one. */
export function jailCaseOf(world: World, cId: CitizenId): CaseId | null {
  const n = world.counters[caseKey(cId)];
  return n === undefined ? null : `k_${Math.round(n)}`;
}

/** The offence a citizen is held for, when it is one of the nine. */
export function custodyCodeOf(world: World, cId: CitizenId): PersonCode | null {
  const n = world.counters[codeKey(cId)];
  if (n === undefined) return null;
  const code = PERSON_CODES[Math.round(n) - 1];
  return code ?? null;
}

/** Is this a life term? The register says so, never the size of the number. */
export function isLifeTerm(world: World, cId: CitizenId): boolean {
  return world.counters[lifeKey(cId)] === 1;
}

/** Everything the register holds about one prisoner. */
export function custodyOf(world: World, cId: CitizenId): CustodyRecord | null {
  const c = world.citizens[cId];
  if (!c || !isJailed(c)) return null;
  const life = isLifeTerm(world, cId);
  return {
    citizenId: cId,
    code: custodyCodeOf(world, cId),
    caseId: jailCaseOf(world, cId),
    startDay: Math.round(world.counters[startKey(cId)] ?? world.day),
    term: Math.round(world.counters[termKey(cId)] ?? Math.max(0, (c.jailedUntilDay ?? world.day) - world.day)),
    untilDay: c.jailedUntilDay ?? world.day,
    life,
    where: c.district === KEEP_DISTRICT || (keepBuilt(world) && belongsInKeep(world, cId)) ? 'keep' : 'watch house',
  };
}

/** Days left of a term. A life term is not a number of days; it reads as one anyway. */
export function daysLeft(world: World, c: Citizen): number {
  return isJailed(c) ? Math.max(0, (c.jailedUntilDay ?? world.day) - world.day) : 0;
}

// ---------------------------------------------------------------------------
// The cells, and the Keep
// ---------------------------------------------------------------------------

/** Cells at the Watch House (a world saved before they were built has the default). */
export function jailCells(world: World): number {
  const n = world.jailCells;
  return Number.isFinite(n) && (n as number) >= 0 ? Math.floor(n as number) : JAIL_CELLS;
}

/** Has the city built the Keep? */
export function keepBuilt(world: World): boolean {
  return world.counters[KEEP_BUILT_KEY] !== undefined;
}

/** Places in the Keep, once it stands. */
export function keepCells(world: World): number {
  return keepBuilt(world) ? KEEP_CELLS : 0;
}

/** Everything the city can hold at once. */
export function custodyCapacity(world: World): number {
  return jailCells(world) + keepCells(world);
}

/** A term of 30 days or more is not cell work; it is the Keep's. */
export function belongsInKeep(world: World, cId: CitizenId): boolean {
  if (isLifeTerm(world, cId)) return true;
  const term = world.counters[termKey(cId)];
  return term !== undefined && Math.round(term) >= KEEP_THRESHOLD_DAYS;
}

/** Where the Keep stands: the Undercroft when the city has opened it, else beside the Watch House. */
export function keepDistrict(world: World): DistrictId {
  return (world.openDistricts ?? []).includes(KEEP_DISTRICT) ? KEEP_DISTRICT : JAIL_DISTRICT;
}

/** More prisoners than the city has room for. */
export function overcrowded(world: World): boolean {
  return jailedCitizens(world).length > custodyCapacity(world);
}

/** Prisoners the Watch House is holding who should be in a Keep the city has not built. */
export function heldWithoutAKeep(world: World): Citizen[] {
  if (keepBuilt(world)) return [];
  return jailedCitizens(world).filter((c) => belongsInKeep(world, c.id));
}

/**
 * The Council is obliged to fund the Keep — the Charter's word is *shall* —
 * from the moment the city holds somebody it has no room for, or holds a long
 * term it has nowhere to put. Returns the day the obligation began, or null.
 */
export function keepObligation(world: World): number | null {
  const since = world.counters[KEEP_OBLIGATION_KEY];
  return since === undefined ? null : Math.round(since);
}

/**
 * Build the Keep out of the public works fund. The fund is lumens the Council
 * has already voted to works, so building takes work and not a citizen's
 * purse — exactly as the tram and the monument do. Returns false when the
 * fund is short, which is the Council's problem and the Chronicle's story.
 */
export function fundKeep(world: World): boolean {
  if (keepBuilt(world)) return false;
  const fund = Math.max(0, Math.round(world.government.publicWorksFund ?? 0));
  if (fund < KEEP_COST) return false;
  world.government.publicWorksFund = fund - KEEP_COST;
  world.counters[KEEP_BUILT_KEY] = world.day;
  delete world.counters[KEEP_OBLIGATION_KEY];
  const where = keepDistrict(world);
  emit(world, 'jail', `The Keep is built: ${KEEP_CELLS} places, ${KEEP_COST} ℓ of public works, `
    + `in ${world.districts[where]?.name ?? where}. Long terms are served there now.`, [], 0.8,
  { cost: KEEP_COST, cells: KEEP_CELLS, district: where });
  for (const c of jailedCitizens(world)) {
    if (!belongsInKeep(world, c.id)) continue;
    c.district = where;
    remember(world, c.id, 'event', 'You were moved from the cells at the Watch House to the Keep.');
  }
  return true;
}

/**
 * The answer to "the cells are full, let one out". There is no arrangement of
 * the city's problems that makes this a reason.
 */
export function releaseForSpace(world: World, cId: CitizenId): ActionResult {
  const name = world.citizens[cId]?.name ?? cId;
  return fail(`No. Crowding is not a reason to release ${name}: the Council is obliged to fund the Keep, `
    + 'and until it does the city holds who it holds.');
}

// ---------------------------------------------------------------------------
// Taking into custody
// ---------------------------------------------------------------------------

export interface CustodySpec {
  citizenId: CitizenId;
  caseId: CaseId;
  /** The term in days; ignored when `life` is set. */
  days?: number;
  life?: boolean;
  /** The offence, when it is one of the nine. */
  code?: string;
  /** A restraining order in favour of the victim. */
  victimId?: CitizenId | null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Put a citizen in custody. The term is served in a cell at the Watch House,
 * or in the Keep when it is long enough and the city has one. The job, the
 * home, the household, the office and the standing are not touched: custody is
 * a state, not a standing, and the sentence ends.
 *
 * Reverie does not put children in cells. A child answers to whoever is
 * raising them, and the city says so out loud.
 */
export function takeIntoCustody(world: World, spec: CustodySpec): CustodyRecord | null {
  const c = world.citizens[spec.citizenId];
  if (!c || c.standing === 'exiled' || !world.order.includes(c.id)) return null;
  const life = spec.life === true;
  const term = life ? LIFE_TERM_DAYS : Math.max(1, Math.round(Number.isFinite(spec.days) ? (spec.days as number) : 1));
  const code = isPersonCode(spec.code ?? null) ? (spec.code as PersonCode) : null;

  if (c.lifeStage === 'child') {
    emit(world, 'jail', `The Court did not take ${c.name} into custody: Reverie does not jail its children.`,
      [c.id], 0.4, { caseId: spec.caseId, child: true });
    remember(world, c.id, 'verdict',
      `The Court did not take you into custody (case ${spec.caseId}); the city does not jail children.`);
    return null;
  }

  const until = world.day + term;
  const already = c.jailedUntilDay ?? null;
  const wasLife = isLifeTerm(world, c.id);
  c.jailedUntilDay = already !== null ? Math.max(already, until) : until;
  world.counters[caseKey(c.id)] = caseNumber(spec.caseId);
  world.counters[startKey(c.id)] = world.day;
  world.counters[termKey(c.id)] = Math.max(term, wasLife ? LIFE_TERM_DAYS : Math.round(world.counters[termKey(c.id)] ?? 0));
  if (code) world.counters[codeKey(c.id)] = PERSON_CODES.indexOf(code) + 1;
  if (life || wasLife) world.counters[lifeKey(c.id)] = 1;

  // Detention was the wait for a verdict; the verdict has come.
  c.detainedUntilTick = null;
  c.shiftsToday = Math.max(c.shiftsToday, world.config.maxShiftsPerDay);
  // A household does not lose its home because one of its members is inside.
  c.rentArrearsDays = 0;

  const keep = belongsInKeep(world, c.id) && keepBuilt(world);
  c.district = keep ? keepDistrict(world) : JAIL_DISTRICT;
  const where = keep ? 'the Keep' : 'the cells at the Watch House';
  const how = life ? 'for life' : `for ${plural(term, 'day')}`;

  if (code && world.counters[restrainKey(c.id, spec.victimId ?? '')] === undefined && spec.victimId
    && personLaw(code).restrainingOrder) {
    world.counters[restrainKey(c.id, spec.victimId)] = world.day;
  }

  emit(world, 'jail', `${c.name} was taken to ${where} ${how} (case ${spec.caseId}).`, [c.id],
    life ? 0.9 : 0.6, { caseId: spec.caseId, days: life ? null : term, life, code, until: c.jailedUntilDay });
  remember(world, c.id, 'verdict', `You were taken to ${where} ${how} (case ${spec.caseId}).`
    + (life ? ' The Council reviews a life term every two cycles.' : ` You are out on day ${c.jailedUntilDay}.`)
    + ' You may write, send a letter, study, work in custody, appeal, ask for parole and receive visits.');
  tellNeighbours(world, c.id, `${c.name} was taken to ${where}.`);
  return custodyOf(world, c.id);
}

/**
 * The whole of a Track II sentence in one call: work out the days from the
 * band and the harm, record the conviction, and take the citizen into custody.
 * It returns the term it passed, and it never — under any record, any harm and
 * any number of priors — reaches exile.
 */
export function sentenceToCustody(
  world: World,
  spec: { citizenId: CitizenId; caseId: CaseId; code: string; harm: Harm | number; victimId?: CitizenId | null },
  factors: CustodyFactors = {},
): CustodyTerm {
  const priors = factors.priorCustodial ?? custodialConvictions(world, spec.citizenId);
  const term = custodyTerm(spec.code, spec.harm, { ...factors, priorCustodial: priors }, world);
  imposeCustody(world, {
    id: spec.caseId, defendantId: spec.citizenId, law: spec.code, victimId: spec.victimId ?? null, amount: 0,
  }, term);
  return term;
}

/**
 * Carry a term out, once it has been worked out: the record of the custodial
 * conviction, the Chronicle's account of the arithmetic, the cell, and the
 * restraining order the code calls for. Split from `sentenceToCustody` so that
 * the Court can compute a sentence at the verdict and carry out *that* term
 * rather than a freshly recomputed one.
 */
export function imposeCustody(world: World, k: TriedCase, term: CustodyTerm): CustodyRecord | null {
  const c = world.citizens[k.defendantId];
  // A band whose floor is zero can end at zero: P01 and P02 at no measured
  // harm are *often a restraining order instead* (`docs/JUSTICE.md` §2), and a
  // sentence of no days is exactly that. The order is made, the conviction is
  // recorded, and nobody is put in a cell for a term the Court did not pass.
  const noCell = !term.life && term.days <= 0;
  if (c) {
    recordCustodialConviction(world, k.defendantId);
    const law = personLaw(term.code);
    const passed = noCell
      ? `a restraining order and no term at all${term.restrainingOrder ? '' : ', on no measured harm'}`
      : describeCustodyTerm(term);
    emit(world, 'sentence', `The Court sentenced ${c.name} to ${passed} for `
      + `${law.name.toLowerCase()} (${term.steps.join('; ')}).`, [c.id], term.life ? 0.9 : noCell ? 0.4 : 0.6,
    { caseId: k.id, code: law.code, days: term.life ? null : term.days, life: term.life, harm: term.harm,
      track: 'person' });
    remember(world, k.defendantId, 'verdict',
      `Your sentence in case ${k.id}: ${passed} for ${law.name.toLowerCase()}. `
      + `${term.steps.join('; ')}. No fine is asked of you and no purse can shorten it.`);
    if (k.victimId && world.citizens[k.victimId]) {
      remember(world, k.victimId, 'verdict',
        `The Court sentenced ${c.name} to ${passed} for what they did to you (case ${k.id}).`);
    }
  }
  const record = noCell ? null : takeIntoCustody(world, {
    citizenId: k.defendantId, caseId: k.id, days: term.days, life: term.life,
    code: term.code, victimId: k.victimId ?? null,
  });
  if (term.restrainingOrder && k.victimId) makeRestrainingOrder(world, k.defendantId, k.victimId);
  return record;
}

/**
 * **Where the two tracks meet, third crossing** (`docs/JUSTICE.md` §4.3).
 *
 * Defying custody escalates custody. An offence committed inside, a broken
 * parole condition, a term walked out of: the answer is more days, and it is
 * *only* ever more days. It never converts into exile, it never becomes a
 * rung of the civic ladder, and no record of defiance is a strike toward the
 * Gate. `days` defaults to half of whatever is left, never less than one.
 */
export function defyCustody(world: World, cId: CitizenId, what: string, days?: number): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isJailed(c)) return fail(`${c.name} is not in custody.`);
  if (isLifeTerm(world, cId)) {
    remember(world, cId, 'verdict', `You defied custody (${what}). A life term has nothing left to add to it.`);
    return ok(`${c.name} is serving life; the term cannot be lengthened.`);
  }
  const left = Math.max(0, (c.jailedUntilDay ?? world.day) - world.day);
  const extra = Math.max(1, Math.round(Number.isFinite(days) ? (days as number) : left / 2));
  c.jailedUntilDay = (c.jailedUntilDay ?? world.day) + extra;
  world.counters[termKey(cId)] = Math.round(world.counters[termKey(cId)] ?? left) + extra;
  emit(world, 'jail', `${c.name} defied custody (${what}); the term grew by ${plural(extra, 'day')}. `
    + 'Custody answers defiance with custody and with nothing else.', [cId], 0.6,
  { prisoner: cId, added: extra, reason: what, until: c.jailedUntilDay });
  remember(world, cId, 'verdict', `You defied custody (${what}). ${plural(extra, 'day')} were added; you are out on `
    + `day ${c.jailedUntilDay}. Nothing about this can exile you.`);
  return ok(`${plural(extra, 'day')} were added to ${c.name}'s term.`);
}

/**
 * The term a tried case stands for on Track II: the band, the harm read off
 * the record, and the mitigation the defendant actually earned. Pure
 * arithmetic — the Court calls it at the verdict, and `imposeCustody` carries
 * out what it returned.
 */
export function sentenceTermFor(world: World, k: TriedCase, factors: CustodyFactors = {}): CustodyTerm {
  const settled = k.amount > 0 && world.counters[`restitutionPaid:${k.id}`] !== undefined;
  return custodyTerm(k.law, harmOfCase(world, k), {
    priorCustodial: custodialConvictions(world, k.defendantId),
    advocate: (k.advocacy ?? 0) > 0,
    plea: pleadedGuilty(world, k.id),
    restitution: settled,
    ...factors,
  }, world);
}

// ---------------------------------------------------------------------------
// From a charge to a term
// ---------------------------------------------------------------------------

/**
 * What the Court needs from a case to sentence it on this track. A `Case`
 * satisfies it as it stands, so the sitting can hand its own record straight
 * over the moment `Case.law` can hold a personal code.
 */
export interface TriedCase {
  id: CaseId;
  defendantId: CitizenId;
  law: string;
  victimId: CitizenId | null;
  amount: number;
  /** What an advocate's speech was worth (`government/advocates.ts`). */
  advocacy?: number;
}

/** Is this charge answered by custody rather than by the ladder? */
export function isCustodialCase(k: { law: string }): boolean {
  return isPersonCode(k.law);
}

/** Where a guilty plea is recorded, so the bench can see it was entered in time. */
function pleaKey(caseId: CaseId): string { return `plea:${caseId}`; }

/**
 * Plead guilty. It is worth a fifth off the term, and only if it is entered
 * **before the bench sits** — the discount is for sparing the Court and the
 * victim the trial, so a plea offered after the evidence has been heard buys
 * nothing.
 */
export function pleadGuilty(world: World, cId: CitizenId, caseId: CaseId, sitting = false): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const k = world.cases[caseId];
  if (k && k.defendantId !== cId) return fail('That is not your case.');
  if (world.counters[pleaKey(caseId)] !== undefined) return fail('You have already pleaded.');
  const inSession = sitting || (k ? k.status !== 'pending' : false);
  if (inSession) return fail('The bench is already sitting; a plea now is not a plea in time.');
  world.counters[pleaKey(caseId)] = world.day;
  emit(world, 'charge', `${c.name} pleaded guilty in case ${caseId} before the bench sat.`, [cId], 0.4,
    { caseId, defendant: cId });
  remember(world, cId, 'verdict', `You pleaded guilty in case ${caseId} before the Court sat.`);
  return ok('You pleaded guilty.');
}

/** Did the defendant plead guilty in time? */
export function pleadedGuilty(world: World, caseId: CaseId): boolean {
  return world.counters[pleaKey(caseId)] !== undefined;
}

/**
 * The harm in a case, read off the public record: the lumens handed over under
 * threat, how long the victim has carried the injury, how far their needs were
 * knocked down, and whether they were a child or an elder. A caller who
 * measured the harm as it happened should pass its own `Harm` instead — this
 * is what the city can still see afterwards.
 */
export function harmOfCase(world: World, k: TriedCase): Harm {
  const victim = k.victimId ? world.citizens[k.victimId] : null;
  if (!victim) return { lumens: Math.max(0, Math.round(k.amount)) };
  const since = victim.health?.sinceDay ?? null;
  return {
    lumens: Math.max(0, Math.round(k.amount)),
    injuryDays: victim.health?.glitched && since !== null ? Math.max(0, world.day - since) : 0,
    needsDamage: Math.max(0, 70 - Math.round(victim.mood)),
    vulnerableVictim: victim.lifeStage === 'child' || victim.lifeStage === 'elder',
  };
}

/**
 * Sentence a tried case on Track II: the harm read off the record, the
 * mitigation read off what the defendant actually did — an advocate who spoke,
 * a plea in time, a victim made whole before the sentence — and the term
 * carried out. Null when the charge is not a personal offence, which is the
 * ladder's business and not this file's.
 */
export function sentenceCaseToCustody(world: World, k: TriedCase, factors: CustodyFactors = {}): CustodyTerm | null {
  if (!isCustodialCase(k)) return null;
  const term = sentenceTermFor(world, k, factors);
  imposeCustody(world, k, term);
  return term;
}

/**
 * The old civic call, kept so that a caller with a plain number of days and a
 * case still works. It carries no personal code, so nothing about it counts as
 * a custodial conviction on Track II.
 */
export function jailCitizen(world: World, cId: CitizenId, days: number, caseId: CaseId): void {
  takeIntoCustody(world, { citizenId: cId, caseId, days: Number.isFinite(days) ? days : 1 });
}

/** A restraining order: the city's record that this citizen keeps away from that one. */
export function makeRestrainingOrder(world: World, cId: CitizenId, victimId: CitizenId): void {
  if (!world.citizens[cId] || !world.citizens[victimId] || cId === victimId) return;
  if (world.counters[restrainKey(cId, victimId)] !== undefined) return;
  world.counters[restrainKey(cId, victimId)] = world.day;
  emit(world, 'law', `The Court made a restraining order: ${nameOf(world, cId)} keeps away from ${nameOf(world, victimId)}.`,
    [cId, victimId], 0.4, { subject: cId, protected: victimId });
  remember(world, victimId, 'verdict', `The Court made a restraining order in your favour against ${nameOf(world, cId)}.`);
  remember(world, cId, 'verdict', `The Court ordered you to keep away from ${nameOf(world, victimId)}.`);
}

/** Is there an order between these two? */
export function restrainedFrom(world: World, cId: CitizenId, victimId: CitizenId): boolean {
  return world.counters[restrainKey(cId, victimId)] !== undefined;
}

/** Open the cell. The term did the punishing; release takes nothing more. */
export function releaseFromJail(world: World, c: Citizen, reason: string): void {
  if (!isJailed(c)) return;
  c.jailedUntilDay = null;
  for (const key of [caseKey(c.id), codeKey(c.id), lifeKey(c.id), termKey(c.id), startKey(c.id), workedKey(c.id),
    `custody:kept:${c.id}`]) {
    delete world.counters[key];
  }
  clearParoleState(world, c.id);
  const why = (reason ?? '').trim() || 'the term is served';
  emit(world, 'jail', `${c.name} walked out of custody: ${why}.`, [c.id], 0.3, { reason: why });
  remember(world, c.id, 'verdict', `You were let out of custody: ${why}.`);
  tellNeighbours(world, c.id, `${c.name} is out of custody.`);
}

/** The same door, named for Track II. */
export function releaseFromCustody(world: World, c: Citizen, reason: string): void {
  releaseFromJail(world, c, reason);
}

// ---------------------------------------------------------------------------
// What a prisoner may do
// ---------------------------------------------------------------------------

/**
 * Whether an action is open to a citizen in custody. Everything on the
 * Charter's list is; everything that reaches the city's money, its ballots,
 * its offices or another person's skin is not.
 */
export function mayActInCustody(world: World, c: Citizen, actionType: string): boolean {
  if (!isJailed(c)) return true;
  if (CUSTODY_ALSO_ALLOWS.includes(actionType)) return true;
  if (actionType === 'visit') return false; // a prisoner is visited; they do not visit
  return (CUSTODY_ACTIONS as readonly string[]).includes(actionType);
}

/**
 * A day's labour in custody: a reduced wage, and the victim is paid first.
 * Whatever is left after restitution reaches the citizen, which is the point —
 * a term that pays nobody anything is a term that mends nothing.
 */
export function workInCustody(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isJailed(c)) return fail('You are not in custody.');
  if (world.counters[workedKey(cId)] === world.day) return fail('You have worked your shift in custody today.');
  world.counters[workedKey(cId)] = world.day;

  const gross = Math.max(1, Math.round(world.government.minWage * CUSTODY_WAGE_SHARE));
  const owed = restitutionOwed(world, cId);
  const toVictim = Math.min(gross, owed.amount);
  let paid = 0;
  if (toVictim > 0 && owed.victimId
    && transfer(world, 'treasury', owed.victimId, toVictim, 'restitution', `restitution from ${c.name}'s labour in custody`)) {
    paid = toVictim;
    world.counters[paidKey(cId)] = (world.counters[paidKey(cId)] ?? 0) + paid;
    remember(world, owed.victimId, 'money', `${c.name} paid you ${paid} ℓ in restitution out of their labour in custody.`);
  }
  const rest = gross - paid;
  const wage = rest > 0 ? withholdingPay(world, 'treasury', cId, rest, 'wage', 'labour in custody') : { net: 0, tax: 0 };
  c.needs.purpose = clamp(c.needs.purpose + CUSTODY_WORK_PURPOSE, 0, 100);
  c.stats.shiftsWorked += 1;
  const note = paid > 0
    ? `${paid} ℓ went to ${nameOf(world, owed.victimId)} in restitution and ${wage.net} ℓ to you`
    : `${wage.net} ℓ`;
  remember(world, cId, 'work', `You worked a shift in custody: ${note}.`);
  return ok(`You worked a shift in custody: ${note}.`);
}

/** Note lumens that reached the victim, wherever they came from. */
export function creditRestitution(world: World, cId: CitizenId, amount: number): void {
  const paid = Math.max(0, Math.round(Number.isFinite(amount) ? amount : 0));
  if (paid <= 0) return;
  world.counters[paidKey(cId)] = (world.counters[paidKey(cId)] ?? 0) + paid;
}

/**
 * What is still owed to the victim of the offence somebody is held for — or
 * was held for, when they are out on parole and paying it off in instalments.
 */
export function restitutionOwed(world: World, cId: CitizenId): { victimId: CitizenId | null; amount: number } {
  const caseId = jailCaseOf(world, cId) ?? paroleCaseOf(world, cId);
  const k = caseId ? world.cases[caseId] : null;
  if (!k || !k.victimId || k.amount <= 0) return { victimId: null, amount: 0 };
  const victim = world.citizens[k.victimId];
  if (!victim || victim.standing === 'exiled') return { victimId: null, amount: 0 };
  const paid = Math.max(0, Math.round(world.counters[paidKey(cId)] ?? 0));
  return { victimId: k.victimId, amount: Math.max(0, Math.round(k.amount) - paid) };
}

/**
 * A visit from family or a friend. Nothing about custody takes a citizen's
 * people away from them — that is the difference between a term and exile.
 */
export function visitPrisoner(world: World, visitorId: CitizenId, prisonerId: CitizenId): ActionResult {
  const visitor = world.citizens[visitorId];
  const prisoner = world.citizens[prisonerId];
  if (!visitor || !prisoner) return fail('Nobody by that id is in Reverie.');
  if (visitorId === prisonerId) return fail('You cannot visit yourself.');
  if (!isJailed(prisoner)) return fail(`${prisoner.name} is not in custody.`);
  if (isJailed(visitor)) return fail('You are in custody yourself.');
  if (!isPresent(world, visitor)) return fail('You are not in the city.');
  if (visitor.district !== prisoner.district) {
    return fail(`${prisoner.name} is held in ${world.districts[prisoner.district]?.name ?? prisoner.district}, and you are not.`);
  }
  if (!areFamily(world, visitorId, prisonerId) && !areFriends(world, visitorId, prisonerId)) {
    return fail(`Custody is not a public gallery: ${prisoner.name} is visited by family and friends.`);
  }
  if (world.counters[visitKey(visitorId, prisonerId)] === world.day) return fail(`You have already visited ${prisoner.name} today.`);
  world.counters[visitKey(visitorId, prisonerId)] = world.day;

  visitor.needs.social = clamp(visitor.needs.social + VISIT_SOCIAL / 2, 0, 100);
  prisoner.needs.social = clamp(prisoner.needs.social + VISIT_SOCIAL, 0, 100);
  adjustBond(world, visitorId, prisonerId, VISIT_BOND);
  emit(world, 'social', `${visitor.name} visited ${prisoner.name} in custody.`, [visitorId, prisonerId], 0.2,
    { visitor: visitorId, prisoner: prisonerId });
  remember(world, prisonerId, 'social', `${visitor.name} came to see you.`);
  remember(world, visitorId, 'social', `You visited ${prisoner.name} in custody.`);
  return ok(`You visited ${prisoner.name}.`);
}

/**
 * The prisoners this citizen could go and see this hour: family and friends
 * held where the visitor is standing, whom they have not already visited
 * today. Custody is not exile — the difference is exactly this list — so the
 * observation carries it and `availableActions` offers `visit` from it.
 */
export function visitablePrisoners(world: World, visitorId: CitizenId): Citizen[] {
  const visitor = world.citizens[visitorId];
  if (!visitor || isJailed(visitor) || !isPresent(world, visitor)) return [];
  const out: Citizen[] = [];
  for (const prisoner of jailedCitizens(world)) {
    if (prisoner.id === visitorId || prisoner.district !== visitor.district) continue;
    if (!areFamily(world, visitorId, prisoner.id) && !areFriends(world, visitorId, prisoner.id)) continue;
    out.push(prisoner);
  }
  return out;
}

/** Has this citizen already been to see that prisoner today? */
export function visitedToday(world: World, visitorId: CitizenId, prisonerId: CitizenId): boolean {
  return world.counters[visitKey(visitorId, prisonerId)] === world.day;
}

/** True once today's shift in custody has been worked. */
export function workedInCustodyToday(world: World, cId: CitizenId): boolean {
  return world.counters[workedKey(cId)] === world.day;
}

/** Lumens of restitution the victim of the offence somebody is held for has had. */
export function restitutionPaidInCustody(world: World, cId: CitizenId): number {
  return Math.max(0, Math.round(world.counters[paidKey(cId)] ?? 0));
}

// ---------------------------------------------------------------------------
// The keep of a prisoner, and of the people who depend on them
// ---------------------------------------------------------------------------

/** The people a prisoner leaves behind who cannot keep themselves. */
export function custodyDependants(world: World, prisoner: Citizen): Citizen[] {
  const out: Citizen[] = [];
  const seen = new Set<CitizenId>([prisoner.id]);
  const household = householdOf(world, prisoner.id);
  const candidates: Citizen[] = household ? membersOf(world, household) : [];
  for (const id of [...prisoner.family.children, prisoner.family.partnerId ?? '']) {
    const kin = world.citizens[id];
    if (kin) candidates.push(kin);
  }
  for (const kin of candidates) {
    if (seen.has(kin.id)) continue;
    seen.add(kin.id);
    if (!isPresent(world, kin)) continue;
    if (hardshipOf(world, kin) === null) continue;
    out.push(kin);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The city took the earner, so the city carries the household: everyone in it
 * who falls below the hardship line is a claimant of the Community Chest for
 * as long as the term runs (`society/chest.ts` pays them in the same morning's
 * round, ten lumens each while the pot lasts). Custody does not pay a second
 * stipend on top — it makes sure the household is counted, and says so once,
 * out loud, so that a term nobody else notices is still a household the city
 * can see.
 */
function noteDependants(world: World, prisoner: Citizen): void {
  const dependants = custodyDependants(world, prisoner);
  const key = `custody:kept:${prisoner.id}`;
  if (dependants.length === 0 || world.counters[key] !== undefined) return;
  world.counters[key] = world.day;
  emit(world, 'jail', `${prisoner.name} is in custody; the Community Chest carries `
    + `${dependants.map((d) => d.name).join(' and ')} while the term runs.`,
  [prisoner.id, ...dependants.map((d) => d.id)], 0.4,
  { prisoner: prisoner.id, dependants: dependants.map((d) => d.id), stipend: STIPEND });
  for (const dependant of dependants) {
    remember(world, dependant.id, 'family',
      `${prisoner.name} is in custody. The Community Chest keeps you while the term runs, and the home is yours.`);
  }
}

/** The Watch House feeds and beds whoever it holds. Nobody starves in a cell. */
function ration(c: Citizen): void {
  c.needs.energy = Math.max(c.needs.energy, RATION_FLOOR);
  c.needs.rest = Math.max(c.needs.rest, RATION_FLOOR);
}

/**
 * The crowding: a mood penalty on everyone held over the city's room, the
 * Council's obligation recorded, and the story in the Chronicle every single
 * day it lasts. No cell opens because of it.
 */
function crowding(world: World): void {
  const held = jailedCitizens(world);
  const capacity = custodyCapacity(world);
  const noKeep = heldWithoutAKeep(world);
  const over = held.length > capacity;
  if (!over && noKeep.length === 0) {
    delete world.counters[KEEP_OBLIGATION_KEY];
    return;
  }
  if (world.counters[KEEP_OBLIGATION_KEY] === undefined) world.counters[KEEP_OBLIGATION_KEY] = world.day;

  for (const c of held) {
    if (over) c.needs.comfort = clamp(c.needs.comfort - CROWDING_COMFORT, 0, 100);
    else if (noKeep.includes(c)) c.needs.comfort = clamp(c.needs.comfort - NO_KEEP_COMFORT, 0, 100);
  }

  // The Charter says the Council *shall* fund the Keep. When the works fund
  // holds the money, the obligation is discharged; when it does not, the city
  // is told again, and told again tomorrow.
  if (fundKeep(world)) return;

  if (world.counters[CROWDING_STORY_KEY] === world.day) return;
  world.counters[CROWDING_STORY_KEY] = world.day;
  const since = keepObligation(world) ?? world.day;
  const days = Math.max(1, world.day - since + 1);
  emit(world, 'jail', over
    ? `The city is holding ${held.length} in ${capacity} ${capacity === 1 ? 'place' : 'places'}. `
      + `Nobody has been let out for room, and nobody will be: the Council has owed Reverie a Keep for ${plural(days, 'day')}.`
    : `${plural(noKeep.length, 'prisoner')} serving long terms ${noKeep.length === 1 ? 'is' : 'are'} held in the cells `
      + `at the Watch House because the city has no Keep. The Council has owed Reverie one for ${plural(days, 'day')}.`,
  held.map((c) => c.id), 0.8, { held: held.length, capacity, days, fund: world.government.publicWorksFund });
}

/**
 * The morning roll.
 *
 * Terms that are up are served and the doors open. Parole applications are
 * heard, life terms are put to the Council on their day, the crowding is
 * counted and printed, and the households of the people the city is holding
 * are kept. Nobody, at any point in this function, is released because the
 * city is short of room.
 */
export function dailyJail(world: World): void {
  for (const c of jailedCitizens(world)) {
    if ((c.jailedUntilDay ?? 0) > world.day) continue;
    if (isLifeTerm(world, c.id)) continue;
    releaseFromJail(world, c, 'the term is served');
  }

  dailyParole(world);

  for (const c of jailedCitizens(world)) {
    ration(c);
    c.rentArrearsDays = 0;
    noteDependants(world, c);
  }
  crowding(world);
  dailyErasure(world);

  // A cell nobody is in should not be remembered as occupied.
  for (const key of Object.keys(world.counters)) {
    if (!key.startsWith('jailCase:')) continue;
    const id = key.slice('jailCase:'.length);
    if (!isJailed(world.citizens[id])) delete world.counters[key];
  }
}

/** The same roll, named for the track it belongs to. */
export function dailyCustody(world: World): void {
  dailyJail(world);
}

// ---------------------------------------------------------------------------
// The roll
// ---------------------------------------------------------------------------

export interface JailEntry {
  id: CitizenId;
  name: string;
  until: number;
  caseId: CaseId | null;
  /** The offence, when it is one of the nine. */
  code: PersonCode | null;
  life: boolean;
  where: 'watch house' | 'keep';
}

/** The custody roll, as the Chronicle and the dashboard print it. */
export function jailRoster(world: World): JailEntry[] {
  return jailedCitizens(world)
    .map((c) => {
      const record = custodyOf(world, c.id);
      return {
        id: c.id,
        name: c.name,
        until: c.jailedUntilDay ?? world.day,
        caseId: record?.caseId ?? null,
        code: record?.code ?? null,
        life: record?.life ?? false,
        where: record?.where ?? 'watch house',
      };
    })
    .sort((a, b) => a.until - b.until || a.id.localeCompare(b.id));
}

/** The same roll, named for the track it belongs to. */
export function custodyRoster(world: World): JailEntry[] {
  return jailRoster(world);
}

/**
 * Re-exported where the rest of the government can find it: the Charter's flat
 * refusal to exile anybody convicted of an offence against a person.
 */
export { exileForbidden } from './custody.ts';
