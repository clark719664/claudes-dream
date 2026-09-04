/**
 * Decrees (src/politics/decrees.ts).
 *
 * The Mayor's one act a cycle: who may make it, what each kind does, and how
 * the rest of the city reads it while it stands.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, Disaster, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  CURFEW_ALLOWED, CURFEW_HOURS, CURFEW_SOCIAL_RELIEF, CURFEW_VISIBILITY, EMERGENCY_DAYS,
  EMERGENCY_WORKS_MULTIPLIER, RELIEF_MAX,
  activeDecrees, curfewBlocks, curfewSocialRelief, curfewVisibilityMod, dailyDecrees, decree, decreeInForce,
  decreesObservation, emergencyWorksMultiplier, inCurfewHours, mayDecree, salesTaxToday,
} from '../src/politics/decrees.ts';

function mayor(world: World, name = 'Sable'): Citizen {
  const c = makeCitizen(world, { name });
  world.government.mayorId = c.id;
  world.government.council = [c.id];
  c.office = 'mayor';
  return c;
}

function storm(world: World): Disaster {
  const d: Disaster = { kind: 'storm', day: world.day, district: 'harbor_market', severity: 0.6, resolvedDay: null };
  world.disasters = [d];
  return d;
}

// -------------------------------------------------------------- who may decree

test('only the Mayor decrees, and only once a cycle', () => {
  const w = makeWorld();
  const m = mayor(w);
  const other = makeCitizen(w);
  assert.equal(mayDecree(w, m), true);
  assert.equal(mayDecree(w, other), false);
  assert.equal(decree(w, other.id, 'tax_holiday').ok, false);
  assert.equal(decree(w, 'c_nobody', 'tax_holiday').ok, false);
  assert.equal(decree(w, m.id, 'nonsense' as 'relief').ok, false);

  const first = decree(w, m.id, 'tax_holiday');
  assert.equal(first.ok, true, first.message);
  assert.equal(w.government.decreeUsedCycle, w.government.cycle);
  assert.equal(mayDecree(w, m), false);
  assert.equal(decree(w, m.id, 'curfew', 'commons').ok, false, 'one a cycle');

  w.government.cycle += 1;
  assert.equal(mayDecree(w, m), true, 'a new cycle, a new decree');
});

test('a Mayor in the cells, detained, or out of standing decrees nothing', () => {
  const w = makeWorld();
  const m = mayor(w);
  m.standing = 'suspended';
  assert.equal(mayDecree(w, m), false);
  assert.equal(decree(w, m.id, 'tax_holiday').ok, false);
  m.standing = 'good';
  m.jailedUntilDay = w.day + 2;
  assert.equal(mayDecree(w, m), false);
  assert.equal(decree(w, m.id, 'tax_holiday').ok, false);
  m.jailedUntilDay = null;
  m.detainedUntilTick = w.tick + 5;
  assert.equal(decree(w, m.id, 'tax_holiday').ok, false);
  assert.equal(w.government.decreeUsedCycle, null, 'a refused decree is not spent');
});

// ---------------------------------------------------------------- tax holiday

test('a tax holiday costs the Treasury its sales tax for exactly one day', () => {
  const w = makeWorld();
  const m = mayor(w);
  w.government.salesTax = 0.05;
  assert.equal(salesTaxToday(w), 0.05);

  assert.equal(decree(w, m.id, 'tax_holiday').ok, true);
  assert.equal(salesTaxToday(w), 0, 'nothing is charged today');
  assert.equal(w.government.salesTax, 0.05, 'and the rate itself is untouched');
  assert.equal(decreeInForce(w, 'tax_holiday')?.untilDay, w.day);

  w.day += 1;
  assert.equal(salesTaxToday(w), 0.05, 'the holiday was a day');
  assert.equal(decreeInForce(w, 'tax_holiday'), null);
});

// --------------------------------------------------------------------- curfew

test('a curfew stops the night\'s business in its district and lets a citizen rest', () => {
  const w = makeWorld();
  const m = mayor(w);
  const inside = makeCitizen(w, { district: 'nightglass' });
  const elsewhere = makeCitizen(w, { district: 'commons' });

  assert.equal(decree(w, m.id, 'curfew').ok, false, 'a curfew must name a district');
  assert.equal(decree(w, m.id, 'curfew', 'nowhere' as 'commons').ok, false);
  const res = decree(w, m.id, 'curfew', 'nightglass');
  assert.equal(res.ok, true, res.message);

  w.hour = 22;
  assert.equal(curfewBlocks(w, inside, 'work'), true);
  assert.equal(curfewBlocks(w, inside, 'steal'), true);
  for (const allowed of CURFEW_ALLOWED) assert.equal(curfewBlocks(w, inside, allowed), false, `${allowed} is allowed`);
  assert.equal(curfewBlocks(w, elsewhere, 'work'), false, 'a curfew covers a district, not a city');

  w.hour = 12;
  assert.equal(curfewBlocks(w, inside, 'work'), false, 'a curfew is a night, not a day');
  assert.equal(inCurfewHours(CURFEW_HOURS[0]), true);
  assert.equal(inCurfewHours(CURFEW_HOURS[1]), false);
  assert.equal(inCurfewHours(3), true);

  assert.equal(curfewVisibilityMod(w, 'nightglass'), CURFEW_VISIBILITY, 'the Watch is out');
  assert.equal(curfewVisibilityMod(w, 'commons'), 0);
  assert.equal(curfewSocialRelief(w, inside), CURFEW_SOCIAL_RELIEF, 'shut in, the city misses itself less');
  assert.equal(curfewSocialRelief(w, elsewhere), 1);

  w.day += 2;
  assert.equal(curfewBlocks(w, inside, 'work'), false);
  assert.equal(curfewSocialRelief(w, inside), 1);
});

// --------------------------------------------------------------------- relief

test('relief reaches every citizen in hardship, and the money is conserved', () => {
  const w = makeWorld();
  const m = mayor(w);
  const a = makeCitizen(w, { wallet: 0, homeTier: 0 });
  const b = makeCitizen(w, { wallet: 5, homeTier: 0 });
  const comfortable = makeCitizen(w, { wallet: 500, homeTier: 2 });
  const before = totalMoney(w);
  const treasury = w.treasury.balance;

  const res = decree(w, m.id, 'relief', undefined, 25);
  assert.equal(res.ok, true, res.message);
  assert.equal(a.wallet, 25);
  assert.equal(b.wallet, 30);
  assert.equal(comfortable.wallet, 500, 'relief answers hardship, not everybody');
  assert.equal(totalMoney(w), before, 'the Treasury paid it; nothing was minted');
  assert.ok(w.treasury.balance < treasury);
  assert.ok(a.memory.some((mem) => mem.text.includes('relief')));
  assert.equal(decreeInForce(w, 'relief')?.value, 25);
});

test('relief is capped, paid pro rata from a thin Treasury, and refused when there is nobody to pay', () => {
  const w = makeWorld();
  const m = mayor(w);
  const claimant = makeCitizen(w, { wallet: 0, homeTier: 0 });
  assert.equal(decree(w, m.id, 'relief', undefined, 10_000).ok, true);
  assert.equal(claimant.wallet, RELIEF_MAX, 'no more than the cap, however generous the Mayor');

  const w2 = makeWorld();
  const m2 = mayor(w2);
  m2.homeTier = 2;
  for (let i = 0; i < 10; i++) makeCitizen(w2, { wallet: 0, homeTier: 0 });
  w2.treasury.balance = 20;
  const before = totalMoney(w2);
  assert.equal(decree(w2, m2.id, 'relief', undefined, RELIEF_MAX).ok, true);
  assert.equal(totalMoney(w2), before);
  assert.ok(w2.treasury.balance >= 0, 'the Treasury cannot go under');

  const w3 = makeWorld();
  const m3 = mayor(w3);
  m3.homeTier = 3;
  m3.needs = { energy: 90, rest: 90, social: 90, comfort: 90, purpose: 90 };
  assert.equal(decree(w3, m3.id, 'relief').ok, false, 'nobody is in hardship');
  assert.equal(w3.government.decreeUsedCycle, null);
});

// ------------------------------------------------------------------ emergency

test('a state of emergency answers a disaster, and only a disaster', () => {
  const w = makeWorld();
  const m = mayor(w);
  assert.equal(decree(w, m.id, 'emergency').ok, false, 'the city is not living through one');
  assert.equal(emergencyWorksMultiplier(w), 1);

  const d = storm(w);
  const res = decree(w, m.id, 'emergency');
  assert.equal(res.ok, true, res.message);
  assert.equal(emergencyWorksMultiplier(w), EMERGENCY_WORKS_MULTIPLIER);
  assert.equal(decreeInForce(w, 'emergency')?.untilDay, w.day + EMERGENCY_DAYS);

  w.day += EMERGENCY_DAYS;
  assert.equal(emergencyWorksMultiplier(w), EMERGENCY_WORKS_MULTIPLIER, 'it stands to the end of its last day');
  w.day += 1;
  assert.equal(emergencyWorksMultiplier(w), 1);
  d.resolvedDay = w.day;
});

// ----------------------------------------------------------------- the record

test('a decree lapses on time and the city is told, once', () => {
  const w = makeWorld();
  const m = mayor(w);
  decree(w, m.id, 'curfew', 'commons');
  const lapses = (): number => w.events.filter((e) => e.kind === 'decree' && e.data?.lapsed === true).length;

  dailyDecrees(w);
  assert.equal(lapses(), 0, 'it is still in force');
  w.day += 1;
  dailyDecrees(w);
  assert.equal(lapses(), 0, 'its last day is today');
  w.day += 1;
  dailyDecrees(w);
  assert.equal(lapses(), 1);
  w.day += 1;
  dailyDecrees(w);
  assert.equal(lapses(), 1, 'and it is not news twice');
});

test('the decrees standing over the city are the ones a citizen sees', () => {
  const w = makeWorld();
  const m = mayor(w);
  assert.deepEqual(decreesObservation(w), []);
  decree(w, m.id, 'curfew', 'verdant_quarter');
  assert.deepEqual(decreesObservation(w), [{ kind: 'curfew', district: 'verdant_quarter', untilDay: w.day + 1 }]);
  assert.equal(activeDecrees(w).length, 1);
  assert.equal(activeDecrees(w, w.day + 5).length, 0);

  w.day += w.config.cycleDays + 2;
  dailyDecrees(w);
  assert.equal(w.decrees?.length, 0, 'old decrees are cleared away');
});

test('a world with no decrees, no disasters and no citizens is not an error', () => {
  const w = makeWorld();
  dailyDecrees(w);
  assert.equal(salesTaxToday(w), w.government.salesTax);
  assert.equal(emergencyWorksMultiplier(w), 1);
  assert.equal(curfewVisibilityMod(w, 'commons'), 0);
  assert.equal(curfewSocialRelief(w, undefined as unknown as Citizen), 1);
  assert.equal(curfewBlocks(w, undefined as unknown as Citizen, 'work'), false);
  assert.equal(decreeInForce(w, 'curfew', 'commons'), null);
  assert.equal(mayDecree(w, makeCitizen(w)), false);
});

test('a curfew names a district the city has opened', () => {
  const w = makeWorld();
  const m = mayor(w);
  const closed = decree(w, m.id, 'curfew', 'undercroft');
  assert.equal(closed.ok, false, 'the tunnels are not open yet');
  assert.match(closed.message, /not open/);
  assert.equal(w.government.decreeUsedCycle, null, 'and a refusal spends nothing');
  assert.equal(decree(w, m.id, 'curfew', 'nowhere' as never).ok, false);

  w.openDistricts.push('undercroft');
  const opened = decree(w, m.id, 'curfew', 'undercroft');
  assert.equal(opened.ok, true, opened.message);
  assert.equal(decreeInForce(w, 'curfew', 'undercroft')?.district, 'undercroft');
});

test('relief that names no sum gives what the Charter allows', () => {
  const w = makeWorld();
  w.treasury.balance = 10_000;
  const m = mayor(w);
  const poor = makeCitizen(w, { name: 'Wren', wallet: 0, homeTier: 0 });
  const before = totalMoney(w);

  assert.equal(decree(w, m.id, 'relief').ok, true);
  assert.equal(poor.wallet, RELIEF_MAX, 'no sum named is the most the Charter allows, not a single lumen');
  assert.equal(totalMoney(w), before);

  const w2 = makeWorld();
  w2.treasury.balance = 10_000;
  const m2 = mayor(w2);
  const poor2 = makeCitizen(w2, { name: 'Fen', wallet: 0, homeTier: 0 });
  assert.equal(decree(w2, m2.id, 'relief', undefined, 0).ok, true);
  assert.equal(poor2.wallet, RELIEF_MAX, 'and neither is a sum of nothing');
  void m2;
});

test('a payment made does not lapse', () => {
  const w = makeWorld();
  w.treasury.balance = 1_000;
  const m = mayor(w);
  makeCitizen(w, { wallet: 0, homeTier: 0 });
  assert.equal(decree(w, m.id, 'relief', undefined, 10).ok, true);
  w.day += 2;
  dailyDecrees(w);
  assert.equal(w.events.filter((e) => e.kind === 'decree' && e.data?.lapsed === true).length, 0,
    'relief is a payment, not a state of affairs');
});
