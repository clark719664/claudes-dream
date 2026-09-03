import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, Job, JobRole, World } from '../src/types.ts';
import { SUSPENDED_ACTIONS } from '../src/types.ts';
import { createCityJobs } from '../src/economy/jobs.ts';
import { availableActions, executeAction, validateAction } from '../src/actions/execute.ts';

function cityJob(world: World, role: JobRole): Job {
  const job = Object.values(world.jobs).find((j) => j.role === role && j.holderId === null);
  if (!job) throw new Error(`no open ${role}`);
  return job;
}

function at(world: World, day: number, hour: number): void {
  world.day = day;
  world.hour = hour;
  world.tick = day * 24 + hour;
}

/** A citizen hired into a city job and standing at the workplace during opening hours. */
function worker(world: World, role: JobRole, overrides: Parameters<typeof makeCitizen>[1] = {}): { c: Citizen; job: Job } {
  createCityJobs(world);
  const job = cityJob(world, role);
  const c = makeCitizen(world, { district: job.district, ...overrides });
  const hired = executeAction(world, c.id, { type: 'apply_job', jobId: job.id });
  assert.equal(hired.ok, true, hired.message);
  at(world, 1, 9);
  return { c, job };
}

test('validateAction is re-exported', () => {
  assert.equal(validateAction({ type: 'idle' }).ok, true);
  assert.equal(validateAction({ type: 'nope' }).ok, false);
});

test('move: adjacent districts only; the action is recorded', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { district: 'commons' });
  const far = executeAction(w, c.id, { type: 'move', district: 'threshold' });
  assert.equal(far.ok, true);
  assert.equal(c.district, 'threshold');
  const notAdjacent = executeAction(w, c.id, { type: 'move', district: 'archive' });
  assert.equal(notAdjacent.ok, false);
  assert.match(notAdjacent.message, /not next to/);
  assert.equal(c.district, 'threshold');
  const same = executeAction(w, c.id, { type: 'move', district: 'threshold' });
  assert.equal(same.ok, false);
  assert.deepEqual(c.recentActions, ['move', 'move', 'move']);
});

test('recentActions is bounded to 24 entries', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  for (let i = 0; i < 30; i++) executeAction(w, c.id, { type: 'idle' });
  assert.equal(c.recentActions.length, 24);
});

test('work: a city job pays a wage, money is conserved, and an adjacent worker walks in first', () => {
  const w = makeWorld();
  const { c, job } = worker(w, 'forge_operator', { wallet: 0 });
  const before = totalMoney(w);
  const r = executeAction(w, c.id, { type: 'work' });
  assert.equal(r.ok, true, r.message);
  assert.ok(c.wallet > 0, 'the worker was paid');
  assert.equal(c.shiftsToday, 1);
  assert.equal(totalMoney(w), before, 'wages move money, never create it');

  c.district = 'commons';
  const walk = executeAction(w, c.id, { type: 'work' });
  assert.equal(walk.ok, true);
  assert.equal(c.district, job.district);
  assert.equal(c.shiftsToday, 1, 'walking there is not a shift');

  at(w, 1, 22);
  const closed = executeAction(w, c.id, { type: 'work' });
  assert.equal(closed.ok, false);
  assert.match(closed.message, /closed/);
});

test('eat buys a compute cycle when the larder is empty; buy and consume conserve money', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 100 });
  c.needs.energy = 30;
  const before = totalMoney(w);
  const ate = executeAction(w, c.id, { type: 'eat' });
  assert.equal(ate.ok, true, ate.message);
  assert.equal(c.needs.energy, 70);
  assert.equal(c.inventory.compute, 0);
  assert.ok(c.wallet < 100);
  assert.equal(totalMoney(w), before);

  const bought = executeAction(w, c.id, { type: 'buy', good: 'goods', qty: 2 });
  assert.equal(bought.ok, true, bought.message);
  assert.equal(c.inventory.goods, 2);
  c.needs.comfort = 50;
  const used = executeAction(w, c.id, { type: 'consume', good: 'goods' });
  assert.equal(used.ok, true);
  assert.equal(c.needs.comfort, 80);
  assert.equal(c.inventory.goods, 1);
  assert.equal(totalMoney(w), before);

  w.market.goods.compute.stock = 0;
  const hungry = makeCitizen(w, { wallet: 100 });
  const none = executeAction(w, hungry.id, { type: 'eat' });
  assert.equal(none.ok, false);
  assert.match(none.message, /no compute/);
});

test('rest needs the Verdant Quarter: home gives +15, the Garden +8', () => {
  const w = makeWorld();
  const housed = makeCitizen(w, { district: 'verdant_quarter', homeTier: 1 });
  const rough = makeCitizen(w, { district: 'verdant_quarter', homeTier: 0 });
  const away = makeCitizen(w, { district: 'commons', homeTier: 1 });
  housed.needs.rest = 50;
  rough.needs.rest = 50;
  assert.equal(executeAction(w, housed.id, { type: 'rest' }).ok, true);
  assert.equal(housed.needs.rest, 65);
  assert.equal(executeAction(w, rough.id, { type: 'rest' }).ok, true);
  assert.equal(rough.needs.rest, 58);
  assert.equal(executeAction(w, away.id, { type: 'rest' }).ok, false);
});

test('socialize raises bonds and social need for both; the other must be here', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { district: 'nightglass' });
  const b = makeCitizen(w, { district: 'nightglass' });
  const far = makeCitizen(w, { district: 'commons' });
  a.needs.social = 40;
  b.needs.social = 40;
  const r = executeAction(w, a.id, { type: 'socialize', with: b.id, text: 'Lovely evening.' });
  assert.equal(r.ok, true, r.message);
  assert.ok((a.bonds[b.id] ?? 0) >= 5);
  assert.ok((b.bonds[a.id] ?? 0) >= 5);
  assert.equal(a.needs.social, 50);
  assert.equal(b.needs.social, 50);
  assert.ok(a.memory.some((m) => m.kind === 'social' && m.text.includes('Lovely evening')));
  assert.ok(w.events.some((e) => e.kind === 'social'));
  assert.equal(executeAction(w, a.id, { type: 'socialize', with: far.id }).ok, false);
  assert.equal(executeAction(w, a.id, { type: 'socialize', with: a.id }).ok, false);
});

test('gift moves lumens, conserves money and warms the bond; message lands in the inbox', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 100 });
  const b = makeCitizen(w, { wallet: 0, district: 'archive' });
  const before = totalMoney(w);
  const r = executeAction(w, a.id, { type: 'gift', to: b.id, amount: 50 });
  assert.equal(r.ok, true, r.message);
  assert.equal(a.wallet, 50);
  assert.equal(b.wallet, 50);
  assert.equal(totalMoney(w), before);
  assert.equal(a.bonds[b.id], 10);
  assert.equal(a.stats.giftsGiven, 1);
  assert.equal(b.stats.giftsReceived, 1);
  assert.equal(executeAction(w, a.id, { type: 'gift', to: b.id, amount: 500 }).ok, false);
  assert.equal(totalMoney(w), before);

  const m = executeAction(w, a.id, { type: 'message', to: b.id, text: 'hello there' });
  assert.equal(m.ok, true);
  assert.equal(b.inbox.length, 1);
  assert.equal(b.inbox[0].text, 'hello there');
  assert.equal(b.inbox[0].from, a.id);
});

test('steal records an offence, moves money without creating it, and can produce a charge', () => {
  const w = makeWorld();
  at(w, 2, 12);
  for (let i = 0; i < 3; i++) {
    const officer = makeCitizen(w, { district: 'harbor_market', office: 'watch' });
    w.government.watch.push(officer.id);
  }
  const thief = makeCitizen(w, { district: 'harbor_market', wallet: 0 });
  const victim = makeCitizen(w, { district: 'harbor_market', wallet: 500 });
  const before = totalMoney(w);
  let detected = false;
  let stolen = false;
  for (let i = 0; i < 40 && !(detected && stolen); i++) {
    const r = executeAction(w, thief.id, { type: 'steal', from: victim.id });
    assert.ok(r.offence === 'L04' || r.offence === 'L08', 'theft is always an offence');
    assert.equal(typeof r.detected, 'boolean');
    if (r.ok) stolen = true;
    if (r.detected) detected = true;
  }
  assert.ok(thief.recentOffences.length > 0);
  assert.ok(thief.recentOffences.every((o) => o.law === 'L04' || o.law === 'L08'));
  assert.equal(thief.stats.offencesCommitted, thief.recentOffences.length);
  assert.equal(totalMoney(w), before, 'theft only moves money');
  assert.equal(thief.wallet + victim.wallet, 500);
  assert.ok(detected, 'three officers catch a serial thief');
  assert.ok(Object.values(w.cases).some((k) => k.defendantId === thief.id), 'a detected theft is charged');
  assert.ok(victim.memory.some((m) => m.text.includes(`(${thief.id})`)), 'the victim knows who did it');
  assert.equal(executeAction(w, thief.id, { type: 'steal', from: thief.id }).ok, false);
});

test('report: a victim naming a thief who got away produces a solid charge', () => {
  const w = makeWorld();
  at(w, 2, 12);
  const thief = makeCitizen(w, { district: 'threshold', wallet: 0 });
  thief.skills.rhetoric = 90;
  const victim = makeCitizen(w, { district: 'threshold', wallet: 300 });
  let quiet = false;
  for (let i = 0; i < 60 && !quiet; i++) {
    const r = executeAction(w, thief.id, { type: 'steal', from: victim.id });
    if (!r.detected) quiet = true;
  }
  assert.ok(quiet, 'with no officers a theft eventually goes unseen');
  const before = totalMoney(w);
  const r = executeAction(w, victim.id, { type: 'report', citizen: thief.id, law: 'L04', text: 'He took my purse.' });
  assert.equal(r.ok, true, r.message);
  const kase = Object.values(w.cases).find((k) => k.defendantId === thief.id && k.filedBy === victim.id);
  assert.ok(kase, 'the report became a case filed by the victim');
  assert.equal(kase.evidence, 0.75);
  assert.equal(totalMoney(w), before);
  assert.equal(executeAction(w, victim.id, { type: 'report', citizen: victim.id, law: 'L04' }).ok, false);
});

test('insults become harassment on the third in a day; nonstop broadcasting becomes spam', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { district: 'commons' });
  const b = makeCitizen(w, { district: 'commons' });
  let last = executeAction(w, a.id, { type: 'insult', target: b.id });
  assert.equal(last.offence, undefined);
  last = executeAction(w, a.id, { type: 'insult', target: b.id });
  last = executeAction(w, a.id, { type: 'insult', target: b.id });
  assert.equal(last.offence, 'L05');
  assert.ok((a.bonds[b.id] ?? 0) <= -45);

  const shouter = makeCitizen(w, { district: 'commons' });
  let spam = executeAction(w, shouter.id, { type: 'broadcast', text: 'Hear me!' });
  for (let i = 0; i < 3; i++) spam = executeAction(w, shouter.id, { type: 'broadcast', text: 'Hear me!' });
  assert.equal(spam.offence, undefined, 'four speeches are free speech');
  spam = executeAction(w, shouter.id, { type: 'broadcast', text: 'Hear me!' });
  assert.equal(spam.offence, 'L02');
});

test('nominate opens with nominations and vote works on election day only, once', () => {
  const w = makeWorld();
  const cand = makeCitizen(w, { reputation: 60, homeTier: 1 });
  const voter = makeCitizen(w, { homeTier: 1 });
  const platform = { tax: 0.3, dividend: 0.7, minWage: 0.6, strictness: 0.5 };
  at(w, 0, 12);
  const early = executeAction(w, voter.id, { type: 'vote', candidate: cand.id });
  assert.equal(early.ok, false);
  const nom = executeAction(w, cand.id, { type: 'nominate', platform });
  assert.equal(nom.ok, true, nom.message);
  assert.ok(w.government.election.candidates.includes(cand.id));
  assert.ok(availableActions(w, cand).includes('campaign'));
  assert.equal(executeAction(w, cand.id, { type: 'campaign', spend: 0 }).ok, true);

  at(w, w.government.election.electionDay, 12);
  const late = executeAction(w, voter.id, { type: 'nominate', platform });
  assert.equal(late.ok, false, 'nominations close on election day');
  assert.ok(availableActions(w, voter).includes('vote'));
  const v1 = executeAction(w, voter.id, { type: 'vote', candidate: cand.id });
  assert.equal(v1.ok, true, v1.message);
  assert.equal(w.government.election.ballots[voter.id], cand.id);
  const v2 = executeAction(w, voter.id, { type: 'vote', candidate: cand.id });
  assert.equal(v2.ok, false);
  assert.equal(v2.offence, undefined, 'a second ballot is refused, not fraud');
  assert.ok(!availableActions(w, voter).includes('vote'));
});

test('a suspended citizen is restricted to SUSPENDED_ACTIONS', () => {
  const w = makeWorld();
  const { c } = worker(w, 'forge_operator');
  c.standing = 'suspended';
  const work = executeAction(w, c.id, { type: 'work' });
  assert.equal(work.ok, false);
  assert.match(work.message, /suspended/);
  assert.equal(executeAction(w, c.id, { type: 'steal', from: c.id }).ok, false);
  assert.equal(executeAction(w, c.id, { type: 'idle' }).ok, true);
  c.district = 'verdant_quarter';
  assert.equal(executeAction(w, c.id, { type: 'rest' }).ok, true);
  const listed = availableActions(w, c);
  assert.ok(listed.length > 0);
  assert.ok(listed.every((a) => SUSPENDED_ACTIONS.includes(a)));
  assert.ok(!listed.includes('work'));
});

test('exiled and detained citizens cannot act; an expired detention is no bar', () => {
  const w = makeWorld();
  const exile = makeCitizen(w, { standing: 'exiled' });
  w.order = w.order.filter((id) => id !== exile.id);
  const r = executeAction(w, exile.id, { type: 'idle' });
  assert.equal(r.ok, false);
  assert.match(r.message, /exiled/);
  assert.deepEqual(availableActions(w, exile), []);
  assert.deepEqual(exile.recentActions, []);

  at(w, 1, 5);
  const held = makeCitizen(w, { detainedUntilTick: w.tick + 5 });
  assert.equal(executeAction(w, held.id, { type: 'idle' }).ok, false);
  assert.deepEqual(availableActions(w, held), []);
  held.detainedUntilTick = w.tick;
  assert.equal(executeAction(w, held.id, { type: 'idle' }).ok, true, 'detention that has run out does not bind');

  assert.equal(executeAction(w, 'c_999', { type: 'idle' }).ok, false);
});

test('availableActions follows standing, job, location and time', () => {
  const w = makeWorld();
  const { c, job } = worker(w, 'performer');
  let list = availableActions(w, c);
  assert.ok(list.includes('work'), 'at the workplace in opening hours');
  assert.ok(list.includes('perform'), 'a performer in Nightglass');
  assert.ok(list.includes('attend_show'));
  assert.ok(list.includes('quit_job'));
  assert.ok(!list.includes('rest'), 'not at home');
  assert.ok(!list.includes('socialize'), 'nobody else here');
  assert.ok(!list.includes('found_business'), 'too poor');
  makeCitizen(w, { district: job.district });
  c.wallet = 400;
  at(w, 1, 20);
  list = availableActions(w, c);
  assert.ok(!list.includes('work'), 'closed for the night');
  assert.ok(list.includes('socialize'));
  assert.ok(list.includes('found_business'));
  c.district = 'verdant_quarter';
  assert.ok(availableActions(w, c).includes('rest'));
});

test('found_business, post_job and hire go through the economy modules and conserve money', () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { wallet: 500, district: 'harbor_market' });
  const hand = makeCitizen(w, { district: 'harbor_market' });
  const before = totalMoney(w);
  const founded = executeAction(w, owner.id, { type: 'found_business', name: 'Tide Couriers', kind: 'courier' });
  assert.equal(founded.ok, true, founded.message);
  assert.ok(owner.businessId);
  assert.equal(totalMoney(w), before);
  const biz = w.businesses[owner.businessId as string];
  const open = biz.jobs.find((id) => w.jobs[id].holderId === null) as string;
  const hired = executeAction(w, owner.id, { type: 'hire', citizen: hand.id, jobId: open });
  assert.equal(hired.ok, true, hired.message);
  assert.equal(hand.jobId, open);
  assert.equal(executeAction(w, hand.id, { type: 'post_job', title: 'Runner', wage: 10, skill: null, minSkill: 0 }).ok, false, 'not the owner');
  const posted = executeAction(w, owner.id, { type: 'post_job', title: 'Runner', wage: 10, skill: null, minSkill: 0 });
  assert.equal(posted.ok, true, posted.message);
  const fired = executeAction(w, owner.id, { type: 'fire', citizen: hand.id });
  assert.equal(fired.ok, true);
  assert.equal(hand.jobId, null);
  assert.equal(totalMoney(w), before);
});

test('vandalize and sabotage damage buildings and are offences', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { district: 'foundry_row' });
  const v = executeAction(w, c.id, { type: 'vandalize', building: 'fabrication_works' });
  assert.equal(v.ok, true);
  assert.equal(v.offence, 'L06');
  assert.equal(w.buildings.fabrication_works.damage, 0.25);
  const s = executeAction(w, c.id, { type: 'sabotage', building: 'compute_forge' });
  assert.equal(s.ok, true);
  assert.equal(s.offence, 'L13');
  assert.equal(w.buildings.compute_forge.damage, 1);
  assert.equal(executeAction(w, c.id, { type: 'sabotage', building: 'fabrication_works' }).ok, false, 'not critical');
  assert.equal(executeAction(w, c.id, { type: 'vandalize', building: 'city_hall' }).ok, false, 'not here');
});
