/**
 * The wiring of civil law and finance into the city (`docs/CIVIL.md`,
 * `docs/FINANCE.md`, `REGISTRY.md` §3).
 *
 * Two layers were built and tested in isolation before this. What is asserted
 * here is the thing isolation cannot show: that every action either of them
 * added is **reachable** — in the catalogue, through `validateAction`, out the
 * far side of `executeAction` into the module that owns it — and that the
 * hours those layers keep are actually kept: the morning rollover, the
 * auction's close at tick 14 and the civil docket at tick 16.
 *
 * The lesson this file exists for is written in the repository's history:
 * mobility and property shipped as working functions that nothing called for
 * a whole phase.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import type { Action, ActionType, World } from '../src/types.ts';
import { ACTION_TYPES, CIVIL_ACTIONS, FINANCE_ACTIONS } from '../src/types.ts';
import { ACTION_CATALOGUE } from '../src/data/actions.ts';
import { availableActions, executeAction, validateAction } from '../src/actions/execute.ts';
import { dailyRollover, openSittings, closeSittings } from '../src/world/daily.ts';
import { civilState } from '../src/civil/state.ts';
import { acceptContract, offerContract } from '../src/civil/contracts.ts';
import { contractById } from '../src/civil/terms.ts';
import { financeState } from '../src/finance/state.ts';
import { depositOf } from '../src/finance/bank.ts';
import { openIssue } from '../src/finance/bonds.ts';
import { transfer } from '../src/economy/treasury.ts';
import { createCityJobs } from '../src/economy/jobs.ts';

const HOOKS = { guard: <T>(_w: World, _where: string, fn: () => T) => fn(), autosave: () => {} };

/** A world where two citizens can be bound by an instrument and pay for it. */
function city(): { world: World; a: string; b: string } {
  const world = makeWorld();
  const a = makeCitizen(world, { name: 'Ilse' });
  const b = makeCitizen(world, { name: 'Bram' });
  a.wallet = 500;
  b.wallet = 500;
  a.district = 'commons';
  b.district = 'commons';
  return { world, a: a.id, b: b.id };
}

// ---------------------------------------------------------------------------
// Reachable
// ---------------------------------------------------------------------------

test('every civil and finance action is in the catalogue the whole city reads from', () => {
  for (const type of [...CIVIL_ACTIONS, ...FINANCE_ACTIONS]) {
    assert.ok(ACTION_TYPES.includes(type), `${type} is missing from ACTION_TYPES`);
    const spec = ACTION_CATALOGUE[type];
    assert.ok(spec, `${type} has no line in the action catalogue`);
    assert.ok(spec.text.length > 20, `${type}'s catalogue line says nothing`);
  }
  // 26 in `CIVIL.md` §10 and 22 in `FINANCE.md` §9.
  assert.equal(CIVIL_ACTIONS.length, 26);
  assert.equal(FINANCE_ACTIONS.length, 22);
});

/** One well-formed call of every action, as a mind outside the engine would send it. */
const SAMPLES: Record<string, Record<string, unknown>> = {
  offer_contract: { to: 'c_2', kind: 'employment', terms: 'a shift a day', consideration: 10, days: 7 },
  accept_contract: { offerId: 'ct_1' },
  close_offer: { offerId: 'ct_1' },
  witness_contract: { offerId: 'ct_1' },
  perform_contract: { contractId: 'ct_1' },
  propose_variation: { contractId: 'ct_1', terms: 'less, for longer', consideration: 8 },
  accept_variation: { variationId: 'cv_1' },
  terminate_contract: { contractId: 'ct_1' },
  open_escrow: { contractId: 'ct_1', holder: 'exchange', amount: 50 },
  release_escrow: { escrowId: 'ce_1' },
  file_suit: { defendant: 'c_2', claim: 'they did not deliver', damages: 100 },
  answer_suit: { suitId: 'cs_1', plea: 'deny', text: 'I delivered' },
  settle: { suitId: 'cs_1', amount: 40 },
  accept_settlement: { suitId: 'cs_1' },
  judge_civil: { suitId: 'cs_1', finding: 'plaintiff', damages: 40, order: 'damages', reason: 'the record reads for them' },
  enforce_judgment: { judgmentId: 'cj_1' },
  offer_arbitration: { with: 'c_2', about: 'the breach of ct_1', arbiter: 'c_3', fee: 20 },
  accept_arbitration: { offerId: 'ca_1' },
  arbitrate: { disputeId: 'ca_1', award: 25, reason: 'the register shows it owed' },
  refer_dispute: { cities: ['reverie', 'vantage'], about: 'a raided caravan' },
  found_guild: { profession: 'builder' },
  sit_examination: { guildId: 'cg_1' },
  certify: { candidate: 'c_2' },
  revoke_licence: { citizen: 'c_2', reason: 'three breaches on the record' },
  offer_patronage: { to: 'c_2', perDay: 5, days: 14 },
  accept_patronage: { offerId: 'ct_1' },
  bid_bond: { issueId: 'bond_1', price: 98, qty: 3 },
  sell_bond: { holdingId: 'hold_1', price: 97 },
  buy_bond: { offerId: 'offer_1' },
  offer_restructure: { issueId: 'bond_1', coupon: 1, term: 56, haircut: 0.2 },
  vote_restructure: { issueId: 'bond_1', accept: true },
  repudiate: { issueId: 'bond_1' },
  deposit: { amount: 100 },
  withdraw: { amount: 50 },
  set_deposit_rate: { rate: 0.005 },
  set_lending_rate: { rate: 0.02 },
  call_loan: { loanId: 'l_1' },
  found_underwriter: { name: 'Harbour Assurance', capital: 500 },
  offer_policy: { kind: 'home', cover: 200, premium: 2, term: 28 },
  buy_policy: { policyId: 'line_1' },
  file_claim: { policyId: 'pol_1', event: 'a storm took the roof', amount: 50 },
  settle_claim: { claimId: 'ins_1', amount: 50 },
  deny_claim: { claimId: 'ins_1', reason: 'no register shows it' },
  found_mutual: { name: 'The Harbour Fund', dues: 2 },
  join_mutual: { mutualId: 'mut_1' },
  pay_dues: { mutualId: 'mut_1' },
  claim_aid: { amount: 30, reason: 'I have no roof' },
  vote_aid: { claimId: 'aid_1', aye: true },
};

test('validateAction takes every one of them from outside the engine', () => {
  for (const type of [...CIVIL_ACTIONS, ...FINANCE_ACTIONS]) {
    const sample = SAMPLES[type];
    assert.ok(sample, `${type} has no sample call in this test`);
    const parsed = validateAction({ type, ...sample });
    assert.ok(parsed.ok, `${type} was refused by validateAction: ${parsed.ok ? '' : parsed.error}`);
  }
});

test('executeAction hands every one of them to the layer that owns it', () => {
  const { world, a } = city();
  for (const type of [...CIVIL_ACTIONS, ...FINANCE_ACTIONS]) {
    const parsed = validateAction({ type, ...SAMPLES[type] });
    assert.ok(parsed.ok);
    const result = executeAction(world, a, parsed.action);
    // Most of these are refused on the facts — there is no such contract, no
    // such guild, no auction open — and that is the point: the refusal has to
    // come from the module, never from a dispatcher that has never heard of
    // the action.
    assert.doesNotMatch(result.message, /has no .* to offer|Unknown action/,
      `${type} fell through the dispatcher: ${result.message}`);
  }
});

// ---------------------------------------------------------------------------
// Exercised
// ---------------------------------------------------------------------------

test('an instrument is offered, seen on the offeree\'s list, formed and performed', () => {
  const { world, a, b } = city();
  const before = totalMoney(world);
  const offered = offerContract(world, a, {
    to: b, kind: 'lease', terms: 'a room over the Bazaar', consideration: 8, days: 7, penalty: 16, notice: 3,
  });
  assert.ok(offered.ok && offered.id, offered.message);

  // The offeree can see what to do about it without being told: the action is
  // on their own list, and the id is in their own observation's civil block.
  const theirs = availableActions(world, world.citizens[b]);
  assert.ok(theirs.includes('accept_contract'), 'the offeree is not offered accept_contract');
  assert.ok(theirs.includes('close_offer'), 'the offeree cannot decline it either');

  const formed = executeAction(world, b, { type: 'accept_contract', offerId: offered.id });
  assert.ok(formed.ok, formed.message);
  const k = contractById(world, offered.id);
  assert.equal(k?.status, 'active');

  world.day += 1;
  const performed = executeAction(world, b, { type: 'perform_contract', contractId: offered.id });
  assert.ok(performed.ok, performed.message);
  assert.equal(contractById(world, offered.id)?.performances.length, 1);
  assert.equal(totalMoney(world), before, 'filing and paying rent moved no lumen into or out of the city');
});

test('the counter takes a deposit and gives it back, and the supply never moves', () => {
  const { world, a } = city();
  world.hour = 10;
  // A banker behind the counter is what opens the bank.
  createCityJobs(world);
  const banker = makeCitizen(world, { name: 'Wren' });
  const job = Object.values(world.jobs).find((j) => j.role === 'banker');
  assert.ok(job, 'the city has no banker post to fill');
  job.holderId = banker.id;
  banker.jobId = job.id;

  const before = totalMoney(world);
  const put = executeAction(world, a, { type: 'deposit', amount: 200 });
  assert.ok(put.ok, put.message);
  assert.equal(depositOf(world, a), 200);
  const took = executeAction(world, a, { type: 'withdraw', amount: 120 });
  assert.ok(took.ok, took.message);
  assert.equal(depositOf(world, a), 80);
  assert.equal(totalMoney(world), before, 'a deposit is a claim, and claims hold no lumens of their own');
});

test('a mutual is founded, joined and paid into through the ordinary action table', () => {
  const { world, a, b } = city();
  const before = totalMoney(world);
  const founded = executeAction(world, a, { type: 'found_mutual', name: 'The Harbour Fund', dues: 2 });
  assert.ok(founded.ok, founded.message);
  const mutual = Object.values(financeState(world).mutuals)[0];
  assert.ok(mutual, 'nothing reached the register');
  const joined = executeAction(world, b, { type: 'join_mutual', mutualId: mutual.id });
  assert.ok(joined.ok, joined.message);
  world.day += 1;
  const paid = executeAction(world, b, { type: 'pay_dues', mutualId: mutual.id });
  assert.ok(paid.ok, paid.message);
  assert.equal(totalMoney(world), before, 'a pot holds real lumens and the supply is unchanged');
});

// ---------------------------------------------------------------------------
// The hours both layers keep
// ---------------------------------------------------------------------------

test('the morning rollover pays a patron\'s stipend and reads the instruments', () => {
  const { world, a, b } = city();
  const offered = offerContract(world, a, {
    to: b, kind: 'patronage', terms: 'a daily stipend', consideration: 5, days: 7, penalty: 0, notice: 0,
  });
  assert.ok(offered.ok && offered.id, offered.message);
  assert.ok(acceptContract(world, b, offered.id).ok);

  const before = totalMoney(world);
  const held = world.citizens[b].wallet;
  world.tick += 24;
  world.day += 1;
  dailyRollover(world, HOOKS);
  const k = contractById(world, offered.id);
  assert.equal(k?.performances.length, 1, 'the stipend was never paid at the rollover');
  assert.equal(world.citizens[b].wallet, held + 5 + world.government.dividend,
    'the stipend did not reach the citizen it was for');
  assert.equal(totalMoney(world), before, 'the morning made or lost a lumen');
});

test('the docket sits at tick 16 and the auction closes at tick 14, around the hour\'s turns', () => {
  const world = makeWorld();
  const s = civilState(world);
  // The second day of the week, which is a docket day at the founding.
  world.day = 1;
  world.hour = 16;
  world.tick = world.day * 24 + world.hour;
  const plaintiff = makeCitizen(world, { name: 'Ilse' });
  const defendant = makeCitizen(world, { name: 'Bram' });
  plaintiff.wallet = 500;
  defendant.wallet = 500;
  const judge = makeCitizen(world, { name: 'Wendel' });
  judge.reputation = 80;
  world.government.judges = [judge.id];
  judge.office = 'judge';

  const suit = executeAction(world, plaintiff.id, {
    type: 'file_suit', defendant: defendant.id, claim: 'they never paid what they said they would', damages: 60,
  });
  assert.ok(suit.ok, suit.message);

  openSittings(world, HOOKS);
  const before = Object.values(s.suits)[0];
  assert.equal(before.status, 'in_session', 'the docket did not open at tick 16');
  assert.ok(before.judges.length > 0, 'nobody was seated');

  // The judge decides in the hour, exactly as the criminal bench does.
  const decided = executeAction(world, before.judges[0], {
    type: 'judge_civil', suitId: before.id, finding: 'defendant', damages: 0, order: 'none',
    reason: 'the record does not reach a half',
  });
  assert.ok(decided.ok, decided.message);
  closeSittings(world, HOOKS);
  assert.equal(Object.values(s.suits)[0].status, 'judged');
});

test('an auction opened by the Council closes at tick 14 and nothing else', () => {
  const world = makeWorld();
  const f = financeState(world);
  const bidder = makeCitizen(world, { name: 'Ilse' });
  bidder.wallet = 1_000;
  // The Exchange opens the issue the Council voted for.
  // Four of five carried it, which is what the charter asks of an issue past
  // the debt-service cap — and a city with no revenue yet has a cap of nothing.
  const opened = openIssue(world, { size: 20, coupon: 1.5, termDays: 28, override: true });
  assert.ok(opened.ok && opened.issue, opened.message);
  world.day = opened.issue.closesDay;
  world.hour = 13;
  world.tick = world.day * 24 + world.hour;
  const bid = executeAction(world, bidder.id, { type: 'bid_bond', issueId: opened.issue.id, price: 100, qty: 2 });
  assert.ok(bid.ok, bid.message);

  openSittings(world, HOOKS);
  assert.equal(f.issues[opened.issue.id].status, 'auction', 'the auction closed before its hour');
  world.hour = 14;
  world.tick = world.day * 24 + world.hour;
  openSittings(world, HOOKS);
  assert.notEqual(f.issues[opened.issue.id].status, 'auction', 'the auction did not close at tick 14');
});

// ---------------------------------------------------------------------------
// What the wiring may not do
// ---------------------------------------------------------------------------

test('nothing either layer added reaches a citizen through the ladder or a cell', () => {
  const { world, a, b } = city();
  const before = {
    standing: world.citizens[b].standing,
    convictions: world.citizens[b].record.convictions.length,
    jailed: world.citizens[b].jailedUntilDay,
    suspended: world.citizens[b].suspendedUntilDay,
    reputation: world.citizens[b].reputation,
  };
  const offered = offerContract(world, a, {
    to: b, kind: 'lease', terms: 'a room over the Bazaar', consideration: 8, days: 3, penalty: 16, notice: 0,
  });
  assert.ok(offered.ok && offered.id);
  assert.ok(acceptContract(world, b, offered.id).ok);
  // The tenant lets it go into breach, which is what the docket is for and
  // what the ladder is not (Charter Article VI, `docs/CIVIL.md` §3).
  for (let d = 0; d < 4; d++) {
    world.tick += 24;
    world.day += 1;
    dailyRollover(world, HOOKS);
  }
  const after = world.citizens[b];
  assert.equal(contractById(world, offered.id)?.status, 'breached');
  assert.equal(after.standing, before.standing, 'a breach moved a citizen’s standing');
  assert.equal(after.record.convictions.length, before.convictions, 'a breach became a conviction');
  assert.equal(after.jailedUntilDay, before.jailed, 'a breach reached a cell');
  assert.equal(after.suspendedUntilDay, before.suspended, 'a breach became a suspension');
  assert.equal(after.reputation, before.reputation, 'a breach docked repute');
});

test('children are offered nothing of either layer, and refused it if they ask', () => {
  const { world, a } = city();
  const child = makeCitizen(world, { name: 'Wren' });
  child.lifeStage = 'child';
  child.wallet = 500;
  child.district = 'commons';
  const offered = new Set(availableActions(world, child));
  for (const type of [...CIVIL_ACTIONS, ...FINANCE_ACTIONS]) {
    assert.ok(!offered.has(type), `a child is offered ${type}`);
  }
  const asked = executeAction(world, child.id, { type: 'deposit', amount: 10 } as Action);
  assert.equal(asked.ok, false);
  // And the money did not move anyway.
  assert.equal(world.citizens[child.id].wallet, 500);
  assert.ok(a);
});

test('a suspended citizen may not contract, bank or bid', () => {
  const { world, a } = city();
  world.citizens[a].standing = 'suspended';
  world.citizens[a].suspendedUntilDay = world.day + 5;
  const offered = new Set(availableActions(world, world.citizens[a]));
  for (const type of [...CIVIL_ACTIONS, ...FINANCE_ACTIONS]) {
    assert.ok(!offered.has(type), `a suspended citizen is offered ${type}`);
  }
  const asked = executeAction(world, a, { type: 'found_mutual', name: 'The Harbour Fund', dues: 2 });
  assert.equal(asked.ok, false);
});

test('the money supply is whole after a morning of both layers', () => {
  const { world, a, b } = city();
  transfer(world, 'treasury', a, 100, 'grant', 'a test grant');
  const before = totalMoney(world);
  const ids: ActionType[] = ['found_mutual', 'deposit'];
  assert.ok(ids.length === 2);
  executeAction(world, a, { type: 'found_mutual', name: 'The Harbour Fund', dues: 2 });
  const mutual = Object.values(financeState(world).mutuals)[0];
  if (mutual) executeAction(world, b, { type: 'join_mutual', mutualId: mutual.id });
  world.tick += 24;
  world.day += 1;
  dailyRollover(world, HOOKS);
  assert.equal(totalMoney(world), before);
});
