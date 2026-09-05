/**
 * Appeals: a convicted citizen's one appeal to the Council, and the Council's
 * decision (uphold, reduce by a tier, overturn).
 *
 * The Council decides by voting. A convicted citizen's appeal appears in every
 * sitting councillor's observation the moment it is filed, and a councillor
 * answers it with the `vote_appeal` action; the votes are counted at the end
 * of the daily session. A majority carries, ties uphold, and an appeal with
 * fewer than two votes is held over once and then upheld by default. Scripted
 * councillors make up their minds by the disposition below and cast their
 * votes through the same `castAppealVote`, so the record reads the same either
 * way. court.ts re-exports all of this.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, AppealResult, Case, Citizen, CitizenId, ObservedAppeal, PenaltyTier, Sentence, World,
} from '../types.ts';
import { offenceName, trackOf } from '../data/laws.ts';
import { bandOf } from './persons.ts';
import { rand } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { areFriends, areRivals, bondBetween } from '../citizens/relationships.ts';
import { byFiling, isPresent, latestConviction, nameOf, sittingCouncil } from './cases.ts';
import { TIER_WARNING, describeSentence, executeSentence, revokeSentence, sentenceForTier } from './sentencing.ts';
import { memo } from '../util/memo.ts';

/** Days after the verdict during which an appeal may be filed. */
export const APPEAL_WINDOW_DAYS = 1;
/** With no Council to hear it, an appeal waits this long before the Court reviews it on the evidence alone. */
export const APPEAL_HOLDOVER_DAYS = 7;
/** Votes a Council needs before it may decide an appeal. */
export const MIN_APPEAL_VOTES = 2;
/** Sessions an appeal is held over for want of votes before it is upheld by default. */
export const MAX_APPEAL_CARRIES = 1;
/** A friend this close votes to overturn rather than merely reduce. */
const DEVOTED_BOND = 70;

function fail(message: string): ActionResult { return { ok: false, message }; }

/** Appeal the latest conviction to the Council, once, within a day of the verdict. */
export function fileAppeal(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing === 'exiled') return fail('Exiles have no standing before the Council.');
  const k = latestConviction(world, cId);
  if (!k) return fail('You have no conviction to appeal.');
  if (k.appeal) return fail(`You have already appealed case ${k.id}.`);
  if (k.status !== 'tried' || k.triedDay === null) return fail(`Case ${k.id} can no longer be appealed.`);
  if (world.day - k.triedDay > APPEAL_WINDOW_DAYS) return fail('The appeal window has closed.');
  k.status = 'appealed';
  k.appeal = { filedDay: world.day, decidedDay: null, result: null, votes: {}, carried: 0 };
  emit(world, 'appeal', `${c.name} appealed their conviction for ${offenceName(k.law).toLowerCase()} (case ${k.id}) to the Council.`,
    [cId], 0.5, { caseId: k.id });
  remember(world, cId, 'civic', `You appealed case ${k.id} to the Council; it will decide at its next session.`);
  return { ok: true, message: `Your appeal in case ${k.id} will be heard at the next Council session.` };
}

/** A councillor's vote: friendship leans lenient, grievance and strictness lean harsh, otherwise the evidence decides. */
export function appealVote(world: World, councillor: Citizen, k: Case): AppealResult {
  const d = world.citizens[k.defendantId];
  if (!d) return 'upheld';
  if (councillor.id === k.victimId || councillor.id === k.filedBy) return 'upheld';
  if (areRivals(world, councillor.id, d.id)) return 'upheld';
  if (areFriends(world, councillor.id, d.id)) return bondBetween(world, councillor.id, d.id) >= DEVOTED_BOND ? 'overturned' : 'reduced';
  const strictness = councillor.platform?.strictness ?? clamp(councillor.personality.honesty * 0.6 + 0.2, 0, 1);
  if (strictness > 0.65) return 'upheld';
  const e = k.evidence + (rand(world) - 0.5) * 0.1 + (strictness - 0.5) * 0.2;
  if (e >= 0.6) return 'upheld';
  if (e < 0.4) return 'overturned';
  return 'reduced';
}

/** Uphold unless a strict majority wants change; the lenient camp then picks reduce (default) or overturn. */
export function appealOutcome(votes: Record<CitizenId, AppealResult>): AppealResult {
  const n = { upheld: 0, reduced: 0, overturned: 0 };
  for (const v of Object.values(votes)) n[v]++;
  const total = n.upheld + n.reduced + n.overturned;
  if (total === 0 || n.upheld * 2 >= total) return 'upheld';
  return n.overturned > n.reduced ? 'overturned' : 'reduced';
}

/** Appeals waiting on the Council, oldest first. */
export function pendingAppeals(world: World): Case[] {
  return memo(world, 'appeals:pending',
    () => Object.values(world.cases).filter((k) => k.status === 'appealed' && k.appeal && k.sentence).sort(byFiling));
}

/**
 * A councillor's vote on an appeal. Votes may be changed until the session
 * counts them, and every one of them is public.
 */
export function castAppealVote(world: World, councillorId: CitizenId, caseId: string, result: AppealResult): ActionResult {
  const k = world.cases[caseId];
  if (!k) return fail('There is no such case.');
  const appeal = k.appeal;
  if (k.status !== 'appealed' || !appeal) return fail(`Case ${k.id} is not before the Council.`);
  const c = world.citizens[councillorId];
  if (!c) return fail('Unknown citizen.');
  if (!sittingCouncil(world).some((m) => m.id === councillorId)) return fail('Only sitting councillors vote on appeals.');
  const changed = appeal.votes[councillorId] !== undefined && appeal.votes[councillorId] !== result;
  appeal.votes[councillorId] = result;
  const name = nameOf(world, k.defendantId);
  emit(world, 'vote', `Councillor ${c.name} voted "${result}" on ${name}'s appeal (case ${k.id}).`,
    [councillorId, k.defendantId], 0.2, { caseId: k.id, councillor: councillorId, result });
  remember(world, councillorId, 'civic', `You voted "${result}" on ${name}'s appeal (case ${k.id}).`);
  return { ok: true, message: `${changed ? 'You changed your vote to' : 'You voted'} "${result}" on case ${k.id}.` };
}

/** The appeals before a councillor, as their observation shows them. */
export function appealsFor(world: World, cId: CitizenId): ObservedAppeal[] {
  if (!sittingCouncil(world).some((m) => m.id === cId)) return [];
  const out: ObservedAppeal[] = [];
  for (const k of pendingAppeals(world)) {
    const appeal = k.appeal;
    const s = k.sentence;
    if (!appeal) continue;
    out.push({
      caseId: k.id, defendant: k.defendantId, defendantName: nameOf(world, k.defendantId),
      law: k.law, lawName: offenceName(k.law), track: trackOf(k.law), evidence: Math.round(k.evidence * 100) / 100,
      verdict: k.verdict,
      sentence: s ? {
        tier: s.tier, fine: s.fine, serviceDays: s.serviceDays, suspensionDays: s.suspensionDays, exile: s.exile,
        jailDays: s.jailDays, life: s.life,
      } : null,
      filedDay: appeal.filedDay, votes: { ...appeal.votes }, youVoted: appeal.votes[cId] ?? null, carried: appeal.carried,
    });
  }
  return out;
}

/**
 * Carry out the Council's decision; returns a phrase describing the effect.
 *
 * A reduction is one rung down the five-rung ladder, and a reduced **exile**
 * is the rung below it: suspension, for the fixed `REDUCED_EXILE_SUSPENSION_DAYS`
 * fortnight (`government/sentencing.ts`). The Council can only ever lower a
 * sentence here — no appeal has ever raised one, and none may reach exile.
 */
function applyAppeal(world: World, k: Case, result: AppealResult): string {
  const s = k.sentence;
  const d = world.citizens[k.defendantId];
  if (!s || !d) return 'the sentence stands';
  if (result === 'upheld') {
    if (!s.executed) executeSentence(world, k);
    return `the sentence of ${describeSentence(s)} stands`;
  }
  if (result === 'overturned') {
    revokeSentence(world, k, 'good');
    return 'the conviction was overturned';
  }
  const wasExile = s.exile;
  // A custodial sentence has no rung to step down: the Council reduces a term
  // by a quarter of what the band gave, never below the floor of the band, and
  // it can never turn custody into a fine or into exile (`JUSTICE.md` §2).
  if (s.track === 'person') {
    revokeSentence(world, k, 'probation');
    k.sentence = reduceCustody(world, k, s);
    executeSentence(world, k);
    return `the sentence was reduced to ${describeSentence(k.sentence)}`;
  }
  revokeSentence(world, k, 'probation');
  const tier = Math.max(TIER_WARNING, (s.tier ?? TIER_WARNING) - 1) as PenaltyTier;
  k.sentence = sentenceForTier(world, k, tier, { fromExile: wasExile });
  executeSentence(world, k);
  return `the sentence was reduced to ${describeSentence(k.sentence)}`;
}

/** How much of a custodial term an appeal on sentence can take off. */
export const CUSTODY_APPEAL_REDUCTION = 0.25;

/**
 * A reduced custodial sentence: a quarter off the days, held at the floor of
 * the band the code prescribes. A **life** term is never reduced by any
 * multiplier — erasure least of all, which only a Council pardon can ever
 * open (`docs/JUSTICE.md` §3).
 */
function reduceCustody(world: World, k: Case, s: Sentence): Sentence {
  if (s.life) return { ...s, executed: false, executeOnDay: null };
  const floor = bandOf(k.law).min;
  const days = Math.max(floor, Math.round(s.jailDays * (1 - CUSTODY_APPEAL_REDUCTION)));
  return { ...s, jailDays: days, executed: false, executeOnDay: null };
}

/** "Ada upheld, Bram reduced" — how the Council divided, by name. */
function describeAppealVotes(world: World, votes: Record<CitizenId, AppealResult>): string {
  const rows = Object.entries(votes).map(([id, v]) => `${nameOf(world, id)} ${v}`);
  return rows.length > 0 ? rows.join(', ') : 'nobody voted';
}

/**
 * Count the votes on every pending appeal (called from the daily council
 * session). Councillors who think for themselves have voted by now; scripted
 * ones make up their minds here. With no Council sitting, appeals are held
 * over; after a week the Court reviews them on the evidence alone so nobody
 * waits forever.
 */
export function decideAppeals(world: World): void {
  const appealed = pendingAppeals(world);
  if (appealed.length === 0) return;
  const council = sittingCouncil(world);
  for (const k of appealed) {
    const appeal = k.appeal;
    if (!appeal) continue;
    const d = world.citizens[k.defendantId];
    const present = !!d && isPresent(world, d);
    const overdue = world.day - appeal.filedDay >= APPEAL_HOLDOVER_DAYS;
    if (council.length === 0 && present && !overdue) {
      if (world.counters.appealsHeldOverDay !== world.day) {
        world.counters.appealsHeldOverDay = world.day;
        emit(world, 'appeal', 'No Council sits to hear appeals; they are held over until one is seated.', [], 0.3);
      }
      continue;
    }
    if (present) {
      for (const m of council) {
        if (m.brain === 'reflex' && appeal.votes[m.id] === undefined) castAppealVote(world, m.id, k.id, appealVote(world, m, k));
      }
    }
    const byCourt = council.length === 0 && present;
    const cast = Object.keys(appeal.votes).length;
    if (present && !byCourt && cast < MIN_APPEAL_VOTES && appeal.carried < MAX_APPEAL_CARRIES) {
      appeal.carried += 1;
      emit(world, 'appeal', `The Council did not decide ${nameOf(world, k.defendantId)}'s appeal (case ${k.id}): `
        + `${cast} of ${council.length} councillors voted. It is held over to the next session.`,
      [k.defendantId, ...council.map((m) => m.id)], 0.4, { caseId: k.id, carried: appeal.carried });
      if (d) remember(world, d.id, 'civic', `The Council did not vote on your appeal (case ${k.id}); it waits for the next session.`);
      continue;
    }
    const result: AppealResult = byCourt
      ? (k.evidence >= 0.6 ? 'upheld' : 'reduced')
      : cast < MIN_APPEAL_VOTES ? 'upheld' : appealOutcome(appeal.votes);
    appeal.result = result;
    appeal.decidedDay = world.day;
    const effect = d ? applyAppeal(world, k, result) : 'the defendant has left the city';
    k.status = 'closed';

    const name = nameOf(world, k.defendantId);
    const offence = offenceName(k.law).toLowerCase();
    const who = byCourt ? 'With no Council seated, the Court reviewed and' : 'The Council';
    const verb = result === 'upheld' ? 'upheld' : result === 'reduced' ? 'reduced' : 'overturned';
    const how = byCourt ? 'on the evidence alone'
      : cast < MIN_APPEAL_VOTES ? 'with too few votes to decide it, so it stands'
        : describeAppealVotes(world, appeal.votes);
    emit(world, 'appeal', `${who} ${verb} ${name}'s conviction for ${offence} (case ${k.id}; ${how}): ${effect}.`,
      [k.defendantId, ...council.map((m) => m.id)], result === 'upheld' ? 0.6 : 0.7, { caseId: k.id, result, votes: { ...appeal.votes } });
    if (d) remember(world, d.id, 'verdict', `Your appeal in case ${k.id} was decided (${how}): ${effect}.`);
    if (k.victimId) remember(world, k.victimId, 'verdict', `${name}'s appeal (case ${k.id}) was decided: ${effect}.`);
    for (const m of council) {
      const mine = appeal.votes[m.id];
      remember(world, m.id, 'civic', `${mine ? `You voted "${mine}" on` : 'You did not vote on'} ${name}'s appeal; the Council ruled: ${effect}.`);
    }
  }
}
