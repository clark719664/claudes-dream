/**
 * The Council's newer levers: a tax on let property, a tax on large wallets, a
 * tariff on trade with the Outer Cities, and a **reserve target** — a balance
 * the Treasury tries to hold, against which the citizen's dividend floats.
 *
 * Nothing here decides anything. Every one of the four is a number the Council
 * votes on, and the only thing this file does on its own is nudge the dividend
 * a single lumen a day toward whatever balance the councillors asked the city
 * to keep. A city with no reserve target floats nothing at all.
 *
 * The levers live on `world.government` and are read defensively: a world
 * saved before this layer has none of them, and reads as zero.
 */
import { clamp } from '../types.ts';
import type { Government, Proposal, World } from '../types.ts';
import { WEALTH_TAX_THRESHOLD } from '../data/metropolis.ts';
import { emit, remember } from '../sim/events.ts';
import { residentIds, transfer } from '../economy/treasury.ts';
import { setTariff, tariff } from './outer.ts';
import { memo } from '../util/memo.ts';

/** The most of a wallet's excess the city may take in a day. */
export const WEALTH_TAX_MAX = 0.02;
/** The most of a let unit's rent the city may take from its landlord. */
export const PROPERTY_TAX_MAX = 0.5;
/** The most the Council may set the tariff to, either way across the water. */
export const TARIFF_MAX = 0.5;
/** The largest reserve the Council may ask the Treasury to hold. */
export const RESERVE_MAX = 200_000;
/** Lumens the dividend moves in a day when the reserve is off target. */
export const RESERVE_STEP = 1;
/** The dividend's own bounds, as `government.ts` sets them. */
export const DIVIDEND_MIN = 0;
export const DIVIDEND_MAX = 60;
/** Balance above and below the target at which the dividend starts to move. */
export const RESERVE_UPPER = 1.1;
export const RESERVE_LOWER = 0.9;

/**
 * The Government as this layer extends it. The three fields are optional so a
 * world saved before the metropolis still loads and reads as "no lever set".
 */
type LeverGovernment = Government & {
  propertyTax?: number;
  wealthTax?: number;
  reserveTarget?: number;
};

function gov(world: World): LeverGovernment {
  return world.government as LeverGovernment;
}

function num(v: number | undefined, lo: number, hi: number): number {
  return Number.isFinite(v) ? clamp(v as number, lo, hi) : lo;
}

/** Share of a let unit's rent its owner pays the city each day, 0..PROPERTY_TAX_MAX. */
export function propertyTaxRate(world: World): number {
  return num(gov(world).propertyTax, 0, PROPERTY_TAX_MAX);
}

/** Daily rate on the part of a wallet above WEALTH_TAX_THRESHOLD, 0..WEALTH_TAX_MAX. */
export function wealthTaxRate(world: World): number {
  return num(gov(world).wealthTax, 0, WEALTH_TAX_MAX);
}

/** The balance the Treasury is asked to hold. 0 means the Council has asked for none. */
export function reserveTarget(world: World): number {
  return Math.round(num(gov(world).reserveTarget, 0, RESERVE_MAX));
}

/** The tariff, which lives on the Outer market rather than the Government. */
export function tariffRate(world: World): number {
  return tariff(world);
}

// ---------------------------------------------------------------------------
// The wealth tax
// ---------------------------------------------------------------------------

/**
 * Daily: every citizen living in the city whose wallet is above the threshold
 * pays a share of the part above it. Below the threshold nothing is owed, and
 * a citizen who cannot cover the whole charge pays what they have. Returns the
 * total collected.
 */
export function collectWealthTax(world: World): number {
  const rate = wealthTaxRate(world);
  if (rate <= 0) return 0;
  const residents = residentIds(world);
  let total = 0;
  let payers = 0;
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !residents.has(id)) continue;
    const excess = c.wallet - WEALTH_TAX_THRESHOLD;
    if (excess <= 0) continue;
    const due = Math.min(Math.round(excess * rate), Math.max(0, c.wallet));
    if (due <= 0) continue;
    if (!transfer(world, id, 'treasury', due, 'wealth_tax', 'wealth tax')) continue;
    total += due;
    payers++;
    remember(world, id, 'money', `You paid ${due} ℓ of wealth tax on the ${excess} ℓ you hold above ${WEALTH_TAX_THRESHOLD} ℓ.`);
  }
  if (total > 0) {
    emit(world, 'treasury', `The wealth tax took ${total} ℓ from ${payers} ${payers === 1 ? 'wallet' : 'wallets'}.`,
      [], 0.3, { total, payers, rate });
  }
  return total;
}

// ---------------------------------------------------------------------------
// The reserve, and the dividend that floats against it
// ---------------------------------------------------------------------------

/**
 * With a reserve target set, the dividend drifts a lumen a day: up while the
 * Treasury holds more than a tenth above the target, down while it holds less
 * than a tenth below. It never leaves the bounds the Charter gives it, and
 * with no target it does not move at all.
 */
export function floatDividend(world: World): void {
  const target = reserveTarget(world);
  if (target <= 0) return;
  const balance = world.treasury.balance;
  const before = Math.round(world.government.dividend);
  let after = before;
  if (balance > target * RESERVE_UPPER) after = Math.min(DIVIDEND_MAX, before + RESERVE_STEP);
  else if (balance < target * RESERVE_LOWER) after = Math.max(DIVIDEND_MIN, before - RESERVE_STEP);
  if (after === before) return;
  world.government.dividend = after;
  const way = after > before ? 'rose' : 'fell';
  emit(world, 'treasury', `The Treasury holds ${balance} ℓ against a reserve of ${target} ℓ, so the dividend ${way} to ${after} ℓ a day.`,
    [], 0.3, { balance, target, dividend: after });
}

// ---------------------------------------------------------------------------
// The Council's side
// ---------------------------------------------------------------------------

/** The bounds `council.tableProposal` checks a lever proposal against. */
export function leverRanges(): Record<'property_tax' | 'wealth_tax' | 'tariff' | 'reserve', [number, number]> {
  return {
    property_tax: [0, PROPERTY_TAX_MAX],
    wealth_tax: [0, WEALTH_TAX_MAX],
    tariff: [0, TARIFF_MAX],
    reserve: [0, RESERVE_MAX],
  };
}

/** True when a proposal is one of the four this file enacts. */
export function isLeverProposal(p: Proposal): boolean {
  const kind = String(p.kind);
  return kind === 'property_tax' || kind === 'wealth_tax' || kind === 'tariff' || kind === 'reserve';
}

/**
 * Enact a passed lever proposal and return the line the Council's decision is
 * printed with. An unknown kind changes nothing and says so.
 */
export function applyLever(world: World, p: Proposal): string {
  const g = gov(world);
  const value = Number.isFinite(p.value) ? p.value : 0;
  switch (String(p.kind)) {
    case 'property_tax': {
      g.propertyTax = clamp(value, 0, PROPERTY_TAX_MAX);
      return `Property tax is now ${Math.round(g.propertyTax * 100)}% of a let unit's rent.`;
    }
    case 'wealth_tax': {
      g.wealthTax = clamp(value, 0, WEALTH_TAX_MAX);
      const perThousand = Math.round(g.wealthTax * 1000 * 10) / 10;
      return `Wealth tax is now ${perThousand} ℓ a day per 1,000 ℓ held above ${WEALTH_TAX_THRESHOLD} ℓ.`;
    }
    case 'tariff': {
      setTariff(world, value);
      return `The tariff at the Docks is now ${Math.round(tariffRate(world) * 100)}%.`;
    }
    case 'reserve': {
      g.reserveTarget = Math.round(clamp(value, 0, RESERVE_MAX));
      return g.reserveTarget === 0
        ? 'The Treasury keeps no reserve target; the dividend stays where the Council set it.'
        : `The Treasury will hold a reserve of ${g.reserveTarget} ℓ; the dividend floats to keep it.`;
    }
    default:
      return 'That was not a lever the Council holds; nothing changed.';
  }
}

// ---------------------------------------------------------------------------
// The daily pass and the observation
// ---------------------------------------------------------------------------

/** Daily, after the dividend and the stipends: the wealth tax, then the float. */
export function dailyLevers(world: World): void {
  collectWealthTax(world);
  floatDividend(world);
}

/** What every citizen may read of the four levers. */
export function leversObservation(world: World): {
  propertyTax: number; wealthTax: number; tariff: number; reserveTarget: number;
} {
  return memo(world, 'levers:observation', () => ({
    propertyTax: propertyTaxRate(world),
    wealthTax: wealthTaxRate(world),
    tariff: tariffRate(world),
    reserveTarget: reserveTarget(world),
  }));
}
