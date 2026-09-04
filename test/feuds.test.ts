/**
 * Feuds (src/social/feuds.ts).
 *
 * Three hostile acts in a cycle put two families at war; a bond that crosses
 * the line is pressed to the floor every morning; and the only ways out are an
 * apology in the Plaza or a wedding.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CitizenId, World } from '../src/types.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import {
  APOLOGY_BOND, APOLOGY_REPUTATION, FEUD_BOND_FLOOR, FEUD_INCIDENTS,
  apologize, applyFeudFloor, dailyFeuds, feudBetween, feudsOf, inFeud, incidentTally,
  noteHostility, reconcileByMarriage,
} from '../src/social/feuds.ts';

function bond(world: World, a: CitizenId, b: CitizenId): number {
  return world.citizens[a].bonds[b] ?? 0;
}

function setBond(world: World, a: CitizenId, b: CitizenId, v: number): void {
  world.citizens[a].bonds[b] = v;
  world.citizens[b].bonds[a] = v;
}

/** Two adults of two families, both standing in the Commons (where the Plaza is). */
function twoFamilies(world: World): [CitizenId, CitizenId] {
  const a = makeCitizen(world, { name: 'Ondine', familyName: 'Ashgrove' });
  const b = makeCitizen(world, { name: 'Bram', familyName: 'Corvane' });
  return [a.id, b.id];
}

// ------------------------------------------------------------------- opening

test('three hostile acts in a cycle open a feud; two do not', () => {
  const w = makeWorld();
  const [a, b] = twoFamilies(w);
  noteHostility(w, a, b);
  noteHostility(w, b, a);
  assert.equal(incidentTally(w, 'Ashgrove', 'Corvane'), 2);
  assert.equal(feudBetween(w, 'Ashgrove', 'Corvane'), null);
  noteHostility(w, a, b);
  const feud = feudBetween(w, 'Corvane', 'Ashgrove');
  assert.ok(feud, 'the third opened it, whichever way round the names come');
  assert.equal(feud.incidents, FEUD_INCIDENTS);
  assert.equal(feud.sinceDay, w.day);
  assert.equal(feud.endedDay, null);
  assert.equal(incidentTally(w, 'Ashgrove', 'Corvane'), 0, 'the tally moves into the feud');
  assert.equal(inFeud(w, a, b), true);
  assert.ok(w.events.some((e) => e.kind === 'feud'));
  assert.ok(w.citizens[a].memory.some((m) => m.text.includes('feud')));
});

test('a further act inside a live feud deepens it rather than opening another', () => {
  const w = makeWorld();
  const [a, b] = twoFamilies(w);
  for (let i = 0; i < FEUD_INCIDENTS + 2; i++) noteHostility(w, a, b);
  assert.equal(w.feuds.length, 1);
  assert.equal(w.feuds[0].incidents, FEUD_INCIDENTS + 2);
});

test('two citizens of one family never feud, and children are never counted', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { familyName: 'Ashgrove' });
  const b = makeCitizen(w, { familyName: 'Ashgrove' });
  const child = makeCitizen(w, { familyName: 'Corvane', lifeStage: 'child' });
  for (let i = 0; i < 5; i++) {
    noteHostility(w, a, b);
    noteHostility(w, a, child.id);
    noteHostility(w, child.id, a);
  }
  assert.equal(w.feuds.length, 0);
  assert.equal(inFeud(w, a, child.id), false);
});

test('hostility toward an exile, a stranger or oneself counts for nothing', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { familyName: 'Ashgrove' });
  const exile = makeCitizen(w, { familyName: 'Corvane', standing: 'exiled' });
  for (let i = 0; i < 5; i++) {
    noteHostility(w, a, exile.id);
    noteHostility(w, a, 'c_nobody');
    noteHostility(w, a, a);
  }
  assert.equal(w.feuds.length, 0);
});

// ------------------------------------------------------------------ the floor

test('the floor lowers a bond that crosses a feud, and never raises one', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { familyName: 'Ashgrove' });
  const b = makeCitizen(w, { familyName: 'Corvane' });
  const c = makeCitizen(w, { familyName: 'Corvane' });
  const friend = makeCitizen(w, { familyName: 'Ashgrove' });
  setBond(w, a, b, 70);
  setBond(w, a, c, -80);
  setBond(w, a, friend, 90);
  for (let i = 0; i < FEUD_INCIDENTS; i++) noteHostility(w, a, b);

  applyFeudFloor(w);
  assert.equal(bond(w, a, b), FEUD_BOND_FLOOR, 'a warm bond is pressed down');
  assert.equal(bond(w, b, a), FEUD_BOND_FLOOR);
  assert.equal(bond(w, a, c), -80, 'a colder bond is left where it is');
  assert.equal(bond(w, a, friend), 90, 'inside a family nothing changes');
  applyFeudFloor(w);
  assert.equal(bond(w, a, b), FEUD_BOND_FLOOR, 'applying it twice changes nothing');
});

test('the floor stops the day the feud ends', () => {
  const w = makeWorld();
  const [a, b] = twoFamilies(w);
  for (let i = 0; i < FEUD_INCIDENTS; i++) noteHostility(w, a, b);
  const feud = feudBetween(w, 'Ashgrove', 'Corvane');
  assert.ok(feud);
  feud.endedDay = w.day;
  setBond(w, a, b, 50);
  applyFeudFloor(w);
  assert.equal(bond(w, a, b), 50);
});

// ---------------------------------------------------------------- apologising

test('an apology at the Plaza strikes one incident; elsewhere it is refused', () => {
  const w = makeWorld();
  const [a, b] = twoFamilies(w);
  for (let i = 0; i < FEUD_INCIDENTS; i++) noteHostility(w, a, b);
  setBond(w, a, b, 0);
  const before = w.citizens[a].reputation;

  w.citizens[a].district = 'nightglass';
  const away = apologize(w, a, b);
  assert.equal(away.ok, false);
  assert.match(away.message, /Plaza/);
  assert.equal(feudBetween(w, 'Ashgrove', 'Corvane')?.incidents, FEUD_INCIDENTS);

  w.citizens[a].district = 'commons';
  const said = apologize(w, a, b);
  assert.equal(said.ok, true);
  assert.equal(feudBetween(w, 'Ashgrove', 'Corvane')?.incidents, FEUD_INCIDENTS - 1);
  assert.equal(bond(w, a, b), APOLOGY_BOND);
  assert.equal(bond(w, b, a), APOLOGY_BOND);
  assert.equal(w.citizens[a].reputation, before + APOLOGY_REPUTATION);
  assert.ok(w.citizens[b].memory.some((m) => m.text.includes('apologised')));

  const twice = apologize(w, a, b);
  assert.equal(twice.ok, false, 'one apology a day');
  assert.equal(feudBetween(w, 'Ashgrove', 'Corvane')?.incidents, FEUD_INCIDENTS - 1);
});

test('striking the last incident ends the feud', () => {
  const w = makeWorld();
  const [a, b] = twoFamilies(w);
  for (let i = 0; i < FEUD_INCIDENTS; i++) noteHostility(w, a, b);
  for (let day = 0; day < FEUD_INCIDENTS; day++) {
    w.day = day;
    const r = apologize(w, a, b);
    assert.equal(r.ok, true, `apology ${day + 1} was accepted`);
  }
  assert.equal(feudBetween(w, 'Ashgrove', 'Corvane'), null);
  assert.equal(w.feuds[0].endedDay, FEUD_INCIDENTS - 1);
  assert.equal(inFeud(w, a, b), false);
  assert.ok(w.events.some((e) => e.kind === 'feud' && e.text.includes('over')));
});

test('an apology with no feud, to your own family, or to a stranger is refused', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { familyName: 'Ashgrove' });
  const kin = makeCitizen(w, { familyName: 'Ashgrove' });
  const other = makeCitizen(w, { familyName: 'Corvane' });
  assert.equal(apologize(w, a, other.id).ok, false);
  assert.equal(apologize(w, a, kin.id).ok, false);
  assert.equal(apologize(w, a, 'c_nobody').ok, false);
  assert.equal(apologize(w, 'c_nobody', a).ok, false);
  assert.equal(apologize(w, a, a).ok, false);
});

// ------------------------------------------------------------- reconciliation

test('a marriage across a feud ends it', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { familyName: 'Ashgrove' });
  const b = makeCitizen(w, { familyName: 'Corvane' });
  const other = makeCitizen(w, { familyName: 'Corvane' });
  for (let i = 0; i < FEUD_INCIDENTS; i++) noteHostility(w, a, other.id);
  assert.ok(feudBetween(w, 'Ashgrove', 'Corvane'));
  reconcileByMarriage(w, a, b);
  assert.equal(feudBetween(w, 'Ashgrove', 'Corvane'), null);
  assert.ok(w.events.some((e) => e.kind === 'feud' && e.text.includes('married')));
});

test('a marriage still ends the feud when the couple have already taken one name', () => {
  const w = makeWorld();
  const parentA = makeCitizen(w, { familyName: 'Ashgrove' });
  const parentB = makeCitizen(w, { familyName: 'Corvane' });
  const child = makeCitizen(w, { familyName: 'Corvane' });
  child.family.parents = [parentB.id];
  for (let i = 0; i < FEUD_INCIDENTS; i++) noteHostility(w, parentA, parentB);
  // The wedding merged the names before the hook ran.
  child.familyName = 'Ashgrove';
  child.family.familyName = 'Ashgrove';
  reconcileByMarriage(w, parentA, child.id);
  assert.equal(feudBetween(w, 'Ashgrove', 'Corvane'), null);
});

test('a marriage inside one family, or where there is no feud, changes nothing', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { familyName: 'Ashgrove' });
  const b = makeCitizen(w, { familyName: 'Ashgrove' });
  assert.doesNotThrow(() => reconcileByMarriage(w, a, b));
  assert.doesNotThrow(() => reconcileByMarriage(w, a, 'c_nobody'));
  assert.equal(w.feuds.length, 0);
});

// -------------------------------------------------------------- the daily pass

test('incidents that never became a feud lapse after a cycle', () => {
  const w = makeWorld();
  const [a, b] = twoFamilies(w);
  noteHostility(w, a, b);
  noteHostility(w, a, b);
  w.day = w.config.cycleDays + 1;
  dailyFeuds(w);
  assert.equal(incidentTally(w, 'Ashgrove', 'Corvane'), 0);
  noteHostility(w, a, b);
  assert.equal(w.feuds.length, 0, 'the old two no longer count toward a feud');
  assert.equal(incidentTally(w, 'Ashgrove', 'Corvane'), 1);
});

test('a feud with nobody left on one side closes itself', () => {
  const w = makeWorld();
  const [a, b] = twoFamilies(w);
  for (let i = 0; i < FEUD_INCIDENTS; i++) noteHostility(w, a, b);
  w.citizens[b].standing = 'exiled';
  w.day = 1;
  dailyFeuds(w);
  assert.equal(feudBetween(w, 'Ashgrove', 'Corvane'), null);
  assert.equal(w.feuds[0].endedDay, 1);
});

test('the daily pass applies the floor and survives an empty city', () => {
  const w = makeWorld();
  assert.doesNotThrow(() => dailyFeuds(w));
  const [a, b] = twoFamilies(w);
  for (let i = 0; i < FEUD_INCIDENTS; i++) noteHostility(w, a, b);
  setBond(w, a, b, 80);
  dailyFeuds(w);
  assert.equal(bond(w, a, b), FEUD_BOND_FLOOR);
});

test('a citizen reads the feuds their own family is in', () => {
  const w = makeWorld();
  const [a, b] = twoFamilies(w);
  const bystander = makeCitizen(w, { familyName: 'Dunmore' });
  for (let i = 0; i < FEUD_INCIDENTS; i++) noteHostility(w, a, b);
  assert.equal(feudsOf(w, w.citizens[a]).length, 1);
  assert.equal(feudsOf(w, w.citizens[b]).length, 1);
  assert.equal(feudsOf(w, bystander).length, 0);
  assert.equal(feudBetween(w, 'Ashgrove', 'Ashgrove'), null);
});
