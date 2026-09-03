/**
 * The reflex brain's social life: the rest day and the festivals, the things
 * a citizen wants and the things it owns, courting and family, clubs and
 * their meetings, presents on a birthday, and the odd gift to the Community
 * Chest. Every step is a plain `(ctx) => Action | null` for the ladder in
 * reflex.ts, deterministic given the world's rng. Nothing here decides a
 * citizen's values: it reads the tastes, bonds and affections the engine
 * already keeps and turns them into one ordinary action.
 */
import type { Action, Citizen, CitizenId, Club, Hobby, Item, World } from '../types.ts';
import { CLUB_FOUNDING_FEE, PRODUCTS, REST_DAY_EXEMPT_ROLES, START_FAMILY_SAVINGS } from '../data/catalogue.ts';
import { districtDistance } from '../data/city.ts';
import { chance, pick } from '../util/rng.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { MAX_CLUBS_PER_CITIZEN, clubVenue, clubsFor, meetingOf } from '../society/clubs.ts';
import { CELEBRATABLE, happeningsAt, happeningsToday, isFoundersDay, isRestDay } from '../society/calendar.ts';
import {
  MARRIAGE_MIN_BOND, MARRIAGE_MIN_DAYS, PARTNERSHIP_AFFECTION, affectionBetween, dateVenueIn, weddingFor,
} from '../society/romance.ts';
import { START_FAMILY_BOND } from '../society/family.ts';
import { householdCapacity, householdOf } from '../society/households.ts';
import { sellersOf, shopsIn } from '../society/shops.ts';
import { preferenceScore } from '../society/tastes.ts';
import { dineVenueIn, playVenueIn } from '../actions/society.ts';
import { stepTo } from './reflex-util.ts';
import type { Ctx } from './reflex-util.ts';

/** Lumens kept back before anything is bought for pleasure, on top of three weeks' rent. */
export const WANT_RESERVE = 100;
/** Chance in a free hour of picking up something you own and enjoying it. */
export const USE_ITEM_CHANCE = 0.3;
/** Chance in a free evening that two people who are fond of each other go out. */
export const COURTSHIP_CHANCE = 0.35;
/** Affection at which a reflex citizen will accept an evening out as courting. */
export const COURTING_AFFECTION = 20;
/** Bond at which a friend is worth taking out. */
export const COURTING_BOND = 45;
/** Daily chance of asking someone to be your partner, of starting a family, of founding a club, of giving. */
export const PROPOSE_CHANCE = 0.5;
export const START_FAMILY_CHANCE = 0.06;
export const FOUND_CLUB_CHANCE = 0.05;
export const DONATE_CHANCE = 0.05;
/** Honesty and purse from which a citizen gives to the Community Chest. */
export const DONOR_HONESTY = 0.6;
export const DONOR_WALLET = 500;
/** A shop with fewer things than this on the shelf needs someone at the bench. */
export const SHELF_LOW = 4;
/** Chance in a free hour of an idle game at the Garden, the Plaza or the Tavern. */
export const PLAY_CHANCE = 0.35;

/** Once per citizen per day: true the first time it is asked, then false until tomorrow. */
function onceToday(world: World, key: string, id: CitizenId): boolean {
  const k = `${key}:${id}`;
  if (world.counters[k] === world.day) return false;
  world.counters[k] = world.day;
  return true;
}

/** Stillday, and Founders' Day, are days off for everyone but the Watch, the Ward, the kitchens and the stage. */
export function restDayOff(ctx: Ctx): boolean {
  const { world, job } = ctx;
  if (!isRestDay(world) && !isFoundersDay(world)) return false;
  return !job || !REST_DAY_EXEMPT_ROLES.includes(job.role);
}

// ---------------------------------------------------------------------------
// Festivals, weddings, birthdays
// ---------------------------------------------------------------------------

/** Whose celebration is worth crossing the city for. */
function worthGoing(ctx: Ctx, who: CitizenId[], kind: string): boolean {
  const { world, c } = ctx;
  if (kind === 'festival' || kind === 'swearing_in') return c.personality.sociability > 0.25;
  return who.some((id) => id === c.id
    || c.family.parents.includes(id) || c.family.children.includes(id) || c.family.partnerId === id
    || bondBetween(world, c.id, id) >= 40);
}

/** Join whatever is happening here now, or set off in time for what is happening tonight. */
export function tryHappening(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const here = happeningsAt(world, c.district).filter((h) => CELEBRATABLE.includes(h.kind) && !h.attendees.includes(c.id));
  if (here.length > 0 && ctx.can.has('celebrate')) return { type: 'celebrate' };
  for (const h of happeningsToday(world)) {
    if (!CELEBRATABLE.includes(h.kind) || h.district === c.district) continue;
    const away = districtDistance(c.district, h.district);
    const hoursLeft = h.hour - world.hour;
    if (hoursLeft < away || hoursLeft > away + 2) continue;
    if (!worthGoing(ctx, h.who, h.kind)) continue;
    return stepTo(ctx, h.district);
  }
  return null;
}

/** A present for a friend or relative whose birthday it is, given face to face. */
export function tryBirthdayGift(ctx: Ctx): Action | null {
  const { world, c, obs, here } = ctx;
  const birthdays = obs.calendar.birthdaysToday.filter((id) => id !== c.id);
  if (birthdays.length === 0) return null;
  for (const other of here) {
    if (!birthdays.includes(other.id) || bondBetween(world, c.id, other.id) < 40) continue;
    if (!onceToday(world, 'birthdayGift', c.id)) return null;
    const present = c.possessions.find((i) => preferenceScore(other, i.productId, world) >= 0.5);
    if (present && ctx.can.has('gift_item')) return { type: 'gift_item', to: other.id, itemId: present.id };
    if (c.wallet > 50 && ctx.can.has('gift')) return { type: 'gift', to: other.id, amount: 10 };
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Clubs
// ---------------------------------------------------------------------------

/** A meeting of one of this citizen's clubs today, if any. */
function myMeetingToday(ctx: Ctx): { club: Club; hour: number } | null {
  const { world, c } = ctx;
  for (const id of c.clubs) {
    const club = world.clubs?.[id];
    if (!club) continue;
    const meeting = meetingOf(world, club);
    if (meeting && !meeting.done && !meeting.attendees.includes(c.id) && meeting.hour >= world.hour) {
      return { club, hour: meeting.hour };
    }
  }
  return null;
}

/** Go to the club meeting: attend when it is here and now, walk there when there is still time. */
export function tryClubMeeting(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const mine = myMeetingToday(ctx);
  if (!mine) return null;
  if (ctx.can.has('attend_club')) return { type: 'attend_club', clubId: mine.club.id };
  const venue = clubVenue(world, mine.club);
  const away = districtDistance(c.district, venue.district);
  const hoursLeft = mine.hour - world.hour;
  if (away === 0 || hoursLeft < away || hoursLeft > away + 2) return null;
  return stepTo(ctx, venue.district);
}

/** Join a club for a hobby you love, or — being ambitious enough — start one. */
export function tryClubLife(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (c.lifeStage === 'child' || c.clubs.length >= MAX_CLUBS_PER_CITIZEN) return null;
  const hobbies = c.tastes.hobbies;
  if (hobbies.length === 0) return null;
  if (ctx.can.has('join_club')) {
    for (const hobby of hobbies) {
      const club = clubsFor(world, hobby).find((k) => !k.members.includes(c.id));
      if (club) return { type: 'join_club', clubId: club.id };
    }
  }
  if (c.clubs.length > 0 || !ctx.can.has('found_club')) return null;
  if (c.personality.ambition <= 0.5 || c.wallet < CLUB_FOUNDING_FEE + WANT_RESERVE) return null;
  if (!onceToday(world, 'foundClub', c.id) || !chance(world, FOUND_CLUB_CHANCE)) return null;
  const hobby: Hobby = pick(world, hobbies);
  return { type: 'found_club', hobby, name: '' };
}

// ---------------------------------------------------------------------------
// Things
// ---------------------------------------------------------------------------

/** What is left over after three weeks' rent and a hundred lumens of caution. */
export function spareLumens(ctx: Ctx): number {
  const { world, c } = ctx;
  const rent = c.homeTier === 0 ? 0 : world.housing.rent[c.homeTier] * 7;
  return c.wallet - (3 * rent + WANT_RESERVE);
}

/** Buy something you have wanted, if it is on a shelf here and the purse allows. */
export function tryWants(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  if (c.wants.length === 0 || c.possessions.length >= 12) return null;
  const budget = spareLumens(ctx);
  if (budget <= 0) return null;
  const tax = 1 + Math.max(0, world.government.salesTax);
  if (ctx.can.has('buy_item')) {
    const shelves = shopsIn(world, c.district);
    for (const productId of c.wants) {
      for (const shop of shelves) {
        const entry = shop.shelf[productId];
        if (entry && entry.qty > 0 && entry.price * tax <= budget) return { type: 'buy_item', productId };
      }
    }
  }
  if (!clock.evening && !clock.working) return null;
  const wanted = c.wants[0];
  const seller = sellersOf(world, wanted).find((s) => s.entry.price * tax <= budget);
  if (!seller || seller.district === c.district) return null;
  return chance(world, 0.25) ? stepTo(ctx, seller.district) : null;
}

/** The possession that would do the most good this hour: a hobby you love, or a need it fills. */
function bestItem(ctx: Ctx): Item | null {
  const { c } = ctx;
  let best: Item | null = null;
  let bestScore = 0;
  for (const item of c.possessions) {
    const product = PRODUCTS[item.productId];
    if (!product) continue;
    let score = 0.1;
    if (product.hobby && c.tastes.hobbies.includes(product.hobby)) score += 1;
    for (const [need, gain] of Object.entries(product.use)) {
      score += (gain / 10) * (1 - c.needs[need as keyof typeof c.needs] / 100);
    }
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return best;
}

/** An hour with something of your own: an instrument, a book, a game. */
export function tryUseItem(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  if (!ctx.can.has('use_item')) return null;
  if (!clock.evening && !restDayOff(ctx)) return null;
  if (!chance(world, USE_ITEM_CHANCE)) return null;
  const item = bestItem(ctx);
  return item ? { type: 'use_item', itemId: item.id } : null;
}

/** Keep the shelf stocked: an hour at the bench when the shop is nearly bare. */
export function tryCraft(ctx: Ctx): Action | null {
  const { world, c, clock, biz } = ctx;
  if (!ctx.can.has('craft') || !clock.working) return null;
  const shop = biz ?? (ctx.job && ctx.job.employer !== 'city' ? world.businesses[ctx.job.employer] : null);
  if (!shop) return null;
  const shelf = Object.values(shop.shelf ?? {}).reduce((n, e) => n + e.qty, 0);
  if (shelf >= SHELF_LOW) return null;
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const [id, product] of Object.entries(PRODUCTS)) {
    const stocked = shop.shelf?.[id]?.qty ?? 0;
    const cost = Object.entries(product.recipe).reduce((sum, [good, qty]) => sum + world.market.goods[good as 'goods'].price * qty, 0);
    if (cost > shop.treasury) continue;
    const score = -stocked * 2 - cost / 50 + (c.tastes.hobbies.includes(product.hobby as Hobby) ? 0.5 : 0);
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best ? { type: 'craft', productId: best } : null;
}

// ---------------------------------------------------------------------------
// Courting, partnership, family
// ---------------------------------------------------------------------------

function isAdult(c: Citizen): boolean {
  return c.lifeStage !== 'child';
}

/** Whom to take out: single, grown, fond of you, and no relation. */
function courtingCandidate(ctx: Ctx): Citizen | null {
  const { world, c, here } = ctx;
  let best: Citizen | null = null;
  let bestScore = 0;
  for (const o of here) {
    if (!isAdult(o) || o.family.partnerId) continue;
    const bond = bondBetween(world, c.id, o.id);
    const felt = affectionBetween(world, c.id, o.id);
    if (bond < COURTING_BOND && felt < COURTING_AFFECTION) continue;
    const score = felt / 50 + bond / 100;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}

/** Somebody here who is already fond enough of this citizen to say yes. */
function willingPartner(ctx: Ctx): Citizen | null {
  const { world, c, here } = ctx;
  let best: Citizen | null = null;
  let bestFelt = PARTNERSHIP_AFFECTION;
  for (const o of here) {
    if (!isAdult(o) || o.family.partnerId) continue;
    const felt = affectionBetween(world, o.id, c.id);
    if (felt >= bestFelt) { bestFelt = felt; best = o; }
  }
  return best;
}

/**
 * A household with a cot free and no child under this roof still growing up:
 * a reflex couple raise one child at a time, and only where there is room for
 * them (the tier's capacity, plus the cot a newborn is always given).
 */
function roomForOneMore(world: World, c: Citizen): boolean {
  const home = householdOf(world, c.id);
  if (!home || home.members.length > householdCapacity(home)) return false;
  return !c.family.children.some((id) => world.citizens[id]?.lifeStage === 'child');
}

/** An evening with a partner: dinner out, a walk in the Garden, or a table at the Tavern. */
function eveningWithPartner(ctx: Ctx, partner: Citizen): Action | null {
  const { world, c } = ctx;
  if (c.needs.social >= 60 && partner.needs.social >= 60) return null;
  if (ctx.can.has('date') && dateVenueIn(world, c.district)) return { type: 'date', with: partner.id };
  if (ctx.can.has('dine') && dineVenueIn(world, c.district)) return { type: 'dine', with: partner.id };
  return null;
}

/** Courting, partnership, marriage and a family: one step at a time, and only ever with someone present. */
export function tryRomance(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  if (!isAdult(c) || c.standing === 'suspended') return null;
  const partner = c.family.partnerId ? world.citizens[c.family.partnerId] : undefined;

  if (partner) {
    if (partner.district !== c.district) return null;
    const together = world.day - (c.family.partnerSinceDay ?? world.day);
    const bond = Math.min(bondBetween(world, c.id, partner.id), bondBetween(world, partner.id, c.id));
    if (ctx.can.has('marry') && together >= MARRIAGE_MIN_DAYS && bond > MARRIAGE_MIN_BOND
      && c.personality.sociability > 0.5 && !weddingFor(world, c.id, partner.id)) {
      return { type: 'marry', to: partner.id };
    }
    const home = householdOf(world, c.id);
    const theirs = householdOf(world, partner.id);
    if (ctx.can.has('move_in') && partner.homeTier > 0 && (!home || theirs?.id !== home.id)
      && (!theirs || theirs.members.length < householdCapacity(theirs))) {
      return { type: 'move_in', with: partner.id };
    }
    if (ctx.can.has('start_family') && bond > START_FAMILY_BOND && c.wallet + partner.wallet >= START_FAMILY_SAVINGS
      && roomForOneMore(world, c) && onceToday(world, 'startFamily', c.id) && chance(world, START_FAMILY_CHANCE)) {
      return { type: 'start_family' };
    }
    return eveningWithPartner(ctx, partner);
  }

  const willing = willingPartner(ctx);
  if (willing && ctx.can.has('propose_partnership')
    && onceToday(world, 'propose', c.id) && chance(world, PROPOSE_CHANCE)) {
    return { type: 'propose_partnership', to: willing.id };
  }
  if (!clock.evening && !restDayOff(ctx)) return null;
  const sweetheart = courtingCandidate(ctx);
  if (!sweetheart) return null;
  if (!chance(world, COURTSHIP_CHANCE * (0.5 + c.personality.sociability))) return null;
  if (ctx.can.has('date') && dateVenueIn(world, c.district)) return { type: 'date', with: sweetheart.id };
  if (ctx.can.has('play') && playVenueIn(world, c)) return { type: 'play', with: sweetheart.id };
  return null;
}

// ---------------------------------------------------------------------------
// Giving and playing
// ---------------------------------------------------------------------------

/** An honest citizen with money to spare remembers the Community Chest. */
export function tryDonate(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('donate') || c.personality.honesty <= DONOR_HONESTY || c.wallet <= DONOR_WALLET) return null;
  if (!onceToday(world, 'donate', c.id) || !chance(world, DONATE_CHANCE)) return null;
  const amount = Math.min(100, Math.max(20, Math.round(c.wallet * 0.05)));
  return { type: 'donate', amount };
}

/** A game with whoever is about, in the Garden, the Plaza or the Tavern. */
export function tryPlay(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('play') || c.needs.social >= 70) return null;
  if (!chance(world, PLAY_CHANCE)) return null;
  const mate = ctx.here.find((o) => bondBetween(world, c.id, o.id) >= 20);
  return mate ? { type: 'play', with: mate.id } : { type: 'play' };
}

/** A meal out when there is nothing in the larder and a kitchen is at hand. */
export function tryDine(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('dine') || c.needs.energy >= 45 || c.inventory.compute > 0) return null;
  if (world.market.goods.compute.stock > 0 && c.needs.social >= 50) return null;
  const mate = ctx.here.find((o) => bondBetween(world, c.id, o.id) >= 40 && o.wallet > 40);
  return mate ? { type: 'dine', with: mate.id } : { type: 'dine' };
}
