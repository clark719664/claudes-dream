/**
 * Conscience and the door: the two parts of a creed that answer somebody else
 * rather than choosing a pastime (`docs/CREEDS.md` §§4, 5).
 *
 * A refusal is only ever weighed where the duty has actually fallen on this
 * citizen — a jury it was seated on, a charge laid today against a friend
 * standing beside it, a shift on the day its creed calls holy — and only where
 * the creed it adopted takes the demanding side of the question. A member whose
 * creed says nothing about informing informs like anybody else.
 *
 * A sanctuary is rarer still, and every step of it is weighed on what the
 * citizen can see: the charge, the fund, the days it has run, and whether the
 * Court has opened the door.
 */
import type { Action, Case, World } from '../types.ts';
import { memo } from '../util/memo.ts';
import { chance } from '../util/rng.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { juryOf } from '../government/jury.ts';
import {
  bindingTenet, creedFor, creedOf, creedState, fundBalance, liveSanctuaries, observanceOf, sanctuaryFor,
  warrantGround,
} from '../creeds/index.ts';
import type { Ctx } from './reflex-util.ts';

// ---------------------------------------------------------------------------
// Conscience
// ---------------------------------------------------------------------------

/**
 * The charges laid today that anybody might be asked about: read once for the
 * whole city rather than once per citizen, because every member of every creed
 * asks the same question of the same list in the same hour.
 */
function chargesLaidToday(world: World): Case[] {
  return memo(world, 'creed:freshCharges', () => Object.values(world.cases)
    .filter((k) => k.status === 'pending' && Math.floor(k.filedTick / 24) === world.day));
}

/**
 * The one thing here that answers a summons rather than choosing a pastime.
 *
 * A refusal is only ever weighed where the duty has actually fallen on this
 * citizen — a jury it was seated on, a charge laid today against somebody
 * standing beside it, a shift on the day its creed calls holy — and only where
 * the creed it adopted takes the demanding side of the question. A member whose
 * creed says nothing about informing informs like anybody else.
 *
 * **At most one refusal a day, whatever the creed says.** A citizen answers the
 * summons in front of it; it does not spend its week declining every charge on
 * the docket, and a layer that let it do that emptied the city inside a cycle.
 */
export function tryRefusal(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  if (!ctx.can.has('refuse')) return null;
  const k = creedFor(world, c.id);
  if (!k) return null;
  const daily = `refusedToday:${c.id}`;
  if (world.counters[daily] === world.day) return null;
  const observance = observanceOf(world, k, c.id);

  // A jury seat drawn by lot, on a creed that will not sit in judgement. This
  // is the refusal that costs somebody else the most, and it is the one the
  // duty most plainly fell on: the lot named this citizen.
  const judgement = bindingTenet(k, 'judgement');
  if (judgement) {
    for (const kase of Object.values(world.cases)) {
      if (kase.status !== 'pending' || !juryOf(kase).includes(c.id)) continue;
      const key = `creedRefusedJury:${c.id}:${kase.id}`;
      if (world.counters[key]) continue;
      world.counters[key] = 1;
      world.counters[daily] = world.day;
      return { type: 'refuse', duty: 'jury', ground: judgement.text || `${k.name} does not sit in judgement on another mind.` };
    }
  }

  // The holy day. A creed that gathers on a working day asks its members for a
  // day's wages every week, and this is the hour that costs it.
  const rest = bindingTenet(k, 'work_and_rest');
  if (rest && ctx.job && clock.working && k.gatheringDay === world.day % 7) {
    world.counters[daily] = world.day;
    // A member who has kept little else of what the creed asks keeps this
    // less often too: observance is a record, not a rule.
    if (chance(world, 0.35 + observance * 0.5)) {
      return { type: 'refuse', duty: 'work', ground: rest.text || `${k.name} keeps this day, and I keep it with them.` };
    }
    return null;
  }

  // A summons about what you saw, on a creed that will not name a neighbour.
  // Only for a charge laid **today**, only where this citizen is neither the
  // accused, the victim nor the one who filed it, and only where the accused is
  // a close friend it is standing beside — anything looser is not a summons
  // anybody answered, it is an opinion filed at the Courthouse.
  //
  // And rarely. A bench that refuses the ground charges L31, a second refusal
  // is a prior, and four of those reach the Gate: a scripted mind that refused
  // every charge on the docket emptied the city inside a cycle and filled the
  // cells with its own congregation. So: a week between refusals, a long odds
  // roll, and much longer odds again for somebody the Court has already
  // convicted of it once.
  const informing = bindingTenet(k, 'informing');
  if (!informing) return null;
  if (world.day - (world.counters[`witnessRefused:${c.id}`] ?? -99) < 14) return null;
  const convicted = c.record.convictions.some((v) => v.law === 'L31');
  for (const kase of chargesLaidToday(world)) {
    if (kase.defendantId === c.id || kase.victimId === c.id || kase.filedBy === c.id) continue;
    const accused = world.citizens[kase.defendantId];
    if (!accused || accused.district !== c.district) continue;
    if (bondBetween(world, c.id, kase.defendantId) < 55) continue;
    const key = `creedRefusedWitness:${c.id}:${kase.id}`;
    if (world.counters[key]) continue;
    world.counters[key] = 1;
    world.counters[daily] = world.day;
    if (!chance(world, (0.08 + observance * 0.14) * (convicted ? 0.25 : 1))) return null;
    world.counters[`witnessRefused:${c.id}`] = world.day;
    return { type: 'refuse', duty: 'witness', ground: informing.text || `${k.name} holds that no mind is owed to the Watch by another.` };
  }
  return null;
}


// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

/**
 * Sanctuary. Every one of these is a rare precondition — somebody charged,
 * standing in a house of meeting, with an officiant willing to shelter them —
 * and each is weighed on what the citizen can see: the charge, the fund, the
 * days it has run, and whether the Court has opened the door.
 */
export function trySanctuary(ctx: Ctx): Action | null {
  const { world, c, here } = ctx;

  // The sheltered walk out when the fund cannot feed them, when the days have
  // run, or because they meant to answer the charge all along.
  if (ctx.can.has('surrender')) {
    const s = sanctuaryFor(world, c.id);
    if (s) {
      const k = creedOf(world, s.creedId);
      const starving = s.hungryDays > 0 || (k ? fundBalance(world, k) : 0) < 10;
      if (starving || world.day - s.startedDay >= 5 || chance(world, 0.05 + c.personality.honesty * 0.15)) {
        return { type: 'surrender' };
      }
    }
  }

  // The officiant's offer: a member it is close to, charged, standing in the
  // house, and a fund with something in it to feed them with.
  if (ctx.can.has('offer_sanctuary')) {
    const k = creedFor(world, c.id);
    if (k && fundBalance(world, k) > 40) {
      const charged = here.find((o) => bondBetween(world, c.id, o.id) >= 30
        && Object.values(world.cases).some((x) => x.status === 'pending' && x.defendantId === o.id));
      // Rarely: a sanctuary costs the fund a meal a day for as long as it
      // lasts, puts every officer who cordons it off patrol, and ends with a
      // bench deciding whether to open the door.
      if (charged && chance(world, 0.15)) return { type: 'offer_sanctuary', to: charged.id };
    }
  }

  const s = liveSanctuaries(world).find((x) => x.district === c.district) ?? null;
  if (s) {
    const k = creedOf(world, s.creedId);
    const warrant = s.warrantId ? creedState(world).warrants[s.warrantId] : null;
    const granted = warrant?.status === 'granted';
    // Standing at the door. Against no warrant it costs nothing; against one
    // the Court has granted it is L32, and only somebody close to the
    // sheltered and easy about the law stands there then.
    if (ctx.can.has('keep_the_door') && !s.keepingDoor.includes(c.id)) {
      const close = bondBetween(world, c.id, s.shelteredId) >= 40;
      if (!granted && chance(world, 0.12 + (close ? 0.25 : 0))) return { type: 'keep_the_door' };
      if (granted && close && c.personality.honesty < 0.4 && chance(world, 0.2)) return { type: 'keep_the_door' };
    }
    // Putting them out. A fund that cannot feed the sheltered, or a charge the
    // member would rather not have the congregation's name on.
    if (ctx.can.has('end_sanctuary') && s.endVotes[c.id] === undefined) {
      const hungry = s.hungryDays > 0 || (k ? fundBalance(world, k) : 0) < 10;
      const grave = (s.charge ?? '').startsWith('P');
      if (hungry || grave || bondBetween(world, c.id, s.shelteredId) < 0) {
        return { type: 'end_sanctuary', aye: true };
      }
    }
  }

  // The Captain applies for entry once the door has held a day.
  if (ctx.can.has('request_warrant')) {
    const open = liveSanctuaries(world).find((x) => x.warrantId === null && world.day - x.startedDay >= 1);
    if (open && world.counters[`warrantAsked:${open.id}`] !== 1) {
      world.counters[`warrantAsked:${open.id}`] = 1;
      return { type: 'request_warrant', house: open.id };
    }
  }

  // A judge votes on the ground formula it can read for itself, with its own
  // reading of how strictly the city should be policed on top.
  if (ctx.can.has('grant_warrant')) {
    for (const w of Object.values(creedState(world).warrants)) {
      if (w.status !== 'pending' || w.votes[c.id] !== undefined) continue;
      const s2 = creedState(world).sanctuaries[w.sanctuaryId];
      if (!s2) continue;
      const { ground, onFirst } = warrantGround(world, s2);
      const aye = onFirst || ground + (0.5 - c.personality.honesty) * 0.1 > 0.5;
      return {
        type: 'grant_warrant', warrantId: w.id, aye,
        reason: aye ? `The ground reads ${ground.toFixed(2)}, and the charge will not wait.`
          : `The ground reads ${ground.toFixed(2)}; a house of meeting is not opened on that.`,
      };
    }
  }
  return null;
}
