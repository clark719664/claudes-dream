import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Business, Citizen, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import {
  BUST_CONVICTIONS, GANG_MIN_BONDS, RACKET_MIN, bustCheck, bustGang, convictionsThisCycle, dailyGangs, defend,
  describeGang, foundGang, gangOf, gangOfTurf, gangsView, liveGangs, mayFoundGang, payRacket, racket, racketDemand,
  recruit, splitLoot,
} from '../src/government/gangs.ts';
import { EVIDENCE_WITNESS_REPORT } from '../src/government/watch.ts';

/** Somebody the city has watched and does not trust. */
function addCrook(w: World, name: string, honesty = 0.2, district: Citizen['district'] = 'nightglass'): Citizen {
  const c = makeCitizen(w, { name, district, familyName: name });
  c.character.honesty = honesty;
  return c;
}

/** A founder with the friends a gang needs behind it. */
function gangFounder(w: World): { boss: Citizen; friends: Citizen[] } {
  const boss = addCrook(w, 'Boss', 0.15);
  const friends: Citizen[] = [];
  for (let i = 0; i < GANG_MIN_BONDS; i++) {
    const f = addCrook(w, `Hand${i}`, 0.25);
    f.bonds[boss.id] = 60;
    boss.bonds[f.id] = 60;
    friends.push(f);
  }
  return { boss, friends };
}

function addBusiness(w: World, ownerId: string, treasury = 400, district: Business['district'] = 'nightglass'): Business {
  const id = nextId(w, 'b');
  const b: Business = {
    id, name: 'Glass Works', kind: 'workshop', ownerId, treasury, district, buildingId: 'shopfronts_harbor',
    employees: [], jobs: [], inventory: { compute: 0, energy: 8, goods: 10, culture: 0, knowledge: 0 },
    foundedDay: w.day, rentPerDay: 15, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  w.businesses[id] = b;
  w.citizens[ownerId].businessId = id;
  return b;
}

test('a gang needs a name the city has earned for you, and friends of the same kind', () => {
  const w = makeWorld();
  const honest = makeCitizen(w, { name: 'Clean', familyName: 'Clean' });
  honest.character.honesty = 0.9;
  assert.equal(mayFoundGang(w, honest), false);
  const refused = foundGang(w, honest.id, 'The Choir');
  assert.equal(refused.ok, false);
  assert.match(refused.message, /too clean/);

  const lonely = addCrook(w, 'Lonely');
  assert.equal(mayFoundGang(w, lonely), false, 'no friends, no gang');
  assert.match(foundGang(w, lonely.id, 'The One').message, /friends of your own sort/);

  const { boss } = gangFounder(w);
  assert.equal(mayFoundGang(w, boss), true);
  const made = foundGang(w, boss.id, 'The Ash Hands');
  assert.equal(made.ok, true);
  const g = gangOf(w, boss.id);
  assert.ok(g);
  assert.equal(g.name, 'The Ash Hands');
  assert.equal(g.bossId, boss.id);
  assert.equal(g.turf, 'nightglass', 'the turf is where the founder stands');
  assert.deepEqual(g.members, [boss.id]);
  assert.equal(gangOfTurf(w, 'nightglass')?.id, g.id);
  assert.ok(w.events.some((e) => e.kind === 'gang' && e.weight === 0.7));
  assert.equal(foundGang(w, boss.id, 'Another').ok, false, 'one gang to a citizen');
  assert.equal(foundGang(w, 'c_nobody', 'Ghosts').ok, false);
  assert.ok(describeGang(w, g).includes('Nightglass'));

  // A citizen the Court has suspended is in no position to found anything.
  const barred = addCrook(w, 'Barred');
  for (let i = 0; i < GANG_MIN_BONDS; i++) {
    const f = addCrook(w, `Ally${i}`, 0.2);
    f.bonds[barred.id] = 60; barred.bonds[f.id] = 60;
  }
  barred.standing = 'suspended';
  assert.equal(mayFoundGang(w, barred), false);
});

test('the Undercroft is a gang\'s natural home once it is open', () => {
  const w = makeWorld();
  w.openDistricts = ['commons', 'nightglass', 'undercroft'];
  const { boss } = gangFounder(w);
  boss.homeTier = 0; // nowhere of their own
  assert.equal(foundGang(w, boss.id, 'The Low Keys').ok, true);
  assert.equal(gangOf(w, boss.id)?.turf, 'undercroft');
});

test('recruiting works on people who already know you, and a refusal only costs the bond', () => {
  const w = makeWorld();
  const { boss } = gangFounder(w);
  foundGang(w, boss.id, 'The Ash Hands');

  const stranger = addCrook(w, 'Stranger', 0.2);
  assert.equal(recruit(w, boss.id, stranger.id).ok, false, 'nobody joins somebody they barely know');

  const upright = addCrook(w, 'Upright', 0.8);
  upright.bonds[boss.id] = 80; boss.bonds[upright.id] = 80;
  const notThatSort = recruit(w, boss.id, upright.id);
  assert.equal(notThatSort.ok, false);
  assert.match(notThatSort.message, /not that sort/);

  const willing = addCrook(w, 'Willing', 0.1);
  willing.bonds[boss.id] = 90; boss.bonds[willing.id] = 90;
  let joined = false;
  for (let i = 0; i < 20 && !joined; i++) joined = !!recruit(w, boss.id, willing.id).ok && !!willing.gangId;
  assert.ok(joined, 'a close friend the city does not trust joins sooner or later');
  assert.deepEqual(gangOf(w, boss.id)?.members, [boss.id, willing.id]);
  assert.ok(willing.memory.some((m) => m.text.includes('You joined')));

  // Recruiting happens in the turf, and only there.
  boss.district = 'commons';
  const elsewhere = recruit(w, boss.id, willing.id);
  assert.equal(elsewhere.ok, false);
  assert.match(elsewhere.message, /turf/);
  assert.equal(recruit(w, 'c_nobody', willing.id).ok, false);
  assert.equal(recruit(w, willing.id, willing.id).ok, false);
});

test('a racket moves money from the till to the boss and conserves it', () => {
  const w = makeWorld();
  const { boss } = gangFounder(w);
  foundGang(w, boss.id, 'The Ash Hands');
  const owner = addCrook(w, 'Pliable', 0.3);   // the city does not read them as one to go to the Watch
  const biz = addBusiness(w, owner.id, 400);
  const before = totalMoney(w);
  const demand = racketDemand(w, biz.id);
  assert.equal(demand, 60, '15% of the till');

  const done = racket(w, boss.id, biz.id);
  assert.equal(done.ok, true);
  assert.equal(biz.treasury, 340);
  assert.equal(boss.wallet, 200 + demand);
  assert.equal(totalMoney(w), before, 'protection money is money moved, not made');
  assert.equal(w.treasury.totals.racket, demand);
  assert.deepEqual(gangOf(w, boss.id)?.rackets, [biz.id]);
  // Extortion left the Code of the City with the two-track reform: a racket is
  // P06, answered by custody in days, and no fine stands in for it.
  assert.ok(boss.recentOffences.some((o) => o.law === 'P06'), 'a racket is extortion whether it is noticed or not');
  assert.ok(w.events.some((e) => e.kind === 'gang' && e.text.includes('paid')));

  const again = racket(w, boss.id, biz.id);
  assert.equal(again.ok, false, 'going back twice in a cycle is how a gang gets caught');
  assert.match(again.message, /already paid/);
});

test('an owner who refuses finds the shopfront wrecked', () => {
  const w = makeWorld();
  const { boss } = gangFounder(w);
  foundGang(w, boss.id, 'The Ash Hands');
  const owner = makeCitizen(w, { name: 'Upright', familyName: 'Upright', district: 'nightglass' });
  owner.character.honesty = 0.9;
  const biz = addBusiness(w, owner.id, 400);
  const before = totalMoney(w);

  const refused = racket(w, boss.id, biz.id);
  assert.equal(refused.ok, true, 'the act happened; it is the money that did not move');
  assert.equal(biz.treasury, 400);
  assert.equal(totalMoney(w), before);
  assert.equal(w.buildings.shopfronts_harbor.damage, 0.25);
  assert.equal(biz.inventory.goods, 5, 'half the shelves');
  assert.equal(biz.inventory.energy, 4);
  assert.ok(owner.memory.some((m) => m.text.includes('wrecked')));
  assert.ok(boss.recentOffences.some((o) => o.law === 'P06'));
});

test('an owner may pay before anybody comes, and that is no offence of theirs', () => {
  const w = makeWorld();
  const { boss } = gangFounder(w);
  foundGang(w, boss.id, 'The Ash Hands');
  const owner = makeCitizen(w, { name: 'Careful', familyName: 'Careful', district: 'nightglass' });
  const biz = addBusiness(w, owner.id, 200);
  const before = totalMoney(w);

  const paid = payRacket(w, owner.id);
  assert.equal(paid.ok, true);
  assert.equal(biz.treasury, 170, '15% of a 200 ℓ till');
  assert.equal(boss.wallet, 230);
  assert.equal(totalMoney(w), before);
  assert.deepEqual(owner.recentOffences, [], 'being leaned on is not a crime you commit');
  assert.ok(owner.bonds[boss.id] > 0);
  assert.equal(payRacket(w, owner.id).ok, false, 'once a cycle');

  const nobody = makeCitizen(w, { district: 'archive' });
  assert.equal(payRacket(w, nobody.id).ok, false, 'no business, nothing to protect');
  const elsewhere = makeCitizen(w, { district: 'archive', familyName: 'Far' });
  addBusiness(w, elsewhere.id, 100, 'archive');
  assert.equal(payRacket(w, elsewhere.id).ok, false, 'no gang calls the Archive its turf');
});

test('the take is split: half to the boss, the rest evenly among the others', () => {
  const w = makeWorld();
  const { boss, friends } = gangFounder(w);
  foundGang(w, boss.id, 'The Ash Hands');
  const g = gangOf(w, boss.id);
  assert.ok(g);
  for (const f of friends) { g.members.push(f.id); f.gangId = g.id; }

  const owner = addCrook(w, 'Pliable', 0.3);
  const biz = addBusiness(w, owner.id, 400);
  racket(w, boss.id, biz.id);
  const take = 60;
  const before = totalMoney(w);

  splitLoot(w);
  const share = Math.floor(Math.floor(take / 2) / friends.length);
  assert.equal(share, 10);
  for (const f of friends) {
    assert.equal(f.wallet, 200 + share);
    assert.ok(f.memory.some((m) => m.text.includes('split the take; your share was')));
  }
  assert.equal(boss.wallet, 200 + take - share * friends.length);
  assert.equal(totalMoney(w), before, 'the split moves money among them and nowhere else');
  assert.equal(w.counters[`take:${g.id}`], undefined, 'the day\'s take is settled');

  splitLoot(w);
  assert.equal(friends[0].wallet, 200 + share, 'nothing to split, nothing paid');
});

test('three convictions in a cycle bust the gang, and its people are their own again', () => {
  const w = makeWorld();
  w.day = 10;
  const { boss, friends } = gangFounder(w);
  foundGang(w, boss.id, 'The Ash Hands');
  const g = gangOf(w, boss.id);
  assert.ok(g);
  for (const f of friends) { g.members.push(f.id); f.gangId = g.id; }

  assert.equal(convictionsThisCycle(w, g), 0);
  assert.equal(bustCheck(w, g), false);
  for (let i = 0; i < BUST_CONVICTIONS; i++) {
    g.members.map((id) => w.citizens[id])[i].record.convictions.push(
      { caseId: `k_${i}`, law: 'P06', severity: 4, tier: null, day: w.day - 1 },
    );
  }
  assert.equal(convictionsThisCycle(w, g), BUST_CONVICTIONS);
  assert.equal(bustCheck(w, g), true);

  dailyGangs(w);
  assert.equal(g.bustedDay, w.day);
  assert.deepEqual(liveGangs(w), []);
  assert.equal(gangsView(w).length, 1, 'the record of it stays');
  for (const id of g.members) assert.equal(w.citizens[id].gangId, null, 'nobody is punished for having been in it');
  assert.equal(gangOf(w, boss.id), null);
  assert.ok(w.events.some((e) => e.kind === 'gang' && e.weight === 0.9));

  dailyGangs(w);
  assert.equal(w.events.filter((e) => e.kind === 'gang' && e.weight === 0.9).length, 1, 'a gang is broken up once');
});

test('a member reported to the Watch is defended, and the defence is itself an offence', () => {
  const w = makeWorld();
  const { boss, friends } = gangFounder(w);
  foundGang(w, boss.id, 'The Ash Hands');
  const g = gangOf(w, boss.id);
  assert.ok(g);
  const enforcer = friends[0];
  g.members.push(enforcer.id);
  enforcer.gangId = g.id;

  const reporter = makeCitizen(w, { name: 'Witness', familyName: 'Witness', district: 'nightglass' });
  enforcer.district = 'nightglass';

  assert.equal(defend(w, boss.id, reporter.id), true);
  // Harassment is P02 now, and leaning on a witness is charged like it.
  assert.ok(enforcer.recentOffences.some((o) => o.law === 'P02'), 'intimidation is harassment, and it is charged like it');
  assert.ok(reporter.hostilityFrom[enforcer.id]?.length);
  assert.ok(reporter.bonds[enforcer.id] < 0);
  assert.ok(reporter.memory.some((m) => m.text.includes('leaned on you')));
  assert.ok(w.events.some((e) => e.kind === 'gang' && e.text.includes('leaned on')));

  assert.equal(defend(w, boss.id, boss.id), false, 'nobody defends against themselves');
  assert.equal(defend(w, boss.id, enforcer.id), false, 'a member reporting a member is a matter inside the gang');
  assert.equal(defend(w, reporter.id, boss.id), false, 'the reporter is in no gang');
  enforcer.district = 'archive';
  assert.equal(defend(w, boss.id, reporter.id), false, 'nobody was there to do it');
});

test('the roll is tidied: exiles, children and departures leave, and the gang passes on', () => {
  const w = makeWorld();
  const { boss, friends } = gangFounder(w);
  foundGang(w, boss.id, 'The Ash Hands');
  const g = gangOf(w, boss.id);
  assert.ok(g);
  for (const f of friends) { g.members.push(f.id); f.gangId = g.id; }

  friends[0].lifeStage = 'child';
  friends[1].standing = 'exiled';
  w.order = w.order.filter((id) => id !== friends[1].id);
  boss.standing = 'exiled';
  w.order = w.order.filter((id) => id !== boss.id);

  dailyGangs(w);
  assert.equal(g.bustedDay, null, 'a gang outlives its boss');
  assert.deepEqual(g.members, [friends[2].id]);
  assert.equal(g.bossId, friends[2].id, 'somebody takes it over');
  assert.equal(friends[0].gangId, null);
  assert.equal(friends[1].gangId, null);
  assert.ok(w.events.some((e) => e.text.includes('took over')));

  friends[2].standing = 'exiled';
  w.order = w.order.filter((id) => id !== friends[2].id);
  dailyGangs(w);
  assert.equal(g.bustedDay, w.day, 'nobody was left in it');
  bustGang(w, g, 'again');
  assert.equal(g.bustedDay, w.day, 'a gang is only broken up once');
});

test('a racket needs a real business in your own district, and a gang behind you', () => {
  const w = makeWorld();
  const lone = addCrook(w, 'Lone');
  const owner = addCrook(w, 'Owner', 0.3);
  const biz = addBusiness(w, owner.id, 200);
  assert.equal(racket(w, lone.id, biz.id).ok, false, 'no gang, no racket');

  const { boss } = gangFounder(w);
  foundGang(w, boss.id, 'The Ash Hands');
  assert.equal(racket(w, boss.id, 'b_nope').ok, false);
  boss.district = 'archive';
  assert.equal(racket(w, boss.id, biz.id).ok, false, 'you lean on what is in front of you');
  boss.district = 'nightglass';

  const ownBiz = addBusiness(w, boss.id, 100);
  assert.equal(racket(w, boss.id, ownBiz.id).ok, false, 'not from yourself');

  biz.dissolvedDay = w.day;
  assert.equal(racket(w, boss.id, biz.id).ok, false, 'a business that closed cannot be leaned on');
  assert.ok(racketDemand(w, 'b_nope') === 0);
  assert.ok(racketDemand(w, ownBiz.id) >= RACKET_MIN);
});

test('a refusal may go to the Watch, and what is reported is the act already done, not a new one', () => {
  const w = makeWorld();
  w.day = 4; w.tick = 4 * 24;
  const { boss } = gangFounder(w);
  foundGang(w, boss.id, 'The Ash Hands');

  // Something the boss got away with, and a neighbour close enough to be asked.
  boss.recentOffences.push({ tick: w.tick - 2, law: 'L04', detected: false, victimId: null, amount: 30 });
  const committed = boss.stats.offencesCommitted;
  const wary = addCrook(w, 'Wary', 0.45);
  wary.bonds[boss.id] = 45; boss.bonds[wary.id] = 45;

  let refusals = 0;
  for (let i = 0; i < 12 && !wary.gangId; i++) {
    const r = recruit(w, boss.id, wary.id);
    if (r.ok && /refused/.test(r.message)) refusals++;
  }
  assert.ok(refusals > 0, 'somebody the city half-trusts says no at least once');

  // The one theft stays one theft: a report is not a second offence.
  assert.equal(boss.recentOffences.filter((o) => o.law === 'L04').length, 1);
  assert.equal(boss.stats.offencesCommitted, committed, 'being reported is not committing anything');

  const reported = boss.recentOffences[0].detected;
  const report = Object.values(w.reports).find((r) => r.suspectId === boss.id && r.law === 'L04');
  if (reported) {
    assert.ok(report, 'what the refuser knew reached the Watch as a report');
    assert.ok(report.evidence >= EVIDENCE_WITNESS_REPORT, 'a witness who was there is worth more than a rumour');
    assert.ok(wary.memory.some((m) => m.text.includes('told the Watch')));
    assert.equal(boss.stats.offencesDetected, 1);
  } else {
    assert.equal(report, undefined);
  }
});
