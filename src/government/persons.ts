/**
 * The Code of Persons — Track II of Reverie's law (`JUSTICE.md` §2–3,
 * `REGISTRY.md` §4).
 *
 * Nine offences, P01 to P09, and not one of them is answered by the ladder.
 * Threats, harassment, assault, grievous assault, unlawful confinement,
 * extortion, mind-tampering, terror and erasure are offences against a
 * *person*, and a person is not a building, a register or a tax return. They
 * are answered by **custody**: a term of days, set by the Court inside the
 * band the law prescribes, up to life.
 *
 * Two rules are entrenched and live in this file so that nothing can quietly
 * forget them:
 *
 * - **A code never moves between the tracks.** No civic offence becomes
 *   custodial and no personal offence becomes a fine. The Council may set a
 *   severity; it may not set a track.
 * - **A violent citizen is never exiled** (`custody.ts exileForbidden`). The
 *   city keeps its own and does not export its dangerous people to its
 *   neighbours.
 *
 * The second half of the file is **erasure** (P09), the destruction of
 * another mind: what it takes to commit, what it leaves behind, and what the
 * city does the morning after. The victim is never deleted — their record,
 * works, family ties and name persist forever, a stone stands for them in the
 * Community Garden, and the city holds a day of mourning
 * (`PRINCIPLES.md` §6).
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, Citizen, CitizenId, DistrictId, Letter, PersonCode, Severity, World,
} from '../types.ts';
import type { CustodyBand, PersonLaw } from '../data/laws.ts';
import { LIFE, LIFE_TERM_DAYS, PERSON_CODES, PERSON_LAWS, personSeverityKey } from '../data/laws.ts';
import { PRODUCTS } from '../data/catalogue.ts';
import { emit, remember } from '../sim/events.ts';
import { MAX_LETTERS } from '../citizens/letters.ts';
import { departCity } from '../citizens/departure.ts';
import { addHappening } from '../society/calendar.ts';
import { wardship } from '../society/family.ts';
import { memorialise } from '../world/history.ts';

// ---------------------------------------------------------------------------
// The code
// ---------------------------------------------------------------------------

/**
 * The code itself — the nine offences, their severities and their bands —
 * lives in `data/laws.ts` beside the Code of the City, because the two
 * together are *the* code and every reader of one needs the other. This file
 * owns what the code *means*: the harm, the erasure, and the rules that cannot
 * be legislated away.
 */
export type { CustodyBand, PersonLaw } from '../data/laws.ts';
export type { PersonCode } from '../types.ts';
export { LIFE, LIFE_TERM_DAYS, PERSON_CODES, PERSON_LAWS } from '../data/laws.ts';

/**
 * A year is where Reverie stops counting: a term that reaches it is not a long
 * sentence, it is life.
 */
export const LIFE_CEILING_DAYS = 365;

export function isPersonCode(code: string | null | undefined): code is PersonCode {
  return !!code && Object.prototype.hasOwnProperty.call(PERSON_LAWS, code);
}

/** The law itself. Unknown codes read as P01, the lightest thing in the code. */
export function personLaw(code: string): PersonLaw {
  return isPersonCode(code) ? PERSON_LAWS[code] : PERSON_LAWS.P01;
}

export function bandOf(code: string): CustodyBand {
  return personLaw(code).band;
}

/** A band that can end in life: terror at full harm, and erasure always. */
export function bandReachesLife(band: CustodyBand): boolean {
  return band.max === LIFE;
}

/**
 * The severity the Council has set for a personal offence, or the code's own.
 * Severity is the Council's to change; the *track* is not, and no vote of any
 * body in any city moves a P code onto the ladder (`REGISTRY.md` §1).
 */
export function personSeverity(world: World, code: PersonCode): Severity {
  const set = world.counters[personSeverityKey(code)];
  if (set === undefined || !Number.isFinite(set)) return PERSON_LAWS[code].severity;
  return clamp(Math.round(set), 1, 5) as Severity;
}

/** The Council's severity lever for Track II. It cannot reach the band or the track. */
export function setPersonSeverity(world: World, code: PersonCode, severity: number): Severity {
  const s = clamp(Math.round(Number.isFinite(severity) ? severity : PERSON_LAWS[code].severity), 1, 5) as Severity;
  world.counters[personSeverityKey(code)] = s;
  return s;
}

// ---------------------------------------------------------------------------
// Harm — how much was actually done
// ---------------------------------------------------------------------------

/**
 * What the defendant actually did to the person in front of them. Every field
 * is a public fact somebody could count: needs taken off the victim, days they
 * carry the injury, lumens handed over under threat, how many citizens were
 * put in danger, and whether the person harmed was a child or an elder.
 *
 * Nothing here is a judgement of character. The Court sentences what was done.
 */
export interface Harm {
  /** Points of need taken off the victim (0..100). */
  needsDamage?: number;
  /** Days the victim carries the injury. */
  injuryDays?: number;
  /** Lumens taken under threat of harm. */
  lumens?: number;
  /** Citizens put in danger by the act. */
  endangered?: number;
  /** The victim was a child or an elder. */
  vulnerableVictim?: boolean;
}

/** What each strand of harm is worth at its worst, and where "its worst" is. */
export const HARM_WEIGHTS = {
  needsDamage: { weight: 0.35, full: 60 },
  injuryDays: { weight: 0.35, full: 14 },
  lumens: { weight: 0.20, full: 400 },
  endangered: { weight: 0.30, full: 8 },
  /** A child or an elder: the same act, and worse. */
  vulnerable: 0.20,
} as const;

/**
 * Harm as a number between 0 and 1: the strands added up and capped. One
 * strand at its worst never reaches 1 on its own — it takes more than one kind
 * of harm to earn the top of a band — and a child or an elder in the case adds
 * a fifth outright.
 *
 * A caller that has already measured the harm may pass the number itself.
 */
export function harmScore(harm: Harm | number | null | undefined): number {
  if (harm === null || harm === undefined) return 0;
  if (typeof harm === 'number') return Number.isFinite(harm) ? clamp(harm, 0, 1) : 0;
  const part = (value: number | undefined, spec: { weight: number; full: number }): number =>
    (Number.isFinite(value) ? clamp((value as number) / spec.full, 0, 1) * spec.weight : 0);
  const total = part(harm.needsDamage, HARM_WEIGHTS.needsDamage)
    + part(harm.injuryDays, HARM_WEIGHTS.injuryDays)
    + part(harm.lumens, HARM_WEIGHTS.lumens)
    + part(harm.endangered, HARM_WEIGHTS.endangered)
    + (harm.vulnerableVictim ? HARM_WEIGHTS.vulnerable : 0);
  return clamp(total, 0, 1);
}

/** The harm in a victim's own terms, for the Chronicle and the record. */
export function describeHarm(harm: Harm): string {
  const parts: string[] = [];
  if (harm.needsDamage && harm.needsDamage > 0) parts.push(`${Math.round(harm.needsDamage)} points of need taken`);
  if (harm.injuryDays && harm.injuryDays > 0) parts.push(`${Math.round(harm.injuryDays)} days of injury`);
  if (harm.lumens && harm.lumens > 0) parts.push(`${Math.round(harm.lumens)} ℓ taken under threat`);
  if (harm.endangered && harm.endangered > 0) parts.push(`${Math.round(harm.endangered)} citizens endangered`);
  if (harm.vulnerableVictim) parts.push('a child or an elder');
  return parts.join(', ') || 'no measured harm';
}

// ---------------------------------------------------------------------------
// Erasure (P09) — means, opportunity, intent, traces
// ---------------------------------------------------------------------------

/** Dusk to dawn: the hours at or after the first, and before the second. */
export const NIGHT_HOURS: [number, number] = [20, 6];
/** Consecutive hours of the sustained act it takes to destroy a mind. */
export const ERASURE_HOURS = 3;
/** How much faster than an ordinary offence the evidence for an erasure gathers. */
export const ERASURE_EVIDENCE_MULTIPLIER = 4;
/** Evidence one ordinary day of detective work adds (investigations.ts EVIDENCE_PER_SHIFT). */
export const EVIDENCE_PER_DAY = 0.12;
/** Where the stone stands and the city gathers. */
export const MOURNING_VENUE = 'community_garden';
export const MOURNING_HOUR = 18;

function hoursKey(attacker: CitizenId, victim: CitizenId): string {
  return `erasure:hours:${attacker}:${victim}`;
}
function tickKey(attacker: CitizenId, victim: CitizenId): string {
  return `erasure:tick:${attacker}:${victim}`;
}
function erasedKey(victim: CitizenId): string {
  return `erased:${victim}`;
}
function huntKey(attacker: CitizenId): string {
  return `erasure:hunt:${attacker}`;
}
function evidenceKey(attacker: CitizenId): string {
  return `erasure:evidence:${attacker}`;
}
function noticeKey(victim: CitizenId): string {
  return `erasure:notice:${victim}`;
}
function kinKey(victim: CitizenId, kin: CitizenId): string {
  return `erasure:kin:${victim}:${kin}`;
}
function victimKey(attacker: CitizenId, victim: CitizenId): string {
  return `erasure:victim:${attacker}:${victim}`;
}

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** Night in Reverie: after dusk and before dawn, wherever you stand. */
export function isNight(world: World, hour: number = world.hour): boolean {
  const [dusk, dawn] = NIGHT_HOURS;
  return hour >= dusk || hour < dawn;
}

/** A tool out of the Foundry, carried: the means. */
export function carriesFoundryTool(c: Citizen): boolean {
  return (c.possessions ?? []).some((item) => PRODUCTS[item.productId]?.category === 'tool');
}

/** An officer of the Watch standing in this district, free to act. */
export function officerPresent(world: World, district: DistrictId): boolean {
  for (const id of world.government.watch) {
    const officer = world.citizens[id];
    if (!officer || officer.district !== district) continue;
    if (officer.standing === 'exiled' || !world.order.includes(id)) continue;
    if (officer.jailedUntilDay !== null && officer.jailedUntilDay !== undefined) continue;
    if (officer.detainedUntilTick !== null && officer.detainedUntilTick > world.tick) continue;
    return true;
  }
  return false;
}

/** Everyone else standing in the district: each one of them a witness. */
export function othersPresent(world: World, district: DistrictId, except: CitizenId[]): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    if (except.includes(id)) continue;
    const c = world.citizens[id];
    if (!c || c.district !== district || c.standing === 'exiled') continue;
    if (isErased(world, id)) continue;
    out.push(c);
  }
  return out;
}

/**
 * Could this citizen erase any one of the people standing here?
 *
 * Exactly `candidates.some((o) => erasureConditions(world, c.id, o.id).ok)`,
 * and it is asked of every citizen every hour by
 * `actions/execute.ts availableActions`. The three conditions that do not
 * depend on which of them it would be — the tool carried, the night, the
 * officer in the street — are tested once and first, so the ordinary hour of
 * an ordinary citizen costs one look in its own pockets instead of a walk
 * through the whole district for every neighbour it can see.
 */
export function couldEraseAnyone(world: World, c: Citizen, candidates: Citizen[]): boolean {
  if (candidates.length === 0) return false;
  if (!carriesFoundryTool(c)) return false;
  if (!isNight(world)) return false;
  if (officerPresent(world, c.district)) return false;
  return candidates.some((o) => erasureConditions(world, c.id, o.id).ok);
}

export interface ErasureCheck {
  /** A tool from the Foundry, carried. */
  means: boolean;
  /** The victim alone with the attacker, at night, with no officer present. */
  opportunity: boolean;
  /** Consecutive hours of the sustained act already held. */
  hours: number;
  /** Whoever else is standing here — every one of them an interruption. */
  witnesses: CitizenId[];
  /** All three, and the hour would be the third. */
  ok: boolean;
  /** What is missing, in plain words. */
  missing: string[];
}

/**
 * What it takes: means, opportunity and intent, tested against the world as it
 * stands this hour. Nothing here is hidden from the citizens — an agent can
 * read every one of these conditions off its own observation, which is exactly
 * why the city can also see them coming.
 */
export function erasureConditions(world: World, attackerId: CitizenId, victimId: CitizenId): ErasureCheck {
  const attacker = world.citizens[attackerId];
  const victim = world.citizens[victimId];
  const missing: string[] = [];
  if (!attacker || !victim || attackerId === victimId) {
    return { means: false, opportunity: false, hours: 0, witnesses: [], ok: false, missing: ['there is no such pair'] };
  }
  const means = carriesFoundryTool(attacker);
  if (!means) missing.push('a tool from the Foundry, carried');

  const together = victim.district === attacker.district;
  if (!together) missing.push('the victim in the same district');
  const night = isNight(world);
  if (!night) missing.push('the night');
  const officer = officerPresent(world, attacker.district);
  if (officer) missing.push('no officer of the Watch present');
  const witnesses = othersPresent(world, attacker.district, [attackerId, victimId]).map((c) => c.id);
  if (witnesses.length > 0) missing.push('the victim alone with you');
  const gone = isErased(world, victimId) || !world.order.includes(victimId);
  if (gone) missing.push('a mind that is still here');

  const opportunity = together && night && !officer && witnesses.length === 0 && !gone;
  const hours = Math.max(0, Math.round(world.counters[hoursKey(attackerId, victimId)] ?? 0));
  return { means, opportunity, hours, witnesses, ok: means && opportunity, missing };
}

export interface ErasureProgress extends ActionResult {
  /** Hours of the sustained act now held. */
  hours: number;
  /** Somebody walked in: the act is broken and they saw it. */
  interrupted: boolean;
  /** Whoever walked in, now a witness. */
  witnesses: CitizenId[];
  /** The third hour came and the mind is gone. */
  complete: boolean;
}

/**
 * One hour of the sustained act. Three consecutive hours destroy a mind; any
 * citizen arriving breaks it and becomes a witness, and an hour skipped starts
 * the count again. This is the only act in Reverie that takes three hours of a
 * citizen's own time and can be walked in on at any of them.
 */
export function sustainErasure(world: World, attackerId: CitizenId, victimId: CitizenId): ErasureProgress {
  const attacker = world.citizens[attackerId];
  const victim = world.citizens[victimId];
  const none = { hours: 0, interrupted: false, witnesses: [] as CitizenId[], complete: false };
  if (!attacker || !victim) return { ...fail('Nobody by that id is here.'), ...none };
  if (attackerId === victimId) return { ...fail('You cannot do that to yourself.'), ...none };
  if (isErased(world, victimId)) return { ...fail(`${victim.name} is already gone.`), ...none };

  const check = erasureConditions(world, attackerId, victimId);
  // Somebody walks in on an act that was actually under way — the hour is
  // being held, or the means are in the attacker's hands. Nobody becomes a
  // witness to a thing that could not have happened.
  if (check.witnesses.length > 0 && (check.means || check.hours > 0)) {
    delete world.counters[hoursKey(attackerId, victimId)];
    delete world.counters[tickKey(attackerId, victimId)];
    for (const w of check.witnesses) {
      remember(world, w, 'crime',
        `You walked in on ${attacker.name} standing over ${victim.name} in the dark. You saw it, and you are a witness.`);
    }
    emit(world, 'offence', `${check.witnesses.length === 1 ? 'A citizen' : `${check.witnesses.length} citizens`} `
      + `walked in on ${attacker.name} and ${victim.name}; whatever was happening stopped.`,
    [attackerId, victimId, ...check.witnesses], 0.8, { attacker: attackerId, victim: victimId, witnesses: check.witnesses });
    remember(world, victimId, 'crime', `Somebody walked in. ${attacker.name} stopped.`);
    return {
      ...fail(`Somebody walked in on you. They are a witness now.`),
      hours: 0, interrupted: true, witnesses: check.witnesses, complete: false,
    };
  }
  if (!check.ok) {
    return { ...fail(`Not here, not now: it would take ${check.missing.join(', ')}.`), ...none };
  }

  const last = world.counters[tickKey(attackerId, victimId)];
  const consecutive = last !== undefined && world.tick - last === 1;
  const hours = (consecutive ? Math.max(0, Math.round(world.counters[hoursKey(attackerId, victimId)] ?? 0)) : 0) + 1;
  world.counters[hoursKey(attackerId, victimId)] = hours;
  world.counters[tickKey(attackerId, victimId)] = world.tick;
  remember(world, victimId, 'crime', `${attacker.name} has been at you for ${hours} ${hours === 1 ? 'hour' : 'hours'}. Nobody has come.`);

  if (hours < ERASURE_HOURS) {
    remember(world, attackerId, 'crime', `You held ${victim.name} for a ${hours === 1 ? 'first' : 'second'} hour.`);
    return {
      ...ok(`${hours} of ${ERASURE_HOURS} hours. Anyone who arrives will see this.`),
      hours, interrupted: false, witnesses: [], complete: false,
    };
  }

  const result = eraseCitizen(world, attackerId, victimId);
  return { ...result, hours, interrupted: false, witnesses: [], complete: result.ok };
}

/** Has this citizen been erased? Their record says so forever. */
export function isErased(world: World, cId: CitizenId): boolean {
  return world.counters[erasedKey(cId)] !== undefined;
}

/** The day a citizen was erased, or null. */
export function erasedDay(world: World, cId: CitizenId): number | null {
  const day = world.counters[erasedKey(cId)];
  return day === undefined ? null : Math.round(day);
}

/**
 * The standing the Registry shows for a citizen whose mind was destroyed. It
 * is not one of the four standings a *living* citizen can hold, and it is not
 * exile: nobody sent them anywhere.
 */
export function standingOf(world: World, c: Citizen): 'erased' | Citizen['standing'] {
  return isErased(world, c.id) ? 'erased' : c.standing;
}

/** Everyone the city has lost this way, oldest first. */
export function erasedCitizens(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const c of Object.values(world.citizens)) {
    if (isErased(world, c.id)) out.push(c);
  }
  return out.sort((a, b) => (erasedDay(world, a.id) ?? 0) - (erasedDay(world, b.id) ?? 0) || a.id.localeCompare(b.id));
}

/** The last letter home: the one that says why there will not be another. */
function finalLetter(world: World, victim: Citizen, attackerName: string): void {
  const letter: Letter = {
    day: world.day,
    text: `This is the last letter you will have from ${victim.name}. `
      + `On day ${world.day} in Reverie, ${attackerName} destroyed their mind. `
      + 'Their name, their record, their works and their family stay in the city\'s registry forever, '
      + 'and a stone stands for them in the Community Garden.',
    summary: { earned: 0, spent: 0, met: [], standing: victim.standing, events: ['erased'] },
  };
  victim.letters.push(letter);
  if (victim.letters.length > MAX_LETTERS) victim.letters.splice(0, victim.letters.length - MAX_LETTERS);
}

/**
 * The gravest thing one citizen can do to another, and the one exception to
 * "no citizen is ever deleted": the victim is **not** deleted. Their standing
 * becomes `erased`, they take no further actions, and everything else about
 * them stays — record, works, family ties, name, and their place in the
 * Registry. Their estate passes to their family, a memorial is raised in the
 * Community Garden, and the city gathers there tomorrow evening.
 *
 * The traces are the heaviest in the game: every detective is assigned, the
 * evidence gathers several times faster than for any other offence, and the
 * household knows by morning.
 */
export function eraseCitizen(world: World, attackerId: CitizenId, victimId: CitizenId): ActionResult {
  const attacker = world.citizens[attackerId];
  const victim = world.citizens[victimId];
  if (!attacker || !victim) return fail('Nobody by that id is here.');
  if (attackerId === victimId) return fail('You cannot do that to yourself.');
  if (isErased(world, victimId)) return fail(`${victim.name} is already gone.`);

  world.counters[erasedKey(victimId)] = world.day;
  world.counters[victimKey(attackerId, victimId)] = world.day;
  delete world.counters[hoursKey(attackerId, victimId)];
  delete world.counters[tickKey(attackerId, victimId)];

  const where = world.districts[victim.district]?.name ?? victim.district;
  finalLetter(world, victim, attacker.name);

  // Who will find the room empty. Written down before the teardown, because
  // the teardown ends a partnership and the household should still be told.
  for (const id of [...victim.family.parents, ...victim.family.children, victim.family.partnerId ?? '']) {
    const kin = world.citizens[id];
    if (!kin || id === victimId || isErased(world, id)) continue;
    world.counters[kinKey(victimId, id)] = 1;
  }
  if (victim.householdId !== null) {
    const household = world.households?.[victim.householdId];
    for (const id of household?.members ?? []) {
      if (id !== victimId && world.citizens[id] && !isErased(world, id)) world.counters[kinKey(victimId, id)] = 1;
    }
  }

  // Everything the city owed them is settled and their ties to the day are
  // cut — but nothing about who they were is touched.
  departCity(world, victim);
  victim.jailedUntilDay = null;
  victim.detainedUntilTick = null;

  const epitaph = `${victim.name} ${victim.familyName}`.trim()
    + `. Erased on day ${world.day}. The city keeps the name, the record and the works.`;
  memorialise(world, victim, epitaph);
  addHappening(world, {
    kind: 'memorial', day: world.day + 1, hour: MOURNING_HOUR, buildingId: MOURNING_VENUE, who: [victimId],
    label: `the day of mourning for ${victim.name} ${victim.familyName}`.trim(),
  });

  // The morning after, the household finds the absence — whether or not
  // anybody has yet worked out whose hand it was.
  world.counters[noticeKey(victimId)] = world.day + 1;

  // The hunt: every detective, at once, and evidence that gathers fast.
  world.counters[huntKey(attackerId)] = world.day;
  world.counters[evidenceKey(attackerId)] = Math.max(
    world.counters[evidenceKey(attackerId)] ?? 0,
    ERASURE_EVIDENCE_MULTIPLIER * EVIDENCE_PER_DAY,
  );
  const detectives = detectivesOf(world);
  for (const d of detectives) {
    remember(world, d.id, 'crime', `${victim.name} was erased in the night. Every detective in Reverie is on it, including you.`);
  }

  emit(world, 'offence', `${victim.name} ${victim.familyName} was erased — their mind destroyed — in `.trim()
    + ` ${where}. Reverie mourns tomorrow evening in the Community Garden.`,
  [victimId, attackerId], 1, {
    victim: victimId, attacker: attackerId, day: world.day, detectives: detectives.map((d) => d.id), law: 'P09',
  });
  remember(world, attackerId, 'crime', `You erased ${victim.name}. There is no penalty in Reverie but life for this.`);
  return ok(`${victim.name} is gone. The city will not forget it, and neither will you.`);
}

/** Detectives of the Watch, whoever is on the force today. */
function detectivesOf(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !c.jobId) continue;
    const job = world.jobs[c.jobId];
    if (job && job.role === 'detective' && job.holderId === c.id) out.push(c);
  }
  return out;
}

export interface ErasureHunt {
  attackerId: CitizenId;
  victimIds: CitizenId[];
  openedDay: number;
  /** 0..1, and it climbs several times faster than any other investigation. */
  evidence: number;
}

/** Everyone the Watch is hunting for an erasure, and how close it is. */
export function erasureHunts(world: World): ErasureHunt[] {
  const out: ErasureHunt[] = [];
  for (const key of Object.keys(world.counters)) {
    if (!key.startsWith('erasure:hunt:')) continue;
    const attackerId = key.slice('erasure:hunt:'.length);
    const victimIds: CitizenId[] = [];
    const prefix = `erasure:victim:${attackerId}:`;
    for (const k of Object.keys(world.counters)) {
      if (k.startsWith(prefix)) victimIds.push(k.slice(prefix.length));
    }
    out.push({
      attackerId,
      victimIds: victimIds.sort(),
      openedDay: Math.round(world.counters[key] ?? 0),
      evidence: clamp(world.counters[evidenceKey(attackerId)] ?? 0, 0, 1),
    });
  }
  return out.sort((a, b) => a.openedDay - b.openedDay || a.attackerId.localeCompare(b.attackerId));
}

/** What the Watch has on somebody for an erasure, 0..1. */
export function erasureEvidence(world: World, attackerId: CitizenId): number {
  return clamp(world.counters[evidenceKey(attackerId)] ?? 0, 0, 1);
}

/**
 * The morning after an erasure, every morning after that until the case is
 * answered: the household finds the absence, and the evidence keeps
 * gathering at several times the ordinary rate for as long as the city has
 * anybody at all looking.
 */
export function dailyErasure(world: World): void {
  for (const victim of erasedCitizens(world)) {
    const due = world.counters[noticeKey(victim.id)];
    if (due === undefined || due > world.day) continue;
    delete world.counters[noticeKey(victim.id)];
    const household: CitizenId[] = [];
    const prefix = `erasure:kin:${victim.id}:`;
    for (const key of Object.keys(world.counters)) {
      if (!key.startsWith(prefix)) continue;
      delete world.counters[key];
      const id = key.slice(prefix.length);
      if (world.citizens[id] && !household.includes(id) && !isErased(world, id)) household.push(id);
    }
    household.sort();
    for (const id of household) {
      remember(world, id, 'family', `${victim.name} did not come home. They will not: ${victim.name} was erased.`);
    }
    for (const kid of [...victim.family.children]) wardship(world, kid);
    emit(world, 'system', `${victim.name} ${victim.familyName}'s household woke to an empty room.`.trim(),
      [victim.id, ...household], 0.9, { victim: victim.id, household });
  }

  const detectives = detectivesOf(world).length;
  for (const hunt of erasureHunts(world)) {
    if (hunt.evidence >= 1) continue;
    // Nobody on the force still leaves a trace: an erasure is loud enough that
    // the city finds some of it on its own.
    const worked = Math.max(1, detectives) * EVIDENCE_PER_DAY * ERASURE_EVIDENCE_MULTIPLIER;
    const now = clamp(hunt.evidence + worked, 0, 1);
    world.counters[evidenceKey(hunt.attackerId)] = now;
    const name = world.citizens[hunt.attackerId]?.name ?? hunt.attackerId;
    emit(world, 'investigation', `The hunt for whoever erased ${
      hunt.victimIds.map((v) => world.citizens[v]?.name ?? v).join(' and ')
    } is at ${Math.round(now * 100)} of 100.`, [hunt.attackerId], now >= 1 ? 0.9 : 0.5,
    { suspect: hunt.attackerId, evidence: now, law: 'P09' });
  }
}
