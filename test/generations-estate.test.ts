import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import type { Citizen, PropertyUnit, World } from '../src/types.ts';
import { generationsSettings, generationsState, willOf } from '../src/generations/state.ts';
import {
  FLOOR_SHARE, WILL_FEE, defaultDivision, dutyExemption, dutyOn, floorHeirs, normaliseShares,
  revokeWill, siblingsOf, writeWill,
} from '../src/generations/wills.ts';
import { foundingSettings } from '../src/generations/state.ts';
import {
  EXECUTOR_DAYS, dailyEstates, estateDebts, estateFor, estateUnits, holdReading, liquidateEstate,
  openEstate, settleEstate,
} from '../src/generations/estate.ts';
import { conveyToHouse } from '../src/generations/entail.ts';
import { foundHouse, houseOfName } from '../src/generations/houses.ts';

function unitFor(world: World, owner: Citizen, rent = 20): PropertyUnit {
  const id = `y_${Object.keys(world.property).length + 1}`;
  const u: PropertyUnit = {
    id, kind: 'home', tier: 1, buildingId: 'lantern_lofts', ownerId: owner.id, tenantId: null, rent,
  };
  world.property[id] = u;
  owner.ownedUnits.push(id);
  return u;
}

function partnered(world: World, aWallet = 1000): { a: Citizen; b: Citizen } {
  const a = makeCitizen(world, { familyName: 'Ashgrove', wallet: aWallet });
  const b = makeCitizen(world, { familyName: 'Ashgrove', wallet: 0 });
  a.family.partnerId = b.id;
  b.family.partnerId = a.id;
  a.family.married = true;
  b.family.married = true;
  return { a, b };
}

function childOf(world: World, parent: Citizen, stage: 'child' | 'adult' = 'adult'): Citizen {
  const kid = makeCitizen(world, { familyName: parent.familyName, wallet: 0, lifeStage: stage });
  parent.family.children.push(kid.id);
  kid.family.parents.push(parent.id);
  return kid;
}

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

test('a will is filed for a fee, is public the day it is filed, and may be refiled', () => {
  const w = makeWorld();
  const { a } = partnered(w);
  const heir = childOf(w, a);
  const before = totalMoney(w);

  const result = writeWill(w, a.id, { shares: { [heir.id]: 60 }, residue: 'chest' });
  assert.equal(result.ok, true, result.message);
  assert.equal(a.wallet, 1000 - WILL_FEE);
  assert.equal(totalMoney(w), before, 'the filing fee is a transfer');

  const will = willOf(w, a.id);
  assert.ok(will);
  assert.equal(will.shares[0].to, heir.id);
  assert.equal(will.residue, 'chest');
  // Public the day it is filed: the heir has read it while the testator lives.
  assert.ok(heir.memory.some((m) => m.text.includes('60%')), 'the heir reads it while the testator lives');
  assert.ok(w.events.some((e) => e.text.includes('filed a will')));

  writeWill(w, a.id, { shares: { [heir.id]: 10 } });
  assert.equal(willOf(w, a.id)?.shares[0].percent, 10, 'the last filing stands');
  assert.equal(revokeWill(w, a.id).ok, true);
  assert.equal(willOf(w, a.id), null);
  assert.equal(revokeWill(w, a.id).ok, false);
});

test('shares are read as proportions, and a division of more than the estate is scaled back', () => {
  assert.deepEqual(normaliseShares({ c_1: 50, c_2: 50 }), [{ to: 'c_1', percent: 50 }, { to: 'c_2', percent: 50 }]);
  assert.deepEqual(normaliseShares([{ to: 'c_1', percent: 25 }]), [{ to: 'c_1', percent: 25 }]);
  const scaled = normaliseShares({ c_1: 150, c_2: 50 });
  assert.equal(scaled[0].percent, 75);
  assert.equal(scaled[1].percent, 25);
  assert.deepEqual(normaliseShares(null), []);
  assert.deepEqual(normaliseShares({ c_1: -5 }), []);
});

// ---------------------------------------------------------------------------
// The default division
// ---------------------------------------------------------------------------

test('the default division follows the city\'s table, down to the Chest', () => {
  const w = makeWorld();
  const { a, b } = partnered(w);
  const kid1 = childOf(w, a);
  const kid2 = childOf(w, a);
  const withBoth = defaultDivision(w, a);
  assert.equal(withBoth.find((r) => r.to === b.id)?.percent, 50, 'half to the partner');
  assert.equal(withBoth.find((r) => r.to === kid1.id)?.percent, 25);
  assert.equal(withBoth.find((r) => r.to === kid2.id)?.percent, 25);

  a.family.children = [];
  assert.deepEqual(defaultDivision(w, a), [{ to: b.id, percent: 100 }], 'all to the partner');

  a.family.partnerId = null;
  a.family.children = [kid1.id];
  assert.deepEqual(defaultDivision(w, a), [{ to: kid1.id, percent: 100 }], 'equally among the children');

  const alone = makeCitizen(w, { familyName: 'Vell' });
  const parent = makeCitizen(w, { familyName: 'Vell' });
  const sibling = makeCitizen(w, { familyName: 'Vell' });
  alone.family.parents = [parent.id];
  parent.family.children = [alone.id, sibling.id];
  sibling.family.parents = [parent.id];
  assert.equal(siblingsOf(w, alone)[0].id, sibling.id);
  const upward = defaultDivision(w, alone);
  assert.equal(upward.length, 2, 'equally among parents and siblings');

  const orphan = makeCitizen(w, { familyName: 'Nobody' });
  assert.deepEqual(defaultDivision(w, orphan), [{ to: 'chest', percent: 100 }], 'no family at all: the Chest');
});

// ---------------------------------------------------------------------------
// The duty
// ---------------------------------------------------------------------------

test('the duty is a rate on what stands above a season\'s wages', () => {
  const w = makeWorld();
  const s = generationsSettings(w);
  assert.equal(s.estateDuty, 0.1, 'the founding rate');
  assert.equal(dutyExemption(w), foundingSettings().exemptionWages * w.government.minWage);
  assert.equal(dutyOn(w, dutyExemption(w)), 0, 'a modest life passes untaxed');
  assert.equal(dutyOn(w, dutyExemption(w) + 1000), 100);
  s.estateDuty = 0.4;
  assert.equal(dutyOn(w, dutyExemption(w) + 1000), 400);
});

// ---------------------------------------------------------------------------
// Opening and settling
// ---------------------------------------------------------------------------

test('an estate settles debts, then the duty, then the shares, and conserves the supply', () => {
  const w = makeWorld();
  w.government.minWage = 0;                   // no exemption, so the arithmetic is plain
  const { a, b } = partnered(w, 1000);
  a.finesOwed = 100;
  a.finesOwedSinceDay = 0;
  const before = totalMoney(w);
  const treasuryBefore = w.treasury.balance;

  const estate = openEstate(w, a.id, 'sunset');
  assert.ok(estate);
  assert.equal(estate.status, 'settled', 'an estate of pure cash settles at once');
  assert.equal(estate.debts, 100);
  assert.equal(estate.duty, 90, '10% of the 900 that was left after the debt');
  assert.equal(w.treasury.balance, treasuryBefore + 190);
  assert.equal(b.wallet, 810, 'all to the partner');
  assert.equal(a.wallet, 0);
  assert.equal(totalMoney(w), before, 'an estate moves lumens and makes none');
  assert.equal(a.finesOwed, 0);
});

test('an exile leaves no estate, and an estate opens once', () => {
  const w = makeWorld();
  const { a } = partnered(w);
  a.standing = 'exiled';
  assert.equal(openEstate(w, a.id, 'emigration'), null);
  a.standing = 'good';
  const first = openEstate(w, a.id, 'sunset');
  assert.equal(openEstate(w, a.id, 'sunset'), first, 'the same estate, not a second one');
});

test('a will is honoured, and the residue follows it', () => {
  const w = makeWorld();
  w.government.minWage = 0;
  generationsSettings(w).estateDuty = 0;
  const a = makeCitizen(w, { familyName: 'Ashgrove', wallet: 1000 });
  const friend = makeCitizen(w, { familyName: 'Vell', wallet: 0 });
  const other = makeCitizen(w, { familyName: 'Kest', wallet: 0 });
  writeWill(w, a.id, { shares: { [friend.id]: 70 }, residue: other.id, executor: friend.id });
  const purse = a.wallet;

  openEstate(w, a.id, 'sunset');
  assert.equal(friend.wallet, Math.floor(purse * 0.7));
  assert.equal(other.wallet, purse - Math.floor(purse * 0.7));
  assert.equal(a.wallet, 0);
});

test('the floor holds: a partner and an under-age child cannot be written out', () => {
  const w = makeWorld();
  w.government.minWage = 0;
  generationsSettings(w).estateDuty = 0;
  const { a, b } = partnered(w, 1000);
  const kid = childOf(w, a, 'child');
  const stranger = makeCitizen(w, { familyName: 'Vell', wallet: 0 });
  assert.deepEqual(floorHeirs(w, a).map((h) => h.id).sort(), [b.id, kid.id].sort());

  writeWill(w, a.id, { shares: { [stranger.id]: 100 } });
  const purse = a.wallet;
  openEstate(w, a.id, 'sunset');

  assert.ok(b.wallet >= Math.floor(purse * FLOOR_SHARE), 'the partner takes at least a tenth');
  assert.ok(kid.wallet >= Math.floor(purse * FLOOR_SHARE), 'and so does the under-age child');
  assert.equal(stranger.wallet, purse - b.wallet - kid.wallet, 'the rest is the testator\'s to give');
  assert.ok(stranger.wallet > 0, 'and above the floor a testator may disinherit anyone');
});

test('an adult child has no floor: above it a testator may disinherit anyone', () => {
  const w = makeWorld();
  w.government.minWage = 0;
  generationsSettings(w).estateDuty = 0;
  const a = makeCitizen(w, { familyName: 'Ashgrove', wallet: 500 });
  const grown = childOf(w, a, 'adult');
  const stranger = makeCitizen(w, { familyName: 'Vell', wallet: 0 });
  writeWill(w, a.id, { shares: { [stranger.id]: 100 } });
  openEstate(w, a.id, 'sunset');
  assert.equal(grown.wallet, 0);
  assert.ok(stranger.wallet > 0);
});

test('an estate with no family at all goes to the Community Chest', () => {
  const w = makeWorld();
  w.government.minWage = 0;
  generationsSettings(w).estateDuty = 0;
  const alone = makeCitizen(w, { familyName: 'Nobody', wallet: 300 });
  const before = totalMoney(w);
  const chest = w.treasury.chest;
  openEstate(w, alone.id, 'emigration');
  // Less the Exchange's 2 %: there was no heir to execute it.
  assert.equal(w.treasury.chest, chest + 294);
  assert.equal(totalMoney(w), before);
});

test('an estate that is land and no cash waits for the executor, then the Exchange sells it', () => {
  const w = makeWorld();
  w.government.minWage = 0;
  const { a, b } = partnered(w, 0);
  const u = unitFor(w, a, 30);
  const before = totalMoney(w);

  const estate = openEstate(w, a.id, 'sunset');
  assert.ok(estate);
  assert.equal(estate.status, 'open', 'nothing is divided while the estate is land');
  assert.equal(estate.units.length, 1);
  assert.equal(estate.sellByDay, w.day + EXECUTOR_DAYS);
  assert.ok(estate.gross > 0);
  assert.equal(b.wallet, 0);

  // The days pass; on the last of them the Exchange liquidates and settles.
  w.day = estate.sellByDay;
  dailyEstates(w);
  assert.equal(estate.status, 'settled');
  assert.equal(u.ownerId, 'city');
  assert.equal(a.ownedUnits.length, 0);
  assert.ok(b.wallet > 0, 'the partner takes what the land fetched, less the duty');
  assert.equal(totalMoney(w), before, 'a liquidation is a transfer');
  assert.ok(estate.read, 'and the will was read');
});

test('an executor who sells the land themselves closes the estate early', () => {
  const w = makeWorld();
  w.government.minWage = 0;
  const { a, b } = partnered(w, 0);
  const u = unitFor(w, a, 30);
  const estate = openEstate(w, a.id, 'sunset');
  assert.ok(estate);
  assert.equal(estate.executorId, b.id, 'the eldest living adult heir, with no executor named');

  // The executor found a buyer: the deed left the estate, and the purse holds
  // what it fetched.
  u.ownerId = 'city';
  a.ownedUnits = [];
  a.wallet = 400;
  w.day += 1;
  dailyEstates(w);
  assert.equal(estate.status, 'settled');
  assert.ok(b.wallet > 0);
});

test('entailed land is no part of a member\'s estate and pays no duty', () => {
  const w = makeWorld();
  w.government.minWage = 0;
  const members = Array.from({ length: 3 }, () => makeCitizen(w, { familyName: 'Ashgrove', wallet: 600 }));
  foundHouse(w, members[0].id, 'Ashgrove', 'eldest');
  const house = houseOfName(w, 'Ashgrove');
  assert.ok(house);
  const u = unitFor(w, members[0], 30);
  conveyToHouse(w, members[0].id, u.id);

  assert.deepEqual(estateUnits(w, members[0]), [], 'the entail is not in the estate');
  const estate = openEstate(w, members[0].id, 'sunset');
  assert.ok(estate);
  assert.equal(estate.units.length, 0);
  assert.equal(u.ownerId, house.boxId, 'and the house still holds it');
});

test('the reading is held the morning after, and prints the shares', () => {
  const w = makeWorld();
  w.government.minWage = 0;
  const { a, b } = partnered(w, 400);
  const estate = openEstate(w, a.id, 'sunset');
  assert.ok(estate);
  assert.equal(estate.read, false, 'nothing is read the day it opens');
  w.day += 1;
  dailyEstates(w);
  assert.equal(estate.read, true);
  const printed = w.events.filter((e) => e.text.includes('was read at the Hall of Records'));
  assert.equal(printed.length, 1);
  assert.ok(printed[0].text.includes(b.name));
  holdReading(w, estate);
  assert.equal(w.events.filter((e) => e.text.includes('was read at the Hall of Records')).length, 1, 'and read once');
});

test('a debt the estate cannot cover is settled as far as the purse goes', () => {
  const w = makeWorld();
  w.government.minWage = 0;
  const { a, b } = partnered(w, 50);
  a.finesOwed = 500;
  a.finesOwedSinceDay = 0;
  assert.equal(estateDebts(w, a), 500);
  const before = totalMoney(w);
  openEstate(w, a.id, 'sunset');
  assert.equal(a.finesOwed, 450, 'what the estate could not reach still stands');
  assert.equal(b.wallet, 0);
  assert.equal(totalMoney(w), before);
});

test('the Exchange executes for its fee when there is nobody else to do it', () => {
  const w = makeWorld();
  w.government.minWage = 0;
  generationsSettings(w).estateDuty = 0;
  const alone = makeCitizen(w, { familyName: 'Nobody', wallet: 1000 });
  const treasuryBefore = w.treasury.balance;
  const estate = openEstate(w, alone.id, 'emigration');
  assert.ok(estate);
  assert.equal(estate.exchangeExecuted, true);
  assert.equal(w.treasury.balance, treasuryBefore + 20, 'two per cent, and the rest to the Chest');
  assert.equal(w.treasury.chest, 980);
});

test('settling twice pays nothing twice', () => {
  const w = makeWorld();
  w.government.minWage = 0;
  const { a, b } = partnered(w, 500);
  const estate = openEstate(w, a.id, 'sunset');
  assert.ok(estate);
  const paid = b.wallet;
  settleEstate(w, estate);
  assert.equal(b.wallet, paid);
  assert.equal(estateFor(w, a.id)?.status, 'settled');
});

test('liquidation never fetches the whole price, and never mints', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { familyName: 'Ashgrove', wallet: 0 });
  const u = unitFor(w, a, 40);
  const estate = openEstate(w, a.id, 'sunset');
  assert.ok(estate);
  const before = totalMoney(w);
  const got = liquidateEstate(w, estate);
  assert.ok(got > 0);
  assert.equal(totalMoney(w), before);
  assert.equal(u.ownerId, 'city');
  assert.equal(generationsState(w).estates[estate.id].units.length, 0);
});
