/**
 * JSON views of the World for the dashboard, part two: economy, government,
 * court, ban registry and chronicle. Read-only projections.
 */
import type { Case, ChronicleEdition, CitizenId, Good, PaperId, Proposal, World, WorldEvent } from '../types.ts';
import { GOODS, PAPERS } from '../types.ts';
import { isEligibleVoter } from '../citizens/citizen.ts';
import { employerName, openJobs } from '../economy/jobs.ts';
import { vacancies } from '../economy/housing.ts';
import { moneySupply } from '../economy/treasury.ts';
import { daysToElection, isElectionDay, nominationsOpen } from '../government/council.ts';
import { officersOnDuty } from '../government/watch.ts';
import { LAWS, LAW_CODES, offenceName, trackOf } from '../data/laws.ts';
import type { ResidencyHearing, StandingNotice } from '../standing/state.ts';
import { gateOf, residencyLine, visitLine } from '../standing/gates.ts';
import { NOTICE_KEEPS, RECOVERY_DAYS } from '../standing/notices.ts';
import { RESIDENCY_HEARING_HOUR } from '../standing/hearings.ts';
import { isPresentIn, nameOf, noticeBadge, partyName, personCard, personCards, portraitPath, presentSet } from './views.ts';
import { caseExtras, courtExtras, governmentExtras } from './views-metropolis.ts';
import { economyExtras } from './views-markets.ts';
// The Chronicle's own desk: both papers, the evening's diaries, the arts
// notices and the era a back number was printed in.
import { PAPER_INFO, WORK_INFO } from '../data/metropolis.ts';
import { frontPage, inLedgerVoice, paperOf, paperReading, readershipShare } from '../culture/press.ts';
import { quotableDiaries } from '../identity/diary.ts';
import { allWorks } from '../culture/works.ts';
import { eraOfDay } from '../world/history.ts';

/** Per-good price samples kept by the server, one per tick. */
export interface PriceHistory {
  goods: Record<Good, number[]>;
  index: number[];
}

export const LEDGER_VIEW_LENGTH = 50;
export const CASE_VIEW_LENGTH = 200;
export const EVENT_VIEW_LENGTH = 200;
export const STATS_VIEW_LENGTH = 120;
/** Lines of a notice of standing put on the public register. */
export const NOTICE_ITEMS_SHOWN = 8;
/** Residency hearings kept on the register, newest first. */
export const HEARINGS_SHOWN = 40;

const idNumber = (id: string) => Number(id.slice(id.indexOf('_') + 1)) || 0;

// ---------------------------------------------------------------- economy

export function economyView(world: World, history: PriceHistory): Record<string, unknown> {
  const present = presentSet(world);
  const living = Object.values(world.citizens).filter((c) => isPresentIn(world, c, present));
  const grownUps = living.filter((c) => c.lifeStage !== 'child');
  const employed = grownUps.filter((c) => c.jobId !== null && world.jobs[c.jobId]?.holderId === c.id).length;
  const jobs = Object.values(world.jobs);
  const t = world.treasury;
  const goods = {} as Record<Good, Record<string, unknown>>;
  for (const g of GOODS) {
    const m = world.market.goods[g];
    goods[g] = {
      price: m.price, basePrice: m.basePrice, stock: m.stock,
      demandTick: m.demandTick, supplyTick: m.supplyTick, demandDay: m.demandDay, supplyDay: m.supplyDay,
      history: history.goods[g] ?? [],
    };
  }
  const loans = Object.values(world.loans);
  const supply = moneySupply(world);
  const expected = t.foundingSupply + t.minted - t.burned;
  return {
    market: { goods, priceIndex: world.market.priceIndex, shortages: world.market.shortages, priceIndexHistory: history.index },
    treasury: {
      balance: t.balance, foundingSupply: t.foundingSupply, minted: t.minted, burned: t.burned,
      revenueToday: t.revenueToday, spendToday: t.spendToday, totals: t.totals,
      moneySupply: supply, audit: { supply, expected, ok: supply === expected },
      ledger: t.ledger.slice(-LEDGER_VIEW_LENGTH).reverse().map((l) => ({
        ...l, fromName: partyName(world, l.from), toName: partyName(world, l.to),
      })),
    },
    housing: {
      capacity: world.housing.capacity, occupied: world.housing.occupied, rent: world.housing.rent,
      progress: Math.round(world.housing.progress), vacancies: vacancies(world),
      homeless: living.filter((c) => c.homeTier === 0).length, housed: living.filter((c) => c.homeTier > 0).length,
    },
    businesses: Object.values(world.businesses)
      .sort((a, b) => Number(a.dissolvedDay !== null) - Number(b.dissolvedDay !== null) || b.foundedDay - a.foundedDay)
      .map((b) => ({
        id: b.id, name: b.name, kind: b.kind, ownerId: b.ownerId, ownerName: nameOf(world, b.ownerId), treasury: b.treasury,
        district: b.district, employees: b.employees.length, jobs: b.jobs.length,
        openJobs: b.jobs.filter((j) => world.jobs[j]?.holderId === null).length,
        inventory: b.inventory, revenueToday: b.revenueToday, costsToday: b.costsToday, daysNegative: b.daysNegative,
        foundedDay: b.foundedDay, dissolvedDay: b.dissolvedDay, rentPerDay: b.rentPerDay,
      })),
    jobs: openJobs(world).map((j) => ({
      id: j.id, title: j.title, role: j.role, employer: j.employer, employerName: employerName(world, j), district: j.district,
      wage: Math.max(world.government.minWage, j.wage), skill: j.skill, minSkill: j.minSkill, minReputation: j.minReputation,
      createdDay: j.createdDay,
    })),
    employment: {
      employed, unemployed: grownUps.length - employed, jobsTotal: jobs.length,
      jobsOpen: jobs.filter((j) => j.holderId === null).length, jobsFilled: jobs.filter((j) => j.holderId !== null).length,
    },
    loans: {
      count: loans.length, outstanding: loans.reduce((s, l) => s + l.outstanding, 0),
      defaulted: loans.filter((l) => l.defaulted).length,
    },
    stats: world.stats.slice(-STATS_VIEW_LENGTH),
    ...economyExtras(world),
  };
}

// ------------------------------------------------------------- government

function proposalView(world: World, p: Proposal): Record<string, unknown> {
  const votes = Object.entries(p.votes).map(([id, aye]) => ({ id, name: nameOf(world, id), aye }));
  return {
    id: p.id, kind: p.kind, value: p.value, lawCode: p.lawCode, targetId: p.targetId, targetName: nameOf(world, p.targetId),
    summary: p.summary, proposerId: p.proposerId, proposerName: nameOf(world, p.proposerId), petition: p.petition,
    tabledDay: p.tabledDay, status: p.status, decidedDay: p.decidedDay, needed: p.needed,
    ayes: votes.filter((v) => v.aye).length, nays: votes.filter((v) => !v.aye).length, votes,
  };
}

/** A name with a face, falling back to the registry's own record of a departed id. */
function cardOf(world: World, id: CitizenId, present: Set<CitizenId>): Record<string, unknown> {
  const card = personCard(world, id, present);
  return card ? { ...card } : { id, name: nameOf(world, id) ?? id, portrait: portraitPath(id) };
}

// ------------------------------------------------- the register of standing

/**
 * One line of the public register (`docs/CITIZENSHIP.md` §3): who is under a
 * notice of standing, the line they are judged against, exactly what the fall
 * cost them, and the day the grace runs out.
 *
 * Everything here is read straight off `world.standing` rather than through
 * the standing layer's own accessors, which create the ledgers they read. A
 * view changes nothing (docs/PRINCIPLES.md §1).
 */
function noticeRow(world: World, n: StandingNotice, present: Set<CitizenId>): Record<string, unknown> | null {
  const c = world.citizens[n.citizenId];
  const card = personCard(world, n.citizenId, present);
  const badge = c ? noticeBadge(world, c) : null;
  if (!card || !badge) return null;
  return {
    ...card, ...badge,
    city: n.city, cityName: gateOf(n.city).name,
    graceDays: n.graceDays, halved: n.halved, extendedDays: n.extendedDays,
    status: n.status, hearingId: n.hearingId, daysAbove: n.daysAbove,
    // The grace has run out and the citizen is still short: the Court will sit.
    due: n.immediate || world.day >= n.graceEndsDay,
    items: n.items.slice(0, NOTICE_ITEMS_SHOWN).map((i) => ({
      kind: i.kind, label: i.label, amount: Math.round(i.amount), caseId: i.caseId ?? null, law: i.law ?? null,
    })),
  };
}

/** One residency hearing, with the bench's reasons and every vote named. */
function hearingRow(world: World, h: ResidencyHearing, present: Set<CitizenId>): Record<string, unknown> {
  return {
    id: h.id, day: h.day, hour: h.hour, outcome: h.outcome,
    repute: Math.round(h.repute), line: Math.round(h.line),
    shortfall: Math.max(0, Math.round(h.line - h.repute)),
    spoke: h.spoke, extendedDays: h.extendedDays, leaveByDay: h.leaveByDay, reasons: h.reasons,
    citizen: cardOf(world, h.citizenId, present),
    advocate: h.advocateId ? cardOf(world, h.advocateId, present) : null,
    vouchers: personCards(world, h.vouchers, present, 8),
    votes: Object.entries(h.votes).map(([id, vote]) => ({ ...cardOf(world, id, present), vote })),
  };
}

/**
 * The register itself. Public by the Charter: a notice arrives in the
 * citizen's inbox, in their memory, **and** on this page. What it does not do
 * is take anything away, which is what `keeps` says in the city's own words.
 */
function standingRegister(world: World, present: Set<CitizenId>): Record<string, unknown> {
  const state = world.standing;
  const open = Object.values(state?.notices ?? {})
    .filter((n) => n.status === 'open')
    .sort((a, b) => a.graceEndsDay - b.graceEndsDay || a.issuedDay - b.issuedDay || a.citizenId.localeCompare(b.citizenId))
    .map((n) => noticeRow(world, n, present))
    .filter((row): row is Record<string, unknown> => row !== null);
  const hearings = [...(state?.hearings ?? [])]
    .sort((a, b) => b.day - a.day || b.id.localeCompare(a.id))
    .slice(0, HEARINGS_SHOWN)
    .map((h) => hearingRow(world, h, present));
  return {
    city: gateOf().name,
    residencyLine: residencyLine(world), visitLine: visitLine(world),
    recoveryDays: RECOVERY_DAYS, hearingHour: RESIDENCY_HEARING_HOUR, keeps: NOTICE_KEEPS,
    open, due: open.filter((n) => n.due === true).length,
    hearings,
    // Ended, and still inside the fourteen days to sell up and take the road.
    leaving: hearings
      .filter((h) => h.outcome === 'ended' && typeof h.leaveByDay === 'number' && (h.leaveByDay as number) >= world.day)
      .map((h) => ({ hearingId: h.id, day: h.day, leaveByDay: h.leaveByDay, citizen: h.citizen })),
  };
}

/**
 * What the Council session has in front of it: the bills tabled, the appeals
 * it decides at the same sitting, and the residencies whose grace has run out
 * and that the Court will therefore put to it.
 */
function councilAgenda(world: World, present: Set<CitizenId>, register: Record<string, unknown>): Record<string, unknown> {
  const votesOf = (votes: Record<CitizenId, boolean>) => Object.values(votes);
  return {
    hour: world.config.councilHour,
    seats: world.government.council.length,
    bills: world.government.proposals.filter((p) => p.status === 'open').map((p) => ({
      id: p.id, kind: p.kind, summary: p.summary, tabledDay: p.tabledDay, needed: p.needed, petition: p.petition,
      ayes: votesOf(p.votes).filter(Boolean).length, nays: votesOf(p.votes).filter((v) => !v).length,
      proposer: cardOf(world, p.proposerId, present),
    })),
    appeals: Object.values(world.cases)
      .filter((k) => k.status === 'appealed' && k.appeal !== null)
      .sort((a, b) => (a.appeal?.filedDay ?? 0) - (b.appeal?.filedDay ?? 0) || idNumber(a.id) - idNumber(b.id))
      .map((k) => ({
        caseId: k.id, law: k.law, lawName: offenceName(k.law), severity: k.severity,
        defendant: cardOf(world, k.defendantId, present),
        filedDay: k.appeal?.filedDay ?? null, sentence: k.sentence,
        votes: Object.entries(k.appeal?.votes ?? {}).map(([id, vote]) => ({ ...cardOf(world, id, present), vote })),
      })),
    // The notices whose grace has run out; the rows themselves are on the
    // register above, so the agenda only names them.
    residency: (register.open as Record<string, unknown>[])
      .filter((n) => n.due === true)
      .map((n) => ({ id: n.id, name: n.name, familyName: n.familyName, portrait: n.portrait,
        shortfall: n.shortfall, immediate: n.immediate, applied: n.applied })),
  };
}

export function governmentView(world: World): Record<string, unknown> {
  const g = world.government;
  const e = g.election;
  const present = presentSet(world);
  const register = standingRegister(world, present);
  const onDuty = new Set(officersOnDuty(world).map((c) => c.id));
  const member = (id: CitizenId) => {
    const c = world.citizens[id];
    return { id, name: c?.name ?? id, reputation: c ? Math.round(c.reputation) : 0, platform: c?.platform ?? null };
  };
  const ballotsFor: Record<string, number> = {};
  for (const candidate of Object.values(e.ballots)) ballotsFor[candidate] = (ballotsFor[candidate] ?? 0) + 1;
  const eligibleVoters = Object.values(world.citizens).filter((c) => isEligibleVoter(world, c)).length;
  return {
    mayor: g.mayorId ? { id: g.mayorId, name: nameOf(world, g.mayorId) } : null,
    council: g.council.map((id) => ({ ...member(id), isMayor: id === g.mayorId })),
    judges: g.judges.map((id) => ({ ...member(id), termEndsDay: world.citizens[id]?.judgeTermEndsDay ?? null })),
    watch: g.watch.map((id) => ({ ...member(id), captain: id === g.watchCaptainId, onDuty: onDuty.has(id) })),
    watchCaptain: g.watchCaptainId ? { id: g.watchCaptainId, name: nameOf(world, g.watchCaptainId) } : null,
    incomeTax: g.incomeTax, salesTax: g.salesTax, profitTax: g.profitTax, dividend: g.dividend, minWage: g.minWage,
    publicWorksFund: g.publicWorksFund, cycle: g.cycle, decreeUsedCycle: g.decreeUsedCycle,
    laws: LAW_CODES.map((code) => ({
      code, name: LAWS[code].name, severity: g.lawSeverity[code] ?? LAWS[code].severity,
      defaultSeverity: LAWS[code].severity, description: LAWS[code].description,
    })),
    election: {
      cycle: e.cycle, nominationsOpenDay: e.nominationsOpenDay, electionDay: e.electionDay,
      daysToElection: daysToElection(world), nominationsOpen: nominationsOpen(world),
      electionToday: isElectionDay(world) && !e.resolved, resolved: e.resolved,
      candidates: e.candidates.map((id) => {
        const c = world.citizens[id];
        return {
          id, name: c?.name ?? id, platform: c?.platform ?? null, visibility: c?.campaignVisibility ?? 0,
          reputation: c ? Math.round(c.reputation) : 0, ballots: ballotsFor[id] ?? 0,
        };
      }),
      ballotsCast: Object.keys(e.ballots).length, eligibleVoters,
      results: e.results ? e.results.map((r) => ({
        candidateId: r.candidateId, name: nameOf(world, r.candidateId), votes: r.votes,
        seated: g.council.includes(r.candidateId), mayor: r.candidateId === g.mayorId,
      })) : null,
      turnout: e.turnout,
    },
    proposals: [...g.proposals]
      .sort((a, b) => b.tabledDay - a.tabledDay || idNumber(b.id) - idNumber(a.id))
      .map((p) => proposalView(world, p)),
    // The public register of standing, and what the 14:00 session will sit on.
    notices: register,
    agenda: councilAgenda(world, present, register),
    ...governmentExtras(world),
  };
}

// ------------------------------------------------------------------ court

function caseView(world: World, k: Case): Record<string, unknown> {
  return {
    id: k.id, defendantId: k.defendantId, defendantName: nameOf(world, k.defendantId),
    law: k.law, lawName: offenceName(k.law), track: trackOf(k.law), severity: k.severity, evidence: Math.round(k.evidence * 100) / 100,
    filedTick: k.filedTick, filedDay: Math.floor(k.filedTick / 24), filedBy: k.filedBy,
    filedByName: k.filedBy === 'watch' ? 'the Watch' : nameOf(world, k.filedBy),
    victimId: k.victimId, victimName: nameOf(world, k.victimId), amount: k.amount, description: k.description,
    status: k.status, triedDay: k.triedDay,
    judges: k.judges.map((id) => ({ id, name: nameOf(world, id), verdict: k.votes[id] ?? null, reason: k.reasons?.[id] ?? null })),
    votes: Object.entries(k.votes).map(([id, verdict]) => ({ id, name: nameOf(world, id), verdict, reason: k.reasons?.[id] ?? null })),
    carriedSessions: k.carriedSessions ?? 0, decidedByDefault: k.decidedByDefault === true,
    verdict: k.verdict, sentence: k.sentence,
    appeal: k.appeal ? {
      filedDay: k.appeal.filedDay, decidedDay: k.appeal.decidedDay, result: k.appeal.result,
      votes: Object.entries(k.appeal.votes).map(([id, vote]) => ({ id, name: nameOf(world, id), vote })),
    } : null,
    ...caseExtras(world, k),
  };
}

export function courtView(world: World): Record<string, unknown> {
  const all = Object.values(world.cases);
  const count = (fn: (k: Case) => boolean) => all.filter(fn).length;
  const cases = [...all]
    .sort((a, b) => b.filedTick - a.filedTick || idNumber(b.id) - idNumber(a.id))
    .slice(0, CASE_VIEW_LENGTH)
    .map((k) => caseView(world, k));
  const tried = count((k) => k.verdict !== null);
  const guilty = count((k) => k.verdict === 'guilty');
  return {
    counts: {
      total: all.length,
      pending: count((k) => k.status === 'pending'), inSession: count((k) => k.status === 'in_session'),
      tried: count((k) => k.status === 'tried'),
      appealed: count((k) => k.status === 'appealed'), closed: count((k) => k.status === 'closed'),
      guilty, acquitted: count((k) => k.verdict === 'acquitted'),
      exiles: count((k) => k.sentence?.exile === true),
      // The two tracks, counted apart, and the rate a city can argue about.
      civicCharges: count((k) => trackOf(k.law) === 'city'),
      personCharges: count((k) => trackOf(k.law) === 'person'),
      ladderSentences: count((k) => k.sentence?.track === 'city'),
      custodySentences: count((k) => k.sentence?.track === 'person'),
      convictionRate: tried > 0 ? Math.round((guilty / tried) * 100) / 100 : null,
    },
    nextSessionHour: world.config.courtHour,
    cases,
    // The Watch's book: what was reported, what an officer charged, what they
    // dropped and why, and what lapsed in whose hands. All of it public.
    reports: Object.values(world.reports ?? {})
      .sort((a, b) => b.tick - a.tick || idNumber(b.id) - idNumber(a.id))
      .slice(0, CASE_VIEW_LENGTH)
      .map((r) => ({
        id: r.id, officerId: r.officerId, officerName: r.officerId ? nameOf(world, r.officerId) : null,
        suspectId: r.suspectId, suspectName: nameOf(world, r.suspectId),
        law: r.law, lawName: offenceName(r.law), track: trackOf(r.law), evidence: Math.round(r.evidence * 100) / 100,
        tick: r.tick, day: Math.floor(r.tick / 24), victimId: r.victimId, victimName: nameOf(world, r.victimId),
        amount: r.amount, description: r.description, status: r.status,
        filedCaseId: r.filedCaseId, droppedReason: r.droppedReason,
      })),
    ...courtExtras(world),
  };
}

// ------------------------------------------------------------------- bans

export function bansView(world: World): Record<string, unknown> {
  const present = presentSet(world);
  const bans = world.bans.map((b, i) => ({ b, i }))
    .sort((x, y) => y.b.day - x.b.day || y.i - x.i)
    .map(({ b }) => {
      // The face the city drew for them, and the case that put them through
      // the Gate: an exile's record stays in the registry forever, so the
      // register links to the whole of it (docs/PRINCIPLES.md §6).
      const k = world.cases[b.caseId] ?? null;
      return {
        ...cardOf(world, b.citizenId, present),
        citizenId: b.citizenId, name: b.name, lineage: b.lineage,
        caseId: b.caseId, law: b.law, lawName: LAWS[b.law]?.name ?? b.law,
        day: b.day, judges: b.judges.map((id) => ({ ...cardOf(world, id, present), name: nameOf(world, id) })),
        votes: Object.entries(b.votes).map(([id, verdict]) => ({ id, name: nameOf(world, id), verdict })),
        appealed: b.appealed, appealResult: b.appealResult, pardonedDay: b.pardonedDay, hasApiKey: b.apiKeyHash !== null,
        case: k ? {
          id: k.id, severity: k.severity, evidence: Math.round(k.evidence * 100) / 100, track: trackOf(k.law),
          description: k.description, filedDay: Math.floor(k.filedTick / 24), triedDay: k.triedDay,
          filedBy: k.filedBy, filedByName: k.filedBy === 'watch' ? 'the Watch' : nameOf(world, k.filedBy),
          victim: k.victimId ? cardOf(world, k.victimId, present) : null,
          verdict: k.verdict, sentence: k.sentence,
        } : null,
      };
    });
  return { bans, active: bans.filter((b) => b.pardonedDay === null).length };
}

// -------------------------------------------------------------- chronicle
//
// `GET /api/chronicle` — the broadsheet (`docs/UI.md` §9). An edition keeps
// only its five sentences and the Treasury's line; everything a front page
// needs beyond that is found again here: the event each headline was set from
// (so the lead can carry a face), the evening's diary lines — public, unlike
// a citizen's notes and letters (`docs/PRINCIPLES.md` §5) — the arts desk's
// notices, and the figures behind the Treasury box. Read-only throughout.

/** Back numbers the rail carries, per paper. */
export const EDITIONS_SHOWN = 30;
/** Stories on a page that carry faces: a broadsheet pictures its lead, not its columns. */
export const STORIES_WITH_FACES = 2;
/** How far back the log is read when matching a headline to its event. */
export const HEADLINE_INDEX_EVENTS = 1_500;
/** Evenings the front page may quote from. */
export const DIARY_DAYS = 12;
/** Diary lines quoted from one evening. */
export const DIARIES_QUOTED = 4;
/** Notices from the arts desk. */
export const REVIEWS_SHOWN = 12;
/** Days of Treasury figures behind the box. */
export const TREASURY_DAYS = 60;

/**
 * Every recent event by the sentence a paper would print it as: its own words
 * for the Chronicle, and the Ledger's for the Ledger, which rewrites what it
 * runs. Newest wins, so a line that recurs points at the last time it
 * happened. A headline older than the log simply finds nothing and prints
 * without a face.
 */
function headlineIndex(world: World): Map<string, WorldEvent> {
  const index = new Map<string, WorldEvent>();
  const events = world.events;
  const from = Math.max(0, events.length - HEADLINE_INDEX_EVENTS);
  for (let i = events.length - 1; i >= from; i--) {
    const e = events[i];
    if (!index.has(e.text)) index.set(e.text, e);
    const ledger = inLedgerVoice(e.text);
    if (ledger !== e.text && !index.has(ledger)) index.set(ledger, e);
  }
  return index;
}

/** One headline, with the hour it happened and the people it names. */
function storyView(
  world: World, text: string, index: Map<string, WorldEvent>, present: Set<CitizenId>, faces: boolean,
): Record<string, unknown> {
  const e = index.get(text) ?? null;
  return {
    text,
    kind: e?.kind ?? null, tick: e?.tick ?? null, day: e?.day ?? null, weight: e?.weight ?? null,
    who: e && faces ? personCards(world, e.actors, present, 3) : [],
  };
}

/** One edition as a front page: masthead, stories, and the Treasury's line. */
function editionView(
  world: World, e: ChronicleEdition, index: Map<string, WorldEvent>, present: Set<CitizenId>,
): Record<string, unknown> {
  const paper = paperOf(e);
  const info = PAPER_INFO[paper];
  const era = eraOfDay(world, e.day);
  return {
    key: `${paper}:${e.day}`,
    day: e.day, reportedDay: Math.max(0, e.day - 1),
    paper, paperName: info?.name ?? paper, slant: info?.slant ?? '',
    era: era?.name ?? null,
    treasuryReport: e.treasuryReport,
    // The five sentences, each with what the log still knows about it. The
    // edition's own `headlines` are not repeated: `stories[].text` is them.
    stories: (e.headlines ?? []).map((h, i) => storyView(world, h, index, present, i < STORIES_WITH_FACES)),
  };
}

/** The back numbers, newest first, bounded per paper rather than per shelf. */
function editionsView(world: World, index: Map<string, WorldEvent>, present: Set<CitizenId>): Record<string, unknown>[] {
  const kept: Record<string, unknown>[] = [];
  const counts: Record<string, number> = {};
  for (let i = world.chronicle.length - 1; i >= 0; i--) {
    const e = world.chronicle[i];
    const paper = paperOf(e);
    counts[paper] = (counts[paper] ?? 0) + 1;
    if (counts[paper] > EDITIONS_SHOWN) continue;
    kept.push(editionView(world, e, index, present));
  }
  return kept;
}

/**
 * The evenings the front page can quote: a citizen's diary is public and the
 * Chronicle may print from it (`src/identity/diary.ts`). Notes and letters
 * are never here.
 */
function diariesView(world: World, present: Set<CitizenId>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const oldest = Math.max(0, world.day - DIARY_DAYS);
  for (let day = world.day; day >= oldest; day--) {
    const quotes = quotableDiaries(world, day, DIARIES_QUOTED)
      .map(({ c, text }) => ({ text, who: personCard(world, c.id, present) }));
    if (quotes.length > 0) out.push({ day, quotes });
  }
  return out;
}

/** What the papers made of what the city made, newest notice first. */
function reviewsView(world: World, present: Set<CitizenId>): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const w of allWorks(world)) {
    for (const r of w.reviews ?? []) {
      rows.push({
        workId: w.id, title: w.title, kind: w.kind, kindName: WORK_INFO[w.kind]?.name ?? w.kind,
        creatorId: w.creatorId, creator: personCard(world, w.creatorId, present),
        paper: r.paper, paperName: PAPER_INFO[r.paper]?.name ?? r.paper, score: r.score, day: r.day,
        quality: Math.round(w.quality), popularity: Math.round(w.popularity), inMuseum: w.inMuseum === true,
      });
    }
  }
  rows.sort((a, b) => (b.day as number) - (a.day as number)
    || (b.score as number) - (a.score as number)
    || String(a.workId).localeCompare(String(b.workId)));
  return rows.slice(0, REVIEWS_SHOWN);
}

/** The masthead line for each paper: who it is, what it leads on, who reads it. */
function papersView(world: World): Record<string, unknown>[] {
  const share = readershipShare(world);
  return PAPERS.map((p: PaperId) => {
    const page = frontPage(world, p);
    return {
      paper: p, name: PAPER_INFO[p]?.name ?? p, slant: PAPER_INFO[p]?.slant ?? '',
      day: page?.day ?? null, headline: page?.headlines?.[0] ?? null,
      editions: world.chronicle.filter((e) => paperOf(e) === p).length,
      readership: share[p] ?? 0, reading: paperReading(world, p),
    };
  });
}

export function chronicleView(world: World): Record<string, unknown> {
  const present = presentSet(world);
  const index = headlineIndex(world);
  const t = world.treasury;
  return {
    day: world.day, hour: world.hour, cycle: world.government.cycle,
    era: eraOfDay(world, world.day)?.name ?? null,
    papers: papersView(world),
    editions: editionsView(world, index, present),
    diaries: diariesView(world, present),
    reviews: reviewsView(world, present),
    treasury: {
      balance: t.balance, revenueToday: t.revenueToday, spendToday: t.spendToday,
      moneySupply: moneySupply(world), priceIndex: world.market.priceIndex,
      series: world.stats.slice(-TREASURY_DAYS).map((s) => ({
        day: s.day, treasury: s.treasury, moneySupply: s.moneySupply,
        priceIndex: s.priceIndex, population: s.population,
      })),
    },
    events: world.events.slice(-EVENT_VIEW_LENGTH).reverse(),
  };
}
