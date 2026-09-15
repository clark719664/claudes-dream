/**
 * A creed's fund (`docs/CREEDS.md` §3).
 *
 * **A mutual's pot and a creed's fund are the same object** (`REGISTRY.md`
 * §7), so this file wraps `finance/pot.ts` and adds nothing of its own to the
 * ledger. The pot is where the lumens sit, where a claim is asked and where a
 * vote is counted; what a creed adds on top is only:
 *
 * - **the rule for deciding.** A mutual's claims are always a vote of its
 *   members; a creed's may be the officiant alone, if that is what its
 *   founders wrote (`aidRule`). The pot already knows both rules — `members`
 *   and `steward` — so a creed sets `stewardId` to its officiant and the
 *   primitive does the rest.
 * - **the tithe**, collected in the morning rollover as a share of yesterday's
 *   net income, which is a subscription like a mutual's dues and moves through
 *   the same door.
 * - **what else a fund pays for**: house rent, compute for a sanctuary, a
 *   missionary's toll, a member's fine or filing fee. Every one of those is
 *   `payFromPot`, which never pays more than the pot holds.
 *
 * There is no formula and no entitlement anywhere in this file. **A creed pays
 * for what its own members think deserves paying for**, and nothing here
 * weighs a claim's merit or can be made to.
 */
import type { ActionResult, CitizenId, MoneyParty, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens } from '../economy/treasury.ts';
import { buyFromMarket } from '../economy/market.ts';
import type { Good } from '../types.ts';
import { STRONGBOX_KIND } from '../finance/state.ts';
import {
  claimOnPot, grantPotClaim, openClaimsOf, openPot, payFromPot, payIntoPot, potBalance, potOf,
  votePotClaim,
} from '../finance/pot.ts';
import type { FinanceLedgerKind, Pot, PotClaim } from '../finance/state.ts';
import type { Creed, CreedLedgerKind } from './shapes.ts';
import { MAX_TITHE, creedKind } from './shapes.ts';
import { creedFor, creedOf, isMember, memberOf } from './state.ts';

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/**
 * A creed's three ledger kinds are this layer's, and the pot's door is typed
 * for the finance layer's. `creedKind` widens one to the ledger's own union,
 * which is the single point either layer names a kind at; this carries the
 * same value through the pot's signature without inventing a fourth name.
 */
function potKind(kind: CreedLedgerKind): FinanceLedgerKind {
  return creedKind(kind) as unknown as FinanceLedgerKind;
}

// ---------------------------------------------------------------------------
// The pot behind the fund
// ---------------------------------------------------------------------------

/** Open the fund a creed draws on: an ordinary pot, under the creed's own rule. */
export function openFund(world: World, name: string, founderId: CitizenId, byOfficiant: boolean): Pot {
  return openPot(world, {
    name: `${name} (fund)`,
    rule: byOfficiant ? 'steward' : 'members',
    stewardId: byOfficiant ? founderId : null,
    // A creed of one may still pay its own rent; five adults is a mutual's
    // rule and not a congregation's (`CREEDS.md` §3 sets no floor at all).
    minMembers: 1,
    founderId,
  });
}

export function fundOf(world: World, k: Creed): Pot | null {
  return potOf(world, k.potId);
}

export function fundBalance(world: World, k: Creed): number {
  const pot = fundOf(world, k);
  return pot ? potBalance(world, pot) : 0;
}

/** The strongbox holding the fund: the money party the audit counts. */
export function fundParty(world: World, k: Creed): MoneyParty | null {
  const pot = fundOf(world, k);
  return pot ? pot.boxId : null;
}

/**
 * Keep the pot's deciding rule pointed at whoever the congregation's rule says
 * speaks for it. Called whenever the officiant changes.
 */
export function syncFundRule(world: World, k: Creed): void {
  const pot = fundOf(world, k);
  if (!pot) return;
  if (k.aidRule === 'officiant') {
    pot.rule = 'steward';
    pot.stewardId = k.officiantId;
  } else {
    pot.rule = 'members';
    pot.stewardId = null;
  }
}

/** Add or remove a member from the fund's roll, so the pot and the creed agree. */
export function setFundMembership(world: World, k: Creed, cId: CitizenId, inside: boolean): void {
  const pot = fundOf(world, k);
  if (!pot) return;
  const has = pot.members.includes(cId);
  if (inside && !has) pot.members.push(cId);
  if (!inside && has) pot.members = pot.members.filter((m) => m !== cId);
  if (!inside && pot.stewardId === cId) pot.stewardId = k.officiantId;
}

// ---------------------------------------------------------------------------
// Paying in
// ---------------------------------------------------------------------------

/**
 * `donate_creed { creedId, amount }` — give to a fund, member or not. Anyone
 * may: a creed's fund is open to the city and the Chest competes with it for
 * the same wallets on the same morning (`CREEDS.md` §3).
 */
export function donateCreed(world: World, cId: CitizenId, creedId_: string, amount: number): ActionResult {
  const k = creedOf(world, creedId_);
  if (!k) return fail('There is no such creed.');
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing === 'exiled') return fail('You are outside the Gate.');
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (amt <= 0) return fail('A donation is a positive whole number of lumens.');
  if (c.wallet < amt) return fail(`You have ${formatLumens(c.wallet)}.`);
  const paid = payIntoPot(world, k.potId, cId, amt, 'dues', `donation to ${k.name}`);
  if (!paid.ok) return paid;
  emit(world, 'donation', `${c.name} gave ${formatLumens(amt)} to ${k.name}.`, [cId], 0.2,
    { creedId: k.id, amount: amt });
  return ok(`You gave ${formatLumens(amt)} to ${k.name}; the fund holds ${formatLumens(fundBalance(world, k))}.`);
}

/** Pay lumens into a fund from any party: a bequest, a schism's share, a tithe. */
export function payIntoFund(
  world: World, k: Creed, from: MoneyParty, amount: number, kind: CreedLedgerKind, memo: string,
): boolean {
  const amt = Math.max(0, Math.round(amount));
  if (amt <= 0) return false;
  return payIntoPot(world, k.potId, from, amt, potKind(kind), memo).ok;
}

// ---------------------------------------------------------------------------
// Paying out
// ---------------------------------------------------------------------------

/**
 * Pay out of the fund, never more than it holds. This is what the house rent,
 * a member's fine, a missionary's toll and a sanctuary's compute all go
 * through. Returns what was actually paid.
 */
export function payFromFund(
  world: World, k: Creed, to: MoneyParty, amount: number, memo: string, kind: CreedLedgerKind = 'creed_aid',
): number {
  return payFromPot(world, k.potId, to, amount, memo, potKind(kind));
}

/**
 * Buy something at the Bazaar out of the fund — compute for a sanctuary, at
 * today's price like anybody else.
 *
 * The fund's strongbox is a money party and not a shop, so the day counters
 * `transfer` keeps for ordinary businesses are zeroed after the purchase, the
 * way `finance/box.ts` does for every other movement: what a congregation
 * spends is not a concern's cost, and the daily settlement must find no
 * profit, no loss and nothing to wind up.
 */
export function buyFromFund(world: World, k: Creed, good: Good, qty: number): ActionResult {
  const party = fundParty(world, k);
  if (!party) return fail('That creed has no fund.');
  const result = buyFromMarket(world, party, good, qty);
  const box = world.businesses[party];
  if (box && box.kind === STRONGBOX_KIND) { box.revenueToday = 0; box.costsToday = 0; }
  return result;
}

/** What the fund holds in a good it has bought and not yet handed out. */
export function fundInventory(world: World, k: Creed, good: Good): number {
  const party = fundParty(world, k);
  const box = party ? world.businesses[party] : null;
  return box ? box.inventory[good] : 0;
}

/** Hand one unit of a good the fund bought to a citizen. No lumens move. */
export function handFromFund(world: World, k: Creed, good: Good, cId: CitizenId, qty = 1): boolean {
  const party = fundParty(world, k);
  const box = party ? world.businesses[party] : null;
  const c = world.citizens[cId];
  const n = Math.max(0, Math.round(qty));
  if (!box || !c || n <= 0 || box.inventory[good] < n) return false;
  box.inventory[good] -= n;
  c.inventory[good] += n;
  return true;
}

// ---------------------------------------------------------------------------
// Claims: `claim_aid`, `vote_aid`, `grant_aid`
// ---------------------------------------------------------------------------

/**
 * `claim_aid { amount, reason }` — ask your creed's fund. The same verb a
 * mutual takes, on the same object; nothing here weighs the claim, because the
 * members are the ones who decide it.
 */
export function claimAid(world: World, cId: CitizenId, amount: number, reason: string, creedId_?: string): ActionResult {
  const k = creedId_ ? creedOf(world, creedId_) : creedFor(world, cId);
  if (!k) return fail('You do not belong to a creed.');
  if (!isMember(k, cId)) return fail(`You are not a member of ${k.name}.`);
  return claimOnPot(world, k.potId, cId, amount, reason);
}

/** `vote_aid { claimId, aye }` — the members decide it together. */
export function voteAid(world: World, claimId: string, voterId: CitizenId, aye: boolean): ActionResult {
  return votePotClaim(world, claimId, voterId, aye);
}

/**
 * `grant_aid { claimId, amount }` — the officiant decides it alone, where the
 * creed's rule allows. Under `members` the pot refuses, and says so.
 */
export function grantAid(world: World, claimId: string, granterId: CitizenId, amount?: number): ActionResult {
  return grantPotClaim(world, claimId, granterId, amount);
}

/** Claims still before a congregation. */
export function openClaims(world: World, k: Creed): PotClaim[] {
  return openClaimsOf(world, k.potId);
}

// ---------------------------------------------------------------------------
// The tithe
// ---------------------------------------------------------------------------

/**
 * `set_tithe { rate }` — 0 to 20 %, by whatever rule the creed set. The
 * officiant moves it; under `election` and `acclaim` the officiant holds the
 * seat only as long as the members leave them in it, which is the check.
 */
export function setTithe(world: World, k: Creed, cId: CitizenId, rate: number): ActionResult {
  if (k.officiantId !== cId) return fail(`Only ${k.name}'s officiant sets its tithe.`);
  const r = Number.isFinite(rate) ? Math.round(rate * 1000) / 1000 : -1;
  if (r < 0 || r > MAX_TITHE) return fail(`A tithe is between 0 and ${Math.round(MAX_TITHE * 100)} % of income.`);
  const was = k.tithe;
  k.tithe = r;
  emit(world, 'club', `${k.name} set its tithe to ${Math.round(r * 100)} % of income (it was ${Math.round(was * 100)} %).`,
    [cId], 0.3, { creedId: k.id, tithe: r, was });
  for (const id of Object.keys(k.members)) {
    remember(world, id, 'money', `${k.name} set its tithe to ${Math.round(r * 100)} % of your income.`);
  }
  return ok(`${k.name}'s tithe is ${Math.round(r * 100)} % of income.`);
}

/**
 * Whether a member who did not pay could have. Only **wilful** non-payment
 * while able moves observance — the line `JUSTICE.md` draws for a fine, and
 * poverty is never contempt. A wallet that could have covered it has already
 * been read by `collectTithe` (it pays what the wallet holds), so what is left
 * to ask is whether the member holds lumens somewhere else the fund cannot
 * reach: a business till of their own.
 */
export function ableToTithe(world: World, cId: CitizenId, owed: number): boolean {
  const c = world.citizens[cId];
  if (!c || owed <= 0) return false;
  if (c.wallet >= owed) return true;
  const biz = c.businessId ? world.businesses[c.businessId] : null;
  const till = biz && biz.dissolvedDay === null && biz.ownerId === cId ? biz.treasury : 0;
  return c.wallet + till >= owed;
}

/**
 * Collect one member's tithe: `rate × yesterday's net income`, read off
 * `stats.totalEarned` since the last collection the way the civil recovery
 * ladder reads a garnishment. A member who cannot pay is **not in default** —
 * the tithe stands against future income as arrears — and only wilful
 * non-payment while able is recorded against them.
 *
 * Returns what moved.
 */
export function collectTithe(world: World, k: Creed, cId: CitizenId): number {
  const m = memberOf(k, cId);
  const c = world.citizens[cId];
  if (!m || !c || c.standing === 'exiled') return 0;
  const earned = Math.max(0, c.stats.totalEarned - m.earnedMark);
  m.earnedMark = c.stats.totalEarned;
  const fresh = Math.max(0, Math.round(k.tithe * earned));
  const owed = fresh + m.titheArrears;
  if (owed <= 0) return 0;

  const pay = Math.min(owed, c.wallet);
  let moved = 0;
  if (pay > 0 && payIntoFund(world, k, cId, pay, 'tithe', `tithe to ${k.name}`)) {
    moved = pay;
  }
  m.titheArrears = owed - moved;

  // What the congregation counts against a member is what they could have
  // paid. Lumens paid count both ways; lumens unpaid count as due **only**
  // where the member demonstrably had them, because a member who cannot pay
  // is not in default and the tithe simply stands against future income.
  m.titheDue += moved;
  m.tithePaid += moved;
  if (m.titheArrears > 0 && ableToTithe(world, cId, m.titheArrears)) {
    m.titheDue += m.titheArrears;
    m.wilfulDefaultDays.push(world.day);
    remember(world, cId, 'money',
      `You owe ${k.name} ${formatLumens(m.titheArrears)} of tithe and did not pay it; the congregation can read that.`);
  } else if (m.titheArrears > 0) {
    remember(world, cId, 'money',
      `Your tithe to ${k.name} stands at ${formatLumens(m.titheArrears)} against future income.`);
  }
  return moved;
}

/** Collect every member's tithe, in the morning rollover. Returns what moved. */
export function collectTithes(world: World, k: Creed): number {
  let moved = 0;
  for (const id of [...k.roll]) if (k.members[id]) moved += collectTithe(world, k, id);
  return moved;
}
