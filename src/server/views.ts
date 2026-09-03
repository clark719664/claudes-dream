/**
 * JSON views of the World for the dashboard: state summary, map, citizen
 * list and citizen detail. Pure read-only projections — nothing here emits
 * events, drains inboxes or moves money.
 */
import type { Building, Citizen, CitizenId, MoneyParty, World } from '../types.ts';
import { activeCitizens, isDetained } from '../citizens/citizen.ts';
import { friendsOf, rivalsOf, bondBetween } from '../citizens/relationships.ts';
import { employerName, openJobs } from '../economy/jobs.ts';
import { daysToElection, isElectionDay, nominationsOpen } from '../government/council.ts';
import { pendingCasesFor } from '../government/court.ts';
import { LAWS } from '../data/laws.ts';

export interface SimStatus {
  running: boolean;
  tickMs: number;
  busy: boolean;
  pendingRemote: CitizenId[];
}

export const MAP_WIDTH = 60;
export const MAP_HEIGHT = 40;

// ---------------------------------------------------------------- helpers

export function nameOf(world: World, id: CitizenId | null | undefined): string | null {
  if (!id) return null;
  return world.citizens[id]?.name ?? id;
}

/** Human name for any party on the ledger. */
export function partyName(world: World, party: MoneyParty | 'city'): string {
  switch (party) {
    case 'treasury': return 'The Treasury';
    case 'mint': return 'The Mint';
    case 'burn': return 'Burned';
    case 'city': return 'City of Reverie';
    default:
      return world.citizens[party]?.name ?? world.businesses[party]?.name ?? party;
  }
}

/** Ids of citizens living in the city (in the turn order). */
export function presentSet(world: World): Set<CitizenId> {
  return new Set(world.order);
}

export function isPresentIn(world: World, c: Citizen, present: Set<CitizenId>): boolean {
  return c.standing !== 'exiled' && present.has(c.id);
}

export function clockText(world: World): string {
  return `Day ${world.day}, ${String(world.hour).padStart(2, '0')}:00`;
}

/** FNV-1a, for stable per-citizen jitter on the map. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function jitter(id: string): [number, number] {
  const h = hash32(id);
  return [(h & 0xffff) / 0x10000, ((h >>> 16) & 0xffff) / 0x10000];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Where a citizen stands on the 60 x 40 grid: jittered inside their
 * district, at the Exile Gate when exiled, at the Watch House when detained.
 */
export function positionOf(world: World, c: Citizen): { x: number; y: number } {
  const [u, v] = jitter(c.id);
  const near = (b: Building | undefined, dx: number, dy: number, fallbackDistrict: Citizen['district']) => {
    if (b) return { x: round2(b.x + dx + (u - 0.5) * 3.2), y: round2(b.y + dy + (v - 0.5) * 1.8) };
    return inDistrict(fallbackDistrict);
  };
  const inDistrict = (districtId: Citizen['district']) => {
    const d = world.districts[districtId] ?? world.districts.commons;
    const padX = 1.3;
    const top = 3.0;
    const bottom = 1.0;
    return { x: round2(d.x + padX + u * (d.w - 2 * padX)), y: round2(d.y + top + v * Math.max(1, d.h - top - bottom)) };
  };
  if (c.standing === 'exiled') return near(world.buildings.exile_gate, 0, 2.2, 'threshold');
  if (isDetained(world, c)) return near(world.buildings.watch_house, 0, 2.0, 'commons');
  return inDistrict(c.district);
}

function jobOf(world: World, c: Citizen) {
  const job = c.jobId ? world.jobs[c.jobId] : undefined;
  return job && job.holderId === c.id ? job : null;
}

function businessOf(world: World, c: Citizen) {
  return c.businessId ? world.businesses[c.businessId] ?? null : null;
}

// ------------------------------------------------------------------ state

export function stateView(world: World, status: SimStatus): Record<string, unknown> {
  const present = presentSet(world);
  const all = Object.values(world.citizens);
  const living = all.filter((c) => isPresentIn(world, c, present));
  const employed = living.filter((c) => jobOf(world, c) !== null).length;
  const g = world.government;
  return {
    tick: world.tick, day: world.day, hour: world.hour, clock: clockText(world),
    population: living.length,
    running: status.running, tickMs: status.tickMs, busy: status.busy, pendingRemote: status.pendingRemote,
    config: world.config,
    counts: {
      citizens: all.length, present: living.length, employed, unemployed: living.length - employed,
      homeless: living.filter((c) => c.homeTier === 0).length,
      detained: living.filter((c) => isDetained(world, c)).length,
      exiled: all.filter((c) => c.standing === 'exiled').length,
      remote: living.filter((c) => c.brain === 'remote').length,
      llm: living.filter((c) => c.brain === 'llm').length,
      businesses: Object.values(world.businesses).filter((b) => b.dissolvedDay === null).length,
      openJobs: openJobs(world).length,
      pendingCases: Object.values(world.cases).filter((k) => k.status === 'pending').length,
      bans: world.bans.filter((b) => b.pardonedDay === null).length,
    },
    treasury: { balance: world.treasury.balance, revenueToday: world.treasury.revenueToday, spendToday: world.treasury.spendToday },
    priceIndex: world.market.priceIndex,
    shortages: world.market.shortages,
    mayor: g.mayorId ? { id: g.mayorId, name: nameOf(world, g.mayorId) } : null,
    election: {
      electionDay: g.election.electionDay, daysToElection: daysToElection(world),
      nominationsOpen: nominationsOpen(world), electionToday: isElectionDay(world) && !g.election.resolved,
    },
    events: world.events.length,
    lastEvent: world.events.length ? world.events[world.events.length - 1] : null,
  };
}

// -------------------------------------------------------------------- map

export function mapView(world: World): Record<string, unknown> {
  const present = presentSet(world);
  const citizens = Object.values(world.citizens).filter((c) => c.standing === 'exiled' || present.has(c.id));
  const perDistrict: Record<string, number> = {};
  const workers: Record<string, number> = {};
  for (const c of citizens) {
    if (c.standing === 'exiled') continue;
    perDistrict[c.district] = (perDistrict[c.district] ?? 0) + 1;
  }
  for (const j of Object.values(world.jobs)) {
    if (j.holderId) workers[j.buildingId] = (workers[j.buildingId] ?? 0) + 1;
  }
  return {
    width: MAP_WIDTH, height: MAP_HEIGHT,
    districts: Object.values(world.districts).map((d) => ({
      id: d.id, name: d.name, x: d.x, y: d.y, w: d.w, h: d.h, adjacent: d.adjacent, population: perDistrict[d.id] ?? 0,
    })),
    buildings: Object.values(world.buildings).map((b) => ({
      id: b.id, name: b.name, district: b.district, kind: b.kind, critical: b.critical, damage: round2(b.damage), x: b.x, y: b.y,
      workers: workers[b.id] ?? 0,
    })),
    citizens: citizens.map((c) => {
      const pos = positionOf(world, c);
      const job = jobOf(world, c);
      return {
        id: c.id, name: c.name, district: c.district, x: pos.x, y: pos.y, standing: c.standing, office: c.office,
        brain: c.brain, mood: Math.round(c.mood), detained: isDetained(world, c), job: job ? job.title : null,
      };
    }),
  };
}

// --------------------------------------------------------------- citizens

export interface CompactCitizen {
  id: CitizenId; name: string; lineage: string; brain: string; job: string | null; employer: string | null;
  district: string; wallet: number; mood: number; reputation: number; standing: string; office: string | null;
  homeTier: number; detained: boolean; present: boolean; business: string | null; convictions: number; arrivedDay: number;
}

export function compactCitizen(world: World, c: Citizen, present: Set<CitizenId>): CompactCitizen {
  const job = jobOf(world, c);
  const biz = businessOf(world, c);
  return {
    id: c.id, name: c.name, lineage: c.lineage, brain: c.brain,
    job: job ? job.title : null, employer: job ? employerName(world, job) : null,
    district: c.district, wallet: c.wallet, mood: Math.round(c.mood), reputation: Math.round(c.reputation),
    standing: c.standing, office: c.office, homeTier: c.homeTier,
    detained: isDetained(world, c), present: isPresentIn(world, c, present),
    business: biz ? biz.name : null, convictions: c.record.convictions.length, arrivedDay: c.arrivedDay,
  };
}

const SORT_KEYS: readonly (keyof CompactCitizen)[] = [
  'name', 'lineage', 'brain', 'job', 'district', 'wallet', 'mood', 'reputation', 'standing', 'office', 'arrivedDay', 'convictions',
];

function compareBy(key: keyof CompactCitizen, dir: 1 | -1) {
  return (a: CompactCitizen, b: CompactCitizen): number => {
    const x = a[key];
    const y = b[key];
    if (x === y) return a.name.localeCompare(b.name);
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y)) * dir;
  };
}

/** `?sort=wallet` or `?sort=-wallet`, `?standing=good|probation|suspended|exiled`, `?present=1`. */
export function citizensView(world: World, params: URLSearchParams): Record<string, unknown> {
  const present = presentSet(world);
  let rows = Object.values(world.citizens).map((c) => compactCitizen(world, c, present));
  const standing = params.get('standing');
  if (standing && standing !== 'all') rows = rows.filter((r) => r.standing === standing);
  if (params.get('present') === '1' || params.get('present') === 'true') rows = rows.filter((r) => r.present);
  const brain = params.get('brain');
  if (brain && brain !== 'all') rows = rows.filter((r) => r.brain === brain);
  const sortParam = params.get('sort') ?? 'name';
  const desc = sortParam.startsWith('-');
  const key = (desc ? sortParam.slice(1) : sortParam) as keyof CompactCitizen;
  rows.sort(compareBy(SORT_KEYS.includes(key) ? key : 'name', desc ? -1 : 1));
  const limit = Number(params.get('limit'));
  if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
  return { citizens: rows, count: rows.length, total: Object.keys(world.citizens).length };
}

function relation(world: World, selfId: CitizenId, ids: CitizenId[], max: number) {
  const out: { id: CitizenId; name: string; bond: number; standing: string }[] = [];
  for (const id of ids) {
    const other = world.citizens[id];
    if (!other) continue;
    out.push({ id, name: other.name, bond: Math.round(bondBetween(world, selfId, id)), standing: other.standing });
    if (out.length >= max) break;
  }
  return out;
}

/** Everything about one citizen except the API key hash; null when unknown. */
export function citizenView(world: World, id: CitizenId): Record<string, unknown> | null {
  const c = world.citizens[id];
  if (!c) return null;
  const present = presentSet(world);
  const { apiKeyHash, ...rest } = c;
  const job = jobOf(world, c);
  const biz = businessOf(world, c);
  const loan = c.loanId ? world.loans[c.loanId] ?? null : null;
  const cases = Object.values(world.cases)
    .filter((k) => k.defendantId === id)
    .sort((a, b) => b.filedTick - a.filedTick)
    .map((k) => ({
      id: k.id, law: k.law, lawName: LAWS[k.law]?.name ?? k.law, severity: k.severity, status: k.status, verdict: k.verdict,
      day: Math.floor(k.filedTick / 24), triedDay: k.triedDay, sentence: k.sentence,
      appeal: k.appeal ? { filedDay: k.appeal.filedDay, result: k.appeal.result } : null,
    }));
  const ban = [...world.bans].reverse().find((b) => b.citizenId === id) ?? null;
  return {
    ...rest,
    hasApiKey: apiKeyHash !== null,
    detained: isDetained(world, c),
    present: isPresentIn(world, c, present),
    districtName: world.districts[c.district]?.name ?? c.district,
    job: job ? {
      id: job.id, title: job.title, role: job.role, employer: employerName(world, job), employerId: job.employer,
      district: job.district, wage: Math.max(world.government.minWage, job.wage),
    } : null,
    business: biz ? {
      id: biz.id, name: biz.name, kind: biz.kind, treasury: biz.treasury, employees: biz.employees.length,
      district: biz.district, dissolvedDay: biz.dissolvedDay,
    } : null,
    loan,
    friends: relation(world, id, friendsOf(world, id), 8),
    rivals: relation(world, id, rivalsOf(world, id), 8),
    cases,
    ban: ban ? { ...ban, lawName: LAWS[ban.law]?.name ?? ban.law, apiKeyHash: undefined, hasApiKey: ban.apiKeyHash !== null } : null,
    pendingCharges: pendingCasesFor(world, id).length,
    inboxCount: c.inbox.length,
  };
}

/** The living population, for the CLI and tests. */
export function population(world: World): number {
  return activeCitizens(world).length;
}
