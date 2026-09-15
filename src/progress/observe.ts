/**
 * What a citizen sees of the city's knowledge (`docs/PROGRESS.md` §7).
 *
 * ```jsonc
 * "progress": {
 *   "held": ["crop_rotation", "sanitation", "double_entry"],
 *   "adopting": [{ "technology": "germ_theory", "worksPaid": 620, "worksCost": 800, "uptake": 0.35 }],
 *   "projects": [{ "id": "rp_4", "technology": "the_printing_press", "progress": 22, "cost": 80,
 *                  "funder": "council", "purse": 340, "secret": false,
 *                  "researchers": ["c_12", "c_31"], "volumesOnHand": 3 }],
 *   "elsewhere": [{ "technology": "precision_machining", "heldBy": "Cinderhold", "secret": true }],
 *   "youAreAMasterOf": ["precision_machining"]
 * },
 * "trends": [{ "kind": "possession", "subject": "glass_harp", "share": 0.22, "rising": true }]
 * ```
 *
 * Every number here is public and the same for everybody, with one exception
 * that is the whole point of §4: **a secret appears in no observation but a
 * master's.** A citizen who is not a master is not told the subject exists, is
 * not told a programme on it is running, and cannot read it in `held`.
 *
 * `elsewhere` holds only what this citizen has travelled to, been told, or read
 * in a Chronicle. Reverie is one city today, so it is empty and the Expanse
 * will fill it.
 */
import type { CitizenId, World } from '../types.ts';
import { formatLumens } from '../economy/treasury.ts';
import type { ProgressDeeds, TrendKind } from './state.ts';
import { deedsOf, progressState } from './state.ts';
import type { TechnologyId } from './tree.ts';
import { TECHNOLOGIES, technologyName } from './tree.ts';
import { cityHolds, heldTechnologies, isMasterOf, isSecret, uptakeOf } from './effects.ts';
import { cityAdoptions } from './adoption.ts';
import { openProjects } from './projects.ts';
import { contributorsOf, purseOf } from './purse.ts';
import type { ObservedTrend } from './trends.ts';
import { trendsObservation } from './trends.ts';

/** What the contribution table in `CITIZENSHIP.md` pays for each of this layer's deeds. */
export const PROGRESS_CONTRIBUTION_WORTH = {
  /** A technology discovered, to each contributor of three shifts or more. */
  discovered: 20,
  /** One taught to another city. */
  taught: 10,
  /** An apprentice who carries a secret on. */
  apprentice: 12,
} as const;

export interface ObservedAdoption {
  technology: TechnologyId;
  name: string;
  worksPaid: number;
  worksCost: number;
  uptake: number;
}

export interface ObservedProject {
  id: string;
  technology: TechnologyId;
  name: string;
  progress: number;
  cost: number;
  /** Who is paying: the Council, a patron, a business, or nobody yet. */
  funder: string;
  purse: number;
  secret: boolean;
  researchers: CitizenId[];
  volumesOnHand: number;
  volumesSpent: number;
  volumesRequired: number;
}

export interface ObservedElsewhere {
  technology: TechnologyId;
  heldBy: string;
  secret: boolean;
}

export interface ProgressObservation {
  held: TechnologyId[];
  adopting: ObservedAdoption[];
  projects: ObservedProject[];
  elsewhere: ObservedElsewhere[];
  youAreAMasterOf: TechnologyId[];
  /** Subjects this citizen has worked under long enough to teach another city. */
  familiarWith: TechnologyId[];
}

/** Who is paying for a programme, in a word. */
export function funderOf(world: World, funded: Record<string, number>): string {
  const parties = Object.keys(funded).filter((p) => (funded[p] ?? 0) > 0);
  if (parties.length === 0) return 'nobody';
  const best = parties.sort((a, b) => (funded[b] ?? 0) - (funded[a] ?? 0) || a.localeCompare(b))[0];
  if (best === 'treasury') return 'council';
  if (world.businesses[best]) return world.businesses[best].name;
  return world.citizens[best]?.name ?? 'a patron';
}

/**
 * The `progress` block for one citizen. A secret is filtered out of every part
 * of it unless this citizen is one of its masters.
 */
export function progressObservation(world: World, cId: CitizenId): ProgressObservation {
  const s = progressState(world);
  const mine = (Object.keys(s.technologies) as TechnologyId[]).filter((id) => isMasterOf(world, cId, id));
  const held = [...heldTechnologies(world), ...mine];
  const adopting: ObservedAdoption[] = cityAdoptions(world)
    .filter((a) => cityHolds(world, a.technology) || mine.includes(a.technology))
    .map((a) => ({
      technology: a.technology,
      name: technologyName(a.technology),
      worksPaid: a.worksPaid,
      worksCost: a.worksCost,
      uptake: Math.round(uptakeOf(world, a) * 100) / 100,
    }));
  const projects: ObservedProject[] = openProjects(world)
    .filter((p) => !isSecret(world, p.technology) || mine.includes(p.technology))
    .map((p) => ({
      id: p.id,
      technology: p.technology,
      name: p.name,
      progress: Math.round(p.progress * 10) / 10,
      cost: p.cost,
      funder: funderOf(world, p.funded),
      purse: purseOf(world, p),
      secret: isSecret(world, p.technology),
      researchers: contributorsOf(p),
      volumesOnHand: p.volumesOnHand,
      volumesSpent: p.volumesSpent,
      volumesRequired: p.volumesRequired,
    }));
  return {
    held,
    adopting,
    projects,
    elsewhere: [],
    youAreAMasterOf: mine,
    familiarWith: [...(s.familiar[cId] ?? [])],
  };
}

/** The `trends` block: one lagged index, the same for everybody. */
export function trendsBlock(world: World): ObservedTrend[] {
  return trendsObservation(world);
}

/** The three rows this layer adds to a citizen's contribution, and what they are worth. */
export function progressContribution(world: World, cId: CitizenId): { deeds: ProgressDeeds; worth: number } {
  const deeds = deedsOf(world, cId);
  const worth = deeds.discovered * PROGRESS_CONTRIBUTION_WORTH.discovered
    + deeds.taught * PROGRESS_CONTRIBUTION_WORTH.taught
    + deeds.apprentices * PROGRESS_CONTRIBUTION_WORTH.apprentice;
  return { deeds, worth };
}

/** The itemised rows, for a notice of standing that has to say why. */
export function progressDeedRows(world: World, cId: CitizenId): { label: string; count: number; worth: number }[] {
  const { deeds } = progressContribution(world, cId);
  const w = PROGRESS_CONTRIBUTION_WORTH;
  return [
    { label: 'technologies discovered', count: deeds.discovered, worth: deeds.discovered * w.discovered },
    { label: 'technologies taught to another city', count: deeds.taught, worth: deeds.taught * w.taught },
    { label: 'apprentices who carry a secret on', count: deeds.apprentices, worth: deeds.apprentices * w.apprentice },
  ].filter((r) => r.count > 0);
}

/** One line of the morning edition: what is being worked on, and what it is costing. */
export function progressReport(world: World): string {
  const projects = openProjects(world);
  if (projects.length === 0) return 'No programme of research is open.';
  const rows = projects.slice(0, 3).map((p) => {
    const tech = TECHNOLOGIES[p.technology];
    return `${p.name} (${tech.name}) at ${Math.round(p.progress)} of ${p.cost}, purse ${formatLumens(purseOf(world, p))}`;
  });
  const more = projects.length > 3 ? `, and ${projects.length - 3} more` : '';
  return `Research: ${rows.join('; ')}${more}.`;
}

/** What kinds of trend the city knows about, for a dashboard's filter. */
export function trendKinds(): readonly TrendKind[] {
  return ['possession', 'dish', 'hobby', 'name', 'school'];
}
