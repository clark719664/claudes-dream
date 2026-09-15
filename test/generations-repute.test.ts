import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld } from './helpers.ts';
import type { Citizen, World } from '../src/types.ts';
import { contributionLedger } from '../src/standing/state.ts';
import { computeRepute, dailyRepute, reputeOf } from '../src/standing/repute.ts';
import { generationsState, officesOf, stainsOf } from '../src/generations/state.ts';
import {
  GENERATION_DECAY, HERITAGE_CAP, HOUSE_BASELINE, OFFICE_WEIGHTS, RELAXATION, STAIN_CIVIC,
  STAIN_CUSTODIAL, STAIN_DECAY, STAIN_GRAVEST, accrueOffices, accrueStains, dailyHouseRepute,
  departedMembers, generationsBack, heritageOf, houseNames, houseReputeOf, houseTarget,
  livingAdults, meanLivingRepute, noteOffice, stainBase, stainOf,
} from '../src/generations/repute.ts';

function ashgrove(world: World, over: Partial<Citizen> = {}): Citizen {
  return makeCitizen(world, { familyName: 'Ashgrove', ...over });
}

/** Take a citizen out of the turn order: they left the city, and the tree keeps them. */
function depart(world: World, c: Citizen): void {
  world.order = world.order.filter((id) => id !== c.id);
}

test('a name nobody has heard of sits at the average, and every new name starts there', () => {
  const w = makeWorld();
  ashgrove(w);
  assert.equal(houseReputeOf(w, 'Ashgrove'), HOUSE_BASELINE);
  assert.equal(houseReputeOf(w, 'a name that does not exist'), HOUSE_BASELINE);
  assert.equal(houseReputeOf(w, ''), HOUSE_BASELINE);
});

test('only names with a living adult member carry a figure', () => {
  const w = makeWorld();
  const adult = ashgrove(w);
  makeCitizen(w, { familyName: 'Vell', lifeStage: 'child' });
  const gone = makeCitizen(w, { familyName: 'Marrow' });
  depart(w, gone);
  const exiled = makeCitizen(w, { familyName: 'Kest', standing: 'exiled' });
  assert.equal(exiled.familyName, 'Kest');

  const names = houseNames(w);
  assert.deepEqual(names, ['Ashgrove']);
  assert.equal(livingAdults(w, 'Ashgrove')[0].id, adult.id);
  assert.equal(livingAdults(w, 'Vell').length, 0, 'a child is of the name but is not an adult of it');
});

test('the living carry half the weight, and the morning relaxes 15% of the way there', () => {
  const w = makeWorld();
  const a = ashgrove(w, { reputation: 100 });
  const b = ashgrove(w, { reputation: 100 });
  dailyRepute(w);
  const mean = (reputeOf(w, a.id) + reputeOf(w, b.id)) / 2;
  assert.equal(Math.round(meanLivingRepute(w, 'Ashgrove')), Math.round(mean));

  const target = houseTarget(w, 'Ashgrove');
  assert.equal(target.target, Math.round(HOUSE_BASELINE + 0.5 * (mean - HOUSE_BASELINE)));
  dailyHouseRepute(w);
  const expected = HOUSE_BASELINE + RELAXATION * (target.target - HOUSE_BASELINE);
  assert.equal(houseReputeOf(w, 'Ashgrove'), Math.round(expected));

  // A fortnight of the same morning walks it most of the way, and never past it.
  for (let d = 0; d < 14; d++) {
    w.day += 1;
    dailyRepute(w);
    dailyHouseRepute(w);
  }
  const settled = houseReputeOf(w, 'Ashgrove');
  assert.ok(settled > expected, 'the figure keeps moving toward the target');
  assert.ok(settled <= houseTarget(w, 'Ashgrove').target, 'and never overshoots it');
});

test('heritage is a decaying echo of the dead, capped at a quarter of the scale', () => {
  const w = makeWorld();
  const child = ashgrove(w);
  const parent = ashgrove(w);
  const grandparent = ashgrove(w);
  parent.family.children = [child.id];
  child.family.parents = [parent.id];
  grandparent.family.children = [parent.id];
  parent.family.parents = [grandparent.id];
  depart(w, parent);
  depart(w, grandparent);

  contributionLedger(w, parent.id).councilCycles = 4;      // 60
  contributionLedger(w, grandparent.id).councilCycles = 4; // 60
  assert.equal(departedMembers(w, 'Ashgrove').length, 2);
  assert.equal(generationsBack(w, parent, 'Ashgrove'), 1);
  assert.equal(generationsBack(w, grandparent, 'Ashgrove'), 2);

  const worth = 60 * GENERATION_DECAY + 60 * GENERATION_DECAY ** 2;
  assert.equal(Math.round(heritageOf(w, 'Ashgrove')), Math.round(worth));

  // Nothing about it is a floor: it is capped, and the cap really binds.
  for (let i = 0; i < 12; i++) {
    const forebear = ashgrove(w);
    forebear.family.children = [child.id];
    child.family.parents.push(forebear.id);
    depart(w, forebear);
    contributionLedger(w, forebear.id).councilCycles = 9;
  }
  assert.equal(heritageOf(w, 'Ashgrove'), HERITAGE_CAP);
});

test('an exile leaves no heritage, and a living member is counted as living', () => {
  const w = makeWorld();
  ashgrove(w);
  const exiled = ashgrove(w, { standing: 'exiled' });
  depart(w, exiled);
  contributionLedger(w, exiled.id).mayorCycles = 5;
  assert.equal(departedMembers(w, 'Ashgrove').length, 0);
  assert.equal(heritageOf(w, 'Ashgrove'), 0);
});

test('offices count once a cycle and halve every four cycles', () => {
  const w = makeWorld();
  const councillor = ashgrove(w);
  w.government.council = [councillor.id];
  w.government.cycle = 1;

  accrueOffices(w);
  accrueOffices(w);        // the same morning twice
  w.day += 1;
  accrueOffices(w);        // and the next morning
  assert.equal(officesOf(w, 'Ashgrove').length, 1, 'a cycle in an office counts once');
  assert.equal(Math.round(heritageOf(w, 'Ashgrove')), OFFICE_WEIGHTS.council);

  w.government.cycle = 5;  // four cycles on
  assert.equal(Math.round(heritageOf(w, 'Ashgrove')), Math.round(OFFICE_WEIGHTS.council / 2));

  noteOffice(w, councillor.id, 'mayor');
  assert.equal(officesOf(w, 'Ashgrove').length, 2);
});

test('a stain is 15, 40 or 120, and a conviction under severity 3 leaves none', () => {
  assert.equal(stainBase({ caseId: 'k_1', law: 'L06', severity: 3, tier: 2, day: 1 }), STAIN_CIVIC);
  assert.equal(stainBase({ caseId: 'k_2', law: 'L04', severity: 2, tier: 2, day: 1 }), 0);
  assert.equal(stainBase({ caseId: 'k_3', law: 'P03', severity: 3, tier: null, day: 1 }), STAIN_CUSTODIAL);
  assert.equal(stainBase({ caseId: 'k_4', law: 'P09', severity: 5, tier: null, day: 1 }), STAIN_GRAVEST);
});

test('a family is slower to live a thing down: 1% a clean day, and a conviction stops the clock', () => {
  const w = makeWorld();
  const c = ashgrove(w);
  w.day = 10;
  c.record.convictions.push({ caseId: 'k_9', law: 'L06', severity: 3, tier: 3, day: 10 });
  accrueStains(w, 'Ashgrove');
  assert.equal(stainsOf(w, 'Ashgrove').length, 1);
  assert.equal(Math.round(stainOf(w, 'Ashgrove')), STAIN_CIVIC);

  // The day after the conviction is not itself a clean day: yesterday had one.
  for (let d = 0; d < 10; d++) {
    w.day += 1;
    accrueStains(w, 'Ashgrove');
  }
  assert.equal(stainsOf(w, 'Ashgrove')[0].cleanDays, 9);
  assert.equal(stainOf(w, 'Ashgrove').toFixed(4), (STAIN_CIVIC * (1 - STAIN_DECAY) ** 9).toFixed(4));

  // A day on which any member is convicted of anything is not a clean day,
  // however small the offence.
  const kin = ashgrove(w);
  kin.record.convictions.push({ caseId: 'k_10', law: 'L01', severity: 1, tier: 1, day: w.day });
  accrueStains(w, 'Ashgrove');
  assert.equal(stainsOf(w, 'Ashgrove')[0].cleanDays, 9, 'no decay on a day with a conviction');
  assert.equal(stainsOf(w, 'Ashgrove').length, 1, 'and a severity-1 conviction stains nothing');
});

test('a conviction an appeal struck off takes its stain with it', () => {
  const w = makeWorld();
  const c = ashgrove(w);
  c.record.convictions.push({ caseId: 'k_11', law: 'P03', severity: 3, tier: null, day: 0 });
  accrueStains(w, 'Ashgrove');
  assert.equal(Math.round(stainOf(w, 'Ashgrove')), STAIN_CUSTODIAL);
  c.record.convictions = [];
  accrueStains(w, 'Ashgrove');
  assert.equal(stainOf(w, 'Ashgrove'), 0);
});

test('the stain pulls the name down and the figure comes back when it decays', () => {
  const w = makeWorld();
  const a = ashgrove(w);
  ashgrove(w);
  a.record.convictions.push({ caseId: 'k_12', law: 'P08', severity: 5, tier: null, day: 0 });
  dailyRepute(w);
  dailyHouseRepute(w);
  const target = houseTarget(w, 'Ashgrove');
  assert.ok(target.stain >= STAIN_GRAVEST - 1, 'the gravest convictions cost the name 120');
  assert.ok(target.target < HOUSE_BASELINE, 'and pull the name below the average');
});

test('no citizen repute component reads a house: the arrow runs one way only', () => {
  const w = makeWorld();
  const a = ashgrove(w, { reputation: 90 });
  const b = ashgrove(w, { reputation: 10 });
  b.record.convictions.push({ caseId: 'k_13', law: 'P09', severity: 5, tier: null, day: 0 });
  dailyRepute(w);
  const before = computeRepute(w, a);
  for (let d = 0; d < 20; d++) {
    w.day += 1;
    dailyRepute(w);
    dailyHouseRepute(w);
  }
  const house = houseReputeOf(w, 'Ashgrove');
  assert.ok(house < HOUSE_BASELINE, 'the name is ruined by what the other one did');
  assert.equal(computeRepute(w, a), before, 'and the citizen\'s own score does not move a point for it');
});

test('the heir of a great house comes of age at the same baseline as anybody else', () => {
  const w = makeWorld();
  // A house four generations deep, with everything heritage can hold.
  const forebears = Array.from({ length: 4 }, () => ashgrove(w));
  for (const f of forebears) {
    depart(w, f);
    contributionLedger(w, f.id).mayorCycles = 6;
  }
  ashgrove(w);
  for (let d = 0; d < 30; d++) {
    w.day += 1;
    dailyRepute(w);
    dailyHouseRepute(w);
  }
  assert.ok(houseReputeOf(w, 'Ashgrove') > HOUSE_BASELINE, 'the name is worth something');

  const heir = ashgrove(w);
  const arrival = makeCitizen(w, { familyName: 'Nobody' });
  dailyRepute(w);
  assert.equal(computeRepute(w, heir), computeRepute(w, arrival),
    'the same conduct is the same repute, whatever name it carries');
  assert.equal(contributionLedger(w, heir.id).councilCycles, 0, 'and contribution starts empty');
});

test('the register survives a save: the whole of it is plain data', () => {
  const w = makeWorld();
  ashgrove(w);
  dailyHouseRepute(w);
  const copy = JSON.parse(JSON.stringify(generationsState(w)));
  assert.equal(typeof copy.repute.Ashgrove, 'number');
  assert.deepEqual(Object.keys(copy).sort(), [
    'cycleRepute', 'estates', 'headVotes', 'houses', 'lastConvictionDay', 'ledgerCycle', 'letters',
    'matches', 'motions', 'next', 'officesDay', 'offices', 'pledges', 'repute', 'settings', 'stains', 'wills',
  ].sort());
});
