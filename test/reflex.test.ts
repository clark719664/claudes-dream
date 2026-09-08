import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen } from './helpers.ts';
import { SUSPENDED_ACTIONS } from '../src/types.ts';
import type { Action, BusinessKind, Citizen, World } from '../src/types.ts';
import { isAdjacent } from '../src/data/city.ts';
import { CLUB_MEETING_HOUR } from '../src/data/catalogue.ts';
import { createCityJobs, applyForJob, isQualified } from '../src/economy/jobs.ts';
import { scheduleFestivals } from '../src/society/calendar.ts';
import { scheduleMeetings } from '../src/society/clubs.ts';
import { executeAction } from '../src/actions/execute.ts';
import { buildObservation } from '../src/brains/observe.ts';
import { CHILD_ACTIONS } from '../src/brains/child.ts';
import { reflexBrain, reflexDecide } from '../src/brains/reflex.ts';
import { roomForBusiness } from '../src/brains/reflex-work.ts';
import { BAZAAR_MAX_COVER_DAYS } from '../src/economy/market.ts';

function at(world: World, day: number, hour: number): void {
  world.day = day;
  world.hour = hour;
  world.tick = day * 24 + hour;
}

function decide(world: World, c: Citizen): Action {
  return reflexDecide(world, c, buildObservation(world, c.id));
}

/** A settled citizen: housed, fed, rested, content, so only the situation under test drives the choice. */
function settled(world: World, overrides: Parameters<typeof makeCitizen>[1] = {}): Citizen {
  const c = makeCitizen(world, { homeTier: 1, ...overrides });
  world.housing.occupied[1] += 1;
  return c;
}

test('a hungry citizen eats what it has, or buys a cycle; when the Bazaar is empty it goes to earn, then to the Ward', () => {
  const w = makeWorld();
  at(w, 1, 12);
  const c = settled(w, { wallet: 100, district: 'commons' });
  c.needs.energy = 25;
  assert.deepEqual(decide(w, c), { type: 'eat' });
  const r = executeAction(w, c.id, decide(w, c));
  assert.equal(r.ok, true);
  assert.equal(c.needs.energy, 65);

  c.needs.energy = 25;
  c.inventory.compute = 1;
  assert.deepEqual(decide(w, c), { type: 'eat' });

  c.inventory.compute = 0;
  w.market.goods.compute.stock = 0;
  createCityJobs(w);
  const medic = Object.values(w.jobs).find((j) => j.role === 'medic')!;
  const doctor = makeCitizen(w, { district: 'verdant_quarter' });
  doctor.skills.care = 40;
  applyForJob(w, doctor.id, medic.id);

  // A city with empty shelves needs hands at its posts more than it needs
  // another queue at the Ward: hunger does not outrank the working day.
  const first = decide(w, c);
  assert.equal(first.type, 'apply_job', 'the hungry look for work before they look for alms');

  // With work already in hand and nothing to buy, the Ward it is.
  const post = Object.values(w.jobs).find((j) => j.role === 'librarian')!;
  applyForJob(w, c.id, post.id);
  c.shiftsToday = 99;
  const a = decide(w, c);
  assert.deepEqual(a, { type: 'move', district: 'verdant_quarter' }, 'heads for the Restoration Ward in a shortage');
  c.district = 'verdant_quarter';
  assert.deepEqual(decide(w, c), { type: 'visit_clinic' });
});

test('starving, broke and dishonest with a mark at hand: steal; honest citizens do not', () => {
  const w = makeWorld();
  at(w, 1, 12);
  w.market.goods.compute.stock = 0;
  const mark = makeCitizen(w, { district: 'threshold', wallet: 200 });
  const rogue = settled(w, { district: 'threshold', wallet: 0, personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.2, ambition: 0.5 } });
  rogue.needs.energy = 15;
  assert.deepEqual(decide(w, rogue), { type: 'steal', from: mark.id });
  const saint = settled(w, { district: 'threshold', wallet: 0, personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.9, ambition: 0.5 } });
  saint.needs.energy = 15;
  assert.notEqual(decide(w, saint).type, 'steal');
});

test('an unemployed citizen applies for a job it qualifies for in work hours, then commutes and works', () => {
  const w = makeWorld();
  createCityJobs(w);
  at(w, 1, 9);
  const c = settled(w, { district: 'commons' });
  const a = decide(w, c);
  assert.equal(a.type, 'apply_job');
  const job = w.jobs[(a as { jobId: string }).jobId];
  assert.ok(isQualified(w, c, job), 'only applies where qualified');
  assert.equal(executeAction(w, c.id, a).ok, true);
  assert.equal(c.jobId, job.id);

  for (let guard = 0; guard < 4 && c.district !== job.district; guard++) {
    const step = decide(w, c);
    assert.equal(step.type, 'move', 'walks toward the workplace');
    assert.equal(executeAction(w, c.id, step).ok, true);
  }
  assert.equal(c.district, job.district);
  assert.deepEqual(decide(w, c), { type: 'work' });
  assert.equal(executeAction(w, c.id, { type: 'work' }).ok, true);
  assert.equal(c.shiftsToday, 1);
});

test('travel is one step along a shortest path, and the night is for sleeping at home', () => {
  const w = makeWorld();
  createCityJobs(w);
  at(w, 1, 9);
  const medic = Object.values(w.jobs).find((j) => j.role === 'medic')!;
  const c = settled(w, { district: 'harbor_market' });
  c.skills.care = 40;
  applyForJob(w, c.id, medic.id);
  assert.deepEqual(decide(w, c), { type: 'move', district: 'commons' }, 'Harbor Market to the Verdant Quarter goes through the Commons');

  at(w, 1, 23);
  const sleepy = settled(w, { district: 'foundry_row' });
  sleepy.needs.rest = 50;
  const a = decide(w, sleepy);
  assert.equal(a.type, 'move');
  const via = (a as { district: string }).district;
  assert.ok(isAdjacent('foundry_row', via as never) && isAdjacent(via as never, 'verdant_quarter'), `via ${via}`);
  sleepy.district = 'verdant_quarter';
  assert.deepEqual(decide(w, sleepy), { type: 'rest' });
});

test('a homeless citizen with money moves into the best tier it can afford', () => {
  // Rent now varies by address (docs/PROPERTY.md §2), so the best-affordable
  // tier for a given wallet is not fixed: on seed 42 the cheapest Terraces
  // room (tier 2) lets for 10, comfortably inside a 150-lumen wallet, and
  // tryHousing tries the highest tier down, so it lands there rather than
  // the Lofts.
  const w = makeWorld();
  at(w, 1, 12);
  const c = makeCitizen(w, { homeTier: 0, wallet: 150 });
  assert.deepEqual(decide(w, c), { type: 'move_home', tier: 2 });
});

test('broke, dishonest and miserable with a target present: theft (deterministic per seed)', () => {
  const w = makeWorld();
  at(w, 1, 12);
  const target = makeCitizen(w, { district: 'nightglass', wallet: 150 });
  const rogue = settled(w, { district: 'nightglass', wallet: 10, personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.2, ambition: 0.5 } });
  const a = decide(w, rogue);
  assert.deepEqual(a, { type: 'steal', from: target.id });
  const r = executeAction(w, rogue.id, a);
  assert.ok(r.offence === 'L04' || r.offence === 'L08');
  assert.ok(rogue.recentOffences.length === 1);
});

test('election day: an eligible voter votes for the candidate it prefers; nothing appealing means abstention', () => {
  const w = makeWorld();
  const e = w.government.election;
  at(w, e.electionDay, 12);
  const cand = settled(w, { name: 'Sable', reputation: 70 });
  cand.platform = { tax: 0.4, dividend: 0.8, minWage: 0.8, strictness: 0.5 };
  e.candidates.push(cand.id);
  const voter = settled(w, { wallet: 30 });
  voter.bonds[cand.id] = 30;
  const a = decide(w, voter);
  assert.deepEqual(a, { type: 'vote', candidate: cand.id });
  assert.equal(executeAction(w, voter.id, a).ok, true);
  assert.notEqual(decide(w, voter).type, 'vote', 'one ballot each');

  const crook = settled(w, { name: 'Rook', reputation: 10 });
  crook.platform = { tax: 0.9, dividend: 0.1, minWage: 0.1, strictness: 1 };
  e.candidates = [crook.id];
  const sceptic = settled(w, { wallet: 30 });
  sceptic.bonds[crook.id] = -50;
  sceptic.record.convictions.push({ caseId: 'k_1', law: 'L04', severity: 2, tier: 2, day: 1 });
  const b = decide(w, sceptic);
  assert.notEqual(b.type, 'vote');
  assert.equal(w.counters[`abstain:${sceptic.id}:${e.electionDay}`], 1);
  assert.equal(reflexBrain.kind, 'reflex');
  assert.equal(reflexBrain.decide(w, sceptic, buildObservation(w, sceptic.id)) instanceof Object, true);
});

test('with nominations open, an ambitious reputable citizen stands on a platform of its own', () => {
  const w = makeWorld();
  at(w, 0, 12);
  const c = settled(w, { reputation: 70, personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.5, ambition: 0.9 } });
  let nominated: Action | null = null;
  for (let i = 0; i < 60 && !nominated; i++) {
    const a = decide(w, c);
    if (a.type === 'nominate') nominated = a;
  }
  assert.ok(nominated, 'declares within a few hours of nominations opening');
  const platform = (nominated as Extract<Action, { type: 'nominate' }>).platform;
  for (const v of Object.values(platform)) assert.ok(v >= 0 && v <= 1);
  assert.equal(executeAction(w, c.id, nominated).ok, true);
  assert.ok(w.government.election.candidates.includes(c.id));
  const timid = settled(w, { reputation: 70, personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.5, ambition: 0.2 } });
  for (let i = 0; i < 30; i++) assert.notEqual(decide(w, timid).type, 'nominate');
});

test('detained citizens idle; suspended citizens stay within SUSPENDED_ACTIONS', () => {
  const w = makeWorld();
  at(w, 1, 12);
  const held = settled(w, { detainedUntilTick: w.tick + 3 });
  assert.deepEqual(decide(w, held), { type: 'idle' });
  const banned = settled(w, { standing: 'suspended', district: 'commons', wallet: 5 });
  banned.needs.energy = 10;
  banned.needs.social = 10;
  for (let i = 0; i < 20; i++) {
    const a = decide(w, banned);
    assert.ok(SUSPENDED_ACTIONS.includes(a.type), `${a.type} is not allowed while suspended`);
    executeAction(w, banned.id, a);
  }
});

test('a suspended citizen with nowhere to sleep still looks for a roof', () => {
  const w = makeWorld();
  at(w, 1, 20);
  const banned = settled(w, { standing: 'suspended', district: 'commons', wallet: 200 });
  banned.homeTier = 0;
  banned.homeBuildingId = null;
  // A suspension takes work, trade, the vote and office; it does not evict
  // anybody (`docs/PROPERTY.md` §3), so the restricted ladder still reaches
  // for a room while there is one standing empty.
  let sought: Action | null = null;
  for (let i = 0; i < 20 && !sought; i++) {
    const a = decide(w, banned);
    if (a.type === 'move_home') sought = a;
    else executeAction(w, banned.id, a);
  }
  assert.ok(sought, 'a suspended citizen slept in the street beside an empty room');
  assert.equal(executeAction(w, banned.id, sought as Action).ok, true);
  assert.ok(banned.homeTier > 0);
});

test('a lonely citizen seeks company, and the same seed replays the same choices', () => {
  const w = makeWorld();
  at(w, 1, 19);
  const other = settled(w, { district: 'nightglass' });
  const c = settled(w, { district: 'nightglass' });
  c.needs.social = 20;
  const a = decide(w, c);
  assert.equal(a.type, 'socialize');
  assert.equal((a as { with: string }).with, other.id);

  const run = () => {
    const world = makeWorld({ seed: 11 });
    createCityJobs(world);
    at(world, 1, 8);
    const ids = [makeCitizen(world, { district: 'commons' }).id, makeCitizen(world, { district: 'commons' }).id];
    const trail: string[] = [];
    for (let t = 0; t < 30; t++) {
      for (const id of ids) {
        const action = decide(world, world.citizens[id]);
        trail.push(action.type);
        executeAction(world, id, action);
      }
      at(world, 1, 8 + (t % 14));
    }
    return trail.join(',');
  };
  assert.equal(run(), run());
});

// ---------------------------------------------------------------------------
// The social layer
// ---------------------------------------------------------------------------

/** Decide up to `tries` times, one day apart, and return the first action of this type. */
function decideUntil(world: World, c: Citizen, type: Action['type'], tries = 10): Action | null {
  for (let i = 0; i < tries; i++) {
    const a = decide(world, c);
    if (a.type === type) return a;
    at(world, world.day + 1, world.hour);
  }
  return null;
}

test('nobody works on Stillday but the Watch, the Ward, the kitchens and the stage', () => {
  const w = makeWorld();
  createCityJobs(w);
  const forge = Object.values(w.jobs).find((j) => j.role === 'forge_operator')!;
  const medicJob = Object.values(w.jobs).find((j) => j.role === 'medic')!;
  at(w, 5, 10);
  const smith = settled(w, { district: forge.district, wallet: 200 });
  smith.skills[forge.skill ?? 'crafting'] = 80;
  applyForJob(w, smith.id, forge.id);
  assert.deepEqual(decide(w, smith), { type: 'work' }, 'an ordinary working day');

  at(w, 6, 10); // day 6 of the week is Stillday
  assert.notEqual(decide(w, smith).type, 'work', 'the forge is shut');

  const medic = settled(w, { district: medicJob.district, wallet: 200 });
  medic.skills.care = 80;
  applyForJob(w, medic.id, medicJob.id);
  assert.deepEqual(decide(w, medic), { type: 'work' }, 'the Restoration Ward never closes');
});

test('a citizen joins what is happening in the district and walks to it when it is elsewhere', () => {
  const w = makeWorld();
  at(w, 4, 20);
  const c = settled(w, { district: 'nightglass', wallet: 200 });
  scheduleFestivals(w);
  w.happenings.push({
    id: 'e_9', kind: 'festival', day: 4, hour: 20, district: 'nightglass', buildingId: 'sound_garden',
    who: [], clubId: null, label: 'Lantern Night at The Sound Garden', done: false, attendees: [],
  });
  assert.deepEqual(decide(w, c), { type: 'celebrate' });

  // An hour earlier, one district away: the walk is how you are there for it.
  at(w, 4, 19);
  const far = settled(w, { district: 'verdant_quarter', wallet: 200 });
  far.personality.sociability = 0.9;
  far.needs.social = 30;
  assert.deepEqual(decide(w, far), { type: 'move', district: 'nightglass' }, 'one district away, one hour before');
});

test('a citizen with money to spare buys what it has been wanting off the shelf here', () => {
  const w = makeWorld();
  at(w, 3, 19);
  const c = settled(w, { district: 'harbor_market', wallet: 600 });
  c.wants = ['tin_whistle'];
  const action = decideUntil(w, c, 'buy_item', 4);
  assert.deepEqual(action, { type: 'buy_item', productId: 'tin_whistle' });

  const poor = settled(w, { district: 'harbor_market', wallet: 40 });
  poor.wants = ['glass_harp'];
  assert.equal(decideUntil(w, poor, 'buy_item', 3), null, 'not on this purse');
});

test('courting: an evening out, then a proposal, then a wedding', () => {
  const w = makeWorld();
  at(w, 12, 19);
  const a = settled(w, { district: 'verdant_quarter', wallet: 300, name: 'Ondine' });
  const b = settled(w, { district: 'verdant_quarter', wallet: 300, name: 'Bram' });
  a.personality.sociability = 0.9;
  b.personality.sociability = 0.9;
  a.bonds[b.id] = 70;
  b.bonds[a.id] = 70;
  a.affection[b.id] = 40;
  b.affection[a.id] = 40;
  const outing = decideUntil(w, a, 'date', 8);
  assert.ok(outing, 'the Community Garden is a free evening out');
  assert.deepEqual(outing, { type: 'date', with: b.id });

  b.affection[a.id] = 75;
  const proposal = decideUntil(w, a, 'propose_partnership', 8);
  assert.deepEqual(proposal, { type: 'propose_partnership', to: b.id });
  assert.equal(executeAction(w, a.id, proposal).ok, true);

  a.family.partnerSinceDay = w.day - 8;
  b.family.partnerSinceDay = w.day - 8;
  a.bonds[b.id] = 90;
  b.bonds[a.id] = 90;
  const wedding = decideUntil(w, a, 'marry', 4);
  assert.deepEqual(wedding, { type: 'marry', to: b.id });
  assert.equal(executeAction(w, a.id, wedding).ok, true);
  assert.equal(decideUntil(w, a, 'marry', 2), null, 'the wedding is already arranged');
});

test('clubs: a citizen joins one for a hobby it loves, then goes to the meeting', () => {
  const w = makeWorld();
  at(w, 3, 12);
  const founder = settled(w, { district: 'commons', wallet: 300, name: 'Alder' });
  founder.tastes = { hobbies: ['games', 'reading'], favouriteDistrict: 'commons', favouriteGood: 'culture', categories: ['game'] };
  const club = { id: 'u_1', name: 'Halflight Chess Circle', hobby: 'games' as const, founderId: founder.id, convenorId: founder.id, members: [founder.id], foundedDay: 0, meetsOnWeekday: 3 };
  w.clubs[club.id] = club;
  founder.clubs.push(club.id);
  const joiner = settled(w, { district: 'commons', wallet: 300, name: 'Wick' });
  joiner.tastes = { hobbies: ['games', 'running'], favouriteDistrict: 'commons', favouriteGood: 'culture', categories: ['game'] };
  assert.deepEqual(decide(w, joiner), { type: 'join_club', clubId: club.id });
  assert.equal(executeAction(w, joiner.id, { type: 'join_club', clubId: club.id }).ok, true);

  at(w, 10, CLUB_MEETING_HOUR);
  scheduleMeetings(w);
  const meeting = w.happenings.find((h) => h.kind === 'club_meeting')!;
  joiner.district = meeting.district;
  assert.deepEqual(decide(w, joiner), { type: 'attend_club', clubId: club.id });
  joiner.district = 'foundry_row';
  const walk = decide(w, joiner);
  assert.equal(walk.type, 'move', 'otherwise it sets off for the venue');
});

test('an honest citizen with a full purse gives to the Community Chest', () => {
  const w = makeWorld();
  at(w, 3, 21);
  const c = settled(w, { district: 'commons', wallet: 2000 });
  c.personality.honesty = 0.9;
  const gift = decideUntil(w, c, 'donate', 40);
  assert.ok(gift && gift.type === 'donate' && gift.amount >= 20, 'a share of what it can spare');
});

test('children think with the child policy and never take a grown citizen action', () => {
  const w = makeWorld();
  at(w, 6, 19);
  const parent = settled(w, { district: 'verdant_quarter', wallet: 200, name: 'Noor' });
  const child = makeCitizen(w, { district: 'verdant_quarter', lifeStage: 'child', name: 'Sprig', wallet: 10, bornDay: 2 });
  child.family.parents = [parent.id];
  parent.family.children = [child.id];
  for (let i = 0; i < 24; i++) {
    const a = decide(w, child);
    assert.ok(CHILD_ACTIONS.includes(a.type), `a child would not ${a.type}`);
    at(w, w.day, (w.hour + 1) % 24);
  }
});

test('a founder opens shop while the Bazaar still buys what they would make, and not once its shelves are full', () => {
  const w = makeWorld();
  for (let i = 0; i < 40; i++) makeCitizen(w);
  const goods = w.market.goods.goods;

  // a shelf the Bazaar is still filling: there is a market to sell into
  w.counters['flow:demand:goods'] = 2;          // 48 crates a day
  goods.stock = 24;                             // half a day of cover
  assert.equal(roomForBusiness(w, 'workshop'), true);

  // the Bazaar has stopped buying: a new maker would only pile up stock
  goods.stock = 48 * (BAZAAR_MAX_COVER_DAYS + 1);
  assert.equal(roomForBusiness(w, 'workshop'), false);

  // room is also a matter of how many people there are to serve
  goods.stock = 24;
  const owner = makeCitizen(w);
  const kinds: BusinessKind[] = ['workshop', 'workshop'];
  kinds.forEach((kind, i) => {
    w.businesses[`b_${i}`] = {
      id: `b_${i}`, name: `Works ${i}`, kind, ownerId: owner.id, treasury: 100, district: 'harbor_market',
      buildingId: 'shopfronts_harbor', employees: [], jobs: [],
      inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
      foundedDay: 0, rentPerDay: 12, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
    };
  });
  assert.equal(roomForBusiness(w, 'workshop'), false, 'two workshops already serve a city of forty');
  assert.equal(roomForBusiness(w, 'clinic'), true, 'a clinic is a different trade');
});
