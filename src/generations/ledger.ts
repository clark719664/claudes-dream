/**
 * The ledger of the house — what the Chronicle prints each cycle, and the one
 * thing a name does to the people who carry it (`docs/GENERATIONS.md` §2).
 *
 * Members standing more than 150 repute **above** their house are named, and
 * so are those more than 150 **below**. Being named earns or costs 2 public
 * reputation — about 4 repute a cycle — and it compounds only while the gap is
 * open. It lands on the child of a great house who wanted to be a courier
 * exactly as on the one who wanted the Council, and **the way out is
 * `renounce_name`**, which costs the whole of what the name was worth.
 *
 * This is an **expectation**, not a threshold. Nothing here bars anybody from
 * anything, no gate reads it, and the repute formula in `CITIZENSHIP.md` §1 is
 * untouched in every term: what moves is the city's opinion of a citizen, by
 * two points, because the city read a public list and had one.
 *
 * A name with only one adult has no ledger. Their house repute is mostly their
 * own repute halved toward the average, so a gap against it would say nothing
 * about them at all — it would only be arithmetic printed as a judgement.
 */
import type { Citizen, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { adjustReputation } from '../citizens/citizen.ts';
import { reputeOf } from '../standing/repute.ts';
import { houseNames, houseReputeOf, livingAdults } from './repute.ts';

/** How far from the name's own figure a member has to stand to be named. */
export const LEDGER_GAP = 150;
/** What being named is worth, in public reputation, either way. */
export const LEDGER_REPUTATION = 2;
/** A name with fewer adults than this has no ledger to print. */
export const LEDGER_MIN_ADULTS = 2;

export interface HouseLedger {
  name: string;
  repute: number;
  above: { id: string; name: string; repute: number }[];
  below: { id: string; name: string; repute: number }[];
}

/** Who stands above their name this cycle, and who stands below it. */
export function houseLedger(world: World, name: string): HouseLedger {
  const repute = houseReputeOf(world, name);
  const above: HouseLedger['above'] = [];
  const below: HouseLedger['below'] = [];
  for (const c of livingAdults(world, name)) {
    const own = reputeOf(world, c.id);
    const gap = own - repute;
    if (gap > LEDGER_GAP) above.push({ id: c.id, name: c.name, repute: own });
    else if (gap < -LEDGER_GAP) below.push({ id: c.id, name: c.name, repute: own });
  }
  above.sort((a, b) => b.repute - a.repute || a.id.localeCompare(b.id, 'en'));
  below.sort((a, b) => a.repute - b.repute || a.id.localeCompare(b.id, 'en'));
  return { name, repute, above, below };
}

function tell(world: World, c: Citizen | undefined, text: string): void {
  if (!c) return;
  remember(world, c.id, 'family', text);
}

/**
 * The cycle's print. Every name with two or more adults is read against its
 * members, the two lists go into the Chronicle, and the city's opinion of the
 * people on them moves by two points.
 */
export function printHouseLedger(world: World): HouseLedger[] {
  const printed: HouseLedger[] = [];
  for (const name of houseNames(world)) {
    if (livingAdults(world, name).length < LEDGER_MIN_ADULTS) continue;
    const ledger = houseLedger(world, name);
    if (ledger.above.length === 0 && ledger.below.length === 0) continue;
    printed.push(ledger);
    for (const row of ledger.above) {
      const c = world.citizens[row.id];
      if (!c) continue;
      adjustReputation(world, c, LEDGER_REPUTATION, `standing above the house of ${name}`);
      tell(world, c, `The Chronicle's ledger of the house names you above the ${name}s: your ${row.repute} against the name's ${ledger.repute}.`);
    }
    for (const row of ledger.below) {
      const c = world.citizens[row.id];
      if (!c) continue;
      adjustReputation(world, c, -LEDGER_REPUTATION, `standing below the house of ${name}`);
      tell(world, c, `The Chronicle's ledger of the house names you below the ${name}s: your ${row.repute} against the name's ${ledger.repute}. Any adult may renounce a name.`);
    }
    const parts: string[] = [];
    if (ledger.above.length > 0) parts.push(`above it: ${ledger.above.map((r) => `${r.name} (${r.repute})`).join(', ')}`);
    if (ledger.below.length > 0) parts.push(`below it: ${ledger.below.map((r) => `${r.name} (${r.repute})`).join(', ')}`);
    emit(world, 'history', `The ledger of the house of ${name}, at ${ledger.repute} — ${parts.join('; ')}.`,
      [...ledger.above, ...ledger.below].map((r) => r.id), 0.4,
      { name, repute: ledger.repute, above: ledger.above.length, below: ledger.below.length });
  }
  return printed;
}
