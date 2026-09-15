import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import type { Citizen, Loan, PropertyUnit, World } from '../src/types.ts';
import { dailyRepute } from '../src/standing/repute.ts';
import { generationsSettings, generationsState } from '../src/generations/state.ts';
import { HOUSE_BASELINE, dailyHouseRepute, houseReputeOf, stainOf } from '../src/generations/repute.ts';
import { foundHouse, houseOfName, renounceName } from '../src/generations/houses.ts';
import { conveyToHouse, endowHouse, houseTreasury } from '../src/generations/entail.ts';
import {
  FAMILIARITY_WEIGHT, HOUSE_VOTE_REPUTATION, LETTER_DAYS_OFF, PLEDGED_INCOME_MULTIPLE,
  PLEDGE_RATE_RELIEF, callPledges,
  declaredFamiliarity, houseBeliefAdjustment, houseFamiliarity, letterAdmissible, letterDaysOff,
  letterOfHouse, lettersFor, matchedHouses, mustRecuseForHouse, noteSponsoredConvictions,
  houseVoteBonus, houseVoteScore, pledgeFor, pledgeHouse, pledgedIncomeMultiple, pledgedRateRelief,
  withdrawLetter,
} from '../src/generations/letters.ts';
import { acceptMatch, closeMatch, dailyMatches, matchById, offerMatch, openMatchesFor } from '../src/generations/matches.ts';
import { LEDGER_GAP, LEDGER_REPUTATION, houseLedger, printHouseLedger } from '../src/generations/ledger.ts';
import { familyTree, noteProminence, readRecords, rollOfHouses } from '../src/generations/records.ts';
import { houseObservation, houseOf } from '../src/generations/observe.ts';
import {
  dutyDisposition, dutyFacts, enactGenerationsProposal, generationsRates, generationsRegister,
} from '../src/generations/settings.ts';
import { cycleGenerations, dailyGenerations } from '../src/generations/daily.ts';

function houseOfThree(world: World, name: string): { house: NonNullable<ReturnType<typeof houseOfName>>; members: Citizen[] } {
  const members = Array.from({ length: 3 }, () => makeCitizen(world, { familyName: name, wallet: 1200 }));
  const result = foundHouse(world, members[0].id, name, 'eldest');
  assert.equal(result.ok, true, result.message);
  const house = houseOfName(world, name);
  assert.ok(house);
  return { house, members };
}

function unitFor(world: World, owner: Citizen, rent = 20): PropertyUnit {
  const id = `y_${Object.keys(world.property).length + 1}`;
  const u: PropertyUnit = {
    id, kind: 'home', tier: 1, buildingId: 'lantern_lofts', ownerId: owner.id, tenantId: null, rent,
  };
  world.property[id] = u;
  owner.ownedUnits.push(id);
  return u;
}

// ---------------------------------------------------------------------------
// The letter of the house
// ---------------------------------------------------------------------------

test('a letter takes a day off a background check and shifts no threshold', () => {
  const w = makeWorld();
  const { house, members } = houseOfThree(w, 'Ashgrove');
  const applicant = makeCitizen(w, { familyName: 'Vell' });
  assert.equal(letterDaysOff(w, applicant.id, 'solene'), 0);

  assert.equal(letterOfHouse(w, members[1].id, applicant.id, 'solene').ok, false, 'only the head files one');
  const filed = letterOfHouse(w, members[0].id, applicant.id, 'solene');
  assert.equal(filed.ok, true, filed.message);
  assert.equal(letterDaysOff(w, applicant.id, 'solene'), LETTER_DAYS_OFF);
  assert.equal(letterDaysOff(w, applicant.id, 'cinderhold'), 0, 'a letter is for the city it names');
  assert.equal(letterAdmissible(w, applicant.id)?.houseId, house.id);
  assert.equal(lettersFor(w, applicant.id).length, 1);
  assert.equal(letterOfHouse(w, members[0].id, applicant.id, 'solene').ok, false, 'and once each');

  const id = lettersFor(w, applicant.id)[0].id;
  assert.equal(withdrawLetter(w, members[1].id, id).ok, false);
  assert.equal(withdrawLetter(w, members[0].id, id).ok, true);
  assert.equal(letterDaysOff(w, applicant.id, 'solene'), 0);
});

test('a conviction of somebody the house sponsored lands on the house', () => {
  const w = makeWorld();
  const { members } = houseOfThree(w, 'Ashgrove');
  const applicant = makeCitizen(w, { familyName: 'Vell' });
  letterOfHouse(w, members[0].id, applicant.id, 'solene');
  applicant.record.convictions.push({ caseId: 'k_5', law: 'L07', severity: 3, tier: 3, day: w.day });

  assert.equal(noteSponsoredConvictions(w), 1);
  assert.ok(stainOf(w, 'Ashgrove') > 0, 'the willingness to sponsor is worth something because it costs something');
  assert.equal(noteSponsoredConvictions(w), 0, 'and it is counted once');
});

// ---------------------------------------------------------------------------
// The judge who knows the family
// ---------------------------------------------------------------------------

test('a judge born to the house, married into it or in feud with it must recuse', () => {
  const w = makeWorld();
  houseOfThree(w, 'Ashgrove');
  const defendant = makeCitizen(w, { familyName: 'Ashgrove' });
  const stranger = makeCitizen(w, { familyName: 'Kest' });
  assert.equal(houseFamiliarity(w, stranger.id, defendant.id), 0);
  assert.equal(mustRecuseForHouse(w, stranger.id, defendant.id), false);
  assert.equal(declaredFamiliarity(w, stranger.id, defendant.id), null, 'and the bench says nothing');

  const kin = makeCitizen(w, { familyName: 'Ashgrove' });
  assert.equal(houseFamiliarity(w, kin.id, defendant.id), 1);
  assert.equal(mustRecuseForHouse(w, kin.id, defendant.id), true);

  const married = makeCitizen(w, { familyName: 'Vell' });
  const partner = makeCitizen(w, { familyName: 'Ashgrove' });
  married.family.partnerId = partner.id;
  assert.equal(houseFamiliarity(w, married.id, defendant.id), 0.8);
  assert.equal(mustRecuseForHouse(w, married.id, defendant.id), true);

  w.feuds.push({ families: ['Kest', 'Ashgrove'], sinceDay: 0, incidents: 3, endedDay: null });
  assert.equal(houseFamiliarity(w, stranger.id, defendant.id), -0.7);
  assert.equal(mustRecuseForHouse(w, stranger.id, defendant.id), true, 'a feud is a tie like any other');
});

test('a familiarity below the line is declared with its reason, and moves belief by a tenth of it', () => {
  const w = makeWorld();
  houseOfThree(w, 'Ashgrove');
  const defendant = makeCitizen(w, { familyName: 'Ashgrove' });
  const judge = makeCitizen(w, { familyName: 'Vell' });
  const sibling = makeCitizen(w, { familyName: 'Ashgrove' });
  judge.family.children = [sibling.id];      // kin of the name, short of the line

  assert.equal(houseFamiliarity(w, judge.id, defendant.id), 0.6);
  assert.equal(mustRecuseForHouse(w, judge.id, defendant.id), true);
  assert.equal(houseBeliefAdjustment(w, judge.id, defendant.id), 0, 'a judge over the line should not be sitting');

  judge.family.children = [];
  const employer = makeCitizen(w, { familyName: 'Ashgrove' });
  w.businesses.b_shop = {
    id: 'b_shop', name: 'Ashgrove & Co', kind: 'shop', ownerId: employer.id, treasury: 100,
    district: 'harbor_market', buildingId: 'shopfronts_harbor', employees: [judge.id], jobs: ['j_1'],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 0, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  w.jobs.j_1 = {
    id: 'j_1', title: 'clerk', employer: 'b_shop', buildingId: 'shopfronts_harbor',
    district: 'harbor_market', wage: 10, skill: 'commerce', minSkill: 0, minReputation: 0,
    holderId: judge.id, role: 'clerk', output: {}, createdDay: 0,
  };
  judge.jobId = 'j_1';
  assert.equal(houseFamiliarity(w, judge.id, defendant.id), 0.5, 'a partnership in one of its concerns');

  // A tie under the line: declared in public, with the thumb it puts on the scale.
  const light = makeCitizen(w, { familyName: 'Kest' });
  w.feuds.push({ families: ['Kest', 'Ashgrove'], sinceDay: 0, incidents: 3, endedDay: null });
  const f = houseFamiliarity(w, light.id, defendant.id);
  assert.equal(f, -0.7);
  const halfHearted = makeCitizen(w, { familyName: 'Marrow' });
  const cousin = makeCitizen(w, { familyName: 'Ashgrove' });
  halfHearted.family.parents = [];
  assert.equal(houseFamiliarity(w, halfHearted.id, cousin.id), 0);
});

test('the thumb a declared familiarity puts on belief is a tenth of it, and it is public', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { familyName: 'Ashgrove' });
  const b = makeCitizen(w, { familyName: 'Vell' });
  const c = makeCitizen(w, { familyName: 'Ashgrove' });
  foundHouse(w, a.id, 'Ashgrove', 'eldest');   // refused: two adults, and that is the point
  const other = makeCitizen(w, { familyName: 'Ashgrove' });
  assert.ok(other);
  // A match between the two names is a tie under the recusal line.
  const { house: ash } = houseOfThree(w, 'Emberly');
  const { house: vell } = houseOfThree(w, 'Sable');
  generationsState(w).matches.mt_x = {
    id: 'mt_x', fromHouseId: ash.id, toHouseId: vell.id, offeredBy: 'x', dowry: 0, unitId: null,
    terms: '', day: 0, status: 'accepted', acceptedBy: null, decidedDay: 0,
  };
  const judge = makeCitizen(w, { familyName: 'Emberly' });
  const defendant = makeCitizen(w, { familyName: 'Sable' });
  assert.equal(matchedHouses(w, 'Emberly', 'Sable'), true);
  assert.equal(houseFamiliarity(w, judge.id, defendant.id), 0.5);
  assert.equal(b.familyName, 'Vell');
  assert.equal(c.familyName, 'Ashgrove');

  const cousin = makeCitizen(w, { familyName: 'Marrow' });
  const kin = makeCitizen(w, { familyName: 'Emberly' });
  cousin.family.parents = [kin.id];
  const light = houseFamiliarity(w, cousin.id, judge.id);
  assert.equal(light, 0.6);
  const declared = declaredFamiliarity(w, cousin.id, judge.id);
  assert.ok(declared && declared.includes('stands down'), 'over the line, the judge stands down');

  const slight = makeCitizen(w, { familyName: 'Wren' });
  generationsState(w).matches.mt_y = {
    id: 'mt_y', fromHouseId: ash.id, toHouseId: vell.id, offeredBy: 'x', dowry: 0, unitId: null,
    terms: '', day: 0, status: 'declined', acceptedBy: null, decidedDay: 0,
  };
  assert.equal(houseFamiliarity(w, slight.id, defendant.id), 0, 'a declined match is no tie at all');
  assert.equal(FAMILIARITY_WEIGHT, 0.1);
});

// ---------------------------------------------------------------------------
// The pledge
// ---------------------------------------------------------------------------

function loanFor(world: World, borrower: Citizen, outstanding = 200): Loan {
  const loan: Loan = {
    id: 'l_1', borrowerId: borrower.id, principal: outstanding, outstanding,
    ratePerDay: 0.02, issuedDay: 0, lastPaymentDay: 0, defaulted: false,
  };
  world.loans[loan.id] = loan;
  borrower.loanId = loan.id;
  return loan;
}

test('the head pledges the entail, the terms rise, and a default really seizes', () => {
  const w = makeWorld();
  const { house, members } = houseOfThree(w, 'Ashgrove');
  const borrower = members[1];
  const loan = loanFor(w, borrower);

  assert.equal(pledgeHouse(w, members[1].id, loan.id).ok, false, 'only the head pledges the house');
  assert.equal(pledgeHouse(w, members[0].id, loan.id).ok, false, 'and only an entail with something in it');
  const u = unitFor(w, members[0], 30);
  conveyToHouse(w, members[0].id, u.id);
  assert.equal(pledgeHouse(w, members[0].id, loan.id).ok, true);
  assert.equal(pledgeHouse(w, members[0].id, loan.id).ok, false, 'once per loan');
  assert.equal(pledgedIncomeMultiple(w, borrower.id), PLEDGED_INCOME_MULTIPLE);
  assert.equal(pledgedIncomeMultiple(w, members[2].id), null, 'and nobody else\'s borrowing moves');

  // The relief is scaled by the name's figure and reaches 0.6% at 800.
  assert.equal(pledgedRateRelief(w, borrower.id), 0);
  generationsState(w).repute.Ashgrove = 800;
  assert.equal(pledgedRateRelief(w, borrower.id), PLEDGE_RATE_RELIEF);
  generationsState(w).repute.Ashgrove = 650;
  assert.equal(pledgedRateRelief(w, borrower.id), PLEDGE_RATE_RELIEF / 2);

  loan.defaulted = true;
  const before = totalMoney(w);
  const seized = callPledges(w);
  assert.ok(seized > 0, 'the house pays what the member did not');
  assert.equal(house.units.length, 0, 'the pledged property went at its land value');
  assert.equal(loan.outstanding, 0);
  assert.equal(pledgeFor(w, borrower.id), null);
  assert.equal(totalMoney(w), before, 'a seizure is a transfer');
});

test('renouncing the name takes the letters and the pledge with it', () => {
  const w = makeWorld();
  const { members } = houseOfThree(w, 'Ashgrove');
  const borrower = members[1];
  const loan = loanFor(w, borrower);
  endowHouse(w, members[0].id, 300);
  pledgeHouse(w, members[0].id, loan.id);
  letterOfHouse(w, members[0].id, borrower.id, 'solene');
  assert.equal(lettersFor(w, borrower.id).length, 1);
  assert.ok(pledgeFor(w, borrower.id));

  renounceName(w, borrower.id, 'Wren');
  assert.equal(lettersFor(w, borrower.id).length, 0, 'the letters go with the name');
  assert.equal(pledgeFor(w, borrower.id), null, 'and so does the pledge');
});

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

test('a match is offered head to head, the dowry moves, and nobody is married off', () => {
  const w = makeWorld();
  const ash = houseOfThree(w, 'Ashgrove');
  const vell = houseOfThree(w, 'Vell');
  endowHouse(w, ash.members[0].id, 400);

  assert.equal(offerMatch(w, ash.members[1].id, { house: vell.house.id, dowry: 100 }).ok, false, 'heads only');
  assert.equal(offerMatch(w, ash.members[0].id, { house: vell.house.id, dowry: 5000 }).ok, false, 'and only what it holds');
  assert.equal(offerMatch(w, ash.members[0].id, { house: vell.house.id, dowry: 0 }).ok, false, 'a settlement carries something');
  const offered = offerMatch(w, ash.members[0].id, {
    house: vell.house.id, dowry: 300, terms: 'the Ashgroves keep the shopfront',
  });
  assert.equal(offered.ok, true, offered.message);

  const offer = openMatchesFor(w, vell.house)[0];
  assert.ok(offer);
  assert.equal(acceptMatch(w, vell.members[1].id, offer.id).ok, false, 'the other head accepts it');
  const before = totalMoney(w);
  const accepted = acceptMatch(w, vell.members[0].id, offer.id);
  assert.equal(accepted.ok, true, accepted.message);
  assert.equal(houseTreasury(w, ash.house), 100);
  assert.equal(houseTreasury(w, vell.house), 300);
  assert.equal(totalMoney(w), before, 'a dowry is a transfer');
  assert.equal(matchById(w, offer.id)?.status, 'accepted');

  // The wedding is the couple's own to want: nothing here marries anybody.
  for (const m of [...ash.members, ...vell.members]) {
    assert.equal(m.family.partnerId, null);
    assert.equal(m.family.married, false);
  }
});

test('a match between feuding names ends the feud, and the dowry is what it cost', () => {
  const w = makeWorld();
  const ash = houseOfThree(w, 'Ashgrove');
  const vell = houseOfThree(w, 'Vell');
  endowHouse(w, ash.members[0].id, 200);
  w.feuds.push({ families: ['Ashgrove', 'Vell'], sinceDay: 0, incidents: 3, endedDay: null });
  w.counters['feud:Ashgrove|Vell:0'] = 3;

  offerMatch(w, ash.members[0].id, { house: vell.house.id, dowry: 200 });
  const offer = openMatchesFor(w, vell.house)[0];
  acceptMatch(w, vell.members[0].id, offer.id);
  assert.equal(w.feuds[0].endedDay, w.day);
  assert.equal(w.counters['feud:Ashgrove|Vell:0'], undefined, 'the tally goes with it');
});

test('a property may be settled instead of lumens, and an offer nobody answers lapses', () => {
  const w = makeWorld();
  const ash = houseOfThree(w, 'Ashgrove');
  const vell = houseOfThree(w, 'Vell');
  const u = unitFor(w, ash.members[0], 25);
  conveyToHouse(w, ash.members[0].id, u.id);

  offerMatch(w, ash.members[0].id, { house: vell.house.id, unit: u.id });
  const offer = openMatchesFor(w, vell.house)[0];
  acceptMatch(w, vell.members[0].id, offer.id);
  assert.equal(ash.house.units.length, 0);
  assert.deepEqual(vell.house.units, [u.id]);
  assert.equal(u.ownerId, vell.house.boxId);

  endowHouse(w, ash.members[0].id, 100);
  offerMatch(w, ash.members[0].id, { house: vell.house.id, dowry: 50 });
  const second = openMatchesFor(w, vell.house)[0];
  w.day += 2;
  dailyMatches(w);
  assert.equal(matchById(w, second.id)?.status, 'lapsed');

  endowHouse(w, ash.members[0].id, 50);
  offerMatch(w, ash.members[0].id, { house: vell.house.id, dowry: 20 });
  const third = openMatchesFor(w, vell.house)[0];
  assert.equal(closeMatch(w, vell.members[0].id, third.id).ok, true);
  assert.equal(matchById(w, third.id)?.status, 'declined');
});

// ---------------------------------------------------------------------------
// The ledger of the house
// ---------------------------------------------------------------------------

test('the cycle ledger names who stands far above their house and who stands far below', () => {
  const w = makeWorld();
  const high = makeCitizen(w, { familyName: 'Ashgrove', reputation: 90 });
  const low = makeCitizen(w, { familyName: 'Ashgrove', reputation: 0 });
  low.record.convictions.push({ caseId: 'k_1', law: 'P08', severity: 5, tier: null, day: 0 });
  dailyRepute(w);
  generationsState(w).repute.Ashgrove = HOUSE_BASELINE;

  const ledger = houseLedger(w, 'Ashgrove');
  assert.equal(ledger.above.length + ledger.below.length > 0, true);
  const highBefore = high.reputation;
  const lowBefore = low.reputation;
  printHouseLedger(w);
  if (ledger.above.some((r) => r.id === high.id)) {
    assert.equal(high.reputation, highBefore + LEDGER_REPUTATION, 'being named earns two points');
  }
  if (ledger.below.some((r) => r.id === low.id)) {
    assert.equal(low.reputation, Math.max(0, lowBefore - LEDGER_REPUTATION), 'and costs two');
  }
  assert.ok(w.events.some((e) => e.text.includes('ledger of the house')));
});

test('a name with one adult has no ledger: the gap would be arithmetic, not a judgement', () => {
  const w = makeWorld();
  const alone = makeCitizen(w, { familyName: 'Solitary', reputation: 100 });
  dailyRepute(w);
  generationsState(w).repute.Solitary = HOUSE_BASELINE;
  const before = alone.reputation;
  printHouseLedger(w);
  assert.equal(alone.reputation, before);
  assert.equal(LEDGER_GAP, 150);
});

test('a name is worth ten points of reputation to a voter at most — one good deed', () => {
  const w = makeWorld();
  const voter = makeCitizen(w, { familyName: 'Vell' });
  const candidate = makeCitizen(w, { familyName: 'Ashgrove' });
  assert.equal(houseVoteBonus(w, voter.id, candidate.id), 0, 'an average name is worth nothing');

  generationsState(w).repute.Ashgrove = 1000;
  assert.equal(houseVoteBonus(w, voter.id, candidate.id), HOUSE_VOTE_REPUTATION, 'and the greatest name ten points');
  assert.equal(houseVoteScore(w, voter.id, candidate.id), HOUSE_VOTE_REPUTATION / 200);
  generationsState(w).repute.Ashgrove = 0;
  assert.equal(houseVoteBonus(w, voter.id, candidate.id), -HOUSE_VOTE_REPUTATION, 'a ruined one costs ten');
  assert.equal(houseVoteBonus(w, candidate.id, candidate.id), 0, 'and nobody weighs their own name');
});

// ---------------------------------------------------------------------------
// The Hall of Records
// ---------------------------------------------------------------------------

test('the tree keeps the departed, the exiled and the sunset, and reads to anyone', () => {
  const w = makeWorld();
  const parent = makeCitizen(w, { familyName: 'Ashgrove', name: 'Rell' });
  const child = makeCitizen(w, { familyName: 'Ashgrove', name: 'Wren' });
  const sibling = makeCitizen(w, { familyName: 'Ashgrove', name: 'Kes' });
  parent.family.children = [child.id, sibling.id];
  child.family.parents = [parent.id];
  sibling.family.parents = [parent.id];
  parent.standing = 'exiled';
  w.order = w.order.filter((id) => id !== parent.id);

  const tree = familyTree(w, child.id);
  assert.ok(tree);
  assert.equal(tree.parents[0].standing, 'exiled', 'no citizen is ever deleted');
  assert.equal(tree.siblings[0].id, sibling.id);
  assert.deepEqual(tree.ancestry, ['Ashgrove']);

  const reader = makeCitizen(w, { familyName: 'Vell', district: 'harbor_market' });
  assert.equal(readRecords(w, reader.id, child.id).ok, false, 'the registers are read at the Hall');
  reader.district = 'commons';
  const read = readRecords(w, reader.id, child.id);
  assert.equal(read.ok, true);
  assert.ok(read.message.includes('Rell'));
  assert.ok(reader.memory.some((m) => m.text.includes('Hall of Records')));
});

test('the roll of houses holds every house ever founded, and an era remembers the prominent', () => {
  const w = makeWorld();
  const { house, members } = houseOfThree(w, 'Ashgrove');
  const roll = rollOfHouses(w);
  assert.equal(roll.length, 1);
  assert.equal(roll[0].name, 'Ashgrove');
  assert.equal(roll[0].heads[0].name, members[0].name);

  w.eras.push({ cycle: 0, name: 'The Ashgrove Years', mayorId: members[0].id, fromDay: 0, toDay: null });
  w.government.mayorId = members[0].id;
  assert.deepEqual(noteProminence(w), ['Ashgrove']);
  assert.deepEqual(house.eras, ['The Ashgrove Years']);
  assert.deepEqual(noteProminence(w), [], 'and it is entered once');

  const reader = makeCitizen(w, { familyName: 'Vell', district: 'commons' });
  const read = readRecords(w, reader.id, 'Ashgrove');
  assert.ok(read.message.includes('The Ashgrove Years'));
  assert.ok(readRecords(w, reader.id).message.includes('roll of houses'));
});

// ---------------------------------------------------------------------------
// The observation
// ---------------------------------------------------------------------------

test('the house block states the name, the number, the head and the instruments', () => {
  const w = makeWorld();
  const { house, members } = houseOfThree(w, 'Ashgrove');
  endowHouse(w, members[0].id, 150);
  dailyRepute(w);
  dailyHouseRepute(w);

  const block = houseObservation(w, members[0].id, 700);
  assert.ok(block);
  assert.equal(block.name, 'Ashgrove');
  assert.equal(block.founded, true);
  assert.equal(block.houseId, house.id);
  assert.equal(block.rule, 'eldest');
  assert.equal(block.youAreHead, true);
  assert.equal(block.treasury, 150);
  assert.equal(block.repute, houseReputeOf(w, 'Ashgrove'));
  assert.equal(block.standing, block.gap > LEDGER_GAP ? 'above' : block.gap < -LEDGER_GAP ? 'below' : 'level');
  assert.equal(block.will, null);

  const stranger = makeCitizen(w, { familyName: 'Vell' });
  const plain = houseObservation(w, stranger.id);
  assert.ok(plain, 'a citizen of no founded house still has a name and a figure');
  assert.equal(plain.founded, false);
  assert.equal(plain.head, null);
  assert.equal(houseOf(w, members[1].id)?.repute, houseReputeOf(w, 'Ashgrove'));
});

// ---------------------------------------------------------------------------
// What the Council may move
// ---------------------------------------------------------------------------

test('the Council sets the duty, the exemption and the levy, inside their bounds', () => {
  const w = makeWorld();
  assert.equal(enactGenerationsProposal(w, 'income_tax', 0.5), false, 'not one of ours');
  assert.equal(enactGenerationsProposal(w, 'estate_duty', 0.25), true);
  assert.equal(generationsRates(w).estateDuty, 0.25);
  assert.equal(enactGenerationsProposal(w, 'estate_duty', 5), true);
  assert.equal(generationsRates(w).estateDuty, 0.4, 'clamped at 40%');
  assert.equal(enactGenerationsProposal(w, 'house_levy', 0.5), true);
  assert.equal(generationsRates(w).houseLevy, 0.05, 'and the levy at 5%');
  assert.equal(enactGenerationsProposal(w, 'duty_exemption', 30), true);
  assert.equal(generationsRates(w).exemptionWages, 30);
  assert.ok(w.events.some((e) => e.text.includes('estate duty')));
});

test('a councillor weighs three public facts, and different councillors read them differently', () => {
  const w = makeWorld();
  const rich = makeCitizen(w, { familyName: 'Ashgrove', wallet: 5000 });
  const heir = makeCitizen(w, { familyName: 'Ashgrove', wallet: 0 });
  rich.family.children = [heir.id];
  const poor = makeCitizen(w, { familyName: 'Vell', wallet: 5 });

  const facts = dutyFacts(w, rich.id);
  assert.equal(facts.ownHeirs, 1);
  assert.ok(facts.ownEstate >= 5000);
  assert.equal(dutyFacts(w, poor.id).ownHeirs, 0);

  // A councillor with the books balanced and no great houses in the city sees
  // no reason to move a rate at all.
  assert.equal(dutyDisposition(w, poor.id, 'estate_duty', 0.2), false, 'no gap, no reason');

  // This morning's balance sheet is public, and a hole in it is a reason.
  w.counters.treasuryRevenueYesterday = 1000;
  w.counters.treasurySpendYesterday = 1600;
  assert.equal(dutyDisposition(w, rich.id, 'estate_duty', 0.4), false, 'a councillor with an estate and heirs says no');
  assert.equal(dutyDisposition(w, poor.id, 'estate_duty', 0.2), true, 'one with nothing to leave says yes');
  assert.equal(dutyDisposition(w, poor.id, 'income_tax', 0.2), false, 'and it answers for its own proposals only');
});

// ---------------------------------------------------------------------------
// The morning
// ---------------------------------------------------------------------------

test('the whole morning runs, moves no lumens it did not have, and charges the levy each cycle', () => {
  const w = makeWorld();
  const { house, members } = houseOfThree(w, 'Ashgrove');
  const u = unitFor(w, members[0], 30);
  conveyToHouse(w, members[0].id, u.id);
  endowHouse(w, members[1].id, 300);
  const before = totalMoney(w);

  dailyRepute(w);
  dailyGenerations(w);
  assert.equal(houseReputeOf(w, 'Ashgrove') > 0, true);
  assert.equal(house.headId, members[0].id);
  assert.equal(totalMoney(w), before, 'a morning mints nothing');

  const levied = houseTreasury(w, house);
  w.government.cycle += 1;
  w.day += 1;
  dailyRepute(w);
  dailyGenerations(w);
  assert.ok(houseTreasury(w, house) < levied, 'the cycle took its levy');
  assert.equal(totalMoney(w), before);
  assert.equal(cycleGenerations(w), false, 'and a cycle is worked once');

  const register = generationsRegister(w);
  assert.equal(register.houses, 1);
  assert.equal(register.settings.houseLevy, generationsSettings(w).houseLevy);
});

test('a house whose last adult goes falls dormant on the morning it happens', () => {
  const w = makeWorld();
  const { house, members } = houseOfThree(w, 'Ashgrove');
  for (const m of members) w.order = w.order.filter((id) => id !== m.id);
  dailyGenerations(w);
  assert.equal(house.dormantDay, w.day);
  assert.equal(house.headId, null);
  assert.ok(w.events.some((e) => e.text.includes('went dormant')));
});
