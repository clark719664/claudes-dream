/**
 * `GET /api/culture` — what the city makes and what it does with its evenings:
 * the works and what the papers said of them, the Museum's collection, the
 * league table with its results, fixtures and past champions, both papers'
 * front pages, the share each school of thought holds, and the cafés' menus.
 *
 * Read-only. Nothing here creates a work, reviews one, or picks a team.
 */
import type { CitizenId, DistrictId, Happening, Match, PaperId, Work, World, WorkKind } from '../types.ts';
import { PAPERS, SCHOOLS, WORK_KINDS } from '../types.ts';
import { DISHES, PAPER_INFO, SCHOOL_INFO, WORK_INFO } from '../data/metropolis.ts';
import { allWorks, homeName, reviewScore, topWorks } from '../culture/works.ts';
import { MUSEUM_BUILDING, collection, curatorOnDuty, museumValue } from '../culture/museum.ts';
import { fixtureOf, leagueSince, leagueTable } from '../culture/stadium.ts';
import { frontPage, paperReading, readershipShare } from '../culture/press.ts';
import { creedLine, schoolOf, shares } from '../culture/schools.ts';
import { bestCafe, cafesWithMenus, dishById, mealCost } from '../culture/menus.ts';
import { nameOf, personCard, personCards, portraitPath, presentSet } from './views.ts';

/** Matches kept on the Culture tab, newest first. */
export const MATCH_VIEW_LENGTH = 24;
/** Works the "what the city is talking about" rail carries. */
export const TOP_WORKS = 6;
/** Back issues listed under each paper's front page. */
export const BACK_ISSUES = 5;
/** Faces shown for one school of thought. */
export const SCHOOL_FACES = 24;
/** Championships kept on the honours board, newest first. */
export const CHAMPIONS_LENGTH = 8;

type School = (typeof SCHOOLS)[number];

function workView(world: World, w: Work, present: Set<CitizenId>): Record<string, unknown> {
  return {
    id: w.id, kind: w.kind, kindName: WORK_INFO[w.kind]?.name ?? w.kind, title: w.title,
    // `creator` stays the plain name the API has always sent; `creatorCard`
    // is the same citizen with a face, for anything that draws one.
    creatorId: w.creatorId, creator: nameOf(world, w.creatorId),
    creatorPortrait: world.citizens[w.creatorId] ? portraitPath(w.creatorId) : null,
    creatorCard: personCard(world, w.creatorId, present),
    createdDay: w.createdDay, quality: Math.round(w.quality), popularity: Math.round(w.popularity),
    home: w.home, homeName: homeName(world, w),
    district: world.buildings[w.home]?.district ?? null,
    districtName: world.districts[world.buildings[w.home]?.district as DistrictId]?.name ?? null,
    inMuseum: !!w.inMuseum,
    reviewScore: reviewScore(w),
    reviews: (w.reviews ?? []).map((r) => ({
      paper: r.paper, paperName: PAPER_INFO[r.paper]?.name ?? r.paper, score: r.score, day: r.day,
    })),
  };
}

function worksView(world: World, present: Set<CitizenId>): Record<string, unknown> {
  const works = allWorks(world);
  const counts: Record<string, number> = {};
  let reviewed = 0;
  for (const w of works) {
    counts[w.kind] = (counts[w.kind] ?? 0) + 1;
    if ((w.reviews ?? []).length) reviewed++;
  }
  return {
    count: works.length,
    reviewed,
    inMuseum: works.filter((w) => w.inMuseum).length,
    creators: new Set(works.map((w) => w.creatorId)).size,
    kinds: (WORK_KINDS as readonly WorkKind[])
      .map((k) => ({ kind: k, name: WORK_INFO[k]?.name ?? k, count: counts[k] ?? 0 }))
      .filter((k) => k.count > 0),
    top: topWorks(world, TOP_WORKS).map((w) => workView(world, w, present)),
    // Newest first: the panel sorts by whichever column the reader picked.
    all: works
      .slice()
      .sort((a, b) => b.createdDay - a.createdDay || a.id.localeCompare(b.id))
      .map((w) => workView(world, w, present)),
  };
}

// ------------------------------------------------------------------ league

function teamName(world: World, d: DistrictId): string {
  return world.teams?.[d]?.name ?? world.districts[d]?.name ?? d;
}

function matchView(world: World, m: Match): Record<string, unknown> {
  return {
    day: m.day,
    home: m.home, homeName: teamName(world, m.home),
    away: m.away, awayName: teamName(world, m.away),
    homeGoals: m.homeGoals, awayGoals: m.awayGoals, attendance: m.attendance,
    result: m.homeGoals === m.awayGoals ? 'draw' : m.homeGoals > m.awayGoals ? 'home' : 'away',
  };
}

/** Matches on the calendar that have not been played yet, earliest first. */
function fixtures(world: World): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const h of (world.happenings ?? []) as Happening[]) {
    if (h.kind !== 'match' || h.done) continue;
    const pair = fixtureOf(world, h);
    if (!pair) continue;
    out.push({
      day: h.day, hour: h.hour, label: h.label,
      home: pair.home, homeName: teamName(world, pair.home),
      away: pair.away, awayName: teamName(world, pair.away),
      district: h.district, districtName: world.districts[h.district]?.name ?? h.district,
    });
  }
  return out.sort((a, b) => (a.day as number) - (b.day as number) || (a.hour as number) - (b.hour as number));
}

/** Goals for and against each side, over the season the table covers. */
function goalTallies(world: World, since: number): Map<DistrictId, { for: number; against: number }> {
  const tally = new Map<DistrictId, { for: number; against: number }>();
  const bump = (d: DistrictId, scored: number, conceded: number) => {
    const row = tally.get(d) ?? { for: 0, against: 0 };
    row.for += scored;
    row.against += conceded;
    tally.set(d, row);
  };
  for (const m of world.matches ?? []) {
    if (m.day < since) continue;
    bump(m.home, m.homeGoals, m.awayGoals);
    bump(m.away, m.awayGoals, m.homeGoals);
  }
  return tally;
}

/** Every championship the city has crowned, newest first. */
function champions(world: World): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = world.events.length - 1; i >= 0 && out.length < CHAMPIONS_LENGTH; i--) {
    const e = world.events[i];
    if (e.kind !== 'match' || !e.data || e.data.points === undefined || !e.data.district) continue;
    const district = e.data.district as DistrictId;
    out.push({
      day: e.day, district, name: teamName(world, district),
      points: e.data.points ?? null, played: e.data.played ?? null, prize: e.data.prize ?? 0, text: e.text,
    });
  }
  return out;
}

function leagueView(world: World, present: Set<CitizenId>): Record<string, unknown> {
  const since = leagueSince(world);
  const goals = goalTallies(world, since);
  const book = world.teams ?? {};
  return {
    since,
    table: leagueTable(world).map((row, i) => {
      const t = book[row.district];
      const g = goals.get(row.district) ?? { for: 0, against: 0 };
      return {
        rank: i + 1, district: row.district, name: row.name, played: row.played, points: row.points,
        wins: t?.wins ?? 0, draws: t?.draws ?? 0, losses: t?.losses ?? 0,
        goalsFor: g.for, goalsAgainst: g.against, goalDiff: g.for - g.against,
        size: t?.players.length ?? 0,
      };
    }),
    teams: Object.values(book)
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({
        district: t.district, name: t.name, wins: t.wins, losses: t.losses, draws: t.draws,
        districtName: world.districts[t.district]?.name ?? t.district,
        size: t.players.length, players: personCards(world, t.players, present, 16),
      })),
    matches: [...(world.matches ?? [])]
      .sort((a, b) => b.day - a.day)
      .slice(0, MATCH_VIEW_LENGTH)
      .map((m) => matchView(world, m)),
    fixtures: fixtures(world),
    champions: champions(world),
  };
}

// ------------------------------------------------------------------ papers

function papersView(world: World): Record<string, unknown> {
  const readership = readershipShare(world);
  const shelf = world.chronicle ?? [];
  return {
    readership,
    pages: PAPERS.map((p: PaperId) => {
      const page = frontPage(world, p);
      const mine = shelf.filter((e) => ((e as { paper?: PaperId }).paper ?? 'chronicle') === p);
      return {
        paper: p, name: PAPER_INFO[p]?.name ?? p, slant: PAPER_INFO[p]?.slant ?? '',
        line: PAPER_INFO[p]?.line ?? null,
        share: readership[p] ?? 0,
        reading: paperReading(world, p),
        editions: mine.length,
        day: page?.day ?? null, headlines: page?.headlines ?? [], treasuryReport: page?.treasuryReport ?? null,
        backIssues: mine
          .slice(0, -1)
          .reverse()
          .slice(0, BACK_ISSUES)
          .map((e) => ({ day: e.day, headline: e.headlines[0] ?? '' })),
      };
    }),
  };
}

// ----------------------------------------------------------------- schools

function schoolsView(world: World, present: Set<CitizenId>): Record<string, unknown> {
  const share = shares(world);
  const held = new Map<string, CitizenId[]>();
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || c.standing === 'exiled' || c.lifeStage === 'child') continue;
    const key = schoolOf(c) ?? 'none';
    const list = held.get(key) ?? [];
    list.push(c.id);
    held.set(key, list);
  }
  return {
    shares: share,
    schools: (SCHOOLS as readonly School[]).map((s) => {
      const ids = held.get(s) ?? [];
      return {
        school: s, name: SCHOOL_INFO[s].name, creed: SCHOOL_INFO[s].creed, line: creedLine(world, s),
        platform: SCHOOL_INFO[s].platform, hobbies: SCHOOL_INFO[s].hobbies,
        share: share[s] ?? 0, count: ids.length,
        members: personCards(world, ids, present, SCHOOL_FACES),
      };
    }),
    none: share.none ?? 0,
    unaffiliated: (held.get('none') ?? []).length,
  };
}

// ------------------------------------------------------------------ menus

function menusView(world: World): Record<string, unknown> {
  const best = bestCafe(world);
  const served = new Map<string, number>();
  const cafes = cafesWithMenus(world).map(({ biz, menu }) => {
    const dish = dishById(menu.dish);
    served.set(menu.dish, (served.get(menu.dish) ?? 0) + 1);
    return {
      businessId: biz.id, name: biz.name, district: biz.district,
      districtName: world.districts[biz.district]?.name ?? biz.district,
      ownerId: biz.ownerId, ownerName: nameOf(world, biz.ownerId),
      dish: menu.dish, dishName: dish ? dish.name : menu.dish,
      energy: dish?.energy ?? null, social: dish?.social ?? null,
      price: menu.price, quality: Math.round(menu.quality), setDay: menu.setDay,
      stale: world.day - menu.setDay,
    };
  });
  return {
    mealCost: mealCost(world),
    dishes: DISHES.map((d) => ({
      id: d.id, name: d.name, recipe: d.recipe, energy: d.energy, social: d.social,
      servedBy: served.get(d.id) ?? 0,
    })),
    cafes: cafes.sort((a, b) => b.quality - a.quality || a.price - b.price),
    best: best ? { businessId: best.biz.id, name: best.biz.name, dish: dishById(best.menu.dish)?.name ?? best.menu.dish } : null,
  };
}

/** `GET /api/culture`. */
export function cultureView(world: World): Record<string, unknown> {
  const present: Set<CitizenId> = presentSet(world);
  const held = collection(world);
  const museum = world.buildings[MUSEUM_BUILDING] ?? null;
  return {
    works: worksView(world, present),
    museum: {
      count: held.length, value: museumValue(world), curatorOnDuty: curatorOnDuty(world),
      name: museum?.name ?? 'The Museum',
      district: museum?.district ?? null,
      districtName: museum ? world.districts[museum.district]?.name ?? museum.district : null,
      collection: held
        .slice()
        .sort((a, b) => b.quality - a.quality || a.id.localeCompare(b.id))
        .map((w) => workView(world, w, present)),
    },
    league: leagueView(world, present),
    papers: papersView(world),
    schools: schoolsView(world, present),
    menus: menusView(world),
    monuments: (world.monuments ?? []).map((m) => ({
      id: m.id, day: m.day, inscription: m.inscription, honoree: personCard(world, m.honoreeId, present),
    })),
  };
}
