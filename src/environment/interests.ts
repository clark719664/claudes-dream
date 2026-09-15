/**
 * The corruption that follows zoning, and how it is proved
 * (`docs/ENVIRONMENT.md` §5).
 *
 * The property register and the roll of votes are both public and both
 * permanent. **That is the entire detection mechanism.** The morning a zoning
 * proposal passes, this file reads one against the other: every councillor who
 * voted aye, what they and their household hold in that district or one beside
 * it, and what the vote just did to the price of it.
 *
 * - A proven gain above 200 ℓ with no declaration filed leaves a **trace** on
 *   the same channel `government/investigations.ts` already reads, law **L11**,
 *   abuse of office. Unlike a theft's trace, this one never decays: the
 *   register still says what they own and the roll how they voted, ten cycles
 *   later.
 * - Failing to declare with no proven gain is **L47**, severity 3, and it goes
 *   before the Watch like anything else.
 *
 * The escape is honest and it costs: `declare_interest` files the holding and
 * abstains — no trace, no offence, the Chronicle prints the declaration, and
 * the councillor has given up their vote on the question they know most about.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, CitizenId, DistrictId, Proposal, PropertyUnit, World,
} from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { districtName, fail, isPresent, ok } from '../actions/common.ts';
import { adjacentDistricts } from '../data/city.ts';
import { isOpen } from '../world/growth.ts';
import { CITY_PRICE_CLASS, LAND_MAX, LAND_MIN, LAND_WEIGHTS, landReadings, recomputeLand } from '../economy/land.ts';
import { MIN_PRICE, PRICE_MULTIPLE } from '../markets/property.ts';
import { householdOf } from '../society/households.ts';
import { noteAbuseOfOffice } from '../government/investigations.ts';
import { PERMIT_PREMIUM, UNDECLARED_INTEREST, environmentState } from './state.ts';
import type { Permit } from './state.ts';
import { chargeEnvironmentOffence } from './offences.ts';

/** A gain above this, undeclared, is abuse of office and not a slip. */
export const GAIN_THRESHOLD = 200;
/** The gain that makes a trace as loud as a trace ever gets. */
export const GAIN_FOR_FULL_TRACE = 3000;
export const TRACE_MIN = 0.30;
export const TRACE_MAX = 0.95;
/** Property bought this close to the tabling counts double. */
export const RECENT_PURCHASE_DAYS = 14;

// ---------------------------------------------------------------------------
// What a vote does to a price
// ---------------------------------------------------------------------------

/**
 * The land values the city would read if these districts' amenity moved by
 * these amounts — the same arithmetic `economy/land.ts` runs every morning,
 * asked one day early. Nothing is written: this only answers a question.
 */
export function valuesWithAmenityShift(
  world: World, shift: Partial<Record<DistrictId, number>>,
): Record<string, number> {
  let readings = landReadings(world);
  let rows = Object.values(readings).filter((r) => isOpen(world, r.district));
  // A world just loaded from a save carries only the mirrored value, not the
  // itemised reading it was struck from; ask for a fresh one.
  if (rows.length === 0 || rows.every((r) => r.raw === 0)) {
    readings = recomputeLand(world);
    rows = Object.values(readings).filter((r) => isOpen(world, r.district));
  }
  const raws = new Map<string, number>();
  for (const r of rows) raws.set(r.district, Math.max(0, r.raw + LAND_WEIGHTS.amenity * (shift[r.district] ?? 0)));
  const mean = rows.length > 0
    ? [...raws.values()].reduce((sum, v) => sum + v, 0) / rows.length
    : 0;
  const out: Record<string, number> = {};
  for (const r of rows) {
    const raw = raws.get(r.district) ?? 0;
    const normalised = mean > 0 ? raw / mean : 1;
    out[r.district] = clamp(normalised * r.scarcity, LAND_MIN, LAND_MAX);
  }
  return out;
}

/** What a unit sells for at a given land value (`PROPERTY.md` §2). */
export function priceAtValue(unit: PropertyUnit, landValue: number): number {
  const rent = Math.max(0, Math.round(unit.rent));
  const premium = (0.8 + 0.4 * landValue) * CITY_PRICE_CLASS;
  return Math.max(MIN_PRICE, Math.round(PRICE_MULTIPLE * rent * premium));
}

/** The district a unit stands in. */
function districtOfUnit(world: World, u: PropertyUnit): DistrictId | null {
  return world.buildings[u.buildingId]?.district ?? null;
}

/** The district itself and everything beside it: where a rezoning is felt. */
export function zoneAndNeighbours(d: DistrictId): DistrictId[] {
  return [d, ...adjacentDistricts(d)];
}

/**
 * What a citizen and their household hold in a district or one beside it. A
 * household's holdings count because a deed in a partner's name is still a
 * pocket the vote pays into.
 */
export function holdingsNear(world: World, cId: CitizenId, d: DistrictId): PropertyUnit[] {
  const household = householdOf(world, cId);
  const owners = new Set<string>([cId, ...(household?.members ?? [])]);
  const near = new Set<string>(zoneAndNeighbours(d));
  return Object.values(world.property ?? {})
    .filter((u) => owners.has(String(u.ownerId)))
    .filter((u) => {
      const at = districtOfUnit(world, u);
      return at !== null && near.has(at);
    });
}

/** Whether this citizen or their household bought property close to the tabling. */
export function boughtRecently(world: World, cId: CitizenId, tabledDay: number): boolean {
  const household = householdOf(world, cId);
  const buyers = new Set<string>([cId, ...(household?.members ?? [])]);
  const from = Math.max(0, tabledDay - RECENT_PURCHASE_DAYS) * 24;
  for (const row of world.treasury.ledger) {
    if (row.kind !== 'property') continue;
    if (row.tick < from) continue;
    if (Math.floor(row.tick / 24) > tabledDay + 1) continue;
    if (buyers.has(String(row.from))) return true;
  }
  return false;
}

/**
 * What a rezoning is worth to one councillor: the price of everything they and
 * their household hold in the district or beside it, before and after, with
 * anything bought within a fortnight of the tabling counted double.
 */
export function zoningGain(
  world: World, cId: CitizenId, d: DistrictId, was: Permit, now: Permit, tabledDay: number,
): number {
  const units = holdingsNear(world, cId, d);
  if (units.length === 0) return 0;
  const before = valuesWithAmenityShift(world, { [d]: PERMIT_PREMIUM[was] });
  const after = valuesWithAmenityShift(world, { [d]: PERMIT_PREMIUM[now] });
  let gain = 0;
  for (const u of units) {
    const at = districtOfUnit(world, u);
    if (!at) continue;
    gain += priceAtValue(u, after[at] ?? 1) - priceAtValue(u, before[at] ?? 1);
  }
  return Math.round(gain * (boughtRecently(world, cId, tabledDay) ? 2 : 1));
}

// ---------------------------------------------------------------------------
// Declaring
// ---------------------------------------------------------------------------

/** Councillors who have filed an interest on a question. */
export function declarationsOn(world: World, proposalId: string): CitizenId[] {
  return environmentState(world).declarations[proposalId] ?? [];
}

export function hasDeclared(world: World, proposalId: string, cId: CitizenId): boolean {
  return declarationsOn(world, proposalId).includes(cId);
}

/**
 * `declare_interest` — a councillor files the property they hold and abstains.
 * The abstention is entered on the roll as a vote that is not an aye, so
 * nobody's mind is made up for them at the session, and the Chronicle prints
 * the declaration.
 */
export function declareInterest(world: World, cId: CitizenId, proposalId: string): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const p = world.government.proposals.find((x) => x.id === proposalId);
  if (!p) return fail('There is no such proposal.');
  if (p.status !== 'open') return fail(`Proposal ${p.id} has already been decided.`);
  const q = environmentState(world).zoning[p.id];
  if (!q || (q.kind !== 'zone' && q.kind !== 'conserve')) {
    return fail('An interest is declared on a zoning question; that proposal is not one.');
  }
  if (hasDeclared(world, p.id, cId)) return fail('You have already declared your interest on that question.');
  const d = q.district;
  const units = d ? holdingsNear(world, cId, d) : [];
  const s = environmentState(world);
  s.declarations[p.id] ??= [];
  s.declarations[p.id].push(cId);
  p.votes[cId] = false;
  const where = d ? districtName(world, d) : 'the city';
  const holding = units.length === 1 ? 'one holding' : `${units.length} holdings`;
  emit(world, 'proposal',
    `${c.name} declared an interest in ${where} — ${holding} on the register — and abstained on ${p.id}.`,
    [cId], 0.6, { proposalId: p.id, district: d, holdings: units.length, declared: true });
  remember(world, cId, 'civic',
    `You declared your interest in ${where} (${holding}) and gave up your vote on ${p.id}.`);
  return ok(`Your interest in ${where} is on the record and you have abstained on ${p.id}.`);
}

// ---------------------------------------------------------------------------
// Reading the register against the roll
// ---------------------------------------------------------------------------

export interface ZoningInterest {
  councillorId: CitizenId;
  gain: number;
  holdings: number;
  declared: boolean;
  /** The weight of the trace left, where one was left. */
  trace: number | null;
  /** The code the city answered it with, where it answered. */
  code: string | null;
}

/**
 * The morning a zoning question passes: every aye read against the register.
 * Returns what it found, so a test and the dashboard can both read it.
 */
export function settleZoningInterests(
  world: World, p: Proposal, d: DistrictId, was: Permit, now: Permit,
): ZoningInterest[] {
  const found: ZoningInterest[] = [];
  if (PERMIT_PREMIUM[was] === PERMIT_PREMIUM[now]) return found;
  const q = environmentState(world).zoning[p.id];
  const tabledDay = q?.tabledDay ?? p.tabledDay;
  const ayes = Object.entries(p.votes).filter(([, aye]) => aye === true).map(([id]) => id);
  for (const councillorId of ayes) {
    const c = world.citizens[councillorId];
    if (!c) continue;
    const holdings = holdingsNear(world, councillorId, d).length;
    if (holdings === 0) continue;
    // A declaration is an abstention. A councillor who filed one and voted aye
    // anyway did not abstain, and the roll — not the filing — is what the
    // register is read against.
    const declared = hasDeclared(world, p.id, councillorId);
    const gain = zoningGain(world, councillorId, d, was, now, tabledDay);
    if (gain > GAIN_THRESHOLD) {
      const trace = clamp(gain / GAIN_FOR_FULL_TRACE, TRACE_MIN, TRACE_MAX);
      noteAbuseOfOffice(world, councillorId,
        `voted to zone ${districtName(world, d)} ${now.replace(/_/g, ' ')} while holding ${holdings} `
        + `${holdings === 1 ? 'address' : 'addresses'} there worth ${gain} ℓ more for it, and declared nothing`);
      emit(world, 'property',
        `${c.name} voted for ${p.id} holding ${holdings} ${holdings === 1 ? 'address' : 'addresses'} in or beside `
        + `${districtName(world, d)}; the register says the vote moved ${gain} ℓ into their household, and no declaration was filed.`,
        [councillorId], 0.8, { proposalId: p.id, district: d, gain, holdings, law: 'L11', trace });
      found.push({ councillorId, gain, holdings, declared, trace, code: 'L11' });
      continue;
    }
    chargeEnvironmentOffence(world, councillorId, UNDECLARED_INTEREST, {
      proved: true,
      amount: Math.max(0, gain),
      description: `${c.name} voted on ${p.id}, which moved land in ${districtName(world, d)} that their household holds, `
        + 'and filed no declaration',
    });
    found.push({ councillorId, gain, holdings, declared, trace: null, code: UNDECLARED_INTEREST });
  }
  return found;
}
