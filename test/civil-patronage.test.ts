/**
 * Patronage (src/civil/patronage.ts).
 *
 * What a fortune can buy, which is not repute and not a shorter sentence: a
 * stipend, a name on every work made while it runs, and ten of contribution
 * against the creator's twenty when one reaches the Museum. The subject a
 * patron names is a request and never an instruction, and stopping payment
 * inside the term is a breach that costs the patron nothing but their record.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, Club, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  CREATOR_MUSEUM_CONTRIBUTION, PATRON_MUSEUM_CONTRIBUTION, acceptPatronage, countsAsShift, museumLabel,
  offerPatronage, patronOfWork, patronageBy, patronageOf, payPatronage, recordPatronisedWork, worksPatronisedBy,
} from '../src/civil/patronage.ts';
import { dailyContracts, terminateContract } from '../src/civil/amend.ts';
import { contractById } from '../src/civil/terms.ts';
import { contractRecordOf } from '../src/civil/state.ts';

function pair(world: World, patronWallet = 1_000): [Citizen, Citizen] {
  return [
    makeCitizen(world, { name: 'Patron', wallet: patronWallet }),
    makeCitizen(world, { name: 'Artist', wallet: 100 }),
  ];
}

function running(world: World, perDay = 12, days = 10): { patron: Citizen; artist: Citizen; id: string } {
  const [patron, artist] = pair(world);
  const offered = offerPatronage(world, patron.id, { to: artist.id, perDay, days, subject: 'the harbour at dusk' });
  assert.equal(offered.ok, true, offered.message);
  assert.equal(acceptPatronage(world, artist.id, offered.id!).ok, true);
  return { patron, artist, id: offered.id! };
}

test('patronage files a contract like any other, and the one with least to bargain with pays to file it', () => {
  const world = makeWorld();
  const [patron, artist] = pair(world);
  const before = totalMoney(world);
  const treasury = world.treasury.balance;
  const wallet = artist.wallet;
  const offered = offerPatronage(world, patron.id, { to: artist.id, perDay: 12, days: 10 });
  assert.equal(acceptPatronage(world, artist.id, offered.id!).ok, true);
  const k = contractById(world, offered.id!)!;
  assert.equal(k.kind, 'patronage');
  assert.equal(k.status, 'active');
  assert.equal(artist.wallet, wallet - k.fee);
  assert.equal(world.treasury.balance, treasury + k.fee);
  assert.equal(totalMoney(world), before);
});

test('a stipend runs 7 to 112 days and pays at the morning rollover', () => {
  const world = makeWorld();
  const [patron, artist] = pair(world);
  assert.equal(offerPatronage(world, patron.id, { to: artist.id, perDay: 12, days: 6 }).ok, false);
  assert.equal(offerPatronage(world, patron.id, { to: artist.id, perDay: 12, days: 113 }).ok, false);

  const { patron: p, artist: a, id } = running(world);
  assert.equal(payPatronage(world), 0, 'nothing is owed on the day it is signed');
  world.day = 1;
  const before = totalMoney(world);
  const patronWallet = p.wallet;
  const artistWallet = a.wallet;
  assert.equal(payPatronage(world), 12);
  assert.equal(p.wallet, patronWallet - 12);
  assert.equal(a.wallet, artistWallet + 12);
  assert.equal(totalMoney(world), before);
  assert.equal(payPatronage(world), 0, 'once a day');
  assert.equal(contractById(world, id)!.performances.length, 1);
});

test('while it runs, making things counts as a worked shift', () => {
  const world = makeWorld();
  const { artist, patron } = running(world);
  assert.equal(countsAsShift(world, artist.id, 'create_work'), true);
  assert.equal(countsAsShift(world, artist.id, 'publish'), true);
  assert.equal(countsAsShift(world, artist.id, 'study'), true);
  assert.equal(countsAsShift(world, artist.id, 'work'), false, 'a shift is a shift');
  assert.equal(countsAsShift(world, patron.id, 'create_work'), false, 'the patron is not the one being kept');
  const other = makeCitizen(world, { name: 'Unfunded' });
  assert.equal(countsAsShift(world, other.id, 'create_work'), false);
});

test('every work made during the term carries the patron’s name for ever', () => {
  const world = makeWorld();
  const { patron, artist, id } = running(world);
  assert.equal(recordPatronisedWork(world, 'w_1', artist.id), patron.id);
  assert.equal(patronOfWork(world, 'w_1'), patron.id);
  assert.equal(museumLabel(world, 'w_1'), `under the patronage of ${patron.name}`);
  assert.deepEqual(worksPatronisedBy(world, patron.id), ['w_1']);
  assert.equal(PATRON_MUSEUM_CONTRIBUTION, 10);
  assert.equal(CREATOR_MUSEUM_CONTRIBUTION, 20);

  // The term ends; the name does not.
  world.day = 1;
  assert.equal(terminateContract(world, patron.id, id).ok, true);
  assert.equal(contractById(world, id)!.status, 'terminated');
  assert.equal(patronOfWork(world, 'w_1'), patron.id);
  assert.equal(recordPatronisedWork(world, 'w_2', artist.id), null, 'and nothing after it does');
});

test('stopping payment inside the term is a breach, and it costs the patron nothing but the record', () => {
  const world = makeWorld();
  const { patron, artist, id } = running(world, 40, 10);
  patron.wallet = 0;
  const reputation = patron.reputation;
  const money = totalMoney(world);
  world.day = 1;
  assert.equal(payPatronage(world), 0, 'a patron who cannot pay has not paid');
  world.day = 2;
  dailyContracts(world);
  const k = contractById(world, id)!;
  assert.equal(k.status, 'breached');
  assert.equal(k.breachedById, patron.id, 'the stipend is the patron’s to pay');
  assert.equal(contractRecordOf(world, patron.id).breached, 1);
  assert.equal(totalMoney(world), money);
  assert.equal(patron.reputation, reputation);
  assert.equal(patron.standing, 'good');
  assert.equal(patron.finesOwed, 0);
  assert.equal(patron.record.convictions.length, 0);
  assert.equal(artist.wallet >= 0, true);
});

test('the subject is a request and never an instruction', () => {
  const world = makeWorld();
  const { patron, artist, id } = running(world);
  const k = contractById(world, id)!;
  assert.equal(k.subject, 'the harbour at dusk');
  // Nothing anywhere reads it back: the artist may make whatever they like and
  // the term runs on regardless. All the patron can do is serve notice.
  world.day = 1;
  payPatronage(world);
  recordPatronisedWork(world, 'w_9', artist.id);
  assert.equal(contractById(world, id)!.status, 'active');
  assert.equal(terminateContract(world, patron.id, id).ok, true);
  assert.equal(contractById(world, id)!.status, 'terminated');
  assert.equal(contractRecordOf(world, artist.id).breached, 0, 'ignoring a request is not a breach');
  assert.equal(patronageOf(world, artist.id), null);
  assert.deepEqual(patronageBy(world, patron.id), []);
});

test('a club has no purse, so its convenor takes the stipend in its name', () => {
  const world = makeWorld();
  const patron = makeCitizen(world, { name: 'Patron', wallet: 1_000 });
  const convenor = makeCitizen(world, { name: 'Convenor', wallet: 100 });
  const club: Club = {
    id: 'u_1', name: 'The Lantern Choir', hobby: 'music', founderId: convenor.id, convenorId: convenor.id,
    members: [convenor.id], foundedDay: 0, meetsOnWeekday: 3,
  };
  world.clubs[club.id] = club;
  const offered = offerPatronage(world, patron.id, { to: convenor.id, perDay: 10, days: 7, clubId: club.id });
  assert.equal(offered.ok, true, offered.message);
  assert.equal(acceptPatronage(world, convenor.id, offered.id!).ok, true);
  const k = contractById(world, offered.id!)!;
  assert.equal(k.clubId, club.id);
  assert.ok(k.terms.includes('The Lantern Choir'));
  world.day = 1;
  const wallet = convenor.wallet;
  assert.equal(payPatronage(world), 10);
  assert.equal(convenor.wallet, wallet + 10);
});
