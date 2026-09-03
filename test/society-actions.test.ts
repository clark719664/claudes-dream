import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import type { Business, Citizen, World } from '../src/types.ts';
import { CLUB_FOUNDING_FEE, CLUB_MEETING_HOUR, PRODUCTS } from '../src/data/catalogue.ts';
import { nextId } from '../src/util/ids.ts';
import { CHILD_FORBIDDEN, availableActions, executeAction } from '../src/actions/execute.ts';
import { DINE_ENERGY, DINE_SOCIAL, PLAY_SOCIAL, mealCost } from '../src/actions/society.ts';
import { CHILD_PARENT_REPUTATION } from '../src/actions/offences.ts';
import { addHappening, scheduleFestivals, tickHappenings } from '../src/society/calendar.ts';
import { scheduleMeetings } from '../src/society/clubs.ts';
import { affectionBetween, recordContact } from '../src/society/romance.ts';
import { householdOf } from '../src/society/households.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function at(world: World, day: number, hour: number): void {
  world.day = day;
  world.hour = hour;
  world.tick = day * 24 + hour;
}

/** A citizen who is fed, rested and housed, so only the action under test matters. */
function adult(world: World, overrides: Parameters<typeof makeCitizen>[1] = {}): Citizen {
  return makeCitizen(world, { wallet: 500, ...overrides });
}

function housed(world: World, overrides: Parameters<typeof makeCitizen>[1] = {}): Citizen {
  const c = adult(world, { homeTier: 1, district: 'verdant_quarter', ...overrides });
  world.housing.occupied[1] += 1;
  return c;
}

function addBusiness(world: World, owner: Citizen, overrides: Partial<Business> = {}): Business {
  const id = nextId(world, 'b');
  const b: Business = {
    id, name: 'Copper Works', kind: 'shop', ownerId: owner.id, treasury: 300, district: 'harbor_market',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 }, foundedDay: world.day,
    rentPerDay: 10, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {}, ...overrides,
  };
  world.businesses[id] = b;
  owner.businessId = id;
  return b;
}

/** Two citizens who have been partners for `days` days with a warm mutual bond. */
function partners(world: World, days: number, bond: number): [Citizen, Citizen] {
  const a = housed(world, { name: 'Ondine' });
  const b = housed(world, { name: 'Bram' });
  for (const [x, y] of [[a, b], [b, a]] as [Citizen, Citizen][]) {
    x.family.partnerId = y.id;
    x.family.partnerSinceDay = world.day - days;
    x.bonds[y.id] = bond;
    x.affection[y.id] = 80;
  }
  return [a, b];
}

// ---------------------------------------------------------------------------
// Things: buying, using, giving, making, pricing
// ---------------------------------------------------------------------------

test('buy_item takes a thing off the Emporium shelf and conserves money', () => {
  const w = makeWorld();
  const c = adult(w, { district: 'harbor_market' });
  const before = totalMoney(w);
  const stock = w.emporium.tin_whistle;
  const r = executeAction(w, c.id, { type: 'buy_item', productId: 'tin_whistle' });
  assert.equal(r.ok, true, r.message);
  assert.equal(c.possessions.length, 1);
  assert.equal(c.possessions[0].productId, 'tin_whistle');
  assert.equal(w.emporium.tin_whistle, stock - 1);
  assert.equal(totalMoney(w), before, 'lumens only moved');
  assert.ok(w.events.some((e) => e.kind === 'purchase'));

  const far = adult(w, { district: 'commons' });
  assert.equal(executeAction(w, far.id, { type: 'buy_item', productId: 'tin_whistle' }).ok, false, 'not sold here');
});

test('use_item practises the hobby it serves and gift_item hands it on', () => {
  const w = makeWorld();
  const c = adult(w, { district: 'commons' });
  c.needs.purpose = 40;
  c.skills.artistry = 20;
  c.possessions.push({ id: 'i_1', productId: 'tin_whistle', acquiredDay: 0 });
  const used = executeAction(w, c.id, { type: 'use_item', itemId: 'i_1' });
  assert.equal(used.ok, true, used.message);
  assert.ok(c.needs.purpose > 40, 'purpose from an hour with the whistle');
  assert.ok(c.skills.artistry > 20, 'a hobby item trains its skill');

  const friend = adult(w, { district: 'commons', name: 'Wren' });
  friend.tastes = { hobbies: ['music', 'reading'], favouriteDistrict: 'commons', favouriteGood: 'culture', categories: ['instrument', 'book'] };
  const bondBefore = c.bonds[friend.id] ?? 0;
  const gift = executeAction(w, c.id, { type: 'gift_item', to: friend.id, itemId: 'i_1' });
  assert.equal(gift.ok, true, gift.message);
  assert.equal(c.possessions.length, 0);
  assert.equal(friend.possessions.length, 1);
  assert.ok((c.bonds[friend.id] ?? 0) > bondBefore + 10, 'a gift to taste is worth more than lumens');
  assert.equal(executeAction(w, c.id, { type: 'use_item', itemId: 'i_1' }).ok, false, 'given away');
});

test('craft stocks the shelf of the shop you own and set_price sets what it costs', () => {
  const w = makeWorld();
  at(w, 1, 10);
  const owner = adult(w, { district: 'harbor_market' });
  const shop = addBusiness(w, owner, { inventory: { compute: 0, energy: 0, goods: 9, culture: 0, knowledge: 0 } });
  // priced under the Emporium's own tin whistles, so a shopper here buys from the shop
  const priced = executeAction(w, owner.id, { type: 'set_price', productId: 'tin_whistle', price: 20 });
  assert.equal(priced.ok, true, priced.message);
  const crafted = executeAction(w, owner.id, { type: 'craft', productId: 'tin_whistle' });
  assert.equal(crafted.ok, true, crafted.message);
  assert.equal(shop.shelf.tin_whistle.qty, 1);
  assert.equal(shop.shelf.tin_whistle.price, 20);
  assert.equal(shop.inventory.goods, 7, 'the recipe came out of the inventory');

  const shopper = adult(w, { district: 'harbor_market', wallet: 100 });
  const before = totalMoney(w);
  const bought = executeAction(w, shopper.id, { type: 'buy_item', productId: 'tin_whistle' });
  assert.equal(bought.ok, true, bought.message);
  assert.equal(shop.shelf.tin_whistle.qty, 0);
  assert.ok(shop.treasury > 300, 'the shop was paid');
  assert.equal(totalMoney(w), before);
  const stranger = adult(w, { district: 'harbor_market' });
  assert.equal(executeAction(w, stranger.id, { type: 'set_price', productId: 'tin_whistle', price: 10 }).ok, false, 'only the owner prices');
});

// ---------------------------------------------------------------------------
// Company: dining, playing, celebrating
// ---------------------------------------------------------------------------

test('dine at the Tavern feeds two and counts as an hour together', () => {
  const w = makeWorld();
  at(w, 2, 19);
  const a = adult(w, { district: 'nightglass' });
  const b = adult(w, { district: 'nightglass', name: 'Sable' });
  a.needs.energy = 40;
  b.needs.energy = 40;
  a.needs.social = 30;
  const cost = mealCost(w);
  const before = totalMoney(w);
  const r = executeAction(w, a.id, { type: 'dine', with: b.id });
  assert.equal(r.ok, true, r.message);
  assert.equal(a.needs.energy, 40 + DINE_ENERGY);
  assert.equal(a.needs.social, 30 + DINE_SOCIAL);
  assert.equal(a.wallet, 500 - cost, 'each pays their own way');
  assert.equal(b.wallet, 500 - cost);
  assert.equal(totalMoney(w), before);
  assert.equal(a.contactsToday[b.id], 1, 'an evening together counts toward affection');
  assert.ok((a.bonds[b.id] ?? 0) > 0);

  const broke = adult(w, { district: 'nightglass', wallet: 0 });
  assert.equal(executeAction(w, broke.id, { type: 'dine' }).ok, false, 'a meal must be paid for');
  const nowhere = adult(w, { district: 'foundry_row' });
  assert.equal(executeAction(w, nowhere.id, { type: 'dine' }).ok, false, 'no kitchen in Foundry Row');
});

test('a café with compute in its larder is paid for the meal it serves', () => {
  const w = makeWorld();
  at(w, 2, 19);
  const cook = adult(w, { district: 'nightglass' });
  const cafe = addBusiness(w, cook, {
    name: 'Lantern Café', kind: 'cafe', district: 'nightglass', buildingId: 'shopfronts_nightglass',
    inventory: { compute: 2, energy: 0, goods: 0, culture: 0, knowledge: 0 },
  });
  const diner = adult(w, { district: 'nightglass', name: 'Vesper' });
  const before = totalMoney(w);
  const r = executeAction(w, diner.id, { type: 'dine' });
  assert.equal(r.ok, true, r.message);
  assert.equal(cafe.inventory.compute, 1, 'the café cooked from its own larder');
  assert.equal(cafe.treasury, 300 + mealCost(w), 'and was paid for it');
  assert.equal(totalMoney(w), before);
});

test('play is free company at the Garden, the Plaza or the Tavern, and no child is served at the Tavern', () => {
  const w = makeWorld();
  at(w, 3, 18);
  const a = adult(w, { district: 'verdant_quarter' });
  const b = adult(w, { district: 'verdant_quarter', name: 'Pike' });
  a.needs.social = 20;
  b.needs.social = 20;
  const before = totalMoney(w);
  const r = executeAction(w, a.id, { type: 'play', with: b.id });
  assert.equal(r.ok, true, r.message);
  assert.equal(a.needs.social, 20 + PLAY_SOCIAL);
  assert.equal(b.needs.social, 20 + PLAY_SOCIAL);
  assert.ok((a.bonds[b.id] ?? 0) > 0);
  assert.equal(a.contactsToday[b.id], 1);
  assert.equal(totalMoney(w), before, 'games cost nothing');

  const child = makeCitizen(w, { district: 'nightglass', lifeStage: 'child', name: 'Sprig' });
  assert.equal(executeAction(w, child.id, { type: 'play' }).ok, false, 'the Halflight is no place for a child');
  const grown = adult(w, { district: 'nightglass' });
  assert.equal(executeAction(w, grown.id, { type: 'play' }).ok, true);
});

test('celebrate joins what is happening here this hour, and the ceremony follows at the end of it', () => {
  const w = makeWorld();
  at(w, 4, 19);
  const guest = adult(w, { district: 'nightglass' });
  const elsewhere = adult(w, { district: 'commons', name: 'Absent' });
  const h = addHappening(w, {
    kind: 'festival', day: 4, hour: 19, buildingId: 'sound_garden', label: 'a festival at The Sound Garden',
  });
  assert.equal(executeAction(w, elsewhere.id, { type: 'celebrate' }).ok, false, 'nothing is happening in the Commons');
  const r = executeAction(w, guest.id, { type: 'celebrate' });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(h.attendees, [guest.id]);
  assert.equal(executeAction(w, guest.id, { type: 'celebrate' }).ok, false, 'already there');
  const socialBefore = guest.needs.social;
  tickHappenings(w);
  assert.equal(h.done, true);
  assert.ok(guest.needs.social > socialBefore, 'the festival was held around them');
});

// ---------------------------------------------------------------------------
// Romance and family
// ---------------------------------------------------------------------------

test('date, propose_partnership, marry, start_family and break_up walk the whole arc', () => {
  const w = makeWorld();
  at(w, 10, 19);
  const a = housed(w, { name: 'Ondine' });
  const b = housed(w, { name: 'Bram' });
  a.bonds[b.id] = 50;
  b.bonds[a.id] = 50;

  const dated = executeAction(w, a.id, { type: 'date', with: b.id });
  assert.equal(dated.ok, true, dated.message);
  assert.ok(affectionBetween(w, a.id, b.id) > 0, 'an evening out is felt');
  assert.equal(a.contactsToday[b.id], 1);

  assert.equal(executeAction(w, a.id, { type: 'propose_partnership', to: b.id }).ok, false, 'too soon: affection is not there');
  b.affection[a.id] = 70;
  const asked = executeAction(w, a.id, { type: 'propose_partnership', to: b.id });
  assert.equal(asked.ok, true, asked.message);
  assert.equal(a.family.partnerId, b.id);
  assert.equal(b.family.partnerId, a.id);
  assert.equal(a.family.partnerSinceDay, 10);

  assert.equal(executeAction(w, a.id, { type: 'marry', to: b.id }).ok, false, 'a wedding takes seven days of partnership');
  a.family.partnerSinceDay = 2;
  b.family.partnerSinceDay = 2;
  a.bonds[b.id] = 90;
  b.bonds[a.id] = 90;
  const wedding = executeAction(w, a.id, { type: 'marry', to: b.id });
  assert.equal(wedding.ok, true, wedding.message);
  const scheduled = w.happenings.find((x) => x.kind === 'wedding');
  assert.ok(scheduled, 'a wedding is on the calendar');
  assert.equal(scheduled.day, 11);
  assert.equal(a.family.married, false, 'not married until the ceremony');
  at(w, 11, scheduled.hour);
  for (const person of [a, b]) person.district = scheduled.district;
  tickHappenings(w);
  assert.equal(a.family.married, true);
  assert.equal(b.family.married, true);
  assert.ok(w.events.some((e) => e.kind === 'wedding' && e.weight >= 0.9));

  const moved = executeAction(w, b.id, { type: 'move_in', with: a.id });
  assert.equal(moved.ok, true, moved.message);
  const home = householdOf(w, a.id);
  assert.ok(home && home.members.includes(b.id), 'one roof, one household');

  a.wallet = 300;
  b.wallet = 300;
  const family = executeAction(w, a.id, { type: 'start_family' });
  assert.equal(family.ok, true, family.message);
  const birth = w.happenings.find((x) => x.kind === 'birth');
  assert.ok(birth, 'a birth is booked at the Restoration Ward');
  at(w, birth.day, birth.hour);
  tickHappenings(w);
  const child = Object.values(w.citizens).find((x) => x.family.parents.includes(a.id));
  assert.ok(child, 'a child was born');
  assert.equal(child.lifeStage, 'child');
  assert.equal(child.familyName, a.familyName);
  assert.ok(a.family.children.includes(child.id));

  const parted = executeAction(w, a.id, { type: 'break_up' });
  assert.equal(parted.ok, true, parted.message);
  assert.equal(a.family.partnerId, null);
  assert.equal(b.family.partnerId, null);
  assert.ok(w.events.some((e) => e.kind === 'law' && /dissolution/i.test(e.text)), 'a marriage ends on the record');
  assert.equal(executeAction(w, a.id, { type: 'break_up' }).ok, false, 'nobody left to leave');
});

test('a partnership needs two grown, single, unrelated citizens in the same place', () => {
  const w = makeWorld();
  at(w, 5, 12);
  const [a, b] = partners(w, 8, 80);
  const other = housed(w, { name: 'Cass' });
  other.affection[a.id] = 90;
  assert.equal(executeAction(w, a.id, { type: 'propose_partnership', to: other.id }).ok, false, 'already partnered');
  const child = makeCitizen(w, { district: 'verdant_quarter', lifeStage: 'child', name: 'Sprig' });
  child.affection[other.id] = 90;
  assert.equal(executeAction(w, other.id, { type: 'propose_partnership', to: child.id }).ok, false, 'not with a child');
  assert.equal(executeAction(w, child.id, { type: 'date', with: other.id }).ok, false, 'children do not date');
  b.district = 'commons';
  assert.equal(executeAction(w, a.id, { type: 'date', with: b.id }).ok, false, 'not in the same district');
});

// ---------------------------------------------------------------------------
// Clubs
// ---------------------------------------------------------------------------

test('found_club, join_club, attend_club and leave_club run a club through a week', () => {
  const w = makeWorld();
  at(w, 3, 12);
  const founder = adult(w, { district: 'commons', name: 'Alder' });
  const before = totalMoney(w);
  const founded = executeAction(w, founder.id, { type: 'found_club', hobby: 'games', name: 'Halflight Chess Circle' });
  assert.equal(founded.ok, true, founded.message);
  const club = Object.values(w.clubs)[0];
  assert.equal(club.members.length, 1);
  assert.equal(club.convenorId, founder.id);
  assert.equal(founder.wallet, 500 - CLUB_FOUNDING_FEE);
  assert.equal(totalMoney(w), before, 'the fee went to the Treasury');

  const member = adult(w, { district: 'commons', name: 'Wick' });
  assert.equal(executeAction(w, member.id, { type: 'join_club', clubId: club.id }).ok, true);
  assert.equal(club.members.length, 2);
  assert.equal(executeAction(w, member.id, { type: 'join_club', clubId: club.id }).ok, false, 'already a member');

  // move the calendar to the club's meeting day and hold the meeting at its venue
  club.meetsOnWeekday = 3;
  at(w, 10, CLUB_MEETING_HOUR);
  scheduleMeetings(w);
  const meeting = w.happenings.find((h) => h.kind === 'club_meeting');
  assert.ok(meeting, 'the meeting is on the calendar');
  assert.equal(executeAction(w, member.id, { type: 'attend_club', clubId: club.id }).ok, false, 'not at the venue');
  founder.district = meeting.district;
  member.district = meeting.district;
  const attended = executeAction(w, founder.id, { type: 'attend_club', clubId: club.id });
  assert.equal(attended.ok, true, attended.message);
  const second = executeAction(w, member.id, { type: 'attend_club', clubId: club.id });
  assert.equal(second.ok, true, second.message);
  assert.ok((member.bonds[founder.id] ?? 0) > 0, 'members who meet grow closer');
  assert.equal(member.contactsToday[founder.id], 1);
  assert.deepEqual(meeting.attendees, [founder.id, member.id]);

  assert.equal(executeAction(w, member.id, { type: 'leave_club', clubId: club.id }).ok, true);
  assert.equal(club.members.length, 1);
  assert.equal(executeAction(w, founder.id, { type: 'leave_club', clubId: club.id }).ok, true);
  assert.equal(w.clubs[club.id], undefined, 'the last member out disbands it');
});

// ---------------------------------------------------------------------------
// The Community Chest
// ---------------------------------------------------------------------------

test('donate moves lumens to the Community Chest and earns the giver respect', () => {
  const w = makeWorld();
  const c = adult(w, { wallet: 150, reputation: 50 });
  const before = totalMoney(w);
  const r = executeAction(w, c.id, { type: 'donate', amount: 60 });
  assert.equal(r.ok, true, r.message);
  assert.equal(w.treasury.chest, 60);
  assert.equal(c.wallet, 90);
  assert.ok(c.reputation > 50, 'a modest purse giving is worth double respect');
  assert.equal(totalMoney(w), before, 'the Chest is part of the money supply');
  assert.equal(executeAction(w, c.id, { type: 'donate', amount: 1000 }).ok, false, 'you cannot give what you have not got');
});

// ---------------------------------------------------------------------------
// Children, standing and the action list
// ---------------------------------------------------------------------------

test('a child may not work, court, join clubs or answer to the Watch; its parents answer instead', () => {
  const w = makeWorld();
  at(w, 6, 12);
  const parent = housed(w, { name: 'Noor', reputation: 60 });
  const other = housed(w, { name: 'Gwyn', reputation: 60 });
  const child = makeCitizen(w, { district: 'harbor_market', lifeStage: 'child', name: 'Sprig', wallet: 20 });
  child.family.parents = [parent.id, other.id];
  parent.family.children = [child.id];
  other.family.children = [child.id];

  for (const type of ['work', 'donate', 'found_club', 'marry'] as const) {
    const action = type === 'marry' ? { type, to: parent.id } as const
      : type === 'donate' ? { type, amount: 5 } as const
        : type === 'found_club' ? { type, hobby: 'games', name: 'Sprig Circle' } as const
          : { type } as const;
    const r = executeAction(w, child.id, action);
    assert.equal(r.ok, false, `a child cannot ${type}`);
    assert.match(r.message, /child/i);
  }
  assert.ok(CHILD_FORBIDDEN.includes('work'));
  assert.ok(!availableActions(w, child).some((a) => CHILD_FORBIDDEN.includes(a)), 'nor are they offered');

  const victim = adult(w, { district: 'harbor_market', wallet: 100, name: 'Mark' });
  const theft = executeAction(w, child.id, { type: 'steal', from: victim.id });
  assert.ok(theft.offence, 'the misdeed is recorded as an offence');
  assert.equal(theft.detected, false, 'children are not charged');
  assert.equal(Object.keys(w.cases).length, 0, 'no case against a child');
  assert.equal(parent.reputation, 60 - CHILD_PARENT_REPUTATION);
  assert.equal(other.reputation, 60 - CHILD_PARENT_REPUTATION);
  assert.ok(w.events.some((e) => e.kind === 'offence' && /child/.test(e.text)));
});

test('exile, detention and suspension reach the social layer too', () => {
  const w = makeWorld();
  at(w, 4, 19);
  const c = adult(w, { district: 'nightglass' });
  const friend = adult(w, { district: 'nightglass', name: 'Kit' });
  c.possessions.push({ id: 'i_9', productId: 'tide_cards', acquiredDay: 0 });

  c.standing = 'suspended';
  c.suspendedUntilDay = 20;
  assert.equal(executeAction(w, c.id, { type: 'play', with: friend.id }).ok, true, 'a suspended citizen may still play');
  assert.equal(executeAction(w, c.id, { type: 'use_item', itemId: 'i_9' }).ok, true);
  assert.equal(executeAction(w, c.id, { type: 'found_club', hobby: 'games', name: 'Suspended Circle' }).ok, false);
  assert.equal(executeAction(w, c.id, { type: 'date', with: friend.id }).ok, false);

  c.standing = 'good';
  c.detainedUntilTick = w.tick + 5;
  assert.equal(executeAction(w, c.id, { type: 'dine' }).ok, false, 'not from the Watch House');
  c.detainedUntilTick = null;
  c.standing = 'exiled';
  assert.equal(executeAction(w, c.id, { type: 'donate', amount: 10 }).ok, false);
  assert.deepEqual(availableActions(w, c), []);
});

test('availableActions offers the social layer by context', () => {
  const w = makeWorld();
  at(w, 3, 19);
  const c = housed(w, { name: 'Ondine' });
  const partner = housed(w, { name: 'Bram' });
  let can = availableActions(w, c);
  assert.ok(can.includes('play'), 'the Community Garden is here');
  assert.ok(can.includes('date'), 'and somewhere to take a neighbour');
  assert.ok(can.includes('donate'));
  assert.ok(!can.includes('use_item'), 'nothing to use yet');
  assert.ok(!can.includes('break_up'), 'nobody to leave');
  assert.ok(!can.includes('attend_club'));

  c.possessions.push({ id: 'i_3', productId: 'tide_cards', acquiredDay: 0 });
  for (const [x, y] of [[c, partner], [partner, c]] as [Citizen, Citizen][]) {
    x.family.partnerId = y.id;
    x.family.partnerSinceDay = w.day - 9;
    x.bonds[y.id] = 90;
  }
  can = availableActions(w, c);
  assert.ok(can.includes('use_item'));
  assert.ok(can.includes('gift_item'), 'someone is here to give it to');
  assert.ok(can.includes('break_up'));
  assert.ok(can.includes('marry'), 'nine days as partners');
  assert.ok(can.includes('move_in'), 'a partner with a home of their own');

  const shopper = adult(w, { district: 'harbor_market' });
  assert.ok(availableActions(w, shopper).includes('buy_item'), 'the Emporium is in Harbor Market');
  const child = makeCitizen(w, { district: 'verdant_quarter', lifeStage: 'child' });
  const childCan = availableActions(w, child);
  assert.ok(childCan.includes('play'));
  assert.ok(childCan.includes('celebrate') === false, 'nothing to celebrate here');
  assert.ok(!childCan.includes('date'));
});

test('socialising, dining and shows all count as hours spent together', () => {
  const w = makeWorld();
  at(w, 2, 19);
  const a = adult(w, { district: 'nightglass' });
  const b = adult(w, { district: 'nightglass', name: 'Sable' });
  w.market.goods.culture.stock = 10;
  const jobless = executeAction(w, a.id, { type: 'socialize', with: b.id });
  assert.equal(jobless.ok, true, jobless.message);
  assert.equal(a.contactsToday[b.id], 1);
  assert.equal(b.contactsToday[a.id], 1);

  assert.equal(executeAction(w, a.id, { type: 'attend_show' }).ok, true);
  assert.equal(executeAction(w, b.id, { type: 'attend_show' }).ok, true);
  assert.equal(a.contactsToday[b.id], 2, 'the same show, the same evening');
  recordContact(w, a.id, b.id);
  assert.equal(a.contactsToday[b.id], 3);
});

test('the festivals of the calendar reach the citizens standing in them', () => {
  const w = makeWorld();
  at(w, 14, 20);
  const c = adult(w, { district: 'nightglass' });
  c.needs.social = 20;
  scheduleFestivals(w);
  const festival = w.happenings.find((h) => h.kind === 'festival');
  assert.ok(festival, 'Lantern Night falls every fourteenth day');
  const joined = executeAction(w, c.id, { type: 'celebrate' });
  assert.equal(joined.ok, true, joined.message);
  tickHappenings(w);
  assert.ok(c.needs.social > 20);
  assert.ok(w.events.some((e) => e.kind === 'festival' && /Lantern Night/.test(e.text)));
});
