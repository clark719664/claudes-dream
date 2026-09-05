/**
 * Referendums — the day the city answers a question itself.
 *
 * Any citizen may petition the Council; a petition that gathers the
 * signatures of PETITION_SHARE of the city's voters stops being a request and
 * becomes a question, put to everybody on the next Stillday at
 * REFERENDUM_HOUR. Every voter has one vote, cast by their own hand; the
 * scripted minds that have not voted by the hour make their minds up the way
 * they would on the Council floor, and minds that think for themselves and
 * did not come to the poll simply abstain — nobody votes on anybody's behalf.
 *
 * A majority carries it (a tie fails), and a carried referendum **binds the
 * Council**: the proposal is enacted there and then, without a Council vote,
 * even where the Council has already rejected it. That is the whole point of
 * the mechanism, and the Chronicle says so when it happens.
 */
import type { ActionResult, Citizen, CitizenId, Proposal, ProposalId, Referendum, World } from '../types.ts';
import { PETITION_SHARE, REFERENDUM_WEEKDAY } from '../data/metropolis.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { isEligibleVoter, isPresent } from '../citizens/citizen.ts';
import { councillorDisposition, enactProposal } from '../government/council.ts';
import { weekday } from '../society/calendar.ts';
import { memo } from '../util/memo.ts';

/** How long a petition the Council has rejected may still be taken up by the city. */
export const PETITION_REVIVAL_DAYS = 7;

/** What a citizen sees of the question before the city. */
export interface ObservedReferendum {
  id: string;
  question: string;
  day: number;
  /** How this citizen voted, or null if they have not. */
  youVoted: boolean | null;
}

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The city's referendums, past and pending. An older save has none. */
function referendumList(world: World): Referendum[] {
  const w = world as { referendums?: Referendum[] };
  if (!w.referendums) w.referendums = [];
  return w.referendums;
}

/** The names on a petition. Older saves carry none. */
function signaturesOf(p: Proposal): CitizenId[] {
  const q = p as Proposal & { signatures?: CitizenId[] };
  if (!q.signatures) q.signatures = [];
  return q.signatures;
}

/**
 * The names that still count: a petition is the city asking for something, so
 * a signature from somebody the Gate or the Threshold has since taken away is
 * kept in the record and left out of the count. The list itself is never
 * rewritten — what a citizen signed, they signed.
 */
export function liveSignatures(world: World, p: Proposal): CitizenId[] {
  return signaturesOf(p).filter((id) => {
    const c = world.citizens[id];
    return Boolean(c && isPresent(world, c));
  });
}

function voteKey(referendumId: string, cId: CitizenId): string { return `ref:${referendumId}:${cId}`; }

function isJailed(world: World, c: Citizen): boolean {
  return c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day;
}

/** Grown, in the city, in standing to vote, and not held anywhere. */
export function isVoter(world: World, c: Citizen): boolean {
  if (!c || c.lifeStage === 'child') return false;
  return isEligibleVoter(world, c) && !isJailed(world, c);
}

function voters(world: World): Citizen[] {
  return memo(world, 'referendum:voters', () => votersNow(world));
}

function votersNow(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && isVoter(world, c)) out.push(c);
  }
  return out;
}

/** Signatures a petition needs today: a fifth of the city's voters, never fewer than one. */
export function signaturesNeeded(world: World): number {
  return Math.max(1, Math.ceil(PETITION_SHARE * voters(world).length));
}

/** Where a petition stands: the names still in the city, and what it needs. */
export function petitionStanding(
  world: World, proposalId: ProposalId, cId?: CitizenId,
): { signatures: number; needed: number; youSigned: boolean; crossed: boolean } | null {
  const p = world.government.proposals.find((x) => x.id === proposalId);
  if (!p || !p.petition) return null;
  const signatures = liveSignatures(world, p).length;
  const needed = signaturesNeeded(world);
  return {
    signatures, needed,
    youSigned: cId !== undefined && signaturesOf(p).includes(cId),
    crossed: signatures >= needed,
  };
}

/** The referendum already called on a petition, if there is one. */
export function referendumFor(world: World, proposalId: ProposalId): Referendum | null {
  return referendumList(world).find((r) => r.petitionId === proposalId) ?? null;
}

/** The question waiting to be put, if any. */
export function pendingReferendum(world: World): Referendum | null {
  return referendumList(world).find((r) => r.result === null && r.day >= world.day) ?? null;
}

/** The poll the city goes to today, if it goes to one. */
export function referendumToday(world: World): Referendum | null {
  return referendumList(world).find((r) => r.result === null && r.day === world.day) ?? null;
}

/** Whether a petition can still be signed: before the Council decides it, or shortly after it says no. */
function signable(world: World, p: Proposal): boolean {
  if (!p.petition) return false;
  if (p.status === 'open') return true;
  if (p.status !== 'failed' || p.decidedDay === null) return false;
  return world.day - p.decidedDay <= PETITION_REVIVAL_DAYS;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/** Put your name to a petition. One name each; the twentieth of the city puts it to the vote. */
export function signPetition(world: World, cId: CitizenId, proposalId: ProposalId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (c.lifeStage === 'child') return fail('You must be grown to sign a petition.');
  if (isJailed(world, c)) return fail('You cannot sign a petition from the cells.');
  if (!isVoter(world, c)) return fail(`You cannot sign a petition while ${c.standing}.`);
  const p = world.government.proposals.find((x) => x.id === proposalId);
  if (!p) return fail('There is no such proposal.');
  if (!p.petition) return fail('That is a councillor\'s proposal, not a petition; only petitions are signed.');
  if (referendumFor(world, p.id)) return fail('That petition is already before the city.');
  if (!signable(world, p)) return fail(`Petition ${p.id} is closed.`);
  const names = signaturesOf(p);
  if (names.includes(cId)) return fail('You have already signed that petition.');
  names.push(cId);
  const standing = liveSignatures(world, p).length;
  const needed = signaturesNeeded(world);
  const crossed = standing >= needed;
  emit(world, 'referendum', `${c.name} signed ${world.citizens[p.proposerId]?.name ?? p.proposerId}'s petition (${standing}/${needed}): ${p.summary}`,
    [cId], crossed ? 0.6 : 0.2, { proposalId: p.id, signatures: standing, needed });
  remember(world, cId, 'civic', `You signed petition ${p.id} (${p.summary}) — ${standing} of the ${needed} names it needs.`);
  return {
    ok: true,
    message: crossed
      ? `Your name is the ${standing}th on petition ${p.id}: it has the names it needs and goes to the city.`
      : `You signed petition ${p.id} (${standing}/${needed} names).`,
  };
}

// ---------------------------------------------------------------------------
// Calling the vote
// ---------------------------------------------------------------------------

/** The next Stillday. A petition that crosses on a Stillday waits for the following one. */
export function nextReferendumDay(world: World): number {
  const ahead = ((REFERENDUM_WEEKDAY - weekday(world) + 7) % 7) || 7;
  return world.day + ahead;
}

/** Put a petition to the city on the next Stillday. */
export function openReferendum(world: World, p: Proposal): Referendum {
  const existing = referendumFor(world, p.id);
  if (existing) return existing;
  const r: Referendum = {
    id: nextId(world, 'd'), petitionId: p.id, question: p.summary,
    day: nextReferendumDay(world), ayes: 0, nays: 0, result: null,
  };
  referendumList(world).push(r);
  const who = world.citizens[p.proposerId]?.name ?? p.proposerId;
  emit(world, 'referendum', `${who}'s petition goes to the city: "${r.question}" is put to a vote on day ${r.day}.`,
    [p.proposerId], 0.8, { referendumId: r.id, proposalId: p.id, day: r.day });
  for (const c of voters(world)) {
    remember(world, c.id, 'civic', `The city votes on day ${r.day}: ${r.question} (referendum ${r.id}).`);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

/** Cast your vote, on the day, once. */
export function voteReferendum(world: World, cId: CitizenId, referendumId: string, aye: boolean): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const r = referendumList(world).find((x) => x.id === referendumId);
  if (!r) return fail('There is no such referendum.');
  if (r.result !== null) return fail('That question has been answered.');
  if (r.day !== world.day) return fail(`The city votes on that on day ${r.day}.`);
  if (c.lifeStage === 'child') return fail('You must be grown to vote.');
  if (isJailed(world, c)) return fail('You cannot vote from the cells.');
  if (!isVoter(world, c)) return fail(`You cannot vote while ${c.standing}.`);
  const key = voteKey(r.id, cId);
  if (world.counters[key] !== undefined) return fail('You have already voted in this referendum.');
  world.counters[key] = aye ? 1 : 0;
  if (aye) r.ayes++; else r.nays++;
  c.stats.votesCast++;
  emit(world, 'vote', `${c.name} voted in the referendum.`, [cId], 0.1, { referendumId: r.id });
  remember(world, cId, 'civic', `You voted ${aye ? 'aye' : 'nay'} on "${r.question}".`);
  return { ok: true, message: `You voted ${aye ? 'aye' : 'nay'} on "${r.question}".` };
}

/**
 * The poll closes. Scripted citizens who never came make their minds up the
 * way they would on the Council floor; minds of their own that stayed away
 * abstain, and their silence is counted as nothing at all.
 */
export function holdReferendum(world: World): void {
  const r = referendumToday(world);
  if (r) closePoll(world, r);
}

/** Count the votes, answer the question, and do what the answer says. */
function closePoll(world: World, r: Referendum): void {
  const p = world.government.proposals.find((x) => x.id === r.petitionId) ?? null;
  for (const c of voters(world)) {
    if (c.brain !== 'reflex') continue;
    if (world.counters[voteKey(r.id, c.id)] !== undefined) continue;
    const aye = p ? councillorDisposition(world, c.id, p) : false;
    world.counters[voteKey(r.id, c.id)] = aye ? 1 : 0;
    if (aye) r.ayes++; else r.nays++;
    c.stats.votesCast++;
  }
  const passed = r.ayes > r.nays;
  r.result = passed ? 'passed' : 'failed';
  const overruled = passed && p !== null && p.status === 'failed';
  let outcome: string;
  if (passed && p) {
    if (p.status === 'passed') outcome = 'The Council had already passed it; the city agrees.';
    else {
      p.status = 'passed';
      p.decidedDay = world.day;
      enactProposal(world, p);
      outcome = overruled ? 'The Council rejected it; the city has overruled the Council.' : 'The Council is bound by it.';
    }
  } else if (passed) {
    outcome = 'The proposal it stood on is gone; nothing changed.';
  } else {
    if (p && p.status === 'open') { p.status = 'failed'; p.decidedDay = world.day; }
    outcome = r.ayes + r.nays === 0 ? 'Nobody came to the poll.' : r.ayes === r.nays ? 'A tied vote fails.' : 'The city said no.';
  }
  const text = `Referendum ${r.id}: "${r.question}" — ${r.ayes} ayes, ${r.nays} nays. ${passed ? 'Carried' : 'Rejected'}. ${outcome}`;
  emit(world, 'referendum', text, [], 1.0,
    { referendumId: r.id, proposalId: r.petitionId, ayes: r.ayes, nays: r.nays, passed, overruled });
  for (const c of voters(world)) remember(world, c.id, 'civic', text);
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

/**
 * Morning: a petition that has the names it needs is called (one question at a
 * time — the city answers them in the order they filled up), and answered
 * questions older than a cycle are cleared away.
 */
export function dailyReferendums(world: World): void {
  const list = referendumList(world);
  // A poll whose day went by unheld (a city resumed after the hour) is counted now.
  for (const r of list) if (r.result === null && r.day < world.day) closePoll(world, r);
  if (!pendingReferendum(world)) {
    const needed = signaturesNeeded(world);
    const ready = world.government.proposals
      .filter((p) => p.petition && p.status !== 'passed' && !referendumFor(world, p.id)
        && signable(world, p) && liveSignatures(world, p).length >= needed)
      .sort((a, b) => liveSignatures(world, b).length - liveSignatures(world, a).length
        || a.tabledDay - b.tabledDay || a.id.localeCompare(b.id));
    if (ready.length > 0) openReferendum(world, ready[0]);
  }
  const keep = list.filter((r) => r.result === null || world.day - r.day < world.config.cycleDays);
  if (keep.length !== list.length) {
    for (const gone of list) {
      if (keep.includes(gone)) continue;
      for (const id of Object.keys(world.counters)) {
        if (id.startsWith(`ref:${gone.id}:`)) delete world.counters[id];
      }
    }
    (world as { referendums?: Referendum[] }).referendums = keep;
  }
}

/** An open petition as a citizen sees it: whose it is, how far it has got, and whether they signed. */
export interface ObservedPetition {
  id: ProposalId;
  summary: string;
  proposer: string;
  signatures: number;
  needed: number;
  youSigned: boolean;
}

/**
 * Every petition still open to signature, best-supported first. A citizen
 * deciding whether to put their name to one can see how many names it has and
 * how many the city asks for; what they do about it is their own business.
 */
export function petitionsObservation(world: World, c: Citizen): ObservedPetition[] {
  return memo(world, `referendum:petitions:${c?.id ?? ''}`, () => petitionBoard(world, c));
}

function petitionBoard(world: World, c: Citizen): ObservedPetition[] {
  const needed = signaturesNeeded(world);
  return world.government.proposals
    .filter((p) => p.petition && signable(world, p) && !referendumFor(world, p.id))
    .map((p) => ({
      id: p.id,
      summary: p.summary,
      proposer: world.citizens[p.proposerId]?.name ?? p.proposerId,
      signatures: liveSignatures(world, p).length,
      needed,
      youSigned: Boolean(c) && signaturesOf(p).includes(c.id),
    }))
    .sort((a, b) => b.signatures - a.signatures || a.id.localeCompare(b.id));
}

/** The question before the city, as this citizen sees it. */
export function referendumObservation(world: World, c: Citizen): ObservedReferendum | null {
  const r = pendingReferendum(world);
  if (!r) return null;
  const vote = c ? world.counters[voteKey(r.id, c.id)] : undefined;
  return { id: r.id, question: r.question, day: r.day, youVoted: vote === undefined ? null : vote === 1 };
}
