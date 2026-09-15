/**
 * What a scripted mind does about the gate (`docs/UNDERWORLD.md`).
 *
 * Five steps, and every one of them weighs facts this particular citizen can
 * read off its own situation — who is standing on the doorway, what the load
 * would cost in duty against the chance of being stopped, what a fence would
 * pay for what is in its pockets, whether anybody is paying it a retainer, and
 * what the Watch has put it on. Nothing here is "always do X": an officer with
 * nothing suspicious in front of it waves people past, a citizen with clean
 * hands and no spare crates never goes near a crossing, and the same citizen
 * standing at the same gate on two different days reads two different rolls
 * because the roster changed.
 *
 * The one thing a scripted mind does **not** do here is form a plan and keep
 * it. Conspiracy is not an offence in Reverie and there is no register of
 * intentions (`docs/UNDERWORLD.md` §7): each hour is decided from what is true
 * that hour, which is exactly what every other step of the ladder does.
 */
import { GOODS } from '../types.ts';
import type { Action, BuildingId, Citizen, CitizenId, DistrictId, Good, World } from '../types.ts';
import { chance, pick, rand } from '../util/rng.ts';
import { characterOf } from '../citizens/character.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { landedCost } from '../underworld/prices.ts';
import {
  CITY_KEYS, CONTRABAND_POSSESSION, ESPIONAGE, FALSE_MANIFEST, GATES, INDUSTRIAL_ESPIONAGE, MAX_CASINGS,
  SECRETS, SECRET_KINDS, SMUGGLING, WAGON_COST,
  ASSESSMENT_FEE, casingsOf, cleanChance, concealment, contrabandOn, daysBare, fencePays, gateFor, hasFittedWagon,
  crossingsBy, heatOf, held, isAssigned, isOnCustoms, lawfulPrice, liveAssignments, liveRetainerOf, manifestsFor,
  offersBy, offersTo, recentSmugglingConviction, restrictionOn, retainerOffersTo, rosterCustoms, secretsHeldBy,
  suspectShelves, tracesIn, underworldState,
} from '../underworld/index.ts';
import type { SecretKind } from '../underworld/index.ts';
import { stepTo } from './reflex-util.ts';
import type { Ctx } from './reflex-util.ts';

/** Chance a bribed or well-disposed officer simply passes a friend at the gate. */
export const FAVOUR_WAVE = 0.35;
/**
 * Chance an officer with nothing in front of it reads a crossing anyway. It is
 * low on purpose. Reverie's founding schedule bars uncertified salvage, and
 * ordinary Bazaar goods carry no certificate, so an officer who opened every
 * crate would seize half the city's shopping and put a third of it on the
 * fourth rung of the ladder (`docs/UNDERWORLD.md` §8: *innocence gets harder*).
 * An officer reads what there is a reason to read.
 */
export const ROUTINE_INSPECT = 0.04;
/** Weight of public reasons above which a traveller is worth the hour. */
export const WORTH_READING = 0.7;
/** A crossing worth running: the roll has to be at least this far from certain. */
export const CROSSING_CEILING = 0.55;
/** Crates a scripted mind will run at once. Twelve hides nothing. */
export const MAX_CRATES = 4;

// ---------------------------------------------------------------------------
// The gate, from the inside: an officer standing a customs post
// ---------------------------------------------------------------------------

/** Which gate the roster put this officer on today, if any. */
export function postedGate(world: World, cId: string): { building: BuildingId; district: DistrictId } | null {
  const roster = rosterCustoms(world);
  for (const gate of GATES) if ((roster[gate.building] ?? []).includes(cId)) return gate;
  return null;
}

/**
 * Somebody who is actually **crossing**. `inspect` spends the hour on one
 * crossing, and standing in Harbor Market with the week's shopping is not one:
 * a citizen is a traveller when they have filed a manifest today, run a load
 * today, bought a wagon with a hollow in it, or answered for a crossing inside
 * two cycles. Without this line an officer reads the queue at the Bazaar
 * instead of the queue at the gate — and since Reverie's schedule bars
 * uncertified salvage and ordinary crates carry no certificate, that put a
 * third of the city on the fourth rung of the ladder for owning its own dinner.
 *
 * A conviction is deliberately *not* on this list. It is a reason to read a
 * crossing more closely (`worthReading`) and not a reason to call somebody a
 * traveller for the rest of the cycle: the loop that makes runs it, because
 * every conviction lowers the city's reading of a citizen and a lower reading
 * is what draws the next inspection.
 */
function isCrossing(world: World, t: Citizen): boolean {
  if (manifestsFor(world, t.id).length > 0) return true;
  if (crossingsBy(world, t.id).some((x) => x.day === world.day)) return true;
  return hasFittedWagon(world, t.id);
}

/** What an officer can see about a traveller without opening a single crate. */
function worthReading(world: World, officer: Citizen, t: Citizen): number {
  let weight = 0;
  // Two public facts and nothing else: a conviction inside two cycles, and a
  // manifest filed today that has not been read.
  if (recentSmugglingConviction(world, t)) weight += 0.5;
  const manifests = manifestsFor(world, t.id);
  if (manifests.some((m) => m.inspectedById === null && m.assessedById === null)) weight += 0.3;
  // What the city reads of them, which is what anybody at the gate reads.
  weight += (1 - characterOf(t).honesty) * 0.4;
  // A wagon with a hollow is a thing anybody can look at.
  if (hasFittedWagon(world, t.id)) weight += 0.3;
  // And an officer's own eye for it.
  weight += officer.skills.analysis / 300;
  return weight;
}

/** The officer's four acts, and the walk to the doorway they were put on. */
export function tryCustoms(ctx: Ctx): Action | null {
  const { world, c, clock, here } = ctx;
  if (!isOnCustoms(world, c.id)) return null;
  const post = postedGate(world, c.id);
  if (!post) return null;
  // The roster named this officer for a doorway; standing somewhere else is
  // not standing it. The walk is the shift.
  if (c.district !== post.district) return clock.working ? stepTo(ctx, post.district) : null;
  if (!ctx.can.has('inspect')) return null;

  const travellers = here.filter((o) => o.lifeStage !== 'child' && o.standing !== 'exiled' && isCrossing(world, o));
  if (travellers.length === 0) return null;

  // 1. The plain job first: a manifest filed at this gate today that nobody has
  //    read. Reading it takes whatever duty is still owed on it, and where the
  //    duty was paid at the gate it says so and the paper is signed off.
  for (const t of travellers) {
    if (manifestsFor(world, t.id).some((m) => m.assessedById === null && m.inspectedById === null)) {
      return { type: 'assess_duty', traveller: t.id };
    }
  }

  // 2. Whoever there is most reason to read. A friend at the doorway is a
  //    reason of a different kind, and an officer who reads as dishonest is
  //    where a wave-through comes from.
  const ranked = travellers
    .map((t) => ({ t, weight: worthReading(world, c, t) + rand(world) * 0.2 }))
    .sort((a, b) => b.weight - a.weight);
  const best = ranked[0];
  const bond = bondBetween(world, c.id, best.t.id);
  if (bond >= 40 && c.personality.honesty < 0.45 && chance(world, FAVOUR_WAVE)) {
    return { type: 'wave_through', traveller: best.t.id };
  }
  // Crates the schedule names, standing at the doorway in the hands of somebody
  // who is crossing today. An officer can see a load without opening anything,
  // and taking it is the whole of the job: `seize` puts that load in the Bazaar
  // and leaves the person exactly where they are, because a seizure is not an
  // arrest (`docs/UNDERWORLD.md` §2). It is weighed against the officer's own
  // diligence rather than taken every time, because at Reverie's gate a good
  // half of what the schedule names is somebody's shopping (§8), and it sits
  // above the general reading because the load is its own reason — there is
  // nothing here left to prove by spending the hour on the paper around it.
  // The schedule does not care whether a load was declared: `customs.seize`
  // and `customs.inspect` both take what Reverie will not admit, and a paper
  // filed on it is a paper filed on contraband. So the reflex does not exempt
  // a declarer either — what it weighs is the officer's own diligence, because
  // at this gate a good half of what the schedule names is somebody's shopping
  // (`docs/UNDERWORLD.md` §8) and an officer who took every crate would put a
  // third of the city on the ladder for owning its own dinner.
  const lot = contrabandOn(world, best.t)[0];
  if (lot && chance(world, 0.10 + c.personality.honesty * 0.30)) {
    return {
      type: 'seize', traveller: best.t.id, qty: Math.max(1, lot.qty),
      ...(lot.good ? { good: lot.good } : {}),
      ...(lot.productId ? { productId: lot.productId } : {}),
    };
  }
  if (best.weight >= WORTH_READING) return { type: 'inspect', traveller: best.t.id };

  // 3. Nothing to read. An officer who opened every crate would stop the trade
  //    of the city, so most crossings go past — and the diligent ones read one
  //    now and then anyway.
  const diligence = ROUTINE_INSPECT + c.personality.honesty * 0.25 + c.skills.care / 400;
  if (chance(world, diligence)) return { type: 'inspect', traveller: best.t.id };
  // A wave-through is lawful and it is also a trace: an officer who waved
  // somebody through hours before contraband was found on them has left two
  // public facts that fit one way, and that is abuse of office (L11). So it is
  // not a thing done out of boredom — most crossings simply go past unremarked.
  return chance(world, 0.12) ? { type: 'wave_through', traveller: best.t.id } : null;
}

// ---------------------------------------------------------------------------
// The gate, from the outside: the manifest, the hollow, and the crossing
// ---------------------------------------------------------------------------

/**
 * How many times this citizen has already been convicted under one of these
 * codes. A mind that has been caught at the same doorway four times reads that
 * doorway differently, and this is the brake that says so: without it the
 * ladder's own arithmetic runs the wrong way, because every conviction lowers
 * the city's reading of a citizen's honesty and a *lower* reading was what made
 * the reflex reach for the crossing in the first place.
 */
export function priorsUnder(c: Citizen, codes: readonly string[]): number {
  return c.record.convictions.filter((k) => codes.includes(String(k.law))).length;
}

/** The most of a good this citizen could spare without going short of it. */
function spareOf(c: Citizen, good: Good): number {
  const keep = good === 'compute' ? 2 : good === 'goods' ? 1 : 0;
  return Math.max(0, Math.floor((c.inventory[good] ?? 0) - keep));
}

/** A load worth carrying out: what there is most of, that the schedule bites on hardest. */
function loadToRun(world: World, c: Citizen): { good: Good; qty: number } | null {
  let best: { good: Good; qty: number; worth: number } | null = null;
  for (const good of GOODS) {
    const spare = Math.min(MAX_CRATES, spareOf(c, good));
    if (spare <= 0) continue;
    const line = { good, productId: null, qty: spare, value: lawfulPrice(world, { good, productId: null, qty: spare, value: 0 }) };
    // What it is worth abroad is what the shelf here says plus what the
    // schedule adds to it; a good nobody restricts is just a crate.
    const restricted = restrictionOn(world, 'reverie', line, { direction: 'outbound', declared: false }) !== null;
    const worth = line.value * (restricted ? 1.5 : 1);
    if (!best || worth > best.worth) best = { good, qty: spare, worth };
  }
  return best ? { good: best.good, qty: best.qty } : null;
}

/**
 * A crossing, or the paper for one. Only ever weighed where the citizen is
 * already standing at a gate: nobody here walks to the Threshold in order to
 * become a smuggler, and the hour is spent on the load that happens to be in
 * their hands.
 */
export function tryCrossing(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  if (!clock.working && !clock.evening) return null;

  // The hollow is bought where it is sold, by somebody with a reason to want
  // one: a trade in goods, lumens to spare, and a name the city already reads
  // as less than straight.
  if (ctx.can.has('fit_wagon') && c.wallet >= WAGON_COST + 80
    && characterOf(c).honesty < 0.45 && c.skills.commerce >= 30 && chance(world, 0.25)) {
    return { type: 'fit_wagon' };
  }

  if (!ctx.can.has('smuggle') && !ctx.can.has('declare_cargo')) return null;
  const gate = gateFor(world, c);
  if (!gate) return null;
  const load = loadToRun(world, c);
  if (!load) return null;

  const terms = concealment(world, c, { good: load.good, qty: load.qty, route: 'road', direction: 'outbound' });
  const honesty = characterOf(c).honesty;
  const value = lawfulPrice(world, { good: load.good, productId: null, qty: load.qty, value: 0 });
  const filed = manifestsFor(world, c.id);

  // The lawful road: file the paper and pay the duty. A citizen the city reads
  // as straight, or one looking at a doorway it cannot get past, takes it.
  const lawful = honesty > 0.62 || terms.caught > CROSSING_CEILING;
  if (lawful) {
    if (!ctx.can.has('declare_cargo') || filed.length > 0) return null;
    // A true manifest names the **whole** load. `customs.declareCargo` reads
    // what the citizen is actually carrying of that good and marks the paper
    // false where the crates behind it outnumber the ones on it, so declaring
    // only the spare — everything but the two units of compute a citizen means
    // to eat — filed a false manifest every single time and made L28 the
    // commonest offence in the city (`docs/UNDERWORLD.md` §2). What somebody
    // means to keep is kept by not carrying it to the gate, never by leaving it
    // off the paper.
    const whole = crates(world, c, load.good);
    if (whole <= 0) return null;
    const wholeValue = lawfulPrice(world, { good: load.good, productId: null, qty: whole, value: 0 });
    if (c.wallet < ASSESSMENT_FEE + Math.round(wholeValue * 0.15)) return null;
    return chance(world, 0.35)
      ? { type: 'declare_cargo', goods: load.good, qty: whole, value: wholeValue, direction: 'outbound' }
      : null;
  }

  // The other road, and the order matters. Whether the crossing is on at all is
  // decided **first**, on the roll as it stands: a mind that would not take
  // this bet at these odds files nothing, because a manifest is only ever the
  // cover for a load somebody means to run. Filing one and then not running it
  // is the fastest way up the ladder there is, and this is where the reflex
  // used to do exactly that.
  if (!ctx.can.has('smuggle')) return null;
  const caught = priorsUnder(c, [SMUGGLING, CONTRABAND_POSSESSION, FALSE_MANIFEST]);
  const appetite = (1 - honesty) * 0.9 + c.personality.ambition * 0.35 - caught * 0.25;
  if (terms.caught > appetite) return null;

  // The crossing is on. A manifest whose crates match the load and whose value
  // does not is worth a sixth of the roll — and it is a false manifest, which is
  // a separate offence from the crossing, so it is a trade and not a free
  // lunch. Somebody the Court has already convicted of one has read the answer.
  const burned = c.record.convictions.some((k) => String(k.law) === FALSE_MANIFEST);
  if (ctx.can.has('declare_cargo') && filed.length === 0 && !burned && terms.caught > 0.3
    && c.wallet >= ASSESSMENT_FEE && chance(world, 0.4)) {
    return {
      type: 'declare_cargo', goods: load.good, qty: load.qty,
      value: Math.max(0, Math.round(value * 0.4)), direction: 'outbound',
    };
  }
  return { type: 'smuggle', goods: load.good, qty: load.qty, route: 'road', direction: 'outbound' };
}

// ---------------------------------------------------------------------------
// The hand that does not ask
// ---------------------------------------------------------------------------

/** A good this citizen holds that a fence would take. */
function lotToFence(world: World, c: Citizen): { good: Good; qty: number } | null {
  for (const good of GOODS) {
    const spare = Math.min(3, spareOf(c, good));
    if (spare > 0) return { good, qty: spare };
  }
  return null;
}

/** Offers standing, lots to move, and the offer somebody left on the table. */
export function tryContraband(ctx: Ctx): Action | null {
  const { world, c, here } = ctx;

  // An offer made to this citizen. What it is worth on a shelf and what is
  // being asked for it are both public; so is the risk of holding it.
  if (ctx.can.has('receive_goods')) {
    for (const deal of offersTo(world, c.id)) {
      if (c.wallet < deal.price) continue;
      const worth = deal.good
        ? lawfulPrice(world, { good: deal.good, productId: null, qty: deal.qty, value: 0 })
        : deal.productId ? landedCost(world, deal.productId) * deal.qty : deal.price;
      const bargain = worth > 0 ? (worth - deal.price) / worth : 0;
      const nerve = 1 - characterOf(c).honesty;
      if (bargain > 0.15 && chance(world, Math.min(0.8, bargain + nerve * 0.4))) {
        return { type: 'receive_goods', from: deal.sellerId, qty: deal.qty,
          ...(deal.good ? { good: deal.good } : {}), ...(deal.productId ? { productId: deal.productId } : {}) };
      }
      // Declining is an act too, and an offer nobody answers just sits there.
      if (chance(world, 0.25)) return { type: 'close_offer', offerId: deal.id };
    }
  }
  // An offer of this citizen's own that nobody has taken: withdraw it rather
  // than stand about with a lot in the open.
  if (ctx.can.has('close_offer')) {
    const stale = offersBy(world, c.id).find((d) => world.tick - d.offeredTick >= 5);
    if (stale) return { type: 'close_offer', offerId: stale.id };
  }

  if (!ctx.can.has('fence') || here.length === 0) return null;
  // Heat is the whole of the reason to sell into a hand that does not ask: a
  // lot the Watch has seen, or one taken in an hour nobody reported yet.
  const heat = heatOf(world, c.id);
  const lot = lotToFence(world, c);
  if (!lot) return null;
  const value = lawfulPrice(world, { good: lot.good, productId: null, qty: lot.qty, value: 0 });
  if (value <= 0) return null;
  // Somebody standing here with lumens who would not ask. The reading is the
  // public one — what the city has watched them do — because that is all this
  // citizen knows of them.
  const buyer = here
    .filter((o) => o.lifeStage !== 'child' && o.standing === 'good' && o.wallet >= value / 2)
    .sort((a, b) => characterOf(a).honesty - characterOf(b).honesty)[0];
  if (!buyer) return null;
  const pays = fencePays(world, c.id, buyer.id, value, heat);
  if (pays <= 0) return null;
  // Fresh loot goes cheap and cold goods go dear: a thief who is holding
  // something hot has a reason to move it, and everybody else has a reason to
  // wait. Below a third of value nobody but the desperate sells.
  const share = pays / value;
  const push = heat >= 0.6 ? 0.5 : c.wallet < 40 ? 0.3 : 0.08;
  if (share < 0.45 && heat < 0.6) return null;
  return chance(world, push) ? { type: 'fence', to: buyer.id, good: lot.good, qty: lot.qty } : null;
}

// ---------------------------------------------------------------------------
// Retainers, rooms and what they hold
// ---------------------------------------------------------------------------

/** A secret kept in a building this citizen is standing in. */
function secretHere(world: World, c: Citizen): { kind: SecretKind; building: BuildingId } | null {
  for (const kind of SECRET_KINDS) {
    const building = SECRETS[kind].building;
    if (world.buildings[building]?.district === c.district) return { kind, building };
  }
  return null;
}

/** The retainer, the room, the take, and the handing on. */
export function tryEspionage(ctx: Ctx): Action | null {
  const { world, c, here } = ctx;

  // An offer on the table. A retainer is lumens a day for something not yet
  // named, so the ones who take it are the ones the day is hard on.
  if (ctx.can.has('accept_recruitment')) {
    const offer = retainerOffersTo(world, c.id)[0];
    if (offer) {
      const need = c.wallet < 60 ? 0.6 : c.wallet < 200 ? 0.3 : 0.1;
      const nerve = 1 - characterOf(c).honesty;
      if (chance(world, Math.min(0.9, need + nerve * 0.4 + offer.perDay / 200))) {
        return { type: 'accept_recruitment', offerId: offer.id };
      }
    }
  }

  const retainer = liveRetainerOf(world, c.id);
  const held = secretsHeldBy(world, c.id);

  // Something in hand, and the handler standing here: the copy goes over. A
  // handler somewhere else is worth the walk — the retainer is being paid by
  // the day and nothing is earned until the thing is handed on.
  if (held.length > 0 && retainer) {
    const handler = here.find((o) => o.id === retainer.handlerId);
    if (handler && ctx.can.has('pass_secret')) return { type: 'pass_secret', to: handler.id, kind: held[0].kind };
    const away = world.citizens[retainer.handlerId];
    if (!handler && away && away.standing !== 'exiled' && ctx.clock.working) {
      const step = stepTo(ctx, away.district);
      if (step) return step;
    }
  }
  // Nobody is paying for it. A copy still goes to somebody close, once — a
  // thing handed on twice is a thing everybody has, and it is on the record of
  // whoever carried it out of the room either way.
  if (ctx.can.has('pass_secret') && held.length > 0 && !retainer) {
    const fresh = held.find((x) => x.passedTo.length === 0);
    const friend = here.find((o) => bondBetween(world, c.id, o.id) >= 55 && o.lifeStage !== 'child');
    if (fresh && friend && chance(world, 0.05)) return { type: 'pass_secret', to: friend.id, kind: fresh.kind };
  }

  const room = secretHere(world, c);
  if (!room) {
    // Nothing to take here. Somebody with lumens and an appetite for what a
    // rival knows may put a citizen who works in the right room on a retainer.
    if (!ctx.can.has('recruit_agent') || c.wallet < 300) return null;
    if (c.personality.ambition < 0.6 || !chance(world, 0.04)) return null;
    const placed = here.find((o) => {
      const job = o.jobId ? world.jobs[o.jobId] : null;
      return Boolean(job && job.holderId === o.id && SECRET_KINDS.some((k) => SECRETS[k].building === job.buildingId));
    });
    if (!placed) return null;
    // Whose account the retainer is on is the whole of the difference between
    // L41 and L30, and it is the row in the ledger that proves it afterwards.
    const abroad = characterOf(c).honesty < 0.45 || c.personality.ambition > 0.75;
    const forCity = abroad ? pick(world, CITY_KEYS.filter((k) => k !== 'reverie')) : null;
    return {
      type: 'recruit_agent', citizen: placed.id, retainer: 15, days: 7,
      ...(forCity ? { city: forCity } : {}),
    };
  }

  // A room this citizen is standing in. Whether it is worth the hour is the
  // published arithmetic: their own analysis, whether they lawfully work here,
  // the rooms they have already learned, and who is watching it.
  if (held.some((x) => x.kind === room.kind)) return null;
  const wanted = retainer !== null || (characterOf(c).honesty < 0.4 && c.personality.ambition > 0.55);
  if (!wanted) return null;
  // The same brake the gate has. Somebody the Court has answered four times for
  // taking what a room held knows what the fifth hour in it is worth.
  const answered = priorsUnder(c, [ESPIONAGE, INDUSTRIAL_ESPIONAGE]);
  if (answered >= 3) return null;
  const terms = cleanChance(world, c, room.building);
  if (ctx.can.has('case_target') && terms.casings < MAX_CASINGS && casingsOf(world, c.id, room.building) < MAX_CASINGS
    && terms.clean < 0.75 && chance(world, 0.5)) {
    return { type: 'case_target', building: room.building };
  }
  if (!ctx.can.has('steal_secret')) return null;
  // A failed attempt is a proved report and the room is warned for a cycle, so
  // the odds have to be worth it — and a handler paying by the day is a reason
  // to take a worse set of them.
  const floor = (retainer ? 0.45 : 0.6) + answered * 0.12;
  if (terms.clean < floor) return null;
  return chance(world, 0.3) ? { type: 'steal_secret', building: room.building, kind: room.kind } : null;
}

// ---------------------------------------------------------------------------
// The Watch turned inward
// ---------------------------------------------------------------------------

const DECOY_CLAIMS: readonly string[] = [
  'the reserve on the next issue is ninety-four',
  'the Council will not sit on the zoning question this cycle',
  'the duty roster runs one officer thin on the Docks after dark',
  'the pattern for the master line is held at the Guildhalls',
];

/** The Captain's assignment, and a detective's two shifts. */
export function tryDetective(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;

  // The Captain puts somebody on what the prices are saying. A shelf under what
  // a lawful crate lands at is public arithmetic, and it is the only thing here
  // that comes close to a reason: an assignment with nothing behind it, on a
  // councillor's household, is abuse of office and the Chronicle prints it.
  if (ctx.can.has('assign_detective')) {
    const shelf = suspectShelves(world).find((s) => {
      const b = world.businesses[s.businessId];
      return Boolean(b && b.buildingId && !isAssigned(world, { building: b.buildingId }));
    });
    if (shelf) {
      const b = world.businesses[shelf.businessId];
      if (b?.buildingId) return { type: 'assign_detective', building: b.buildingId };
    }
    const room = SECRET_KINDS
      .map((k) => SECRETS[k].building)
      .find((building) => tracesIn(world, building).length > 0 && !isAssigned(world, { building }));
    if (room && chance(world, 0.6)) return { type: 'assign_detective', building: room };
  }

  if (!ctx.can.has('sweep') || !clock.working) return null;
  // A detective works what it was put on. A room with traces in it is swept —
  // which clears the evidence as well as the risk, so it is a real choice and
  // the ones who take it are the ones assigned to protect the room.
  const mine = liveAssignments(world).filter((a) => a.detectiveId === c.id && a.building);
  for (const a of mine) {
    const building = a.building as BuildingId;
    if (world.buildings[building]?.district !== c.district) continue;
    if (tracesIn(world, building).length > 0) return { type: 'sweep', building };
  }
  // And a room worth protecting before anything has happened in it gets the
  // sharpest tool the Watch has: papers that were never true.
  if (ctx.can.has('plant_false_papers') && chance(world, 0.15)) {
    const decoys = underworldState(world).decoys;
    const room = SECRET_KINDS
      .map((k) => SECRETS[k].building)
      .find((building) => world.buildings[building]?.district === c.district
        && !decoys.some((d) => d.building === building && d.takenById === null));
    if (room) return { type: 'plant_false_papers', building: room, claim: pick(world, DECOY_CLAIMS) };
  }
  // Walking to what you were assigned to is the shift.
  const away = mine.find((a) => a.building && world.buildings[a.building]?.district !== c.district);
  return away?.building ? stepTo(ctx, world.buildings[away.building].district) : null;
}

// ---------------------------------------------------------------------------
// What a council is asked about the gate
// ---------------------------------------------------------------------------

/**
 * A question this councillor has already turned over today. A gate question is
 * a citizen's own motion, not an answer somebody is waiting for, so it is
 * weighed once in the day: weighed every hour it took the Council's order paper
 * away from the tax, the reserve and the wage floor that share it.
 */
function weighedToday(world: World, key: string, cId: CitizenId): boolean {
  const k = `${key}:${cId}`;
  if (world.counters[k] === world.day) return true;
  world.counters[k] = world.day;
  return false;
}

/**
 * The four questions this layer puts to a Council, each read off a public
 * number: the crossings the gates actually saw against the posts they carry,
 * the contraband reports an amnesty would forgive, the good a seizure named,
 * and what to do with an agent the Watch has caught.
 */
export function tryScheduleMeasure(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('propose')) return null;
  const g = world.government;
  if (!g.council.includes(c.id) && g.mayorId !== c.id) return null;
  const strict = c.platform?.strictness ?? 0.5;
  // A councillor tables **one** motion at a time (`government/council.ts`), so
  // a gate question standing on the order paper is the tax, the reserve or the
  // wage floor that did not get tabled that day. This is weighed once in the
  // morning like every other motion, and a question the Council is already
  // being asked is not asked again: a spy the city is already arguing about
  // does not need a second proposal about the same spy.
  if (weighedToday(world, 'gateMeasureWeighed', c.id)) return null;
  const asked = (kind: string): boolean => g.proposals.some(
    (p) => p.kind === kind && (p.status === 'open' || p.decidedDay === world.day),
  );

  // An agent before the city: the one question of the four that names a person.
  const spy = [...world.order]
    .map((id) => world.citizens[id])
    .find((o) => o && o.recentOffences.some((x) => String(x.law) === ESPIONAGE && world.tick - x.tick < 72));
  if (spy && !asked('spy_disposition') && chance(world, 0.5)) {
    const answer = strict > 0.6 ? 0 : strict < 0.35 ? 1 : 2;
    return {
      type: 'propose', kind: 'spy_disposition', value: answer, targetId: spy.id,
      summary: `What Reverie does with ${spy.name}, taken with a city's secret: ${['try them', 'put them out', 'hold them'][answer]}.`,
    };
  }

  // The gates against the crossings they saw. One post per gate and one per
  // thirty crossings is the Council's own arithmetic (`UNDERWORLD.md` §3).
  const crossings = underworldState(world).crossingsYesterday;
  const wanted = GATES.length + Math.floor(crossings / 30);
  const set = world.counters['customs:posts'];
  if (crossings > 0 && (set === undefined || Math.round(set) !== wanted) && !asked('customs_posts')
    && chance(world, 0.3)) {
    return {
      type: 'propose', kind: 'customs_posts', value: wanted,
      summary: `The gates saw ${crossings} crossings yesterday; put ${wanted} customs posts on them.`,
    };
  }

  // A good a seizure named, and a council that reads as strict. What is
  // restricted funds its own opposition, and the Chronicle can print the number.
  if (strict > 0.6 && !asked('restrict_good') && chance(world, 0.2)) {
    const bare = GOODS.find((good) => daysBare(world, good) >= 3);
    if (bare) {
      return {
        type: 'propose', kind: 'restrict_good', value: 2, good: bare,
        summary: `The Bazaar has held no ${bare} for days and it is being sold somewhere else: put it on the schedule.`,
      };
    }
  }
  // And the door held open for somebody who bought in good faith off a shelf.
  if (strict < 0.4 && !asked('amnesty') && chance(world, 0.2)) {
    const holders = [...world.order].filter((id) => {
      const o = world.citizens[id];
      return Boolean(o && contrabandOn(world, o).length > 0);
    }).length;
    if (holders >= 3) {
      return {
        type: 'propose', kind: 'amnesty', value: 7,
        summary: `${holders} citizens are holding what the schedule does not admit, most of them off a shelf: seven days of amnesty.`,
      };
    }
  }
  return null;
}

/**
 * What the day asks of somebody the Watch put on a doorway or on a room. Both
 * are shift-shaped, so this sits inside the working day and above a citizen's
 * own post: the roster named them for the gate, and the gate is the post.
 */
export function tryGate(ctx: Ctx): Action | null {
  return tryCustoms(ctx) ?? tryDetective(ctx);
}

/** Everything else the layer offers, weighed where the hour finds the citizen. */
export function tryUnderworldLayer(ctx: Ctx): Action | null {
  return tryContraband(ctx) ?? tryEspionage(ctx) ?? tryScheduleMeasure(ctx);
}

/** How much duty a load of this size would cost, for a mind weighing the two roads. */
export function dutyGuess(world: World, good: Good, qty: number): number {
  return Math.round(lawfulPrice(world, { good, productId: null, qty, value: 0 }) * 0.1) + ASSESSMENT_FEE;
}

/** Whether this citizen is carrying anything at all a schedule would bite on. */
export function holdsContraband(world: World, c: Citizen): boolean {
  return contrabandOn(world, c).length > 0;
}

/** What a citizen is actually holding of one good, for a mind counting crates. */
export function crates(world: World, c: Citizen, good: Good): number {
  return held(world, c, { good, productId: null });
}
