/**
 * The Museum (src/culture/museum.ts).
 *
 * What the city keeps, what it pays for it, what it does when the purse is
 * empty, and what an hour among the collection is worth.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, Job, Work, World } from '../src/types.ts';
import { MASTERPIECE_QUALITY } from '../src/data/metropolis.ts';
import { MUSEUM_PRICE } from '../src/data/jobs.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  ACQUISITION_REPUTATION, VALUE_PER_QUALITY, VISIT_PURPOSE, VISIT_SOCIAL,
  acquire, collection, curatorOnDuty, dailyMuseum, inCollection, museumValue, visitMuseum,
} from '../src/culture/museum.ts';

/** A work on the books, without going through the whole of works.ts. */
function makeWork(world: World, creator: Citizen | null, over: Partial<Work> = {}): Work {
  const id = `w_${Object.keys(world.works).length + 1}`;
  const work: Work = {
    id, kind: 'painting', title: `Work ${id}`, creatorId: creator?.id ?? 'c_gone', createdDay: world.day,
    quality: MASTERPIECE_QUALITY, popularity: 0, home: 'gallery_of_echoes', inMuseum: false, reviews: [],
    ...over,
  };
  world.works[id] = work;
  if (creator) creator.works.push(id);
  return work;
}

function makeCurator(world: World, over: Record<string, unknown> = {}): Citizen {
  const c = makeCitizen(world, { name: 'Cura', district: 'archive', ...over });
  const job: Job = {
    id: `j_${Object.keys(world.jobs).length + 1}`, role: 'curator', title: 'Curator', employer: 'city',
    buildingId: 'museum', district: 'archive', skill: 'artistry', minSkill: 0, minReputation: 0,
    wage: 13, output: {}, holderId: c.id, createdDay: world.day,
  };
  world.jobs[job.id] = job;
  c.jobId = job.id;
  return c;
}

// --------------------------------------------------------------- acquisition

test('only a masterpiece is acquired, and the maker is paid from the public purse', () => {
  const w = makeWorld();
  const maker = makeCitizen(w, { name: 'Ondine', reputation: 40 });
  const ordinary = makeWork(w, maker, { quality: MASTERPIECE_QUALITY - 1, title: 'Near Enough' });
  const great = makeWork(w, maker, { quality: MASTERPIECE_QUALITY, title: 'The Long Quay' });

  assert.equal(acquire(w, ordinary.id), false);
  assert.equal(ordinary.inMuseum, false);
  assert.deepEqual(w.museum, []);

  const before = totalMoney(w);
  const wallet = maker.wallet;
  const treasury = w.treasury.balance;
  assert.equal(acquire(w, great.id), true);
  assert.equal(great.inMuseum, true);
  assert.equal(great.home, 'museum');
  assert.deepEqual(w.museum, [great.id]);
  assert.equal(maker.wallet, wallet + MUSEUM_PRICE);
  assert.equal(w.treasury.balance, treasury - MUSEUM_PRICE);
  assert.equal(totalMoney(w), before, 'an acquisition moves money; it does not make any');
  assert.equal(maker.reputation, 40 + ACQUISITION_REPUTATION);
  assert.ok(maker.milestones.some((m) => m.text.includes('The Long Quay')));
  assert.ok(w.events.some((e) => e.kind === 'museum' && e.text.includes('The Long Quay')));
});

test('the same painting is never bought twice', () => {
  const w = makeWorld();
  const maker = makeCitizen(w);
  const work = makeWork(w, maker);
  assert.equal(acquire(w, work.id), true);
  const wallet = maker.wallet;
  assert.equal(acquire(w, work.id), false);
  assert.equal(maker.wallet, wallet);
  assert.equal(collection(w).length, 1);
});

test('an empty Treasury declines quietly, and buys the same work the day it can', () => {
  const w = makeWorld();
  const maker = makeCitizen(w);
  const work = makeWork(w, maker);
  w.treasury.balance = MUSEUM_PRICE - 1;
  const before = totalMoney(w);

  assert.equal(acquire(w, work.id), false, 'no error, no purchase');
  assert.equal(work.inMuseum, false);
  assert.equal(totalMoney(w), before);
  assert.equal(w.events.filter((e) => e.kind === 'museum').length, 0);

  w.treasury.balance = MUSEUM_PRICE;
  assert.equal(acquire(w, work.id), true);
  assert.equal(w.treasury.balance, 0);
});

test('a work whose maker has left the city is still kept, and nobody is paid', () => {
  const w = makeWorld();
  const maker = makeCitizen(w, { name: 'Gone' });
  const work = makeWork(w, maker);
  maker.standing = 'exiled';
  w.order = w.order.filter((id) => id !== maker.id);
  const before = totalMoney(w);

  assert.equal(acquire(w, work.id), true);
  assert.equal(totalMoney(w), before, 'nothing moved');
  assert.equal(inCollection(w, work.id), true);
  assert.equal(work.inMuseum, true);
});

test('a work whose maker was never in the registry is handled without a crash', () => {
  const w = makeWorld();
  const orphan = makeWork(w, null);
  assert.equal(acquire(w, orphan.id), true);
  assert.equal(collection(w).length, 1);
  assert.equal(acquire(w, 'w_nowhere'), false);
});

test('the collection is what the city kept, in the order it kept it', () => {
  const w = makeWorld();
  const maker = makeCitizen(w);
  const a = makeWork(w, maker, { title: 'First' });
  const b = makeWork(w, maker, { title: 'Second' });
  acquire(w, b.id);
  acquire(w, a.id);
  assert.deepEqual(collection(w).map((x) => x.title), ['Second', 'First']);
  assert.equal(museumValue(w), (a.quality + b.quality) * VALUE_PER_QUALITY);
  assert.equal(museumValue(makeWorld()), 0);
});

test('the collection survives a save and a load, and the daily pass tidies stale ids', () => {
  const w = makeWorld();
  const maker = makeCitizen(w);
  const work = makeWork(w, maker);
  acquire(w, work.id);

  const reloaded: World = JSON.parse(JSON.stringify(w));
  assert.deepEqual(collection(reloaded).map((x) => x.title), [work.title]);
  assert.equal(museumValue(reloaded), work.quality * VALUE_PER_QUALITY);

  reloaded.museum.push('w_never', work.id);      // a lost id and a duplicate
  const stray = makeWork(reloaded, null, { title: 'Not Ours' });
  stray.inMuseum = true;
  dailyMuseum(reloaded);
  assert.deepEqual(reloaded.museum, [work.id]);
  assert.equal(stray.inMuseum, false, 'a work the city never bought is not in the collection');
});

// ------------------------------------------------------------------ visiting

test('the doors are free, and only open in the Archive', () => {
  const w = makeWorld();
  const maker = makeCitizen(w);
  acquire(w, makeWork(w, maker).id);
  const visitor = makeCitizen(w, {
    district: 'commons', needs: { energy: 50, rest: 50, social: 50, comfort: 50, purpose: 50 },
  });

  const away = visitMuseum(w, visitor.id);
  assert.equal(away.ok, false);
  assert.match(away.message, /Archive/);

  visitor.district = 'archive';
  const before = totalMoney(w);
  const res = visitMuseum(w, visitor.id);
  assert.equal(res.ok, true, res.message);
  assert.equal(totalMoney(w), before, 'the collection belongs to the city');
  assert.equal(visitor.needs.social, 50 + VISIT_SOCIAL);
  assert.equal(visitor.needs.purpose, 50 + VISIT_PURPOSE);
});

test('a thin hour without culture on the shelves, a better one with the curator in', () => {
  const w = makeWorld();
  w.market.goods.culture.stock = 0;
  const thin = makeCitizen(w, { district: 'archive', needs: { energy: 50, rest: 50, social: 0, comfort: 50, purpose: 50 } });
  assert.equal(visitMuseum(w, thin.id).ok, true);
  assert.equal(thin.needs.social, Math.round(VISIT_SOCIAL / 2));

  const other = makeWorld();
  other.market.goods.culture.stock = 10;
  assert.equal(curatorOnDuty(other), false);
  const curator = makeCurator(other);
  assert.equal(curatorOnDuty(other), true);
  const guest = makeCitizen(other, { district: 'archive', needs: { energy: 50, rest: 50, social: 0, comfort: 50, purpose: 50 } });
  assert.equal(visitMuseum(other, guest.id).ok, true);
  assert.equal(guest.needs.social, Math.round(VISIT_SOCIAL * 1.2));

  curator.jailedUntilDay = other.day + 2;
  assert.equal(curatorOnDuty(other), false, 'a curator in the cells is not at their desk');
});

test('an empty museum, a damaged one and an unknown visitor are refusals, not crashes', () => {
  const w = makeWorld();
  const visitor = makeCitizen(w, { district: 'archive' });
  const res = visitMuseum(w, visitor.id);
  assert.equal(res.ok, true, 'the empty halls are still open');
  assert.match(res.message, /0 works/);

  w.buildings.museum.damage = 1;
  assert.equal(visitMuseum(w, visitor.id).ok, false);
  assert.equal(visitMuseum(w, 'c_999').ok, false);

  visitor.detainedUntilTick = w.tick + 5;
  w.buildings.museum.damage = 0;
  assert.equal(visitMuseum(w, visitor.id).ok, false);
});
