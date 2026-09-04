/**
 * Neighbours (src/social/neighbours.ts).
 *
 * Who shares your stairs, what that is worth, and the Stillday block party.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Happening, World } from '../src/types.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import {
  BLOCK_PARTY_BOND, BLOCK_PARTY_COMFORT, BLOCK_PARTY_HOUR, BLOCK_PARTY_SOCIAL, BLOCK_PARTY_WEEKDAY,
  NEIGHBOUR_BOND, NEIGHBOUR_BOND_CAP,
  dailyNeighbours, holdBlockParty, neighboursOf, residentsOf, scheduleBlockParties, tellNeighbours,
} from '../src/social/neighbours.ts';

const LOFTS = 'lantern_lofts';
const TERRACES = 'terraces';

function partyAt(world: World, buildingId: string): Happening | undefined {
  return world.happenings.find((h) => h.kind === 'block_party' && h.buildingId === buildingId);
}

// ----------------------------------------------------------------- who is who

test('neighbours are exactly the other citizens of the same block', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { name: 'Ondine', homeBuildingId: LOFTS });
  const b = makeCitizen(w, { name: 'Bram', homeBuildingId: LOFTS });
  const other = makeCitizen(w, { name: 'Wren', homeBuildingId: TERRACES });
  const homeless = makeCitizen(w, { name: 'Ivo', homeBuildingId: null });

  assert.deepEqual(neighboursOf(w, a.id).map((c) => c.id), [b.id]);
  assert.deepEqual(neighboursOf(w, b.id).map((c) => c.id), [a.id]);
  assert.deepEqual(neighboursOf(w, other.id), [], 'alone in the Terraces');
  assert.deepEqual(neighboursOf(w, homeless.id), [], 'a citizen with no home has no neighbours');
  assert.deepEqual(neighboursOf(w, 'c_nobody'), []);
  assert.equal(residentsOf(w, LOFTS).length, 2);
  assert.deepEqual(residentsOf(w, null), []);
});

test('an exile is nobody’s neighbour any more', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { homeBuildingId: LOFTS });
  const gone = makeCitizen(w, { homeBuildingId: LOFTS, standing: 'exiled' });
  assert.deepEqual(neighboursOf(w, a.id), []);
  assert.deepEqual(neighboursOf(w, gone.id), []);
});

// ---------------------------------------------------------------- the daily bond

test('living alongside somebody is worth a point a day, up to the ceiling', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { homeBuildingId: LOFTS });
  const b = makeCitizen(w, { homeBuildingId: LOFTS });
  dailyNeighbours(w);
  assert.equal(a.bonds[b.id], NEIGHBOUR_BOND);
  assert.equal(b.bonds[a.id], NEIGHBOUR_BOND);
  for (let day = 0; day < NEIGHBOUR_BOND_CAP + 10; day++) dailyNeighbours(w);
  assert.equal(a.bonds[b.id], NEIGHBOUR_BOND_CAP, 'the stairwell only takes you so far');
  assert.equal(b.bonds[a.id], NEIGHBOUR_BOND_CAP);
});

test('a bond already above the ceiling is left exactly where it is', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { homeBuildingId: LOFTS });
  const b = makeCitizen(w, { homeBuildingId: LOFTS });
  a.bonds[b.id] = 80;
  b.bonds[a.id] = -70;
  dailyNeighbours(w);
  assert.equal(a.bonds[b.id], 80, 'friends are not levelled down');
  assert.equal(b.bonds[a.id], -70 + NEIGHBOUR_BOND, 'and a cold neighbour warms one point at a time');
});

test('a citizen living alone gains nothing, and an empty city is safe', () => {
  const w = makeWorld();
  const alone = makeCitizen(w, { homeBuildingId: LOFTS });
  assert.doesNotThrow(() => dailyNeighbours(w));
  assert.deepEqual(alone.bonds, {});
});

// -------------------------------------------------------------- block parties

test('a block party is scheduled on Stillday only, and only where two or more live', () => {
  const w = makeWorld();
  makeCitizen(w, { homeBuildingId: LOFTS });
  makeCitizen(w, { homeBuildingId: LOFTS });
  makeCitizen(w, { homeBuildingId: TERRACES });
  makeCitizen(w, { homeBuildingId: null });

  w.day = BLOCK_PARTY_WEEKDAY - 1;
  scheduleBlockParties(w);
  assert.equal(w.happenings.length, 0, 'not on a Marketday');

  w.day = BLOCK_PARTY_WEEKDAY;
  scheduleBlockParties(w);
  assert.equal(w.happenings.length, 1, 'one party, at the block with two residents');
  const h = partyAt(w, LOFTS);
  assert.ok(h);
  assert.equal(h.hour, BLOCK_PARTY_HOUR);
  assert.equal(h.day, w.day);
  assert.equal(h.district, 'verdant_quarter');
  assert.equal(h.who.length, 2);
  assert.equal(partyAt(w, TERRACES), undefined, 'one resident is not a party');

  scheduleBlockParties(w);
  assert.equal(w.happenings.length, 1, 'scheduling twice in a day changes nothing');
});

test('a block party raises social and comfort, and binds the block a little', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { homeBuildingId: LOFTS, district: 'verdant_quarter' });
  const b = makeCitizen(w, { homeBuildingId: LOFTS, district: 'verdant_quarter' });
  const away = makeCitizen(w, { homeBuildingId: LOFTS, district: 'harbor_market' });
  for (const c of [a, b, away]) { c.needs.social = 40; c.needs.comfort = 40; }

  w.day = BLOCK_PARTY_WEEKDAY;
  scheduleBlockParties(w);
  const h = partyAt(w, LOFTS);
  assert.ok(h);
  holdBlockParty(w, h);

  assert.equal(a.needs.social, 40 + BLOCK_PARTY_SOCIAL);
  assert.equal(a.needs.comfort, 40 + BLOCK_PARTY_COMFORT);
  assert.equal(b.needs.social, 40 + BLOCK_PARTY_SOCIAL);
  assert.equal(away.needs.social, 40, 'a neighbour across the city misses it');
  assert.equal(a.bonds[b.id], BLOCK_PARTY_BOND);
  assert.equal(a.contactsToday[b.id], 1);
  assert.deepEqual([...h.attendees].sort(), [a.id, b.id].sort());
  assert.ok(w.events.some((e) => e.kind === 'festival' && e.text.includes('block party')));
  assert.ok(a.memory.some((m) => m.text.includes('block party')));
});

test('a neighbour who came especially is counted, wherever they live', () => {
  const w = makeWorld();
  const host = makeCitizen(w, { homeBuildingId: LOFTS, district: 'verdant_quarter' });
  const guest = makeCitizen(w, { homeBuildingId: TERRACES, district: 'nightglass' });
  w.day = BLOCK_PARTY_WEEKDAY;
  makeCitizen(w, { homeBuildingId: LOFTS, district: 'verdant_quarter' });
  scheduleBlockParties(w);
  const h = partyAt(w, LOFTS);
  assert.ok(h);
  h.attendees.push(guest.id);
  guest.needs.social = 30;
  holdBlockParty(w, h);
  assert.equal(guest.needs.social, 30 + BLOCK_PARTY_SOCIAL);
  assert.ok(host.bonds[guest.id] >= BLOCK_PARTY_BOND);
});

test('a party nobody came to is held, quietly, and throws nothing', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { homeBuildingId: LOFTS, district: 'verdant_quarter' });
  const b = makeCitizen(w, { homeBuildingId: LOFTS, district: 'verdant_quarter' });
  w.day = BLOCK_PARTY_WEEKDAY;
  scheduleBlockParties(w);
  const h = partyAt(w, LOFTS);
  assert.ok(h);
  a.district = 'threshold';
  b.district = 'threshold';
  assert.doesNotThrow(() => holdBlockParty(w, h));
  assert.ok(w.events.some((e) => e.kind === 'festival' && e.text.includes('called off')));
});

test('a citizen in the Watch House misses the party on their own landing', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { homeBuildingId: LOFTS, district: 'verdant_quarter' });
  const held = makeCitizen(w, { homeBuildingId: LOFTS, district: 'verdant_quarter' });
  held.detainedUntilTick = w.tick + 5;
  held.needs.social = 40;
  w.day = BLOCK_PARTY_WEEKDAY;
  scheduleBlockParties(w);
  const h = partyAt(w, LOFTS);
  assert.ok(h);
  holdBlockParty(w, h);
  assert.equal(held.needs.social, 40);
  assert.equal(h.attendees.includes(a.id), true);
  assert.equal(h.attendees.includes(held.id), false);
});

// ----------------------------------------------------------------- telling them

test('the block hears the news, and an empty block hears nothing', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { homeBuildingId: LOFTS });
  const b = makeCitizen(w, { homeBuildingId: LOFTS });
  const alone = makeCitizen(w, { homeBuildingId: TERRACES });
  const homeless = makeCitizen(w, { homeBuildingId: null });

  tellNeighbours(w, a.id, 'The Watch came to the door.');
  assert.ok(b.memory.some((m) => m.text === 'The Watch came to the door.'));
  assert.equal(a.memory.length, 0, 'you are not told your own news');

  tellNeighbours(w, alone.id, 'A child was born.');
  tellNeighbours(w, homeless.id, 'A child was born.');
  tellNeighbours(w, 'c_nobody', 'Anything.');
  tellNeighbours(w, a.id, '   ');
  assert.equal(b.memory.length, 1, 'nothing empty, nothing from nowhere');
});
