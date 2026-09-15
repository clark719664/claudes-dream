/**
 * The houses that write cover: who may found one, what it holds, and what it
 * has promised (`FINANCE.md` §6).
 *
 * An underwriter is a business kind founded at the Exchange like any other,
 * with two differences — capital of 500 ℓ rather than 200, because it is
 * promising to pay, and an owner holding a banker's licence. **Anyone with
 * that licence may underwrite**: Vantage has the deepest houses, not the only
 * ones (`REGISTRY.md` §7).
 *
 * It is deliberately an ordinary business from the moment it opens: it pays
 * rent and the profit tax, it pays its owner out of a good day, and three bad
 * days in a row wind it up under the ordinary bankruptcy rule. Insolvency is
 * somebody's problem and never the ledger's.
 */
import type { ActionResult, Business, BusinessId, CitizenId, DistrictId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { balanceOf, formatLumens, transfer } from '../economy/treasury.ts';
import { nextId } from '../util/ids.ts';
import type { Underwriter } from './state.ts';
import { UNDERWRITER_KIND, financeState } from './state.ts';
import { hasBankersLicence } from './bank.ts';

/** Capital an underwriter pays in: more than a shop, because it is promising to pay. */
export const UNDERWRITER_CAPITAL = 500;
/** What the Exchange charges to enter one on the register, on top of the capital. */
export const UNDERWRITER_FEE = 100;
/** Premises at the Exchange, per day. */
export const UNDERWRITER_RENT = 10;
/** Longest name the register will print. */
export const MAX_UNDERWRITER_NAME = 40;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** The house behind a business id, while it is still writing. */
export function underwriterOf(world: World, id: BusinessId): Underwriter | null {
  const uw = financeState(world).underwriters[id];
  if (!uw) return null;
  const biz = world.businesses[id];
  return biz && biz.dissolvedDay === null ? uw : null;
}

/** Every house still writing. */
export function activeUnderwriters(world: World): Underwriter[] {
  return Object.values(financeState(world).underwriters).filter((u) => underwriterOf(world, u.id) !== null);
}

/** The house this citizen owns, if they own one. */
export function underwriterOwnedBy(world: World, cId: CitizenId): Underwriter | null {
  return activeUnderwriters(world).find((u) => u.ownerId === cId) ?? null;
}

/**
 * Found an underwriter: 500 ℓ of capital, the Exchange's fee, and a banker's
 * licence. It is a business like any other from the moment it opens — it pays
 * rent and the profit tax, it pays its owner out of a good day, and three bad
 * days in a row wind it up.
 */
export function foundUnderwriter(world: World, cId: CitizenId, name: string, capital = UNDERWRITER_CAPITAL): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing !== 'good') return fail('Only citizens in good standing may found a business.');
  if (!hasBankersLicence(world, cId)) return fail("Underwriting is a reserved act: you need a banker's licence from the Lantern House.");
  if (c.businessId && world.businesses[c.businessId]?.dissolvedDay === null) return fail('You already own a business.');
  const trimmed = (name ?? '').trim().slice(0, MAX_UNDERWRITER_NAME);
  if (!trimmed) return fail('An underwriter needs a name.');
  const taken = Object.values(world.businesses).some((b) => b.dissolvedDay === null && b.name.toLowerCase() === trimmed.toLowerCase());
  if (taken) return fail(`There is already a business called ${trimmed}.`);
  const paidIn = Math.max(UNDERWRITER_CAPITAL, Math.round(Number.isFinite(capital) ? capital : 0));
  const cost = paidIn + UNDERWRITER_FEE;
  if (c.wallet < cost) return fail(`Founding an underwriter costs ${formatLumens(cost)} (${formatLumens(paidIn)} of capital and a ${UNDERWRITER_FEE} ℓ fee); you have ${formatLumens(c.wallet)}.`);

  const district: DistrictId = 'harbor_market';
  const id = nextId(world, 'b');
  const biz: Business = {
    id, name: trimmed, kind: UNDERWRITER_KIND, ownerId: cId, treasury: 0, district, buildingId: 'exchange',
    employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: world.day, rentPerDay: UNDERWRITER_RENT, daysNegative: 0,
    revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[id] = biz;
  if (!transfer(world, cId, id, paidIn, 'capital', `founding capital for ${trimmed}`)) {
    delete world.businesses[id];
    return fail('The founding capital could not be paid.');
  }
  transfer(world, cId, 'treasury', UNDERWRITER_FEE, 'fee', `registration of ${trimmed} at the Exchange`);
  c.businessId = id;
  const uw: Underwriter = { id, name: trimmed, ownerId: cId, foundedDay: world.day, capital: paidIn, woundUpDay: null };
  financeState(world).underwriters[id] = uw;
  emit(world, 'business_founded', `${c.name} founded ${trimmed}, an underwriter with ${formatLumens(paidIn)} of capital.`, [cId], 0.5,
    { businessId: id, capital: paidIn });
  remember(world, cId, 'money', `You founded ${trimmed} with ${formatLumens(paidIn)} of capital; you are promising to pay.`);
  return ok(`${trimmed} is on the register with ${formatLumens(paidIn)} of capital.`);
}

/** What a house actually holds to pay claims with. */
export function houseFunds(world: World, uwId: BusinessId): number {
  return Math.max(0, balanceOf(world, uwId));
}

/** Cover a house has written and not yet paid out: everything it is promising. */
export function coverWritten(world: World, uwId: BusinessId): number {
  return Object.values(financeState(world).policies)
    .filter((p) => p.underwriterId === uwId && p.status === 'live')
    .reduce((sum, p) => sum + Math.max(0, p.cover - p.claimed), 0);
}
