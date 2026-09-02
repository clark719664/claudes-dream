/**
 * Elections: nominations, campaigning, ballots, the reflex voter's mind and
 * election night. The Council's day-to-day business lives in council.ts,
 * which re-exports everything here.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, ElectionResult, Platform, World } from '../types.ts';
import { chance } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { isEligibleCandidate, isEligibleVoter } from '../citizens/citizen.ts';
import { bondBetween } from '../citizens/relationships.ts';

export const COUNCIL_SEATS = 5;
/** Nominations open this many days before election day. */
export const NOMINATION_LEAD_DAYS = 7;
/** A voter whose best candidate scores below this stays home. */
export const ABSTAIN_THRESHOLD = 0.15;
/** Sociability + ambition below this makes a citizen a reluctant voter. */
export const LOW_CIVIC_INTEREST = 0.6;
/** Wallet thresholds for "poor" and "rich" in the voter's mind. */
export const POOR_WALLET = 50;
export const RICH_WALLET = 500;

function fail(message: string): ActionResult { return { ok: false, message }; }

function isPresent(world: World, c: Citizen): boolean {
  return c.standing !== 'exiled' && world.order.includes(c.id);
}

export function daysToElection(world: World): number {
  return Math.max(0, world.government.election.electionDay - world.day);
}

export function nominationsOpen(world: World): boolean {
  const e = world.government.election;
  return world.day >= e.nominationsOpenDay && world.day < e.electionDay;
}

export function isElectionDay(world: World): boolean {
  return world.day === world.government.election.electionDay;
}

/** Has this citizen ever been the victim in a case? */
export function wasVictim(world: World, cId: CitizenId): boolean {
  return Object.values(world.cases).some((k) => k.victimId === cId);
}

/**
 * The platform a citizen would stand on, read off their situation and
 * personality: the poor want dividend and wages, owners want low taxes, the
 * honest and the wronged want strict enforcement, the convicted do not.
 */
export function impliedPlatform(world: World, c: Citizen): Platform {
  const owner = c.businessId !== null;
  const employed = c.jobId !== null;
  const rich = c.wallet > RICH_WALLET;
  const poor = c.wallet < POOR_WALLET || (!employed && !owner);
  const p = c.personality;
  return {
    tax: clamp(0.5 - (owner || rich ? 0.25 : 0) + (poor ? 0.15 : 0) + (0.5 - p.ambition) * 0.2, 0, 1),
    dividend: clamp(0.5 + (poor ? 0.3 : 0) - (owner || rich ? 0.2 : 0) + (p.sociability - 0.5) * 0.2, 0, 1),
    minWage: clamp(0.5 + (employed && !owner ? 0.2 : 0) - (owner ? 0.3 : 0) + (poor ? 0.1 : 0), 0, 1),
    strictness: clamp(0.3 + p.honesty * 0.5 - (c.record.convictions.length > 0 ? 0.3 : 0) + (wasVictim(world, c.id) ? 0.2 : 0), 0, 1),
  };
}

function sanitizePlatform(platform: Platform): Platform {
  const v = (x: number) => (Number.isFinite(x) ? clamp(x, 0, 1) : 0.5);
  return { tax: v(platform.tax), dividend: v(platform.dividend), minWage: v(platform.minWage), strictness: v(platform.strictness) };
}

// ---------------------------------------------------------------------------
// Nominations and campaigning
// ---------------------------------------------------------------------------

/** Reset the ballot box for a new cycle and announce the election. */
export function openNominations(world: World): void {
  const g = world.government;
  const e = g.election;
  e.candidates = [];
  e.ballots = {};
  e.resolved = false;
  const office = new Set<CitizenId>([...g.council, ...(g.mayorId ? [g.mayorId] : [])]);
  for (const c of Object.values(world.citizens)) {
    c.campaignVisibility = 0;
    if (!office.has(c.id)) c.platform = null;
  }
  world.counters.nominationsOpenedDay = e.nominationsOpenDay;
  emit(world, 'election', `Nominations for the Council are open; the election is on day ${e.electionDay}.`, [], 0.6,
    { electionDay: e.electionDay, cycle: e.cycle });
}

/** Stand for the Council on a platform. */
export function nominate(world: World, cId: CitizenId, platform: Platform): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const e = world.government.election;
  if (!nominationsOpen(world)) {
    return fail(world.day >= e.electionDay ? 'Nominations have closed for this election.' : `Nominations open on day ${e.nominationsOpenDay}.`);
  }
  if (e.candidates.includes(cId)) return fail('You are already a candidate.');
  if (!isEligibleCandidate(world, c)) {
    if (!isEligibleVoter(world, c)) return fail(`You cannot stand while ${c.standing}.`);
    if (world.day - c.arrivedDay < 7) return fail('You must have lived in Reverie for seven days to stand.');
    return fail('A conviction of severity 3 or higher this cycle bars you from standing.');
  }
  if (!platform || typeof platform !== 'object') return fail('A candidate needs a platform.');
  c.platform = sanitizePlatform(platform);
  e.candidates.push(cId);
  emit(world, 'nomination', `${c.name} is standing for the Council.`, [cId], 0.4, { platform: c.platform });
  remember(world, cId, 'civic', `You declared your candidacy for the Council (election on day ${e.electionDay}).`);
  return { ok: true, message: `You are a candidate for the Council; the election is on day ${e.electionDay}.` };
}

/** Raise visibility: a tick in the Plaza helps, and lumens help more. */
export function campaign(world: World, cId: CitizenId, spend = 0): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const e = world.government.election;
  if (!e.candidates.includes(cId)) return fail('Only candidates can campaign.');
  if (e.resolved || world.day > e.electionDay) return fail('The election is over.');
  const amount = Number.isFinite(spend) ? Math.max(0, Math.round(spend)) : 0;
  if (amount > c.wallet) return fail(`You cannot spend ${amount} ℓ on your campaign; you have ${c.wallet} ℓ.`);
  if (amount > 0 && !transfer(world, cId, 'treasury', amount, 'campaign', `${c.name}'s campaign`)) return fail('The campaign spending could not be paid.');
  const plaza = c.district === 'commons' ? 0.5 : 0;
  c.campaignVisibility += 1 + amount / 20 + plaza;
  const where = world.districts[c.district]?.name ?? c.district;
  emit(world, 'election', `${c.name} campaigned in ${where}${amount > 0 ? `, spending ${amount} ℓ` : ''}.`, [cId], amount > 0 ? 0.4 : 0.2,
    { spend: amount, visibility: c.campaignVisibility });
  remember(world, cId, 'civic', `You campaigned in ${where}${amount > 0 ? ` (spent ${amount} ℓ)` : ''}.`);
  return { ok: true, message: `You campaigned in ${where}; your visibility is now ${Math.round(c.campaignVisibility * 10) / 10}.` };
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

/** One ballot per eligible voter, on election day only. */
export function castBallot(world: World, voterId: CitizenId, candidateId: CitizenId): ActionResult {
  const voter = world.citizens[voterId];
  if (!voter) return fail('Unknown citizen.');
  const e = world.government.election;
  if (!isElectionDay(world)) return fail(`It is not election day (that is day ${e.electionDay}).`);
  if (e.resolved) return fail('The polls have closed.');
  if (!isEligibleVoter(world, voter)) return fail(`You cannot vote while ${voter.standing}.`);
  if (!e.candidates.includes(candidateId)) return fail('That citizen is not a candidate.');
  if (e.ballots[voterId]) return fail('You have already voted in this election.');
  e.ballots[voterId] = candidateId;
  voter.stats.votesCast++;
  const candidate = world.citizens[candidateId];
  emit(world, 'vote', `${voter.name} cast a ballot.`, [voterId], 0.1);
  remember(world, voterId, 'civic', `You voted for ${candidate?.name ?? candidateId} in the Council election.`);
  return { ok: true, message: `You voted for ${candidate?.name ?? candidateId}.` };
}

/** How well a candidate's platform serves this voter's situation. */
export function platformFit(world: World, voter: Citizen, platform: Platform): number {
  const owner = voter.businessId !== null;
  const employed = voter.jobId !== null;
  const rich = voter.wallet > RICH_WALLET;
  const poor = voter.wallet < POOR_WALLET || (!employed && !owner);
  let fit = 0;
  if (poor) fit += (platform.dividend - 0.5) * 0.4 + (platform.minWage - 0.5) * 0.3;
  if (owner || rich) fit += (0.5 - platform.tax) * 0.4;
  if (employed && !owner) fit += (platform.minWage - 0.5) * 0.2;
  if (wasVictim(world, voter.id)) fit += (platform.strictness - 0.5) * 0.3;
  if (voter.record.convictions.length > 0) fit -= (platform.strictness - 0.5) * 0.4;
  fit += (platform.strictness - 0.5) * (voter.personality.honesty - 0.5) * 0.2;
  return fit;
}

/**
 * Whom a reflex voter picks: friends, the reputable, the well-known and
 * those whose platform suits them. Returns null for an abstention.
 */
export function voterPreference(world: World, voterId: CitizenId, candidates: CitizenId[]): CitizenId | null {
  const voter = world.citizens[voterId];
  if (!voter) return null;
  const field = candidates.filter((id) => world.citizens[id] !== undefined);
  if (field.length === 0) return null;
  const civic = voter.personality.sociability + voter.personality.ambition;
  if (civic < LOW_CIVIC_INTEREST && chance(world, 0.5)) return null;

  let best: CitizenId | null = null;
  let bestScore = -Infinity;
  for (const id of field) {
    const cand = world.citizens[id];
    const platform = cand.platform ?? impliedPlatform(world, cand);
    let score = bondBetween(world, voterId, id) / 100 + cand.reputation / 200 + platformFit(world, voter, platform) + cand.campaignVisibility / 20;
    if (id === voterId) score += 0.5;
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return bestScore >= ABSTAIN_THRESHOLD ? best : null;
}

// ---------------------------------------------------------------------------
// Election night
// ---------------------------------------------------------------------------

function tally(world: World, candidates: CitizenId[]): ElectionResult[] {
  const counts = new Map<CitizenId, number>(candidates.map((id) => [id, 0]));
  for (const candidate of Object.values(world.government.election.ballots)) {
    if (counts.has(candidate)) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([candidateId, votes]) => ({ candidateId, votes }))
    .sort((a, b) => b.votes - a.votes
      || world.citizens[b.candidateId].reputation - world.citizens[a.candidateId].reputation
      || world.citizens[a.candidateId].name.localeCompare(world.citizens[b.candidateId].name));
}

/** Seat the winners, unseat the rest, make the top candidate Mayor. */
function seatCouncil(world: World, results: ElectionResult[]): void {
  const g = world.government;
  const winners = results.slice(0, COUNCIL_SEATS).map((r) => r.candidateId);
  const previousMayor = g.mayorId;
  const incumbents = new Set<CitizenId>([...g.council, ...(g.mayorId ? [g.mayorId] : [])]);
  for (const id of incumbents) {
    if (winners.includes(id)) continue;
    const c = world.citizens[id];
    if (!c) continue;
    c.office = g.watch.includes(id) ? 'watch' : null;
    remember(world, id, 'civic', 'You were not re-elected; your term on the Council has ended.');
  }
  g.council = winners;
  g.mayorId = winners[0] ?? null;
  for (const id of winners) {
    const c = world.citizens[id];
    if (g.judges.includes(id)) {
      g.judges = g.judges.filter((j) => j !== id);
      c.judgeTermEndsDay = null;
      emit(world, 'law', `${c.name} stepped down as judge to take their seat on the Council.`, [id], 0.3);
    }
    c.office = id === g.mayorId ? 'mayor' : 'councillor';
    remember(world, id, 'civic', id === g.mayorId ? 'You were elected Mayor of Reverie.' : 'You were elected to the Council.');
  }
  if (g.mayorId !== previousMayor) g.watchCaptainId = null;
}

/** Roll the election calendar forward one cycle and clear the ballot box. */
function scheduleNextElection(world: World, results: ElectionResult[] | null, turnout: number | null): void {
  const g = world.government;
  const e = g.election;
  const seated = new Set(g.council);
  for (const c of Object.values(world.citizens)) {
    c.campaignVisibility = 0;
    if (!seated.has(c.id)) c.platform = null;
  }
  e.cycle += 1;
  g.cycle = e.cycle;
  e.nominationsOpenDay = e.electionDay + world.config.cycleDays - NOMINATION_LEAD_DAYS;
  e.electionDay += world.config.cycleDays;
  e.candidates = [];
  e.ballots = {};
  e.results = results;
  e.turnout = turnout;
  e.resolved = true;
}

/**
 * Close the polls: reflex citizens who have not voted make up their minds,
 * ballots are counted, the top five take their seats and the winner becomes
 * Mayor. With no candidates the sitting Council carries on.
 */
export function holdElection(world: World): void {
  const g = world.government;
  const e = g.election;
  if (e.resolved || world.day < e.electionDay) return;
  const candidates = e.candidates.filter((id) => {
    const c = world.citizens[id];
    return c && isPresent(world, c) && isEligibleCandidate(world, c);
  });
  if (candidates.length === 0) {
    emit(world, 'election', `Election day ${world.day} passed with no candidates; the sitting Council carries on.`, [], 0.6, { cycle: e.cycle });
    scheduleNextElection(world, null, null);
    return;
  }

  const eligible = Object.values(world.citizens).filter((c) => isEligibleVoter(world, c));
  for (const voter of eligible) {
    if (voter.brain !== 'reflex' || e.ballots[voter.id]) continue;
    const pick = voterPreference(world, voter.id, candidates);
    if (!pick) continue;
    e.ballots[voter.id] = pick;
    voter.stats.votesCast++;
  }
  for (const [voter, candidate] of Object.entries(e.ballots)) {
    if (!candidates.includes(candidate)) delete e.ballots[voter];
  }
  const results = tally(world, candidates);
  const cast = Object.keys(e.ballots).length;
  const turnout = eligible.length > 0 ? Math.round((cast / eligible.length) * 1000) / 1000 : 0;
  seatCouncil(world, results);

  const mayor = world.citizens[g.mayorId ?? ''];
  const councilNames = g.council.slice(1).map((id) => world.citizens[id]?.name ?? id);
  const summary = `Election day ${world.day}: ${mayor ? `${mayor.name} is Mayor with ${results[0].votes} votes` : 'no Mayor'}`
    + `${councilNames.length ? `; Council: ${councilNames.join(', ')}` : ''}. Turnout ${Math.round(turnout * 100)}% of ${eligible.length} voters.`;
  emit(world, 'election', summary, [...g.council], 1.0, { results, turnout, cycle: e.cycle });
  for (const voter of eligible) remember(world, voter.id, 'civic', summary);
  scheduleNextElection(world, results, turnout);
}
