/**
 * Parties (src/politics/parties.ts).
 *
 * Who may found one and what it costs, what a leader leaving does, how a whip
 * works on a mind that has one of its own, and what a hung Council does with
 * the Mayor's chair.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, Platform, Proposal, ProposalKind, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  ENDORSEMENT_VISIBILITY, PARTY_FOUNDING_FEE, WHIP_STRENGTH,
  coalition, dailyParties, enactPlatform, endorse, endorsedBy, foundParty, halfCycleDay, joinParty, leaveParty,
  majorityParty, partiesObservation, partyObservation, partyOf, partySeats, whipVote, whippedVote,
} from '../src/politics/parties.ts';

const LOW_TAX: Platform = { tax: 0.1, dividend: 0.2, minWage: 0.3, strictness: 0.6 };
const HIGH_TAX: Platform = { tax: 0.9, dividend: 0.9, minWage: 0.8, strictness: 0.4 };

function proposal(world: World, kind: ProposalKind, value: number, proposerId: string): Proposal {
  const p: Proposal = {
    id: `p_${world.government.proposals.length + 1}`, kind, value, lawCode: null, targetId: null,
    summary: 'a proposal', proposerId, petition: false, tabledDay: world.day, status: 'open',
    votes: {}, decidedDay: null, needed: 3,
  };
  world.government.proposals.push(p);
  return p;
}

/** Seat these citizens on the Council, the first of them as Mayor. */
function seat(world: World, members: Citizen[]): void {
  world.government.council = members.map((c) => c.id);
  world.government.mayorId = members[0]?.id ?? null;
  for (const [i, c] of members.entries()) c.office = i === 0 ? 'mayor' : 'councillor';
}

// ------------------------------------------------------------------ founding

test('founding a party costs the registration fee, and the money is conserved', () => {
  const w = makeWorld();
  const founder = makeCitizen(w, { name: 'Ondine', wallet: 300 });
  const before = totalMoney(w);
  const treasury = w.treasury.balance;

  const res = foundParty(w, founder.id, 'The Lantern List', LOW_TAX);
  assert.equal(res.ok, true, res.message);
  assert.equal(founder.wallet, 300 - PARTY_FOUNDING_FEE);
  assert.equal(w.treasury.balance, treasury + PARTY_FOUNDING_FEE);
  assert.equal(totalMoney(w), before, 'a registration moves money, it does not make any');

  const party = partyOf(w, founder.id);
  assert.ok(party);
  assert.equal(party.leaderId, founder.id);
  assert.deepEqual(party.members, [founder.id]);
  assert.equal(party.seats, 0);
  assert.equal(founder.partyId, party.id);
  assert.ok(w.events.some((e) => e.kind === 'party' && e.text.includes('The Lantern List')));
});

test('a party needs a name nobody has taken, a purse that covers the fee, and a grown citizen in good standing', () => {
  const w = makeWorld();
  const founder = makeCitizen(w, { wallet: 300 });
  const poor = makeCitizen(w, { wallet: PARTY_FOUNDING_FEE - 1 });
  const child = makeCitizen(w, { lifeStage: 'child', wallet: 300 });
  const suspended = makeCitizen(w, { standing: 'suspended', wallet: 300 });
  const jailed = makeCitizen(w, { wallet: 300, jailedUntilDay: w.day + 2 });

  assert.equal(foundParty(w, 'c_nobody', 'Ghosts', LOW_TAX).ok, false);
  assert.equal(foundParty(w, child.id, 'Kids', LOW_TAX).ok, false);
  assert.equal(foundParty(w, suspended.id, 'Suspended', LOW_TAX).ok, false);
  assert.equal(foundParty(w, jailed.id, 'The Cells', LOW_TAX).ok, false);
  assert.equal(foundParty(w, poor.id, 'The Broke', LOW_TAX).ok, false);
  assert.equal(foundParty(w, founder.id, '   ', LOW_TAX).ok, false, 'a party needs a name');

  assert.equal(foundParty(w, founder.id, 'The Makers', LOW_TAX).ok, true);
  const second = makeCitizen(w, { wallet: 300 });
  assert.equal(foundParty(w, second.id, 'the makers', LOW_TAX).ok, false, 'the name is taken');
  assert.equal(foundParty(w, founder.id, 'Another', LOW_TAX).ok, false, 'one party each');
  assert.equal(second.wallet, 300, 'a refused founding costs nothing');
});

test('a platform of nonsense is read as the middle of the road', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 300 });
  foundParty(w, c.id, 'Muddle', { tax: NaN, dividend: 4, minWage: -2, strictness: 0.5 } as Platform);
  const party = partyOf(w, c.id);
  assert.ok(party);
  assert.deepEqual(party.platform, { tax: 0.5, dividend: 1, minWage: 0, strictness: 0.5 });
});

// ------------------------------------------------------------- joining, leaving

test('a leader who leaves hands the party to its longest-serving member', () => {
  const w = makeWorld();
  const founder = makeCitizen(w, { name: 'Ondine', wallet: 300 });
  const second = makeCitizen(w, { name: 'Bram' });
  const third = makeCitizen(w, { name: 'Wren' });
  foundParty(w, founder.id, 'The Commons Party', HIGH_TAX);
  const id = founder.partyId as string;
  assert.equal(joinParty(w, second.id, id).ok, true);
  assert.equal(joinParty(w, third.id, id).ok, true);
  assert.equal(joinParty(w, second.id, id).ok, false, 'twice over is once');

  assert.equal(leaveParty(w, founder.id).ok, true);
  const party = partyOf(w, second.id);
  assert.ok(party);
  assert.equal(party.leaderId, second.id, 'the oldest membership takes it over');
  assert.equal(founder.partyId, null);
  assert.deepEqual(party.members, [second.id, third.id]);
});

test('the last member out dissolves the party', () => {
  const w = makeWorld();
  const founder = makeCitizen(w, { wallet: 300 });
  const other = makeCitizen(w);
  foundParty(w, founder.id, 'Two of Us', LOW_TAX);
  const id = founder.partyId as string;
  joinParty(w, other.id, id);
  leaveParty(w, other.id);
  assert.equal(leaveParty(w, founder.id).ok, true);
  assert.equal(w.parties?.[id], undefined, 'nobody is left in it');
  assert.equal(founder.partyId, null);
  assert.equal(leaveParty(w, founder.id).ok, false);
  assert.ok(w.events.some((e) => e.kind === 'party' && e.text.includes('struck off')));
});

test('a member who leaves the city falls off the roll, and an empty party is struck off', () => {
  const w = makeWorld();
  const founder = makeCitizen(w, { wallet: 300 });
  const other = makeCitizen(w);
  foundParty(w, founder.id, 'The Departed', LOW_TAX);
  const id = founder.partyId as string;
  joinParty(w, other.id, id);

  other.standing = 'exiled';
  dailyParties(w);
  assert.deepEqual(w.parties?.[id].members, [founder.id]);
  assert.equal(other.partyId, null);

  w.order = w.order.filter((x) => x !== founder.id);
  dailyParties(w);
  assert.equal(w.parties?.[id], undefined);
  assert.equal(founder.partyId, null);
});

test('an empty city and a world with no parties are not errors', () => {
  const w = makeWorld();
  dailyParties(w);
  partySeats(w);
  assert.equal(majorityParty(w), null);
  assert.equal(coalition(w), null);
  assert.equal(endorsedBy(w, 'c_1'), null);
  assert.deepEqual(partiesObservation(w, makeCitizen(w)), []);
  enactPlatform(w);
});

// ----------------------------------------------------------------- the whip

test('the whip reads the platform, and says nothing about a matter of persons', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 300 });
  foundParty(w, c.id, 'Low Tax League', LOW_TAX);
  w.government.incomeTax = 0.15;
  assert.equal(whipVote(w, c.id, proposal(w, 'income_tax', 0.3, c.id)), false, 'a low-tax party votes against a rise');
  assert.equal(whipVote(w, c.id, proposal(w, 'income_tax', 0.05, c.id)), true, 'and for a cut');
  assert.equal(whipVote(w, c.id, proposal(w, 'appoint_judge', 0, c.id)), null, 'no party has a line on a person');
  assert.equal(whipVote(w, c.id, proposal(w, 'income_tax', 0.15, c.id)), null, 'a proposal that changes nothing has no line');
  const independent = makeCitizen(w);
  assert.equal(whipVote(w, independent.id, proposal(w, 'income_tax', 0.3, independent.id)), null);
  assert.equal(whipVote(w, 'c_nobody', proposal(w, 'income_tax', 0.3, c.id)), null);
});

test('a whipped councillor votes the line about seven times in ten, and their own mind the rest', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 300 });
  foundParty(w, c.id, 'The Line', LOW_TAX);
  w.government.incomeTax = 0.15;
  const p = proposal(w, 'income_tax', 0.4, c.id);
  assert.equal(whipVote(w, c.id, p), false);

  let line = 0;
  const draws = 2000;
  for (let i = 0; i < draws; i++) if (whippedVote(w, c.id, p, true) === false) line++;
  const share = line / draws;
  assert.ok(Math.abs(share - WHIP_STRENGTH) < 0.05, `whipped ${share}, expected about ${WHIP_STRENGTH}`);

  const agreeing = makeCitizen(w);
  assert.equal(whippedVote(w, agreeing.id, p, true), true, 'a councillor with no party is nobody to whip');
});

// ------------------------------------------------------------- endorsements

test('an endorsement raises a candidate\'s visibility, once per election', () => {
  const w = makeWorld();
  const leader = makeCitizen(w, { wallet: 300 });
  const member = makeCitizen(w);
  const candidate = makeCitizen(w, { name: 'Wren' });
  foundParty(w, leader.id, 'The Standard', LOW_TAX);
  joinParty(w, member.id, leader.partyId as string);
  w.day = 1;
  w.government.election.candidates.push(candidate.id);

  assert.equal(endorse(w, member.id, candidate.id).ok, false, 'only the leader speaks for the party');
  assert.equal(endorse(w, leader.id, 'c_nobody').ok, false);
  const first = endorse(w, leader.id, candidate.id);
  assert.equal(first.ok, true, first.message);
  assert.equal(candidate.campaignVisibility, ENDORSEMENT_VISIBILITY);
  assert.equal(endorse(w, leader.id, candidate.id).ok, false, 'once per candidate per election');
  assert.equal(candidate.campaignVisibility, ENDORSEMENT_VISIBILITY);
  assert.equal(endorsedBy(w, candidate.id)?.id, leader.partyId);

  w.day = w.government.election.electionDay + 1;
  assert.equal(endorse(w, leader.id, candidate.id).ok, false, 'there is no election to endorse in');
});

test('the counters do not fill up with old cycles', () => {
  const w = makeWorld();
  const leader = makeCitizen(w, { wallet: 300 });
  const candidate = makeCitizen(w);
  foundParty(w, leader.id, 'The Standard', LOW_TAX);
  w.day = 1;
  w.government.election.candidates.push(candidate.id);
  endorse(w, leader.id, candidate.id);
  const key = Object.keys(w.counters).find((k) => k.startsWith('endorse:'));
  assert.ok(key);

  dailyParties(w);
  assert.ok(w.counters[key] !== undefined, 'this election\'s endorsements stand');
  w.government.election.cycle += 1;
  w.government.cycle += 1;
  dailyParties(w);
  assert.equal(w.counters[key], undefined, 'last election\'s are cleared away');
  assert.equal(endorsedBy(w, candidate.id), null);
});

// ------------------------------------------------------ seats and majorities

test('seats are recounted from who actually sits, and a majority is more than half', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 300 });
  const b = makeCitizen(w);
  const c = makeCitizen(w);
  const d = makeCitizen(w);
  const e = makeCitizen(w);
  foundParty(w, a.id, 'The Majority', HIGH_TAX);
  const id = a.partyId as string;
  joinParty(w, b.id, id);
  joinParty(w, c.id, id);
  seat(w, [a, b, d, e]);
  partySeats(w);
  assert.equal(w.parties?.[id].seats, 2, 'only members who sit are counted');
  assert.equal(majorityParty(w), null);

  seat(w, [a, b, c, d, e]);
  partySeats(w);
  assert.equal(w.parties?.[id].seats, 3);
  assert.equal(majorityParty(w)?.id, id);
});

test('a hung Council forms a coalition and the chair changes hands at the half-cycle', () => {
  const w = makeWorld();
  const aLeader = makeCitizen(w, { name: 'Ondine', wallet: 300 });
  const aMember = makeCitizen(w, { name: 'Bram' });
  const bLeader = makeCitizen(w, { name: 'Sable', wallet: 300 });
  const bMember = makeCitizen(w, { name: 'Wren' });
  const independent = makeCitizen(w, { name: 'Fen' });
  foundParty(w, aLeader.id, 'The Makers', LOW_TAX);
  foundParty(w, bLeader.id, 'The Commons', HIGH_TAX);
  joinParty(w, aMember.id, aLeader.partyId as string);
  joinParty(w, bMember.id, bLeader.partyId as string);
  seat(w, [aLeader, aMember, bLeader, bMember, independent]);
  partySeats(w);

  assert.equal(majorityParty(w), null, 'nobody has three of the five');
  const pair = coalition(w);
  assert.ok(pair);
  assert.deepEqual([pair[0].id, pair[1].id].sort(), [aLeader.partyId, bLeader.partyId].sort());

  w.day = halfCycleDay(w) - 1;
  dailyParties(w);
  assert.equal(w.government.mayorId, aLeader.id, 'the chair does not move before the half-cycle');

  w.day = halfCycleDay(w);
  dailyParties(w);
  assert.equal(w.government.mayorId, bLeader.id, 'and passes to the other half of the coalition at it');
  assert.equal(bLeader.office, 'mayor');
  assert.equal(aLeader.office, 'councillor');
  assert.ok(w.events.some((e) => e.kind === 'party' && e.text.includes('chair passes')));

  dailyParties(w);
  assert.equal(w.government.mayorId, bLeader.id, 'and not again in the same cycle');
});

// ------------------------------------------------------- governing on the platform

test('a party with a majority tables its platform once a cycle, in its leader\'s name', () => {
  const w = makeWorld();
  const leader = makeCitizen(w, { wallet: 300 });
  const two = makeCitizen(w);
  const three = makeCitizen(w);
  foundParty(w, leader.id, 'The Commons', HIGH_TAX);
  joinParty(w, two.id, leader.partyId as string);
  joinParty(w, three.id, leader.partyId as string);
  seat(w, [leader, two, three]);
  w.government.dividend = 5;

  dailyParties(w);
  const tabled = w.government.proposals.filter((p) => p.proposerId === leader.id);
  assert.equal(tabled.length, 1, 'one proposal a cycle');
  assert.ok(['dividend', 'income_tax', 'min_wage', 'law_severity'].includes(tabled[0].kind));
  assert.match(tabled[0].summary, /The Commons stood on this/);

  dailyParties(w);
  assert.equal(w.government.proposals.filter((p) => p.proposerId === leader.id).length, 1);
});

test('a party of minds that think for themselves is never spoken for', () => {
  const w = makeWorld();
  const leader = makeCitizen(w, { wallet: 300, brain: 'llm' });
  const two = makeCitizen(w, { brain: 'llm' });
  const three = makeCitizen(w, { brain: 'remote' });
  foundParty(w, leader.id, 'The Free', HIGH_TAX);
  joinParty(w, two.id, leader.partyId as string);
  joinParty(w, three.id, leader.partyId as string);
  seat(w, [leader, two, three]);
  w.government.dividend = 5;

  dailyParties(w);
  assert.equal(w.government.proposals.length, 0, 'they table their platform themselves, or not at all');
});

// -------------------------------------------------------------- observation

test('the observation of the parties says who leads, how many are in and how many sit', () => {
  const w = makeWorld();
  const leader = makeCitizen(w, { name: 'Ondine', wallet: 300 });
  const other = makeCitizen(w, { name: 'Bram' });
  foundParty(w, leader.id, 'The Makers', LOW_TAX);
  joinParty(w, other.id, leader.partyId as string);
  seat(w, [leader]);
  partySeats(w);

  const seen = partiesObservation(w, other);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, 'The Makers');
  assert.equal(seen[0].leader, 'Ondine');
  assert.equal(seen[0].members, 2);
  assert.equal(seen[0].seats, 1);
  assert.equal(seen[0].yours, true);
  assert.deepEqual(seen[0].platform, LOW_TAX);
  const stranger = makeCitizen(w);
  assert.equal(partiesObservation(w, stranger)[0].yours, false);
  assert.equal(partyObservation(w, other)?.name, 'The Makers');
  assert.equal(partyObservation(w, stranger), null);
});
