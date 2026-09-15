/**
 * The layer's morning, in one call (`docs/PROGRESS.md`).
 *
 * The order is the argument:
 *
 * 1. **Programmes resolve first.** A project that reached its cost yesterday is
 *    put to the test before anybody can put another hour into it, and what it
 *    finds is in the register before the Council's works are paid — so the
 *    morning a discovery lands is the morning the city may start building for
 *    it.
 * 2. **Then the roll call of masters.** A secret whose last master left in the
 *    night is lost this morning, before anything reads it: the works that were
 *    built for it stand idle from today.
 * 3. **Then the works.** Each subject the Council pledged for draws from the
 *    public works fund, in tree order, until the fund runs out.
 * 4. **Then the trends.** Yesterday's shares become the lagged index every
 *    shopkeeper will read today, new trends are found, and the roll runs.
 *
 * Nothing here decides anything a citizen could have decided.
 */
import type { World } from '../types.ts';
import { describeProgress } from './effects.ts';
import { dailyWorks, worksReport } from './adoption.ts';
import { dailyProjects } from './projects.ts';
import { loseOrphanedSecrets } from './discovery.ts';
import { dailyTrends, trendsReport } from './trends.ts';
import { progressReport } from './observe.ts';

/** The whole of the layer's rollover. Safe to call on a world that has never used it. */
export function dailyProgress(world: World): void {
  dailyProjects(world);
  loseOrphanedSecrets(world);
  dailyWorks(world);
  dailyTrends(world);
}

/**
 * What the Chronicle can print about knowledge this morning: what is held,
 * what is being worked on, what the works are short of, and what the city has
 * taken up.
 */
export function progressChronicle(world: World): string[] {
  return [describeProgress(world), progressReport(world), worksReport(world), trendsReport(world)];
}
