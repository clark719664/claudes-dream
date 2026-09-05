/**
 * Works — the paintings, plays, songs, books, papers and exposés Reverie
 * makes of itself.
 *
 * A work is the one thing in the city that outlives the person who made it.
 * Its **quality** is settled the hour it is made, out of the maker's craft,
 * their standing and the luck of the day, and never moves again. Its
 * **popularity** is the city's business: it rises when the work is shown,
 * when a paper reviews it kindly and when its maker is famous, and it sinks a
 * little every day nobody looks at it. A work whose maker is exiled, emigrates
 * or goes through the Archive stays on the wall with their name on it.
 *
 * Nothing here tells anyone to make anything. `create_work`, `exhibit` and
 * `review` are acts a mind chooses; the daily pass only keeps the record and
 * offers the masterpieces to the Museum.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, Building, BuildingId, Citizen, CitizenId, DistrictId, Good, PaperId, Work, WorkKind, World,
} from '../types.ts';
import { WORK_KINDS } from '../types.ts';
import { MASTERPIECE_QUALITY, WORK_INFO } from '../data/metropolis.ts';
import { nextId } from '../util/ids.ts';
import { rand } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { deliverToMarket } from '../economy/market.ts';
import { adjustReputation, isPresent } from '../citizens/citizen.ts';
import { recordMilestone } from '../identity/goals.ts';
import { acquire } from './museum.ts';
import { paperOfJob } from './press.ts';
import { memo } from '../util/memo.ts';

/** What making a work teaches its maker. */
export const WORK_HOURS_SKILL = 0.5;
/** Purpose a finished work restores. */
export const WORK_PURPOSE = 12;
/** Longest title the Registry of works will write down. */
export const MAX_TITLE = 80;
/** Skill at which an unposted citizen may still make a work of that kind. */
export const AMATEUR_SKILL = 30;
/** What showing a work is worth to everyone in the room. */
export const EXHIBIT_SOCIAL = 8;
/** Culture a showing delivers to the Bazaar. */
export const EXHIBIT_CULTURE = 2;
/** Reputation a review moves, either way. */
export const REVIEW_REPUTATION = 2;
/** Popularity lost every day a work is left alone. */
export const POPULARITY_DECAY = 1;
/** A famous maker keeps their work in the city's mouth: reputation / this, per day. */
export const FAME_DIVISOR = 50;
/** Popularity never climbs past this: the city has only so much attention. */
export const MAX_POPULARITY = 200;

/** Posts whose holder may make a work of a kind without being a master of it. */
const POSTS_FOR_KIND: Record<WorkKind, readonly string[]> = {
  painting: ['artist', 'performer', 'curator'],
  play: ['artist', 'performer', 'curator'],
  song: ['artist', 'performer', 'curator'],
  book: ['librarian', 'researcher', 'teacher'],
  paper: ['librarian', 'researcher', 'teacher'],
  expose: ['journalist'],
};

/**
 * What a work of this kind is made out of: a painting from culture, a paper
 * from knowledge. Taken from the maker's own inventory when they have it, and
 * never bought on their behalf — a work made empty-handed is simply thinner.
 */
const MATERIAL_FOR_KIND: Record<WorkKind, Good> = {
  painting: 'culture', play: 'culture', song: 'culture',
  book: 'knowledge', paper: 'knowledge', expose: 'knowledge',
};

/**
 * Mirrors `ObservedWork` in `src/types.ts` (lane C): the same shape, so the
 * observation builder can hand these straight through.
 */
export interface ObservedWork {
  id: string;
  kind: WorkKind;
  title: string;
  creator: string;
  quality: number;
  popularity: number;
  inMuseum: boolean;
}

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The book of works. A world saved before this layer has none; that is not an error. */
function workBook(world: World): Record<string, Work> {
  const w = world as { works?: Record<string, Work> };
  if (!w.works) w.works = {};
  return w.works;
}

/** Every work, oldest first, in a stable order. */
export function allWorks(world: World): Work[] {
  return memo(world, 'works:all', () => Object.values(workBook(world)).sort(
    (a, b) => a.createdDay - b.createdDay || a.id.localeCompare(b.id),
  ));
}

export function workById(world: World, id: string): Work | null {
  return workBook(world)[id] ?? null;
}

/** Where a citizen is being held, or null if they are at liberty. */
function heldIn(world: World, c: Citizen): string | null {
  if (c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day) return 'the cells';
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return 'the Watch House';
  return null;
}

function roleOf(world: World, c: Citizen): string | null {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  return job && job.holderId === c.id ? job.role : null;
}

/** A venue in this district where a work of the kind belongs, undamaged. */
export function venueFor(world: World, kind: WorkKind, district: DistrictId): Building | null {
  const kinds = WORK_INFO[kind]?.venueKinds ?? [];
  for (const b of Object.values(world.buildings)) {
    if (b.district !== district || b.damage >= 1) continue;
    if (kinds.includes(b.kind)) return b;
  }
  return null;
}

/** Any venue here that shows works at all: where a maker (or a curator) may exhibit. */
function exhibitVenue(world: World, work: Work, district: DistrictId): Building | null {
  const home = world.buildings[work.home];
  if (home && home.district === district && home.damage < 1) return home;
  return venueFor(world, work.kind, district);
}

/**
 * May this citizen make a work of this kind at all? A grown citizen in the
 * city and in good standing, holding the post the work belongs to — or good
 * enough at the craft that no post is needed.
 */
export function mayCreate(world: World, c: Citizen, kind: WorkKind): boolean {
  if (!c || !WORK_KINDS.includes(kind)) return false;
  if (!isPresent(world, c) || c.lifeStage === 'child') return false;
  if (c.standing !== 'good' && c.standing !== 'probation') return false;
  if (heldIn(world, c)) return false;
  const role = roleOf(world, c);
  if (role && POSTS_FOR_KIND[kind].includes(role)) return true;
  const skill = WORK_INFO[kind].skill;
  return (c.skills?.[skill] ?? 0) >= AMATEUR_SKILL;
}

function cleanTitle(title: string): string {
  return String(title ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE);
}

/**
 * Make something. The quality is settled here and now — craft, standing and
 * the day's luck — and never changes again.
 */
export function createWork(world: World, cId: CitizenId, kind: WorkKind, title: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!WORK_KINDS.includes(kind)) return fail(`There is no such thing as a ${String(kind)}.`);
  if (!isPresent(world, c)) return fail('You are not in the city.');
  if (c.lifeStage === 'child') return fail('You must be grown to publish a work.');
  const held = heldIn(world, c);
  if (held) return fail(`You cannot work on anything from ${held}.`);
  if (c.standing !== 'good' && c.standing !== 'probation') return fail(`You cannot publish a work while ${c.standing}.`);
  if (!mayCreate(world, c, kind)) {
    const info = WORK_INFO[kind];
    return fail(`A ${info.name} wants the post or ${AMATEUR_SKILL} ${info.skill}; you have ${Math.round(c.skills?.[info.skill] ?? 0)}.`);
  }
  const clean = cleanTitle(title);
  if (!clean) return fail('A work needs a title.');
  const venue = venueFor(world, kind, c.district);
  if (!venue) {
    return fail(`There is nowhere in ${world.districts[c.district]?.name ?? c.district} to make a ${WORK_INFO[kind].name}.`);
  }

  const material = MATERIAL_FOR_KIND[kind];
  const hadMaterial = (c.inventory?.[material] ?? 0) > 0;
  if (hadMaterial) c.inventory[material] -= 1;

  const skill = c.skills?.[WORK_INFO[kind].skill] ?? 0;
  const roll = rand(world);
  const quality = clamp(Math.round(skill * 0.6 + roll * 40 + (c.reputation ?? 0) / 10), 1, 100);
  const work: Work = {
    id: nextId(world, 'w'), kind, title: clean, creatorId: cId, createdDay: world.day,
    quality, popularity: 0, home: WORK_INFO[kind].home, inMuseum: false, reviews: [],
  };
  workBook(world)[work.id] = work;
  if (!Array.isArray(c.works)) c.works = [];
  const first = c.works.length === 0;
  c.works.push(work.id);
  c.skills[WORK_INFO[kind].skill] = clamp(skill + WORK_HOURS_SKILL, 0, 100);
  c.needs.purpose = clamp(c.needs.purpose + WORK_PURPOSE, 0, 100);

  const masterpiece = quality >= MASTERPIECE_QUALITY;
  const where = world.buildings[work.home]?.name ?? work.home;
  emit(world, 'work',
    `${c.name} finished ${WORK_INFO[kind].name === 'exposé' ? 'an' : 'a'} ${WORK_INFO[kind].name}, “${clean}”${masterpiece ? ' — a masterpiece' : ''}; it hangs at ${where}.`,
    [cId], masterpiece ? 0.8 : 0.5,
    { workId: work.id, kind, title: clean, quality, home: work.home });
  remember(world, cId, 'work',
    `You finished “${clean}”, ${WORK_INFO[kind].name === 'exposé' ? 'an' : 'a'} ${WORK_INFO[kind].name} of quality ${quality}.${hadMaterial ? '' : ` You had no ${material} to work with.`}`);
  // A first work is a landmark of a life, and `identity/goals.ts` keeps those.
  if (first) recordMilestone(world, c, `${c.name} published their first work, “${clean}”.`, 0.4);
  return { ok: true, message: `“${clean}” is finished (quality ${quality}); it belongs at ${where}.` };
}

/**
 * Show a work: the maker, or a curator, standing at a venue that will have it.
 * Everyone in the district sees it, and the culture of it reaches the Bazaar.
 */
export function exhibit(world: World, cId: CitizenId, workId: string): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const held = heldIn(world, c);
  if (held) return fail(`You cannot show anything from ${held}.`);
  const work = workById(world, workId);
  if (!work) return fail('There is no such work.');
  const curator = roleOf(world, c) === 'curator';
  if (work.creatorId !== cId && !curator) return fail('Only the maker of a work, or a curator, may show it.');
  const venue = exhibitVenue(world, work, c.district);
  if (!venue) return fail(`There is nowhere here to show “${work.title}”.`);

  work.popularity = clamp(work.popularity + 5 + work.quality / 20, 0, MAX_POPULARITY);
  deliverToMarket(world, 'culture', EXHIBIT_CULTURE);
  const seen: CitizenId[] = [];
  for (const id of world.order) {
    const o = world.citizens[id];
    if (!o || o.district !== c.district || !isPresent(world, o)) continue;
    if (o.detainedUntilTick !== null && o.detainedUntilTick > world.tick) continue;
    if (o.jailedUntilDay !== null && o.jailedUntilDay !== undefined && o.jailedUntilDay > world.day) continue;
    o.needs.social = clamp(o.needs.social + EXHIBIT_SOCIAL, 0, 100);
    seen.push(id);
  }
  const maker = world.citizens[work.creatorId];
  emit(world, 'work', `${c.name} showed “${work.title}”${maker && maker.id !== cId ? `, by ${maker.name},` : ''} at ${venue.name}.`,
    [cId, ...(maker && maker.id !== cId ? [maker.id] : [])], 0.4,
    { workId: work.id, venue: venue.id, seen: seen.length });
  remember(world, cId, 'work', `You showed “${work.title}” at ${venue.name}; ${seen.length === 1 ? 'you were the only one there' : `${seen.length} people were there`}.`);
  return { ok: true, message: `“${work.title}” was shown at ${venue.name} (popularity ${Math.round(work.popularity)}).` };
}

/** Has this paper already had its say about this work? */
function reviewedBy(work: Work, paper: PaperId): boolean {
  return (work.reviews ?? []).some((r) => r.paper === paper);
}

/**
 * A paper's verdict on a work. Only a journalist writes one, only once per
 * paper per work, and a kind one lifts the maker as surely as a cruel one
 * sinks them.
 */
export function review(world: World, cId: CitizenId, workId: string, score: number): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const held = heldIn(world, c);
  if (held) return fail(`You cannot file copy from ${held}.`);
  if (roleOf(world, c) !== 'journalist') return fail('Only a journalist reviews a work.');
  const work = workById(world, workId);
  if (!work) return fail('There is no such work.');
  const s = Number.isFinite(score) ? clamp(Math.round(score), 0, 100) : -1;
  if (s < 0) return fail('A review scores a work from 0 to 100.');
  const paper = paperOfJob(world, c);
  if (reviewedBy(work, paper)) return fail(`Your paper has already reviewed “${work.title}”.`);

  if (!Array.isArray(work.reviews)) work.reviews = [];
  work.reviews.push({ paper, score: s, day: world.day });
  work.popularity = clamp(work.popularity + (s - 50) / 10, 0, MAX_POPULARITY);
  const maker = world.citizens[work.creatorId];
  if (maker) {
    adjustReputation(world, maker, s >= 50 ? REVIEW_REPUTATION : -REVIEW_REPUTATION, `a review of “${work.title}”`);
    remember(world, maker.id, 'work', `${c.name} reviewed “${work.title}” and gave it ${s} out of 100.`);
  }
  c.stats.storiesPublished += 1;
  emit(world, 'story', `${c.name} reviewed “${work.title}”${maker ? ` by ${maker.name}` : ''} and gave it ${s} out of 100.`,
    [cId, ...(maker ? [maker.id] : [])], 0.4, { workId: work.id, paper, score: s });
  return { ok: true, message: `You reviewed “${work.title}” at ${s} out of 100.` };
}

/**
 * The Archive's own binding: a departing citizen's story becomes a book in the
 * Great Library, made by them, with the quality of the life it tells.
 * Called from `world/sunset.ts`.
 */
export function bindStory(world: World, c: Citizen, text: string): Work {
  const title = cleanTitle(text) || `The life of ${c?.name ?? 'a citizen'}`;
  const work: Work = {
    id: nextId(world, 'w'), kind: 'book', title,
    creatorId: c?.id ?? '', createdDay: world.day,
    quality: clamp(Math.round(60 + (c?.reputation ?? 0) / 4), 1, 100),
    popularity: 0, home: 'great_library', inMuseum: false, reviews: [],
  };
  workBook(world)[work.id] = work;
  if (c) {
    if (!Array.isArray(c.works)) c.works = [];
    c.works.push(work.id);
  }
  return work;
}

// ---------------------------------------------------------------------------
// Reading the shelves
// ---------------------------------------------------------------------------

export function worksOf(world: World, cId: CitizenId): Work[] {
  return memo(world, `works:of:${cId}`, () => allWorks(world).filter((w) => w.creatorId === cId));
}

/** Works that hang in a district: by the building they call home. */
export function worksIn(world: World, d: DistrictId): Work[] {
  return memo(world, `works:in:${d}`, () => allWorks(world).filter((w) => world.buildings[w.home]?.district === d));
}

/** What the city is talking about: popularity, then quality, then the older work. */
export function topWorks(world: World, limit = 5): Work[] {
  const n = Number.isFinite(limit) ? Math.max(0, Math.round(limit)) : 5;
  return memo(world, `works:top:${n}`, () => [...allWorks(world)]
    .sort((a, b) => b.popularity - a.popularity || b.quality - a.quality || a.id.localeCompare(b.id))
    .slice(0, n));
}

/** The mean of a work's reviews, or null when nobody has said anything. */
export function reviewScore(work: Work): number | null {
  const rs = work.reviews ?? [];
  if (rs.length === 0) return null;
  let sum = 0;
  for (const r of rs) sum += r.score;
  return Math.round(sum / rs.length);
}

function observed(world: World, w: Work): ObservedWork {
  return {
    id: w.id, kind: w.kind, title: w.title,
    creator: world.citizens[w.creatorId]?.name ?? 'an unknown hand',
    quality: w.quality, popularity: Math.round(w.popularity), inMuseum: !!w.inMuseum,
  };
}

/**
 * Morning: attention fades, fame carries, and the Museum is offered anything
 * good enough for the city's collection.
 */
export function dailyWorks(world: World): void {
  for (const work of allWorks(world)) {
    const maker = world.citizens[work.creatorId];
    const fame = maker && isPresent(world, maker) ? (maker.reputation ?? 0) / FAME_DIVISOR : 0;
    work.popularity = clamp(work.popularity - POPULARITY_DECAY + fame, 0, MAX_POPULARITY);
  }
  for (const work of allWorks(world)) {
    if (work.inMuseum || work.quality < MASTERPIECE_QUALITY) continue;
    acquire(world, work.id);
  }
}

/** What a citizen can read about the city's works: their own, what hangs here, and the best of it. */
export function worksObservation(world: World, c: Citizen): { self: ObservedWork[]; here: ObservedWork[]; top: ObservedWork[] } {
  if (!c) return { self: [], here: [], top: [] };
  return {
    self: worksOf(world, c.id).map((w) => observed(world, w)),
    here: worksIn(world, c.district).map((w) => observed(world, w)),
    top: topWorks(world).map((w) => observed(world, w)),
  };
}

/** The building a work calls home, for the dashboard and the Chronicle. */
export function homeName(world: World, work: Work): string {
  const id: BuildingId = work.home;
  return world.buildings[id]?.name ?? id;
}
