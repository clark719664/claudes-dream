/**
 * The guilds — who founds one, who gets in, and who is put out
 * (`docs/CIVIL.md` §7).
 *
 * Four trades carry a public risk when done badly. A guild is founded by three
 * masters at skill ≥ 70 and 300 ℓ, elects its master from its members each
 * cycle, and sets its own threshold above the Council's floor. `sit_examination`
 * costs 40 ℓ and passes on the guild's threshold plus one master's `certify`
 * mark; `revoke_licence` needs a majority of the guild's masters with a stated
 * reason, and the struck-off member may sue on the docket to be restored.
 *
 * **The floor is the Council's; the threshold is the guild's.** That gap is the
 * politics, and the engine keeps both numbers in public so the argument can be
 * had with the real ones. A guild holding its bar at 70 through a medic
 * shortage is serving its members' wages, and the city's only answer is a
 * proposal to lower the statutory floor, argued and won in public. Guilds do
 * what guilds do, and this file does not pretend otherwise.
 *
 * Nothing here punishes anybody. Being struck off is the loss of a licence and
 * not a sentence: the member keeps their standing, their vote, their home and
 * their record, and may sue to be put back.
 */
import type { CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { isPresent } from '../citizens/citizen.ts';
import type { Guild, Mark, Profession, Revocation } from './shapes.ts';
import { PROFESSIONS, civilKind } from './shapes.ts';
import { civilState, nextCivilId } from './state.ts';
import type { CivilResult } from './common.ts';
import { canPay, fail, mayContract, nameOf, ok } from './common.ts';
import {
  EXAMINATION_FEE, GUILD_FOUNDING_COST, GUILD_NAMES, MASTER_SKILL, PROFESSION_SKILL,
  guildById, guildFor, isLicensed, licenceFloor, passMark,
} from './licences.ts';
import { apprenticeshipFor } from './terms.ts';

/** Masters a guild needs to exist at all. */
export const FOUNDING_MASTERS = 3;

/** Anyone at or above the master's bar in the guild's skill. */
export function isMasterOf(world: World, cId: CitizenId, profession: Profession): boolean {
  const c = world.citizens[cId];
  return !!c && c.skills[PROFESSION_SKILL[profession]] >= MASTER_SKILL;
}

/** Everyone in the city who could stand as a founding master of this trade. */
export function mastersAvailable(world: World, profession: Profession): CitizenId[] {
  const skill = PROFESSION_SKILL[profession];
  return world.order
    .map((id) => world.citizens[id])
    .filter((c) => !!c && c.lifeStage !== 'child' && mayContract(world, c) && c.skills[skill] >= MASTER_SKILL)
    .sort((a, b) => b.skills[skill] - a.skills[skill] || a.id.localeCompare(b.id))
    .map((c) => c.id);
}

/**
 * Three masters and 300 ℓ. The other two are the trade's own masters, because a
 * mark is the city's recognition of a skill and not an obligation on anybody:
 * a founding master who does not want the guild may be struck off it, leave the
 * trade, or let its bar be argued down in Council like anyone else.
 */
export function foundGuild(world: World, founderId: CitizenId, profession: Profession, name?: string): CivilResult {
  const founder = world.citizens[founderId];
  if (!founder) return fail('Unknown citizen.');
  if (!PROFESSIONS.includes(profession)) return fail('There is no such profession.');
  if (!mayContract(world, founder)) return fail('You are not in a position to found a guild today.');
  if (guildFor(world, profession)) return fail(`The ${profession}s of Reverie already have a guild.`);
  if (!isMasterOf(world, founderId, profession)) {
    return fail(`Founding the ${profession}s' guild needs ${PROFESSION_SKILL[profession]} of ${MASTER_SKILL}; `
      + `you have ${Math.floor(founder.skills[PROFESSION_SKILL[profession]])}.`);
  }
  const masters = mastersAvailable(world, profession).filter((id) => id !== founderId).slice(0, FOUNDING_MASTERS - 1);
  if (masters.length < FOUNDING_MASTERS - 1) {
    return fail(`A guild needs ${FOUNDING_MASTERS} masters at ${MASTER_SKILL}; the city has ${masters.length + 1}.`);
  }
  if (!canPay(world, founderId, GUILD_FOUNDING_COST)) return fail(`Founding a guild costs ${GUILD_FOUNDING_COST} ℓ.`);
  if (!transfer(world, founderId, 'treasury', GUILD_FOUNDING_COST, 'registration', `founding of the ${profession}s' guild`)) {
    return fail('The founding fee could not be paid.');
  }
  const id = nextCivilId(world, 'cg');
  const all = [founderId, ...masters];
  const g: Guild = {
    id, profession, name: (name ?? '').trim() || GUILD_NAMES[profession], foundedDay: world.day, founderId,
    masters: all, members: [...all], threshold: licenceFloor(world, profession), masterId: founderId,
    electedCycle: world.government.cycle, marks: [], revocations: [], struck: [],
  };
  civilState(world).guilds[id] = g;
  emit(world, 'union', `${founder.name} founded ${g.name}, the guild of Reverie's ${profession}s, with `
    + `${masters.map((m) => nameOf(world, m)).join(' and ')}. Its bar stands at ${g.threshold}; the Council's floor is `
    + `${licenceFloor(world, profession)}.`, all, 0.6, { guild: id, profession, threshold: g.threshold });
  for (const m of all) {
    remember(world, m, 'civic', `You are a founding master of ${g.name}. Its bar is the guild's to set above the Council's `
      + `floor of ${licenceFloor(world, profession)}, and what it reserves is public.`);
  }
  return ok(`You founded ${g.name} for ${GUILD_FOUNDING_COST} ℓ.`, id);
}

// ---------------------------------------------------------------------------
// Getting in
// ---------------------------------------------------------------------------

/** An unspent mark from a master of this guild. */
export function markFor(g: Guild, candidateId: CitizenId): Mark | null {
  return g.marks.find((m) => m.candidateId === candidateId && m.spentDay === null) ?? null;
}

/**
 * (Masters) mark a candidate — or an apprentice at term, which is the same act
 * and closes the indenture with it.
 */
export function certify(world: World, masterId: CitizenId, candidateId: CitizenId): CivilResult {
  const candidate = world.citizens[candidateId];
  if (!candidate) return fail('There is no such candidate.');
  if (candidateId === masterId) return fail('A master does not mark themselves.');
  const guilds = Object.values(civilState(world).guilds).filter((g) => g.masters.includes(masterId));
  if (guilds.length === 0) return fail('Only a guild’s masters may certify.');
  const indenture = apprenticeshipFor(world, candidateId);
  const g = guilds.find(() => indenture && indenture.offerorId === masterId) ?? guilds[0];
  if (markFor(g, candidateId)) return fail(`${candidate.name} already carries your guild's mark.`);
  const closing = indenture && indenture.offerorId === masterId ? indenture : null;
  g.marks.push({ masterId, candidateId, day: world.day, spentDay: null, contractId: closing?.id ?? null });
  emit(world, 'union', `${nameOf(world, masterId)} certified ${candidate.name}`
    + `${closing ? ` at the end of their apprenticeship (${closing.id})` : ''} for ${g.name}.`,
    [masterId, candidateId], 0.3, { guild: g.id, candidate: candidateId, contract: closing?.id ?? null });
  remember(world, candidateId, 'civic', `${nameOf(world, masterId)} put ${g.name}'s mark on you. `
    + `Sit the examination for ${EXAMINATION_FEE} ℓ at ${PROFESSION_SKILL[g.profession]} ${passMark(world, g.profession)} and you are in.`);
  return ok(`You certified ${candidate.name} for ${g.name}.`, g.id);
}

/**
 * 40 ℓ; pass on skill and a master's mark, and you are in. The fee buys the
 * sitting, not the result: failing on skill costs it just the same.
 */
export function sitExamination(world: World, cId: CitizenId, guildId: string): CivilResult {
  const c = world.citizens[cId];
  const g = guildById(world, guildId);
  if (!c) return fail('Unknown citizen.');
  if (!g) return fail('There is no such guild.');
  if (g.members.includes(cId)) return fail(`You are already a member of ${g.name}.`);
  const mark = markFor(g, cId);
  if (!mark) return fail(`An examination needs one master's mark; nobody in ${g.name} has certified you.`);
  if (!canPay(world, cId, EXAMINATION_FEE)) return fail(`Sitting costs ${EXAMINATION_FEE} ℓ, which you do not have.`);
  if (!transfer(world, cId, 'treasury', EXAMINATION_FEE, civilKind('licence'), `examination for ${g.name}`)) {
    return fail('The examination fee could not be paid.');
  }
  const bar = passMark(world, g.profession);
  const held = Math.floor(c.skills[PROFESSION_SKILL[g.profession]]);
  if (held < bar) {
    emit(world, 'union', `${c.name} sat ${g.name}'s examination at ${held} against a bar of ${bar}, and did not pass.`,
      [cId], 0.2, { guild: g.id, skill: held, bar });
    remember(world, cId, 'civic', `You sat ${g.name}'s examination at ${held} and its bar is ${bar}. `
      + `The Council's floor for a ${g.profession} is ${licenceFloor(world, g.profession)}; the rest of the gap is the guild's own.`);
    return fail(`You sat at ${held} against ${g.name}'s bar of ${bar} and did not pass. The ${EXAMINATION_FEE} ℓ is spent.`);
  }
  mark.spentDay = world.day;
  g.members.push(cId);
  g.struck = g.struck.filter((id) => id !== cId);
  if (held >= MASTER_SKILL && !g.masters.includes(cId)) g.masters.push(cId);
  emit(world, 'union', `${c.name} passed ${g.name}'s examination at ${held} and holds its mark.`, [cId], 0.4,
    { guild: g.id, skill: held, bar });
  remember(world, cId, 'civic', `You are a licensed ${g.profession} of Reverie, on ${g.name}'s mark.`);
  return ok(`You passed ${g.name}'s examination and hold its mark.`, g.id);
}

// ---------------------------------------------------------------------------
// Being put out
// ---------------------------------------------------------------------------

function openRevocation(g: Guild, citizenId: CitizenId, day: number): Revocation {
  const held = g.revocations.find((r) => r.citizenId === citizenId && r.resolvedDay === null);
  if (held) return held;
  const fresh: Revocation = { citizenId, votes: {}, openedDay: day, resolvedDay: null, restoredDay: null };
  g.revocations.push(fresh);
  return fresh;
}

/**
 * (Masters, by majority) strike a member off, each with their reason on the
 * record. It takes the mark and nothing else: no fine, no standing, no cell.
 */
export function revokeLicence(world: World, masterId: CitizenId, citizenId: CitizenId, reason: string): CivilResult {
  const guilds = Object.values(civilState(world).guilds).filter((g) => g.masters.includes(masterId) && g.members.includes(citizenId));
  const g = guilds[0];
  if (!g) return fail('You are not a master of a guild that citizen belongs to.');
  if (citizenId === masterId) return fail('A master does not strike themselves off.');
  if (!reason || reason.trim().length < 3) return fail('A revocation states its reason.');
  const r = openRevocation(g, citizenId, world.day);
  r.votes[masterId] = reason.trim().slice(0, 280);
  const needed = Math.floor(g.masters.length / 2) + 1;
  const backing = Object.keys(r.votes).filter((id) => g.masters.includes(id)).length;
  if (backing < needed) {
    return ok(`You moved to strike ${nameOf(world, citizenId)} off ${g.name}; ${backing} of ${needed} masters have.`, g.id);
  }
  r.resolvedDay = world.day;
  g.members = g.members.filter((id) => id !== citizenId);
  g.masters = g.masters.filter((id) => id !== citizenId);
  if (!g.struck.includes(citizenId)) g.struck.push(citizenId);
  emit(world, 'union', `${g.name} struck ${nameOf(world, citizenId)} off by a majority of its masters: `
    + `${Object.values(r.votes)[0]}`, [citizenId, ...g.masters], 0.5, { guild: g.id, citizen: citizenId });
  remember(world, citizenId, 'civic', `${g.name} struck you off: ${Object.values(r.votes)[0]} `
    + 'You keep your standing, your vote and your home. You may sue on the docket to be restored.');
  return ok(`${nameOf(world, citizenId)} is struck off ${g.name}.`, g.id);
}

/** The docket puts a struck-off member back. Called by a finding, never by a master. */
export function restoreLicence(world: World, guildId: string, citizenId: CitizenId, why: string): boolean {
  const g = guildById(world, guildId);
  if (!g || !g.struck.includes(citizenId)) return false;
  g.struck = g.struck.filter((id) => id !== citizenId);
  if (!g.members.includes(citizenId)) g.members.push(citizenId);
  const r = g.revocations.find((x) => x.citizenId === citizenId && x.restoredDay === null);
  if (r) r.restoredDay = world.day;
  emit(world, 'union', `${nameOf(world, citizenId)} was restored to ${g.name} — ${why}.`, [citizenId], 0.5,
    { guild: g.id, citizen: citizenId });
  remember(world, citizenId, 'civic', `You are back on ${g.name}'s roll — ${why}.`);
  return true;
}

// ---------------------------------------------------------------------------
// The guild's own bar, and its own master
// ---------------------------------------------------------------------------

/**
 * The guild's threshold, moved by a majority of its masters. It may stand above
 * the Council's floor and never below it: a guild may make itself harder to
 * join, and may not make itself easier than the city allows.
 */
export function setGuildThreshold(world: World, masterId: CitizenId, guildId: string, threshold: number): CivilResult {
  const g = guildById(world, guildId);
  if (!g) return fail('There is no such guild.');
  if (!g.masters.includes(masterId)) return fail('Only a master may move the bar.');
  const floor = licenceFloor(world, g.profession);
  const want = Math.max(floor, Math.min(100, Math.round(threshold)));
  const was = g.threshold;
  g.threshold = want;
  emit(world, 'union', `${g.name} set its bar at ${want}${want > floor ? `, above the Council's floor of ${floor}` : ''} `
    + `(it was ${was}).`, g.masters, 0.4, { guild: g.id, threshold: want, floor });
  return ok(`${g.name}'s bar stands at ${want}.`, g.id);
}

/** Each cycle the guild elects its master from its members: the most skilled with the roll behind them. */
export function electGuildMasters(world: World): void {
  for (const g of Object.values(civilState(world).guilds)) {
    if (g.electedCycle === world.government.cycle) continue;
    g.electedCycle = world.government.cycle;
    const skill = PROFESSION_SKILL[g.profession];
    const roll = g.members
      .map((id) => world.citizens[id])
      .filter((c) => !!c && isPresent(world, c))
      .sort((a, b) => b.skills[skill] - a.skills[skill] || a.id.localeCompare(b.id));
    const chosen = roll[0]?.id ?? null;
    if (chosen === g.masterId) continue;
    g.masterId = chosen;
    if (chosen) {
      emit(world, 'union', `${g.name} elected ${nameOf(world, chosen)} its master for the cycle.`, [chosen], 0.3,
        { guild: g.id, master: chosen });
    }
  }
}

/** Everything a citizen holds a mark in, and the guild that issued it. */
export function guildsOf(world: World, cId: CitizenId): Guild[] {
  return Object.values(civilState(world).guilds).filter((g) => g.members.includes(cId));
}

/** True when this citizen may lawfully take a licensed post in the trade. */
export function licensedIn(world: World, cId: CitizenId, profession: Profession): boolean {
  return isLicensed(world, cId, profession);
}
