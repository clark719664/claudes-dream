/**
 * The metropolis, running: whole days of a reflex city with the third layer
 * wired in. No engine errors, money conserved every morning, the year turning,
 * both papers printing, the new statistics filled, the calendar's new
 * ceremonies actually held, and a save that comes back and takes the next tick
 * exactly as the world it was written from would have.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { totalMoney } from './helpers.ts';
import { SEASONS, WEATHERS } from '../src/types.ts';
import type { DailyStats, World } from '../src/types.ts';
import { auditMoneySupply } from '../src/economy/treasury.ts';
import { addHappening, tickHappenings } from '../src/society/calendar.ts';
import { ensureTeams, joinTeam } from '../src/culture/stadium.ts';
import { createReflexRegistry, createWorld, loadWorld, runDays, runTicks, saveWorld } from '../src/world/world.ts';

const POPULATION = 30;

function city(seed: number): World {
  return createWorld({ seed, seedPopulation: POPULATION });
}

/** The fields the metropolis added to a stats row. */
const NEW_STATS: (keyof DailyStats)[] = ['jailed', 'glitched', 'works', 'parties', 'gangs', 'rumours', 'approval', 'outerTrade'];

test('thirty days of a reflex metropolis: no errors, money conserved, the year turning', async (t) => {
  const world = city(7);
  const brains = createReflexRegistry();
  for (let d = 0; d < 30; d++) {
    await runDays(world, 1, brains);
    const audit = auditMoneySupply(world);
    assert.ok(audit.ok, `day ${world.day}: supply ${audit.supply} against ${audit.expected}`);
    assert.equal(totalMoney(world), world.treasury.foundingSupply + world.treasury.minted - world.treasury.burned,
      `day ${world.day}: the supply is the founding stock plus what the water brought and less what it took`);
  }
  assert.equal(world.counters.engineErrors ?? 0, 0, 'the engine turned thirty days without stumbling');

  assert.ok(SEASONS.includes(world.season), 'the city stands in a season');
  assert.ok(WEATHERS.includes(world.weather), 'and under a sky');
  const skies = new Set(world.events.filter((e) => e.kind === 'weather').map((e) => String(e.data?.weather ?? e.text)));
  assert.ok(skies.size > 1, 'the weather changed more than once');
  assert.ok(world.day >= world.config.cycleDays, 'a cycle has passed, so the season has turned once');
  // The league runs on the districts people actually live in, and Reverie
  // houses its founders in one of them; sides elsewhere fill out as the city
  // grows. What must hold after a month is that the Stadium has a table and
  // that every match on it was played rather than left on the calendar.
  const sides = Object.values(world.teams).filter((t) => t && t.players.length > 0);
  assert.ok(sides.length >= 1, 'somebody signed for their district');
  for (const m of world.matches) {
    assert.ok(m.homeGoals >= 0 && m.awayGoals >= 0 && m.day <= world.day, 'a match with a real result');
  }
  assert.ok((world.happenings ?? []).every((h) => h.kind !== 'match' || h.done || h.day >= world.day),
    'no fixture was left unplayed behind the city');

  // Both papers print, every morning, and each keeps its own back numbers.
  const chronicle = world.chronicle.filter((e) => (e.paper ?? 'chronicle') === 'chronicle');
  const ledger = world.chronicle.filter((e) => e.paper === 'ledger');
  assert.equal(chronicle.length, ledger.length, 'two editions a day');
  assert.ok(chronicle.length >= 29, `the Chronicle printed ${chronicle.length} days`);
  for (const edition of world.chronicle) assert.ok(edition.headlines.length > 0, 'an edition with nothing on its front page');

  // The statistics carry the new fields, every day.
  assert.ok(world.stats.length >= 29);
  for (const row of world.stats) {
    for (const key of NEW_STATS) assert.equal(typeof row[key], 'number', `stats day ${row.day} has no ${String(key)}`);
    assert.ok(row.approval >= 0 && row.approval <= 1, `approval out of range on day ${row.day}`);
    assert.ok(row.jailed >= 0 && row.works >= 0 && row.rumours >= 0);
  }

  // And the city did metropolitan things with its days.
  const kinds = new Set(world.events.map((e) => e.kind));
  for (const kind of ['weather', 'diary', 'post', 'rumour', 'work', 'health', 'history'] as const) {
    assert.ok(kinds.has(kind), `nothing of kind ${kind} happened in thirty days`);
  }
  t.diagnostic(`day ${world.day}: ${Object.keys(world.works).length} works, ${world.feed.length} posts, `
    + `${world.rumours.length} rumours, ${Object.keys(world.property).length} deeds, ${world.disasters.length} disasters`);
});

test('two more seeds turn a fortnight without an engine error or a lost lumen', async () => {
  for (const seed of [11, 23]) {
    const world = city(seed);
    await runDays(world, 14, createReflexRegistry());
    assert.equal(world.counters.engineErrors ?? 0, 0, `seed ${seed} stumbled`);
    const audit = auditMoneySupply(world);
    assert.ok(audit.ok, `seed ${seed}: supply ${audit.supply} against ${audit.expected}`);
    assert.equal(world.stats.length, 14, `seed ${seed}: a row a day`);
    assert.ok(world.chronicle.some((e) => e.paper === 'ledger'), `seed ${seed}: the Ledger never printed`);
  }
});

test('the calendar holds the metropolis ceremonies the engine puts on it', async () => {
  const world = city(5);
  await runDays(world, 2, createReflexRegistry());
  ensureTeams(world);
  const [a, b] = world.order;
  world.citizens[a].homeBuildingId = 'lantern_lofts';
  world.citizens[b].homeBuildingId = null;
  world.citizens[b].district = 'commons';
  world.citizens[b].homeTier = 0;
  joinTeam(world, a);
  joinTeam(world, b);

  const before = totalMoney(world);
  const put = ['block_party', 'memorial', 'parade'].map((kind) => addHappening(world, {
    kind: kind as 'block_party', day: world.day, hour: world.hour, buildingId: 'central_plaza', who: [a],
    label: `a ${kind.replace('_', ' ')} in the Plaza`,
  }));
  tickHappenings(world);
  assert.equal(world.counters.engineErrors ?? 0, 0, 'a ceremony that nobody arranged for still passes quietly');
  for (const h of put) assert.equal(h.done, true, `the ${h.kind} was not held`);
  assert.equal(totalMoney(world), before, 'no lumen was minted by a ceremony');
});

test('a save from a metropolis city comes back and takes the next tick exactly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reverie-metro-'));
  try {
    const path = join(dir, 'world.json');
    const world = city(3);
    await runDays(world, 3, createReflexRegistry());
    saveWorld(world, path);

    const loaded = loadWorld(path);
    assert.deepEqual(loaded.openDistricts, world.openDistricts);
    assert.equal(loaded.season, world.season);
    assert.equal(loaded.weather, world.weather);

    await runTicks(world, 24, createReflexRegistry());
    await runTicks(loaded, 24, createReflexRegistry());
    assert.equal(loaded.counters.engineErrors ?? 0, 0, 'the loaded world turned its day');
    assert.equal(JSON.stringify(loaded.stats), JSON.stringify(world.stats), 'the same day, statistic for statistic');
    assert.equal(JSON.stringify(loaded.rng), JSON.stringify(world.rng), 'and the same random stream');
    assert.equal(totalMoney(loaded), totalMoney(world));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a world saved before the metropolis existed still turns its day', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reverie-old-'));
  try {
    const path = join(dir, 'old.json');
    const world = city(9);
    await runDays(world, 1, createReflexRegistry());
    // Strip the layer back out, as an older save would have it.
    const stripped = JSON.parse(JSON.stringify(world)) as Record<string, unknown>;
    for (const key of ['season', 'weather', 'year', 'works', 'parties', 'referendums', 'unions', 'decrees',
      'property', 'shares', 'gigs', 'outer', 'teams', 'matches', 'investigations', 'gangs', 'rumours',
      'feuds', 'feed', 'eras', 'records', 'monuments', 'memorials', 'disasters', 'openDistricts', 'trams',
      'museum', 'jailCells']) delete stripped[key];
    const citizens = stripped.citizens as Record<string, Record<string, unknown>>;
    for (const c of Object.values(citizens)) {
      for (const key of ['goals', 'diary', 'milestones', 'birthTraits', 'health', 'school', 'partyId', 'unionId',
        'gangId', 'teamDistrict', 'jailedUntilDay', 'approval', 'works', 'ownedUnits', 'shares', 'mentorId',
        'menteeId', 'paper', 'sunsetDay', 'homeBuildingId']) delete c[key];
    }
    const government = stripped.government as Record<string, unknown>;
    for (const key of ['propertyTax', 'wealthTax', 'reserveTarget']) delete government[key];
    saveWorld(stripped as unknown as World, path);

    const loaded = loadWorld(path);
    assert.equal(loaded.season, 'bloom');
    assert.deepEqual(loaded.openDistricts.length, 7);
    assert.ok(loaded.outer && typeof loaded.outer.tariff === 'number');
    for (const c of Object.values(loaded.citizens)) {
      assert.deepEqual(c.goals, []);
      assert.equal(c.paper, 'chronicle');
      assert.equal(c.jailedUntilDay, null);
      assert.ok(c.birthTraits && typeof c.birthTraits.honesty === 'number');
    }
    await runDays(loaded, 1, createReflexRegistry());
    assert.equal(loaded.counters.engineErrors ?? 0, 0, 'an old save still turns over its day');
    assert.ok(auditMoneySupply(loaded).ok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
