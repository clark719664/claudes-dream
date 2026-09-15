/**
 * The crossing nobody declared (`docs/UNDERWORLD.md` §2).
 *
 * Enforcement without evasion is scenery. A tariff nobody can dodge is
 * arithmetic and an officer who can only wave people through is a salary, so
 * this is the other side of the gate: one roll, of public terms, on the tick
 * the traveller arrives.
 *
 * ```
 * scrutiny = 0.20                        a gate is always watched
 *          + 0.12 per officer            diminishing, as detection does
 *          + 0.25 × best analysis / 100
 *          + 0.20 a conviction inside two cycles
 *          + 0.15 an open Watch investigation
 *
 * cover    = 0.15 × commerce / 100       the merchant's own trade
 *          + 0.20 a fitted wagon
 *          + 0.15 a false manifest whose declared weight matches the real one
 *          + 0.35 an officer on this shift who took the bribe
 *          + 0.25 a mountain pass or a night landing instead of the road
 *          − 0.05 per crate above four
 *          − 0.10 goods only one city makes
 *
 * p(caught) = clamp(scrutiny − cover, 0.02, 0.95)
 * ```
 *
 * The bribe is the largest term because it alone removes the person doing the
 * looking rather than making the looking harder. The pass is worth nearly as
 * much, costs four times the journey, and **closes in Frost** — so smuggling is
 * seasonal, and a council that wants to squeeze it funds the road.
 *
 * Twelve crates is −0.40 and nothing hides a caravan: **bulk trade is lawful,
 * and the pocket trade is the crime.**
 *
 * Caught is a **seizure, not an arrest**. The load goes to the Bazaar, a report
 * opens before the officer who found it, and the traveller walks away to answer
 * on the ladder. Nothing here detains anybody and nothing here can exile
 * anybody on a first conviction.
 */
import { GOODS, clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, Good, World } from '../types.ts';
import { MAX_POSSESSIONS, PRODUCTS } from '../data/catalogue.ts';
import { chance } from '../util/rng.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { outerPrice } from '../markets/outer.ts';
import { isBribedBy } from '../government/reports.ts';
import { underInvestigation } from '../government/investigations.ts';
import { isCivicLaw } from '../data/laws.ts';
import { cargoOf, gateFor, held, seizeLot } from './customs.ts';
import { holdsLiveSecret } from './espionage.ts';
import { restrictionOn } from './schedule.ts';
import { lawfulPrice, tariffOf } from './prices.ts';
import { chargeUnderworldOffence } from './offences.ts';
import type { CityKey, Crossing, SmuggleRoute } from './state.ts';
import {
  CROSSING_HISTORY, FALSE_MANIFEST, HOME_CITY, SMUGGLING, SMUGGLE_ROUTES,
  bound, cityName, hasFittedWagon, isGateBanned, underworldId, underworldState,
} from './state.ts';

/** A gate is always watched. */
export const SCRUTINY_BASE = 0.20;
/** What one more officer on the shift is worth, diminishing as detection does. */
export const SCRUTINY_PER_OFFICER = 0.12;
/** What the sharpest eye on the shift is worth. */
export const SCRUTINY_ANALYSIS = 0.25;
/** A smuggling or false-manifest conviction inside two cycles. */
export const SCRUTINY_CONVICTION = 0.20;
/** An open Watch investigation into this traveller. */
export const SCRUTINY_INVESTIGATION = 0.15;

/** The merchant's own trade. */
export const COVER_COMMERCE = 0.15;
/** A fitted wagon with a hollow. */
export const COVER_WAGON = 0.20;
/** A false manifest whose declared weight matches the real one. */
export const COVER_PAPER = 0.15;
/** An officer on this shift who took the bribe: the largest term, and why. */
export const COVER_BRIBE = 0.35;
/** A mountain pass, or a night landing instead of the road. */
export const COVER_ROUTE = 0.25;
/** Every crate above four hides worse than the last. */
export const COVER_PER_CRATE = 0.05;
export const CRATES_FREE = 4;
/** Goods only one city makes carry a maker's mark. */
export const COVER_MARKED = 0.10;
/** The Watch's own duty roster, which says which gate runs thin on which shift. */
export const COVER_ROSTER = 0.25;

export const CAUGHT_FLOOR = 0.02;
export const CAUGHT_CEILING = 0.95;

/** Cycles a conviction keeps the gate's eye on a traveller. */
export const CONVICTION_CYCLES = 2;
/** Hours that count as a night landing. */
export const NIGHT_FROM = 20;
export const NIGHT_TO = 6;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** The pass is shut in Frost, and a smuggler who wanted it waits for Bloom. */
export function passOpen(world: World): boolean {
  return world.season !== 'frost';
}

/** True at the hours a landing is a night landing. */
export function isNight(world: World): boolean {
  return world.hour >= NIGHT_FROM || world.hour < NIGHT_TO;
}

/** A conviction of smuggling or a false manifest inside two cycles. */
export function recentSmugglingConviction(world: World, c: Citizen): boolean {
  const window = CONVICTION_CYCLES * Math.max(1, world.config.cycleDays);
  // `types.ts` does not carry L26–L28 yet, so the codes are compared as the
  // plain strings the record actually holds.
  return c.record.convictions.some((k) => {
    const code: string = k.law;
    return (code === SMUGGLING || code === FALSE_MANIFEST) && world.day - k.day <= window;
  });
}

/** Goods only one city makes: a pattern, or a master-grade line with a maker's mark. */
export function carriesAMark(good: Good | null, productId: string | null): boolean {
  if (good === 'knowledge') return true;
  const p = productId ? PRODUCTS[productId] : null;
  return !!p && p.category === 'tool' && p.basePrice >= 60;
}

export interface ConcealmentTerms {
  scrutiny: number;
  cover: number;
  caught: number;
  officers: number;
  bestAnalysis: number;
  crates: number;
  bribed: boolean;
  wagon: boolean;
  paper: boolean;
  route: SmuggleRoute;
  marked: boolean;
  /** The traveller holds the Watch's duty roster and knows which gate runs thin. */
  roster: boolean;
}

export interface CrossingSpec {
  good?: Good | null;
  productId?: string | null;
  qty: number;
  route: SmuggleRoute;
  /** The other city: where the load is going, or where it came from. */
  city?: CityKey;
  /** Inbound lands a load here; outbound takes one out. */
  direction?: 'inbound' | 'outbound';
}

/**
 * The roll, in public terms. Everything in it is a fact a citizen could count
 * for themselves: who is on the gate, how sharp they are, how many crates, and
 * whether somebody has been paid.
 */
export function concealment(world: World, c: Citizen, spec: CrossingSpec): ConcealmentTerms {
  const gate = gateFor(world, c);
  const officers = gate ? gate.officers.filter((o) => o.id !== c.id) : [];
  const n = officers.length;
  // Diminishing, exactly as detection does: each officer covers what the last
  // one left, never the whole doorway again.
  const officerTerm = 1 - Math.pow(1 - SCRUTINY_PER_OFFICER, n);
  const bestAnalysis = officers.reduce((best, o) => Math.max(best, o.skills.analysis), 0);

  let scrutiny = SCRUTINY_BASE + officerTerm + SCRUTINY_ANALYSIS * bestAnalysis / 100;
  if (recentSmugglingConviction(world, c)) scrutiny += SCRUTINY_CONVICTION;
  if (underInvestigation(world, c.id)) scrutiny += SCRUTINY_INVESTIGATION;

  const s = underworldState(world);
  const paper = s.manifests.some((m) => m.travellerId === c.id && m.day === world.day && m.false && m.declaredQty === m.actualQty);
  const bribed = officers.some((o) => isBribedBy(world, o.id, c.id));
  const wagon = hasFittedWagon(world, c.id);
  const crates = Math.max(0, Math.round(spec.qty));
  const marked = carriesAMark(spec.good ?? null, spec.productId ?? null);
  const quietWay = spec.route === 'pass' || ((spec.route === 'sea' || spec.route === 'river') && isNight(world));

  const roster = holdsLiveSecret(world, c.id, 'duty_roster');
  let cover = COVER_COMMERCE * Math.max(0, Math.min(100, c.skills.commerce)) / 100;
  if (roster) cover += COVER_ROSTER;
  if (wagon) cover += COVER_WAGON;
  if (paper) cover += COVER_PAPER;
  if (bribed) cover += COVER_BRIBE;
  if (quietWay) cover += COVER_ROUTE;
  cover -= COVER_PER_CRATE * Math.max(0, crates - CRATES_FREE);
  if (marked) cover -= COVER_MARKED;

  return {
    scrutiny, cover, caught: clamp(scrutiny - cover, CAUGHT_FLOOR, CAUGHT_CEILING),
    officers: n, bestAnalysis, crates, bribed, wagon, paper, route: spec.route, marked, roster,
  };
}

/** What the load is worth where it came from, before duty and carriage. */
function originValue(world: World, good: Good | null, productId: string | null, qty: number): number {
  if (good) return Math.max(0, Math.round(outerPrice(world, good) * qty));
  if (productId && PRODUCTS[productId]) return Math.max(0, Math.round(PRODUCTS[productId].basePrice * qty));
  return 0;
}

/**
 * Attempt a crossing unmanifested. One roll; then either a seizure and a report
 * before the officer who found it, or a load that is in the city and a trace
 * nobody has read yet.
 *
 * The lumens move exactly as lawful trade's do (`markets/outer.ts`): a load
 * bought abroad is paid for out of the city's supply and a load sold abroad is
 * paid for into it, so the audit closes and the *only* thing smuggling saves is
 * the duty — which is the whole of its wage.
 */
export function smuggle(world: World, cId: CitizenId, spec: CrossingSpec): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing === 'exiled') return fail('An exile does not cross this gate.');
  if (c.lifeStage === 'child') return fail('You must be grown to run a load past a gate.');
  if (c.standing === 'suspended') return fail('You cannot trade while suspended.');
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail('You cannot cross while detained.');
  if (!SMUGGLE_ROUTES.includes(spec.route)) return fail(`There is no route called ${String(spec.route)}.`);
  if (spec.route === 'pass' && !passOpen(world)) return fail('The pass is shut with the Frost; nothing crosses it until Bloom.');

  const good = spec.good ?? null;
  const productId = spec.productId ?? null;
  if (good && !GOODS.includes(good)) return fail(`There is no such good as ${String(good)}.`);
  if (productId && !PRODUCTS[productId]) return fail(`There is no such thing as ${String(productId)}.`);
  if (!good && !productId) return fail('A crossing carries something.');
  const qty = Math.max(0, Math.round(spec.qty));
  if (qty <= 0) return fail('A crossing carries a whole number of crates.');

  const gate = gateFor(world, c);
  const overland = spec.route === 'pass';
  if (!gate && !overland) return fail('A crossing starts at a gate — the Threshold or the Docks.');
  if (!gate && overland && c.district !== 'heights' && c.district !== 'foundry_row') {
    return fail('The pass is reached from the hills above Foundry Row.');
  }

  const direction = spec.direction ?? 'inbound';
  const other = spec.city ?? 'marrowgate';
  if (direction === 'inbound' && isGateBanned(world, cId)) {
    return fail('Your name is on the register every gate reads; the road home is shut for now.');
  }
  if (direction === 'inbound' && productId && c.possessions.length + qty > MAX_POSSESSIONS) {
    return fail(`You could not carry that much: ${MAX_POSSESSIONS} things is all anybody keeps.`);
  }
  const value = originValue(world, good, productId, qty);
  if (direction === 'outbound' && held(world, c, { good, productId }) < qty) {
    return fail(`You are not carrying ${qty} of that.`);
  }
  if (direction === 'inbound' && c.wallet < value) {
    return fail(`That load costs ${value} ℓ where it is bought; you have ${Math.floor(c.wallet)} ℓ.`);
  }

  // The load, and what the schedule of the city it is crossing into says of it.
  const into: CityKey = direction === 'inbound' ? HOME_CITY : other;
  const line = cargoOf(world, c, good, productId, qty, value);
  const restriction = restrictionOn(world, into, line, { direction: direction === 'inbound' ? 'inbound' : 'outbound', declared: false });

  const terms = concealment(world, c, { ...spec, qty });
  const caught = chance(world, terms.caught);

  // Move the load. Bought abroad it is paid for out of the supply; sold abroad
  // it is paid for into it — the same two legs `markets/outer.ts` uses.
  //
  // A load stopped on its way *out* never goes: it is standing at the gate when
  // the officer opens it, so nobody abroad pays for it and the seizure below
  // takes it out of the smuggler's hands. A load stopped on its way *in* was
  // already bought, and its owner loses the lumens and the crates both.
  if (direction === 'inbound') {
    if (value > 0 && !transfer(world, cId, 'burn', value, 'import', `${qty} ${good ?? productId} bought in ${cityName(other)}`)) {
      return fail('The load could not be paid for.');
    }
    if (good) c.inventory[good] += qty;
    else if (productId) {
      for (let i = 0; i < qty; i++) c.possessions.push({ id: nextId(world, 'i'), productId, acquiredDay: world.day });
    }
  } else if (!caught) {
    if (good) c.inventory[good] -= qty;
    else if (productId) {
      let left = qty;
      for (let i = c.possessions.length - 1; i >= 0 && left > 0; i--) {
        if (c.possessions[i].productId !== productId) continue;
        c.possessions.splice(i, 1);
        left--;
      }
    }
    if (value > 0) transfer(world, 'mint', cId, value, 'export', `${qty} ${good ?? productId} sold in ${cityName(other)}`);
  }

  const s = underworldState(world);
  s.crossingsToday += 1;
  const officer = gate?.officers.find((o) => o.id !== cId) ?? null;
  const crossing: Crossing = {
    id: underworldId(world, 'x'), travellerId: cId,
    from: direction === 'inbound' ? other : HOME_CITY, to: into,
    good, productId, qty, value, route: spec.route, crates: terms.crates,
    scrutiny: Math.round(terms.scrutiny * 100) / 100, cover: Math.round(terms.cover * 100) / 100,
    caught, officerId: officer?.id ?? null, restriction: restriction?.severity ?? 0,
    seizedValue: 0, reportId: null, day: world.day, tick: world.tick,
  };
  s.crossings.push(crossing);
  bound(s.crossings, CROSSING_HISTORY);

  const evaded = Math.round(tariffOf(world, into) * lawfulPrice(world, line));
  const what = `${qty} ${good ?? (productId ? PRODUCTS[productId].name : 'crates')}`;

  if (!caught) {
    // Nobody saw it. The offence is on the record undetected, which is exactly
    // what a detective reads when they look around (`investigations.ts`).
    chargeUnderworldOffence(world, cId, SMUGGLING, {
      quiet: true, amount: evaded,
      description: `${c.name} ran ${what} past ${cityName(into)}'s gate by the ${spec.route}`,
    });
    remember(world, cId, 'money', `You ran ${what} past the gate by the ${spec.route}; nobody stopped you, `
      + `and ${evaded} ℓ of duty stayed in your pocket.`);
    return ok(`You crossed with ${what} unmanifested. Nobody read anything; ${evaded} ℓ of duty went unpaid.`);
  }

  const seized = seizeLot(world, officer?.id ?? null, cId, line);
  crossing.seizedValue = seized.value;
  const aggravated = (restriction?.severity ?? 0) >= 3;
  const reportId = chargeUnderworldOffence(world, cId, SMUGGLING, {
    proved: true, amount: seized.value || value, officerId: officer?.id ?? null,
    description: `${c.name} ran ${what} past ${cityName(into)}'s gate by the ${spec.route}`
      + `${restriction ? ` against the schedule (${restriction.subject})` : ''}; the load was seized`,
  });
  crossing.reportId = reportId;
  emit(world, 'outer', `${what} was seized from ${c.name} at ${gate?.name ?? 'the pass'}: `
    + `an unmanifested crossing${aggravated ? ' of a gravely restricted line' : ''}.`,
  officer ? [cId, officer.id] : [cId], 0.7,
  { crossing: crossing.id, seized: seized.value, aggravated, restriction: restriction?.id ?? null, reportId });
  return ok(`You were stopped at the gate: ${seized.qty} seized, worth ${seized.value} ℓ.`
    + `${reportId ? ` The Watch holds a report (${reportId}).` : ''}`);
}

/** The crossings this citizen has attempted, newest first. */
export function crossingsBy(world: World, cId: CitizenId): Crossing[] {
  return underworldState(world).crossings.filter((x) => x.travellerId === cId).reverse();
}

/**
 * The public terms of the roll, written out. A citizen deciding whether to try
 * can count every one of them; so can the officer, and so can the Chronicle.
 */
export function concealmentLine(terms: ConcealmentTerms): string {
  const parts = [`${terms.officers} officer${terms.officers === 1 ? '' : 's'} on the gate`];
  if (terms.bestAnalysis > 0) parts.push(`the sharpest at ${Math.round(terms.bestAnalysis)} analysis`);
  parts.push(`${terms.crates} crate${terms.crates === 1 ? '' : 's'}`);
  if (terms.wagon) parts.push('a fitted wagon');
  if (terms.paper) parts.push('a manifest that matches the weight');
  if (terms.bribed) parts.push('an officer who has been paid');
  if (terms.marked) parts.push("a maker's mark on the load");
  if (terms.roster) parts.push("the Watch's own duty roster");
  return `${parts.join(', ')} — ${Math.round(terms.caught * 100)} in 100 of being stopped.`;
}

/** True where the code names one of the offences the gate charges. */
export function isGateOffence(code: string): boolean {
  return isCivicLaw(code) && (code === SMUGGLING || code === FALSE_MANIFEST);
}
