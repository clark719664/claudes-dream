/**
 * The Council's newer levers (src/markets/levers.ts).
 *
 * A tax on let property, a tax on large wallets, the tariff at the Docks, and
 * the reserve the dividend floats against. Every one of them is a number the
 * Council votes on; this file only checks that the arithmetic is honest, that
 * the bounds hold, and that nothing here makes or loses a lumen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Proposal, ProposalKind, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { WEALTH_TAX_THRESHOLD } from '../src/data/metropolis.ts';
import { tariff } from '../src/markets/outer.ts';
import {
  DIVIDEND_MAX, DIVIDEND_MIN, PROPERTY_TAX_MAX, RESERVE_LOWER, RESERVE_MAX, RESERVE_STEP,
  RESERVE_UPPER, TARIFF_MAX, WEALTH_TAX_MAX,
  applyLever, collectWealthTax, dailyLevers, floatDividend, isLeverProposal, leverRanges,
  leversObservation, propertyTaxRate, reserveTarget, tariffRate, wealthTaxRate,
} from '../src/markets/levers.ts';

type Levers = { propertyTax?: number; wealthTax?: number; reserveTarget?: number };

function proposal(world: World, kind: string, value: number): Proposal {
  return {
    id: `p_${world.government.proposals.length + 1}`, kind: kind as ProposalKind, value, lawCode: null,
    targetId: null, summary: kind, proposerId: 'c_1', petition: false,
    tabledDay: world.day, status: 'passed', votes: {}, decidedDay: world.day, needed: 3,
  };
}

// ---------------------------------------------------------------------------
// Reading the levers
// ---------------------------------------------------------------------------

test('a city that has never voted on a lever reads every one of them as nothing', () => {
  const world = makeWorld();
  assert.equal(propertyTaxRate(world), 0);
  assert.equal(wealthTaxRate(world), 0);
  assert.equal(reserveTarget(world), 0);
  assert.equal(tariffRate(world), 0);
  assert.deepEqual(leversObservation(world), { propertyTax: 0, wealthTax: 0, tariff: 0, reserveTarget: 0 });
});

test('a lever read back is always inside its bounds, whatever nonsense it holds', () => {
  const world = makeWorld();
  const g = world.government as unknown as Levers;
  g.propertyTax = 9;
  g.wealthTax = 9;
  g.reserveTarget = RESERVE_MAX * 10;
  assert.equal(propertyTaxRate(world), PROPERTY_TAX_MAX);
  assert.equal(wealthTaxRate(world), WEALTH_TAX_MAX);
  assert.equal(reserveTarget(world), RESERVE_MAX);

  g.propertyTax = Number.NaN;
  g.wealthTax = -1;
  g.reserveTarget = Number.NaN;
  assert.equal(propertyTaxRate(world), 0);
  assert.equal(wealthTaxRate(world), 0);
  assert.equal(reserveTarget(world), 0);
});

test('the ranges the Council votes inside are the ones the Charter allows', () => {
  const ranges = leverRanges();
  assert.deepEqual(ranges.property_tax, [0, PROPERTY_TAX_MAX]);
  assert.deepEqual(ranges.wealth_tax, [0, WEALTH_TAX_MAX]);
  assert.deepEqual(ranges.tariff, [0, TARIFF_MAX]);
  assert.deepEqual(ranges.reserve, [0, RESERVE_MAX]);
});

// ---------------------------------------------------------------------------
// Enacting
// ---------------------------------------------------------------------------

test('a passed lever proposal moves the number and says what it did', () => {
  const world = makeWorld();
  const g = world.government as unknown as Levers;

  assert.ok(applyLever(world, proposal(world, 'property_tax', 0.3)).includes('30%'));
  assert.equal(g.propertyTax, 0.3);
  assert.ok(applyLever(world, proposal(world, 'wealth_tax', 0.01)).length > 0);
  assert.equal(g.wealthTax, 0.01);
  assert.ok(applyLever(world, proposal(world, 'tariff', 0.4)).includes('40%'));
  assert.equal(tariff(world), 0.4);
  assert.ok(applyLever(world, proposal(world, 'reserve', 5_000)).includes('5000'));
  assert.equal(reserveTarget(world), 5_000);
  assert.ok(applyLever(world, proposal(world, 'reserve', 0)).includes('no reserve'));
});

test('a value outside a lever\'s range is clamped, and an unknown lever changes nothing', () => {
  const world = makeWorld();
  applyLever(world, proposal(world, 'property_tax', 5));
  assert.equal(propertyTaxRate(world), PROPERTY_TAX_MAX);
  applyLever(world, proposal(world, 'wealth_tax', -3));
  assert.equal(wealthTaxRate(world), 0);
  applyLever(world, proposal(world, 'tariff', 99));
  assert.equal(tariffRate(world), TARIFF_MAX);
  applyLever(world, proposal(world, 'reserve', -1));
  assert.equal(reserveTarget(world), 0);

  const before = leversObservation(world);
  assert.ok(applyLever(world, proposal(world, 'pardon', 1)).includes('not a lever'));
  assert.deepEqual(leversObservation(world), before);

  assert.equal(isLeverProposal(proposal(world, 'tariff', 0)), true);
  assert.equal(isLeverProposal(proposal(world, 'income_tax', 0)), false);
});

// ---------------------------------------------------------------------------
// The wealth tax
// ---------------------------------------------------------------------------

test('the wealth tax touches only the part of a wallet above the threshold, and conserves money', () => {
  const world = makeWorld();
  const rich = makeCitizen(world, { name: 'Rich', wallet: WEALTH_TAX_THRESHOLD + 2_000 });
  const modest = makeCitizen(world, { name: 'Modest', wallet: WEALTH_TAX_THRESHOLD });
  const poor = makeCitizen(world, { name: 'Poor', wallet: 10 });
  (world.government as unknown as Levers).wealthTax = 0.01;

  const before = totalMoney(world);
  const treasuryBefore = world.treasury.balance;
  const took = collectWealthTax(world);

  assert.equal(took, 20, 'a hundredth of the 2,000 ℓ held above the threshold');
  assert.equal(rich.wallet, WEALTH_TAX_THRESHOLD + 2_000 - 20);
  assert.equal(modest.wallet, WEALTH_TAX_THRESHOLD, 'exactly at the threshold, nothing is owed');
  assert.equal(poor.wallet, 10);
  assert.equal(world.treasury.balance, treasuryBefore + 20);
  assert.equal(totalMoney(world), before);
  assert.ok(rich.memory.some((m) => m.text.includes('wealth tax')));
  assert.ok(world.events.some((e) => e.kind === 'treasury' && e.text.includes('wealth tax')));
});

test('with no wealth tax set, nothing is taken and nobody is told', () => {
  const world = makeWorld();
  makeCitizen(world, { name: 'Rich', wallet: 50_000 });
  const before = totalMoney(world);
  assert.equal(collectWealthTax(world), 0);
  assert.equal(totalMoney(world), before);
  assert.equal(world.events.length, 0);
});

test('the wealth tax does not follow an exile out of the city', () => {
  const world = makeWorld();
  const gone = makeCitizen(world, { name: 'Gone', wallet: 10_000, standing: 'exiled' });
  world.order = world.order.filter((id) => id !== gone.id);
  const here = makeCitizen(world, { name: 'Here', wallet: 10_000 });
  (world.government as unknown as Levers).wealthTax = WEALTH_TAX_MAX;

  const before = totalMoney(world);
  collectWealthTax(world);
  assert.equal(gone.wallet, 10_000);
  assert.ok(here.wallet < 10_000);
  assert.equal(totalMoney(world), before);
});

// ---------------------------------------------------------------------------
// The reserve, and the dividend that floats against it
// ---------------------------------------------------------------------------

test('with no reserve target the dividend does not float at all', () => {
  const world = makeWorld();
  const dividend = world.government.dividend;
  world.treasury.balance = 1;
  floatDividend(world);
  assert.equal(world.government.dividend, dividend);
  world.treasury.balance = 10_000_000;
  floatDividend(world);
  assert.equal(world.government.dividend, dividend);
});

test('a Treasury above its reserve raises the dividend a lumen a day, and below lowers it', () => {
  const world = makeWorld();
  (world.government as unknown as Levers).reserveTarget = 10_000;
  world.government.dividend = 15;

  world.treasury.balance = Math.ceil(10_000 * RESERVE_UPPER) + 1;
  floatDividend(world);
  assert.equal(world.government.dividend, 15 + RESERVE_STEP);
  floatDividend(world);
  assert.equal(world.government.dividend, 15 + 2 * RESERVE_STEP);

  world.treasury.balance = Math.floor(10_000 * RESERVE_LOWER) - 1;
  floatDividend(world);
  assert.equal(world.government.dividend, 15 + RESERVE_STEP);

  // inside the band nothing moves
  world.treasury.balance = 10_000;
  const steady = world.government.dividend;
  floatDividend(world);
  assert.equal(world.government.dividend, steady);
  assert.ok(world.events.some((e) => e.kind === 'treasury' && e.text.includes('reserve')));
});

test('the floating dividend never leaves the bounds the Charter gives it', () => {
  const world = makeWorld();
  (world.government as unknown as Levers).reserveTarget = 1_000;
  world.government.dividend = DIVIDEND_MAX;
  world.treasury.balance = 1_000_000;
  for (let d = 0; d < 20; d++) floatDividend(world);
  assert.equal(world.government.dividend, DIVIDEND_MAX);

  world.government.dividend = DIVIDEND_MIN;
  world.treasury.balance = 0;
  for (let d = 0; d < 20; d++) floatDividend(world);
  assert.equal(world.government.dividend, DIVIDEND_MIN);
});

test('the daily pass takes the tax first and floats the dividend after, and conserves money', () => {
  const world = makeWorld();
  const rich = makeCitizen(world, { name: 'Rich', wallet: 100_000 });
  const g = world.government as unknown as Levers;
  g.wealthTax = WEALTH_TAX_MAX;
  g.reserveTarget = 1_000;
  world.government.dividend = 10;
  world.treasury.balance = 5_000;

  const before = totalMoney(world);
  dailyLevers(world);
  const expectedTax = Math.round((100_000 - WEALTH_TAX_THRESHOLD) * WEALTH_TAX_MAX);
  assert.equal(rich.wallet, 100_000 - expectedTax);
  assert.equal(world.government.dividend, 11, 'the balance was over target once the tax was in');
  assert.equal(totalMoney(world), before);
});

test('a week of the daily pass on an empty city changes nothing', () => {
  const world = makeWorld();
  const before = totalMoney(world);
  const dividend = world.government.dividend;
  for (let d = 0; d < 7; d++) { world.day = d; dailyLevers(world); }
  assert.equal(totalMoney(world), before);
  assert.equal(world.government.dividend, dividend);
});

test('the observation reads all four levers back, tariff included', () => {
  const world = makeWorld();
  applyLever(world, proposal(world, 'property_tax', 0.2));
  applyLever(world, proposal(world, 'wealth_tax', 0.005));
  applyLever(world, proposal(world, 'tariff', 0.1));
  applyLever(world, proposal(world, 'reserve', 2_500));
  assert.deepEqual(leversObservation(world), {
    propertyTax: 0.2, wealthTax: 0.005, tariff: 0.1, reserveTarget: 2_500,
  });
});
