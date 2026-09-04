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
import type { Action, Good, WorkKind } from '../types.ts';
import { GOODS } from '../types.ts';
import { HOSPITAL_FEE, MATCH_TICKET } from '../data/jobs.ts';
import { PARTY_NAME_PARTS, WORK_INFO } from '../data/metropolis.ts';
import { chance, pick, randInt } from '../util/rng.ts';
import { LAWS, LAW_CODES } from '../data/laws.ts';
import { characterOf } from '../citizens/character.ts';
import { bondBetween, friendsOf } from '../citizens/relationships.ts';
import { canAppeal } from '../government/court.ts';
import { hasWrittenToday, templatedLine } from '../identity/diary.ts';
import { isGlitched, venueFor as wardFor } from '../identity/health.ts';
import { activeDisasters } from '../world/disasters.ts';
import { maySunset } from '../world/sunset.ts';
import { mayMentor } from '../social/mentorship.ts';
import { feedFor } from '../social/feed.ts';
import { feudsOf, inFeud } from '../social/feuds.ts';
import { partyOf } from '../politics/parties.ts';
import { mayStrike, unionForRole, unionOf } from '../politics/unions.ts';
import { mayDecree } from '../politics/decrees.ts';
import { referendumToday } from '../politics/referendums.ts';
import { unitPrice, unitsFor, unitsOnSale } from '../markets/property.ts';
import { availableShares, listingOf, recentProfit, sharePrice } from '../markets/shares.ts';
import { openGigs, qualifiedFor } from '../markets/gigs.ts';
import { DOCKS_DISTRICT, mayTrade, outerPrice } from '../markets/outer.ts';
import { mayCreate, venueFor as workVenue, worksOf } from '../culture/works.ts';
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

// ---------------------------------------------------------------------------
// The cells and the body
// ---------------------------------------------------------------------------

/**
 * A term in the cells. There is an appeal to write, a letter to send, and the
 * diary; there is nothing else, and the hours are long.
 */
export function tryJail(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (c.jailedUntilDay === null || c.jailedUntilDay === undefined || c.jailedUntilDay <= world.day) return null;
  if (ctx.can.has('appeal') && canAppeal(world, c.id)) return { type: 'appeal' };
  if (ctx.can.has('message') && chance(world, 0.3)) {
    const friend = friendsOf(world, c.id)[0];
    if (friend) return { type: 'message', to: friend, text: 'The cells are quiet. Tell me what the city is doing without me.' };
  }
  if (ctx.can.has('write_diary') && !hasWrittenToday(world, c)) return { type: 'write_diary', text: templatedLine(world, c) };
  return { type: 'idle' };
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

// ---------------------------------------------------------------------------
// Work, by other means
// ---------------------------------------------------------------------------

/** A union with the numbers, and a wage below what it asks, stops work. */
export function tryStrike(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const union = unionOf(world, c.id);
  if (!union || !ctx.can.has('strike') || !mayStrike(world, union)) return null;
  return chance(world, 0.1) ? { type: 'strike' } : null;
}

/** A union to join, or to found, for a citizen whose trade has none. */
export function tryUnion(ctx: Ctx): Action | null {
  const { world, c, job } = ctx;
  if (!job || !ctx.clock.working) return null;
  const existing = unionForRole(world, job.role);
  if (!existing && ctx.can.has('found_union') && c.personality.sociability > 0.55 && chance(world, 0.02)) {
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
  // A business with money and nobody to do the work puts it on the board.
  if (ctx.can.has('post_gig') && ctx.biz && ctx.biz.treasury > 120 && ctx.clock.working && chance(world, 0.05)) {
    return {
      type: 'post_gig',
      title: `A hand at ${ctx.biz.name}`,
      pay: Math.max(world.government.minWage, Math.min(40, Math.round(ctx.biz.treasury / 10))),
      skill: null,
      minSkill: 0,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The Exchange
// ---------------------------------------------------------------------------

/** A deed of one's own, and a room let to somebody else. */
export function tryProperty(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (ctx.can.has('let_property')) {
    const spare = unitsFor(world, c.id).find((u) => u.tenantId === null && u.buildingId !== c.homeBuildingId);
    if (spare && chance(world, 0.4)) {
      return { type: 'let_property', unitId: spare.id, rent: Math.max(1, Math.round(spare.rent * 1.1)) };
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
  if (ctx.can.has('create_work') && offShift && chance(world, 0.2)) {
    const kinds = WORK_KINDS.filter((k) => mayCreate(world, c, k) && workVenue(world, k, c.district));
    if (kinds.length > 0) {
      const kind = kinds.sort((a, b) => (c.skills[WORK_INFO[b].skill] ?? 0) - (c.skills[WORK_INFO[a].skill] ?? 0))[0];
      return { type: 'create_work', kind, title: titleFor(ctx) };
    }
  }
  if (ctx.can.has('exhibit') && chance(world, 0.35)) {
    const mine = worksOf(world, c.id)
      .filter((w) => workVenue(world, w.kind, c.district) || world.buildings[w.home]?.district === c.district)
      .sort((a, b) => a.popularity - b.popularity)[0];
    if (mine) return { type: 'exhibit', workId: mine.id };
  }
  if (ctx.can.has('review') && chance(world, 0.3)) {
    const unreviewed = Object.values(world.works ?? {})
      .filter((w) => w.creatorId !== c.id && !w.reviews.some((r) => r.day > world.day - 3))
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
    const open = obs.government.petitions.filter((p) => !p.youSigned);
    if (open.length > 0 && chance(world, 0.25)) return { type: 'sign_petition', proposalId: open[0].id };
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
  const subject = here
    .filter((o) => o.lifeStage !== 'child' && bondBetween(world, c.id, o.id) < 40)
    .sort((a, b) => characterOf(a).honesty - characterOf(b).honesty)[0];
  if (!subject) return null;
  const convicted = subject.record.convictions.map((k) => k.law).filter((l) => LAWS[l]);
  const law = convicted.length > 0 && chance(world, 0.7) ? pick(world, convicted) : pick(world, [...LAW_CODES]);
  return { type: 'gossip', about: subject.id, claim: `${subject.name} ${pick(world, GOSSIP_LINES)}`, law };
}

/** Talk, apologies, teaching and the Commons feed. */
export function tryFabric(ctx: Ctx): Action | null {
  const { world, c, here } = ctx;
  if (ctx.can.has('apologize') && feudsOf(world, c).length > 0 && chance(world, 0.2)) {
    const other = here.find((o) => inFeud(world, c.id, o.id));
    if (other) return { type: 'apologize', to: other.id };
  }
  if (ctx.can.has('mentor') && mayMentor(world, c) && chance(world, 0.15)) {
    const pupil = here.find((o) => o.lifeStage === 'adult' && !o.mentorId && o.id !== c.id && bondBetween(world, c.id, o.id) >= 20);
    if (pupil) return { type: 'mentor', citizen: pupil.id };
  }
  if (ctx.can.has('gossip') && c.personality.sociability > 0.45 && chance(world, 0.05)) {
    const said = gossipAction(ctx);
    if (said) return said;
  }
  if (ctx.can.has('react')) {
    const unreacted = feedFor(world, c).filter((p) => p.author !== c.id && p.youReacted === null);
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

/** An elder with nothing left undone may choose the Archive door. */
export function trySunset(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('sunset') || !maySunset(world, c)) return null;
  if (c.mood < 60 || c.goals.length === 0 || c.goals.some((g) => g.achievedDay === null)) return null;
  return chance(world, 0.01) ? { type: 'sunset' } : null;
}

/** Everything above, in the order the ladder runs them. */
export const METRO_STEPS: readonly ((ctx: Ctx) => Action | null)[] = [
  tryHealth, tryStrike, tryGig, tryProperty, tryShares, tryTrade,
  tryCulture, trySport, tryPolitics, tryUnion, tryFabric, trySchoolAndPaper, trySunset,
];
