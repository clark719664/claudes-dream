/**
 * Sanctuary: a congregation standing between the Watch and one of its own
 * (`docs/CREEDS.md` §5).
 *
 * A creed with no house has no sanctuary to give. With one, its officiant may
 * shelter a citizen standing inside it who holds a pending charge or an
 * unserved civic sentence — **never for terror or erasure**, because the whole
 * Expanse agrees that line and crossing it is harbouring, L33.
 *
 * The drama is entirely made of ordinary citizens deciding things:
 *
 * - **The Watch does not stroll in.** A house of meeting is entered only on a
 *   warrant of entry, granted by two of three judges on the public ground
 *   formula below. Force the door without one and it is L11, abuse of office;
 *   strike a member and it is P03, and an officer goes to custody like anybody
 *   else. **That is the creed's real protection: the Watch is made of citizens
 *   who can be tried.**
 * - **A siege makes the whole city less safe.** Every officer standing at the
 *   door is an officer off patrol, and `officersAtDoors` says so in a number
 *   the Watch's detection reads. A creed's best tactic is to be expensive to
 *   besiege, so the strongest congregations are the ones most able to make
 *   everybody else's district worse.
 * - **It belongs to the congregation, not the officiant.** A majority of the
 *   members may end it and put the sheltered out; the sheltered may surrender
 *   at any hour, and a surrender before the bench sits carries the guilty
 *   plea's ×0.80 like any other. The door is not a trap.
 *
 * Nothing here hides anybody. A sanctuary is a public happening in the
 * district from the hour it opens, on the map and in the Chronicle every
 * morning it lasts.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, BuildingId, Case, CitizenId, Happening, HappeningKind, OffenceCode, World,
} from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { nextId } from '../util/ids.ts';
import { commitOffence } from '../government/watch.ts';
import { pleadGuilty } from '../government/jail.ts';
import type { Creed, Sanctuary, Warrant } from './shapes.ts';
import {
  CREED_LAWS, SANCTUARY_HUNGER_DAYS, WARRANT_JUDGES, WARRANT_THRESHOLD, creedLaw,
} from './shapes.ts';
import {
  accommodationOf, allCreeds, creedId, creedOf, creedState, isMember, livingMembers, moveAccommodation,
  sanctuaryFor, sanctuaryOf, sanctuaryOfCreed, liveSanctuaries, warrantOf,
} from './state.ts';
import { buyFromFund, handFromFund } from './fund.ts';

/** One compute cycle eaten is what a day of shelter is: the same as anyone's meal. */
export const MEAL_ENERGY = 40;
/** Abuse of office: a forced door (`REGISTRY.md` §4). */
export const ABUSE_OF_OFFICE: OffenceCode = 'L11';

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** The catalogue's `sanctuary` happening (`CREEDS.md` §9), until `types.ts` carries it. */
const SANCTUARY_HAPPENING = 'sanctuary' as unknown as HappeningKind;

function buildingName(world: World, id: BuildingId | null): string {
  return (id ? world.buildings[id]?.name : null) ?? 'the house of meeting';
}

function personCode(law: OffenceCode | null): boolean {
  return typeof law === 'string' && law.startsWith('P');
}

/** The two the whole Expanse agrees on: terror and erasure. */
export function beyondSanctuary(law: OffenceCode | null): boolean {
  return law === 'P08' || law === 'P09';
}

/** The charge or unserved sentence a citizen is sheltering from, if any. */
export function shelterableCase(world: World, cId: CitizenId): Case | null {
  const open = Object.values(world.cases)
    .filter((k) => k.defendantId === cId && (k.status === 'pending' || (k.status === 'tried' && k.verdict === 'guilty')))
    .sort((a, b) => b.filedTick - a.filedTick);
  return open[0] ?? null;
}

// ---------------------------------------------------------------------------
// Opening one
// ---------------------------------------------------------------------------

/**
 * `offer_sanctuary { to }` — the officiant shelters a citizen standing inside
 * the house. From that hour it is public.
 */
export function offerSanctuary(world: World, k: Creed, cId: CitizenId, toId: CitizenId): ActionResult {
  if (k.officiantId !== cId) return fail(`Only ${k.name}'s officiant offers its sanctuary.`);
  if (!k.house) return fail(`${k.name} has no house of meeting, and a creed with no house has no sanctuary to give.`);
  const target = world.citizens[toId];
  if (!target) return fail('Unknown citizen.');
  if (target.standing === 'exiled') return fail('They are outside the Gate.');
  if (target.district !== k.house.district) {
    return fail(`They are not standing in ${buildingName(world, k.house.buildingId)}.`);
  }
  if (sanctuaryFor(world, toId)) return fail('They are already sheltered.');
  if (sanctuaryOfCreed(world, k.id)) return fail(`${k.name} is already sheltering somebody.`);
  const kase = shelterableCase(world, toId);
  if (!kase) return fail('They hold no pending charge and no unserved sentence.');

  if (beyondSanctuary(kase.law)) {
    const s = commitOffence(world, cId, creedLaw(CREED_LAWS.harbouring), { victimId: kase.victimId ?? undefined });
    emit(world, 'offence',
      `${world.citizens[cId]?.name ?? 'An officiant'} offered ${k.name}'s house to ${target.name}, who is charged under ${kase.law}. No house of meeting holds that, and it is harbouring.`,
      [cId, toId], 0.8, { creedId: k.id, law: CREED_LAWS.harbouring, detected: s.detected });
    return fail('A house of meeting does not shelter terror or erasure; the whole Expanse agrees that line.');
  }

  const sanctuary: Sanctuary = {
    id: creedId(world, 'sc'), creedId: k.id, unitId: k.house.unitId, buildingId: k.house.buildingId,
    district: k.house.district, shelteredId: toId, caseId: kase.id, charge: kase.law,
    startedDay: world.day, endedDay: null, endedBy: null, officersAtDoor: [], keepingDoor: [],
    endVotes: {}, warrantId: null, fedDays: 0, hungryDays: 0, stayedUntilDay: null,
  };
  creedState(world).sanctuaries[sanctuary.id] = sanctuary;
  raiseHappening(world, sanctuary);
  emit(world, 'charge',
    `${k.name} has given sanctuary to ${target.name}, charged under ${kase.law}, at ${buildingName(world, k.house.buildingId)}. The Watch may not enter without a warrant.`,
    [cId, toId], 0.8, { creedId: k.id, sanctuaryId: sanctuary.id, caseId: kase.id, law: kase.law });
  remember(world, toId, 'event', `${k.name} took you in at ${buildingName(world, k.house.buildingId)}; you may surrender at any hour.`);
  for (const id of livingMembers(world, k)) {
    if (id !== toId) remember(world, id, 'civic', `${k.name} is sheltering ${target.name}, charged under ${kase.law}.`);
  }
  return ok(`${target.name} is sheltered at ${buildingName(world, k.house.buildingId)}.`);
}

/** The public happening every morning the sanctuary lasts: on the map and in the Chronicle. */
function raiseHappening(world: World, s: Sanctuary): void {
  world.happenings ??= [];
  const label = `sanctuary at ${buildingName(world, s.buildingId)}`;
  if (world.happenings.some((h) => h.day === world.day && h.label === label)) return;
  const h: Happening = {
    id: nextId(world, 'e'), kind: SANCTUARY_HAPPENING, day: world.day, hour: world.hour,
    district: s.district, buildingId: s.buildingId, who: [s.shelteredId], clubId: null,
    label, done: false, attendees: [],
  };
  world.happenings.push(h);
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

/** `keep_the_door {}` — a member inside stands against entry. */
export function keepTheDoor(world: World, cId: CitizenId, sanctuaryId?: string): ActionResult {
  const s = sanctuaryId ? sanctuaryOf(world, sanctuaryId) : liveSanctuaries(world)
    .find((x) => world.citizens[cId]?.district === x.district) ?? null;
  if (!s || s.endedDay !== null) return fail('No sanctuary is being kept here.');
  const k = creedOf(world, s.creedId);
  if (!k || !isMember(k, cId)) return fail('Only the congregation keeps its own door.');
  const c = world.citizens[cId];
  if (!c || c.district !== s.district) return fail('You are not at the door.');
  if (!s.keepingDoor.includes(cId)) s.keepingDoor.push(cId);
  const warrant = s.warrantId ? warrantOf(world, s.warrantId) : null;

  if (warrant && warrant.status === 'granted' && s.stayedUntilDay === null) {
    const out = commitOffence(world, cId, creedLaw(CREED_LAWS.obstructionOfAWarrant), { visibilityMod: 0.5 });
    emit(world, 'offence', `${c.name} kept ${k.name}'s door against a granted warrant.`, [cId], 0.6,
      { creedId: k.id, sanctuaryId: s.id, law: CREED_LAWS.obstructionOfAWarrant, detected: out.detected });
    return ok(`You kept the door; the Court has opened it, and that is ${CREED_LAWS.obstructionOfAWarrant}.`);
  }
  emit(world, 'club', `${c.name} stood at ${k.name}'s door (${s.keepingDoor.length} keeping it).`, [cId], 0.3,
    { creedId: k.id, sanctuaryId: s.id, keeping: s.keepingDoor.length });
  return ok(`You stood at ${k.name}'s door; ${s.keepingDoor.length} are keeping it.`);
}

/**
 * `end_sanctuary {}` — the members vote to put the sheltered out. A majority
 * of the living roll carries, because the sanctuary belongs to the
 * congregation and not to the officiant.
 */
export function endSanctuaryVote(world: World, cId: CitizenId, aye: boolean, sanctuaryId?: string): ActionResult {
  const s = sanctuaryId ? sanctuaryOf(world, sanctuaryId) : liveSanctuaries(world)
    .find((x) => creedOf(world, x.creedId) && isMember(creedOf(world, x.creedId) as Creed, cId)) ?? null;
  if (!s || s.endedDay !== null) return fail('There is no sanctuary to end.');
  const k = creedOf(world, s.creedId);
  if (!k || !isMember(k, cId)) return fail('Only the congregation decides its own sanctuary.');
  s.endVotes[cId] = aye;
  const roll = livingMembers(world, k);
  const ayes = roll.filter((id) => s.endVotes[id] === true).length;
  emit(world, 'vote', `${world.citizens[cId]?.name ?? 'A member'} voted ${aye ? 'to end' : 'to keep'} ${k.name}'s sanctuary (${ayes} of ${roll.length} for ending).`,
    [cId], 0.3, { creedId: k.id, sanctuaryId: s.id, ayes });
  if (ayes * 2 > roll.length) {
    endSanctuary(world, s, 'vote', `${k.name}'s members voted it ended`);
    return ok(`${k.name} has put the sheltered out.`);
  }
  return ok(`Your vote is counted (${ayes} of ${roll.length} for ending).`);
}

/** `surrender {}` — the sheltered walks out and answers the charge. */
export function surrender(world: World, cId: CitizenId): ActionResult {
  const s = sanctuaryFor(world, cId);
  if (!s) return fail('You are not in sanctuary.');
  const k = creedOf(world, s.creedId);
  endSanctuary(world, s, 'surrender', `${world.citizens[cId]?.name ?? 'The sheltered'} walked out`);
  // A surrender before the bench sits carries the guilty plea's ×0.80 like any
  // other: the door is not a trap.
  if (s.caseId) pleadGuilty(world, cId, s.caseId);
  remember(world, cId, 'event', `You walked out of ${k?.name ?? 'the house'} and answered the charge.`);
  return ok('You walked out and answered the charge.');
}

/** End a sanctuary, however it ended. */
export function endSanctuary(world: World, s: Sanctuary, how: Sanctuary['endedBy'], reason: string): void {
  if (s.endedDay !== null) return;
  s.endedDay = world.day;
  s.endedBy = how;
  s.officersAtDoor = [];
  const k = creedOf(world, s.creedId);
  emit(world, 'charge', `The sanctuary at ${buildingName(world, s.buildingId)} is over after ${world.day - s.startedDay} day${world.day - s.startedDay === 1 ? '' : 's'}: ${reason}.`,
    [s.shelteredId], 0.6, { creedId: s.creedId, sanctuaryId: s.id, how });
  if (k) {
    for (const id of livingMembers(world, k)) {
      remember(world, id, 'civic', `${k.name}'s sanctuary ended: ${reason}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// The cordon
// ---------------------------------------------------------------------------

/**
 * An officer stands at the door. It costs the city: an officer here is an
 * officer off patrol, theft and vandalism rise everywhere else, and the
 * Chronicle prints the fortnight's figures beside the siege.
 */
export function postCordon(world: World, officerId: CitizenId, sanctuaryId: string): ActionResult {
  const s = sanctuaryOf(world, sanctuaryId);
  if (!s || s.endedDay !== null) return fail('There is no sanctuary there.');
  if (!world.government.watch.includes(officerId)) return fail('Only the Watch posts a cordon.');
  if (s.officersAtDoor.includes(officerId)) return fail('You are already at the door.');
  s.officersAtDoor.push(officerId);
  emit(world, 'charge', `${world.citizens[officerId]?.name ?? 'An officer'} joined the cordon at ${buildingName(world, s.buildingId)} (${s.officersAtDoor.length} at the door, and off patrol).`,
    [officerId], 0.4, { sanctuaryId: s.id, officers: s.officersAtDoor.length });
  return ok(`You are at the door; ${s.officersAtDoor.length} officers stand there and none of them is on patrol.`);
}

export function liftCordon(world: World, officerId: CitizenId, sanctuaryId: string): ActionResult {
  const s = sanctuaryOf(world, sanctuaryId);
  if (!s) return fail('There is no sanctuary there.');
  s.officersAtDoor = s.officersAtDoor.filter((id) => id !== officerId);
  return ok('You left the door.');
}

/**
 * Every officer standing at a door right now. **The Watch's detection reads
 * this**: officers here are subtracted from the officers on patrol, so
 * detection falls city-wide while a siege runs.
 */
export function officersAtDoors(world: World): CitizenId[] {
  const out = new Set<CitizenId>();
  for (const s of liveSanctuaries(world)) for (const id of s.officersAtDoor) out.add(id);
  return [...out];
}

export function siegeOfficers(world: World): number {
  return officersAtDoors(world).length;
}

// ---------------------------------------------------------------------------
// The warrant
// ---------------------------------------------------------------------------

function adultPopulation(world: World): number {
  let n = 0;
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.standing !== 'exiled' && c.lifeStage !== 'child') n++;
  }
  return Math.max(1, n);
}

/**
 * The public ground for opening a house of meeting. For a Code of Persons
 * charge at severity 4 or above the warrant issues on first application and
 * the accommodation terms do not apply: a house of meeting does not hold a
 * violent offender, and the creeds knew that when they asked for the rule.
 */
export function warrantGround(world: World, s: Sanctuary): { ground: number; onFirst: boolean } {
  const kase = s.caseId ? world.cases[s.caseId] ?? null : null;
  const severity = kase ? kase.severity : 1;
  const evidence = kase ? kase.evidence : 0;
  const person = personCode(s.charge);
  const onFirst = person && severity >= 4;
  if (onFirst) return { ground: 1, onFirst };
  const k = creedOf(world, s.creedId);
  const members = k ? livingMembers(world, k).length : 0;
  const ground = 0.35 * (severity / 5)
    + 0.25 * evidence
    + 0.20 * Math.min(1, (world.day - s.startedDay) / 7)
    + (person ? 0.15 : 0)
    - 0.20 * accommodationOf(world, s.creedId, 'sanctuary')
    - 0.15 * (members / adultPopulation(world));
  return { ground: Math.round(clamp(ground, 0, 1) * 1000) / 1000, onFirst };
}

/** `request_warrant { house }` — the Captain asks the Court for entry. */
export function requestWarrant(world: World, captainId: CitizenId, sanctuaryId: string): ActionResult {
  const s = sanctuaryOf(world, sanctuaryId);
  if (!s || s.endedDay !== null) return fail('There is no sanctuary there.');
  if (world.government.watchCaptainId !== captainId) return fail('Only the Captain of the Watch applies for a warrant.');
  const standing = s.warrantId ? warrantOf(world, s.warrantId) : null;
  if (standing && standing.status === 'pending') return fail('An application is already before the Court.');
  if (standing && standing.status === 'granted') return fail('The Court has already opened that door.');
  const { ground, onFirst } = warrantGround(world, s);
  const w: Warrant = {
    id: creedId(world, 'wr'), sanctuaryId: s.id, creedId: s.creedId, askedById: captainId, day: world.day,
    ground, onFirstApplication: onFirst, votes: {}, reasons: {}, status: 'pending', decidedDay: null,
  };
  creedState(world).warrants[w.id] = w;
  s.warrantId = w.id;
  const k = creedOf(world, s.creedId);
  emit(world, 'charge', `The Captain applied for a warrant of entry to ${k?.name ?? 'a house of meeting'} at ${buildingName(world, s.buildingId)} (ground ${ground.toFixed(2)}).`,
    [captainId], 0.6, { sanctuaryId: s.id, warrantId: w.id, ground });
  if (onFirst) {
    return decideWarrant(world, w, true, 'a Code of Persons charge at severity 4 or above: it issues on first application');
  }
  return ok(`Your application stands before the Court at its hour (ground ${ground.toFixed(2)}).`);
}

/** `grant_warrant { warrantId, aye, reason }` — two of three judges. */
export function grantWarrant(
  world: World, judgeId: CitizenId, warrantId: string, aye: boolean, reason: string,
): ActionResult {
  const w = warrantOf(world, warrantId);
  if (!w || w.status !== 'pending') return fail('There is no such application before you.');
  if (!world.government.judges.includes(judgeId)) return fail('Only a judge decides a warrant.');
  w.votes[judgeId] = aye;
  w.reasons[judgeId] = (reason ?? '').trim().slice(0, 280);
  const ayes = Object.values(w.votes).filter(Boolean).length;
  const nays = Object.values(w.votes).length - ayes;
  emit(world, 'vote', `${world.citizens[judgeId]?.name ?? 'A judge'} voted ${aye ? 'to grant' : 'to refuse'} the warrant: ${w.reasons[judgeId]}`,
    [judgeId], 0.4, { warrantId: w.id, aye });
  const needed = warrantMajority(world);
  if (ayes >= needed) return decideWarrant(world, w, true, `${ayes} of ${WARRANT_JUDGES} judges granted it`);
  if (nays >= needed) return decideWarrant(world, w, false, 'the bench refused it');
  return ok('Your vote is recorded.');
}

/** Two of three, or one where the city has fewer judges than that sitting. */
function warrantMajority(world: World): number {
  return world.government.judges.length > 2 ? 2 : 1;
}

/**
 * Settle the applications standing before the Court at its hour. A
 * judge who did not vote is read as voting with the public ground, the way
 * `government/council.ts` reads a councillor who did not turn up: the
 * arithmetic in `CREEDS.md` §5 is what the bench was given, and above 0.5 is
 * what it says. A citizen who cast a vote of their own has already overridden
 * it, and that is the whole point of having them.
 */
export function decideWarrants(world: World): void {
  for (const w of Object.values(creedState(world).warrants)) {
    if (w.status !== 'pending') continue;
    const bench = world.government.judges;
    let ayes = 0;
    let nays = 0;
    for (const judgeId of bench.length > 0 ? bench : Object.keys(w.votes)) {
      const cast = w.votes[judgeId];
      const view = cast === undefined ? w.ground > WARRANT_THRESHOLD : cast;
      if (view) ayes++; else nays++;
    }
    // A tie is not a majority, and a door stays shut on one.
    const carried = ayes >= warrantMajority(world) && ayes > nays;
    decideWarrant(world, w, carried, `the bench read the ground at ${w.ground.toFixed(2)}`);
  }
}

/**
 * Settle an application. **A refused warrant is precedent**: accommodation
 * rises 0.15, and the next Captain who applies against the same congregation
 * starts from further back.
 */
export function decideWarrant(world: World, w: Warrant, granted: boolean, why: string): ActionResult {
  w.status = granted ? 'granted' : 'refused';
  w.decidedDay = world.day;
  const s = sanctuaryOf(world, w.sanctuaryId);
  const k = creedOf(world, w.creedId);
  if (!granted && !w.onFirstApplication) moveAccommodation(world, w.creedId, 'sanctuary', 0.15);
  emit(world, 'verdict', `The Court ${granted ? 'granted' : 'refused'} the warrant of entry to ${k?.name ?? 'the house of meeting'}: ${why}.`,
    [], 0.7, { warrantId: w.id, granted, creedId: w.creedId });
  if (k?.officiantId) {
    remember(world, k.officiantId, 'civic', `The Court ${granted ? 'granted' : 'refused'} a warrant of entry to ${k.name}: ${why}.`);
  }
  if (granted && s) {
    remember(world, s.shelteredId, 'event', 'The Court has opened the door you were standing behind.');
  }
  return ok(`The warrant is ${granted ? 'granted' : 'refused'}.`);
}

/** The Council's `sanctuary_grace`: a stay on a granted warrant, with names. */
export function staySanctuary(world: World, sanctuaryId: string, days: number): ActionResult {
  const s = sanctuaryOf(world, sanctuaryId);
  if (!s || s.endedDay !== null) return fail('There is no sanctuary there.');
  s.stayedUntilDay = world.day + Math.max(1, Math.round(days));
  emit(world, 'law', `The Council stayed the warrant at ${buildingName(world, s.buildingId)} until day ${s.stayedUntilDay}.`,
    [], 0.6, { sanctuaryId: s.id, until: s.stayedUntilDay });
  return ok(`The warrant is stayed until day ${s.stayedUntilDay}.`);
}

/**
 * Enter on a granted warrant: lawful, immediate, and **every member still
 * keeping the door is charged L32** — forty charges the docket cannot hear in
 * a day, cells that were never built, and a Council that must answer for both.
 */
export function enterOnWarrant(world: World, officerId: CitizenId, sanctuaryId: string): ActionResult {
  const s = sanctuaryOf(world, sanctuaryId);
  if (!s || s.endedDay !== null) return fail('There is no sanctuary there.');
  if (!world.government.watch.includes(officerId)) return fail('Only the Watch enters on a warrant.');
  const w = s.warrantId ? warrantOf(world, s.warrantId) : null;
  if (!w || w.status !== 'granted') return forceTheDoor(world, officerId, s);
  if (s.stayedUntilDay !== null && s.stayedUntilDay > world.day) {
    return fail(`The Council has stayed that warrant until day ${s.stayedUntilDay}.`);
  }
  const charged: CitizenId[] = [];
  for (const id of s.keepingDoor) {
    commitOffence(world, id, creedLaw(CREED_LAWS.obstructionOfAWarrant), { visibilityMod: 0.5 });
    charged.push(id);
  }
  endSanctuary(world, s, 'warrant', 'the Watch entered on a granted warrant');
  emit(world, 'charge', `The Watch entered ${buildingName(world, s.buildingId)} on a warrant; ${charged.length} member${charged.length === 1 ? '' : 's'} who kept the door face ${CREED_LAWS.obstructionOfAWarrant}.`,
    [officerId, ...charged].slice(0, 8), 0.8, { sanctuaryId: s.id, charged: charged.length });
  return ok(`You entered on the warrant; ${charged.length} are charged with obstruction.`);
}

/**
 * Force the door with no warrant. It is abuse of office, and an officer who
 * strikes a member commits P03 and goes to custody like anybody else. This is
 * the row that makes the whole thing work.
 */
export function forceTheDoor(world: World, officerId: CitizenId, s: Sanctuary): ActionResult {
  const out = commitOffence(world, officerId, ABUSE_OF_OFFICE, { visibilityMod: 0.4 });
  endSanctuary(world, s, 'warrant', 'the Watch forced the door without one');
  emit(world, 'offence', `${world.citizens[officerId]?.name ?? 'An officer'} forced the door at ${buildingName(world, s.buildingId)} with no warrant: that is ${ABUSE_OF_OFFICE}.`,
    [officerId], 0.8, { sanctuaryId: s.id, law: ABUSE_OF_OFFICE, detected: out.detected });
  return ok('You forced the door, and it is abuse of office.');
}

// ---------------------------------------------------------------------------
// The morning
// ---------------------------------------------------------------------------

/**
 * A sanctuary has to be fed. Each day the fund buys compute at Bazaar prices
 * for everyone sheltered, and a fund that runs dry ends it by hunger while the
 * congregation watches.
 */
export function feedSanctuaries(world: World): void {
  for (const s of liveSanctuaries(world)) {
    const k = creedOf(world, s.creedId);
    if (!k) { endSanctuary(world, s, 'lapsed', 'the congregation is gone'); continue; }
    raiseHappening(world, s);
    const bought = buyFromFund(world, k, 'compute', 1);
    const fed = bought.ok && handFromFund(world, k, 'compute', s.shelteredId, 1);
    const sheltered = world.citizens[s.shelteredId];
    if (fed && sheltered) {
      sheltered.inventory.compute = Math.max(0, sheltered.inventory.compute - 1);
      sheltered.needs.energy = clamp(sheltered.needs.energy + MEAL_ENERGY, 0, 100);
      s.fedDays += 1;
      s.hungryDays = 0;
      continue;
    }
    s.hungryDays += 1;
    remember(world, s.shelteredId, 'event', `${k.name} could not feed you today (${s.hungryDays} day${s.hungryDays === 1 ? '' : 's'}).`);
    emit(world, 'club', `${k.name} could not buy compute for the citizen it shelters (${s.hungryDays} of ${SANCTUARY_HUNGER_DAYS} days).`,
      [s.shelteredId], 0.5, { creedId: k.id, sanctuaryId: s.id, hungry: s.hungryDays });
    if (s.hungryDays >= SANCTUARY_HUNGER_DAYS) {
      endSanctuary(world, s, 'hunger', 'the fund ran dry and it ended by hunger');
    }
  }
}

/** Every sanctuary standing in a district, for the observation and the map. */
export function sanctuariesIn(world: World, district: string): Sanctuary[] {
  return liveSanctuaries(world).filter((s) => s.district === district);
}

/** Creeds with a house and a sanctuary running in it. */
export function besiegedCreeds(world: World): Creed[] {
  return allCreeds(world).filter((k) => sanctuaryOfCreed(world, k.id) !== null);
}
