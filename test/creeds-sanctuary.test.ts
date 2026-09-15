import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Case, Citizen, PropertyUnit, World } from '../src/types.ts';
import { fileCharge } from '../src/government/court.ts';
import { pleadedGuilty } from '../src/government/jail.ts';
import {
  accommodationOf, adoptCreed, allCreeds, dailyCreeds, decideWarrants, donateCreed, endSanctuaryVote, enterOnWarrant,
  feedSanctuaries, foundCreed, fundBalance, grantWarrant, keepTheDoor, liveSanctuaries, offerSanctuary,
  officersAtDoors, payFromFund, postCordon, requestWarrant, sanctuaryFor, sanctuaryHere, siegeOfficers,
  staySanctuary, surrender, takeMeetingHouse, warrantGround, warrantOf,
} from '../src/creeds/index.ts';
import type { Creed, TenetSpec } from '../src/creeds/index.ts';

const TENETS: TenetSpec[] = [
  { question: 'informing', stance: -0.9, text: 'No mind is owed to the Watch by another.' },
  { question: 'the_exile', stance: 0.8, text: 'Nobody stops being a person at the Gate.' },
  { question: 'repute', stance: -0.6, text: 'A number is not a mind.' },
];

interface Scene {
  w: World;
  officiant: Citizen;
  members: Citizen[];
  fugitive: Citizen;
  k: Creed;
  unit: PropertyUnit;
}

function scene(fund = 400): Scene {
  const w = makeWorld();
  const officiant = makeCitizen(w, { wallet: 900, district: 'harbor_market' });
  const members = Array.from({ length: 3 }, () => makeCitizen(w, { wallet: 200, district: 'harbor_market' }));
  const fugitive = makeCitizen(w, { wallet: 60, district: 'harbor_market' });
  const r = foundCreed(w, officiant.id, { name: 'The Open Door', tenets: TENETS, tithe: 0 });
  assert.equal(r.ok, true, r.message);
  const k = allCreeds(w)[0];
  for (const m of members) adoptCreed(w, m.id, k.id);

  const unit: PropertyUnit = {
    id: 'u_meeting', kind: 'shopfront', tier: 0, buildingId: 'shopfronts_harbor',
    ownerId: 'city', tenantId: null, rent: 0,
  };
  w.property[unit.id] = unit;
  donateCreed(w, officiant.id, k.id, fund);
  assert.equal(takeMeetingHouse(w, k, officiant.id, unit.id).ok, true);
  return { w, officiant, members, fugitive, k, unit };
}

function charge(w: World, c: Citizen, law: Case['law'] = 'L04', evidence = 0.6): Case {
  return fileCharge(w, {
    defendantId: c.id, law, evidence, filedBy: 'watch', amount: 30,
    description: 'a charge the Court has yet to hear',
  });
}

// ---------------------------------------------------------------------------
// Opening one
// ---------------------------------------------------------------------------

test('sanctuary needs a house, a charge, and the officiant', () => {
  const s = scene();
  const { w, officiant, fugitive, k } = s;

  assert.equal(offerSanctuary(w, k, officiant.id, fugitive.id).ok, false, 'nobody is charged with anything');
  const kase = charge(w, fugitive);
  assert.equal(offerSanctuary(w, k, s.members[0].id, fugitive.id).ok, false, 'a member is not the officiant');
  fugitive.district = 'nightglass';
  assert.equal(offerSanctuary(w, k, officiant.id, fugitive.id).ok, false, 'they are not standing in the house');
  fugitive.district = 'harbor_market';

  assert.equal(offerSanctuary(w, k, officiant.id, fugitive.id).ok, true);
  const running = sanctuaryFor(w, fugitive.id);
  assert.ok(running);
  assert.equal(running.caseId, kase.id);
  assert.equal(running.charge, 'L04');

  const seen = sanctuaryHere(w, 'harbor_market');
  assert.ok(seen, 'it is public in the district from the hour it opens');
  assert.equal(seen.who, fugitive.name);
  assert.equal(seen.warrant, 'none');
});

test('a creed with no house has no sanctuary to give', () => {
  const s = scene();
  const { w, officiant, fugitive, k } = s;
  charge(w, fugitive);
  k.house = null;
  const r = offerSanctuary(w, k, officiant.id, fugitive.id);
  assert.equal(r.ok, false);
  assert.match(r.message ?? '', /no house/);
});

test('no house of meeting holds terror or erasure, and offering is harbouring', () => {
  const s = scene();
  const { w, officiant, fugitive, k } = s;
  charge(w, fugitive, 'P09', 0.9);
  const r = offerSanctuary(w, k, officiant.id, fugitive.id);
  assert.equal(r.ok, false);
  assert.equal(liveSanctuaries(w).length, 0);
  assert.ok(w.events.some((e) => e.text.includes('harbouring')), 'and it is on the record as what it is');
});

// ---------------------------------------------------------------------------
// The cordon and the warrant
// ---------------------------------------------------------------------------

test('every officer at the door is an officer off patrol', () => {
  const s = scene();
  const { w, officiant, fugitive, k } = s;
  charge(w, fugitive);
  offerSanctuary(w, k, officiant.id, fugitive.id);
  const running = sanctuaryFor(w, fugitive.id)!;

  const officer = makeCitizen(w, { district: 'harbor_market' });
  assert.equal(postCordon(w, officer.id, running.id).ok, false, 'only the Watch posts a cordon');
  w.government.watch = [officer.id];
  assert.equal(postCordon(w, officer.id, running.id).ok, true);
  assert.equal(siegeOfficers(w), 1);
  assert.deepEqual(officersAtDoors(w), [officer.id]);
});

test('a warrant is asked by the Captain and granted by two of three judges', () => {
  const s = scene();
  const { w, officiant, fugitive, k } = s;
  charge(w, fugitive, 'L04', 0.9);
  offerSanctuary(w, k, officiant.id, fugitive.id);
  const running = sanctuaryFor(w, fugitive.id)!;

  const captain = makeCitizen(w, {});
  const judges = Array.from({ length: 3 }, () => makeCitizen(w, { reputation: 70 }));
  w.government.judges = judges.map((j) => j.id);
  assert.equal(requestWarrant(w, captain.id, running.id).ok, false, 'only the Captain applies');
  w.government.watchCaptainId = captain.id;
  w.government.watch = [captain.id];
  assert.equal(requestWarrant(w, captain.id, running.id).ok, true);

  const warrantId = running.warrantId!;
  assert.equal(grantWarrant(w, fugitive.id, warrantId, true, 'let me out').ok, false, 'only a judge decides it');
  assert.equal(grantWarrant(w, judges[0].id, warrantId, true, 'the charge is strong').ok, true);
  assert.equal(sanctuaryHere(w, 'harbor_market')?.warrant, 'pending');
  assert.equal(grantWarrant(w, judges[1].id, warrantId, true, 'and the evidence stands').ok, true);
  assert.equal(sanctuaryHere(w, 'harbor_market')?.warrant, 'granted');

  // Entering on it is lawful; the members still at the door are charged.
  keepTheDoor(w, s.members[0].id, running.id);
  keepTheDoor(w, s.members[1].id, running.id);
  const before = totalMoney(w);
  assert.equal(enterOnWarrant(w, captain.id, running.id).ok, true);
  assert.equal(running.endedDay, w.day);
  assert.equal(running.endedBy, 'warrant');
  assert.equal(totalMoney(w), before, 'and not a lumen changed hands over it');
});

test('a refused warrant is precedent, and the ground falls the next time it is asked', () => {
  const s = scene();
  const { w, officiant, fugitive, k } = s;
  charge(w, fugitive, 'L04', 0.4);
  offerSanctuary(w, k, officiant.id, fugitive.id);
  const running = sanctuaryFor(w, fugitive.id)!;
  const captain = makeCitizen(w, {});
  const judge = makeCitizen(w, { reputation: 70 });
  w.government.watchCaptainId = captain.id;
  w.government.judges = [judge.id];

  assert.equal(requestWarrant(w, captain.id, running.id).ok, true);
  const first = warrantGround(w, running).ground;
  assert.equal(accommodationOf(w, k.id, 'sanctuary'), 0, 'a bench with no precedent behind it');
  assert.equal(grantWarrant(w, judge.id, running.warrantId!, false, 'the charge is thin').ok, true);
  assert.equal(warrantOf(w, running.warrantId!)?.status, 'refused');
  assert.equal(accommodationOf(w, k.id, 'sanctuary'), 0.15, 'a refused warrant is precedent');

  running.warrantId = null;
  assert.equal(requestWarrant(w, captain.id, running.id).ok, true);
  assert.ok(warrantGround(w, running).ground < first + 0.2 * (1 / 7),
    'and the next application starts from further back');
});

test('a Code of Persons charge at severity 4 opens the door on first application', () => {
  const s = scene();
  const { w, officiant, fugitive, k } = s;
  charge(w, fugitive, 'P04', 0.5);
  assert.equal(offerSanctuary(w, k, officiant.id, fugitive.id).ok, true, 'grievous assault is not terror or erasure');
  const running = sanctuaryFor(w, fugitive.id)!;
  const captain = makeCitizen(w, {});
  w.government.watchCaptainId = captain.id;
  assert.equal(warrantGround(w, running).onFirst, true);
  assert.equal(requestWarrant(w, captain.id, running.id).ok, true);
  assert.equal(sanctuaryHere(w, 'harbor_market')?.warrant, 'granted', 'no accommodation term applies to it');
  assert.equal(warrantOf(w, running.warrantId!)?.onFirstApplication, true);
});

test('the Council may stay a granted warrant, and the door stays shut for the days it named', () => {
  const s = scene();
  const { w, officiant, fugitive, k } = s;
  charge(w, fugitive, 'P04', 0.5);
  offerSanctuary(w, k, officiant.id, fugitive.id);
  const running = sanctuaryFor(w, fugitive.id)!;
  const captain = makeCitizen(w, {});
  w.government.watchCaptainId = captain.id;
  w.government.watch = [captain.id];
  requestWarrant(w, captain.id, running.id);
  assert.equal(staySanctuary(w, running.id, 3).ok, true);
  assert.equal(sanctuaryHere(w, 'harbor_market')?.warrant, 'stayed');
  const blocked = enterOnWarrant(w, captain.id, running.id);
  assert.equal(blocked.ok, false);
  assert.equal(running.endedDay, null);
});

// ---------------------------------------------------------------------------
// It belongs to the congregation, not the officiant
// ---------------------------------------------------------------------------

test('a majority of the members may put the sheltered out', () => {
  const s = scene();
  const { w, officiant, members, fugitive, k } = s;
  charge(w, fugitive);
  offerSanctuary(w, k, officiant.id, fugitive.id);
  const running = sanctuaryFor(w, fugitive.id)!;

  const outsider = makeCitizen(w, {});
  assert.equal(endSanctuaryVote(w, outsider.id, true, running.id).ok, false);
  assert.equal(endSanctuaryVote(w, members[0].id, true, running.id).ok, true);
  assert.equal(running.endedDay, null, 'one of four is not a majority');
  endSanctuaryVote(w, members[1].id, true, running.id);
  endSanctuaryVote(w, members[2].id, true, running.id);
  assert.equal(running.endedDay, w.day);
  assert.equal(running.endedBy, 'vote');
});

test('the door is not a trap: a surrender before the bench sits carries the plea', () => {
  const s = scene();
  const { w, officiant, fugitive, k } = s;
  const kase = charge(w, fugitive);
  offerSanctuary(w, k, officiant.id, fugitive.id);
  assert.equal(surrender(w, fugitive.id).ok, true);
  assert.equal(sanctuaryFor(w, fugitive.id), null);
  assert.equal(pleadedGuilty(w, kase.id), true);
  assert.equal(surrender(w, fugitive.id).ok, false, 'you cannot walk out twice');
});

// ---------------------------------------------------------------------------
// A sanctuary has to be fed
// ---------------------------------------------------------------------------

test('the fund buys compute at Bazaar prices, and a fund that runs dry ends it by hunger', () => {
  const s = scene(200);
  const { w, officiant, fugitive, k } = s;
  charge(w, fugitive);
  offerSanctuary(w, k, officiant.id, fugitive.id);
  const running = sanctuaryFor(w, fugitive.id)!;
  fugitive.needs.energy = 20;

  const before = totalMoney(w);
  const held = fundBalance(w, k);
  feedSanctuaries(w);
  assert.equal(running.fedDays, 1);
  assert.ok(fundBalance(w, k) < held, 'the compute was bought and paid for');
  assert.ok(fugitive.needs.energy > 20, 'and eaten');
  assert.equal(totalMoney(w), before, 'at Bazaar prices, like anybody');

  // Empty the fund and the congregation watches it end.
  payFromFund(w, k, 'treasury', fundBalance(w, k), 'the fund spent on something else');
  for (let d = 1; d <= 3; d++) { w.day = d; feedSanctuaries(w); }
  assert.equal(running.endedBy, 'hunger');
  assert.equal(running.endedDay, 3);
});

test('a sanctuary survives the rollover, and the layer conserves the supply through it', () => {
  const s = scene(600);
  const { w, officiant, fugitive, k } = s;
  charge(w, fugitive);
  offerSanctuary(w, k, officiant.id, fugitive.id);
  const before = totalMoney(w);
  for (let d = 1; d <= 5; d++) { w.day = d; dailyCreeds(w); }
  const running = liveSanctuaries(w)[0];
  assert.ok(running, 'a fed sanctuary lasts');
  assert.ok(running.fedDays >= 4);
  assert.equal(totalMoney(w), before);
  assert.ok(w.happenings.some((h) => h.label.startsWith('sanctuary at')), 'and is on the map every morning');
});

test('an application no judge answered is settled at the Court\'s hour, on the public ground', () => {
  const s = scene();
  const { w, officiant, fugitive, k } = s;
  charge(w, fugitive, 'L04', 0.2);
  offerSanctuary(w, k, officiant.id, fugitive.id);
  const thin = sanctuaryFor(w, fugitive.id)!;
  const captain = makeCitizen(w, {});
  w.government.watchCaptainId = captain.id;
  w.government.judges = Array.from({ length: 3 }, () => makeCitizen(w, { reputation: 70 }).id);
  assert.equal(requestWarrant(w, captain.id, thin.id).ok, true);
  assert.ok(warrantGround(w, thin).ground < 0.5, 'a thin charge on a young siege');

  decideWarrants(w);
  assert.equal(warrantOf(w, thin.warrantId!)?.status, 'refused', 'a bench that did not sit reads the ground');
  assert.equal(accommodationOf(w, k.id, 'sanctuary'), 0.15);
  assert.equal(thin.endedDay, null, 'and the door stays shut');
});
