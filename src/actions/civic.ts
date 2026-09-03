/**
 * Civic actions that need more than a pass-through: bribing an official.
 * (Nominations, votes, proposals, reports, appeals and Watch applications go
 * straight to government/*.)
 */
import { clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { chance } from '../util/rng.ts';
import { remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { adjustBond } from '../citizens/relationships.ts';
import { commitOffence } from '../government/watch.ts';
import { dropReportsAfterBribe, recordBribedOfficer } from '../government/reports.ts';
import { pendingCasesFor } from '../government/court.ts';
import { fail, holdsOffice, isPresent, nameTag, ok } from './common.ts';

/** Evidence against the briber's pending charges shrinks by this much when the bribe is taken. */
export const BRIBE_EVIDENCE_DISCOUNT = 0.3;
export const BRIBE_MIN_EVIDENCE = 0.1;

/** Chance an official pockets a bribe: certain at zero honesty, nil from 0.5 up. */
export function bribeAcceptance(official: Citizen): number {
  return clamp(1 - 2 * official.personality.honesty, 0, 1);
}

/**
 * Pay an official. A corruptible one takes the money and pending charges
 * against the briber lose evidence; an honest one hands it back and the
 * attempt is far more likely to reach the Watch. Bribery (L09) either way,
 * for the briber — and for the official who accepted.
 */
export function doBribe(world: World, c: Citizen, officialId: CitizenId, amount: number): ActionResult {
  if (officialId === c.id) return fail('You cannot bribe yourself.');
  const o = world.citizens[officialId];
  if (!o || !isPresent(world, o)) return fail('Nobody by that id lives in Reverie.');
  if (!holdsOffice(world, o)) return fail(`${o.name} holds no office.`);
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (amt <= 0) return fail('A bribe must be a positive whole number of lumens.');
  if (c.wallet < amt) return fail(`You cannot offer ${amt} ℓ; you have ${c.wallet} ℓ.`);
  if (!transfer(world, c.id, o.id, amt, 'bribe', `${c.name} to ${o.name}`)) return fail('The money could not change hands.');

  if (chance(world, bribeAcceptance(o))) {
    let weakened = 0;
    for (const k of pendingCasesFor(world, c.id)) {
      k.evidence = Math.max(BRIBE_MIN_EVIDENCE, k.evidence - BRIBE_EVIDENCE_DISCOUNT);
      weakened++;
    }
    // An officer of the Watch who takes money looks the other way: what they
    // hold against the payer is dropped, and they file nothing new for a day.
    // Officers who think for themselves make that choice with drop_report.
    let dropped = 0;
    if (world.government.watch.includes(o.id)) {
      recordBribedOfficer(world, o.id, c.id);
      if (o.brain === 'reflex') dropped = dropReportsAfterBribe(world, o.id, c.id);
    }
    adjustBond(world, c.id, o.id, 10);
    remember(world, o.id, 'crime', `You accepted ${amt} ℓ from ${c.name} to look the other way${dropped ? `; you dropped ${dropped} report(s) against them` : ''}.`);
    remember(world, c.id, 'crime', `${o.name} took your ${amt} ℓ${weakened ? `; the evidence in ${weakened} pending case(s) against you has gone soft` : ''}${dropped ? `; ${dropped} report(s) against you were dropped` : ''}.`);
    const r = commitOffence(world, c.id, 'L09', { amount: amt });
    commitOffence(world, o.id, 'L09', { amount: amt, visibilityMod: -0.1 });
    return ok(`${o.name} pocketed your ${amt} ℓ.`, { offence: 'L09', detected: r.detected });
  }

  transfer(world, o.id, c.id, amt, 'bribe', `bribe refused by ${o.name}`);
  adjustBond(world, c.id, o.id, -15);
  remember(world, o.id, 'crime', `${nameTag(c)} tried to bribe you with ${amt} ℓ; you refused.`);
  remember(world, c.id, 'crime', `${o.name} refused your bribe of ${amt} ℓ and handed it back.`);
  const r = commitOffence(world, c.id, 'L09', { amount: amt, visibilityMod: 0.3 });
  return fail(`${o.name} refused your bribe and handed the money back.`, { offence: 'L09', detected: r.detected });
}
