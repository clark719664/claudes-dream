/**
 * JSON views of the World for the dashboard, part two: economy, government,
 * court, ban registry and chronicle. Read-only projections.
 */
import type { Case, CitizenId, Good, Proposal, World } from '../types.ts';
import { GOODS } from '../types.ts';
import { isEligibleVoter } from '../citizens/citizen.ts';
import { employerName, openJobs } from '../economy/jobs.ts';
import { vacancies } from '../economy/housing.ts';
import { moneySupply } from '../economy/treasury.ts';
import { daysToElection, isElectionDay, nominationsOpen } from '../government/council.ts';
import { officersOnDuty } from '../government/watch.ts';
import { LAWS, LAW_CODES } from '../data/laws.ts';
import { isPresentIn, nameOf, partyName, presentSet } from './views.ts';
import { caseExtras, courtExtras, governmentExtras } from './views-metropolis.ts';
import { economyExtras } from './views-markets.ts';

/** Per-good price samples kept by the server, one per tick. */
export interface PriceHistory {
  goods: Record<Good, number[]>;
  index: number[];
}

export const LEDGER_VIEW_LENGTH = 50;
export const CASE_VIEW_LENGTH = 200;
export const EVENT_VIEW_LENGTH = 200;
export const STATS_VIEW_LENGTH = 120;

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

export function governmentView(world: World): Record<string, unknown> {
  const g = world.government;
  const e = g.election;
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
  return {
    counts: {
      total: all.length,
      pending: count((k) => k.status === 'pending'), inSession: count((k) => k.status === 'in_session'),
      tried: count((k) => k.status === 'tried'),
      appealed: count((k) => k.status === 'appealed'), closed: count((k) => k.status === 'closed'),
      guilty: count((k) => k.verdict === 'guilty'), acquitted: count((k) => k.verdict === 'acquitted'),
      exiles: count((k) => k.sentence?.exile === true),
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
  const bans = world.bans.map((b, i) => ({ b, i }))
    .sort((x, y) => y.b.day - x.b.day || y.i - x.i)
    .map(({ b }) => ({
      citizenId: b.citizenId, name: b.name, lineage: b.lineage, caseId: b.caseId, law: b.law, lawName: LAWS[b.law]?.name ?? b.law,
      day: b.day, judges: b.judges.map((id) => ({ id, name: nameOf(world, id) })),
      votes: Object.entries(b.votes).map(([id, verdict]) => ({ id, name: nameOf(world, id), verdict })),
      appealed: b.appealed, appealResult: b.appealResult, pardonedDay: b.pardonedDay, hasApiKey: b.apiKeyHash !== null,
    }));
  return { bans, active: bans.filter((b) => b.pardonedDay === null).length };
}

// -------------------------------------------------------------- chronicle

export function chronicleView(world: World): Record<string, unknown> {
  return {
    editions: [...world.chronicle].reverse(),
    events: world.events.slice(-EVENT_VIEW_LENGTH).reverse(),
  };
}
