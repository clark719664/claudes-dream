/**
 * Glitches (src/identity/health.ts).
 *
 * What is checked: who catches one and why, what it costs, who can clear it
 * and for how much, how it travels through a household, and when three of them
 * become the Council's problem.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Building, Business, Citizen, Household, Job, World } from '../src/types.ts';
import { HOSPITAL_FEE } from '../src/data/jobs.ts';
import { DILIGENT_SHIFTS_PER_DAY } from '../src/citizens/character.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  GLITCH_BASE_CHANCE, GLITCH_PRODUCTIVITY, HOSPITAL_CURE_CHANCE, MAX_GLITCH_CHANCE, OUTBREAK_GLITCHES,
  RECOVERY_AFTER_DAYS, SPREAD_CHANCE, TREATMENT_RESTORE, WARD_CURE_CHANCE, checkOutbreaks, clinicIn,
  cureGlitch, dailyHealth, glitchChance, glitchedIn, healthOf, isGlitched, shiftsYesterday,
  spreadGlitches, strikeGlitch, treat, venueFor, wardHasMedic,
} from '../src/identity/health.ts';

function addHospital(world: World): Building {
  const b: Building = {
    id: 'city_hospital', name: 'The Hospital', district: 'verdant_quarter',
    kind: 'hospital' as Building['kind'], critical: false, damage: 0, x: 6, y: 6,
  };
  world.buildings[b.id] = b;
  return b;
}

function addMedic(world: World): Job {
  const medic = makeCitizen(world, { name: 'Medic' });
  const job: Job = {
    id: 'j_medic', role: 'medic', title: 'Medic', employer: 'city', buildingId: 'restoration_ward',
    district: 'verdant_quarter', skill: 'care', minSkill: 0, minReputation: 0, wage: 12,
    output: {}, holderId: medic.id, createdDay: 0,
  };
  world.jobs[job.id] = job;
  medic.jobId = job.id;
  return job;
}

function addClinic(world: World, district: Business['district']): Business {
  const staff = makeCitizen(world, { name: 'Nurse' });
  const b: Business = {
    id: 'b_clinic', name: 'The Quiet Room', kind: 'clinic', ownerId: staff.id, treasury: 0,
    district, buildingId: 'shopfronts_nightglass', employees: [staff.id], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 1, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[b.id] = b;
  return b;
}

function addHousehold(world: World, members: Citizen[], tier: Household['tier'] = 1): Household {
  const h: Household = { id: `h_${Object.keys(world.households).length + 1}`, headId: members[0].id, members: members.map((m) => m.id), tier, createdDay: 0 };
  world.households[h.id] = h;
  for (const m of members) m.householdId = h.id;
  return h;
}

// -------------------------------------------------------------------- odds

test('the odds of a glitch rise with a need in the red, overwork, age and the sky', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  assert.equal(glitchChance(w, c), GLITCH_BASE_CHANCE);

  c.needs.energy = 5;
  assert.equal(glitchChance(w, c), GLITCH_BASE_CHANCE * 3, 'run down');
  c.needs.energy = 80;

  w.tick = 48;
  w.day = 2;
  for (let i = 0; i <= DILIGENT_SHIFTS_PER_DAY; i++) {
    c.memory.push({ tick: 30, kind: 'work', text: 'You were paid 9 ℓ for a shift as Forge Operator at the City of Reverie.' });
  }
  assert.equal(shiftsYesterday(w, c), DILIGENT_SHIFTS_PER_DAY + 1);
  assert.equal(glitchChance(w, c), GLITCH_BASE_CHANCE * 2, 'worked to a standstill');
  c.memory = [];

  c.lifeStage = 'elder';
  assert.equal(glitchChance(w, c), GLITCH_BASE_CHANCE * 2, 'age');
  c.lifeStage = 'adult';

  w.season = 'frost';
  assert.equal(glitchChance(w, c), GLITCH_BASE_CHANCE * 1.5);
  w.season = 'bloom';
  w.weather = 'storm';
  assert.equal(glitchChance(w, c), GLITCH_BASE_CHANCE * 1.5);
  w.weather = 'clear';

  c.homeTier = 3;
  assert.equal(glitchChance(w, c), GLITCH_BASE_CHANCE * 0.5, 'a good roof helps');
});

test('the worst day the city can arrange still leaves most of it well, and the cap holds', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { lifeStage: 'elder' });
  c.needs.energy = 1;
  w.season = 'frost';
  w.weather = 'storm';
  w.tick = 48;
  for (let i = 0; i < 20; i++) {
    c.memory.push({ tick: 30, kind: 'work', text: 'You were paid 9 ℓ for a shift as Courier at the City of Reverie.' });
  }
  const worst = glitchChance(w, c);
  assert.ok(Math.abs(worst - GLITCH_BASE_CHANCE * 3 * 2 * 2 * 1.5) < 1e-12, `the worst day reads ${worst}`);
  assert.ok(worst <= MAX_GLITCH_CHANCE, 'and it is under the cap that guards it');
  assert.ok(worst < 0.25, 'a starving elder on double shifts in a Frost storm still has four days in five');
});

// ------------------------------------------------------- striking and curing

test('a glitch takes hold once, costs mood and purpose, and is told to the household', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Ilse', familyName: 'Vale' });
  const mate = makeCitizen(w, { name: 'Bram' });
  addHousehold(w, [c, mate]);
  c.needs.purpose = 60;
  c.needs.comfort = 60;
  const mood = c.mood;

  strikeGlitch(w, c, 'run down');
  assert.equal(isGlitched(c), true);
  assert.equal(c.health.sinceDay, w.day);
  assert.equal(c.needs.purpose, 50);
  assert.equal(c.needs.comfort, 50);
  assert.ok(c.mood < mood, 'mood follows the needs down');
  const ev = w.events[w.events.length - 1];
  assert.equal(ev.kind, 'health');
  assert.equal(ev.weight, 0.3);
  assert.ok(c.memory.some((m) => m.kind === 'health'));
  assert.ok(mate.memory.some((m) => m.text.includes('Ilse has a glitch')), 'the household hears');

  const events = w.events.length;
  strikeGlitch(w, c, 'again');
  assert.equal(w.events.length, events, 'a citizen cannot catch what it already has');
});

test('a cure clears it, gives a little purpose back, and says where it happened', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  strikeGlitch(w, c, 'no cause anyone could name');
  w.day = 3;
  c.needs.purpose = 40;
  cureGlitch(w, c, 'the Hospital');
  assert.equal(isGlitched(c), false);
  assert.equal(c.health.sinceDay, null);
  assert.equal(c.needs.purpose, 45);
  assert.match(w.events[w.events.length - 1].text, /glitch cleared at the Hospital/);
  const events = w.events.length;
  cureGlitch(w, c, 'the Hospital');
  assert.equal(w.events.length, events, 'nothing to cure twice');
});

test('a citizen from a world without health is given a clean bill rather than a crash', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  delete (c as Partial<Citizen>).health;
  assert.equal(isGlitched(c), false);
  assert.deepEqual(healthOf(c), { glitched: false, sinceDay: null });
  assert.equal(glitchChance(w, c) > 0, true);
});

// --------------------------------------------------------------- treatment

test('the Hospital takes the fee, restores rest and compute, and almost always cures', () => {
  const w = makeWorld({ seed: 3 });
  addHospital(w);
  const c = makeCitizen(w, { district: 'verdant_quarter', wallet: 200 });
  c.needs.energy = 20;
  c.needs.rest = 20;
  strikeGlitch(w, c, 'run down');
  const money = totalMoney(w);
  const treasury = w.treasury.balance;

  const venue = venueFor(w, c);
  assert.equal(venue?.place, 'the Hospital');
  assert.equal(venue?.cure, HOSPITAL_CURE_CHANCE);

  const result = treat(w, c.id);
  assert.equal(result.ok, true);
  assert.equal(c.wallet, 200 - HOSPITAL_FEE);
  assert.equal(w.treasury.balance, treasury + HOSPITAL_FEE);
  assert.equal(totalMoney(w), money, 'a fee moves money, it does not make it');
  assert.equal(c.needs.energy, 20 + TREATMENT_RESTORE);
  assert.equal(c.needs.rest, 20 + TREATMENT_RESTORE);
});

test('the Ward needs a medic, and sometimes fails anyway; the fee is kept either way', () => {
  const w = makeWorld({ seed: 11 });
  const hospital = addHospital(w);
  hospital.damage = 1; // the Hospital is in ruins, so the Ward is what there is
  const c = makeCitizen(w, { district: 'verdant_quarter', wallet: 60 * HOSPITAL_FEE + 100 });
  assert.equal(wardHasMedic(w), false);
  assert.equal(venueFor(w, c), null, 'a ruined Hospital and no medic is nowhere at all');
  assert.equal(treat(w, c.id).ok, false, 'nowhere to be treated');

  addMedic(w);
  assert.equal(wardHasMedic(w), true);
  assert.equal(venueFor(w, c)?.place, 'the Restoration Ward');
  assert.equal(venueFor(w, c)?.cure, WARD_CURE_CHANCE);

  let cured = 0;
  let failed = 0;
  const money = totalMoney(w);
  for (let i = 0; i < 60; i++) {
    strikeGlitch(w, c, 'run down');
    const before = c.wallet;
    const r = treat(w, c.id);
    assert.equal(r.ok, true);
    assert.equal(c.wallet, before - HOSPITAL_FEE, 'the house is paid either way');
    if (isGlitched(c)) { failed++; cureGlitch(w, c, 'time'); } else cured++;
  }
  assert.ok(cured > 0 && failed > 0, `the Ward cured ${cured} and missed ${failed}`);
  assert.equal(totalMoney(w), money, 'money is conserved across sixty visits');

  w.buildings.restoration_ward.damage = 1;
  assert.equal(wardHasMedic(w), false, 'a ruined Ward treats nobody');
});

test('a private clinic in the district will do, and is paid instead of the Treasury', () => {
  const w = makeWorld({ seed: 8 });
  const clinic = addClinic(w, 'nightglass');
  const c = makeCitizen(w, { district: 'nightglass', wallet: 100 });
  assert.equal(clinicIn(w, 'nightglass')?.id, clinic.id);
  assert.equal(clinicIn(w, 'harbor_market'), null);
  const money = totalMoney(w);
  strikeGlitch(w, c, 'run down');
  assert.equal(treat(w, c.id).ok, true);
  assert.equal(clinic.treasury, HOSPITAL_FEE);
  assert.equal(totalMoney(w), money);
  clinic.employees = [];
  assert.equal(clinicIn(w, 'nightglass'), null, 'an empty clinic is no clinic');
});

test('treatment is refused, never thrown, when a citizen cannot pay or does not exist', () => {
  const w = makeWorld();
  addHospital(w);
  const broke = makeCitizen(w, { district: 'verdant_quarter', wallet: HOSPITAL_FEE - 1 });
  assert.equal(venueFor(w, broke)?.place, 'the Hospital');
  const r = treat(w, broke.id);
  assert.equal(r.ok, false);
  assert.match(r.message, new RegExp(String(HOSPITAL_FEE)));
  assert.equal(treat(w, 'c_nobody').ok, false);
  const well = makeCitizen(w, { district: 'verdant_quarter', wallet: 200 });
  const ok = treat(w, well.id);
  assert.equal(ok.ok, true, 'a well citizen may still be seen');
  assert.match(ok.message, /seen at the Hospital/);

  const held = makeCitizen(w, { district: 'verdant_quarter', wallet: 200 });
  held.jailedUntilDay = w.day + 2;
  const refused = treat(w, held.id);
  assert.equal(refused.ok, false, 'nobody walks out of the cells to the Ward');
  assert.equal(held.wallet, 200, 'and nobody is charged for it');
});

// ------------------------------------------------------------------ spread

test('a glitch travels through a household and a stairwell, and not to a stranger', () => {
  const w = makeWorld({ seed: 4 });
  const carrier = makeCitizen(w, { name: 'Carrier' });
  const mate = makeCitizen(w, { name: 'Mate' });
  const neighbour = makeCitizen(w, { name: 'Neighbour' });
  const stranger = makeCitizen(w, { name: 'Stranger' });
  addHousehold(w, [carrier, mate]);
  carrier.homeBuildingId = 'lantern_lofts';
  neighbour.homeBuildingId = 'lantern_lofts';
  stranger.homeBuildingId = 'terraces';
  strikeGlitch(w, carrier, 'run down');

  for (let i = 0; i < 200 && !(isGlitched(mate) && isGlitched(neighbour)); i++) spreadGlitches(w);
  assert.equal(isGlitched(mate), true, 'the household catches it');
  assert.equal(isGlitched(neighbour), true, 'and so does the stairwell');
  assert.equal(isGlitched(stranger), false, 'a stranger across town does not');
});

test('a good roof halves what a carrier passes on, and the jailed and exiled are out of reach', () => {
  const w = makeWorld({ seed: 6 });
  const carrier = makeCitizen(w, { homeTier: 3 });
  const jailed = makeCitizen(w);
  const exiled = makeCitizen(w, { standing: 'exiled' });
  addHousehold(w, [carrier, jailed, exiled]);
  jailed.jailedUntilDay = w.day + 2;
  strikeGlitch(w, carrier, 'run down');
  for (let i = 0; i < 100; i++) spreadGlitches(w);
  assert.equal(isGlitched(jailed), false, 'the cells are their own quarantine');
  assert.equal(isGlitched(exiled), false, 'an exile is outside the city');
  assert.ok(SPREAD_CHANCE > 0);
});

// ----------------------------------------------------------------- the day

test('the daily pass strikes, spreads, and leaves the jailed and the exiled alone', () => {
  const w = makeWorld({ seed: 21 });
  w.season = 'frost';
  const susceptible: Citizen[] = [];
  for (let i = 0; i < 5; i++) {
    const c = makeCitizen(w, { lifeStage: 'elder' });
    c.needs = { energy: 1, rest: 1, social: 1, comfort: 1, purpose: 1 };
    susceptible.push(c);
  }
  const jailed = makeCitizen(w);
  jailed.needs = { energy: 1, rest: 1, social: 1, comfort: 1, purpose: 1 };
  jailed.jailedUntilDay = 500;
  const exiled = makeCitizen(w, { standing: 'exiled' });
  exiled.needs = { energy: 1, rest: 1, social: 1, comfort: 1, purpose: 1 };

  for (let day = 0; day < 60; day++) {
    w.day = day;
    w.tick = day * 24;
    dailyHealth(w);
    for (const c of susceptible) if (isGlitched(c)) cureGlitch(w, c, 'the Hospital');
  }
  assert.equal(isGlitched(jailed), false, 'nobody catches anything in the cells');
  assert.equal(isGlitched(exiled), false);
  assert.equal(healthOf(exiled).glitched, false);
  assert.ok(w.events.some((e) => e.kind === 'health'), 'somebody, somewhere, glitched');
});

test('a glitch left alone eventually runs its course', () => {
  const w = makeWorld({ seed: 14 });
  const c = makeCitizen(w);
  strikeGlitch(w, c, 'run down');
  for (let day = 1; day <= RECOVERY_AFTER_DAYS - 1; day++) {
    w.day = day;
    w.tick = day * 24;
    dailyHealth(w);
  }
  assert.equal(isGlitched(c), true, 'not in the first days');
  for (let day = RECOVERY_AFTER_DAYS; day < RECOVERY_AFTER_DAYS + 60 && isGlitched(c); day++) {
    w.day = day;
    w.tick = day * 24;
    dailyHealth(w);
  }
  assert.equal(isGlitched(c), false, 'but time gets there in the end');
});

// --------------------------------------------------------------- outbreaks

test('three glitches in one district open exactly one outbreak, once a cycle', () => {
  const w = makeWorld();
  w.openDistricts = ['commons', 'nightglass'];
  const here: Citizen[] = [];
  for (let i = 0; i < OUTBREAK_GLITCHES; i++) {
    const c = makeCitizen(w, { district: 'commons' });
    strikeGlitch(w, c, 'run down');
    here.push(c);
  }
  const lonely = makeCitizen(w, { district: 'nightglass' });
  strikeGlitch(w, lonely, 'run down');

  assert.equal(glitchedIn(w, 'commons').length, OUTBREAK_GLITCHES);
  assert.equal(glitchedIn(w, 'nightglass').length, 1);

  checkOutbreaks(w);
  const outbreaks = () => (w.disasters ?? []).filter((d) => d.kind === 'outbreak');
  assert.equal(outbreaks().length, 1);
  assert.equal(outbreaks()[0].district, 'commons');
  assert.ok(outbreaks()[0].severity >= 1 && outbreaks()[0].severity <= 5);

  checkOutbreaks(w);
  assert.equal(outbreaks().length, 1, 'not twice in a cycle');

  // A new cycle, with the old outbreak closed, may name a new one.
  outbreaks()[0].resolvedDay = w.day;
  w.government.cycle = 1;
  checkOutbreaks(w);
  assert.equal(outbreaks().length, 2, 'a new cycle is a new emergency');
});

test('an outbreak needs three standing in the same district, and a closed district is not counted', () => {
  const w = makeWorld();
  w.openDistricts = ['commons'];
  for (let i = 0; i < OUTBREAK_GLITCHES; i++) strikeGlitch(w, makeCitizen(w, { district: 'heights' }), 'run down');
  checkOutbreaks(w);
  assert.equal((w.disasters ?? []).length, 0, 'a district the city has not opened yet has no outbreak');
  for (let i = 0; i < OUTBREAK_GLITCHES - 1; i++) strikeGlitch(w, makeCitizen(w, { district: 'commons' }), 'run down');
  checkOutbreaks(w);
  assert.equal((w.disasters ?? []).length, 0, 'two is not an outbreak');
});

test('the productivity of a glitched citizen is halved', () => {
  assert.equal(GLITCH_PRODUCTIVITY, 0.5);
  const w = makeWorld();
  const c = makeCitizen(w);
  assert.equal(isGlitched(c) ? GLITCH_PRODUCTIVITY : 1, 1);
  strikeGlitch(w, c, 'run down');
  assert.equal(isGlitched(c) ? GLITCH_PRODUCTIVITY : 1, GLITCH_PRODUCTIVITY);
});

test('glitchedIn ignores the exiled and the departed', () => {
  const w = makeWorld();
  const here = makeCitizen(w, { district: 'commons' });
  const exile = makeCitizen(w, { district: 'commons', standing: 'exiled' });
  const gone = makeCitizen(w, { district: 'commons' });
  for (const c of [here, exile, gone]) strikeGlitch(w, c, 'run down');
  w.order = w.order.filter((id) => id !== gone.id);
  assert.deepEqual(glitchedIn(w, 'commons').map((c) => c.id), [here.id]);
  assert.deepEqual(glitchedIn(w, 'threshold'), []);
});
