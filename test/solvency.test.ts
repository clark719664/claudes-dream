/**
 * Solvency over the long run.
 *
 * Every other test in this repository asks whether a rule is arithmetically
 * right. This one asks the only question the arithmetic cannot answer: run a
 * whole city for five months and see whether it can still pay for itself at
 * the end.
 *
 * It exists because the answer used to be no, and nothing caught it. The
 * Treasury opened at 89,760 ℓ on seed 7 and fell almost every single day —
 * 43,789 ℓ by day 60, 7,918 ℓ by day 150 — with the money-supply audit clean
 * throughout, no engine errors, the population growing and employment holding.
 * Every unit test passed on every one of those days. On seed 1 the same code
 * left 115 ℓ in the Treasury on its worst morning. A city can be perfectly
 * conserved and perfectly broke.
 *
 * Three things were wrong and all three are asserted here rather than
 * described:
 *
 * - the wage budget deducted a *list* of costs and everything it did not name
 *   was simply spent, and the day it measured excluded the whole morning
 *   rollover, which is where most of the city's spending happens
 *   (`economy/budget.ts`);
 * - the dividend floated up a lumen a day whenever the balance stood above the
 *   Council's reserve, however fast the Treasury was emptying, and a single
 *   party platform motion could set a rate the city could never pay
 *   (`markets/levers.ts`, `economy/treasury.ts`);
 * - and the Council's own test for a strained Treasury was denominated in the
 *   dividend, so trimming the dividend silenced the alarm (`government/council.ts`).
 *
 * The city is still free to spend itself into trouble — that is a Council's
 * right, and the founding rush is *meant* to run a deficit. What it may not do
 * is ride a one-way ramp to zero with every instrument reading green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { World } from '../src/types.ts';
import { reflexBrain } from '../src/brains/reflex.ts';
import { createWorld, runDays } from '../src/world/world.ts';
import { auditMoneySupply, moneySupply } from '../src/economy/treasury.ts';

/** Long enough for the founding rush to end and the city to have to live on its income. */
const DAYS = 155;
/** Founders. Smaller than the CLI's forty so the run fits in a test. */
const POPULATION = 24;
const SEED = 7;

/**
 * The Treasury may never fall below a tenth of what the city was founded with.
 * This is a floor, not a target: a healthy run finishes several times above it.
 * It is set low on purpose — the point is to catch a ramp to zero, not to
 * freeze one seed's numbers into an assertion that breaks whenever a citizen
 * makes a different choice.
 */
const FLOOR_SHARE = 0.1;

interface Day { day: number; treasury: number; supply: number; expected: number }

let cached: { world: World; days: Day[] } | null = null;

async function city(): Promise<{ world: World; days: Day[] }> {
  if (cached) return cached;
  const world = createWorld({ seed: SEED, seedPopulation: POPULATION });
  const days: Day[] = [];
  for (let d = 0; d < DAYS; d++) {
    await runDays(world, 1, { brainFor: () => reflexBrain });
    const t = world.treasury;
    days.push({ day: world.day, treasury: t.balance, supply: moneySupply(world), expected: t.foundingSupply + t.minted - t.burned });
  }
  cached = { world, days };
  return cached;
}

/** Lumens a day the Treasury gained (negative) or lost (positive) between two days. */
function slope(days: Day[], from: number, to: number): number {
  return (days[from].treasury - days[to].treasury) / (to - from);
}

test('the Treasury holds a floor over five months, and no lumen is made or lost doing it',
  { timeout: 900_000 }, async () => {
    const { world, days } = await city();
    const floor = Math.round(world.treasury.foundingSupply * FLOOR_SHARE);

    for (const d of days) {
      assert.equal(d.supply, d.expected,
        `day ${d.day}: ${d.supply} ℓ in circulation against ${d.expected} ℓ founded, minted and burned`);
      assert.ok(d.treasury >= floor,
        `day ${d.day}: the Treasury was down to ${d.treasury} ℓ, under the ${floor} ℓ floor`);
    }
    assert.ok(auditMoneySupply(world).ok, 'the city audits its own money supply and finds it whole');
    assert.equal(world.counters.engineErrors ?? 0, 0, 'the run finished without an engine error');
    assert.ok(world.order.length > POPULATION, 'the city grew, so the bill it has to pay grew with it');
  });

test('the city stops losing money: a founding rush is allowed, a one-way ramp is not',
  { timeout: 900_000 }, async () => {
    const { days } = await city();
    const founding = slope(days, 0, 50);
    const middle = slope(days, 50, 100);
    const settled = slope(days, 100, DAYS - 1);

    // The founding city is spending capital it has against an income it does
    // not have yet, and it is allowed to: what has to happen is that the loss
    // falls away as the city grows into its own economy. The middle stretch is
    // not asserted against the first — an election, a party platform or a bad
    // fortnight can make any single fifty days worse than the fifty before it,
    // and a city where that is forbidden is a city on rails.
    assert.ok(settled < founding / 2,
      `the loss has to fall away: ${Math.round(founding)} → ${Math.round(middle)} → ${Math.round(settled)} ℓ a day`);
    // And the last third is close enough to flat that the balance is not on
    // its way anywhere: at this rate the Treasury has years, not months.
    assert.ok(settled < days[100].treasury / 400,
      `the last third still loses ${Math.round(settled)} ℓ a day against ${days[100].treasury} ℓ in hand`);
    assert.ok(days[DAYS - 1].treasury > days[100].treasury / 2,
      `the Treasury halved again after day 100 (${days[100].treasury} → ${days[DAYS - 1].treasury})`);
  });
