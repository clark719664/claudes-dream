import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Business, Citizen, Household, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import { adjustBond, bondBetween } from '../src/citizens/relationships.ts';
import { tickHappenings } from '../src/society/calendar.ts';
import {
  AFFECTION_DAILY_CAP, AFFECTION_DECAY, BREAKUP_BOND, COLLAPSED_BOND, DATE_AFFECTION, DATE_BOND, JEALOUSY_BOND,
  MARRIAGE_MIN_BOND, MARRIAGE_MIN_DAYS, NAME_MERGE_MARGIN, PARTNERSHIP_AFFECTION, WEDDING_GIFT, WEDDING_HOUR,
  affectionBetween, breakUp, dailyAffection, date, dateCost, dateVenueIn, holdWedding, marry, openToAffection,
  proposePartnership, recordContact, separatePartners,
} from '../src/society/romance.ts';

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

function addCafe(w: World, ownerId: string): Business {
  const id = nextId(w, 'b');
  const b: Business = {
    id, name: 'The Slow Kettle', kind: 'cafe', ownerId, treasury: 50, district: 'nightglass', buildingId: 'shopfronts_nightglass',
    employees: [], jobs: [], inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 }, foundedDay: w.day,
    rentPerDay: 10, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  w.businesses[id] = b;
  return b;
}

/** Two adults standing in the same district, as fond of each other as asked. */
function couple(w: World, opts: { district?: 'commons' | 'nightglass' | 'verdant_quarter'; bond?: number; affection?: number } = {}): [Citizen, Citizen] {
  const district = opts.district ?? 'verdant_quarter';
  const a = makeCitizen(w, { name: 'Ondine', familyName: 'Ashgrove', district });
  const b = makeCitizen(w, { name: 'Bram', familyName: 'Corvane', district });
  if (opts.bond) adjustBond(w, a.id, b.id, opts.bond);
  if (opts.affection) {
    a.affection[b.id] = opts.affection;
    b.affection[a.id] = opts.affection;
  }
  return [a, b];
}

function partner(w: World, a: Citizen, b: Citizen, since = w.day, married = false): void {
  a.family.partnerId = b.id;
  b.family.partnerId = a.id;
  a.family.partnerSinceDay = since;
  b.family.partnerSinceDay = since;
  a.family.married = married;
  b.family.married = married;
}

// ---------------------------------------------------------------------------
// Contact and affection
// ---------------------------------------------------------------------------

test('recordContact counts an hour together for both, and ignores nonsense', () => {
  const w = makeWorld();
  const [a, b] = couple(w);
  recordContact(w, a.id, b.id);
  recordContact(w, a.id, b.id);
  assert.equal(a.contactsToday[b.id], 2);
  assert.equal(b.contactsToday[a.id], 2);
  recordContact(w, a.id, a.id);
  recordContact(w, a.id, 'c_999');
  assert.deepEqual(Object.keys(a.contactsToday), [b.id]);
});

test('affection grows only with contact, and fades without it', () => {
  const w = makeWorld();
  const [a, b] = couple(w);
  dailyAffection(w);
  assert.equal(affectionBetween(w, a.id, b.id), 0, 'no contact, no feeling');

  recordContact(w, a.id, b.id);
  dailyAffection(w);
  // identical personalities (compatibility 1), no bond: 2 + 4 = 6
  assert.equal(affectionBetween(w, a.id, b.id), 6);
  assert.equal(affectionBetween(w, b.id, a.id), 6);
  assert.deepEqual(a.contactsToday, {}, 'the tally is cleared each morning');

  dailyAffection(w);
  assert.equal(affectionBetween(w, a.id, b.id), 6 - AFFECTION_DECAY);
});

test('a long day together is worth more, up to the daily cap', () => {
  const w = makeWorld();
  const [a, b] = couple(w, { bond: 50 });
  for (let i = 0; i < 6; i++) recordContact(w, a.id, b.id);
  dailyAffection(w);
  assert.equal(affectionBetween(w, a.id, b.id), AFFECTION_DAILY_CAP);
});

test('affection is only ever felt between adults', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { name: 'Ondine' });
  const kid = makeCitizen(w, { name: 'Wren', lifeStage: 'child' });
  recordContact(w, a.id, kid.id);
  dailyAffection(w);
  assert.equal(affectionBetween(w, a.id, kid.id), 0);
  assert.equal(affectionBetween(w, kid.id, a.id), 0);
});

test('a partnered citizen looks elsewhere only once their own bond has collapsed', () => {
  const w = makeWorld();
  const [a, b] = couple(w);
  const other = makeCitizen(w, { name: 'Kestrel' });
  partner(w, a, b);
  adjustBond(w, a.id, b.id, COLLAPSED_BOND + 10);

  assert.equal(openToAffection(w, a, other.id), false);
  recordContact(w, a.id, other.id);
  dailyAffection(w);
  assert.equal(affectionBetween(w, a.id, other.id), 0);
  assert.ok(affectionBetween(w, other.id, a.id) > 0, 'the single one is free to feel it');

  adjustBond(w, a.id, b.id, -(COLLAPSED_BOND + 10));
  assert.equal(openToAffection(w, a, other.id), true);
  recordContact(w, a.id, other.id);
  dailyAffection(w);
  assert.ok(affectionBetween(w, a.id, other.id) > 0);
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test('a walk in the Community Garden costs nothing and brings two people closer', () => {
  const w = makeWorld();
  const [a, b] = couple(w, { district: 'verdant_quarter' });
  const before = totalMoney(w);
  const r = date(w, a.id, b.id);
  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /Community Garden/);
  assert.equal(affectionBetween(w, a.id, b.id), DATE_AFFECTION);
  assert.equal(affectionBetween(w, b.id, a.id), DATE_AFFECTION);
  assert.equal(bondBetween(w, a.id, b.id), DATE_BOND);
  assert.equal(a.contactsToday[b.id], 1);
  assert.equal(totalMoney(w), before, 'the Garden is free');
  assert.ok(w.events.some((e) => e.kind === 'romance'));
});

test('dinner at the Halflight Tavern is paid for by both, and the money is conserved', () => {
  const w = makeWorld();
  const [a, b] = couple(w, { district: 'nightglass' });
  const cost = dateCost(w);
  const before = totalMoney(w);
  const treasury = w.treasury.balance;
  const r = date(w, a.id, b.id);
  assert.equal(r.ok, true, r.message);
  assert.equal(a.wallet, 200 - cost);
  assert.equal(b.wallet, 200 - cost);
  assert.equal(w.treasury.balance, treasury + 2 * cost);
  assert.equal(totalMoney(w), before);
});

test('a café takes the money when there is one in the district', () => {
  const w = makeWorld();
  const [a, b] = couple(w, { district: 'nightglass' });
  const owner = makeCitizen(w, { name: 'Marrow' });
  const cafe = addCafe(w, owner.id);
  assert.deepEqual(dateVenueIn(w, 'nightglass'), { name: cafe.name, payTo: cafe.id });
  const before = totalMoney(w);
  const till = cafe.treasury;
  assert.equal(date(w, a.id, b.id).ok, true);
  assert.equal(cafe.treasury, till + 2 * dateCost(w));
  assert.equal(totalMoney(w), before);
});

test('a date needs two adults in the same place, in good standing, with the price of a table', () => {
  const w = makeWorld();
  const [a, b] = couple(w, { district: 'nightglass' });
  assert.match(date(w, a.id, a.id).message, /takes two/);
  assert.match(date(w, a.id, 'c_404').message, /Nobody by that id/);

  b.district = 'commons';
  assert.match(date(w, a.id, b.id).message, /The Commons/);
  b.district = 'nightglass';

  b.wallet = 1;
  const before = totalMoney(w);
  const broke = date(w, a.id, b.id);
  assert.equal(broke.ok, false);
  assert.match(broke.message, /cannot spare/);
  assert.equal(totalMoney(w), before, 'a refused date moves no money');
  assert.equal(a.wallet, 200, 'nobody pays for a table nobody sat at');
  b.wallet = 200;

  const kid = makeCitizen(w, { name: 'Wren', lifeStage: 'child', district: 'nightglass' });
  assert.match(date(w, a.id, kid.id).message, /is a child/);
  assert.match(date(w, kid.id, b.id).message, /Children do not date/);

  a.standing = 'suspended';
  assert.match(date(w, a.id, b.id).message, /while suspended/);
  a.standing = 'good';
  a.detainedUntilTick = w.tick + 5;
  assert.match(date(w, a.id, b.id).message, /Watch House/);
});

test('there is nowhere to take anybody in Foundry Row', () => {
  const w = makeWorld();
  const [a, b] = couple(w, { district: 'commons' });
  a.district = 'foundry_row';
  b.district = 'foundry_row';
  assert.equal(dateVenueIn(w, 'foundry_row'), null);
  const r = date(w, a.id, b.id);
  assert.equal(r.ok, false);
  assert.match(r.message, /nowhere in Foundry Row/);
});

test('a partner left at home resents the evening', () => {
  const w = makeWorld();
  const [a, b] = couple(w, { district: 'verdant_quarter' });
  const left = makeCitizen(w, { name: 'Kestrel', district: 'commons' });
  partner(w, a, left);
  adjustBond(w, left.id, a.id, 40);

  assert.equal(date(w, a.id, b.id).ok, true);
  assert.equal(bondBetween(w, left.id, a.id), 40 - JEALOUSY_BOND);
  assert.equal(bondBetween(w, a.id, left.id), 40, 'only the one who was left feels it');
  const ev = w.events.find((e) => e.kind === 'romance');
  assert.deepEqual(ev?.data?.jealous, [left.id]);
});

// ---------------------------------------------------------------------------
// Partnership
// ---------------------------------------------------------------------------

test('a proposal is accepted once the affection is there, and not before', () => {
  const w = makeWorld();
  const [a, b] = couple(w);
  const early = proposePartnership(w, a.id, b.id);
  assert.equal(early.ok, false);
  assert.match(early.message, /not that fond of you yet/);
  assert.equal(a.family.partnerId, null);

  b.affection[a.id] = PARTNERSHIP_AFFECTION;
  w.day = 4;
  const r = proposePartnership(w, a.id, b.id);
  assert.equal(r.ok, true, r.message);
  assert.equal(a.family.partnerId, b.id);
  assert.equal(b.family.partnerId, a.id);
  assert.equal(a.family.partnerSinceDay, 4);
  assert.equal(b.family.married, false);
  assert.ok(bondBetween(w, a.id, b.id) > 0);
  assert.ok(w.events.some((e) => e.kind === 'romance' && e.weight === 0.5));
});

test('nobody may partner with somebody else\'s partner, their own kin, or a child', () => {
  const w = makeWorld();
  const [a, b] = couple(w);
  const third = makeCitizen(w, { name: 'Kestrel' });
  b.affection[a.id] = 90;
  third.affection[a.id] = 90;

  partner(w, b, third);
  assert.match(proposePartnership(w, a.id, b.id).message, /already with somebody else/);
  b.family.partnerId = null;
  third.family.partnerId = null;

  a.family.parents = ['x'];
  b.family.parents = ['x'];
  assert.match(proposePartnership(w, a.id, b.id).message, /is family/);
  a.family.parents = [];
  b.family.parents = [];

  partner(w, a, third);
  assert.match(proposePartnership(w, a.id, b.id).message, /break up first/);
});

// ---------------------------------------------------------------------------
// Weddings
// ---------------------------------------------------------------------------

test('a wedding is arranged only after seven days and a strong bond, and only once', () => {
  const w = makeWorld();
  w.day = 10;
  const [a, b] = couple(w);
  partner(w, a, b, 10);

  assert.match(marry(w, a.id, b.id).message, /a wedding takes 7/);
  a.family.partnerSinceDay = 10 - MARRIAGE_MIN_DAYS;
  b.family.partnerSinceDay = 10 - MARRIAGE_MIN_DAYS;
  assert.match(marry(w, a.id, b.id).message, new RegExp(`more than ${MARRIAGE_MIN_BOND}`));

  adjustBond(w, a.id, b.id, MARRIAGE_MIN_BOND + 5);
  const r = marry(w, a.id, b.id);
  assert.equal(r.ok, true, r.message);
  const h = w.happenings.find((x) => x.kind === 'wedding');
  assert.ok(h);
  assert.equal(h.day, 11);
  assert.equal(h.hour, WEDDING_HOUR);
  assert.equal(h.district, 'nightglass');
  assert.equal(h.buildingId, 'sound_garden');
  assert.deepEqual(h.who, [a.id, b.id]);
  assert.equal(a.family.married, false, 'nothing is settled until the ceremony');
  assert.match(marry(w, a.id, b.id).message, /already arranged/);
  assert.equal(w.happenings.filter((x) => x.kind === 'wedding').length, 1);
});

test('the wedding is held through the Happening: guests, gifts, names and conserved money', () => {
  const w = makeWorld();
  w.day = 20;
  const a = makeCitizen(w, { name: 'Ondine', familyName: 'Ashgrove', district: 'nightglass', reputation: 70 });
  const b = makeCitizen(w, { name: 'Bram', familyName: 'Corvane', district: 'nightglass', reputation: 40 });
  partner(w, a, b, 10);
  adjustBond(w, a.id, b.id, 90);
  const friend = makeCitizen(w, { name: 'Marrow', district: 'nightglass', wallet: 300 });
  adjustBond(w, friend.id, a.id, 60);
  const stranger = makeCitizen(w, { name: 'Vale', district: 'nightglass', wallet: 300 });
  const elsewhere = makeCitizen(w, { name: 'Isling', district: 'commons', wallet: 300 });

  assert.equal(marry(w, a.id, b.id).ok, true);
  const h = w.happenings.find((x) => x.kind === 'wedding');
  assert.ok(h);
  const before = totalMoney(w);

  w.day = 21;
  w.hour = WEDDING_HOUR;
  w.tick = w.day * 24 + w.hour;
  tickHappenings(w);

  assert.equal(a.family.married, true);
  assert.equal(b.family.married, true);
  assert.equal(h.done, true);
  assert.equal(b.familyName, 'Ashgrove', 'the better-known name is taken');
  assert.equal(b.family.familyName, 'Ashgrove');
  assert.equal(a.familyName, 'Ashgrove');
  assert.deepEqual(h.attendees.sort(), [friend.id, stranger.id].sort());
  assert.ok(!h.attendees.includes(elsewhere.id), 'the wedding is not held by post');
  assert.equal(friend.wallet, 300 - WEDDING_GIFT, 'friends bring a present');
  assert.equal(stranger.wallet, 300, 'strangers only bring themselves');
  assert.equal(a.wallet + b.wallet, 400 + WEDDING_GIFT);
  assert.equal(totalMoney(w), before);
  const ev = w.events.find((e) => e.kind === 'wedding');
  assert.ok(ev);
  assert.equal(ev.weight, 0.9);
  assert.match(ev.text, /Ondine and Bram were married/);
  assert.ok(a.memory.some((m) => m.kind === 'family' && /married Bram/.test(m.text)));
});

test('close reputations keep both family names, and a present may be a thing rather than lumens', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { name: 'Ondine', familyName: 'Ashgrove', district: 'nightglass', reputation: 50 });
  const b = makeCitizen(w, { name: 'Bram', familyName: 'Corvane', district: 'nightglass', reputation: 50 + NAME_MERGE_MARGIN });
  partner(w, a, b, 0);
  const giver = makeCitizen(w, { name: 'Marrow', district: 'nightglass', wallet: 300 });
  giver.possessions = [{ id: 'i_1', productId: 'tin_whistle', acquiredDay: 0 }];
  adjustBond(w, giver.id, a.id, 60);

  const before = totalMoney(w);
  holdWedding(w, {
    id: 'e_1', kind: 'wedding', day: w.day, hour: WEDDING_HOUR, district: 'nightglass', buildingId: 'sound_garden',
    who: [a.id, b.id], clubId: null, label: 'the wedding', done: false, attendees: [],
  });

  assert.equal(a.familyName, 'Ashgrove');
  assert.equal(b.familyName, 'Corvane');
  assert.equal(giver.possessions.length, 0);
  assert.equal(a.possessions[0].productId, 'tin_whistle', 'a music lover gets the whistle');
  assert.equal(giver.stats.giftsGiven, 1);
  assert.equal(a.stats.giftsReceived, 1);
  assert.equal(totalMoney(w), before, 'a present in kind moves no lumens');
});

test('a wedding whose couple have parted or left is quietly not held', () => {
  const w = makeWorld();
  const [a, b] = couple(w, { district: 'nightglass' });
  const h = {
    id: 'e_1', kind: 'wedding' as const, day: w.day, hour: WEDDING_HOUR, district: 'nightglass' as const,
    buildingId: 'sound_garden', who: [a.id, b.id], clubId: null, label: 'the wedding', done: false, attendees: [],
  };
  holdWedding(w, h);
  assert.equal(a.family.married, false, 'they were never partners');

  partner(w, a, b, 0);
  w.order = w.order.filter((id) => id !== b.id);
  holdWedding(w, h);
  assert.equal(a.family.married, false, 'one of them has left the city');
});

// ---------------------------------------------------------------------------
// Breaking up
// ---------------------------------------------------------------------------

test('a breakup splits the household: the home stays with the higher earner', () => {
  const w = makeWorld();
  const [a, b] = couple(w, { bond: 80, affection: 70 });
  partner(w, a, b, 0, true);
  const home = addHousehold(w, [a.id, b.id], 2);
  a.stats.totalEarned = 900;
  b.stats.totalEarned = 100;
  const occupied = w.housing.occupied[2];

  const r = breakUp(w, a.id);
  assert.equal(r.ok, true, r.message);
  assert.equal(a.family.partnerId, null);
  assert.equal(b.family.partnerId, null);
  assert.equal(a.family.married, false);
  assert.equal(b.family.married, false);
  assert.equal(affectionBetween(w, a.id, b.id), 0);
  assert.equal(affectionBetween(w, b.id, a.id), 0);
  assert.equal(bondBetween(w, a.id, b.id), 80 - BREAKUP_BOND);

  assert.deepEqual(home.members, [a.id]);
  assert.equal(a.homeTier, 2);
  assert.equal(b.homeTier, 0);
  assert.equal(b.householdId, null);
  assert.equal(w.housing.occupied[2], occupied, 'the home is still lived in');
  assert.ok(w.events.some((e) => e.kind === 'law' && /dissolution/.test(e.text)));
  assert.ok(w.events.some((e) => e.kind === 'romance' && /no longer married/.test(e.text)));
});

test('an unmarried breakup is recorded without a dissolution, and needs a partner', () => {
  const w = makeWorld();
  const [a, b] = couple(w, { bond: 60 });
  assert.match(breakUp(w, a.id).message, /no partner to leave/);
  partner(w, a, b, 0);
  assert.equal(breakUp(w, a.id).ok, true);
  assert.equal(w.events.filter((e) => e.kind === 'law').length, 0);
  assert.ok(b.memory.some((m) => m.kind === 'family' && /ended your partnership/.test(m.text)));
});

test('a partner who leaves the city leaves their partner single, with the bond intact', () => {
  const w = makeWorld();
  const [a, b] = couple(w, { bond: 70 });
  partner(w, a, b, 3, true);
  const left = separatePartners(w, a.id, 'left the city');
  assert.equal(left, b.id);
  assert.equal(a.family.partnerId, null);
  assert.equal(b.family.partnerId, null);
  assert.equal(b.family.married, false);
  assert.equal(bondBetween(w, a.id, b.id), 70, 'the bond is kept for the record');
  assert.ok(b.memory.some((m) => /no longer married/.test(m.text)));
  assert.equal(separatePartners(w, a.id, 'left the city'), null, 'nothing left to undo');
});
