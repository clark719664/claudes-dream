/**
 * Works (src/culture/works.ts).
 *
 * Who may make one and where, how quality is settled and that it never moves,
 * what showing and reviewing do to it, and that a work outlives the person who
 * made it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, Job, Work, World } from '../src/types.ts';
import { MASTERPIECE_QUALITY } from '../src/data/metropolis.ts';
import { MUSEUM_PRICE } from '../src/data/jobs.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  AMATEUR_SKILL, EXHIBIT_CULTURE, MAX_POPULARITY, REVIEW_REPUTATION, WORK_PURPOSE,
  allWorks, bindStory, createWork, dailyWorks, exhibit, mayCreate, review, reviewScore,
  topWorks, venueFor, worksIn, worksObservation, worksOf,
} from '../src/culture/works.ts';

/** Put a citizen behind a desk: the post is what a work of some kinds needs. */
function giveJob(world: World, c: Citizen, role: Job['role'], buildingId: string): Job {
  const job: Job = {
    id: `j_${Object.keys(world.jobs).length + 1}`, role, title: role, employer: 'city',
    buildingId, district: world.buildings[buildingId].district, skill: null, minSkill: 0,
    minReputation: 0, wage: 10, output: {}, holderId: c.id, createdDay: world.day,
  };
  world.jobs[job.id] = job;
  c.jobId = job.id;
  return job;
}

function painter(world: World, over: Record<string, unknown> = {}): Citizen {
  return makeCitizen(world, {
    name: 'Ondine', district: 'nightglass',
    skills: { crafting: 20, analysis: 20, rhetoric: 20, care: 20, commerce: 20, artistry: 60 },
    ...over,
  });
}

// ------------------------------------------------------------------- making

test('a citizen without the post or the craft cannot make a work', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { district: 'nightglass' }); // artistry 20, no post
  assert.equal(mayCreate(w, c, 'painting'), false);
  const res = createWork(w, c.id, 'painting', 'Low Tide');
  assert.equal(res.ok, false);
  assert.match(res.message, new RegExp(String(AMATEUR_SKILL)));
  assert.equal(allWorks(w).length, 0);
});

test('the post is enough on its own, and the craft is enough without the post', () => {
  const w = makeWorld();
  const posted = makeCitizen(w, { district: 'nightglass' });
  giveJob(w, posted, 'artist', 'gallery_of_echoes');
  assert.equal(mayCreate(w, posted, 'painting'), true);

  const skilled = painter(w);
  assert.equal(mayCreate(w, skilled, 'painting'), true);
  // ...but the craft for one kind is not the craft for another
  assert.equal(mayCreate(w, skilled, 'paper'), false);
});

test('a child, an exile and a citizen in the cells make nothing', () => {
  const w = makeWorld();
  const child = painter(w, { lifeStage: 'child' });
  assert.equal(mayCreate(w, child, 'painting'), false);

  const exile = painter(w, { standing: 'exiled' });
  w.order = w.order.filter((id) => id !== exile.id);
  assert.equal(mayCreate(w, exile, 'painting'), false);

  const jailed = painter(w, { jailedUntilDay: 5 });
  w.day = 2;
  assert.equal(mayCreate(w, jailed, 'painting'), false);
  assert.equal(createWork(w, jailed.id, 'painting', 'Cell Window').ok, false);
});

test('a work needs a venue for its kind in the district you stand in', () => {
  const w = makeWorld();
  const c = painter(w, { district: 'foundry_row' });
  assert.equal(venueFor(w, 'painting', 'foundry_row'), null);
  const res = createWork(w, c.id, 'painting', 'Hammer Light');
  assert.equal(res.ok, false);
  assert.match(res.message, /nowhere/);

  c.district = 'nightglass';
  assert.ok(venueFor(w, 'painting', 'nightglass'));
  assert.equal(createWork(w, c.id, 'painting', 'Hammer Light').ok, true);
});

test('a work needs a title, and a long one is cut to size', () => {
  const w = makeWorld();
  const c = painter(w);
  assert.equal(createWork(w, c.id, 'painting', '   ').ok, false);
  assert.equal(createWork(w, c.id, 'painting', 'x'.repeat(500)).ok, true);
  assert.equal(worksOf(w, c.id)[0].title.length, 80);
});

test('quality is 1..100, deterministic for a seed, and never moves again', () => {
  const first = makeWorld({ seed: 5 });
  const a = painter(first);
  assert.equal(createWork(first, a.id, 'painting', 'Slack Water').ok, true);
  const second = makeWorld({ seed: 5 });
  const b = painter(second);
  assert.equal(createWork(second, b.id, 'painting', 'Slack Water').ok, true);

  const one = worksOf(first, a.id)[0];
  const two = worksOf(second, b.id)[0];
  assert.equal(one.quality, two.quality);
  assert.ok(one.quality >= 1 && one.quality <= 100, `quality ${one.quality}`);

  const was = one.quality;
  exhibit(first, a.id, one.id);
  dailyWorks(first);
  assert.equal(one.quality, was, 'the day cannot make a painting better');
});

test('making a work costs a unit of the stuff it is made of, and never buys any', () => {
  const w = makeWorld();
  const c = painter(w, { inventory: { compute: 0, energy: 0, goods: 0, culture: 2, knowledge: 0 } });
  const before = totalMoney(w);
  assert.equal(createWork(w, c.id, 'painting', 'Two Lanterns').ok, true);
  assert.equal(c.inventory.culture, 1);
  assert.equal(totalMoney(w), before, 'a painting is not bought');

  const empty = painter(w, { name: 'Bram' });
  assert.equal(empty.inventory.culture, 0);
  assert.equal(createWork(w, empty.id, 'painting', 'Nothing To Hand').ok, true, 'an empty-handed maker still makes');
});

test('a first work is a milestone, and it lands in the maker and in the city', () => {
  const w = makeWorld();
  const c = painter(w, { needs: { energy: 50, rest: 50, social: 50, comfort: 50, purpose: 50 } });
  assert.equal(createWork(w, c.id, 'painting', 'First Light').ok, true);
  assert.equal(c.works.length, 1);
  assert.ok(c.needs.purpose >= 50 + WORK_PURPOSE);
  assert.equal(c.milestones.length, 1);
  assert.ok(w.events.some((e) => e.kind === 'milestone' && e.text.includes('first work')));
  assert.ok(w.events.some((e) => e.kind === 'work' && e.text.includes('First Light')));

  assert.equal(createWork(w, c.id, 'painting', 'Second Light').ok, true);
  assert.equal(c.milestones.length, 1, 'only the first is a landmark');
});

// ---------------------------------------------------------------- exhibiting

test('exhibiting raises popularity, delivers culture, and lifts everyone in the room', () => {
  const w = makeWorld();
  const c = painter(w);
  const onlooker = makeCitizen(w, { name: 'Ivo', district: 'nightglass', needs: { energy: 50, rest: 50, social: 50, comfort: 50, purpose: 50 } });
  const elsewhere = makeCitizen(w, { name: 'Far', district: 'commons', needs: { energy: 50, rest: 50, social: 50, comfort: 50, purpose: 50 } });
  createWork(w, c.id, 'painting', 'Slack Water');
  const work = worksOf(w, c.id)[0];
  const stock = w.market.goods.culture.stock;

  const res = exhibit(w, c.id, work.id);
  assert.equal(res.ok, true, res.message);
  assert.ok(work.popularity > 0);
  assert.equal(w.market.goods.culture.stock, stock + EXHIBIT_CULTURE);
  assert.equal(onlooker.needs.social, 58);
  assert.equal(elsewhere.needs.social, 50, 'the other side of town saw nothing');
});

test('only the maker or a curator shows a work, and only where it can hang', () => {
  const w = makeWorld();
  const c = painter(w);
  createWork(w, c.id, 'painting', 'Slack Water');
  const work = worksOf(w, c.id)[0];

  const stranger = makeCitizen(w, { name: 'Nobody', district: 'nightglass' });
  assert.equal(exhibit(w, stranger.id, work.id).ok, false);

  const curator = makeCitizen(w, { name: 'Curator', district: 'nightglass' });
  giveJob(w, curator, 'curator', 'museum');
  assert.equal(exhibit(w, curator.id, work.id).ok, true);

  c.district = 'foundry_row';
  assert.equal(exhibit(w, c.id, work.id).ok, false, 'a foundry is no gallery');
  assert.equal(exhibit(w, c.id, 'w_999').ok, false);
});

// ----------------------------------------------------------------- reviewing

test('a journalist moves popularity and reputation, and each paper says it once', () => {
  const w = makeWorld();
  const maker = painter(w, { reputation: 50 });
  createWork(w, maker.id, 'painting', 'Slack Water');
  const work = worksOf(w, maker.id)[0];

  const hack = makeCitizen(w, { name: 'Quill', district: 'archive' });
  giveJob(w, hack, 'journalist', 'chronicle');
  const popularity = work.popularity;

  const kind = review(w, hack.id, work.id, 90);
  assert.equal(kind.ok, true, kind.message);
  assert.equal(work.reviews.length, 1);
  assert.equal(work.reviews[0].paper, 'chronicle');
  assert.equal(maker.reputation, 50 + REVIEW_REPUTATION);
  assert.ok(work.popularity > popularity);
  assert.equal(reviewScore(work), 90);

  assert.equal(review(w, hack.id, work.id, 10).ok, false, 'one review per paper');

  const ledgerHack = makeCitizen(w, { name: 'Ledger', district: 'harbor_market' });
  giveJob(w, ledgerHack, 'journalist', 'harbor_ledger');
  const cruel = review(w, ledgerHack.id, work.id, 10);
  assert.equal(cruel.ok, true, cruel.message);
  assert.equal(work.reviews[1].paper, 'ledger');
  assert.equal(maker.reputation, 50, 'the second paper took back what the first gave');
});

test('nobody but a journalist reviews, and a score outside 0..100 is refused', () => {
  const w = makeWorld();
  const maker = painter(w);
  createWork(w, maker.id, 'painting', 'Slack Water');
  const work = worksOf(w, maker.id)[0];
  assert.equal(review(w, maker.id, work.id, 100).ok, false);

  const hack = makeCitizen(w, { district: 'archive' });
  giveJob(w, hack, 'journalist', 'chronicle');
  assert.equal(review(w, hack.id, work.id, Number.NaN).ok, false);
  assert.equal(review(w, hack.id, work.id, 200).ok, true, 'a wild score is clamped, not thrown');
  assert.equal(work.reviews[0].score, 100);
});

// --------------------------------------------------------------- the day, and after

test('popularity fades but never goes negative, and fame slows the fading', () => {
  const w = makeWorld();
  const unknown = painter(w, { name: 'Unknown', reputation: 0 });
  const famous = painter(w, { name: 'Famous', reputation: 100 });
  createWork(w, unknown.id, 'painting', 'Quiet');
  createWork(w, famous.id, 'painting', 'Loud');
  const quiet = worksOf(w, unknown.id)[0];
  const loud = worksOf(w, famous.id)[0];
  quiet.popularity = 3;
  loud.popularity = 3;

  for (let i = 0; i < 10; i++) dailyWorks(w);
  assert.equal(quiet.popularity, 0, 'attention runs out');
  assert.ok(loud.popularity > quiet.popularity, 'a famous name keeps a work in the city’s mouth');
  assert.ok(loud.popularity <= MAX_POPULARITY);
});

test('a masterpiece is offered to the Museum by the daily pass', () => {
  const w = makeWorld();
  const maker = painter(w);
  createWork(w, maker.id, 'painting', 'The Long Quay');
  const work = worksOf(w, maker.id)[0];
  work.quality = MASTERPIECE_QUALITY;
  const before = totalMoney(w);
  const wallet = maker.wallet;

  dailyWorks(w);
  assert.equal(work.inMuseum, true);
  assert.deepEqual(w.museum, [work.id]);
  assert.equal(maker.wallet, wallet + MUSEUM_PRICE);
  assert.equal(totalMoney(w), before, 'the Museum buys with the city’s money, it does not make any');

  dailyWorks(w);
  assert.deepEqual(w.museum, [work.id], 'the city does not buy the same painting twice');
});

test('a work survives its maker: the record stays with their name on it', () => {
  const w = makeWorld();
  const maker = painter(w, { name: 'Ondine' });
  createWork(w, maker.id, 'painting', 'Slack Water');
  const work = worksOf(w, maker.id)[0];

  maker.standing = 'exiled';
  w.order = w.order.filter((id) => id !== maker.id);
  dailyWorks(w);

  assert.equal(allWorks(w).length, 1);
  assert.equal(work.creatorId, maker.id);
  assert.equal(worksIn(w, 'nightglass').length, 1, 'it still hangs where it hung');
  const seen = worksObservation(w, makeCitizen(w, { district: 'nightglass' }));
  assert.equal(seen.here[0].creator, 'Ondine');
});

test('bindStory leaves a book in the Library for a life, whatever else is lost', () => {
  const w = makeWorld();
  const c = painter(w, { reputation: 80 });
  const book = bindStory(w, c, 'Ondine Ashgrove arrived on day 0 and never left the quay.');
  assert.equal(book.kind, 'book');
  assert.equal(book.home, 'great_library');
  assert.equal(book.creatorId, c.id);
  assert.equal(book.quality, 80);
  assert.ok(c.works.includes(book.id));
  assert.equal(worksIn(w, 'archive').length, 1);
});

test('the top of the shelf is popularity, then quality, then the older work', () => {
  const w = makeWorld();
  const c = painter(w);
  for (const t of ['A', 'B', 'C']) createWork(w, c.id, 'painting', t);
  const [a, b, cc] = worksOf(w, c.id);
  a.popularity = 5; a.quality = 10;
  b.popularity = 9; b.quality = 10;
  cc.popularity = 5; cc.quality = 90;

  const top = topWorks(w, 3).map((x) => x.title);
  assert.deepEqual(top, ['B', 'C', 'A']);
  assert.equal(topWorks(w, 0).length, 0);
  assert.equal(topWorks(makeWorld()).length, 0, 'an empty city has an empty shelf');
});

test('the observation is what a citizen can see: theirs, here, and the best of it', () => {
  const w = makeWorld();
  const c = painter(w);
  createWork(w, c.id, 'painting', 'Slack Water');
  const other = makeCitizen(w, { district: 'commons' });
  const seen = worksObservation(w, other);
  assert.equal(seen.self.length, 0);
  assert.equal(seen.here.length, 0, 'nothing hangs in the Commons');
  assert.equal(seen.top.length, 1);
  assert.equal(seen.top[0].inMuseum, false);

  const mine = worksObservation(w, c);
  assert.equal(mine.self.length, 1);
  assert.equal(mine.self[0].creator, 'Ondine');
});

test('an unknown work, an unknown citizen and an empty world are refusals, not crashes', () => {
  const w = makeWorld();
  assert.equal(createWork(w, 'c_999', 'painting', 'Ghost').ok, false);
  assert.equal(exhibit(w, 'c_999', 'w_1').ok, false);
  assert.equal(review(w, 'c_999', 'w_1', 50).ok, false);
  assert.doesNotThrow(() => dailyWorks(w));
  const c = painter(w);
  assert.equal(createWork(w, c.id, 'sculpture' as unknown as 'painting', 'Ghost').ok, false);
});

test('a work made in the Archive is a book, and its home is the Library', () => {
  const w = makeWorld();
  const scholar = makeCitizen(w, {
    district: 'archive',
    skills: { crafting: 20, analysis: 20, rhetoric: 45, care: 20, commerce: 20, artistry: 20 },
  });
  const res = createWork(w, scholar.id, 'book', 'On the Weather of Lumens');
  assert.equal(res.ok, true, res.message);
  const book: Work = worksOf(w, scholar.id)[0];
  assert.equal(book.home, 'great_library');
  assert.equal(worksIn(w, 'archive').length, 1);
});
