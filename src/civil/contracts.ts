/**
 * Contracts — offer, the witnesses' marks, acceptance and performance
 * (`docs/CIVIL.md` §§1–3).
 *
 * A contract is made by **two actions and never one**: `offer_contract` puts an
 * instrument on the table, where it sits in the target's observation for two
 * days and then lapses, and `accept_contract` forms it, pays the filing fee and
 * files it at the Exchange. Nobody is bound by another citizen's action alone,
 * and nothing in this file is a punishment.
 *
 * The arithmetic and the reading of the register are in `terms.ts`; variation,
 * notice and breach are in `amend.ts`.
 */
import type { BusinessId, CitizenId, ClubId, Good, MoneyParty, World } from '../types.ts';
import { GOODS } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, transfer, withholdingPay } from '../economy/treasury.ts';
import type { Contract, ContractKind } from './shapes.ts';
import { civilKind } from './shapes.ts';
import { civilState, contractRecordOf, nextCivilId } from './state.ts';
import type { CivilResult } from './common.ts';
import { canPay, fail, lumens, mayContract, nameOf, ok, partyName, tillFor } from './common.ts';
import { UNLICENSED_LOAN_LIMIT, isLicensed } from './licences.ts';
import {
  APPRENTICE_WAGE_SHARE, DEFAULT_NOTICE_DAYS, MAX_APPRENTICESHIP_DAYS, MAX_CONTRACT_DAYS, MAX_WITNESSES,
  MIN_PATRONAGE_DAYS, OFFER_LAPSE_DAYS, PENALTY_MULTIPLE, WITNESS_FEE,
  contractById, currentPeriod, faceValue, filingFee, isParty, isPerformed, obligorOf, partiesOf,
  moneyLeg, periodDueDay, periodsOf, suspendedForCustody,
} from './terms.ts';

// ---------------------------------------------------------------------------
// Offering
// ---------------------------------------------------------------------------

/** Everything `offer_contract` carries, and the few extras a kind needs to be filed at all. */
export interface ContractSpec {
  to: CitizenId;
  kind: ContractKind;
  terms: string;
  consideration: number;
  days: number;
  penalty?: number;
  notice?: number;
  /** Names the offeror asks to witness; a mark is still the witness's own act. */
  witnesses?: CitizenId[];
  /** The offeror's own business, where the till behind them is one. */
  business?: BusinessId;
  /** Forward supply: what is delivered. */
  good?: Good;
  qty?: number;
  /** A private loan's principal, advanced at formation. */
  principal?: number;
  /** Partnership: the filed split, which must sum to 1 across 2–5 owners. */
  shares?: Record<CitizenId, number>;
  /** Patronage and commission: a request, and never an instruction. */
  subject?: string;
  clubId?: ClubId;
}

function defaultNotice(kind: ContractKind): number {
  return kind === 'employment' || kind === 'lease' ? DEFAULT_NOTICE_DAYS : 0;
}

/** The bar a wage under this instrument may not go under. */
export function wageFloor(world: World, kind: ContractKind): number {
  const min = world.government.minWage;
  return kind === 'apprenticeship' ? Math.round(min * APPRENTICE_WAGE_SHARE) : min;
}

function checkKind(world: World, offeror: CitizenId, spec: ContractSpec, principal: number): string | null {
  const { kind, consideration, days } = spec;
  if (kind === 'employment' || kind === 'apprenticeship') {
    const floor = wageFloor(world, kind);
    if (consideration < floor) {
      return kind === 'apprenticeship'
        ? `A training wage may not go under ${floor} ℓ, which is 60 % of the minimum wage.`
        : `A wage may not go under the minimum wage of ${floor} ℓ.`;
    }
  }
  if (kind === 'apprenticeship' && days > MAX_APPRENTICESHIP_DAYS) {
    return `An apprenticeship runs at most ${MAX_APPRENTICESHIP_DAYS} days.`;
  }
  if (kind === 'patronage' && (days < MIN_PATRONAGE_DAYS || days > MAX_CONTRACT_DAYS)) {
    return `Patronage runs ${MIN_PATRONAGE_DAYS}–${MAX_CONTRACT_DAYS} days.`;
  }
  if (kind === 'forward') {
    if (!spec.good || !GOODS.includes(spec.good)) return 'A forward supply must name a good the Bazaar trades.';
    if (lumens(spec.qty) <= 0) return 'A forward supply must name a quantity.';
  }
  if (kind === 'loan') {
    if (principal >= UNLICENSED_LOAN_LIMIT && !isLicensed(world, offeror, 'banker')) {
      return `A loan of ${principal} ℓ or more is a banker's act; no licence needed under ${UNLICENSED_LOAN_LIMIT} ℓ.`;
    }
  }
  if (kind === 'partnership') {
    const shares = spec.shares ?? {};
    const owners = Object.keys(shares);
    if (owners.length < 2 || owners.length > 5) return 'A partnership is 2–5 owners.';
    const total = owners.reduce((s, id) => s + (shares[id] ?? 0), 0);
    if (Math.abs(total - 1) > 0.001) return 'A partnership’s profit split must sum to 1.';
    if (!spec.business) return 'A partnership must name the concern it splits.';
  }
  return null;
}

/**
 * Table an instrument. It sits in the target's observation for two days and
 * then lapses. Nothing is owed by anybody until it is accepted.
 */
export function offerContract(world: World, offerorId: CitizenId, spec: ContractSpec): CivilResult {
  const offeror = world.citizens[offerorId];
  const offeree = world.citizens[spec.to];
  if (!mayContract(world, offeror)) return fail('You are not in a position to be bound by a contract.');
  if (!offeree || spec.to === offerorId) return fail('There is nobody on the other side of that.');
  if (!mayContract(world, offeree)) return fail(`${nameOf(world, spec.to)} cannot be bound by a contract today.`);
  if (!spec.terms || spec.terms.trim().length < 3) return fail('An instrument has to say what each side must do.');

  const consideration = lumens(spec.consideration);
  if (consideration <= 0) {
    return fail('A promise with nothing coming back is a gift, and the docket will not hear it.');
  }
  const days = Math.round(spec.days);
  if (!Number.isFinite(days) || days < 1 || days > MAX_CONTRACT_DAYS) {
    return fail(`A contract runs 1–${MAX_CONTRACT_DAYS} days; longer than that and it outlives the law it was written under.`);
  }
  const till = tillFor(world, offerorId, spec.business ?? null);
  if (!till) return fail('That is not your business to contract through.');
  const principal = lumens(spec.principal) || (spec.kind === 'loan' ? consideration * periodsOf('loan', days) : 0);
  const problem = checkKind(world, offerorId, spec, principal);
  if (problem) return fail(problem);

  const face = faceValue(consideration, spec.kind, days);
  const penalty = Math.min(lumens(spec.penalty), PENALTY_MULTIPLE * face);
  const asked = (spec.witnesses ?? []).filter((id) => id !== offerorId && id !== spec.to && !!world.citizens[id]).slice(0, MAX_WITNESSES);
  const id = nextCivilId(world, 'ct');
  const k: Contract = {
    id, kind: spec.kind, offerorId, offereeId: spec.to,
    offerorParty: till, offereeParty: spec.to,
    terms: spec.terms.trim(), consideration, days, periods: periodsOf(spec.kind, days),
    penalty, notice: spec.notice === undefined ? defaultNotice(spec.kind) : Math.max(0, Math.round(spec.notice)),
    witnesses: [], asked,
    offeredDay: world.day, lapsesDay: world.day + OFFER_LAPSE_DAYS, status: 'offered',
    startDay: null, filedDay: null, fee: filingFee(world, face), suspendedDays: 0,
    performances: [], variations: [],
    noticeById: null, noticeDay: null, endsDay: null,
    breachedDay: null, breachedById: null, breachedPeriod: null,
    good: spec.good ?? null, qty: lumens(spec.qty),
    shares: spec.shares ?? null, businessId: spec.business ?? null,
    subject: spec.subject?.trim() || null, clubId: spec.clubId ?? null,
    compelledUntilDay: null, compelledSuitId: null,
  };
  civilState(world).contracts[id] = k;
  emit(world, 'trade', `${offeror.name} tabled a ${spec.kind} instrument for ${nameOf(world, spec.to)}: `
    + `${formatLumens(consideration)} a period for ${days} days (${id}).`, [offerorId, spec.to], 0.3,
    { contract: id, kind: spec.kind, consideration, days, face });
  remember(world, spec.to, 'money', `${offeror.name} offered you a ${spec.kind} contract (${id}): ${k.terms}. `
    + `${consideration} ℓ a period for ${days} days; filing it costs ${k.fee} ℓ. It lapses in ${OFFER_LAPSE_DAYS} days.`);
  return ok(`You tabled a ${spec.kind} instrument for ${offeree.name} (${id}). It lapses in ${OFFER_LAPSE_DAYS} days.`, id);
}

/**
 * Put your mark on an offer you are standing beside. A witness confirms the
 * terms and nothing else; they are not a party and owe nobody anything.
 */
export function witnessContract(world: World, witnessId: CitizenId, offerId: string): CivilResult {
  const k = contractById(world, offerId);
  const w = world.citizens[witnessId];
  if (!k) return fail('There is no such instrument.');
  if (!w) return fail('Unknown citizen.');
  if (k.status !== 'offered') return fail('An instrument is witnessed before it is formed, not after.');
  if (isParty(k, witnessId)) return fail('A party to an instrument cannot witness it.');
  if (k.witnesses.includes(witnessId)) return fail('Your mark is already on it.');
  if (k.witnesses.length >= MAX_WITNESSES) return fail(`An instrument carries at most ${MAX_WITNESSES} marks.`);
  const offeror = world.citizens[k.offerorId];
  if (!offeror) return fail('The offeror is no longer here.');
  if (w.district !== offeror.district) return fail('A witness stands beside the parties; you are in another district.');
  if (!canPay(world, k.offerorParty, WITNESS_FEE)) return fail(`${offeror.name} cannot pay the witness fee.`);
  if (!transfer(world, k.offerorParty, witnessId, WITNESS_FEE, civilKind('contract'), `witness mark on ${k.id}`)) {
    return fail('The witness fee could not be paid.');
  }
  k.witnesses.push(witnessId);
  emit(world, 'trade', `${w.name} witnessed ${offeror.name}'s instrument ${k.id}.`, [witnessId, k.offerorId], 0.2,
    { contract: k.id, witness: witnessId });
  remember(world, witnessId, 'money', `You put your mark on ${offeror.name}'s ${k.kind} instrument ${k.id} and were paid ${WITNESS_FEE} ℓ.`);
  return ok(`You witnessed ${k.id} and were paid ${WITNESS_FEE} ℓ.`, k.id);
}

/** Decline an offer made to you, or withdraw your own. */
export function closeOffer(world: World, actorId: CitizenId, offerId: string): CivilResult {
  const k = contractById(world, offerId);
  if (!k) return fail('There is no such instrument.');
  if (k.status !== 'offered') return fail('That instrument is no longer on the table.');
  if (!isParty(k, actorId)) return fail('That offer is not yours to close.');
  const withdrawn = actorId === k.offerorId;
  k.status = withdrawn ? 'withdrawn' : 'declined';
  const other = withdrawn ? k.offereeId : k.offerorId;
  emit(world, 'trade', `${nameOf(world, actorId)} ${withdrawn ? 'withdrew' : 'declined'} instrument ${k.id}.`,
    [actorId, other], 0.2, { contract: k.id });
  remember(world, other, 'money', `${nameOf(world, actorId)} ${withdrawn ? 'withdrew' : 'declined'} the ${k.kind} instrument ${k.id}.`);
  return ok(`You ${withdrawn ? 'withdrew' : 'declined'} ${k.id}.`, k.id);
}

// ---------------------------------------------------------------------------
// Formation
// ---------------------------------------------------------------------------

/** The lumens that move the moment an instrument is formed, by kind. */
function formationLeg(world: World, k: Contract, spec: { principal: number }): boolean {
  if (k.kind === 'loan') {
    return transfer(world, k.offerorParty, k.offereeParty, spec.principal, 'loan', `principal advanced under ${k.id}`);
  }
  if (k.kind === 'commission') {
    return transfer(world, k.offerorParty, k.offereeParty, Math.round(k.consideration / 2), civilKind('contract'),
      `half the commission on formation of ${k.id}`);
  }
  if (k.kind === 'partnership' && k.businessId) {
    return transfer(world, k.offereeParty, k.businessId, k.consideration, 'capital', `capital into ${k.id}`);
  }
  return true;
}

/** What the formation of this instrument needs paid, on top of the filing fee. */
function formationCost(k: Contract, principal: number): { payer: MoneyParty; amount: number } | null {
  if (k.kind === 'loan') return { payer: k.offerorParty, amount: principal };
  if (k.kind === 'commission') return { payer: k.offerorParty, amount: Math.round(k.consideration / 2) };
  if (k.kind === 'partnership') return { payer: k.offereeParty, amount: k.consideration };
  return null;
}

/**
 * Form it, pay the filing fee, file it at the Exchange. The **acceptor** pays
 * the fee: that is the price of a record worth trusting, and `CIVIL.md` §11 is
 * plain that it is charged to whoever had least to bargain with.
 */
export function acceptContract(world: World, actorId: CitizenId, offerId: string): CivilResult {
  const k = contractById(world, offerId);
  if (!k) return fail('There is no such instrument.');
  if (k.status !== 'offered') return fail('That instrument is no longer on the table.');
  if (k.offereeId !== actorId) return fail('That offer was not made to you.');
  if (world.day > k.lapsesDay) return fail('That offer has lapsed.');
  const acceptor = world.citizens[actorId];
  const offeror = world.citizens[k.offerorId];
  if (!mayContract(world, acceptor) || !mayContract(world, offeror)) {
    return fail('One of you is not in a position to be bound today.');
  }
  const principal = k.kind === 'loan' ? k.consideration * k.periods : 0;
  const cost = formationCost(k, principal);
  if (cost && !canPay(world, cost.payer, cost.amount)) {
    return fail(`${partyName(world, cost.payer)} cannot find the ${formatLumens(cost.amount)} formation calls for.`);
  }
  if (!canPay(world, actorId, k.fee)) return fail(`Filing this instrument costs ${k.fee} ℓ, which you do not have.`);
  if (!transfer(world, actorId, 'treasury', k.fee, 'fee', `filing fee for ${k.id}`)) {
    return fail('The filing fee could not be paid.');
  }
  if (cost && !formationLeg(world, k, { principal })) {
    // Nothing was filed, so nothing is charged for filing: the fee goes back and
    // the citizen keeps the hour's mistake and nothing else.
    transfer(world, 'treasury', actorId, k.fee, 'fee', `filing fee returned: ${k.id} could not be formed`);
    return fail('The formation payment could not be made.');
  }
  k.status = 'active';
  k.startDay = world.day;
  k.filedDay = world.day;
  k.endsDay = world.day + k.days;
  emit(world, 'trade', `${acceptor?.name ?? actorId} accepted ${nameOf(world, k.offerorId)}'s ${k.kind} instrument ${k.id}: `
    + `${formatLumens(k.consideration)} a period for ${k.days} days, filed for ${formatLumens(k.fee)}`
    + `${k.witnesses.length > 0 ? ` before ${k.witnesses.length} witness${k.witnesses.length > 1 ? 'es' : ''}` : ''}.`,
    [actorId, k.offerorId], 0.4, { contract: k.id, kind: k.kind, fee: k.fee, face: faceValue(k.consideration, k.kind, k.days) });
  remember(world, actorId, 'money', `You accepted ${nameOf(world, k.offerorId)}'s ${k.kind} contract ${k.id} and paid ${k.fee} ℓ to file it. `
    + `It runs ${k.days} days. Filing is forever: it is public from today.`);
  remember(world, k.offerorId, 'money', `${nameOf(world, actorId)} accepted your ${k.kind} contract ${k.id}. It runs ${k.days} days.`);
  return ok(`You formed ${k.id} and paid ${k.fee} ℓ to file it at the Exchange.`, k.id);
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

function note(k: Contract): string {
  switch (k.kind) {
    case 'employment': return 'a shift worked under the term';
    case 'lease': return `${k.consideration} ℓ of rent`;
    case 'loan': return `an instalment of ${k.consideration} ℓ`;
    case 'apprenticeship': return `a training wage of ${k.consideration} ℓ`;
    case 'patronage': return `a stipend of ${k.consideration} ℓ`;
    case 'forward': return `${k.qty} ${k.good} at ${k.consideration} ℓ struck on day ${(k.startDay ?? 0)}`;
    case 'commission': return `the commissioned work, and the second half of ${Math.round(k.consideration / 2)} ℓ`;
    default: return `a period of ${k.id}`;
  }
}

/** Move the goods on a forward supply, seller to buyer, at the struck price. */
function deliverGoods(world: World, k: Contract): string | null {
  const good = k.good;
  if (!good) return 'That instrument names no goods.';
  const seller = world.citizens[k.offerorId];
  const buyer = world.citizens[k.offereeId];
  if (!seller || !buyer) return 'One of you is no longer here.';
  const held = Math.floor(seller.inventory[good] ?? 0);
  if (held < k.qty) return `You hold ${held} ${good} and owe ${k.qty}.`;
  if (!canPay(world, k.offereeParty, k.consideration)) {
    return `${buyer.name} cannot find the ${k.consideration} ℓ struck for it.`;
  }
  seller.inventory[good] = held - k.qty;
  buyer.inventory[good] = (buyer.inventory[good] ?? 0) + k.qty;
  return null;
}

/**
 * Discharge this period's obligation — the shift, the instalment, the crates —
 * and the Exchange records it with its tick, which is what a judge reads later.
 */
export function performContract(world: World, actorId: CitizenId, contractId: string): CivilResult {
  const k = contractById(world, contractId);
  if (!k) return fail('There is no such contract.');
  if (k.status !== 'active') return fail(`Contract ${k.id} is ${k.status}; there is nothing to discharge.`);
  if (!isParty(k, actorId)) return fail('You are not a party to that contract.');
  const owed = obligorOf(k);
  if (owed === null) return fail(`A ${k.kind} has no period to discharge; the filed terms do that themselves.`);
  if (owed !== actorId) return fail(`This period is ${nameOf(world, owed)}'s to discharge, not yours.`);
  if (suspendedForCustody(world, k)) return fail('This contract is suspended while a party is in custody.');

  const period = currentPeriod(world, k);
  if (isPerformed(k, period)) return fail(`Period ${period + 1} of ${k.id} is already discharged.`);
  if (world.day < periodDueDay(k, period)) return fail(`Period ${period + 1} of ${k.id} is not due until day ${periodDueDay(k, period)}.`);

  if (k.kind === 'employment') {
    const worker = world.citizens[actorId];
    if (!worker || worker.shiftsToday <= 0) return fail('You discharge an employment term by working the shift it is for.');
  }
  if (k.kind === 'forward') {
    const problem = deliverGoods(world, k);
    if (problem) return fail(problem);
  }
  const leg = moneyLeg(k);
  if (leg) {
    const amount = k.kind === 'commission' ? Math.round(k.consideration / 2) : k.consideration;
    if (!canPay(world, leg.from, amount)) {
      return fail(`${partyName(world, leg.from)} cannot find the ${formatLumens(amount)} this period calls for.`);
    }
    const paid = leg.kind === 'wage' && world.citizens[leg.to]
      ? withholdingPay(world, leg.from, leg.to, amount, 'wage', `training wage under ${k.id}`).net > 0
      : transfer(world, leg.from, leg.to, amount, ledgerKindFor(k), `${k.kind} under ${k.id}`);
    if (!paid) return fail('The payment could not be made.');
  }
  k.performances.push({ period, day: world.day, tick: world.tick, byId: actorId, note: note(k) });
  remember(world, actorId, 'money', `You discharged period ${period + 1} of ${k.id}: ${note(k)}.`);
  const other = actorId === k.offerorId ? k.offereeId : k.offerorId;
  remember(world, other, 'money', `${nameOf(world, actorId)} discharged period ${period + 1} of ${k.id}: ${note(k)}.`);
  if (k.performances.length >= k.periods) completeContract(world, k);
  return ok(`You discharged period ${period + 1} of ${k.id}.`, k.id);
}

function ledgerKindFor(k: Contract) {
  if (k.kind === 'patronage') return civilKind('patronage');
  if (k.kind === 'lease') return 'lease' as const;
  if (k.kind === 'loan') return 'repayment' as const;
  return civilKind('contract');
}

/** Performed to term: the record says so, and it says so forever. */
export function completeContract(world: World, k: Contract): void {
  if (k.status !== 'active') return;
  k.status = 'kept';
  k.endsDay = world.day;
  for (const id of partiesOf(k)) contractRecordOf(world, id).kept += 1;
  emit(world, 'trade', `Contract ${k.id} between ${nameOf(world, k.offerorId)} and ${nameOf(world, k.offereeId)} ran to term and was kept.`,
    partiesOf(k), 0.3, { contract: k.id, kind: k.kind });
  for (const id of partiesOf(k)) remember(world, id, 'money', `Contract ${k.id} ran to term and was kept. It stays in the register.`);
}
