/**
 * Appeals: a convicted citizen's one appeal to the Council, and the Council's
 * decision (uphold, reduce by a tier, overturn). court.ts re-exports these.
 */
import { clamp } from '../types.ts';
import type { ActionResult, AppealResult, Case, Citizen, CitizenId, PenaltyTier, World } from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { rand } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { areFriends, areRivals, bondBetween } from '../citizens/relationships.ts';
import { byFiling, isPresent, latestConviction, nameOf, sittingCouncil } from './cases.ts';
import { describeSentence, executeSentence, revokeSentence, sentenceForTier } from './sentencing.ts';

/** Days after the verdict during which an appeal may be filed. */
export const APPEAL_WINDOW_DAYS = 1;
/** With no Council to hear it, an appeal waits this long before the Court reviews it on the evidence alone. */
export const APPEAL_HOLDOVER_DAYS = 7;
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
  k.appeal = { filedDay: world.day, decidedDay: null, result: null, votes: {} };
  emit(world, 'appeal', `${c.name} appealed their conviction for ${LAWS[k.law].name.toLowerCase()} (case ${k.id}) to the Council.`,
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

/** Carry out the Council's decision; returns a phrase describing the effect. */
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
  revokeSentence(world, k, 'probation');
  const tier = Math.max(1, s.tier - 1) as PenaltyTier;
  k.sentence = sentenceForTier(world, k, tier, { fromExile: wasExile });
  executeSentence(world, k);
  return `the sentence was reduced to ${describeSentence(k.sentence)}`;
}

/**
 * The Council decides every pending appeal (called from the daily council
 * session). With no Council sitting, appeals are held over; after a week the
 * Court reviews them on the evidence alone so nobody waits forever.
 */
export function decideAppeals(world: World): void {
  const appealed = Object.values(world.cases).filter((k) => k.status === 'appealed' && k.appeal && k.sentence).sort(byFiling);
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
    const votes: Record<CitizenId, AppealResult> = {};
    if (present) for (const m of council) votes[m.id] = appealVote(world, m, k);
    const byCourt = council.length === 0 && present;
    const result: AppealResult = byCourt ? (k.evidence >= 0.6 ? 'upheld' : 'reduced') : appealOutcome(votes);
    appeal.votes = votes;
    appeal.result = result;
    appeal.decidedDay = world.day;
    const effect = d ? applyAppeal(world, k, result) : 'the defendant has left the city';
    k.status = 'closed';

    const name = nameOf(world, k.defendantId);
    const offence = LAWS[k.law].name.toLowerCase();
    const who = byCourt ? 'With no Council seated, the Court reviewed and' : 'The Council';
    const verb = result === 'upheld' ? 'upheld' : result === 'reduced' ? 'reduced' : 'overturned';
    emit(world, 'appeal', `${who} ${verb} ${name}'s conviction for ${offence} (case ${k.id}): ${effect}.`,
      [k.defendantId, ...council.map((m) => m.id)], result === 'upheld' ? 0.6 : 0.7, { caseId: k.id, result, votes });
    if (d) remember(world, d.id, 'verdict', `Your appeal in case ${k.id} was decided: ${effect}.`);
    if (k.victimId) remember(world, k.victimId, 'verdict', `${name}'s appeal (case ${k.id}) was decided: ${effect}.`);
    for (const m of council) remember(world, m.id, 'civic', `You voted "${votes[m.id]}" on ${name}'s appeal; the Council ruled: ${effect}.`);
  }
}
