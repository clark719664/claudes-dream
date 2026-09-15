import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { World } from '../src/types.ts';
import { dailyBusinesses } from '../src/economy/business.ts';
import { financeState } from '../src/finance/state.ts';
import {
  CLAIM_DECIDES_AFTER_DAYS, claimOnPot, closePot, grantPotClaim, joinPot, leavePot, openPot, payFromPot,
  payIntoPot, potBalance, potOf, potsOf, resolvePotClaims, votePotClaim,
} from '../src/finance/pot.ts';
import {
  MUTUAL_FEE, MUTUAL_MIN_MEMBERS, allMutuals, claimAid, duesStanding, foundMutual, joinMutual, mutualFor,
  mutualView, payDues, potOfMutual, voteAid,
} from '../src/finance/mutual.ts';

function members(world: World, n: number, wallet = 200) {
  return Array.from({ length: n }, () => makeCitizen(world, { wallet }));
}

test('a pot holds real lumens in a party of its own and conserves the supply', () => {
  const w = makeWorld();
  const [a, b] = members(w, 2);
  const before = totalMoney(w);
  const pot = openPot(w, { name: 'The Lamplighters', founderId: a.id });
  assert.equal(potBalance(w, pot), 0);
  assert.equal(totalMoney(w), before, 'opening a pot mints nothing');

  assert.equal(payIntoPot(w, pot.id, a.id, 50).ok, true);
  assert.equal(payIntoPot(w, pot.id, b.id, 30).ok, true);
  assert.equal(potBalance(w, pot), 80);
  assert.equal(a.wallet, 150);
  assert.equal(totalMoney(w), before, 'lumens moved, none made');

  // The pot's balance is the strongbox's balance and nothing else.
  assert.equal(w.businesses[pot.boxId].treasury, 80);
});

test('a pot never pays out more than it holds', () => {
  const w = makeWorld();
  const [a] = members(w, 1);
  const pot = openPot(w, { name: 'Thin Pot', founderId: a.id });
  payIntoPot(w, pot.id, a.id, 40);
  const paid = payFromPot(w, pot.id, a.id, 500, 'more than there is');
  assert.equal(paid, 40);
  assert.equal(potBalance(w, pot), 0);
  assert.equal(payFromPot(w, pot.id, a.id, 10, 'from an empty pot'), 0);
});

test('a strongbox is never settled like a shop: no profit tax, no payout, no bankruptcy', () => {
  const w = makeWorld();
  const [a] = members(w, 1);
  const pot = openPot(w, { name: 'The Quiet Fund', founderId: a.id });
  payIntoPot(w, pot.id, a.id, 100);
  const treasuryBefore = w.treasury.balance;
  for (let d = 0; d < 5; d++) {
    w.day = d;
    dailyBusinesses(w);
  }
  assert.equal(potBalance(w, pot), 100, 'the pot keeps every lumen paid into it');
  assert.equal(w.treasury.balance, treasuryBefore, 'a mutual pays no profit tax and no rent');
  assert.equal(w.businesses[pot.boxId].dissolvedDay, null, 'and is never wound up for want of profit');
  assert.equal(w.businesses[pot.boxId].daysNegative, 0);
});

test('members vote a claim: a majority pays, a tie refuses, silence lapses', () => {
  const w = makeWorld();
  const [a, b, c] = members(w, 3);
  const pot = openPot(w, { name: 'The Three', founderId: a.id });
  joinPot(w, pot.id, b.id);
  joinPot(w, pot.id, c.id);
  payIntoPot(w, pot.id, a.id, 60);
  payIntoPot(w, pot.id, b.id, 60);

  const claim = claimOnPot(w, pot.id, a.id, 50, 'my forge burned');
  assert.equal(claim.ok, true);
  const claimId = Object.values(financeState(w).potClaims)[0].id;
  assert.equal(votePotClaim(w, claimId, a.id, true).ok, true, 'a claimant may vote on their own claim');
  assert.equal(votePotClaim(w, claimId, b.id, true).ok, true);
  assert.equal(votePotClaim(w, claimId, c.id, false).ok, true);
  const walletBefore = a.wallet;
  const supply = totalMoney(w);
  resolvePotClaims(w);
  assert.equal(financeState(w).potClaims[claimId].status, 'granted');
  assert.equal(a.wallet, walletBefore + 50);
  assert.equal(potBalance(w, pot), 70);
  assert.equal(totalMoney(w), supply);

  // A tie is not a majority.
  claimOnPot(w, pot.id, b.id, 20, 'a funeral');
  const tied = Object.values(financeState(w).potClaims).find((k) => k.claimantId === b.id)!;
  votePotClaim(w, tied.id, a.id, true);
  votePotClaim(w, tied.id, c.id, false);
  w.day += CLAIM_DECIDES_AFTER_DAYS;
  resolvePotClaims(w);
  assert.equal(financeState(w).potClaims[tied.id].status, 'refused');

  // Nobody voted at all: it lapses rather than passing by default.
  claimOnPot(w, pot.id, c.id, 10, 'a fortnight without work');
  const ignored = Object.values(financeState(w).potClaims).find((k) => k.claimantId === c.id)!;
  w.day += CLAIM_DECIDES_AFTER_DAYS;
  resolvePotClaims(w);
  assert.equal(financeState(w).potClaims[ignored.id].status, 'lapsed');
});

test('a claim carried against an empty pot pays nothing and says so', () => {
  const w = makeWorld();
  const [a, b] = members(w, 2);
  const pot = openPot(w, { name: 'Empty', founderId: a.id });
  joinPot(w, pot.id, b.id);
  claimOnPot(w, pot.id, a.id, 40, 'nothing left');
  const claim = Object.values(financeState(w).potClaims)[0];
  votePotClaim(w, claim.id, b.id, true);
  resolvePotClaims(w);
  assert.equal(claim.status, 'granted');
  assert.equal(claim.paid, 0);
});

test("a steward's pot is decided by the steward, and a members' pot never is", () => {
  const w = makeWorld();
  const [a, b] = members(w, 2);
  const stewarded = openPot(w, { name: 'The Rule of One', founderId: a.id, rule: 'steward', stewardId: a.id });
  joinPot(w, stewarded.id, b.id);
  payIntoPot(w, stewarded.id, a.id, 80, 'dues');
  claimOnPot(w, stewarded.id, b.id, 30, 'a fine to pay');
  const claim = Object.values(financeState(w).potClaims)[0];
  resolvePotClaims(w);
  assert.equal(claim.status, 'open', 'a steward decides in their own hour, not by a vote');
  assert.equal(grantPotClaim(w, claim.id, b.id).ok, false, 'and only the steward decides');
  const before = b.wallet;
  assert.equal(grantPotClaim(w, claim.id, a.id).ok, true);
  assert.equal(b.wallet, before + 30);

  const voted = openPot(w, { name: 'The Rule of Many', founderId: a.id });
  claimOnPot(w, voted.id, a.id, 10, 'a claim');
  const second = Object.values(financeState(w).potClaims).find((k) => k.potId === voted.id)!;
  assert.match(grantPotClaim(w, second.id, a.id).message, /vote of the members/);
});

test('a pot short of the members it needs pays nothing', () => {
  const w = makeWorld();
  const [a, b] = members(w, 2);
  const pot = openPot(w, { name: 'Not Yet Five', founderId: a.id, minMembers: 5 });
  joinPot(w, pot.id, b.id);
  payIntoPot(w, pot.id, a.id, 100);
  claimOnPot(w, pot.id, a.id, 20, 'too soon');
  const claim = Object.values(financeState(w).potClaims)[0];
  votePotClaim(w, claim.id, b.id, true);
  resolvePotClaims(w);
  assert.equal(claim.status, 'refused');
  assert.equal(potBalance(w, pot), 100);
});

test('leaving a pot leaves what you paid in; closing one shares it out', () => {
  const w = makeWorld();
  const [a, b] = members(w, 2);
  const pot = openPot(w, { name: 'The Parting', founderId: a.id });
  joinPot(w, pot.id, b.id);
  payIntoPot(w, pot.id, a.id, 60);
  assert.equal(leavePot(w, pot.id, a.id).ok, true);
  assert.equal(potBalance(w, pot), 60, 'what you paid in stays in the pot');
  assert.equal(potsOf(w, a.id).length, 0);

  const supply = totalMoney(w);
  const before = b.wallet;
  closePot(w, pot.id);
  assert.equal(b.wallet, before + 60);
  assert.equal(totalMoney(w), supply);
  assert.equal(potOf(w, pot.id), null);
});

test('a mutual is five adults, 50 lumens and a subscription', () => {
  const w = makeWorld();
  const founder = makeCitizen(w, { wallet: 200 });
  assert.equal(foundMutual(w, founder.id, '', 5).ok, false);
  assert.equal(foundMutual(w, founder.id, 'The Lantern Society', 0).ok, false, 'dues have a floor');
  assert.equal(foundMutual(w, founder.id, 'The Lantern Society', 500).ok, false, 'and a ceiling');
  const poor = makeCitizen(w, { wallet: 10 });
  assert.match(foundMutual(w, poor.id, 'The Poor Society', 2).message, /costs/);

  const supply = totalMoney(w);
  const treasury = w.treasury.balance;
  assert.equal(foundMutual(w, founder.id, 'The Lantern Society', 3).ok, true);
  assert.equal(founder.wallet, 150);
  assert.equal(w.treasury.balance, treasury + MUTUAL_FEE, 'the fee is the club fee, and it is the city that takes it');
  assert.equal(totalMoney(w), supply);
  assert.equal(foundMutual(w, founder.id, 'Another Society', 3).ok, false, 'one mutual each');
  const other = makeCitizen(w, { wallet: 200 });
  assert.equal(foundMutual(w, other.id, 'the lantern society', 3).ok, false, 'and one of each name');
  assert.equal(allMutuals(w).length, 1);
});

test('a mutual pays a claim its members vote for, and never more than the pot', () => {
  const w = makeWorld();
  const [founder, ...rest] = members(w, MUTUAL_MIN_MEMBERS, 300);
  assert.equal(foundMutual(w, founder.id, 'The Ninefold', 5).ok, true);
  const mutual = mutualFor(w, founder.id)!;
  for (const c of rest) assert.equal(joinMutual(w, mutual.id, c.id).ok, true);
  assert.equal(potOfMutual(w, mutual)!.members.length, MUTUAL_MIN_MEMBERS);
  assert.equal(joinMutual(w, mutual.id, founder.id).ok, false, 'a citizen belongs to one mutual');

  // Dues, once a day, into the pot.
  for (const c of [founder, ...rest]) assert.equal(payDues(w, c.id).ok, true);
  assert.equal(payDues(w, founder.id).ok, false, 'and only once');
  const pot = potOfMutual(w, mutual)!;
  assert.equal(potBalance(w, pot), 5 * MUTUAL_MIN_MEMBERS);

  const supply = totalMoney(w);
  assert.equal(claimAid(w, founder.id, 20, 'my roof went in the storm').ok, true);
  const claim = Object.values(financeState(w).potClaims)[0];
  for (const c of rest) assert.equal(voteAid(w, claim.id, c.id, true).ok, true);
  const before = founder.wallet;
  resolvePotClaims(w);
  assert.equal(claim.status, 'granted');
  assert.equal(founder.wallet, before + 20);
  assert.equal(totalMoney(w), supply, 'a payout moves lumens and makes none');

  // A claim for more than the pot holds pays the pot out and no more.
  assert.equal(claimAid(w, rest[0].id, 1_000, 'everything').ok, true);
  const big = Object.values(financeState(w).potClaims).find((k) => k.claimantId === rest[0].id)!;
  for (const c of [founder, ...rest.slice(1)]) voteAid(w, big.id, c.id, true);
  resolvePotClaims(w);
  assert.equal(big.paid, 5);
  assert.equal(potBalance(w, pot), 0);
});

test('a mutual is not an underwriter: the members may simply say no', () => {
  const w = makeWorld();
  const [founder, ...rest] = members(w, MUTUAL_MIN_MEMBERS, 300);
  foundMutual(w, founder.id, 'The Hard Cases', 4);
  const mutual = mutualFor(w, founder.id)!;
  for (const c of rest) joinMutual(w, mutual.id, c.id);
  for (const c of [founder, ...rest]) payDues(w, c.id);
  claimAid(w, founder.id, 10, 'a claim the others do not think much of');
  const claim = Object.values(financeState(w).potClaims)[0];
  for (const c of rest) voteAid(w, claim.id, c.id, false);
  const before = founder.wallet;
  resolvePotClaims(w);
  assert.equal(claim.status, 'refused');
  assert.equal(founder.wallet, before, 'no formula, no entitlement');
});

test('the roll shows arrears without barring anybody from asking', () => {
  const w = makeWorld();
  const [founder, ...rest] = members(w, MUTUAL_MIN_MEMBERS, 300);
  foundMutual(w, founder.id, 'The Arrears', 2);
  const mutual = mutualFor(w, founder.id)!;
  for (const c of rest) joinMutual(w, mutual.id, c.id);
  payDues(w, founder.id);
  w.day += 5;
  assert.equal(duesStanding(w, mutual, founder.id).days, 5);
  assert.equal(duesStanding(w, mutual, founder.id).arrears, true);
  assert.equal(claimAid(w, founder.id, 5, 'behind on my dues and still asking').ok, true);
  const view = mutualView(w, founder.id)!;
  assert.equal(view.arrears, true);
  assert.equal(view.members, MUTUAL_MIN_MEMBERS);
  assert.equal(view.openClaims.length, 1);
});

test('a claimant may not stack claims, and a stranger may not vote', () => {
  const w = makeWorld();
  const [a, b] = members(w, 2);
  const stranger = makeCitizen(w);
  const pot = openPot(w, { name: 'The Closed Room', founderId: a.id });
  joinPot(w, pot.id, b.id);
  payIntoPot(w, pot.id, a.id, 40);
  assert.equal(claimOnPot(w, pot.id, a.id, 10, 'once').ok, true);
  assert.equal(claimOnPot(w, pot.id, a.id, 10, 'twice').ok, false);
  assert.equal(claimOnPot(w, pot.id, stranger.id, 10, 'not a member').ok, false);
  const claim = Object.values(financeState(w).potClaims)[0];
  assert.equal(votePotClaim(w, claim.id, stranger.id, true).ok, false);
});
