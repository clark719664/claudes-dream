/**
 * Strongboxes: how this layer holds lumens without inventing a new kind of
 * money party.
 *
 * The vault and every mutual's pot hold real lumens, and `REGISTRY.md` §5
 * counts each of them in the money supply. `economy/treasury.transfer` knows
 * four kinds of party — the Treasury, the Chest, a citizen and a business — so
 * a strongbox here **is** a business record: a real, auditable holder of
 * lumens that `moneySupply` already sums, needing no change to the money
 * funnel and no new term in the audit.
 *
 * A strongbox is a business with no owner, no premises rent, no jobs and no
 * stock, and it is never read as a trading concern: dues paid into a mutual
 * are not the mutual's revenue, an aid grant is not its cost, a deposit is not
 * the vault's turnover and a withdrawal is not its loss. Every movement in or
 * out is therefore followed by `clearFlows`, which zeroes the day counters
 * `transfer` keeps for ordinary businesses. The daily settlement in
 * `economy/business.ts` then reads a strongbox as a concern with no rent, no
 * profit, no loss and no owner: it charges it no profit tax (a mutual "pays no
 * profit tax", `FINANCE.md` §6), pays nobody out of it, and can never declare
 * it bankrupt. The lumens sit there, in the supply, belonging to whoever the
 * register says they belong to.
 *
 * An **underwriter** is the opposite case and is deliberately not a strongbox:
 * it is a business like any other (`FINANCE.md` §6), its premiums are revenue,
 * its claims are costs, it pays the profit tax on what it makes, and it is
 * wound up by the ordinary bankruptcy rule when it cannot pay.
 */
import type { Business, BusinessId, DistrictId, LedgerKind, MoneyParty, World } from '../types.ts';
import { balanceOf, transfer } from '../economy/treasury.ts';
import { nextId } from '../util/ids.ts';
import type { FinanceLedgerKind } from './state.ts';
import { STRONGBOX_KIND, financeKind } from './state.ts';

/**
 * Open a strongbox: a money party of its own, counted in the supply, holding
 * real lumens and nothing else. See the file header for why it is a business
 * record and why it is never settled like one.
 */
export function openStrongbox(world: World, name: string, district: DistrictId, buildingId: string): Business {
  const id = nextId(world, 'b');
  const box: Business = {
    id, name, kind: STRONGBOX_KIND, ownerId: '', treasury: 0, district, buildingId,
    employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: world.day, rentPerDay: 0, daysNegative: 0,
    revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[id] = box;
  return box;
}

/** True for a party this layer opened to hold lumens rather than to trade. */
export function isStrongbox(world: World, party: MoneyParty): boolean {
  const b = world.businesses[party];
  return !!b && b.kind === STRONGBOX_KIND;
}

/**
 * A strongbox keeps no books: what went in was not turnover and what came out
 * was not a cost. Called after every movement so the ordinary daily settlement
 * reads no profit, charges no tax and finds nothing to wind up.
 */
function clearFlows(world: World, party: MoneyParty): void {
  const b = world.businesses[party];
  if (!b || b.kind !== STRONGBOX_KIND) return;
  b.revenueToday = 0;
  b.costsToday = 0;
}

/**
 * Move lumens into or out of a strongbox through the ordinary money funnel.
 * Returns false and changes nothing when the payer cannot cover it.
 */
export function moveThroughBox(
  world: World, from: MoneyParty, to: MoneyParty, amount: number,
  kind: FinanceLedgerKind | LedgerKind, memo: string,
): boolean {
  const done = transfer(world, from, to, amount, financeKind(kind), memo);
  clearFlows(world, from);
  clearFlows(world, to);
  return done;
}

/** What a strongbox actually holds, read off the money it is holding. */
export function boxBalance(world: World, boxId: BusinessId | null): number {
  if (!boxId) return 0;
  return Math.max(0, balanceOf(world, boxId));
}
