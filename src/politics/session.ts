/**
 * The politics layer's three doors: the hour the bodies sit, the hour the
 * Court hears what is not a crime, and the morning everything is read back.
 *
 * `REGISTRY.md` §2 spreads the public hours of a day so that the layers added
 * since the founding are not all putting their hearings in the Court's one:
 *
 * ```
 * 10–11  the Court's criminal list
 * 12     the Court's second sitting: impeachments, a convention, a record appeal
 * 14     the Council's session: the order paper, and the charter's own measures
 * ```
 *
 * Nothing here decides anything. It calls the modules that own each question
 * in the order the timetable puts them, and hands the wiring pass a single
 * function for each hour rather than a dozen.
 *
 * Loading this file also loads the two modules that put a question to the city
 * — the recall ballot and a convention's ratification — which is what tells
 * `politics/referendums.ts` how a scripted mind reads each of them. Anything
 * that runs the city's day should import this file rather than the pieces.
 */
import type { Citizen, World } from '../types.ts';
import { dailyCharter } from './charter.ts';
import type { MeasureKind, MeasureHooks } from './measures.ts';
import { measureSession, measuresObservation, trimMeasures } from './measures.ts';
import { amendmentHooks, isSelfInterested } from './amendments.ts';
import { conventionHooks } from './convention.ts';
import { conventionSitting, dailyConvention } from './convention-floor.ts';
import { apportionHooks, dailyWards, tickWardPresence } from './wards.ts';
import { dailyPress } from './press.ts';
import { pressHooks } from './press-measures.ts';
import { transparencyHooks, dailyRecords, decideRecordAppeals } from './records.ts';
import { gamesBidHooks, gamesTruceHooks, gamesWaiverHooks } from './games.ts';
import { dailyGames } from './games-week.ts';
import { dailySitting } from './accountability.ts';
import { holdImpeachments } from './impeachment.ts';
import { dailyRecalls } from './recall.ts';
import { charterObservation, type ObservedCharter } from './charter.ts';
import { accountabilityObservation, type ObservedAccountability } from './accountability.ts';
import { conventionObservation, type ObservedConvention } from './convention.ts';
import { wardsObservation, type ObservedWards } from './wards.ts';
import { pressObservation, type ObservedPaper } from './press.ts';
import { recordsObservation, type ObservedRecords } from './records.ts';
import { gamesObservation, type ObservedGames } from './games.ts';
import type { ObservedMeasure } from './measures.ts';

/** Which module owns which kind of measure. */
export function hooksFor(kind: MeasureKind): MeasureHooks | null {
  switch (kind) {
    case 'amend_charter': return amendmentHooks;
    case 'call_convention': return conventionHooks;
    case 'apportion': return apportionHooks;
    case 'press_licence': case 'press_duty': case 'press_restraint': case 'press_closure': return pressHooks;
    case 'transparency': return transparencyHooks;
    case 'games_bid': return gamesBidHooks;
    case 'games_waiver': return gamesWaiverHooks;
    case 'games_truce': return gamesTruceHooks;
    default: return null;
  }
}

/** Tick 14: the Council's session reads the order paper the charter added. */
export function politicsSession(world: World): void {
  measureSession(world, hooksFor);
}

/** Tick 12: the Court's second sitting. */
export function politicsHearings(world: World): void {
  holdImpeachments(world);
  conventionSitting(world);
  decideRecordAppeals(world);
}

/**
 * Morning, in the order the day makes sense in: the convention finishes what
 * the city answered yesterday, the charter is read back and classified, the
 * seats are counted, the bodies answer for sitting past their term, the
 * records and the papers do their day, and the Games keep their clock.
 */
export function dailyPolitics(world: World): void {
  dailyConvention(world);
  dailyRecalls(world);
  dailyCharter(world);
  dailyWards(world);
  dailySitting(world);
  dailyRecords(world);
  dailyPress(world);
  dailyGames(world);
  trimMeasures(world);
}

/** Every tick: a candidate's hour in a ward is an hour the ward saw them. */
export function tickPolitics(world: World): void {
  tickWardPresence(world);
}

/** Everything the politics layer puts in a citizen's observation. */
export interface ObservedPolitics {
  charter: ObservedCharter;
  measures: ObservedMeasure[];
  convention: ObservedConvention | null;
  accountability: ObservedAccountability;
  wards: ObservedWards;
  papers: ObservedPaper[];
  records: ObservedRecords;
  games: ObservedGames | null;
}

export function politicsObservation(world: World, c: Citizen | null): ObservedPolitics {
  return {
    charter: charterObservation(world, c),
    measures: measuresObservation(world, c, (m) => isSelfInterested(world, m)),
    convention: conventionObservation(world, c),
    accountability: accountabilityObservation(world, c),
    wards: wardsObservation(world, c),
    papers: pressObservation(world, c),
    records: recordsObservation(world, c),
    games: gamesObservation(world, c),
  };
}
