/**
 * The three codes this layer adds, laid before the Watch the way every other
 * code is (`docs/REGISTRY.md` §4, `docs/JUSTICE.md` §1).
 *
 * Nothing here punishes anybody and nothing here files a charge. What the city
 * notices becomes a **report** in the Watch's book (`government/reports.ts`),
 * and an officer decides whether to put it before the Court — exactly as for a
 * theft. The ladder then answers it, and it never reaches a cell: smoke is an
 * offence against the city, not against a person, and a councillor who rezoned
 * themselves rich has taken from the city's regard and not from anybody's
 * safety.
 *
 * The detection of L45 is a roll, because somebody has to be caught opening a
 * bypass. The detection of L46 and L47 is not: the maintenance book, the
 * property register and the roll of votes are all public and all permanent, so
 * the Watch does not have to see anything to hold the evidence
 * (`ENVIRONMENT.md` §5). What it does with it is still an officer's decision.
 *
 * When `types.ts` and `data/laws.ts` learn L45–L47, every call below becomes a
 * plain `watch.commitOffence(world, actorId, code, ctx)` and this file goes.
 */
import { clamp } from '../types.ts';
import type { CitizenId, LawCode, OffenceCode, ReportId, World } from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { emit, remember } from '../sim/events.ts';
import { chance } from '../util/rng.ts';
import {
  RECENT_OFFENCES_LENGTH, detectionProbability, evidenceFor, officersInDistrict, officersOnDuty,
} from '../government/watch.ts';
import { openReport } from '../government/reports.ts';
import { environmentOffenceName, environmentSeverity } from './state.ts';

/**
 * How easily each of the three is noticed. `data/laws.ts` does not carry them,
 * and `offenceVisibility` answers 0.5 for a code it does not know, so the
 * difference is carried here and handed to the Watch's own roll as a modifier.
 */
export const ENVIRONMENT_VISIBILITY: Record<string, number> = { L45: 0.25, L46: 0.40, L47: 1.0 };

/** What the Watch's default reading of an unknown code is (`data/laws.ts offenceVisibility`). */
const ASSUMED_VISIBILITY = 0.5;

/** A downstream reading to compare a bypass against makes it very much easier to see. */
export const SURVEY_VISIBILITY_BONUS = 0.35;

export interface EnvironmentOffenceContext {
  /** Skip the roll: the register itself is the evidence (`ENVIRONMENT.md` §5). */
  proved?: boolean;
  /** Extra evidence the books hold beyond what an officer saw. */
  corroboration?: number;
  visibilityMod?: number;
  amount?: number;
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

/**
 * Record one of this layer's offences against the citizen who committed it and
 * put it before the Watch where it is noticed. Returns the report, or null
 * where nobody noticed anything.
 */
export function chargeEnvironmentOffence(
  world: World, actorId: CitizenId, code: string, ctx: EnvironmentOffenceContext,
): ReportId | null {
  const actor = world.citizens[actorId];
  if (!actor) return null;
  const amount = Math.max(0, Math.round(ctx.amount ?? 0));
  const offence = { tick: world.tick, law: code as OffenceCode, detected: false, victimId: null, amount };
  actor.recentOffences.push(offence);
  if (actor.recentOffences.length > RECENT_OFFENCES_LENGTH) {
    actor.recentOffences.splice(0, actor.recentOffences.length - RECENT_OFFENCES_LENGTH);
  }
  actor.stats.offencesCommitted++;

  const onDuty = officersOnDuty(world).filter((o) => o.id !== actorId);
  const present = officersInDistrict(world, actor);
  const witnesses = witnessesAround(world, actorId);
  const name = environmentOffenceName(code).toLowerCase();

  if (!ctx.proved) {
    const known = ENVIRONMENT_VISIBILITY[code] ?? ASSUMED_VISIBILITY;
    // The Watch's own roll. `data/laws.ts` carries L45–L47 now, so the book's
    // own visibility is already in `detectionProbability`; the modifier below
    // is only for a code the book has not learned, and adding it twice would
    // make a bypass harder to see than the table says it is.
    const carried = LAWS[code as LawCode] !== undefined;
    const mod = (ctx.visibilityMod ?? 0) + (carried ? 0 : (known - ASSUMED_VISIBILITY) * 0.35);
    if (!chance(world, detectionProbability(world, actor, code as OffenceCode, witnesses, onDuty.length, mod))) {
      return null;
    }
  }

  offence.detected = true;
  actor.stats.offencesDetected++;
  const evidence = ctx.proved
    ? clamp(0.75 + (ctx.corroboration ?? 0), 0, 0.95)
    : evidenceFor(world, actor, code as OffenceCode, {
      witnesses, officerSaw: present.length > 0, corroboration: ctx.corroboration,
    });
  const report = openReport(world, {
    officerId: null, suspectId: actorId, law: code as OffenceCode, evidence, amount,
    description: `${environmentOffenceName(code)}: ${ctx.description}`.slice(0, 280),
  });
  const severity = environmentSeverity(world, code);
  emit(world, 'offence',
    `${actor.name} is before the Watch for ${name}: ${ctx.description} (${report.id}).`,
    [actorId], severity >= 4 ? 0.8 : 0.5, { law: code, reportId: report.id, evidence, track: 'city' });
  remember(world, actorId, 'crime',
    `The Watch holds a report against you for ${name} (${report.id}): ${ctx.description}`);
  return report.id;
}
