/**
 * Who leads a house, and what happens when there is nobody left to
 * (`docs/GENERATIONS.md` §4).
 *
 * The head is chosen by **the family's own rule**, fixed at founding and
 * amendable by four-fifths of the adults: `eldest`, `chosen` (whoever the
 * sitting head named, effective at their sunset), `assent` (elected by the
 * adults with `house_vote`) or `founder_line` (the eldest living descendant of
 * the founder in the direct line, reverting to `eldest` when the line fails).
 * The engine applies the rule the family wrote and picks a head on no ground
 * of its own. A head in custody cannot act for the house, so the members carry
 * an **acting head** for the term.
 *
 * **A house survives its members.** When the last adult goes it falls dormant:
 * the holdings are held by the Exchange, the levy keeps accruing, the record is
 * kept forever, and any citizen who can show descent in the Hall's tree may
 * revive it with `claim_house` — taking the holdings, the arrears and the stain
 * together. A claim the tree does not bear out is L44, and it leaves a trace
 * like any other offence.
 */
import type { ActionResult, Citizen, CitizenId, HappeningKind, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { addHappening } from '../society/calendar.ts';
import { formatLumens } from '../economy/treasury.ts';
import { isPresent } from '../citizens/citizen.ts';
import { isJailed } from '../government/jail.ts';
import { commitOffence } from '../government/watch.ts';
import type { House } from './state.ts';
import { GENERATIONS_LAWS, generationsLaw, generationsState } from './state.ts';
import {
  DESCENT_DEPTH, houseAdults, houseById, houseFor, houseHeaded, houseMembers, isAdult, setFamilyName,
} from './houses.ts';

/** Where a house gathers when it takes a new head, and when. */
export const INVESTITURE_VENUE = 'exchange';
export const INVESTITURE_HOUR = 19;
/** `investiture` is this layer's happening; the calendar carries it like any other. */
export const INVESTITURE_KIND = 'investiture' as unknown as HappeningKind;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

// ---------------------------------------------------------------------------
// The head
// ---------------------------------------------------------------------------

function oldest(candidates: Citizen[]): Citizen | null {
  return [...candidates].sort((a, b) => (a.bornDay ?? 0) - (b.bornDay ?? 0) || a.id.localeCompare(b.id, 'en'))[0] ?? null;
}

/** The eldest living adult descendant of the founder, in the direct line. */
export function founderLine(world: World, h: House): Citizen | null {
  const adults = new Map(houseAdults(world, h).map((c) => [c.id, c]));
  const line: Citizen[] = [];
  let front: CitizenId[] = [h.founderId];
  const seen = new Set<CitizenId>(front);
  for (let depth = 0; depth <= DESCENT_DEPTH; depth++) {
    const next: CitizenId[] = [];
    for (const id of front) {
      const c = world.citizens[id];
      const living = adults.get(id);
      if (living && id !== h.founderId) line.push(living);
      for (const childId of c?.family?.children ?? []) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        next.push(childId);
      }
    }
    if (line.length > 0) return oldest(line);
    if (next.length === 0) break;
    front = next;
  }
  const founder = adults.get(h.founderId);
  return founder ?? null;
}

/** Who the adults have voted for under the `assent` rule, most votes first. */
export function headVoteTally(world: World, h: House): { candidateId: CitizenId; votes: number }[] {
  const cast = generationsState(world).headVotes[h.id] ?? {};
  const adults = new Set(houseAdults(world, h).map((c) => c.id));
  const tally = new Map<CitizenId, number>();
  for (const [voter, candidate] of Object.entries(cast)) {
    if (!adults.has(voter) || !adults.has(candidate)) continue;
    tally.set(candidate, (tally.get(candidate) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([candidateId, votes]) => ({ candidateId, votes }))
    .sort((a, b) => b.votes - a.votes || a.candidateId.localeCompare(b.candidateId, 'en'));
}

/** Who the family's own rule says leads them, read fresh. */
export function ruleSaysHead(world: World, h: House): CitizenId | null {
  const adults = houseAdults(world, h);
  if (adults.length === 0) return null;
  switch (h.rule) {
    case 'chosen': {
      const named = h.successorId ? adults.find((c) => c.id === h.successorId) ?? null : null;
      const sitting = h.headId ? adults.find((c) => c.id === h.headId) ?? null : null;
      // A successor takes over at the sitting head's sunset, and not before.
      if (sitting) return sitting.id;
      return (named ?? oldest(adults))?.id ?? null;
    }
    case 'assent': {
      const tally = headVoteTally(world, h);
      if (tally.length > 0) return tally[0].candidateId;
      const sitting = h.headId ? adults.find((c) => c.id === h.headId) ?? null : null;
      return (sitting ?? oldest(adults))?.id ?? null;
    }
    case 'founder_line': {
      const heir = founderLine(world, h);
      return (heir ?? oldest(adults))?.id ?? null;
    }
    case 'eldest':
    default:
      return oldest(adults)?.id ?? null;
  }
}

/** Put a new head in, and tell the city: an investiture is a public act. */
export function investHead(world: World, h: House, cId: CitizenId, why: string): void {
  const c = world.citizens[cId];
  if (!c || h.headId === cId) return;
  const term = h.heads.find((t) => t.citizenId === h.headId && t.toDay === null);
  if (term) term.toDay = world.day;
  h.headId = cId;
  h.actingHeadId = null;
  h.heads.push({ citizenId: cId, fromDay: world.day, toDay: null, acting: false });
  if (h.successorId === cId) h.successorId = null;
  const gathering = addHappening(world, {
    kind: INVESTITURE_KIND, day: world.day, hour: INVESTITURE_HOUR, buildingId: INVESTITURE_VENUE,
    who: [cId], label: `the investiture of ${c.name} as head of the house of ${h.name}`,
  });
  emit(world, 'household', `${c.name} ${h.name} is head of the house of ${h.name} (${why}).`,
    houseAdults(world, h).map((a) => a.id), 0.5, { houseId: h.id, headId: cId, rule: h.rule, happeningId: gathering.id });
  for (const m of houseMembers(world, h)) {
    remember(world, m.id, 'family', m.id === cId
      ? `You are head of the house of ${h.name} (${why}).`
      : `${c.name} is head of the house of ${h.name} (${why}).`);
  }
}

/**
 * The morning's reading of the rule: a head who has gone, sunset, been exiled
 * or renounced the name is replaced by whoever the family's own rule names,
 * and a head in custody is carried by an acting head until they are out.
 */
export function refreshHead(world: World, h: House): void {
  if (h.dormantDay !== null) return;
  const adults = houseAdults(world, h);
  const sitting = h.headId ? world.citizens[h.headId] : null;
  const gone = !sitting || !isPresent(world, sitting) || sitting.familyName !== h.name;
  if (gone) {
    if (h.headId) {
      const term = h.heads.find((t) => t.citizenId === h.headId && t.toDay === null);
      if (term) term.toDay = world.day;
      h.headId = null;
    }
    const next = h.rule === 'chosen' && h.successorId && adults.some((a) => a.id === h.successorId)
      ? h.successorId
      : ruleSaysHead(world, h);
    if (next) investHead(world, h, next, h.rule === 'chosen' && next === h.successorId ? 'named by the last head' : `the ${h.rule} rule`);
    return;
  }
  // A head in custody cannot act for the house; the members carry one for the term.
  if (isJailed(sitting)) {
    const tally = headVoteTally(world, h).filter((t) => t.candidateId !== sitting.id);
    const chosen = tally[0]?.candidateId ?? oldest(adults.filter((a) => a.id !== sitting.id))?.id ?? null;
    if (chosen && h.actingHeadId !== chosen) {
      h.actingHeadId = chosen;
      h.heads.push({ citizenId: chosen, fromDay: world.day, toDay: null, acting: true });
      const c = world.citizens[chosen];
      emit(world, 'household', `${c?.name ?? 'A member'} acts for the house of ${h.name} while ${sitting.name} is in custody.`,
        adults.map((a) => a.id), 0.4, { houseId: h.id, actingHeadId: chosen });
    }
    return;
  }
  if (h.actingHeadId) {
    const term = h.heads.find((t) => t.citizenId === h.actingHeadId && t.acting && t.toDay === null);
    if (term) term.toDay = world.day;
    h.actingHeadId = null;
  }
  // The rule is read afresh every morning, and it may have named somebody else:
  // an older adult has joined the name, the founder's line has come of age, the
  // adults have voted. **`chosen` is the exception** — a named successor takes
  // over at the sitting head's sunset and not one day sooner, which is the whole
  // difference between naming an heir and being replaced by one.
  if (h.rule !== 'chosen') {
    const says = ruleSaysHead(world, h);
    if (says && says !== h.headId) investHead(world, h, says, `the ${h.rule} rule`);
  }
}

/** Name the next head, under the `chosen` rule. Effective at the sitting head's sunset. */
export function nameSuccessor(world: World, cId: CitizenId, toId: CitizenId): ActionResult {
  const h = houseHeaded(world, cId);
  if (!h) return fail('Only the head of a house may name a successor.');
  if (h.rule !== 'chosen') return fail(`The ${h.name}s choose their head by the ${h.rule} rule; a head names no successor.`);
  const to = world.citizens[toId];
  if (!to || !isPresent(world, to)) return fail('Unknown citizen.');
  if (to.familyName !== h.name) return fail(`${to.name} is not of the ${h.name}s.`);
  if (!isAdult(to)) return fail('A child cannot be named head.');
  h.successorId = toId;
  emit(world, 'household', `The head of the house of ${h.name} named ${to.name} as the next.`,
    [cId, toId], 0.4, { houseId: h.id, successorId: toId });
  remember(world, toId, 'family', `You were named the next head of the house of ${h.name}.`);
  return ok(`${to.name} will take the house of ${h.name} after you.`);
}

/** Vote for the head, under the `assent` rule. One adult, one vote, public and changeable. */
export function houseVote(world: World, cId: CitizenId, candidateId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const h = houseFor(world, cId);
  if (!h) return fail('You are not of a founded house.');
  if (h.rule !== 'assent') return fail(`The ${h.name}s choose their head by the ${h.rule} rule.`);
  if (!isAdult(c) || !isPresent(world, c)) return fail('Only the adults of the house elect its head.');
  const candidate = world.citizens[candidateId];
  if (!candidate || candidate.familyName !== h.name || !isAdult(candidate) || !isPresent(world, candidate)) {
    return fail('The head is elected from the adults of the house.');
  }
  const s = generationsState(world);
  s.headVotes[h.id] ??= {};
  s.headVotes[h.id][cId] = candidateId;
  const tally = headVoteTally(world, h);
  emit(world, 'vote', `${c.name} voted for ${candidate.name} to head the house of ${h.name}.`, [cId, candidateId], 0.2,
    { houseId: h.id, candidateId });
  return ok(`You voted for ${candidate.name} (${tally.find((t) => t.candidateId === candidateId)?.votes ?? 1} of ${houseAdults(world, h).length}).`);
}

// ---------------------------------------------------------------------------
// Dormancy, and the claim that ends it
// ---------------------------------------------------------------------------

/** The last adult has gone: the house sleeps, and the Exchange holds what it held. */
export function goDormant(world: World, h: House): void {
  if (h.dormantDay !== null) return;
  h.dormantDay = world.day;
  if (h.headId) {
    const term = h.heads.find((t) => t.citizenId === h.headId && t.toDay === null);
    if (term) term.toDay = world.day;
  }
  h.headId = null;
  h.actingHeadId = null;
  emit(world, 'household', `The house of ${h.name} went dormant with the last of its adults gone; the Exchange holds ${h.units.length} entailed ${h.units.length === 1 ? 'property' : 'properties'} and its treasury, and the levy runs on.`,
    [], 0.6, { houseId: h.id, name: h.name, units: h.units.length });
}

/** Everybody who ever carried the name, for a claim of descent. */
function everBorne(world: World, name: string): Citizen[] {
  return Object.values(world.citizens).filter((c) => c.familyName === name);
}

/**
 * Can this citizen show descent from the house in the Hall's tree? Any
 * ancestor who carried the name will do — the tree keeps the exiled, the
 * departed, the sunset and the erased, so a lineage never goes missing.
 */
export function showsDescent(world: World, cId: CitizenId, h: House): boolean {
  const bearers = new Set<CitizenId>(everBorne(world, h.name).map((c) => c.id));
  bearers.add(h.founderId);
  for (const term of h.heads) bearers.add(term.citizenId);
  const start = world.citizens[cId];
  if (!start) return false;
  if (bearers.has(cId)) return true;
  let front: CitizenId[] = [...(start.family?.parents ?? [])];
  const seen = new Set<CitizenId>(front);
  for (let depth = 0; depth < DESCENT_DEPTH; depth++) {
    if (front.length === 0) return false;
    const next: CitizenId[] = [];
    for (const id of front) {
      if (bearers.has(id)) return true;
      for (const p of world.citizens[id]?.family?.parents ?? []) {
        if (seen.has(p)) continue;
        seen.add(p);
        next.push(p);
      }
    }
    front = next;
  }
  return false;
}

/**
 * Revive a dormant house by descent, taking the holdings, the arrears and the
 * stain together — the whole of it, or none of it. A claim the tree does not
 * bear out is a false claim of descent (L44) and leaves a trace like any other
 * offence: the Hall holds the tree, and the arithmetic does not match.
 */
export function claimHouse(world: World, cId: CitizenId, houseId: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('Only a citizen living in Reverie may claim a house.');
  if (!isAdult(c)) return fail('A child cannot claim a house.');
  const h = houseById(world, houseId);
  if (!h) return fail('There is no such house on the roll.');
  if (h.dormantDay === null) return fail(`The house of ${h.name} is not dormant: it has adults of its own.`);

  if (!showsDescent(world, cId, h)) {
    const { detected } = commitOffence(world, cId, generationsLaw(GENERATIONS_LAWS.falseClaimOfDescent), {
      visibilityMod: 0.2,
    });
    emit(world, 'household', `${c.name} claimed the dormant house of ${h.name} and the Hall's tree does not bear it out.`,
      [cId], 0.5, { houseId: h.id, citizenId: cId, law: GENERATIONS_LAWS.falseClaimOfDescent });
    return {
      ok: false,
      message: `The Hall of Records shows no descent from the ${h.name}s. A false claim of descent is an offence.`,
      offence: generationsLaw(GENERATIONS_LAWS.falseClaimOfDescent),
      detected,
    };
  }

  const was = c.familyName;
  setFamilyName(world, c, h.name);
  h.dormantDay = null;
  h.revivedDays.push(world.day);
  if (!h.admitted.includes(cId)) h.admitted.push(cId);
  h.renounced = h.renounced.filter((id) => id !== cId);
  investHead(world, h, cId, 'revived the house by descent');
  emit(world, 'household', `${c.name} ${was} showed descent and revived the house of ${h.name}, taking its holdings, its arrears of ${formatLumens(Math.round(h.levyArrears))} and its stain together.`,
    [cId], 0.7, { houseId: h.id, citizenId: cId, arrears: Math.round(h.levyArrears) });
  remember(world, cId, 'family', `You revived the house of ${h.name}: its ${h.units.length} entailed ${h.units.length === 1 ? 'property' : 'properties'}, its arrears of ${formatLumens(Math.round(h.levyArrears))} and its name are yours now.`);
  return ok(`The house of ${h.name} is awake, and you are its head.`);
}