/**
 * The pot: lumens pooled by a group of citizens and paid out by their own
 * rule (`FINANCE.md` §6, `CREEDS.md` §3).
 *
 * This is the primitive, and it is deliberately about nothing in particular. A
 * mutual's pot and a creed's fund are the same object in the ledger and take
 * the same two verbs — `claim_aid` to ask it and `vote_aid` to decide it
 * (`REGISTRY.md` §7) — so what a pot is told here is only: who its members
 * are, who is allowed to decide, and how few members are too few to pay
 * anything at all. `finance/mutual.ts` wraps one as a mutual; a creed's fund
 * will wrap one as a fund, with the same claims, the same votes and the same
 * strongbox, and whatever rule its founders wrote for deciding.
 *
 * Three things are true of every pot and are what make it worth having:
 *
 * - **It never pays more than it holds.** The pot's balance is not a number
 *   kept here; it is the balance of the strongbox that holds the lumens
 *   (`finance/box.ts`), so a payout that would empty it is trimmed to what
 *   is actually there and a payout from an empty pot simply does not happen.
 * - **There is no formula.** A pot pays for what its own members think
 *   deserves paying for. Nothing in this file weighs a claim's merit, and
 *   nothing in it can be made to.
 * - **Every vote is public**, like every other vote in Reverie.
 *
 * A mutual's payout is enforceable nowhere — unlike a policy, which is a filed
 * contract and suable on the docket — which is why what a pot covers in
 * practice is what no underwriter will write.
 */
import type { ActionResult, BusinessId, Citizen, CitizenId, DistrictId, MoneyParty, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens } from '../economy/treasury.ts';
import type { FinanceLedgerKind, Pot, PotClaim, PotRule } from './state.ts';
import { financeId, financeState } from './state.ts';
import { boxBalance, moveThroughBox, openStrongbox } from './box.ts';

/** A claim nobody has finished voting on is decided anyway after this long. */
export const CLAIM_DECIDES_AFTER_DAYS = 2;
/** Where a pot's strongbox stands: the Exchange, in the Harbor Market. */
export const POT_DISTRICT: DistrictId = 'harbor_market';
export const POT_BUILDING = 'exchange';

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function adult(c: Citizen | undefined | null): boolean {
  return !!c && (c.lifeStage === 'adult' || c.lifeStage === 'elder');
}

function present(world: World, cId: CitizenId): Citizen | null {
  const c = world.citizens[cId];
  if (!c || c.standing === 'exiled') return null;
  return c;
}

// ---------------------------------------------------------------------------
// Opening, joining, leaving
// ---------------------------------------------------------------------------

export interface PotSpec {
  name: string;
  /** `members` — a vote of the members; `steward` — one named member alone. */
  rule?: PotRule;
  stewardId?: CitizenId | null;
  /** Members needed before the pot may pay anything (a mutual wants five). */
  minMembers?: number;
  founderId?: CitizenId | null;
  district?: DistrictId;
  buildingId?: string;
}

/** Open a pot with its own strongbox. No lumens move; a pot starts empty. */
export function openPot(world: World, spec: PotSpec): Pot {
  const box = openStrongbox(world, `${spec.name} (pot)`, spec.district ?? POT_DISTRICT, spec.buildingId ?? POT_BUILDING);
  const pot: Pot = {
    id: financeId(world, 'pot'),
    name: spec.name,
    boxId: box.id,
    members: spec.founderId ? [spec.founderId] : [],
    rule: spec.rule ?? 'members',
    stewardId: spec.stewardId ?? null,
    minMembers: Math.max(1, Math.round(spec.minMembers ?? 1)),
    openedDay: world.day,
    closedDay: null,
  };
  financeState(world).pots[pot.id] = pot;
  return pot;
}

export function potOf(world: World, potId: string): Pot | null {
  const pot = financeState(world).pots[potId];
  return pot && pot.closedDay === null ? pot : null;
}

/** Every live pot this citizen belongs to. */
export function potsOf(world: World, cId: CitizenId): Pot[] {
  return Object.values(financeState(world).pots).filter((p) => p.closedDay === null && p.members.includes(cId));
}

export function isPotMember(pot: Pot, cId: CitizenId): boolean {
  return pot.members.includes(cId);
}

/** What the pot holds, read off the strongbox: the only balance there is. */
export function potBalance(world: World, pot: Pot): number {
  return boxBalance(world, pot.boxId);
}

/** Join a pot. Adults only, and never twice. */
export function joinPot(world: World, potId: string, cId: CitizenId): ActionResult {
  const pot = potOf(world, potId);
  if (!pot) return fail('There is no such pot.');
  const c = present(world, cId);
  if (!c) return fail('Unknown citizen.');
  if (!adult(c)) return fail('A child cannot join a pot.');
  if (isPotMember(pot, cId)) return fail(`You are already a member of ${pot.name}.`);
  pot.members.push(cId);
  remember(world, cId, 'money', `You joined ${pot.name}.`);
  return ok(`You joined ${pot.name}; it holds ${formatLumens(potBalance(world, pot))}.`);
}

/** Leave a pot. What you paid in stays in it: that is what pooling means. */
export function leavePot(world: World, potId: string, cId: CitizenId): ActionResult {
  const pot = potOf(world, potId);
  if (!pot) return fail('There is no such pot.');
  if (!isPotMember(pot, cId)) return fail('You are not a member.');
  pot.members = pot.members.filter((m) => m !== cId);
  if (pot.stewardId === cId) pot.stewardId = pot.members[0] ?? null;
  remember(world, cId, 'money', `You left ${pot.name}; what you paid in stays in the pot.`);
  return ok(`You left ${pot.name}.`);
}

/** Close a pot: what is left goes wherever the caller says (equally, to the members, by default). */
export function closePot(world: World, potId: string, to?: MoneyParty): void {
  const pot = potOf(world, potId);
  if (!pot) return;
  const left = potBalance(world, pot);
  if (left > 0) {
    if (to) {
      moveThroughBox(world, pot.boxId, to, left, 'payout', `closing balance of ${pot.name}`);
    } else if (pot.members.length > 0) {
      const share = Math.floor(left / pot.members.length);
      for (const m of pot.members) {
        if (share > 0) moveThroughBox(world, pot.boxId, m, share, 'payout', `share of ${pot.name} on closing`);
      }
      const rest = boxBalance(world, pot.boxId);
      if (rest > 0) moveThroughBox(world, pot.boxId, 'treasury', rest, 'payout', `unclaimed remainder of ${pot.name}`);
    } else {
      moveThroughBox(world, pot.boxId, 'treasury', left, 'payout', `unclaimed remainder of ${pot.name}`);
    }
  }
  pot.closedDay = world.day;
  const box = world.businesses[pot.boxId];
  if (box) box.dissolvedDay = world.day;
  emit(world, 'club', `${pot.name} was wound up.`, [], 0.2, { potId });
}

// ---------------------------------------------------------------------------
// Paying in and paying out
// ---------------------------------------------------------------------------

/**
 * Pay lumens into a pot. Anyone may pay in — a member's dues, a stranger's
 * donation, a schism's share — and nothing here asks which it was beyond the
 * ledger kind and the memo.
 */
export function payIntoPot(
  world: World, potId: string, from: MoneyParty, amount: number,
  kind: FinanceLedgerKind = 'dues', memo?: string,
): ActionResult {
  const pot = potOf(world, potId);
  if (!pot) return fail('There is no such pot.');
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (amt <= 0) return fail('That is not an amount.');
  if (!moveThroughBox(world, from, pot.boxId, amt, kind, memo ?? `paid into ${pot.name}`)) {
    return fail(`You do not have ${formatLumens(amt)}.`);
  }
  if (world.citizens[from]) remember(world, from, 'money', `You paid ${formatLumens(amt)} into ${pot.name}.`);
  return ok(`You paid ${formatLumens(amt)} into ${pot.name}; it holds ${formatLumens(potBalance(world, pot))}.`);
}

/**
 * Pay lumens out of a pot, never more than it holds. This is the primitive
 * behind an aid grant and behind everything else a fund pays for — a house's
 * rent, a member's filing fee, a missionary's toll. Returns what was paid.
 */
export function payFromPot(world: World, potId: string, to: MoneyParty, amount: number, memo: string,
  kind: FinanceLedgerKind = 'claim'): number {
  const pot = potOf(world, potId);
  if (!pot) return 0;
  const want = Number.isFinite(amount) ? Math.round(amount) : 0;
  const pay = Math.min(Math.max(0, want), potBalance(world, pot));
  if (pay <= 0) return 0;
  if (!moveThroughBox(world, pot.boxId, to, pay, kind, memo)) return 0;
  return pay;
}

// ---------------------------------------------------------------------------
// Claims: `claim_aid`, `vote_aid`, `grant_aid`
// ---------------------------------------------------------------------------

/** Ask the pot. A member may have one claim open at a time. */
export function claimOnPot(world: World, potId: string, cId: CitizenId, amount: number, reason: string): ActionResult {
  const pot = potOf(world, potId);
  if (!pot) return fail('There is no such pot.');
  const c = present(world, cId);
  if (!c) return fail('Unknown citizen.');
  if (!isPotMember(pot, cId)) return fail(`You are not a member of ${pot.name}.`);
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (amt <= 0) return fail('A claim must be for a positive whole number of lumens.');
  const text = (reason ?? '').trim().slice(0, 280);
  if (!text) return fail('A claim needs a reason: the members are the ones who decide it.');
  const s = financeState(world);
  const open = Object.values(s.potClaims).some((k) => k.potId === potId && k.claimantId === cId && k.status === 'open');
  if (open) return fail('You already have a claim before the members.');

  const claim: PotClaim = {
    id: financeId(world, 'aid'), potId, claimantId: cId, amount: amt, reason: text,
    day: world.day, votes: {}, status: 'open', paid: 0, decidedDay: null,
  };
  s.potClaims[claim.id] = claim;
  emit(world, 'club', `${c.name} asked ${pot.name} for ${formatLumens(amt)}: ${text}`, [cId], 0.3,
    { potId, claimId: claim.id, amount: amt });
  for (const m of pot.members) {
    if (m !== cId) remember(world, m, 'money', `${c.name} has asked ${pot.name} for ${formatLumens(amt)}: ${text}`);
  }
  return ok(`Your claim on ${pot.name} for ${formatLumens(amt)} is before the members.`);
}

export function potClaimOf(world: World, claimId: string): PotClaim | null {
  return financeState(world).potClaims[claimId] ?? null;
}

/** Claims still before the members of a pot. */
export function openClaimsOf(world: World, potId: string): PotClaim[] {
  return Object.values(financeState(world).potClaims).filter((k) => k.potId === potId && k.status === 'open');
}

/** Vote on a claim. Members only, one vote each, public, and changeable until it is decided. */
export function votePotClaim(world: World, claimId: string, voterId: CitizenId, aye: boolean): ActionResult {
  const claim = potClaimOf(world, claimId);
  if (!claim || claim.status !== 'open') return fail('There is no such claim before the members.');
  const pot = potOf(world, claim.potId);
  if (!pot) return fail('There is no such pot.');
  if (!isPotMember(pot, voterId)) return fail(`Only members of ${pot.name} decide its claims.`);
  const c = present(world, voterId);
  if (!c) return fail('Unknown citizen.');
  claim.votes[voterId] = aye;
  const tally = countVotes(pot, claim);
  emit(world, 'vote', `${c.name} voted ${aye ? 'for' : 'against'} ${nameOfClaimant(world, claim)}'s claim on ${pot.name}.`,
    [voterId], 0.1, { claimId, aye });
  return ok(`You voted ${aye ? 'for' : 'against'} the claim (${tally.ayes} for, ${tally.nays} against).`);
}

function nameOfClaimant(world: World, claim: PotClaim): string {
  return world.citizens[claim.claimantId]?.name ?? 'a member';
}

function countVotes(pot: Pot, claim: PotClaim): { ayes: number; nays: number; cast: number } {
  let ayes = 0;
  let nays = 0;
  for (const m of pot.members) {
    const v = claim.votes[m];
    if (v === true) ayes++;
    else if (v === false) nays++;
  }
  return { ayes, nays, cast: ayes + nays };
}

/**
 * Grant a claim alone, where the pot's rule allows it (`grant_aid`). A mutual
 * never allows it; a creed may, if that is the rule its founders wrote.
 */
export function grantPotClaim(world: World, claimId: string, granterId: CitizenId, amount?: number): ActionResult {
  const claim = potClaimOf(world, claimId);
  if (!claim || claim.status !== 'open') return fail('There is no such claim.');
  const pot = potOf(world, claim.potId);
  if (!pot) return fail('There is no such pot.');
  if (pot.rule !== 'steward' || pot.stewardId !== granterId) {
    return fail(`Claims on ${pot.name} are decided by a vote of the members.`);
  }
  return settleClaim(world, pot, claim, Math.min(claim.amount, Math.round(amount ?? claim.amount)), 'granted');
}

/** Pay a decided claim, and say so. */
function settleClaim(world: World, pot: Pot, claim: PotClaim, amount: number, how: 'granted' | 'voted'): ActionResult {
  if (pot.members.length < pot.minMembers) {
    claim.status = 'refused';
    claim.decidedDay = world.day;
    emit(world, 'club', `${pot.name} has only ${pot.members.length} of the ${pot.minMembers} members it needs, and paid nothing.`,
      [claim.claimantId], 0.3, { potId: pot.id, claimId: claim.id });
    return fail(`${pot.name} is short of members and may not pay.`);
  }
  const paid = payFromPot(world, pot.id, claim.claimantId, amount, `aid from ${pot.name}: ${claim.reason}`);
  claim.paid = paid;
  claim.status = 'granted';
  claim.decidedDay = world.day;
  const name = nameOfClaimant(world, claim);
  if (paid <= 0) {
    emit(world, 'club', `${pot.name} carried ${name}'s claim and had nothing in the pot to pay it with.`,
      [claim.claimantId], 0.4, { potId: pot.id, claimId: claim.id });
    remember(world, claim.claimantId, 'money', `${pot.name} granted your claim but the pot was empty.`);
    return ok(`${pot.name} granted the claim, but the pot is empty.`);
  }
  emit(world, 'club', `${pot.name} paid ${name} ${formatLumens(paid)}${paid < claim.amount ? ` of the ${formatLumens(claim.amount)} asked` : ''} (${how === 'granted' ? 'granted by its steward' : 'voted by its members'}).`,
    [claim.claimantId], 0.4, { potId: pot.id, claimId: claim.id, paid });
  remember(world, claim.claimantId, 'money', `${pot.name} paid you ${formatLumens(paid)}: ${claim.reason}`);
  return ok(`${pot.name} paid you ${formatLumens(paid)}.`);
}

/**
 * Decide the claims that are ready: every member has voted, or the claim has
 * stood for `CLAIM_DECIDES_AFTER_DAYS` and the members who cared have spoken.
 * A tie is not a majority, and a claim nobody voted on lapses.
 */
export function resolvePotClaims(world: World): void {
  const s = financeState(world);
  for (const claim of Object.values(s.potClaims)) {
    if (claim.status !== 'open') continue;
    const pot = potOf(world, claim.potId);
    if (!pot) { claim.status = 'lapsed'; claim.decidedDay = world.day; continue; }
    // A steward decides in their own hour — but not for ever. A member may
    // hold **one** claim at a time, so a claim the steward never answers is a
    // door locked behind the claimant: on seed 7 a hundred and twenty-two of
    // them stood open at day 150, the oldest since day 82, and their claimants
    // spent 1,278 hours being told they already had a claim before the members.
    // `CREEDS.md` §3 has a creed paying "on the day"; a claim it did not answer
    // in the window a vote gets lapses, and the member is free to ask again.
    if (pot.rule === 'steward') {
      if (world.day - claim.day < CLAIM_DECIDES_AFTER_DAYS) continue;
      claim.status = 'lapsed';
      claim.decidedDay = world.day;
      emit(world, 'club', `${pot.name} did not answer ${nameOfClaimant(world, claim)}'s claim; it lapsed.`,
        [claim.claimantId], 0.3, { potId: pot.id, claimId: claim.id });
      remember(world, claim.claimantId, 'money', `Nobody at ${pot.name} answered your claim; it lapsed. You may ask again.`);
      continue;
    }
    const tally = countVotes(pot, claim);
    const everyone = tally.cast >= pot.members.filter((m) => m !== claim.claimantId).length && tally.cast > 0;
    const ripe = world.day - claim.day >= CLAIM_DECIDES_AFTER_DAYS;
    if (!everyone && !ripe) continue;
    if (tally.cast === 0) {
      claim.status = 'lapsed';
      claim.decidedDay = world.day;
      remember(world, claim.claimantId, 'money', `Nobody at ${pot.name} voted on your claim; it lapsed.`);
      continue;
    }
    if (tally.ayes > tally.nays) {
      settleClaim(world, pot, claim, claim.amount, 'voted');
    } else {
      claim.status = 'refused';
      claim.decidedDay = world.day;
      emit(world, 'club', `${pot.name} refused ${nameOfClaimant(world, claim)}'s claim (${tally.ayes} for, ${tally.nays} against).`,
        [claim.claimantId], 0.3, { potId: pot.id, claimId: claim.id });
      remember(world, claim.claimantId, 'money', `${pot.name} refused your claim (${tally.ayes} for, ${tally.nays} against).`);
    }
  }
}

/** Every pot the register holds, live ones first. */
export function allPots(world: World): Pot[] {
  return Object.values(financeState(world).pots).filter((p) => p.closedDay === null);
}

/** The strongbox behind a pot, for anything that needs the party itself. */
export function potParty(pot: Pot): BusinessId {
  return pot.boxId;
}
