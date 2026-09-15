/**
 * The tree — twenty-five technologies in five branches (`docs/PROGRESS.md` §2).
 *
 * Pure data and the arithmetic that reads it. A technology is a **subject** a
 * project can be opened on: it sits at a depth (its tier), it needs the
 * subjects above it, and it names what changes in the engine when the city
 * both holds it and has built the works for it.
 *
 * What a technology changes is written here as numbers rather than as prose,
 * because `progress/effects.ts` has to be able to scale them: a discovery is a
 * line in the Hall of Records until the drains are dug and the hands are
 * trained (`PROGRESS.md` §3), so every number below is the *full* effect and
 * what the city actually gets is that number scaled by its readiness and its
 * uptake. Nothing here reads or writes the World.
 *
 * Two shapes, because there are two kinds of change:
 *
 * - a **multiplier** is 1 at no effect (output ×1.15, emission ×0.55), and
 *   scales as `1 + (m − 1) × strength`;
 * - a **delta** is 0 at no effect (visibility +0.30, the outbreak threshold
 *   +2), and scales as `d × strength`;
 * - an **unlock** is a door that is either open or shut. It opens on holding
 *   the subject, because a door is not a quantity — the tram is the one the
 *   registry cares about (`REGISTRY.md` §7: METROPOLIS's tram was buildable
 *   from day one, and now it is not).
 */

export type Branch = 'materials' | 'medicine' | 'transport' | 'information' | 'agriculture';

export const BRANCHES: readonly Branch[] = ['materials', 'medicine', 'transport', 'information', 'agriculture'];

/** How deep a subject sits, and therefore what it costs. */
export type Tier = 1 | 2 | 3 | 4;

export type TechnologyId =
  // materials
  | 'the_loom' | 'blast_furnace' | 'the_lens' | 'flue_scrubbing' | 'precision_machining' | 'standardised_parts'
  // medicine
  | 'sanitation' | 'anaesthesia' | 'germ_theory' | 'vaccination' | 'mind_repair'
  // transport
  | 'road_metalling' | 'canal_locks' | 'refrigeration' | 'the_tram' | 'the_deep_hull'
  // information
  | 'double_entry' | 'the_printing_press' | 'cartography' | 'actuarial_tables' | 'the_telegraph'
  // agriculture
  | 'crop_rotation' | 'the_seed_drill' | 'silage' | 'the_glasshouse';

/**
 * Every number in the engine a technology moves. Each is read through a named
 * accessor in `progress/effects.ts`, never by string from outside this layer.
 */
export type EffectKey =
  // materials
  | 'comfortDecay' | 'attireGoods' | 'producerOutput' | 'energyAnchor'
  | 'academyAnalysis' | 'researchInsight' | 'emission' | 'toolOutput'
  | 'recipeGoods' | 'businessOutput' | 'fabricatorMinSkill'
  // medicine
  | 'glitchOnset' | 'glitchSpread' | 'wardCure' | 'outbreakThreshold'
  // transport
  | 'roadSpeed' | 'routeDecay' | 'riverSpeed' | 'riverCapacity'
  | 'spoilage' | 'glutDays' | 'seaCargo' | 'stormHazard'
  // information
  | 'evasionVisibility' | 'insiderVisibility' | 'trendReach' | 'rumourReach' | 'travelHazard'
  // agriculture
  | 'computeOutput' | 'forgeMaximum' | 'famineCeiling';

/** A door a technology opens: open or shut, never a quantity. */
export type Unlock =
  | 'tool_grades' | 'quarantine' | 'inoculation' | 'mind_repair' | 'lock_toll'
  | 'tram' | 'open_books' | 'more_papers' | 'region_maps' | 'priced_premiums'
  | 'telegraph' | 'bazaar_reserve' | 'compute_anywhere' | 'painless_treatment';

export interface Technology {
  id: TechnologyId;
  name: string;
  branch: Branch;
  tier: Tier;
  /** Subjects the city must already hold before this one may be opened. */
  needs: TechnologyId[];
  /** Multiplicative effects; 1 is no change. */
  multipliers: Partial<Record<EffectKey, number>>;
  /** Additive effects; 0 is no change. */
  deltas: Partial<Record<EffectKey, number>>;
  /** Doors this subject opens. */
  unlocks: Unlock[];
  /** What changes, in the words of `docs/PROGRESS.md` §2. */
  changes: string;
}

function tech(
  id: TechnologyId, name: string, branch: Branch, tier: Tier, needs: TechnologyId[],
  changes: string,
  effects: {
    multipliers?: Partial<Record<EffectKey, number>>;
    deltas?: Partial<Record<EffectKey, number>>;
    unlocks?: Unlock[];
  } = {},
): Technology {
  return {
    id, name, branch, tier, needs, changes,
    multipliers: effects.multipliers ?? {},
    deltas: effects.deltas ?? {},
    unlocks: effects.unlocks ?? [],
  };
}

export const TECHNOLOGIES: Record<TechnologyId, Technology> = Object.fromEntries(([
  // --- materials ---------------------------------------------------------
  tech('the_loom', 'The Loom', 'materials', 1, [],
    'attire and furniture cost 2 fewer goods to make; comfort decays a tenth slower city-wide',
    { deltas: { attireGoods: -2 }, multipliers: { comfortDecay: 0.9 } }),
  tech('blast_furnace', 'Blast Furnace', 'materials', 1, [],
    'the Power Station and the Fabrication Works make 15 % more a shift; energy costs a tenth less to make',
    { multipliers: { producerOutput: 1.15, energyAnchor: 0.9 } }),
  tech('the_lens', 'The Lens', 'materials', 1, [],
    'Academy lessons in analysis teach a quarter faster; research goes 0.10 further an hour; the gate to medicine and information',
    { multipliers: { academyAnalysis: 1.25 }, deltas: { researchInsight: 0.1 } }),
  tech('flue_scrubbing', 'Flue Scrubbing', 'materials', 2, ['blast_furnace', 'the_lens'],
    'every producing building emits 45 % less',
    { multipliers: { emission: 0.55 } }),
  tech('precision_machining', 'Precision Machining', 'materials', 2, ['blast_furnace', 'the_lens'],
    'tools gain a grade: a graded tool raises its holder\'s shift by 5 % while they own it',
    { deltas: { toolOutput: 0.05 }, unlocks: ['tool_grades'] }),
  tech('standardised_parts', 'Standardised Parts', 'materials', 3, ['precision_machining'],
    'every craft recipe drops a unit of goods; businesses make a tenth more; a fabricator\'s post asks 10 less skill',
    { deltas: { recipeGoods: -1, fabricatorMinSkill: -10 }, multipliers: { businessOutput: 1.1 } }),
  // --- medicine ----------------------------------------------------------
  tech('sanitation', 'Sanitation', 'medicine', 1, [],
    'glitches begin at 0.6 of the rate and spread at half; the largest works bill in the tree, because drains must be dug',
    { multipliers: { glitchOnset: 0.6, glitchSpread: 0.5 } }),
  tech('anaesthesia', 'Anaesthesia', 'medicine', 2, ['the_lens'],
    'the Ward cures 85 times in a hundred rather than 60, and treatment no longer costs the patient a shift',
    { deltas: { wardCure: 0.25 }, unlocks: ['painless_treatment'] }),
  tech('germ_theory', 'Germ Theory', 'medicine', 2, ['sanitation', 'the_lens'],
    'an outbreak takes 5 glitches rather than 3; medics cure before the spread roll; the Mayor may decree a quarantine',
    { deltas: { outbreakThreshold: 2 }, unlocks: ['quarantine'] }),
  tech('vaccination', 'Vaccination', 'medicine', 3, ['germ_theory'],
    'a visit to the clinic may inoculate for a fee: a fifth of the glitch chance for a cycle',
    { unlocks: ['inoculation'] }),
  tech('mind_repair', 'Mind Repair', 'medicine', 3, ['germ_theory', 'anaesthesia'],
    'the Ward can treat the damage mind-tampering does, which today only Solene can',
    { unlocks: ['mind_repair'] }),
  // --- transport ---------------------------------------------------------
  tech('road_metalling', 'Road Metalling', 'transport', 1, [],
    'roads carry 11 leagues a tick rather than 8, and a route\'s condition decays 30 % slower',
    { deltas: { roadSpeed: 3 }, multipliers: { routeDecay: 0.7 } }),
  tech('canal_locks', 'Canal Locks', 'transport', 1, [],
    'river routes run 1.3 times as fast with half again the capacity; the city that keeps the locks takes a toll',
    { multipliers: { riverSpeed: 1.3, riverCapacity: 1.5 }, unlocks: ['lock_toll'] }),
  tech('refrigeration', 'Refrigeration', 'transport', 2, ['blast_furnace'],
    'cargo spoils at 1 % a day rather than 4; the Bazaar will hold 9 days of cover rather than 6',
    { multipliers: { spoilage: 0.25 }, deltas: { glutDays: 3 } }),
  tech('the_tram', 'The Tram', 'transport', 3, ['blast_furnace', 'precision_machining'],
    'the Council\'s tram works become possible at all: two districts become neighbours',
    { unlocks: ['tram'] }),
  tech('the_deep_hull', 'The Deep Hull', 'transport', 3, ['canal_locks', 'precision_machining'],
    'a sea hull carries twice the cargo at half the storm hazard',
    { multipliers: { seaCargo: 2, stormHazard: 0.5 } }),
  // --- information -------------------------------------------------------
  tech('double_entry', 'Double-Entry Bookkeeping', 'information', 1, [],
    'tax evasion is seen 1 time in 2 rather than 1 in 5, insider dealing nearly as often; a business\'s books are public',
    { deltas: { evasionVisibility: 0.3, insiderVisibility: 0.2 }, unlocks: ['open_books'] }),
  tech('the_printing_press', 'The Printing Press', 'information', 2, ['the_lens'],
    'a second and third paper may be founded; rumours, ideas and trends reach twice as many citizens a day',
    { multipliers: { trendReach: 2, rumourReach: 2 }, unlocks: ['more_papers'] }),
  tech('cartography', 'Cartography', 'information', 2, ['the_lens'],
    'a map is of a whole region rather than one road, and travel is a quarter less hazardous',
    { multipliers: { travelHazard: 0.75 }, unlocks: ['region_maps'] }),
  tech('actuarial_tables', 'Actuarial Tables', 'information', 2, ['double_entry'],
    'any city with a bank may underwrite, and a premium is priced off the last cycle\'s real losses',
    { unlocks: ['priced_premiums'] }),
  tech('the_telegraph', 'The Telegraph', 'information', 3, ['precision_machining', 'the_printing_press'],
    'news, prices, charges and treaty terms cross between connected cities in one tick instead of days',
    { unlocks: ['telegraph'] }),
  // --- agriculture -------------------------------------------------------
  tech('crop_rotation', 'Crop Rotation', 'agriculture', 1, [],
    'a shift at the Forge makes a fifth more compute, and the staple gets cheaper for everyone',
    { multipliers: { computeOutput: 1.2 } }),
  tech('the_seed_drill', 'The Seed Drill', 'agriculture', 3, ['crop_rotation', 'precision_machining'],
    'compute output rises again by 15 %, and one operator does the work of two: the forge maximum falls by a third',
    { multipliers: { computeOutput: 1.15, forgeMaximum: 2 / 3 } }),
  tech('silage', 'Silage', 'agriculture', 3, ['crop_rotation', 'refrigeration'],
    'the Bazaar keeps a reserve; a famine settles at 1.25 times the anchor rather than 1.6',
    { deltas: { famineCeiling: -0.35 }, unlocks: ['bazaar_reserve'] }),
  tech('the_glasshouse', 'The Glasshouse', 'agriculture', 4, ['silage', 'the_lens'],
    'compute can be grown in any hinterland: a mountain city feeds itself',
    { unlocks: ['compute_anywhere'] }),
] as Technology[]).map((t) => [t.id, t])) as Record<TechnologyId, Technology>;

export const TECHNOLOGY_IDS: readonly TechnologyId[] = Object.keys(TECHNOLOGIES) as TechnologyId[];

// ---------------------------------------------------------------------------
// Reading the tree
// ---------------------------------------------------------------------------

/** The subject by that name, or null. Unknown ids are a citizen's mistake, not a crash. */
export function technology(id: string): Technology | null {
  return TECHNOLOGIES[id as TechnologyId] ?? null;
}

export function isTechnologyId(id: string): id is TechnologyId {
  return id in TECHNOLOGIES;
}

export function technologyName(id: string): string {
  return technology(id)?.name ?? String(id);
}

export function technologiesIn(branch: Branch): Technology[] {
  return TECHNOLOGY_IDS.map((id) => TECHNOLOGIES[id]).filter((t) => t.branch === branch);
}

/** Progress a project must accumulate before it may resolve: 40 × tier. */
export function progressCost(tier: Tier | number): number {
  return 40 * Math.max(1, Math.round(tier));
}

/** Volumes of knowledge a subject wants off the Bazaar: 6 × tier. */
export function volumesRequired(tier: Tier | number): number {
  return 6 * Math.max(1, Math.round(tier));
}

/** What the works cost, a day at a time, before a technology does anything: 400 × tier. */
export function worksCost(tier: Tier | number): number {
  return 400 * Math.max(1, Math.round(tier));
}

/** The three costs of a subject, together. */
export function costsOf(id: TechnologyId): { progress: number; volumes: number; works: number } {
  const t = TECHNOLOGIES[id];
  const tier = t?.tier ?? 1;
  return { progress: progressCost(tier), volumes: volumesRequired(tier), works: worksCost(tier) };
}

/** Are every one of this subject's prerequisites in the given set? */
export function prerequisitesMet(held: Iterable<string>, id: TechnologyId): boolean {
  const t = TECHNOLOGIES[id];
  if (!t) return false;
  const have = new Set(held);
  return t.needs.every((n) => have.has(n));
}

/** Which of a subject's prerequisites are still missing. */
export function missingPrerequisites(held: Iterable<string>, id: TechnologyId): TechnologyId[] {
  const t = TECHNOLOGIES[id];
  if (!t) return [];
  const have = new Set(held);
  return t.needs.filter((n) => !have.has(n));
}

/** Subjects a city holding `held` may open a project on. The tier-1 subjects are open on founding day. */
export function openSubjects(held: Iterable<string>): TechnologyId[] {
  const have = new Set(held);
  return TECHNOLOGY_IDS.filter((id) => !have.has(id) && prerequisitesMet(have, id));
}

/** How many of a branch a set of technologies holds — the term in the success roll. */
export function heldInBranch(held: Iterable<string>, branch: Branch): number {
  let n = 0;
  for (const id of held) {
    const t = technology(id);
    if (t && t.branch === branch) n++;
  }
  return n;
}
