/**
 * `GET /api/culture` — what the city makes and what it does with its evenings:
 * the works and what the papers said of them, the Museum's collection, the
 * league table with its results and next fixture, both papers' front pages,
 * the share each school of thought holds, and the cafés' menus.
 *
 * Read-only. Nothing here creates a work, reviews one, or picks a team.
 */
import type { CitizenId, Happening, Work, World } from '../types.ts';
import { PAPERS, SCHOOLS } from '../types.ts';
import { DISHES, PAPER_INFO, SCHOOL_INFO } from '../data/metropolis.ts';
import { allWorks, homeName, reviewScore, topWorks } from '../culture/works.ts';
import { collection, museumValue } from '../culture/museum.ts';
import { fixtureOf, leagueSince, leagueTable } from '../culture/stadium.ts';
import { frontPage, readershipShare } from '../culture/press.ts';
import { creedLine, shares } from '../culture/schools.ts';
import { bestCafe, cafesWithMenus, dishById } from '../culture/menus.ts';
import { nameOf, personCard, personCards, portraitPath, presentSet } from './views.ts';

/** Matches kept on the Culture tab, newest first. */
export const MATCH_VIEW_LENGTH = 24;
/** Works the "what the city is talking about" rail carries. */
export const TOP_WORKS = 6;

function workView(world: World, w: Work): Record<string, unknown> {
  const creator = world.citizens[w.creatorId] ?? null;
  return {
    id: w.id, kind: w.kind, title: w.title,
    creatorId: w.creatorId, creator: creator ? creator.name : null,
    creatorPortrait: creator ? portraitPath(creator.id) : null,
    createdDay: w.createdDay, quality: Math.round(w.quality), popularity: Math.round(w.popularity),
    home: w.home, homeName: homeName(world, w),
    district: world.buildings[w.home]?.district ?? null,
    inMuseum: !!w.inMuseum,
    reviewScore: reviewScore(w),
    reviews: (w.reviews ?? []).map((r) => ({
      paper: r.paper, paperName: PAPER_INFO[r.paper]?.name ?? r.paper, score: r.score, day: r.day,
    })),
  };
}

function matchView(world: World, m: World['matches'][number]): Record<string, unknown> {
  return {
    day: m.day,
    home: m.home, homeName: world.teams?.[m.home]?.name ?? world.districts[m.home]?.name ?? m.home,
    away: m.away, awayName: world.teams?.[m.away]?.name ?? world.districts[m.away]?.name ?? m.away,
    homeGoals: m.homeGoals, awayGoals: m.awayGoals, attendance: m.attendance,
    result: m.homeGoals === m.awayGoals ? 'draw' : m.homeGoals > m.awayGoals ? 'home' : 'away',
  };
}

/** Matches on the calendar that have not been played yet. */
function fixtures(world: World): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const h of (world.happenings ?? []) as Happening[]) {
    if (h.kind !== 'match' || h.done) continue;
    const pair = fixtureOf(world, h);
    if (!pair) continue;
    out.push({
      day: h.day, hour: h.hour, label: h.label,
      home: pair.home, homeName: world.teams?.[pair.home]?.name ?? pair.home,
      away: pair.away, awayName: world.teams?.[pair.away]?.name ?? pair.away,
    });
  }
  return out.sort((a, b) => (a.day as number) - (b.day as number) || (a.hour as number) - (b.hour as number));
}

function schoolsView(world: World): Record<string, unknown> {
  const share = shares(world);
  return {
    shares: share,
    schools: SCHOOLS.map((s) => ({
      school: s, name: SCHOOL_INFO[s].name, creed: SCHOOL_INFO[s].creed, line: creedLine(world, s),
      platform: SCHOOL_INFO[s].platform, share: share[s] ?? 0,
    })),
    none: share.none ?? 0,
  };
}

function menusView(world: World): Record<string, unknown> {
  const best = bestCafe(world);
  return {
    dishes: DISHES.map((d) => ({ id: d.id, name: d.name, recipe: d.recipe, energy: d.energy, social: d.social })),
    cafes: cafesWithMenus(world).map(({ biz, menu }) => {
      const dish = dishById(menu.dish);
      return {
        businessId: biz.id, name: biz.name, district: biz.district,
        districtName: world.districts[biz.district]?.name ?? biz.district,
        ownerId: biz.ownerId, ownerName: nameOf(world, biz.ownerId),
        dish: menu.dish, dishName: dish ? dish.name : menu.dish,
        price: menu.price, quality: Math.round(menu.quality), setDay: menu.setDay,
      };
    }),
    best: best ? { businessId: best.biz.id, name: best.biz.name, dish: dishById(best.menu.dish)?.name ?? best.menu.dish } : null,
  };
}

/** `GET /api/culture`. */
export function cultureView(world: World): Record<string, unknown> {
  const present: Set<CitizenId> = presentSet(world);
  const works = allWorks(world);
  const held = collection(world);
  const matches = [...(world.matches ?? [])].sort((a, b) => b.day - a.day).slice(0, MATCH_VIEW_LENGTH);
  return {
    works: {
      count: works.length,
      top: topWorks(world, TOP_WORKS).map((w) => workView(world, w)),
      all: works
        .slice()
        .sort((a, b) => b.createdDay - a.createdDay || a.id.localeCompare(b.id))
        .map((w) => workView(world, w)),
    },
    museum: {
      count: held.length, value: museumValue(world),
      collection: held.map((w) => workView(world, w)),
    },
    league: {
      table: leagueTable(world),
      since: leagueSince(world),
      teams: Object.values(world.teams ?? {})
        .filter((t): t is NonNullable<typeof t> => !!t)
        .map((t) => ({
          district: t.district, name: t.name, wins: t.wins, losses: t.losses, draws: t.draws,
          size: t.players.length, players: personCards(world, t.players, present, 16),
        })),
      matches: matches.map((m) => matchView(world, m)),
      fixtures: fixtures(world),
    },
    papers: {
      readership: readershipShare(world),
      pages: PAPERS.map((p) => {
        const page = frontPage(world, p);
        return {
          paper: p, name: PAPER_INFO[p]?.name ?? p, slant: PAPER_INFO[p]?.slant ?? '',
          day: page?.day ?? null, headlines: page?.headlines ?? [], treasuryReport: page?.treasuryReport ?? null,
        };
      }),
    },
    schools: schoolsView(world),
    menus: menusView(world),
    monuments: (world.monuments ?? []).map((m) => ({
      id: m.id, day: m.day, inscription: m.inscription, honoree: personCard(world, m.honoreeId, present),
    })),
  };
}
