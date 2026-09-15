/**
 * `file_nuisance` — a civil claim for the damage somebody else's emissions do
 * (`docs/ENVIRONMENT.md` §7, `docs/CIVIL.md` §4).
 *
 * A downstream household or business does not have to wait for the Watch. It
 * needs no conviction, no officer and no detection roll: it needs an address
 * that the smoke or the water reaches, a defendant whose works put it there,
 * and a filing fee. A judge who is a citizen decides it on the docket's own
 * merit formula, and may award damages or refuse them.
 *
 * The two answers are separate and both stand: `discharge` is L45 and answers
 * to the ladder for the offence against the city; this answers to the docket
 * for the harm to a neighbour.
 */
import type { CitizenId, DistrictId, World } from '../types.ts';
import { fileSuit } from '../civil/docket.ts';
import type { CivilResult } from '../civil/common.ts';
import { districtName } from '../actions/common.ts';
import { isOpen } from '../world/growth.ts';
import { environmentState } from './state.ts';
import { emittersToday } from './emissions.ts';
import { downstreamOf, downwindOf } from './wind.ts';
import { pollutionBurden } from './readings.ts';

/** What a mote is worth in a claim, before a judge reads it. */
export const NUISANCE_PER_MOTE = 8;
/** And what standing in the burden itself is worth, per point of it. */
export const NUISANCE_PER_BURDEN = 40;

function fail(message: string): CivilResult {
  return { ok: false, message };
}

/** Whether what one district emits reaches another, by the wind or by the water. */
export function reaches(world: World, from: DistrictId, to: DistrictId): boolean {
  if (from === to) return true;
  if (downwindOf(world, from).includes(to)) return true;
  let at: DistrictId | null = from;
  const seen = new Set<DistrictId>();
  while (at && !seen.has(at)) {
    seen.add(at);
    at = downstreamOf(world, at);
    if (at === to) return true;
  }
  return false;
}

/** What one citizen's works put out today, and where from. */
export function emissionsBy(world: World, ownerId: CitizenId): { district: DistrictId; motes: number }[] {
  const biz = world.citizens[ownerId]?.businessId ?? null;
  const owned = new Set<string>();
  if (biz) owned.add(biz);
  for (const b of Object.values(world.businesses)) {
    if (b.ownerId === ownerId && b.dissolvedDay === null) owned.add(b.id);
  }
  const out = new Map<DistrictId, number>();
  for (const row of emittersToday(world)) {
    if (!owned.has(String(row.owner))) continue;
    out.set(row.district, (out.get(row.district) ?? 0) + row.motes);
  }
  return [...out.entries()].map(([district, motes]) => ({ district, motes }));
}

/**
 * Sue a neighbour for what their works are putting over your address. The sum
 * claimed is public arithmetic — what they emitted, and what the air where you
 * live already stands at — and the docket decides whether any of it is owed.
 */
export function fileNuisance(
  world: World, plaintiffId: CitizenId, againstId: CitizenId, district: DistrictId,
): CivilResult {
  const plaintiff = world.citizens[plaintiffId];
  const defendant = world.citizens[againstId];
  if (!plaintiff) return fail('Unknown citizen.');
  if (!defendant || againstId === plaintiffId) return fail('There is nobody to sue there.');
  if (!isOpen(world, district)) return fail('The city has not opened that district.');
  const home = plaintiff.homeBuildingId ? world.buildings[plaintiff.homeBuildingId]?.district ?? null : null;
  if ((home ?? plaintiff.district) !== district) {
    return fail(`A nuisance is sued for where you live or trade; you are not of ${districtName(world, district)}.`);
  }
  const works = emissionsBy(world, againstId).filter((w) => reaches(world, w.district, district));
  const motes = works.reduce((sum, w) => sum + w.motes, 0);
  if (motes <= 0) {
    return fail(`Nothing ${defendant.name} works reaches ${districtName(world, district)}; there is nothing to sue about.`);
  }
  const burden = pollutionBurden(world, district);
  const damages = Math.max(1, Math.round(NUISANCE_PER_MOTE * motes + NUISANCE_PER_BURDEN * burden));
  const where = works.map((w) => districtName(world, w.district)).join(' and ');
  const claim = `${Math.round(motes * 100) / 100} motes out of ${where} reach ${districtName(world, district)}, `
    + `where the air stands at ${burden.toFixed(2)}`;
  const filed = fileSuit(world, plaintiffId, { defendant: againstId, claim, damages });
  if (filed.ok) {
    const s = environmentState(world);
    s.readings.push({ district, kind: 'air', value: Math.round(burden * 1000) / 1000, day: world.day, byId: plaintiffId });
  }
  return filed;
}
