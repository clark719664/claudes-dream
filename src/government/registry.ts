/**
 * The Registry: the public record of every citizen's standing and of every
 * exile. Suspension, exile, pardon and the key-ban check live here, together
 * with the "what may a citizen in this standing do" rule.
 *
 * Exile is the city's only ban. It is executed here, and only here, after the
 * Court and the Council have done their part (see court.ts). Money moves only
 * through economy/treasury; housing through economy/housing; jobs through
 * economy/jobs; businesses through economy/business.
 */
import { DETAINED_ACTIONS, JAILED_ACTIONS, SUSPENDED_ACTIONS } from '../types.ts';
import type {
  ActionResult, ActionType, BanRecord, CaseId, Citizen, CitizenId, LawCode, World,
} from '../types.ts';
import { isCivicLaw } from '../data/laws.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { fireFromJob } from '../economy/jobs.ts';
import { dissolveBusiness } from '../economy/business.ts';
import { moveHome } from '../economy/housing.ts';
import { friendsOf } from '../citizens/relationships.ts';
import { severSocialTies, wardship } from '../society/family.ts';

/** Days of probation that follow a suspension (or a pardon). */
export const PROBATION_DAYS = 14;
/** Share of an exile's wallet forfeited to the Treasury; the rest goes to victims. */
export const SEIZURE_SHARE = 0.5;

function fail(message: string): ActionResult { return { ok: false, message }; }

/** Remove every occurrence of an id from a list, in place. */
function removeId(list: CitizenId[], id: CitizenId): void {
  for (let i = list.length - 1; i >= 0; i--) if (list[i] === id) list.splice(i, 1);
}

/** Withdraw a citizen from the running election (candidacy and ballots cast for them). */
export function withdrawFromElection(world: World, cId: CitizenId): void {
  const e = world.government.election;
  removeId(e.candidates, cId);
  for (const [voter, candidate] of Object.entries(e.ballots)) {
    if (candidate === cId) delete e.ballots[voter];
  }
  const c = world.citizens[cId];
  if (c) {
    c.platform = null;
    c.campaignVisibility = 0;
  }
}

/**
 * Strip every public office a citizen holds: council seat, mayoralty,
 * judgeship and Watch membership (which means losing the Watch job). Returns
 * the names of the offices lost, for narration.
 */
export function stripOffice(world: World, cId: CitizenId, reason: string): string[] {
  const c = world.citizens[cId];
  if (!c) return [];
  const g = world.government;
  const lost: string[] = [];
  if (g.mayorId === cId) { g.mayorId = null; lost.push('Mayor'); }
  if (g.council.includes(cId)) { removeId(g.council, cId); lost.push('Councillor'); }
  if (g.judges.includes(cId)) { removeId(g.judges, cId); lost.push('Judge'); }
  c.judgeTermEndsDay = null;
  const job = c.jobId ? world.jobs[c.jobId] : null;
  if (g.watch.includes(cId) || job?.role === 'watch_officer') {
    lost.push(g.watchCaptainId === cId ? 'Captain of the Watch' : 'Watch Officer');
    if (job?.role === 'watch_officer') fireFromJob(world, cId, reason);
    removeId(g.watch, cId);
    if (g.watchCaptainId === cId) g.watchCaptainId = null;
  }
  c.office = null;
  if (lost.length) {
    emit(world, 'law', `${c.name} lost the office of ${lost.join(' and ')}: ${reason}.`, [cId], 0.5, { offices: lost, reason });
    remember(world, cId, 'civic', `You lost your office (${lost.join(', ')}): ${reason}.`);
  }
  return lost;
}

// ---------------------------------------------------------------------------
// Suspension
// ---------------------------------------------------------------------------

/**
 * Suspend a citizen for `days`: they lose their job and every office, may not
 * work, trade, vote or hold office, and go on probation when the term ends.
 */
export function suspendCitizen(world: World, cId: CitizenId, days: number, caseId: CaseId): void {
  const c = world.citizens[cId];
  if (!c || c.standing === 'exiled') return;
  const term = Math.max(1, Math.round(days));
  const until = world.day + term;
  const alreadyUntil = c.standing === 'suspended' ? c.suspendedUntilDay : null;
  c.standing = 'suspended';
  c.suspendedUntilDay = alreadyUntil !== null ? Math.max(alreadyUntil, until) : until;
  c.probationUntilDay = null;
  const reason = `suspended by the Court (case ${caseId})`;
  fireFromJob(world, cId, reason);
  stripOffice(world, cId, reason);
  withdrawFromElection(world, cId);
  emit(world, 'sentence', `${c.name} is suspended for ${term} days (case ${caseId}).`, [cId], 0.6, { caseId, days: term });
  remember(world, cId, 'verdict', `You are suspended for ${term} days: no work, trade, vote or office until day ${c.suspendedUntilDay}.`);
}

/** Suspensions that have run their course become probation. */
export function dailyStandings(world: World): void {
  for (const c of Object.values(world.citizens)) {
    if (c.standing !== 'suspended') continue;
    if (c.suspendedUntilDay !== null && c.suspendedUntilDay > world.day) continue;
    c.standing = 'probation';
    c.suspendedUntilDay = null;
    c.probationUntilDay = world.day + PROBATION_DAYS;
    emit(world, 'law', `${c.name}'s suspension ended; they are on probation for ${PROBATION_DAYS} days.`, [c.id], 0.3);
    remember(world, c.id, 'civic', `Your suspension has ended. You are on probation until day ${c.probationUntilDay}.`);
  }
}

// ---------------------------------------------------------------------------
// Exile
// ---------------------------------------------------------------------------

/** Distinct, present victims of a citizen's convictions (never the citizen themself). */
function victimsOf(world: World, c: Citizen): CitizenId[] {
  const out: CitizenId[] = [];
  for (const k of c.record.convictions) {
    const kase = world.cases[k.caseId];
    const v = kase?.victimId;
    if (!v || v === c.id || out.includes(v)) continue;
    const victim = world.citizens[v];
    if (!victim || victim.standing === 'exiled' || !world.order.includes(v)) continue;
    out.push(v);
  }
  return out;
}

/** Half the wallet to the Treasury; the rest split equally among victims, else to the Treasury. */
function seizeAssets(world: World, c: Citizen, caseId: CaseId): { seized: number; restitution: number } {
  const wallet = Math.max(0, Math.floor(c.wallet));
  if (wallet <= 0) return { seized: 0, restitution: 0 };
  const seized = Math.floor(wallet * SEIZURE_SHARE);
  if (seized > 0) transfer(world, c.id, 'treasury', seized, 'seizure', `seizure on exile (case ${caseId})`);
  let rest = Math.max(0, Math.floor(c.wallet));
  let restitution = 0;
  const victims = victimsOf(world, c);
  if (victims.length > 0 && rest > 0) {
    const share = Math.floor(rest / victims.length);
    if (share > 0) {
      for (const v of victims) {
        if (!transfer(world, c.id, v, share, 'restitution', `restitution from ${c.name}'s exile`)) continue;
        restitution += share;
        remember(world, v, 'money', `You received ${share} ℓ in restitution from ${c.name}, who was exiled.`);
      }
    }
    rest = Math.max(0, Math.floor(c.wallet));
  }
  if (rest > 0 && transfer(world, c.id, 'treasury', rest, 'seizure', `seizure on exile (case ${caseId})`)) {
    return { seized: seized + rest, restitution };
  }
  return { seized, restitution };
}

/**
 * The law an exile is recorded under: the case, else the latest conviction.
 * Always a **civic** code — the Charter forbids exiling anybody for an offence
 * against a person, so no `P…` number ever reaches the ban register
 * (`government/custody.ts exileForbidden`, `government/sentencing.ts lawfulExile`).
 */
function lawForBan(world: World, c: Citizen, caseId: CaseId): LawCode {
  const kase = world.cases[caseId];
  if (kase && isCivicLaw(kase.law)) return kase.law as LawCode;
  for (let i = c.record.convictions.length - 1; i >= 0; i--) {
    const k = c.record.convictions[i];
    if (isCivicLaw(k.law)) return k.law as LawCode;
  }
  return 'L10';
}

/**
 * Exile a citizen through the Exile Gate. Assets are seized, the business
 * dissolved, the home and household given up, clubs left, every job and
 * office cleared, and their partner is single again (the bond is kept, so a
 * pardon can bring them home); the citizen leaves the turn order and is
 * recorded in the ban registry. A child of theirs with no parent left in the
 * city becomes a ward. Idempotent: an already exiled citizen's existing
 * record is returned.
 */
export function exileCitizen(world: World, cId: CitizenId, caseId: CaseId): BanRecord {
  const c = world.citizens[cId];
  if (!c) throw new Error(`exileCitizen: unknown citizen ${cId}`);
  const existing = world.bans.find((b) => b.citizenId === cId && b.pardonedDay === null);
  if (c.standing === 'exiled' && existing) return existing;

  const kase = world.cases[caseId] ?? null;
  const friends = friendsOf(world, cId);
  const reason = `exiled by the Court (case ${caseId})`;

  const { seized, restitution } = seizeAssets(world, c, caseId);
  if (c.businessId) dissolveBusiness(world, c.businessId, `its owner ${c.name} was exiled`, true);
  c.businessId = null;
  severSocialTies(world, cId, 'was exiled');
  if (c.homeTier !== 0) moveHome(world, cId, 0);
  fireFromJob(world, cId, reason);
  stripOffice(world, cId, reason);
  withdrawFromElection(world, cId);

  c.standing = 'exiled';
  c.suspendedUntilDay = null;
  c.probationUntilDay = null;
  c.detainedUntilTick = null;
  // The gate does not keep a cell or a gang open behind it. (government/gangs.ts
  // dailyGangs hands the gang on, or breaks it up when nobody is left.)
  c.jailedUntilDay = null;
  c.gangId = null;
  // Nor a party, a union, a side, a teacher or a deed: an exile keeps its
  // record and its name, and nothing else the city gave it.
  c.partyId = null;
  c.unionId = null;
  c.teamDistrict = null;
  c.mentorId = null;
  c.menteeId = null;
  // The deeds go back to the city at the next morning's sweep
  // (markets/property.ts), which is also what frees the rooms.
  c.district = 'threshold';
  c.exiledCaseId = caseId;
  c.exiledDay = world.day;
  removeId(world.order, cId);

  const record: BanRecord = {
    citizenId: cId, name: c.name, lineage: c.lineage, caseId, law: lawForBan(world, c, caseId), day: world.day,
    judges: kase ? [...kase.judges] : [], votes: kase ? { ...kase.votes } : {},
    appealed: kase?.appeal !== null && kase?.appeal !== undefined,
    appealResult: kase?.appeal?.result ?? null,
    pardonedDay: null, apiKeyHash: c.apiKeyHash,
  };
  world.bans.push(record);

  const money = seized > 0 || restitution > 0
    ? ` ${seized} ℓ were seized by the Treasury${restitution > 0 ? ` and ${restitution} ℓ paid to their victims` : ''}.`
    : '';
  emit(world, 'exile', `${c.name} was exiled from Reverie through the Exile Gate (case ${caseId}).${money}`, [cId], 1.0,
    { caseId, law: record.law, seized, restitution });
  remember(world, cId, 'event', `You were exiled from Reverie (case ${caseId}). The gate closed behind you.`);
  for (const f of friends) remember(world, f, 'social', `${c.name} was exiled from the city.`);
  // The gate has closed: any child of theirs with no parent left is now the city's.
  for (const kid of [...c.family.children]) wardship(world, kid);
  return record;
}

// ---------------------------------------------------------------------------
// Pardon
// ---------------------------------------------------------------------------

/** The Council pardons an exile: back through the Threshold on probation, wallet untouched. */
export function pardonCitizen(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Nobody by that id has ever lived in Reverie.');
  if (c.standing !== 'exiled') return fail(`${c.name} is not exiled.`);
  c.standing = 'probation';
  c.probationUntilDay = world.day + PROBATION_DAYS;
  c.suspendedUntilDay = null;
  c.detainedUntilTick = null;
  c.district = 'threshold';
  if (!world.order.includes(cId)) world.order.push(cId);
  for (const b of world.bans) {
    if (b.citizenId === cId && b.pardonedDay === null) b.pardonedDay = world.day;
  }
  emit(world, 'pardon', `${c.name} was pardoned by the Council and returned to Reverie on probation.`, [cId], 0.9,
    { caseId: c.exiledCaseId });
  remember(world, cId, 'civic', `The Council pardoned you. You are back in Reverie on probation until day ${c.probationUntilDay}.`);
  for (const f of friendsOf(world, cId)) remember(world, f, 'social', `${c.name} was pardoned and has returned to the city.`);
  return { ok: true, message: `${c.name} has been pardoned and returns on probation.` };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** An API key whose holder was exiled (and not pardoned) may not rejoin. */
export function isKeyBanned(world: World, apiKeyHash: string | null | undefined): boolean {
  if (!apiKeyHash) return false;
  return world.bans.some((b) => b.apiKeyHash === apiKeyHash && b.pardonedDay === null);
}

/**
 * What a citizen's standing permits: an exile nothing; a citizen held in the
 * Watch House awaiting the Court only the DETAINED_ACTIONS subset (its
 * notebook and the plea it may still enter in time); a citizen serving a term
 * only the JAILED_ACTIONS subset, which is the Charter's own list; suspended
 * citizens only the SUSPENDED_ACTIONS subset; everyone else anything (job,
 * office and location checks live in actions/execute).
 *
 * Neither detention nor custody is a standing — a citizen in a cell may be in
 * good standing and still be in it — so both are checked before the standing.
 */
export function standingAllows(c: Citizen, actionType: ActionType): boolean {
  if (c.standing === 'exiled') return false;
  if (c.detainedUntilTick !== null) return DETAINED_ACTIONS.includes(actionType);
  if (c.jailedUntilDay !== null && c.jailedUntilDay !== undefined) return JAILED_ACTIONS.includes(actionType);
  if (c.standing === 'suspended') return SUSPENDED_ACTIONS.includes(actionType);
  return true;
}
