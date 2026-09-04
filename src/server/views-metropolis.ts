/**
 * The metropolis views: the city's front page and the new blocks the older
 * endpoints gained — parties and approval on the Government, juries, advocates,
 * investigations, the cells and the gangs on the Court, property, shares, gigs,
 * the Outer market and the Reserve on the Economy, and rumours, feuds,
 * mentorships and the Commons feed on Society.
 *
 * Read-only projections, like every other view: nothing here emits an event,
 * moves a lumen, or decides anything. Observers watch (docs/PRINCIPLES.md §1),
 * and nothing private — a note, a letter, a key — is ever put on a page.
 */
import type {
  Case, CitizenId, Disaster, Gang, Investigation, PaperId, Proposal, World,
} from '../types.ts';
import { PAPERS } from '../types.ts';
import { PAPER_INFO, SEASON_NAMES, WEATHER_NAMES } from '../data/metropolis.ts';
import { LAWS } from '../data/laws.ts';
import { epithet } from '../identity/biography.ts';
import { describeSky } from '../world/seasons.ts';
import { activeDisasters } from '../world/disasters.ts';
import { openDistricts } from '../world/growth.ts';
import { currentEra } from '../world/history.ts';
import { isFestivalToday, nextFestival, weekday, weekdayName } from '../society/calendar.ts';
import { cityApproval } from '../politics/approval.ts';
import { coalition, majorityParty, manifestoOf } from '../politics/parties.ts';
import { keptShare, platformInWords, promisesOf, PROMISE_WORDS } from '../politics/promises.ts';
import { liveSignatures, referendumFor, signaturesNeeded } from '../politics/referendums.ts';
import { hasMajority, meanWage } from '../politics/unions.ts';
import { activeDecrees } from '../politics/decrees.ts';
import { leversObservation, reserveTarget } from '../markets/levers.ts';
import { touristsToday } from '../markets/outer.ts';
import { leagueTable } from '../culture/stadium.ts';
import { frontPage } from '../culture/press.ts';
import { advocateFor } from '../government/advocates.ts';
import { juryTally, seatedJurors } from '../government/jury.ts';
import { openInvestigations } from '../government/investigations.ts';
import { daysLeft, jailCells, jailRoster, overcrowded } from '../government/jail.ts';
import { gangsView } from '../government/gangs.ts';
import { clockText, isPresentIn, nameOf, personCard, personCards, portraitPath, presentSet } from './views.ts';
import { happeningsView } from './views-society.ts';

/** Days of the Treasury series the front page draws. */
export const CITY_SPARK_DAYS = 30;
/** Rows of the league table on the front page. */
export const LEAGUE_TOP = 3;
/** Headlines quoted from a paper's front page. */
export const FRONT_PAGE_HEADLINES = 4;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function disasterView(world: World, d: Disaster): Record<string, unknown> {
  return {
    kind: d.kind, day: d.day, district: d.district,
    districtName: d.district ? world.districts[d.district]?.name ?? d.district : null,
    severity: round2(d.severity), resolvedDay: d.resolvedDay,
  };
}

// ------------------------------------------------------------- the front page

/** The loudest thing the city did today: the heaviest event, latest wins a tie. */
function leadStory(world: World): Record<string, unknown> | null {
  let best: (typeof world.events)[number] | null = null;
  for (let i = world.events.length - 1; i >= 0; i--) {
    const e = world.events[i];
    if (e.day !== world.day) break;
    if (!best || e.weight > best.weight) best = e;
  }
  const chosen = best ?? world.events[world.events.length - 1] ?? null;
  if (!chosen) return null;
  const present = presentSet(world);
  return {
    tick: chosen.tick, day: chosen.day, kind: chosen.kind, text: chosen.text, weight: chosen.weight,
    who: personCards(world, chosen.actors, present, 4),
  };
}

function paperView(world: World, paper: PaperId): Record<string, unknown> {
  const info = PAPER_INFO[paper];
  const page = frontPage(world, paper);
  return {
    paper, name: info?.name ?? paper, slant: info?.slant ?? '',
    day: page?.day ?? null,
    headline: page?.headlines?.[0] ?? null,
    headlines: (page?.headlines ?? []).slice(0, FRONT_PAGE_HEADLINES),
    treasuryReport: page?.treasuryReport ?? null,
  };
}

/**
 * `GET /api/city` — the day as the city would print it: the sky, the calendar,
 * who is in the Mayor's chair and what the city makes of them, the Treasury's
 * last thirty days, the top of the league, both papers' leads, today's
 * happenings, where everyone is, and what is going wrong.
 */
export function cityView(world: World): Record<string, unknown> {
  const present = presentSet(world);
  const living = Object.values(world.citizens).filter((c) => isPresentIn(world, c, present));
  const g = world.government;
  const season = world.season ?? 'bloom';
  const weather = world.weather ?? 'clear';
  const festival = isFestivalToday(world);
  const approval = cityApproval(world);
  const open = openDistricts(world);
  const mayor = g.mayorId ? world.citizens[g.mayorId] ?? null : null;
  const byDistrict: Record<string, number> = {};
  for (const d of open) byDistrict[d] = 0;
  for (const c of living) byDistrict[c.district] = (byDistrict[c.district] ?? 0) + 1;
  const series = world.stats.slice(-CITY_SPARK_DAYS);
  const era = currentEra(world);
  const t = world.treasury;

  return {
    clock: {
      tick: world.tick, day: world.day, hour: world.hour, text: clockText(world),
      weekday: weekday(world), weekdayName: weekdayName(world.day),
    },
    season, seasonName: SEASON_NAMES[season] ?? season,
    weather, weatherName: WEATHER_NAMES[weather] ?? weather,
    sky: describeSky(world),
    year: num(world.year), cycle: g.cycle,
    era: era ? { cycle: era.cycle, name: era.name, mayorId: era.mayorId, fromDay: era.fromDay } : null,
    festival: festival ? { name: festival.name, hour: festival.hour } : null,
    nextFestival: nextFestival(world),
    population: living.length,
    populationByDistrict: byDistrict,
    openDistricts: open,
    mayor: mayor ? {
      ...personCard(world, mayor.id, present),
      epithet: epithet(world, mayor),
      approval: approval.mayor,
      promisesKept: keptShare(world, mayor.id),
    } : null,
    approval,
    council: g.council.map((id) => personCard(world, id, present)).filter((c) => c !== null),
    treasury: {
      balance: t.balance, revenueToday: t.revenueToday, spendToday: t.spendToday,
      reserveTarget: reserveTarget(world),
      series: series.map((s) => ({ day: s.day, treasury: s.treasury, priceIndex: s.priceIndex, population: s.population })),
    },
    league: leagueTable(world).slice(0, LEAGUE_TOP),
    papers: PAPERS.map((p) => paperView(world, p)),
    lead: leadStory(world),
    happenings: (happeningsView(world, present).today as Record<string, unknown>[]),
    disasters: activeDisasters(world).map((d) => disasterView(world, d)),
  };
}

/** What `/api/map` gained: open districts, tram lines, the sky and who is where. */
export function mapExtras(world: World): Record<string, unknown> {
  const present = presentSet(world);
  const byDistrict: Record<string, number> = {};
  for (const d of openDistricts(world)) byDistrict[d] = 0;
  for (const c of Object.values(world.citizens)) {
    if (!isPresentIn(world, c, present)) continue;
    byDistrict[c.district] = (byDistrict[c.district] ?? 0) + 1;
  }
  const season = world.season ?? 'bloom';
  const weather = world.weather ?? 'clear';
  return {
    openDistricts: openDistricts(world),
    trams: (world.trams ?? []).map((t) => [t[0], t[1]]),
    weather, weatherName: WEATHER_NAMES[weather] ?? weather,
    season, seasonName: SEASON_NAMES[season] ?? season,
    hour: world.hour,
    populationByDistrict: byDistrict,
    monuments: (world.monuments ?? []).map((m) => ({
      id: m.id, honoreeId: m.honoreeId, honoree: nameOf(world, m.honoreeId), inscription: m.inscription, day: m.day,
    })),
  };
}

// --------------------------------------------------------------- government

function partyRow(world: World, present: Set<CitizenId>): Record<string, unknown>[] {
  return Object.values(world.parties ?? {})
    .sort((a, b) => b.seats - a.seats || b.members.length - a.members.length || a.id.localeCompare(b.id))
    .map((p) => ({
      id: p.id, name: p.name, platform: p.platform, manifesto: manifestoOf(p),
      words: platformInWords(p.platform), foundedDay: p.foundedDay, seats: p.seats,
      leader: personCard(world, p.leaderId, present), founder: personCard(world, p.founderId, present),
      size: p.members.length, members: personCards(world, p.members, present, 24),
    }));
}

function promiseRows(world: World, present: Set<CitizenId>): Record<string, unknown>[] {
  const ids = new Set<CitizenId>([...world.government.council]);
  if (world.government.mayorId) ids.add(world.government.mayorId);
  const rows: Record<string, unknown>[] = [];
  for (const id of ids) {
    const promises = promisesOf(world, id);
    if (promises.length === 0) continue;
    rows.push({
      ...personCard(world, id, present),
      keptShare: keptShare(world, id),
      promises: promises.map((p) => ({
        field: p.field, wanted: round2(p.wanted), madeDay: p.madeDay, state: p.state,
        words: p.wanted >= 0.5 ? PROMISE_WORDS[p.field].up : PROMISE_WORDS[p.field].down,
      })),
    });
  }
  return rows;
}

function petitionRows(world: World, present: Set<CitizenId>): Record<string, unknown>[] {
  const needed = signaturesNeeded(world);
  return world.government.proposals
    .filter((p: Proposal) => p.petition)
    .sort((a, b) => b.tabledDay - a.tabledDay || a.id.localeCompare(b.id))
    .map((p) => {
      const referendum = referendumFor(world, p.id);
      return {
        proposalId: p.id, kind: p.kind, summary: p.summary, tabledDay: p.tabledDay, status: p.status,
        proposer: personCard(world, p.proposerId, present),
        signatures: liveSignatures(world, p).length, needed,
        referendumId: referendum ? referendum.id : null,
      };
    });
}

/** Parties, approval, promises, referendums, unions, decrees and the new levers. */
export function governmentExtras(world: World): Record<string, unknown> {
  const present = presentSet(world);
  const approval = cityApproval(world);
  const major = majorityParty(world);
  const pact = coalition(world);
  return {
    parties: partyRow(world, present),
    majorityPartyId: major ? major.id : null,
    coalition: pact ? pact.map((p) => ({ id: p.id, name: p.name, seats: p.seats })) : null,
    approval,
    promises: promiseRows(world, present),
    petitions: petitionRows(world, present),
    referendums: [...(world.referendums ?? [])]
      .sort((a, b) => b.day - a.day || a.id.localeCompare(b.id))
      .map((r) => ({ ...r, today: r.day === world.day && r.result === null })),
    unions: Object.values(world.unions ?? {})
      .sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id))
      .map((u) => ({
        id: u.id, name: u.name, role: u.role, demandWage: u.demandWage,
        strikingUntilDay: u.strikingUntilDay,
        striking: u.strikingUntilDay !== null && u.strikingUntilDay >= world.day,
        majority: hasMajority(world, u), meanWage: Math.round(meanWage(world, u.role)),
        size: u.members.length, members: personCards(world, u.members, present, 24),
      })),
    decrees: [...(world.decrees ?? [])]
      .sort((a, b) => b.day - a.day)
      .map((d) => ({
        kind: d.kind, day: d.day, untilDay: d.untilDay, value: d.value,
        district: d.district, districtName: d.district ? world.districts[d.district]?.name ?? d.district : null,
        by: personCard(world, d.byId, present),
        inForce: d.day <= world.day && d.untilDay >= world.day,
      })),
    activeDecrees: activeDecrees(world).map((d) => d.kind),
    levers: { ...leversObservation(world), tourists: touristsToday(world) },
  };
}

// -------------------------------------------------------------------- court

/** The jury box and the advocate's bench, for one case. */
export function caseExtras(world: World, k: Case): Record<string, unknown> {
  const jury = k.jury ?? [];
  const seated = new Set(seatedJurors(world, k));
  const advocate = advocateFor(world, k);
  return {
    jury: jury.map((id) => ({
      id, name: nameOf(world, id), portrait: portraitPath(id),
      verdict: k.juryVotes?.[id] ?? null, reason: k.juryReasons?.[id] ?? null, seated: seated.has(id),
    })),
    juryTally: jury.length > 0 ? juryTally(world, k) : null,
    advocate: advocate ? { id: advocate.id, name: advocate.name, portrait: portraitPath(advocate.id) } : null,
    advocacy: round2(num(k.advocacy)),
  };
}

function investigationRow(world: World, i: Investigation): Record<string, unknown> {
  return {
    id: i.id, suspectId: i.suspectId, suspect: nameOf(world, i.suspectId),
    law: i.law, lawName: LAWS[i.law]?.name ?? i.law,
    evidence: round2(i.evidence), openedDay: i.openedDay, closedDay: i.closedDay,
    detectiveId: i.detectiveId, detective: nameOf(world, i.detectiveId),
    caseId: i.caseId, reportId: i.reportId,
  };
}

function gangRow(world: World, g: Gang, present: Set<CitizenId>): Record<string, unknown> {
  return {
    id: g.id, name: g.name, turf: g.turf, turfName: world.districts[g.turf]?.name ?? g.turf,
    foundedDay: g.foundedDay, bustedDay: g.bustedDay,
    boss: personCard(world, g.bossId, present), size: g.members.length,
    members: personCards(world, g.members, present, 24),
    rackets: g.rackets.map((id) => ({ id, name: world.businesses[id]?.name ?? id })),
  };
}

/** Investigations in progress, the cells, and the gangs the Watch knows of. */
export function courtExtras(world: World): Record<string, unknown> {
  const present = presentSet(world);
  return {
    investigations: openInvestigations(world)
      .sort((a, b) => b.evidence - a.evidence || a.id.localeCompare(b.id))
      .map((i) => investigationRow(world, i)),
    closedInvestigations: Object.values(world.investigations ?? {})
      .filter((i) => i.closedDay !== null)
      .sort((a, b) => (b.closedDay ?? 0) - (a.closedDay ?? 0) || a.id.localeCompare(b.id))
      .slice(0, 40)
      .map((i) => investigationRow(world, i)),
    jail: {
      cells: jailCells(world),
      overcrowded: overcrowded(world),
      roster: jailRoster(world).map((e) => {
        const c = world.citizens[e.id];
        return {
          ...personCard(world, e.id, present),
          until: e.until, daysLeft: c ? daysLeft(world, c) : 0, caseId: e.caseId,
        };
      }),
    },
    gangs: gangsView(world).map((g) => gangRow(world, g, present)),
  };
}
