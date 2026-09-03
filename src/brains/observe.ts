/**
 * What a brain sees. buildObservation renders one citizen's situation into
 * the Observation shape shared by every kind of mind — reflex, Claude and
 * remote — so nothing is possible for one that is invisible to another.
 * Draining the inbox is the one side effect: a letter is delivered once.
 */
import { CITY_SENDER, GOODS } from '../types.ts';
import type {
  Citizen, CitizenId, DistrictId, Good, Job, Observation, ObservedCitizen, ObservedClub, ObservedFamilyMember,
  ObservedHappening, ObservedJob, ObservedProposal, ObservedShop, World,
} from '../types.ts';
import { districtDistance } from '../data/city.ts';
import { CLUB_MEETING_HOUR, PRODUCTS } from '../data/catalogue.ts';
import { employerName, isQualified, openJobs } from '../economy/jobs.ts';
import { loanOf } from '../economy/bank.ts';
import { vacancies } from '../economy/housing.ts';
import { isDetained } from '../citizens/citizen.ts';
import { characterOf } from '../citizens/character.ts';
import { CITY_NAME } from '../citizens/orientation.ts';
import { bondBetween, friendsOf, rivalsOf } from '../citizens/relationships.ts';
import { appealsFor, benchFor, canAppeal, latestCaseFor, pendingCasesFor } from '../government/court.ts';
import { observedReportsFor } from '../government/reports.ts';
import { daysToElection, impliedPlatform, isElectionDay, nominationsOpen } from '../government/council.ts';
import { shopsIn } from '../society/shops.ts';
import { ageOf, familyOf } from '../society/family.ts';
import { householdOf, rentShareOf } from '../society/households.ts';
import { calendarObservation, happeningsToday } from '../society/calendar.ts';
import { availableActions, heldJob } from '../actions/execute.ts';
import { ownedBusiness } from '../actions/enterprise.ts';
import { citizensIn, districtName } from '../actions/common.ts';

/** Memory entries surfaced as `recent`. */
export const RECENT_MEMORIES = 8;
/** Open jobs shown on the board, qualified ones first. */
export const MAX_JOBS_SHOWN = 12;
/** Friends and rivals listed, strongest bond first. */
export const MAX_RELATIONS_SHOWN = 5;
/** Affections listed, warmest first. */
export const MAX_AFFECTION_SHOWN = 5;

/**
 * Another citizen as `self` sees them: their name, what they hold, how the
 * two stand with each other, and the character the city reads off their
 * record. Never their hidden traits, needs, wallet or notes.
 */
export function observeCitizen(world: World, self: Citizen, other: Citizen): ObservedCitizen {
  const job = heldJob(world, other);
  return {
    id: other.id, name: other.name, bond: bondBetween(world, self.id, other.id), job: job ? job.title : null,
    office: other.office, reputation: Math.round(other.reputation), standing: other.standing,
    character: characterOf(other),
  };
}

function jobNumber(job: Job): number {
  return Number(job.id.slice(2)) || 0;
}

/** The job board: open positions, qualified first, then best paid, then nearest. */
function observedJobs(world: World, c: Citizen): ObservedJob[] {
  const minWage = world.government.minWage;
  const pay = (j: Job) => Math.max(minWage, j.wage);
  const rows = openJobs(world).map((job) => ({
    job,
    qualified: isQualified(world, c, job) && !(job.role === 'watch_officer' && c.office !== null && c.office !== 'watch'),
    distance: districtDistance(c.district, job.district),
  }));
  rows.sort((a, b) => Number(b.qualified) - Number(a.qualified) || pay(b.job) - pay(a.job) || a.distance - b.distance || jobNumber(a.job) - jobNumber(b.job));
  return rows.slice(0, MAX_JOBS_SHOWN).map(({ job, qualified }) => ({
    id: job.id, title: job.title, wage: pay(job), employer: employerName(world, job), district: job.district,
    skill: job.skill, minSkill: job.minSkill, qualified,
  }));
}

function observedProposals(world: World, cId: CitizenId): ObservedProposal[] {
  return world.government.proposals.filter((p) => p.status === 'open').map((p) => {
    const votes = Object.values(p.votes);
    return {
      id: p.id, kind: p.kind, value: p.value, summary: p.summary,
      proposer: world.citizens[p.proposerId]?.name ?? p.proposerId,
      ayes: votes.filter((v) => v).length, nays: votes.filter((v) => !v).length, needed: p.needed,
      youVoted: p.votes[cId] ?? null,
    };
  });
}

function relations(world: World, c: Citizen, ids: CitizenId[]): ObservedCitizen[] {
  const out: ObservedCitizen[] = [];
  for (const id of ids) {
    const other = world.citizens[id];
    if (other) out.push(observeCitizen(world, c, other));
    if (out.length >= MAX_RELATIONS_SHOWN) break;
  }
  return out;
}

function nameOf(world: World, id: CitizenId | null): string | null {
  return id ? world.citizens[id]?.name ?? id : null;
}

/** The things a citizen owns, oldest first, by product name. */
function observedPossessions(c: Citizen): { id: string; product: string; name: string }[] {
  return c.possessions.map((item) => ({
    id: item.id, product: item.productId, name: PRODUCTS[item.productId]?.name ?? item.productId,
  }));
}

/** Partner, parents, children and siblings who are still in the city. */
function observedFamily(world: World, c: Citizen): ObservedFamilyMember[] {
  const out: ObservedFamilyMember[] = [];
  for (const { id, relation } of familyOf(world, c.id)) {
    const other = world.citizens[id];
    if (!other || other.standing === 'exiled' || !world.order.includes(id)) continue;
    out.push({ id, name: other.name, relation, lifeStage: other.lifeStage });
  }
  return out;
}

/** The clubs a citizen belongs to and when each meets. */
function observedClubs(world: World, c: Citizen): ObservedClub[] {
  const out: ObservedClub[] = [];
  for (const id of c.clubs) {
    const club = world.clubs?.[id];
    if (!club) continue;
    out.push({ id: club.id, name: club.name, hobby: club.hobby, meetsOn: club.meetsOnWeekday, meetsAt: CLUB_MEETING_HOUR });
  }
  return out;
}

/** Shops open here and what is on their shelves. */
function observedShops(world: World, district: DistrictId): ObservedShop[] {
  return shopsIn(world, district).map((shop) => ({
    business: shop.businessId,
    name: shop.name,
    shelf: Object.entries(shop.shelf)
      .filter(([, entry]) => entry.qty > 0)
      .map(([productId, entry]) => ({
        product: productId, name: PRODUCTS[productId]?.name ?? productId, price: entry.price, qty: entry.qty,
      })),
  }));
}

/** What is happening here today, from this hour on, earliest first. */
function observedHappenings(world: World, district: DistrictId): ObservedHappening[] {
  return happeningsToday(world, district).map((h) => ({
    id: h.id, kind: h.kind, who: [...h.who], label: h.label, hour: h.hour,
  }));
}

/** The citizens this one is drawn to, warmest first. */
function observedAffection(world: World, c: Citizen): { id: CitizenId; name: string; affection: number }[] {
  return Object.entries(c.affection ?? {})
    .filter(([id, value]) => value > 0 && world.citizens[id] && world.citizens[id].standing !== 'exiled')
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_AFFECTION_SHOWN)
    .map(([id, value]) => ({ id, name: world.citizens[id].name, affection: Math.round(value) }));
}

/** Build the observation for a citizen. Unknown ids are a programmer error. */
export function buildObservation(world: World, cId: CitizenId): Observation {
  const c = world.citizens[cId];
  if (!c) throw new Error(`buildObservation: unknown citizen ${cId}`);
  const g = world.government;
  const e = g.election;
  const job = heldJob(world, c);
  const biz = ownedBusiness(world, c);
  const loan = loanOf(world, c);
  const latest = latestCaseFor(world, cId);

  const market = {} as Record<Good, { price: number; stock: number }>;
  for (const good of GOODS) market[good] = { price: world.market.goods[good].price, stock: world.market.goods[good].stock };

  // The city itself writes to a citizen once, at the Arrivals Hall; a sender
  // that is not a citizen keeps its id and is named for what it is.
  const senderName = (from: CitizenId): string => (
    from === CITY_SENDER ? CITY_NAME : world.citizens[from]?.name ?? from
  );
  const inbox = c.inbox.map((m) => ({ from: m.from, fromName: senderName(m.from), text: m.text, tick: m.tick }));
  c.inbox.length = 0;

  const partner = c.family.partnerId ? world.citizens[c.family.partnerId] : undefined;
  const household = householdOf(world, cId);

  return {
    tick: world.tick, day: world.day, hour: world.hour,
    self: {
      id: c.id, name: c.name, familyName: c.familyName, lineage: c.lineage,
      lifeStage: c.lifeStage, age: ageOf(world, c), standing: c.standing, wallet: c.wallet,
      needs: { ...c.needs }, mood: c.mood, reputation: c.reputation, district: c.district,
      home: { tier: c.homeTier, rentPerDay: c.homeTier === 0 ? 0 : world.housing.rent[c.homeTier], arrearsDays: c.rentArrearsDays },
      job: job ? {
        id: job.id, title: job.title, wage: Math.max(g.minWage, job.wage), employer: employerName(world, job),
        district: job.district, shiftsToday: c.shiftsToday,
      } : null,
      business: biz ? { id: biz.id, name: biz.name, kind: biz.kind, treasury: biz.treasury, employees: biz.employees.length } : null,
      loan: loan ? { outstanding: loan.outstanding, ratePerDay: loan.ratePerDay } : null,
      skills: { ...c.skills }, character: characterOf(c), inventory: { ...c.inventory },
      notes: [...(c.notes ?? [])],
      office: c.office,
      record: {
        convictions: c.record.convictions.length, strikes: c.record.strikes, pendingCharges: pendingCasesFor(world, cId).length,
        finesOwed: c.finesOwed, serviceDaysLeft: c.communityServiceDaysLeft,
      },
      detained: isDetained(world, c),
      tastes: { ...c.tastes, hobbies: [...c.tastes.hobbies], categories: [...c.tastes.categories], wants: [...c.wants] },
      possessions: observedPossessions(c),
      partner: partner
        ? { id: partner.id, name: partner.name, married: c.family.married, since: c.family.partnerSinceDay ?? world.day }
        : null,
      family: observedFamily(world, c),
      household: household
        ? {
          id: household.id, home: household.tier, members: household.members.filter((id) => id !== cId),
          rentShare: rentShareOf(world, cId),
        }
        : null,
      clubs: observedClubs(world, c),
    },
    here: {
      district: c.district, districtName: districtName(world, c.district),
      buildings: Object.values(world.buildings).filter((b) => b.district === c.district)
        .map((b) => ({ id: b.id, name: b.name, kind: b.kind, damage: b.damage })),
      citizens: citizensIn(world, c.district, c.id).map((o) => observeCitizen(world, c, o)),
      shops: observedShops(world, c.district),
      happening: observedHappenings(world, c.district),
    },
    friends: relations(world, c, friendsOf(world, cId)),
    rivals: relations(world, c, rivalsOf(world, cId)),
    affection: observedAffection(world, c),
    calendar: calendarObservation(world, c),
    market,
    housing: { rent: { ...world.housing.rent }, vacancies: vacancies(world) },
    jobs: observedJobs(world, c),
    government: {
      mayor: nameOf(world, g.mayorId),
      council: g.council.map((id) => world.citizens[id]?.name ?? id),
      judges: g.judges.map((id) => world.citizens[id]?.name ?? id),
      watchOfficers: g.watch.length,
      incomeTax: g.incomeTax, salesTax: g.salesTax, dividend: g.dividend, minWage: g.minWage,
      daysToElection: daysToElection(world),
      nominationsOpen: nominationsOpen(world),
      electionToday: isElectionDay(world) && !e.resolved,
      candidates: e.candidates.flatMap((id) => {
        const cand = world.citizens[id];
        return cand ? [{ id, name: cand.name, platform: cand.platform ?? impliedPlatform(world, cand), visibility: cand.campaignVisibility }] : [];
      }),
      openProposals: observedProposals(world, cId),
      myLatestCase: latest ? {
        id: latest.id, law: latest.law, status: latest.status, verdict: latest.verdict,
        tier: latest.sentence?.tier ?? null, canAppeal: canAppeal(world, cId),
      } : null,
    },
    // What the citizen's office puts before them today. Empty for everyone
    // who holds none, and the same shape for every kind of mind.
    bench: benchFor(world, cId),
    appeals: appealsFor(world, cId),
    reports: observedReportsFor(world, cId),
    inbox,
    recent: c.memory.slice(-RECENT_MEMORIES).map((m) => m.text),
    availableActions: availableActions(world, c),
  };
}
