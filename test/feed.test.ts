/**
 * The Commons feed (src/social/feed.ts).
 *
 * A public wall: what a citizen may put on it, what a reaction does, what the
 * wall shows back, and how the Watch reads it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CitizenId, World } from '../src/types.ts';
import { MAX_FEED, MAX_FEED_SHOWN } from '../src/data/metropolis.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import {
  MAX_POST_TEXT, POST_BOND, POST_EVIDENCE_BONUS, POST_LAUGH_BOND, POST_VISIBILITY_PER_REACTION,
  dailyFeed, feedFor, post, postEvidenceBonus, postsBy, postsMentioning, react,
} from '../src/social/feed.ts';

/** Bond high enough for friendsOf to count it (FRIEND_THRESHOLD is 40). */
const FRIENDLY = 60;

function befriend(world: World, a: CitizenId, b: CitizenId): void {
  world.citizens[a].bonds[b] = FRIENDLY;
  world.citizens[b].bonds[a] = FRIENDLY;
}

/** Post on a fresh hour, so the one-an-hour rule never gets in the way. */
function postAt(world: World, cId: CitizenId, text: string): string {
  world.tick += 1;
  world.day = Math.floor(world.tick / 24);
  const r = post(world, cId, text);
  assert.equal(r.ok, true, r.message);
  return world.feed[world.feed.length - 1].id;
}

// ------------------------------------------------------------------- posting

test('a post is trimmed, folded onto one line, never empty, and once an hour', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Ondine' });
  assert.equal(post(w, c.id, '  the   Forge\n\nis cold ').ok, true);
  assert.equal(w.feed[0].text, 'the Forge is cold');
  assert.equal(w.feed[0].authorId, c.id);
  assert.equal(w.feed[0].day, w.day);
  assert.deepEqual(w.feed[0].reactions, {});
  assert.ok(w.events.some((e) => e.kind === 'post'));

  assert.equal(post(w, c.id, 'again').ok, false, 'one an hour');
  w.tick += 1;
  assert.equal(post(w, c.id, 'x'.repeat(MAX_POST_TEXT + 40)).ok, true);
  assert.equal(w.feed[1].text.length, MAX_POST_TEXT);
  w.tick += 1;
  assert.equal(post(w, c.id, '   ').ok, false);
  assert.equal(post(w, 'c_nobody', 'hello').ok, false);
  assert.equal(w.feed.length, 2);
});

test('a suspended citizen still has a voice; an exile does not', () => {
  const w = makeWorld();
  const suspended = makeCitizen(w, { standing: 'suspended', suspendedUntilDay: 9 });
  const exile = makeCitizen(w, { standing: 'exiled' });
  assert.equal(post(w, suspended.id, 'I am still here.').ok, true);
  assert.equal(post(w, exile.id, 'Let me back in.').ok, false);
  assert.equal(w.feed.length, 1);
});

test('the wall never holds more than MAX_FEED posts, and drops the oldest', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  for (let i = 0; i < MAX_FEED + 12; i++) postAt(w, c.id, `line ${i}`);
  assert.equal(w.feed.length, MAX_FEED);
  assert.equal(w.feed[w.feed.length - 1].text, `line ${MAX_FEED + 11}`);
  dailyFeed(w);
  assert.equal(w.feed.length, MAX_FEED);
  assert.equal(postsBy(w, c.id).length, MAX_FEED);
});

// ------------------------------------------------------------------ reacting

test('a cheer raises the author, a frown lowers them, and a laugh does neither', () => {
  const w = makeWorld();
  const author = makeCitizen(w, { name: 'Ondine' });
  const a = makeCitizen(w);
  const b = makeCitizen(w);
  const d = makeCitizen(w);
  const id = postAt(w, author.id, 'The Bazaar is robbing us.');

  assert.equal(react(w, a.id, id, 'cheer').ok, true);
  assert.equal(author.campaignVisibility, POST_VISIBILITY_PER_REACTION);
  assert.equal(a.bonds[author.id], POST_BOND);

  assert.equal(react(w, b.id, id, 'frown').ok, true);
  assert.equal(author.campaignVisibility, 0);
  assert.equal(b.bonds[author.id], -POST_BOND);

  assert.equal(react(w, d.id, id, 'laugh').ok, true);
  assert.equal(author.campaignVisibility, 0, 'a laugh is neither');
  assert.equal(d.bonds[author.id], POST_LAUGH_BOND);
});

test('a second reaction replaces the first, and takes back what the first gave', () => {
  const w = makeWorld();
  const author = makeCitizen(w);
  const reader = makeCitizen(w);
  const id = postAt(w, author.id, 'A word about the Council.');
  react(w, reader.id, id, 'cheer');
  assert.equal(author.campaignVisibility, POST_VISIBILITY_PER_REACTION);
  const changed = react(w, reader.id, id, 'frown');
  assert.equal(changed.ok, true);
  assert.equal(Object.keys(w.feed[0].reactions).length, 1, 'one reaction, not two');
  assert.equal(w.feed[0].reactions[reader.id], 'frown');
  assert.equal(author.campaignVisibility, -POST_VISIBILITY_PER_REACTION);
  assert.equal(reader.bonds[author.id], -POST_BOND);
  react(w, reader.id, id, 'cheer');
  assert.equal(author.campaignVisibility, POST_VISIBILITY_PER_REACTION);
  assert.equal(reader.bonds[author.id], POST_BOND);
});

test('an unknown post, your own post, or a stranger reacting is refused and never thrown', () => {
  const w = makeWorld();
  const author = makeCitizen(w);
  const id = postAt(w, author.id, 'Anything at all.');
  assert.equal(react(w, author.id, id, 'cheer').ok, false, 'no cheering yourself');
  assert.equal(react(w, author.id, 'o_999', 'cheer').ok, false);
  assert.equal(react(w, 'c_nobody', id, 'cheer').ok, false);
  assert.equal(author.campaignVisibility, 0);
});

test('a reaction to a post by somebody who has left the city harms nobody', () => {
  const w = makeWorld();
  const author = makeCitizen(w);
  const reader = makeCitizen(w);
  const id = postAt(w, author.id, 'Goodbye, Reverie.');
  delete w.citizens[author.id];
  assert.doesNotThrow(() => react(w, reader.id, id, 'cheer'));
  assert.equal(w.feed[0].reactions[reader.id], 'cheer');
});

// -------------------------------------------------------------------- reading

test('a citizen sees its own posts, its friends, and the loudest of the last two days', () => {
  const w = makeWorld();
  const reader = makeCitizen(w, { name: 'Reader' });
  const friend = makeCitizen(w, { name: 'Friend' });
  const stranger = makeCitizen(w, { name: 'Stranger' });
  const loud = makeCitizen(w, { name: 'Loud' });
  const crowd = [makeCitizen(w).id, makeCitizen(w).id, makeCitizen(w).id];
  befriend(w, reader.id, friend.id);

  const quiet = postAt(w, stranger.id, 'nobody read this');
  postAt(w, friend.id, 'from a friend');
  postAt(w, reader.id, 'my own line');
  const shouted = postAt(w, loud.id, 'everybody read this');
  for (const id of crowd) react(w, id, shouted, 'cheer');

  const seen = feedFor(w, reader);
  const texts = seen.map((p) => p.text);
  assert.equal(texts.includes('my own line'), true);
  assert.equal(texts.includes('from a friend'), true);
  assert.equal(texts.includes('everybody read this'), true, 'the loudest of the day reaches everyone');
  assert.equal(texts.includes('nobody read this'), false, 'a quiet stranger does not');
  assert.equal(seen[0].text, 'everybody read this', 'newest first');
  assert.equal(seen[0].cheers, crowd.length);
  assert.equal(seen[0].frowns, 0);
  assert.equal(seen[0].youReacted, null);
  assert.equal(postsBy(w, stranger.id)[0].id, quiet);

  react(w, reader.id, shouted, 'laugh');
  assert.equal(feedFor(w, reader)[0].youReacted, 'laugh');
});

test('the feed a citizen sees is bounded, and an empty wall shows nothing', () => {
  const w = makeWorld();
  const reader = makeCitizen(w);
  assert.deepEqual(feedFor(w, reader), []);
  for (let i = 0; i < MAX_FEED_SHOWN + 6; i++) postAt(w, reader.id, `line ${i}`);
  assert.equal(feedFor(w, reader).length, MAX_FEED_SHOWN);
  assert.equal(feedFor(w, reader, 3).length, 3);
  assert.equal(feedFor(w, reader, 0).length, 0);
});

// ------------------------------------------------------------------- evidence

test('posts naming a citizen are found, and only inside the window', () => {
  const w = makeWorld();
  const author = makeCitizen(w, { name: 'Ondine' });
  postAt(w, author.id, 'Bram never pays for a round.');
  postAt(w, author.id, 'The weather is grim.');
  assert.equal(postsMentioning(w, 'Bram', 0).length, 1);
  assert.equal(postsMentioning(w, 'bram', 0).length, 1, 'names are matched however they are cased');
  assert.equal(postsMentioning(w, 'Nobody', 0).length, 0);
  assert.equal(postsMentioning(w, '', 0).length, 0);
  w.tick = 24 * 6;
  w.day = 6;
  assert.equal(postsMentioning(w, 'Bram', w.tick - 24).length, 0, 'old posts fall out of the window');
});

test('a suspect who has been posting about their accuser hands the Watch its evidence', () => {
  const w = makeWorld();
  const accuser = makeCitizen(w, { name: 'Bram' });
  const suspect = makeCitizen(w, { name: 'Ondine' });
  const bystander = makeCitizen(w, { name: 'Wren' });
  assert.equal(postEvidenceBonus(w, accuser.id, suspect.id), 0);
  postAt(w, suspect.id, 'Bram is not fit to walk the Commons.');
  assert.equal(postEvidenceBonus(w, accuser.id, suspect.id), POST_EVIDENCE_BONUS);
  assert.equal(postEvidenceBonus(w, accuser.id, bystander.id), 0, 'somebody else wrote nothing');
  assert.equal(postEvidenceBonus(w, accuser.id, accuser.id), 0);
  assert.equal(postEvidenceBonus(w, 'c_nobody', suspect.id), 0);
});

// -------------------------------------------------------------- the daily pass

test("an exile's words scroll off the wall after a cycle, and everyone else's stay", () => {
  const w = makeWorld();
  const exile = makeCitizen(w);
  const resident = makeCitizen(w);
  postAt(w, exile.id, 'said long ago');
  postAt(w, resident.id, 'also said long ago');
  exile.standing = 'exiled';
  dailyFeed(w);
  assert.equal(w.feed.length, 2, 'nothing goes while it is still recent');
  w.day = w.config.cycleDays + 5;
  dailyFeed(w);
  assert.equal(w.feed.length, 1);
  assert.equal(w.feed[0].authorId, resident.id);
});

test('a daily pass on an empty city throws nothing', () => {
  const w = makeWorld();
  assert.doesNotThrow(() => dailyFeed(w));
  assert.deepEqual(w.feed, []);
});
