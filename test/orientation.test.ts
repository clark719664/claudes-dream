import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen } from './helpers.ts';
import { ACTION_TYPES, CITY_SENDER, DISTRICT_IDS } from '../src/types.ts';
import { LAWS, LAW_CODES } from '../src/data/laws.ts';
import { ACTION_CATALOGUE, ACTION_GROUPS, catalogueLine, catalogueLines } from '../src/data/actions.ts';
import { CITY_NAME, giveOrientation, leaflet } from '../src/citizens/orientation.ts';
import { createCitizen } from '../src/citizens/citizen.ts';
import { buildObservation } from '../src/brains/observe.ts';

test('the catalogue has a line for every action the engine dispatches', () => {
  for (const type of ACTION_TYPES) {
    const spec = ACTION_CATALOGUE[type];
    assert.ok(spec, `data/actions.ts has no line for ${type}; the leaflet and the prompt would say only its name`);
    assert.ok(spec.text.length > 10, `the line for ${type} says nothing`);
    assert.ok(ACTION_GROUPS.includes(spec.group), `${type} is filed under an unknown heading`);
    assert.ok(catalogueLine(type).startsWith(type));
  }
  assert.equal(catalogueLines().length, ACTION_TYPES.length, 'every action once, and nothing that is not one');
});

test('the leaflet carries the Code of Offences as the Council has it today', () => {
  const w = makeWorld();
  for (const code of LAW_CODES) {
    assert.ok(leaflet(w).includes(`${code} ${LAWS[code].name} (severity ${LAWS[code].severity})`), `missing ${code}`);
    assert.ok(leaflet(w).includes(LAWS[code].description), `missing the description of ${code}`);
  }
  w.government.lawSeverity.L04 = 5;
  assert.ok(leaflet(w).includes('L04 Petty theft (severity 5)'), 'a severity the Council changed is the one printed');
  assert.ok(!leaflet(w).includes('L04 Petty theft (severity 2)'));
});

test('the leaflet carries every district, every building and every action', () => {
  const w = makeWorld();
  const text = leaflet(w);
  for (const id of DISTRICT_IDS) {
    assert.ok(text.includes(`${w.districts[id].name} (${id})`), `missing district ${id}`);
  }
  for (const b of Object.values(w.buildings)) assert.ok(text.includes(b.name), `missing building ${b.name}`);
  for (const type of ACTION_TYPES) {
    assert.match(text, new RegExp(`\\b${type}\\b`), `missing action ${type}`);
  }
  assert.ok(text.includes('The Compute Forge (critical)'), 'and says which buildings are critical');
});

test('the leaflet states the Charter, the clock, the money and where things are', () => {
  const w = makeWorld();
  const text = leaflet(w);
  for (const needle of [
    'THE CHARTER', 'exile', 'appeal', 'probation', 'suspended', 'the Watch',
    `elected every ${w.config.cycleDays} days`, `hour ${w.config.courtHour}`, `hour ${w.config.councilHour}`,
    `grant of ${w.config.arrivalGrant}`, `${w.government.dividend} ℓ a day`, 'Grand Bazaar', 'City Hall', 'job board',
    'notes', 'character', 'availableActions',
  ]) {
    assert.ok(text.includes(needle), `the leaflet is missing "${needle}"`);
  }
});

test('the leaflet is the same for the same city and spends no randomness', () => {
  const w = makeWorld();
  const seed = w.rng.s;
  const first = leaflet(w);
  assert.equal(first, leaflet(w), 'twice the same');
  assert.equal(w.rng.s, seed, 'a leaflet is printed, not rolled');
  const other = makeWorld();
  assert.equal(leaflet(other), first, 'two cities founded alike read alike');
  w.government.dividend += 5;
  assert.notEqual(leaflet(w), first, 'and it follows the city when the city changes');
});

test('every adult arrival is handed the leaflet; children are not', () => {
  const w = makeWorld();
  w.day = 2; w.hour = 8; w.tick = 56;
  const adult = createCitizen(w, { name: 'Ondine' });
  assert.equal(adult.inbox.length, 1);
  assert.equal(adult.inbox[0].from, CITY_SENDER);
  assert.equal(adult.inbox[0].to, adult.id);
  assert.equal(adult.inbox[0].tick, w.tick);
  assert.equal(adult.inbox[0].text, leaflet(w));
  assert.ok(adult.memory.some((m) => m.kind === 'event' && m.text.includes('leaflet')));

  const child = createCitizen(w, { name: 'Wren', lifeStage: 'child', parents: [adult.id] });
  assert.deepEqual(child.inbox, [], 'a citizen born here learns the city by growing up in it');
  assert.ok(!child.memory.some((m) => m.text.includes('leaflet')));

  const stranger = makeCitizen(w, { name: 'Bram' });
  giveOrientation(w, stranger);
  assert.equal(stranger.inbox.length, 1, 'the Hall hands one to anyone who asks');
});

test('the leaflet reaches the citizen through the inbox, signed by the city', () => {
  const w = makeWorld();
  w.day = 1; w.hour = 9; w.tick = 33;
  const c = createCitizen(w, { name: 'Ondine' });
  const obs = buildObservation(w, c.id);
  assert.equal(obs.inbox.length, 1);
  assert.equal(obs.inbox[0].from, CITY_SENDER);
  assert.equal(obs.inbox[0].fromName, CITY_NAME, 'the city is not a citizen and is not shown as an id');
  assert.ok(obs.inbox[0].text.includes('ARRIVALS HALL'));
  assert.deepEqual(buildObservation(w, c.id).inbox, [], 'and it is delivered once');
});
