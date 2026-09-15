/**
 * What a citizen can see of the underworld — which is all of it, because
 * everything in Reverie is observable (`PRINCIPLES.md` §5).
 *
 * There is nothing here a citizen could not have counted for themselves: the
 * schedule is law and law is published, the gate's roster is a list of people
 * standing in a doorway, the offers are offers made to *them*, an assignment is
 * printed the day it is made, and a shelf price is written on the shelf. The
 * one thing that is not here is anybody's *intention*: no citizen ever sees
 * that another means to run a load, because conspiracy is not an offence in
 * Reverie and there is nothing to see until somebody acts.
 */
import type { CitizenId, World } from '../types.ts';
import { customsLine, gateFor, manifestsFor } from './customs.ts';
import { fenceLine, offersTo } from './black.ts';
import { retainerOffersTo, secretLine, secretsHeldBy, liveRetainerOf } from './espionage.ts';
import { assignmentsOf, liveAssignments, shelfStory } from './counter.ts';
import { scheduleLine } from './schedule.ts';
import { blackPriceStory } from './daily.ts';
import { HOME_CITY, amnestyRunning, cityName, hasFittedWagon, isGateBanned, underworldState } from './state.ts';

export interface ObservedOffer {
  id: string;
  from: string;
  fromId: CitizenId;
  what: string;
  qty: number;
  price: number;
}

export interface ObservedRetainerOffer {
  id: string;
  from: string;
  perDay: number;
  days: number;
  forCity: string;
}

export interface UnderworldObservation {
  /** The schedule of the city you are standing in, in the words the charge sheet uses. */
  schedule: string;
  /** The gates, their posts and today's crossings. */
  gates: string;
  /** The gate you are standing at, and who is on it. */
  atGate: { name: string; officers: string[] } | null;
  /** Manifests you have filed today. */
  manifests: string[];
  /** Offers standing before you from a hand that did not ask where it came from. */
  offers: ObservedOffer[];
  /** Retainers offered to you, and what they say they are for. */
  retainers: ObservedRetainerOffer[];
  /** The retainer you are working under, if any. It is in the ledger either way. */
  workingFor: string | null;
  /** Secrets you hold, and what each is still worth. */
  secrets: string[];
  /** Assignments the Watch has published — on you, and by you if you are a detective. */
  assignments: string[];
  /** What the prices are saying, which is what a detective reads. */
  story: string | null;
  wagon: boolean;
  gateBanned: boolean;
  amnesty: boolean;
  /** What the city says about who takes what, if it says anything. */
  wordOfMouth: string;
}

/** The whole layer as one citizen sees it. */
export function underworldObservation(world: World, cId: CitizenId): UnderworldObservation {
  const c = world.citizens[cId];
  const gate = c ? gateFor(world, c) : null;
  const retainer = liveRetainerOf(world, cId);
  const onMe = liveAssignments(world)
    .filter((a) => a.citizenId === cId)
    .map((a) => `The Watch has a detective on you (${a.id}, since day ${a.day}).`);
  const mine = assignmentsOf(world, cId).map((a) =>
    `You are assigned to ${a.building ? world.buildings[a.building]?.name ?? a.building : world.citizens[a.citizenId ?? '']?.name ?? 'somebody'} (${a.id}).`);

  return {
    schedule: scheduleLine(world, HOME_CITY),
    gates: customsLine(world),
    atGate: gate ? { name: gate.name, officers: gate.officers.map((o) => o.name) } : null,
    manifests: manifestsFor(world, cId).map((m) =>
      `${m.id}: ${m.declaredQty} ${m.good ?? m.productId ?? 'lumens'} at ${m.declaredValue} ℓ, duty ${m.dutyPaid} of ${m.duty} ℓ.`),
    offers: offersTo(world, cId).map((d) => ({
      id: d.id, fromId: d.sellerId, from: world.citizens[d.sellerId]?.name ?? d.sellerId,
      what: d.good ?? d.productId ?? 'a lot', qty: d.qty, price: d.price,
    })),
    retainers: retainerOffersTo(world, cId).map((r) => ({
      id: r.id, from: world.citizens[r.handlerId]?.name ?? r.handlerId,
      perDay: r.perDay, days: r.days, forCity: cityName(r.forCity),
    })),
    workingFor: retainer ? `${cityName(retainer.forCity)}, at ${retainer.perDay} ℓ a day (${retainer.id})` : null,
    secrets: secretsHeldBy(world, cId).map((x) => secretLine(world, x)),
    assignments: [...onMe, ...mine],
    story: shelfStory(world) ?? blackPriceStory(world),
    wagon: hasFittedWagon(world, cId),
    gateBanned: isGateBanned(world, cId),
    amnesty: amnestyRunning(world),
    wordOfMouth: fenceLine(world, cId),
  };
}

/** A compact summary for the dashboard: what the underworld did today. */
export function underworldSummary(world: World): {
  crossings: number; seizures: number; deals: number; secrets: number; assignments: number; amnesty: boolean;
} {
  const s = underworldState(world);
  return {
    crossings: s.crossings.filter((x) => x.day === world.day).length,
    seizures: s.crossings.filter((x) => x.day === world.day && x.caught).length,
    deals: s.deals.filter((d) => d.takenDay === world.day).length,
    secrets: s.secrets.filter((x) => x.takenDay === world.day).length,
    assignments: liveAssignments(world).length,
    amnesty: amnestyRunning(world),
  };
}
