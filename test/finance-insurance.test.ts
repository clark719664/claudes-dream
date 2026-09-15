import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, World } from '../src/types.ts';
import { transfer } from '../src/economy/treasury.ts';
import { dailyBusinesses } from '../src/economy/business.ts';
import { financeState } from '../src/finance/state.ts';
import {
  PREMIUM_GRACE_DAYS, buyPolicy, dailyInsurance, denyClaim, fileClaim, insuranceView, offerPolicy, openLines,
  policiesOf, policyOf, settleClaim, windUpUnderwriter, withdrawLine,
} from '../src/finance/insurance.ts';
import {
  UNDERWRITER_CAPITAL, UNDERWRITER_FEE, activeUnderwriters, coverWritten, foundUnderwriter, houseFunds,
  underwriterOwnedBy,
} from '../src/finance/houses.ts';
import {
  FLAT_PREMIUM_RATE, LOADING_BASE, hasActuarialTables, loadingFor, lossOnRecord, meanPayout, observedEvents,
  observedRate, quotePremium,
} from '../src/finance/premiums.ts';

/** A citizen the Council's floor would license, with money to pay in. */
function banker(world: World, wallet = 1_000): Citizen {
  const c = makeCitizen(world, { wallet });
  c.skills.commerce = 60;
  return c;
}

function house(world: World, name = 'The Quay Office'): { owner: Citizen; id: string } {
  const owner = banker(world, 1_000);
  assert.equal(foundUnderwriter(world, owner.id, name).ok, true);
  return { owner, id: owner.businessId! };
}

test('an underwriter needs a licence, 500 lumens of capital and a name of its own', () => {
  const w = makeWorld();
  const clerk = makeCitizen(w, { wallet: 1_000 });
  clerk.skills.commerce = 20;
  assert.match(foundUnderwriter(w, clerk.id, 'The Clerk’s Office').message, /licence/);

  const poor = banker(w, 300);
  assert.match(foundUnderwriter(w, poor.id, 'The Thin House').message, /costs/);

  const owner = banker(w, 1_000);
  const supply = totalMoney(w);
  const treasury = w.treasury.balance;
  assert.equal(foundUnderwriter(w, owner.id, '  ').ok, false);
  assert.equal(foundUnderwriter(w, owner.id, 'Harbor Indemnity').ok, true);
  assert.equal(owner.wallet, 1_000 - UNDERWRITER_CAPITAL - UNDERWRITER_FEE);
  assert.equal(houseFunds(w, owner.businessId!), UNDERWRITER_CAPITAL);
  assert.equal(w.treasury.balance, treasury + UNDERWRITER_FEE);
  assert.equal(totalMoney(w), supply, 'capital moved; nothing was made');
  assert.equal(activeUnderwriters(w).length, 1);

  const rival = banker(w, 1_000);
  assert.equal(foundUnderwriter(w, rival.id, 'harbor indemnity').ok, false, 'one of each name');
  assert.equal(foundUnderwriter(w, owner.id, 'Second Office').ok, false, 'one business each');
});

test('the flat quote is four per cent of the value over the term, until the tables exist', () => {
  const w = makeWorld();
  assert.equal(hasActuarialTables(w), false);
  assert.equal(quotePremium(w, 'business', 1_000, 28), Math.round((1_000 * FLAT_PREMIUM_RATE) / 28));
  assert.equal(quotePremium(w, 'home', 200, 7), Math.max(1, Math.round((200 * FLAT_PREMIUM_RATE) / 7)));
});

test('a line is posted by its house and taken as a filed contract', () => {
  const w = makeWorld();
  const { owner, id } = house(w);
  const buyer = makeCitizen(w, { wallet: 500 });
  const stranger = makeCitizen(w);
  assert.equal(offerPolicy(w, stranger.id, { kind: 'business', cover: 400, premium: 3, termDays: 28 }).ok, false);
  assert.equal(offerPolicy(w, owner.id, { kind: 'business', cover: 5, premium: 3, termDays: 28 }).ok, false, 'a floor on cover');
  assert.equal(offerPolicy(w, owner.id, { kind: 'business', cover: 400, premium: 0, termDays: 28 }).ok, false, 'and on the premium');
  assert.equal(offerPolicy(w, owner.id, { kind: 'business', cover: 400, premium: 3, termDays: 2 }).ok, false, 'and on the term');
  assert.equal(offerPolicy(w, owner.id, { kind: 'business', cover: 400, premium: 3, termDays: 28 }).ok, true);

  const offer = openLines(w)[0];
  assert.equal(buyPolicy(w, owner.id, offer.id).ok, false, 'a house does not insure itself');
  const supply = totalMoney(w);
  assert.equal(buyPolicy(w, buyer.id, offer.id).ok, true);
  assert.equal(buyer.wallet, 497, 'the first premium is paid at the counter');
  assert.equal(houseFunds(w, id), UNDERWRITER_CAPITAL + 3);
  assert.equal(totalMoney(w), supply);
  const policy = policiesOf(w, buyer.id)[0];
  assert.equal(policy.cover, 400);
  assert.equal(policy.untilDay, w.day + 28);
  assert.equal(coverWritten(w, id), 400);
  assert.equal(withdrawLine(w, owner.id, offer.id).ok, true);
  assert.equal(policiesOf(w, buyer.id).length, 1, 'the policies already taken stand');
});

test('premiums are collected daily, and a policy nobody pays for lapses', () => {
  const w = makeWorld();
  const { owner } = house(w);
  const buyer = makeCitizen(w, { wallet: 20 });
  offerPolicy(w, owner.id, { kind: 'home', cover: 300, premium: 5, termDays: 28 });
  buyPolicy(w, buyer.id, openLines(w)[0].id);
  assert.equal(buyer.wallet, 15);

  w.day += 1;
  dailyInsurance(w);
  assert.equal(buyer.wallet, 10);
  w.day += 1;
  dailyInsurance(w);
  assert.equal(buyer.wallet, 5);
  w.day += 1;
  dailyInsurance(w);
  assert.equal(buyer.wallet, 0);

  const policy = policiesOf(w, buyer.id)[0];
  for (let i = 0; i <= PREMIUM_GRACE_DAYS; i++) {
    w.day += 1;
    dailyInsurance(w);
  }
  assert.equal(policyOf(w, policy.id)!.status, 'lapsed');
});

test('a policy that runs its term expires', () => {
  const w = makeWorld();
  const { owner } = house(w);
  const buyer = makeCitizen(w, { wallet: 500 });
  offerPolicy(w, owner.id, { kind: 'ship', cover: 300, premium: 2, termDays: 7 });
  buyPolicy(w, buyer.id, openLines(w)[0].id);
  const policy = policiesOf(w, buyer.id)[0];
  w.day += 7;
  dailyInsurance(w);
  assert.equal(policyOf(w, policy.id)!.status, 'expired');
});

test('the registers decide whether a loss happened', () => {
  const w = makeWorld();
  const { owner } = house(w);
  const buyer = makeCitizen(w, { wallet: 500, district: 'foundry_row' });
  offerPolicy(w, owner.id, { kind: 'business', cover: 300, premium: 2, termDays: 28 });
  buyPolicy(w, buyer.id, openLines(w)[0].id);
  const policy = policiesOf(w, buyer.id)[0];
  assert.equal(lossOnRecord(w, policy), false, 'nothing on any register');

  w.disasters.push({ kind: 'forge_fire', day: w.day, district: 'foundry_row', severity: 0.6, resolvedDay: null });
  assert.equal(lossOnRecord(w, policy), true);
  assert.equal(observedEvents(w, 'business'), 1);
  assert.equal(observedRate(w, 'business'), 1 / 56);
});

test('a claim is answered: settled, or refused with a reason', () => {
  const w = makeWorld();
  const { owner, id } = house(w);
  const buyer = makeCitizen(w, { wallet: 500 });
  offerPolicy(w, owner.id, { kind: 'home', cover: 300, premium: 2, termDays: 28 });
  buyPolicy(w, buyer.id, openLines(w)[0].id);
  const policy = policiesOf(w, buyer.id)[0];
  transfer(w, 'treasury', id, 400, 'grant', 'the house is well funded');

  assert.equal(fileClaim(w, buyer.id, policy.id, 'a storm', 0).ok, false);
  assert.equal(fileClaim(w, buyer.id, policy.id, 'a storm', 400).ok, false, 'more than the cover');
  assert.equal(fileClaim(w, owner.id, policy.id, 'a storm', 100).ok, false, 'somebody else’s policy');
  assert.equal(fileClaim(w, buyer.id, policy.id, 'a storm took the roof', 100).ok, true);
  assert.equal(fileClaim(w, buyer.id, policy.id, 'and again', 50).ok, false, 'one claim at a time');

  const claim = Object.values(financeState(w).claims)[0];
  const stranger = makeCitizen(w);
  assert.equal(settleClaim(w, stranger.id, claim.id).ok, false);
  const supply = totalMoney(w);
  const wallet = buyer.wallet;
  assert.equal(settleClaim(w, owner.id, claim.id, 80).ok, true);
  assert.equal(buyer.wallet, wallet + 80);
  assert.equal(claim.status, 'settled');
  assert.equal(policyOf(w, policy.id)!.claimed, 80);
  assert.equal(totalMoney(w), supply);

  assert.equal(fileClaim(w, buyer.id, policy.id, 'another storm', 100).ok, true);
  const second = Object.values(financeState(w).claims).find((k) => k.status === 'open')!;
  assert.equal(denyClaim(w, owner.id, second.id, '').ok, false, 'a denial without a reason is no denial');
  assert.equal(denyClaim(w, owner.id, second.id, 'the register shows no storm that night').ok, true);
  assert.equal(second.status, 'denied');
  assert.equal(second.reason, 'the register shows no storm that night');
});

test('a house that cannot meet a claim pays what it holds and is wound up', () => {
  const w = makeWorld();
  const { owner, id } = house(w);
  const buyer = makeCitizen(w, { wallet: 500 });
  const other = makeCitizen(w, { wallet: 500 });
  offerPolicy(w, owner.id, { kind: 'business', cover: 2_000, premium: 5, termDays: 28 });
  const line = openLines(w)[0].id;
  buyPolicy(w, buyer.id, line);
  buyPolicy(w, other.id, line);
  assert.equal(coverWritten(w, id), 4_000);

  fileClaim(w, buyer.id, policiesOf(w, buyer.id)[0].id, 'the forge burned', 2_000);
  const claim = Object.values(financeState(w).claims)[0];
  const supply = totalMoney(w);
  const held = houseFunds(w, id);
  const wallet = buyer.wallet;
  assert.equal(settleClaim(w, owner.id, claim.id, 2_000).ok, true);
  assert.equal(buyer.wallet, wallet + held, 'it pays what it holds and no more');
  assert.equal(w.businesses[id].dissolvedDay, w.day, 'and is wound up under the ordinary rule');
  assert.equal(policiesOf(w, other.id).length, 0, 'the surviving policies are worth nothing');
  assert.equal(totalMoney(w), supply, 'nothing was created to cover the gap');
  assert.equal(activeUnderwriters(w).length, 0);
});

test('the pro rata wind-up shares what is left among that day’s claimants', () => {
  const w = makeWorld();
  const { owner, id } = house(w);
  const a = makeCitizen(w, { wallet: 500 });
  const b = makeCitizen(w, { wallet: 500 });
  offerPolicy(w, owner.id, { kind: 'home', cover: 900, premium: 1, termDays: 28 });
  const line = openLines(w)[0].id;
  buyPolicy(w, a.id, line);
  buyPolicy(w, b.id, line);
  fileClaim(w, a.id, policiesOf(w, a.id)[0].id, 'a flood', 600);
  fileClaim(w, b.id, policiesOf(w, b.id)[0].id, 'a flood', 300);

  const funds = houseFunds(w, id);
  const supply = totalMoney(w);
  const aBefore = a.wallet;
  const bBefore = b.wallet;
  windUpUnderwriter(w, id, 'it could not meet the day’s claims');
  assert.equal(a.wallet - aBefore, Math.floor((funds * 600) / 900));
  assert.equal(b.wallet - bBefore, Math.floor((funds * 300) / 900));
  assert.equal(totalMoney(w), supply);
  assert.equal(w.businesses[id].dissolvedDay, w.day);
});

test('an underwriter is a business like any other: rent, profit tax, and the owner’s payout', () => {
  const w = makeWorld();
  const { owner, id } = house(w);
  const buyer = makeCitizen(w, { wallet: 2_000 });
  offerPolicy(w, owner.id, { kind: 'business', cover: 1_000, premium: 40, termDays: 28 });
  buyPolicy(w, buyer.id, openLines(w)[0].id);

  const treasury = w.treasury.balance;
  const supply = totalMoney(w);
  dailyBusinesses(w);
  assert.ok(w.treasury.balance > treasury, 'the city took its rent and its share of the profit');
  assert.equal(totalMoney(w), supply);
  assert.equal(w.businesses[id].dissolvedDay, null);
});

test('a thin house has to quote dearer than a deep one', () => {
  const w = makeWorld();
  const { owner, id } = house(w);
  assert.equal(loadingFor(w, id), LOADING_BASE, 'nothing written yet');
  const buyer = makeCitizen(w, { wallet: 500 });
  offerPolicy(w, owner.id, { kind: 'business', cover: 500, premium: 5, termDays: 28 });
  buyPolicy(w, buyer.id, openLines(w)[0].id);
  assert.equal(loadingFor(w, id), LOADING_BASE + 0.5 * (500 / UNDERWRITER_CAPITAL));
  assert.ok(loadingFor(w, null) < loadingFor(w, id));
});

test('the view a citizen reads carries their cover and every house writing', () => {
  const w = makeWorld();
  const { owner } = house(w);
  const buyer = makeCitizen(w, { wallet: 500 });
  offerPolicy(w, owner.id, { kind: 'health', cover: 200, premium: 2, termDays: 14 });
  buyPolicy(w, buyer.id, openLines(w)[0].id);
  const view = insuranceView(w, buyer.id);
  assert.equal(view.policies.length, 1);
  assert.equal(view.houses.length, 1);
  assert.equal(view.houses[0].written, 200);
  assert.equal(underwriterOwnedBy(w, owner.id)!.capital, UNDERWRITER_CAPITAL);
  assert.equal(meanPayout(w, 'health', 42), 42, 'with no settled claims yet, the fallback stands');
});
