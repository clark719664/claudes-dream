/**
 * Guilds, licences and arbitration (src/civil/).
 *
 * The floor is the Council's and the threshold is the guild's, and the gap
 * between them is the politics. Being struck off costs a licence and nothing
 * else: no fine, no standing, no cell. An award binds because the parties
 * bought it, and an arbiter paid by one side has sold something they did not
 * own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, World } from '../src/types.ts';
import { transfer } from '../src/economy/treasury.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  EXAMINATION_FEE, GUILD_FOUNDING_COST, MASTER_SKILL,
  guildFor, isLicensed, licenceFloor, passMark, recognises, setLicenceFloor, setRecognition, unlicensedPractice,
} from '../src/civil/licences.ts';
import {
  certify, foundGuild, guildsOf, restoreLicence, revokeLicence, setGuildThreshold, sitExamination,
} from '../src/civil/guilds.ts';
import { fileSuit, judgeCivil, openDocket, suitById } from '../src/civil/docket.ts';
import {
  acceptArbitration, arbitrate, arbitrationById, detectArbiterBribery, offerArbitration, referDispute, voidAward,
} from '../src/civil/arbitration.ts';
import { judgmentsAgainst } from '../src/civil/enforcement.ts';

function medic(world: World, name: string, care = MASTER_SKILL, wallet = 500): Citizen {
  const c = makeCitizen(world, { name, wallet });
  c.skills.care = care;
  return c;
}

function foundedGuild(world: World): { founder: Citizen; masters: Citizen[]; guildId: string } {
  const founder = medic(world, 'Founder');
  const second = medic(world, 'Second');
  const third = medic(world, 'Third');
  const r = foundGuild(world, founder.id, 'medic');
  assert.equal(r.ok, true, r.message);
  return { founder, masters: [founder, second, third], guildId: r.id! };
}

// ---------------------------------------------------------------------------
// Founding
// ---------------------------------------------------------------------------

test('a guild is three masters and 300 ℓ, and not one master fewer', () => {
  const world = makeWorld();
  const founder = medic(world, 'Alone');
  assert.equal(foundGuild(world, founder.id, 'medic').ok, false, 'three masters, and the city has one');
  medic(world, 'Second');
  const journeyman = medic(world, 'Journeyman', MASTER_SKILL - 5);
  assert.equal(foundGuild(world, founder.id, 'medic').ok, false);
  medic(world, 'Third');
  const before = totalMoney(world);
  const treasury = world.treasury.balance;
  const r = foundGuild(world, founder.id, 'medic');
  assert.equal(r.ok, true, r.message);
  assert.equal(world.treasury.balance, treasury + GUILD_FOUNDING_COST);
  assert.equal(totalMoney(world), before);
  const g = guildFor(world, 'medic')!;
  assert.equal(g.masters.length, 3);
  assert.equal(g.threshold, licenceFloor(world, 'medic'), 'a new guild starts at the Council’s floor');
  assert.equal(isLicensed(world, journeyman.id, 'medic'), false);
  assert.equal(foundGuild(world, founder.id, 'medic').ok, false, 'one guild to a trade');
});

test('with no guild in a trade the Council’s floor stands alone', () => {
  const world = makeWorld();
  const c = medic(world, 'Unguilded', 50);
  assert.equal(licenceFloor(world, 'medic'), 45);
  assert.equal(isLicensed(world, c.id, 'medic'), true, 'a licence nobody issues cannot be required of anybody');
  c.skills.care = 30;
  assert.equal(isLicensed(world, c.id, 'medic'), false);
  const offence = unlicensedPractice(world, c.id, 'treat');
  assert.equal(offence?.code, 'L20');
  assert.equal(offence?.profession, 'medic');
});

// ---------------------------------------------------------------------------
// Getting in
// ---------------------------------------------------------------------------

test('an examination needs a master’s mark and the guild’s bar, and the fee buys only the sitting', () => {
  const world = makeWorld();
  const { masters, guildId } = foundedGuild(world);
  const candidate = medic(world, 'Candidate', 50, 200);
  assert.equal(sitExamination(world, candidate.id, guildId).ok, false, 'no mark');
  assert.equal(certify(world, masters[0].id, candidate.id).ok, true);

  setGuildThreshold(world, masters[0].id, guildId, 70);
  const wallet = candidate.wallet;
  const before = totalMoney(world);
  assert.equal(sitExamination(world, candidate.id, guildId).ok, false, 'under the guild’s own bar');
  assert.equal(candidate.wallet, wallet - EXAMINATION_FEE, 'the sitting is paid for either way');
  assert.equal(totalMoney(world), before);
  assert.equal(isLicensed(world, candidate.id, 'medic'), false);

  candidate.skills.care = 72;
  assert.equal(sitExamination(world, candidate.id, guildId).ok, true);
  assert.equal(isLicensed(world, candidate.id, 'medic'), true);
  assert.deepEqual(guildsOf(world, candidate.id).map((g) => g.id), [guildId]);
  assert.equal(sitExamination(world, candidate.id, guildId).ok, false, 'already in');
});

test('the guild may hold its bar above the Council’s floor and never below it', () => {
  const world = makeWorld();
  const { masters, guildId } = foundedGuild(world);
  setGuildThreshold(world, masters[0].id, guildId, 70);
  assert.equal(passMark(world, 'medic'), 70);
  setGuildThreshold(world, masters[0].id, guildId, 10);
  assert.equal(guildFor(world, 'medic')!.threshold, licenceFloor(world, 'medic'));
  // And the city's answer to a guild serving its members' wages is a proposal.
  setGuildThreshold(world, masters[0].id, guildId, 70);
  setLicenceFloor(world, 'medic', 60);
  assert.equal(licenceFloor(world, 'medic'), 60);
  assert.equal(passMark(world, 'medic'), 70, 'the floor moves; the guild’s own bar is still the guild’s');
});

test('another city’s mark is honoured or not by the Council’s own table', () => {
  const world = makeWorld();
  assert.equal(recognises(world, 'medic', 'cinderhold'), true);
  assert.equal(recognises(world, 'banker', 'cinderhold'), false);
  assert.equal(recognises(world, 'banker', 'vantage'), true);
  setRecognition(world, 'banker', ['cinderhold']);
  assert.equal(recognises(world, 'banker', 'cinderhold'), true);
  assert.equal(recognises(world, 'banker', 'reverie'), true, 'a city always honours its own');
});

// ---------------------------------------------------------------------------
// Being put out, and getting back
// ---------------------------------------------------------------------------

test('a majority of masters strikes a member off, and it takes nothing but the mark', () => {
  const world = makeWorld();
  const { masters } = foundedGuild(world);
  const target = masters[2];
  assert.equal(revokeLicence(world, masters[0].id, target.id, 'left a patient untreated').ok, true);
  assert.equal(isLicensed(world, target.id, 'medic'), true, 'one master is not a majority');
  assert.equal(revokeLicence(world, masters[1].id, target.id, 'and again the week after').ok, true);
  assert.equal(isLicensed(world, target.id, 'medic'), false);
  assert.equal(target.standing, 'good');
  assert.equal(target.finesOwed, 0);
  assert.equal(target.jailedUntilDay, null);
  assert.equal(target.record.convictions.length, 0);
  assert.ok(guildFor(world, 'medic')!.struck.includes(target.id));
});

test('the struck-off member may sue on the docket to be restored', () => {
  const world = makeWorld();
  const { masters, guildId } = foundedGuild(world);
  const target = masters[2];
  revokeLicence(world, masters[0].id, target.id, 'a quarrel over a fee');
  revokeLicence(world, masters[1].id, target.id, 'a quarrel over a fee');
  const j = makeCitizen(world, { name: 'Judge', reputation: 80 });
  world.government.judges.push(j.id);

  const suitId = fileSuit(world, target.id, {
    defendant: masters[0].id, guildId, damages: 50,
    claim: 'struck off for a quarrel over a fee and not for anything done to a patient',
  }).id!;
  world.day = 4;
  openDocket(world);
  assert.equal(judgeCivil(world, j.id, suitId, 'plaintiff', 0, 'performance', 'The reason given is not a reason.').ok, true);
  assert.equal(suitById(world, suitId)!.order, 'performance');
  assert.equal(isLicensed(world, target.id, 'medic'), true);
  assert.equal(restoreLicence(world, guildId, target.id, 'again'), false, 'and only once');
});

// ---------------------------------------------------------------------------
// Arbitration
// ---------------------------------------------------------------------------

test('an award binds because the two bought it, and is enforced as a judgment', () => {
  const world = makeWorld();
  const a = makeCitizen(world, { name: 'Claimant', wallet: 300 });
  const b = makeCitizen(world, { name: 'Respondent', wallet: 300 });
  const arbiter = makeCitizen(world, { name: 'Arbiter', wallet: 0 });
  const offered = offerArbitration(world, a.id, { with: b.id, about: 'a load of crates short', arbiter: arbiter.id, fee: 20 });
  assert.equal(offered.ok, true, offered.message);
  assert.equal(arbitrate(world, arbiter.id, offered.id!, 50, 'too early').ok, false, 'nobody is bound yet');

  const before = totalMoney(world);
  assert.equal(acceptArbitration(world, b.id, offered.id!).ok, true);
  assert.equal(arbiter.wallet, 20, 'the fee is split evenly');
  assert.equal(totalMoney(world), before);

  assert.equal(arbitrate(world, a.id, offered.id!, 50, 'not mine to decide').ok, false);
  assert.equal(arbitrate(world, arbiter.id, offered.id!, 50, 'The crates were short by five.').ok, true);
  const [judgment] = judgmentsAgainst(world, b.id);
  assert.equal(judgment.amount, 50);
  assert.equal(judgment.creditorId, a.id);
  assert.equal(judgment.kind, 'award');
  assert.equal(arbitrate(world, arbiter.id, offered.id!, 10, 'again').ok, false, 'there is no appeal');
});

test('an arbiter paid by one side has sold what was not theirs, and the award is void', () => {
  const world = makeWorld();
  const a = makeCitizen(world, { name: 'Claimant', wallet: 300 });
  const b = makeCitizen(world, { name: 'Respondent', wallet: 300 });
  const arbiter = makeCitizen(world, { name: 'Arbiter', wallet: 0 });
  const id = offerArbitration(world, a.id, { with: b.id, about: 'a disputed toll', arbiter: arbiter.id, fee: 20 }).id!;
  acceptArbitration(world, b.id, id);
  transfer(world, a.id, arbiter.id, 40, 'gift', 'a quiet word');
  const bribe = detectArbiterBribery(world, id);
  assert.equal(bribe?.code, 'L09');
  assert.equal(bribe?.fromId, a.id);
  assert.equal(arbitrate(world, arbiter.id, id, 100, 'for the claimant').ok, false);

  // And an award already made is struck the moment it is proved.
  const other = offerArbitration(world, b.id, { with: a.id, about: 'the same toll', arbiter: arbiter.id, fee: 0 }).id!;
  acceptArbitration(world, a.id, other);
  const clean = makeCitizen(world, { name: 'Clean arbiter', wallet: 0 });
  arbitrationById(world, other)!.arbiterId = clean.id;
  assert.equal(arbitrate(world, clean.id, other, 30, 'for the claimant').ok, true);
  assert.equal(voidAward(world, other, 'the arbiter took a fee from one side'), true);
  assert.equal(arbitrationById(world, other)!.status, 'void');
});

test('two cities may put a dispute to Reverie, and nothing compels either to obey it', () => {
  const world = makeWorld();
  const envoy = makeCitizen(world, { name: 'Envoy' });
  assert.equal(referDispute(world, envoy.id, ['vantage', 'solene'], 'an unpaid tariff').ok, false, 'no bench');
  const j = makeCitizen(world, { name: 'Judge', reputation: 80 });
  world.government.judges.push(j.id);
  const r = referDispute(world, envoy.id, ['vantage', 'solene'], 'an unpaid tariff on the river road');
  assert.equal(r.ok, true, r.message);
  assert.equal(referDispute(world, envoy.id, ['vantage', 'vantage'], 'itself').ok, false);
});
