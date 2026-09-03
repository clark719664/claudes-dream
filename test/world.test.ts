import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { totalMoney } from './helpers.ts';
import type { Action, Brain, World } from '../src/types.ts';
import { auditMoneySupply } from '../src/economy/treasury.ts';
import { activeCitizens } from '../src/citizens/citizen.ts';
import { heldJob } from '../src/actions/execute.ts';
import {
  computeStats, createBrainRegistry, createReflexRegistry, createWorld, loadWorld, runDays, runTicks, saveWorld, stepTick,
} from '../src/world/world.ts';
import { countFriendships, gini } from '../src/world/stats.ts';

const POP = 20;

function city(seed = 7): World {
  return createWorld({ seed, seedPopulation: POP, arrivalRate: 0 });
}

function expectedSupply(w: World): number {
  return w.treasury.foundingSupply + w.treasury.minted - w.treasury.burned;
}

test('createWorld founds a city: jobs, citizens spread over districts, open nominations, a founding notice', () => {
  const w = city();
  assert.equal(Object.keys(w.citizens).length, POP);
  assert.equal(w.order.length, POP);
  assert.ok(Object.keys(w.jobs).length > 0, 'city jobs exist');
  const districts = new Set(Object.values(w.citizens).map((c) => c.district));
  assert.ok(districts.size >= 6, 'founders are spread over the districts');
  assert.ok(!districts.has('threshold'), 'founders do not start at the gate');
  assert.ok(w.events.some((e) => e.kind === 'system' && e.weight === 0.9 && /founded/.test(e.text)), 'founding event');
  assert.ok(w.events.some((e) => e.kind === 'election' && /Nominations/.test(e.text)), 'nominations are open for the founding election');
  assert.equal(w.government.election.electionDay, 7);
  assert.equal(totalMoney(w), expectedSupply(w), 'arrival grants conserve money');
  assert.equal(w.tick, 0);
});

test('createWorld gives the first llmCitizens founders a Claude brain', () => {
  const w = createWorld({ seed: 3, seedPopulation: 6, llmCitizens: 2 });
  const brains = w.order.map((id) => w.citizens[id].brain);
  assert.deepEqual(brains, ['llm', 'llm', 'reflex', 'reflex', 'reflex', 'reflex']);
  assert.equal(w.citizens[w.order[0]].lineage, 'Claude');
});

test('two days of city life: no engine errors, money conserved, people employed, stats per day', async () => {
  const w = city();
  await runDays(w, 2, createReflexRegistry());
  assert.equal(w.tick, 48);
  assert.equal(w.day, 2);
  assert.equal(w.hour, 0);
  assert.equal(w.counters.engineErrors ?? 0, 0, 'no engine errors');
  const audit = auditMoneySupply(w);
  assert.ok(audit.ok, `money supply audit: ${audit.supply} vs ${audit.expected}`);
  assert.equal(totalMoney(w), expectedSupply(w));
  const employed = activeCitizens(w).filter((c) => heldJob(w, c) !== null).length;
  assert.ok(employed > 0, 'at least one citizen found a job');
  assert.equal(w.stats.length, 2, 'one DailyStats row per completed day');
  assert.deepEqual(w.stats.map((s) => s.day), [0, 1]);
  assert.equal(w.chronicle.length, 2, 'a morning edition per day');
  assert.equal(w.chronicle[1].day, 2);
  assert.ok(w.chronicle[1].treasuryReport.startsWith('Treasury:'));
  assert.ok(w.events.some((e) => e.kind === 'hired'), 'hiring happened');
  assert.ok(w.events.some((e) => e.kind === 'treasury'), 'the Treasury reported');
});

test('an empty city still turns over its days without errors', async () => {
  const w = createWorld({ seed: 1, seedPopulation: 0, arrivalRate: 0 });
  await runDays(w, 1, createReflexRegistry());
  assert.equal(w.counters.engineErrors ?? 0, 0);
  assert.equal(w.stats.length, 1);
  assert.equal(w.stats[0].population, 0);
  assert.equal(w.stats[0].giniWealth, 0);
  assert.equal(w.stats[0].avgMood, 0);
  assert.ok(auditMoneySupply(w).ok);
});

test('computeStats fills every DailyStats field sensibly', async () => {
  const w = city();
  await runDays(w, 1, createReflexRegistry());
  const s = w.stats[0];
  assert.equal(s.day, 0);
  assert.equal(s.population, activeCitizens(w).length);
  assert.equal(s.employed + s.unemployed, s.population);
  assert.ok(s.homeless >= 0 && s.homeless <= s.population);
  assert.ok(s.avgMood >= 0 && s.avgMood <= 100);
  assert.ok(s.avgWallet >= 0);
  assert.ok(s.giniWealth >= 0 && s.giniWealth <= 1);
  assert.equal(s.priceIndex, w.market.priceIndex);
  assert.equal(s.treasury, w.treasury.balance);
  assert.equal(s.moneySupply, totalMoney(w));
  for (const k of ['offences', 'charges', 'convictions', 'exiles', 'businesses', 'friendships'] as const) {
    assert.ok(Number.isInteger(s[k]) && s[k] >= 0, `${k} is a count`);
  }
  // per-day counts refer to the summarised day
  const w2 = city();
  await runTicks(w2, 5, createReflexRegistry());
  assert.equal(computeStats(w2).day, 0, 'mid-day stats summarise today');
  assert.equal(computeStats(w2, 3).charges, 0, 'no charges on a day that has not happened');
});

test('gini and friendships helpers', () => {
  assert.equal(gini([]), 0);
  assert.equal(gini([0, 0, 0]), 0);
  assert.equal(gini([10, 10, 10, 10]), 0);
  assert.ok(gini([0, 0, 0, 100]) > 0.7);
  const w = city();
  const [a, b, c] = w.order;
  w.citizens[a].bonds[b] = 45;
  w.citizens[b].bonds[a] = 45;
  w.citizens[b].bonds[c] = 40;
  w.citizens[c].bonds[a] = 10;
  assert.equal(countFriendships(w, activeCitizens(w)), 2, 'pairs a-b and b-c, counted once each');
});

test('the same seed produces an identical city after a day', async () => {
  const a = city(11);
  const b = city(11);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  await runDays(a, 1, createReflexRegistry());
  await runDays(b, 1, createReflexRegistry());
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.counters.engineErrors ?? 0, 0);
});

test('save and load round-trip preserves the world and continues identically', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reverie-'));
  try {
    const a = city(5);
    await runTicks(a, 30, createReflexRegistry());
    const path = join(dir, 'nested', 'world.json');
    saveWorld(a, path);
    const b = loadWorld(path);
    assert.equal(JSON.stringify(b), JSON.stringify(a), 'loaded world equals the saved one');
    assert.equal(b.tick, 30);
    await runDays(a, 1, createReflexRegistry());
    await runDays(b, 1, createReflexRegistry());
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'both worlds continue identically');
    assert.equal(b.counters.engineErrors ?? 0, 0);
    assert.throws(() => loadWorld(join(dir, 'missing.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a brain that throws or returns rubbish costs the citizen the hour, never the run', async () => {
  const w = city(2);
  const bad: Brain = { kind: 'reflex', decide: () => { throw new Error('boom'); } };
  const rubbish: Brain = { kind: 'reflex', decide: () => (42 as unknown as Action) };
  const [first, second] = w.order;
  const registry = createBrainRegistry({
    reflex: { kind: 'reflex', decide: (world, c, obs) => (c.id === first ? bad : c.id === second ? rubbish : createReflexRegistry().brainFor(c)).decide(world, c, obs) },
  });
  await stepTick(w, registry);
  assert.equal(w.tick, 1);
  assert.equal(w.counters.engineErrors, 1, 'the throwing brain is one engine error');
  assert.ok(w.events.some((e) => e.kind === 'system' && /Engine error/.test(e.text)));
  assert.deepEqual(w.citizens[first].recentActions, ['idle'], 'the citizen idled');
  assert.deepEqual(w.citizens[second].recentActions, ['idle'], 'rubbish becomes idle');
  assert.equal(totalMoney(w), expectedSupply(w));
});

test('an action that throws inside the engine is recorded and the tick completes', async () => {
  const w = city(9);
  const victim = w.order[0];
  // executeAction records the action type first; a poisoned recentActions makes it throw for this citizen only
  Object.defineProperty(w.citizens[victim], 'recentActions', { get() { throw new Error('cursed'); }, configurable: true });
  const registry = createBrainRegistry({ reflex: { kind: 'reflex', decide: () => ({ type: 'idle' }) } });
  await stepTick(w, registry);
  assert.equal(w.counters.engineErrors, 1, 'the failure was counted once');
  assert.ok(w.events.some((e) => e.kind === 'system' && /Engine error in idle by/.test(e.text)));
  assert.ok(w.citizens[victim].memory.some((m) => /could not idle/.test(m.text)), 'the citizen remembers losing the hour');
  const others = w.order.filter((id) => id !== victim);
  assert.ok(others.every((id) => w.citizens[id].recentActions.length === 1), 'everyone else still acted');
  assert.equal(w.tick, 1);
});

test('a failed action leaves a note in the citizen memory', async () => {
  const w = city(4);
  const registry = createBrainRegistry({ reflex: { kind: 'reflex', decide: () => ({ type: 'quit_job' }) } });
  await stepTick(w, registry);
  const c = w.citizens[w.order[0]];
  assert.ok(c.memory.some((m) => m.text.startsWith('(could not quit job:')), `memory: ${c.memory.map((m) => m.text).join(' | ')}`);
});

test('buildings repair a tenth a day and the loan-default hook files a fraud charge', async () => {
  const w = city(8);
  w.buildings.compute_forge.damage = 0.25;
  w.buildings.central_plaza.damage = 0.05;
  const borrower = w.citizens[w.order[0]];
  const loanId = 'l_1';
  w.loans[loanId] = {
    id: loanId, borrowerId: borrower.id, principal: 40, outstanding: 40, ratePerDay: 0.02, issuedDay: 0, lastPaymentDay: -8, defaulted: false,
  };
  borrower.loanId = loanId;
  // suspended: no work and no dividend, so nothing reaches the wallet and the bank cannot collect
  borrower.standing = 'suspended';
  borrower.suspendedUntilDay = 10;
  w.treasury.balance += borrower.wallet; // tests may move money directly; keep the supply consistent
  borrower.wallet = 0;
  await runTicks(w, 24, createReflexRegistry());
  assert.equal(w.buildings.compute_forge.damage, 0.15);
  assert.equal(w.buildings.central_plaza.damage, 0);
  assert.ok(w.events.some((e) => /fully repaired/.test(e.text)));
  const fraud = Object.values(w.cases).find((k) => k.defendantId === borrower.id && k.law === 'L07');
  assert.ok(fraud, 'a fraud charge was filed on default');
  assert.equal(fraud.filedBy, 'watch');
  assert.equal(fraud.evidence, 0.5);
});
