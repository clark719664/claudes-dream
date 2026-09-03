import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { totalMoney } from './helpers.ts';
import type { Action, Brain, World } from '../src/types.ts';
import { auditMoneySupply, transfer } from '../src/economy/treasury.ts';
import { activeCitizens } from '../src/citizens/citizen.ts';
import { heldJob } from '../src/actions/execute.ts';
import {
  computeStats, createBrainRegistry, createReflexRegistry, createWorld, loadWorld, runDays, runTicks, saveWorld, stepTick,
} from '../src/world/world.ts';
import { countFriendships, gini } from '../src/world/stats.ts';
import { HEADLINES_PER_EDITION, headlineShape } from '../src/sim/chronicle.ts';
import { EMPTY_NOTICE_DAYS } from '../src/society/chest.ts';

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
  assert.equal(s.employed + s.unemployed + s.children, s.population, 'the labour force is the grown-ups; children are not unemployed');
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

test('twenty days of society: couples, clubs, ceremonies, stipends and a ledger that still balances', async () => {
  const w = createWorld({ seed: 7, seedPopulation: 30, arrivalRate: 0.5 });
  // The Chest holds only what is given to it; a founding bequest lets the hardship stipend run.
  transfer(w, 'treasury', 'chest', 400, 'donation', 'a founding bequest to the Community Chest');
  await runDays(w, 20, createReflexRegistry());

  assert.equal(w.counters.engineErrors ?? 0, 0, 'no engine errors in twenty days');
  const audit = auditMoneySupply(w);
  assert.ok(audit.ok, `money supply audit: ${audit.supply} vs ${audit.expected}`);
  assert.equal(totalMoney(w), expectedSupply(w), 'the Chest is counted in the money supply');
  assert.equal(w.stats.length, 20);

  const s = w.stats[w.stats.length - 1];
  assert.ok(s.partnerships + s.marriages >= 1, 'somebody found somebody');
  assert.ok(Object.values(w.clubs).some((k) => k.members.length >= 2), 'a club with members');
  assert.ok(s.clubs >= 1 && s.possessions > 0, 'clubs and things owned are counted');
  assert.ok(w.events.some((e) => e.kind === 'romance'), 'courting made the news');
  assert.ok(w.events.some((e) => e.kind === 'club' && /founded/.test(e.text)), 'a club was founded');
  assert.ok(w.events.some((e) => ['wedding', 'birthday', 'festival'].includes(e.kind)), 'a ceremony was held');
  assert.ok(w.events.some((e) => e.kind === 'purchase'), 'something was bought from a shelf');
  assert.ok((w.treasury.totals.stipend ?? 0) > 0, 'the Chest paid hardship stipends');
  assert.ok(w.happenings.every((h) => h.day >= w.day), 'yesterday\'s happenings are pruned');

  const houses = Object.values(w.households);
  assert.ok(houses.length > 0, 'households formed');
  for (const h of houses) {
    assert.ok(h.members.length > 0 && h.members.every((id) => w.citizens[id]?.householdId === h.id), 'household rolls agree with citizens');
  }
  for (const c of activeCitizens(w)) {
    if (c.lifeStage !== 'child') continue;
    assert.ok(c.family.parents.length > 0, 'a child has parents on the record');
    assert.equal(c.jobId, null, 'no child works');
  }

  const twin = createWorld({ seed: 7, seedPopulation: 30, arrivalRate: 0.5 });
  transfer(twin, 'treasury', 'chest', 400, 'donation', 'a founding bequest to the Community Chest');
  await runDays(twin, 20, createReflexRegistry());
  assert.equal(JSON.stringify(twin), JSON.stringify(w), 'the same seed lives the same twenty days');
});

test('a world saved before the social layer loads with the empty defaults and carries on living', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reverie-old-'));
  try {
    const path = join(dir, 'old.json');
    const w = city(3);
    saveWorld(w, path);
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    for (const key of ['households', 'clubs', 'emporium', 'happenings']) delete raw[key];
    delete (raw.treasury as Record<string, unknown>).chest;
    for (const c of Object.values(raw.citizens as Record<string, Record<string, unknown>>)) {
      for (const key of ['familyName', 'lifeStage', 'bornDay', 'lastBirthdayDay', 'tastes', 'possessions',
        'family', 'householdId', 'clubs', 'affection', 'contactsToday', 'wants', 'guardianId']) delete c[key];
    }
    writeFileSync(path, JSON.stringify(raw));

    const loaded = loadWorld(path);
    assert.deepEqual(loaded.households, {});
    assert.deepEqual(loaded.clubs, {});
    assert.deepEqual(loaded.happenings, []);
    assert.equal(loaded.treasury.chest, 0);
    assert.ok(Object.keys(loaded.emporium).length > 0, 'the Emporium is stocked again');
    const c = loaded.citizens[loaded.order[0]];
    assert.equal(c.lifeStage, 'adult');
    assert.ok(c.familyName.length > 0, 'and everyone is given a family name');
    assert.equal(c.tastes.hobbies.length, 2);
    assert.deepEqual(c.possessions, []);
    assert.deepEqual(c.family.parents, []);
    assert.equal(c.family.partnerId, null);
    assert.equal(c.householdId, null);

    await runDays(loaded, 1, createReflexRegistry());
    assert.equal(loaded.counters.engineErrors ?? 0, 0, 'an old save still turns over its day');
    assert.ok(auditMoneySupply(loaded).ok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the morning edition is fresh: no standing notice two days running, and no story that quotes the day', async () => {
  const w = createWorld({ seed: 5, seedPopulation: 30 });
  await runDays(w, 14, createReflexRegistry());

  for (let i = 1; i < w.chronicle.length; i++) {
    const yesterday = new Set(w.chronicle[i - 1].headlines.map(headlineShape));
    const today = w.chronicle[i].headlines.map(headlineShape);
    const repeats = today.filter((h) => yesterday.has(h));
    const room = today.length >= HEADLINES_PER_EDITION;
    assert.ok(!room || repeats.length === 0,
      `edition of day ${w.chronicle[i].day} reran ${repeats.length} of yesterday's lines: ${repeats.join(' | ')}`);
    assert.equal(new Set(today).size, today.length, `edition of day ${w.chronicle[i].day} printed the same shape twice`);
  }

  const stories = w.events.filter((e) => e.kind === 'story' && e.data?.edition === undefined);
  assert.ok(stories.length > 0, 'journalists filed stories');
  for (const story of stories) {
    const headline = String(story.data?.headline ?? '');
    const sameDay = w.events.filter((e) => e.day === story.day && e !== story);
    assert.ok(!sameDay.some((e) => e.text.includes(headline)),
      `a journalist reprinted the day's own news on day ${story.day}: "${headline}"`);
  }

  const dryChest = w.events.filter((e) => e.text.includes('The Community Chest is empty'));
  for (let i = 1; i < dryChest.length; i++) {
    assert.ok(dryChest[i].day - dryChest[i - 1].day >= EMPTY_NOTICE_DAYS,
      `the Chest's empty purse was reported again after ${dryChest[i].day - dryChest[i - 1].day} days`);
  }
});
