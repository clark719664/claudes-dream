/**
 * Civil law — contracts, the docket, licensing and patronage (`docs/CIVIL.md`).
 *
 * The whole of this layer is **Track-free**: it moves lumens and compels
 * performance, never liberty. Nothing exported from here fines, suspends,
 * exiles or detains anybody, and the one thing that collects money by force is
 * the civil recovery ladder the Treasury already runs
 * (`government/recovery.ts`), which this layer calls and never re-implements.
 * Article VI — debt is not a crime — is absolute here.
 *
 * This file is the layer's whole surface, for the pass that wires these into
 * the action catalogue, the observation and the daily rollover.
 */
export type {
  Arbitration, CityDispute, CivilFinding, CivilLedgerKind, CivilOrder, CivilVote, Contract, ContractKind,
  ContractStatus, Escrow, Guild, Judgment, Mark, Performance, Plea, Profession, Revocation, SettlementOffer,
  Suit, SuitStatus, Variation,
} from './shapes.ts';
export { CONTRACT_KINDS, PROFESSIONS, civilKind } from './shapes.ts';
export type { CivilSettings, CivilState, ContractRecord } from './state.ts';
export { civilSettings, civilState, contractRecordOf, emptyContractRecord, foundingSettings } from './state.ts';
export type { CivilResult } from './common.ts';
export { mayContract, partyName } from './common.ts';

export * from './terms.ts';
export * from './contracts.ts';
export * from './amend.ts';
export * from './escrow.ts';
export * from './merit.ts';
export * from './docket.ts';
export * from './enforcement.ts';
export * from './arbitration.ts';
export * from './licences.ts';
export * from './guilds.ts';
export * from './patronage.ts';
export * from './observe.ts';
export * from './daily.ts';
