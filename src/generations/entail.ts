/**
 * The entail: what a house holds, and why nobody can sell it (`docs/GENERATIONS.md` §4).
 *
 * A founded House is a party in the ledger like a business. It holds property
 * (`convey_to_house`), businesses (`convey_business_to_house`) and a treasury
 * (`endow_house`), and all of it is **entailed**: no member may sell one, and
 * none of it forms part of any member's estate or pays duty when a member
 * sunsets. That is what an entail is for, and it is the loophole every estate
 * duty has had.
 *
 * **The Council prices it rather than closing it.** Entailed holdings pay a
 * house levy each cycle on their land value, 0–5 % by `house_levy` proposal
 * and 1 % at the founding, so a house holding more land than its members can
 * pay for sells, or is sold up by the Exchange at 60–75 % of what it is worth.
 * The levy is argued in a chamber where the great houses have relatives, and
 * this file has no opinion about how that goes.
 *
 * The house treasury is a **strongbox** (`finance/box.ts`): a real money party
 * the audit already sums, so every lumen a house holds is in the supply and
 * nothing here creates or destroys one.
 */
import type { ActionResult, BusinessId, CitizenId, PropertyUnit, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens } from '../economy/treasury.ts';
import { isPresent } from '../citizens/citizen.ts';
import { rand } from '../util/rng.ts';
import { boxBalance, moveThroughBox } from '../finance/box.ts';
import { allUnits, marketPrice, setAsking } from '../markets/property.ts';
import type { House } from './state.ts';
import { generationsKind, generationsSettings, generationsState } from './state.ts';
import { houseAdults, houseFor, isAdult } from './houses.ts';

/** What the Exchange gets for a forced sale: never the full price. */
export const LIQUIDATION_LOW = 0.6;
export const LIQUIDATION_HIGH = 0.75;
/** A house's business pays the house what a payout would have paid the owner. */
export const HOUSE_PAYOUT_RESERVE = 100;
export const HOUSE_PAYOUT_SHARE = 0.5;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

// ---------------------------------------------------------------------------
// Reading the holdings
// ---------------------------------------------------------------------------

export function unitById(world: World, unitId: string): PropertyUnit | null {
  return allUnits(world).find((u) => u.id === unitId) ?? null;
}

/** The house that has this unit in its entail, or null. */
export function entailedIn(world: World, unitId: string): House | null {
  for (const h of Object.values(generationsState(world).houses)) {
    if (h.units.includes(unitId)) return h;
  }
  return null;
}

/** The house that has this business in its entail, or null. */
export function businessEntailedIn(world: World, businessId: BusinessId): House | null {
  for (const h of Object.values(generationsState(world).houses)) {
    if (h.businesses.includes(businessId)) return h;
  }
  return null;
}

/**
 * The refusal a sale of an entailed asset should carry, or null when the asset
 * is free to sell. Exported for the pass that wires `list_property`,
 * `sell_property` and `sell_business`: **no member may sell one**, and only a
 * carried `sell` motion or the Exchange's own hand may move it.
 */
export function entailGuard(world: World, assetId: string): string | null {
  const house = entailedIn(world, assetId) ?? businessEntailedIn(world, assetId);
  if (!house) return null;
  return `That is entailed to the house of ${house.name}; a sale takes a motion of the members.`;
}

export function houseTreasury(world: World, h: House): number {
  return boxBalance(world, h.boxId);
}

/** What the entailed land is worth today: the levy's base, and the pledge's. */
export function houseLandValue(world: World, h: House): number {
  let total = 0;
  for (const unitId of h.units) {
    const u = unitById(world, unitId);
    if (u) total += marketPrice(world, u);
  }
  return Math.round(total);
}

/** Everything the house holds: the treasury, the land, and the tills of its concerns. */
export function houseWorth(world: World, h: House): number {
  let total = houseTreasury(world, h) + houseLandValue(world, h);
  for (const id of h.businesses) {
    const b = world.businesses[id];
    if (b && b.dissolvedDay === null) total += Math.max(0, Math.round(b.treasury));
  }
  return total;
}

/**
 * Keep an empty entailed unit off the Exchange's board. `markets/property.ts`
 * puts an idle deed up for sale by default, which would sell the entail out
 * from under the house; a unit the house has offered is on the letting market
 * instead, where the tenancy — and, in `daily.ts`, the rent — is the house's.
 */
function holdOffTheBoard(world: World, unitId: string, held: boolean): void {
  if (held) world.counters[`let:${unitId}`] = 1;
  else delete world.counters[`let:${unitId}`];
}

// ---------------------------------------------------------------------------
// Conveying into the entail
// ---------------------------------------------------------------------------

/** Entail lumens: any member may endow their house, and nobody may take them back. */
export function endowHouse(world: World, cId: CitizenId, amount: number): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const h = houseFor(world, cId);
  if (!h) return fail('You are not of a founded house.');
  if (h.dormantDay !== null) return fail(`The house of ${h.name} is dormant.`);
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (amt <= 0) return fail('That is not an amount.');
  if (c.wallet < amt) return fail(`You have ${formatLumens(c.wallet)}.`);
  if (!moveThroughBox(world, cId, h.boxId, amt, generationsKind('endowment'), `endowment of the house of ${h.name}`)) {
    return fail('The endowment could not be paid.');
  }
  emit(world, 'household', `${c.name} endowed the house of ${h.name} with ${formatLumens(amt)}; it holds ${formatLumens(houseTreasury(world, h))}.`,
    [cId], 0.3, { houseId: h.id, amount: amt });
  remember(world, cId, 'money', `You endowed the house of ${h.name} with ${formatLumens(amt)}. It is entailed: it is not yours to take back.`);
  return ok(`The house of ${h.name} holds ${formatLumens(houseTreasury(world, h))}.`);
}

/**
 * Entail a property. The deed passes to the house, out of the member's estate
 * and out of the reach of the duty forever — and out of the member's own reach
 * too: they cannot sell it back, and only a motion of the members can.
 */
export function conveyToHouse(world: World, cId: CitizenId, unitId: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const h = houseFor(world, cId);
  if (!h) return fail('You are not of a founded house.');
  if (h.dormantDay !== null) return fail(`The house of ${h.name} is dormant.`);
  if (!isAdult(c)) return fail('A child holds no deeds to convey.');
  const u = unitById(world, unitId);
  if (!u) return fail('There is no such unit on the Exchange board.');
  if (u.ownerId !== cId) return fail('That deed is not yours to convey.');
  if (h.units.includes(unitId)) return fail('That is already entailed.');

  u.ownerId = h.boxId;
  c.ownedUnits = (c.ownedUnits ?? []).filter((id) => id !== unitId);
  h.units.push(unitId);
  setAsking(world, u, 0);
  holdOffTheBoard(world, unitId, true);
  const worth = marketPrice(world, u);
  emit(world, 'property', `${c.name} conveyed a property worth ${formatLumens(worth)} into the entail of the house of ${h.name}.`,
    [cId], 0.5, { houseId: h.id, unitId, worth });
  remember(world, cId, 'money', `You entailed a property worth ${formatLumens(worth)} to the house of ${h.name}: it is out of your estate, and out of your hands.`);
  return ok(`The house of ${h.name} holds that deed now.`);
}

/**
 * Entail a business. The concern belongs to the house: its profits pay into
 * the house treasury instead of a member's purse, and no member may sell it.
 */
export function conveyBusinessToHouse(world: World, cId: CitizenId, businessId: BusinessId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const h = houseFor(world, cId);
  if (!h) return fail('You are not of a founded house.');
  if (h.dormantDay !== null) return fail(`The house of ${h.name} is dormant.`);
  const b = world.businesses[businessId];
  if (!b || b.dissolvedDay !== null) return fail('There is no such business.');
  if (b.ownerId !== cId) return fail('That business is not yours to convey.');
  if (h.businesses.includes(businessId)) return fail('That is already entailed.');

  b.ownerId = h.boxId;
  if (c.businessId === businessId) c.businessId = null;
  h.businesses.push(businessId);
  emit(world, 'property', `${c.name} conveyed ${b.name} into the entail of the house of ${h.name}.`,
    [cId], 0.5, { houseId: h.id, businessId });
  remember(world, cId, 'money', `You entailed ${b.name} to the house of ${h.name}: what it earns is the house's now.`);
  return ok(`${b.name} belongs to the house of ${h.name}.`);
}

// ---------------------------------------------------------------------------
// Selling out of the entail
// ---------------------------------------------------------------------------

/**
 * Sell an entailed property, at the Exchange, for what the city will pay. Only
 * `motions.ts` calls this — after the members have carried it — and the
 * Exchange itself, when a levy or a pledge has to be answered. `share` is what
 * of the market price the sale fetches.
 */
export function sellEntailedUnit(world: World, h: House, unitId: string, share: number, why: string): number {
  const u = unitById(world, unitId);
  if (!u || !h.units.includes(unitId)) return 0;
  const price = Math.max(1, Math.round(marketPrice(world, u) * share));
  if (world.treasury.balance < price) return 0;
  if (!moveThroughBox(world, 'treasury', h.boxId, price, 'property', `the Exchange bought ${why} from the house of ${h.name}`)) {
    return 0;
  }
  u.ownerId = 'city';
  h.units = h.units.filter((id) => id !== unitId);
  holdOffTheBoard(world, unitId, false);
  setAsking(world, u, 0);
  emit(world, 'property', `The house of ${h.name} sold a property to the Exchange for ${formatLumens(price)} (${why}).`,
    houseAdults(world, h).map((a) => a.id), 0.5, { houseId: h.id, unitId, price, why });
  return price;
}

/** Sell an entailed business back to the city, the same way. Returns what it fetched. */
export function sellEntailedBusiness(world: World, h: House, businessId: BusinessId, why: string): number {
  const b = world.businesses[businessId];
  if (!b || !h.businesses.includes(businessId)) return 0;
  const till = Math.max(0, Math.round(b.treasury));
  h.businesses = h.businesses.filter((id) => id !== businessId);
  if (till > 0) moveThroughBox(world, b.id, h.boxId, till, 'payout', `the house of ${h.name} drew ${b.name}'s till`);
  b.ownerId = '';
  emit(world, 'property', `The house of ${h.name} gave up ${b.name} (${why}); ${formatLumens(till)} came into the house treasury.`,
    houseAdults(world, h).map((a) => a.id), 0.4, { houseId: h.id, businessId, till, why });
  return till;
}

// ---------------------------------------------------------------------------
// The levy
// ---------------------------------------------------------------------------

/** What this house owes the city this cycle, on the land it has entailed. */
export function levyDue(world: World, h: House): number {
  const rate = generationsSettings(world).houseLevy;
  return Math.round(houseLandValue(world, h) * Math.max(0, rate));
}

/**
 * The cycle's levy, charged once per cycle on the entailed land. What the
 * treasury cannot pay stands as arrears against the house — dormant houses
 * included, because the levy runs on while a house sleeps.
 */
export function chargeHouseLevy(world: World, h: House): number {
  const cycle = world.government?.cycle ?? 0;
  if (h.lastLevyCycle >= cycle) return 0;
  h.lastLevyCycle = cycle;
  const due = levyDue(world, h);
  if (due <= 0) return 0;
  const paid = Math.min(due, houseTreasury(world, h));
  if (paid > 0) moveThroughBox(world, h.boxId, 'treasury', paid, generationsKind('levy'), `house levy on the entail of the ${h.name}s`);
  const short = due - paid;
  h.levyArrears = Math.max(0, Math.round(h.levyArrears + short));
  emit(world, 'property', `The house of ${h.name} was levied ${formatLumens(due)} on ${formatLumens(houseLandValue(world, h))} of entailed land${short > 0 ? ` and is ${formatLumens(h.levyArrears)} in arrears` : ''}.`,
    houseAdults(world, h).map((a) => a.id), short > 0 ? 0.5 : 0.3, { houseId: h.id, due, paid, arrears: h.levyArrears });
  for (const a of houseAdults(world, h)) {
    remember(world, a.id, 'money', `The house of ${h.name} paid ${formatLumens(paid)} of a ${formatLumens(due)} levy${short > 0 ? `; ${formatLumens(h.levyArrears)} stands in arrears` : ''}.`);
  }
  return paid;
}

/**
 * A house holding more land than its members can pay for sells, or is sold up
 * by the Exchange: the dearest holding goes at 60–75 % of what it is worth,
 * the arrears come out of the proceeds, and the rest stays in the entail.
 */
export function sellUpForLevy(world: World, h: House): number {
  if (h.levyArrears <= 0 || h.units.length === 0) return 0;
  if (houseTreasury(world, h) >= h.levyArrears) {
    const paid = Math.min(h.levyArrears, houseTreasury(world, h));
    if (paid > 0 && moveThroughBox(world, h.boxId, 'treasury', paid, generationsKind('levy'), `arrears of the house levy, the ${h.name}s`)) {
      h.levyArrears = Math.max(0, h.levyArrears - paid);
    }
    return paid;
  }
  const dearest = [...h.units]
    .map((id) => ({ id, worth: unitById(world, id) ? marketPrice(world, unitById(world, id)!) : 0 }))
    .sort((a, b) => b.worth - a.worth || a.id.localeCompare(b.id, 'en'))[0];
  if (!dearest) return 0;
  const share = LIQUIDATION_LOW + rand(world) * (LIQUIDATION_HIGH - LIQUIDATION_LOW);
  const got = sellEntailedUnit(world, h, dearest.id, share, 'sold up for the levy');
  if (got <= 0) return 0;
  const paid = Math.min(h.levyArrears, houseTreasury(world, h));
  if (paid > 0 && moveThroughBox(world, h.boxId, 'treasury', paid, generationsKind('levy'), `arrears of the house levy, the ${h.name}s`)) {
    h.levyArrears = Math.max(0, h.levyArrears - paid);
  }
  return paid;
}

// ---------------------------------------------------------------------------
// What the entail earns
// ---------------------------------------------------------------------------

/**
 * Rent on the entail. `markets/property.ts` collects for a landlord who is a
 * citizen and leaves a deed with nobody behind it alone, so a house's rents
 * are collected here — into the house treasury, where the levy will find them.
 * A tenant who cannot pay is not put out by this file: a house is a landlord,
 * not a court.
 */
export function collectEntailRents(world: World): number {
  let moved = 0;
  for (const h of Object.values(generationsState(world).houses)) {
    for (const unitId of h.units) {
      const u = unitById(world, unitId);
      if (!u || !u.tenantId) continue;
      const tenant = world.citizens[u.tenantId];
      if (!tenant || !isPresent(world, tenant)) continue;
      const rent = Math.max(0, Math.round(u.rent));
      if (rent <= 0) continue;
      if (moveThroughBox(world, tenant.id, h.boxId, rent, 'lease', `rent to the house of ${h.name}`)) {
        moved += rent;
        remember(world, tenant.id, 'money', `You paid ${formatLumens(rent)} of rent to the house of ${h.name}.`);
      } else {
        remember(world, tenant.id, 'money', `You could not pay the house of ${h.name} ${formatLumens(rent)} of rent.`);
      }
    }
  }
  return moved;
}

/**
 * What an entailed concern earns pays the house, exactly as a payout would
 * have paid an owner — and a concern that has been wound up leaves the entail
 * with whatever was in its till.
 */
export function sweepEntailedBusinesses(world: World): number {
  let moved = 0;
  for (const h of Object.values(generationsState(world).houses)) {
    for (const businessId of [...h.businesses]) {
      const b = world.businesses[businessId];
      if (!b) { h.businesses = h.businesses.filter((id) => id !== businessId); continue; }
      if (b.dissolvedDay !== null) {
        sellEntailedBusiness(world, h, businessId, 'the concern was wound up');
        continue;
      }
      const till = Math.max(0, Math.round(b.treasury));
      if (till <= HOUSE_PAYOUT_RESERVE) continue;
      const payout = Math.round((till - HOUSE_PAYOUT_RESERVE) * HOUSE_PAYOUT_SHARE);
      if (payout <= 0) continue;
      if (moveThroughBox(world, b.id, h.boxId, payout, 'payout', `${b.name} paid the house of ${h.name}`)) moved += payout;
    }
  }
  return moved;
}

/**
 * Debts of the entail, settled the only way an entail can settle one: by
 * selling. Used for a pledge that has been called (`letters.ts`) — the
 * property goes at its land value, and the house is the poorer for having
 * stood behind a member who did not pay.
 */
export function seizeFromEntail(world: World, h: House, amount: number, why: string): { paid: number; unitId: string | null } {
  const want = Math.max(0, Math.round(amount));
  if (want <= 0) return { paid: 0, unitId: null };
  let paid = 0;
  const fromTill = Math.min(want, houseTreasury(world, h));
  if (fromTill > 0 && moveThroughBox(world, h.boxId, 'treasury', fromTill, 'seizure', why)) paid += fromTill;
  if (paid >= want || h.units.length === 0) return { paid, unitId: null };

  const cheapest = [...h.units]
    .map((id) => ({ id, worth: unitById(world, id) ? marketPrice(world, unitById(world, id)!) : 0 }))
    .sort((a, b) => a.worth - b.worth || a.id.localeCompare(b.id, 'en'))[0];
  if (!cheapest) return { paid, unitId: null };
  const got = sellEntailedUnit(world, h, cheapest.id, 1, why);
  if (got <= 0) return { paid, unitId: null };
  const rest = Math.min(want - paid, houseTreasury(world, h));
  if (rest > 0 && moveThroughBox(world, h.boxId, 'treasury', rest, 'seizure', why)) paid += rest;
  return { paid, unitId: cheapest.id };
}
