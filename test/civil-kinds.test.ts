/**
 * The eight kinds of instrument, each doing the one thing it is for
 * (src/civil/, `docs/CIVIL.md` §2).
 *
 * A wage per shift, a rent per day, an instalment, a split, a load of crates on
 * a struck price, a sum in escrow, a training wage under the floor, and a
 * commissioned work. Money is conserved in every one of them, and none of them
 * can reach anybody's liberty.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Business, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { acceptContract, offerContract, performContract, wageFloor } from '../src/civil/contracts.ts';
import { dailyContracts } from '../src/civil/amend.ts';
import {
  APPRENTICE_SKILL_MULTIPLIER, apprenticeshipFor, contractById, employmentContractFor, faceValue,
  firingBreaches, obligorOf, partnershipSharesOf, periodsOf,
} from '../src/civil/terms.ts';
import { civilObservation, contractCharacter } from '../src/civil/observe.ts';

function business(world: World, ownerId: string, treasury = 1_000): Business {
  const b: Business = {
    id: 'b_1', name: 'Quay Provisions', kind: 'shop', ownerId, treasury, district: 'commons',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 12, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[b.id] = b;
  const owner = world.citizens[ownerId];
  if (owner) owner.businessId = b.id;
  return b;
}

test('a forward supply moves crates one way and the struck price the other, whatever the Bazaar now says', () => {
  const world = makeWorld();
  const seller = makeCitizen(world, { name: 'Seller', wallet: 100 });
  const buyer = makeCitizen(world, { name: 'Buyer', wallet: 300 });
  const id = offerContract(world, seller.id, {
    to: buyer.id, kind: 'forward', terms: 'ten crates of goods on day three', consideration: 90, days: 3,
    penalty: 40, good: 'goods', qty: 10,
  }).id!;
  assert.equal(acceptContract(world, buyer.id, id).ok, true);
  assert.equal(periodsOf('forward', 3), 1, 'a delivery falls due once');
  assert.equal(obligorOf(contractById(world, id)!), seller.id);

  world.day = 3;
  assert.equal(performContract(world, seller.id, id).ok, false, 'the seller does not hold the crates');
  seller.inventory.goods = 10;
  const before = totalMoney(world);
  assert.equal(performContract(world, seller.id, id).ok, true);
  assert.equal(seller.inventory.goods, 0);
  assert.equal(buyer.inventory.goods, 10);
  assert.equal(seller.wallet, 100 + 90);
  assert.equal(totalMoney(world), before);
  world.day = 4;
  dailyContracts(world);
  assert.equal(contractById(world, id)!.status, 'kept');
});

test('a forward supply the buyer cannot pay for is the buyer’s breach, and nothing worse', () => {
  const world = makeWorld();
  const seller = makeCitizen(world, { name: 'Seller', wallet: 100 });
  const buyer = makeCitizen(world, { name: 'Buyer', wallet: 30 });
  const id = offerContract(world, seller.id, {
    to: buyer.id, kind: 'forward', terms: 'ten crates on day two', consideration: 90, days: 2,
    penalty: 0, good: 'goods', qty: 10,
  }).id!;
  acceptContract(world, buyer.id, id);
  seller.inventory.goods = 10;
  world.day = 2;
  const r = performContract(world, seller.id, id);
  assert.equal(r.ok, false);
  assert.match(r.message, /cannot find/);
  assert.equal(seller.inventory.goods, 10, 'nothing is delivered into a hand that cannot pay');
  assert.equal(buyer.standing, 'good');
});

test('a commission pays half on formation and half on delivery of the named work', () => {
  const world = makeWorld();
  const patron = makeCitizen(world, { name: 'Commissioner', wallet: 500 });
  const maker = makeCitizen(world, { name: 'Maker', wallet: 100 });
  const before = totalMoney(world);
  const id = offerContract(world, patron.id, {
    to: maker.id, kind: 'commission', terms: 'a portrait of the harbour', consideration: 120, days: 5, penalty: 0,
    subject: 'the harbour',
  }).id!;
  assert.equal(acceptContract(world, maker.id, id).ok, true);
  const k = contractById(world, id)!;
  assert.equal(maker.wallet, 100 - k.fee + 60);
  assert.equal(obligorOf(k), maker.id, 'the maker delivers the work');
  world.day = 5;
  assert.equal(performContract(world, maker.id, id).ok, true);
  assert.equal(maker.wallet, 100 - k.fee + 120);
  assert.equal(totalMoney(world), before);
  assert.equal(contractById(world, id)!.status, 'kept');
});

test('an employment term guarantees the post; the shift is what discharges it, and the wage still moves through the job', () => {
  const world = makeWorld();
  const owner = makeCitizen(world, { name: 'Owner', wallet: 300 });
  const worker = makeCitizen(world, { name: 'Worker', wallet: 100 });
  const b = business(world, owner.id);
  const id = offerContract(world, owner.id, {
    to: worker.id, kind: 'employment', terms: 'the counter, six days', consideration: 12, days: 6, penalty: 50,
    business: b.id,
  }).id!;
  assert.equal(acceptContract(world, worker.id, id).ok, true);
  const k = contractById(world, id)!;
  assert.equal(k.offerorParty, b.id, 'the till behind the employer');
  assert.equal(k.notice, 3, 'three days for employment, unless they agreed otherwise');

  world.day = 1;
  const before = totalMoney(world);
  assert.equal(performContract(world, worker.id, id).ok, false, 'you discharge it by working the shift');
  worker.shiftsToday = 1;
  assert.equal(performContract(world, worker.id, id).ok, true);
  assert.equal(totalMoney(world), before, 'the contract pays no second wage; the job pays the wage');
  assert.equal(worker.wallet, 100 - k.fee);

  // The post itself cannot be cut inside the term.
  assert.equal(employmentContractFor(world, worker.id, b.id)?.id, id);
  assert.ok(firingBreaches(world, worker.id, b.id), 'firing inside the term is a breach');
});

test('an employment term the employer cut is the employer’s breach, not the worker’s', () => {
  const world = makeWorld();
  const owner = makeCitizen(world, { name: 'Owner', wallet: 300 });
  const worker = makeCitizen(world, { name: 'Worker', wallet: 100 });
  const b = business(world, owner.id);
  const id = offerContract(world, owner.id, {
    to: worker.id, kind: 'employment', terms: 'the counter', consideration: 12, days: 6, penalty: 50, business: b.id,
  }).id!;
  acceptContract(world, worker.id, id);
  world.day = 2;                     // the worker holds no post with that till
  dailyContracts(world);
  const k = contractById(world, id)!;
  assert.equal(k.status, 'breached');
  assert.equal(k.breachedById, owner.id);
  assert.equal(owner.standing, 'good');
  assert.equal(owner.finesOwed, 0);
});

test('an apprenticeship is the one lawful wage under the floor, and it is filed so the city can count it', () => {
  const world = makeWorld();
  const master = makeCitizen(world, { name: 'Master', wallet: 500 });
  const apprentice = makeCitizen(world, { name: 'Apprentice', wallet: 100 });
  const low = wageFloor(world, 'apprenticeship');
  assert.equal(low, Math.round(world.government.minWage * 0.6));
  assert.ok(low < world.government.minWage);
  const id = offerContract(world, master.id, {
    to: apprentice.id, kind: 'apprenticeship', terms: 'the bench, four weeks', consideration: low, days: 28, penalty: 0,
  }).id!;
  assert.equal(acceptContract(world, apprentice.id, id).ok, true);
  assert.equal(apprenticeshipFor(world, apprentice.id)?.id, id);
  assert.equal(APPRENTICE_SKILL_MULTIPLIER, 2);
  world.day = 1;
  const before = totalMoney(world);
  assert.equal(performContract(world, master.id, id).ok, true, 'the master pays the training wage');
  assert.equal(totalMoney(world), before, 'the wage is taxed at the source like any other');
  assert.ok(apprentice.stats.totalEarned > 0);
});

test('a partnership files a split, and the split is what the payout follows', () => {
  const world = makeWorld();
  const owner = makeCitizen(world, { name: 'Owner', wallet: 500 });
  const partner = makeCitizen(world, { name: 'Partner', wallet: 500 });
  const b = business(world, owner.id);
  const shares = { [owner.id]: 0.6, [partner.id]: 0.4 };
  assert.equal(offerContract(world, owner.id, {
    to: partner.id, kind: 'partnership', terms: 'half the concern', consideration: 200, days: 60, penalty: 0,
    business: b.id, shares: { [owner.id]: 0.7, [partner.id]: 0.4 },
  }).ok, false, 'a split must sum to one');
  const id = offerContract(world, owner.id, {
    to: partner.id, kind: 'partnership', terms: 'two fifths of the concern', consideration: 200, days: 60, penalty: 0,
    business: b.id, shares,
  }).id!;
  const before = totalMoney(world);
  assert.equal(acceptContract(world, partner.id, id).ok, true);
  assert.equal(b.treasury, 1_200, 'the capital went in');
  assert.equal(totalMoney(world), before);
  assert.deepEqual(partnershipSharesOf(world, b.id), shares);
  assert.equal(obligorOf(contractById(world, id)!), null, 'the filed shares do the work, not a daily act');
});

test('the face value of an instrument is its consideration times the periods it runs', () => {
  assert.equal(faceValue(8, 'lease', 28), 224);
  assert.equal(faceValue(90, 'forward', 3), 90);
  assert.equal(faceValue(5_000, 'partnership', 60), 5_000);
  assert.equal(faceValue(12, 'employment', 6), 72);
});

test('a citizen’s civil life is public, and a breach shows in it without costing repute', () => {
  const world = makeWorld();
  const landlord = makeCitizen(world, { name: 'Landlord', wallet: 400 });
  const tenant = makeCitizen(world, { name: 'Tenant', wallet: 200 });
  const id = offerContract(world, landlord.id, {
    to: tenant.id, kind: 'lease', terms: 'a room', consideration: 6, days: 5, penalty: 10,
  }).id!;
  acceptContract(world, tenant.id, id);
  const seen = civilObservation(world, tenant.id);
  assert.equal(seen.contracts.length, 1);
  assert.equal(seen.contracts[0].with, 'Landlord');
  assert.equal(seen.contracts[0].outstanding, 30);
  assert.equal(seen.record.breached, 0);
  assert.equal(seen.judgmentDebt, 0);
  assert.deepEqual(contractCharacter(world, tenant.id), { diligence: 0, dishonesty: 0 });

  const reputation = tenant.reputation;
  world.day = 2;
  dailyContracts(world);
  const after = civilObservation(world, tenant.id);
  assert.equal(after.record.breached, 1);
  assert.equal(after.contracts[0].breachedBy, 'Tenant');
  assert.equal(tenant.reputation, reputation);
  assert.deepEqual(contractCharacter(world, tenant.id), { diligence: 0, dishonesty: 0 },
    'only an adjudicated breach reaches the honesty reading, and never repute');
});
