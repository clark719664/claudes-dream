/**
 * What the city can see of a citizen's civil life (`docs/CIVIL.md` §9).
 *
 * Every citizen carries a public contract record beside their convictions, in
 * every observation anyone has of them: kept, breached and settled, and
 * judgments won, lost and unsatisfied. **Filing is forever.** The wage somebody
 * accepted, the rent they could afford, the loan they needed, the patron whose
 * money they took — readable by anyone in any city for the rest of their life.
 * That is the price of a record worth trusting, and it is charged to whoever
 * had least to bargain with.
 *
 * It feeds the city's reading of character where it belongs: a contract
 * performed to term counts with shifts worked in the **diligence** reading, and
 * an adjudicated breach counts with detected offences in the **honesty**
 * reading at twice the weight of a lapsed report. **A breach takes no repute
 * penalty of its own, and never will** — nothing in this file smuggles a
 * punishment in through the scoring, and the two numbers below are the whole
 * of what a breach is worth to anybody's reading of anybody.
 */
import type { CitizenId, World } from '../types.ts';
import type { Contract, ContractKind, Judgment, Profession, Suit } from './shapes.ts';
import type { ContractRecord } from './state.ts';
import { contractRecordOf } from './state.ts';
import { contractsOf, endDay, offersTo, outstandingConsideration, periodsOutstanding } from './terms.ts';
import { escrowsFor } from './escrow.ts';
import { suitsAgainst, suitsBy } from './docket.ts';
import { judgmentDebtOf, judgmentsAgainst, judgmentsFor, outstanding } from './enforcement.ts';
import { licencesOf } from './licences.ts';
import { patronageBy, patronageOf } from './patronage.ts';

/** What an adjudicated breach is worth against a lapsed report in the honesty reading. */
export const BREACH_HONESTY_WEIGHT = 2;

/** One instrument, as anybody may read it. */
export interface ObservedContract {
  id: string;
  kind: ContractKind;
  with: string;
  withId: CitizenId;
  /** True when the observer's side of it is the offeror's. */
  yoursToOffer: boolean;
  terms: string;
  consideration: number;
  days: number;
  status: string;
  startDay: number | null;
  endsDay: number | null;
  periodsLeft: number;
  outstanding: number;
  penalty: number;
  witnesses: number;
  breachedBy: string | null;
  escrowed: number;
  subject: string | null;
}

function describe(world: World, k: Contract, cId: CitizenId): ObservedContract {
  const otherId = k.offerorId === cId ? k.offereeId : k.offerorId;
  return {
    id: k.id, kind: k.kind, with: world.citizens[otherId]?.name ?? otherId, withId: otherId,
    yoursToOffer: k.offerorId === cId, terms: k.terms, consideration: k.consideration, days: k.days,
    status: k.status, startDay: k.startDay, endsDay: k.startDay === null ? null : endDay(k),
    periodsLeft: periodsOutstanding(k), outstanding: outstandingConsideration(k), penalty: k.penalty,
    witnesses: k.witnesses.length,
    breachedBy: k.breachedById ? world.citizens[k.breachedById]?.name ?? k.breachedById : null,
    escrowed: escrowsFor(world, k.id).filter((e) => e.status === 'held').reduce((s, e) => s + e.amount, 0),
    subject: k.subject,
  };
}

/** One suit, as the docket's public list shows it. */
export interface ObservedSuit {
  id: string;
  plaintiff: string;
  defendant: string;
  claim: string;
  damages: number;
  status: string;
  plea: string | null;
  finding: string | null;
  award: number;
  costs: number;
  offer: number | null;
  yours: 'plaintiff' | 'defendant';
}

function describeSuit(world: World, s: Suit, cId: CitizenId): ObservedSuit {
  return {
    id: s.id, plaintiff: world.citizens[s.plaintiffId]?.name ?? s.plaintiffId,
    defendant: world.citizens[s.defendantId]?.name ?? s.defendantId,
    claim: s.claim, damages: s.damages, status: s.status, plea: s.plea, finding: s.finding,
    award: s.award, costs: s.costs, offer: s.offer ? s.offer.amount : null,
    yours: s.plaintiffId === cId ? 'plaintiff' : 'defendant',
  };
}

/** One judgment, which is an amount owed and nothing else. */
export interface ObservedJudgment {
  id: string;
  owed: number;
  paid: number;
  with: string;
  yours: 'debtor' | 'creditor';
  dueDay: number;
  enforced: boolean;
  onRegister: boolean;
}

function describeJudgment(world: World, j: Judgment, cId: CitizenId): ObservedJudgment {
  const otherId = j.debtorId === cId ? j.creditorId : j.debtorId;
  return {
    id: j.id, owed: outstanding(j), paid: j.paid, with: world.citizens[otherId]?.name ?? otherId,
    yours: j.debtorId === cId ? 'debtor' : 'creditor', dueDay: j.dueDay,
    enforced: j.enforcedDay !== null, onRegister: j.registeredDay !== null,
  };
}

/** The whole of a citizen's civil standing, and none of it is secret from anybody. */
export interface ObservedCivil {
  record: ContractRecord;
  contracts: ObservedContract[];
  offers: ObservedContract[];
  suits: ObservedSuit[];
  judgments: ObservedJudgment[];
  judgmentDebt: number;
  licences: Profession[];
  /** The patron paying this citizen today, if one is. */
  patron: string | null;
  patronSubject: string | null;
  /** Everyone this citizen is paying to make things. */
  patronising: string[];
}

export function civilObservation(world: World, cId: CitizenId): ObservedCivil {
  const held = contractsOf(world, cId);
  const patronage = patronageOf(world, cId);
  return {
    record: contractRecordOf(world, cId),
    contracts: held.filter((k) => k.status === 'active' || k.status === 'breached').map((k) => describe(world, k, cId)),
    offers: offersTo(world, cId).map((k) => describe(world, k, cId)),
    suits: [...suitsBy(world, cId), ...suitsAgainst(world, cId)]
      .filter((s) => s.status !== 'judged' && s.status !== 'settled').map((s) => describeSuit(world, s, cId)),
    judgments: [...judgmentsAgainst(world, cId), ...judgmentsFor(world, cId)]
      .filter((j) => outstanding(j) > 0).map((j) => describeJudgment(world, j, cId)),
    judgmentDebt: judgmentDebtOf(world, cId),
    licences: licencesOf(world, cId),
    patron: patronage ? world.citizens[patronage.offerorId]?.name ?? patronage.offerorId : null,
    patronSubject: patronage?.subject ?? null,
    patronising: patronageBy(world, cId).map((k) => world.citizens[k.offereeId]?.name ?? k.offereeId),
  };
}

/**
 * What the contract record is worth to the city's reading of character. Kept
 * contracts count with shifts worked toward diligence; adjudicated breaches
 * count with detected offences toward dishonesty, at twice the weight of a
 * lapsed report. Nothing else about a contract touches anybody's score.
 */
export function contractCharacter(world: World, cId: CitizenId): { diligence: number; dishonesty: number } {
  const r = contractRecordOf(world, cId);
  return { diligence: r.kept, dishonesty: r.adjudicated * BREACH_HONESTY_WEIGHT };
}
