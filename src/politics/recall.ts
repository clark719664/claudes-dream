/**
 * Recall — the city taking an office back without waiting for the term
 * (`docs/POLITICS.md` §4), and only where the charter opens the road.
 *
 * `sign_recall { officer }` gathers `recall.share` of the franchise within 14
 * days and forces a recall ballot on the next Stillday, through the same
 * machinery every other question goes to the city by. A majority of the votes
 * cast removes them, and a by-election follows within three days. No officer
 * faces recall in their first seven days or twice in a cycle.
 *
 * Solene's delegates are recallable at 5 %, which is the commune's whole
 * character and its whole cost: no Solene delegate will ever do an unpopular
 * necessary thing.
 */
import type { ActionResult, CitizenId, Referendum, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent } from '../citizens/citizen.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { nextId } from '../util/ids.ts';
import { openNominations } from '../government/elections.ts';
import { charterOf, franchiseThreshold, inFranchise } from './charter.ts';
import type { Recall } from './accountability.ts';
import { accountability, denyCycleCredit, officeOf, vacateOffice } from './accountability.ts';
import { isVoter, putQuestion, questionKindOf, questionSubject, referendumsOfKind, registerQuestion } from './referendums.ts';

/** Days a recall petition may gather names. */
export const RECALL_WINDOW_DAYS = 14;
/** Days after a body takes office before any of it faces a recall. */
export const RECALL_GRACE_DAYS = 7;
/** Days between a recall carrying and the by-election that answers it. */
export const BY_ELECTION_DAYS = 3;

function fail(message: string): ActionResult { return { ok: false, message }; }

function recallCycleKey(officerId: CitizenId, cycle: number): string { return `recall:${officerId}:${cycle}`; }

/** The day the cycle the city is in now began, for the grace period. */
function cycleStartDay(world: World): number {
  return Math.max(0, world.government.election.electionDay - (world.config?.cycleDays ?? 28));
}

/** The names still standing behind a recall: a signature from somebody the city has lost is not counted. */
export function liveRecallSignatures(world: World, r: Recall): number {
  return r.signatures.filter((id) => {
    const s = world.citizens[id];
    return Boolean(s && isPresent(world, s) && isVoter(world, s));
  }).length;
}

/** One public signature toward a recall ballot. */
export function signRecall(world: World, cId: CitizenId, officerId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const ch = charterOf(world);
  if (!ch.recall.allowed) return fail('The charter does not allow a recall; amend it first.');
  if (!inFranchise(world, c)) return fail('Only somebody the charter counts may sign a recall.');
  const officer = world.citizens[officerId];
  if (!officer) return fail('Nobody by that id lives in Reverie.');
  if (!officeOf(world, officerId)) return fail(`${officer.name} holds no office to be recalled from.`);
  if (world.day - cycleStartDay(world) < RECALL_GRACE_DAYS) {
    return fail(`No officer faces a recall in their first ${RECALL_GRACE_DAYS} days.`);
  }
  if (world.counters[recallCycleKey(officerId, world.government.cycle)] !== undefined) {
    return fail(`${officer.name} has already faced a recall this cycle.`);
  }
  const book = accountability(world);
  let r = book.recalls.find((x) => x.officerId === officerId && x.result === 'gathering');
  if (!r) {
    r = {
      id: nextId(world, 'd'), officerId, signatures: [], openedDay: world.day,
      closesDay: world.day + RECALL_WINDOW_DAYS, needed: franchiseThreshold(world, ch.recall.share),
      ballotId: null, result: 'gathering',
    };
    book.recalls.push(r);
  }
  if (r.signatures.includes(cId)) return fail('You have already signed that recall.');
  r.signatures.push(cId);
  r.needed = franchiseThreshold(world, ch.recall.share);
  const live = liveRecallSignatures(world, r);
  emit(world, 'referendum', `${c.name} signed the recall of ${officer.name} (${live}/${r.needed}).`, [cId, officerId],
    live >= r.needed ? 0.8 : 0.3, { recallId: r.id, officer: officerId, signatures: live, needed: r.needed });
  remember(world, cId, 'civic', `You signed the recall of ${officer.name} (${live} of the ${r.needed} names it needs).`);
  if (live >= r.needed) openRecallBallot(world, r);
  return {
    ok: true,
    message: live >= r.needed
      ? `Your name carries the recall of ${officer.name} to a ballot.`
      : `You signed the recall of ${officer.name} (${live}/${r.needed} names).`,
  };
}

/** Where a recall stands today. */
export function recallStanding(world: World, officerId: CitizenId): { signatures: number; needed: number } | null {
  const r = accountability(world).recalls.find((x) => x.officerId === officerId && x.result === 'gathering');
  if (!r) return null;
  return { signatures: liveRecallSignatures(world, r), needed: r.needed };
}

function openRecallBallot(world: World, r: Recall): void {
  const officer = world.citizens[r.officerId];
  const ballot = putQuestion(world, {
    kind: 'recall', subject: r.officerId,
    question: `Shall ${officer?.name ?? r.officerId} be removed from the office of ${officeOf(world, r.officerId) ?? 'their office'}?`,
  });
  r.ballotId = ballot.id;
  r.result = 'ballot';
  world.counters[recallCycleKey(r.officerId, world.government.cycle)] = world.day;
}

/**
 * How a scripted citizen who did not come to the poll reads a recall: what
 * they make of the office as they have watched it run, and how they stand with
 * the officer themselves. A citizen with no reading of that office stays home,
 * and staying home is counted as nothing at all.
 */
export function recallDisposition(world: World, cId: CitizenId, r: Referendum): boolean | null {
  const officerId = questionSubject(r);
  const c = world.citizens[cId];
  if (!c || !officerId || !world.citizens[officerId]) return null;
  const bond = bondBetween(world, cId, officerId);
  if (bond > 40) return false;
  if (bond < -30) return true;
  const g = world.government;
  const reading = c.approval
    ? (g.mayorId === officerId ? c.approval.mayor : g.council.includes(officerId) ? c.approval.council : null)
    : null;
  if (reading === null) return null;
  if (reading < 0.4) return true;
  if (reading > 0.6) return false;
  return null;
}

registerQuestion('recall', { disposition: recallDisposition });

/** Whether a poll before the city is a recall of somebody. */
export function isRecallBallot(r: Referendum): boolean {
  return questionKindOf(r) === 'recall';
}

/** A by-election, three days out: the city fills what it emptied. */
export function callByElection(world: World, why: string): void {
  const e = world.government.election;
  e.electionDay = world.day + BY_ELECTION_DAYS;
  e.nominationsOpenDay = world.day;
  e.resolved = false;
  e.candidates = [];
  e.ballots = {};
  world.counters.nominationsOpenedDay = -1;
  openNominations(world);
  emit(world, 'election', `A by-election is called for day ${e.electionDay}: ${why}.`, [], 0.9,
    { electionDay: e.electionDay, why });
}

/**
 * Morning: petitions that ran out of days lapse, and a ballot the city has
 * answered is carried out — a majority of the votes cast removes the officer,
 * and a by-election follows within three days.
 */
export function dailyRecalls(world: World): void {
  const book = accountability(world);
  for (const r of book.recalls) {
    if (r.result === 'gathering' && world.day > r.closesDay) {
      r.result = 'lapsed';
      const officer = world.citizens[r.officerId];
      emit(world, 'referendum', `The recall of ${officer?.name ?? r.officerId} lapsed with ${liveRecallSignatures(world, r)} of ${r.needed} names.`,
        [r.officerId], 0.4, { recallId: r.id, officer: r.officerId });
      continue;
    }
    if (r.result !== 'ballot' || !r.ballotId) continue;
    const ballot = referendumsOfKind(world, 'recall').find((x) => x.id === r.ballotId);
    if (!ballot || ballot.result === null) continue;
    const officer = world.citizens[r.officerId];
    const office = officeOf(world, r.officerId);
    const removed = ballot.result === 'passed' && office !== null;
    r.result = removed ? 'removed' : 'kept';
    if (!officer) continue;
    if (!removed) {
      const text = `${officer.name} keeps the office: the recall ballot was ${ballot.ayes} to ${ballot.nays}.`;
      emit(world, 'referendum', text, [r.officerId], 0.7, { recallId: r.id, officer: r.officerId, removed: false });
      remember(world, r.officerId, 'civic', text);
      continue;
    }
    const after = vacateOffice(world, r.officerId, office);
    denyCycleCredit(world, r.officerId, office);
    const text = `${officer.name} is recalled by the city, ${ballot.ayes} to ${ballot.nays}. ${after}`;
    emit(world, 'referendum', text, [r.officerId], 1.0, { recallId: r.id, officer: r.officerId, removed: true });
    remember(world, r.officerId, 'civic', text);
    callByElection(world, `the recall of ${officer.name}`);
  }
  const cycle = world.config?.cycleDays ?? 28;
  book.recalls = book.recalls.filter((r) => r.result === 'gathering' || r.result === 'ballot'
    || r.openedDay > world.day - cycle);
}
