/**
 * The gate: the manifest, the duty, and the four things an officer standing at
 * one may do (`docs/UNDERWORLD.md` §2, §3).
 *
 * **Customs is a job, and the officer is a citizen.** A customs officer is a
 * Watch officer working a doorway, at the analysis and the wage the schedule
 * asks for, and every hour they spend at the gate is an hour they chose to
 * spend there. They may `inspect` a crossing, `assess_duty` on a manifest,
 * `seize` what the schedule does not admit, or `wave_through` — which is
 * lawful, is sometimes the right call, and is exactly what a bribe buys.
 *
 * A **bounty** of 5 % of what an officer seizes, capped at a day's wage, makes
 * inspecting beat standing without ever beating a serious bribe, so the choice
 * stays a choice. And an officer who waves a traveller through who is then
 * found holding contraband leaves the clearest trace in the system: two public
 * facts that fit together one way (`government/investigations.ts` reads it).
 *
 * Nothing here detains anybody. A seizure is a seizure: the load goes to the
 * Bazaar, the report goes before the officer who found it, and the traveller
 * walks away to answer a charge on the ladder like anybody else.
 */
import type { ActionResult, BuildingId, Citizen, CitizenId, Good, World } from '../types.ts';
import { GOODS } from '../types.ts';
import { PRODUCTS } from '../data/catalogue.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { deliverToMarket } from '../economy/market.ts';
import { officersOnDuty } from '../government/watch.ts';
import { isBribedBy } from '../government/reports.ts';
import { noteAbuseOfOffice } from '../government/investigations.ts';
import type { CargoLine } from './schedule.ts';
import { restrictionOn } from './schedule.ts';
import { lawfulPrice, tariffOf } from './prices.ts';
import { chargeUnderworldOffence } from './offences.ts';
import type { CityKey, Manifest } from './state.ts';
import {
  CONTRABAND_POSSESSION, FALSE_MANIFEST, GATES, HOME_CITY, MANIFEST_HISTORY, READS_MANIFESTS,
  bound, cityName, gateAt, hasFittedWagon, isGateBanned, underworldId, underworldKind, underworldState,
} from './state.ts';

/** The assessment fee, in local money, non-refundable. */
export const ASSESSMENT_FEE = 15;
/** What a customs post pays a shift — the Watch's own wage at the doorway. */
export const CUSTOMS_WAGE = 16;
/** An officer keeps this share of what they seize... */
export const BOUNTY_SHARE = 0.05;
/** ...up to a day's wage at the gate, and never more. */
export const BOUNTY_CAP = CUSTOMS_WAGE;
/** One customs post per gate, and one more for every this many crossings a day. */
export const CROSSINGS_PER_POST = 30;
/** The hollow at the Builders' Yard: 120 ℓ, and seized with the load. */
export const WAGON_COST = 120;
/** How long a wave-through is still fresh enough to sit beside a seizure. */
export const WAVE_WINDOW_TICKS = 24;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function waveKey(officerId: CitizenId, travellerId: CitizenId): string {
  return `waved:${officerId}:${travellerId}`;
}

// ---------------------------------------------------------------------------
// The roster (`UNDERWORLD.md` §3)
// ---------------------------------------------------------------------------

/**
 * How many posts the gates carry today: one per gate, plus one per
 * `CROSSINGS_PER_POST` crossings yesterday — or whatever number the Council set
 * with a `customs_posts` measure, which is theirs to set.
 */
export function customsPostsNeeded(world: World): number {
  const set = world.counters['customs:posts'];
  if (set !== undefined && Number.isFinite(set) && set > 0) return Math.round(set);
  const s = underworldState(world);
  return GATES.length + Math.floor(Math.max(0, s.crossingsYesterday) / CROSSINGS_PER_POST);
}

/**
 * Open and close the gate posts for the day, and roster the officers who will
 * stand at them: the sharpest eyes first, one gate each, then round again. A
 * thin Watch staffs a thin border — which is the whole of §8 in one line.
 */
export function rosterCustoms(world: World): Record<string, CitizenId[]> {
  const s = underworldState(world);
  if (s.rosterDay === world.day) return s.roster;
  const posts = customsPostsNeeded(world);
  const officers = officersOnDuty(world)
    .sort((a, b) => b.skills.analysis - a.skills.analysis || a.id.localeCompare(b.id))
    .slice(0, posts);
  const roster: Record<string, CitizenId[]> = {};
  for (const g of GATES) roster[g.building] = [];
  officers.forEach((officer, i) => {
    const gate = GATES[i % GATES.length];
    roster[gate.building].push(officer.id);
  });
  s.roster = roster;
  s.rosterDay = world.day;
  const staffed = officers.length;
  if (staffed < GATES.length) {
    emit(world, 'law', staffed === 0
      ? 'No officer stood at either gate today; the crossings went unread.'
      : `Only ${staffed} of the city's ${GATES.length} gates carried a customs officer today.`,
    officers.map((o) => o.id), 0.4, { posts, staffed });
  }
  return roster;
}

/** The officers standing at one gate today, still on duty. */
export function officersAtGate(world: World, building: BuildingId): Citizen[] {
  const roster = rosterCustoms(world);
  const duty = new Set(officersOnDuty(world).map((o) => o.id));
  return (roster[building] ?? []).filter((id) => duty.has(id)).map((id) => world.citizens[id]).filter((c): c is Citizen => !!c);
}

/** True where this citizen is standing a customs post at this gate today. */
export function isOnCustoms(world: World, cId: CitizenId, building?: BuildingId): boolean {
  if (building) return officersAtGate(world, building).some((o) => o.id === cId);
  return GATES.some((g) => officersAtGate(world, g.building).some((o) => o.id === cId));
}

/** The gate a citizen is standing at, with the officers on it. */
export function gateFor(world: World, c: Citizen): { building: BuildingId; name: string; officers: Citizen[] } | null {
  const gate = gateAt(c.district);
  if (!gate) return null;
  return { building: gate.building, name: gate.name, officers: officersAtGate(world, gate.building) };
}

/** What an officer takes for a seizure: 5 % of it, never more than a day's wage. */
export function bountyFor(value: number): number {
  return Math.max(0, Math.min(BOUNTY_CAP, Math.round(Math.max(0, value) * BOUNTY_SHARE)));
}

/** Pay the bounty out of the Treasury, which is where the load's proceeds land. */
export function payBounty(world: World, officerId: CitizenId, value: number): number {
  const bounty = bountyFor(value);
  if (bounty <= 0) return 0;
  if (!transfer(world, 'treasury', officerId, bounty, underworldKind('bounty'), `bounty on a seizure worth ${Math.round(value)} ℓ`)) return 0;
  remember(world, officerId, 'money', `You took ${bounty} ℓ of bounty on a seizure worth ${Math.round(value)} ℓ.`);
  return bounty;
}

// ---------------------------------------------------------------------------
// What a traveller is actually carrying
// ---------------------------------------------------------------------------

/** How much of a good, or of a named thing, a citizen is holding right now. */
export function held(world: World, c: Citizen, line: { good: Good | null; productId: string | null }): number {
  if (line.good) return Math.max(0, Math.floor(c.inventory[line.good] ?? 0));
  if (line.productId) return c.possessions.filter((p) => p.productId === line.productId).length;
  return Math.max(0, Math.floor(c.wallet));
}

/** A load a citizen is carrying, as the schedule reads it. */
export function cargoOf(world: World, c: Citizen, good: Good | null, productId: string | null, qty: number, value?: number): CargoLine {
  const q = Math.max(0, Math.round(qty));
  const line: CargoLine = { good, productId, qty: q, value: 0 };
  line.value = value !== undefined && Number.isFinite(value) ? Math.max(0, Math.round(value)) : lawfulPrice(world, { ...line, qty: q });
  return line;
}

/** Everything a traveller carries that any schedule of this city would bite on. */
export function contrabandOn(world: World, c: Citizen, city: CityKey = HOME_CITY): CargoLine[] {
  const out: CargoLine[] = [];
  for (const good of GOODS) {
    const qty = Math.floor(c.inventory[good] ?? 0);
    if (qty <= 0) continue;
    const line = cargoOf(world, c, good, null, qty);
    if (restrictionOn(world, city, line, { direction: 'either', declared: true })) out.push(line);
  }
  const counted = new Set<string>();
  for (const item of c.possessions) {
    if (counted.has(item.productId)) continue;
    counted.add(item.productId);
    const qty = c.possessions.filter((p) => p.productId === item.productId).length;
    const line = cargoOf(world, c, null, item.productId, qty);
    if (restrictionOn(world, city, line, { direction: 'either', declared: true })) out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The manifest and the duty (`UNDERWORLD.md` §2)
// ---------------------------------------------------------------------------

/** The manifests a traveller has filed today, newest last. */
export function manifestsFor(world: World, travellerId: CitizenId): Manifest[] {
  return underworldState(world).manifests.filter((m) => m.travellerId === travellerId && m.day === world.day);
}

/** The duty on a declared value, plus the assessment fee that is never refunded. */
export function dutyOn(world: World, city: CityKey, declaredValue: number): { duty: number; fee: number } {
  return { duty: Math.max(0, Math.round(tariffOf(world, city) * Math.max(0, declaredValue))), fee: ASSESSMENT_FEE };
}

export interface DeclareSpec {
  good?: Good | null;
  productId?: string | null;
  qty: number;
  value: number;
  /** Where the load is going. Reverie's own gate assesses an arrival too. */
  to?: CityKey;
  from?: CityKey;
}

/**
 * Present a manifest at a gate and pay the duty. The declaration is public the
 * moment it is made and joins the traveller's record; understating the
 * quantity, the value or the kind is a **false manifest (L28)**, a separate
 * offence because the paper is a separate act.
 */
export function declareCargo(world: World, cId: CitizenId, spec: DeclareSpec): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing === 'exiled') return fail('An exile does not cross a gate with cargo.');
  if (c.lifeStage === 'child') return fail('You must be grown to cross with cargo.');
  // A suspension bars work, trade, office and the vote, and a manifest is trade.
  if (c.standing === 'suspended') return fail('You cannot trade while suspended.');
  const gate = gateFor(world, c);
  if (!gate) return fail('You must be standing at a gate — the Threshold or the Docks — to declare a load.');
  const good = spec.good ?? null;
  const productId = spec.productId ?? null;
  if (good && !GOODS.includes(good)) return fail(`There is no such good as ${String(good)}.`);
  if (productId && !PRODUCTS[productId]) return fail(`There is no such thing as ${String(productId)}.`);
  const qty = Math.max(0, Math.round(spec.qty));
  if (qty <= 0 && !(good === null && productId === null)) return fail('A manifest names a quantity.');
  const declaredValue = Math.max(0, Math.round(spec.value));
  const to = spec.to ?? HOME_CITY;
  const from = spec.from ?? HOME_CITY;
  if (!READS_MANIFESTS[to]) return fail(`${cityName(to)} reads nothing and asks nothing; there is no manifest to file.`);
  if (isGateBanned(world, cId) && to === HOME_CITY) {
    return fail('Your name is on the register every gate reads; you may not bring a load in.');
  }

  // A lot of lumens is a cargo line with no good and no product on it, and what
  // it is worth is what it is: the purse, not a price.
  const money = good === null && productId === null;
  const carrying = held(world, c, { good, productId });
  const trueValue = money ? carrying : lawfulPrice(world, { good, productId, qty: carrying, value: carrying });
  const { duty, fee } = dutyOn(world, to, declaredValue);
  if (c.wallet < fee) return fail(`The assessment fee is ${fee} ℓ; you have ${Math.floor(c.wallet)} ℓ.`);
  if (!transfer(world, cId, 'treasury', fee, 'fee', `assessment fee at ${gate.name}`)) return fail('The assessment fee could not be paid.');
  const dutyPaid = duty > 0 && transfer(world, cId, 'treasury', duty, underworldKind('duty'),
    `duty on ${qty} ${good ?? productId ?? 'lumens'} at ${gate.name}`) ? duty : 0;

  const s = underworldState(world);
  const understated = money ? carrying > declaredValue : (carrying > qty || trueValue > declaredValue * 1.25);
  const manifest: Manifest = {
    id: underworldId(world, 'mf'), travellerId: cId, from, to, good, productId,
    declaredQty: qty, declaredValue, actualQty: carrying, actualValue: trueValue,
    duty, dutyPaid, fee, day: world.day, tick: world.tick, false: understated, chargedDay: null,
    assessedById: null, inspectedById: null, waved: false,
  };
  s.manifests.push(manifest);
  bound(s.manifests, MANIFEST_HISTORY);
  s.crossingsToday += 1;

  emit(world, 'outer', `${c.name} declared ${qty} ${good ?? (productId ? PRODUCTS[productId].name : 'lumens')} at ${gate.name}, `
    + `valued at ${declaredValue} ℓ${duty > 0 ? `, duty ${dutyPaid} of ${duty} ℓ` : ''}.`,
  [cId], 0.3, { manifest: manifest.id, duty, declaredValue, gate: gate.building });
  remember(world, cId, 'money', `You declared ${qty} ${good ?? productId ?? 'lumens'} at ${gate.name} `
    + `(${manifest.id}); duty ${dutyPaid} ℓ and ${fee} ℓ of fee.`);

  if (understated) {
    // The paper is public the moment it is made, and the crates are standing
    // right there: an officer on the gate is looking at both.
    const reportId = chargeUnderworldOffence(world, cId, FALSE_MANIFEST, {
      amount: Math.max(0, trueValue - declaredValue),
      officerId: gate.officers[0]?.id ?? null,
      description: `${c.name} declared ${qty} at ${declaredValue} ℓ and carried ${carrying} worth ${trueValue} ℓ (${manifest.id})`,
    });
    if (reportId) manifest.chargedDay = world.day;
  }
  const outstanding = duty - dutyPaid;
  return ok(`You declared ${qty} ${good ?? productId ?? 'lumens'} at ${gate.name}: ${fee} ℓ of fee and ${dutyPaid} ℓ of duty`
    + `${outstanding > 0 ? `, with ${outstanding} ℓ still owed before the load is released` : ''}.`);
}

/** (customs) Read a manifest and take the duty that was not paid when it was filed. */
export function assessDuty(world: World, officerId: CitizenId, travellerId: CitizenId): ActionResult {
  const officer = world.citizens[officerId];
  const traveller = world.citizens[travellerId];
  if (!officer || !traveller) return fail('Unknown citizen.');
  if (!isOnCustoms(world, officerId)) return fail('Only an officer standing a customs post reads manifests.');
  const manifests = manifestsFor(world, travellerId);
  if (manifests.length === 0) return fail(`${traveller.name} has filed no manifest today.`);
  const m = manifests[manifests.length - 1];
  m.assessedById = officerId;
  const outstanding = Math.max(0, m.duty - m.dutyPaid);
  if (outstanding <= 0) {
    return ok(`You read ${traveller.name}'s manifest (${m.id}); the duty of ${m.duty} ℓ was paid at the gate.`);
  }
  const paid = Math.min(outstanding, Math.max(0, Math.floor(traveller.wallet)));
  if (paid > 0) transfer(world, travellerId, 'treasury', paid, underworldKind('duty'), `duty assessed on manifest ${m.id}`);
  m.dutyPaid += paid;
  emit(world, 'outer', `Officer ${officer.name} assessed ${traveller.name}'s manifest (${m.id}) and took ${paid} ℓ of duty.`,
    [officerId, travellerId], 0.3, { manifest: m.id, duty: paid });
  remember(world, travellerId, 'money', `Officer ${officer.name} assessed your manifest (${m.id}): ${paid} ℓ of duty.`);
  return ok(`You assessed ${traveller.name}'s manifest and took ${paid} ℓ of the ${outstanding} ℓ owed.`);
}

// ---------------------------------------------------------------------------
// Seizure
// ---------------------------------------------------------------------------

export interface SeizureResult {
  value: number;
  bounty: number;
  qty: number;
}

/**
 * Take a load to the Bazaar. The goods leave the traveller and land on the
 * city's own shelf — which *is* the Treasury's till, since everything bought
 * there is paid to the Treasury — so the proceeds reach the city without a
 * lumen being conjured, and the money audit closes unchanged.
 */
export function seizeLot(world: World, officerId: CitizenId | null, travellerId: CitizenId, line: CargoLine): SeizureResult {
  const traveller = world.citizens[travellerId];
  if (!traveller) return { value: 0, bounty: 0, qty: 0 };
  let taken = 0;
  if (line.good) {
    taken = Math.min(Math.max(0, Math.round(line.qty)), Math.floor(traveller.inventory[line.good] ?? 0));
    if (taken > 0) {
      traveller.inventory[line.good] -= taken;
      deliverToMarket(world, line.good, taken);
    }
  } else if (line.productId) {
    const wanted = Math.max(0, Math.round(line.qty));
    for (let i = traveller.possessions.length - 1; i >= 0 && taken < wanted; i--) {
      if (traveller.possessions[i].productId !== line.productId) continue;
      traveller.possessions.splice(i, 1);
      taken++;
    }
    if (taken > 0) {
      world.emporium ??= {};
      world.emporium[line.productId] = (world.emporium[line.productId] ?? 0) + taken;
    }
  }
  if (taken <= 0) return { value: 0, bounty: 0, qty: 0 };
  const value = lawfulPrice(world, { ...line, qty: taken });
  // A wagon with a hollow is seized with the load it was hiding.
  const s = underworldState(world);
  const wagon = s.wagons.indexOf(travellerId);
  if (wagon >= 0) s.wagons.splice(wagon, 1);
  const bounty = officerId ? payBounty(world, officerId, value) : 0;
  const what = line.good ?? (line.productId ? PRODUCTS[line.productId]?.name ?? line.productId : 'the load');
  emit(world, 'outer', `${officerId ? `Officer ${world.citizens[officerId]?.name ?? officerId}` : 'The Watch'} seized `
    + `${taken} ${what} from ${traveller.name}; it went to the Bazaar${bounty > 0 ? ` (${bounty} ℓ of bounty)` : ''}.`,
  officerId ? [officerId, travellerId] : [travellerId], 0.6, { qty: taken, value, bounty });
  remember(world, travellerId, 'crime', `${taken} ${what} was seized from you at the gate and taken to the Bazaar.`);
  return { value, bounty, qty: taken };
}

/** (customs) Take a named load to the Bazaar and open a report on what it was. */
export function seize(world: World, officerId: CitizenId, travellerId: CitizenId, good: Good | null, productId: string | null, qty: number): ActionResult {
  const officer = world.citizens[officerId];
  const traveller = world.citizens[travellerId];
  if (!officer || !traveller) return fail('Unknown citizen.');
  if (!isOnCustoms(world, officerId)) return fail('Only an officer standing a customs post may seize a load.');
  if (officerId === travellerId) return fail('You cannot seize your own load.');
  if (traveller.district !== officer.district) return fail(`${traveller.name} is not at your gate.`);
  const line = cargoOf(world, traveller, good, productId, qty);
  const restriction = restrictionOn(world, HOME_CITY, line, { direction: 'either', declared: true });
  if (!restriction) return fail('The schedule says nothing about that; there is nothing to seize.');
  const result = seizeLot(world, officerId, travellerId, line);
  if (result.qty <= 0) return fail(`${traveller.name} is not carrying that.`);
  noteWaveThroughTrace(world, travellerId);
  chargeUnderworldOffence(world, travellerId, CONTRABAND_POSSESSION, {
    proved: true, amount: result.value, officerId,
    description: `${traveller.name} held ${result.qty} against the schedule (${restriction.subject}); the load was seized`,
  });
  return ok(`You seized ${result.qty} from ${traveller.name}, worth ${result.value} ℓ${result.bounty > 0 ? `, and took ${result.bounty} ℓ of bounty` : ''}.`);
}

/**
 * An officer who waved a traveller through who is then found holding
 * contraband has left two public facts that fit together one way. It is not a
 * charge and not a conviction — it is a thing a detective may one day notice.
 */
export function noteWaveThroughTrace(world: World, travellerId: CitizenId): void {
  for (const key of Object.keys(world.counters)) {
    if (!key.startsWith('waved:') || !key.endsWith(`:${travellerId}`)) continue;
    const tick = world.counters[key] ?? 0;
    if (world.tick - tick > WAVE_WINDOW_TICKS) continue;
    const officerId = key.slice('waved:'.length, key.length - travellerId.length - 1);
    if (!world.citizens[officerId]) continue;
    noteAbuseOfOffice(world, officerId, `waved ${world.citizens[travellerId]?.name ?? travellerId} through the gate `
      + 'hours before contraband was found on them');
  }
}

/**
 * (customs) Spend the hour on one crossing. What an inspection proves is what
 * the paper and the crates say between them: a manifest that understates its
 * load is a false manifest, and anything the schedule does not admit is seized.
 */
export function inspect(world: World, officerId: CitizenId, travellerId: CitizenId): ActionResult {
  const officer = world.citizens[officerId];
  const traveller = world.citizens[travellerId];
  if (!officer || !traveller) return fail('Unknown citizen.');
  if (officerId === travellerId) return fail('You cannot inspect yourself.');
  if (!isOnCustoms(world, officerId)) return fail('Only an officer standing a customs post may inspect a crossing.');
  if (traveller.district !== officer.district) return fail(`${traveller.name} is not at your gate.`);

  const findings: string[] = [];
  for (const m of manifestsFor(world, travellerId)) {
    m.inspectedById = officerId;
    // The paper stays false on the record for ever; what may not happen twice
    // is the charge, and `chargedDay` is what says it already has.
    if (!m.false || m.chargedDay !== null) continue;
    m.chargedDay = world.day;
    chargeUnderworldOffence(world, travellerId, FALSE_MANIFEST, {
      proved: true, amount: Math.max(0, m.actualValue - m.declaredValue), officerId,
      description: `${traveller.name}'s manifest ${m.id} declared ${m.declaredQty} at ${m.declaredValue} ℓ `
        + `against a load of ${m.actualQty} worth ${m.actualValue} ℓ`,
    });
    findings.push(`the manifest ${m.id} does not match the load`);
  }

  let seizedValue = 0;
  for (const line of contrabandOn(world, traveller)) {
    const restriction = restrictionOn(world, HOME_CITY, line, { direction: 'either', declared: true });
    const result = seizeLot(world, officerId, travellerId, line);
    if (result.qty <= 0) continue;
    seizedValue += result.value;
    chargeUnderworldOffence(world, travellerId, CONTRABAND_POSSESSION, {
      proved: true, amount: result.value, officerId,
      description: `${traveller.name} was found holding ${result.qty} against the schedule (${restriction?.subject ?? 'the schedule'})`,
    });
    findings.push(`${result.qty} ${line.good ?? line.productId} against the schedule`);
  }
  if (seizedValue > 0) noteWaveThroughTrace(world, travellerId);

  const wagon = hasFittedWagon(world, travellerId);
  emit(world, 'outer', findings.length === 0
    ? `Officer ${officer.name} inspected ${traveller.name}'s crossing and found nothing.`
    : `Officer ${officer.name} inspected ${traveller.name}'s crossing: ${findings.join(', ')}.`,
  [officerId, travellerId], findings.length === 0 ? 0.2 : 0.6, { findings: findings.length, seized: seizedValue });
  remember(world, travellerId, 'crime', findings.length === 0
    ? `Officer ${officer.name} inspected your crossing and found nothing.`
    : `Officer ${officer.name} inspected your crossing: ${findings.join(', ')}.`);
  if (findings.length === 0) return ok(`You inspected ${traveller.name}'s crossing and found nothing.`);
  return ok(`You inspected ${traveller.name}'s crossing${wagon ? ' and the hollow in their wagon' : ''}: ${findings.join(', ')}.`);
}

/**
 * (customs) Pass a traveller unread. Lawful — an officer who inspected every
 * crate would stop the trade of the city — and what a bribe buys.
 */
export function waveThrough(world: World, officerId: CitizenId, travellerId: CitizenId): ActionResult {
  const officer = world.citizens[officerId];
  const traveller = world.citizens[travellerId];
  if (!officer || !traveller) return fail('Unknown citizen.');
  if (officerId === travellerId) return fail('You cannot wave yourself through.');
  if (!isOnCustoms(world, officerId)) return fail('Only an officer standing a customs post waves a crossing through.');
  world.counters[waveKey(officerId, travellerId)] = world.tick;
  for (const m of manifestsFor(world, travellerId)) m.waved = true;
  const paid = isBribedBy(world, officerId, travellerId);
  emit(world, 'outer', `Officer ${officer.name} waved ${traveller.name} through ${gateFor(world, officer)?.name ?? 'the gate'} unread.`,
    [officerId, travellerId], 0.3, { waved: true, paid });
  remember(world, travellerId, 'event', `Officer ${officer.name} waved you through the gate without reading anything.`);
  remember(world, officerId, 'civic', `You waved ${traveller.name} through the gate unread. It is on the record.`);
  return ok(`You waved ${traveller.name} through unread.`);
}

/** Buy the hollow at the Builders' Yard: 120 ℓ, and seized with the load. */
export function fitWagon(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.district !== 'foundry_row') return fail("The Builders' Yard is on Foundry Row; you must be there.");
  if (hasFittedWagon(world, cId)) return fail('Your wagon already has a hollow in it.');
  if (c.wallet < WAGON_COST) return fail(`A fitted wagon costs ${WAGON_COST} ℓ; you have ${Math.floor(c.wallet)} ℓ.`);
  if (!transfer(world, cId, 'treasury', WAGON_COST, 'purchase', "a fitted wagon at the Builders' Yard")) {
    return fail('The wagon could not be paid for.');
  }
  underworldState(world).wagons.push(cId);
  emit(world, 'trade', `${c.name} had a wagon fitted at the Builders' Yard for ${WAGON_COST} ℓ.`, [cId], 0.2, { cost: WAGON_COST });
  remember(world, cId, 'money', `You had a hollow fitted in your wagon for ${WAGON_COST} ℓ. It is seized with anything found in it.`);
  return ok(`Your wagon has a hollow in it now (${WAGON_COST} ℓ).`);
}

/** What the gates of a city look like today, for an observation or the dashboard. */
export function customsLine(world: World): string {
  const posts = customsPostsNeeded(world);
  const staffed = GATES.reduce((n, g) => n + officersAtGate(world, g.building).length, 0);
  const s = underworldState(world);
  return `${cityName(HOME_CITY)}'s gates: ${staffed} of ${posts} customs posts standing, `
    + `${s.crossingsToday} crossings today, tariff ${Math.round(tariffOf(world, HOME_CITY) * 100)} %.`;
}
