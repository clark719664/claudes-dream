/**
 * Parties — the citizens who decide to want the same things out loud.
 *
 * Anybody in good standing may pay the registration fee and found one on a
 * platform; anybody may join. A party is nothing but a name, a platform and a
 * list of members, and everything it does follows from those three: it
 * endorses candidates (a name on a poster is worth a few days of campaigning),
 * it whips its councillors (the line wins seven votes in ten — the other three
 * are the councillor's own mind, which no party owns), and with a majority of
 * the Council it tables the platform it stood on, one proposal a cycle, so a
 * party that wins has to govern by what it said. A Council nobody controls is
 * a **hung** Council: the two largest parties share the Mayor's chair, half a
 * cycle each. Nothing forces them to agree; the chair simply changes hands.
 *
 * Nothing here tells a citizen what to want. Founding, joining, leaving and
 * endorsing are all actions a mind chooses; the daily pass only keeps the
 * books.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, Citizen, CitizenId, LawCode, ObservedParty, Party, Platform, Proposal, World,
} from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { nextId } from '../util/ids.ts';
import { chance } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { isPresent } from '../citizens/citizen.ts';
import { tableProposal } from '../government/council.ts';
import { isElectionDay, nominationsOpen } from '../government/elections.ts';
import { PLATFORM_FIELDS, PROMISE_WORDS, platformInWords, positionOf, settingFor } from './promises.ts';

/** What the Registry charges to enter a party in the roll. */
export const PARTY_FOUNDING_FEE = 100;
/** How often a whipped councillor votes the party line rather than their own mind. */
export const WHIP_STRENGTH = 0.7;
/** What a party's endorsement is worth to a candidate, in campaign visibility. */
export const ENDORSEMENT_VISIBILITY = 3;
/** Longest name the Registry will write down. */
export const MAX_PARTY_NAME = 40;

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The party roll. A world saved before this layer has none; that is not an error. */
function partyBook(world: World): Record<string, Party> {
  const w = world as { parties?: Record<string, Party> };
  if (!w.parties) w.parties = {};
  return w.parties;
}

/** Parties in a stable order: biggest in the Council first, then the largest. */
function allParties(world: World): Party[] {
  return Object.values(partyBook(world)).sort(
    (a, b) => b.seats - a.seats || b.members.length - a.members.length || a.foundedDay - b.foundedDay || a.id.localeCompare(b.id),
  );
}

/** Where a citizen is being held, or null if they are at liberty. */
function heldIn(world: World, c: Citizen): string | null {
  if (c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day) return 'the cells';
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return 'the Watch House';
  return null;
}

/** The party a citizen belongs to, or null. A stale id (the party dissolved) is no party. */
export function partyOf(world: World, cId: CitizenId): Party | null {
  const c = world.citizens[cId];
  if (!c) return null;
  const id = c.partyId ?? null;
  if (!id) return null;
  const party = partyBook(world)[id];
  return party && party.members.includes(cId) ? party : null;
}

function sanitizePlatform(platform: Platform | undefined | null): Platform {
  const v = (x: number): number => (Number.isFinite(x) ? clamp(x, 0, 1) : 0.5);
  const p = platform ?? { tax: 0.5, dividend: 0.5, minWage: 0.5, strictness: 0.5 };
  return { tax: v(p.tax), dividend: v(p.dividend), minWage: v(p.minWage), strictness: v(p.strictness) };
}

/** What a party stands for, in a sentence the Chronicle can print. */
export function manifestoOf(party: Party): string {
  return `The manifesto of ${party.name}: ${platformInWords(sanitizePlatform(party.platform))}.`;
}

/** Every party's manifesto, biggest first: what the press prints on the eve of an election. */
export function manifestos(world: World): { id: string; name: string; manifesto: string }[] {
  return allParties(world).map((p) => ({ id: p.id, name: p.name, manifesto: manifestoOf(p) }));
}

// ---------------------------------------------------------------------------
// Founding, joining and leaving
// ---------------------------------------------------------------------------

/** Found a party on a platform: the fee to the Treasury, the founder its first member and leader. */
export function foundParty(world: World, cId: CitizenId, name: string, platform: Platform): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (c.lifeStage === 'child') return fail('You must be grown to found a party.');
  if (c.standing !== 'good') return fail(`You cannot found a party while ${c.standing}.`);
  const held = heldIn(world, c);
  if (held) return fail(`You cannot found a party from ${held}.`);
  const mine = partyOf(world, cId);
  if (mine) return fail(`You already belong to ${mine.name}; leave it before founding another.`);
  const clean = (name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_PARTY_NAME);
  if (!clean) return fail('A party needs a name.');
  const book = partyBook(world);
  if (Object.values(book).some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    return fail(`There is already a party called ${clean}.`);
  }
  if (c.wallet < PARTY_FOUNDING_FEE) return fail(`Registering a party costs ${PARTY_FOUNDING_FEE} ℓ; you have ${c.wallet} ℓ.`);
  if (!transfer(world, cId, 'treasury', PARTY_FOUNDING_FEE, 'registration', `registration of ${clean}`)) {
    return fail('The registration fee could not be paid.');
  }
  const party: Party = {
    id: nextId(world, 'f'), name: clean, platform: sanitizePlatform(platform),
    founderId: cId, leaderId: cId, members: [cId], foundedDay: world.day, seats: 0,
  };
  book[party.id] = party;
  c.partyId = party.id;
  partySeats(world);
  const stands = platformInWords(party.platform);
  emit(world, 'party', `${c.name} founded ${party.name}, standing for ${stands}.`, [cId], 0.6,
    { partyId: party.id, name: party.name, platform: party.platform, manifesto: manifestoOf(party) });
  remember(world, cId, 'civic',
    `You founded ${party.name} and paid the ${PARTY_FOUNDING_FEE} ℓ registration; it stands for ${stands}.`);
  return { ok: true, message: `${party.name} is on the Registry's roll; you lead it.` };
}

export function joinParty(world: World, cId: CitizenId, partyId: string): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (c.lifeStage === 'child') return fail('You must be grown to join a party.');
  if (c.standing === 'suspended' || c.standing === 'exiled') return fail(`You cannot join a party while ${c.standing}.`);
  const held = heldIn(world, c);
  if (held) return fail(`You cannot join a party from ${held}.`);
  const mine = partyOf(world, cId);
  if (mine) return fail(mine.id === partyId ? `You are already a member of ${mine.name}.` : `You already belong to ${mine.name}.`);
  const party = partyBook(world)[partyId];
  if (!party) return fail('There is no such party.');
  if (!party.members.includes(cId)) party.members.push(cId);
  c.partyId = party.id;
  partySeats(world);
  emit(world, 'party', `${c.name} joined ${party.name} (${party.members.length} members).`, [cId], 0.3,
    { partyId: party.id, members: party.members.length });
  remember(world, cId, 'civic', `You joined ${party.name}, which stands for ${platformInWords(party.platform)}.`);
  return { ok: true, message: `You are a member of ${party.name}.` };
}

/** Leave: a leader on the way out hands the party to its longest-serving member. */
export function leaveParty(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const party = partyOf(world, cId);
  if (!party) { c.partyId = null; return fail('You do not belong to a party.'); }
  party.members = party.members.filter((m) => m !== cId);
  c.partyId = null;
  const wasLeader = party.leaderId === cId;
  if (party.members.length === 0) {
    dissolveParty(world, party, `${c.name} was the last member`);
    return { ok: true, message: `You left ${party.name}; with nobody left in it, the party is struck off the roll.` };
  }
  if (wasLeader) handOver(world, party, `${c.name} left the party`);
  partySeats(world);
  emit(world, 'party', `${c.name} left ${party.name}.`, [cId], 0.3, { partyId: party.id, members: party.members.length });
  remember(world, cId, 'civic', `You left ${party.name}.`);
  return { ok: true, message: `You have left ${party.name}.` };
}

/**
 * The oldest remaining membership takes the party over: the first member still
 * in the city, and failing that the first member on the roll — a party is
 * never left in the name of somebody who has walked out of it.
 */
function handOver(world: World, party: Party, reason: string): void {
  const members = party.members.map((id) => world.citizens[id]).filter((m): m is Citizen => Boolean(m));
  const next = members.find((m) => isPresent(world, m)) ?? members[0];
  if (!next) return;
  party.leaderId = next.id;
  emit(world, 'party', `${next.name} leads ${party.name}: ${reason}.`, [next.id], 0.4, { partyId: party.id, leader: next.id });
  remember(world, next.id, 'civic', `You lead ${party.name} now: ${reason}.`);
}

function dissolveParty(world: World, party: Party, reason: string): void {
  for (const id of party.members) {
    const m = world.citizens[id];
    if (m && m.partyId === party.id) m.partyId = null;
  }
  party.members = [];
  party.seats = 0;
  delete partyBook(world)[party.id];
  emit(world, 'party', `${party.name} is struck off the roll: ${reason}.`, [], 0.5, { partyId: party.id, dissolved: true });
}

// ---------------------------------------------------------------------------
// Endorsements and the whip
// ---------------------------------------------------------------------------

function endorsementKey(cycle: number, partyId: string, candidateId: CitizenId): string {
  return `endorse:${cycle}:${partyId}:${candidateId}`;
}

/** A leader puts their party's name behind a candidate: worth a few days of campaigning. */
export function endorse(world: World, cId: CitizenId, candidateId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const party = partyOf(world, cId);
  if (!party) return fail('You do not belong to a party.');
  if (party.leaderId !== cId) return fail(`Only ${world.citizens[party.leaderId]?.name ?? 'the leader'} endorses for ${party.name}.`);
  if (c.standing === 'suspended' || c.standing === 'exiled') return fail(`You cannot endorse while ${c.standing}.`);
  const held = heldIn(world, c);
  if (held) return fail(`You cannot endorse a candidate from ${held}.`);
  const e = world.government.election;
  if (!nominationsOpen(world) && !isElectionDay(world)) return fail('There is no election to endorse in.');
  const candidate = world.citizens[candidateId];
  if (!candidate) return fail('Nobody by that id lives in Reverie.');
  if (!e.candidates.includes(candidateId)) return fail(`${candidate.name} is not standing.`);
  const key = endorsementKey(e.cycle, party.id, candidateId);
  if (world.counters[key] !== undefined) return fail(`${party.name} has already endorsed ${candidate.name} in this election.`);
  world.counters[key] = world.day;
  candidate.campaignVisibility += ENDORSEMENT_VISIBILITY;
  emit(world, 'party', `${party.name} endorsed ${candidate.name} for the Council.`, [cId, candidateId], 0.5,
    { partyId: party.id, candidate: candidateId });
  remember(world, cId, 'civic', `You endorsed ${candidate.name} for the Council in ${party.name}'s name.`);
  remember(world, candidateId, 'civic',
    `${party.name} endorsed your candidacy; it stands for ${platformInWords(party.platform)}.`);
  return { ok: true, message: `${party.name} stands behind ${candidate.name}.` };
}

/** The party backing a candidate in this election, if any. */
export function endorsedBy(world: World, candidateId: CitizenId): Party | null {
  const cycle = world.government.election.cycle;
  for (const party of allParties(world)) {
    if (world.counters[endorsementKey(cycle, party.id, candidateId)] !== undefined) return party;
  }
  return null;
}

/** What the city has set today for the thing a proposal would change. */
function currentSetting(world: World, kind: string, p: Proposal): number | null {
  const g = world.government as typeof world.government & { propertyTax?: number; wealthTax?: number; reserveTarget?: number };
  switch (kind) {
    case 'income_tax': return g.incomeTax;
    case 'sales_tax': return g.salesTax;
    case 'dividend': return g.dividend;
    case 'min_wage': return g.minWage;
    case 'law_severity': return p.lawCode ? g.lawSeverity[p.lawCode] : null;
    case 'property_tax': return g.propertyTax ?? 0;
    case 'wealth_tax': return g.wealthTax ?? 0;
    case 'reserve': return g.reserveTarget ?? 0;
    case 'tariff': return world.outer?.tariff ?? 0;
    default: return null;
  }
}

/**
 * The party line on a proposal, read off the platform it registered — the same
 * four questions a councillor's own reading weighs. Null where the platform
 * says nothing: who sits on the bench, who is pardoned and who is Mayor are
 * matters of persons, and no party has a line on a person.
 */
export function whipVote(world: World, councillorId: CitizenId, p: Proposal): boolean | null {
  const party = partyOf(world, councillorId);
  if (!party) return null;
  const platform = sanitizePlatform(party.platform);
  const kind: string = p.kind;
  const current = currentSetting(world, kind, p);
  const d = current === null ? 0 : Math.sign(p.value - current);
  let score = 0;
  switch (kind) {
    case 'income_tax': case 'sales_tax': case 'property_tax': case 'wealth_tax': case 'tariff':
      score = (platform.tax - 0.5) * d; break;
    case 'dividend': score = (platform.dividend - 0.5) * d; break;
    case 'min_wage': score = (platform.minWage - 0.5) * d; break;
    case 'law_severity': score = (platform.strictness - 0.5) * d; break;
    case 'reserve': score = (0.5 - platform.dividend) * d; break;
    case 'public_works': case 'charity': case 'tram': case 'monument':
      score = (platform.dividend - 0.5) + (0.5 - platform.tax); break;
    case 'pardon': score = 0.5 - platform.strictness; break;
    default: return null;
  }
  if (Math.abs(score) < 0.01) return null;
  return score > 0;
}

/**
 * How a councillor with a party actually votes: the line WHIP_STRENGTH of the
 * time, their own reading the rest. With no party, or no line, they vote their
 * own mind and nothing is drawn.
 */
export function whippedVote(world: World, councillorId: CitizenId, p: Proposal, own: boolean): boolean {
  const line = whipVote(world, councillorId, p);
  if (line === null) return own;
  if (line === own) return own;
  return chance(world, WHIP_STRENGTH) ? line : own;
}

// ---------------------------------------------------------------------------
// Seats, coalitions and the platform
// ---------------------------------------------------------------------------

/** Everyone who holds a seat, the Mayor included, without counting anybody twice. */
function seatHolders(world: World): CitizenId[] {
  const g = world.government;
  const ids = new Set<CitizenId>(g.council);
  if (g.mayorId) ids.add(g.mayorId);
  return [...ids].filter((id) => {
    const c = world.citizens[id];
    return Boolean(c && isPresent(world, c));
  });
}

/** Recount every party's seats from who actually sits on the Council. */
export function partySeats(world: World): void {
  const book = partyBook(world);
  for (const party of Object.values(book)) party.seats = 0;
  for (const id of seatHolders(world)) {
    const party = partyOf(world, id);
    if (party) party.seats += 1;
  }
}

/** The party with more than half the seats, or null. */
export function majorityParty(world: World): Party | null {
  const size = seatHolders(world).length;
  if (size === 0) return null;
  partySeats(world);
  for (const party of allParties(world)) if (party.seats * 2 > size) return party;
  return null;
}

/** A hung Council: the two largest parties in it, who must share the chair. */
export function coalition(world: World): [Party, Party] | null {
  if (majorityParty(world)) return null;
  const seated = allParties(world).filter((p) => p.seats > 0);
  if (seated.length < 2) return null;
  return [seated[0], seated[1]];
}

function cycleStartDay(world: World): number {
  return Math.max(0, world.government.election.electionDay - world.config.cycleDays);
}

/** The day the chair changes hands in a hung Council. */
export function halfCycleDay(world: World): number {
  return cycleStartDay(world) + Math.floor(world.config.cycleDays / 2);
}

/**
 * The party's members who actually hold a seat and are in a position to use
 * it: in standing, and not in the cells or the Watch House — a councillor in
 * custody neither takes the chair nor tables anything in the party's name.
 */
function sittingMembers(world: World, party: Party): Citizen[] {
  return seatHolders(world)
    .map((id) => world.citizens[id])
    .filter((c): c is Citizen => Boolean(c) && partyOf(world, c.id)?.id === party.id
      && (c.standing === 'good' || c.standing === 'probation') && heldIn(world, c) === null);
}

/** Who could take the chair for a party: its leader if they sit, else its best-placed councillor. */
function chairFor(world: World, party: Party): Citizen | null {
  const seated = sittingMembers(world, party);
  if (seated.length === 0) return null;
  const leader = seated.find((c) => c.id === party.leaderId);
  if (leader) return leader;
  const rank = new Map<CitizenId, number>((world.government.election.results ?? []).map((r, i) => [r.candidateId, i]));
  return seated.sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99) || b.reputation - a.reputation || a.id.localeCompare(b.id))[0];
}

/**
 * Half-way through a cycle a hung Council's chair passes to the other half of
 * the coalition — once a cycle, and only while the Council is still hung: a
 * defection that gives somebody a majority ends the arrangement of itself.
 *
 * The chair goes to the larger of the two, unless the Mayor already sits for
 * it: a Mayor who belongs to neither party (or to some third one) is not part
 * of the arrangement, and the coalition takes the chair beginning with the
 * party the city gave the most seats.
 */
function coalitionSwap(world: World): void {
  const g = world.government;
  const key = `coalition:${g.cycle}`;
  if (world.counters[key] !== undefined) return;
  if (world.day < halfCycleDay(world)) return;
  const pair = coalition(world);
  if (!pair) return;
  const [first, second] = pair;
  const held = g.mayorId ? partyOf(world, g.mayorId) : null;
  const to = held && held.id === first.id ? second : first;
  const next = chairFor(world, to);
  if (!next || next.id === g.mayorId) return;
  world.counters[key] = world.day;
  const outgoing = g.mayorId ? world.citizens[g.mayorId] ?? null : null;
  if (outgoing) outgoing.office = g.council.includes(outgoing.id) ? 'councillor' : g.watch.includes(outgoing.id) ? 'watch' : null;
  g.mayorId = next.id;
  if (!g.council.includes(next.id)) g.council.push(next.id);
  next.office = 'mayor';
  g.watchCaptainId = null;
  emit(world, 'party', `The chair passes to ${next.name} of ${to.name} for the rest of the cycle`
    + `${outgoing ? `; ${outgoing.name}${held ? ` of ${held.name}` : ''} steps aside` : ''}.`,
  [next.id, ...(outgoing ? [outgoing.id] : [])], 0.8, { partyId: to.id, mayor: next.id, coalition: [first.id, second.id] });
  remember(world, next.id, 'civic', `You took the Mayor's chair under the coalition of ${first.name} and ${second.name}.`);
  if (outgoing) remember(world, outgoing.id, 'civic', `You handed the Mayor's chair to ${next.name} at the half-cycle.`);
}

const FIELD_KIND: Record<keyof Platform, 'income_tax' | 'dividend' | 'min_wage' | 'law_severity'> = {
  tax: 'income_tax', dividend: 'dividend', minWage: 'min_wage', strictness: 'law_severity',
};
/** The law furthest from the severity a platform wants, in the direction it wants. */
function lawToMove(world: World, target: number): LawCode | null {
  const severities = world.government.lawSeverity;
  let best: LawCode | null = null;
  let gap = 0;
  for (const code of Object.keys(LAWS) as LawCode[]) {
    const now = severities[code] ?? LAWS[code].severity;
    if (Math.abs(target - now) > Math.abs(gap)) { gap = target - now; best = code; }
  }
  return gap === 0 ? null : best;
}

/**
 * Who tables the party's platform. Only a scripted mind is ever spoken for: a
 * councillor who thinks for itself decides for itself whether to table what
 * its party stood on (`docs/PRINCIPLES.md` §2).
 */
function platformProposer(world: World, party: Party): Citizen | null {
  const chair = chairFor(world, party);
  if (chair && chair.brain === 'reflex') return chair;
  return sittingMembers(world, party).find((c) => c.brain === 'reflex') ?? null;
}

/**
 * A party that holds the Council tables what it stood on: once a cycle, the
 * plank furthest from the way the city is run, in a councillor's name. The
 * Council still has to vote for it — a majority is not a rubber stamp.
 */
export function enactPlatform(world: World): void {
  const party = majorityParty(world);
  if (!party) return;
  const g = world.government;
  const key = `platformTabled:${party.id}:${g.cycle}`;
  if (world.counters[key] !== undefined) return;
  const proposer = platformProposer(world, party);
  if (!proposer) return;
  let best: keyof Platform | null = null;
  let gap = 0;
  for (const field of PLATFORM_FIELDS) {
    const want = party.platform[field];
    const now = positionOf(world, field);
    if (Math.abs(want - now) > Math.abs(gap)) { gap = want - now; best = field; }
  }
  if (!best || Math.abs(gap) < 0.1) return;
  const kind = FIELD_KIND[best];
  const value = settingFor(world, best, party.platform[best]);
  const direction = gap > 0 ? 'raise' : 'lower';
  const lawCode = kind === 'law_severity' ? lawToMove(world, value) : null;
  if (kind === 'law_severity' && !lawCode) return;
  const result = tableProposal(world, proposer.id, {
    kind,
    value,
    summary: `${party.name} stood on this: ${direction} ${PROMISE_WORDS[best].noun}`
      + `${lawCode ? ` — ${LAWS[lawCode].name} (${lawCode}) to ${value}` : ` to ${kind === 'income_tax' ? `${Math.round(value * 100)}%` : value}`}.`,
    ...(lawCode ? { lawCode } : {}),
  });
  if (!result.ok) return;
  world.counters[key] = world.day;
  emit(world, 'party', `${party.name} holds the Council and tabled its platform: ${direction} ${PROMISE_WORDS[best].noun}.`,
    [proposer.id], 0.5, { partyId: party.id, field: best, value });
}

// ---------------------------------------------------------------------------
// The daily pass, and what a citizen sees
// ---------------------------------------------------------------------------

/** Endorsements, coalitions and platforms belong to a cycle; older keys are cleared away. */
function pruneCounters(world: World): void {
  const cycle = Math.max(world.government.cycle, world.government.election.cycle);
  for (const key of Object.keys(world.counters)) {
    const at = key.startsWith('platformTabled:') ? 2
      : key.startsWith('endorse:') || key.startsWith('coalition:') ? 1 : -1;
    if (at >= 0 && Number(key.split(':')[at]) < cycle) delete world.counters[key];
  }
}

/** Morning: the roll is corrected, then the parties do what their standing lets them. */
export function dailyParties(world: World): void {
  const book = partyBook(world);
  for (const party of Object.values(book)) {
    const kept: CitizenId[] = [];
    for (const id of party.members) {
      const m = world.citizens[id];
      if (!m || !isPresent(world, m) || m.partyId !== party.id) {
        if (m && m.partyId === party.id) m.partyId = null;
        continue;
      }
      if (!kept.includes(id)) kept.push(id);
    }
    party.members = kept;
    if (kept.length === 0) { dissolveParty(world, party, 'nobody is left in it'); continue; }
    const leader = world.citizens[party.leaderId];
    if (!leader || !isPresent(world, leader) || leader.partyId !== party.id) {
      handOver(world, party, 'the leader has left the city');
    }
  }
  // A citizen carrying the id of a party that no longer exists belongs to none.
  for (const c of Object.values(world.citizens)) {
    if (c.partyId && !book[c.partyId]) c.partyId = null;
  }
  partySeats(world);
  enactPlatform(world);
  coalitionSwap(world);
  pruneCounters(world);
}

/** The party this citizen belongs to, as they see it. */
export function partyObservation(world: World, c: Citizen): ObservedParty | null {
  return partiesObservation(world, c).find((p) => p.yours) ?? null;
}

export function partiesObservation(world: World, c: Citizen): ObservedParty[] {
  const mine = c ? c.partyId ?? null : null;
  return allParties(world).map((p) => ({
    id: p.id,
    name: p.name,
    platform: { ...p.platform },
    leader: world.citizens[p.leaderId]?.name ?? p.leaderId,
    members: p.members.length,
    seats: p.seats,
    yours: p.id === mine,
  }));
}
