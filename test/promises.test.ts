/**
 * Promises (src/politics/promises.ts).
 *
 * A platform, the settings of the day its author took office, and what the
 * Council did afterwards — nothing else is stored, and everything else is read
 * back out of those three.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, Platform, World } from '../src/types.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import {
  PLATFORM_FIELDS, PROMISE_MARGIN, dailyPromises, keptShare, positionOf, promiseState, promisesOf, recordPlatform,
  settingFor,
} from '../src/politics/promises.ts';

/** A platform that asks for the city exactly as it is, but for the fields named. */
function platformOf(world: World, overrides: Partial<Platform> = {}): Platform {
  return {
    tax: positionOf(world, 'tax'), dividend: positionOf(world, 'dividend'),
    minWage: positionOf(world, 'minWage'), strictness: positionOf(world, 'strictness'),
    ...overrides,
  };
}

/** A councillor who stood on a platform, with the day's settings written down. */
function councillor(world: World, platform: Platform, name = 'Ondine'): Citizen {
  const c = makeCitizen(world, { name });
  c.platform = platform;
  world.government.council.push(c.id);
  c.office = 'councillor';
  recordPlatform(world, c);
  return c;
}

function announcements(world: World, id: string): { text: string; state: unknown }[] {
  return world.events
    .filter((e) => e.kind === 'proposal' && (e.data?.holder as string) === id)
    .map((e) => ({ text: e.text, state: e.data?.state }));
}

// ------------------------------------------------------------- the readings

test('the city\'s settings read as a platform, and a platform reads back as settings', () => {
  const w = makeWorld();
  w.government.incomeTax = 0.25;
  w.government.dividend = 30;
  w.government.minWage = 22.5;
  assert.equal(positionOf(w, 'tax'), 0.5);
  assert.equal(positionOf(w, 'dividend'), 0.5);
  assert.equal(Math.round(positionOf(w, 'minWage') * 100) / 100, 0.5);
  assert.ok(positionOf(w, 'strictness') > 0 && positionOf(w, 'strictness') <= 1);

  assert.equal(settingFor(w, 'tax', 0.5), 0.25);
  assert.equal(settingFor(w, 'dividend', 0.5), 30);
  assert.equal(settingFor(w, 'minWage', 0), 5);
  assert.equal(settingFor(w, 'strictness', 1), 5);
  assert.equal(settingFor(w, 'tax', NaN), 0.25, 'nonsense is read as the middle');
  for (const field of PLATFORM_FIELDS) assert.ok(Number.isFinite(positionOf(w, field)));
});

// ------------------------------------------------------------ what a promise is

test('a platform that matches the city as it is promises nothing', () => {
  const w = makeWorld();
  const c = councillor(w, platformOf(w));
  assert.deepEqual(promisesOf(w, c.id), []);
  assert.equal(keptShare(w, c.id), 0.5);
});

test('a citizen with no platform, and one nobody wrote down, promise nothing', () => {
  const w = makeWorld();
  const plain = makeCitizen(w);
  assert.deepEqual(promisesOf(w, plain.id), []);
  assert.equal(keptShare(w, plain.id), 0.5);
  assert.equal(keptShare(w, 'c_nobody'), 0.5);
  assert.deepEqual(promisesOf(w, 'c_nobody'), []);

  const unrecorded = makeCitizen(w);
  unrecorded.platform = platformOf(w, { tax: 0.05 });
  assert.deepEqual(promisesOf(w, unrecorded.id), [], 'nothing was written down when they stood');
  assert.equal(promiseState(w, unrecorded, 'tax'), 'open');
});

test('a promise stands open until the setting moves', () => {
  const w = makeWorld();
  const c = councillor(w, platformOf(w, { tax: 0.05 }));
  const promises = promisesOf(w, c.id);
  assert.equal(promises.length, 1);
  assert.equal(promises[0].field, 'tax');
  assert.equal(promises[0].state, 'open');
  assert.ok(Math.abs(promises[0].wanted - positionOf(w, 'tax')) > PROMISE_MARGIN);
  dailyPromises(w);
  assert.deepEqual(announcements(w, c.id), [], 'an open promise is not news');
});

// ------------------------------------------------------------------ breaking

test('a councillor who said they would cut tax and raised it is marked broken exactly once', () => {
  const w = makeWorld();
  const c = councillor(w, platformOf(w, { tax: 0.05 }));
  const before = c.reputation;
  w.government.incomeTax = 0.35;

  assert.equal(promiseState(w, c, 'tax'), 'broken');
  dailyPromises(w);
  assert.equal(c.reputation, before - 3);
  assert.equal(announcements(w, c.id).length, 1);
  assert.match(announcements(w, c.id)[0].text, /cut income tax/);
  assert.match(announcements(w, c.id)[0].text, /risen/);

  for (let day = 1; day < 10; day++) { w.day = day; dailyPromises(w); }
  assert.equal(announcements(w, c.id).length, 1, 'once, not every morning');
  assert.equal(c.reputation, before - 3);
  assert.equal(keptShare(w, c.id), 0);
});

test('a promise kept pays reputation, once', () => {
  const w = makeWorld();
  const c = councillor(w, platformOf(w, { tax: 0.05 }));
  const before = c.reputation;
  w.government.incomeTax = 0.02;

  assert.equal(promiseState(w, c, 'tax'), 'kept');
  dailyPromises(w);
  dailyPromises(w);
  assert.equal(c.reputation, before + 2);
  assert.equal(announcements(w, c.id).length, 1);
  assert.equal(announcements(w, c.id)[0].state, 'kept');
  assert.equal(keptShare(w, c.id), 1);
});

test('a Council that changes its mind twice is news twice, and no more', () => {
  const w = makeWorld();
  const c = councillor(w, platformOf(w, { tax: 0.05 }));
  w.government.incomeTax = 0.02;
  dailyPromises(w);
  w.day = 2;
  w.government.incomeTax = 0.4;
  dailyPromises(w);
  dailyPromises(w);
  const said = announcements(w, c.id);
  assert.equal(said.length, 2);
  assert.deepEqual(said.map((s) => s.state), ['kept', 'broken']);
});

test('the Mayor is judged by the same measure as the Council', () => {
  const w = makeWorld();
  const mayor = councillor(w, platformOf(w, { tax: 0.05 }), 'Sable');
  w.government.mayorId = mayor.id;
  mayor.office = 'mayor';
  w.government.incomeTax = 0.4;
  dailyPromises(w);
  assert.match(announcements(w, mayor.id)[0].text, /^Mayor Sable/);
});

// -------------------------------------------------------------- edge cases

test('a holder who leaves the city is judged no further, and the record is cleared away', () => {
  const w = makeWorld();
  const c = councillor(w, platformOf(w, { tax: 0.05 }));
  w.government.incomeTax = 0.4;
  dailyPromises(w);
  const said = announcements(w, c.id).length;

  w.government.council = [];
  w.day = w.config.cycleDays + 1;
  dailyPromises(w);
  assert.equal(announcements(w, c.id).length, said, 'no office, no promise to keep');
  assert.equal(w.counters[`platformDay:${c.id}`], undefined, 'the counters are not a graveyard');
  assert.deepEqual(promisesOf(w, c.id), []);
});

test('standing again writes down the new day, and the old announcements go with it', () => {
  const w = makeWorld();
  const c = councillor(w, platformOf(w, { tax: 0.05 }));
  w.government.incomeTax = 0.4;
  dailyPromises(w);
  assert.equal(w.counters[`promise:${c.id}:tax`], 2);

  w.day = 30;
  recordPlatform(w, c);
  assert.equal(w.counters[`platformDay:${c.id}`], 30);
  assert.equal(w.counters[`promise:${c.id}:tax`], undefined);
  assert.equal(promiseState(w, c, 'tax'), 'open', 'the promise is measured from the new term');
});

test('a government with nobody in it, and a citizen who no longer exists, are not errors', () => {
  const w = makeWorld();
  dailyPromises(w);
  w.government.council.push('c_nobody');
  w.government.mayorId = 'c_ghost';
  dailyPromises(w);
  assert.equal(keptShare(w, 'c_ghost'), 0.5);
});
