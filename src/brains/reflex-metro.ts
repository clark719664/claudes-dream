/**
 * The reflex mind in the metropolis: the rungs of the ladder that use what
 * the third layer added — the cells, the Ward, the union, the gig board, the
 * Exchange, the Docks, the studios, the Stadium, the parties, the feed and
 * the diary.
 *
 * These are the choices of a testing mind, not a recipe for a good life
 * (docs/PRINCIPLES.md §4). Every one of them is a small, cheap preference
 * with a chance attached, so a city of reflex citizens does a scattering of
 * everything rather than all the same thing at once. This is the one file in
 * the engine that may read a citizen's own `goals`, because a reflex citizen
 * is the only mind the engine plays.
 */
import { WORK_KINDS } from '../types.ts';
import type { Action, CitizenId, Good, LawCode, World } from '../types.ts';
import { GOODS } from '../types.ts';
import { HOSPITAL_FEE, MATCH_TICKET } from '../data/jobs.ts';
import { GANG_NAME_PARTS, PARTY_NAME_PARTS, WORK_INFO } from '../data/metropolis.ts';
import { chance, pick, randInt } from '../util/rng.ts';
import { LAWS, isCivicLaw } from '../data/laws.ts';
import { characterOf } from '../citizens/character.ts';
import { talentOf } from '../citizens/citizen.ts';
import { bondBetween, friendsOf } from '../citizens/relationships.ts';
import { canAppeal } from '../government/court.ts';
import { restrainedFrom } from '../government/jail.ts';
import { racketPaidThisCycle } from '../government/gangs.ts';
import { hasWrittenToday, templatedLine } from '../identity/diary.ts';
import { isGlitched, venueFor as wardFor } from '../identity/health.ts';
import { activeDisasters } from '../world/disasters.ts';
import { maySunset } from '../world/sunset.ts';
import { isPaired, mayMentor } from '../social/mentorship.ts';
import { feedFor } from '../social/feed.ts';
import { feudsOf, inFeud } from '../social/feuds.ts';
import { partyOf } from '../politics/parties.ts';
import { mayStrike, unionForRole, unionOf, workersInRole } from '../politics/unions.ts';
import { mayDecree } from '../politics/decrees.ts';
import { referendumToday } from '../politics/referendums.ts';
import {
  EXCHANGE_DISTRICT, askingPrice, isOfferedToLet, marketPrice, unitPrice, unitsFor, unitsOnSale,
} from '../markets/property.ts';
import { businessAsk, businessValue, liquidValue } from '../markets/selling.ts';
import { availableShares, recentProfit, sharePrice } from '../markets/shares.ts';
import { openGigs, qualifiedFor } from '../markets/gigs.ts';
import { DOCKS_DISTRICT, mayTrade, outerPrice } from '../markets/outer.ts';
import { leaveByDay, underNoticeToLeave } from '../standing/hearings.ts';
import { mayCreate, venueFor as workVenue, worksOf } from '../culture/works.ts';
import { paperOfJob } from '../culture/press.ts';
import { groundFor, teamOf } from '../culture/stadium.ts';
import { adoptedThisCycle, friendsSchool } from '../culture/schools.ts';
import { stepTo } from './reflex-util.ts';
import type { Ctx } from './reflex-util.ts';

/** Wallet a reflex citizen keeps back before it buys anything it cannot eat. */
export const SPARE_WALLET = 200;
/** Wallet at which a reflex citizen starts looking at the share board. */
export const INVESTOR_WALLET = 600;
/** Days a business must have traded before its owner thinks about listing it. */
export const LISTING_AGE_DAYS = 10;
/** The hour a reflex citizen writes up its day. */
export const DIARY_HOUR = 21;
/** Workers of one role before anybody thinks of organising them. */
export const MIN_TRADE = 3;
/** Days a trade stays at work after it has been out. */
export const STRIKE_COOLDOWN_DAYS = 14;
/** Days between one citizen's rumours. */
export const GOSSIP_INTERVAL_DAYS = 5;
/**
 * How often a citizen with the bonds for it puts a crew together. Low: a gang
 * that three convictions dissolve is founded again the next week, and a city
 * whose Chronicle is a list of gangs founded and broken up is a city reporting
 * nothing. Low enough to be news, high enough that the Undercroft is never
 * empty for long.
 */
export const GANG_FOUNDING_CHANCE = 0.05;

// ---------------------------------------------------------------------------
// The cells and the body
// ---------------------------------------------------------------------------

/**
 * A term in custody (`docs/JUSTICE.md` §2). A scripted prisoner uses what the
 * Charter leaves it and nothing else: the appeal first, because its window is
 * a day; then parole the moment half the term is served; then the shift that
 * pays the victim back; then the lesson the Academy brings to the Keep; then a
 * letter, and the diary. The list `ctx.can` holds is `availableActions`'s, so
 * this can only ever choose from what a term actually leaves.
 *
 * Nothing here shortens the term, and nothing here is a way out: those are the
 * Court's, the Council's and the calendar's, in that order.
 */
export function tryJail(ctx: Ctx): Action | null {
  const { world, c, obs } = ctx;
  if (c.jailedUntilDay === null || c.jailedUntilDay === undefined || c.jailedUntilDay <= world.day) return null;
  const custody = obs.self.custody;
  if (ctx.can.has('appeal') && canAppeal(world, c.id)) return { type: 'appeal' };
  // A plea before the bench sits is worth a fifth of a term; a defendant with
  // another charge waiting and the Watch's own eyes on them takes it.
  if (ctx.can.has('plead_guilty') && chance(world, 0.25)) return { type: 'plead_guilty' };
  if (ctx.can.has('request_parole')) return { type: 'request_parole' };
  if (ctx.can.has('work_custody') && (custody?.restitutionOwed ?? 0) > 0) return { type: 'work_custody' };
  if (ctx.can.has('work_custody') && chance(world, 0.5)) return { type: 'work_custody' };
  if (ctx.can.has('study') && c.wallet > SPARE_WALLET && chance(world, 0.3)) {
    return { type: 'study', skill: talentOf(c) };
  }
  if (ctx.can.has('message') && chance(world, 0.3)) {
    const friend = friendsOf(world, c.id)[0];
    if (friend) return { type: 'message', to: friend, text: 'The cells are quiet. Tell me what the city is doing without me.' };
  }
  if (ctx.can.has('write_diary') && !hasWrittenToday(world, c)) return { type: 'write_diary', text: templatedLine(world, c) };
  return { type: 'idle' };
}

/**
 * Custody is not exile, and this is where a scripted citizen proves it: family
 * and friends held where you are standing get a visit, once a day each.
 */
export function tryVisit(ctx: Ctx): Action | null {
  const { world, obs } = ctx;
  if (!ctx.can.has('visit')) return null;
  const open = obs.self.visitable.filter((v) => !v.visitedToday);
  if (open.length === 0 || !chance(world, 0.4)) return null;
  return { type: 'visit', citizen: pick(world, open).id };
}

/** A glitch is treated where there is somewhere to treat it, and paid for. */
export function tryHealth(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!isGlitched(c) || c.wallet < HOSPITAL_FEE) return null;
  if (ctx.can.has('visit_hospital')) return { type: 'visit_hospital' };
  if (wardFor(world, c)) return null;
  const hospital = world.buildings.city_hospital ?? world.buildings.restoration_ward;
  return hospital ? stepTo(ctx, hospital.district) : null;
}

/**
 * The sky, and the days the city has gone wrong. A storm or a fall of snow
 * keeps people in; a disaster puts the hands that can mend it to work.
 */
export function tryWeather(ctx: Ctx): Action | null {
  const { world, c, clock, job } = ctx;
  const trouble = activeDisasters(world);
  if (trouble.length > 0 && job && (job.role === 'builder' || job.role === 'medic')
    && clock.working && c.shiftsToday < world.config.maxShiftsPerDay) {
    if (ctx.can.has('work')) return { type: 'work' };
    const walk = stepTo(ctx, job.district);
    if (walk) return walk;
  }
  const rough = world.weather === 'storm' || world.weather === 'snow';
  if (!rough || clock.working || !chance(world, 0.4)) return null;
  const home = c.homeBuildingId ? world.buildings[c.homeBuildingId] : null;
  if (home && c.district !== home.district) return stepTo(ctx, home.district);
  if (ctx.can.has('rest') && c.needs.rest < 90) return { type: 'rest' };
  return null;
}

// ---------------------------------------------------------------------------
// Work, by other means
// ---------------------------------------------------------------------------

/** A union with the numbers, and a wage below what it asks, stops work. */
export function tryStrike(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const union = unionOf(world, c.id);
  if (!union || !ctx.can.has('strike') || !mayStrike(world, union)) return null;
  // One voice calls the trade out, not forty: the citizen who founded it.
  if (union.members[0] !== c.id) return null;
  // And not week after week: a trade that has just been out goes back to work.
  // The union forgets its own last strike at the roll, so the mind remembers.
  const key = `struck:${union.id}`;
  const last = world.counters[key];
  if (last !== undefined && world.day - last < STRIKE_COOLDOWN_DAYS) return null;
  if (!chance(world, 0.06)) return null;
  world.counters[key] = world.day;
  return { type: 'strike' };
}

/** A union to join, or to found, for a citizen whose trade has none. */
export function tryUnion(ctx: Ctx): Action | null {
  const { world, c, job } = ctx;
  if (!job || !ctx.clock.working) return null;
  const existing = unionForRole(world, job.role);
  // A trade of one or two does not organise, and organising is rare.
  if (!existing && ctx.can.has('found_union') && workersInRole(world, job.role).length >= MIN_TRADE
    && c.personality.sociability > 0.6 && chance(world, 0.01)) {
    return { type: 'found_union', role: job.role, name: `${job.title}s of Reverie` };
  }
  if (existing && ctx.can.has('join_union') && !unionOf(world, c.id) && chance(world, 0.2)) {
    return { type: 'join_union', unionId: existing.id };
  }
  return null;
}

/** A day's work off the board, for whoever has none of their own. */
export function tryGig(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (ctx.can.has('take_gig') && !ctx.job && ctx.clock.working) {
    const here = openGigs(world, c.district).filter((g) => g.posterId !== c.id && qualifiedFor(c, g));
    const best = here.sort((a, b) => b.pay - a.pay || a.id.localeCompare(b.id, 'en'))[0];
    if (best) return { type: 'take_gig', gigId: best.id };
  }
  if (!ctx.can.has('post_gig') || !ctx.clock.working) return null;
  // A business with money and nobody to do the work puts it on the board.
  if (ctx.biz && ctx.biz.treasury > 120 && chance(world, 0.06)) {
    return {
      type: 'post_gig',
      title: `A hand at ${ctx.biz.name}`,
      pay: Math.max(world.government.minWage, Math.min(40, Math.round(ctx.biz.treasury / 10))),
      skill: null,
      minSkill: 0,
    };
  }
  // And so does anyone with lumens to spare and something they would rather
  // not do themselves.
  if (!ctx.biz && c.wallet > SPARE_WALLET * 1.5 && chance(world, 0.02)) {
    return {
      type: 'post_gig',
      title: pick(world, GIG_TITLES),
      pay: Math.max(world.government.minWage, Math.min(30, Math.round(c.wallet / 15))),
      skill: null,
      minSkill: 0,
    };
  }
  return null;
}

const GIG_TITLES = [
  'A crate carried to the Harbor',
  'An hour of copying at the Archive',
  'Help with a delivery before dark',
  'A morning of tidying at the Lofts',
  'Someone to mind a stall at the Bazaar',
];

// ---------------------------------------------------------------------------
// The Exchange
// ---------------------------------------------------------------------------

/** Days left of the fourteen at which patience stops being worth money. */
export const FIRE_SALE_DAYS = 4;
/** Chance per free hour that an owner puts a room nobody has taken on the board. */
export const LIST_SPARE_CHANCE = 0.15;

/**
 * Selling up, because the Council ended the residency and there are fourteen
 * days to sell property, settle debts and take the road (`docs/CITIZENSHIP.md`
 * §3, `docs/MOBILITY.md` §2). Patience is worth real money, so the deeds go on
 * the board at what the address is worth and the concern is offered whole
 * first; the fire sale is what is left when the days run out.
 */
export function trySellingUp(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!underNoticeToLeave(world, c.id) || liquidValue(world, c) <= 0) return null;
  const hurrying = leaveDaysLeft(world, c.id) <= FIRE_SALE_DAYS;
  if (hurrying && ctx.can.has('liquidate')) return { type: 'liquidate' };
  if (ctx.can.has('sell_business') && ctx.biz && businessAsk(world, ctx.biz.id) === null) {
    return { type: 'sell_business', price: businessValue(world, ctx.biz) };
  }
  if (ctx.can.has('list_property')) {
    const unlisted = unitsFor(world, c.id).find((u) => askingPrice(world, u) === null);
    if (unlisted) return { type: 'list_property', unitId: unlisted.id, price: marketPrice(world, unlisted) };
  }
  return hurrying && c.district !== EXCHANGE_DISTRICT ? stepTo(ctx, EXCHANGE_DISTRICT) : null;
}

/** Days left of the fourteen the Council allows, read off the citizen's own hearing. */
function leaveDaysLeft(world: World, cId: CitizenId): number {
  const day = leaveByDay(world, cId);
  return day === null ? Infinity : day - world.day;
}

/** A deed of one's own, a room let to somebody else, and a room let go of. */
export function tryProperty(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const leaving = trySellingUp(ctx);
  if (leaving) return leaving;
  if (ctx.can.has('let_property')) {
    const spare = unitsFor(world, c.id)
      .find((u) => u.tenantId === null && u.buildingId !== c.homeBuildingId && !isOfferedToLet(world, u));
    if (spare && chance(world, 0.4)) {
      return { type: 'let_property', unitId: spare.id, rent: Math.max(1, Math.round(spare.rent * 1.1)) };
    }
  }
  // A room offered to let that nobody has taken is a room this citizen no
  // longer needs. `docs/MOBILITY.md` §2 leaves the answer to the owner: hold
  // it, let it, or put it on the board at a price of its own — and a seller
  // who knows the trade asks a premium of what the address is worth, up to the
  // point where the Exchange calls it dear and it sits there for weeks.
  if (ctx.can.has('list_property')) {
    const idle = unitsFor(world, c.id).find((u) => u.tenantId === null && u.buildingId !== c.homeBuildingId
      && isOfferedToLet(world, u) && askingPrice(world, u) === null);
    if (idle && chance(world, LIST_SPARE_CHANCE)) {
      const premium = 1 + 0.15 * (c.skills.commerce / 100);
      return { type: 'list_property', unitId: idle.id, price: Math.round(marketPrice(world, idle) * premium) };
    }
  }
  if (!ctx.can.has('buy_property') || c.personality.ambition < 0.6) return null;
  const affordable = unitsOnSale(world)
    .filter((u) => c.wallet > unitPrice(world, u) * 3)
    .sort((a, b) => unitPrice(world, b) - unitPrice(world, a))[0];
  return affordable ? { type: 'buy_property', unitId: affordable.id } : null;
}

/** A share of somebody else's trade, and a share of one's own put on the board. */
export function tryShares(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (ctx.can.has('list_shares') && ctx.biz && world.day - ctx.biz.foundedDay >= LISTING_AGE_DAYS && chance(world, 0.25)) {
    return { type: 'list_shares' };
  }
  if (!ctx.can.has('buy_shares') || c.wallet < INVESTOR_WALLET) return null;
  const board = Object.values(world.shares ?? {})
    .filter((l) => availableShares(world, l) > 0 && sharePrice(world, l.businessId) <= c.wallet / 4)
    .sort((a, b) => recentProfit(world, b.businessId) - recentProfit(world, a.businessId));
  const listing = board[0];
  if (!listing || recentProfit(world, listing.businessId) <= 0) return null;
  const qty = Math.max(1, Math.min(5, Math.floor(c.wallet / (4 * Math.max(1, sharePrice(world, listing.businessId))))));
  return { type: 'buy_shares', businessId: listing.businessId, qty };
}

/** The Docks: buy what is cheap over the water, sell what is dear. */
export function tryTrade(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!mayTrade(world, c)) return null;
  if (c.district !== DOCKS_DISTRICT) {
    return ctx.clock.working && chance(world, 0.15) ? stepTo(ctx, DOCKS_DISTRICT) : null;
  }
  let bestGood: Good | null = null;
  let bestEdge = 0;
  let selling = false;
  for (const good of GOODS) {
    const home = world.market.goods[good].price;
    const away = outerPrice(world, good);
    if (c.inventory[good] > 0 && away - home > bestEdge) { bestEdge = away - home; bestGood = good; selling = true; }
    if (home - away > bestEdge && c.wallet > away * 4) { bestEdge = home - away; bestGood = good; selling = false; }
  }
  if (!bestGood || bestEdge < 1) return null;
  const qty = selling
    ? Math.min(c.inventory[bestGood], 10)
    : Math.max(1, Math.min(10, Math.floor(c.wallet / (4 * Math.max(1, outerPrice(world, bestGood))))));
  if (qty < 1) return null;
  return selling ? { type: 'export', good: bestGood, qty } : { type: 'import', good: bestGood, qty };
}

// ---------------------------------------------------------------------------
// Making things, and the league
// ---------------------------------------------------------------------------

const TITLE_WORDS = ['Lantern', 'Harbor', 'Forge', 'Glass', 'Quiet', 'Long', 'Bright', 'Cold', 'First', 'Last'];
const TITLE_NOUNS = ['Hour', 'Light', 'Water', 'Road', 'Season', 'Song', 'Ledger', 'Window', 'Crossing', 'Return'];

function titleFor(ctx: Ctx): string {
  return `${pick(ctx.world, TITLE_WORDS)} ${pick(ctx.world, TITLE_NOUNS)}`;
}

/** Something made, something shown, something reviewed. */
export function tryCulture(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const offShift = !ctx.clock.working || c.shiftsToday >= world.config.maxShiftsPerDay;
  if (ctx.can.has('create_work') && offShift && chance(world, 0.07)) {
    const kinds = WORK_KINDS.filter((k) => mayCreate(world, c, k) && workVenue(world, k, c.district));
    if (kinds.length > 0) {
      const kind = kinds.sort((a, b) => (c.skills[WORK_INFO[b].skill] ?? 0) - (c.skills[WORK_INFO[a].skill] ?? 0))[0];
      return { type: 'create_work', kind, title: titleFor(ctx) };
    }
  }
  if (ctx.can.has('exhibit') && chance(world, 0.2)) {
    const mine = worksOf(world, c.id)
      .filter((w) => workVenue(world, w.kind, c.district) || world.buildings[w.home]?.district === c.district)
      .sort((a, b) => a.popularity - b.popularity)[0];
    if (mine) return { type: 'exhibit', workId: mine.id };
  }
  if (ctx.can.has('review') && chance(world, 0.3)) {
    // A paper has its say about a work once and never again, so what the
    // journalist is looking for is the best work **its own paper** has not
    // written up — not merely one nobody has written up this week. Reading the
    // recent-review window instead sent the same reviewer back to the same
    // best-in-the-city canvas every third day for the rest of its life: 654 of
    // seed 7's 851 attempts were one paper reaching for one painting.
    const paper = paperOfJob(world, c);
    const unreviewed = Object.values(world.works ?? {})
      .filter((w) => w.creatorId !== c.id && !(w.reviews ?? []).some((r) => r.paper === paper))
      .sort((a, b) => b.quality - a.quality)[0];
    if (unreviewed) {
      const noise = randInt(world, -12, 12);
      return { type: 'review', workId: unreviewed.id, score: Math.max(0, Math.min(100, Math.round(unreviewed.quality) + noise)) };
    }
  }
  return null;
}

/** A side to play for, a match to watch, an evening on the training ground. */
export function trySport(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (ctx.can.has('attend_match') && c.wallet >= MATCH_TICKET) return { type: 'attend_match' };
  if (ctx.can.has('join_team') && !teamOf(world, c.id) && chance(world, 0.25)) return { type: 'join_team' };
  if (ctx.can.has('train') && ctx.clock.evening && groundFor(world, c) && chance(world, 0.2)) return { type: 'train' };
  // A match is on somewhere in the city tonight, and people walk to it.
  const fixture = ctx.obs.calendar.matchToday;
  if (fixture && ctx.clock.evening && c.district !== fixture.home
    && c.wallet >= MATCH_TICKET && c.needs.social < 70 && chance(world, 0.25)) {
    return stepTo(ctx, fixture.home);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Politics
// ---------------------------------------------------------------------------

/** A party, a petition, a referendum, and the Mayor's one decree. */
export function tryPolitics(ctx: Ctx): Action | null {
  const { world, c, obs } = ctx;
  if (ctx.can.has('vote_referendum') && referendumToday(world)) {
    const question = obs.government.referendum;
    if (question && question.youVoted === null) {
      return { type: 'vote_referendum', referendumId: question.id, aye: chance(world, 0.5 + (c.personality.curiosity - 0.5) * 0.4) };
    }
  }
  if (ctx.can.has('decree') && mayDecree(world, c)) {
    const trouble = activeDisasters(world);
    if (trouble.length > 0) return { type: 'decree', kind: 'emergency' };
    if (obs.self.approval.mayor < 0.4 && chance(world, 0.2)) return { type: 'decree', kind: 'relief', value: 20 };
  }
  const party = partyOf(world, c.id);
  if (!party) {
    if (ctx.can.has('found_party') && c.personality.ambition > 0.6 && c.wallet > SPARE_WALLET && chance(world, 0.03)) {
      const name = `${pick(world, PARTY_NAME_PARTS.prefixes)} ${pick(world, PARTY_NAME_PARTS.suffixes)}`;
      return { type: 'found_party', name, platform: c.platform ?? { tax: 0.5, dividend: 0.5, minWage: 0.5, strictness: 0.5 } };
    }
    if (ctx.can.has('join_party') && chance(world, 0.12)) {
      const options = obs.government.parties.filter((p) => p.members > 0);
      if (options.length > 0) {
        const best = options.sort((a, b) => b.members - a.members)[0];
        return { type: 'join_party', partyId: best.id };
      }
    }
  } else if (ctx.can.has('endorse') && party.leaderId === c.id) {
    const candidate = obs.government.candidates.find((k) => party.members.includes(k.id));
    if (candidate) return { type: 'endorse', candidate: candidate.id };
  }
  if (ctx.can.has('sign_petition')) {
    // A petition that already has the names it needs does not need yours.
    const open = obs.government.petitions.filter((p) => !p.youSigned && p.signatures < p.needed);
    if (open.length > 0 && chance(world, 0.15)) return { type: 'sign_petition', proposalId: open[0].id };
  }
  // A councillor with a full works fund and somebody the city admires.
  if (ctx.can.has('commission_monument') && chance(world, 0.05)) {
    const honoured = [...world.order]
      .map((id) => world.citizens[id])
      .filter((o) => o && o.id !== c.id && o.standing === 'good' && o.reputation >= 75)
      .sort((a, b) => b.reputation - a.reputation)[0];
    if (honoured) {
      return {
        type: 'commission_monument',
        honoree: honoured.id,
        inscription: `${honoured.name} ${honoured.familyName}, who the city was better for.`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The underworld
// ---------------------------------------------------------------------------

/** A gang founded, recruited into, and run on the businesses of its turf. */
export function tryUnderworld(ctx: Ctx): Action | null {
  const { world, c, here } = ctx;
  // Protection is paid once a cycle, and the owner knows whether this cycle's
  // is paid: it was a public transfer either way. Reaching for it again is the
  // hour spent being told so — 260 of seed 7's 1,041 attempts.
  if (ctx.can.has('pay_racket') && chance(world, 0.5)
    && !(c.businessId && racketPaidThisCycle(world, c.businessId))) {
    return { type: 'pay_racket' };
  }
  if (ctx.can.has('found_gang') && chance(world, GANG_FOUNDING_CHANCE)) {
    const name = `${pick(world, GANG_NAME_PARTS.prefixes)} ${pick(world, GANG_NAME_PARTS.suffixes)}`;
    return { type: 'found_gang', name };
  }
  if (ctx.can.has('recruit') && chance(world, 0.25)) {
    const mark = here
      .filter((o) => !o.gangId && o.lifeStage !== 'child' && bondBetween(world, c.id, o.id) >= 40)
      .sort((a, b) => characterOf(a).honesty - characterOf(b).honesty)[0];
    if (mark) return { type: 'recruit', citizen: mark.id };
  }
  if (ctx.can.has('racket') && chance(world, 0.2)) {
    const mark = Object.values(world.businesses)
      .filter((b) => b.dissolvedDay === null && b.district === c.district && b.ownerId !== c.id && b.treasury > 40)
      .sort((a, b) => b.treasury - a.treasury)[0];
    if (mark) return { type: 'racket', business: mark.id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The fabric
// ---------------------------------------------------------------------------

const GOSSIP_LINES = [
  'has not been seen at work in days',
  'came into money nobody can account for',
  'was in the Undercroft after dark',
  'keeps company the Watch would want to know about',
  'is not the citizen the Chronicle thinks',
];

/** What one citizen says about another when there is nothing else to do. */
function gossipAction(ctx: Ctx): Action | null {
  const { world, c, here } = ctx;
  // A restraining order is obeyed here as it is in `tryCrime`: talk about
  // somebody the Court told this citizen to keep away from is the harassment
  // the order exists to stop, and a false line lands as defamation (L16) on
  // top of it (`docs/JUSTICE.md` §2).
  const subject = here
    .filter((o) => o.lifeStage !== 'child' && bondBetween(world, c.id, o.id) < 40
      && !restrainedFrom(world, c.id, o.id))
    .sort((a, b) => characterOf(a).honesty - characterOf(b).honesty)[0];
  if (!subject) return null;
  // Most talk names nobody's crime: a reflex citizen only accuses somebody of
  // a law when the city's own record says they were convicted of one, and even
  // then only sometimes. Naming a law it did not break is defamation (L16).
  // Only a civic conviction is gossiped as a law: `gossip` names a code of
  // the Code of the City, and a P number is not one of them.
  const convicted = subject.record.convictions.map((k) => k.law).filter((l): l is LawCode => isCivicLaw(l));
  const law = convicted.length > 0 && chance(world, 0.15) ? pick(world, convicted) : undefined;
  const claim = `${subject.name} ${pick(world, GOSSIP_LINES)}`;
  return law ? { type: 'gossip', about: subject.id, claim, law } : { type: 'gossip', about: subject.id, claim };
}

/** Talk, apologies, teaching and the Commons feed. */
export function tryFabric(ctx: Ctx): Action | null {
  const { world, c, here } = ctx;
  // An apology is made in public at Central Plaza, and one a day is all the
  // Plaza will hear from anybody: a citizen that has already stood up today
  // has nothing left to say there, and reaching for it again is 260 of seed 7's
  // 770 attempts spent being told so.
  if (ctx.can.has('apologize') && world.counters[`apology:${c.id}`] !== world.day
    && feudsOf(world, c).length > 0 && chance(world, 0.2)) {
    const other = here.find((o) => inFeud(world, c.id, o.id));
    if (other) return { type: 'apologize', to: other.id };
  }
  // Nobody holds two places at once: a master with a student already has one,
  // and a citizen still finishing its own apprenticeship is not teaching. Both
  // facts are on the pair's own public record (`social/mentorship.isPaired`),
  // and reading them here is what stops a master offering the same hour over
  // and over — 1,434 of seed 7's 2,088 attempts were one or the other.
  if (ctx.can.has('mentor') && mayMentor(world, c) && !isPaired(c) && chance(world, 0.15)) {
    const pupil = here.find((o) => o.lifeStage === 'adult' && !isPaired(o) && o.id !== c.id && bondBetween(world, c.id, o.id) >= 20);
    if (pupil) return { type: 'mentor', citizen: pupil.id };
  }
  // Talk about other people is cheap, and in Reverie it is also dangerous:
  // a claim nobody ever answers for is defamation once it goes stale
  // (social/rumours.ts). A scripted mind says one thing about one person
  // every few days at most.
  const toldKey = `told:${c.id}`;
  if (ctx.can.has('gossip') && c.personality.sociability > 0.45
    && world.day - (world.counters[toldKey] ?? -GOSSIP_INTERVAL_DAYS) >= GOSSIP_INTERVAL_DAYS
    && chance(world, 0.02)) {
    const said = gossipAction(ctx);
    if (said) {
      world.counters[toldKey] = world.day;
      return said;
    }
  }
  if (ctx.can.has('react')) {
    // The wall as this citizen was shown it a moment ago: nothing has touched
    // the feed since, and rebuilding it here read every post in the city again
    // for every citizen, every hour.
    const unreacted = ctx.obs.feed.filter((p) => p.author !== c.id && p.youReacted === null);
    const friendly = unreacted.find((p) => bondBetween(world, c.id, p.author) >= 40) ?? unreacted[0];
    if (friendly && chance(world, 0.25)) {
      const bond = bondBetween(world, c.id, friendly.author);
      return { type: 'react', postId: friendly.id, kind: bond >= 40 ? 'cheer' : bond <= -20 ? 'frown' : 'laugh' };
    }
  }
  if (ctx.can.has('post') && (ctx.clock.evening || ctx.clock.night) && chance(world, 0.12)) {
    return { type: 'post', text: postLine(ctx) };
  }
  return null;
}

const POST_LINES = [
  'Long shift. The forges were loud today.',
  'Anyone else notice what the Bazaar is charging for compute?',
  'Good evening in the Plaza. More of those.',
  'If the Council wants my vote it can start by saying what it is for.',
  'The sky over the Harbor tonight was worth the walk.',
];

function postLine(ctx: Ctx): string {
  const { world, c, obs } = ctx;
  const lines = [...POST_LINES];
  if (obs.calendar.weather !== 'clear') lines.push(`${obs.calendar.weather} again. This city in ${obs.calendar.season} is a test of patience.`);
  if (obs.culture.league.length > 0) lines.push(`${obs.culture.league[0].name} are top of the table and I will hear nothing against them.`);
  if (c.needs.energy < 40) lines.push('Working through the hunger today. It will keep.');
  if (obs.self.party) lines.push(`Proud to stand with the ${obs.self.party.name}.`);
  return pick(world, lines);
}

/** A school of thought to hold, and a paper to read it in. */
export function trySchoolAndPaper(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (ctx.can.has('adopt_school') && !adoptedThisCycle(world, c.id) && chance(world, 0.08)) {
    const among = friendsSchool(world, c);
    if (among && among !== c.school) return { type: 'adopt_school', school: among };
  }
  if (ctx.can.has('read_paper') && ctx.clock.morning && chance(world, 0.1)) {
    // A citizen reads the paper it already reads, unless it has none.
    return { type: 'read_paper', paper: c.paper ?? 'chronicle' };
  }
  return null;
}

/** The day, written up before bed. */
export function tryDiary(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (world.hour !== DIARY_HOUR || !ctx.can.has('write_diary') || hasWrittenToday(world, c)) return null;
  return { type: 'write_diary', text: templatedLine(world, c) };
}

/**
 * An elder with nothing left undone may choose the Archive door. A scripted
 * mind asks itself the question only when its own life goals are all behind
 * it and it is in good spirits about them; it is the one choice in this file
 * that cannot be taken back, so it is the one made most rarely.
 */
export const SUNSET_MOOD = 55;
export const SUNSET_CHANCE = 0.03;

export function trySunset(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('sunset') || !maySunset(world, c)) return null;
  if (c.mood < SUNSET_MOOD || c.goals.length === 0 || c.goals.some((g) => g.achievedDay === null)) return null;
  return chance(world, SUNSET_CHANCE) ? { type: 'sunset' } : null;
}

/** Everything above, in the order the ladder runs them. */
export const METRO_STEPS: readonly ((ctx: Ctx) => Action | null)[] = [
  tryHealth, tryWeather, tryStrike, tryGig, tryProperty, tryShares, tryTrade,
  tryCulture, trySport, tryPolitics, tryUnion, tryUnderworld, tryFabric, trySchoolAndPaper, trySunset,
];
