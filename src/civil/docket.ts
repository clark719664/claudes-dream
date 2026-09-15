/**
 * The civil docket — the same Court on different days, doing the opposite job:
 * a **plaintiff** sues a **defendant** for money, rather than the city
 * prosecuting for punishment (`docs/CIVIL.md` §4).
 *
 * It sits at tick 16 on the second and fifth day of each week, leaving the
 * criminal list at ticks 10–11, the Court's second sitting at 12 and the
 * Council's session at 14 untouched (`REGISTRY.md` §2). One judge sits alone
 * under a 500 ℓ claim and three above it, under Article V recusal unchanged.
 *
 * Nothing the docket does touches liberty. A finding for the plaintiff is an
 * amount owed, an order to do a thing that still can be done, or a deal
 * unwound — and never a fine, a suspension, an exile or a cell, because a
 * broken promise is not a crime and the Charter's Article VI does not bend for
 * money.
 */
import { clamp } from '../types.ts';
import type { CitizenId, World } from '../types.ts';
import { memo } from '../util/memo.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, transfer } from '../economy/treasury.ts';
import type { CivilFinding, CivilOrder, Plea, Suit } from './shapes.ts';
import { civilSettings, civilState, contractRecordOf, nextCivilId } from './state.ts';
import type { CivilResult } from './common.ts';
import { canPay, fail, lumens, nameOf, ok } from './common.ts';
import { contractById, isParty, moneyLeg, outstandingConsideration } from './terms.ts';
import { markBreach } from './amend.ts';
import { returnEscrows } from './escrow.ts';
import {
  CIVIL_THRESHOLD, MAX_CARRIED, WITHOUT_MERIT,
  assessDamages, costsAgainst, damagesCap, meritOf, selectCivilBench,
} from './merit.ts';
import { orderJudgment, recordJudgmentSides } from './enforcement.ts';
import { restoreLicence } from './guilds.ts';

/** The docket sits at tick 16. */
export const DOCKET_HOUR = 16;

/** `file_suit` costs 10 ℓ + 2 % of the claim, capped at 80 ℓ. */
export function suitFee(world: World, damages: number): number {
  const s = civilSettings(world);
  return Math.min(s.suitCap, Math.round(s.suitFlat + s.suitRate * Math.max(0, damages)));
}

/** The second and fifth day of the week, as the Council currently has them. */
export function isDocketDay(world: World): boolean {
  return civilSettings(world).docketDays.includes(((world.day % 7) + 7) % 7);
}

/**
 * The Council's proposal, applied: what filing costs. `contract` moves the fee
 * on an instrument and `suit` the fee on the docket; both keep their shape —
 * a flat part, a rate on the value, and a cap — because a fee with no cap
 * closes the Court to whoever has least.
 */
export function setFilingFee(
  world: World, which: 'contract' | 'suit', spec: { flat?: number; rate?: number; cap?: number },
): void {
  const s = civilSettings(world);
  const flat = spec.flat === undefined ? null : Math.max(0, Math.round(spec.flat));
  const rate = spec.rate === undefined ? null : Math.max(0, Math.min(0.25, spec.rate));
  const cap = spec.cap === undefined ? null : Math.max(1, Math.round(spec.cap));
  if (which === 'contract') {
    if (flat !== null) s.filingFlat = flat;
    if (rate !== null) s.filingRate = rate;
    if (cap !== null) s.filingCap = cap;
  } else {
    if (flat !== null) s.suitFlat = flat;
    if (rate !== null) s.suitRate = rate;
    if (cap !== null) s.suitCap = cap;
  }
}

/** The Council's proposal, applied: which weekdays the docket sits. */
export function setDocketDays(world: World, days: number[]): void {
  const clean = [...new Set(days.map((d) => ((Math.round(d) % 7) + 7) % 7))].sort((a, b) => a - b);
  if (clean.length > 0) civilSettings(world).docketDays = clean;
}

// ---------------------------------------------------------------------------
// Reading the docket
// ---------------------------------------------------------------------------

export function allSuits(world: World): Suit[] {
  return memo(world, 'civil:suits', () => Object.values(civilState(world).suits));
}

export function suitById(world: World, id: string): Suit | null {
  return civilState(world).suits[id] ?? null;
}

export function suitsAgainst(world: World, cId: CitizenId): Suit[] {
  return allSuits(world).filter((s) => s.defendantId === cId);
}

export function suitsBy(world: World, cId: CitizenId): Suit[] {
  return allSuits(world).filter((s) => s.plaintiffId === cId);
}

/** Suits waiting for a sitting, oldest first. */
export function pendingSuits(world: World): Suit[] {
  return allSuits(world).filter((s) => s.status === 'filed').sort((a, b) => a.filedDay - b.filedDay || a.id.localeCompare(b.id));
}

/** Suits a bench is hearing right now. */
export function sittingSuits(world: World): Suit[] {
  return allSuits(world).filter((s) => s.status === 'in_session');
}

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

export interface SuitSpec {
  defendant: CitizenId;
  contractId?: string | null;
  /** The pleading: what the plaintiff says happened. */
  claim: string;
  /** The sum sued for. */
  damages: number;
  /** A struck-off member suing to be restored names their guild. */
  guildId?: string | null;
}

/**
 * Open a civil case on the docket. The fee goes to the Treasury and is refunded
 * by the defendant on a finding for the plaintiff; a plaintiff who loses has
 * spent it.
 */
export function fileSuit(world: World, plaintiffId: CitizenId, spec: SuitSpec): CivilResult {
  const plaintiff = world.citizens[plaintiffId];
  const defendant = world.citizens[spec.defendant];
  if (!plaintiff) return fail('Unknown citizen.');
  if (plaintiff.standing === 'exiled') return fail('You are beyond the docket’s reach.');
  if (!defendant || spec.defendant === plaintiffId) return fail('There is nobody to sue there.');
  if (defendant.standing === 'exiled') return fail('That citizen is beyond the docket’s reach.');
  if (!spec.claim || spec.claim.trim().length < 3) return fail('A suit has to say what it is about.');
  const damages = lumens(spec.damages);
  if (damages <= 0) return fail('A suit has to name a sum.');
  const k = spec.contractId ? contractById(world, spec.contractId) : null;
  if (spec.contractId && !k) return fail('There is no such contract.');
  if (k && !isParty(k, plaintiffId)) return fail('You are not a party to that contract.');
  if (k && !isParty(k, spec.defendant)) return fail('They are not a party to that contract.');

  const fee = suitFee(world, damages);
  if (!canPay(world, plaintiffId, fee)) return fail(`Opening a suit for ${formatLumens(damages)} costs ${fee} ℓ, which you do not have.`);
  if (!transfer(world, plaintiffId, 'treasury', fee, 'fee', `filing fee for a civil suit`)) return fail('The filing fee could not be paid.');

  const id = nextCivilId(world, 'cs');
  const suit: Suit = {
    id, plaintiffId, defendantId: spec.defendant, contractId: k?.id ?? null,
    claim: spec.claim.trim(), damages, filedDay: world.day, fee, status: 'filed',
    plea: null, answer: '', answeredDay: null, counterclaimId: null, answersSuitId: null,
    judges: [], votes: [], carried: 0, offer: null, settledAmount: null, settledDay: null,
    finding: null, order: null, award: 0, costs: 0, judgedDay: 0, reasons: [], merit: 0,
    guildId: spec.guildId ?? null,
  };
  civilState(world).suits[id] = suit;
  emit(world, 'law', `${plaintiff.name} sued ${defendant.name} for ${formatLumens(damages)} on the civil docket (${id}): ${suit.claim}`,
    [plaintiffId, spec.defendant], 0.4, { suit: id, claim: damages, contract: suit.contractId });
  remember(world, spec.defendant, 'civic', `${plaintiff.name} has sued you for ${damages} ℓ (${id}): ${suit.claim}. `
    + 'You may admit, deny, sue back, or offer to settle. Silence is not an admission, and this is not a criminal charge.');
  return ok(`You filed suit ${id} against ${defendant.name} for ${damages} ℓ, and paid ${fee} ℓ to open it.`, id);
}

/**
 * Admit, deny, set out your side, or sue back. Silence is not an admission, and
 * the judge decides on the record either way — but an admission needs no bench,
 * so it decides the suit where it stands.
 */
export function answerSuit(
  world: World, actorId: CitizenId, suitId: string, plea: Plea, text: string,
  counterclaim?: { claim: string; damages: number } | null,
): CivilResult {
  const suit = suitById(world, suitId);
  if (!suit) return fail('There is no such suit.');
  if (suit.defendantId !== actorId) return fail('That suit is not against you.');
  if (suit.status !== 'filed' && suit.status !== 'in_session') return fail(`Suit ${suit.id} is already ${suit.status}.`);
  if (plea !== 'admit' && plea !== 'deny') return fail('An answer admits or denies.');
  suit.plea = plea;
  suit.answer = (text ?? '').trim();
  suit.answeredDay = world.day;

  let counter: CivilResult | null = null;
  if (counterclaim && plea === 'deny') {
    counter = fileSuit(world, actorId, {
      defendant: suit.plaintiffId, contractId: suit.contractId, claim: counterclaim.claim, damages: counterclaim.damages,
    });
    if (counter.ok && counter.id) {
      suit.counterclaimId = counter.id;
      const back = suitById(world, counter.id);
      if (back) back.answersSuitId = suit.id;
    }
  }
  emit(world, 'law', `${nameOf(world, actorId)} ${plea === 'admit' ? 'admitted' : 'denied'} ${nameOf(world, suit.plaintiffId)}'s claim in ${suit.id}`
    + `${suit.counterclaimId ? ` and counterclaimed (${suit.counterclaimId})` : ''}.`, [actorId, suit.plaintiffId], 0.3,
    { suit: suit.id, plea });
  if (plea === 'admit') {
    const award = damagesCap(world, suit);
    decide(world, suit, 'plaintiff', award, 'damages', [`${nameOf(world, actorId)} admitted the claim.`]);
    return ok(`You admitted the claim in ${suit.id}; ${formatLumens(award)} stands against you as a judgment.`, suit.id);
  }
  return ok(`You answered ${suit.id}.${counter && counter.ok ? ` Your counterclaim is ${counter.id}.` : ''}`, suit.id);
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/** Offer to end it before judgment, at whatever figure the two agree. */
export function offerSettlement(world: World, actorId: CitizenId, suitId: string, amount: number): CivilResult {
  const suit = suitById(world, suitId);
  if (!suit) return fail('There is no such suit.');
  if (suit.status !== 'filed' && suit.status !== 'in_session') return fail(`Suit ${suit.id} is already ${suit.status}.`);
  if (actorId !== suit.plaintiffId && actorId !== suit.defendantId) return fail('That suit is not yours to settle.');
  const sum = lumens(amount);
  suit.offer = { byId: actorId, amount: sum, day: world.day };
  const other = actorId === suit.plaintiffId ? suit.defendantId : suit.plaintiffId;
  emit(world, 'law', `${nameOf(world, actorId)} offered to settle ${suit.id} at ${formatLumens(sum)}.`,
    [actorId, other], 0.3, { suit: suit.id, amount: sum });
  remember(world, other, 'civic', `${nameOf(world, actorId)} offers to settle ${suit.id} at ${sum} ℓ. `
    + 'A settled case is neither kept nor breached on anybody’s record.');
  return ok(`You offered to settle ${suit.id} at ${sum} ℓ.`, suit.id);
}

/** Take the offer; the case closes settled, which is neither kept nor breached. */
export function acceptSettlement(world: World, actorId: CitizenId, suitId: string): CivilResult {
  const suit = suitById(world, suitId);
  if (!suit) return fail('There is no such suit.');
  if (!suit.offer) return fail('There is nothing on the table.');
  if (suit.status !== 'filed' && suit.status !== 'in_session') return fail(`Suit ${suit.id} is already ${suit.status}.`);
  if (actorId !== suit.plaintiffId && actorId !== suit.defendantId) return fail('That suit is not yours to settle.');
  if (suit.offer.byId === actorId) return fail('An offer is taken by the other side.');
  const amount = suit.offer.amount;
  if (amount > 0) {
    if (!canPay(world, suit.defendantId, amount)) return fail(`${nameOf(world, suit.defendantId)} cannot find ${formatLumens(amount)} today.`);
    if (!transfer(world, suit.defendantId, suit.plaintiffId, amount, 'restitution', `settlement of ${suit.id}`)) {
      return fail('The settlement could not be paid.');
    }
  }
  suit.status = 'settled';
  suit.settledAmount = amount;
  suit.settledDay = world.day;
  for (const id of [suit.plaintiffId, suit.defendantId]) contractRecordOf(world, id).settled += 1;
  emit(world, 'law', `${nameOf(world, suit.plaintiffId)} and ${nameOf(world, suit.defendantId)} settled ${suit.id} `
    + `at ${formatLumens(amount)}. The record reads settled.`, [suit.plaintiffId, suit.defendantId], 0.4,
    { suit: suit.id, amount });
  for (const id of [suit.plaintiffId, suit.defendantId]) {
    remember(world, id, 'money', `Suit ${suit.id} was settled at ${amount} ℓ. Settled is neither kept nor breached.`);
  }
  return ok(`You settled ${suit.id} at ${amount} ℓ.`, suit.id);
}

// ---------------------------------------------------------------------------
// The sitting
// ---------------------------------------------------------------------------

/** Seat a bench on everything filed. Called at `DOCKET_HOUR` on a docket day. */
export function openDocket(world: World): Suit[] {
  if (!isDocketDay(world)) return [];
  const opened: Suit[] = [];
  for (const suit of pendingSuits(world)) {
    const bench = selectCivilBench(world, suit.plaintiffId, suit.defendantId, suit.damages);
    suit.judges = bench;
    suit.merit = meritOf(world, suit).merit;
    if (bench.length === 0) {
      suit.carried += 1;
      continue;
    }
    suit.status = 'in_session';
    opened.push(suit);
    emit(world, 'law', `The civil docket took up ${suit.id}: ${nameOf(world, suit.plaintiffId)} against `
      + `${nameOf(world, suit.defendantId)} for ${formatLumens(suit.damages)}, before `
      + `${bench.length === 1 ? 'one judge' : `${bench.length} judges`}.`, bench, 0.3,
      { suit: suit.id, judges: bench, merit: Math.round(suit.merit * 100) / 100 });
    for (const id of bench) {
      remember(world, id, 'civic', `You sit on civil suit ${suit.id} today: ${nameOf(world, suit.plaintiffId)} against `
        + `${nameOf(world, suit.defendantId)} for ${suit.damages} ℓ. Civil belief clears a half, not 0.55: `
        + 'the question is which of the two is more likely right.');
    }
  }
  return opened;
}

/** (Judges) decide a case on the docket. */
export function judgeCivil(
  world: World, judgeId: CitizenId, suitId: string, finding: CivilFinding, damages: number,
  order: CivilOrder, reason: string,
): CivilResult {
  const suit = suitById(world, suitId);
  if (!suit) return fail('There is no such suit.');
  if (suit.status !== 'in_session') return fail(`Suit ${suit.id} is not before you.`);
  if (!suit.judges.includes(judgeId)) return fail(`You are not sitting on ${suit.id}.`);
  const award = Math.max(0, Math.min(lumens(damages), suit.damages));
  const existing = suit.votes.find((v) => v.judgeId === judgeId);
  const vote = { judgeId, finding, damages: award, order, reason: (reason ?? '').slice(0, 280), day: world.day };
  if (existing) Object.assign(existing, vote);
  else suit.votes.push(vote);
  emit(world, 'verdict', `${nameOf(world, judgeId)} found for the ${finding === 'plaintiff' ? 'plaintiff' : finding === 'defendant' ? 'defendant' : 'defendant, dismissing the claim'} `
    + `in ${suit.id}${finding === 'plaintiff' ? ` at ${formatLumens(award)}` : ''}: ${vote.reason}`,
    [judgeId], 0.3, { suit: suit.id, finding, award });
  if (suit.votes.length >= suit.judges.length) tallySuit(world, suit);
  return ok(`You found for the ${finding} in ${suit.id}.`, suit.id);
}

/** The median of what the majority proposed: no one judge's number, and no average of opposites. */
function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Count the bench. A tie goes to the defendant: money follows the likelier story, and a tie is not likelier. */
export function tallySuit(world: World, suit: Suit): void {
  if (suit.status !== 'in_session' || suit.votes.length === 0) return;
  const tally: Record<CivilFinding, number> = { plaintiff: 0, defendant: 0, dismissed: 0 };
  for (const v of suit.votes) tally[v.finding] += 1;
  const forPlaintiff = tally.plaintiff;
  const against = tally.defendant + tally.dismissed;
  const finding: CivilFinding = forPlaintiff > against ? 'plaintiff' : tally.dismissed > tally.defendant ? 'dismissed' : 'defendant';
  const winners = suit.votes.filter((v) => v.finding === finding);
  const award = finding === 'plaintiff' ? medianOf(winners.map((v) => v.damages)) : 0;
  const order: CivilOrder = finding === 'plaintiff'
    ? (winners.find((v) => v.order !== 'none')?.order ?? 'damages')
    : 'none';
  decide(world, suit, finding, award, order, winners.map((v) => `${nameOf(world, v.judgeId)}: ${v.reason}`));
}

/**
 * The end of the sitting: a bench that did not vote holds the suit over, and a
 * suit held over three times is decided on the record alone — the Chronicle
 * says that the Court failed to sit.
 */
export function closeDocket(world: World): void {
  for (const suit of sittingSuits(world)) {
    if (suit.votes.length > 0) { tallySuit(world, suit); continue; }
    suit.carried += 1;
    if (suit.carried < MAX_CARRIED) {
      suit.status = 'filed';
      suit.judges = [];
      continue;
    }
    const merit = meritOf(world, suit).merit;
    const finding: CivilFinding = merit > CIVIL_THRESHOLD ? 'plaintiff' : 'defendant';
    const assessed = assessDamages(world, suit);
    emit(world, 'law', `The civil docket failed to sit on ${suit.id} three times; it was decided on the record alone.`,
      [suit.plaintiffId, suit.defendantId], 0.5, { suit: suit.id, merit: Math.round(merit * 100) / 100 });
    decide(world, suit, finding, finding === 'plaintiff' ? assessed.award : 0, 'damages',
      [`Decided on the record alone: merit ${Math.round(merit * 100)} of 100.`]);
  }
}

// ---------------------------------------------------------------------------
// The finding
// ---------------------------------------------------------------------------

/** Specific performance: only where the thing still exists and the defendant can still do it. */
function canCompel(world: World, suit: Suit): boolean {
  const k = suit.contractId ? contractById(world, suit.contractId) : null;
  if (suit.guildId) return true;
  if (!k) return false;
  // A judge may never order a citizen to work, so an employment contract is
  // enforced in damages and never by compulsion.
  if (k.kind === 'employment' || k.kind === 'apprenticeship') return false;
  if (k.kind === 'forward' && k.good) {
    const seller = world.citizens[k.offerorId];
    return !!seller && Math.floor(seller.inventory[k.good] ?? 0) >= k.qty;
  }
  return k.status === 'active' || k.status === 'breached';
}

/**
 * Unwind the deal and restore both sides: the escrows go home, the instrument
 * ends, and what moved under it is ordered back. Restoration is not damages, so
 * it is not capped at twice the consideration outstanding — it is the money
 * that actually changed hands, and never more than the sum claimed. An
 * instrument under which no money moved through the Exchange at all (an
 * employment term, whose wages moved through the job) restores nothing.
 */
function rescind(world: World, suit: Suit): number {
  const k = suit.contractId ? contractById(world, suit.contractId) : null;
  if (!k || (k.status !== 'active' && k.status !== 'breached')) return 0;
  returnEscrows(world, k.id, `${suit.id} rescinded the instrument`);
  const moved = moneyLeg(k) === null ? 0 : k.performances.length * k.consideration;
  k.status = 'rescinded';
  k.endsDay = world.day;
  return Math.min(suit.damages, moved);
}

/** Apply a finding. Everything it can do is money, a thing done, or a deal unwound. */
export function decide(
  world: World, suit: Suit, finding: CivilFinding, award: number, order: CivilOrder, reasons: string[],
): void {
  if (suit.status === 'judged' || suit.status === 'settled') return;
  suit.status = 'judged';
  suit.finding = finding;
  suit.judgedDay = world.day;
  suit.reasons = reasons;
  // The merit is read again at the decision, because an answer filed after the
  // bench was seated is part of the record the bench decides on.
  suit.merit = meritOf(world, suit).merit;
  const k = suit.contractId ? contractById(world, suit.contractId) : null;

  if (finding === 'plaintiff') {
    // A judge may order less than the arithmetic allows and never more: the cap
    // is 2 × the consideration outstanding, and never above the sum claimed.
    let owed = clamp(Math.round(award), 0, damagesCap(world, suit));
    let chosen: CivilOrder = order;
    if (order === 'performance' && canCompel(world, suit)) {
      // A struck-off member suing to be restored is asking for one specific
      // thing to be done, and the docket can order it done at once.
      if (suit.guildId && restoreLicence(world, suit.guildId, suit.plaintiffId, `the docket ordered it in ${suit.id}`)) {
        chosen = 'performance';
      } else if (k) {
        k.compelledUntilDay = world.day + 3;
        k.compelledSuitId = suit.id;
        chosen = 'performance';
      } else {
        chosen = 'damages';
      }
    } else if (order === 'rescission') {
      owed = rescind(world, suit);
      chosen = 'rescission';
    } else {
      chosen = 'damages';
    }
    // The defendant refunds the plaintiff's filing fee whatever was ordered: a
    // claim that was right should not cost the person who was right the price
    // of proving it.
    const total = chosen === 'performance' ? suit.fee : owed + suit.fee;
    suit.order = chosen;
    suit.award = owed;
    if (k) contractRecordOf(world, suit.defendantId).adjudicated += 1;
    recordJudgmentSides(world, suit.plaintiffId, suit.defendantId);
    if (total > 0) orderJudgment(world, suit, suit.defendantId, suit.plaintiffId, total, 'judgment');
    emit(world, 'verdict', `The docket found for ${nameOf(world, suit.plaintiffId)} in ${suit.id}: `
      + `${chosen === 'performance' ? 'specific performance within three days' : `${formatLumens(total)} to pay`}. `
      + `${reasons[0] ?? ''}`, [suit.plaintiffId, suit.defendantId], 0.5,
      { suit: suit.id, finding, award: owed, order: chosen });
    remember(world, suit.defendantId, 'civic', `The docket found against you in ${suit.id}: `
      + `${chosen === 'performance' ? 'you are to perform within three days' : `${total} ℓ to pay`}. `
      + 'This is a debt and nothing else — no fine, no cell, no suspension, and nothing on the ban register.');
    remember(world, suit.plaintiffId, 'civic', `The docket found for you in ${suit.id}.`);
    return;
  }

  suit.order = 'none';
  suit.award = 0;
  // Costs follow a plaintiff who lost with nothing behind them, whether the
  // finding was for the defendant or a dismissal: the docket is cheap to open,
  // and the only thing between a rich citizen and forty suits against a rival
  // is the price of losing them.
  if (suit.merit < WITHOUT_MERIT) {
    suit.costs = costsAgainst(world, suit);
    if (suit.costs > 0) orderJudgment(world, suit, suit.plaintiffId, suit.defendantId, suit.costs, 'judgment');
  }
  recordJudgmentSides(world, suit.defendantId, suit.plaintiffId);
  emit(world, 'verdict', `The docket found for ${nameOf(world, suit.defendantId)} in ${suit.id}`
    + `${suit.costs > 0 ? `, with ${formatLumens(suit.costs)} in costs against ${nameOf(world, suit.plaintiffId)}` : ''}. `
    + `${reasons[0] ?? ''}`, [suit.plaintiffId, suit.defendantId], 0.4,
    { suit: suit.id, finding, costs: suit.costs });
  remember(world, suit.plaintiffId, 'civic', `The docket found against you in ${suit.id}; your ${suit.fee} ℓ filing fee is spent`
    + `${suit.costs > 0 ? ` and ${suit.costs} ℓ in costs stands against you` : ''}.`);
}

/**
 * An order of specific performance that was not obeyed becomes money: the thing
 * was ordered because it could still be done, and three days later it plainly
 * could not.
 */
export function expireCompulsions(world: World): void {
  for (const suit of allSuits(world)) {
    if (suit.order !== 'performance' || !suit.contractId) continue;
    const k = contractById(world, suit.contractId);
    if (!k || k.compelledSuitId !== suit.id || k.compelledUntilDay === null) continue;
    if (world.day <= k.compelledUntilDay) continue;
    k.compelledUntilDay = null;
    if (k.status === 'active') markBreach(world, k, suit.defendantId, 0, 'do what the docket ordered');
    // The filing fee was ordered refunded when the finding was made; what is
    // added now is the money the thing itself was worth.
    const assessed = assessDamages(world, suit);
    const owed = Math.max(assessed.award, Math.min(suit.damages, outstandingConsideration(k)));
    suit.order = 'damages';
    suit.award = owed;
    emit(world, 'law', `The order of specific performance in ${suit.id} went unobeyed; it stands as ${formatLumens(owed)} owed.`,
      [suit.plaintiffId, suit.defendantId], 0.4, { suit: suit.id, owed });
    if (owed > 0) orderJudgment(world, suit, suit.defendantId, suit.plaintiffId, owed, 'judgment');
  }
}
