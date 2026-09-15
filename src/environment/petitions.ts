/**
 * NIMBY — the jobs without the smoke (`docs/ENVIRONMENT.md` §6).
 *
 * `petition_zoning` at a fifth of a **district's** residents puts the permit to
 * a citywide **referendum** on the next Stillday, and a referendum binds the
 * Council. It is the one deliberate exception to the `PETITION_SHARE` of a
 * fifth of the whole city: only the residents of the district whose permit is
 * at stake may open it at the district share, and the ballot they open is still
 * the city's.
 *
 * That asymmetry is the mechanic, not a bug in it. A motion to keep heavy
 * industry in Foundry Row can carry 55–45 across the city while Foundry Row
 * votes 82 % against, and the Chronicle prints both numbers. The district that
 * hosts the smoke is outvoted by the city that eats the compute, lawfully, on a
 * fair ballot, every time — and what ends the fight is a price (`host_payment`).
 */
import type { ActionResult, CitizenId, DistrictId, Proposal, World } from '../types.ts';
import { districtName, fail } from '../actions/common.ts';
import { isOpen } from '../world/growth.ts';
import { isVoter, liveSignatures, openReferendum, pendingReferendum, referendumFor, signPetition } from '../politics/referendums.ts';
import { environmentState } from './state.ts';
import type { Permit } from './state.ts';
import { readPermit, residentsOf } from './zoning.ts';
import { tableEnvironmentMeasure } from './proposals.ts';

/** A fifth of the district — not of the city (`ENVIRONMENT.md` §6). */
export const DISTRICT_PETITION_SHARE = 0.20;

/** The residents of a district who may sign at the district share. */
export function districtVoters(world: World, d: DistrictId): CitizenId[] {
  return residentsOf(world, d).filter((id) => {
    const c = world.citizens[id];
    return !!c && isVoter(world, c);
  });
}

/** Names a district petition needs: a fifth of its own residents, never fewer than one. */
export function districtSignaturesNeeded(world: World, d: DistrictId): number {
  return Math.max(1, Math.ceil(DISTRICT_PETITION_SHARE * districtVoters(world, d).length));
}

/**
 * `petition_zoning` — a resident puts their district's permit to the city. The
 * petition is an ordinary one, signed with `sign_petition` like any other; what
 * is different is only who may open it and how many names it takes.
 */
export function petitionZoning(
  world: World, cId: CitizenId, district: DistrictId, permit: Permit,
): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isOpen(world, district)) return fail('The city has not opened that district.');
  const wanted = readPermit(permit);
  if (!wanted) return fail('A zoning petition must name a permit.');
  if (!isVoter(world, c)) return fail(`You cannot open a petition while ${c.standing}.`);
  if (!residentsOf(world, district).includes(cId)) {
    return fail(`Only the residents of ${districtName(world, district)} may put its permit to the city at the district's own share.`);
  }
  const needed = districtSignaturesNeeded(world, district);
  const tabled = tableEnvironmentMeasure(world, cId, {
    kind: 'zone', district, permit: wanted, petition: true,
    summary: `Zone ${districtName(world, district)} ${wanted.replace(/_/g, ' ')} — put to the city by its own residents`,
  });
  if (!tabled.proposal) return tabled.result;
  const signed = signPetition(world, cId, tabled.proposal.id);
  const standing = districtSignatures(world, tabled.proposal).length;
  return {
    ok: true,
    message: `Petition ${tabled.proposal.id} is open: ${standing} of the ${needed} names ${districtName(world, district)} needs `
      + `to put its permit to the whole city.${signed.ok ? '' : ` (${signed.message})`}`,
  };
}

/** The names on a petition that are residents of the district whose permit it moves. */
export function districtSignatures(world: World, p: Proposal): CitizenId[] {
  const q = environmentState(world).zoning[p.id];
  if (!q?.district) return [];
  const residents = new Set(residentsOf(world, q.district));
  return liveSignatures(world, p).filter((id) => residents.has(id));
}

/** Where a district's petition stands: its own names, and what it needs. */
export function districtPetitionStanding(
  world: World, proposalId: string,
): { district: DistrictId; signatures: number; needed: number; crossed: boolean } | null {
  const q = environmentState(world).zoning[proposalId];
  if (!q?.district || !q.petition) return null;
  const p = world.government.proposals.find((x) => x.id === proposalId);
  if (!p) return null;
  const signatures = districtSignatures(world, p).length;
  const needed = districtSignaturesNeeded(world, q.district);
  return { district: q.district, signatures, needed, crossed: signatures >= needed };
}

/**
 * The morning: a district petition that has its own names goes to the city on
 * the next Stillday. One question at a time, exactly as
 * `politics/referendums.ts` has it — the city answers them in the order they
 * filled up.
 */
export function dailyZoningPetitions(world: World): void {
  if (pendingReferendum(world)) return;
  const s = environmentState(world);
  const ready: { p: Proposal; signatures: number }[] = [];
  for (const p of world.government.proposals) {
    const q = s.zoning[p.id];
    if (!q || !q.petition || !q.district) continue;
    if (p.status === 'passed') continue;
    if (referendumFor(world, p.id)) continue;
    const standing = districtPetitionStanding(world, p.id);
    if (!standing || !standing.crossed) continue;
    ready.push({ p, signatures: standing.signatures });
  }
  if (ready.length === 0) return;
  ready.sort((a, b) => b.signatures - a.signatures || a.p.tabledDay - b.p.tabledDay || a.p.id.localeCompare(b.p.id));
  openReferendum(world, ready[0].p);
}
