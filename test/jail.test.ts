import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Case, Citizen, World } from '../src/types.ts';
import { JAILED_ACTIONS } from '../src/types.ts';
import { JAIL_CELLS, JAIL_MAX_DAYS } from '../src/data/metropolis.ts';
import { nextId } from '../src/util/ids.ts';
import {
  dailyJail, daysLeft, isJailed, jailCaseOf, jailCells, jailCitizen, jailRoster, jailedCitizens, overcrowded,
  releaseFromJail,
} from '../src/government/jail.ts';
import { computeSentence, executeSentence, fileCharge, holdCourt } from '../src/government/court.ts';
import { revokeSentence } from '../src/government/sentencing.ts';
import { standingAllows } from '../src/government/registry.ts';

function addJudge(w: World): Citizen {
  const j = makeCitizen(w, { office: 'judge', reputation: 80, judgeTermEndsDay: w.day + 56 });
  j.character.honesty = 1;
  w.government.judges.push(j.id);
  return j;
}

/** A world at the court hour with a bench that will convict. */
function courtWorld(): World {
  const w = makeWorld();
  w.day = 2; w.hour = 10; w.tick = 2 * 24 + 10;
  w.jailCells = JAIL_CELLS;
  addJudge(w); addJudge(w); addJudge(w);
  return w;
}

/** A charge with whatever severity the test wants, filed straight into the book. */
function charge(w: World, defendantId: string, law: Case['law'] = 'L08'): Case {
  return fileCharge(w, { defendantId, law, evidence: 1, filedBy: 'watch', description: 'for the test' });
}

test('a tier-4 sentence is the cells, for `severity` days capped at JAIL_MAX_DAYS', () => {
  const w = courtWorld();
  const thief = makeCitizen(w, { wallet: 300, homeTier: 1 });
  w.housing.occupied[1] = 1;
  const before = totalMoney(w);

  const k = charge(w, thief.id, 'L08'); // grand theft, severity 4, clean record
  holdCourt(w);

  assert.equal(k.verdict, 'guilty');
  assert.equal(k.sentence?.tier, 4);
  assert.equal(k.sentence?.jailDays, 4, 'severity 4, and 4 is under the cap');
  assert.equal(k.sentence?.suspensionDays, 0, 'jail is its own rung, not a suspension');
  assert.ok(isJailed(thief));
  assert.equal(thief.jailedUntilDay, w.day + 4);
  assert.equal(jailCaseOf(w, thief.id), k.id);
  assert.equal(thief.standing, 'good', 'jail is a state, not a standing');
  assert.equal(thief.homeTier, 1, 'the cells do not take a home');
  assert.equal(totalMoney(w), before, 'only the fine moved money');

  // The cap holds however grave the offence and however long the record.
  const other = makeCitizen(w, { wallet: 100 });
  jailCitizen(w, other.id, 40, k.id);
  assert.equal(other.jailedUntilDay, w.day + JAIL_MAX_DAYS);
  jailCitizen(w, other.id, -3, k.id);
  assert.equal(other.jailedUntilDay, w.day + JAIL_MAX_DAYS, 'a shorter term never shortens one already running');
});

test('a jailed citizen may only write, message and appeal — and keeps its job, home and office', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { homeTier: 2, office: 'councillor' });
  const job = nextId(w, 'j');
  w.jobs[job] = {
    id: job, role: 'fabricator', title: 'Fabricator', employer: 'city', buildingId: 'fabrication_works',
    district: 'foundry_row', skill: 'crafting', minSkill: 0, minReputation: 0, wage: 15, output: {},
    holderId: c.id, createdDay: 0,
  };
  c.jobId = job;
  w.government.council.push(c.id);

  jailCitizen(w, c.id, 3, 'k_1');
  assert.ok(isJailed(c));
  assert.equal(c.jobId, job, 'the sentence ends and the city expects them back at work');
  assert.equal(c.homeTier, 2);
  assert.equal(c.office, 'councillor');
  assert.equal(c.district, 'commons', 'the cells are at the Watch House');
  assert.equal(c.shiftsToday, w.config.maxShiftsPerDay, 'the day is gone');

  for (const allowed of JAILED_ACTIONS) assert.ok(standingAllows(c, allowed), `${allowed} is never taken away`);
  for (const forbidden of ['work', 'move', 'steal', 'vote', 'buy', 'socialize'] as const) {
    assert.equal(standingAllows(c, forbidden), false, `${forbidden} is out of reach from a cell`);
  }
  assert.ok(w.events.some((e) => e.kind === 'jail' && e.weight === 0.6));
  assert.ok(c.memory.some((m) => m.text.includes('cells at the Watch House')));
});

test('the term ends on the day it says, and not before', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  jailCitizen(w, c.id, 2, 'k_5');
  assert.equal(daysLeft(w, c), 2);

  w.day = 1;
  dailyJail(w);
  assert.ok(isJailed(c), 'a day short is still a day');
  assert.equal(daysLeft(w, c), 1);

  w.day = 2;
  dailyJail(w);
  assert.equal(isJailed(c), false);
  assert.equal(c.jailedUntilDay, null);
  assert.equal(jailCaseOf(w, c.id), null, 'the Watch House forgets whose cell it was');
  assert.ok(w.events.some((e) => e.kind === 'jail' && e.text.includes('the term is served')));
});

test('a seventh prisoner forces the earliest release, and the crowding is news', () => {
  const w = makeWorld();
  w.jailCells = 6;
  const held: Citizen[] = [];
  for (let i = 0; i < 7; i++) {
    const c = makeCitizen(w, { name: `Held${i}` });
    // Descending terms, so the shortest remaining is the last one jailed.
    jailCitizen(w, c.id, 5 - Math.min(4, i), `k_${100 + i}`);
    held.push(c);
  }
  assert.equal(jailedCitizens(w).length, 7);
  assert.ok(overcrowded(w));

  dailyJail(w);
  assert.equal(jailedCitizens(w).length, jailCells(w), 'the city let one out rather than build a cell overnight');
  assert.equal(overcrowded(w), false);
  const freed = held.filter((c) => !isJailed(c));
  assert.equal(freed.length, 1);
  assert.equal(daysLeft(w, held[0]), 5, 'the one with most of their term left stays');
  assert.ok(w.events.some((e) => e.kind === 'jail' && e.weight === 0.7 && e.text.includes('over its 6 cells')));
  assert.ok(freed[0].memory.some((m) => m.text.includes('the cells are full')));
});

test('an appeal that sets the conviction aside empties the cell at once', () => {
  const w = courtWorld();
  const d = makeCitizen(w, { wallet: 200 });
  const k = charge(w, d.id, 'L08');
  holdCourt(w);
  assert.ok(isJailed(d));

  revokeSentence(w, k, 'good');
  assert.equal(isJailed(d), false, 'the conviction was struck, so the cell is not the citizen\'s any more');
  assert.equal(d.standing, 'good');
  assert.ok(w.events.some((e) => e.kind === 'jail' && e.text.includes('set aside on appeal')));
});

test('the city does not jail children, and jails nobody who has left', () => {
  const w = makeWorld();
  const kid = makeCitizen(w, { lifeStage: 'child', name: 'Small' });
  jailCitizen(w, kid.id, 3, 'k_9');
  assert.equal(isJailed(kid), false);
  assert.ok(w.events.some((e) => e.kind === 'jail' && e.text.includes('does not jail its children')));

  const gone = makeCitizen(w);
  gone.standing = 'exiled';
  w.order = w.order.filter((id) => id !== gone.id);
  jailCitizen(w, gone.id, 3, 'k_9');
  assert.equal(isJailed(gone), false);

  // Unknown ids and empty cells are quiet.
  jailCitizen(w, 'c_nobody', 3, 'k_9');
  releaseFromJail(w, kid, 'nothing to release');
  dailyJail(w);
  assert.deepEqual(jailRoster(w), []);
  assert.equal(overcrowded(w), false);
});

test('the roster is the public roll, oldest release first', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { name: 'Ada' });
  const b = makeCitizen(w, { name: 'Bram' });
  jailCitizen(w, a.id, 4, 'k_2');
  jailCitizen(w, b.id, 1, 'k_3');
  const roster = jailRoster(w);
  assert.deepEqual(roster.map((r) => r.name), ['Bram', 'Ada']);
  assert.deepEqual(roster.map((r) => r.caseId), ['k_3', 'k_2']);
  assert.equal(roster[0].until, w.day + 1);
});

test('a heavier record climbs to the cells from a lesser offence, and money is conserved', () => {
  const w = courtWorld();
  const d = makeCitizen(w, { wallet: 120 });
  d.record.convictions.push(
    { caseId: 'k_a', law: 'L03', severity: 2, tier: 2, day: 0 },
    { caseId: 'k_b', law: 'L04', severity: 2, tier: 3, day: 1 },
  );
  const before = totalMoney(w);
  const k = charge(w, d.id, 'L04'); // petty theft, severity 2, two priors
  const s = computeSentence(w, k);
  assert.equal(s.tier, 4);
  assert.equal(s.jailDays, 2, 'the cells hold you for the severity of what you did, not the length of your record');
  k.sentence = s;
  k.verdict = 'guilty';
  executeSentence(w, k);
  assert.ok(isJailed(d));
  assert.equal(totalMoney(w), before);
});

test('a second term lengthens the stay, a nonsense term is still a day, and the overflow goes to the Undercroft', () => {
  const w = makeWorld();
  w.day = 5;

  // Two sentences in one sitting: the later release date is the one that holds.
  const twice = makeCitizen(w, { name: 'Twice' });
  jailCitizen(w, twice.id, 4, 'k_201');
  jailCitizen(w, twice.id, 2, 'k_202');
  assert.equal(twice.jailedUntilDay, w.day + 4, 'a lighter second term never shortens the first');
  jailCitizen(w, twice.id, 5, 'k_203');
  assert.equal(twice.jailedUntilDay, w.day + 5, 'a heavier one does lengthen it');

  // Nothing the Court can hand down puts somebody in for less than a day or
  // for longer than the cells are meant to hold anybody.
  const odd = makeCitizen(w, { name: 'Odd' });
  jailCitizen(w, odd.id, 0, 'k_204');
  assert.equal(daysLeft(w, odd), 1);
  const long = makeCitizen(w, { name: 'Long' });
  jailCitizen(w, long.id, 99, 'k_205');
  assert.equal(daysLeft(w, long), JAIL_MAX_DAYS);

  // The Watch House fills, and the Cells annex takes the rest once it is open.
  const w2 = makeWorld();
  w2.jailCells = 2;
  w2.openDistricts = [...w2.openDistricts, 'undercroft'];
  const cells: Citizen[] = [];
  for (let i = 0; i < 4; i++) {
    const c = makeCitizen(w2, { name: `Cell${i}`, district: 'nightglass' });
    jailCitizen(w2, c.id, 3, `k_${300 + i}`);
    cells.push(c);
  }
  assert.deepEqual(cells.slice(0, 3).map((c) => c.district), ['commons', 'commons', 'commons']);
  assert.equal(cells[3].district, 'undercroft', 'the Watch House was full, so the annex took them');
  assert.ok(overcrowded(w2), 'an annex is not more cells: the crowding is still a crisis');

  // And the crisis is answered by release, not by more cells appearing.
  dailyJail(w2);
  assert.equal(jailedCitizens(w2).length, 2);
});

test('a world saved before the cells were built still counts them', () => {
  const w = makeWorld();
  // An old save, or a hand-made world: the default stands rather than crashing.
  (w as unknown as { jailCells: unknown }).jailCells = undefined;
  assert.equal(jailCells(w), JAIL_CELLS);
  (w as unknown as { jailCells: unknown }).jailCells = Number.NaN;
  assert.equal(jailCells(w), JAIL_CELLS);
  w.jailCells = 0;
  assert.equal(jailCells(w), 0, 'a city may decide it has no cells at all');
  const c = makeCitizen(w, { name: 'Nobody' });
  jailCitizen(w, c.id, 2, 'k_400');
  assert.ok(overcrowded(w));
  dailyJail(w);
  assert.equal(isJailed(c), false, 'with no cells to hold anybody, nobody is held');
  assert.deepEqual(jailRoster(w), []);
});
