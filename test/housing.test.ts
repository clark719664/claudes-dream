import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import {
  CELLS_RENT, addHousingProgress, addressName, cellsOpen, comfortDecayMultiplier, dailyHousing,
  evict, inTheCells, moveHome, moveHomeTo, rentOf, takeBunk, vacancies,
} from '../src/economy/housing.ts';
import { SUSPENDED_ACTIONS } from '../src/types.ts';
import { availableActions, executeAction } from '../src/actions/execute.ts';
import { createHousehold, householdOf, joinHousehold } from '../src/society/households.ts';
import { openDistrict } from '../src/world/growth.ts';
import { landValue } from '../src/economy/land.ts';

test('vacancies reflect capacity minus occupancy', () => {
  const w = makeWorld();
  assert.deepEqual(vacancies(w), { 1: 30, 2: 15, 3: 5 });
  w.housing.occupied[1] = 30;
  w.housing.occupied[3] = 7; // over-occupied never goes negative
  assert.deepEqual(vacancies(w), { 1: 0, 2: 15, 3: 0 });
});

test('moveHome moves in, between tiers and out, adjusting occupancy and arrears', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  const res = moveHome(w, c.id, 1);
  assert.equal(res.ok, true, res.message);
  assert.equal(c.homeTier, 1);
  assert.equal(w.housing.occupied[1], 1);
  // a home is an address, not a tier: the memory names the block they got
  const address = addressName(w, c);
  assert.ok(c.memory.some((m) => m.text.includes(address)), address);

  c.rentArrearsDays = 2;
  assert.equal(moveHome(w, c.id, 3).ok, true);
  assert.equal(c.homeTier, 3);
  assert.equal(c.rentArrearsDays, 0);
  assert.deepEqual(w.housing.occupied, { 1: 0, 2: 0, 3: 1 });

  assert.equal(moveHome(w, c.id, 0).ok, true);
  assert.equal(c.homeTier, 0);
  assert.deepEqual(w.housing.occupied, { 1: 0, 2: 0, 3: 0 });
  assert.ok(w.events.some((e) => e.kind === 'housing'));
});

test('moveHome refuses when full, when already there, for exiles and unknown citizens', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  w.housing.capacity[2] = 0;
  assert.equal(moveHome(w, c.id, 2).ok, false);
  assert.equal(moveHome(w, c.id, 0).ok, false); // no home to leave
  moveHome(w, c.id, 1);
  assert.equal(moveHome(w, c.id, 1).ok, false);
  assert.equal(c.homeTier, 1);
  const ex = makeCitizen(w, { standing: 'exiled' });
  assert.equal(moveHome(w, ex.id, 1).ok, false);
  assert.equal(moveHome(w, 'c_404', 1).ok, false);
  assert.equal(w.housing.occupied[1], 1);
});

test('evict frees the unit, dents comfort and is remembered', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  moveHome(w, c.id, 2);
  evict(w, c.id, 'unpaid rent');
  assert.equal(c.homeTier, 0);
  assert.equal(w.housing.occupied[2], 0);
  assert.equal(c.needs.comfort, 70);
  const ev = w.events.find((e) => e.kind === 'eviction');
  assert.ok(ev && ev.actors.includes(c.id));
  assert.ok(c.memory.some((m) => m.text.includes('evicted')));
  evict(w, c.id, 'again'); // homeless already: no-op
  assert.equal(w.events.filter((e) => e.kind === 'eviction').length, 1);
});

test('addHousingProgress builds tiers in rotation 1 → 2 → 3 → 1', () => {
  const w = makeWorld();
  addHousingProgress(w, 60);
  assert.deepEqual(w.housing.capacity, { 1: 30, 2: 15, 3: 5 });
  addHousingProgress(w, 40);
  assert.deepEqual(w.housing.capacity, { 1: 31, 2: 15, 3: 5 });
  assert.equal(w.housing.progress, 0);
  addHousingProgress(w, 250);
  assert.deepEqual(w.housing.capacity, { 1: 31, 2: 16, 3: 5 });
  addHousingProgress(w, 650);
  assert.deepEqual(w.housing.capacity, { 1: 31, 2: 16, 3: 6 });
  assert.equal(w.housing.progress, 50);
  addHousingProgress(w, 50);
  assert.deepEqual(w.housing.capacity, { 1: 32, 2: 16, 3: 6 });
  assert.equal(w.events.filter((e) => e.kind === 'housing').length, 4);
  addHousingProgress(w, -10);
  addHousingProgress(w, Number.NaN);
  assert.equal(w.housing.progress, 0);
});

test('a large progress windfall completes several units at once', () => {
  const w = makeWorld();
  addHousingProgress(w, 100 + 250 + 600 + 100 + 30);
  assert.deepEqual(w.housing.capacity, { 1: 32, 2: 16, 3: 6 });
  assert.equal(w.housing.progress, 30);
});

test('dailyHousing collects rent, tracks arrears, evicts after three days and conserves money', () => {
  const w = makeWorld();
  const payer = makeCitizen(w, { wallet: 100 });
  const broke = makeCitizen(w, { wallet: 3 });
  const homeless = makeCitizen(w, { wallet: 50 });
  const exiled = makeCitizen(w, { wallet: 50, standing: 'exiled' });
  moveHome(w, payer.id, 2);
  moveHome(w, broke.id, 1);
  moveHome(w, exiled.id, 1);
  exiled.standing = 'exiled';
  const before = totalMoney(w);
  const t0 = w.treasury.balance;

  const rent2 = rentOf(w, payer);
  const rent1 = rentOf(w, broke);
  assert.ok(rent2 > rent1, 'a terrace costs more than a loft');
  assert.ok(rent1 > 3, 'and more than the broke citizen has');

  dailyHousing(w);
  assert.equal(payer.wallet, 100 - rent2);
  assert.equal(payer.needs.comfort, 85);
  assert.equal(w.treasury.balance, t0 + rent2);
  assert.equal(w.treasury.totals.rent, rent2);
  assert.equal(broke.wallet, 3);
  assert.equal(broke.rentArrearsDays, 1);
  assert.equal(homeless.wallet, 50);
  assert.equal(exiled.homeTier, 0); // exiles are quietly vacated, not charged
  assert.equal(totalMoney(w), before);

  dailyHousing(w);
  assert.equal(broke.rentArrearsDays, 2);
  assert.equal(broke.homeTier, 1);
  dailyHousing(w);
  assert.equal(broke.homeTier, 0);
  assert.equal(broke.rentArrearsDays, 0);
  assert.ok(w.events.some((e) => e.kind === 'eviction' && e.actors.includes(broke.id)));
  assert.equal(w.housing.occupied[1], 0);
  assert.equal(totalMoney(w), before);

  // a windfall clears arrears
  const late = makeCitizen(w, { wallet: 0 });
  moveHome(w, late.id, 1);
  dailyHousing(w);
  assert.equal(late.rentArrearsDays, 1);
  late.wallet = 40;
  const lateRent = rentOf(w, late);
  dailyHousing(w);
  assert.equal(late.rentArrearsDays, 0);
  assert.equal(late.wallet, 40 - lateRent);
});

test('dailyHousing quietly frees the homes of emigrants without charging or evicting them', () => {
  const w = makeWorld();
  const gone = makeCitizen(w, { wallet: 100 });
  moveHome(w, gone.id, 1);
  w.order = w.order.filter((id) => id !== gone.id);
  dailyHousing(w);
  assert.equal(gone.homeTier, 0);
  assert.equal(gone.wallet, 100);
  assert.equal(w.housing.occupied[1], 0);
  assert.equal(w.events.filter((e) => e.kind === 'eviction').length, 0);
});

test('comfortDecayMultiplier matches the housing table', () => {
  assert.equal(comfortDecayMultiplier(0), 2.0);
  assert.equal(comfortDecayMultiplier(1), 1.0);
  assert.equal(comfortDecayMultiplier(2), 0.7);
  assert.equal(comfortDecayMultiplier(3), 0.4);
});

test('a housemate who moves out on their own does not take the household\'s unit with them', () => {
  const w = makeWorld();
  const host = makeCitizen(w, { name: 'Ondine' });
  const lodger = makeCitizen(w, { name: 'Bram' });
  assert.equal(moveHome(w, host.id, 2).ok, true);
  assert.equal(w.housing.occupied[2], 1, 'one roof, one unit');
  const h = createHousehold(w, host.id);
  assert.equal(joinHousehold(w, lodger.id, host.id).ok, true);
  assert.equal(lodger.homeTier, 2);
  assert.equal(w.housing.occupied[2], 1, 'moving in shares the unit, it does not take a second');

  // The lodger takes a place of their own: the household keeps its unit.
  assert.equal(moveHome(w, lodger.id, 1).ok, true);
  assert.equal(w.housing.occupied[2], 1, 'the household still holds its unit');
  assert.equal(w.housing.occupied[1], 1, 'and the mover holds a new one');
  assert.equal(lodger.householdId, null, 'they are off the old household');
  assert.equal(householdOf(w, lodger.id), null);
  assert.deepEqual(h.members, [host.id]);

  // And when the last of them leaves, the unit comes back.
  assert.equal(moveHome(w, host.id, 0).ok, true);
  assert.equal(w.housing.occupied[2], 0);
  assert.equal(w.households[h.id], undefined, 'the household is dissolved with the last member out');
});

test('occupancy tracks roofs, not heads, however people move', () => {
  const w = makeWorld();
  const people = [makeCitizen(w), makeCitizen(w), makeCitizen(w), makeCitizen(w)];
  for (const p of people) assert.equal(moveHome(w, p.id, 1).ok, true);
  assert.equal(w.housing.occupied[1], 4);
  createHousehold(w, people[0].id);
  assert.equal(joinHousehold(w, people[1].id, people[0].id).ok, true);
  assert.equal(w.housing.occupied[1], 3, 'two under one roof hold one unit');

  assert.equal(moveHome(w, people[1].id, 3).ok, true);
  assert.equal(moveHome(w, people[2].id, 0).ok, true);
  const roofs = new Set<string>();
  for (const c of Object.values(w.citizens)) {
    if (!c.homeTier) continue;
    roofs.add(`${c.homeTier}:${c.householdId ?? c.id}`);
  }
  const counted = w.housing.occupied[1] + w.housing.occupied[2] + w.housing.occupied[3];
  assert.equal(counted, roofs.size, 'the register counts exactly the roofs that are lived under');
});

// ---------------------------------------------------------------------------
// Addresses: every district has a stock, and they do not cost the same
// ---------------------------------------------------------------------------

test('a home is an address: the same tier costs different rents in different districts', () => {
  const w = makeWorld();
  const cheap = makeCitizen(w, { homeTier: 1, homeBuildingId: 'forge_cottages' });
  const dear = makeCitizen(w, { homeTier: 1, homeBuildingId: 'lantern_lofts' });
  assert.ok(rentOf(w, cheap) < rentOf(w, dear), 'backing onto the Forge is cheaper than the Garden');
  assert.ok(rentOf(w, cheap) > 0);

  // and the rent follows the land: a district the city has ruined gets cheaper
  const before = rentOf(w, dear);
  for (const b of Object.values(w.buildings)) if (b.district === 'verdant_quarter') b.damage = 1;
  w.day += 1;
  assert.ok(rentOf(w, dear) <= before, 'a district in ruins does not let for more');
});

test('a citizen may name a district, and is housed there if anything in it is free', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  const r = moveHomeTo(w, c.id, 1, 'foundry_row');
  assert.equal(r.ok, true, r.message);
  assert.equal(c.homeTier, 1);
  assert.equal(w.buildings[c.homeBuildingId ?? '']?.district, 'foundry_row');

  // asking for a district with nothing free in it still gets a roof somewhere
  const other = makeCitizen(w);
  assert.equal(moveHomeTo(w, other.id, 3, 'threshold').ok, true);
  assert.equal(other.homeTier, 3);
  assert.ok(other.homeBuildingId);
});

test('rent tracks the land: a monument in the Commons lifts the rent of Civic Chambers', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { homeTier: 2, homeBuildingId: 'civic_chambers' });
  const before = rentOf(w, c);
  for (let i = 0; i < 6; i++) w.monuments.push({ id: `m_${i}`, honoreeId: c.id, inscription: 'For the city', day: 0 });
  w.day += 1;
  assert.ok(rentOf(w, c) > before, `${rentOf(w, c)} should beat ${before}`);
});

// ---------------------------------------------------------------------------
// The Cells: the floor under the city
// ---------------------------------------------------------------------------

test('the Cells take anyone the city has no room for, and are never a vacancy', () => {
  const w = makeWorld();
  for (let i = 0; i < 3; i++) makeCitizen(w);
  assert.equal(cellsOpen(w), false, 'until the Undercroft opens there is no floor');
  openDistrict(w, 'undercroft');
  assert.equal(cellsOpen(w), true);

  // fill the city's own tier-1 rooms
  w.housing.occupied[1] = w.housing.capacity[1];
  assert.equal(vacancies(w)[1], 0);

  const homeless = makeCitizen(w, { wallet: 10 });
  const capacity = w.housing.capacity[1];
  const r = moveHome(w, homeless.id, 1);
  assert.equal(r.ok, true, r.message);
  assert.equal(inTheCells(homeless), true, 'nobody is turned away');
  assert.equal(homeless.homeTier, 1);
  assert.equal(rentOf(w, homeless), CELLS_RENT);
  assert.equal(w.housing.capacity[1], capacity + 1, 'a bunk is made up for them');
  assert.equal(vacancies(w)[1], 0, 'and it is never a room somebody else could have had');
  assert.ok(w.housing.occupied[1] <= w.housing.capacity[1]);

  // and folded away again when they leave
  assert.equal(moveHome(w, homeless.id, 0).ok, true);
  assert.equal(w.housing.capacity[1], capacity);
  assert.equal(vacancies(w)[1], 0);
});

test('a suspension takes a citizen\'s work and trade, not the roof over its head', () => {
  const w = makeWorld();
  for (let i = 0; i < 3; i++) makeCitizen(w);
  const banned = makeCitizen(w, { wallet: 60 });
  banned.standing = 'suspended';
  banned.suspendedUntilDay = w.day + 10;

  // The Charter takes work, trade, the vote and office (`CONSTITUTION.md` §92).
  assert.ok(!SUSPENDED_ACTIONS.includes('work'));
  assert.ok(!SUSPENDED_ACTIONS.includes('buy_property'));
  // It does not take a room: a citizen who may buy its dinner may rent the
  // place it eats it in, and the Cells turn nobody away (`PROPERTY.md` §3).
  assert.ok(SUSPENDED_ACTIONS.includes('move_home'));
  assert.ok(availableActions(w, banned).includes('move_home'), 'a suspended citizen was offered no roof');

  const took = executeAction(w, banned.id, { type: 'move_home', tier: 1 });
  assert.equal(took.ok, true, took.message);
  assert.equal(banned.homeTier, 1);

  // And when the city's own rooms are full, the floor under it still holds.
  assert.equal(executeAction(w, banned.id, { type: 'move_home', tier: 0 }).ok, true);
  openDistrict(w, 'undercroft');
  w.housing.occupied[1] = w.housing.capacity[1];
  const bunked = executeAction(w, banned.id, { type: 'move_home', tier: 1 });
  assert.equal(bunked.ok, true, bunked.message);
  assert.equal(inTheCells(banned), true, 'a suspension is not a sentence of sleeping in the street');
});

test('a bunk costs three lumens a day and nobody is ever put out of one', () => {
  const w = makeWorld();
  for (let i = 0; i < 3; i++) makeCitizen(w);
  openDistrict(w, 'undercroft');
  const skint = makeCitizen(w, { wallet: CELLS_RENT });
  assert.equal(takeBunk(w, skint.id).ok, true);
  assert.equal(takeBunk(w, skint.id).ok, false, 'you cannot take two bunks');

  const before = totalMoney(w);
  dailyHousing(w);
  assert.equal(skint.wallet, 0);
  assert.equal(skint.rentArrearsDays, 0);
  assert.equal(totalMoney(w), before);

  for (let day = 0; day < 5; day++) { w.day += 1; dailyHousing(w); }
  assert.equal(inTheCells(skint), true, 'five days in arrears and still under a roof');
  assert.ok(skint.rentArrearsDays >= 3);
  assert.equal(w.events.filter((e) => e.kind === 'eviction' && e.actors.includes(skint.id)).length, 0);
  assert.equal(totalMoney(w), before, 'and not a lumen made or lost');
});

test('a bunk is worse than a room and better than the street', () => {
  const w = makeWorld();
  for (let i = 0; i < 3; i++) makeCitizen(w);
  openDistrict(w, 'undercroft');
  const c = makeCitizen(w);
  takeBunk(w, c.id);
  assert.equal(comfortDecayMultiplier(c.homeTier, 1.6), 1.6);
  assert.ok(comfortDecayMultiplier(1, 1.6) < comfortDecayMultiplier(0), 'better than the street');
  assert.ok(comfortDecayMultiplier(1, 1.6) > comfortDecayMultiplier(1), 'worse than a room of your own');

  // a room of their own is an upgrade a citizen may take at any time
  assert.equal(moveHome(w, c.id, 1).ok, true);
  assert.equal(inTheCells(c), false);
  assert.equal(c.homeTier, 1);
  assert.equal(w.counters.cellBunks, 0);
});

test('the bunk count repairs itself however else the city moved somebody', () => {
  const w = makeWorld();
  for (let i = 0; i < 3; i++) makeCitizen(w);
  openDistrict(w, 'undercroft');
  const c = makeCitizen(w);
  takeBunk(w, c.id);
  const capacity = w.housing.capacity[1];
  // something else in the city puts them on the street without telling housing
  c.homeTier = 0;
  c.homeBuildingId = null;
  w.housing.occupied[1] = Math.max(0, w.housing.occupied[1] - 1);
  dailyHousing(w);
  assert.equal(w.counters.cellBunks, 0);
  assert.equal(w.housing.capacity[1], capacity - 1, 'the bunk was folded away with them');
  assert.ok(w.housing.occupied[1] <= w.housing.capacity[1]);
});

test('land value moves rents but never mints a lumen', () => {
  const w = makeWorld();
  const people = [0, 1, 2, 3, 4].map(() => makeCitizen(w, { wallet: 500 }));
  for (const p of people) moveHome(w, p.id, 1);
  const before = totalMoney(w);
  for (let day = 0; day < 6; day++) {
    w.day += 1;
    if (day === 2) w.monuments.push({ id: 'm_1', honoreeId: people[0].id, inscription: 'For the city', day: w.day });
    dailyHousing(w);
    assert.equal(totalMoney(w), before, `day ${day}`);
  }
  assert.ok(landValue(w, 'commons') > 0);
});
