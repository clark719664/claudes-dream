import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import type { Citizen, PropertyUnit, World } from '../src/types.ts';
import { dailyBusinesses } from '../src/economy/business.ts';
import { generationsState } from '../src/generations/state.ts';
import {
  FOUND_HOUSE_ADULTS, FOUND_HOUSE_COST, admitToHouse, allHouses, foundHouse, headOf, houseAdults,
  houseFor, houseHeaded, houseOfName, renounceName,
} from '../src/generations/houses.ts';
import {
  claimHouse, founderLine, goDormant, headVoteTally, houseVote, investHead, nameSuccessor,
  refreshHead, ruleSaysHead, showsDescent,
} from '../src/generations/head.ts';
import {
  LIQUIDATION_LOW, chargeHouseLevy, collectEntailRents, conveyBusinessToHouse, conveyToHouse,
  endowHouse, entailGuard, entailedIn, houseLandValue, houseTreasury, houseWorth, levyDue,
  sellUpForLevy, sweepEntailedBusinesses,
} from '../src/generations/entail.ts';
import {
  houseAssent, houseMotion, joinHouse, motionTally, openMotionsOf, resolveMotion,
} from '../src/generations/motions.ts';
import { generationsSettings } from '../src/generations/state.ts';

function ashgroves(world: World, n = 3, wallet = 600): Citizen[] {
  return Array.from({ length: n }, () => makeCitizen(world, { familyName: 'Ashgrove', wallet }));
}

function unitFor(world: World, owner: Citizen, rent = 10): PropertyUnit {
  const id = `y_${Object.keys(world.property).length + 1}`;
  const u: PropertyUnit = {
    id, kind: 'home', tier: 1, buildingId: 'lantern_lofts', ownerId: owner.id, tenantId: null, rent,
  };
  world.property[id] = u;
  owner.ownedUnits.push(id);
  return u;
}

// ---------------------------------------------------------------------------
// Founding
// ---------------------------------------------------------------------------

test('three adults of a name and 500 lumens found a house, and the fee is a transfer', () => {
  const w = makeWorld();
  const [a] = ashgroves(w);
  const before = totalMoney(w);
  const treasury = w.treasury.balance;

  const result = foundHouse(w, a.id, 'Ashgrove', 'eldest');
  assert.equal(result.ok, true, result.message);
  const house = houseOfName(w, 'Ashgrove');
  assert.ok(house);
  assert.equal(house.headId, a.id, 'the founder is its first head');
  assert.equal(house.rule, 'eldest');
  assert.equal(a.wallet, 100);
  assert.equal(w.treasury.balance, treasury + FOUND_HOUSE_COST);
  assert.equal(totalMoney(w), before, 'founding a house mints nothing');
  assert.equal(houseTreasury(w, house), 0, 'and endows it with nothing');
});

test('a house takes three adults of the name, the name itself, and the fee', () => {
  const w = makeWorld();
  const [a, b] = ashgroves(w, 2);
  assert.equal(foundHouse(w, a.id, 'Ashgrove', 'eldest').ok, false, `${FOUND_HOUSE_ADULTS} adults or none`);
  makeCitizen(w, { familyName: 'Ashgrove', lifeStage: 'child' });
  assert.equal(foundHouse(w, a.id, 'Ashgrove', 'eldest').ok, false, 'a child is not an adult of the name');
  ashgroves(w, 1);
  assert.equal(foundHouse(w, a.id, 'Vantage', 'eldest').ok, false, 'only your own name');
  b.wallet = 10;
  assert.equal(foundHouse(w, b.id, 'Ashgrove', 'eldest').ok, false, 'and only with the fee');
  assert.equal(foundHouse(w, a.id, 'Ashgrove', 'eldest').ok, true);
  assert.equal(foundHouse(w, a.id, 'Ashgrove', 'eldest').ok, false, 'a name is founded once');
});

test('everybody carrying the name is of the house, and a child of it is too', () => {
  const w = makeWorld();
  const [a] = ashgroves(w);
  foundHouse(w, a.id, 'Ashgrove', 'eldest');
  const house = houseOfName(w, 'Ashgrove');
  assert.ok(house);
  assert.equal(houseAdults(w, house).length, 3);
  const born = makeCitizen(w, { familyName: 'Ashgrove', lifeStage: 'child' });
  assert.equal(houseFor(w, born.id)?.id, house.id, 'a child born to the name is of the house');
  assert.equal(houseAdults(w, house).length, 3, 'and is not counted among its adults');
});

// ---------------------------------------------------------------------------
// The entail
// ---------------------------------------------------------------------------

function founded(world: World): { house: NonNullable<ReturnType<typeof houseOfName>>; members: Citizen[] } {
  const members = ashgroves(world);
  foundHouse(world, members[0].id, 'Ashgrove', 'eldest');
  const house = houseOfName(world, 'Ashgrove');
  assert.ok(house);
  return { house, members };
}

test('an endowment is entailed: it moves through the ledger and cannot be taken back', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const before = totalMoney(w);
  assert.equal(endowHouse(w, members[1].id, 200).ok, true);
  assert.equal(houseTreasury(w, house), 200);
  assert.equal(members[1].wallet, 400);
  assert.equal(totalMoney(w), before, 'an endowment mints nothing');
  assert.equal(w.businesses[house.boxId].treasury, 200, 'the house treasury is a real party');
  assert.equal(endowHouse(w, members[1].id, 10_000).ok, false, 'and never more than the purse holds');
});

test('a property conveyed into the entail leaves the member and cannot be sold by them', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const u = unitFor(w, members[0]);
  assert.equal(entailGuard(w, u.id), null, 'a deed nobody entailed is free to sell');

  assert.equal(conveyToHouse(w, members[0].id, u.id).ok, true);
  assert.equal(u.ownerId, house.boxId);
  assert.equal(members[0].ownedUnits.includes(u.id), false);
  assert.equal(entailedIn(w, u.id)?.id, house.id);
  assert.ok((entailGuard(w, u.id) ?? '').includes('entailed'));
  assert.ok(houseLandValue(w, house) > 0);
  assert.equal(conveyToHouse(w, members[1].id, u.id).ok, false, 'and it is not somebody else\'s to convey either');
});

test('a business conveyed into the entail pays the house, not a member', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const owner = members[0];
  w.businesses.b_press = {
    id: 'b_press', name: 'The Ashgrove Press', kind: 'studio', ownerId: owner.id, treasury: 500,
    district: 'nightglass', buildingId: 'shopfronts_nightglass', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 0, daysNegative: 0, revenueToday: 0, costsToday: 0,
    dissolvedDay: null, shelf: {},
  };
  owner.businessId = 'b_press';
  const before = totalMoney(w);

  assert.equal(conveyBusinessToHouse(w, owner.id, 'b_press').ok, true);
  assert.equal(w.businesses.b_press.ownerId, house.boxId);
  assert.equal(owner.businessId, null);
  const walletBefore = owner.wallet;
  sweepEntailedBusinesses(w);
  assert.equal(owner.wallet, walletBefore, 'the payout does not reach the member');
  assert.equal(houseTreasury(w, house), 200, 'it reaches the house');
  assert.equal(totalMoney(w), before, 'and mints nothing');
  assert.ok(houseWorth(w, house) >= 200);

  // A strongbox is never settled like a shop.
  const treasuryBefore = w.treasury.balance;
  dailyBusinesses(w);
  assert.equal(houseTreasury(w, house), 200);
  assert.equal(w.treasury.balance >= treasuryBefore, true);
});

test('the levy is charged once a cycle on the land, and arrears sell a house up', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const u = unitFor(w, members[0], 40);
  conveyToHouse(w, members[0].id, u.id);
  const land = houseLandValue(w, house);
  assert.ok(land > 0);
  assert.equal(levyDue(w, house), Math.round(land * generationsSettings(w).houseLevy));

  endowHouse(w, members[1].id, levyDue(w, house));
  const before = totalMoney(w);
  // A house founded this cycle is levied from the next one.
  assert.equal(chargeHouseLevy(w, house), 0, 'the cycle it was founded in is already charged');
  w.government.cycle += 1;
  const paid = chargeHouseLevy(w, house);
  assert.equal(paid, levyDue(w, house));
  assert.equal(house.levyArrears, 0);
  assert.equal(chargeHouseLevy(w, house), 0, 'and once a cycle only');
  assert.equal(totalMoney(w), before, 'the levy is a transfer');

  // A house that cannot pay falls into arrears, and the Exchange sells it up.
  w.government.cycle += 1;
  generationsSettings(w).houseLevy = 0.05;
  chargeHouseLevy(w, house);
  assert.ok(house.levyArrears > 0, 'what the treasury cannot pay stands as arrears');
  const supply = totalMoney(w);
  sellUpForLevy(w, house);
  assert.equal(house.units.length, 0, 'the dearest holding went');
  assert.equal(u.ownerId, 'city');
  assert.equal(totalMoney(w), supply, 'a forced sale is a transfer too');
});

test('rent on the entail is collected for the house, never for a member', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const u = unitFor(w, members[0], 12);
  conveyToHouse(w, members[0].id, u.id);
  const tenant = makeCitizen(w, { familyName: 'Vell', wallet: 100 });
  u.tenantId = tenant.id;

  const before = totalMoney(w);
  assert.equal(collectEntailRents(w), 12);
  assert.equal(tenant.wallet, 88);
  assert.equal(houseTreasury(w, house), 12);
  assert.equal(totalMoney(w), before);

  // A tenant who cannot pay is not put out by the house: it is a landlord, not a court.
  tenant.wallet = 0;
  assert.equal(collectEntailRents(w), 0);
  assert.equal(u.tenantId, tenant.id);
});

// ---------------------------------------------------------------------------
// Motions
// ---------------------------------------------------------------------------

test('a motion takes a majority of the adults, and the head cannot carry one alone', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const [head, second, third] = members;
  const outsider = makeCitizen(w, { familyName: 'Vell' });

  const moved = houseMotion(w, head.id, { kind: 'campaign', target: second.id, value: 50 });
  assert.equal(moved.ok, false, 'a house cannot fund what it does not hold');
  endowHouse(w, third.id, 200);
  assert.equal(houseMotion(w, head.id, { kind: 'campaign', target: second.id, value: 50 }).ok, true);

  const motion = openMotionsOf(w, house)[0];
  assert.ok(motion);
  assert.equal(motionTally(w, house, motion).needed, 2, 'three adults: two carry it');
  assert.equal(motionTally(w, house, motion).ayes, 1, 'moving is a vote');
  assert.equal(houseAssent(w, outsider.id, motion.id, true).ok, false, 'and only the adults of the house vote');

  const walletBefore = second.wallet;
  assert.equal(houseAssent(w, third.id, motion.id, true).ok, true);
  assert.equal(motion.status, 'carried');
  assert.equal(second.wallet, walletBefore + 50, 'the house funded the campaign');
  assert.equal(houseTreasury(w, house), 150);
});

test('amending the rule takes four-fifths, not a majority', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const [a, b, c] = members;
  assert.equal(houseMotion(w, a.id, { kind: 'rule', target: 'assent' }).ok, true);
  const motion = openMotionsOf(w, house)[0];
  assert.equal(motionTally(w, house, motion).needed, 3, 'four-fifths of three is three');
  houseAssent(w, b.id, motion.id, true);
  assert.equal(house.rule, 'eldest', 'two of three is not four-fifths');
  houseAssent(w, c.id, motion.id, true);
  assert.equal(house.rule, 'assent');
});

test('a motion nobody finishes is decided when it has stood its days, and a tie is not a majority', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const [a, b] = members;
  houseMotion(w, a.id, { kind: 'rule', target: 'chosen' });
  const motion = openMotionsOf(w, house)[0];
  houseAssent(w, b.id, motion.id, false);
  w.day += 2;
  resolveMotion(w, house, motion, true);
  assert.equal(motion.status, 'lost');
  assert.equal(house.rule, 'eldest');
});

test('a citizen asks to join and the members assent; nobody is written into a name', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const asker = makeCitizen(w, { name: 'Wren', familyName: 'Vell' });

  assert.equal(joinHouse(w, asker.id, house.id).ok, true);
  const motion = openMotionsOf(w, house)[0];
  assert.equal(motion.kind, 'admit');
  assert.equal(motionTally(w, house, motion).ayes, 0, 'the asker has no vote in it');
  assert.equal(asker.familyName, 'Vell', 'and nothing has happened yet');

  houseAssent(w, members[0].id, motion.id, true);
  houseAssent(w, members[1].id, motion.id, true);
  assert.equal(motion.status, 'carried');
  assert.equal(asker.familyName, 'Ashgrove');
  assert.equal(asker.family.familyName, 'Ashgrove');
  assert.equal(houseFor(w, asker.id)?.id, house.id);
});

test('selling an entailed asset takes a motion; no member may sell one alone', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const u = unitFor(w, members[0], 20);
  conveyToHouse(w, members[0].id, u.id);
  const before = totalMoney(w);

  houseMotion(w, members[0].id, { kind: 'sell', target: u.id });
  const motion = openMotionsOf(w, house)[0];
  houseAssent(w, members[1].id, motion.id, true);
  assert.equal(motion.status, 'carried');
  assert.equal(house.units.length, 0);
  assert.equal(u.ownerId, 'city');
  assert.ok(houseTreasury(w, house) > 0, 'what it fetched went into the entail');
  assert.equal(totalMoney(w), before);
});

// ---------------------------------------------------------------------------
// The head
// ---------------------------------------------------------------------------

test('the eldest rule seats the oldest living adult, and the rule is read every morning', () => {
  const w = makeWorld();
  const members = ashgroves(w);
  members[0].bornDay = -5;
  members[1].bornDay = -30;
  members[2].bornDay = -10;
  foundHouse(w, members[0].id, 'Ashgrove', 'eldest');
  const house = houseOfName(w, 'Ashgrove');
  assert.ok(house);
  assert.equal(house.headId, members[0].id, 'the founder starts as head');
  refreshHead(w, house);
  assert.equal(ruleSaysHead(w, house), members[1].id);
  investHead(w, house, members[1].id, 'the eldest rule');
  assert.equal(headOf(w, house), members[1].id);
  assert.equal(house.heads.length, 2);
  assert.equal(house.heads[0].toDay, w.day, 'the roll keeps every head in order');
});

test('a head who leaves is replaced by the rule; under `chosen` by the one they named', () => {
  const w = makeWorld();
  const members = ashgroves(w);
  foundHouse(w, members[0].id, 'Ashgrove', 'chosen');
  const house = houseOfName(w, 'Ashgrove');
  assert.ok(house);
  assert.equal(nameSuccessor(w, members[1].id, members[2].id).ok, false, 'only the head names one');
  assert.equal(nameSuccessor(w, members[0].id, members[2].id).ok, true);
  assert.equal(house.successorId, members[2].id);

  // Effective at the head's sunset, and not before.
  assert.equal(headOf(w, house), members[0].id);
  members[0].sunsetDay = w.day;
  w.order = w.order.filter((id) => id !== members[0].id);
  refreshHead(w, house);
  assert.equal(house.headId, members[2].id);
});

test('under `assent` the adults elect the head, and only the adults of the house', () => {
  const w = makeWorld();
  const members = ashgroves(w);
  foundHouse(w, members[0].id, 'Ashgrove', 'assent');
  const house = houseOfName(w, 'Ashgrove');
  assert.ok(house);
  const outsider = makeCitizen(w, { familyName: 'Vell' });
  assert.equal(houseVote(w, outsider.id, members[1].id).ok, false);
  assert.equal(houseVote(w, members[1].id, members[1].id).ok, true);
  assert.equal(houseVote(w, members[2].id, members[1].id).ok, true);
  assert.equal(headVoteTally(w, house)[0].votes, 2);
  refreshHead(w, house);
  assert.equal(house.headId, members[1].id);
});

test('under `founder_line` the eldest living descendant leads, and the line may fail', () => {
  const w = makeWorld();
  const members = ashgroves(w);
  const founder = members[0];
  const heir = makeCitizen(w, { familyName: 'Ashgrove', bornDay: -3 });
  founder.family.children = [heir.id];
  heir.family.parents = [founder.id];
  foundHouse(w, founder.id, 'Ashgrove', 'founder_line');
  const house = houseOfName(w, 'Ashgrove');
  assert.ok(house);
  assert.equal(founderLine(w, house)?.id, heir.id);

  w.order = w.order.filter((id) => id !== heir.id);
  const fallback = ruleSaysHead(w, house);
  assert.ok(fallback && fallback !== heir.id, 'a failed line reverts to the eldest');
});

test('a head in custody cannot act for the house; the members carry an acting head', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const head = members[0];
  head.jailedUntilDay = w.day + 5;
  refreshHead(w, house);
  assert.equal(house.headId, head.id, 'the head keeps the office');
  assert.ok(house.actingHeadId, 'and somebody carries it');
  assert.notEqual(headOf(w, house), head.id);
  assert.equal(houseHeaded(w, head.id), null, 'the head cannot act while inside');

  head.jailedUntilDay = null;
  refreshHead(w, house);
  assert.equal(house.actingHeadId, null);
  assert.equal(headOf(w, house), head.id);
});

// ---------------------------------------------------------------------------
// Renouncing, dormancy, and the claim
// ---------------------------------------------------------------------------

test('any adult may renounce a name, keeping their repute, their record and their kin', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const leaver = members[1];
  const reputation = leaver.reputation;
  leaver.record.convictions.push({ caseId: 'k_1', law: 'L06', severity: 3, tier: 3, day: 0 });

  const result = renounceName(w, leaver.id, 'Wren');
  assert.equal(result.ok, true, result.message);
  assert.equal(leaver.familyName, 'Wren');
  assert.equal(leaver.family.familyName, 'Wren');
  assert.equal(leaver.reputation, reputation, 'repute and record are the citizen\'s, not the name\'s');
  assert.equal(leaver.record.convictions.length, 1);
  assert.equal(houseFor(w, leaver.id), null);
  assert.equal(houseAdults(w, house).length, 2);
  assert.ok(house.renounced.includes(leaver.id));
});

test('renouncing cannot take another family\'s name, and falls back to your own', () => {
  const w = makeWorld();
  const { members } = founded(w);
  makeCitizen(w, { name: 'Sable', familyName: 'Vell' });
  assert.equal(renounceName(w, members[1].id, 'Vell').ok, false);
  const own = renounceName(w, members[1].id);
  assert.equal(own.ok, true);
  assert.equal(members[1].familyName, members[1].name);
});

test('a house with no adults left goes dormant, keeps its holdings, and is revived by descent', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const u = unitFor(w, members[0], 15);
  conveyToHouse(w, members[0].id, u.id);
  endowHouse(w, members[0].id, 100);
  const heir = makeCitizen(w, { familyName: 'Vell', name: 'Wren' });
  heir.family.parents = [members[0].id];
  members[0].family.children = [heir.id];
  for (const m of members) { w.order = w.order.filter((id) => id !== m.id); }

  goDormant(w, house);
  assert.equal(house.dormantDay, w.day);
  assert.equal(house.headId, null);
  assert.equal(house.units.length, 1, 'the Exchange holds what it held');
  assert.equal(houseTreasury(w, house), 100);

  // A claim the tree bears out revives it, arrears and all.
  house.levyArrears = 40;
  assert.equal(showsDescent(w, heir.id, house), true);
  const claim = claimHouse(w, heir.id, house.id);
  assert.equal(claim.ok, true, claim.message);
  assert.equal(heir.familyName, 'Ashgrove');
  assert.equal(house.dormantDay, null);
  assert.equal(house.headId, heir.id);
  assert.equal(house.levyArrears, 40, 'the holdings, the arrears and the stain come together');
});

test('a claim of descent the tree does not bear out is an offence, and revives nothing', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  for (const m of members) { w.order = w.order.filter((id) => id !== m.id); }
  goDormant(w, house);

  const stranger = makeCitizen(w, { familyName: 'Vell' });
  assert.equal(showsDescent(w, stranger.id, house), false);
  const result = claimHouse(w, stranger.id, house.id);
  assert.equal(result.ok, false);
  assert.equal(result.offence, 'L44');
  assert.equal(stranger.familyName, 'Vell');
  assert.equal(house.dormantDay !== null, true);
  // The charge is laid the moment `data/laws.ts` carries L44; until it does,
  // `commitOffence` ignores a code the Code of the City does not yet have, and
  // the result still names the offence for the pass that wires it in.
  assert.equal(result.detected, false);
});

test('a dormant house is not joined, and admitting somebody takes them into the name', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const asker = makeCitizen(w, { familyName: 'Vell' });
  house.dormantDay = w.day;
  assert.equal(joinHouse(w, asker.id, house.id).ok, false);
  house.dormantDay = null;
  assert.equal(admitToHouse(w, house, asker.id).ok, true);
  assert.equal(asker.familyName, 'Ashgrove');
  assert.equal(allHouses(w).length, 1);
  assert.equal(members.length, 3);
});

test('a forced sale never fetches the whole price', () => {
  const w = makeWorld();
  const { house, members } = founded(w);
  const u = unitFor(w, members[0], 30);
  conveyToHouse(w, members[0].id, u.id);
  const worth = houseLandValue(w, house);
  house.levyArrears = worth;
  sellUpForLevy(w, house);
  const paidToTreasury = worth - house.levyArrears;
  assert.ok(paidToTreasury < worth, 'the Exchange takes it at 60–75% of what it is worth');
  assert.ok(paidToTreasury >= Math.floor(worth * LIQUIDATION_LOW) - 1);
});

test('the register keeps every house ever founded, dormant or not', () => {
  const w = makeWorld();
  const { house } = founded(w);
  goDormant(w, house);
  assert.equal(allHouses(w).length, 1);
  assert.equal(Object.keys(generationsState(w).houses).length, 1);
});
