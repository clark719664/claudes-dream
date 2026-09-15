/**
 * Dispute, schism and reunion (`docs/CREEDS.md` §6).
 *
 * A creed spreads because people like each other, and it splits along the same
 * edges. `dispute_tenet` changes nothing at all: it states a different position
 * in public and starts a count. Only when the dissenters have held a third of
 * the congregation for three consecutive days may any of them `secede`, and
 * what they leave with is a share of the fund their own tithes paid for and
 * nothing else.
 *
 * The −15 on every bond across a fresh split is the same floor a feud puts on
 * one (`METROPOLIS.md` §7), and it heals the same way: `reunite_creed` needs
 * both officiants. The city gets its argument; some households do not get
 * their friends back.
 */
import type { ActionResult, CitizenId, World } from '../types.ts';
import { clamp } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens } from '../economy/treasury.ts';
import { adjustBond } from '../citizens/relationships.ts';
import { closePot, potOf } from '../finance/pot.ts';
import type { Creed, Tenet } from './shapes.ts';
import { MAX_CREED_NAME, MAX_TENET_TEXT, QUESTIONS, SCHISM_BOND, SCHISM_DAYS, SCHISM_SHARE } from './shapes.ts';
import { allCreeds, creedFor, creedId, creedOf, creedState, isMember, livingMembers, memberOf, newMember } from './state.ts';
import { fundBalance, openFund, payFromFund, setFundMembership, syncFundRule } from './fund.ts';
import { chooseOfficiant } from './officiant.ts';
import { endCreed, removeMember } from './creeds.ts';

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function cleanStance(v: number): number {
  return Number.isFinite(v) ? Math.round(clamp(v, -1, 1) * 100) / 100 : 0;
}

function cleanText(v: string | undefined): string {
  return (typeof v === 'string' ? v : '').trim().slice(0, MAX_TENET_TEXT);
}

function nameTaken(world: World, name: string): boolean {
  const want = name.toLowerCase();
  return allCreeds(world).some((k) => k.name.toLowerCase() === want);
}

/**
 * `dispute_tenet { tenetId, stance, text }` — state a different position, in
 * public. Nothing changes: what it does is start a count. When the dissenters
 * hold a third of the congregation for three consecutive days, any of them may
 * secede.
 */
export function disputeTenet(
  world: World, k: Creed, cId: CitizenId, tenetId: string, stance: number, text: string,
): ActionResult {
  if (!isMember(k, cId)) return fail(`You are not a member of ${k.name}.`);
  const tenet = k.tenets.find((t) => t.id === tenetId) ?? null;
  if (!tenet) return fail('There is no such tenet.');
  const s = creedState(world);
  let dispute = Object.values(s.disputes)
    .find((d) => d.creedId === k.id && d.tenetId === tenetId && d.resolvedDay === null) ?? null;
  const value = cleanStance(stance);
  const words = cleanText(text);
  if (!dispute) {
    dispute = {
      id: creedId(world, 'dp'), creedId: k.id, tenetId, stance: value, text: words, openedDay: world.day,
      dissenters: [cId], daysAtThreshold: 0, lastCountedDay: world.day - 1, resolvedDay: null, secededTo: null,
    };
    s.disputes[dispute.id] = dispute;
  } else if (!dispute.dissenters.includes(cId)) {
    dispute.dissenters.push(cId);
  } else {
    return fail('You have already stated your position against that tenet.');
  }
  const title = QUESTIONS[tenet.question].title.toLowerCase();
  emit(world, 'club',
    `${world.citizens[cId]?.name ?? 'A member'} disputed ${k.name}'s position on ${title}, holding ${value.toFixed(2)}: ${words}`,
    [cId], 0.4, { creedId: k.id, tenetId, stance: value, dissenters: dispute.dissenters.length });
  for (const id of livingMembers(world, k)) {
    if (id !== cId) remember(world, id, 'civic', `${world.citizens[cId]?.name} disputed ${k.name}'s position on ${title}.`);
  }
  return ok(`Your position against ${k.name}'s tenet on ${title} is public (${dispute.dissenters.length} dissenting).`);
}

/** Open disputes against a creed's tenets. */
export function disputesOf(world: World, k: Creed) {
  return Object.values(creedState(world).disputes).filter((d) => d.creedId === k.id && d.resolvedDay === null);
}

/**
 * Count each morning how long the dissenters have held a third. Three
 * consecutive days at the threshold opens the door to secession; a day below
 * it closes the door again, and the count starts over.
 */
export function countDisputes(world: World, k: Creed): void {
  const size = livingMembers(world, k).length;
  for (const d of disputesOf(world, k)) {
    if (d.lastCountedDay === world.day) continue;
    d.lastCountedDay = world.day;
    d.dissenters = d.dissenters.filter((id) => isMember(k, id) && world.citizens[id]?.standing !== 'exiled');
    if (d.dissenters.length === 0) { d.resolvedDay = world.day; continue; }
    const share = size > 0 ? d.dissenters.length / size : 0;
    d.daysAtThreshold = share >= SCHISM_SHARE ? d.daysAtThreshold + 1 : 0;
    if (d.daysAtThreshold === SCHISM_DAYS) {
      emit(world, 'club',
        `A third of ${k.name} has held against its position for ${SCHISM_DAYS} days; any of them may now secede.`,
        [...d.dissenters].slice(0, 5), 0.5, { creedId: k.id, disputeId: d.id, dissenters: d.dissenters.length });
    }
  }
}

// ---------------------------------------------------------------------------
// Schism and reunion
// ---------------------------------------------------------------------------

/**
 * `secede { creedId, name, tenetId }` — found a schism: a new creed with the
 * parent's tenets except the disputed one, a `parentCreed` link, a share of
 * the fund proportional to the seceders' tithes over the last cycle, and a
 * kindred relation. Bonds across a fresh schism take −15 the way a feud floors
 * them, and it heals the same way.
 */
export function secede(world: World, cId: CitizenId, creedId_: string, name: string, tenetId: string): ActionResult {
  const parent = creedOf(world, creedId_);
  if (!parent) return fail('There is no such creed.');
  if (!isMember(parent, cId)) return fail(`You are not a member of ${parent.name}.`);
  const dispute = disputesOf(world, parent).find((d) => d.tenetId === tenetId) ?? null;
  if (!dispute) return fail('Nobody has disputed that tenet in public.');
  if (!dispute.dissenters.includes(cId)) return fail('You have not stated a position against that tenet.');
  if (dispute.daysAtThreshold < SCHISM_DAYS) {
    return fail(`The dissenters have held a third of ${parent.name} for ${dispute.daysAtThreshold} of ${SCHISM_DAYS} days.`);
  }
  const wanted = (name ?? '').trim().slice(0, MAX_CREED_NAME);
  if (!wanted) return fail('A creed needs a name.');
  if (nameTaken(world, wanted)) return fail(`There is already a creed called ${wanted}.`);

  const seceders = dispute.dissenters.filter((id) => isMember(parent, id) && world.citizens[id]?.standing !== 'exiled');
  const tenets: Tenet[] = parent.tenets
    .filter((t) => t.id !== tenetId)
    .map((t) => ({ ...t, id: creedId(world, 'tn'), statedDay: world.day }));
  tenets.push({
    id: creedId(world, 'tn'), question: parent.tenets.find((t) => t.id === tenetId)?.question ?? 'informing',
    stance: dispute.stance, text: dispute.text, statedDay: world.day,
  });

  const pot = openFund(world, wanted, cId, parent.aidRule === 'officiant');
  const child: Creed = {
    id: creedId(world, 'cr'), name: wanted, founderId: cId, foundedDay: world.day, potId: pot.id, tenets,
    tithe: parent.tithe, gatheringDay: parent.gatheringDay, gatheringHour: parent.gatheringHour,
    succession: parent.succession, aidRule: parent.aidRule, examinationFloor: parent.examinationFloor,
    officiantId: cId, members: {}, roll: [], house: null, gatheringsHeld: 0,
    parentCreedId: parent.id, kindred: [parent.id], acclaim: {}, standing: [], ballots: {},
    lastElectionDay: null, endedDay: null,
  };
  creedState(world).creeds[child.id] = child;

  // The share of the fund the seceders' own tithes paid for, and no more.
  const paidAll = Object.values(parent.members).reduce((sum, m) => sum + m.tithePaid, 0);
  const paidThem = seceders.reduce((sum, id) => sum + (memberOf(parent, id)?.tithePaid ?? 0), 0);
  const balance = fundBalance(world, parent);
  const share = paidAll > 0 ? Math.round(balance * (paidThem / paidAll)) : 0;
  const moved = share > 0 ? payFromFund(world, parent, pot.boxId, share, `${wanted}'s share of ${parent.name}'s fund`, 'creed_aid') : 0;

  for (const id of seceders) {
    removeMember(world, parent, id);
    child.members[id] = newMember(world, id);
    child.roll.push(id);
    setFundMembership(world, child, id, true);
    remember(world, id, 'civic', `You seceded from ${parent.name} into ${wanted}.`);
  }
  // A schism cuts along friendships: the −15 lands on the pairs that carried it.
  for (const a of seceders) {
    for (const b of livingMembers(world, parent)) adjustBond(world, a, b, SCHISM_BOND);
  }
  parent.kindred.push(child.id);
  dispute.resolvedDay = world.day;
  dispute.secededTo = child.id;
  syncFundRule(world, child);
  chooseOfficiant(world, child);
  chooseOfficiant(world, parent);
  if (livingMembers(world, parent).length === 0) endCreed(world, parent, null, 'everyone left in the schism');

  emit(world, 'club',
    `${seceders.length} member${seceders.length === 1 ? '' : 's'} seceded from ${parent.name} to found ${wanted}, taking ${formatLumens(moved)} of the fund; the two are kindred and the bonds across the split are cold.`,
    seceders.slice(0, 5), 0.7, { creedId: child.id, parentCreedId: parent.id, members: seceders.length, share: moved });
  return ok(`${wanted} (${child.id}) is on the register with ${seceders.length} members and ${formatLumens(moved)}.`);
}

/**
 * `reunite_creed { creedId }` — heal a schism. It needs both officiants and a
 * majority in each, so this records one officiant's assent and completes the
 * reunion when the other has given theirs.
 */
export function reuniteCreed(world: World, cId: CitizenId, creedId_: string): ActionResult {
  const mine = creedFor(world, cId);
  if (!mine) return fail('You do not belong to a creed.');
  if (mine.officiantId !== cId) return fail(`Only ${mine.name}'s officiant may move to heal a schism.`);
  const other = creedOf(world, creedId_);
  if (!other) return fail('There is no such creed.');
  if (other.id === mine.id) return fail('A creed cannot reunite with itself.');
  if (!mine.kindred.includes(other.id)) return fail(`${other.name} is not kindred to ${mine.name}.`);

  const key = `reunite:${mine.id}:${other.id}`;
  const back = `reunite:${other.id}:${mine.id}`;
  if (typeof world.counters[back] === 'number') {
    delete world.counters[back];
    delete world.counters[key];
    return mergeCreeds(world, other, mine);
  }
  world.counters[key] = world.day;
  emit(world, 'club', `${mine.name} moved to reunite with ${other.name}; it needs ${other.name}'s officiant too.`,
    [cId], 0.4, { creedId: mine.id, other: other.id });
  if (other.officiantId) {
    remember(world, other.officiantId, 'civic', `${mine.name} has moved to reunite with ${other.name}.`);
  }
  return ok(`Your motion to reunite with ${other.name} stands; their officiant must move too.`);
}

/** Fold the second creed into the first: one roll, one fund, one house. */
function mergeCreeds(world: World, into: Creed, from: Creed): ActionResult {
  const target = potOf(world, into.potId);
  const joined: CitizenId[] = [];
  for (const id of livingMembers(world, from)) {
    const was = memberOf(from, id);
    removeMember(world, from, id);
    if (into.members[id]) continue;
    const m = newMember(world, id);
    if (was) { m.joinedDay = was.joinedDay; m.tithePaid = was.tithePaid; m.titheDue = was.titheDue; }
    into.members[id] = m;
    into.roll.push(id);
    setFundMembership(world, into, id, true);
    joined.push(id);
    remember(world, id, 'civic', `${from.name} reunited with ${into.name}; you are on its roll.`);
  }
  for (const a of joined) for (const b of into.roll) adjustBond(world, a, b, 5);
  from.endedDay = world.day;
  creedState(world).dead[from.id] = from;
  // The whole fund follows the roll into the surviving congregation.
  closePot(world, from.potId, target ? target.boxId : 'chest');
  chooseOfficiant(world, into);
  emit(world, 'club', `${from.name} and ${into.name} are one congregation again (${livingMembers(world, into).length} members).`,
    [], 0.6, { creedId: into.id, healed: from.id });
  return ok(`${from.name} and ${into.name} are one congregation again.`);
}
