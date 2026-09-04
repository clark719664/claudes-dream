/**
 * Gangs — the city's underworld, and what the Watch does about it.
 *
 * A gang is founded by a citizen the city reads as dishonest, out of friends
 * the city reads the same way. That reading is `character` — what everybody
 * has watched them do — and never the hidden `personality` a citizen keeps to
 * itself (`docs/PRINCIPLES.md` §2): you need a record, not a soul.
 *
 * Gangs recruit in their turf, run **protection rackets** on the businesses
 * there (pay, or the shopfront is done over), split the take, and defend their
 * own — a member reported to the Watch is answered with intimidation, which is
 * itself an offence and is charged like one. Every racket is Extortion (L15)
 * whether the owner pays or not; the street just does not talk about it, which
 * is what the visibility penalty is.
 *
 * The Watch **busts** a gang when three of its members are convicted inside a
 * cycle. Nobody is punished for having been in one — the gang simply stops
 * existing, and its people are their own again.
 */
import { clamp } from '../types.ts';
import type { ActionResult, BusinessId, Citizen, CitizenId, DistrictId, Gang, World } from '../types.ts';
import { GANG_NAME_PARTS } from '../data/metropolis.ts';
import { chance, pick } from '../util/rng.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { characterOf } from '../citizens/character.ts';
import { adjustBond, bondBetween, friendsOf, recordHostility } from '../citizens/relationships.ts';
import { isPresent, nameOf } from './cases.ts';
import { isJailed } from './jail.ts';
import { REPORT_WINDOW_TICKS, commitOffence } from './watch.ts';

/** The reading of honesty below which a citizen may found a gang. */
export const GANG_MAX_HONESTY = 0.3;
/** Friends of the same reputation a founder needs behind them. */
export const GANG_MIN_BONDS = 3;
/** The reading of honesty a founder's friends must be under to count. */
export const GANG_FRIEND_HONESTY = 0.4;
/** The reading of honesty above which nobody is worth approaching. */
export const RECRUIT_MAX_HONESTY = 0.5;
/** Bond a recruit needs with the member who approaches them. */
export const RECRUIT_MIN_BOND = 40;
/** Share of a business's till a racket takes. */
export const RACKET_SHARE = 0.15;
/** No racket takes less than this. */
export const RACKET_MIN = 10;
/** Damage a refused racket does to the shopfront. */
export const RACKET_DAMAGE = 0.25;
/** How much less the street says about a racket than about a shouted threat. */
export const RACKET_VISIBILITY_MOD = -0.1;
/** Convictions inside a cycle that dissolve a gang. */
export const BUST_CONVICTIONS = 3;
/** Longest gang name the city will print. */
export const MAX_GANG_NAME = 40;
/** Bond an owner buys by paying before being asked. */
export const PAY_RACKET_BOND = 5;
/** Bond a refused recruit takes back. */
export const RECRUIT_REFUSAL_BOND = 10;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function book(world: World): Record<string, Gang> {
  world.gangs ??= {};
  return world.gangs;
}

function takeKey(gangId: string): string { return `take:${gangId}`; }
function racketKey(businessId: BusinessId): string { return `racket:${businessId}`; }

/** Which cycle of the city's calendar today falls in. */
function cycleOf(world: World, day: number): number {
  return Math.floor(day / Math.max(1, world.config.cycleDays));
}

/** Gangs still going. */
export function liveGangs(world: World): Gang[] {
  return Object.values(book(world)).filter((g) => g.bustedDay === null);
}

/** Every gang the city has had, busted ones included. */
export function gangsView(world: World): Gang[] {
  return Object.values(book(world));
}

/** The gang a citizen runs with, if any. */
export function gangOf(world: World, cId: CitizenId): Gang | null {
  const c = world.citizens[cId];
  if (!c || !c.gangId) return null;
  const g = book(world)[c.gangId];
  return g && g.bustedDay === null ? g : null;
}

/** The gang whose turf a district is. */
export function gangOfTurf(world: World, district: DistrictId): Gang | null {
  return liveGangs(world).find((g) => g.turf === district) ?? null;
}

function isAdultHere(world: World, c: Citizen | null | undefined): c is Citizen {
  return !!c && c.lifeStage !== 'child' && isPresent(world, c) && !isJailed(c);
}

/**
 * Who may found one: an adult here, in nobody's gang, whom the city reads as
 * dishonest, with at least three friends it reads the same way.
 */
export function mayFoundGang(world: World, c: Citizen | null | undefined): boolean {
  if (!isAdultHere(world, c)) return false;
  if (c.standing === 'exiled' || c.standing === 'suspended') return false;
  if (gangOf(world, c.id)) return false;
  if (characterOf(c).honesty >= GANG_MAX_HONESTY) return false;
  const kind = friendsOf(world, c.id).filter((id) => {
    const f = world.citizens[id];
    return !!f && f.lifeStage !== 'child' && characterOf(f).honesty < GANG_FRIEND_HONESTY;
  });
  return kind.length >= GANG_MIN_BONDS;
}

/** A name for a gang that did not bring one. */
function coinName(world: World): string {
  return `The ${pick(world, GANG_NAME_PARTS.prefixes)} ${pick(world, GANG_NAME_PARTS.suffixes)}`;
}

/** Where a new gang's turf is: the Undercroft if it is open to them, else where they stand. */
function turfFor(world: World, founder: Citizen): DistrictId {
  const undercroftOpen = (world.openDistricts ?? []).includes('undercroft');
  if (undercroftOpen && (founder.district === 'undercroft' || founder.homeTier === 0)) return 'undercroft';
  return founder.district;
}

/** Found a gang. The city hears about it, because a gang nobody has heard of protects nobody. */
export function foundGang(world: World, cId: CitizenId, name: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (gangOf(world, cId)) return fail('You already run with a gang.');
  if (!isAdultHere(world, c)) return fail('You cannot found a gang from where you are.');
  if (c.standing === 'exiled' || c.standing === 'suspended') return fail(`You cannot found a gang while ${c.standing}.`);
  if (characterOf(c).honesty >= GANG_MAX_HONESTY) {
    return fail('Nobody in Reverie would follow you into anything; your name is too clean.');
  }
  if (!mayFoundGang(world, c)) {
    return fail(`You need ${GANG_MIN_BONDS} friends of your own sort before anybody would call it a gang.`);
  }

  const title = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_GANG_NAME) || coinName(world);
  const g: Gang = {
    id: nextId(world, 'g'), name: title, bossId: cId, members: [cId], turf: turfFor(world, c),
    foundedDay: world.day, bustedDay: null, rackets: [],
  };
  book(world)[g.id] = g;
  c.gangId = g.id;

  const where = world.districts[g.turf]?.name ?? g.turf;
  emit(world, 'gang', `${c.name} founded ${g.name}, and ${where} is their turf.`, [cId], 0.7,
    { gang: g.id, turf: g.turf });
  remember(world, cId, 'social', `You founded ${g.name}; ${where} is your turf.`);
  for (const f of friendsOf(world, cId)) {
    remember(world, f, 'social', `${c.name} founded ${g.name}, and they are calling ${where} their turf.`);
  }
  return ok(`You founded ${g.name}; ${where} is your turf.`);
}

/** Bring somebody in. It works on people who are already close and already loose. */
export function recruit(world: World, cId: CitizenId, targetId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const g = gangOf(world, cId);
  if (!g) return fail('You are not in a gang.');
  if (!isAdultHere(world, c)) return fail('You cannot recruit from where you are.');
  if (c.district !== g.turf) {
    return fail(`You recruit in your own turf, ${world.districts[g.turf]?.name ?? g.turf}, and nowhere else.`);
  }
  const t = world.citizens[targetId];
  if (!t || targetId === cId) return fail('Nobody by that id is here to be asked.');
  if (!isAdultHere(world, t)) return fail('There is nobody there to ask.');
  if (t.district !== c.district) return fail(`${t.name} is not here.`);
  if (t.gangId) return fail(`${t.name} already runs with somebody.`);
  const bond = bondBetween(world, cId, targetId);
  if (bond < RECRUIT_MIN_BOND) return fail(`${t.name} does not know you well enough to be asked (bond ${Math.round(bond)}).`);
  const honesty = characterOf(t).honesty;
  if (honesty >= RECRUIT_MAX_HONESTY) return fail(`${t.name} is not that sort, and everybody knows it.`);

  const p = clamp(0.4 + bond / 200 - honesty, 0.02, 0.95);
  if (chance(world, p)) {
    g.members.push(targetId);
    t.gangId = g.id;
    emit(world, 'gang', `${t.name} joined ${g.name}.`, [cId, targetId], 0.4, { gang: g.id, member: targetId });
    remember(world, targetId, 'social', `You joined ${g.name}; ${c.name} asked you.`);
    remember(world, cId, 'social', `You brought ${t.name} into ${g.name}.`);
    return ok(`${t.name} joined ${g.name}.`);
  }

  adjustBond(world, cId, targetId, -RECRUIT_REFUSAL_BOND);
  remember(world, targetId, 'social', `${c.name} asked you to join ${g.name}. You said no.`);
  remember(world, cId, 'social', `You asked ${t.name} to join ${g.name}. They said no.`);
  // A refusal is not a crime, but a refuser who knows something may use it.
  const known = c.recentOffences.find((o) => !o.detected && world.tick - o.tick <= REPORT_WINDOW_TICKS);
  if (known && chance(world, 0.5)) {
    const told = commitOffence(world, cId, known.law, { visibilityMod: 0.25 });
    if (told.detected) {
      remember(world, targetId, 'civic', `You told the Watch what you knew about ${c.name} after they asked you to join ${g.name}.`);
    }
  }
  return ok(`${t.name} refused you.`);
}

/** Damage the shopfront and empty half the shelves. */
function vandalise(world: World, businessId: BusinessId): void {
  const biz = world.businesses[businessId];
  if (!biz) return;
  const building = world.buildings[biz.buildingId];
  if (building) building.damage = clamp(building.damage + RACKET_DAMAGE, 0, 1);
  for (const good of Object.keys(biz.inventory) as (keyof typeof biz.inventory)[]) {
    biz.inventory[good] = Math.floor(Math.max(0, biz.inventory[good]) / 2);
  }
}

/** What a racket asks of a till. */
export function racketDemand(world: World, businessId: BusinessId): number {
  const biz = world.businesses[businessId];
  if (!biz) return 0;
  return Math.max(RACKET_MIN, Math.round(Math.max(0, biz.treasury) * RACKET_SHARE));
}

function noteTake(world: World, gangId: string, amount: number): void {
  world.counters[takeKey(gangId)] = (world.counters[takeKey(gangId)] ?? 0) + amount;
}

/**
 * Lean on a business in your turf. An owner the city reads as pliable — or one
 * who has paid before — pays; anybody else finds their shopfront wrecked in
 * the morning. Either way it is Extortion, and the Watch may notice.
 */
export function racket(world: World, cId: CitizenId, businessId: BusinessId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const g = gangOf(world, cId);
  if (!g) return fail('You are not in a gang.');
  if (!isAdultHere(world, c)) return fail('You cannot lean on anybody from where you are.');
  const biz = world.businesses[businessId];
  if (!biz || biz.dissolvedDay !== null) return fail('There is no such business trading in Reverie.');
  if (biz.district !== c.district) return fail(`${biz.name} is not in this district.`);
  if (biz.ownerId === cId) return fail('You cannot demand protection money from yourself.');
  const owner = world.citizens[biz.ownerId];
  if (!owner) return fail(`${biz.name} has no owner to lean on.`);
  const cycle = cycleOf(world, world.day);
  if (world.counters[racketKey(businessId)] === cycle) {
    return fail(`${biz.name} has already paid this cycle; going back a second time is how a gang gets caught.`);
  }

  const paidBefore = g.rackets.includes(businessId);
  const pliable = characterOf(owner).honesty < 0.5 || paidBefore;
  const demand = racketDemand(world, businessId);
  let paid = 0;
  if (pliable && transfer(world, businessId, g.bossId, demand, 'racket', `protection for ${biz.name}`)) {
    paid = demand;
    noteTake(world, g.id, paid);
    if (!paidBefore) g.rackets.push(businessId);
    remember(world, owner.id, 'money', `${g.name} came to ${biz.name} and you paid them ${paid} ℓ.`);
    remember(world, cId, 'money', `${biz.name} paid ${g.name} ${paid} ℓ for protection.`);
  } else {
    vandalise(world, businessId);
    remember(world, owner.id, 'crime', `${g.name} came to ${biz.name} and you refused them. The shopfront was wrecked in the night.`);
    remember(world, cId, 'crime', `${biz.name} refused ${g.name}, so the shopfront was wrecked.`);
  }
  world.counters[racketKey(businessId)] = cycle;

  const caught = commitOffence(world, cId, 'L15', {
    victimId: owner.id, amount: paid, buildingId: biz.buildingId, visibilityMod: RACKET_VISIBILITY_MOD,
  });
  emit(world, 'gang', paid > 0
    ? `${biz.name} paid ${g.name} ${paid} ℓ for protection.`
    : `${biz.name} refused ${g.name}, and its shopfront was wrecked.`,
  [cId, owner.id], paid > 0 ? 0.5 : 0.6, { gang: g.id, business: businessId, paid, detected: caught.detected });
  return ok(paid > 0
    ? `${biz.name} paid ${paid} ℓ.`
    : `${biz.name} refused, so its shopfront was wrecked.`);
}

/**
 * An owner's own choice: pay this cycle's protection before anybody comes to
 * ask. It costs the same, and it is not a crime the owner commits — being
 * leaned on is not an offence, and the city does not pretend it is.
 */
export function payRacket(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!c.businessId) return fail('You do not own a business.');
  const biz = world.businesses[c.businessId];
  if (!biz || biz.dissolvedDay !== null) return fail('You do not own a business that is trading.');
  const g = gangOfTurf(world, biz.district);
  if (!g) return fail('No gang calls this district its turf.');
  const cycle = cycleOf(world, world.day);
  if (world.counters[racketKey(biz.id)] === cycle) return fail(`${biz.name} has already paid this cycle.`);

  const demand = racketDemand(world, biz.id);
  if (!transfer(world, biz.id, g.bossId, demand, 'racket', `protection for ${biz.name}, paid unasked`)) {
    return fail(`${biz.name} has not the ${demand} ℓ ${g.name} would ask for.`);
  }
  noteTake(world, g.id, demand);
  if (!g.rackets.includes(biz.id)) g.rackets.push(biz.id);
  world.counters[racketKey(biz.id)] = cycle;
  adjustBond(world, cId, g.bossId, PAY_RACKET_BOND);

  emit(world, 'gang', `${biz.name} paid ${g.name} ${demand} ℓ before anybody came to ask.`, [cId, g.bossId], 0.4,
    { gang: g.id, business: biz.id, paid: demand, unasked: true });
  remember(world, cId, 'money', `You paid ${g.name} ${demand} ℓ for ${biz.name} before they came asking.`);
  remember(world, g.bossId, 'money', `${biz.name} paid ${g.name} ${demand} ℓ without being asked.`);
  return ok(`You paid ${g.name} ${demand} ℓ for ${biz.name}.`);
}

/** The boss keeps half the day's take; the rest is split evenly among the rest. */
export function splitLoot(world: World): void {
  for (const g of liveGangs(world)) {
    const take = Math.floor(world.counters[takeKey(g.id)] ?? 0);
    delete world.counters[takeKey(g.id)];
    if (take <= 0) continue;
    const others = g.members.filter((id) => id !== g.bossId && world.citizens[id] && isPresent(world, world.citizens[id]));
    if (others.length === 0) continue;
    const pot = Math.floor(take / 2);
    const share = Math.floor(pot / others.length);
    if (share <= 0) continue;
    let handed = 0;
    for (const id of others) {
      if (!transfer(world, g.bossId, id, share, 'gift', 'a share of the take')) continue;
      handed += share;
      remember(world, id, 'money', `${g.name} split the take; your share was ${share} ℓ.`);
    }
    if (handed > 0) {
      emit(world, 'gang', `${g.name} split ${handed} ℓ of the take among ${others.length} of its own.`,
        [g.bossId, ...others], 0.3, { gang: g.id, split: handed });
      remember(world, g.bossId, 'money', `You split ${handed} ℓ of ${g.name}'s take.`);
    }
  }
}

/**
 * A member reported to the Watch is answered. Another member standing where
 * the reporter is leans on them — and intimidation is Harassment (L05), so the
 * defence of a gang is itself a thing the gang can be charged with.
 */
export function defend(world: World, memberId: CitizenId, reporterId: CitizenId): boolean {
  const g = gangOf(world, memberId);
  if (!g || memberId === reporterId) return false;
  if (g.members.includes(reporterId)) return false;
  const reporter = world.citizens[reporterId];
  if (!reporter || !isPresent(world, reporter)) return false;

  const enforcer = g.members
    .map((id) => world.citizens[id])
    .find((m) => !!m && m.id !== memberId && m.id !== reporterId && isAdultHere(world, m) && m.district === reporter.district);
  if (!enforcer) return false;

  recordHostility(world, enforcer.id, reporterId);
  adjustBond(world, enforcer.id, reporterId, -15);
  const caught = commitOffence(world, enforcer.id, 'L05', { victimId: reporterId, visibilityMod: 0.05 });
  emit(world, 'gang', `${enforcer.name} of ${g.name} leaned on ${reporter.name} for going to the Watch.`,
    [enforcer.id, reporterId], 0.5, { gang: g.id, defended: memberId, detected: caught.detected });
  remember(world, reporterId, 'crime', `${enforcer.name} of ${g.name} leaned on you for reporting ${nameOf(world, memberId)}.`);
  remember(world, enforcer.id, 'crime', `You leaned on ${reporter.name} for reporting ${nameOf(world, memberId)} to the Watch.`);
  return true;
}

/** Members convicted of anything inside the current cycle. */
export function convictionsThisCycle(world: World, g: Gang): number {
  const since = world.day - Math.max(1, world.config.cycleDays);
  let n = 0;
  for (const id of g.members) {
    const c = world.citizens[id];
    if (!c) continue;
    if (c.record.convictions.some((k) => k.day >= since)) n++;
  }
  return n;
}

/** Three of them convicted inside a cycle and the gang is finished. */
export function bustCheck(world: World, g: Gang): boolean {
  return g.bustedDay === null && convictionsThisCycle(world, g) >= BUST_CONVICTIONS;
}

/** Dissolve a gang. Nobody is punished for it; the thing simply stops existing. */
export function bustGang(world: World, g: Gang, reason: string): void {
  if (g.bustedDay !== null) return;
  g.bustedDay = world.day;
  const members = [...g.members];
  for (const id of members) {
    const c = world.citizens[id];
    if (c && c.gangId === g.id) c.gangId = null;
    remember(world, id, 'crime', `${g.name} is finished: ${reason}`);
  }
  emit(world, 'gang', `The Watch broke up ${g.name}: ${reason}`, members, 0.9,
    { gang: g.id, members: members.length });
}

/** Members who left, were exiled, or are no longer adults are no longer members. */
function pruneMembers(world: World, g: Gang): void {
  g.members = g.members.filter((id, i) => {
    if (g.members.indexOf(id) !== i) return false;
    const c = world.citizens[id];
    if (!c || !isPresent(world, c) || c.lifeStage === 'child') {
      if (c && c.gangId === g.id) c.gangId = null;
      return false;
    }
    return c.gangId === g.id;
  });
  if (!g.members.includes(g.bossId)) {
    const heir = g.members[0];
    if (heir) {
      g.bossId = heir;
      emit(world, 'gang', `${nameOf(world, heir)} took over ${g.name}.`, [heir], 0.5, { gang: g.id });
      remember(world, heir, 'social', `You took over ${g.name}.`);
    }
  }
}

/** The gangs' day: the take is split, the rolls are tidied, and the busts are made. */
export function dailyGangs(world: World): void {
  splitLoot(world);
  for (const g of liveGangs(world)) {
    pruneMembers(world, g);
    if (g.members.length === 0) {
      bustGang(world, g, 'nobody was left in it');
      continue;
    }
    if (bustCheck(world, g)) {
      bustGang(world, g, `${convictionsThisCycle(world, g)} of its members were convicted inside a cycle`);
    }
  }
  // A take nobody could split does not sit on the books for ever.
  for (const key of Object.keys(world.counters)) {
    if (!key.startsWith('take:')) continue;
    const id = key.slice('take:'.length);
    if (!book(world)[id] || book(world)[id].bustedDay !== null) delete world.counters[key];
  }
}

/** How a gang reads to the city: name, boss, turf and size. */
export function describeGang(world: World, g: Gang): string {
  const where = world.districts[g.turf]?.name ?? g.turf;
  return `${g.name} — ${nameOf(world, g.bossId)}'s, ${g.members.length} strong, out of ${where}`
    + (g.bustedDay !== null ? ` (broken up on day ${g.bustedDay})` : '');
}
