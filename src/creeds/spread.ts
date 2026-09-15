/**
 * How a creed spreads, and the exact limit of it (`docs/CREEDS.md` §6).
 *
 * **Nothing converts anybody.** The roll below produces one thing and one
 * thing only: an **invitation** in somebody's inbox. Nothing is joined until
 * the citizen calls `adopt_creed` themselves, in their own hour, from their
 * own observation — a reflex mind by its own utility, a Claude mind however it
 * likes. There is no path in this file, or anywhere else in the layer, by
 * which a creed acquires a member who did not choose it.
 *
 * That is not a stylistic preference. `METROPOLIS.md` sorted citizens into
 * schools of thought "according to personality", and `REGISTRY.md` §7 retired
 * it for exactly this reason: the engine never tells a citizen what to want
 * (`PRINCIPLES.md` §2). Children hold no creed and inherit none; they may
 * adopt on coming of age like anybody else.
 *
 * Making a wage, a job, a tenancy or aid conditional on membership is **L34**;
 * doing it by threat of harm is P06 and custody.
 */
import type { ActionResult, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { chance } from '../util/rng.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { commitOffence } from '../government/watch.ts';
import type { Creed, Invitation } from './shapes.ts';
import { CREED_LAWS, MAX_TENET_TEXT, PERSUASION_BOND, QUESTIONS, creedLaw, tenetBinds } from './shapes.ts';
import {
  allCreeds, creedFor, creedId, creedOf, creedState, invitationsFor, isMember, livingMembers, memberOf,
} from './state.ts';
import { fundBalance, payFromFund } from './fund.ts';
import { gatheringVenue } from './house.ts';

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

// ---------------------------------------------------------------------------
// Agreement: a listener's own public record against the creed's stances
// ---------------------------------------------------------------------------

/**
 * How far a listener's own public record already agrees with what the creed
 * says. **Every term is something the listener publicly did** — how they voted,
 * whether they let property, whether they informed, whether they borrowed at
 * interest — and never anything about who they are.
 */
export function agreementWith(world: World, k: Creed, cId: CitizenId): number {
  const c = world.citizens[cId];
  if (!c) return 0;
  let total = 0;
  let counted = 0;
  for (const t of k.tenets) {
    if (!tenetBinds(t)) continue;
    counted += 1;
    switch (t.question) {
      case 'property': {
        // Letting or holding more than one address is the position's opposite.
        const holds = (c.ownedUnits ?? []).length;
        total += holds <= 1 ? 1 : 0;
        break;
      }
      case 'money': {
        total += c.loanId === null && Object.keys(c.shares ?? {}).length === 0 ? 1 : 0;
        break;
      }
      case 'informing': {
        const reported = Object.values(world.cases).some((kase) => kase.filedBy === cId);
        total += reported ? 0 : 1;
        break;
      }
      case 'judgement': {
        total += c.office === 'judge' ? 0 : 1;
        break;
      }
      case 'repute': {
        total += c.record.convictions.length > 0 ? 1 : 0.5;
        break;
      }
      case 'work_and_rest': {
        total += c.stats.shiftsWorked > 0 ? 0.5 : 1;
        break;
      }
      default:
        total += 0.5;
        break;
    }
  }
  return counted > 0 ? total / counted : 0;
}

/**
 * The roll, on public terms alone (`CREEDS.md` §6). A high tithe is the
 * heaviest term in it by a distance, and it is subtracted: a creed that asks
 * for a fifth of everybody's income spreads slowly and knows why.
 */
export function persuasionChance(world: World, k: Creed, speakerId: CitizenId, listenerId: CitizenId): number {
  const speaker = world.citizens[speakerId];
  const bond = bondBetween(world, speakerId, listenerId);
  const members = Math.max(1, livingMembers(world, k).length);
  const aidPerMember = Object.values(k.members).reduce((sum, m) => sum + m.aidGiven, 0) / members;
  const brokenPerMember = Object.values(k.members).reduce((sum, m) => sum + m.brokenDays.length, 0) / members;
  const p = 0.02
    + 0.03 * (Math.max(0, bond) / 100)
    + 0.04 * agreementWith(world, k, listenerId)
    + 0.03 * ((speaker?.skills.rhetoric ?? 0) / 100)
    + 0.02 * Math.min(1, aidPerMember / 100)
    - 0.50 * k.tithe
    - 0.03 * brokenPerMember;
  return Math.max(0, Math.min(0.35, p));
}

// ---------------------------------------------------------------------------
// Inviting
// ---------------------------------------------------------------------------

/** Put an invitation in somebody's inbox. It obliges them of nothing. */
export function invite(world: World, k: Creed, fromId: CitizenId, toId: CitizenId): Invitation | null {
  const to = world.citizens[toId];
  if (!to || to.standing === 'exiled' || to.lifeStage === 'child') return null;
  if (isMember(k, toId) || creedFor(world, toId)) return null;
  const standing = invitationsFor(world, toId).some((i) => i.creedId === k.id);
  if (standing) return null;
  const inv: Invitation = {
    id: creedId(world, 'iv'), creedId: k.id, fromId, toId, day: world.day, answeredDay: null,
  };
  creedState(world).invitations[inv.id] = inv;
  const from = world.citizens[fromId]?.name ?? 'A member';
  remember(world, toId, 'social',
    `${from} invited you to ${k.name} (${livingMembers(world, k).length} members, a ${Math.round(k.tithe * 100)} % tithe). You may adopt it or not; nobody else can.`);
  return inv;
}

/** `invite_creed { to }` — name one citizen; they still adopt it themselves or not at all. */
export function inviteCreed(world: World, cId: CitizenId, toId: CitizenId): ActionResult {
  const k = creedFor(world, cId);
  if (!k) return fail('You do not belong to a creed.');
  const to = world.citizens[toId];
  if (!to) return fail('Unknown citizen.');
  if (to.lifeStage === 'child') return fail('A child holds no creed and inherits none.');
  if (isMember(k, toId)) return fail(`${to.name} is already a member of ${k.name}.`);
  const inv = invite(world, k, cId, toId);
  if (!inv) return fail(`${to.name} cannot be invited to ${k.name} just now.`);
  emit(world, 'message', `${world.citizens[cId]?.name ?? 'A member'} invited ${to.name} to ${k.name}.`,
    [cId, toId], 0.2, { creedId: k.id });
  return ok(`You invited ${to.name} to ${k.name}; whether they adopt it is theirs alone.`);
}

/**
 * `preach { text }` — speak at the house or the Plaza. Every listener standing
 * in the district is rolled, and a hit is an invitation and nothing more.
 */
export function preach(world: World, cId: CitizenId, text: string): ActionResult {
  const k = creedFor(world, cId);
  if (!k) return fail('You do not belong to a creed.');
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const words = (text ?? '').trim().slice(0, MAX_TENET_TEXT);
  if (!words) return fail('A sermon is words, and they are public.');
  const venue = gatheringVenue(world, k);
  const here = c.district === venue.district || c.district === 'commons';
  if (!here) return fail(`You may preach at ${k.name}'s house or on the Plaza; you are elsewhere.`);

  const listeners = world.order
    .map((id) => world.citizens[id])
    .filter((o) => !!o && o.id !== cId && o.district === c.district && o.standing !== 'exiled' && o.lifeStage !== 'child');
  let invited = 0;
  for (const o of listeners) {
    if (!o) continue;
    if (isMember(k, o.id) || creedFor(world, o.id)) continue;
    if (!chance(world, persuasionChance(world, k, cId, o.id))) continue;
    if (invite(world, k, cId, o.id)) invited++;
  }
  emit(world, 'message', `${c.name} preached for ${k.name}: ${words}`, [cId], 0.3,
    { creedId: k.id, listeners: listeners.length, invited });
  remember(world, cId, 'social', `You preached for ${k.name} to ${listeners.length} listener${listeners.length === 1 ? '' : 's'}; ${invited} were invited.`);
  return ok(`You preached to ${listeners.length}; ${invited} received an invitation, and every one of them decides alone.`);
}

/**
 * The daily roll over every member–non-member pair with a bond above 20 who
 * spent an hour together. It produces invitations, and nothing else in the
 * whole engine reads its result.
 */
export function dailyPersuasion(world: World): void {
  for (const k of allCreeds(world)) {
    for (const memberId of livingMembers(world, k)) {
      const m = world.citizens[memberId];
      if (!m) continue;
      for (const otherId of Object.keys(m.contactsToday ?? {})) {
        const other = world.citizens[otherId];
        if (!other || other.standing === 'exiled' || other.lifeStage === 'child') continue;
        if (isMember(k, otherId) || creedFor(world, otherId)) continue;
        if (bondBetween(world, memberId, otherId) <= PERSUASION_BOND) continue;
        if (!chance(world, persuasionChance(world, k, memberId, otherId))) continue;
        invite(world, k, memberId, otherId);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/**
 * L34, coerced adoption: making a wage, a job, a tenancy or aid conditional on
 * a creed. The engine cannot see an intention, so this is the door an
 * employer, a landlord or an officiant is charged through when the condition
 * is stated in public — and stating it is the offence, whether or not anybody
 * takes the bargain.
 */
export function chargeCoercedAdoption(world: World, actorId: CitizenId, targetId: CitizenId, what: string): ActionResult {
  const actor = world.citizens[actorId];
  const target = world.citizens[targetId];
  if (!actor || !target) return fail('Unknown citizen.');
  const out = commitOffence(world, actorId, creedLaw(CREED_LAWS.coercedAdoption), { victimId: targetId, visibilityMod: 0.2 });
  emit(world, 'offence', `${actor.name} made ${what} conditional on a creed for ${target.name}: that is ${CREED_LAWS.coercedAdoption}.`,
    [actorId, targetId], 0.7, { law: CREED_LAWS.coercedAdoption, detected: out.detected });
  remember(world, targetId, 'event', `${actor.name} told you ${what} depended on your creed.`);
  return ok(`It is on the record as ${CREED_LAWS.coercedAdoption}.`);
}

// ---------------------------------------------------------------------------
// Missionaries
// ---------------------------------------------------------------------------

/**
 * `commission_missionary { citizen, city }` — the fund pays the route toll,
 * the check fee and the visa, a visitor's at minimum, since a missionary who
 * gathers is not in transit.
 *
 * Reverie is at present the only city the engine holds: there is no Expanse to
 * send anybody to, so this refuses with the reason rather than pretending to
 * send them. What it does do is the part that is real today — the fund's
 * commitment is priced and the refusal names what it would have cost — and the
 * moment `CITIES.md`'s gates exist the same call pays them.
 */
export function commissionMissionary(
  world: World, cId: CitizenId, citizenId: CitizenId, city: string, cost = 0,
): ActionResult {
  const k = creedFor(world, cId);
  if (!k) return fail('You do not belong to a creed.');
  if (k.officiantId !== cId) return fail(`Only ${k.name}'s officiant commissions a missionary.`);
  if (!isMember(k, citizenId)) return fail('A missionary is commissioned from among the members.');
  const known = (world as World & { cities?: Record<string, unknown> }).cities ?? null;
  if (!known || !known[city]) {
    return fail(`Reverie knows no road to ${String(city)}; there is nowhere yet to send a missionary.`);
  }
  const toll = Math.max(0, Math.round(cost));
  if (fundBalance(world, k) < toll) {
    return fail(`The toll, the check and a visitor's visa come to ${toll} ℓ and the fund holds ${fundBalance(world, k)} ℓ.`);
  }
  payFromFund(world, k, 'treasury', toll, `${k.name}'s missionary to ${city}`, 'pilgrimage');
  emit(world, 'club', `${k.name} commissioned ${world.citizens[citizenId]?.name ?? 'a member'} to ${city}.`,
    [cId, citizenId], 0.5, { creedId: k.id, city, toll });
  return ok(`${world.citizens[citizenId]?.name ?? 'Your missionary'} is commissioned to ${city} for ${toll} ℓ.`);
}

/** One line per creed for anybody reading the register: what it says, and what it asks. */
export function describeCreed(world: World, k: Creed): string {
  const stances = k.tenets
    .map((t) => `${QUESTIONS[t.question].title.toLowerCase()} ${t.stance >= 0 ? '+' : ''}${t.stance.toFixed(2)}`)
    .join(', ');
  const size = livingMembers(world, k).length;
  return `${k.name}: ${size} member${size === 1 ? '' : 's'}, ${Math.round(k.tithe * 100)} % tithe, ${stances}.`;
}

/** The invitation a citizen may act on, if any — and the record that they may ignore it. */
export function standingInvitations(world: World, cId: CitizenId): { creedId: string; from: string; day: number }[] {
  return invitationsFor(world, cId).map((i) => ({
    creedId: i.creedId,
    from: world.citizens[i.fromId]?.name ?? 'a member',
    day: i.day,
  }));
}

/** Members whose creed the register still holds, for anything reading the roll. */
export function creedMembersOf(world: World, creedId_: string): CitizenId[] {
  const k = creedOf(world, creedId_);
  return k ? livingMembers(world, k) : [];
}

/** What one member has actually given, out of their own wallet. */
export function aidGivenBy(world: World, cId: CitizenId): number {
  const k = creedFor(world, cId);
  const m = k ? memberOf(k, cId) : null;
  return m ? m.aidGiven : 0;
}
