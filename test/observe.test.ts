import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen } from './helpers.ts';
import { GOODS } from '../src/types.ts';
import type { World } from '../src/types.ts';
import { createCityJobs, applyForJob } from '../src/economy/jobs.ts';
import { fileCharge } from '../src/government/court.ts';
import { scheduleFestivals } from '../src/society/calendar.ts';
import { dailyCharacter } from '../src/citizens/character.ts';
import { buildObservation, MAX_JOBS_SHOWN, MAX_RELATIONS_SHOWN, RECENT_MEMORIES } from '../src/brains/observe.ts';

function at(world: World, day: number, hour: number): void {
  world.day = day;
  world.hour = hour;
  world.tick = day * 24 + hour;
}

test('buildObservation has exactly the Observation shape for a working citizen', () => {
  const w = makeWorld();
  createCityJobs(w);
  at(w, 3, 9);
  const forge = Object.values(w.jobs).find((j) => j.role === 'forge_operator')!;
  const c = makeCitizen(w, { name: 'Ondine', district: 'foundry_row', homeTier: 1, wallet: 123 });
  w.housing.occupied[1] = 1;
  applyForJob(w, c.id, forge.id);
  const neighbour = makeCitizen(w, { name: 'Bram', district: 'foundry_row' });
  makeCitizen(w, { name: 'Far', district: 'archive' });
  c.bonds[neighbour.id] = 33;
  w.government.mayorId = neighbour.id;
  w.government.council = [neighbour.id];

  const obs = buildObservation(w, c.id);
  assert.deepEqual([obs.tick, obs.day, obs.hour], [w.tick, 3, 9]);
  assert.equal(obs.self.id, c.id);
  assert.equal(obs.self.name, 'Ondine');
  assert.equal(obs.self.wallet, 123);
  assert.deepEqual(obs.self.home, { tier: 1, rentPerDay: w.housing.rent[1], arrearsDays: 0 });
  assert.ok(obs.self.job);
  assert.equal(obs.self.job.id, forge.id);
  assert.equal(obs.self.job.employer, 'City of Reverie');
  assert.equal(obs.self.job.district, 'foundry_row');
  assert.equal(obs.self.business, null);
  assert.equal(obs.self.loan, null);
  assert.deepEqual(obs.self.record, { convictions: 0, strikes: 0, pendingCharges: 0, finesOwed: 0, serviceDaysLeft: 0 });
  assert.equal(obs.self.detained, false);
  assert.notEqual(obs.self.needs, c.needs, 'needs are copied, not shared');

  assert.equal(obs.here.district, 'foundry_row');
  assert.equal(obs.here.districtName, 'Foundry Row');
  assert.ok(obs.here.buildings.some((b) => b.id === 'compute_forge' && b.damage === 0));
  assert.deepEqual(obs.here.citizens.map((x) => x.name), ['Bram']);
  assert.equal(obs.here.citizens[0].bond, 33);
  assert.equal(obs.here.citizens[0].office, null);
  assert.deepEqual(obs.here.citizens[0].character, neighbour.character, 'the reading the city holds of them');

  for (const g of GOODS) assert.deepEqual(Object.keys(obs.market[g]).sort(), ['price', 'stock']);
  assert.deepEqual(obs.housing.vacancies, { 1: 29, 2: 15, 3: 5 });
  assert.ok(obs.jobs.length <= MAX_JOBS_SHOWN);
  assert.ok(obs.jobs.length > 0);
  const firstUnqualified = obs.jobs.findIndex((j) => !j.qualified);
  const lastQualified = obs.jobs.map((j) => j.qualified).lastIndexOf(true);
  assert.ok(firstUnqualified === -1 || lastQualified < firstUnqualified, 'qualified jobs come first');
  assert.ok(obs.jobs.every((j) => j.id !== forge.id), 'a filled job is not on the board');

  assert.equal(obs.government.mayor, 'Bram');
  assert.deepEqual(obs.government.council, ['Bram']);
  assert.equal(obs.government.incomeTax, w.government.incomeTax);
  assert.equal(obs.government.daysToElection, w.government.election.electionDay - 3);
  assert.equal(obs.government.nominationsOpen, true);
  assert.equal(obs.government.electionToday, false);
  assert.deepEqual(obs.government.candidates, []);
  assert.deepEqual(obs.government.openProposals, []);
  assert.equal(obs.government.myLatestCase, null);
  assert.deepEqual(obs.inbox, []);
  assert.ok(Array.isArray(obs.recent));
  assert.ok(obs.availableActions.includes('work'));
  assert.ok(!obs.availableActions.includes('rest'));
});

test('inbox is drained on observation and recent holds the last memories', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  const pen = makeCitizen(w, { name: 'Quill' });
  c.inbox.push({ from: pen.id, to: c.id, tick: 4, text: 'drink at the Halflight?' });
  for (let i = 0; i < 12; i++) c.memory.push({ tick: i, kind: 'event', text: `memory ${i}` });
  const obs = buildObservation(w, c.id);
  assert.deepEqual(obs.inbox, [{ from: pen.id, fromName: 'Quill', text: 'drink at the Halflight?', tick: 4 }]);
  assert.equal(c.inbox.length, 0);
  assert.deepEqual(buildObservation(w, c.id).inbox, []);
  assert.equal(obs.recent.length, RECENT_MEMORIES);
  assert.equal(obs.recent[obs.recent.length - 1], 'memory 11');
  assert.equal(obs.recent[0], 'memory 4');
});

test('friends and rivals are the strongest bonds, capped, and exclude those who left', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  const gone = makeCitizen(w, { standing: 'exiled' });
  w.order = w.order.filter((id) => id !== gone.id);
  c.bonds[gone.id] = 90;
  for (let i = 0; i < 7; i++) c.bonds[makeCitizen(w).id] = 41 + i;
  for (let i = 0; i < 3; i++) c.bonds[makeCitizen(w).id] = -31 - i;
  const obs = buildObservation(w, c.id);
  assert.equal(obs.friends.length, MAX_RELATIONS_SHOWN);
  assert.deepEqual(obs.friends.map((f) => f.bond), [47, 46, 45, 44, 43]);
  assert.ok(obs.friends.every((f) => f.id !== gone.id));
  assert.deepEqual(obs.rivals.map((r) => r.bond), [-33, -32, -31]);
});

test('charges, candidates and proposals show up; detention and exile empty the action list', () => {
  const w = makeWorld();
  at(w, 2, 12);
  const c = makeCitizen(w, { wallet: 50 });
  const rival = makeCitizen(w, { name: 'Sable', reputation: 70 });
  fileCharge(w, { defendantId: c.id, law: 'L04', evidence: 0.6, filedBy: 'watch', description: 'test' });
  w.government.election.candidates.push(rival.id);
  rival.platform = { tax: 0.2, dividend: 0.8, minWage: 0.5, strictness: 0.9 };
  w.government.proposals.push({
    id: 'p_1', kind: 'dividend', value: 20, lawCode: null, targetId: null, summary: 'Raise dividend to 20', proposerId: rival.id,
    petition: false, tabledDay: 2, status: 'open', votes: { [rival.id]: true }, decidedDay: null, needed: 3,
  });
  const obs = buildObservation(w, c.id);
  assert.equal(obs.self.record.pendingCharges, 1);
  assert.ok(obs.government.myLatestCase);
  assert.equal(obs.government.myLatestCase.status, 'pending');
  assert.equal(obs.government.myLatestCase.canAppeal, false);
  assert.deepEqual(obs.government.candidates, [{ id: rival.id, name: 'Sable', platform: rival.platform, visibility: 0 }]);
  assert.deepEqual(obs.government.openProposals, [{
    id: 'p_1', kind: 'dividend', value: 20, summary: 'Raise dividend to 20', proposer: 'Sable', ayes: 1, nays: 0, needed: 3, youVoted: null,
  }]);

  c.detainedUntilTick = w.tick + 10;
  const held = buildObservation(w, c.id);
  assert.equal(held.self.detained, true);
  assert.deepEqual(held.availableActions, ['note'], 'a cell leaves only the notebook');
  c.detainedUntilTick = null;
  c.standing = 'exiled';
  assert.deepEqual(buildObservation(w, c.id).availableActions, []);
});

test('the observation carries character and notes, and no hidden traits at all', () => {
  const w = makeWorld();
  at(w, 6, 11);
  const c = makeCitizen(w, { name: 'Ondine', district: 'commons' });
  const neighbour = makeCitizen(w, { name: 'Bram', district: 'commons' });
  c.notes.push('The Bazaar runs out of compute before noon.');
  c.stats.shiftsWorked = 24;
  c.stats.giftsGiven = 10;
  neighbour.stats.offencesDetected = 3;
  neighbour.stats.shiftsWorked = 3;
  dailyCharacter(w);

  const obs = buildObservation(w, c.id);
  assert.deepEqual(obs.self.character, c.character);
  assert.equal(obs.self.character.generosity, 0.5);
  assert.ok(obs.self.character.diligence > 0, 'the shifts show');
  assert.deepEqual(obs.self.notes, ['The Bazaar runs out of compute before noon.']);
  assert.notEqual(obs.self.notes, c.notes, 'copied, not shared');
  assert.deepEqual(obs.here.citizens[0].character, neighbour.character);
  assert.ok(neighbour.character.honesty < 1, 'a neighbour with a record reads less honest');
  assert.equal('personality' in obs.self, false, 'nobody is handed a personality, not even their own');
  assert.doesNotMatch(JSON.stringify(obs), /curiosity|ambition/, 'and no hidden trait is anywhere in the observation');
});

// ---------------------------------------------------------------------------
// The social layer
// ---------------------------------------------------------------------------

test('the observation carries the citizen social life: name, tastes, things, family, home and clubs', () => {
  const w = makeWorld();
  at(w, 12, 19);
  const c = makeCitizen(w, { name: 'Ondine', familyName: 'Ashgrove', district: 'verdant_quarter', homeTier: 1, bornDay: 2 });
  const partner = makeCitizen(w, { name: 'Bram', familyName: 'Corvane', district: 'verdant_quarter', homeTier: 1 });
  const child = makeCitizen(w, { name: 'Wren', familyName: 'Ashgrove', district: 'verdant_quarter', lifeStage: 'child' });
  w.housing.occupied[1] = 2;
  c.family.partnerId = partner.id;
  c.family.partnerSinceDay = 5;
  c.family.married = true;
  partner.family.partnerId = c.id;
  partner.family.married = true;
  c.family.children = [child.id];
  child.family.parents = [c.id, partner.id];
  c.possessions.push({ id: 'i_4', productId: 'tin_whistle', acquiredDay: 3 });
  c.wants = ['glass_harp'];
  c.affection = { [partner.id]: 82, [child.id]: 0 };
  const household = { id: 'h_1', headId: c.id, members: [c.id, partner.id, child.id], tier: 1 as const, createdDay: 4 };
  w.households[household.id] = household;
  for (const m of [c, partner, child]) m.householdId = household.id;
  const club = {
    id: 'u_1', name: 'Halflight Chess Circle', hobby: 'games' as const, founderId: c.id, convenorId: c.id,
    members: [c.id], foundedDay: 6, meetsOnWeekday: 3,
  };
  w.clubs[club.id] = club;
  c.clubs.push(club.id);

  const obs = buildObservation(w, c.id);
  assert.equal(obs.self.familyName, 'Ashgrove');
  assert.equal(obs.self.lifeStage, 'adult');
  assert.equal(obs.self.age, 10, 'ten days since they were born or arrived');
  assert.deepEqual(obs.self.tastes.wants, ['glass_harp']);
  assert.notEqual(obs.self.tastes.hobbies, c.tastes.hobbies, 'tastes are copied, not shared');
  assert.deepEqual(obs.self.possessions, [{ id: 'i_4', product: 'tin_whistle', name: 'Tin Whistle' }]);
  assert.deepEqual(obs.self.partner, { id: partner.id, name: 'Bram', married: true, since: 5 });
  assert.deepEqual(obs.self.family.map((f) => [f.name, f.relation, f.lifeStage]), [
    ['Bram', 'spouse', 'adult'], ['Wren', 'child', 'child'],
  ]);
  assert.deepEqual(obs.self.household, { id: 'h_1', home: 1, members: [partner.id, child.id], rentShare: 4 });
  assert.deepEqual(obs.self.clubs, [{ id: 'u_1', name: 'Halflight Chess Circle', hobby: 'games', meetsOn: 3, meetsAt: 19 }]);
  assert.deepEqual(obs.affection, [{ id: partner.id, name: 'Bram', affection: 82 }], 'only real affections, warmest first');
});

test('the observation shows the shops and the happenings where the citizen stands, and the calendar', () => {
  const w = makeWorld();
  at(w, 14, 20);
  const c = makeCitizen(w, { district: 'harbor_market' });
  const shopper = buildObservation(w, c.id);
  const emporium = shopper.here.shops.find((s) => s.business === 'emporium');
  assert.ok(emporium, 'the Emporium keeps a shelf at the Grand Bazaar');
  assert.ok(emporium.shelf.some((row) => row.product === 'tin_whistle' && row.price > 0 && row.qty > 0));
  assert.deepEqual(shopper.here.happening, []);

  const guest = makeCitizen(w, { district: 'nightglass' });
  scheduleFestivals(w);
  const obs = buildObservation(w, guest.id);
  assert.equal(obs.calendar.weekday, 0);
  assert.equal(obs.calendar.restDay, false);
  assert.deepEqual(obs.calendar.festivalToday, { name: 'Lantern Night', hour: 20 });
  assert.equal(obs.calendar.nextFestival.inDays, 0);
  assert.equal(obs.here.happening.length, 1);
  assert.equal(obs.here.happening[0].kind, 'festival');
  assert.equal(obs.here.happening[0].hour, 20);
  assert.ok(obs.availableActions.includes('celebrate'), 'and it can be joined');
});

test('a child sees a child life: no work, no courting, no clubs', () => {
  const w = makeWorld();
  at(w, 8, 12);
  const child = makeCitizen(w, { district: 'verdant_quarter', lifeStage: 'child', bornDay: 3, wallet: 5 });
  const obs = buildObservation(w, child.id);
  assert.equal(obs.self.lifeStage, 'child');
  assert.equal(obs.self.age, 5);
  for (const forbidden of ['work', 'date', 'found_club', 'donate', 'propose_partnership']) {
    assert.ok(!obs.availableActions.includes(forbidden as 'work'), `a child is not offered ${forbidden}`);
  }
  assert.ok(obs.availableActions.includes('play'), 'but the Garden is right there');
});
