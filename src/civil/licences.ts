/**
 * Licensing — the four trades that carry a public risk when done badly, and
 * what the mark actually reserves (`docs/CIVIL.md` §7).
 *
 * A licence protects the public from a builder who cannot build and protects
 * builders from competition, and the engine cannot tell the two apart. What it
 * can do is keep the two numbers separate and public: **the floor is the
 * Council's, the threshold is the guild's**, and the guild may set it higher.
 * A guild holding its bar at 70 through a medic shortage is serving its
 * members' wages, and the city's only answer is a proposal to lower the
 * statutory floor, argued and won in public.
 *
 * Practising a reserved act without the mark is **L20, severity 2**, on the
 * civic ladder — a fine at worst, never custody, and never exile on its own.
 * It is not `UNDERWORLD.md`'s L29 (trading as a business with no trading
 * licence): a citizen can commit either without the other.
 *
 * This file only *answers questions*. It never charges anybody: the Watch
 * detects an offence like anything else, and the codes below are handed out as
 * plain strings because `types.ts` does not carry L20–L22 yet.
 */
import type { CitizenId, Skill, World } from '../types.ts';
import type { Guild, Profession } from './shapes.ts';
import { PROFESSIONS } from './shapes.ts';
import { civilSettings, civilState } from './state.ts';

/** The codes `CIVIL.md` §10 adds, all three on the civic ladder and none custodial. */
export const UNLICENSED_PRACTICE = 'L20';
export const FORGING_AN_INSTRUMENT = 'L21';
export const FRAUDULENT_CONVEYANCE = 'L22';

/** The skill each profession is examined in. */
export const PROFESSION_SKILL: Record<Profession, Skill> = {
  medic: 'care', advocate: 'rhetoric', banker: 'commerce', builder: 'crafting',
};

/** What a guild is called when its founders do not name it. */
export const GUILD_NAMES: Record<Profession, string> = {
  medic: "The Ward's Company", advocate: 'The Bar of Reverie',
  banker: 'The Lantern House', builder: 'The Yard',
};

/** The acts each profession reserves to its members. */
export type ReservedAct =
  | 'treat' | 'staff_clinic' | 'certify_glitch'
  | 'advocate' | 'appear_on_docket' | 'represent_at_hearing'
  | 'issue_large_loan' | 'hold_escrow' | 'value_estate'
  | 'contract_public_works' | 'structural_repair' | 'certify_building';

export const RESERVED_ACTS: Record<ReservedAct, Profession> = {
  treat: 'medic', staff_clinic: 'medic', certify_glitch: 'medic',
  advocate: 'advocate', appear_on_docket: 'advocate', represent_at_hearing: 'advocate',
  issue_large_loan: 'banker', hold_escrow: 'banker', value_estate: 'banker',
  contract_public_works: 'builder', structural_repair: 'builder', certify_building: 'builder',
};

/** A private loan needs no licence under this; at or above it, the lender must be a banker. */
export const UNLICENSED_LOAN_LIMIT = 200;

/** What a sitting costs, whether it is passed or failed. */
export const EXAMINATION_FEE = 40;
/** Three masters, and this much skill in each of them, found a guild. */
export const MASTER_SKILL = 70;
/** What founding a guild costs. */
export const GUILD_FOUNDING_COST = 300;

/** The guild of a profession, or null where nobody has founded one. */
export function guildFor(world: World, profession: Profession): Guild | null {
  for (const g of Object.values(civilState(world).guilds)) {
    if (g.profession === profession) return g;
  }
  return null;
}

/** Every guild, oldest first. */
export function allGuilds(world: World): Guild[] {
  return Object.values(civilState(world).guilds).sort((a, b) => a.foundedDay - b.foundedDay || a.id.localeCompare(b.id));
}

export function guildById(world: World, id: string): Guild | null {
  return civilState(world).guilds[id] ?? null;
}

/** The Council's statutory floor for a profession. */
export function licenceFloor(world: World, profession: Profession): number {
  return civilSettings(world).floors[profession];
}

/**
 * The bar a candidate must actually clear: the guild's threshold where a guild
 * exists and has set one higher, and the Council's floor where it has not.
 */
export function passMark(world: World, profession: Profession): number {
  const floor = licenceFloor(world, profession);
  const g = guildFor(world, profession);
  return g ? Math.max(floor, g.threshold) : floor;
}

/**
 * Is this citizen licensed in the profession? A guild's member, and not struck
 * off. Where the city has no guild in a trade the Council's floor stands alone
 * and anybody at or above it may practise: a licence nobody issues cannot be
 * required of anybody.
 */
export function isLicensed(world: World, cId: CitizenId, profession: Profession): boolean {
  const g = guildFor(world, profession);
  if (!g) {
    const c = world.citizens[cId];
    return !!c && c.skills[PROFESSION_SKILL[profession]] >= licenceFloor(world, profession);
  }
  return g.members.includes(cId) && !g.struck.includes(cId);
}

/** Every profession this citizen may practise today. */
export function licencesOf(world: World, cId: CitizenId): Profession[] {
  return PROFESSIONS.filter((p) => isLicensed(world, cId, p));
}

/** May this citizen lawfully do this act? */
export function mayPerform(world: World, cId: CitizenId, act: ReservedAct): boolean {
  return isLicensed(world, cId, RESERVED_ACTS[act]);
}

/**
 * The offence, where there is one. Returns the code and the reason for the
 * Watch to read; filing the charge is the Watch's own act, and nothing here
 * detains, fines or suspends anybody.
 */
export function unlicensedPractice(
  world: World, cId: CitizenId, act: ReservedAct,
): { code: string; profession: Profession; reason: string } | null {
  const profession = RESERVED_ACTS[act];
  if (mayPerform(world, cId, act)) return null;
  const g = guildFor(world, profession);
  const bar = passMark(world, profession);
  return {
    code: UNLICENSED_PRACTICE,
    profession,
    reason: g
      ? `${act.replace(/_/g, ' ')} is reserved to ${g.name}, whose mark this citizen does not hold`
      : `${act.replace(/_/g, ' ')} needs ${profession} skill of ${bar}, which this citizen does not have`,
  };
}

/**
 * Whether Reverie honours another city's mark in a profession. A licence is a
 * local instrument and recognition at founding is uneven; a Council changes any
 * of it by proposal (`licence_recognition`), and reciprocity is an ordinary
 * thing for envoys to trade for.
 */
export function recognises(world: World, profession: Profession, city: string): boolean {
  return civilSettings(world).recognises[profession].includes(city.toLowerCase());
}

/** The Council's proposal, applied: whose marks Reverie honours in a trade. */
export function setRecognition(world: World, profession: Profession, cities: string[]): void {
  const s = civilSettings(world);
  const seen = new Set(['reverie', ...cities.map((c) => c.toLowerCase())]);
  s.recognises[profession] = [...seen];
}

/** The Council's proposal, applied: the statutory floor of a trade. */
export function setLicenceFloor(world: World, profession: Profession, floor: number): void {
  civilSettings(world).floors[profession] = Math.max(0, Math.min(100, Math.round(floor)));
}
