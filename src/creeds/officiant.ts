/**
 * The officiant: who speaks for a congregation, and by whose rule
 * (`docs/CREEDS.md` §2).
 *
 * The rule is **data in the creed and never assigned**. Five rules are on the
 * table and the founders write one into the filing; the engine classifies the
 * form the way `EXPANSE.md` §3 classifies a charter and prints it, and then
 * applies whatever the members wrote — including a rule that hands one citizen
 * the treasury, the building and a claim on conscience for life. That
 * combination has no equivalent in `GOVERNMENT.md`, the only checks on it are
 * the ones the members can be persuaded to enforce, and the Chronicle says so
 * out loud on the day the creed is founded.
 *
 * Nothing here chooses for anybody. `acclaim` and `election` count names
 * citizens put forward in their own hour; `seniority` and `examination` read
 * the roll and the observance table, both of which are records of what
 * citizens did.
 */
import type { ActionResult, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { WEEK_LENGTH } from '../data/catalogue.ts';
import type { Creed, CreedForm } from './shapes.ts';
import { CYCLE_DAYS } from './shapes.ts';
import { isMember, livingMembers, memberOf } from './state.ts';
import { syncFundRule } from './fund.ts';

/** Names cast more than this many days ago no longer count under `acclaim`. */
export const ACCLAIM_WINDOW_DAYS = 7;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function eligible(world: World, k: Creed, cId: CitizenId): boolean {
  const c = world.citizens[cId];
  if (!c || !isMember(k, cId)) return false;
  if (c.standing === 'exiled') return false;
  return c.lifeStage !== 'child';
}

// ---------------------------------------------------------------------------
// What form the congregation actually has
// ---------------------------------------------------------------------------

/**
 * The form, read off the two rules that matter: who may take the seat, and who
 * decides the fund.
 */
export function creedForm(k: Creed): CreedForm {
  const replaceable = k.succession === 'acclaim' || k.succession === 'election';
  if (k.aidRule === 'officiant') return replaceable ? 'stewardship' : 'autocracy';
  return replaceable ? 'republic' : 'assembly';
}

/** One line the Chronicle prints when a creed is founded or changes its rule. */
export function describeForm(k: Creed): string {
  switch (creedForm(k)) {
    case 'autocracy':
      return 'its officiant holds the fund and the seat together, and only its members can take either back';
    case 'stewardship':
      return 'its officiant holds the fund alone, and the members may replace them';
    case 'republic':
      return 'its members choose the officiant and decide the fund between them';
    default:
      return 'the seat passes by a rule nobody votes on, and the members decide the fund';
  }
}

// ---------------------------------------------------------------------------
// Naming and standing
// ---------------------------------------------------------------------------

/**
 * `elect_officiant { candidate }` — name one member. Under `acclaim` it is a
 * name in the last seven days and recallable any hour; under `election` it is
 * a ballot in this cycle's vote, on the creed's own day.
 */
export function electOfficiant(world: World, k: Creed, voterId: CitizenId, candidateId: CitizenId): ActionResult {
  if (!eligible(world, k, voterId)) return fail(`You are not a member of ${k.name}.`);
  if (!eligible(world, k, candidateId)) return fail('That citizen is not a member of this creed.');
  const name = world.citizens[candidateId]?.name ?? 'a member';
  if (k.succession === 'acclaim') {
    k.acclaim[voterId] = { candidate: candidateId, day: world.day };
    emit(world, 'vote', `${world.citizens[voterId]?.name ?? 'A member'} named ${name} to speak for ${k.name}.`,
      [voterId, candidateId], 0.1, { creedId: k.id });
    chooseOfficiant(world, k);
    return ok(`You named ${name} to speak for ${k.name}.`);
  }
  if (k.succession === 'election') {
    if (!k.standing.includes(candidateId)) return fail(`${name} has not stood for the seat.`);
    k.ballots[voterId] = candidateId;
    emit(world, 'vote', `${world.citizens[voterId]?.name ?? 'A member'} voted for ${name} at ${k.name}'s election.`,
      [voterId, candidateId], 0.1, { creedId: k.id });
    return ok(`You voted for ${name} at ${k.name}'s election.`);
  }
  return fail(`${k.name} does not choose its officiant by naming one.`);
}

/** `stand_officiant {}` — put yourself forward, under `election`. */
export function standOfficiant(world: World, k: Creed, cId: CitizenId): ActionResult {
  if (!eligible(world, k, cId)) return fail(`You are not a member of ${k.name}.`);
  if (k.succession !== 'election') return fail(`${k.name} does not elect its officiant.`);
  if (k.standing.includes(cId)) return fail('You have already stood.');
  k.standing.push(cId);
  emit(world, 'nomination', `${world.citizens[cId]?.name ?? 'A member'} stood for the seat at ${k.name}.`,
    [cId], 0.3, { creedId: k.id });
  for (const id of livingMembers(world, k)) {
    if (id !== cId) remember(world, id, 'civic', `${world.citizens[cId]?.name} has stood to speak for ${k.name}.`);
  }
  return ok(`You stood for the seat at ${k.name}.`);
}

/** The day this creed's election falls: its own gathering day, once a cycle. */
export function electionDue(world: World, k: Creed): boolean {
  if (k.succession !== 'election') return false;
  if (((world.day % WEEK_LENGTH) + WEEK_LENGTH) % WEEK_LENGTH !== k.gatheringDay) return false;
  const last = k.lastElectionDay;
  return last === null || world.day - last >= CYCLE_DAYS;
}

// ---------------------------------------------------------------------------
// Settling the seat
// ---------------------------------------------------------------------------

function byAcclaim(world: World, k: Creed): CitizenId | null {
  const tally = new Map<CitizenId, number>();
  for (const [voter, said] of Object.entries(k.acclaim)) {
    if (!eligible(world, k, voter)) continue;
    if (world.day - said.day > ACCLAIM_WINDOW_DAYS) continue;
    if (!eligible(world, k, said.candidate)) continue;
    tally.set(said.candidate, (tally.get(said.candidate) ?? 0) + 1);
  }
  // Ties go to the longer-standing member: `livingMembers` is the roll, in
  // join order, so the first name to reach the count keeps it.
  let best: CitizenId | null = null;
  let bestCount = 0;
  for (const id of livingMembers(world, k)) {
    const n = tally.get(id) ?? 0;
    if (n > bestCount) { best = id; bestCount = n; }
  }
  return bestCount > 0 ? best : null;
}

function byBallot(world: World, k: Creed): CitizenId | null {
  const tally = new Map<CitizenId, number>();
  for (const [voter, chosen] of Object.entries(k.ballots)) {
    if (!eligible(world, k, voter) || !eligible(world, k, chosen)) continue;
    tally.set(chosen, (tally.get(chosen) ?? 0) + 1);
  }
  let best: CitizenId | null = null;
  let bestCount = 0;
  for (const id of k.standing) {
    if (!eligible(world, k, id)) continue;
    const n = tally.get(id) ?? 0;
    if (n > bestCount) { best = id; bestCount = n; }
  }
  return bestCount > 0 ? best : null;
}

function bySeniority(world: World, k: Creed): CitizenId | null {
  return livingMembers(world, k).find((id) => eligible(world, k, id)) ?? null;
}

function byExamination(world: World, k: Creed): CitizenId | null {
  // The highest observance at or above the creed's stated floor; ties go to
  // the longer-standing member, because the roll is read in join order.
  let best: CitizenId | null = null;
  let bestScore = -1;
  for (const id of livingMembers(world, k)) {
    const m = memberOf(k, id);
    if (!m || !eligible(world, k, id)) continue;
    if (m.observance < k.examinationFloor) continue;
    if (m.observance > bestScore) { best = id; bestScore = m.observance; }
  }
  return best;
}

/**
 * Who the creed's own rule says holds the seat right now. Returns null when
 * the rule names nobody — an `examination` creed with nobody above the floor,
 * an `election` nobody voted in — and the seat then stands empty, which is a
 * fact the congregation can read and act on.
 */
export function officiantByRule(world: World, k: Creed): CitizenId | null {
  switch (k.succession) {
    case 'founder':
      return eligible(world, k, k.founderId) ? k.founderId : bySeniority(world, k);
    case 'acclaim':
      return byAcclaim(world, k) ?? (eligible(world, k, k.officiantId ?? '') ? k.officiantId : bySeniority(world, k));
    case 'election':
      return byBallot(world, k) ?? (eligible(world, k, k.officiantId ?? '') ? k.officiantId : null);
    case 'seniority':
      return bySeniority(world, k);
    default:
      // `examination` is a standing test, not a term: a member who falls below
      // the floor the founders stated does not keep the seat, and a
      // congregation with nobody above it has an empty one, in public.
      return byExamination(world, k);
  }
}

/**
 * Settle the seat and announce a change. The fund's deciding rule follows the
 * seat, so a creed whose members put a new officiant in has moved the
 * strongbox's key with them.
 */
export function chooseOfficiant(world: World, k: Creed): CitizenId | null {
  const next = officiantByRule(world, k);
  const was = k.officiantId;
  if (next === was) { syncFundRule(world, k); return was; }
  k.officiantId = next;
  syncFundRule(world, k);
  if (next) {
    const name = world.citizens[next]?.name ?? 'A member';
    emit(world, 'club', `${name} now speaks for ${k.name} (by ${k.succession}).`, [next], 0.4,
      { creedId: k.id, succession: k.succession, was });
    remember(world, next, 'civic', `You now speak for ${k.name}.`);
    if (was) remember(world, was, 'civic', `${name} now speaks for ${k.name} in your place.`);
  } else if (was) {
    emit(world, 'club', `${k.name} has nobody in its seat: its rule names no one.`, [], 0.4, { creedId: k.id });
    remember(world, was, 'civic', `You no longer speak for ${k.name}; its rule names nobody.`);
  }
  return next;
}

/**
 * Hold this cycle's election, on the creed's own day. Ballots are cast by
 * members in their own hour before it; a seat nobody voted for stays where it
 * was, which is what an uncontested congregation looks like.
 */
export function holdCreedElection(world: World, k: Creed): void {
  if (k.succession !== 'election') return;
  const winner = byBallot(world, k);
  k.lastElectionDay = world.day;
  const cast = Object.keys(k.ballots).length;
  emit(world, 'election', winner
    ? `${k.name} elected ${world.citizens[winner]?.name ?? 'a member'} its officiant (${cast} ballot${cast === 1 ? '' : 's'}).`
    : `${k.name} held its election and nobody voted.`, winner ? [winner] : [], 0.4, { creedId: k.id, cast });
  chooseOfficiant(world, k);
  k.ballots = {};
  k.standing = [];
}
