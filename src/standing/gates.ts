/**
 * The gates — who a city will have (`docs/CITIZENSHIP.md` §2).
 *
 * Every city in the Expanse sets two thresholds, what it asks of a **visitor**
 * and what it asks for **residency**, and each has its own relief for a
 * shortfall: a purse, an examination, a resident's name, or a toll at the
 * door. Those are ordinary law — written into a founding charter and amendable
 * by whatever procedure that city uses — so the mechanism here takes all four
 * kinds and the table below seats only the numbers Reverie actually has.
 *
 * Reverie asks **380** to walk its streets and **440** to call it home, and one
 * resident vouching covers a shortfall of up to **50**. When the Expanse is
 * built, the other five cities are five more rows in `GATES`.
 *
 * Two rules belong to the whole Expanse rather than to any one city, and they
 * are applied here for every gate:
 *
 * - **A child is never tested.** A child born in a city is a resident of it
 *   and on coming of age receives the baseline.
 * - **A city that takes you takes your family, within reason:** a resident's
 *   partner and children are judged at a household allowance of 60.
 *
 * A refusal always states its reasons, in public and in full, because a gate
 * that will not say why is a gate nobody can climb.
 */
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { isJailed } from '../government/jail.ts';
import { reputeOf } from './repute.ts';
import type { ObservedGate, Sponsorship } from './state.ts';
import { standingState } from './state.ts';

/** The one city there is, until the Expanse is built. */
export const HOME_CITY = 'reverie';

export type ReliefKind = 'purchase' | 'examination' | 'sponsorship' | 'toll' | 'household';

/**
 * One way a city lets a shortfall be covered. `covers` is how much repute it
 * is worth; `cost` is lumens, `skill` a level, `sponsors` a number of
 * residents. A toll covers any shortfall at all — Marrowgate is open to anyone
 * who can pay it.
 */
export interface GateRelief {
  kind: ReliefKind;
  covers: number;
  cost?: number;
  skill?: number;
  sponsors?: number;
  /** How the city states it, in its own words. */
  note: string;
}

export interface CityGate {
  city: string;
  name: string;
  /** Visitors may trade, work gigs, socialise and watch. */
  visit: number;
  /** Residents may vote, stand for office, own a business, and be tried here. */
  reside: number;
  relief: GateRelief[];
}

/** What a resident's partner and children are allowed against any city's line. */
export const HOUSEHOLD_ALLOWANCE = 60;
/** What one Reverie resident's name is worth at Reverie's gate. */
export const REVERIE_SPONSORSHIP = 50;

/**
 * The gates the city knows about. Reverie's numbers are its founding charter's
 * and may be amended by ordinary law — `world.counters['gate:reverie:reside']`
 * carries an amendment when the Council makes one, and a line that rises never
 * costs a resident their home (`standing/notices.ts`).
 */
export const GATES: Record<string, CityGate> = {
  [HOME_CITY]: {
    city: HOME_CITY,
    name: 'Reverie',
    visit: 380,
    reside: 440,
    relief: [{
      kind: 'sponsorship',
      covers: REVERIE_SPONSORSHIP,
      sponsors: 1,
      note: 'one resident vouching covers a shortfall of up to 50',
    }],
  },
};

/** The gate of a named city, or Reverie's. */
export function gateOf(city: string = HOME_CITY): CityGate {
  return GATES[city] ?? GATES[HOME_CITY];
}

function amendment(world: World, city: string, which: 'visit' | 'reside'): number | null {
  const v = world.counters[`gate:${city}:${which}`];
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/** What a city asks of a visitor today. */
export function visitLine(world: World, city: string = HOME_CITY): number {
  return amendment(world, city, 'visit') ?? gateOf(city).visit;
}

/** What a city asks for residency today. */
export function residencyLine(world: World, city: string = HOME_CITY): number {
  return amendment(world, city, 'reside') ?? gateOf(city).reside;
}

// ---------------------------------------------------------------------------
// Vouching
// ---------------------------------------------------------------------------

/** A resident whose name counts at all: living here, of age, and not in a cell. */
export function maySponsorAnyone(world: World, s: Citizen): boolean {
  if (s.standing === 'exiled' || !world.order.includes(s.id)) return false;
  if (s.lifeStage === 'child') return false;
  return !isJailed(s);
}

/** A resident whose name still counts behind this particular applicant. */
export function maySponsor(world: World, s: Citizen, applicantId: CitizenId): boolean {
  return s.id !== applicantId && maySponsorAnyone(world, s);
}

/** Names standing behind an applicant at a city's gate, oldest first. */
export function sponsorshipsFor(world: World, cId: CitizenId, city: string = HOME_CITY): Sponsorship[] {
  return standingState(world).sponsorships.filter((k) => {
    if (k.citizenId !== cId || k.city !== city || k.spentOn !== null) return false;
    const backer = world.citizens[k.sponsorId];
    // A name only counts while the citizen behind it still stands here.
    return !!backer && maySponsor(world, backer, cId);
  });
}

/**
 * `sponsor { citizen, city }` — put your own name behind an applicant, at a
 * gate or at a residency hearing. It is the same public instrument in both
 * places, it is filed in the register under the sponsor's own name, and
 * nobody is asked to make it.
 */
export function sponsor(world: World, sponsorId: CitizenId, citizenId: CitizenId, city: string = HOME_CITY): ActionResult {
  const s = world.citizens[sponsorId];
  const applicant = world.citizens[citizenId];
  if (!s) return { ok: false, message: 'Unknown citizen.' };
  if (!applicant) return { ok: false, message: 'Nobody of that name is known to the Registry.' };
  if (!GATES[city]) return { ok: false, message: `Reverie's Registry keeps no gate for ${city}.` };
  if (sponsorId === citizenId) return { ok: false, message: 'You cannot put your own name behind yourself.' };
  if (!maySponsor(world, s, citizenId)) {
    return { ok: false, message: 'Only a resident of the city, of age and at liberty, may vouch for anyone.' };
  }
  const state = standingState(world);
  if (state.sponsorships.some((k) => k.sponsorId === sponsorId && k.citizenId === citizenId && k.city === city && k.spentOn === null)) {
    return { ok: false, message: `Your name already stands behind ${applicant.name} at ${gateOf(city).name}'s gate.` };
  }
  state.sponsorships.push({ sponsorId, citizenId, city, day: world.day, spentOn: null });
  emit(world, 'standing', `${s.name} vouched for ${applicant.name} at ${gateOf(city).name}'s gate.`,
    [sponsorId, citizenId], 0.4, { sponsor: sponsorId, citizen: citizenId, city });
  remember(world, citizenId, 'civic', `${s.name} put their name behind you at ${gateOf(city).name}'s gate.`);
  remember(world, sponsorId, 'civic', `You put your name behind ${applicant.name} at ${gateOf(city).name}'s gate.`);
  return { ok: true, message: `Your name stands behind ${applicant.name} at ${gateOf(city).name}'s gate.` };
}

/** The same instrument, under the name the city uses for it in conversation. */
export function vouch(world: World, sponsorId: CitizenId, citizenId: CitizenId, city: string = HOME_CITY): ActionResult {
  return sponsor(world, sponsorId, citizenId, city);
}

// ---------------------------------------------------------------------------
// The decision at the gate
// ---------------------------------------------------------------------------

export interface ReliefApplied {
  kind: ReliefKind;
  covers: number;
  note: string;
  /** The residents whose names were spent on it, when it was sponsorship. */
  from: CitizenId[];
}

export interface GateDecision {
  city: string;
  cityName: string;
  kind: 'visit' | 'reside';
  citizenId: CitizenId;
  repute: number;
  threshold: number;
  /** How far short the repute alone falls. */
  shortfall: number;
  /** What the city's own relief covers of it. */
  covered: number;
  relief: ReliefApplied[];
  admitted: boolean;
  /** What the gate says, whether it opens or not. Public, always. */
  reasons: string[];
}

/** Is this citizen the partner or child of somebody who lives here? */
export function inAResidentHousehold(world: World, c: Citizen): CitizenId | null {
  const kin = [c.family?.partnerId ?? null, ...(c.family?.parents ?? [])];
  for (const id of kin) {
    if (!id) continue;
    const other = world.citizens[id];
    if (other && other.standing !== 'exiled' && world.order.includes(id)) return id;
  }
  return null;
}

/** What one relief path is worth to this applicant today, or null when it is out of reach. */
function reliefFor(world: World, c: Citizen, r: GateRelief, city: string): ReliefApplied | null {
  switch (r.kind) {
    case 'sponsorship': {
      const names = sponsorshipsFor(world, c.id, city);
      const need = Math.max(1, r.sponsors ?? 1);
      if (names.length < need) return null;
      return { kind: r.kind, covers: r.covers, note: r.note, from: names.slice(0, need).map((s) => s.sponsorId) };
    }
    case 'purchase':
      if (c.wallet < (r.cost ?? 0)) return null;
      return { kind: r.kind, covers: r.covers, note: r.note, from: [] };
    case 'examination':
      if (!Object.values(c.skills).some((v) => v >= (r.skill ?? 100))) return null;
      return { kind: r.kind, covers: r.covers, note: r.note, from: [] };
    case 'toll':
      if (c.wallet < (r.cost ?? 0)) return null;
      return { kind: r.kind, covers: r.covers, note: r.note, from: [] };
    case 'household': {
      const kin = inAResidentHousehold(world, c);
      return kin ? { kind: r.kind, covers: r.covers, note: r.note, from: [kin] } : null;
    }
    default:
      return null;
  }
}

/** The household allowance every city in the Expanse grants, on top of its own relief. */
function householdRelief(): GateRelief {
  return {
    kind: 'household',
    covers: HOUSEHOLD_ALLOWANCE,
    note: `a resident's partner and children are allowed ${HOUSEHOLD_ALLOWANCE} against the line`,
  };
}

/**
 * What a gate would decide about a citizen today, and what it would say. This
 * is the whole of admission: the score, the line, the shortfall, the relief
 * that covers it, and the public reasons either way.
 */
export function gateDecision(world: World, cId: CitizenId, kind: 'visit' | 'reside', city: string = HOME_CITY): GateDecision {
  const gate = gateOf(city);
  const c = world.citizens[cId];
  const threshold = kind === 'visit' ? visitLine(world, city) : residencyLine(world, city);
  const base: GateDecision = {
    city: gate.city, cityName: gate.name, kind, citizenId: cId, repute: 0, threshold,
    shortfall: 0, covered: 0, relief: [], admitted: false, reasons: [],
  };
  if (!c) return { ...base, reasons: ['The Registry knows nobody of that name.'] };

  // A child born in a city is a resident of it and is never tested.
  if (c.lifeStage === 'child') {
    return {
      ...base, repute: reputeOf(world, cId), admitted: true,
      reasons: [`${gate.name} does not test children: a child born in a city is a resident of it.`],
    };
  }

  const repute = reputeOf(world, cId);
  const shortfall = Math.max(0, threshold - repute);
  const relief: ReliefApplied[] = [];
  let covered = 0;
  if (shortfall > 0) {
    for (const r of [...gate.relief, householdRelief()]) {
      if (covered >= shortfall) break;
      const applied = reliefFor(world, c, r, city);
      if (!applied) continue;
      relief.push(applied);
      covered += applied.covers;
    }
  }
  const admitted = shortfall <= covered;
  const asked = kind === 'visit' ? 'to walk its streets' : 'to call it home';
  const reasons: string[] = [];
  if (shortfall === 0) {
    reasons.push(`${gate.name} asks ${threshold} ${asked}; your repute is ${repute}.`);
  } else {
    reasons.push(`${gate.name} asks ${threshold} ${asked}; your repute is ${repute}, ${shortfall} short.`);
    for (const r of relief) reasons.push(`${r.note} — ${r.covers} covered.`);
    if (!admitted) {
      const left = shortfall - covered;
      reasons.push(`${left} of the shortfall is not covered, so the gate stays shut.`);
      for (const r of gate.relief) {
        if (relief.some((a) => a.kind === r.kind)) continue;
        reasons.push(`${gate.name}'s relief is open to you: ${r.note}.`);
      }
      reasons.push('Repute is not wealth: convictions decay with clean living, and contribution only ever rises.');
    }
  }
  return { ...base, repute, shortfall, covered, relief, admitted, reasons };
}

/** Would this citizen be admitted as a visitor today? */
export function admitsVisit(world: World, cId: CitizenId, city: string = HOME_CITY): boolean {
  return gateDecision(world, cId, 'visit', city).admitted;
}

/** Would this citizen be admitted as a resident today? */
export function admitsResidency(world: World, cId: CitizenId, city: string = HOME_CITY): boolean {
  return gateDecision(world, cId, 'reside', city).admitted;
}

/** Spend the names that covered a shortfall: a sponsorship is used once. */
export function spendRelief(world: World, decision: GateDecision, on: string): void {
  const state = standingState(world);
  for (const applied of decision.relief) {
    if (applied.kind !== 'sponsorship') continue;
    for (const sponsorId of applied.from) {
      const row = state.sponsorships.find((k) => k.sponsorId === sponsorId && k.citizenId === decision.citizenId
        && k.city === decision.city && k.spentOn === null);
      if (row) row.spentOn = on;
    }
  }
}

// ---------------------------------------------------------------------------
// What a citizen sees
// ---------------------------------------------------------------------------

/**
 * Every city a citizen knows of, its thresholds, and whether it would have
 * them today (`CITIZENSHIP.md` §5). Nothing here is secret: the same block can
 * be built about anybody.
 */
export function gatesObservation(world: World, cId: CitizenId): ObservedGate[] {
  const out: ObservedGate[] = [];
  for (const gate of Object.values(GATES)) {
    const visit = gateDecision(world, cId, 'visit', gate.city);
    const reside = gateDecision(world, cId, 'reside', gate.city);
    out.push({
      city: gate.city,
      name: gate.name,
      visit: visitLine(world, gate.city),
      reside: residencyLine(world, gate.city),
      admittedToVisit: visit.admitted,
      admittedToReside: reside.admitted,
      repute: reside.repute,
      shortfall: reside.shortfall,
      relief: [...gate.relief.map((r) => r.note), householdRelief().note],
      reasons: reside.reasons,
      yours: gate.city === HOME_CITY,
    });
  }
  return out;
}
