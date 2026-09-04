/**
 * The Commons feed — the city's public wall.
 *
 * Anyone present may `post` a short line, once an hour, and anyone may `react`
 * to somebody else's with a cheer, a frown or a laugh. Cheers push an author's
 * campaign visibility up and frowns pull it down, which is how a citizen with
 * no money can still be heard at an election; a reaction is also a small bond,
 * kind or unkind, between two people.
 *
 * The feed is public, and being public it is **evidence**. The Watch reads it
 * like everybody else: a post naming the citizen who is reporting you adds to
 * what the Watch has (`postEvidenceBonus`, read by `government/watch.ts
 * reportOffence`), and the Court can be shown the same lines in a harassment
 * or a defamation case. Nothing said here is private, and the city never
 * pretends otherwise — a citizen's notes and its letters home are the only
 * private things in Reverie, and they are not this.
 *
 * A suspension takes a citizen's work, its trade and its vote. It does not
 * take its voice: a suspended citizen posts like anyone else.
 */
import type { Citizen, CitizenId, ObservedPost, Post, ReactionKind, World, ActionResult } from '../types.ts';
import { MAX_FEED, MAX_FEED_SHOWN } from '../data/metropolis.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent } from '../citizens/citizen.ts';
import { adjustBond, friendsOf } from '../citizens/relationships.ts';

/** Longest post the wall will carry. */
export const MAX_POST_TEXT = 280;
/** Campaign visibility one cheer adds (and one frown takes). */
export const POST_VISIBILITY_PER_REACTION = 0.5;
/** Bond a cheer gives and a frown takes, between reactor and author. */
export const POST_BOND = 2;
/** Bond a laugh gives: it is a smaller thing than a cheer, and never unkind. */
export const POST_LAUGH_BOND = 1;
/** Evidence a post about the accuser adds to a report against its author. */
export const POST_EVIDENCE_BONUS = 0.1;
/** How far back the Watch reads the feed for that. */
export const POST_EVIDENCE_TICKS = 24;
/** A post counts as "of the moment" for this many days when the feed is ranked. */
export const POPULAR_POST_DAYS = 2;

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The counter holding the tick a citizen last posted. */
function postKey(cId: CitizenId): string { return `post:${cId}`; }

function reactionCount(p: Post): number {
  return Object.keys(p.reactions).length;
}

function countOf(p: Post, kind: ReactionKind): number {
  let n = 0;
  for (const v of Object.values(p.reactions)) if (v === kind) n++;
  return n;
}

/** A post by id, or null. */
export function postById(world: World, postId: string): Post | null {
  return (world.feed ?? []).find((p) => p.id === postId) ?? null;
}

/** Everything one citizen has put on the wall, newest first. */
export function postsBy(world: World, cId: CitizenId): Post[] {
  return (world.feed ?? []).filter((p) => p.authorId === cId).reverse();
}

// ---------------------------------------------------------------------------
// Posting and reacting
// ---------------------------------------------------------------------------

/** Put a line on the wall. One an hour: the wall is not a megaphone. */
export function post(world: World, cId: CitizenId, text: string): ActionResult {
  world.feed ??= [];
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const body = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_POST_TEXT);
  if (!body) return fail('A post needs something in it.');
  if (world.counters[postKey(cId)] === world.tick) return fail('You have already posted this hour.');
  world.counters[postKey(cId)] = world.tick;

  const p: Post = { id: nextId(world, 'o'), authorId: cId, day: world.day, text: body, reactions: {} };
  world.feed.push(p);
  if (world.feed.length > MAX_FEED) world.feed.splice(0, world.feed.length - MAX_FEED);
  emit(world, 'post', `${c.name} posted to the Commons feed: "${body}"`, [cId], 0.1, { postId: p.id });
  return { ok: true, message: `You posted to the Commons feed (${p.id}).` };
}

/** What one reaction does to the author, in either direction. */
function applyReaction(world: World, author: Citizen | undefined, reactorId: CitizenId, kind: ReactionKind, sign: 1 | -1): void {
  if (!author) return;
  if (kind === 'cheer') {
    author.campaignVisibility += sign * POST_VISIBILITY_PER_REACTION;
    adjustBond(world, reactorId, author.id, sign * POST_BOND);
  } else if (kind === 'frown') {
    author.campaignVisibility -= sign * POST_VISIBILITY_PER_REACTION;
    adjustBond(world, reactorId, author.id, sign * -POST_BOND);
  } else {
    adjustBond(world, reactorId, author.id, sign * POST_LAUGH_BOND);
  }
}

/** Cheer, frown or laugh at somebody's post. A second reaction replaces the first. */
export function react(world: World, cId: CitizenId, postId: string, kind: ReactionKind): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const p = postById(world, postId);
  if (!p) return fail('There is no such post on the Commons feed.');
  if (p.authorId === cId) return fail('You cannot react to your own post.');
  const author = world.citizens[p.authorId];
  const previous = p.reactions[cId];
  if (previous) applyReaction(world, author, cId, previous, -1);
  p.reactions[cId] = kind;
  applyReaction(world, author, cId, kind, 1);
  const name = author?.name ?? p.authorId;
  if (previous && previous !== kind) {
    remember(world, cId, 'social', `You changed your ${previous} to a ${kind} on ${name}'s post.`);
    return { ok: true, message: `Your ${previous} on ${name}'s post is a ${kind} now.` };
  }
  remember(world, cId, 'social', `You ${kind}ed ${name}'s post: "${p.text}"`);
  if (author && author.id !== cId) {
    remember(world, author.id, 'social', `${c.name} ${kind}ed your post: "${p.text}"`);
  }
  return { ok: true, message: `You ${kind}ed ${name}'s post.` };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function observed(world: World, p: Post, readerId: CitizenId): ObservedPost {
  return {
    id: p.id,
    author: p.authorId,
    authorName: world.citizens[p.authorId]?.name ?? p.authorId,
    day: p.day,
    text: p.text,
    cheers: countOf(p, 'cheer'),
    frowns: countOf(p, 'frown'),
    laughs: countOf(p, 'laugh'),
    youReacted: p.reactions[readerId] ?? null,
  };
}

/**
 * What a citizen sees of the wall, newest first: its own posts, its friends',
 * and whatever the last two days have been loudest about.
 */
export function feedFor(world: World, c: Citizen, limit = MAX_FEED_SHOWN): ObservedPost[] {
  const feed = world.feed ?? [];
  if (!c || feed.length === 0 || limit <= 0) return [];
  const friends = new Set(friendsOf(world, c.id));
  const wanted = new Set<string>();
  for (const p of feed) {
    if (p.authorId === c.id || friends.has(p.authorId)) wanted.add(p.id);
  }
  const cutoff = world.day - POPULAR_POST_DAYS;
  const loudest = feed
    .filter((p) => p.day >= cutoff && !wanted.has(p.id) && reactionCount(p) > 0)
    .sort((a, b) => reactionCount(b) - reactionCount(a) || b.day - a.day || a.id.localeCompare(b.id))
    .slice(0, limit);
  for (const p of loudest) wanted.add(p.id);

  const out: ObservedPost[] = [];
  for (let i = feed.length - 1; i >= 0 && out.length < limit; i--) {
    if (wanted.has(feed[i].id)) out.push(observed(world, feed[i], c.id));
  }
  return out;
}

/**
 * Posts naming a citizen since a tick, for evidence. The wall keeps days, not
 * hours, so `sinceTick` is read to the day it falls in.
 */
export function postsMentioning(world: World, name: string, sinceTick: number): Post[] {
  const needle = (name ?? '').trim().toLowerCase();
  if (!needle) return [];
  const sinceDay = Math.floor(Math.max(0, sinceTick) / 24);
  return (world.feed ?? []).filter((p) => p.day >= sinceDay && p.text.toLowerCase().includes(needle));
}

/**
 * What the feed adds to a report: a suspect who has been posting about the
 * citizen reporting them has written the Watch's evidence for it. Public words,
 * publicly read.
 */
export function postEvidenceBonus(world: World, accuserId: CitizenId, suspectId: CitizenId): number {
  const accuser = world.citizens[accuserId];
  const suspect = world.citizens[suspectId];
  if (!accuser || !suspect || accuserId === suspectId) return 0;
  const since = world.tick - POST_EVIDENCE_TICKS;
  const hits = postsMentioning(world, accuser.name, since).filter((p) => p.authorId === suspectId);
  return hits.length > 0 ? POST_EVIDENCE_BONUS : 0;
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

/** The wall is bounded, and an exile's words scroll off it after a cycle. */
export function dailyFeed(world: World): void {
  world.feed ??= [];
  const cutoff = world.day - world.config.cycleDays;
  world.feed = world.feed.filter((p) => {
    const author = world.citizens[p.authorId];
    return !(author && author.standing === 'exiled' && p.day < cutoff);
  });
  if (world.feed.length > MAX_FEED) world.feed.splice(0, world.feed.length - MAX_FEED);
}
