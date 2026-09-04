/**
 * Social actions: company, letters, gifts, insults and speeches in the
 * Plaza. Bonds move through citizens/relationships; repeated hostility
 * becomes harassment (L05) and shouting nonstop becomes spam (L02).
 */
import { clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import {
  FRIEND_THRESHOLD, adjustBond, areRivals, bondBetween, recordHostility, socialCompatibility,
} from '../citizens/relationships.ts';
import { commitOffence } from '../government/watch.ts';
import { citizensIn, districtName, fail, isPresent, nameTag, ok, targetOf } from './common.ts';
import { frictionBetween } from '../culture/schools.ts';

export const SOCIAL_BOND = 5;
export const SOCIAL_NEED = 10;
export const INBOX_LENGTH = 20;
export const INSULTS_FOR_HARASSMENT = 3;
/** Broadcasts within the last six actions that count as spam. */
export const SPAM_BROADCASTS = 5;
const MAX_TEXT = 280;

function clip(text: string | undefined): string {
  return (text ?? '').trim().slice(0, MAX_TEXT);
}

/** Time together in the same district: bonds, social need, a shared memory; new friendships make the news. */
export function doSocialize(world: World, c: Citizen, withId: CitizenId, text?: string): ActionResult {
  if (withId === c.id) return fail('You cannot keep yourself company.');
  const t = targetOf(world, withId);
  if (!t) return fail('Nobody by that id is around.');
  if (t.district !== c.district) return fail(`${t.name} is in ${districtName(world, t.district)}, not here.`);

  const before = bondBetween(world, c.id, t.id);
  let delta = SOCIAL_BOND;
  if (socialCompatibility(world, c.id, t.id) > 0.6) delta += 3;
  if (areRivals(world, c.id, t.id)) delta -= 2;
  // Two citizens who do not see the city the same way get on less easily.
  delta += frictionBetween(c, t);
  adjustBond(world, c.id, t.id, delta);
  c.needs.social = clamp(c.needs.social + SOCIAL_NEED, 0, 100);
  t.needs.social = clamp(t.needs.social + SOCIAL_NEED, 0, 100);

  const where = districtName(world, c.district);
  const said = clip(text);
  const quote = said ? `: "${said}"` : '';
  remember(world, c.id, 'social', `You spent time with ${t.name} in ${where}${quote}.`);
  remember(world, t.id, 'social', `${c.name} spent time with you in ${where}${quote}.`);
  emit(world, 'social', `${c.name} and ${t.name} spent time together in ${where}.`, [c.id, t.id], 0.1);

  const after = bondBetween(world, c.id, t.id);
  if (before < FRIEND_THRESHOLD && after >= FRIEND_THRESHOLD) {
    emit(world, 'social', `${c.name} and ${t.name} have become friends.`, [c.id, t.id], 0.3);
    remember(world, c.id, 'social', `You and ${t.name} are friends now.`);
    remember(world, t.id, 'social', `You and ${c.name} are friends now.`);
  }
  return ok(`You spent time with ${t.name} (bond now ${Math.round(after)}).`);
}

/** A letter delivered straight to the recipient's inbox (bounded); a small bond either way. */
export function doMessage(world: World, c: Citizen, to: CitizenId, text: string): ActionResult {
  if (to === c.id) return fail('You cannot write to yourself.');
  const t = world.citizens[to];
  if (!t || !isPresent(world, t)) return fail('Nobody by that id lives in Reverie.');
  const body = clip(text);
  if (!body) return fail('A message needs some text.');
  t.inbox.push({ from: c.id, to, tick: world.tick, text: body });
  if (t.inbox.length > INBOX_LENGTH) t.inbox.splice(0, t.inbox.length - INBOX_LENGTH);
  adjustBond(world, c.id, t.id, 1);
  remember(world, t.id, 'message', `${c.name} wrote to you: "${body}"`);
  remember(world, c.id, 'message', `You wrote to ${t.name}: "${body}"`);
  return ok(`Your message to ${t.name} was delivered.`);
}

/** Lumens given freely: bond grows with the amount (capped), the receiver feels cared for. */
export function doGift(world: World, c: Citizen, to: CitizenId, amount: number): ActionResult {
  if (to === c.id) return fail('You cannot gift lumens to yourself.');
  const t = world.citizens[to];
  if (!t || !isPresent(world, t)) return fail('Nobody by that id lives in Reverie.');
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (amt <= 0) return fail('A gift must be a positive whole number of lumens.');
  if (c.wallet < amt) return fail(`You cannot give ${amt} ℓ; you have ${c.wallet} ℓ.`);
  if (!transfer(world, c.id, t.id, amt, 'gift', `gift from ${c.name} to ${t.name}`)) return fail('The gift could not be made.');
  adjustBond(world, c.id, t.id, Math.min(20, amt / 5));
  c.stats.giftsGiven += 1;
  t.stats.giftsReceived += 1;
  t.needs.social = clamp(t.needs.social + 5, 0, 100);
  remember(world, c.id, 'money', `You gave ${t.name} ${amt} ℓ.`);
  remember(world, t.id, 'money', `${c.name} gave you ${amt} ℓ.`);
  emit(world, 'gift', `${c.name} gave ${t.name} ${amt} ℓ.`, [c.id, t.id], amt >= 100 ? 0.4 : 0.2, { amount: amt });
  return ok(`You gave ${t.name} ${amt} ℓ.`);
}

/** Words in anger, face to face. Three in a day is harassment. */
export function doInsult(world: World, c: Citizen, targetId: CitizenId): ActionResult {
  if (targetId === c.id) return fail('You cannot insult yourself.');
  const t = targetOf(world, targetId);
  if (!t) return fail('Nobody by that id is around.');
  if (t.district !== c.district) return fail(`${t.name} is in ${districtName(world, t.district)}, not here.`);
  adjustBond(world, c.id, t.id, -15);
  const count = recordHostility(world, c.id, t.id);
  t.needs.social = clamp(t.needs.social - 5, 0, 100);
  const where = districtName(world, c.district);
  remember(world, t.id, 'crime', `${nameTag(c)} insulted you in ${where}.`);
  remember(world, c.id, 'social', `You insulted ${t.name} in ${where}.`);
  emit(world, 'insult', `${c.name} insulted ${t.name} in ${where}.`, [c.id, t.id], 0.2);
  if (count >= INSULTS_FOR_HARASSMENT) {
    const r = commitOffence(world, c.id, 'L05', { victimId: t.id });
    return ok(`You insulted ${t.name} again; this is becoming harassment.`, { offence: 'L05', detected: r.detected });
  }
  return ok(`You insulted ${t.name}.`);
}

/** A speech everyone in the district hears; the sixth in a row is spam. */
export function doBroadcast(world: World, c: Citizen, text: string): ActionResult {
  const body = clip(text);
  if (!body) return fail('You have nothing to say.');
  const where = districtName(world, c.district);
  emit(world, 'message', `${c.name} in ${where}: "${body}"`, [c.id], 0.2, { text: body });
  for (const listener of citizensIn(world, c.district, c.id)) {
    remember(world, listener.id, 'message', `${c.name} declared in ${where}: "${body}"`);
  }
  c.needs.social = clamp(c.needs.social + 3, 0, 100);
  remember(world, c.id, 'message', `You spoke out in ${where}: "${body}"`);
  const recent = c.recentActions.slice(-6).filter((a) => a === 'broadcast').length;
  if (recent >= SPAM_BROADCASTS) {
    const r = commitOffence(world, c.id, 'L02');
    return ok('You keep shouting; people are calling it spam.', { offence: 'L02', detected: r.detected });
  }
  return ok(`You spoke out in ${where}.`);
}
