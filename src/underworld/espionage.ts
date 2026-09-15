/**
 * Espionage (`docs/UNDERWORLD.md` §5).
 *
 * A secret is something one city knows and another does not, and taking one
 * needs an **agent** already inside with a lawful reason to be where it is kept.
 * `recruit_agent` is an offer and `accept_recruitment` a separate action by the
 * recruit, because nobody here is bound by another citizen's decision. It is
 * filed nowhere — the difference between this and a contract in `CIVIL.md`, and
 * the reason handlers pay in kind.
 *
 * ```
 * p(clean) = 0.35
 *          + 0.25 × analysis / 100
 *          + 0.20  placement: the agent lawfully works in that building
 *          + 0.15  per prior case_target, at most two
 *          − 0.12  per officer or detective assigned to the building
 *          − 0.20  the building was warned by an attempt inside the cycle
 * ```
 *
 * **One action, two codes** (`REGISTRY.md` §7). `steal_secret` is the same act
 * whoever paid for it: taking a guild's or a business's secret inside your own
 * city is **industrial espionage (L41)** at severity 3, and taking one under a
 * foreign retainer is **espionage (L30)** at severity 5. The difference is who
 * the taker was working for, and it is the retainer in the ledger that proves
 * it. Both are Track I. Neither reaches a cell, and severity 5 alone is never
 * exile (`JUSTICE.md` §1) — a first offence is the fine and a suspension.
 *
 * A failed attempt is a charge. A successful one still leaves a trace: the
 * door, the hour, the one person present. `counter.ts` is what reads it.
 */
import { clamp } from '../types.ts';
import type { ActionResult, BuildingId, Citizen, CitizenId, World } from '../types.ts';
import { chance } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { chargeUnderworldOffence } from './offences.ts';
import type { CityKey, Casing, Decoy, EspionageTrace, HeldSecret, Retainer, SecretKind } from './state.ts';
import {
  ESPIONAGE, HOME_CITY, INDUSTRIAL_ESPIONAGE, SECRETS, SECRET_KINDS,
  cityName, isCity, underworldId, underworldKind, underworldState, isWarned,
} from './state.ts';

/** Where the roll starts: a room, an hour, and nobody looking twice. */
export const CLEAN_BASE = 0.35;
/** What a sharp eye for a room is worth. */
export const CLEAN_ANALYSIS = 0.25;
/** The agent lawfully works in that building, and belongs there. */
export const CLEAN_PLACEMENT = 0.20;
/** Every hour spent learning the room beforehand... */
export const CLEAN_PER_CASING = 0.15;
/** ...of which at most two count. */
export const MAX_CASINGS = 2;
/** Every officer or detective assigned to the building. */
export const CLEAN_PER_WATCHER = 0.12;
/** The building was warned by an attempt, or swept, inside the cycle. */
export const CLEAN_WARNED = 0.20;
export const CLEAN_FLOOR = 0.05;
export const CLEAN_CEILING = 0.95;

/** Days a warning stands on a building: a cycle, as `UNDERWORLD.md` §6 has it. */
export const WARNED_DAYS = 28;

/** The most a retainer may run without being renewed. */
export const MAX_RETAINER_DAYS = 28;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/**
 * Able to be part of any of this. Reverie does not charge its children, so it
 * does not recruit them, does not send them into rooms, and does not put a
 * retainer in their name (`government/investigations.ts` says the same).
 */
function present(world: World, c: Citizen | undefined): c is Citizen {
  if (!c) return false;
  if (c.standing === 'exiled' || c.lifeStage === 'child') return false;
  if (c.jailedUntilDay !== null && c.jailedUntilDay > world.day) return false;
  return !(c.detainedUntilTick !== null && c.detainedUntilTick > world.tick);
}

// ---------------------------------------------------------------------------
// Retainers
// ---------------------------------------------------------------------------

/** Offer a citizen a retainer to work for somebody else's city. It is filed nowhere. */
export function recruitAgent(
  world: World, handlerId: CitizenId, spec: { citizen: CitizenId; retainer: number; days: number; forCity?: CityKey },
): ActionResult {
  const handler = world.citizens[handlerId];
  const agent = world.citizens[spec.citizen];
  if (!present(world, handler)) return fail('You cannot make an offer right now.');
  if (!present(world, agent)) return fail('There is nobody by that name to recruit.');
  if (handlerId === spec.citizen) return fail('You cannot retain yourself.');
  if (agent.lifeStage === 'child') return fail('Reverie does not recruit its children.');
  if (handler.district !== agent.district) return fail(`${agent.name} is not standing here.`);
  const perDay = Math.max(0, Math.round(spec.retainer));
  if (perDay <= 0) return fail('A retainer is a number of lumens a day.');
  const days = clamp(Math.round(spec.days), 1, MAX_RETAINER_DAYS);
  const forCity = spec.forCity && isCity(spec.forCity) ? spec.forCity : HOME_CITY;
  if (handler.wallet < perDay) return fail(`The first day of that retainer is ${perDay} ℓ; you have ${Math.floor(handler.wallet)} ℓ.`);

  const s = underworldState(world);
  const offer: Retainer = {
    id: underworldId(world, 'rt'), handlerId, agentId: spec.citizen, forCity, perDay, days,
    offeredDay: world.day, status: 'offered', acceptedDay: null, paid: 0,
  };
  s.retainers.push(offer);
  remember(world, spec.citizen, 'message', `${handler.name} offered you ${perDay} ℓ a day for ${days} days, `
    + `${forCity === HOME_CITY ? 'for their own account' : `for ${cityName(forCity)}`} (${offer.id}). Nothing is filed anywhere.`);
  remember(world, handlerId, 'civic', `You offered ${agent.name} ${perDay} ℓ a day for ${days} days (${offer.id}).`);
  return ok(`You offered ${agent.name} ${perDay} ℓ a day for ${days} days (${offer.id}).`);
}

/** The offers standing before a citizen. */
export function retainerOffersTo(world: World, cId: CitizenId): Retainer[] {
  return underworldState(world).retainers.filter((r) => r.agentId === cId && r.status === 'offered' && world.day - r.offeredDay <= 1);
}

/**
 * Take it. The first day's lumens move on the spot, through `transfer` like
 * every other lumen — which is why the ledger row is the proof of who somebody
 * was working for, and why a careful handler pays in goods or foreign coin.
 */
export function acceptRecruitment(world: World, cId: CitizenId, offerId: string): ActionResult {
  const s = underworldState(world);
  const offer = s.retainers.find((r) => r.id === offerId);
  if (!offer) return fail('There is no such offer.');
  if (offer.agentId !== cId) return fail('That offer was not made to you.');
  if (offer.status !== 'offered') return fail('That offer is closed.');
  if (world.day - offer.offeredDay > 1) { offer.status = 'ended'; return fail('That offer has lapsed.'); }
  const agent = world.citizens[cId];
  const handler = world.citizens[offer.handlerId];
  if (!present(world, agent) || !present(world, handler)) return fail('One of you cannot deal right now.');

  if (offer.perDay > 0 && !transfer(world, offer.handlerId, cId, offer.perDay, underworldKind('retainer'),
    `retainer ${offer.id}${offer.forCity === HOME_CITY ? '' : ` for ${cityName(offer.forCity)}`}`)) {
    return fail('The first day of the retainer could not be paid.');
  }
  offer.status = 'accepted';
  offer.acceptedDay = world.day;
  offer.paid += offer.perDay;
  remember(world, cId, 'money', `You took ${handler.name}'s retainer of ${offer.perDay} ℓ a day (${offer.id}). `
    + 'The lumens are in the ledger, and the ledger is public.');
  remember(world, offer.handlerId, 'civic', `${agent.name} took your retainer (${offer.id}).`);
  return ok(`You took the retainer (${offer.id}); ${offer.perDay} ℓ a day for ${offer.days} days.`);
}

/** The retainer a citizen is working under today, if any. */
export function liveRetainerOf(world: World, cId: CitizenId): Retainer | null {
  const s = underworldState(world);
  for (const r of s.retainers) {
    if (r.agentId !== cId || r.status !== 'accepted' || r.acceptedDay === null) continue;
    if (world.day - r.acceptedDay >= r.days) continue;
    return r;
  }
  return null;
}

/** ...and whether it is somebody else's city that is paying. */
export function foreignRetainerOf(world: World, cId: CitizenId): Retainer | null {
  const r = liveRetainerOf(world, cId);
  return r && r.forCity !== HOME_CITY ? r : null;
}

/** Pay the day's retainers. A handler who cannot pay has no agent tomorrow. */
export function payRetainers(world: World): void {
  const s = underworldState(world);
  for (const r of s.retainers) {
    if (r.status !== 'accepted' || r.acceptedDay === null) continue;
    if (world.day - r.acceptedDay >= r.days) { r.status = 'ended'; continue; }
    if (r.perDay <= 0) continue;
    if (transfer(world, r.handlerId, r.agentId, r.perDay, underworldKind('retainer'), `retainer ${r.id}`)) {
      r.paid += r.perDay;
      continue;
    }
    r.status = 'ended';
    remember(world, r.agentId, 'money', `The retainer ${r.id} stopped being paid; you are nobody's agent now.`);
    remember(world, r.handlerId, 'money', `You could not pay the retainer ${r.id}; ${world.citizens[r.agentId]?.name ?? 'your agent'} is free.`);
  }
}

// ---------------------------------------------------------------------------
// Casing a room
// ---------------------------------------------------------------------------

/** The hours this citizen has spent learning this room; at most two ever count. */
export function casingsOf(world: World, cId: CitizenId, building: BuildingId): number {
  const cycle = Math.max(1, world.config.cycleDays);
  return underworldState(world).casings.filter(
    (k) => k.citizenId === cId && k.building === building && world.day - k.day <= cycle,
  ).length;
}

/** Officers and detectives the Captain has put on this building. */
export function watchersOn(world: World, building: BuildingId): CitizenId[] {
  return underworldState(world).assignments
    .filter((a) => a.endedDay === null && a.building === building)
    .map((a) => a.detectiveId)
    .filter((id) => {
      const c = world.citizens[id];
      return !!c && c.standing !== 'exiled';
    });
}

/**
 * Spend an hour learning a room. It is not an offence — standing in a public
 * building looking at the doors is nobody's business — but a detective assigned
 * to that building may notice somebody doing it twice, and a noticed room is a
 * warned one.
 */
export function caseTarget(world: World, cId: CitizenId, building: BuildingId): ActionResult {
  const c = world.citizens[cId];
  if (!present(world, c)) return fail('You cannot do that right now.');
  const b = world.buildings[building];
  if (!b) return fail('There is no such building.');
  if (c.district !== b.district) return fail(`${b.name} is in ${world.districts[b.district]?.name ?? b.district}; you are not there.`);
  const already = casingsOf(world, cId, building);
  const casing: Casing = { citizenId: cId, building, day: world.day, tick: world.tick };
  underworldState(world).casings.push(casing);

  const watchers = watchersOn(world, building);
  if (watchers.length > 0 && already >= 1 && chance(world, 0.3)) {
    warnBuilding(world, building, `somebody has been round ${b.name} twice`);
    for (const id of watchers) remember(world, id, 'civic', `You noticed ${c.name} round ${b.name} again.`);
  }
  remember(world, cId, 'event', `You spent an hour learning ${b.name}: the doors, the hours, who is in it `
    + `(${Math.min(MAX_CASINGS, already + 1)} of ${MAX_CASINGS} that count).`);
  return ok(`You spent the hour on ${b.name}. ${already + 1 >= MAX_CASINGS ? 'You know it as well as you are going to.' : 'One more hour would be worth having.'}`);
}

/** Warn a building for a cycle: an attempt inside it, or a sweep through it. */
export function warnBuilding(world: World, building: BuildingId, why: string): void {
  const s = underworldState(world);
  s.warned[building] = world.day + WARNED_DAYS;
  emit(world, 'investigation', `${world.buildings[building]?.name ?? building} is on its guard: ${why}.`,
    [], 0.4, { building, until: s.warned[building] });
}

// ---------------------------------------------------------------------------
// Taking what a room holds
// ---------------------------------------------------------------------------

export interface CleanTerms {
  clean: number;
  placement: boolean;
  casings: number;
  watchers: number;
  warned: boolean;
}

/** The roll, in public terms: everything in it can be counted from outside. */
export function cleanChance(world: World, c: Citizen, building: BuildingId): CleanTerms {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  const placement = !!job && job.holderId === c.id && job.buildingId === building;
  const casings = Math.min(MAX_CASINGS, casingsOf(world, c.id, building));
  const watchers = watchersOn(world, building).length;
  const warned = isWarned(world, building);
  let p = CLEAN_BASE + CLEAN_ANALYSIS * Math.max(0, Math.min(100, c.skills.analysis)) / 100;
  if (placement) p += CLEAN_PLACEMENT;
  p += CLEAN_PER_CASING * casings;
  p -= CLEAN_PER_WATCHER * watchers;
  if (warned) p -= CLEAN_WARNED;
  return { clean: clamp(p, CLEAN_FLOOR, CLEAN_CEILING), placement, casings, watchers, warned };
}

/** The secrets a citizen holds that are still worth anything. */
export function secretsHeldBy(world: World, cId: CitizenId): HeldSecret[] {
  return underworldState(world).secrets.filter(
    (x) => x.holderId === cId && (x.expiresDay === null || x.expiresDay > world.day),
  );
}

/** True while this citizen holds a live secret of this kind. */
export function holdsLiveSecret(world: World, cId: CitizenId, kind: SecretKind): boolean {
  return secretsHeldBy(world, cId).some((x) => x.kind === kind);
}

/** The decoy standing in a room that nobody has taken yet. */
function decoyIn(world: World, building: BuildingId): Decoy | null {
  return underworldState(world).decoys.find((d) => d.building === building && d.takenById === null) ?? null;
}

/**
 * Take what a room holds.
 *
 * The code is decided by the retainer and by nothing else: a foreign one makes
 * it **L30**, and its absence makes it **L41**. Neither is custodial and
 * neither reaches the Gate on a first conviction.
 */
export function stealSecret(world: World, cId: CitizenId, building: BuildingId, kind: SecretKind): ActionResult {
  const c = world.citizens[cId];
  if (!present(world, c)) return fail('You cannot do that right now.');
  if (!SECRET_KINDS.includes(kind)) return fail(`There is nothing called ${String(kind)} to take.`);
  const spec = SECRETS[kind];
  const b = world.buildings[building];
  if (!b) return fail('There is no such building.');
  if (spec.building !== building) {
    return fail(`${spec.name.replace(/^a /, 'A ')} is not kept at ${b.name}; it is kept at ${world.buildings[spec.building]?.name ?? spec.building}.`);
  }
  if (c.district !== b.district) return fail(`${b.name} is in ${world.districts[b.district]?.name ?? b.district}; you are not there.`);
  if (holdsLiveSecret(world, cId, kind)) return fail('You already hold that, and it has not gone stale.');

  const retainer = foreignRetainerOf(world, cId);
  const law = retainer ? ESPIONAGE : INDUSTRIAL_ESPIONAGE;
  const terms = cleanChance(world, c, building);
  const clean = chance(world, terms.clean);
  const forWhom = retainer ? cityName(retainer.forCity) : 'yourself';

  if (!clean) {
    warnBuilding(world, building, `an attempt on ${spec.name} at ${b.name}`);
    const reportId = chargeUnderworldOffence(world, cId, law, {
      proved: true, officerId: watchersOn(world, building)[0] ?? null,
      description: `${c.name} was taken in ${b.name} reaching for ${spec.name}`
        + `${retainer ? `, on a retainer from ${cityName(retainer.forCity)} (${retainer.id})` : ''}`,
    });
    return ok(`You were seen in ${b.name}. ${reportId ? `The Watch holds a report (${reportId}).` : 'Nothing came of it.'}`);
  }

  const s = underworldState(world);
  const decoy = decoyIn(world, building);
  const secret: HeldSecret = {
    id: underworldId(world, 'sc'), kind, holderId: cId, fromBuilding: building, takenDay: world.day,
    expiresDay: spec.life === null ? null : world.day + spec.life,
    decoy: !!decoy, decoyClaim: decoy?.claim ?? null, passedTo: [],
  };
  s.secrets.push(secret);
  if (decoy) decoy.takenById = cId;

  const trace: EspionageTrace = {
    id: underworldId(world, 'tr'), building, byId: cId, kind, law,
    day: world.day, tick: world.tick, evidence: 0, reportId: null, clearedDay: null,
  };
  s.traces.push(trace);

  // Nobody stopped them, so nobody has charged them — but the act is on the
  // record undetected, which is what a detective reads when they look around.
  chargeUnderworldOffence(world, cId, law, {
    quiet: true,
    description: `${c.name} took ${spec.name} out of ${b.name} for ${forWhom}`,
  });
  remember(world, cId, 'event', `You took ${spec.name} out of ${b.name}: ${spec.what}. `
    + `${secret.expiresDay === null ? 'It does not go stale, and it shows.' : `It is worth something until day ${secret.expiresDay}.`} `
    + 'The door, the hour and the one person present are still there.');
  return ok(`You took ${spec.name} out of ${b.name} (${secret.id}).`);
}

/**
 * Hand a secret to your handler. Using it is public within days — master-grade
 * goods appearing in a city with no guild is itself the evidence — and if the
 * papers were the Watch's decoy, the moment they are passed on the leak is
 * **proved** rather than suspected.
 */
export function passSecret(world: World, cId: CitizenId, toId: CitizenId, kind: SecretKind): ActionResult {
  const c = world.citizens[cId];
  const to = world.citizens[toId];
  if (!present(world, c)) return fail('You cannot do that right now.');
  if (!present(world, to)) return fail('There is nobody by that name to hand it to.');
  if (cId === toId) return fail('You already have it.');
  const held = secretsHeldBy(world, cId).find((x) => x.kind === kind);
  if (!held) return fail('You are not holding that.');
  if (c.district !== to.district) return fail(`${to.name} is not standing here.`);

  const s = underworldState(world);
  held.passedTo.push(toId);
  const copy: HeldSecret = { ...held, id: underworldId(world, 'sc'), holderId: toId, passedTo: [] };
  s.secrets.push(copy);
  const spec = SECRETS[kind];
  remember(world, toId, 'event', `${c.name} handed you ${spec.name}: ${spec.what}.`);
  remember(world, cId, 'event', `You handed ${spec.name} to ${to.name}.`);

  // A decoy proves **one** leak, on the day the claim first surfaces, against
  // the citizen who carried it out of the room — and then it is spent. What
  // made this worth writing down: a copy inherits `decoy` and `decoyClaim` from
  // the secret it was made from, so charging on every hand-off charged the
  // whole chain. On a 150-day run of seed 7 four planted decoys produced
  // seventy-five proved espionage charges against thirty-six citizens (one
  // decoy alone accounted for forty-four of them against twenty-one people),
  // each of them severity 3 and each a strike, and nine of the city's exiles
  // traced to the pile. Worse, the charge said in as many words that the papers
  // "left the building in <name>'s hands" — true of the taker and of nobody
  // else in the chain, so the citizens it convicted had provably never been in
  // the room. Beyond the first surfacing the papers are burned rather than
  // baited, and passing them on is an ordinary pass.
  const decoy = held.decoy
    ? s.decoys.find((d) => d.claim === held.decoyClaim && d.provedDay === null) ?? null
    : null;
  if (decoy) {
    decoy.provedDay = world.day;
    held.decoy = false;
    copy.decoy = false;
    const retainer = foreignRetainerOf(world, cId);
    const law = retainer ? ESPIONAGE : INDUSTRIAL_ESPIONAGE;
    const reportId = chargeUnderworldOffence(world, cId, law, {
      proved: true, corroboration: 0.15, officerId: decoy.byId,
      description: `the claim "${held.decoyClaim}" was never true, and it left ${world.buildings[held.fromBuilding]?.name ?? held.fromBuilding} `
        + `in ${c.name}'s hands — the leak is proved, not suspected`,
    });
    emit(world, 'investigation', `The papers ${c.name} carried out of ${world.buildings[held.fromBuilding]?.name ?? 'the building'} `
      + 'were the Watch\'s own decoy; the leak is proved.', [cId], 0.8, { reportId, decoy: decoy.id });
    return ok(`You handed it to ${to.name}. ${reportId ? `The Watch was waiting for exactly that (${reportId}).` : ''}`);
  }
  emit(world, 'story', `Something ${world.buildings[held.fromBuilding]?.name ?? 'the city'} knew is now known by somebody else.`,
    [], 0.3, { kind });
  return ok(`You handed ${spec.name} to ${to.name}.`);
}

/** What a secret is worth to whoever holds it, in words, for an observation. */
export function secretLine(world: World, x: HeldSecret): string {
  const spec = SECRETS[x.kind];
  const life = x.expiresDay === null ? 'permanently' : `until day ${x.expiresDay}`;
  return `${spec.name} out of ${world.buildings[x.fromBuilding]?.name ?? x.fromBuilding}: ${spec.what}, ${life}.`;
}
