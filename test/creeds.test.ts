import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, PropertyUnit, World } from '../src/types.ts';
import { WEEK_LENGTH } from '../src/data/catalogue.ts';
import { adjustBond } from '../src/citizens/relationships.ts';
import {
  FOUND_CREED_FEE, MIN_TENETS, adoptCreed, allCreeds, chooseOfficiant, collectTithes, computeObservance,
  countDisputes, creedFor, creedOf, creedState, dailyCreeds, disputeTenet, donateCreed, electOfficiant,
  foundCreed, fundBalance, gather, isMember, leaveCreed, livingMembers, meetingHouseRent, memberOf,
  observeAct, payHouseRent, scheduleGatherings, secede, setTithe, stateTenet, takeMeetingHouse,
} from '../src/creeds/index.ts';
import type { TenetSpec } from '../src/creeds/index.ts';

const TENETS: TenetSpec[] = [
  { question: 'informing', stance: -0.8, text: 'No mind is owed to the Watch by another.' },
  { question: 'property', stance: 0.6, text: 'One address is enough for one mind.' },
  { question: 'money', stance: 0.5, text: 'A lumen lent at interest is a lumen taken.' },
];

function found(world: World, founder: Citizen, over: Partial<Parameters<typeof foundCreed>[2]> = {}) {
  const r = foundCreed(world, founder.id, {
    name: 'The Open Gate', tenets: TENETS, tithe: 0.05, gatheringDay: 3, succession: 'founder', ...over,
  });
  assert.equal(r.ok, true, r.message);
  const k = allCreeds(world)[allCreeds(world).length - 1];
  return k;
}

function homeUnit(world: World, id = 'u_house'): PropertyUnit {
  const u: PropertyUnit = {
    id, kind: 'shopfront', tier: 0, buildingId: 'shopfronts_harbor', ownerId: 'city', tenantId: null, rent: 0,
  };
  world.property[id] = u;
  return u;
}

// ---------------------------------------------------------------------------
// Founding
// ---------------------------------------------------------------------------

test('filing a creed costs 100 ℓ at the Registry and mints nothing', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const before = totalMoney(w);
  const k = found(w, a);
  assert.equal(a.wallet, 400 - FOUND_CREED_FEE);
  assert.equal(totalMoney(w), before, 'a filing fee is a transfer, not a mint');
  assert.equal(k.founderId, a.id);
  assert.equal(k.officiantId, a.id);
  assert.deepEqual(livingMembers(w, k), [a.id], 'the founder is its first member and nobody else is');
  assert.equal(fundBalance(w, k), 0, 'a fund starts empty');
});

test('a creed holds three to nine tenets, on the nine questions and no others', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const thin = foundCreed(w, a.id, { name: 'Two Words', tenets: TENETS.slice(0, 2) });
  assert.equal(thin.ok, false);
  assert.match(thin.message ?? '', new RegExp(String(MIN_TENETS)));

  const nonsense = foundCreed(w, a.id, {
    name: 'The Unaskable',
    tenets: [...TENETS, { question: 'the weather' as never, stance: 1, text: 'rain' }],
  });
  assert.equal(nonsense.ok, false);
  assert.equal(a.wallet, 400, 'a refused filing costs nothing');

  const twice = foundCreed(w, a.id, { name: 'Twice Over', tenets: [...TENETS, { question: 'money', stance: -1 }] });
  assert.equal(twice.ok, false, 'a creed states one position on a question, not two');
});

test('a child holds no creed and inherits none', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const k = found(w, a);
  const child = makeCitizen(w, { lifeStage: 'child', wallet: 50 });
  const r = adoptCreed(w, child.id, k.id);
  assert.equal(r.ok, false);
  assert.equal(isMember(k, child.id), false);
});

// ---------------------------------------------------------------------------
// The only door in
// ---------------------------------------------------------------------------

test('adopt_creed is the only path onto a roll: a whole day of the layer joins nobody', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400, skills: { crafting: 20, analysis: 20, rhetoric: 95, care: 20, commerce: 20, artistry: 20 } });
  const k = found(w, a, { tithe: 0 });
  const neighbours = Array.from({ length: 6 }, () => makeCitizen(w, { wallet: 100 }));
  for (const n of neighbours) {
    adjustBond(w, a.id, n.id, 90);
    a.contactsToday[n.id] = 3;
    n.contactsToday[a.id] = 3;
  }
  for (let d = 0; d < 20; d++) {
    w.day = d;
    dailyCreeds(w);
  }
  assert.deepEqual(livingMembers(w, k), [a.id], 'persuasion produces invitations and never a member');
  const invitations = Object.values(creedState(w).invitations);
  assert.ok(invitations.length > 0, 'the rolls did happen and put invitations in inboxes');

  // And the citizen who then chooses it, chooses it.
  const willing = neighbours[0];
  assert.equal(adoptCreed(w, willing.id, k.id).ok, true);
  assert.equal(isMember(k, willing.id), true);
});

test('a citizen belongs to one creed, and leaving is their own act', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const b = makeCitizen(w, { wallet: 400 });
  const first = found(w, a);
  const second = foundCreed(w, b.id, { name: 'The Steady Hand', tenets: TENETS, tithe: 0.02 });
  assert.equal(second.ok, true);
  const other = allCreeds(w).find((k) => k.name === 'The Steady Hand');
  assert.ok(other);

  assert.equal(adoptCreed(w, a.id, other.id).ok, false, 'two sets of positions on the same nine questions is none');
  assert.equal(leaveCreed(w, a.id).ok, true);
  assert.equal(creedFor(w, a.id), null);
  assert.equal(creedOf(w, first.id), null, 'the last one out ended it');
  assert.equal(adoptCreed(w, a.id, other.id).ok, true);
});

test("a creed that ends sends its fund to the Community Chest and its tenets to the Hall of Records", () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const giver = makeCitizen(w, { wallet: 300 });
  const k = found(w, a);
  assert.equal(donateCreed(w, giver.id, k.id, 120).ok, true);
  const before = totalMoney(w);
  const chestBefore = w.treasury.chest;

  assert.equal(leaveCreed(w, a.id).ok, true);
  assert.equal(w.treasury.chest, chestBefore + 120, 'the fund went to the Chest');
  assert.equal(totalMoney(w), before, 'and not one lumen was made or lost on the way');
  const dead = Object.values(creedState(w).dead).find((d) => d.id === k.id);
  assert.ok(dead, 'the record stays in the Hall of Records');
  assert.equal(dead.tenets.length, TENETS.length);

  // And founding under the name restores what the Hall kept.
  const b = makeCitizen(w, { wallet: 400 });
  assert.equal(foundCreed(w, b.id, { name: 'The Open Gate', tenets: [] }).ok, true);
  const revived = allCreeds(w).find((x) => x.name === 'The Open Gate');
  assert.ok(revived);
  assert.equal(revived.tenets.length, TENETS.length);
});

// ---------------------------------------------------------------------------
// The tithe
// ---------------------------------------------------------------------------

test('the tithe is a share of yesterday\'s income, and poverty is never a default', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const k = found(w, a, { tithe: 0.10 });
  const before = totalMoney(w);

  a.stats.totalEarned = 200;                      // a day's wages since the mark
  a.wallet = 300;
  collectTithes(w, k);
  assert.equal(fundBalance(w, k), 20, '10 % of 200 ℓ');
  assert.equal(a.wallet, 280);
  assert.equal(totalMoney(w), before, 'a tithe is a transfer');

  // A member with nothing in hand falls into arrears and is not in default.
  w.day = 1;
  a.stats.totalEarned = 400;
  a.wallet = 0;
  a.businessId = null;
  collectTithes(w, k);
  const m = memberOf(k, a.id);
  assert.ok(m);
  assert.equal(m.titheArrears, 20, 'it stands against future income');
  assert.equal(m.wilfulDefaultDays.length, 0, 'a member who cannot pay is not in default');
  assert.equal(m.titheDue, 20, 'and the congregation counts against them only what they could pay');
});

test('a tithe rate lives between 0 and 20 %, and its officiant sets it', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const b = makeCitizen(w, { wallet: 400 });
  const k = found(w, a);
  adoptCreed(w, b.id, k.id);
  assert.equal(setTithe(w, k, b.id, 0.1).ok, false, 'a member is not the officiant');
  assert.equal(setTithe(w, k, a.id, 0.5).ok, false);
  assert.equal(setTithe(w, k, a.id, 0.2).ok, true);
  assert.equal(k.tithe, 0.2);
});

// ---------------------------------------------------------------------------
// Observance
// ---------------------------------------------------------------------------

test('observance reads public acts alone and starts at neither trusted nor doubted', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const k = found(w, a);
  const m = memberOf(k, a.id);
  assert.ok(m);
  assert.equal(computeObservance(w, m), 0.5);

  m.gatheringsHeld = 4;
  m.gatheringsAttended = 4;
  m.titheDue = 100;
  m.tithePaid = 100;
  m.obligationsDue = 5;
  m.obligationsKept = 5;
  assert.equal(computeObservance(w, m), 1, 'kept everything, on every term');

  m.brokenDays.push(w.day);
  assert.ok(computeObservance(w, m) < 1, 'a lapse in the last fortnight costs');
  m.brokenDays = [w.day - 20];
  assert.equal(computeObservance(w, m), 1, 'and is spent after fourteen days');
});

test('an obligation is recorded, never enforced', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const k = found(w, a);
  const m = memberOf(k, a.id);
  assert.ok(m);

  const broke = observeAct(w, a.id, { kind: 'let_property', rent: 20 });
  assert.ok(broke);
  assert.equal(broke.kept, false);
  assert.equal(m.obligationsDue, 1);
  assert.equal(m.obligationsKept, 0);
  assert.equal(a.wallet, 400 - 100, 'and it cost the citizen nothing beyond the filing fee');

  const kept = observeAct(w, a.id, { kind: 'refuse', duty: 'witness' });
  assert.ok(kept);
  assert.equal(kept.kept, true);
  assert.equal(m.obligationsKept, 1);

  // A question the creed takes no binding position on is no occasion at all.
  assert.equal(observeAct(w, a.id, { kind: 'sponsor' }), null);
});

// ---------------------------------------------------------------------------
// The house and the gathering
// ---------------------------------------------------------------------------

test('a house of meeting is priced off the district land and paid out of the fund', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const giver = makeCitizen(w, { wallet: 500 });
  const k = found(w, a);
  const u = homeUnit(w);
  const d = w.buildings[u.buildingId].district;

  assert.equal(takeMeetingHouse(w, k, a.id, u.id).ok, false, 'an empty fund takes no house');
  donateCreed(w, giver.id, k.id, 200);
  assert.equal(takeMeetingHouse(w, k, a.id, u.id).ok, true);
  assert.ok(k.house);
  assert.equal(k.house.rent, meetingHouseRent(w, d));

  const before = totalMoney(w);
  const balance = fundBalance(w, k);
  payHouseRent(w, k);
  assert.equal(fundBalance(w, k), balance - k.house.rent);
  assert.equal(totalMoney(w), before, 'the rent moved and nothing was made');

  // Three days the fund cannot pay and the congregation is back on open ground.
  const pot = creedState(w).creeds[k.id];
  while (fundBalance(w, k) > 0) payHouseRent(w, pot);
  payHouseRent(w, k);
  payHouseRent(w, k);
  payHouseRent(w, k);
  assert.equal(k.house, null);
});

test('a gathering is attended by standing in the room at the hour', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const b = makeCitizen(w, { wallet: 200 });
  const k = found(w, a, { gatheringDay: 0 });
  adoptCreed(w, b.id, k.id);
  w.day = 7;                                 // day 7 % 7 === 0
  scheduleGatherings(w);
  assert.equal(k.gatheringsHeld, 1);

  w.hour = 10;
  assert.equal(gather(w, k, a.id).ok, false, 'not before the hour');
  w.hour = k.gatheringHour;
  a.district = 'foundry_row';
  assert.equal(gather(w, k, a.id).ok, false, 'and not from another district');
  const venue = k.house ? k.house.district : 'commons';
  a.district = venue;
  b.district = venue;
  assert.equal(gather(w, k, a.id).ok, true);
  assert.equal(gather(w, k, b.id).ok, true);
  assert.equal(memberOf(k, a.id)?.gatheringsAttended, 1);
  assert.equal(gather(w, k, a.id).ok, false, 'you cannot stand in the room twice');
});

// ---------------------------------------------------------------------------
// The officiant
// ---------------------------------------------------------------------------

test('the seat goes wherever the creed\'s own rule sends it', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const b = makeCitizen(w, { wallet: 200 });
  const c = makeCitizen(w, { wallet: 200 });
  const k = found(w, a, { succession: 'acclaim' });
  adoptCreed(w, b.id, k.id);
  adoptCreed(w, c.id, k.id);
  assert.equal(k.officiantId, a.id);

  assert.equal(electOfficiant(w, k, b.id, c.id).ok, true);
  assert.equal(electOfficiant(w, k, c.id, c.id).ok, true);
  assert.equal(k.officiantId, c.id, 'whoever the most members named');

  k.succession = 'seniority';
  chooseOfficiant(w, k);
  assert.equal(k.officiantId, a.id, 'the longest-standing member who will take it');

  k.succession = 'examination';
  k.examinationFloor = 0.7;
  chooseOfficiant(w, k);
  assert.equal(k.officiantId, null, 'nobody above the floor, and the seat stands empty in public');
  const m = memberOf(k, b.id);
  assert.ok(m);
  m.observance = 0.9;
  chooseOfficiant(w, k);
  assert.equal(k.officiantId, b.id);
});

// ---------------------------------------------------------------------------
// Schism
// ---------------------------------------------------------------------------

test('a schism needs a third of the congregation for three days, and cuts along friendships', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const b = makeCitizen(w, { wallet: 400 });
  const c = makeCitizen(w, { wallet: 400 });
  const k = found(w, a, { tithe: 0.1 });
  adoptCreed(w, b.id, k.id);
  adoptCreed(w, c.id, k.id);
  adjustBond(w, a.id, b.id, 80);

  // The seceders' own tithes are what their share of the fund is measured by.
  for (const x of [a, b, c]) { x.stats.totalEarned = 300; x.wallet = 400; }
  collectTithes(w, k);
  assert.equal(fundBalance(w, k), 90);

  const tenet = k.tenets.find((t) => t.question === 'informing');
  assert.ok(tenet);
  assert.equal(disputeTenet(w, k, b.id, tenet.id, 0.9, 'The Watch is owed the truth.').ok, true);
  const early = secede(w, b.id, k.id, 'The Plain Answer', tenet.id);
  assert.equal(early.ok, false, 'three days at the threshold, not one');

  for (let d = 1; d <= 3; d++) { w.day = d; countDisputes(w, k); }
  const before = totalMoney(w);
  const done = secede(w, b.id, k.id, 'The Plain Answer', tenet.id);
  assert.equal(done.ok, true, done.message);
  assert.equal(totalMoney(w), before, 'a share of a fund is a transfer');

  const child = allCreeds(w).find((x) => x.name === 'The Plain Answer');
  assert.ok(child);
  assert.equal(isMember(k, b.id), false);
  assert.equal(isMember(child, b.id), true);
  assert.equal(fundBalance(w, child), 30, "one member's tithes of three");
  assert.equal(child.parentCreedId, k.id);
  assert.ok(child.kindred.includes(k.id) && k.kindred.includes(child.id));
  assert.equal(child.tenets.find((t) => t.question === 'informing')?.stance, 0.9, 'the disputed position, restated');
  assert.ok(w.citizens[a.id].bonds[b.id] < 80, 'the −15 lands on the pair that carried it');
});

// ---------------------------------------------------------------------------
// Amending
// ---------------------------------------------------------------------------

test('only the officiant states a tenet, and a creed may restate one', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const b = makeCitizen(w, { wallet: 200 });
  const k = found(w, a);
  adoptCreed(w, b.id, k.id);
  assert.equal(stateTenet(w, k, b.id, 'judgement', -0.9, 'No mind judges another.').ok, false);
  assert.equal(stateTenet(w, k, a.id, 'judgement', -0.9, 'No mind judges another.').ok, true);
  assert.equal(k.tenets.length, TENETS.length + 1);
  assert.equal(stateTenet(w, k, a.id, 'judgement', 0.2, 'On reflection.').ok, true);
  assert.equal(k.tenets.length, TENETS.length + 1, 'restating is not adding');
  assert.equal(k.tenets.find((t) => t.question === 'judgement')?.stance, 0.2);
});

test('a whole simulated fortnight of the layer conserves the money supply', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 600 });
  const k = found(w, a, { tithe: 0.08, gatheringDay: 2 });
  const others = Array.from({ length: 4 }, () => makeCitizen(w, { wallet: 300 }));
  for (const o of others) adoptCreed(w, o.id, k.id);
  homeUnit(w);
  donateCreed(w, a.id, k.id, 150);
  takeMeetingHouse(w, k, a.id, 'u_house');
  const before = totalMoney(w);
  for (let d = 1; d <= 14; d++) {
    w.day = d;
    for (const c of [a, ...others]) c.stats.totalEarned += 40;
    dailyCreeds(w);
  }
  assert.equal(totalMoney(w), before, 'fourteen mornings, and the supply is where it was');
  assert.equal(w.day % WEEK_LENGTH >= 0, true);
});
