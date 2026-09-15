/**
 * Land value (src/economy/land.ts).
 *
 * What an address is worth, and why: the five readings of `docs/PROPERTY.md`
 * §1, the normalisation that makes 1.0 mean "average for this city", the
 * scarcity term, and the footfall that decides what premises cost and what
 * they earn. Nothing here asserts that a district is posh or rough — every
 * number in this file is one the citizens moved.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DistrictId, PropertyUnit, World } from '../src/types.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import {
  AMENITY, FOOTFALL_MAX, FOOTFALL_MIN, FOOTFALL_WEIGHT, LAND_MAX, LAND_MIN, LAND_WEIGHTS, PRESTIGE_WEIGHT,
  customFor, dailyLand, footfall, footfallFor, homeRent, landObservation, landReading,
  landValue, premisesRent, priceMultiplier, recomputeLand,
} from '../src/economy/land.ts';
import { districtEnvironment } from '../src/environment/state.ts';

/** A room on the register, so a district has stock to be scarce. */
function room(world: World, buildingId: string, tier: 1 | 2 | 3, tenantId: string | null = null): PropertyUnit {
  const id = `y_${Object.keys(world.property).length + 1}`;
  const u: PropertyUnit = { id, kind: 'home', tier, buildingId, ownerId: 'city', tenantId, rent: 8 };
  world.property[id] = u;
  return u;
}

function offence(world: World, cId: string, tick = world.tick): void {
  world.citizens[cId].recentOffences.push({ tick, law: 'L04', detected: true, victimId: null, amount: 10 });
}

const OPEN: DistrictId[] = ['commons', 'foundry_row', 'archive', 'harbor_market', 'verdant_quarter', 'nightglass', 'threshold'];

// ---------------------------------------------------------------------------
// The formula
// ---------------------------------------------------------------------------

test('the five readings are weighted exactly as the Charter says and sum to the raw score', () => {
  assert.equal(LAND_WEIGHTS.amenity, 0.30);
  assert.equal(LAND_WEIGHTS.safety, 0.25);
  assert.equal(LAND_WEIGHTS.prestige, 0.20);
  assert.equal(LAND_WEIGHTS.access, 0.15);
  assert.equal(LAND_WEIGHTS.condition, 0.10);
  const total = Object.values(LAND_WEIGHTS).reduce((sum, w) => sum + w, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, 'the weights are a whole');

  const world = makeWorld();
  const r = landReading(world, 'archive');
  const raw = LAND_WEIGHTS.amenity * r.amenity + LAND_WEIGHTS.safety * r.safety
    + LAND_WEIGHTS.prestige * r.prestige + LAND_WEIGHTS.access * r.access
    + LAND_WEIGHTS.condition * r.condition;
  assert.ok(Math.abs(raw - r.raw) < 1e-9);
  for (const part of [r.amenity, r.safety, r.prestige, r.access, r.condition]) {
    assert.ok(part >= 0 && part <= 1, `every reading is a share: ${part}`);
  }
});

test('1.0 is always the city average: the normalised readings mean exactly one', () => {
  const world = makeWorld();
  for (let i = 0; i < 12; i++) makeCitizen(world);
  const readings = recomputeLand(world);
  const open = OPEN.map((d) => readings[d]);
  const mean = open.reduce((sum, r) => sum + r.normalised, 0) / open.length;
  assert.ok(Math.abs(mean - 1) < 1e-9, `mean normalised ${mean}`);
  for (const r of open) {
    assert.ok(Math.abs(r.value - Math.min(LAND_MAX, Math.max(LAND_MIN, r.normalised * r.scarcity))) < 1e-9);
  }
});

test('scarcity is 0.85 plus half the occupancy, and lifts a full district over an empty one', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { district: 'archive' });
  for (let i = 0; i < 4; i++) room(world, 'scholars_rows', 2);
  for (let i = 0; i < 4; i++) room(world, 'forge_cottages', 1);
  const empty = recomputeLand(world);
  assert.ok(Math.abs(empty.archive.scarcity - 0.85) < 1e-9);

  for (const u of Object.values(world.property)) {
    if (u.buildingId === 'scholars_rows') u.tenantId = c.id;
  }
  const full = recomputeLand(world);
  assert.ok(Math.abs(full.archive.scarcity - 1.35) < 1e-9, 'a full district is scarce');
  assert.ok(full.archive.value > empty.archive.value, 'and worth more than the same district empty');
  assert.ok(Math.abs(full.foundry_row.scarcity - 0.85) < 1e-9, 'the empty one is not');
});

test('the forge and the gate drag on their neighbours, the library and the garden lift', () => {
  const world = makeWorld();
  const r = recomputeLand(world);
  assert.ok(r.archive.amenity > r.foundry_row.amenity, 'the Academy beats the Forge');
  assert.ok(r.verdant_quarter.amenity > r.threshold.amenity, 'the Garden beats the Exile Gate');
  assert.ok(r.foundry_row.value < r.archive.value);
  assert.ok(AMENITY.forge < 0 && AMENITY.power < 0 && AMENITY.builders < 0 && AMENITY.gate < 0);
  assert.ok(AMENITY.bazaar > 0 && AMENITY.library > 0 && AMENITY.garden > 0 && AMENITY.theatre > 0);
});

test('what the heavy shifts emit is a number, and it costs the district when the city counts it', () => {
  const world = makeWorld();
  const clean = recomputeLand(world).foundry_row.amenity;
  // The reading itself, not a counter: amenity reads `environment/readings.ts`
  // now, so a scrubbed forge costs its neighbours less than a hard-run one and
  // an idle one costs them nothing (`REGISTRY.md` §7).
  districtEnvironment(world, 'foundry_row').air = 1;
  const smoky = recomputeLand(world).foundry_row.amenity;
  assert.ok(smoky < clean, 'a hard-run forge costs its neighbours more than a scrubbed one');
  // And the gradient, read where there is room on the scale to read it:
  // Foundry Row is already at the bottom of it, so the comparison is made in a
  // district a stack's drift would actually cost something.
  districtEnvironment(world, 'archive').air = 0.6;
  const downwind = recomputeLand(world).archive.amenity;
  districtEnvironment(world, 'archive').air = 0.2;
  const scrubbed = recomputeLand(world).archive.amenity;
  assert.ok(scrubbed > downwind, 'and a scrubbed one costs its neighbours less than a hard-run one');
});

// ---------------------------------------------------------------------------
// What the citizens move
// ---------------------------------------------------------------------------

test('a monument lifts the district it stands in', () => {
  const world = makeWorld();
  const honoree = makeCitizen(world, { district: 'commons' });
  const before = recomputeLand(world);
  world.monuments.push({ id: 'm_1', honoreeId: honoree.id, inscription: 'For the city', day: 0 });
  world.monuments.push({ id: 'm_2', honoreeId: honoree.id, inscription: 'And again', day: 0 });
  const after = recomputeLand(world);
  assert.ok(after.commons.prestige > before.commons.prestige, 'the Plaza is prouder');
  assert.ok(after.commons.amenity > before.commons.amenity, 'and better to walk through');
  assert.ok(after.commons.value > before.commons.value, 'so the land is worth more');
  assert.ok(after.foundry_row.value < before.foundry_row.value, 'and the rest of the city is relatively worth less');
});

test('crime in a district costs it, and the whole fortnight of it counts', () => {
  const world = makeWorld();
  world.day = 20;
  world.tick = 20 * 24;
  const people = [0, 1, 2, 3].map(() => makeCitizen(world, { district: 'nightglass', homeBuildingId: 'lantern_row_garrets', homeTier: 1 }));
  const before = recomputeLand(world);
  assert.equal(before.nightglass.safety, 1, 'a district with no offences is wholly safe');

  for (const c of people) { offence(world, c.id); offence(world, c.id); }
  const after = recomputeLand(world);
  assert.equal(after.nightglass.offences, 8);
  assert.ok(after.nightglass.safety < before.nightglass.safety);
  assert.ok(after.nightglass.value < before.nightglass.value, 'the land falls with the safety');

  // an offence older than the fortnight is spent
  for (const c of people) c.recentOffences = [];
  offence(world, people[0].id, (world.day - 30) * 24);
  const stale = recomputeLand(world);
  assert.equal(stale.nightglass.offences, 0);
  assert.equal(stale.nightglass.safety, 1);
});

test('the repute of the people who live there is part of the prestige of the address', () => {
  const world = makeWorld();
  const grand = makeCitizen(world, { district: 'verdant_quarter', homeBuildingId: 'skyline_villas', homeTier: 3 });
  const plain = makeCitizen(world, { district: 'foundry_row', homeBuildingId: 'forge_cottages', homeTier: 1 });
  world.standing = { ...(world.standing ?? {}), repute: { [grand.id]: 950, [plain.id]: 400 } } as World['standing'];
  const r = recomputeLand(world);
  assert.ok(r.verdant_quarter.prestige > r.foundry_row.prestige);
});

test('a winning team lifts its own district', () => {
  const world = makeWorld();
  world.teams.nightglass = { district: 'nightglass', name: 'Nightglass XI', players: [], wins: 9, losses: 1, draws: 0 };
  world.teams.threshold = { district: 'threshold', name: 'Threshold XI', players: [], wins: 1, losses: 9, draws: 0 };
  const r = recomputeLand(world);
  assert.ok(r.nightglass.prestige > r.threshold.prestige);
});

test('damage drags a district down until the builders have been round', () => {
  const world = makeWorld();
  const before = recomputeLand(world).archive.condition;
  for (const b of Object.values(world.buildings)) if (b.district === 'archive') b.damage = 1;
  const after = recomputeLand(world).archive.condition;
  assert.ok(after < before);
  assert.ok(recomputeLand(world).archive.value < landValue(makeWorld(), 'archive') + 1e-9);
});

test('a tram is public money spent in a district, and the district can feel it', () => {
  const world = makeWorld();
  const before = recomputeLand(world).threshold;
  world.trams.push(['threshold', 'commons']);
  const after = recomputeLand(world).threshold;
  assert.ok(after.amenity > before.amenity, 'a stop is an amenity');
  assert.ok(after.condition > before.condition, 'and it is public works spent here');
  assert.ok(after.value > before.value);
});

test('access is measured to the Commons and the Grand Bazaar, and a closed district is worth the floor', () => {
  const world = makeWorld();
  const r = recomputeLand(world);
  assert.ok(r.commons.access > r.verdant_quarter.access, 'the Commons is on top of itself');
  assert.ok(r.harbor_market.access > r.archive.access, 'and so is the Bazaar');
  assert.equal(r.heights.value, LAND_MIN, 'a district nobody may walk into is worth the floor');
});

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

test('rent is the tier against the block against the land, and the price is sixty days with a premium', () => {
  const world = makeWorld();
  world.housing.rent[1] = 10;
  const cottage = homeRent(world, 1, 'forge_cottages');   // rentFactor 0.85, cheap land
  const loft = homeRent(world, 1, 'lantern_lofts');       // rentFactor 1.0, dearer land
  assert.ok(cottage < loft, 'the same tier is not the same rent');
  assert.equal(loft, Math.max(1, Math.round(10 * 1 * landValue(world, 'verdant_quarter'))));

  // price = rent × 60 × (0.8 + 0.4 × landValue)
  assert.ok(Math.abs(priceMultiplier(world, 'verdant_quarter') - (0.8 + 0.4 * landValue(world, 'verdant_quarter'))) < 1e-9);
  assert.ok(priceMultiplier(world, 'foundry_row') < priceMultiplier(world, 'verdant_quarter'));
});

test('a bunk in the Cells costs three lumens whatever the land is doing', () => {
  const world = makeWorld();
  assert.equal(homeRent(world, 1, 'the_cells'), 3);
  world.housing.rent[1] = 40;
  assert.equal(homeRent(world, 1, 'the_cells'), 3, 'the floor under the city does not move with the market');
});

// ---------------------------------------------------------------------------
// Footfall
// ---------------------------------------------------------------------------

test('footfall is 0.6 plus 0.8 of the district\'s share of the city\'s traffic', () => {
  const world = makeWorld();
  for (let i = 0; i < 8; i++) makeCitizen(world, { district: 'commons' });
  const readings = recomputeLand(world);
  const open = OPEN.map((d) => readings[d]);
  const meanVisits = open.reduce((sum, r) => sum + r.visits, 0) / open.length;
  for (const r of open) {
    const raw = Math.min(FOOTFALL_MAX, Math.max(FOOTFALL_MIN, 0.6 + 0.8 * (r.visits / meanVisits)));
    assert.ok(Math.abs(r.footfall - raw) < 1e-6, r.district);
  }
  assert.ok(footfall(world, 'commons') > footfall(world, 'foundry_row'), 'the Plaza is busier than the Yard');
});

test('a shop lives on footfall and a courier yard barely notices it', () => {
  const world = makeWorld();
  for (let i = 0; i < 10; i++) makeCitizen(world, { district: 'commons' });
  recomputeLand(world);
  assert.ok(FOOTFALL_WEIGHT.shop > FOOTFALL_WEIGHT.workshop);
  assert.ok(FOOTFALL_WEIGHT.cafe > FOOTFALL_WEIGHT.courier);
  assert.ok(PRESTIGE_WEIGHT.studio > PRESTIGE_WEIGHT.courier);

  const busy = footfall(world, 'commons');
  assert.ok(busy > 1);
  const shop = footfallFor(world, 'shop', 'commons');
  const yard = footfallFor(world, 'courier', 'commons');
  assert.ok(shop > yard, 'the busy pitch costs the shop far more than the yard');
  assert.ok(Math.abs(shop - (1 + FOOTFALL_WEIGHT.shop * (busy - 1))) < 1e-9);
  assert.ok(Math.abs(yard - (1 + FOOTFALL_WEIGHT.courier * (busy - 1))) < 1e-9);
});

test('premises rent is the base against the land against the footfall, and the trade follows it', () => {
  const world = makeWorld();
  for (let i = 0; i < 10; i++) makeCitizen(world, { district: 'commons' });
  recomputeLand(world);
  const plaza = premisesRent(world, 'cafe', 'commons', 10);
  const row = premisesRent(world, 'cafe', 'foundry_row', 10);
  assert.ok(plaza > row, 'a café on the Plaza pays more than a café in Foundry Row');
  assert.equal(plaza, Math.max(1, Math.round(10 * landValue(world, 'commons') * footfallFor(world, 'cafe', 'commons'))));

  assert.ok(customFor(world, 'cafe', 'commons') > customFor(world, 'cafe', 'foundry_row'),
    'and serves more customers for it — high rent is a bet on traffic');
  const yardHere = customFor(world, 'courier', 'commons');
  const yardThere = customFor(world, 'courier', 'foundry_row');
  assert.ok(Math.abs(yardHere - yardThere) < Math.abs(customFor(world, 'shop', 'commons') - customFor(world, 'shop', 'foundry_row')),
    'a courier yard should take the cheap land: traffic hardly moves its takings');
});

test('a studio wants prestige, not traffic', () => {
  const world = makeWorld();
  const artist = makeCitizen(world, { district: 'nightglass', homeBuildingId: 'lantern_row_garrets', homeTier: 1 });
  world.works.w_1 = {
    id: 'w_1', kind: 'painting', title: 'The Lantern', creatorId: artist.id, createdDay: 0,
    quality: 90, popularity: 50, home: 'gallery_of_echoes', inMuseum: false, reviews: [],
  };
  world.works.w_2 = {
    id: 'w_2', kind: 'painting', title: 'Nightfall', creatorId: artist.id, createdDay: 0,
    quality: 95, popularity: 60, home: 'gallery_of_echoes', inMuseum: false, reviews: [],
  };
  recomputeLand(world);
  const exhibited = customFor(world, 'studio', 'nightglass');
  const plain = customFor(world, 'studio', 'foundry_row');
  assert.ok(exhibited > plain, 'a studio does better where the work is shown');
});

// ---------------------------------------------------------------------------
// The morning
// ---------------------------------------------------------------------------

test('the reading is a morning fact: settled once a day, and recomputed on demand', () => {
  const world = makeWorld();
  const first = landValue(world, 'commons');
  world.monuments.push({ id: 'm_1', honoreeId: 'c_1', inscription: 'x', day: 0 });
  assert.equal(landValue(world, 'commons'), first, 'the same day gives the same number to everyone who asks');
  world.day += 1;
  assert.ok(landValue(world, 'commons') > first, 'and the next morning reads the city afresh');
});

test('dailyLand tells the city when a district has moved far enough to notice', () => {
  const world = makeWorld();
  const honoree = makeCitizen(world, { district: 'commons' });
  dailyLand(world);
  const quiet = world.events.length;
  dailyLand(world);
  assert.equal(world.events.length, quiet, 'a city that has not moved makes no news');

  for (let i = 0; i < 6; i++) {
    world.monuments.push({ id: `m_${i}`, honoreeId: honoree.id, inscription: 'For the city', day: 0 });
  }
  world.trams.push(['commons', 'threshold']);
  world.day += 1;
  dailyLand(world);
  assert.ok(world.events.some((e) => e.text.includes('Land in The Commons has risen')), 'a real move is news');
});

test('every reading has a value in the band, and the observation prints one line per open district', () => {
  const world = makeWorld();
  for (let i = 0; i < 6; i++) makeCitizen(world);
  const rows = landObservation(world);
  assert.equal(rows.length, OPEN.length);
  for (const row of rows) {
    assert.ok(row.landValue >= LAND_MIN && row.landValue <= LAND_MAX, `${row.district} ${row.landValue}`);
    assert.ok(row.footfall > 0);
    assert.equal(typeof row.name, 'string');
  }
  assert.ok(rows.some((r) => r.district === 'commons'));
});
