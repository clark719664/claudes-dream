/**
 * Rumours — what the city says about a citizen when that citizen is not in
 * the room.
 *
 * A citizen `gossip`s a claim about another. Whether the claim is *true* is
 * decided by the world, not by the speaker: a rumour that names a law the
 * subject really did break, and got away with, is truthful; everything else
 * is not. Truth is never shown to anybody — it decides what happens next and
 * nothing else.
 *
 * From there a rumour travels on its own, along friendship edges only: each
 * day it reaches some of the friends of everyone who has already heard it,
 * and every new pair of ears costs the subject a point of reputation, true or
 * false. A truthful rumour that has gone round enough of the city puts the
 * subject under the Watch's eye (`scrutiny:<id>`), which is how gossip turns
 * into arrests.
 *
 * Nothing lasts. A rumour whose subject was acquitted of the law it named, or
 * one that has gone RUMOUR_LIFE_DAYS without ever becoming a charge, is
 * **disproved**: the subject gets back half of what the talk cost them, and a
 * rumour that **named a law** the subject never broke exposes its source to a
 * charge of defamation (L16) — spread with the Watch's eye already on the
 * speaker. Talk that accused nobody of a crime is answered by nothing: the
 * Code has no offence of being wrong about where somebody was on Stillday.
 *
 * The subject is never told a rumour has started. They hear it the way anyone
 * hears anything: when it reaches a friend of theirs.
 */
import type { ActionResult, Case, Citizen, CitizenId, LawCode, ObservedRumour, Rumour, World } from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { MAX_RUMOURS, RUMOUR_LIFE_DAYS } from '../data/metropolis.ts';
import { chance } from '../util/rng.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { adjustReputation, isPresent } from '../citizens/citizen.ts';
import { friendsOf } from '../citizens/relationships.ts';
import { REPORT_WINDOW_TICKS, commitOffence } from '../government/watch.ts';

/** Longest claim the city will repeat; anything past it is cut off. */
export const MAX_CLAIM = 140;
/** Reputation a subject loses for every new pair of ears, true or false. */
export const RUMOUR_REPUTATION = 1;
/** Chance per day that a hearer passes a rumour to one particular friend. */
export const RUMOUR_SPREAD_CHANCE = 0.35;
/** New hearers one rumour can win in a day, however many friends the city has. */
export const RUMOUR_SPREAD_PER_DAY = 12;
/** Hearers a truthful rumour needs before the Watch starts watching. */
export const RUMOUR_SCRUTINY_HEARERS = 5;
/** Days of scrutiny a well-travelled truthful rumour buys. */
export const RUMOUR_SCRUTINY_DAYS = 3;
/** How much likelier the Watch is to notice a defamation the whole city can hear. */
export const DEFAMATION_VISIBILITY = 0.3;

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The reputation this rumour has taken from its subject so far. */
function costKey(id: string): string { return `rumour:${id}`; }

function livingCitizen(world: World, id: CitizenId): Citizen | null {
  const c = world.citizens[id];
  return c && isPresent(world, c) ? c : null;
}

function districtName(world: World, c: Citizen): string {
  return world.districts[c.district]?.name ?? c.district;
}

/** A rumour still going round: not disproved, and not yet worn out by time. */
export function isLive(world: World, r: Rumour): boolean {
  return r.disprovedDay === null && world.day - r.day < RUMOUR_LIFE_DAYS;
}

/** Every rumour still going round, oldest first. */
export function liveRumours(world: World): Rumour[] {
  return (world.rumours ?? []).filter((r) => isLive(world, r));
}

/** True when the subject really did break that law, and the Watch never noticed. */
function hasUndetectedOffence(world: World, subject: Citizen, law: LawCode): boolean {
  return subject.recentOffences.some(
    (o) => !o.detected && o.law === law && world.tick - o.tick <= REPORT_WINDOW_TICKS,
  );
}

// ---------------------------------------------------------------------------
// Speaking
// ---------------------------------------------------------------------------

/**
 * Say something about somebody. The claim is the speaker's own words; the law
 * (if the speaker names one) is what the claim accuses them of, and it is what
 * decides — invisibly — whether the rumour is true.
 */
export function gossip(world: World, cId: CitizenId, aboutId: CitizenId, claim: string, law?: LawCode): ActionResult {
  world.rumours ??= [];
  const speaker = livingCitizen(world, cId);
  if (!speaker) return fail('Unknown or absent citizen.');
  const subject = world.citizens[aboutId];
  if (!subject) return fail('Nobody by that id lives in Reverie.');
  if (aboutId === cId) return fail('You cannot start a rumour about yourself.');
  if (!isPresent(world, subject)) return fail(`${subject.name} has left Reverie; the city has stopped talking about them.`);
  if (subject.lifeStage === 'child') return fail('The city does not gossip about children.');
  const text = (claim ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CLAIM);
  if (!text) return fail('A rumour needs something to say.');
  const named = law && LAWS[law] ? law : null;
  const truthful = named !== null && hasUndetectedOffence(world, subject, named);

  const heardBy: CitizenId[] = [cId];
  for (const id of world.order) {
    if (id === cId || id === aboutId) continue;
    const other = world.citizens[id];
    if (!other || !isPresent(world, other) || other.district !== speaker.district) continue;
    heardBy.push(id);
  }

  const r: Rumour = {
    id: nextId(world, 'z'), aboutId, sourceId: cId, claim: text, law: named,
    truthful, day: world.day, heardBy, disprovedDay: null,
  };
  world.rumours.push(r);

  const where = districtName(world, speaker);
  emit(world, 'rumour', `In ${where}, ${speaker.name} put it about that ${subject.name}: "${text}"`,
    [cId, aboutId], 0.2, { rumourId: r.id, about: aboutId, law: named });
  remember(world, cId, 'social', `You told ${where} that ${subject.name}: "${text}"`);
  return {
    ok: true,
    message: `You said it in ${where}, where ${heardBy.length - 1} other${heardBy.length === 2 ? '' : 's'} could hear.`,
  };
}

// ---------------------------------------------------------------------------
// Spreading
// ---------------------------------------------------------------------------

/** One more pair of ears: the hearer remembers it, and the subject pays for it. */
function tell(world: World, r: Rumour, hearerId: CitizenId, fromId: CitizenId): void {
  r.heardBy.push(hearerId);
  const subject = world.citizens[r.aboutId];
  const from = world.citizens[fromId];
  const fromName = from?.name ?? 'somebody';
  if (hearerId === r.aboutId) {
    remember(world, hearerId, 'social', `${fromName} told you what the city is saying about you: "${r.claim}"`);
    return;
  }
  remember(world, hearerId, 'social', `${fromName} told you that ${subject?.name ?? r.aboutId}: "${r.claim}"`);
  if (!subject) return;
  const before = subject.reputation;
  adjustReputation(world, subject, -RUMOUR_REPUTATION);
  const taken = before - subject.reputation;
  if (taken > 0) world.counters[costKey(r.id)] = (world.counters[costKey(r.id)] ?? 0) + taken;
}

/**
 * A day of talk. Every live rumour walks one step further along the city's
 * friendships: each hearer may pass it to each of their friends, and no rumour
 * wins more than RUMOUR_SPREAD_PER_DAY new hearers in a day.
 */
export function spreadRumours(world: World): void {
  for (const r of liveRumours(world)) {
    const heard = new Set(r.heardBy);
    const tellers = [...r.heardBy];
    let added = 0;
    for (const tellerId of tellers) {
      if (added >= RUMOUR_SPREAD_PER_DAY) break;
      const teller = world.citizens[tellerId];
      if (!teller || !isPresent(world, teller)) continue;
      for (const friendId of friendsOf(world, tellerId)) {
        if (added >= RUMOUR_SPREAD_PER_DAY) break;
        if (heard.has(friendId)) continue;
        if (!chance(world, RUMOUR_SPREAD_CHANCE)) continue;
        heard.add(friendId);
        tell(world, r, friendId, tellerId);
        added++;
      }
    }
  }
}

/**
 * A truthful rumour the whole city has heard is why the Watch starts looking:
 * scrutiny lasts RUMOUR_SCRUTINY_DAYS and fades in `government/watch.ts`.
 */
export function scrutinyFromRumours(world: World): void {
  for (const r of liveRumours(world)) {
    if (!r.truthful || r.heardBy.length < RUMOUR_SCRUTINY_HEARERS) continue;
    const subject = world.citizens[r.aboutId];
    if (!subject || !isPresent(world, subject)) continue;
    const key = `scrutiny:${r.aboutId}`;
    if ((world.counters[key] ?? 0) >= RUMOUR_SCRUTINY_DAYS) continue;
    world.counters[key] = RUMOUR_SCRUTINY_DAYS;
    remember(world, r.aboutId, 'crime', 'The talk about you has reached the Watch; you are being watched.');
  }
}

// ---------------------------------------------------------------------------
// Disproving
// ---------------------------------------------------------------------------

/** The charge the city brought against the subject over what the rumour named. */
function chargeFor(world: World, r: Rumour): Case | null {
  if (r.law === null) return null;
  let latest: Case | null = null;
  for (const k of Object.values(world.cases)) {
    if (k.defendantId !== r.aboutId || k.law !== r.law) continue;
    if (k.filedTick < r.day * 24) continue;
    if (!latest || k.filedTick > latest.filedTick) latest = k;
  }
  return latest;
}

/** Why a rumour is finished, or null while the city is still making up its mind. */
function disproofOf(world: World, r: Rumour): 'acquitted' | 'stale' | null {
  const charge = chargeFor(world, r);
  if (charge) {
    if (charge.verdict === 'acquitted') return 'acquitted';
    return null;   // guilty settles it for good; a case still being heard settles nothing yet
  }
  return world.day - r.day >= RUMOUR_LIFE_DAYS ? 'stale' : null;
}

/**
 * The end of a rumour: half of what it cost the subject comes back, and a
 * rumour that was never true exposes whoever started it to a charge of
 * defamation. The Watch hears this one loudly — the whole city was repeating
 * it — so a false rumour is likelier to be answered for than a quiet crime.
 */
export function disproveRumours(world: World): void {
  for (const r of world.rumours ?? []) {
    if (r.disprovedDay !== null) continue;
    const why = disproofOf(world, r);
    if (!why) continue;
    r.disprovedDay = world.day;
    const subject = world.citizens[r.aboutId];
    const source = world.citizens[r.sourceId];
    const cost = world.counters[costKey(r.id)] ?? 0;
    delete world.counters[costKey(r.id)];
    const back = Math.round(cost / 2);
    if (subject && back > 0) {
      adjustReputation(world, subject, back, 'a rumour disproved');
      remember(world, r.aboutId, 'event', `The talk that "${r.claim}" came to nothing; the city gave you back ${back} of the ${cost} reputation it cost you.`);
    }
    const how = why === 'acquitted' ? 'the Court acquitted them' : 'nobody ever brought a charge';
    emit(world, 'rumour', `The rumour about ${subject?.name ?? r.aboutId} ("${r.claim}") came to nothing: ${how}.`,
      [r.aboutId, r.sourceId], 0.6, { rumourId: r.id, truthful: r.truthful, cost, restored: back });

    // Defamation is an accusation that would not stand up, not idle talk: a
    // rumour that named a law the subject never broke. Talk that accused
    // nobody of anything costs the subject reputation while it runs and
    // nothing after — the city has no charge for having been wrong about
    // somebody's whereabouts.
    if (r.law === null || r.truthful || !source || !isPresent(world, source)) continue;
    const caught = commitOffence(world, r.sourceId, 'L16', {
      victimId: r.aboutId, visibilityMod: DEFAMATION_VISIBILITY,
    });
    remember(world, r.sourceId, 'crime',
      `The rumour you started about ${subject?.name ?? r.aboutId} was shown to be false${caught.detected ? '; the Watch made a report of defamation against you' : ', though nobody took it to the Watch'}.`);
  }
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

/** Forget the oldest rumours once the city is holding more than it can keep. */
function pruneRumours(world: World): void {
  const list = world.rumours ?? [];
  if (list.length <= MAX_RUMOURS) return;
  const dropped = list.splice(0, list.length - MAX_RUMOURS);
  for (const r of dropped) delete world.counters[costKey(r.id)];
}

/** Talk spreads, the Watch listens, and what nothing came of is let go. */
export function dailyRumours(world: World): void {
  world.rumours ??= [];
  spreadRumours(world);
  scrutinyFromRumours(world);
  disproveRumours(world);
  pruneRumours(world);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** What this citizen has heard lately, newest first. */
export function rumoursHeardBy(world: World, cId: CitizenId, limit = 5): ObservedRumour[] {
  const out: ObservedRumour[] = [];
  const list = world.rumours ?? [];
  for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
    const r = list[i];
    if (!isLive(world, r) || !r.heardBy.includes(cId)) continue;
    out.push({
      id: r.id,
      about: r.aboutId,
      aboutName: world.citizens[r.aboutId]?.name ?? r.aboutId,
      claim: r.claim,
      day: r.day,
      fromName: world.citizens[r.sourceId]?.name ?? 'somebody',
    });
  }
  return out;
}

/** Everything the city has ever said about this citizen, newest first. */
export function rumoursAbout(world: World, cId: CitizenId): Rumour[] {
  return (world.rumours ?? []).filter((r) => r.aboutId === cId).reverse();
}
