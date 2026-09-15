/**
 * The underworld: the schedule, the gate, the crossing and the black market
 * (`src/underworld/`, `docs/UNDERWORLD.md` §§1–4, 7).
 *
 * Every number asserted here is one a citizen could have counted: what the
 * schedule says, what the duty comes to, who was standing on the gate, how many
 * crates, and what a shelf is asking. Nothing in this file asserts that anybody
 * is a smuggler; it asserts what happens when somebody tries.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Business, Citizen, Report, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { nextId } from '../src/util/ids.ts';
import { rand } from '../src/util/rng.ts';
import { isCivicLaw, isPersonLaw, trackOf } from '../src/data/laws.ts';
import { PRODUCTS } from '../src/data/catalogue.ts';
import { abuseTraceCount } from '../src/government/investigations.ts';
import { recordBribedOfficer } from '../src/government/reports.ts';
import { computeSentence, fileCharge } from '../src/government/court.ts';
import { lawfulExile } from '../src/government/sentencing.ts';
import {
  ASSESSMENT_FEE, BOUNTY_CAP, CONTRABAND_POSSESSION, COVER_BRIBE, COVER_PER_CRATE, COVER_WAGON, CRATES_FREE,
  ESPIONAGE, FALSE_MANIFEST, GATES, HOME_CITY, SMUGGLING, UNDERWORLD_OFFENCES, UNLICENSED_DEALING, WAGON_COST,
  amnestyRunning, assessDuty, blackPrice, blackPriceStory, concealment, contrabandOn, dailyUnderworld,
  dealingsInCycle, declareAmnesty, declareCargo, enactUnderworldQuestion, fence, fencePays, fitWagon, foundingSchedule,
  heatOf, holdsTradingLicence, inspect, isContraband, isMasterGrade, landedCost, lawfulPrice, liftRestriction,
  manifestsFor, notorietyOf, offersTo, passOpen, receiveFrom, receiveGoods, registerUnderworldSeverities, restrictGood,
  restrictionOn, restrictionsFor, rosterCustoms, scheduleLine, seize, smuggle, smugglingSeverity, spreadDealing,
  suspectShelves, suspicionOf, tableUnderworldQuestion, underworldObservation, underworldState, underworldSummary,
  waveThrough,
} from '../src/underworld/index.ts';

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

/** The next number the world's stream will produce, without consuming it. */
function peek(world: World): number {
  const saved = world.rng.s;
  const v = rand(world);
  world.rng.s = saved;
  return v;
}

/** Wind the stream on until the next draw satisfies `want`. Deterministic. */
function primeRng(world: World, want: (v: number) => boolean): void {
  for (let i = 0; i < 20_000; i++) {
    if (want(peek(world))) return;
    rand(world);
  }
  throw new Error('could not prime the stream');
}

const HIGH = (v: number): boolean => v > 0.96;
const LOW = (v: number): boolean => v < 0.01;

/** Codes `types.ts` does not carry yet are compared as the plain strings the record holds. */
function has(c: Citizen, code: string): boolean {
  return c.recentOffences.some((o) => (o.law as string) === code);
}

/** The Watch's reports under one of this layer's codes, newest last. */
function reportsUnder(world: World, code: string): Report[] {
  return Object.values(world.reports).filter((r) => (r.law as string) === code);
}

/** An officer of the Watch, on duty. */
function makeOfficer(world: World, name: string, analysis = 40): Citizen {
  const officer = makeCitizen(world, { name, district: 'threshold', skills: { crafting: 20, analysis, rhetoric: 20, care: 20, commerce: 20, artistry: 20 } });
  world.government.watch.push(officer.id);
  return officer;
}

/** Put officers on the gates for today. */
function staffGates(world: World, ...officers: Citizen[]): void {
  const s = underworldState(world);
  s.rosterDay = -1;
  rosterCustoms(world);
  assert.ok(officers.every((o) => s.roster[GATES[0].building].includes(o.id) || s.roster[GATES[1].building].includes(o.id)));
}

function makeShop(world: World, owner: Citizen, productId: string, price: number, qty = 3): Business {
  const id = nextId(world, 'b');
  const biz: Business = {
    id, name: `${owner.name}'s shop`, kind: 'shop', ownerId: owner.id, treasury: 500,
    district: 'harbor_market', buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: world.day, rentPerDay: 5, daysNegative: 0, revenueToday: 0, costsToday: 0,
    dissolvedDay: null, shelf: { [productId]: { qty, price } },
  };
  world.businesses[id] = biz;
  owner.businessId = id;
  return biz;
}

/** Supply moved only by what was minted and burned. */
function auditDelta(world: World, before: { money: number; minted: number; burned: number }): void {
  const minted = world.treasury.minted - before.minted;
  const burned = world.treasury.burned - before.burned;
  assert.equal(totalMoney(world) - before.money, minted - burned);
}

function snapshot(world: World): { money: number; minted: number; burned: number } {
  return { money: totalMoney(world), minted: world.treasury.minted, burned: world.treasury.burned };
}

// ---------------------------------------------------------------------------
// §1 The schedule of restricted goods
// ---------------------------------------------------------------------------

test('the founding schedules are the six cities of UNDERWORLD.md §1', () => {
  const w = makeWorld();
  const cinderhold = restrictionsFor(w, 'cinderhold');
  const patterns = cinderhold.find((r) => r.id === 'guild_patterns');
  assert.ok(patterns, 'Cinderhold restricts guild patterns');
  assert.equal(patterns.severity, 3, 'a pattern is the guild\'s living');

  // Marrowgate registers rather than restricts, and still reads manifests.
  const marrowgate = restrictionsFor(w, 'marrowgate');
  assert.equal(marrowgate.length, 1);
  assert.ok(marrowgate[0].undeclaredOnly);
  // The Verge does neither.
  assert.equal(foundingSchedule('the_verge').length, 0);
  assert.match(scheduleLine(w, 'the_verge'), /restricts nothing/);
});

test('a certificate of origin is what makes salvage lawful, and a seal a tool', () => {
  const w = makeWorld();
  const uncertified = { good: 'goods' as const, productId: null, qty: 4, value: 48 };
  assert.ok(restrictionOn(w, HOME_CITY, uncertified, { direction: 'inbound', declared: true }));
  assert.equal(restrictionOn(w, HOME_CITY, { ...uncertified, certified: true }, { direction: 'inbound', declared: true }), null);

  // Cinderhold lets a master-grade tool out under a guild seal and not otherwise.
  const lens = { good: null, productId: 'star_lens', qty: 1, value: 130 };
  assert.ok(isMasterGrade('star_lens'));
  assert.ok(!isMasterGrade('tide_cards'));
  assert.ok(restrictionOn(w, 'cinderhold', lens, { direction: 'outbound', declared: true }));
  assert.equal(restrictionOn(w, 'cinderhold', { ...lens, sealed: true }, { direction: 'outbound', declared: true })?.id, 'foundry_tools');
  const cards = { good: null, productId: 'tide_cards', qty: 1, value: 15 };
  assert.equal(restrictionOn(w, 'cinderhold', cards, { direction: 'outbound', declared: true }), null);
});

test('the untaxed-goods line bites on an undeclared load and never on a lawful crate', () => {
  const w = makeWorld();
  const crate = { good: 'compute' as const, productId: null, qty: 40, value: 240 };
  assert.equal(restrictionOn(w, 'marrowgate', crate, { direction: 'inbound', declared: true }), null,
    'bulk trade is lawful: the pocket trade is the crime');
  assert.equal(restrictionOn(w, 'marrowgate', crate, { direction: 'inbound', declared: false })?.id, 'untaxed_goods');
});

test("a money line reads a lot of lumens, a direction and a floor", () => {
  const w = makeWorld();
  const money = (value: number): { good: null; productId: null; qty: number; value: number } =>
    ({ good: null, productId: null, qty: 1, value });
  assert.equal(restrictionOn(w, 'solene', money(400), { direction: 'outbound', declared: true }), null);
  assert.equal(restrictionOn(w, 'solene', money(900), { direction: 'outbound', declared: true })?.id, 'capital_out');
  assert.equal(restrictionOn(w, 'solene', money(900), { direction: 'inbound', declared: true }), null);
});

test('a council amends its own schedule, and what it lifts stops biting', () => {
  const w = makeWorld();
  const line = { good: 'culture' as const, productId: null, qty: 2, value: 16 };
  assert.ok(!isContraband(w, HOME_CITY, line));
  restrictGood(w, HOME_CITY, { id: 'imported_culture', subject: 'culture arriving for resale', severity: 2, goods: ['culture'] });
  assert.ok(isContraband(w, HOME_CITY, line), 'the schedule is where the city says no');
  assert.ok(w.events.some((e) => e.text.includes('schedule of restricted goods')));
  liftRestriction(w, HOME_CITY, 'imported_culture');
  assert.ok(!isContraband(w, HOME_CITY, line), 'what was contraband on Tuesday is a crate on Wednesday');
});

test('a question is filed beside the roll of votes and enacted once', () => {
  const w = makeWorld();
  tableUnderworldQuestion(w, {
    proposalId: 'p_9', kind: 'restrict_good', city: HOME_CITY, liftId: null, value: 0, targetId: null,
    restriction: {
      id: 'energy_out', city: HOME_CITY, subject: 'energy leaving the city', direction: 'outbound', severity: 2,
      goods: ['energy'], products: [], categories: [], licensed: false, needsCertificate: false,
      masterGradeOnly: false, money: false, minValue: 0, undeclaredOnly: false, sinceDay: 0, proposalId: 'p_9',
      liftedDay: null,
    },
  });
  assert.equal(enactUnderworldQuestion(w, 'p_9'), true);
  assert.equal(enactUnderworldQuestion(w, 'p_9'), false, 'a question is carried out once');
  assert.ok(restrictionsFor(w, HOME_CITY).some((r) => r.id === 'energy_out'));
});

// ---------------------------------------------------------------------------
// §4 The prices, which are the evidence
// ---------------------------------------------------------------------------

test('heat is read off what the seller has been doing, and the fence prices it', () => {
  const w = makeWorld();
  const cold = makeCitizen(w, { name: 'Cold' });
  const quiet = makeCitizen(w, { name: 'Quiet' });
  const caught = makeCitizen(w, { name: 'Caught' });
  quiet.recentOffences.push({ tick: w.tick, law: 'L04', detected: false, victimId: null, amount: 40 });
  caught.recentOffences.push({ tick: w.tick, law: 'L08', detected: true, victimId: null, amount: 80 });

  assert.equal(heatOf(w, cold.id), 0.1);
  assert.equal(heatOf(w, cold.id, { namedItem: true }), 0.3);
  assert.equal(heatOf(w, quiet.id), 0.6);
  assert.equal(heatOf(w, caught.id), 1.0);

  const fenceId = makeCitizen(w, { name: 'Fence' }).id;
  const hot = fencePays(w, caught.id, fenceId, 100, heatOf(w, caught.id));
  const chilled = fencePays(w, cold.id, fenceId, 100, heatOf(w, cold.id));
  assert.ok(hot >= 28 && hot <= 33, `fresh detected loot fetches about 30 %, not ${hot}`);
  assert.ok(chilled >= 62 && chilled <= 68, `cold goods fetch about two-thirds, not ${chilled}`);
  assert.ok(chilled > hot, 'a thief who waits ends richer than one who runs');
});

test('the black price is the restriction, and it is capped at four times the anchor', () => {
  const w = makeWorld();
  const anchor = w.market.goods.knowledge.price;
  assert.equal(blackPrice(w, 'knowledge'), anchor, 'nothing restricted, nothing to pay for');
  restrictGood(w, HOME_CITY, { id: 'knowledge_out', subject: 'knowledge in any form', severity: 3, goods: ['knowledge'] });
  const black = blackPrice(w, 'knowledge');
  assert.ok(black > anchor, 'restriction funds its opposition');
  assert.ok(black <= anchor * 4);

  underworldState(w).bare.knowledge = 200;
  assert.equal(blackPrice(w, 'knowledge'), anchor * 4, 'however scarce, four times and no more');
  assert.ok(blackPriceStory(w)?.includes('restriction on knowledge'));
});

test('a shelf under what a lawful crate lands at is the evidence, and it is public', () => {
  const w = makeWorld();
  const landed = landedCost(w, 'star_lens');
  assert.ok(landed > PRODUCTS.star_lens.basePrice, 'a lawful crate carries duty, spread and carriage');
  assert.equal(suspicionOf(w, 'star_lens', landed), 0, 'a shop that paid what the crate cost has nothing to answer for');
  assert.ok(suspicionOf(w, 'star_lens', Math.round(landed * 0.5)) > 0.3);

  const owner = makeCitizen(w, { name: 'Shopkeep', district: 'harbor_market' });
  makeShop(w, owner, 'star_lens', Math.round(landed * 0.5));
  const shelves = suspectShelves(w);
  assert.equal(shelves.length, 1);
  assert.equal(shelves[0].productId, 'star_lens');
  assert.ok(shelves[0].suspicion > 0.3);
});

// ---------------------------------------------------------------------------
// §2–3 The gate: the manifest, the duty, the officer
// ---------------------------------------------------------------------------

test('a manifest pays the duty and the fee, and both go to the Treasury', () => {
  const w = makeWorld();
  w.outer.tariff = 0.10;
  const merchant = makeCitizen(w, { name: 'Merchant', district: 'threshold', wallet: 400 });
  merchant.inventory.goods = 5;
  const before = snapshot(w);

  const result = declareCargo(w, merchant.id, { good: 'goods', qty: 5, value: 100 });
  assert.ok(result.ok, result.message);
  const [m] = manifestsFor(w, merchant.id);
  assert.equal(m.duty, 10);
  assert.equal(m.fee, ASSESSMENT_FEE);
  assert.equal(m.dutyPaid, 10);
  assert.equal(merchant.wallet, 400 - 25);
  auditDelta(w, before);
  assert.equal(m.false, false, 'a true manifest is not a false one');
});

test('understating the load is a false manifest, and an inspection proves it', () => {
  const w = makeWorld();
  const officer = makeOfficer(w, 'Gatekeeper');
  const merchant = makeCitizen(w, { name: 'Understater', district: 'threshold', wallet: 300 });
  merchant.inventory.goods = 10;
  staffGates(w, officer);

  declareCargo(w, merchant.id, { good: 'goods', qty: 2, value: 24 });
  const [m] = manifestsFor(w, merchant.id);
  assert.equal(m.actualQty, 10);
  assert.equal(m.declaredQty, 2);
  assert.ok(m.false, 'the paper is a separate act');

  const result = inspect(w, officer.id, merchant.id);
  assert.ok(result.ok, result.message);
  const report = reportsUnder(w, FALSE_MANIFEST)[0];
  assert.ok(report, 'the manifest and the crates are both in front of the officer');
  assert.ok(report.evidence >= 0.75, 'a public register proves itself');
  assert.equal(report.officerId, officer.id, 'the report is before the officer who read it');
  assert.equal(merchant.detainedUntilTick, null, 'a seizure is not an arrest');
});

test('an inspection seizes what the schedule does not admit, and pays a capped bounty', () => {
  const w = makeWorld();
  const officer = makeOfficer(w, 'Sharp');
  const traveller = makeCitizen(w, { name: 'Carrier', district: 'threshold', wallet: 60 });
  traveller.inventory.goods = 12;                       // uncertified salvage
  staffGates(w, officer);
  assert.equal(contrabandOn(w, traveller).length, 1);

  const stock = w.market.goods.goods.stock;
  const before = snapshot(w);
  const result = inspect(w, officer.id, traveller.id);
  assert.ok(result.ok, result.message);
  assert.equal(traveller.inventory.goods, 0, 'the load went to the Bazaar');
  assert.equal(w.market.goods.goods.stock, stock + 12);
  auditDelta(w, before);
  assert.ok(officer.wallet > 200, 'the bounty is 5 % of what was seized');
  assert.ok(officer.wallet - 200 <= BOUNTY_CAP, 'and never more than a day at the gate');
  assert.ok(has(traveller, CONTRABAND_POSSESSION));
  assert.equal(traveller.detainedUntilTick, null, 'the goods are seized; the person is not detained');
});

test('an officer who waved a traveller through leaves a trace when the load turns up', () => {
  const w = makeWorld();
  const officer = makeOfficer(w, 'Waver');
  const traveller = makeCitizen(w, { name: 'Waved', district: 'threshold' });
  traveller.inventory.goods = 6;
  staffGates(w, officer);

  assert.ok(waveThrough(w, officer.id, traveller.id).ok);
  assert.equal(abuseTraceCount(w, officer.id), 0, 'waving somebody through is lawful');
  assert.ok(seize(w, officer.id, traveller.id, 'goods', null, 6).ok);
  assert.equal(abuseTraceCount(w, officer.id), 1, 'two public facts that fit together one way');
});

test('assess_duty collects what the gate could not', () => {
  const w = makeWorld();
  w.outer.tariff = 0.25;
  const officer = makeOfficer(w, 'Assessor');
  const merchant = makeCitizen(w, { name: 'Broke', district: 'threshold', wallet: ASSESSMENT_FEE });
  merchant.inventory.compute = 2;
  staffGates(w, officer);

  declareCargo(w, merchant.id, { good: 'compute', qty: 2, value: 200 });
  const [m] = manifestsFor(w, merchant.id);
  assert.equal(m.duty, 50);
  assert.equal(m.dutyPaid, 0, 'a load that has not paid is not released');

  merchant.wallet += 30;
  const before = snapshot(w);
  assert.ok(assessDuty(w, officer.id, merchant.id).ok);
  assert.equal(manifestsFor(w, merchant.id)[0].dutyPaid, 30);
  assert.equal(manifestsFor(w, merchant.id)[0].assessedById, officer.id);
  auditDelta(w, before);
});

test('the hollow costs 120 ℓ at the Builders\' Yard and is bought once', () => {
  const w = makeWorld();
  const smuggler = makeCitizen(w, { name: 'Wagoner', district: 'foundry_row', wallet: 200 });
  assert.ok(!fitWagon(w, makeCitizen(w, { name: 'Elsewhere', district: 'commons' }).id).ok);
  const before = snapshot(w);
  assert.ok(fitWagon(w, smuggler.id).ok);
  assert.equal(smuggler.wallet, 200 - WAGON_COST);
  auditDelta(w, before);
  assert.ok(!fitWagon(w, smuggler.id).ok, 'a wagon has one hollow');
});

// ---------------------------------------------------------------------------
// §2 The roll
// ---------------------------------------------------------------------------

test('the terms of the roll are public, and the bribe is the largest of them', () => {
  const w = makeWorld();
  const officer = makeOfficer(w, 'OnDuty', 80);
  const smuggler = makeCitizen(w, { name: 'Runner', district: 'threshold' });
  staffGates(w, officer);
  const spec = { good: 'compute' as const, qty: 1, route: 'road' as const };

  const plain = concealment(w, smuggler, spec);
  assert.ok(plain.scrutiny > 0.2, 'a gate is always watched, and this one has an officer on it');
  assert.equal(plain.officers, 1);
  assert.equal(plain.bestAnalysis, 80);

  underworldState(w).wagons.push(smuggler.id);
  const withWagon = concealment(w, smuggler, spec);
  assert.ok(Math.abs(withWagon.cover - plain.cover - COVER_WAGON) < 1e-9);

  recordBribedOfficer(w, officer.id, smuggler.id);
  const bribed = concealment(w, smuggler, spec);
  assert.ok(Math.abs(bribed.cover - withWagon.cover - COVER_BRIBE) < 1e-9);
  assert.ok(COVER_BRIBE > COVER_WAGON, 'the bribe removes the person doing the looking');
});

test('twelve crates is −0.40, and nothing hides a caravan', () => {
  const w = makeWorld();
  const smuggler = makeCitizen(w, { name: 'Bulk', district: 'threshold' });
  const four = concealment(w, smuggler, { good: 'goods', qty: CRATES_FREE, route: 'road' });
  const twelve = concealment(w, smuggler, { good: 'goods', qty: 12, route: 'road' });
  assert.ok(Math.abs((four.cover - twelve.cover) - 8 * COVER_PER_CRATE) < 1e-9);
  assert.ok(twelve.caught > four.caught, 'bulk trade is lawful; the pocket trade is the crime');
});

test('the pass shuts in the Frost', () => {
  const w = makeWorld();
  const smuggler = makeCitizen(w, { name: 'Climber', district: 'heights', wallet: 500 });
  w.season = 'frost';
  assert.ok(!passOpen(w));
  const refused = smuggle(w, smuggler.id, { good: 'compute', qty: 2, route: 'pass' });
  assert.ok(!refused.ok);
  assert.match(refused.message, /Frost/);
  w.season = 'bloom';
  assert.ok(passOpen(w));
});

test('a crossing that is caught is a seizure and a report, and never an arrest', () => {
  const w = makeWorld();
  const officer = makeOfficer(w, 'Eyes', 90);
  const smuggler = makeCitizen(w, { name: 'Caught', district: 'threshold', wallet: 900 });
  staffGates(w, officer);
  const before = snapshot(w);
  const stock = w.market.goods.goods.stock;

  primeRng(w, LOW);   // the roll comes in under p(caught)
  const result = smuggle(w, smuggler.id, { good: 'goods', qty: 12, route: 'road', direction: 'inbound' });
  assert.ok(result.ok, result.message);
  assert.match(result.message, /seized/);
  assert.equal(smuggler.inventory.goods, 0, 'the load went to the Bazaar');
  assert.equal(w.market.goods.goods.stock, stock + 12);
  assert.equal(smuggler.detainedUntilTick, null, 'caught is a seizure, not an arrest');
  const report = reportsUnder(w, SMUGGLING)[0];
  assert.ok(report, 'a report opens before the officer who found it');
  assert.equal(report.officerId, officer.id);
  assert.equal(report.status, 'open', 'and that officer decides whether to file it');
  auditDelta(w, before);
});

test('a crossing nobody saw leaves an undetected offence, which is a trace', () => {
  const w = makeWorld();
  const smuggler = makeCitizen(w, { name: 'Quiet', district: 'threshold', wallet: 900 });
  const before = snapshot(w);

  primeRng(w, HIGH);  // the roll comes in over p(caught)
  const result = smuggle(w, smuggler.id, { good: 'compute', qty: 2, route: 'road', direction: 'inbound' });
  assert.ok(result.ok, result.message);
  assert.equal(smuggler.inventory.compute, 2, 'the load is in the city');
  const offence = smuggler.recentOffences.at(-1);
  assert.equal(offence?.law, SMUGGLING);
  assert.equal(offence?.detected, false, 'nobody has read it yet');
  assert.equal(Object.keys(w.reports).length, 0);
  auditDelta(w, before);
  assert.equal(underworldSummary(w).crossings, 1);
});

test('a smuggled load out of the city is paid for from outside it', () => {
  const w = makeWorld();
  const smuggler = makeCitizen(w, { name: 'Exporter', district: 'harbor_market', wallet: 100 });
  smuggler.inventory.culture = 6;
  const before = snapshot(w);
  primeRng(w, HIGH);
  const result = smuggle(w, smuggler.id, { good: 'culture', qty: 6, route: 'sea', direction: 'outbound', city: 'vantage' });
  assert.ok(result.ok, result.message);
  assert.equal(smuggler.inventory.culture, 0);
  assert.ok(smuggler.wallet > 100);
  auditDelta(w, before);
});

// ---------------------------------------------------------------------------
// §4 Fencing
// ---------------------------------------------------------------------------

test('a fence offers and a buyer takes: two acts, two decisions, one ledger row', () => {
  const w = makeWorld();
  const thief = makeCitizen(w, { name: 'Seller', district: 'undercroft' });
  const buyer = makeCitizen(w, { name: 'Buyer', district: 'undercroft', wallet: 400 });
  thief.inventory.goods = 5;

  const offer = fence(w, thief.id, { to: buyer.id, good: 'goods', qty: 5 });
  assert.ok(offer.ok, offer.message);
  const [deal] = offersTo(w, buyer.id);
  assert.ok(deal, 'the offer stands before the buyer, and only the buyer may take it');
  assert.equal(thief.inventory.goods, 5, 'nothing moves on an offer alone');

  const before = snapshot(w);
  const taken = receiveGoods(w, buyer.id, deal.id);
  assert.ok(taken.ok, taken.message);
  assert.equal(buyer.inventory.goods, 5);
  assert.equal(thief.inventory.goods, 0);
  assert.equal(thief.wallet, 200 + deal.price);
  auditDelta(w, before);
  const row = w.treasury.ledger.at(-1);
  assert.equal(row?.kind, 'fence', 'the lumens sit in a ledger a detective can read');
});

test('a second lot inside a cycle is a business, and a business needs a licence', () => {
  const w = makeWorld();
  const seller = makeCitizen(w, { name: 'Supplier', district: 'undercroft' });
  const buyer = makeCitizen(w, { name: 'Handler', district: 'undercroft', wallet: 900 });
  seller.inventory.energy = 20;
  assert.ok(!holdsTradingLicence(w, buyer.id));

  for (let i = 0; i < 2; i++) {
    const offered = fence(w, seller.id, { to: buyer.id, good: 'energy', qty: 5 });
    assert.ok(offered.ok, offered.message);
    const [deal] = offersTo(w, buyer.id);
    assert.ok(receiveGoods(w, buyer.id, deal.id).ok);
  }
  assert.equal(dealingsInCycle(w, buyer.id), 2);
  assert.ok(has(buyer, UNLICENSED_DEALING),
    'trading as a business with no trading licence is L29');
});

test('the price paid is the buyer\'s defence, and the fence is the one who knew', () => {
  const w = makeWorld();
  restrictGood(w, HOME_CITY, { id: 'lenses', subject: 'star lenses', severity: 2, products: ['star_lens'] });
  const honest = makeCitizen(w, { name: 'Deceived', district: 'commons', wallet: 900 });
  const dealer = makeCitizen(w, { name: 'Dealer', district: 'commons' });
  dealer.possessions.push({ id: nextId(w, 'i'), productId: 'star_lens', acquiredDay: 0 });

  // Sold at what a lawful crate lands at: the buyer paid the honest price.
  const landed = landedCost(w, 'star_lens');
  const offer = fence(w, dealer.id, { to: honest.id, productId: 'star_lens', qty: 1 });
  assert.ok(offer.ok, offer.message);
  const [deal] = offersTo(w, honest.id);
  deal.price = landed;
  assert.ok(receiveGoods(w, honest.id, deal.id).ok);
  assert.ok(!has(honest, CONTRABAND_POSSESSION),
    'someone who paid the lawful landed cost was probably deceived');
  assert.ok(has(dealer, CONTRABAND_POSSESSION),
    'and the fence is the one who knew');
});

test('a fence\'s name travels along friendship edges and costs them the price', () => {
  const w = makeWorld();
  const seller = makeCitizen(w, { name: 'Runner2', district: 'undercroft' });
  const buyer = makeCitizen(w, { name: 'KnownHand', district: 'undercroft', wallet: 500 });
  const friend = makeCitizen(w, { name: 'Friend', district: 'undercroft' });
  buyer.bonds[friend.id] = 80;
  friend.bonds[buyer.id] = 80;
  seller.inventory.goods = 4;

  const paidBefore = fencePays(w, seller.id, buyer.id, 100, 0.1);
  const offer = fence(w, seller.id, { to: buyer.id, good: 'goods', qty: 4 });
  assert.ok(offer.ok);
  const [deal] = offersTo(w, buyer.id);
  primeRng(w, LOW);      // the friend hears
  assert.ok(receiveGoods(w, buyer.id, deal.id).ok);
  assert.ok(notorietyOf(w, buyer.id) >= 1, 'dealings spread as word of mouth, never as repute');
  assert.equal(buyer.reputation, 50, 'an undetected purchase is not a public act');
  assert.ok(fencePays(w, seller.id, buyer.id, 100, 0.1) < paidBefore, 'a well-known fence pays less, because they can');

  const heard = friend.memory.some((m) => m.text.includes('takes lots nobody asks about'));
  assert.ok(heard || notorietyOf(w, buyer.id) >= 1);
  assert.ok(spreadDealing(w, deal) >= 0);
});

// ---------------------------------------------------------------------------
// §7 Every one of them is Track I
// ---------------------------------------------------------------------------

test('every code this layer adds is civic, and not one of them is a person code', () => {
  const w = makeWorld();
  registerUnderworldSeverities(w);
  for (const code of Object.keys(UNDERWORLD_OFFENCES)) {
    assert.ok(isCivicLaw(code), `${code} is an offence against the city`);
    assert.ok(!isPersonLaw(code), `${code} is not an offence against a person`);
    assert.equal(trackOf(code), 'city');
    assert.equal(w.government.lawSeverity[code as 'L41'], UNDERWORLD_OFFENCES[code].severity);
  }
});

test('espionage is severity 5 and is still a fine and a suspension on a first conviction', () => {
  const w = makeWorld();
  registerUnderworldSeverities(w);
  const spy = makeCitizen(w, { name: 'Agent', wallet: 300 });
  const kase = fileCharge(w, {
    defendantId: spy.id, law: ESPIONAGE as 'L41', evidence: 0.8, filedBy: 'watch',
    description: 'took the Council\'s papers under a foreign retainer',
  });
  assert.equal(kase.severity, 5);
  assert.equal(lawfulExile(w, kase), false, 'severity 5 alone is never exile');
  const sentence = computeSentence(w, kase);
  assert.equal(sentence.track, 'city');
  assert.equal(sentence.jailDays, 0, 'espionage never carries custody');
  assert.equal(sentence.exile, false);
  assert.equal(sentence.tier, 4, 'the fine and a suspension');
  assert.ok(sentence.suspensionDays > 0);
});

test('smuggling answers on the ladder, and the schedule aggravates it', () => {
  const w = makeWorld();
  registerUnderworldSeverities(w);
  const runner = makeCitizen(w, { name: 'Runner3', wallet: 200 });
  const kase = fileCharge(w, {
    defendantId: runner.id, law: SMUGGLING as 'L41', evidence: 0.7, filedBy: 'watch',
    description: 'ran a load past the gate',
  });
  const sentence = computeSentence(w, kase);
  assert.equal(sentence.track, 'city');
  assert.equal(sentence.jailDays, 0);
  assert.equal(sentence.exile, false);
  assert.equal(sentence.tier, 3, 'severity 3, no priors: the fine and community service');
  assert.equal(smugglingSeverity(w, 2), 3);
  assert.equal(smugglingSeverity(w, 3), 4, 'four where the restriction severity is three');
});

// ---------------------------------------------------------------------------
// The amnesty, the rollover and what a citizen sees
// ---------------------------------------------------------------------------

test('an amnesty holds a door open for the citizen who bought off a shelf', () => {
  const w = makeWorld();
  const officer = makeOfficer(w, 'Amnesty');
  const holder = makeCitizen(w, { name: 'Holder', district: 'threshold' });
  holder.inventory.goods = 4;
  staffGates(w, officer);
  declareAmnesty(w);
  assert.ok(amnestyRunning(w));

  assert.ok(inspect(w, officer.id, holder.id).ok);
  assert.equal(holder.inventory.goods, 0, 'the goods are still given up');
  assert.equal(reportsUnder(w, CONTRABAND_POSSESSION).length, 0,
    'and holding them is not charged while the door is open');
});

test('the rollover staffs the gates, counts the shelves and forgets what is cold', () => {
  const w = makeWorld();
  const officer = makeOfficer(w, 'Rota');
  const other = makeOfficer(w, 'Rota2');
  const s = underworldState(w);
  s.crossingsToday = 90;
  w.market.goods.knowledge.stock = 0;

  dailyUnderworld(w);
  assert.equal(s.crossingsYesterday, 90);
  assert.equal(s.crossingsToday, 0);
  assert.equal(s.bare.knowledge, 1);
  assert.ok(s.roster[GATES[0].building].length + s.roster[GATES[1].building].length >= 1);
  assert.ok([officer.id, other.id].includes(s.roster[GATES[0].building][0]));

  w.day += 1;
  dailyUnderworld(w);
  assert.equal(s.bare.knowledge, 2, 'a week of empty shelves is what the black price is made of');
});

test('a citizen sees the schedule, the gate and the offers made to them', () => {
  const w = makeWorld();
  const officer = makeOfficer(w, 'Post');
  const merchant = makeCitizen(w, { name: 'Watcher', district: 'threshold', wallet: 300 });
  staffGates(w, officer);
  const obs = underworldObservation(w, merchant.id);
  assert.match(obs.schedule, /Reverie/);
  assert.match(obs.gates, /customs posts standing/);
  assert.equal(obs.atGate?.name, 'the Threshold');
  assert.deepEqual(obs.atGate?.officers, ['Post']);
  assert.equal(obs.offers.length, 0);
  assert.equal(obs.gateBanned, false);
  assert.equal(obs.wagon, false);
});

test('what a load is worth on the open shelf is what the Bazaar asks for it', () => {
  const w = makeWorld();
  assert.equal(lawfulPrice(w, { good: 'compute', productId: null, qty: 3, value: 0 }), w.market.goods.compute.price * 3);
  assert.equal(lawfulPrice(w, { good: null, productId: null, qty: 1, value: 250 }), 250);
});

test('a gate ban is a name on a register, and it shuts the road in', () => {
  const w = makeWorld();
  const agent = makeCitizen(w, { name: 'Banned', district: 'threshold', wallet: 500 });
  underworldState(w).gateBans.push({ citizenId: agent.id, fromDay: w.day, untilDay: w.day + 28, reason: 'put out' });
  const declared = declareCargo(w, agent.id, { good: 'compute', qty: 1, value: 6 });
  assert.ok(!declared.ok);
  assert.match(declared.message, /register every gate reads/);
  const ran = smuggle(w, agent.id, { good: 'compute', qty: 1, route: 'road', direction: 'inbound' });
  assert.ok(!ran.ok);
  assert.equal(agent.standing, 'good', 'a ban is not an exile and not a conviction');
});

test('a lot of lumens is declared by its value, not by a count of crates', () => {
  const w = makeWorld();
  const traveller = makeCitizen(w, { name: 'Purse', district: 'threshold', wallet: 400 });
  const honest = declareCargo(w, traveller.id, { qty: 0, value: 400, to: 'solene' });
  assert.ok(honest.ok, honest.message);
  assert.equal(manifestsFor(w, traveller.id)[0].false, false, 'a purse declared in full is a true manifest');

  const under = declareCargo(w, traveller.id, { qty: 0, value: 10, to: 'solene' });
  assert.ok(under.ok, under.message);
  assert.equal(manifestsFor(w, traveller.id)[1].false, true, 'and one that understates it is not');
});

test('the Verge reads nothing, so there is no manifest to file at it', () => {
  const w = makeWorld();
  const traveller = makeCitizen(w, { name: 'Vergebound', district: 'threshold', wallet: 200 });
  traveller.inventory.goods = 2;
  const result = declareCargo(w, traveller.id, { good: 'goods', qty: 2, value: 24, to: 'the_verge' });
  assert.ok(!result.ok);
  assert.match(result.message, /reads nothing/);
});

test('a hundred mornings leave a bounded register and no hour that throws', () => {
  const w = makeWorld();
  const officer = makeOfficer(w, 'Longwatch');
  const runner = makeCitizen(w, { name: 'Persistent', district: 'threshold', wallet: 5000 });
  staffGates(w, officer);
  const before = snapshot(w);

  for (let day = 0; day < 100; day++) {
    w.day += 1;
    w.tick = w.day * 24 + 9;
    smuggle(w, runner.id, { good: 'compute', qty: 1, route: 'road', direction: 'inbound' });
    dailyUnderworld(w);
  }

  const s = underworldState(w);
  assert.ok(s.crossings.length <= 200, 'the book of crossings is bounded');
  assert.ok(s.manifests.length <= 200);
  assert.ok(s.traces.length <= 40, 'a trail goes cold');
  assert.ok(runner.recentOffences.length <= 20, 'and a record keeps what the Watch keeps');
  auditDelta(w, before);
});

test('an offer can be taken by what is in it, the way the registry names it', () => {
  const w = makeWorld();
  const seller = makeCitizen(w, { name: 'Hand', district: 'undercroft' });
  const buyer = makeCitizen(w, { name: 'Taker', district: 'undercroft', wallet: 300 });
  seller.inventory.culture = 3;
  assert.ok(fence(w, seller.id, { to: buyer.id, good: 'culture', qty: 3 }).ok);

  assert.ok(!receiveFrom(w, buyer.id, { from: seller.id, good: 'compute', qty: 3 }).ok, 'no such lot');
  const taken = receiveFrom(w, buyer.id, { from: seller.id, good: 'culture', qty: 3 });
  assert.ok(taken.ok, taken.message);
  assert.equal(buyer.inventory.culture, 3);
});

test('the register survives a save and a load, and an old save opens without it', () => {
  const w = makeWorld();
  const runner = makeCitizen(w, { name: 'Saved', district: 'threshold', wallet: 300 });
  runner.inventory.goods = 3;
  declareCargo(w, runner.id, { good: 'goods', qty: 3, value: 36 });
  restrictGood(w, HOME_CITY, { id: 'saved_line', subject: 'a line the council wrote', severity: 2, goods: ['culture'] });

  const clone = JSON.parse(JSON.stringify(w)) as World;
  const s = underworldState(clone);
  assert.equal(s.manifests.length, 1);
  assert.ok(restrictionsFor(clone, HOME_CITY).some((r) => r.id === 'saved_line'));
  assert.equal(underworldState(clone).seq.mf, 1, 'the ids carry on where they left off');

  // A world saved before this layer existed has no register at all, and opens.
  const old = makeWorld();
  delete (old as World & { underworld?: unknown }).underworld;
  assert.equal(underworldState(old).manifests.length, 0);
  assert.ok(restrictionsFor(old, HOME_CITY).length > 0, 'and the founding schedule is there to read');
});

test('a load stopped on its way out never goes, and nobody abroad pays for it', () => {
  const w = makeWorld();
  const officer = makeOfficer(w, 'Outbound', 90);
  const smuggler = makeCitizen(w, { name: 'Leaver', district: 'threshold', wallet: 100 });
  smuggler.inventory.culture = 10;
  staffGates(w, officer);
  const stock = w.market.goods.culture.stock;
  const before = snapshot(w);

  primeRng(w, LOW);
  const result = smuggle(w, smuggler.id, { good: 'culture', qty: 10, route: 'road', direction: 'outbound', city: 'vantage' });
  assert.ok(result.ok, result.message);
  assert.match(result.message, /seized/);
  assert.equal(smuggler.inventory.culture, 0);
  assert.equal(w.market.goods.culture.stock, stock + 10, 'the load is on the Bazaar\'s shelf, not on a ship');
  assert.equal(w.treasury.minted - before.minted, 0, 'nobody abroad paid for a load that never left');
  auditDelta(w, before);
});

test('three strikes is not the Gate: the schedule cannot shortcut Article VI', () => {
  const w = makeWorld();
  registerUnderworldSeverities(w);
  const runner = makeCitizen(w, { name: 'Repeat', wallet: 400 });
  // Two convictions of severity 3 already on the record, both from earlier days.
  runner.record.convictions.push(
    { caseId: 'k_90', law: 'L06', severity: 3, tier: 3, day: 0 },
    { caseId: 'k_91', law: 'L06', severity: 3, tier: 4, day: 1 },
  );
  runner.record.strikes = 2;
  w.day = 5;
  w.tick = w.day * 24;

  const third = fileCharge(w, {
    defendantId: runner.id, law: SMUGGLING as 'L41', evidence: 0.8, filedBy: 'watch',
    description: 'a third crossing',
  });
  assert.equal(lawfulExile(w, third), false, 'the third conviction is a suspension, not the Gate');
  assert.equal(computeSentence(w, third).exile, false);

  // ...and the fourth is the Charter's own door, which is not this layer's to open.
  runner.record.convictions.push({ caseId: 'k_92', law: 'L06', severity: 3, tier: 4, day: 2 });
  const fourth = fileCharge(w, {
    defendantId: runner.id, law: SMUGGLING as 'L41', evidence: 0.8, filedBy: 'watch',
    description: 'a fourth crossing',
  });
  assert.equal(lawfulExile(w, fourth), true, 'Charter Article VI, and only Article VI');
});
