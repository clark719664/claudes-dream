/**
 * The Watch: detection of offences, citizen reports, detention and the daily
 * housekeeping of the force.
 *
 * The Watch cannot punish, and it does not prosecute of its own accord either.
 * What an officer notices becomes a **report** (government/reports.ts) before
 * that officer, and what a citizen reports goes to the Watch's shared inbox;
 * an officer decides whether to file it as a charge before the Court, drop it,
 * or leave it to lapse. Detection is a roll; prosecution is a decision.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, BuildingId, Citizen, CitizenId, OffenceCode, OffenceRecord, ReportId, World,
} from '../types.ts';
import { LAWS, isPersonLaw, offenceName, offenceSeverity, offenceVisibility, trackOf } from '../data/laws.ts';
import { chance, pick, rand } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { applyForJob, createCityJob, openJobs } from '../economy/jobs.ts';
import { bondBetween, adjustBond } from '../citizens/relationships.ts';
import { defend } from './gangs.ts';
import { expireReports, openReport, pruneBribes, watchSession } from './reports.ts';
import { curfewVisibilityMod } from '../politics/decrees.ts';
import { postEvidenceBonus } from '../social/feed.ts';

/** Offences remembered per citizen (newest last). */
export const RECENT_OFFENCES_LENGTH = 20;
/** A report only matches an undetected offence this recent. */
export const REPORT_WINDOW_TICKS = 72;
/** The city always keeps at least this many Watch positions open. */
export const MIN_WATCH_JOBS = 3;
/** Above this population the Watch grows: one position per WATCH_PER_CITIZENS citizens. */
export const WATCH_GROWTH_POPULATION = 60;
export const WATCH_PER_CITIZENS = 20;
/**
 * Laws that describe the same act at different scales: a report of one matches
 * the other. Both tracks have such a pair — petty and grand theft on the
 * ladder, assault and grievous assault in custody — and a report never crosses
 * from one track to the other.
 */
const LAW_FAMILIES: readonly (readonly OffenceCode[])[] = [['L04', 'L08'], ['P03', 'P04'], ['P01', 'P02']];

/**
 * How strong a case the Watch actually holds, 0..1.
 *
 * Detection is not proof, and this is the difference between them. What the
 * Watch has after noticing an offence is built out of things a court could be
 * shown: an officer who saw it with their own eyes, the citizens who were
 * standing there, how much of a mark the act itself leaves, and how plausibly
 * the suspect can account for it. Nothing reaches certainty — a case that
 * cannot be doubted is not a case, it is a formality — and nothing starts high
 * enough that the bench can skip reading it.
 */
export const EVIDENCE_BASE = 0.10;
/** What the act's own visibility is worth: a wrecked building leaves more than a quiet lie. */
export const EVIDENCE_VISIBILITY_WEIGHT = 0.25;
/** An officer of the Watch standing there and seeing it happen. */
export const EVIDENCE_OFFICER_SAW = 0.30;
/** Each citizen who could have seen it, up to EVIDENCE_MAX_WITNESSES of them. */
export const EVIDENCE_PER_WITNESS = 0.05;
export const EVIDENCE_MAX_WITNESSES = 4;
/** A silver tongue muddies the account: rhetoric of 100 is worth this much doubt. */
export const EVIDENCE_RHETORIC_WEIGHT = 1 / 300;
/** How much the hour's own luck moves it, either way. */
export const EVIDENCE_SPREAD = 0.30;
/** No case is beyond doubt, and none is entirely without a thread. */
export const EVIDENCE_FLOOR = 0.05;
export const EVIDENCE_CEILING = 0.90;
/** A victim's own account of what was done to them. */
export const EVIDENCE_VICTIM_REPORT = 0.45;
/** A citizen's account of something that happened to somebody else. */
export const EVIDENCE_WITNESS_REPORT = 0.32;
/** A report with nothing behind it at all. */
export const EVIDENCE_UNCORROBORATED = 0.15;

export interface OffenceContext {
  victimId?: CitizenId;
  amount?: number;
  buildingId?: BuildingId;
  visibilityMod?: number;
}

function fail(message: string): ActionResult { return { ok: false, message }; }

function isDetained(world: World, c: Citizen): boolean {
  return c.detainedUntilTick !== null && c.detainedUntilTick > world.tick;
}

function isPresent(world: World, c: Citizen): boolean {
  return c.standing !== 'exiled' && world.order.includes(c.id);
}

/** Officers on duty: in the Watch, in good standing, not detained, still in the city. */
export function officersOnDuty(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.government.watch) {
    const c = world.citizens[id];
    if (c && c.standing === 'good' && !isDetained(world, c) && isPresent(world, c)) out.push(c);
  }
  return out;
}

/** Other citizens in the same district who could have seen it happen. */
function witnessesOf(world: World, actor: Citizen): number {
  let n = 0;
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.id !== actor.id && c.district === actor.district && c.standing !== 'exiled') n++;
  }
  return n;
}

function currentSeverity(world: World, law: OffenceCode): number {
  return offenceSeverity(world, law);
}

/** Officers on duty who are standing where it happened: the ones who could have seen it. */
export function officersInDistrict(world: World, actor: Citizen): Citizen[] {
  return officersOnDuty(world).filter((o) => o.id !== actor.id && o.district === actor.district);
}

/**
 * What the Watch can put before the Court, 0..1. Public arithmetic: every term
 * is a fact a citizen could count for themselves.
 */
export function evidenceFor(
  world: World, actor: Citizen, law: OffenceCode,
  opts: { witnesses: number; officerSaw: boolean; corroboration?: number },
): number {
  const witnesses = Math.max(0, Math.min(EVIDENCE_MAX_WITNESSES, Math.round(opts.witnesses)));
  let e = EVIDENCE_BASE + offenceVisibility(law) * EVIDENCE_VISIBILITY_WEIGHT;
  if (opts.officerSaw) e += EVIDENCE_OFFICER_SAW;
  e += witnesses * EVIDENCE_PER_WITNESS;
  e += Math.max(0, opts.corroboration ?? 0);
  e -= actor.skills.rhetoric * EVIDENCE_RHETORIC_WEIGHT;
  e += (rand(world) - 0.5) * EVIDENCE_SPREAD;
  return clamp(e, EVIDENCE_FLOOR, EVIDENCE_CEILING);
}

/** One line describing an offence for the charge sheet. */
function describeOffence(world: World, actor: Citizen, law: OffenceCode, ctx: OffenceContext): string {
  const victim = ctx.victimId ? world.citizens[ctx.victimId] : undefined;
  const building = ctx.buildingId ? world.buildings[ctx.buildingId] : undefined;
  const where = world.districts[actor.district]?.name ?? actor.district;
  const parts = [`${offenceName(law)}: ${actor.name}`];
  if (victim) parts.push(`against ${victim.name}`);
  if (ctx.amount && ctx.amount > 0) parts.push(`(${Math.round(ctx.amount)} ℓ)`);
  if (building) parts.push(`at ${building.name}`);
  parts.push(`in ${where}`);
  return parts.join(' ');
}

/**
 * Probability that the Watch notices one offence, from the law's visibility,
 * witnesses, officers on duty, journalistic scrutiny and the actor's silver
 * tongue. Severity-5 offences are never quiet.
 */
export function detectionProbability(
  world: World, actor: Citizen, law: OffenceCode, witnesses: number, officers: number, visibilityMod = 0,
): number {
  const base = clamp(offenceVisibility(law) * 0.35 * (1 + witnesses / 10), 0, 1);
  let p = 1 - Math.pow(1 - base, officers + 0.5);
  p *= 1 + 0.1 * (world.counters.scrutiny ?? 0);
  if ((world.counters[`scrutiny:${actor.id}`] ?? 0) > 0) p += 0.3;
  p += visibilityMod;
  p -= actor.skills.rhetoric / 400;
  p = clamp(p, 0.02, 0.95);
  if (currentSeverity(world, law) >= 5) p = Math.max(p, 0.5);
  return p;
}

/**
 * Record an offence and roll for detection. What the Watch notices becomes a
 * report before the officer who noticed it — with evidence that grows with
 * witnesses — and it is that officer who decides whether to charge it.
 */
export function commitOffence(
  world: World, actorId: CitizenId, law: OffenceCode, ctx: OffenceContext = {},
): { detected: boolean; reportId: ReportId | null } {
  const actor = world.citizens[actorId];
  if (!actor || !(LAWS[law as keyof typeof LAWS] || isPersonLaw(law))) return { detected: false, reportId: null };
  const victim = ctx.victimId && ctx.victimId !== actorId ? world.citizens[ctx.victimId] ?? null : null;
  const amount = Math.max(0, Math.round(ctx.amount ?? 0));

  const offence: OffenceRecord = { tick: world.tick, law, detected: false, victimId: victim?.id ?? null, amount };
  actor.recentOffences.push(offence);
  if (actor.recentOffences.length > RECENT_OFFENCES_LENGTH) {
    actor.recentOffences.splice(0, actor.recentOffences.length - RECENT_OFFENCES_LENGTH);
  }
  actor.stats.offencesCommitted++;

  const onDuty = officersOnDuty(world).filter((o) => o.id !== actorId);
  const present = officersInDistrict(world, actor);
  const witnesses = witnessesOf(world, actor);
  // A curfew empties the streets: what happens under it is easier to see.
  const p = detectionProbability(world, actor, law, witnesses, onDuty.length,
    (ctx.visibilityMod ?? 0) + curfewVisibilityMod(world, actor.district));
  const severity = currentSeverity(world, law);
  const name = offenceName(law).toLowerCase();

  if (!chance(world, p)) {
    if (victim) remember(world, victim.id, 'crime', `Someone committed ${name} against you${amount > 0 ? ` (${amount} ℓ)` : ''}; the Watch saw nothing.`);
    return { detected: false, reportId: null };
  }

  // Noticing is not proving. What the Watch actually holds is built out of an
  // officer's own eyes, the people who were standing there and the mark the
  // act leaves — and it is very often not enough.
  const evidence = evidenceFor(world, actor, law, { witnesses, officerSaw: present.length > 0 });
  offence.detected = true;
  actor.stats.offencesDetected++;
  // The report is made out to an officer who was there if one was, since that
  // is whose account the case rests on.
  const officer = present.length > 0 ? pick(world, present) : (onDuty.length > 0 ? pick(world, onDuty) : null);
  const report = openReport(world, {
    officerId: officer?.id ?? null, suspectId: actorId, law, evidence, victimId: victim?.id, amount,
    description: describeOffence(world, actor, law, ctx),
  });
  const by = officer ? `Officer ${officer.name} made a report (${report.id})` : `the report (${report.id}) waits for an officer`;
  emit(world, 'offence', `The Watch caught ${actor.name} in an act of ${name}${victim ? ` against ${victim.name}` : ''}; ${by}.`,
    victim ? [actorId, victim.id] : [actorId], severity >= 4 ? 0.8 : 0.5, { law, reportId: report.id, evidence });
  remember(world, actorId, 'crime', `The Watch caught you (${name}); ${officer ? `Officer ${officer.name} holds` : 'the Watch holds'} a report against you (${report.id}).`);
  if (victim) remember(world, victim.id, 'crime', `${actor.name} committed ${name} against you and was caught by the Watch (report ${report.id}).`);
  return { detected: true, reportId: report.id };
}

/**
 * **Where the two tracks meet, second crossing** (`docs/JUSTICE.md` §4.2).
 *
 * Violence during a civic offence crosses tracks: strike an officer while
 * being arrested for theft and you are tried for *both* — the theft on the
 * ladder, the assault in custody. Two offences, two reports, two charges, two
 * sentences. Neither is folded into the other, neither is traded for the
 * other, and the custodial half never becomes exile.
 *
 * Returns what the Watch ended up holding on each track.
 */
export function crossTracks(
  world: World, actorId: CitizenId, civic: OffenceCode, person: OffenceCode, ctx: OffenceContext = {},
): { civic: ReportId | null; person: ReportId | null } {
  const actor = world.citizens[actorId];
  if (!actor) return { civic: null, person: null };
  if (trackOf(civic) !== 'city' || trackOf(person) !== 'person') {
    throw new Error('crossTracks: one offence of each code, in that order');
  }
  // Violence in front of the Watch is the loudest thing a citizen can do: both
  // halves are noticed together, and the city is told they are two cases.
  const onLadder = commitOffence(world, actorId, civic, { ...ctx, visibilityMod: (ctx.visibilityMod ?? 0) + 0.2 });
  const inCustody = commitOffence(world, actorId, person, { ...ctx, visibilityMod: (ctx.visibilityMod ?? 0) + 0.2 });
  if (onLadder.detected || inCustody.detected) {
    emit(world, 'offence', `${actor.name} turned violent in the middle of ${offenceName(civic).toLowerCase()}: `
      + `the ${offenceName(civic).toLowerCase()} answers to the ladder and the ${offenceName(person).toLowerCase()} to custody. `
      + 'They are two cases and the city tries both.', [actorId], 0.8,
    { civic, person, tracks: ['city', 'person'] });
    remember(world, actorId, 'crime', `You are answering on both tracks: ${offenceName(civic).toLowerCase()} before the `
      + `ladder and ${offenceName(person).toLowerCase()} before the cells. Neither cancels the other.`);
  }
  return { civic: onLadder.reportId, person: inCustody.reportId };
}

function sameFamily(a: OffenceCode, b: OffenceCode): boolean {
  return a === b || LAW_FAMILIES.some((f) => f.includes(a) && f.includes(b));
}

/** The most recent undetected offence by `accused` matching `law` inside the report window. */
function matchingOffence(world: World, accused: Citizen, law: OffenceCode): OffenceRecord | null {
  for (let i = accused.recentOffences.length - 1; i >= 0; i--) {
    const o = accused.recentOffences[i];
    if (o.detected || world.tick - o.tick > REPORT_WINDOW_TICKS) continue;
    if (sameFamily(o.law, law)) return o;
  }
  return null;
}

/**
 * A citizen reports another to the Watch. The report goes to the Watch's
 * shared inbox, where any officer may take it up: one that matches something
 * the accused actually did (and got away with) carries real evidence, and a
 * baseless one carries almost none — and may bring a report of a False report
 * (L12) down on the citizen who made it.
 */
export function reportOffence(world: World, reporterId: CitizenId, accusedId: CitizenId, law: OffenceCode, text?: string): ActionResult {
  const reporter = world.citizens[reporterId];
  if (!reporter) return fail('Unknown citizen.');
  if (reporter.standing === 'exiled') return fail('Exiles cannot make reports to the Watch.');
  const accused = world.citizens[accusedId];
  if (!accused || !isPresent(world, accused)) return fail('Nobody by that id lives in Reverie.');
  if (accusedId === reporterId) return fail('You cannot report yourself.');
  if (!LAWS[law as keyof typeof LAWS] && !isPersonLaw(law)) return fail('There is no such law.');

  const note = (text ?? '').trim().slice(0, 280);
  const match = matchingOffence(world, accused, law);
  adjustBond(world, reporterId, accusedId, -20);
  // A gang does not wait to hear whether the Watch believed it: one of its own
  // was named, so somebody leans on the citizen who named them. Intimidation is
  // Harassment (L05), and it is charged like it (government/gangs.ts defend).
  defend(world, accusedId, reporterId);

  if (match) {
    const isVictim = match.victimId === reporterId;
    match.detected = true;
    accused.stats.offencesDetected++;
    const actual = match.law;
    // One account, from one citizen, of something that really happened. It is
    // evidence — but a single account is not a proved case, and the bench will
    // want more than the word of one neighbour about another.
    const report = openReport(world, {
      officerId: null, suspectId: accusedId, law: actual,
      evidence: clamp((isVictim ? EVIDENCE_VICTIM_REPORT : EVIDENCE_WITNESS_REPORT)
        + postEvidenceBonus(world, reporterId, accusedId), 0, EVIDENCE_CEILING),
      victimId: match.victimId ?? undefined, amount: match.amount,
      description: `${offenceName(actual)}: ${accused.name}, reported by ${reporter.name}${isVictim ? ' (the victim)' : ''}${note ? ` — "${note}"` : ''}`,
    });
    emit(world, 'offence', `${reporter.name} reported ${accused.name} to the Watch for ${offenceName(actual).toLowerCase()} (${report.id}).`,
      [reporterId, accusedId], 0.3, { law: actual, reportId: report.id, reportedBy: reporterId, track: trackOf(actual) });
    remember(world, reporterId, 'civic', `You reported ${accused.name} for ${offenceName(actual).toLowerCase()}; the Watch opened report ${report.id}.`);
    return { ok: true, message: `The Watch took your report against ${accused.name} (report ${report.id}); an officer decides whether to charge it.` };
  }

  const report = openReport(world, {
    officerId: null, suspectId: accusedId, law, evidence: EVIDENCE_UNCORROBORATED,
    description: `${offenceName(law)}: ${accused.name}, on the uncorroborated word of ${reporter.name}${note ? ` — "${note}"` : ''}`,
  });
  emit(world, 'offence', `${reporter.name} reported ${accused.name} to the Watch for ${offenceName(law).toLowerCase()} (${report.id}); nothing corroborates it.`,
    [reporterId, accusedId], 0.2, { law, reportId: report.id, reportedBy: reporterId, track: trackOf(law) });
  remember(world, reporterId, 'civic', `You reported ${accused.name} for ${offenceName(law).toLowerCase()} (report ${report.id}); the Watch found nothing to corroborate it.`);
  if (chance(world, 0.5)) {
    reporter.recentOffences.push({ tick: world.tick, law: 'L12', detected: true, victimId: accusedId, amount: 0 });
    if (reporter.recentOffences.length > RECENT_OFFENCES_LENGTH) reporter.recentOffences.shift();
    reporter.stats.offencesCommitted++;
    reporter.stats.offencesDetected++;
    const onDuty = officersOnDuty(world).filter((o) => o.id !== reporterId);
    const officer = onDuty.length > 0 ? pick(world, onDuty) : null;
    const counter = openReport(world, {
      // The Watch's own book is the evidence of a false report: it holds the
      // report, and it holds nothing behind it.
      officerId: officer?.id ?? null, suspectId: reporterId, law: 'L12', evidence: 0.7, victimId: accusedId,
      description: `False report: ${reporter.name} accused ${accused.name} of ${offenceName(law).toLowerCase()} without cause`,
    });
    remember(world, reporterId, 'crime', `The Watch made a report of a false report against you (${counter.id}).`);
    return { ok: true, message: `The Watch took your report (${report.id}) but found nothing behind it, and made a report of a false report against you (${counter.id}).` };
  }
  return { ok: true, message: `The Watch took your report against ${accused.name} (report ${report.id}), though it found little to support it.` };
}

/** Join the Watch through an open Watch Officer position. */
export function applyToWatch(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (world.government.watch.includes(cId)) return fail('You already serve in the Watch.');
  const job = openJobs(world).find((j) => j.role === 'watch_officer' && j.employer === 'city');
  if (!job) return fail('The Watch has no openings at the moment.');
  return applyForJob(world, cId, job.id);
}

/** Hold a citizen until `untilTick` (the next Court session). No-op for exiles or past ticks. */
export function detain(world: World, cId: CitizenId, untilTick: number): void {
  const c = world.citizens[cId];
  if (!c || c.standing === 'exiled') return;
  const until = Math.round(untilTick);
  if (until <= world.tick) return;
  if (c.detainedUntilTick !== null && c.detainedUntilTick >= until) return;
  c.detainedUntilTick = until;
  emit(world, 'detained', `The Watch detained ${c.name} until the next sitting of the Court.`, [cId], 0.4, { untilTick: until });
  remember(world, cId, 'crime', `The Watch detained you in the Watch House until the Court sits (tick ${until}).`);
}

/** Release everyone whose detention has expired. */
function releaseDetainees(world: World): void {
  for (const c of Object.values(world.citizens)) {
    if (c.detainedUntilTick === null || c.detainedUntilTick > world.tick) continue;
    c.detainedUntilTick = null;
    if (c.standing !== 'exiled') remember(world, c.id, 'crime', 'The Watch released you from the Watch House.');
  }
}

/**
 * The Watch's hour: detentions run out, scripted officers deal with what is
 * before them, and reports nobody acted on lapse into the record.
 */
export function tickWatch(world: World): void {
  releaseDetainees(world);
  watchSession(world);
  expireReports(world);
}

/** The Mayor's favourite officer (by bond, then analysis); without a Mayor the sharpest one. */
function chooseCaptain(world: World, officers: Citizen[]): Citizen | null {
  if (officers.length === 0) return null;
  const mayorId = world.government.mayorId;
  const ranked = [...officers].sort((a, b) => {
    const bondDiff = mayorId ? bondBetween(world, mayorId, b.id) - bondBetween(world, mayorId, a.id) : 0;
    return bondDiff || b.skills.analysis - a.skills.analysis || a.id.localeCompare(b.id);
  });
  return ranked[0];
}

/** Open Watch positions so the force can grow with the city. */
function ensureWatchJobs(world: World): void {
  const population = world.order.filter((id) => world.citizens[id]?.standing !== 'exiled').length;
  const target = population > WATCH_GROWTH_POPULATION
    ? Math.max(MIN_WATCH_JOBS, Math.floor(population / WATCH_PER_CITIZENS))
    : MIN_WATCH_JOBS;
  const existing = Object.values(world.jobs).filter((j) => j.employer === 'city' && j.role === 'watch_officer').length;
  for (let i = existing; i < target; i++) createCityJob(world, 'watch_officer');
}

/**
 * Daily: scrutiny fades, the roll is pruned, a Captain is appointed when the
 * post is vacant, and the city keeps enough Watch positions open.
 */
export function dailyWatch(world: World): void {
  pruneBribes(world);
  for (const key of Object.keys(world.counters)) {
    if (!key.startsWith('scrutiny:')) continue;
    const left = (world.counters[key] ?? 0) - 1;
    if (left > 0) world.counters[key] = left;
    else delete world.counters[key];
  }
  world.counters.scrutiny = 0;

  const g = world.government;
  g.watch = g.watch.filter((id, i) => {
    const c = world.citizens[id];
    return !!c && isPresent(world, c) && g.watch.indexOf(id) === i;
  });
  if (g.watchCaptainId !== null && !g.watch.includes(g.watchCaptainId)) g.watchCaptainId = null;
  if (g.watchCaptainId === null) {
    const captain = chooseCaptain(world, officersOnDuty(world));
    if (captain) {
      g.watchCaptainId = captain.id;
      const mayor = g.mayorId ? world.citizens[g.mayorId] : null;
      emit(world, 'law', `${captain.name} was appointed Captain of the Watch${mayor ? ` by Mayor ${mayor.name}` : ''}.`,
        mayor ? [captain.id, mayor.id] : [captain.id], 0.4);
      remember(world, captain.id, 'civic', 'You were appointed Captain of the Watch.');
    }
  }
  ensureWatchJobs(world);
}
