/**
 * The generations layer's own morning, and its own cycle (`docs/GENERATIONS.md`).
 *
 * The order matters and is the contract for the pass that wires this into
 * `world/daily.ts`:
 *
 * 1. offices held are entered before heritage is read from them;
 * 2. a sponsored applicant's conviction lands before the stains are counted;
 * 3. **the house repute is recomputed right after each citizen's own repute**
 *    (`GENERATIONS.md` §1), so `dailyGenerations` must run after
 *    `standing/repute.dailyRepute` and never before it;
 * 4. heads are read from the rule, and a house with no adults left falls
 *    dormant;
 * 5. motions and matches that have stood their days are decided;
 * 6. the entail collects its rents and its concerns' profits, so the levy has
 *    something to take;
 * 7. a defaulted loan the house stood behind is answered out of the entail;
 * 8. estates are read, liquidated when their days run out, and settled.
 *
 * The cycle's own work — the levy, the ledger of the house, and the era a
 * house was prominent in — runs on the first morning of a new cycle.
 *
 * Nothing in this file decides anything for a citizen. It reads public facts,
 * moves lumens somebody already agreed to move, and prints what happened.
 */
import type { World } from '../types.ts';
import { emit } from '../sim/events.ts';
import { generationsState } from './state.ts';
import { accrueOffices, dailyHouseRepute, houseNames, houseReputeOf, livingAdults } from './repute.ts';
import { allHouses } from './houses.ts';
import { goDormant, refreshHead } from './head.ts';
import { chargeHouseLevy, collectEntailRents, sellUpForLevy, sweepEntailedBusinesses } from './entail.ts';
import { callPledges, noteSponsoredConvictions } from './letters.ts';
import { dailyMotions } from './motions.ts';
import { dailyMatches } from './matches.ts';
import { dailyEstates } from './estate.ts';
import { printHouseLedger } from './ledger.ts';
import { noteProminence } from './records.ts';

/** Heads, dormancy, and the houses that woke up again. */
export function dailyHouses(world: World): void {
  for (const h of allHouses(world)) {
    if (h.dormantDay !== null) continue;
    if (livingAdults(world, h.name).length === 0) {
      goDormant(world, h);
      continue;
    }
    refreshHead(world, h);
  }
}

/**
 * The first morning of a new cycle: the levy is charged on the entail, houses
 * that cannot pay are sold up, the ledger of the house is printed, and the era
 * remembers who was prominent in it.
 */
export function cycleGenerations(world: World): boolean {
  const s = generationsState(world);
  const cycle = world.government?.cycle ?? 0;
  if (s.ledgerCycle === cycle) return false;
  s.ledgerCycle = cycle;

  for (const h of allHouses(world)) {
    chargeHouseLevy(world, h);
    if (h.levyArrears > 0) sellUpForLevy(world, h);
  }
  printHouseLedger(world);
  const prominent = noteProminence(world);
  if (prominent.length > 0) {
    emit(world, 'history', `The era's houses: ${prominent.join(', ')}.`, [], 0.3, { cycle, houses: prominent });
  }
  // The trend every house block reads is measured from this morning.
  for (const name of houseNames(world)) s.cycleRepute[name] = houseReputeOf(world, name);
  return true;
}

/**
 * The whole of the layer's morning, in the order the header sets out — one
 * call for `world/daily.ts` to place **after** `standing/repute.dailyRepute`
 * and to wrap in its own guard, exactly as it wraps every other pack's
 * morning.
 */
export function dailyGenerations(world: World): void {
  accrueOffices(world);
  noteSponsoredConvictions(world);
  dailyHouseRepute(world);
  dailyHouses(world);
  dailyMotions(world);
  dailyMatches(world);
  collectEntailRents(world);
  sweepEntailedBusinesses(world);
  callPledges(world);
  dailyEstates(world);
  cycleGenerations(world);
}
