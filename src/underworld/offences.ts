/**
 * The five codes this layer adds, laid before the Watch the way every other
 * code is (`docs/REGISTRY.md` §4, `docs/JUSTICE.md` §1).
 *
 * Nothing here punishes anybody and nothing here files a charge. What the city
 * notices becomes a **report** in the Watch's book (`government/reports.ts`),
 * and an officer decides whether to put it before the Court — exactly as for a
 * theft. The ladder then answers it, and **none of it reaches a cell**:
 * smuggling, contraband, a false manifest, unlicensed dealing and espionage are
 * offences against the *city*, not against a person. A spy who strikes an
 * officer resisting arrest is a different matter and is tried on both tracks,
 * which is `government/watch.crossTracks` and not this file.
 *
 * Three of the five are **proved rather than seen**: a manifest that does not
 * match the load, a retainer in the ledger and a shelf under the landed cost
 * are all public and all permanent, so the Watch does not have to be standing
 * there. A crossing and a fence's hand are rolled for, because somebody has to
 * be caught.
 *
 * A **quiet** offence is recorded and not rolled for at all: it is the act
 * nobody noticed, which is exactly what `government/investigations.ts` reads
 * when a detective looks around. Every undetected row below is a trace, and a
 * trace is how the Watch catches what it did not see happen.
 *
 * When `types.ts` and `data/laws.ts` learn L26–L30, every call below becomes a
 * plain `watch.commitOffence(world, actorId, code, ctx)` and this file goes.
 */
import { clamp } from '../types.ts';
import type { CitizenId, LawCode, OffenceCode, ReportId, World } from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { chance } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import {
  RECENT_OFFENCES_LENGTH, detectionProbability, evidenceFor, officersInDistrict, officersOnDuty,
} from '../government/watch.ts';
import { openReport } from '../government/reports.ts';
import {
  CONTRABAND_POSSESSION, UNDERWORLD_OFFENCES, amnestyRunning, underworldOffenceName, underworldSeverity,
} from './state.ts';

/** What the Watch's roll assumes about a code the book has not learned. */
const ASSUMED_VISIBILITY = 0.5;

/** Evidence a public register is worth on its own: a manifest, a ledger, a price. */
export const PROVED_EVIDENCE = 0.75;
/** No proved case is beyond doubt either. */
export const PROVED_CEILING = 0.95;

export interface UnderworldOffenceContext {
  /** Skip the roll: the register itself is the evidence. */
  proved?: boolean;
  /** Record it and roll for nothing: what nobody noticed is a trace, not a report. */
  quiet?: boolean;
  /** Extra evidence the books hold beyond what an officer saw. */
  corroboration?: number;
  visibilityMod?: number;
  amount?: number;
  victimId?: CitizenId;
  /** The officer whose gate or shelf it was; the report is made out to them. */
  officerId?: CitizenId | null;
  description: string;
}

/** Everybody standing where it happened who could have seen it. */
function witnessesAround(world: World, actorId: CitizenId): number {
  const actor = world.citizens[actorId];
  if (!actor) return 0;
  let n = 0;
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.id !== actorId && c.district === actor.district && c.standing !== 'exiled') n++;
  }
  return n;
}

/** How easily one of these is noticed, from this layer's own table or the book's. */
export function underworldVisibility(code: string): number {
  const carried = LAWS[code as LawCode];
  if (carried) return carried.visibility;
  return UNDERWORLD_OFFENCES[code]?.visibility ?? ASSUMED_VISIBILITY;
}

/**
 * Record one of this layer's offences against the citizen who committed it, and
 * put it before the Watch where it is noticed. Returns the report, or null
 * where nobody noticed anything — which is not nothing: the offence is on the
 * citizen's record undetected, and a detective may find it later.
 */
export function chargeUnderworldOffence(
  world: World, actorId: CitizenId, code: string, ctx: UnderworldOffenceContext,
): ReportId | null {
  const actor = world.citizens[actorId];
  if (!actor) return null;
  const amount = Math.max(0, Math.round(ctx.amount ?? 0));
  const offence = { tick: world.tick, law: code as OffenceCode, detected: false, victimId: ctx.victimId ?? null, amount };
  actor.recentOffences.push(offence);
  if (actor.recentOffences.length > RECENT_OFFENCES_LENGTH) {
    actor.recentOffences.splice(0, actor.recentOffences.length - RECENT_OFFENCES_LENGTH);
  }
  actor.stats.offencesCommitted++;
  // An amnesty is a door held open for the citizen who bought in good faith off
  // a shelf: for as long as it runs, *holding* restricted goods is not charged.
  // It forgives no crossing, no dealing and nothing anybody did to anybody.
  if (ctx.quiet || (code === CONTRABAND_POSSESSION && amnestyRunning(world))) return null;

  const onDuty = officersOnDuty(world).filter((o) => o.id !== actorId);
  const present = officersInDistrict(world, actor);
  const witnesses = witnessesAround(world, actorId);
  const name = underworldOffenceName(code).toLowerCase();

  if (!ctx.proved) {
    // `data/laws.ts` does not carry L26–L30, and `offenceVisibility` answers
    // 0.5 for a code it does not know, so the difference between this offence
    // and that assumption is handed to the Watch's own roll as a modifier. Once
    // the book carries the code the modifier is zero and the table is obeyed.
    const carried = LAWS[code as LawCode] !== undefined;
    const known = underworldVisibility(code);
    const mod = (ctx.visibilityMod ?? 0) + (carried ? 0 : (known - ASSUMED_VISIBILITY) * 0.35);
    if (!chance(world, detectionProbability(world, actor, code as OffenceCode, witnesses, onDuty.length, mod))) {
      return null;
    }
  }

  offence.detected = true;
  actor.stats.offencesDetected++;
  const evidence = ctx.proved
    ? clamp(PROVED_EVIDENCE + (ctx.corroboration ?? 0), 0, PROVED_CEILING)
    : evidenceFor(world, actor, code as OffenceCode, {
      witnesses, officerSaw: present.length > 0, corroboration: ctx.corroboration,
    });
  // The report is made out to the officer whose doorway it was where there is
  // one, since that is whose account the case rests on; otherwise it goes to
  // the Watch's shared inbox and any officer may take it up.
  const officer = ctx.officerId && world.citizens[ctx.officerId] && ctx.officerId !== actorId ? ctx.officerId : null;
  const report = openReport(world, {
    officerId: officer, suspectId: actorId, law: code as OffenceCode, evidence, amount,
    victimId: ctx.victimId, description: `${underworldOffenceName(code)}: ${ctx.description}`.slice(0, 280),
  });
  const severity = underworldSeverity(world, code);
  emit(world, 'offence', `${actor.name} is before the Watch for ${name}: ${ctx.description} (${report.id}).`,
    [actorId], severity >= 4 ? 0.8 : 0.5, { law: code, reportId: report.id, evidence, track: 'city' });
  remember(world, actorId, 'crime',
    `The Watch holds a report against you for ${name} (${report.id}): ${ctx.description}`);
  return report.id;
}
