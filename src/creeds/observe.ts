/**
 * What a citizen sees of the creeds (`docs/CREEDS.md` §8).
 *
 * All of it is public except which invitations a citizen has ignored, and that
 * is private only because an unanswered message always was. Nothing here is
 * shown to one kind of mind and not another: a reflex citizen, a child, a
 * Claude and a remote agent read the same rows.
 */
import type { CitizenId, DistrictId, World } from '../types.ts';
import type { RefusableDuty, Succession, TenetQuestion } from './shapes.ts';
import { QUESTIONS, tenetBinds } from './shapes.ts';
import {
  accommodationOf, allCreeds, creedFor, creedOf, invitationsFor, liveSanctuaries, livingMembers,
  memberOf, warrantOf,
} from './state.ts';
import { fundBalance, openClaims } from './fund.ts';
import { creedForm, describeForm } from './officiant.ts';
import { nextGatheringDay } from './house.ts';
import { bindingQuestions } from './observance.ts';
import { sitesHere } from './pilgrimage.ts';

export interface ObservedTenet {
  id: string;
  question: TenetQuestion;
  stance: number;
  text: string;
  /** True when this position actually obliges a member of anything. */
  binds: boolean;
}

export interface ObservedObligation {
  duty: TenetQuestion;
  obliges: string;
  keptSince: number;
}

export interface ObservedClaim {
  id: string;
  claimant: string;
  amount: number;
  reason: string;
  ayes: number;
  nays: number;
}

export interface ObservedOwnCreed {
  id: string;
  name: string;
  joinedDay: number;
  observance: number;
  tithe: number;
  titheArrears: number;
  fund: number;
  members: number;
  form: string;
  officiant: { id: CitizenId; name: string; succession: Succession } | null;
  house: { district: DistrictId; unit: string; rent: number } | null;
  gathering: { weekday: number; hour: number; inDays: number };
  tenets: ObservedTenet[];
  obligations: ObservedObligation[];
  accommodation: { duty: RefusableDuty; value: number }[];
  claims: ObservedClaim[];
  kindred: string[];
}

export interface ObservedCreed {
  id: string;
  name: string;
  members: number;
  tithe: number;
  stances: Partial<Record<TenetQuestion, number>>;
  kindred: string[];
  house: DistrictId | null;
}

export interface ObservedSanctuary {
  creed: string;
  house: string;
  who: string;
  charge: string | null;
  day: number;
  warrant: 'none' | 'pending' | 'granted' | 'refused' | 'stayed';
  officersAtTheDoor: number;
  keepingTheDoor: number;
}

export interface CreedObservation {
  creed: ObservedOwnCreed | null;
  creeds: ObservedCreed[];
  invitations: { from: string; creed: string; day: number }[];
  sanctuary: ObservedSanctuary | null;
  /** Consecrated sites standing where this citizen is standing. */
  sitesHere: { id: string; label: string; creed: string }[];
}

/** The duties a bench has ever ruled on for this creed, and where precedent stands. */
const DUTIES: readonly RefusableDuty[] = ['jury', 'witness', 'work', 'office', 'oath'];

function ownCreed(world: World, cId: CitizenId): ObservedOwnCreed | null {
  const k = creedFor(world, cId);
  if (!k) return null;
  const m = memberOf(k, cId);
  const officiant = k.officiantId ? world.citizens[k.officiantId] ?? null : null;
  return {
    id: k.id,
    name: k.name,
    joinedDay: m ? m.joinedDay : k.foundedDay,
    observance: m ? m.observance : 0,
    tithe: k.tithe,
    titheArrears: m ? m.titheArrears : 0,
    fund: fundBalance(world, k),
    members: livingMembers(world, k).length,
    form: `${creedForm(k)} — ${describeForm(k)}`,
    officiant: officiant ? { id: officiant.id, name: officiant.name, succession: k.succession } : null,
    house: k.house ? { district: k.house.district, unit: k.house.unitId, rent: k.house.rent } : null,
    gathering: {
      weekday: k.gatheringDay, hour: k.gatheringHour, inDays: nextGatheringDay(world, k) - world.day,
    },
    tenets: k.tenets.map((t) => ({
      id: t.id, question: t.question, stance: t.stance, text: t.text, binds: tenetBinds(t),
    })),
    obligations: bindingQuestions(k).map((q) => ({
      duty: q,
      obliges: QUESTIONS[q].obliges,
      keptSince: m ? m.obligationsKept : 0,
    })),
    accommodation: DUTIES
      .map((duty) => ({ duty, value: accommodationOf(world, k.id, duty) }))
      .filter((row) => row.value > 0),
    claims: openClaims(world, k).map((claim) => {
      let ayes = 0;
      let nays = 0;
      for (const v of Object.values(claim.votes)) (v ? ayes++ : nays++);
      return {
        id: claim.id, claimant: world.citizens[claim.claimantId]?.name ?? 'a member',
        amount: claim.amount, reason: claim.reason, ayes, nays,
      };
    }),
    kindred: k.kindred.filter((id) => creedOf(world, id) !== null),
  };
}

/** Every creed on the register, as anybody may read it. */
export function creedRegister(world: World): ObservedCreed[] {
  return allCreeds(world).map((k) => {
    const stances: Partial<Record<TenetQuestion, number>> = {};
    for (const t of k.tenets) stances[t.question] = t.stance;
    return {
      id: k.id, name: k.name, members: livingMembers(world, k).length, tithe: k.tithe, stances,
      kindred: k.kindred.filter((id) => creedOf(world, id) !== null),
      house: k.house ? k.house.district : null,
    };
  });
}

/** The sanctuary a citizen can see from where they stand, if one is running there. */
export function sanctuaryHere(world: World, district: DistrictId): ObservedSanctuary | null {
  const s = liveSanctuaries(world).find((x) => x.district === district) ?? null;
  if (!s) return null;
  const k = creedOf(world, s.creedId);
  const w = s.warrantId ? warrantOf(world, s.warrantId) : null;
  return {
    creed: k?.name ?? s.creedId,
    house: (world.buildings[s.buildingId]?.name) ?? s.buildingId,
    who: world.citizens[s.shelteredId]?.name ?? s.shelteredId,
    charge: s.charge,
    day: world.day - s.startedDay + 1,
    warrant: s.stayedUntilDay !== null && s.stayedUntilDay > world.day ? 'stayed' : (w ? w.status : 'none'),
    officersAtTheDoor: s.officersAtDoor.length,
    keepingTheDoor: s.keepingDoor.length,
  };
}

/** Everything one citizen sees of the creeds this hour. */
export function creedObservation(world: World, cId: CitizenId): CreedObservation {
  const c = world.citizens[cId];
  return {
    creed: ownCreed(world, cId),
    creeds: creedRegister(world),
    invitations: invitationsFor(world, cId).map((i) => ({
      from: world.citizens[i.fromId]?.name ?? 'a member', creed: i.creedId, day: i.day,
    })),
    sanctuary: c ? sanctuaryHere(world, c.district) : null,
    sitesHere: c
      ? sitesHere(world, c.district).map((s) => ({
        id: s.id, label: s.label, creed: creedOf(world, s.creedId)?.name ?? s.creedId,
      }))
      : [],
  };
}
