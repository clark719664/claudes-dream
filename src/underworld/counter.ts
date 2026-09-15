/**
 * The Watch turned inward (`docs/UNDERWORLD.md` §6).
 *
 * Counter-intelligence is the same detectives working the other way. There is
 * no separate force, no secret warrant and no file a citizen cannot read: an
 * assignment is **published the day it is made**, a sweep is a shift somebody
 * worked, and a decoy is a piece of paper that was never true.
 *
 * **This is the dangerous part of the layer and it is meant to be.**
 * Counter-intelligence and political policing are one action with a different
 * target, with nothing between them but a public assignment and a severity-4
 * offence: a Captain who puts detectives on a councillor's household has
 * committed **abuse of office (L11)**, and all that catches it is that every
 * assignment is public. Some Captain, in some city, will find that thin enough.
 *
 * What a detective actually does with an assignment is read arithmetic. A trace
 * left by a theft of a secret and a shelf selling under what a lawful crate
 * lands at are the same kind of evidence: public, dated, and accruing a little
 * every day until it is enough to put before an officer — who then decides,
 * because detection is a roll and prosecution is somebody's decision.
 */
import type { ActionResult, BuildingId, Citizen, CitizenId, World } from '../types.ts';
import { clamp } from '../types.ts';
import { PRODUCTS } from '../data/catalogue.ts';
import { emit, remember } from '../sim/events.ts';
import {
  CHARGE_EVIDENCE, EVIDENCE_PER_SHIFT, detectivesOnDuty, noteAbuseOfOffice, stillADetective,
} from '../government/investigations.ts';
import { detain, officersOnDuty } from '../government/watch.ts';
import { nextCourtTick } from '../government/cases.ts';
import { SUSPICION_THRESHOLD, landedCost, suspectShelves } from './prices.ts';
import { underworldQuestion } from './schedule.ts';
import { chargeUnderworldOffence } from './offences.ts';
import { warnBuilding } from './espionage.ts';
import type { Assignment, Decoy, EspionageTrace } from './state.ts';
import {
  CONTRABAND_POSSESSION, SECRETS, underworldId, underworldState, isGateBanned,
} from './state.ts';

/** The abuse an assignment on a politician is, when nothing whatever is behind it. */
export const ABUSE_OF_OFFICE = 'L11';
/** Days a gate ban stands after a council puts an agent out: one cycle. */
export const GATE_BAN_DAYS = 28;
/** The longest a claim may be. Papers are short. */
export const MAX_CLAIM = 140;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function shelfKey(businessId: string, productId: string): string {
  return `shelfEvidence:${businessId}:${productId}`;
}

/** Every assignment the Captain has not ended. */
export function liveAssignments(world: World): Assignment[] {
  return underworldState(world).assignments.filter((a) => a.endedDay === null);
}

/** The assignments on one detective. */
export function assignmentsOf(world: World, detectiveId: CitizenId): Assignment[] {
  return liveAssignments(world).filter((a) => a.detectiveId === detectiveId);
}

/** True where somebody is already looking at this citizen or this building. */
export function isAssigned(world: World, target: { building?: BuildingId; citizen?: CitizenId }): boolean {
  return liveAssignments(world).some((a) =>
    (target.building !== undefined && a.building === target.building)
    || (target.citizen !== undefined && a.citizenId === target.citizen));
}

/** An office holder, or somebody living in an office holder's household. */
function isPolitical(world: World, c: Citizen): boolean {
  if (c.office !== null && c.office !== 'watch') return true;
  if (!c.householdId) return false;
  for (const other of Object.values(world.citizens)) {
    if (other.householdId !== c.householdId) continue;
    if (other.office !== null && other.office !== 'watch') return true;
  }
  return false;
}

/** Anything at all the Watch holds against this citizen: an undetected act, or a charge. */
function hasCause(world: World, c: Citizen): boolean {
  if (c.recentOffences.length > 0) return true;
  return Object.values(world.cases).some((k) => k.defendantId === c.id && (k.status === 'pending' || k.status === 'in_session'));
}

/**
 * (the Captain) Publish an assignment. It is a decision, not a procedure: the
 * Captain chooses, the city is told the same day, and if the target is a
 * councillor's household with nothing whatever against them, the assignment is
 * itself the evidence of an offence.
 */
export function assignDetective(
  world: World, captainId: CitizenId, detectiveId: CitizenId, target: { building?: BuildingId; citizen?: CitizenId },
): ActionResult {
  const captain = world.citizens[captainId];
  if (!captain) return fail('Unknown citizen.');
  if (world.government.watchCaptainId !== captainId) return fail('Only the Captain of the Watch assigns detectives.');
  if (!stillADetective(world, detectiveId)) return fail('That citizen is not a detective of the Watch.');
  const building = target.building ?? null;
  const citizenId = target.citizen ?? null;
  if (!building && !citizenId) return fail('An assignment names a building or a citizen.');
  if (building && !world.buildings[building]) return fail('There is no such building.');
  const subject = citizenId ? world.citizens[citizenId] : null;
  if (citizenId && !subject) return fail('There is nobody by that name.');
  if (citizenId === detectiveId) return fail('A detective does not investigate themselves.');
  if (isAssigned(world, { ...(building ? { building } : {}), ...(citizenId ? { citizen: citizenId } : {}) })) {
    return fail('Somebody is already on that.');
  }

  const s = underworldState(world);
  const assignment: Assignment = {
    id: underworldId(world, 'as'), detectiveId, building, citizenId, byId: captainId, day: world.day, endedDay: null,
  };
  s.assignments.push(assignment);

  const what = building ? world.buildings[building]?.name ?? building : subject?.name ?? citizenId;
  emit(world, 'investigation', `Captain ${captain.name} assigned Detective ${world.citizens[detectiveId]?.name ?? detectiveId} to ${what}.`,
    citizenId ? [captainId, detectiveId, citizenId] : [captainId, detectiveId], 0.5, { assignment: assignment.id, building, citizen: citizenId });
  remember(world, detectiveId, 'civic', `Captain ${captain.name} put you on ${what} (${assignment.id}).`);
  if (subject) remember(world, citizenId as CitizenId, 'civic', `The Watch has put a detective on you (${assignment.id}). It was printed the day it was made.`);

  // The line between counter-intelligence and political policing is one public
  // fact, and this is it.
  if (subject && isPolitical(world, subject) && !hasCause(world, subject)) {
    noteAbuseOfOffice(world, captainId, `assigned a detective to ${subject.name}, who holds office and has nothing against them`);
    chargeUnderworldOffence(world, captainId, ABUSE_OF_OFFICE, {
      proved: true, victimId: subject.id,
      description: `Captain ${captain.name} put the Watch on ${subject.name}, who holds office, with nothing on the books against them`,
    });
  }
  return ok(`You assigned Detective ${world.citizens[detectiveId]?.name ?? detectiveId} to ${what}; the city was told today.`);
}

/**
 * `assign_detective { building | citizen }` as `REGISTRY.md` §3 writes it: the
 * Captain names the target and the Watch's own roster finds the detective —
 * whoever is on duty carrying the fewest files. The choice is still a citizen's
 * (the Captain's), and it is still printed the day it is made.
 */
export function assignFreeDetective(
  world: World, captainId: CitizenId, target: { building?: BuildingId; citizen?: CitizenId },
): ActionResult {
  const free = detectivesOnDuty(world)
    .filter((d) => d.id !== target.citizen)
    .sort((a, b) => assignmentsOf(world, a.id).length - assignmentsOf(world, b.id).length || a.id.localeCompare(b.id));
  if (free.length === 0) return fail('No detective of the Watch is on duty to take it.');
  return assignDetective(world, captainId, free[0].id, target);
}

/** End an assignment. The Captain's to make and the Captain's to end. */
export function endAssignment(world: World, captainId: CitizenId, assignmentId: string): ActionResult {
  const a = underworldState(world).assignments.find((x) => x.id === assignmentId);
  if (!a || a.endedDay !== null) return fail('There is no such assignment.');
  if (world.government.watchCaptainId !== captainId) return fail('Only the Captain of the Watch ends an assignment.');
  a.endedDay = world.day;
  return ok(`Assignment ${a.id} is ended.`);
}

// ---------------------------------------------------------------------------
// Sweeps and decoys
// ---------------------------------------------------------------------------

/** The traces still lying in a building. */
export function tracesIn(world: World, building: BuildingId): EspionageTrace[] {
  return underworldState(world).traces.filter((t) => t.building === building && t.clearedDay === null && t.reportId === null);
}

/**
 * (detectives) Clear the traces out of a room and warn it for a cycle. A swept
 * building is harder to take anything out of and holds nothing for the next
 * detective — which is the cost: a sweep protects the room and destroys the
 * evidence in it, and somebody has to choose.
 */
export function sweep(world: World, detectiveId: CitizenId, building: BuildingId): ActionResult {
  const detective = world.citizens[detectiveId];
  if (!detective) return fail('Unknown citizen.');
  if (!stillADetective(world, detectiveId)) return fail('Only a detective of the Watch sweeps a building.');
  const b = world.buildings[building];
  if (!b) return fail('There is no such building.');
  if (detective.district !== b.district) return fail(`${b.name} is not where you are standing.`);
  const traces = tracesIn(world, building);
  for (const t of traces) t.clearedDay = world.day;
  warnBuilding(world, building, `Detective ${detective.name} swept it`);
  emit(world, 'investigation', `Detective ${detective.name} swept ${b.name}${traces.length > 0 ? `, clearing ${traces.length} trace${traces.length === 1 ? '' : 's'}` : ''}.`,
    [detectiveId], 0.4, { building, cleared: traces.length });
  remember(world, detectiveId, 'civic', `You swept ${b.name}; ${traces.length} trace${traces.length === 1 ? ' was' : 's were'} cleared and the room is on its guard.`);
  return ok(`You swept ${b.name}. ${traces.length} trace${traces.length === 1 ? '' : 's'} cleared, and it is warned for a cycle.`);
}

/**
 * (detectives) Leave a decoy. The sharpest tool the Watch has: papers that were
 * never true, so that if the claim ever surfaces in another city's prices or a
 * rival's bid, the leak is **proved** rather than suspected.
 */
export function plantFalsePapers(world: World, detectiveId: CitizenId, building: BuildingId, claim: string): ActionResult {
  const detective = world.citizens[detectiveId];
  if (!detective) return fail('Unknown citizen.');
  if (!stillADetective(world, detectiveId)) return fail('Only a detective of the Watch plants papers.');
  const b = world.buildings[building];
  if (!b) return fail('There is no such building.');
  if (detective.district !== b.district) return fail(`${b.name} is not where you are standing.`);
  const words = (claim ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CLAIM);
  if (!words) return fail('A decoy says something.');
  const s = underworldState(world);
  if (s.decoys.some((d) => d.building === building && d.takenById === null)) return fail('There is already a decoy in that room.');
  const decoy: Decoy = {
    id: underworldId(world, 'dc'), building, byId: detectiveId, claim: words, day: world.day,
    takenById: null, provedDay: null,
  };
  s.decoys.push(decoy);
  emit(world, 'investigation', `Detective ${detective.name} left papers in ${b.name}. They are not true.`,
    [detectiveId], 0.4, { building, decoy: decoy.id });
  remember(world, detectiveId, 'civic', `You left a decoy in ${b.name}: "${words}". If it ever surfaces, the leak is proved.`);
  return ok(`You left the papers in ${b.name}.`);
}

// ---------------------------------------------------------------------------
// What an assignment actually does, a day at a time
// ---------------------------------------------------------------------------

/**
 * A detective's day on a building: the traces in it accrue evidence, and one
 * that reaches the Watch's own threshold becomes a report before an officer.
 * The report is `government/reports.ts`'s, the charge is an officer's decision,
 * and the ladder answers it. Nothing here punishes anybody.
 */
export function workTraces(world: World): number {
  let filed = 0;
  for (const a of liveAssignments(world)) {
    if (!a.building || !stillADetective(world, a.detectiveId)) continue;
    const detective = world.citizens[a.detectiveId];
    if (!detective) continue;
    for (const t of tracesIn(world, a.building)) {
      if (t.byId === a.detectiveId) continue;
      t.evidence = clamp(t.evidence + EVIDENCE_PER_SHIFT, 0, 1);
      if (t.evidence < CHARGE_EVIDENCE) continue;
      const taker = world.citizens[t.byId];
      if (!taker) { t.clearedDay = world.day; continue; }
      const spec = SECRETS[t.kind];
      const reportId = chargeUnderworldOffence(world, t.byId, t.law, {
        proved: true, corroboration: t.evidence - CHARGE_EVIDENCE, officerId: a.detectiveId,
        description: `Detective ${detective.name} worked the door, the hour and the one person present at `
          + `${world.buildings[t.building]?.name ?? t.building}: ${spec.name} left it in ${taker.name}'s hands`,
      });
      t.reportId = reportId;
      if (reportId) filed++;
    }
  }
  return filed;
}

/**
 * A detective's day on a shelf. **The price signal is itself the evidence**: a
 * shelf carrying smuggled stock undercuts what a lawful crate costs to land,
 * and both figures are public, so the arithmetic accrues on its own until there
 * is a case in it.
 */
export function workShelves(world: World): number {
  let raided = 0;
  const watchedBusinesses = new Set<string>();
  for (const a of liveAssignments(world)) {
    if (!stillADetective(world, a.detectiveId)) continue;
    for (const b of Object.values(world.businesses)) {
      if (b.dissolvedDay !== null) continue;
      if (a.building === b.buildingId || a.citizenId === b.ownerId) watchedBusinesses.add(`${b.id}:${a.detectiveId}`);
    }
  }
  for (const shelf of suspectShelves(world)) {
    for (const pair of watchedBusinesses) {
      const [businessId, detectiveId] = pair.split(':');
      if (businessId !== shelf.businessId) continue;
      const key = shelfKey(shelf.businessId, shelf.productId);
      const evidence = clamp((world.counters[key] ?? 0) + EVIDENCE_PER_SHIFT, 0, 1);
      world.counters[key] = evidence;
      if (evidence < CHARGE_EVIDENCE) continue;
      if (raidShelf(world, detectiveId, shelf.businessId, shelf.productId)) {
        delete world.counters[key];
        raided++;
      }
    }
  }
  return raided;
}

/**
 * Take a shelf's stock to the Bazaar and put the owner before the Watch. A
 * raid is a **happening**: it draws a crowd, and a crowd is witnesses.
 */
export function raidShelf(world: World, detectiveId: CitizenId, businessId: string, productId: string): boolean {
  const b = world.businesses[businessId];
  const entry = b?.shelf?.[productId];
  if (!b || !entry || entry.qty <= 0) return false;
  const owner = world.citizens[b.ownerId];
  if (!owner) return false;
  const product = PRODUCTS[productId];
  const qty = entry.qty;
  entry.qty = 0;
  world.emporium ??= {};
  world.emporium[productId] = (world.emporium[productId] ?? 0) + qty;

  const detective = world.citizens[detectiveId];
  emit(world, 'offence', `The Watch raided ${b.name} and took ${qty} ${product?.name ?? productId} off the shelf: `
    + `it was selling at ${entry.price} ℓ against the ${landedCost(world, productId)} ℓ a lawful one lands at.`,
  detective ? [detectiveId, owner.id] : [owner.id], 0.7, { businessId, productId, qty });
  chargeUnderworldOffence(world, owner.id, CONTRABAND_POSSESSION, {
    proved: true, amount: entry.price * qty, officerId: officersOnDuty(world)[0]?.id ?? null,
    description: `${b.name} held ${qty} ${product?.name ?? productId} at ${entry.price} ℓ, under what a lawful crate lands at`,
  });
  return true;
}

// ---------------------------------------------------------------------------
// What a council does with a caught agent (`UNDERWORLD.md` §6)
// ---------------------------------------------------------------------------

export type Disposition = 'try' | 'expel' | 'hold';

/**
 * A caught agent is a citizen of somewhere else, and what the host does is a
 * Council decision with a standing cost either way.
 *
 * - **Try them.** Espionage is L30 on the ladder, and severity 5 alone is never
 *   exile, so a first offence is the fine and a suspension. Nothing here files
 *   the charge — the Watch's report already exists and an officer files it;
 *   this only records that the Council chose the Court.
 * - **Expel them.** Cheap, and admits nothing: no trial, no conviction, no
 *   standing changed, and a gate ban of one cycle on the register every gate
 *   reads. It is **not exile** — nobody's property is taken, nobody's record is
 *   marked, and the ban runs out.
 * - **Hold them for exchange.** The Watch may detain a severity 4–5 charge
 *   until the Court sits, and no longer.
 */
export function spyDisposition(world: World, agentId: CitizenId, choice: Disposition): ActionResult {
  const agent = world.citizens[agentId];
  if (!agent) return fail('There is nobody by that name.');
  const s = underworldState(world);
  switch (choice) {
    case 'try':
      emit(world, 'law', `The Council put ${agent.name} before the Court rather than out through the gate.`,
        [agentId], 0.6, { disposition: 'try' });
      remember(world, agentId, 'civic', 'The Council decided you would be tried here, on the ladder, like anybody else.');
      return ok(`${agent.name} answers the charge before the Court.`);
    case 'expel': {
      if (isGateBanned(world, agentId)) return fail(`${agent.name} is already on the register.`);
      s.gateBans.push({
        citizenId: agentId, fromDay: world.day, untilDay: world.day + GATE_BAN_DAYS,
        reason: 'put out by the Council without trial',
      });
      emit(world, 'law', `The Council put ${agent.name} out without a trial; the gates hold their name for a cycle. `
        + 'Nothing was proved and nothing was admitted.', [agentId], 0.7, { disposition: 'expel', until: world.day + GATE_BAN_DAYS });
      remember(world, agentId, 'civic', `The Council put you out without trying you. The gates hold your name until day ${world.day + GATE_BAN_DAYS}. `
        + 'Your standing, your record and everything you own are untouched.');
      return ok(`${agent.name} is on the gate register until day ${world.day + GATE_BAN_DAYS}.`);
    }
    default:
      detain(world, agentId, nextCourtTick(world));
      emit(world, 'law', `The Council is holding ${agent.name} until the Court sits.`, [agentId], 0.6, { disposition: 'hold' });
      return ok(`${agent.name} is held until the Court sits.`);
  }
}

/** The three answers, in the order a Council's `spy_disposition` numbers them. */
export const DISPOSITIONS: readonly Disposition[] = ['try', 'expel', 'hold'];

/**
 * Carry out a `spy_disposition` the Council passed. It is the one question this
 * layer puts to a council that is not about goods: it names a citizen, and the
 * standing cost of every answer is the Expanse's to charge.
 */
export function enactSpyDisposition(world: World, proposalId: string): ActionResult {
  const q = underworldQuestion(world, proposalId);
  if (!q || q.kind !== 'spy_disposition') return fail('There is no such question before the Council.');
  if (q.settledDay !== null) return fail('That question has been answered.');
  if (!q.targetId) return fail('A disposition names the agent it is about.');
  const choice = DISPOSITIONS[Math.max(0, Math.min(DISPOSITIONS.length - 1, Math.round(q.value)))];
  q.settledDay = world.day;
  return spyDisposition(world, q.targetId, choice);
}

/** How suspicious the shelves the Watch is watching have become, for the Chronicle. */
export function shelfStory(world: World): string | null {
  const worst = suspectShelves(world)[0];
  if (!worst || worst.suspicion < SUSPICION_THRESHOLD) return null;
  return `${worst.name} is selling ${worst.productName} at ${worst.price} ℓ, `
    + `${Math.max(0, worst.landed - worst.price)} marks under what a lawful one lands at.`;
}
