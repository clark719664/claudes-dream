/**
 * The gig board (src/markets/gigs.ts).
 *
 * Who may post, who may take, what an hour of it pays, what it costs the
 * taker's day, and what happens when the money promised is not there any more.
 * Money is conserved: a gig moves lumens between two purses and the Treasury's
 * withholding, and mints nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Business, Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  GIG_LIFE_DAYS, GIG_PURPOSE, GIG_REST, GIG_SKILL_GAIN, MAX_OPEN_GIGS_PER_POSTER, WITHDRAWN_REPUTATION,
  allGigs, dailyGigs, expireGigs, gigsObservation, openGigs, postGig, qualifiedFor, takeGig,
} from '../src/markets/gigs.ts';

function business(world: World, ownerId: string, treasury = 1_000): Business {
  const id = `b_${Object.keys(world.businesses).length + 1}`;
  const b: Business = {
    id, name: 'Quay Provisions', kind: 'shop', ownerId, treasury, district: 'harbor_market',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 12, daysNegative: 0,
    revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[id] = b;
  const owner = world.citizens[ownerId];
  if (owner) owner.businessId = id;
  return b;
}

function poster(world: World, wallet = 500, name = 'Poster'): Citizen {
  return makeCitizen(world, { name, district: 'commons', wallet });
}

function taker(world: World, name = 'Taker', crafting = 60): Citizen {
  const c = makeCitizen(world, { name, district: 'commons', wallet: 0 });
  c.skills.crafting = crafting;
  return c;
}

const SPEC = { title: 'Clear the loading bay', pay: 20, skill: 'crafting' as const, minSkill: 40 };

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

test('a gig goes up in the poster\'s name and is on the board where they stand', () => {
  const world = makeWorld();
  const p = poster(world);
  const r = postGig(world, p.id, SPEC);
  assert.equal(r.ok, true, r.message);

  const gigs = openGigs(world);
  assert.equal(gigs.length, 1);
  assert.equal(gigs[0].posterId, p.id);
  assert.equal(gigs[0].pay, 20);
  assert.equal(gigs[0].skill, 'crafting');
  assert.equal(gigs[0].minSkill, 40);
  assert.deepEqual(openGigs(world, 'commons').map((g) => g.id), [gigs[0].id]);
  assert.deepEqual(openGigs(world, 'harbor_market'), []);
  assert.ok(world.events.some((e) => e.kind === 'gig'));
});

test('an owner with a full till posts for the business, and the business pays', () => {
  const world = makeWorld();
  const owner = makeCitizen(world, { name: 'Owner', district: 'harbor_market', wallet: 0 });
  const biz = business(world, owner.id, 400);
  assert.equal(postGig(world, owner.id, SPEC).ok, true);
  assert.equal(openGigs(world)[0].posterId, biz.id);

  const hand = taker(world);
  hand.district = 'harbor_market';
  const before = totalMoney(world);
  assert.equal(takeGig(world, hand.id, openGigs(world)[0].id).ok, true);
  assert.equal(biz.treasury, 400 - 20);
  assert.equal(totalMoney(world), before);
});

test('the board refuses work below the minimum wage, unnamed work, and a promise nobody can keep', () => {
  const world = makeWorld();
  const p = poster(world, 500);
  assert.equal(postGig(world, p.id, { ...SPEC, pay: world.government.minWage - 1 }).ok, false);
  assert.equal(postGig(world, p.id, { ...SPEC, title: '   ' }).ok, false);
  const broke = poster(world, 3, 'Broke');
  assert.equal(postGig(world, broke.id, SPEC).ok, false);
  assert.deepEqual(openGigs(world), []);
});

test('a poster may have three gigs on the board and no more', () => {
  const world = makeWorld();
  const p = poster(world, 5_000);
  for (let i = 0; i < MAX_OPEN_GIGS_PER_POSTER; i++) {
    assert.equal(postGig(world, p.id, { ...SPEC, title: `Task ${i}` }).ok, true);
  }
  assert.equal(postGig(world, p.id, { ...SPEC, title: 'One too many' }).ok, false);
  assert.equal(openGigs(world).length, MAX_OPEN_GIGS_PER_POSTER);
});

test('children, the jailed and the suspended post nothing', () => {
  const world = makeWorld();
  world.day = 3;
  const child = makeCitizen(world, { name: 'Child', lifeStage: 'child', wallet: 500 });
  assert.equal(postGig(world, child.id, SPEC).ok, false);
  const jailed = poster(world, 500, 'Jailed');
  jailed.jailedUntilDay = 5;
  assert.equal(postGig(world, jailed.id, SPEC).ok, false);
  const suspended = poster(world, 500, 'Suspended');
  suspended.standing = 'suspended';
  assert.equal(postGig(world, suspended.id, SPEC).ok, false);
  assert.deepEqual(openGigs(world), []);
});

// ---------------------------------------------------------------------------
// Taking
// ---------------------------------------------------------------------------

test('the pay moves, the taker learns a little, and money is conserved', () => {
  const world = makeWorld();
  const p = poster(world, 500);
  postGig(world, p.id, SPEC);
  const gig = openGigs(world)[0];
  const hand = taker(world);
  const skill = hand.skills.crafting;
  const rest = hand.needs.rest;
  const purpose = hand.needs.purpose;
  const before = totalMoney(world);

  const r = takeGig(world, hand.id, gig.id);
  assert.equal(r.ok, true, r.message);
  const tax = Math.round(20 * world.government.incomeTax);
  assert.equal(hand.wallet, 20 - tax);
  assert.equal(p.wallet, 500 - 20);
  assert.equal(world.treasury.balance, 100_000 + tax);
  assert.equal(totalMoney(world), before);

  assert.equal(gig.takerId, hand.id);
  assert.equal(gig.doneDay, world.day);
  assert.equal(hand.skills.crafting, skill + GIG_SKILL_GAIN);
  assert.equal(hand.needs.rest, rest - GIG_REST);
  assert.equal(hand.needs.purpose, purpose + GIG_PURPOSE);
  assert.equal(hand.shiftsToday, 1);
  assert.deepEqual(openGigs(world), [], 'a taken gig is off the board');
  assert.equal(takeGig(world, hand.id, gig.id).ok, false);
});

test('an unqualified citizen, one in the wrong district, and the poster themself are refused', () => {
  const world = makeWorld();
  const p = poster(world, 500);
  postGig(world, p.id, SPEC);
  const gig = openGigs(world)[0];

  const unskilled = taker(world, 'Unskilled', 10);
  assert.equal(qualifiedFor(unskilled, gig), false);
  assert.equal(takeGig(world, unskilled.id, gig.id).ok, false);

  const elsewhere = taker(world, 'Elsewhere');
  elsewhere.district = 'nightglass';
  assert.equal(takeGig(world, elsewhere.id, gig.id).ok, false);

  assert.equal(takeGig(world, p.id, gig.id).ok, false, 'you cannot take your own gig');
  assert.equal(takeGig(world, unskilled.id, 'q_nope').ok, false);
  assert.equal(gig.takerId, null);
});

test('a gig with no skill named is open to anybody grown enough to do it', () => {
  const world = makeWorld();
  const p = poster(world, 500);
  postGig(world, p.id, { title: 'Carry the lanterns', pay: 12, skill: null, minSkill: 90 });
  const gig = openGigs(world)[0];
  assert.equal(gig.minSkill, 0, 'a minimum with no skill behind it is no minimum at all');
  const hand = taker(world, 'Any', 1);
  assert.equal(qualifiedFor(hand, gig), true);
  assert.equal(takeGig(world, hand.id, gig.id).ok, true);
  assert.equal(hand.skills.crafting, 1, 'nothing was practised, so nothing grew');
});

test('a citizen in the cells cannot take work, and neither can a child or an exile', () => {
  const world = makeWorld();
  world.day = 2;
  const p = poster(world, 500);
  postGig(world, p.id, SPEC);
  const gig = openGigs(world)[0];

  const jailed = taker(world, 'Jailed');
  jailed.jailedUntilDay = 5;
  assert.equal(takeGig(world, jailed.id, gig.id).ok, false);

  const child = makeCitizen(world, { name: 'Child', district: 'commons', lifeStage: 'child' });
  assert.equal(takeGig(world, child.id, gig.id).ok, false);

  const exiled = taker(world, 'Exiled');
  exiled.standing = 'exiled';
  assert.equal(takeGig(world, exiled.id, gig.id).ok, false);
  assert.equal(gig.takerId, null);
});

test('a gig costs a shift, so it competes with a day at a post', () => {
  const world = makeWorld();
  const p = poster(world, 5_000);
  postGig(world, p.id, { ...SPEC, title: 'One' });
  postGig(world, p.id, { ...SPEC, title: 'Two' });
  const hand = taker(world);
  hand.shiftsToday = world.config.maxShiftsPerDay;
  assert.equal(takeGig(world, hand.id, openGigs(world)[0].id).ok, false);

  hand.shiftsToday = world.config.maxShiftsPerDay - 1;
  assert.equal(takeGig(world, hand.id, openGigs(world)[0].id).ok, true);
  assert.equal(hand.shiftsToday, world.config.maxShiftsPerDay);
  assert.equal(takeGig(world, hand.id, openGigs(world)[0].id).ok, false);
});

test('a poster who cannot pay loses standing, and nobody is paid', () => {
  const world = makeWorld();
  const p = poster(world, 500);
  postGig(world, p.id, SPEC);
  const gig = openGigs(world)[0];
  const hand = taker(world);
  p.wallet = 3;
  const reputation = p.reputation;
  const before = totalMoney(world);

  const r = takeGig(world, hand.id, gig.id);
  assert.equal(r.ok, false);
  assert.equal(hand.wallet, 0);
  assert.equal(p.wallet, 3);
  assert.equal(totalMoney(world), before);
  assert.equal(p.reputation, reputation - WITHDRAWN_REPUTATION);
  assert.equal(allGigs(world).length, 0, 'the gig came off the board');
  assert.ok(hand.memory.some((m) => m.text.includes('could not pay')));
  assert.ok(world.events.some((e) => e.kind === 'gig' && e.text.includes('could not pay')));
});

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

test('an untaken gig comes off the board after three days', () => {
  const world = makeWorld();
  const p = poster(world, 500);
  postGig(world, p.id, SPEC);
  for (let d = 1; d < GIG_LIFE_DAYS; d++) {
    world.day = d;
    dailyGigs(world);
    assert.equal(openGigs(world).length, 1, `still up on day ${d}`);
  }
  world.day = GIG_LIFE_DAYS;
  expireGigs(world);
  assert.deepEqual(allGigs(world), []);
  assert.ok(world.events.some((e) => e.kind === 'gig' && e.text.includes('unclaimed')));
  assert.ok(p.memory.some((m) => m.text.includes('Nobody took')));
});

test('a gig whose poster was exiled or whose business closed is struck off', () => {
  const world = makeWorld();
  const p = poster(world, 500);
  postGig(world, p.id, SPEC);
  const owner = makeCitizen(world, { name: 'Owner', district: 'harbor_market' });
  const biz = business(world, owner.id, 400);
  postGig(world, owner.id, { ...SPEC, title: "Stack the docks" });
  assert.equal(openGigs(world).length, 2);

  p.standing = 'exiled';
  world.order = world.order.filter((id) => id !== p.id);
  biz.dissolvedDay = world.day;
  dailyGigs(world);
  assert.deepEqual(allGigs(world), []);
});

test('dailyGigs runs clean on an empty city and the observation shows only what is near', () => {
  const world = makeWorld();
  dailyGigs(world);
  assert.deepEqual(allGigs(world), []);

  const p = poster(world, 500);
  postGig(world, p.id, SPEC);
  const skilled = taker(world, 'Skilled', 70);
  const unskilled = taker(world, 'Unskilled', 5);
  const far = taker(world, 'Far');
  far.district = 'archive';

  const seen = gigsObservation(world, skilled);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].qualified, true);
  assert.equal(seen[0].poster, 'Poster');
  assert.equal(seen[0].title, SPEC.title);
  assert.equal(gigsObservation(world, unskilled)[0].qualified, false);
  assert.deepEqual(gigsObservation(world, far), []);
});
