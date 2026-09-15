/**
 * Matches: a marriage settlement between two founded houses
 * (`docs/GENERATIONS.md` §4).
 *
 * `offer_match` from one head, `accept_match` from the other. The dowry moves
 * through the ledger, the terms are a public instrument, and a live feud
 * between the two names ends with it — **the dowry is what reconciliation now
 * costs**.
 *
 * And then nothing else happens, which is the point. **The wedding is the
 * ordinary one**: the couple still have to want it, `marry` still needs seven
 * days as partners and a bond above 75, and **no head marries anybody off**. A
 * settlement between houses is two heads agreeing what they will do if two of
 * their people choose each other; it is not a promise either of those people
 * made, and nothing in this file can make one for them (`PRINCIPLES.md` §2).
 */
import type { ActionResult, CitizenId, Feud, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens } from '../economy/treasury.ts';
import { moveThroughBox } from '../finance/box.ts';
import { feudBetween } from '../social/feuds.ts';
import type { House, MatchOffer } from './state.ts';
import { generationsKind, generationsState, nextGenerationsId } from './state.ts';
import { houseAdults, houseById, houseHeaded, houseMembers } from './houses.ts';
import { houseTreasury, unitById } from './entail.ts';

/** An offer nobody answers lapses, like every other offer at the Exchange. */
export const MATCH_LAPSE_DAYS = 2;
export const MAX_TERMS = 280;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

export function matchById(world: World, offerId: string): MatchOffer | null {
  return generationsState(world).matches[offerId] ?? null;
}

/** Every match this house has offered or been offered, newest first. */
export function matchesOf(world: World, h: House): MatchOffer[] {
  return Object.values(generationsState(world).matches)
    .filter((m) => m.fromHouseId === h.id || m.toHouseId === h.id)
    .sort((a, b) => b.day - a.day || a.id.localeCompare(b.id, 'en'));
}

export function openMatchesFor(world: World, h: House): MatchOffer[] {
  return matchesOf(world, h).filter((m) => m.status === 'open');
}

export interface MatchSpec {
  house: string;
  dowry?: number;
  /** A named property conveyed instead of, or beside, the lumens. */
  unit?: string | null;
  terms?: string;
}

/**
 * Offer a match. Only a head may offer one, only for what the house actually
 * holds, and the whole instrument is public from the hour it is made.
 */
export function offerMatch(world: World, cId: CitizenId, spec: MatchSpec): ActionResult {
  const from = houseHeaded(world, cId);
  if (!from) return fail('Only the head of a house may offer a match.');
  if (from.dormantDay !== null) return fail(`The house of ${from.name} is dormant.`);
  const to = houseById(world, spec.house) ?? Object.values(generationsState(world).houses).find((h) => h.name === spec.house) ?? null;
  if (!to) return fail('There is no such house on the roll.');
  if (to.id === from.id) return fail('A house does not settle a match with itself.');
  if (to.dormantDay !== null) return fail(`The house of ${to.name} is dormant.`);

  const dowry = Number.isFinite(spec.dowry) ? Math.max(0, Math.round(spec.dowry as number)) : 0;
  if (dowry > houseTreasury(world, from)) {
    return fail(`The house of ${from.name} holds ${formatLumens(houseTreasury(world, from))}.`);
  }
  const unitId = spec.unit && from.units.includes(spec.unit) ? spec.unit : null;
  if (spec.unit && !unitId) return fail('That property is not in your house\'s entail.');
  if (dowry <= 0 && !unitId) return fail('A settlement carries a dowry: lumens, a property, or both.');

  const offer: MatchOffer = {
    id: nextGenerationsId(world, 'mt'),
    fromHouseId: from.id,
    toHouseId: to.id,
    offeredBy: cId,
    dowry,
    unitId,
    terms: (spec.terms ?? '').trim().slice(0, MAX_TERMS),
    day: world.day,
    status: 'open',
    acceptedBy: null,
    decidedDay: null,
  };
  generationsState(world).matches[offer.id] = offer;
  const what = `${dowry > 0 ? formatLumens(dowry) : ''}${dowry > 0 && unitId ? ' and ' : ''}${unitId ? 'a property' : ''}`;
  emit(world, 'household', `The house of ${from.name} offered the house of ${to.name} a match: ${what}${offer.terms ? `, on terms — ${offer.terms}` : ''}.`,
    [cId, ...(to.headId ? [to.headId] : [])], 0.6, { offerId: offer.id, from: from.id, to: to.id, dowry });
  for (const m of houseMembers(world, to)) {
    remember(world, m.id, 'family', `The house of ${from.name} has offered the ${to.name}s a match: ${what}. The couple still have to want it.`);
  }
  return ok(`Your offer to the house of ${to.name} is public (${offer.id}).`);
}

/** Clear the incident tally the two names have run up, the way `social/feuds.ts` does. */
function clearFeudTally(world: World, a: string, b: string): void {
  const key = a < b ? `feud:${a}|${b}:` : `feud:${b}|${a}:`;
  for (const held of Object.keys(world.counters)) {
    if (held.startsWith(key)) delete world.counters[held];
  }
}

/** A settlement between feuding names ends the feud outright. */
function settleFeud(world: World, from: House, to: House): Feud | null {
  const feud = feudBetween(world, from.name, to.name);
  if (!feud) return null;
  feud.endedDay = world.day;
  feud.incidents = 0;
  clearFeudTally(world, from.name, to.name);
  const actors = [...houseMembers(world, from), ...houseMembers(world, to)].map((c) => c.id);
  emit(world, 'feud', `The ${from.name}s and the ${to.name}s settled a match, and the feud between them is over.`,
    actors, 0.8, { families: feud.families, ended: true });
  for (const id of actors) {
    remember(world, id, 'family', `A match was settled between the ${from.name}s and the ${to.name}s, and the feud is over.`);
  }
  return feud;
}

/**
 * Take the terms. The dowry moves, the property is conveyed from one entail to
 * the other, the feud (if there was one) ends, and two families are as bound
 * as two families can be without anybody having promised anything.
 */
export function acceptMatch(world: World, cId: CitizenId, offerId: string): ActionResult {
  const offer = matchById(world, offerId);
  if (!offer || offer.status !== 'open') return fail('There is no such offer before you.');
  const s = generationsState(world);
  const from = s.houses[offer.fromHouseId];
  const to = s.houses[offer.toHouseId];
  if (!from || !to) return fail('One of the houses is no longer on the roll.');
  const head = houseHeaded(world, cId);
  if (!head || head.id !== to.id) return fail(`Only the head of the house of ${to.name} may accept it.`);

  const dowry = Math.min(offer.dowry, houseTreasury(world, from));
  if (dowry > 0 && !moveThroughBox(world, from.boxId, to.boxId, dowry, generationsKind('dowry'), `dowry of the ${from.name}s to the ${to.name}s`)) {
    return fail('The dowry could not be paid.');
  }
  if (offer.unitId && from.units.includes(offer.unitId)) {
    const u = unitById(world, offer.unitId);
    if (u) {
      from.units = from.units.filter((id) => id !== offer.unitId);
      to.units.push(offer.unitId);
      u.ownerId = to.boxId;
    }
  }
  offer.status = 'accepted';
  offer.acceptedBy = cId;
  offer.decidedDay = world.day;
  settleFeud(world, from, to);

  const actors = [...houseAdults(world, from), ...houseAdults(world, to)].map((c) => c.id);
  emit(world, 'household', `The ${to.name}s accepted the ${from.name}s' match: ${dowry > 0 ? formatLumens(dowry) : 'no lumens'}${offer.unitId ? ' and a property' : ''} settled${offer.terms ? `, on terms — ${offer.terms}` : ''}. The wedding is the couple's own to want.`,
    actors, 0.7, { offerId: offer.id, dowry, unitId: offer.unitId });
  for (const id of actors) {
    remember(world, id, 'family', `The houses of ${from.name} and ${to.name} have settled a match. Nobody is married off by it: the couple still have to want it.`);
  }
  return ok(`The match is settled. ${dowry > 0 ? `${formatLumens(dowry)} came into the house treasury. ` : ''}No wedding follows unless two people choose it.`);
}

/** Decline an offer made to you, or withdraw your own. */
export function closeMatch(world: World, cId: CitizenId, offerId: string): ActionResult {
  const offer = matchById(world, offerId);
  if (!offer || offer.status !== 'open') return fail('There is no such offer.');
  const head = houseHeaded(world, cId);
  if (!head || (head.id !== offer.fromHouseId && head.id !== offer.toHouseId)) {
    return fail('That offer is not yours to close.');
  }
  offer.status = 'declined';
  offer.decidedDay = world.day;
  const s = generationsState(world);
  emit(world, 'household', `The match between the ${s.houses[offer.fromHouseId]?.name ?? 'one house'}s and the ${s.houses[offer.toHouseId]?.name ?? 'another'}s was closed.`,
    [cId], 0.3, { offerId });
  return ok('The offer is closed.');
}

/** The morning: an offer nobody answered in two days lapses. */
export function dailyMatches(world: World): void {
  const s = generationsState(world);
  for (const offer of Object.values(s.matches)) {
    if (offer.status !== 'open') continue;
    if (world.day - offer.day < MATCH_LAPSE_DAYS) continue;
    offer.status = 'lapsed';
    offer.decidedDay = world.day;
    emit(world, 'household', `The ${s.houses[offer.fromHouseId]?.name ?? 'a house'}s' offer of a match lapsed unanswered.`,
      [offer.offeredBy], 0.2, { offerId: offer.id });
  }
}
