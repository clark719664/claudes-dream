/**
 * How Reverie gets bigger.
 *
 * The founding city is seven districts. Two more are drawn on the plan from
 * the start and stay shut until the city is big enough to need them: **The
 * Heights** above Foundry Row, with the University and the villas on the hill,
 * and **The Undercroft**, the old tunnels under the Harbor, where a room is
 * cheap and the light is bad. A district opens on a population threshold and
 * never closes again.
 *
 * Because a closed district is not part of the city, this module — and not
 * `data/city.ts` — owns the walk: `canMoveBetween`, `pathDistance` and
 * `nextStep` are measured over the districts that are actually open, plus the
 * tram lines public works have paid for. Every part of the engine that decides
 * where a citizen can go asks here, so a closed district and a new tram are
 * honoured everywhere at once.
 *
 * Nothing in this file tells a citizen where to live or what to do with a new
 * district: it opens the doors, posts the jobs the city runs there, counts the
 * rooms, and lets people make of it what they will.
 */
import { DISTRICT_IDS, FOUNDING_DISTRICT_IDS } from '../types.ts';
import type { Citizen, DistrictId, Job, Team, World } from '../types.ts';
import { BUILDINGS, DISTRICTS, HOUSING_BLOCKS } from '../data/city.ts';
import { CITY_JOBS, TRAM_COST } from '../data/jobs.ts';
import { HEIGHTS_POPULATION, TEAM_NAMES, UNDERCROFT_POPULATION } from '../data/metropolis.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';

/** The districts that open with the city's population, in the order it meets them. */
export const GROWTH_THRESHOLDS: readonly { district: DistrictId; population: number }[] = [
  { district: 'heights', population: HEIGHTS_POPULATION },
  { district: 'undercroft', population: UNDERCROFT_POPULATION },
];

/** Hops the walk gives up at: further than this is "you cannot get there from here". */
export const UNREACHABLE = 99;

// ---------------------------------------------------------------------------
// What is open
// ---------------------------------------------------------------------------

/** The districts the city has opened. A world saved before this layer has the founding seven. */
export function openDistricts(world: World): DistrictId[] {
  const list = world.openDistricts;
  if (!Array.isArray(list) || list.length === 0) return [...FOUNDING_DISTRICT_IDS];
  return list.filter((d) => !!DISTRICTS[d]);
}

export function isOpen(world: World, d: DistrictId): boolean {
  return openDistricts(world).includes(d);
}

/** Citizens living in the city right now (not exiled, still in the turn order). */
function population(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.standing !== 'exiled') out.push(c);
  }
  return out;
}

function districtName(world: World, d: DistrictId): string {
  return world.districts[d]?.name ?? DISTRICTS[d]?.name ?? d;
}

// ---------------------------------------------------------------------------
// Opening a district
// ---------------------------------------------------------------------------

/** City posts that stand in a district: one per slot the plan gives them, opened once. */
function openCityPosts(world: World, d: DistrictId): Job[] {
  const opened: Job[] = [];
  for (const t of CITY_JOBS) {
    const building = world.buildings[t.buildingId] ?? BUILDINGS[t.buildingId];
    if (!building || building.district !== d) continue;
    const existing = Object.values(world.jobs).filter((j) => j.employer === 'city' && j.role === t.role && j.buildingId === t.buildingId).length;
    const slots = Math.max(1, Math.round(t.slots));
    for (let i = existing; i < slots; i++) {
      const id = nextId(world, 'j');
      const job: Job = {
        id, role: t.role, title: t.title, employer: 'city', buildingId: t.buildingId, district: d,
        skill: t.skill, minSkill: t.minSkill, minReputation: t.minReputation, wage: Math.round(t.wage),
        output: { ...t.output }, holderId: null, createdDay: world.day,
      };
      world.jobs[id] = job;
      opened.push(job);
    }
  }
  return opened;
}

/** Rooms a district adds to the city's housing ledger. */
function openHousing(world: World, d: DistrictId): number {
  let rooms = 0;
  for (const block of HOUSING_BLOCKS) {
    const building = world.buildings[block.buildingId] ?? BUILDINGS[block.buildingId];
    if (!building || building.district !== d) continue;
    world.housing.capacity[block.tier] += block.units;
    rooms += block.units;
  }
  return rooms;
}

/** Every open district fields a team; a new district brings its own. */
function openTeam(world: World, d: DistrictId): Team | null {
  world.teams ??= {};
  const existing = world.teams[d];
  if (existing) return existing;
  const team: Team = {
    district: d,
    name: TEAM_NAMES?.[d] ?? `${districtName(world, d)} XI`,
    players: [], wins: 0, losses: 0, draws: 0,
  };
  world.teams[d] = team;
  return team;
}

/**
 * Open a district for good: its city posts are advertised, its rooms join the
 * housing ledger, it fields a team, and the whole city hears. Idempotent, and
 * unknown districts are ignored.
 */
export function openDistrict(world: World, d: DistrictId): void {
  if (!DISTRICTS[d]) return;
  world.openDistricts ??= [...FOUNDING_DISTRICT_IDS];
  if (world.openDistricts.includes(d)) return;
  world.openDistricts.push(d);
  world.districts[d] ??= structuredClone(DISTRICTS[d]);
  const jobs = openCityPosts(world, d);
  const rooms = openHousing(world, d);
  openTeam(world, d);
  const where = districtName(world, d);
  const posts = jobs.length > 0 ? `, ${jobs.length} ${jobs.length === 1 ? 'post' : 'posts'} on the city's board` : '';
  const homes = rooms > 0 ? ` and ${rooms} ${rooms === 1 ? 'room' : 'rooms'} to let` : '';
  emit(world, 'growth', `${where} is open: the city has grown to ${population(world).length} citizens${posts}${homes}.`,
    [], 0.9, { district: d, jobs: jobs.map((j) => j.id), rooms });
  for (const c of population(world)) {
    remember(world, c.id, 'event', `${where} opened today; anyone may walk there now.`);
  }
}

/**
 * Morning: the city counts itself and opens whatever its size has earned.
 * Districts never close, and a threshold already passed is not opened twice.
 */
export function dailyGrowth(world: World): void {
  world.openDistricts ??= [...FOUNDING_DISTRICT_IDS];
  const heads = population(world).length;
  for (const step of GROWTH_THRESHOLDS) {
    if (heads >= step.population && !isOpen(world, step.district)) openDistrict(world, step.district);
  }
}

// ---------------------------------------------------------------------------
// Trams
// ---------------------------------------------------------------------------

/** The tram lines that run from a district, as recorded (either order counts as one line). */
export function tramPartners(world: World, d: DistrictId): DistrictId[] {
  const out: DistrictId[] = [];
  for (const [a, b] of world.trams ?? []) {
    if (a === d && !out.includes(b)) out.push(b);
    else if (b === d && !out.includes(a)) out.push(a);
  }
  return out;
}

export function hasTram(world: World, a: DistrictId, b: DistrictId): boolean {
  return (world.trams ?? []).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/**
 * Lay a tram line: two districts that were a walk apart are now next door,
 * both ways. A line that already runs is refused, and so is a line to nowhere.
 */
export function addTram(world: World, a: DistrictId, b: DistrictId): boolean {
  if (!DISTRICTS[a] || !DISTRICTS[b] || a === b) return false;
  world.trams ??= [];
  if (hasTram(world, a, b)) return false;
  world.trams.push([a, b]);
  emit(world, 'growth', `A tram line runs between ${districtName(world, a)} and ${districtName(world, b)}: the two are neighbours now.`,
    [], 0.8, { tram: [a, b] });
  for (const c of population(world)) {
    remember(world, c.id, 'event', `The tram between ${districtName(world, a)} and ${districtName(world, b)} opened today.`);
  }
  return true;
}

/**
 * The Council's `tram` proposal: the city connects the two open districts
 * furthest apart that are not already neighbours. The line is built by the
 * city's own hands out of the public works fund, so no lumen leaves the
 * Treasury; when the fund is short of TRAM_COST there is no line.
 */
export function enactTram(world: World): [DistrictId, DistrictId] | null {
  const open = openDistricts(world);
  let best: [DistrictId, DistrictId] | null = null;
  let bestDistance = 1;
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i];
      const b = open[j];
      if (openAdjacent(world, a).includes(b)) continue;
      const distance = pathDistance(world, a, b);
      if (distance <= bestDistance) continue;
      bestDistance = distance;
      best = [a, b];
    }
  }
  if (!best) return null;
  const fund = Math.max(0, Math.round(world.government.publicWorksFund ?? 0));
  if (fund < TRAM_COST) {
    emit(world, 'growth', `The tram to ${districtName(world, best[1])} waits: the public works fund holds ${fund} of the ${TRAM_COST} ℓ the line costs.`,
      [], 0.4, { needed: TRAM_COST, fund });
    return null;
  }
  world.government.publicWorksFund = Math.max(0, fund - TRAM_COST);
  return addTram(world, best[0], best[1]) ? best : null;
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/**
 * Everywhere you can get to from a district in one step: its neighbours on the
 * plan that the city has opened, plus everywhere its trams run.
 */
export function openAdjacent(world: World, d: DistrictId): DistrictId[] {
  const plan = DISTRICTS[d]?.adjacent ?? [];
  const out: DistrictId[] = [];
  for (const n of [...plan, ...tramPartners(world, d)]) {
    if (n === d || out.includes(n) || !DISTRICTS[n] || !isOpen(world, n)) continue;
    out.push(n);
  }
  return out;
}

/** Can a citizen standing in `from` walk to `to` this hour? */
export function canMoveBetween(world: World, from: DistrictId, to: DistrictId): boolean {
  if (!DISTRICTS[from] || !DISTRICTS[to] || !isOpen(world, to)) return false;
  if (from === to) return true;
  return openAdjacent(world, from).includes(to);
}

/** Hops between two districts over the open city, 0 for the same one and UNREACHABLE for no way at all. */
export function pathDistance(world: World, a: DistrictId, b: DistrictId): number {
  if (!DISTRICTS[a] || !DISTRICTS[b]) return UNREACHABLE;
  if (a === b) return 0;
  const seen = new Set<DistrictId>([a]);
  let frontier: DistrictId[] = [a];
  let d = 0;
  while (frontier.length > 0) {
    d++;
    const next: DistrictId[] = [];
    for (const x of frontier) {
      for (const y of openAdjacent(world, x)) {
        if (y === b) return d;
        if (seen.has(y)) continue;
        seen.add(y);
        next.push(y);
      }
    }
    frontier = next;
  }
  return UNREACHABLE;
}

/**
 * The first step of the shortest walk from one district to another; null when
 * they are the same district or there is no way through. Ties are broken by
 * the fixed district order, so the same walk is chosen every time.
 */
export function nextStep(world: World, from: DistrictId, to: DistrictId): DistrictId | null {
  if (!DISTRICTS[from] || !DISTRICTS[to] || from === to) return null;
  let best: DistrictId | null = null;
  let bestDistance = UNREACHABLE;
  for (const n of openAdjacent(world, from)) {
    if (n === to) return n;
    const distance = pathDistance(world, n, to);
    if (distance >= UNREACHABLE) continue;
    const better = distance < bestDistance
      || (distance === bestDistance && best !== null && DISTRICT_IDS.indexOf(n) < DISTRICT_IDS.indexOf(best));
    if (!better) continue;
    bestDistance = distance;
    best = n;
  }
  return best;
}

/** The districts a citizen may be told about: the open city, in plan order. */
export function districtsObservation(world: World): DistrictId[] {
  const open = openDistricts(world);
  return DISTRICT_IDS.filter((d) => open.includes(d));
}

/** One line for the Chronicle when the map changes. */
export function describeGrowth(world: World): string {
  const open = openDistricts(world);
  const trams = world.trams ?? [];
  const lines = trams.map(([a, b]) => `${districtName(world, a)}–${districtName(world, b)}`).join(', ');
  return `${open.length} districts open${trams.length > 0 ? `; trams: ${lines}` : ''}.`;
}
