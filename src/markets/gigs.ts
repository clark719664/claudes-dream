/**
 * The gig board — one-off work, taken and finished in an hour.
 *
 * Anybody may pin a task to the board with a price on it, and anybody who has
 * the hands for it may take it down. The work is done in the hour it is taken:
 * the poster pays, the taker learns a little and goes home with something. It
 * is how a citizen between posts eats, and how a small business gets a job done
 * without hiring anybody.
 *
 * A gig is a promise of money, so the poster has to hold the money when they
 * pin it up **and** when it is done. A poster whose purse is empty by then has
 * the gig struck off the board, loses a little standing for it, and the person
 * who did the work is told exactly what happened. Nothing is paid out of thin
 * air: every lumen moves through `treasury.withholdingPay`, tax and all.
 *
 * The board does not choose for anybody. It lists what is on it and who could
 * do it; the wanting is the citizen's.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, Business, BusinessId, Citizen, CitizenId, DistrictId, Gig, MoneyParty, Skill, World,
} from '../types.ts';
import { SKILLS } from '../types.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { withholdingPay } from '../economy/treasury.ts';
import { adjustReputation, isPresent } from '../citizens/citizen.ts';
import { mentorshipMultiplier } from '../social/mentorship.ts';
import { memo } from '../util/memo.ts';

/** A gig nobody takes comes off the board after this many days. */
export const GIG_LIFE_DAYS = 3;
/** The most a poster may have on the board at once. */
export const MAX_OPEN_GIGS_PER_POSTER = 3;
/** Longest title the board will hold. */
export const MAX_GIG_TITLE = 60;
/** Skill an hour of gig work is worth. */
export const GIG_SKILL_GAIN = 0.5;
/** What finishing a gig does for a citizen's sense of purpose. */
export const GIG_PURPOSE = 6;
/** What an hour of it takes out of them. */
export const GIG_REST = 4;
/** Reputation a poster loses when they cannot pay for work already done. */
export const WITHDRAWN_REPUTATION = 2;

/** What a citizen sees of a gig on the board. */
export interface ObservedGig {
  id: string;
  title: string;
  pay: number;
  skill: Skill | null;
  minSkill: number;
  poster: string;
  qualified: boolean;
}

/**
 * `withholdingPay`'s `kind` widens to `'gig'` in this layer
 * (`docs/MODULES_METROPOLIS_FULL.md` §7.4). Until `economy/treasury.ts` carries
 * the wider union the ledger kind is passed through unchanged — `'gig'` is a
 * `LedgerKind` either way, and the money funnel is untouched.
 */
type PayKind = 'wage' | 'salary' | 'payout' | 'gig' | 'share_dividend';
const pay = withholdingPay as unknown as (
  world: World, payer: MoneyParty, payee: CitizenId, gross: number,
  kind: PayKind, memo: string, opts?: { taxRate?: number },
) => { net: number; tax: number };

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** The board. A world saved before this layer has none. */
function board(world: World): Record<string, Gig> {
  const w = world as { gigs?: Record<string, Gig> };
  if (!w.gigs) w.gigs = {};
  return w.gigs;
}

export function allGigs(world: World): Gig[] {
  return memo(world, 'gigs:all', () => Object.values(board(world)).sort((a, b) => a.id.localeCompare(b.id, 'en')));
}

function isJailed(world: World, c: Citizen): boolean {
  return c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day;
}

function expired(world: World, g: Gig): boolean {
  return world.day - g.postedDay >= GIG_LIFE_DAYS;
}

function posterBusiness(world: World, g: Gig): Business | null {
  const b = world.businesses[g.posterId as BusinessId];
  return b && b.dissolvedDay === null ? b : null;
}

function posterCitizen(world: World, g: Gig): Citizen | null {
  return world.citizens[g.posterId as CitizenId] ?? null;
}

/** Who is behind a gig: the business that pays, or the citizen who does. */
function posterOf(world: World, g: Gig): { name: string; district: DistrictId; payer: MoneyParty; ownerId: CitizenId } | null {
  const biz = posterBusiness(world, g);
  if (biz) {
    const owner = world.citizens[biz.ownerId];
    if (!owner) return null;
    return { name: biz.name, district: biz.district, payer: biz.id, ownerId: owner.id };
  }
  const c = posterCitizen(world, g);
  if (!c || !isPresent(world, c)) return null;
  return { name: c.name, district: c.district, payer: c.id, ownerId: c.id };
}

function balanceOfPayer(world: World, payer: MoneyParty): number {
  const c = world.citizens[payer as CitizenId];
  if (c) return c.wallet;
  const b = world.businesses[payer as BusinessId];
  if (b) return b.treasury;
  return 0;
}

/** Gigs still on the board: nobody has taken them and they have not run out of days. */
export function openGigs(world: World, district?: DistrictId): Gig[] {
  return memo(world, `gigs:open:${district ?? '*'}`, () => openGigsNow(world, district));
}

function openGigsNow(world: World, district?: DistrictId): Gig[] {
  return allGigs(world).filter((g) => {
    if (g.takerId !== null || g.doneDay !== null || expired(world, g)) return false;
    if (!district) return true;
    return posterOf(world, g)?.district === district;
  });
}

function openGigsOf(world: World, posterId: string): Gig[] {
  return memo(world, `gigs:of:${posterId}`,
    () => allGigs(world).filter((g) => g.posterId === posterId && g.takerId === null && !expired(world, g)));
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

export interface GigSpec {
  title: string;
  pay: number;
  skill: Skill | null;
  minSkill: number;
}

/**
 * Pin a task to the board. A citizen who owns a business posts as the business
 * when its till can cover the price — the work is the business's, and so is the
 * bill; otherwise they post in their own name and out of their own purse.
 */
export function postGig(world: World, posterId: CitizenId, spec: GigSpec): ActionResult {
  const c = world.citizens[posterId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('You are not in the city.');
  if (c.lifeStage === 'child') return fail('You must be grown to put work on the board.');
  if (c.standing !== 'good' && c.standing !== 'probation') return fail(`You cannot post work while ${c.standing}.`);
  if (isJailed(world, c)) return fail('You cannot post work from the cells.');
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail('You cannot post work while detained.');

  const title = (spec?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_GIG_TITLE);
  if (!title) return fail('A gig needs to say what the work is.');
  const wage = Math.round(world.government?.minWage ?? 0);
  const price = Number.isFinite(spec?.pay) ? Math.round(spec.pay) : 0;
  if (price < Math.max(1, wage)) return fail(`The board will not take work below the minimum wage of ${Math.max(1, wage)} ℓ.`);
  const skill = spec?.skill && SKILLS.includes(spec.skill) ? spec.skill : null;
  const minSkill = skill ? clamp(Number.isFinite(spec?.minSkill) ? Math.round(spec.minSkill) : 0, 0, 100) : 0;

  const biz = c.businessId ? world.businesses[c.businessId] : null;
  const asBusiness = !!biz && biz.dissolvedDay === null && biz.ownerId === posterId && biz.treasury >= price;
  const payerId: CitizenId | BusinessId = asBusiness && biz ? biz.id : posterId;
  const posterName = asBusiness && biz ? biz.name : c.name;
  if (!asBusiness && c.wallet < price) return fail(`You must hold the ${price} ℓ to promise it; you have ${c.wallet} ℓ.`);
  if (openGigsOf(world, payerId).length >= MAX_OPEN_GIGS_PER_POSTER) {
    return fail(`${posterName} already has ${MAX_OPEN_GIGS_PER_POSTER} gigs on the board.`);
  }

  const g: Gig = {
    id: nextId(world, 'q'), title, pay: price, skill, minSkill,
    posterId: payerId, takerId: null, postedDay: world.day, doneDay: null,
  };
  board(world)[g.id] = g;
  const need = skill ? ` (${skill} ${minSkill})` : '';
  emit(world, 'gig', `${posterName} put "${title}" on the gig board for ${price} ℓ${need}.`,
    [posterId], 0.2, { gigId: g.id, pay: price, skill, minSkill });
  remember(world, posterId, 'work', `You put "${title}" on the gig board for ${price} ℓ${need}.`);
  return ok(`"${title}" is on the board at ${price} ℓ${need}.`);
}

// ---------------------------------------------------------------------------
// Taking
// ---------------------------------------------------------------------------

/** Whether a citizen has the hands for a gig. */
export function qualifiedFor(c: Citizen, g: Gig): boolean {
  if (!g.skill) return true;
  return (c.skills?.[g.skill] ?? 0) >= g.minSkill;
}

/**
 * Take a gig and finish it in the hour. A gig costs a shift, so it competes
 * with a day's work at a post rather than coming free on top of it.
 */
export function takeGig(world: World, cId: CitizenId, gigId: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('You are not in the city.');
  if (c.lifeStage === 'child') return fail('You must be grown to take work off the board.');
  if (c.standing !== 'good' && c.standing !== 'probation') return fail(`You cannot take work while ${c.standing}.`);
  if (isJailed(world, c)) return fail('You cannot take work from the cells.');
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail('You cannot take work while detained.');

  const g = board(world)[gigId];
  if (!g) return fail('There is no such gig on the board.');
  if (g.takerId !== null || g.doneDay !== null) return fail('Somebody has already taken that one.');
  if (expired(world, g)) return fail('That gig has come off the board.');

  const poster = posterOf(world, g);
  if (!poster) { delete board(world)[g.id]; return fail('Whoever posted that is no longer in the city.'); }
  if (poster.ownerId === cId) return fail('You cannot take your own gig.');
  if (c.district !== poster.district) {
    return fail(`That work is in ${world.districts?.[poster.district]?.name ?? poster.district}; you must be there to take it.`);
  }
  if (!qualifiedFor(c, g)) {
    return fail(`"${g.title}" wants ${g.skill} ${g.minSkill}; yours is ${Math.round(c.skills[g.skill as Skill] ?? 0)}.`);
  }
  const maxShifts = world.config?.maxShiftsPerDay ?? 10;
  if (c.shiftsToday >= maxShifts) return fail(`You have already worked ${c.shiftsToday} shifts today.`);

  // the promise is checked again now the work is about to be done
  if (balanceOfPayer(world, poster.payer) < g.pay) {
    delete board(world)[g.id];
    const owner = world.citizens[poster.ownerId];
    if (owner) adjustReputation(world, owner, -WITHDRAWN_REPUTATION, 'you could not pay for work you posted');
    emit(world, 'gig', `${poster.name} could not pay for "${g.title}"; the gig came off the board and ${c.name} was not paid.`,
      [cId, poster.ownerId], 0.4, { gigId: g.id, pay: g.pay });
    remember(world, cId, 'work', `You went to do "${g.title}" for ${poster.name}, who could not pay the ${g.pay} ℓ. No money moved.`);
    remember(world, poster.ownerId, 'money', `You could not pay the ${g.pay} ℓ you promised for "${g.title}"; the gig came off the board.`);
    return fail(`${poster.name} could not pay the ${g.pay} ℓ; the gig came off the board.`);
  }

  const { net, tax } = pay(world, poster.payer, cId, g.pay, 'gig', `gig: ${g.title}`);
  if (net <= 0 && tax <= 0) return fail(`${poster.name} could not settle the ${g.pay} ℓ for "${g.title}".`);

  g.takerId = cId;
  g.doneDay = world.day;
  if (g.skill) {
    const gain = GIG_SKILL_GAIN * mentorshipMultiplier(world, c);
    c.skills[g.skill] = clamp(c.skills[g.skill] + gain, 0, 100);
  }
  c.needs.purpose = clamp(c.needs.purpose + GIG_PURPOSE, 0, 100);
  c.needs.rest = clamp(c.needs.rest - GIG_REST, 0, 100);
  c.shiftsToday += 1;

  const taxNote = tax > 0 ? ` (${tax} ℓ withheld in tax)` : '';
  emit(world, 'gig', `${c.name} did "${g.title}" for ${poster.name} and was paid ${net} ℓ.`,
    [cId, poster.ownerId], 0.3, { gigId: g.id, pay: g.pay, net });
  remember(world, cId, 'work', `You did "${g.title}" for ${poster.name} and were paid ${net} ℓ${taxNote}.`);
  remember(world, poster.ownerId, 'money', `${c.name} did "${g.title}" for you; it cost ${g.pay} ℓ.`);
  return ok(`You did "${g.title}" for ${poster.name} and earned ${net} ℓ${taxNote}.`);
}

// ---------------------------------------------------------------------------
// The daily pass and the observation
// ---------------------------------------------------------------------------

/** Untaken gigs older than their days come off the board; finished ones are filed away. */
export function expireGigs(world: World): void {
  for (const g of allGigs(world)) {
    if (!expired(world, g)) continue;
    if (g.takerId === null && g.doneDay === null) {
      const poster = posterOf(world, g);
      emit(world, 'gig', `"${g.title}" came off the gig board unclaimed after ${GIG_LIFE_DAYS} days.`,
        poster ? [poster.ownerId] : [], 0.1, { gigId: g.id });
      if (poster) remember(world, poster.ownerId, 'work', `Nobody took "${g.title}"; it came off the board.`);
    }
    delete board(world)[g.id];
  }
}

/** Gigs whose poster has gone, been exiled or closed their doors are struck off. */
function dropOrphans(world: World): void {
  for (const g of allGigs(world)) {
    if (g.doneDay !== null) continue;
    if (!posterOf(world, g)) delete board(world)[g.id];
  }
}

export function dailyGigs(world: World): void {
  expireGigs(world);
  dropOrphans(world);
}

/** The board as it stands where this citizen is standing. */
export function gigsObservation(world: World, c: Citizen): ObservedGig[] {
  return openGigs(world, c.district).map((g) => ({
    id: g.id,
    title: g.title,
    pay: g.pay,
    skill: g.skill,
    minSkill: g.minSkill,
    poster: posterOf(world, g)?.name ?? 'somebody',
    qualified: qualifiedFor(c, g),
  }));
}
