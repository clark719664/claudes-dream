/**
 * The research half of the action table (`docs/PROGRESS.md` §8, `REGISTRY.md`
 * §3): a programme opened, funded, worked, and then either published or kept.
 *
 * `dispatchProgress` returns null for anything it does not own, so
 * `actions/execute.ts` falls through to its own switch. `progressActions` adds
 * to the set `availableActions` is built from: a guide, never a promise — every
 * handler in `src/progress` checks its own conditions again.
 *
 * Two of the nine are rare by nature and say so here rather than in a comment
 * somewhere else. `keep_secret` belongs to the one funder that may hold a
 * finding — a guild's master, a union's member, a business's owner — and only
 * inside three days of the programme concluding. `teach_technology` is a
 * traveller's action: it needs a subject worked under somewhere else and *not*
 * held here, which in a one-city Expanse is nobody, and it comes alive the day
 * `EXPANSE.md` lands.
 */
import type { Action, ActionResult, ActionType, Citizen, World } from '../types.ts';
import type { TechnologyId } from '../progress/tree.ts';
import { memo } from '../util/memo.ts';
import {
  RESEARCH_MIN_ANALYSIS, RESEARCH_WAGE, adoptTechnology, cityHolds, familiarWith, fundProject, heldFor, isMasterOf,
  isResearcher, keepSecret, openProject, openProjects, openSubjects, projectsHere, projectsOf, publishFinding,
  purseOf, researchBuilding, researchShift, secretKeeper, secretsHeld, sellSecret, takeApprentice, teachTechnology,
} from '../progress/index.ts';

/** Carry out one research action; null means the caller's switch owns it. */
export function dispatchProgress(world: World, c: Citizen, action: Action): ActionResult | null {
  switch (action.type) {
    case 'open_project': return openProject(world, c.id, action.technology, action.name ?? '');
    case 'research': return researchShift(world, c.id, action.projectId);
    // A patron pays out of their own wallet; a business's capital goes into the
    // works, never into a purse (`PROGRESS.md` §1 — the funder is recorded, and
    // what is left comes back to them).
    case 'fund_project': return fundProject(world, c.id, action.projectId, action.amount);
    case 'adopt_technology': return adoptTechnology(world, c.id, action.technology);
    case 'publish_finding': return publishFinding(world, c.id, action.projectId);
    case 'keep_secret': return keepSecret(world, c.id, action.projectId);
    case 'take_apprentice': return takeApprentice(world, c.id, action.citizen, action.technology);
    case 'teach_technology': return teachTechnology(world, c.id, action.technology);
    case 'sell_secret': return sellSecret(world, c.id, action.to, action.technology, action.price);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// What is on offer
// ---------------------------------------------------------------------------

/** Everything the research layer puts in front of this citizen here and now. */
export function progressActions(world: World, c: Citizen, set: Set<ActionType>, here: Citizen[]): void {
  if (c.lifeStage === 'child') return;
  const settled = c.standing === 'good' || c.standing === 'probation';
  const [start, end] = world.config.workHours;
  const hoursOpen = world.hour >= start && world.hour < end;
  const room = researchBuilding(world, c.district) !== null;
  const shiftLeft = c.shiftsToday < world.config.maxShiftsPerDay;

  // The reading room: a Researcher opens a programme, anybody with the
  // analysis for it works an hour on one, and the purse has to be able to pay.
  if (settled && room && hoursOpen && isResearcher(world, c) && openSubjects(heldFor(world, c.id)).length > 0) {
    set.add('open_project');
  }
  const readable = settled && room ? projectsHere(world, c) : [];
  if (readable.length > 0 && hoursOpen && shiftLeft && (c.skills.analysis ?? 0) >= RESEARCH_MIN_ANALYSIS
    && readable.some((p) => purseOf(world, p) >= Math.max(world.government.minWage, RESEARCH_WAGE))) {
    set.add('research');
  }
  // A purse takes money from anybody, from anywhere: a patron does not have to
  // stand in the Observatory to pay for what is done in it.
  if (settled && c.wallet > 0 && openNow(world).length > 0) set.add('fund_project');

  // A concluded programme: publish it, or close the door on it if it was yours
  // to close. Both are read off the register rather than off a place.
  for (const p of projectsOf(world, c.id)) {
    if (p.status === 'open') continue;
    if (p.finding !== 'published') set.add('publish_finding');
    if (p.status === 'succeeded' && p.finding === 'undecided' && secretKeeper(world, p) === c.id) set.add('keep_secret');
  }

  // What a master holds: an apprentice to carry it on, and a buyer for it.
  const secrets = mySecrets(world, c);
  if (secrets.length > 0 && here.some((o) => o.lifeStage !== 'child')) {
    if (here.some((o) => secrets.some((id) => !isMasterOf(world, o.id, id)))) set.add('take_apprentice');
    if (here.some((o) => o.wallet > 0 && secrets.some((id) => !isMasterOf(world, o.id, id)))) set.add('sell_secret');
  }

  // The works at your own premises, out of your own capital.
  const biz = c.businessId ? world.businesses[c.businessId] : null;
  if (settled && biz && biz.dissolvedDay === null && biz.treasury > 0) {
    const known = heldFor(world, c.id);
    if (known.length > 0) set.add('adopt_technology');
  }

  // And what a traveller carries: a subject worked under elsewhere that this
  // city does not hold. One city, so this is empty until the Expanse.
  if (settled && room && familiarWith(world, c.id).some((id) => !cityHolds(world, id))) set.add('teach_technology');
}

/** The open programmes, read once for the whole round rather than per citizen. */
function openNow(world: World): ReturnType<typeof openProjects> {
  return memo(world, 'progress:openProjects', () => openProjects(world));
}

/** The secrets this citizen is a master of, which is all a master may teach or sell. */
export function mySecrets(world: World, c: Citizen): TechnologyId[] {
  const held = memo(world, 'progress:secrets', () => secretsHeld(world));
  return held.filter((s) => s.masters.includes(c.id)).map((s) => s.technology);
}
