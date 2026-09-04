/**
 * What a citizen sees of standing (`docs/CITIZENSHIP.md` §5).
 *
 * The observation carries `self.repute` — the score with its components broken
 * out, so a citizen can see exactly what is costing them — and `gates`, every
 * city they know of with its thresholds and whether they would be admitted
 * today. When a notice stands, it is in there too, itemised, with the day the
 * grace ends and the Charter's own list of what a notice does not take.
 *
 * **Nothing here is private.** Every one of these blocks can be built about any
 * citizen by any citizen, because every part of repute is a public act. That is
 * the difference between repute and character: character is inferred, repute is
 * counted.
 */
import type { CitizenId, World } from '../types.ts';
import { reputeBreakdown } from './repute.ts';
import { gatesObservation, sponsorshipsFor } from './gates.ts';
import { judgedLine, noticeObservation } from './notices.ts';
import { hearingsObservation } from './hearings.ts';
import type { ObservedGate, ObservedRepute } from './state.ts';

/**
 * One citizen's whole standing, as their own observation shows it — and as
 * anybody else's observation of them could show it, since none of it is secret.
 */
export function reputeObservation(world: World, cId: CitizenId): ObservedRepute | null {
  const breakdown = reputeBreakdown(world, cId);
  if (!breakdown) return null;
  return {
    ...breakdown,
    line: judgedLine(world, cId),
    notice: noticeObservation(world, cId),
    hearings: hearingsObservation(world, cId),
    vouchedBy: sponsorshipsFor(world, cId).map((k) => world.citizens[k.sponsorId]?.name ?? k.sponsorId),
  };
}

/** Every gate this citizen knows about, and what each would decide today. */
export function gateObservation(world: World, cId: CitizenId): ObservedGate[] {
  return gatesObservation(world, cId);
}
