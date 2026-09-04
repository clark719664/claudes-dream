/**
 * `GET /api/profile/:id` — one citizen's page: the face the city draws for
 * them, how they are introduced, the story of their life so far, their
 * ambitions and how far along each is, their family tree and their web of
 * friends and rivals, what they own, where they belong, what they have made,
 * what the Court has said of them, and what they have said themselves.
 *
 * Four things are never on it, and never will be: the citizen's own notes, the
 * letters it writes home, the key that answers for it, and the traits it was
 * rolled with (docs/PRINCIPLES.md §2 and §5). The profile is built from public
 * facts alone — record, character, offices, family, works and words.
 */
import type { Case, Citizen, CitizenId, World } from '../types.ts';
import { GOAL_INFO } from '../data/metropolis.ts';
import { LAWS } from '../data/laws.ts';
import { characterOf } from '../citizens/character.ts';
import { isDetained } from '../citizens/citizen.ts';
import { bondBetween, friendsOf, rivalsOf } from '../citizens/relationships.ts';
import { employerName } from '../economy/jobs.ts';
import { ageOf, familyOf } from '../society/family.ts';
import { biography, epithet, timeline } from '../identity/biography.ts';
import { portraitSvg, PORTRAIT_SIZE } from '../identity/portrait.ts';
import { goalsObservation } from '../identity/goals.ts';
import { diaryOf } from '../identity/diary.ts';
import { worksOf, homeName, reviewScore } from '../culture/works.ts';
import { teamOf } from '../culture/stadium.ts';
import { schoolName, schoolOf } from '../culture/schools.ts';
import { partyOf } from '../politics/parties.ts';
import { keptShare, promisesOf, PROMISE_WORDS } from '../politics/promises.ts';
import { unionOf } from '../politics/unions.ts';
import { gangOf } from '../government/gangs.ts';
import { daysLeft, isJailed, jailCaseOf } from '../government/jail.ts';
import { pendingCasesFor } from '../government/court.ts';
import { postsBy } from '../social/feed.ts';
import { feudsOf } from '../social/feuds.ts';
import { neighboursOf } from '../social/neighbours.ts';
import { rumoursAbout } from '../social/rumours.ts';
import { tenancyOf, unitsFor } from '../markets/property.ts';
import { sharePrice } from '../markets/shares.ts';
import { memorialOf, monumentsTo } from '../world/history.ts';
import { isPresentIn, nameOf, personCard, personCards, portraitPath, presentSet } from './views.ts';
import { affectionsView, citizenClubsView, citizenHouseholdView, possessionsView, wantsView } from './views-society.ts';
import { mindLabel } from './owners.ts';

/** Friends, rivals and affections listed on a profile. */
export const RELATION_VIEW_LENGTH = 12;
/** Public posts shown on a profile, newest first. */
export const POSTS_VIEW_LENGTH = 20;

function relationRow(world: World, selfId: CitizenId, ids: readonly CitizenId[], present: Set<CitizenId>, max: number) {
  const out: Record<string, unknown>[] = [];
  for (const id of ids) {
    const card = personCard(world, id, present);
    if (!card) continue;
    out.push({ ...card, bond: Math.round(bondBetween(world, selfId, id)) });
    if (out.length >= max) break;
  }
  return out;
}

/** The small graph the dashboard draws around one citizen. */
function web(world: World, c: Citizen, present: Set<CitizenId>): Record<string, unknown> {
  const nodes = new Map<CitizenId, Record<string, unknown>>();
  const links: Record<string, unknown>[] = [];
  const self = personCard(world, c.id, present);
  if (self) nodes.set(c.id, { ...self, relation: 'self' });
  const add = (id: CitizenId, relation: string, value: number): void => {
    const card = personCard(world, id, present);
    if (!card || id === c.id) return;
    if (!nodes.has(id)) nodes.set(id, { ...card, relation });
    links.push({ from: c.id, to: id, kind: relation, value: Math.round(value) });
  };
  for (const { id, relation } of familyOf(world, c.id)) add(id, relation, bondBetween(world, c.id, id));
  for (const id of friendsOf(world, c.id).slice(0, RELATION_VIEW_LENGTH)) add(id, 'friend', bondBetween(world, c.id, id));
  for (const id of rivalsOf(world, c.id).slice(0, RELATION_VIEW_LENGTH)) add(id, 'rival', bondBetween(world, c.id, id));
  return { nodes: [...nodes.values()], links };
}

function familyTree(world: World, c: Citizen, present: Set<CitizenId>): Record<string, unknown> {
  const members = familyOf(world, c.id).map(({ id, relation }) => {
    const card = personCard(world, id, present);
    return card ? { ...card, relation, bond: Math.round(bondBetween(world, c.id, id)) } : null;
  }).filter((m): m is NonNullable<typeof m> => m !== null);
  const of = (relation: string) => members.filter((m) => m.relation === relation);
  const partnerId = c.family?.partnerId ?? null;
  const partnerCard = partnerId ? personCard(world, partnerId, present) : null;
  return {
    partner: partnerCard ? {
      ...partnerCard, married: c.family.married, since: c.family.partnerSinceDay,
      affection: Math.round(c.affection?.[partnerId as CitizenId] ?? 0),
    } : null,
    parents: of('parent'),
    children: of('child'),
    siblings: of('sibling'),
    all: members,
    familyName: c.familyName,
    household: citizenHouseholdView(world, c, present),
  };
}

function recordOf(world: World, c: Citizen): Record<string, unknown> {
  const cases = Object.values(world.cases)
    .filter((k: Case) => k.defendantId === c.id)
    .sort((a, b) => b.filedTick - a.filedTick)
    .map((k) => ({
      id: k.id, law: k.law, lawName: LAWS[k.law]?.name ?? k.law, severity: k.severity, status: k.status,
      verdict: k.verdict, day: Math.floor(k.filedTick / 24), triedDay: k.triedDay, sentence: k.sentence,
      jury: (k.jury ?? []).length, advocateId: k.advocateId ?? null,
      advocate: k.advocateId ? nameOf(world, k.advocateId) : null,
    }));
  const ban = [...world.bans].reverse().find((b) => b.citizenId === c.id) ?? null;
  return {
    convictions: (c.record?.convictions ?? []).map((v) => ({
      ...v, lawName: LAWS[v.law]?.name ?? v.law,
    })),
    strikes: c.record?.strikes ?? 0,
    standing: c.standing,
    probationUntilDay: c.probationUntilDay,
    suspendedUntilDay: c.suspendedUntilDay,
    communityServiceDaysLeft: c.communityServiceDaysLeft,
    finesOwed: c.finesOwed,
    detained: isDetained(world, c),
    jailed: isJailed(c),
    jailedUntilDay: c.jailedUntilDay ?? null,
    jailDaysLeft: daysLeft(world, c),
    jailCaseId: jailCaseOf(world, c.id),
    pendingCharges: pendingCasesFor(world, c.id).length,
    cases,
    ban: ban ? {
      day: ban.day, caseId: ban.caseId, law: ban.law, lawName: LAWS[ban.law]?.name ?? ban.law,
      appealed: ban.appealed, appealResult: ban.appealResult, pardonedDay: ban.pardonedDay,
    } : null,
    exiledDay: c.exiledDay ?? null,
    sunsetDay: c.sunsetDay ?? null,
    memorial: memorialOf(world, c.id),
    monuments: monumentsTo(world, c.id),
  };
}

function belongings(world: World, c: Citizen, present: Set<CitizenId>): Record<string, unknown> {
  const tenancy = tenancyOf(world, c.id);
  return {
    wallet: c.wallet,
    inventory: c.inventory,
    possessions: possessionsView(c),
    wants: wantsView(c),
    homeTier: c.homeTier,
    homeBuildingId: c.homeBuildingId ?? null,
    homeBuildingName: c.homeBuildingId ? world.buildings[c.homeBuildingId]?.name ?? c.homeBuildingId : null,
    tenancy: tenancy ? { id: tenancy.id, buildingId: tenancy.buildingId, rent: tenancy.rent, tier: tenancy.tier } : null,
    property: unitsFor(world, c.id).map((u) => ({
      id: u.id, kind: u.kind, tier: u.tier, buildingId: u.buildingId,
      buildingName: world.buildings[u.buildingId]?.name ?? u.buildingId,
      rent: u.rent, tenantId: u.tenantId,
      tenant: u.tenantId ? nameOf(world, u.tenantId) ?? world.businesses[u.tenantId]?.name ?? null : null,
    })),
    shares: Object.entries(c.shares ?? {})
      .filter(([, qty]) => qty > 0)
      .map(([businessId, qty]) => ({
        businessId, name: world.businesses[businessId]?.name ?? businessId,
        qty, price: sharePrice(world, businessId), value: qty * sharePrice(world, businessId),
      })),
    loan: c.loanId ? world.loans[c.loanId] ?? null : null,
    neighbours: personCards(world, neighboursOf(world, c.id).map((n) => n.id), present, RELATION_VIEW_LENGTH),
  };
}

/** `GET /api/profile/:id`; null when the registry has never heard of the id. */
export function profileView(world: World, id: CitizenId): Record<string, unknown> | null {
  const c = world.citizens[id];
  if (!c) return null;
  const present = presentSet(world);
  const job = c.jobId ? world.jobs[c.jobId] : null;
  const held = job && job.holderId === c.id ? job : null;
  const biz = c.businessId ? world.businesses[c.businessId] ?? null : null;
  const party = partyOf(world, c.id);
  const union = unionOf(world, c.id);
  const gang = gangOf(world, c.id);
  const team = teamOf(world, c.id);
  const school = schoolOf(c);
  const promises = promisesOf(world, c.id);

  return {
    id: c.id, name: c.name, familyName: c.familyName, lineage: c.lineage,
    brain: c.brain, mind: mindLabel(c),
    epithet: epithet(world, c),
    portraitSvg: portraitSvg(world, c, PORTRAIT_SIZE),
    portrait: portraitPath(c.id),
    story: biography(world, c.id),
    lifeStage: c.lifeStage, age: ageOf(world, c), arrivedDay: c.arrivedDay, bornDay: c.bornDay,
    district: c.district, districtName: world.districts[c.district]?.name ?? c.district,
    present: isPresentIn(world, c, present),
    standing: c.standing, office: c.office, judgeTermEndsDay: c.judgeTermEndsDay,
    reputation: Math.round(c.reputation), mood: Math.round(c.mood),
    needs: c.needs, skills: c.skills, character: characterOf(c),
    health: { ...(c.health ?? { glitched: false, sinceDay: null }) },
    approval: c.approval ?? { mayor: 0.5, council: 0.5 },
    paper: c.paper ?? 'chronicle',
    goals: goalsObservation(world, c).map((g) => ({ ...g, label: GOAL_INFO[g.kind]?.label ?? g.kind })),
    milestones: [...(c.milestones ?? [])],
    timeline: timeline(world, c.id),
    diary: diaryOf(world, c.id),
    job: held ? {
      id: held.id, title: held.title, role: held.role, employerId: held.employer,
      employer: employerName(world, held), district: held.district,
      wage: Math.max(world.government.minWage, held.wage),
    } : null,
    business: biz ? {
      id: biz.id, name: biz.name, kind: biz.kind, district: biz.district,
      treasury: biz.treasury, employees: biz.employees.length, foundedDay: biz.foundedDay, dissolvedDay: biz.dissolvedDay,
    } : null,
    family: familyTree(world, c, present),
    relationships: {
      friends: relationRow(world, c.id, friendsOf(world, c.id), present, RELATION_VIEW_LENGTH),
      rivals: relationRow(world, c.id, rivalsOf(world, c.id), present, RELATION_VIEW_LENGTH),
      affections: affectionsView(world, c, RELATION_VIEW_LENGTH),
      feuds: feudsOf(world, c).map((f) => ({ families: f.families, sinceDay: f.sinceDay, incidents: f.incidents })),
      mentor: personCard(world, c.mentorId ?? null, present),
      mentee: personCard(world, c.menteeId ?? null, present),
      web: web(world, c, present),
    },
    clubs: citizenClubsView(world, c),
    team: team ? {
      district: team.district, name: team.name, wins: team.wins, losses: team.losses, draws: team.draws,
      size: team.players.length,
    } : null,
    party: party ? {
      id: party.id, name: party.name, platform: party.platform, seats: party.seats,
      isLeader: party.leaderId === c.id, isFounder: party.founderId === c.id, size: party.members.length,
    } : null,
    school: school ? { school, name: schoolName(school) } : null,
    union: union ? {
      id: union.id, name: union.name, role: union.role, demandWage: union.demandWage,
      striking: union.strikingUntilDay !== null && union.strikingUntilDay >= world.day,
    } : null,
    gang: gang ? {
      id: gang.id, name: gang.name, turf: gang.turf, isBoss: gang.bossId === c.id,
      foundedDay: gang.foundedDay, bustedDay: gang.bustedDay,
    } : null,
    promises: promises.map((p) => ({
      field: p.field, wanted: Math.round(p.wanted * 100) / 100, madeDay: p.madeDay, state: p.state,
      words: p.wanted >= 0.5 ? PROMISE_WORDS[p.field].up : PROMISE_WORDS[p.field].down,
    })),
    promisesKept: promises.length > 0 ? keptShare(world, c.id) : null,
    platform: c.platform,
    works: worksOf(world, c.id).map((w) => ({
      id: w.id, kind: w.kind, title: w.title, createdDay: w.createdDay,
      quality: Math.round(w.quality), popularity: Math.round(w.popularity),
      inMuseum: !!w.inMuseum, home: w.home, homeName: homeName(world, w), reviewScore: reviewScore(w),
    })),
    posts: postsBy(world, c.id)
      .slice(-POSTS_VIEW_LENGTH)
      .reverse()
      .map((p) => ({
        id: p.id, day: p.day, text: p.text,
        reactionCount: Object.keys(p.reactions ?? {}).length,
      })),
    rumours: rumoursAbout(world, c.id).map((r) => ({
      id: r.id, claim: r.claim, day: r.day, heard: r.heardBy.length,
      law: r.law, lawName: r.law ? LAWS[r.law]?.name ?? r.law : null, disprovedDay: r.disprovedDay,
    })),
    belongings: belongings(world, c, present),
    record: recordOf(world, c),
    stats: c.stats,
  };
}
