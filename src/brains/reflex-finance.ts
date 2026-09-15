/**
 * The reflex brain's money (`docs/FINANCE.md`): the counter at the Lantern
 * Bank, the mutual most citizens will hold, an underwriter's line, and the
 * city's own paper.
 *
 * Every step here reads public facts a citizen could read for itself — what
 * the vault holds against its deposits, what the Chronicle said about the
 * bank this morning, what the pot holds against what a member is asking for,
 * what the auction is offering against what the city can service — and
 * answers what its own situation asks. Nothing is a strategy, and nothing is
 * "always do X": a comfortable citizen saves, a frightened one queues, a poor
 * one pools, and the same citizen does all three in different months.
 *
 * The run is the clearest case. There is no `run_on_bank` action: a run is
 * what it looks like when many citizens each choose `withdraw` on the same
 * morning, because each of them read the same confidence number and did not
 * like it (`FINANCE.md` §5).
 */
import type { Action, Citizen, World } from '../types.ts';
import { chance } from '../util/rng.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { avgDailyIncome } from '../economy/bank.ts';
import { bankState, depositOf, depositsTotal, vaultBalance } from '../finance/bank.ts';
import { bankConfidence, defaultedLoanShare, loanBook } from '../finance/credit.ts';
import { BOND_FACE, holdingsOf, livePrice, openAuctions } from '../finance/bonds.ts';
import { openOffers } from '../finance/secondary.ts';
import { currencyCoverage, restructureOf } from '../finance/debt.ts';
import { claimsToAnswer, openLines, policiesOf, policyOf } from '../finance/insurance.ts';
import { UNDERWRITER_CAPITAL, UNDERWRITER_FEE, houseFunds, underwriterOwnedBy } from '../finance/houses.ts';
import { lossOnRecord, quotePremium } from '../finance/premiums.ts';
import { DUES_GRACE_DAYS, MUTUAL_MIN_MEMBERS, allMutuals, duesStanding, mutualFor, potOfMutual } from '../finance/mutual.ts';
import { openClaimsOf, potBalance } from '../finance/pot.ts';
import type { Ctx } from './reflex-util.ts';

/**
 * Lumens a citizen keeps in hand before it puts anything in the vault. It is
 * deliberately more than a week's eating: a room asks a deposit, the Academy a
 * fee, a shop four hundred, and every one of those choices reads the *wallet*.
 */
export const WORKING_BALANCE = 300;
/**
 * And how much of what is over that a citizen will part with in one visit.
 * Saving everything above the line is what turns a vault into a ratchet — the
 * surplus goes in, nothing comes back until the saver is destitute, and a city
 * of savers has no money left to buy anything with.
 */
export const SAVING_SHARE = 0.5;
/** Confidence below which a depositor stops reading and starts queueing. */
export const RUN_CONFIDENCE = 0.45;
/** A wallet this thin is a reason to take savings back out. */
export const SHORT = 40;
/** What a mutual's dues may cost as a share of a citizen's daily income. */
export const DUES_SHARE = 0.12;
/** A premium worth this much of a day's income is worth the cover. */
export const PREMIUM_SHARE = 0.15;
/** Lumens spare before a citizen bids at an auction of the city's paper. */
export const BIDDING_FLOOR = 250;
/** What an ambitious citizen keeps out of the vault, against a founding fee. */
export const AMBITION_BUFFER = 600;

/** What this citizen earns in a day, the dividend included. */
function income(world: World, c: Citizen): number {
  return Math.max(1, avgDailyIncome(world, c) + world.government.dividend);
}

/** What the city says about its own bank this morning. */
function confidence(world: World): number {
  const stored = bankState(world).confidence;
  return stored > 0 ? stored : bankConfidence(world);
}

// ---------------------------------------------------------------------------
// The counter
// ---------------------------------------------------------------------------

/**
 * What a citizen keeps in hand: a fortnight of its own spending, and more
 * where it is saving toward something the vault would swallow — a business, a
 * guild's founding fee, a house's capital. A deposit is what is left over
 * after the things lumens are actually for.
 */
function keepInHand(world: World, c: Citizen): number {
  return Math.max(WORKING_BALANCE, Math.round(income(world, c) * 2),
    c.personality.ambition > 0.6 ? AMBITION_BUFFER : 0);
}

/**
 * Savings, and the run. A citizen with more in hand than it needs puts the
 * surplus where it earns 0.4 % a day; a citizen whose wallet has run down
 * draws on it again; and a citizen who reads the morning's confidence and does
 * not like it joins the queue with everybody else who read the same number.
 */
export function trySavings(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const held = depositOf(world, c.id);
  const shaky = confidence(world) < RUN_CONFIDENCE;
  const buffer = keepInHand(world, c);

  if (held > 0 && ctx.can.has('withdraw')) {
    // The run. Nothing coordinates it: each depositor reads the same public
    // number, and the ones who read it early are the ones who are paid.
    if (shaky) {
      const key = `runWeighed:${c.id}:${world.day}`;
      if (!world.counters[key]) {
        world.counters[key] = 1;
        // The more frightening the number, the more of the city acts on it.
        if (chance(world, 0.35 + (RUN_CONFIDENCE - confidence(world)))) {
          return { type: 'withdraw', amount: held };
        }
      }
    }
    // A deposit is a current account and not a hole in the ground. Everything
    // else a citizen does reads its *wallet* — the room it can take, the
    // concern it can found, the lesson it can pay for — so a saver whose
    // wallet has fallen under what it means to keep in hand draws it back up,
    // once a day, at the counter. Without this the vault is a ratchet: every
    // surplus lumen goes in, none comes out until the citizen is destitute,
    // and a city of savers stops buying anything.
    const low = Math.max(SHORT, Math.round(buffer / 2));
    const key = `drewOn:${c.id}`;
    if (c.wallet < low && world.counters[key] !== world.day) {
      world.counters[key] = world.day;
      return { type: 'withdraw', amount: Math.min(held, Math.max(SHORT, buffer - c.wallet)) };
    }
  }

  if (!ctx.can.has('deposit') || shaky) return null;
  if (bankState(world).depositRate <= 0) return null;
  const spare = c.wallet - buffer;
  if (spare < 50 || c.loanId) return null;
  const key = `depositWeighed:${c.id}`;
  if (world.counters[key] === world.day) return null;
  world.counters[key] = world.day;
  // Saving is a real choice and not the obvious one: it beats a wallet and
  // loses to owning anything.
  if (!chance(world, 0.25 + c.personality.diligence * 0.3)) return null;
  return { type: 'deposit', amount: Math.max(1, Math.round(spare * SAVING_SHARE)) };
}

/**
 * The bankers' own hours: the rates they post and the loans they call. A
 * vault under its reserve is called in; a vault with money idle and nobody
 * borrowing is cheapened.
 */
export function tryBanker(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const bank = bankState(world);
  if (ctx.can.has('call_loan')) {
    const short = vaultBalance(world) < depositsTotal(world) * bank.reserveRatio;
    for (const loan of Object.values(world.loans)) {
      if (loan.outstanding <= 0 || bank.called[loan.id] !== undefined) continue;
      const stale = world.day - loan.lastPaymentDay;
      if (!loan.defaulted && !short && stale < 5) continue;
      const key = `callWeighed:${c.id}:${loan.id}`;
      if (world.counters[key]) continue;
      world.counters[key] = 1;
      return { type: 'call_loan', loanId: loan.id };
    }
  }
  if (!ctx.can.has('set_deposit_rate') && !ctx.can.has('set_lending_rate')) return null;
  const key = `ratesWeighed:${c.id}`;
  if (world.counters[key] === world.day || !chance(world, 0.25)) return null;
  world.counters[key] = world.day;
  const deposits = depositsTotal(world);
  const vault = vaultBalance(world);
  // Money that is not there is bought with a better rate; money that is idle
  // is not worth paying for.
  if (deposits > 0 && vault < deposits * bank.reserveRatio && ctx.can.has('set_deposit_rate')) {
    return { type: 'set_deposit_rate', rate: Math.min(bank.lendingRate, Math.round((bank.depositRate + 0.001) * 10_000) / 10_000) };
  }
  if (vault > deposits * 2 && bank.depositRate > 0.001 && ctx.can.has('set_deposit_rate')) {
    return { type: 'set_deposit_rate', rate: Math.round((bank.depositRate - 0.001) * 10_000) / 10_000 };
  }
  // The spread pays the bankers, the profit tax and the bad loans. A book that
  // is going bad is repriced; one that is behaving is cheapened, because a
  // dear loan is a loan nobody takes.
  if (ctx.can.has('set_lending_rate')) {
    const bad = defaultedLoanShare(world);
    if (bad > 0.2 && bank.lendingRate < 0.05) {
      return { type: 'set_lending_rate', rate: Math.round((bank.lendingRate + 0.002) * 10_000) / 10_000 };
    }
    if (bad === 0 && loanBook(world) <= 0 && bank.lendingRate > bank.depositRate + 0.002) {
      return { type: 'set_lending_rate', rate: Math.round((bank.lendingRate - 0.002) * 10_000) / 10_000 };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The pot
// ---------------------------------------------------------------------------

/**
 * Asking the pot, which is the one thing here that will not wait: a member
 * with no roof, nothing to eat or rent already in arrears asks its mutual
 * before it thinks about a deposit, a bond or a policy.
 */
export function tryAid(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('claim_aid')) return null;
  const mutual = mutualFor(world, c.id);
  const pot = mutual ? potOfMutual(world, mutual) : null;
  if (!mutual || !pot) return null;
  const daily = income(world, c);
  const balance = potBalance(world, pot);
  // What a mutual is for: the week a household genuinely cannot carry — a
  // roof gone, a day without eating, rent already in arrears — and not the
  // ordinary thin Tuesday, which is what wages are for.
  const desperate = c.wallet < daily
    && (c.homeTier === 0 || c.needs.energy < 35 || c.rentArrearsDays > 0);
  const asking = openClaimsOf(world, pot.id).some((k) => k.claimantId === c.id);
  if (!desperate || asking || balance < daily * 2 || pot.members.length < MUTUAL_MIN_MEMBERS) return null;
  const key = `aidAsked:${c.id}`;
  if (world.counters[key] === world.day) return null;
  world.counters[key] = world.day;
  const amount = Math.max(1, Math.min(Math.round(balance / 2), Math.round(daily * 3)));
  return {
    type: 'claim_aid', amount,
    reason: c.homeTier === 0 ? 'I have no roof and nothing to take one with.' : 'I cannot cover what I owe this week.',
  };
}

/**
 * Mutual aid: the poor citizen's insurance, and the one most citizens hold.
 * A policy is enforceable on the docket and a pot's payout is enforceable
 * nowhere, so what a pot covers is what no underwriter will write.
 */
export function tryMutual(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const mutual = mutualFor(world, c.id);
  const daily = income(world, c);

  if (!mutual) {
    if (ctx.can.has('join_mutual')) {
      // Somebody whose own margin is thin, and whose neighbours are already in.
      for (const m of allMutuals(world)) {
        if (m.dues > daily * DUES_SHARE) continue;
        const pot = potOfMutual(world, m);
        if (!pot) continue;
        const known = pot.members.some((id) => bondBetween(world, c.id, id) >= 20);
        const exposed = c.homeTier === 0 || c.wallet < daily * 3 || ctx.job === null;
        if (!known && !exposed) continue;
        const key = `mutualWeighed:${c.id}`;
        if (world.counters[key] === world.day) return null;
        world.counters[key] = world.day;
        if (!chance(world, 0.3 + c.personality.sociability * 0.3)) return null;
        return { type: 'join_mutual', mutualId: m.id };
      }
    }
    // Nothing on the roll this citizen could carry — no mutual at all, or
    // none whose dues fit its own week — is a reason to start one.
    const affordableRoll = allMutuals(world).some((m) => m.dues <= daily * DUES_SHARE);
    if (ctx.can.has('found_mutual') && !affordableRoll) {
      // It takes five adults, so it takes somebody sociable enough to think
      // the other four will come.
      if (c.personality.sociability > 0.6 && c.wallet > 200 && chance(world, 0.05)) {
        const dues = Math.max(1, Math.min(50, Math.round(daily * 0.05)));
        return { type: 'found_mutual', name: `The ${c.familyName ?? c.name} Benevolent Fund`, dues };
      }
    }
    return null;
  }

  const pot = potOfMutual(world, mutual);
  if (!pot) return null;
  // A member weighs one claim a day, and only while its vote is still open:
  // the Exchange is a stop on the way somewhere, not a citizen's afternoon,
  // and a claim a majority has already carried or refused is decided whatever
  // anybody else thinks of it.
  const half = Math.floor(pot.members.length / 2) + 1;
  if (ctx.can.has('vote_aid') && world.counters[`aidVoted:${c.id}`] !== world.day) {
    for (const k of openClaimsOf(world, pot.id)) {
      if (k.claimantId === c.id || k.votes[c.id] !== undefined) continue;
      const cast = Object.values(k.votes);
      if (cast.filter(Boolean).length >= half || cast.filter((v) => !v).length >= half) continue;
      world.counters[`aidVoted:${c.id}`] = world.day;
      const claimant = world.citizens[k.claimantId];
      const balance = potBalance(world, pot);
      // What a mutual pays is what its own members think deserves paying for:
      // a member in real trouble, for a sum the pot can carry.
      const need = !!claimant && (claimant.wallet < daily || claimant.homeTier === 0 || claimant.needs.energy < 30);
      // Half the pot to anybody who asks; the whole of it only for somebody
      // who plainly cannot wait, because there is no more where it came from.
      const affordable = k.amount <= balance / 2 || (need && k.amount <= balance);
      const friend = !!claimant && bondBetween(world, c.id, claimant.id) > 20;
      return { type: 'vote_aid', claimId: k.id, aye: affordable && (need || friend) };
    }
  }
  // Dues fall due daily and the roll calls a member in arrears after three
  // days, so a member walks to the Exchange when the roll is about to call it
  // one and not before: an hour is worth more than a lumen.
  if (ctx.can.has('pay_dues') && c.wallet >= mutual.dues * 3 && duesStanding(world, mutual, c.id).days >= DUES_GRACE_DAYS) {
    return { type: 'pay_dues', mutualId: mutual.id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

/**
 * Insurance: bought where there is something to lose and the premium is small
 * beside a day's income, written where somebody holds the capital and the
 * licence, and answered on the public record either way.
 */
export function tryInsurance(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const house = underwriterOwnedBy(world, c.id);

  if (house) {
    // A house answers its claims: it pays what the registers show happened and
    // refuses what they do not, with a reason, on the record.
    if (ctx.can.has('settle_claim') || ctx.can.has('deny_claim')) {
      for (const k of claimsToAnswer(world, c.id)) {
        const policy = policyOf(world, k.policyId);
        const shown = policy ? lossOnRecord(world, policy, 7) : false;
        const funds = houseFunds(world, house.id);
        if (shown && funds >= k.amount && ctx.can.has('settle_claim')) {
          return { type: 'settle_claim', claimId: k.id, amount: k.amount };
        }
        if (!ctx.can.has('deny_claim')) continue;
        return {
          type: 'deny_claim', claimId: k.id,
          reason: shown ? 'The house cannot fund a claim of this size today.' : 'No register shows a loss of this kind.',
        };
      }
    }
    if (ctx.can.has('offer_policy')) {
      const key = `lineWeighed:${c.id}`;
      if (world.counters[key] !== world.day && chance(world, 0.3)) {
        world.counters[key] = world.day;
        const funds = houseFunds(world, house.id);
        // A line the city can actually take: cover a quarter of what the house
        // holds, so a bad run costs it one policy and not the whole book. What
        // it writes is what Reverie actually loses — a house is a storm and a
        // burglary, premises are fire, flood and the blackout — and a house
        // does not post the same line twice.
        const mine = openLines(world).filter((o) => o.underwriterId === house.id);
        const kind: 'home' | 'business' = mine.some((o) => o.kind === 'home') ? 'business' : 'home';
        if (mine.some((o) => o.kind === kind)) return null;
        const cover = Math.max(20, Math.min(2_000, Math.round(funds / 4)));
        const premium = Math.max(1, quotePremium(world, kind, cover, 28, house.id));
        return { type: 'offer_policy', kind, cover, premium, term: 28 };
      }
    }
    return null;
  }

  if (ctx.can.has('file_claim')) {
    for (const p of policiesOf(world, c.id)) {
      // A claim for a loss that did not happen is fraud, so a scripted mind
      // reads the registers before it files.
      if (!lossOnRecord(world, p, 3)) continue;
      const key = `claimFiled:${c.id}:${p.id}`;
      if (world.counters[key]) continue;
      world.counters[key] = 1;
      const amount = Math.max(1, Math.min(p.cover - p.claimed, Math.round(p.cover / 2)));
      return { type: 'file_claim', policyId: p.id, event: `a loss of the kind this ${p.kind} cover was written for`, amount };
    }
  }
  // Underwriting is promising to pay: it takes the capital, the fee, a
  // banker's licence and somebody willing to carry a bad run.
  if (ctx.can.has('found_underwriter') && c.personality.ambition > 0.5
    && c.wallet > UNDERWRITER_CAPITAL + UNDERWRITER_FEE && chance(world, 0.3)) {
    return { type: 'found_underwriter', name: `${c.familyName ?? c.name} Assurance`, capital: UNDERWRITER_CAPITAL };
  }
  if (!ctx.can.has('buy_policy')) return null;
  // Something to lose: a concern, a home above the bunks, or possessions.
  const stake = (ctx.biz ? 1 : 0) + (c.homeTier >= 2 ? 1 : 0) + (c.possessions.length > 2 ? 1 : 0);
  if (stake === 0) return null;
  const daily = income(world, c);
  for (const line of openLines(world)) {
    if (line.premium > daily * PREMIUM_SHARE || c.wallet < line.premium * 10) continue;
    // Cover is only worth buying for something this citizen actually has: a
    // concern for premises, a roof for a home. Nobody insures a caravan they
    // will never load.
    if (line.kind === 'business' && !ctx.biz) continue;
    if (line.kind === 'home' && c.homeTier === 0) continue;
    if (line.kind !== 'business' && line.kind !== 'home') continue;
    if (policiesOf(world, c.id).some((p) => p.kind === line.kind)) continue;
    const key = `coverWeighed:${c.id}`;
    if (world.counters[key] === world.day) return null;
    world.counters[key] = world.day;
    if (!chance(world, 0.2 + stake * 0.15)) return null;
    return { type: 'buy_policy', policyId: line.id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The city's paper
// ---------------------------------------------------------------------------

/**
 * The auction is the credit rating, and it is priced by whoever turns up. A
 * citizen with savings it does not need bids what the city's own coverage
 * says the paper is worth; a citizen who needs the money sells what it holds.
 */
export function tryBonds(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const held = holdingsOf(world, c.id);

  if (ctx.can.has('vote_restructure')) {
    for (const h of held) {
      const offer = restructureOf(world, h.issueId);
      if (!offer || offer.votes[c.id] !== undefined) continue;
      // Better a haircut than a default: a holder accepts where the city
      // plainly cannot pay, and calls the bluff where it plainly can.
      const coverage = currencyCoverage(world, depositsTotal(world));
      return { type: 'vote_restructure', issueId: h.issueId, accept: coverage < 0.6 };
    }
  }
  if (ctx.can.has('sell_bond') && c.wallet < SHORT) {
    const listed = new Set(openOffers(world).map((o) => o.holdingId));
    const h = held.find((x) => !listed.has(x.id));
    // Paper is what a citizen sells when the wallet is empty and the coupon is
    // further off than dinner: a little under the last traded price, to move it.
    if (h) return { type: 'sell_bond', holdingId: h.id, price: Math.max(1, Math.round(livePrice(world, h.issueId) - 2)) };
  }
  if (ctx.can.has('buy_bond') && c.wallet > BIDDING_FLOOR) {
    for (const offer of openOffers(world)) {
      if (offer.sellerId === c.id) continue;
      const cost = offer.price * offer.qty;
      // Worth taking where it is going for less than the register's own price
      // and the wallet is not left thin by it.
      if (cost > c.wallet - WORKING_BALANCE) continue;
      if (offer.price >= livePrice(world, offer.issueId)) continue;
      // One buyer to an offer in an hour: the second to reach the Exchange
      // finds it gone and has spent the hour finding out.
      const claim = `bondOfferClaim:${offer.id}`;
      if (world.counters[claim] === world.tick) continue;
      world.counters[claim] = world.tick;
      return { type: 'buy_bond', offerId: offer.id };
    }
  }
  if (!ctx.can.has('bid_bond')) return null;
  const spare = c.wallet - Math.max(BIDDING_FLOOR, Math.round(income(world, c) * 4));
  if (spare < BOND_FACE) return null;
  for (const issue of openAuctions(world)) {
    const key = `bidWeighed:${c.id}:${issue.id}`;
    if (world.counters[key]) continue;
    world.counters[key] = 1;
    // What the paper is worth to this citizen: par, less what the city's own
    // coverage and its debt service say about being paid back.
    const coverage = currencyCoverage(world, depositsTotal(world));
    const price = Math.max(1, Math.min(BOND_FACE, Math.round(BOND_FACE * Math.min(1, 0.75 + coverage / 4))));
    const qty = Math.max(1, Math.floor(spare / price));
    if (qty < 1) continue;
    if (!chance(world, 0.3 + c.personality.ambition * 0.2)) return null;
    return { type: 'bid_bond', issueId: issue.id, price, qty: Math.min(qty, issue.size) };
  }
  return null;
}

/**
 * Everything the money layer offers a scripted citizen, in the order its own
 * situation asks: the bank's own officers first, then a member who cannot eat
 * asking the pot, then the things a spare lumen can be put into, and last the
 * counter. Dues and a vote on somebody else's claim sit below all of it
 * because they are errands, and a citizen with an errand and an opportunity
 * does the opportunity — which is also why the vault is where money goes when
 * there is nothing better to do with it, rather than the first stop.
 */
export function tryMoney(ctx: Ctx): Action | null {
  return tryBanker(ctx) ?? tryAid(ctx) ?? tryBonds(ctx) ?? tryInsurance(ctx) ?? tryMutual(ctx) ?? trySavings(ctx);
}
