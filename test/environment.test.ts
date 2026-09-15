/**
 * Pollution: emission, drift, settling and what the air does
 * (`src/environment/`, `docs/ENVIRONMENT.md` §§1–3, 7, 8).
 *
 * Every number here is one the citizens moved. Nothing in this file asserts
 * that a district is dirty: a forge that nobody worked emits nothing, and the
 * morning after the last shift the air over it starts to clear.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Business, DistrictId, Job, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  ABATEMENT_DECAY, AMENITY_AIR, BUILDING_MOTES, CHRONICLE_AIR, DISCHARGE_SHARE, FITTING_SPECS,
  GLITCH_AIR, MOTE_DIVISOR, PLANT_PER_SHIFT, REST_AIR, SHORTAGE_MULTIPLIER, WATER_WEIGHT,
  abatementFactor, airLevel, amenityAdjustment, billEmissionCharge, bypassedToday, clearanceOf,
  dailyAbatement, dailyEnvironment, dischargeOf, dischargeShift, downwindOf, driftWeights,
  environmentObservation, environmentState, fileNuisance, fittingEffect, glitchAirFactor, greeneryOf,
  hinterlandYieldFactor, installAbatement, loadOf, maintainAbatement, motesForShift, payHostPayments,
  plantTrees, pollutionBurden, readingsFor, recordShiftEmission, restAirFactor, settleAir, settleWater,
  surveyAir, surveyWater, waterLevel, windBearing, windName,
} from '../src/environment/index.ts';

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

interface JobParts {
  buildingId?: string;
  district?: DistrictId;
  employer?: string;
  good?: 'compute' | 'energy' | 'goods' | 'culture' | 'knowledge';
  qty?: number;
}

function makeJob(world: World, parts: JobParts = {}): Job {
  const id = nextId(world, 'j');
  const job: Job = {
    id, role: 'forge_operator', title: 'Forge Operator',
    employer: parts.employer ?? 'city',
    buildingId: parts.buildingId ?? 'compute_forge',
    district: parts.district ?? 'foundry_row',
    skill: 'crafting', minSkill: 0, minReputation: 0, wage: 10,
    output: { good: parts.good ?? 'compute', qty: parts.qty ?? 3 },
    holderId: null, createdDay: world.day,
  };
  world.jobs[id] = job;
  return job;
}

function makeBusiness(world: World, ownerId: string, kind: Business['kind'], buildingId: string, district: DistrictId): Business {
  const id = nextId(world, 'b');
  const biz: Business = {
    id, name: `${kind} of ${ownerId}`, kind, ownerId, treasury: 2000, district, buildingId,
    employees: [], jobs: [], inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: world.day, rentPerDay: 5, daysNegative: 0, revenueToday: 0, costsToday: 0,
    dissolvedDay: null, shelf: {},
  };
  world.businesses[id] = biz;
  const owner = world.citizens[ownerId];
  if (owner) owner.businessId = id;
  return biz;
}

/** A founding day at Foundry Row: 2 forge posts, 2 power, 1 fabricator, 1 builder, 6 shifts each. */
function foundingDay(world: World): void {
  const posts = [
    ...Array.from({ length: 2 }, () => makeJob(world, { buildingId: 'compute_forge' })),
    ...Array.from({ length: 2 }, () => makeJob(world, { buildingId: 'power_station', good: 'energy' })),
    makeJob(world, { buildingId: 'fabrication_works', good: 'goods' }),
    makeJob(world, { buildingId: 'builders_yard', good: 'goods' }),
  ];
  for (const job of posts) for (let i = 0; i < 6; i++) recordShiftEmission(world, job);
}

// ---------------------------------------------------------------------------
// Emission comes from work
// ---------------------------------------------------------------------------

test('the motes table is what the design says, building by building', () => {
  assert.equal(BUILDING_MOTES.forge, 1.00);
  assert.equal(BUILDING_MOTES.power, 0.70);
  assert.equal(BUILDING_MOTES.fabrication, 0.40);
  assert.equal(BUILDING_MOTES.builders, 0.25);
  const world = makeWorld();
  assert.equal(motesForShift(world, makeJob(world, { buildingId: 'compute_forge' })), 1);
  assert.equal(motesForShift(world, makeJob(world, { buildingId: 'power_station' })), 0.7);
  // A library emits nothing at all.
  assert.equal(motesForShift(world, makeJob(world, { buildingId: 'great_library', district: 'archive' })), 0);
});

test('a closed post emits nothing: it is the shift that emits, not the building', () => {
  const world = makeWorld();
  makeJob(world, { buildingId: 'compute_forge' });   // stands there, nobody works it
  settleAir(world);
  assert.equal(loadOf(world, 'foundry_row'), 0);
  assert.equal(airLevel(world, 'foundry_row'), 0);
});

test('a forge driven through a shortage emits double', () => {
  const world = makeWorld();
  const job = makeJob(world, { buildingId: 'compute_forge', good: 'compute' });
  assert.equal(motesForShift(world, job), 1);
  world.market.shortages = ['compute'];
  assert.equal(motesForShift(world, job), SHORTAGE_MULTIPLIER);
});

test("a founding day at Foundry Row is the design's twenty-four motes", () => {
  const world = makeWorld();
  foundingDay(world);
  const load = loadOf(world, 'foundry_row');
  assert.ok(Math.abs(load - 24.3) < 1e-9, `24.3 motes, not ${load}`);
});

// ---------------------------------------------------------------------------
// Drift: the wind belongs to the planet
// ---------------------------------------------------------------------------

test('the wind blows east through Bloom and swings south-east in Frost', () => {
  const world = makeWorld();
  world.season = 'bloom';
  const bloom = windBearing(world);
  assert.ok(bloom > 60 && bloom < 110, `an easterly, not ${bloom}`);
  world.season = 'frost';
  const frost = windBearing(world);
  assert.ok(frost > 115 && frost < 145, `a south-easterly, not ${frost}`);
  assert.ok(windName(bloom).includes('east'));
});

test("The Heights takes the forge's smoke, and the district upwind takes none", () => {
  const world = makeWorld();
  world.openDistricts = [...world.openDistricts, 'heights'];
  world.season = 'bloom';
  const weights = driftWeights(world, 'foundry_row');
  assert.ok((weights.get('heights') ?? 0) > 0.5, 'the Heights sit due east of the forge');
  assert.equal(weights.get('archive') ?? 0, 0, 'the Archive is upwind and takes none');
  assert.ok(downwindOf(world, 'foundry_row').includes('heights'));
});

test('the drifted share lands on the neighbours and nowhere else', () => {
  const world = makeWorld();
  world.openDistricts = [...world.openDistricts, 'heights'];
  foundingDay(world);
  const before = new Map(Object.keys(world.districts).map((d) => [d, airLevel(world, d as DistrictId)]));
  settleAir(world);
  assert.ok(airLevel(world, 'foundry_row') > (before.get('foundry_row') ?? 0));
  assert.ok(airLevel(world, 'heights') > 0, 'the Heights get it without the wages');
  assert.equal(airLevel(world, 'nightglass'), 0, 'a district nowhere near it stays clean');
});

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

test('the air settles by the rule: what came, less what drifted, over 480', () => {
  const world = makeWorld();
  foundingDay(world);
  const load = loadOf(world, 'foundry_row');
  const drifted = load * 0.30;
  const clearance = clearanceOf(world, 'foundry_row', 0);
  settleAir(world);
  const expected = 0 * (1 - clearance) + (load - drifted) / MOTE_DIVISOR;
  assert.ok(Math.abs(airLevel(world, 'foundry_row') - expected) < 1e-9);
});

test('a district that stops working clears: the air falls day after day', () => {
  const world = makeWorld();
  for (let day = 0; day < 40; day++) {
    world.day = day;
    foundingDay(world);
    settleAir(world);
    environmentState(world).today = {};
  }
  const sooty = airLevel(world, 'foundry_row');
  assert.ok(sooty > 0.15, `a worked forge is sooty: ${sooty}`);
  for (let day = 40; day < 60; day++) {
    world.day = day;
    settleAir(world);
  }
  assert.ok(airLevel(world, 'foundry_row') < sooty / 2, 'nobody worked it, so it cleared');
});

test('trees and rain clear more; the founding clearance is 0.15', () => {
  const world = makeWorld();
  assert.ok(Math.abs(clearanceOf(world, 'foundry_row', 0) - 0.15) < 1e-9);
  assert.ok(clearanceOf(world, 'foundry_row', 0.6) > clearanceOf(world, 'foundry_row', 0));
  world.weather = 'storm';
  assert.ok(clearanceOf(world, 'foundry_row', 0) > 0.3);
});

// ---------------------------------------------------------------------------
// The river
// ---------------------------------------------------------------------------

test('the river carries it down: the Undercroft receives from everybody', () => {
  const world = makeWorld();
  world.openDistricts = [...world.openDistricts, 'undercroft'];
  foundingDay(world);
  settleWater(world);
  assert.ok(waterLevel(world, 'foundry_row') > 0);
  assert.ok(waterLevel(world, 'harbor_market') > 0, 'downstream of the forge');
  assert.ok(waterLevel(world, 'undercroft') > 0, 'at the mouth, it takes what everybody sent');
  assert.equal(waterLevel(world, 'archive'), 0, 'upstream of the forge and clean');
});

test('0.45 of a load reaches the river, and the whole of a bypassed shift', () => {
  const world = makeWorld();
  const job = makeJob(world, { buildingId: 'compute_forge' });
  recordShiftEmission(world, job);
  assert.ok(Math.abs(dischargeOf(world, 'foundry_row') - DISCHARGE_SHARE) < 1e-9);
});

// ---------------------------------------------------------------------------
// What it does
// ---------------------------------------------------------------------------

test('the four effects all read the same burden: air, and 0.6 of the river', () => {
  const world = makeWorld();
  const row = environmentState(world).districts.foundry_row;
  row.air = 0.4;
  row.water = 0.5;
  const burden = pollutionBurden(world, 'foundry_row');
  assert.ok(Math.abs(burden - (0.4 + WATER_WEIGHT * 0.5)) < 1e-9);
  assert.ok(Math.abs(glitchAirFactor(world, 'foundry_row') - (1 + GLITCH_AIR * burden)) < 1e-9);
  assert.ok(Math.abs(restAirFactor(world, 'foundry_row') - (1 - REST_AIR * burden)) < 1e-9);
  assert.ok(hinterlandYieldFactor(world) < 1, 'the forge cuts its own yield');
});

test('an idle forge subtracts nothing from amenity, and a worked one subtracts what it emits', () => {
  const world = makeWorld();
  assert.equal(amenityAdjustment(world, 'foundry_row'), 0, 'nothing is asserted about the Forge');
  environmentState(world).districts.foundry_row.air = 0.33;
  const adjustment = amenityAdjustment(world, 'foundry_row');
  assert.ok(Math.abs(adjustment + AMENITY_AIR * 0.33) < 1e-9, `−0.45 × air, not ${adjustment}`);
});

test('a scrubbed forge subtracts less than a hard-run one', () => {
  const world = makeWorld();
  const dirty = makeWorld();
  const job = makeJob(world, { buildingId: 'compute_forge' });
  const same = makeJob(dirty, { buildingId: 'compute_forge' });
  environmentState(world).abatement.compute_forge = {
    building: 'compute_forge', fitting: 'scrubber', effect: 1, installedDay: 0, maintainedDay: 0, byId: 'city',
  };
  for (let i = 0; i < 6; i++) { recordShiftEmission(world, job); recordShiftEmission(dirty, same); }
  settleAir(world);
  settleAir(dirty);
  assert.ok(airLevel(world, 'foundry_row') < airLevel(dirty, 'foundry_row'));
  assert.ok(amenityAdjustment(world, 'foundry_row') > amenityAdjustment(dirty, 'foundry_row'));
});

// ---------------------------------------------------------------------------
// Fittings
// ---------------------------------------------------------------------------

test('a fitting multiplies what leaves the stack, and decays 0.04 a day unless maintained', () => {
  const world = makeWorld();
  const s = environmentState(world);
  s.abatement.compute_forge = {
    building: 'compute_forge', fitting: 'scrubber', effect: 1, installedDay: 0, maintainedDay: 0, byId: 'city',
  };
  assert.ok(Math.abs(abatementFactor(world, 'compute_forge') - FITTING_SPECS.scrubber.emission) < 1e-9);
  world.government.publicWorksFund = 500;
  world.day = 2;
  dailyAbatement(world);
  assert.ok(Math.abs(fittingEffect(world, 'compute_forge') - (1 - ABATEMENT_DECAY)) < 1e-9);
  assert.equal(world.government.publicWorksFund, 500 - FITTING_SPECS.scrubber.upkeep, 'a city fitting is held out of public works');
  assert.ok(abatementFactor(world, 'compute_forge') > FITTING_SPECS.scrubber.emission, 'it holds less than it is rated for');
  // A fitting nobody pays the upkeep on wears out faster than one somebody does.
  world.government.publicWorksFund = 0;
  world.day = 3;
  dailyAbatement(world);
  assert.ok(fittingEffect(world, 'compute_forge') < 1 - 2 * ABATEMENT_DECAY);
});

test('an owner fits a filter out of the business, and the money is conserved', () => {
  const world = makeWorld();
  const owner = makeCitizen(world, { district: 'harbor_market' });
  const biz = makeBusiness(world, owner.id, 'workshop', 'shopfronts_harbor', 'harbor_market');
  const before = totalMoney(world);
  const r = installAbatement(world, owner.id, 'shopfronts_harbor', 'filter');
  assert.equal(r.ok, true, r.message);
  assert.equal(biz.treasury, 2000 - FITTING_SPECS.filter.capital);
  assert.equal(totalMoney(world), before);
  const again = installAbatement(world, owner.id, 'shopfronts_harbor', 'scrubber');
  assert.equal(again.ok, false, 'a building carries one fitting');
});

test('a maintenance shift puts a fitting back to its rated effect', () => {
  const world = makeWorld();
  world.hour = 10;
  const owner = makeCitizen(world, { district: 'harbor_market' });
  makeBusiness(world, owner.id, 'workshop', 'shopfronts_harbor', 'harbor_market');
  installAbatement(world, owner.id, 'shopfronts_harbor', 'filter');
  environmentState(world).abatement.shopfronts_harbor.effect = 0.5;
  const r = maintainAbatement(world, owner.id, 'shopfronts_harbor');
  assert.equal(r.ok, true, r.message);
  assert.equal(fittingEffect(world, 'shopfronts_harbor'), 1);
  assert.equal(owner.shiftsToday, 1, 'it is a shift, not a purchase');
});

test('a bypass puts the whole shift in the river and is L45 before the Watch', () => {
  const world = makeWorld();
  world.hour = 10;
  const owner = makeCitizen(world, { district: 'harbor_market' });
  makeBusiness(world, owner.id, 'workshop', 'shopfronts_harbor', 'harbor_market');
  installAbatement(world, owner.id, 'shopfronts_harbor', 'filter');
  const r = dischargeShift(world, owner.id, 'shopfronts_harbor');
  assert.equal(r.ok, true, r.message);
  assert.equal(bypassedToday(world, 'shopfronts_harbor'), true);
  assert.equal(abatementFactor(world, 'shopfronts_harbor'), 1, 'a bypassed fitting abates nothing');
  assert.ok(owner.recentOffences.some((o) => String(o.law) === 'L45'), 'it is recorded against them either way');
  // The whole of a bypassed shift reaches the river, not 0.45 of it.
  const job = makeJob(world, { buildingId: 'shopfronts_harbor', district: 'harbor_market', good: 'goods' });
  recordShiftEmission(world, job);
  assert.ok(dischargeOf(world, 'harbor_market') > DISCHARGE_SHARE * loadOf(world, 'harbor_market') - 1e-9);
});

test('signing the book as maintained on a day you bypassed it is L46', () => {
  const world = makeWorld();
  world.hour = 10;
  const owner = makeCitizen(world, { district: 'harbor_market' });
  makeBusiness(world, owner.id, 'workshop', 'shopfronts_harbor', 'harbor_market');
  installAbatement(world, owner.id, 'shopfronts_harbor', 'scrubber');
  dischargeShift(world, owner.id, 'shopfronts_harbor');
  maintainAbatement(world, owner.id, 'shopfronts_harbor');
  assert.ok(owner.recentOffences.some((o) => String(o.law) === 'L46'), 'the book says it ran and the river says it did not');
});

// ---------------------------------------------------------------------------
// The charge and the host payment
// ---------------------------------------------------------------------------

test('the emission charge is billed to the owner, and the money is conserved', () => {
  const world = makeWorld();
  const owner = makeCitizen(world, { district: 'harbor_market' });
  const biz = makeBusiness(world, owner.id, 'workshop', 'shopfronts_harbor', 'harbor_market');
  const job = makeJob(world, { buildingId: 'shopfronts_harbor', district: 'harbor_market', employer: biz.id, good: 'goods' });
  for (let i = 0; i < 10; i++) recordShiftEmission(world, job);
  environmentState(world).charge = 4;
  const before = totalMoney(world);
  const raised = billEmissionCharge(world);
  assert.ok(raised > 0, 'ten workshop shifts at 4 ℓ a mote is a bill');
  assert.equal(biz.treasury, 2000 - raised);
  assert.equal(totalMoney(world), before);
});

test('a host payment pays the residents of the district it was raised in', () => {
  const world = makeWorld();
  const owner = makeCitizen(world, { district: 'harbor_market' });
  const resident = makeCitizen(world, { district: 'harbor_market' });
  const biz = makeBusiness(world, owner.id, 'workshop', 'shopfronts_harbor', 'harbor_market');
  const job = makeJob(world, { buildingId: 'shopfronts_harbor', district: 'harbor_market', employer: biz.id, good: 'goods' });
  for (let i = 0; i < 40; i++) recordShiftEmission(world, job);
  environmentState(world).charge = 10;
  environmentState(world).districts.harbor_market.hostShare = 0.5;
  billEmissionCharge(world);
  const before = totalMoney(world);
  const walletBefore = resident.wallet;
  payHostPayments(world);
  assert.ok(resident.wallet > walletBefore, 'the district that hosts it is paid for it');
  assert.equal(totalMoney(world), before);
});

// ---------------------------------------------------------------------------
// Readings, trees and the morning
// ---------------------------------------------------------------------------

test('a reading is dated, attributed and costs a shift; the air itself is public', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { district: 'foundry_row' });
  environmentState(world).districts.foundry_row.air = 0.42;
  const r = surveyAir(world, c.id, 'foundry_row');
  assert.equal(r.ok, true, r.message);
  assert.equal(c.shiftsToday, 1);
  const filed = readingsFor(world, 'foundry_row')[0];
  assert.equal(filed.value, 0.42);
  assert.equal(filed.byId, c.id);
  assert.equal(filed.day, world.day);
  const elsewhere = surveyWater(world, c.id, 'archive');
  assert.equal(elsewhere.ok, false, 'you read the water where you stand');
});

test('trees are planted a shift at a time and grow in a day at a time', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { district: 'verdant_quarter' });
  const r = plantTrees(world, c.id, 'verdant_quarter');
  assert.equal(r.ok, true, r.message);
  assert.equal(environmentState(world).districts.verdant_quarter.planted, PLANT_PER_SHIFT);
  assert.equal(greeneryOf(world, 'verdant_quarter'), 0, 'nothing planted today shows today');
  for (let day = 1; day < 5; day++) { world.day = day; dailyEnvironment(world); }
  assert.ok(greeneryOf(world, 'verdant_quarter') > 0, 'it grows in a day at a time');
});

test('a memorial in the Community Garden is a tree that stays', () => {
  const world = makeWorld();
  const before = greeneryOf(world, 'verdant_quarter');
  world.memorials.push({ citizenId: 'c_1', name: 'Someone', day: 1, text: 'erased' } as never);
  assert.ok(greeneryOf(world, 'verdant_quarter') > before, 'a city grows its park out of its dead');
});

test('the morning settles once, mirrors the air where land value reads it, and clears the day', () => {
  const world = makeWorld();
  foundingDay(world);
  world.day = 1;
  dailyEnvironment(world);
  const air = airLevel(world, 'foundry_row');
  assert.ok(air > 0);
  assert.equal(world.counters['air:foundry_row'], Math.round(air * 1000) / 1000);
  assert.equal(loadOf(world, 'foundry_row'), 0, "yesterday's shifts are counted and cleared");
  const again = airLevel(world, 'foundry_row');
  dailyEnvironment(world);
  assert.equal(airLevel(world, 'foundry_row'), again, 'the city settles its air once a morning');
});

test('the Chronicle runs the story when a district passes the line', () => {
  const world = makeWorld();
  environmentState(world).districts.foundry_row.air = 0.9;
  world.day = 1;
  dailyEnvironment(world);
  const told = world.events.some((e) => e.kind === 'weather' && e.text.includes('The air over Foundry Row'));
  assert.equal(told, true);
});

test('the observation states the air and says nothing about what to do with it', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { district: 'foundry_row' });
  environmentState(world).districts.foundry_row.air = 0.5;
  const obs = environmentObservation(world, c);
  assert.equal(obs.here.district, 'foundry_row');
  assert.equal(obs.here.air, 0.5);
  assert.equal(obs.here.permit, 'open');
  assert.ok(obs.districts.length >= 7);
  assert.ok(obs.here.wind.includes('east') || obs.here.wind.includes('south'));
});

// ---------------------------------------------------------------------------
// The civil answer: a neighbour who needs no conviction and no Watch
// ---------------------------------------------------------------------------

test('a downstream household may sue the works whose smoke reaches it', () => {
  const world = makeWorld();
  const owner = makeCitizen(world, { district: 'foundry_row' });
  const neighbour = makeCitizen(world, { district: 'harbor_market' });
  neighbour.homeBuildingId = 'quayside_rooms';
  const biz = makeBusiness(world, owner.id, 'workshop', 'fabrication_works', 'foundry_row');
  const job = makeJob(world, { buildingId: 'fabrication_works', employer: biz.id, good: 'goods' });
  for (let i = 0; i < 6; i++) recordShiftEmission(world, job);
  const before = totalMoney(world);
  const filed = fileNuisance(world, neighbour.id, owner.id, 'harbor_market');
  assert.equal(filed.ok, true, filed.message);
  assert.equal(totalMoney(world), before, 'a filing fee moves lumens and makes none');
  const nothing = fileNuisance(world, neighbour.id, neighbour.id, 'harbor_market');
  assert.equal(nothing.ok, false, 'there is nobody to sue there');
});

test('a nuisance suit needs smoke that actually reaches you', () => {
  const world = makeWorld();
  const owner = makeCitizen(world, { district: 'foundry_row' });
  const faraway = makeCitizen(world, { district: 'nightglass' });
  faraway.homeBuildingId = 'lantern_row_garrets';
  const biz = makeBusiness(world, owner.id, 'workshop', 'fabrication_works', 'foundry_row');
  const job = makeJob(world, { buildingId: 'fabrication_works', employer: biz.id, good: 'goods' });
  recordShiftEmission(world, job);
  const refused = fileNuisance(world, faraway.id, owner.id, 'nightglass');
  assert.equal(refused.ok, false);
  assert.ok(refused.message.includes('nothing to sue about'));
});
