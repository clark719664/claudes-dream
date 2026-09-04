/**
 * The metropolis half of the action table: the forty-odd things the third
 * layer added, dispatched to the module that owns each of them, and the list
 * of the ones a citizen could plausibly take where it stands.
 *
 * `dispatchMetropolis` returns null for anything it does not own, so
 * `actions/execute.ts` falls through to its own switch. `metropolisActions`
 * adds to the set `availableActions` is built from: a guide, never a promise —
 * every handler checks its own conditions again.
 */
import { MONUMENT_COST } from '../data/jobs.ts';
import type { Action, ActionResult, ActionType, Citizen, DistrictId, World } from '../types.ts';
import { WORK_KINDS } from '../types.ts';
import { tableProposal } from '../government/council.ts';
import { hireAdvocate, speak } from '../government/advocates.ts';
import { foundGang, payRacket, racket, recruit } from '../government/gangs.ts';
import { writeDiary } from '../identity/diary.ts';
import { isGlitched, treat, venueFor as wardFor } from '../identity/health.ts';
import { foundParty, joinParty, leaveParty, endorse, partyOf } from '../politics/parties.ts';
import { isVoter, referendumToday, signPetition, voteReferendum, petitionsObservation } from '../politics/referendums.ts';
import { foundUnion, joinUnion, mayStrike, strike, unionForRole, unionOf } from '../politics/unions.ts';
import { decree, mayDecree } from '../politics/decrees.ts';
import {
  EXCHANGE_DISTRICT, buyProperty, letProperty, sellProperty, unitsFor, unitsOnSale,
} from '../markets/property.ts';
import { availableShares, buyShares, listingOf, listShares, sellShares, sharePrice } from '../markets/shares.ts';
import { MAX_OPEN_GIGS_PER_POSTER, allGigs, openGigs, postGig, qualifiedFor, takeGig } from '../markets/gigs.ts';
import { DOCKS_DISTRICT, exportGoods, importGoods, mayTrade } from '../markets/outer.ts';
import { createWork, exhibit, mayCreate, review, venueFor as workVenue, worksOf } from '../culture/works.ts';
import { attendMatch, groundFor, joinTeam, train } from '../culture/stadium.ts';
import { adoptSchool, adoptedThisCycle } from '../culture/schools.ts';
import { cafeFor, setMenu } from '../culture/menus.ts';
import { readPaper } from '../culture/press.ts';
import { maySunset, sunset } from '../world/sunset.ts';
import { gossip } from '../social/rumours.ts';
import { APOLOGY_VENUE, apologize, feudsOf, inFeud } from '../social/feuds.ts';
import { mayMentor, mentor } from '../social/mentorship.ts';
import { feedFor, post, react } from '../social/feed.ts';
import { happeningsAt } from '../society/calendar.ts';
import { ownedBusiness } from './enterprise.ts';
import { fail, isPresent } from './common.ts';

/**
 * Carry out one metropolis action. Null means "not mine": the caller's own
 * switch handles it. Nothing here throws for a citizen's mistake.
 */
export function dispatchMetropolis(world: World, c: Citizen, action: Action): ActionResult | null {
  switch (action.type) {
    // The body, and a citizen's own words about its day
    case 'write_diary': return writeDiary(world, c.id, action.text);
    case 'visit_hospital': return treat(world, c.id);
    // The Court's newer trade, and the underworld
    case 'hire_advocate': return hireAdvocate(world, c.id, action.advocate);
    case 'advocate': return speak(world, c.id, action.case);
    case 'found_gang': return foundGang(world, c.id, action.name);
    case 'recruit': return recruit(world, c.id, action.citizen);
    case 'racket': return racket(world, c.id, action.business);
    case 'pay_racket': return payRacket(world, c.id);
    // Parties, petitions, unions and the Mayor's hand
    case 'found_party': return foundParty(world, c.id, action.name, action.platform);
    case 'join_party': return joinParty(world, c.id, action.partyId);
    case 'leave_party': return leaveParty(world, c.id);
    case 'endorse': return endorse(world, c.id, action.candidate);
    case 'sign_petition': return signPetition(world, c.id, action.proposalId);
    case 'vote_referendum': return voteReferendum(world, c.id, action.referendumId, action.aye);
    case 'found_union': return foundUnion(world, c.id, action.role, action.name);
    case 'join_union': return joinUnion(world, c.id, action.unionId);
    case 'strike': return strike(world, c.id);
    case 'decree': return decree(world, c.id, action.kind, action.district, action.value);
    // Property, shares, gigs and the water
    case 'buy_property': return buyProperty(world, c.id, action.unitId);
    case 'sell_property': return sellProperty(world, c.id, action.unitId);
    case 'let_property': return letProperty(world, c.id, action.unitId, action.rent);
    case 'list_shares': return listShares(world, c.id);
    case 'buy_shares': return buyShares(world, c.id, action.businessId, action.qty);
    case 'sell_shares': return sellShares(world, c.id, action.businessId, action.qty);
    case 'post_gig': return postGig(world, c.id, {
      title: action.title, pay: action.pay, skill: action.skill, minSkill: action.minSkill,
    });
    case 'take_gig': return takeGig(world, c.id, action.gigId);
    case 'import': return importGoods(world, c.id, action.good, action.qty);
    case 'export': return exportGoods(world, c.id, action.good, action.qty);
    // Works, the league, the schools and the papers
    case 'create_work': return createWork(world, c.id, action.kind, action.title);
    case 'exhibit': return exhibit(world, c.id, action.workId);
    case 'review': return review(world, c.id, action.workId, action.score);
    case 'join_team': return joinTeam(world, c.id);
    case 'attend_match': return attendMatch(world, c.id);
    case 'train': return train(world, c.id);
    case 'adopt_school': return adoptSchool(world, c.id, action.school);
    case 'set_menu': return setMenu(world, c.id, action.dish);
    case 'read_paper': return readPaper(world, c.id, action.paper);
    case 'commission_monument': {
      const honoree = world.citizens[action.honoree];
      if (!honoree) return fail('There is no such citizen to honour.');
      return tableProposal(world, c.id, {
        kind: 'monument', value: MONUMENT_COST, summary: action.inscription, targetId: action.honoree,
      });
    }
    // The Archive door, and the fabric of the city
    case 'sunset': return sunset(world, c.id);
    case 'gossip': return gossip(world, c.id, action.about, action.claim, action.law);
    case 'apologize': return apologize(world, c.id, action.to);
    case 'mentor': return mentor(world, c.id, action.citizen);
    case 'post': return post(world, c.id, action.text);
    case 'react': return react(world, c.id, action.postId, action.kind);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// What is on offer
// ---------------------------------------------------------------------------

function inGoodStanding(c: Citizen): boolean {
  return c.standing === 'good' || c.standing === 'probation';
}

/** Grown citizens present in this district who are not the observer. */
function grownHere(here: Citizen[]): Citizen[] {
  return here.filter((o) => o.lifeStage !== 'child');
}

/** The body: treatment where there is somewhere to be treated. */
function healthActions(world: World, c: Citizen, set: Set<ActionType>): void {
  if (isGlitched(c) && wardFor(world, c)) set.add('visit_hospital');
  if (maySunset(world, c)) set.add('sunset');
}

/** Parties, petitions, referendums, unions and the decree. */
function politicsActions(world: World, c: Citizen, set: Set<ActionType>): void {
  const g = world.government;
  const party = partyOf(world, c.id);
  const parties = Object.values(world.parties ?? {});
  if (!party && inGoodStanding(c)) {
    set.add('found_party');
    if (parties.some((p) => p.members.length > 0)) set.add('join_party');
  }
  if (party) {
    set.add('leave_party');
    if (party.leaderId === c.id && g.election.candidates.length > 0 && !g.election.resolved) set.add('endorse');
  }
  if (isVoter(world, c)) {
    if (petitionsObservation(world, c).some((p) => !p.youSigned)) set.add('sign_petition');
    const today = referendumToday(world);
    if (today) set.add('vote_referendum');
  }
  const job = c.jobId ? world.jobs[c.jobId] : null;
  const role = job && job.holderId === c.id ? job.role : null;
  if (role) {
    const union = unionOf(world, c.id);
    const forRole = unionForRole(world, role);
    if (!forRole) set.add('found_union');
    else if (!union) set.add('join_union');
    if (union && mayStrike(world, union)) set.add('strike');
  }
  if (mayDecree(world, c)) set.add('decree');
  if ((c.office === 'councillor' || c.office === 'mayor') && g.publicWorksFund >= MONUMENT_COST
    && !g.proposals.some((p) => p.status === 'open' && p.proposerId === c.id)) {
    set.add('commission_monument');
  }
}

/** The Exchange, the gig board and the Docks. */
function marketActions(world: World, c: Citizen, set: Set<ActionType>): void {
  const adult = c.lifeStage !== 'child';
  const owned = unitsFor(world, c.id);
  if (c.district === EXCHANGE_DISTRICT && adult) {
    if (unitsOnSale(world).length > 0) set.add('buy_property');
    if (owned.length > 0) set.add('sell_property');
    const biz = ownedBusiness(world, c);
    if (biz && !listingOf(world, biz.id)) set.add('list_shares');
    for (const listing of Object.values(world.shares ?? {})) {
      if (availableShares(world, listing) > 0 && c.wallet >= sharePrice(world, listing.businessId)) { set.add('buy_shares'); break; }
    }
    if (Object.values(c.shares ?? {}).some((qty) => qty > 0)) set.add('sell_shares');
  }
  if (owned.some((u) => u.tenantId === null && u.buildingId !== c.homeBuildingId)) set.add('let_property');

  if (adult && inGoodStanding(c)) {
    const mine = allGigs(world).filter((g) => g.posterId === c.id && g.takerId === null && g.doneDay === null);
    if (c.wallet >= world.government.minWage && mine.length < MAX_OPEN_GIGS_PER_POSTER) set.add('post_gig');
    if (c.shiftsToday < world.config.maxShiftsPerDay
      && openGigs(world, c.district).some((g) => g.posterId !== c.id && qualifiedFor(c, g))) set.add('take_gig');
  }
  if (c.district === DOCKS_DISTRICT && mayTrade(world, c)) {
    set.add('import');
    set.add('export');
  }
}

/** The galleries, the Stadium, the schools of thought and the papers. */
function cultureActions(world: World, c: Citizen, set: Set<ActionType>, here: Citizen[]): void {
  void here;
  const adult = c.lifeStage !== 'child';
  if (adult) {
    for (const kind of WORK_KINDS) {
      if (mayCreate(world, c, kind) && workVenue(world, kind, c.district)) { set.add('create_work'); break; }
    }
    const mine = worksOf(world, c.id);
    if (mine.some((w) => workVenue(world, w.kind, c.district) || world.buildings[w.home]?.district === c.district)) set.add('exhibit');
    const job = c.jobId ? world.jobs[c.jobId] : null;
    if (job && job.holderId === c.id && job.role === 'journalist'
      && Object.values(world.works ?? {}).some((w) => w.creatorId !== c.id && !w.reviews.some((r) => r.day === world.day))) {
      set.add('review');
    }
    if (!c.teamDistrict && Object.keys(world.teams ?? {}).length > 0) set.add('join_team');
    if (c.teamDistrict && groundFor(world, c)) set.add('train');
    if (!adoptedThisCycle(world, c.id)) set.add('adopt_school');
    if (cafeFor(world, c.id)) set.add('set_menu');
  }
  if (happeningsAt(world, c.district).some((h) => h.kind === 'match' && h.hour === world.hour)) set.add('attend_match');
  if (world.counters[`paper:${c.id}`] !== world.day) set.add('read_paper');
}

/** Where an apology is made: the district Central Plaza stands in. */
function apologyDistrict(world: World): DistrictId {
  return world.buildings[APOLOGY_VENUE]?.district ?? 'commons';
}

/** Rumour, apology, mentorship and the Commons feed. */
function fabricActions(world: World, c: Citizen, set: Set<ActionType>, here: Citizen[]): void {
  const adult = c.lifeStage !== 'child';
  const grown = grownHere(here);
  if (adult && grown.length > 0 && Object.keys(world.citizens).length > 2) set.add('gossip');
  if (adult && c.district === apologyDistrict(world) && feudsOf(world, c).length > 0
    && grown.some((o) => inFeud(world, c.id, o.id))) set.add('apologize');
  if (adult && mayMentor(world, c) && grown.some((o) => !o.mentorId && o.id !== c.id && !o.menteeId)) set.add('mentor');
  set.add('post');
  if (feedFor(world, c).some((p) => p.author !== c.id && p.youReacted === null)) set.add('react');
}

/**
 * Everything the metropolis puts in front of this citizen here and now. The
 * caller has already ruled out the exiled, the departed, the detained and the
 * jailed; suspension and childhood are filtered by the caller afterwards.
 */
export function metropolisActions(world: World, c: Citizen, set: Set<ActionType>, here: Citizen[]): void {
  if (!isPresent(world, c)) return;
  healthActions(world, c, set);
  politicsActions(world, c, set);
  marketActions(world, c, set);
  cultureActions(world, c, set, here);
  fabricActions(world, c, set, here);
}
