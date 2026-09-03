import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, Club, Household, World } from '../src/types.ts';
import { BIRTHDAY_EVERY, CHILDHOOD_DAYS, CHILD_UPKEEP_PER_PARENT, ELDER_DAYS } from '../src/data/catalogue.ts';
import { nextId } from '../src/util/ids.ts';
import { adjustBond, bondBetween } from '../src/citizens/relationships.ts';
import { emigrate } from '../src/citizens/citizen.ts';
import { exileCitizen } from '../src/government/registry.ts';
import { fileCharge, selectBench } from '../src/government/court.ts';
import { moveIn } from '../src/society/households.ts';
import { tickHappenings } from '../src/society/calendar.ts';
import {
  BIRTHDAY_GIFT, BIRTHDAY_HOUR, BIRTH_BOND, BIRTH_HOUR, ELDER_REPUTATION, FAMILY_BOND_FLOOR, SIBLING_BOND,
  START_FAMILY_BOND, WARD_UPKEEP, areFamily, birthChild, dailyBirthdays, dailyLifeStages, dailyUpkeep, familyBondFloor,
  familyOf, holdBirthday, inheritance, severSocialTies, startFamily, wardship,
} from '../src/society/family.ts';

function addHousehold(w: World, members: string[], tier: 1 | 2 | 3 = 2): Household {
  const h: Household = { id: nextId(w, 'h'), headId: members[0], members: [...members], tier, createdDay: w.day };
  w.households[h.id] = h;
  w.housing.occupied[tier] += 1;
  for (const id of members) {
    w.citizens[id].householdId = h.id;
    w.citizens[id].homeTier = tier;
  }
  return h;
}

function addClub(w: World, members: string[]): Club {
  const club: Club = {
    id: nextId(w, 'u'), name: 'Lantern Ensemble', hobby: 'music', founderId: members[0], convenorId: members[0],
    members: [...members], foundedDay: w.day, meetsOnWeekday: 2,
  };
  w.clubs[club.id] = club;
  for (const id of members) w.citizens[id].clubs.push(club.id);
  return club;
}

/** Two partners who share a home, close enough and rich enough to start a family. */
function household(w: World, opts: { tier?: 1 | 2 | 3; bond?: number; married?: boolean } = {}): { a: Citizen; b: Citizen; home: Household } {
  const a = makeCitizen(w, { name: 'Ondine', familyName: 'Ashgrove', district: 'verdant_quarter' });
  const b = makeCitizen(w, { name: 'Bram', familyName: 'Ashgrove', district: 'verdant_quarter' });
  a.family.partnerId = b.id;
  b.family.partnerId = a.id;
  a.family.partnerSinceDay = 0;
  b.family.partnerSinceDay = 0;
  a.family.married = opts.married ?? true;
  b.family.married = opts.married ?? true;
  adjustBond(w, a.id, b.id, opts.bond ?? START_FAMILY_BOND + 5);
  const home = addHousehold(w, [a.id, b.id], opts.tier ?? 2);
  return { a, b, home };
}

/** The citizen born during a test: whoever was added last. */
function newest(w: World): Citizen {
  const ids = Object.keys(w.citizens);
  return w.citizens[ids[ids.length - 1]];
}

// ---------------------------------------------------------------------------
// Kinship
// ---------------------------------------------------------------------------

test('familyOf lists partners, parents, children and siblings, once each', () => {
  const w = makeWorld();
  const parent = makeCitizen(w, { name: 'Ondine' });
  const other = makeCitizen(w, { name: 'Bram' });
  const kid = makeCitizen(w, { name: 'Wren', lifeStage: 'child' });
  const sibling = makeCitizen(w, { name: 'Fen', lifeStage: 'child' });
  const stranger = makeCitizen(w, { name: 'Vale' });
  parent.family.partnerId = other.id;
  other.family.partnerId = parent.id;
  parent.family.children = [kid.id, sibling.id];
  kid.family.parents = [parent.id];
  sibling.family.parents = [parent.id];

  assert.deepEqual(familyOf(w, parent.id), [
    { id: other.id, relation: 'partner' },
    { id: kid.id, relation: 'child' },
    { id: sibling.id, relation: 'child' },
  ]);
  parent.family.married = true;
  assert.equal(familyOf(w, parent.id)[0].relation, 'spouse');
  assert.deepEqual(familyOf(w, kid.id), [
    { id: parent.id, relation: 'parent' },
    { id: sibling.id, relation: 'sibling' },
  ]);
  assert.deepEqual(familyOf(w, 'c_999'), []);

  assert.equal(areFamily(w, kid.id, sibling.id), true);
  assert.equal(areFamily(w, parent.id, kid.id), true);
  assert.equal(areFamily(w, kid.id, parent.id), true);
  assert.equal(areFamily(w, parent.id, stranger.id), false);
  assert.equal(areFamily(w, parent.id, parent.id), false);
});

test('family bonds never fall below the floor', () => {
  const w = makeWorld();
  const { a, b } = household(w);
  const stranger = makeCitizen(w, { name: 'Vale' });
  adjustBond(w, a.id, b.id, -200);
  adjustBond(w, a.id, stranger.id, 5);
  assert.ok(bondBetween(w, a.id, b.id) < 0);

  familyBondFloor(w);
  assert.equal(bondBetween(w, a.id, b.id), FAMILY_BOND_FLOOR);
  assert.equal(bondBetween(w, b.id, a.id), FAMILY_BOND_FLOOR);
  assert.equal(bondBetween(w, a.id, stranger.id), 5, 'strangers are on their own');
});

// ---------------------------------------------------------------------------
// Starting a family
// ---------------------------------------------------------------------------

test('a family is started by partners who share a home, a bond and savings', () => {
  const w = makeWorld();
  const { a, b } = household(w, { tier: 1 });
  a.wallet = 100;
  b.wallet = 100;
  assert.match(startFamily(w, a.id).message, /200 ℓ between you/);
  a.wallet = 300;
  b.wallet = 200;

  adjustBond(w, a.id, b.id, -20);
  assert.match(startFamily(w, a.id).message, new RegExp(`more than ${START_FAMILY_BOND}`));
  adjustBond(w, a.id, b.id, 20);

  const r = startFamily(w, a.id);
  assert.equal(r.ok, true, r.message);
  const h = w.happenings.find((x) => x.kind === 'birth');
  assert.ok(h);
  assert.equal(h.day, w.day + 1);
  assert.equal(h.hour, BIRTH_HOUR);
  assert.equal(h.buildingId, 'restoration_ward');
  assert.equal(h.district, 'verdant_quarter');
  assert.deepEqual(h.who, [a.id, b.id]);
  assert.match(startFamily(w, a.id).message, /already expecting/);
  assert.equal(w.happenings.filter((x) => x.kind === 'birth').length, 1);
});

test('a family takes two partners under one roof', () => {
  const w = makeWorld();
  const alone = makeCitizen(w, { name: 'Vale' });
  assert.match(startFamily(w, alone.id).message, /takes two/);

  const { a, b } = household(w);
  b.householdId = null;
  assert.match(startFamily(w, a.id).message, /do not share a home/);
  b.householdId = w.households[Object.keys(w.households)[0]].id;

  a.standing = 'suspended';
  assert.match(startFamily(w, a.id).message, /while suspended/);
  a.standing = 'good';
  a.lifeStage = 'child';
  assert.match(startFamily(w, a.id).message, /Children do not/);
});

// ---------------------------------------------------------------------------
// Birth
// ---------------------------------------------------------------------------

test('a child is born with blended traits, an inherited talent and a place at home', () => {
  const w = makeWorld();
  const { a, b, home } = household(w);
  for (const p of [a, b]) {
    p.personality.curiosity = 0.9;
    p.personality.honesty = 0.1;
    p.skills.artistry = 90;
    p.wallet = 300;
  }
  assert.equal(startFamily(w, a.id).ok, true);
  const before = totalMoney(w);
  const occupied = w.housing.occupied[2];

  w.day += 1;
  w.hour = BIRTH_HOUR;
  w.tick = w.day * 24 + w.hour;
  tickHappenings(w);

  const kid = newest(w);
  assert.equal(kid.lifeStage, 'child');
  assert.equal(kid.bornDay, w.day);
  assert.equal(kid.familyName, 'Ashgrove');
  assert.equal(kid.brain, 'reflex');
  assert.deepEqual(kid.family.parents.sort(), [a.id, b.id].sort());
  assert.deepEqual(a.family.children, [kid.id]);
  assert.deepEqual(b.family.children, [kid.id]);
  assert.ok(kid.personality.curiosity > 0.6, 'curious parents, curious child');
  assert.ok(kid.personality.honesty < 0.4);
  assert.ok(kid.skills.artistry >= 35, 'a talent drawn from a parent');
  assert.equal(kid.wallet, 0, 'a child brings no arrival grant');
  assert.equal(kid.householdId, home.id);
  assert.equal(kid.homeTier, 2);
  assert.deepEqual(home.members, [a.id, b.id, kid.id]);
  assert.equal(w.housing.occupied[2], occupied, 'a child shares the family unit');
  assert.equal(bondBetween(w, a.id, kid.id), BIRTH_BOND);
  assert.equal(totalMoney(w), before);
  const ev = w.events.find((e) => e.kind === 'birth' && e.weight === 0.8);
  assert.ok(ev);
  assert.match(ev.text, /was born to Ondine and Bram at Restoration Ward/);
  assert.ok(a.memory.some((m) => m.kind === 'family' && /was born/.test(m.text)));
});

test('a newborn fits where a lodger would not: a cot in a full Lantern Loft', () => {
  const w = makeWorld();
  const { a, b, home } = household(w, { tier: 1 });
  const lodger = makeCitizen(w, { name: 'Vale', district: 'verdant_quarter' });
  adjustBond(w, a.id, lodger.id, 80);
  assert.match(moveIn(w, lodger.id, a.id).message, /no room/, 'the loft holds two adults');

  const kid = birthChild(w, {
    id: 'e_1', kind: 'birth', day: w.day, hour: BIRTH_HOUR, district: 'verdant_quarter', buildingId: 'restoration_ward',
    who: [a.id, b.id], clubId: null, label: 'a birth', done: false, attendees: [],
  });
  assert.equal(kid.householdId, home.id);
  assert.equal(kid.homeTier, 1);
  assert.deepEqual(home.members, [a.id, b.id, kid.id]);
  assert.equal(w.housing.occupied[1], 1, 'still one unit');
  assert.match(moveIn(w, lodger.id, a.id).message, /no room/);
});

test('a second child is a sibling, and a child born to nobody is a ward', () => {
  const w = makeWorld();
  const { a, b } = household(w, { tier: 3 });
  const first = birthChild(w, {
    id: 'e_1', kind: 'birth', day: w.day, hour: BIRTH_HOUR, district: 'verdant_quarter', buildingId: 'restoration_ward',
    who: [a.id, b.id], clubId: null, label: 'a birth', done: false, attendees: [],
  });
  const second = birthChild(w, {
    id: 'e_2', kind: 'birth', day: w.day, hour: BIRTH_HOUR, district: 'verdant_quarter', buildingId: 'restoration_ward',
    who: [a.id, b.id], clubId: null, label: 'a birth', done: false, attendees: [],
  });
  assert.equal(bondBetween(w, first.id, second.id), SIBLING_BOND);
  assert.equal(areFamily(w, first.id, second.id), true);
  assert.deepEqual(a.family.children, [first.id, second.id]);

  const orphan = birthChild(w, {
    id: 'e_3', kind: 'birth', day: w.day, hour: BIRTH_HOUR, district: 'verdant_quarter', buildingId: 'restoration_ward',
    who: ['c_404'], clubId: null, label: 'a birth', done: false, attendees: [],
  });
  assert.deepEqual(orphan.family.parents, []);
  assert.equal(orphan.householdId, null);
  assert.ok(w.events.some((e) => e.kind === 'birth' && /a ward of the city/.test(e.text)));
});

// ---------------------------------------------------------------------------
// Growing up
// ---------------------------------------------------------------------------

test('a child comes of age after fourteen days, and an adult becomes an elder', () => {
  const w = makeWorld();
  w.day = 40;
  const parent = makeCitizen(w, { name: 'Ondine' });
  const kid = makeCitizen(w, { name: 'Wren', lifeStage: 'child', bornDay: w.day - CHILDHOOD_DAYS + 1 });
  kid.family.parents = [parent.id];
  parent.family.children = [kid.id];
  kid.guardianId = parent.id;

  dailyLifeStages(w);
  assert.equal(kid.lifeStage, 'child', 'a day short of it');

  w.day += 1;
  dailyLifeStages(w);
  assert.equal(kid.lifeStage, 'adult');
  assert.equal(kid.guardianId, null);
  assert.ok(w.events.some((e) => e.kind === 'coming_of_age' && e.weight === 0.6));
  assert.ok(kid.memory.some((m) => m.kind === 'family' && /came of age/.test(m.text)));
  assert.ok(parent.memory.some((m) => /came of age/.test(m.text)));

  const old = makeCitizen(w, { name: 'Vale', bornDay: w.day - ELDER_DAYS, reputation: 60 });
  dailyLifeStages(w);
  assert.equal(old.lifeStage, 'elder');
  assert.equal(old.reputation, 60 + ELDER_REPUTATION);
  dailyLifeStages(w);
  assert.equal(old.reputation, 60 + ELDER_REPUTATION, 'an elder only comes of age once');
});

test('parents keep their children, and the Chest keeps the wards', () => {
  const w = makeWorld();
  const { a, b } = household(w);
  const kid = makeCitizen(w, { name: 'Wren', lifeStage: 'child', wallet: 0 });
  kid.family.parents = [a.id, b.id];
  a.family.children = [kid.id];
  b.family.children = [kid.id];
  const before = totalMoney(w);

  dailyUpkeep(w);
  assert.equal(kid.wallet, 2 * CHILD_UPKEEP_PER_PARENT);
  assert.equal(a.wallet, 200 - CHILD_UPKEEP_PER_PARENT);
  assert.equal(b.wallet, 200 - CHILD_UPKEEP_PER_PARENT);
  assert.equal(totalMoney(w), before);

  // both parents gone: the city pays instead, while the Chest lasts
  w.order = w.order.filter((id) => id !== a.id && id !== b.id);
  w.treasury.chest = WARD_UPKEEP;
  const withChest = totalMoney(w);
  dailyUpkeep(w);
  assert.equal(kid.wallet, 2 * CHILD_UPKEEP_PER_PARENT + WARD_UPKEEP);
  assert.equal(w.treasury.chest, 0);
  assert.equal(totalMoney(w), withChest);
  dailyUpkeep(w);
  assert.equal(kid.wallet, 2 * CHILD_UPKEEP_PER_PARENT + WARD_UPKEEP, 'an empty Chest pays nothing');
});

test('a broke parent simply cannot pay, and adults are nobody\'s charge', () => {
  const w = makeWorld();
  const { a, b } = household(w);
  const kid = makeCitizen(w, { name: 'Wren', lifeStage: 'child', wallet: 0 });
  kid.family.parents = [a.id, b.id];
  a.family.children = [kid.id];
  b.family.children = [kid.id];
  a.wallet = 0;
  const before = totalMoney(w);
  dailyUpkeep(w);
  assert.equal(kid.wallet, CHILD_UPKEEP_PER_PARENT);
  assert.equal(a.wallet, 0);
  assert.equal(totalMoney(w), before);

  kid.lifeStage = 'adult';
  const grown = totalMoney(w);
  dailyUpkeep(w);
  assert.equal(kid.wallet, CHILD_UPKEEP_PER_PARENT, 'nobody keeps an adult');
  assert.equal(totalMoney(w), grown);
});

// ---------------------------------------------------------------------------
// Birthdays
// ---------------------------------------------------------------------------

test('a birthday party is thrown at home every twenty-eight days, once', () => {
  const w = makeWorld();
  w.day = BIRTHDAY_EVERY;
  const c = makeCitizen(w, { name: 'Ondine', bornDay: 0, district: 'commons', homeTier: 1 });
  const homeless = makeCitizen(w, { name: 'Vale', bornDay: 0, district: 'harbor_market' });
  const young = makeCitizen(w, { name: 'Wren', bornDay: w.day - 3 });

  dailyBirthdays(w);
  dailyBirthdays(w);
  const parties = w.happenings.filter((h) => h.kind === 'birthday');
  assert.equal(parties.length, 2);
  const mine = parties.find((h) => h.who[0] === c.id);
  assert.ok(mine);
  assert.equal(mine.hour, BIRTHDAY_HOUR);
  assert.equal(mine.district, 'verdant_quarter', 'the party is at home');
  assert.equal(parties.find((h) => h.who[0] === homeless.id)?.district, 'harbor_market');
  assert.ok(!parties.some((h) => h.who[0] === young.id));
});

test('the party brings family and friends closer, and presents for the birthday', () => {
  const w = makeWorld();
  w.day = BIRTHDAY_EVERY;
  const c = makeCitizen(w, { name: 'Ondine', bornDay: 0, district: 'verdant_quarter', homeTier: 1, wallet: 100 });
  const friend = makeCitizen(w, { name: 'Bram', district: 'verdant_quarter', wallet: 300 });
  const poorFriend = makeCitizen(w, { name: 'Marrow', district: 'verdant_quarter', wallet: 20 });
  const kin = makeCitizen(w, { name: 'Wren', lifeStage: 'child', district: 'verdant_quarter' });
  const stranger = makeCitizen(w, { name: 'Vale', district: 'verdant_quarter' });
  const away = makeCitizen(w, { name: 'Isling', district: 'commons', wallet: 300 });
  adjustBond(w, friend.id, c.id, 60);
  adjustBond(w, poorFriend.id, c.id, 60);
  adjustBond(w, away.id, c.id, 60);
  kin.family.parents = [c.id];
  c.family.children = [kin.id];

  dailyBirthdays(w);
  const h = w.happenings.find((x) => x.kind === 'birthday');
  assert.ok(h);
  const before = totalMoney(w);
  w.hour = BIRTHDAY_HOUR;
  w.tick = w.day * 24 + w.hour;
  tickHappenings(w);

  assert.equal(c.lastBirthdayDay, w.day);
  assert.deepEqual(h.attendees.sort(), [friend.id, poorFriend.id, kin.id].sort());
  assert.equal(friend.wallet, 300 - BIRTHDAY_GIFT);
  assert.equal(poorFriend.wallet, 20, 'an empty purse comes empty-handed');
  assert.equal(c.wallet, 100 + BIRTHDAY_GIFT);
  assert.equal(away.wallet, 300, 'friends elsewhere miss it');
  assert.ok(bondBetween(w, friend.id, c.id) > 60);
  assert.equal(friend.contactsToday[c.id], 1, 'an evening together counts');
  assert.equal(totalMoney(w), before);
  assert.ok(w.events.some((e) => e.kind === 'birthday' && e.weight === 0.4));
  assert.ok(!h.attendees.includes(stranger.id));
});

test('a birthday nobody comes to is still a birthday', () => {
  const w = makeWorld();
  w.day = BIRTHDAY_EVERY;
  const c = makeCitizen(w, { name: 'Ondine', bornDay: 0, district: 'harbor_market' });
  holdBirthday(w, {
    id: 'e_1', kind: 'birthday', day: w.day, hour: BIRTHDAY_HOUR, district: 'harbor_market', buildingId: null,
    who: [c.id], clubId: null, label: 'a party', done: false, attendees: [],
  });
  assert.equal(c.lastBirthdayDay, w.day);
  assert.ok(w.events.some((e) => e.kind === 'birthday' && /no one to mark it/.test(e.text)));
});

// ---------------------------------------------------------------------------
// Leaving
// ---------------------------------------------------------------------------

test('emigrating leaves the purse to the family, and cuts the ties to the city', () => {
  const w = makeWorld();
  const { a, b, home } = household(w);
  const kid = makeCitizen(w, { name: 'Wren', lifeStage: 'child', district: 'verdant_quarter', wallet: 0 });
  kid.family.parents = [a.id];
  a.family.children = [kid.id];
  home.members.push(kid.id);
  kid.householdId = home.id;
  kid.homeTier = 2;
  const club = addClub(w, [a.id, b.id]);
  a.wallet = 101;
  const before = totalMoney(w);

  emigrate(w, a.id);

  assert.equal(a.wallet, 1, 'what could not be divided stays in the purse');
  assert.equal(b.wallet, 250);
  assert.equal(kid.wallet, 50);
  assert.equal(totalMoney(w), before);
  assert.equal(b.family.partnerId, null);
  assert.equal(a.family.partnerId, null);
  assert.deepEqual(home.members, [b.id, kid.id]);
  assert.equal(a.householdId, null);
  assert.equal(a.homeTier, 0);
  assert.equal(w.housing.occupied[2], 1, 'the household keeps the home');
  assert.deepEqual(club.members, [b.id]);
  assert.deepEqual(a.clubs, []);
  assert.equal(club.convenorId, b.id);
  assert.deepEqual(a.family.children, [kid.id], 'kinship is kept in the record');
  assert.ok(b.memory.some((m) => /left the city/.test(m.text)));
  assert.ok(w.events.some((e) => e.kind === 'paid' && /left 100 ℓ/.test(e.text)));
});

test('nothing is inherited without family, and nothing indivisible is split', () => {
  const w = makeWorld();
  const alone = makeCitizen(w, { name: 'Vale', wallet: 90 });
  const before = totalMoney(w);
  inheritance(w, alone.id);
  assert.equal(alone.wallet, 90);
  assert.equal(totalMoney(w), before);

  const { a, b } = household(w);
  a.wallet = 0;
  inheritance(w, a.id);
  assert.equal(b.wallet, 200, 'an empty purse leaves nothing');
  inheritance(w, 'c_999');
});

test('a child whose last parent is exiled becomes a ward, taken in by the closest friend', () => {
  const w = makeWorld();
  const parent = makeCitizen(w, { name: 'Ondine', district: 'verdant_quarter', wallet: 40 });
  const kid = makeCitizen(w, { name: 'Wren', lifeStage: 'child', district: 'verdant_quarter' });
  kid.family.parents = [parent.id];
  parent.family.children = [kid.id];
  addHousehold(w, [parent.id, kid.id], 1);
  const friend = makeCitizen(w, { name: 'Bram', district: 'verdant_quarter' });
  const friendHome = addHousehold(w, [friend.id], 2);
  adjustBond(w, friend.id, parent.id, 50);
  const stranger = makeCitizen(w, { name: 'Vale', reputation: 99 });
  const before = totalMoney(w);

  exileCitizen(w, parent.id, 'k_1');

  assert.equal(parent.standing, 'exiled');
  assert.equal(kid.guardianId, friend.id);
  assert.notEqual(kid.guardianId, stranger.id);
  assert.equal(kid.householdId, friendHome.id);
  assert.equal(kid.homeTier, 2);
  assert.deepEqual(friendHome.members, [friend.id, kid.id]);
  assert.equal(w.housing.occupied[1], 0, 'the family loft is given up');
  assert.equal(w.housing.occupied[2], 1);
  assert.equal(totalMoney(w), before, 'the seizure moves money, it does not make it');
  assert.ok(w.events.some((e) => e.kind === 'household' && /ward of the city/.test(e.text)));
  assert.ok(kid.memory.some((m) => m.kind === 'family' && /ward of the city/.test(m.text)));
});

test('a ward with nobody to take them in waits at the Arrivals Hall, and a child with a parent left is no ward', () => {
  const w = makeWorld();
  const one = makeCitizen(w, { name: 'Ondine', district: 'verdant_quarter' });
  const two = makeCitizen(w, { name: 'Bram', district: 'verdant_quarter' });
  const kid = makeCitizen(w, { name: 'Wren', lifeStage: 'child', district: 'verdant_quarter' });
  kid.family.parents = [one.id, two.id];
  one.family.children = [kid.id];
  two.family.children = [kid.id];
  const home = addHousehold(w, [one.id, two.id, kid.id], 3);

  exileCitizen(w, one.id, 'k_1');
  assert.equal(kid.guardianId, null, 'one parent is still here');
  assert.equal(kid.householdId, home.id);

  exileCitizen(w, two.id, 'k_2');
  assert.equal(kid.guardianId, null, 'nobody was close to them');
  assert.equal(kid.district, 'threshold');
  assert.equal(kid.householdId, null);
  assert.equal(kid.homeTier, 0);
  assert.equal(w.housing.occupied[3], 0);
  assert.ok(w.events.some((e) => e.kind === 'household' && /Arrivals Hall/.test(e.text)));
});

test('severSocialTies is quiet about citizens it does not know', () => {
  const w = makeWorld();
  severSocialTies(w, 'c_999', 'left the city');
  const lone = makeCitizen(w, { name: 'Vale' });
  lone.clubs.push('u_404');
  severSocialTies(w, lone.id, 'left the city');
  assert.deepEqual(lone.clubs, []);
  assert.equal(lone.householdId, null);
  wardship(w, 'c_999');
  wardship(w, lone.id);
  assert.equal(lone.guardianId, null, 'an adult is nobody\'s ward');
});

// ---------------------------------------------------------------------------
// The bench
// ---------------------------------------------------------------------------

test('a judge may not try their own family', () => {
  const w = makeWorld();
  const judges: Citizen[] = [];
  for (let i = 0; i < 3; i++) {
    const j = makeCitizen(w, { office: 'judge', reputation: 80, judgeTermEndsDay: w.day + 56 });
    w.government.judges.push(j.id);
    judges.push(j);
  }
  const parent = makeCitizen(w, { name: 'Ondine' });
  const defendant = makeCitizen(w, { name: 'Wren' });
  defendant.family.parents = [parent.id];
  parent.family.children = [defendant.id, judges[0].id];
  judges[0].family.parents = [parent.id];

  const k = fileCharge(w, { defendantId: defendant.id, law: 'L04', evidence: 0.8, filedBy: 'watch', description: 'theft' });
  const bench = selectBench(w, k);
  assert.ok(!bench.includes(judges[0].id), 'a sibling steps aside');
  assert.ok(bench.includes(judges[1].id) && bench.includes(judges[2].id));

  const victim = makeCitizen(w, { name: 'Vale' });
  victim.family.partnerId = judges[1].id;
  judges[1].family.partnerId = victim.id;
  const k2 = fileCharge(w, {
    defendantId: defendant.id, law: 'L04', evidence: 0.8, filedBy: 'watch', victimId: victim.id, description: 'theft',
  });
  const bench2 = selectBench(w, k2);
  assert.ok(!bench2.includes(judges[1].id), 'the victim\'s partner steps aside too');
});
