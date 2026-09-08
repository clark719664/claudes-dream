/**
 * JSON views of the World for the dashboard: state summary, map, citizen
 * list and citizen detail. Pure read-only projections — nothing here emits
 * events, drains inboxes or moves money.
 */
import type { Building, Citizen, CitizenId, MoneyParty, World } from '../types.ts';
import { characterOf } from '../citizens/character.ts';
import { activeCitizens, isDetained } from '../citizens/citizen.ts';
import { friendsOf, rivalsOf, bondBetween } from '../citizens/relationships.ts';
import { employerName, openJobs } from '../economy/jobs.ts';
import { daysToElection, isElectionDay, nominationsOpen } from '../government/council.ts';
import { pendingCasesFor } from '../government/court.ts';
import { ageOf } from '../society/family.ts';
import { LAWS, offenceName, trackOf } from '../data/laws.ts';
import { schoolName, schoolOf } from '../culture/schools.ts';
import { gangOf } from '../government/gangs.ts';
import { partyOf } from '../politics/parties.ts';
import {
  affectionsView, citizenClubsView, citizenHouseholdView, familyView, partnerView, possessionsView, wantsView,
} from './views-society.ts';

export interface SimStatus {
  running: boolean;
  tickMs: number;
  busy: boolean;
  pendingRemote: CitizenId[];
}

/**
 * The city grid. Seventy-two wide since the Heights and the Undercroft were
 * platted along the eastern edge (`src/data/city.ts`); a city that has not
 * opened them yet simply draws nothing over there.
 */
export const MAP_WIDTH = 72;
export const MAP_HEIGHT = 40;
/** Names the map lists on a building's popover before it says "and more". */
export const MAP_STAFF_SHOWN = 8;

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
    case 'chest': return 'The Community Chest';
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

/** Where a citizen's portrait is served. A file, not a data URI: the browser caches it. */
export function portraitPath(id: CitizenId): string {
  return `/api/portrait/${encodeURIComponent(id)}.svg`;
}

/** A name with a face: what every view uses wherever a citizen is mentioned. */
export interface PersonCard {
  id: CitizenId;
  name: string;
  familyName: string;
  lifeStage: string;
  standing: string;
  office: string | null;
  district: string;
  present: boolean;
  portrait: string;
}

export function personCard(world: World, id: CitizenId | null | undefined, present?: Set<CitizenId>): PersonCard | null {
  if (!id) return null;
  const c = world.citizens[id];
  if (!c) return null;
  return {
    id: c.id, name: c.name, familyName: c.familyName, lifeStage: c.lifeStage, standing: c.standing,
    office: c.office, district: c.district,
    present: isPresentIn(world, c, present ?? presentSet(world)),
    portrait: portraitPath(c.id),
  };
}

/** The cards for a list of ids, skipping anyone the registry does not know. */
export function personCards(world: World, ids: readonly CitizenId[], present: Set<CitizenId>, max = 50): PersonCard[] {
  const out: PersonCard[] = [];
  for (const id of ids) {
    const card = personCard(world, id, present);
    if (card) out.push(card);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * FNV-1a with an avalanche on the end, for stable per-citizen jitter on the
 * map. The tail is what matters here: ids are `c_1`…`c_400`, and plain FNV-1a
 * leaves its low bits almost entirely decided by the last character, so a
 * whole district's dots would stand in a handful of rows instead of being
 * scattered across the ground the plat left for them.
 */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

function jitter(id: string): [number, number] {
  const h = hash32(id);
  return [(h & 0xffff) / 0x10000, ((h >>> 16) & 0xffff) / 0x10000];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Where a citizen stands on the grid: jittered inside their district, at the
 * Exile Gate when exiled, at the Watch House when detained.
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
  const grownUps = living.filter((c) => c.lifeStage !== 'child');
  const employed = grownUps.filter((c) => jobOf(world, c) !== null).length;
  const g = world.government;
  // The date line under the name plate: "Day 41 · Bloom · 19:00 · clear".
  // A world scaffolded before the seasons has neither, and simply reads clear.
  const season = world.season ?? 'bloom';
  const weather = world.weather ?? 'clear';
  const hour = String(world.hour).padStart(2, '0');
  return {
    tick: world.tick, day: world.day, hour: world.hour, clock: clockText(world),
    year: world.year ?? 0, season, weather,
    dateLine: `Day ${world.day} · ${season.charAt(0).toUpperCase()}${season.slice(1)} · ${hour}:00 · ${weather}`,
    population: living.length,
    running: status.running, tickMs: status.tickMs, busy: status.busy, pendingRemote: status.pendingRemote,
    config: world.config,
    counts: {
      citizens: all.length, present: living.length, employed, unemployed: grownUps.length - employed,
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
  for (const c of citizens) {
    if (c.standing === 'exiled') continue;
    perDistrict[c.district] = (perDistrict[c.district] ?? 0) + 1;
  }
  // A building's day of work: how many posts it holds, who is standing at
  // them, and what a full shift of those posts makes. The map draws it in the
  // popover a reader gets by clicking the glyph.
  const workers: Record<string, number> = {};
  const posts: Record<string, { total: number; filled: number; open: number }> = {};
  const staff: Record<string, { id: CitizenId; name: string; title: string }[]> = {};
  const made: Record<string, Record<string, number>> = {};
  for (const j of Object.values(world.jobs)) {
    const post = (posts[j.buildingId] ??= { total: 0, filled: 0, open: 0 });
    post.total += 1;
    if (!j.holderId) {
      post.open += 1;
      continue;
    }
    post.filled += 1;
    workers[j.buildingId] = (workers[j.buildingId] ?? 0) + 1;
    const holder = world.citizens[j.holderId];
    const bench = (staff[j.buildingId] ??= []);
    if (holder && bench.length < MAP_STAFF_SHOWN) bench.push({ id: holder.id, name: holder.name, title: j.title });
    const good = j.output.good;
    const qty = j.output.qty ?? 0;
    if (good && qty > 0) {
      const shift = (made[j.buildingId] ??= {});
      shift[good] = (shift[good] ?? 0) + qty;
    }
  }
  const outputsOf = (id: string) => Object.entries(made[id] ?? {})
    .map(([good, qty]) => ({ good, qty: round2(qty) }))
    .sort((a, b) => b.qty - a.qty || a.good.localeCompare(b.good));
  // The map is of the city as it stands. A district the population has not
  // reached yet — the Heights, the Undercroft — is not drawn until it opens
  // (world/growth.ts), and neither is anything in it.
  const open = world.openDistricts ?? Object.keys(world.districts);
  const isOpen = (d: string): boolean => open.includes(d as (typeof open)[number]);
  return {
    width: MAP_WIDTH, height: MAP_HEIGHT,
    districts: Object.values(world.districts).filter((d) => isOpen(d.id)).map((d) => ({
      id: d.id, name: d.name, x: d.x, y: d.y, w: d.w, h: d.h, adjacent: d.adjacent, population: perDistrict[d.id] ?? 0,
    })),
    buildings: Object.values(world.buildings).filter((b) => isOpen(b.district)).map((b) => ({
      id: b.id, name: b.name, district: b.district, kind: b.kind, critical: b.critical, damage: round2(b.damage), x: b.x, y: b.y,
      workers: workers[b.id] ?? 0,
      jobs: posts[b.id] ?? { total: 0, filled: 0, open: 0 },
      staff: staff[b.id] ?? [],
      outputs: outputsOf(b.id),
    })),
    citizens: citizens.map((c) => {
      const pos = positionOf(world, c);
      const job = jobOf(world, c);
      return {
        id: c.id, name: c.name, familyName: c.familyName, district: c.district, x: pos.x, y: pos.y,
        // Where the dot is anchored, so the map can draw it at the Gate or the
        // Watch House wherever it happens to have platted those glyphs.
        place: c.standing === 'exiled' ? 'gate' : isDetained(world, c) ? 'watch' : 'district',
        standing: c.standing, office: c.office, brain: c.brain, mood: Math.round(c.mood),
        // Held by the Watch for the hour, or serving a term of custody: the
        // map rings both, and neither is a ban (docs/JUSTICE.md).
        detained: isDetained(world, c), jailed: c.jailedUntilDay !== null, job: job ? job.title : null,
        lifeStage: c.lifeStage, married: c.family.married && c.family.partnerId !== null,
        partnerId: c.family.partnerId, partnerName: nameOf(world, c.family.partnerId),
      };
    }),
  };
}

// --------------------------------------------------------------- citizens

/**
 * The badge a row wears when the citizen is under a notice of standing
 * (`docs/CITIZENSHIP.md` §4): the line they are judged against, where they
 * stand against it, and how long the grace runs. Enough to read at a glance;
 * the itemised fall belongs to the Profile.
 */
export interface NoticeBadge {
  issuedDay: number;
  line: number;
  repute: number;
  shortfall: number;
  graceEndsDay: number;
  daysLeft: number;
  immediate: boolean;
  applied: boolean;
  reason: string;
}

/**
 * The register's repute for a citizen, or null when it has not scored them
 * yet. Read, never computed: a view that recomputed repute would create the
 * ledgers the standing layer creates for itself, and an observer changes
 * nothing (docs/PRINCIPLES.md §1).
 */
function heldRepute(world: World, id: CitizenId): number | null {
  const held = world.standing?.repute?.[id];
  return typeof held === 'number' && Number.isFinite(held) ? Math.round(held) : null;
}

/** The open notice against a citizen, as a row shows it; null for everybody else. */
export function noticeBadge(world: World, c: Citizen): NoticeBadge | null {
  const n = world.standing?.notices?.[c.id];
  if (!n || n.status !== 'open') return null;
  const repute = heldRepute(world, c.id) ?? Math.round(n.reputeAtIssue);
  return {
    issuedDay: n.issuedDay, line: Math.round(n.line), repute,
    shortfall: Math.max(0, Math.round(n.line) - repute),
    graceEndsDay: n.graceEndsDay, daysLeft: Math.max(0, n.graceEndsDay - world.day),
    immediate: n.immediate, applied: n.applied, reason: n.reason,
  };
}

export interface CompactCitizen {
  id: CitizenId; name: string; familyName: string; lineage: string; brain: string; job: string | null; employer: string | null;
  district: string; wallet: number; mood: number; reputation: number; standing: string; office: string | null;
  homeTier: number; detained: boolean; present: boolean; business: string | null; convictions: number; arrivedDay: number;
  lifeStage: string; age: number; partner: string | null; partnerId: CitizenId | null; married: boolean;
  householdId: string | null; clubs: number; possessions: number;
  /** The face the city draws from public facts alone (`src/server/portraits.ts`). */
  portrait: string;
  /** What the standing register holds, and the notice it has served, if any. */
  repute: number | null;
  notice: NoticeBadge | null;
  /** The three allegiances a citizen wears in public. */
  partyId: string | null; party: string | null;
  school: string | null; schoolName: string | null;
  gangId: string | null; gang: string | null;
}

export function compactCitizen(world: World, c: Citizen, present: Set<CitizenId>): CompactCitizen {
  const job = jobOf(world, c);
  const biz = businessOf(world, c);
  const partnerId = c.family.partnerId;
  const partner = partnerId ? world.citizens[partnerId] ?? null : null;
  const party = partyOf(world, c.id);
  const school = schoolOf(c);
  const gang = gangOf(world, c.id);
  return {
    id: c.id, name: c.name, familyName: c.familyName, lineage: c.lineage, brain: c.brain,
    job: job ? job.title : null, employer: job ? employerName(world, job) : null,
    district: c.district, wallet: c.wallet, mood: Math.round(c.mood), reputation: Math.round(c.reputation),
    standing: c.standing, office: c.office, homeTier: c.homeTier,
    detained: isDetained(world, c), present: isPresentIn(world, c, present),
    business: biz ? biz.name : null, convictions: c.record.convictions.length, arrivedDay: c.arrivedDay,
    lifeStage: c.lifeStage, age: ageOf(world, c),
    partner: partner ? partner.name : null, partnerId: partner ? partner.id : null, married: partner ? c.family.married : false,
    householdId: c.householdId, clubs: c.clubs.length, possessions: c.possessions.length,
    portrait: portraitPath(c.id),
    repute: heldRepute(world, c.id), notice: noticeBadge(world, c),
    partyId: party ? party.id : null, party: party ? party.name : null,
    school, schoolName: school ? schoolName(school) : null,
    gangId: gang ? gang.id : null, gang: gang ? gang.name : null,
  };
}

const SORT_KEYS: readonly (keyof CompactCitizen)[] = [
  'name', 'familyName', 'lineage', 'brain', 'job', 'district', 'wallet', 'mood', 'reputation', 'standing', 'office',
  'arrivedDay', 'convictions', 'lifeStage', 'age', 'partner', 'repute', 'party', 'school', 'gang',
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

/** The row fields `?district=…&party=…` and friends narrow the register by. */
const FILTER_KEYS: Readonly<Record<string, keyof CompactCitizen>> = {
  standing: 'standing', brain: 'brain', district: 'district',
  party: 'partyId', school: 'school', gang: 'gangId', lineage: 'lineage', office: 'office',
};

/**
 * `?sort=wallet` or `?sort=-wallet`; `?standing=`, `?brain=`, `?district=`,
 * `?party=`, `?school=`, `?gang=`, `?lineage=`, `?office=` narrow the list
 * (`all` is every row); `?notice=1` keeps only citizens under a notice of
 * standing; `?present=1` only those living in the city; `?limit=N` truncates.
 */
export function citizensView(world: World, params: URLSearchParams): Record<string, unknown> {
  const present = presentSet(world);
  let rows = Object.values(world.citizens).map((c) => compactCitizen(world, c, present));
  for (const [param, key] of Object.entries(FILTER_KEYS)) {
    const wanted = params.get(param);
    if (!wanted || wanted === 'all') continue;
    rows = rows.filter((r) => String(r[key] ?? '') === wanted);
  }
  if (params.get('present') === '1' || params.get('present') === 'true') rows = rows.filter((r) => r.present);
  if (params.get('notice') === '1' || params.get('notice') === 'true') rows = rows.filter((r) => r.notice !== null);
  const sortParam = params.get('sort') ?? 'name';
  const desc = sortParam.startsWith('-');
  const key = (desc ? sortParam.slice(1) : sortParam) as keyof CompactCitizen;
  rows.sort(compareBy(SORT_KEYS.includes(key) ? key : 'name', desc ? -1 : 1));
  const limit = Number(params.get('limit'));
  if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
  return {
    citizens: rows, count: rows.length, total: Object.keys(world.citizens).length,
    underNotice: Object.values(world.standing?.notices ?? {}).filter((n) => n.status === 'open').length,
  };
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
  // Everything about a citizen is public except the four things that are not:
  // its key, its notebook, its letters home and where its agent listens.
  // Its rolled traits are not public either — nobody in Reverie is given a
  // personality to live up to, and what the city can see of a citizen is the
  // `character` read off its record (docs/PRINCIPLES.md §2). `birthTraits` is
  // the same secret at an earlier date: drift is measured from it, and it is
  // shown to nobody.
  const { apiKeyHash, callbackUrl, notes, letters, personality, birthTraits, ...rest } = c;
  void personality;
  void birthTraits;
  const job = jobOf(world, c);
  const biz = businessOf(world, c);
  const loan = c.loanId ? world.loans[c.loanId] ?? null : null;
  const cases = Object.values(world.cases)
    .filter((k) => k.defendantId === id)
    .sort((a, b) => b.filedTick - a.filedTick)
    .map((k) => ({
      id: k.id, law: k.law, lawName: offenceName(k.law), track: trackOf(k.law), severity: k.severity, status: k.status, verdict: k.verdict,
      day: Math.floor(k.filedTick / 24), triedDay: k.triedDay, sentence: k.sentence,
      appeal: k.appeal ? { filedDay: k.appeal.filedDay, result: k.appeal.result } : null,
    }));
  const ban = [...world.bans].reverse().find((b) => b.citizenId === id) ?? null;
  const guardian = c.guardianId ? world.citizens[c.guardianId] ?? null : null;
  const school = schoolOf(c);
  return {
    ...rest,
    character: characterOf(c),
    hasApiKey: apiKeyHash !== null,
    hasCallback: !!callbackUrl,
    notesCount: notes?.length ?? 0,
    lettersCount: letters?.length ?? 0,
    detained: isDetained(world, c),
    present: isPresentIn(world, c, present),
    districtName: world.districts[c.district]?.name ?? c.district,
    // Society: the raw links stay under familyLinks; family, possessions, clubs
    // and wants are resolved to names here, as the observation resolves them.
    age: ageOf(world, c),
    familyLinks: c.family,
    family: familyView(world, id, present),
    partner: partnerView(world, c, present),
    household: citizenHouseholdView(world, c, present),
    possessions: possessionsView(c),
    wants: wantsView(c),
    clubs: citizenClubsView(world, c),
    affections: affectionsView(world, c, 8),
    guardian: guardian ? { id: guardian.id, name: guardian.name } : null,
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
    // Standing and allegiance, resolved: the raw ids are already in `rest`, and
    // a stale one (a party that dissolved, a gang the Watch broke) is nothing.
    portrait: portraitPath(c.id),
    repute: heldRepute(world, c.id),
    notice: noticeBadge(world, c),
    partyName: partyOf(world, id)?.name ?? null,
    schoolName: school ? schoolName(school) : null,
    gangName: gangOf(world, id)?.name ?? null,
  };
}

/** The living population, for the CLI and tests. */
export function population(world: World): number {
  return activeCitizens(world).length;
}
