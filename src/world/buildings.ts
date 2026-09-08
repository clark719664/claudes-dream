/**
 * What stands where. The register of buildings is a map keyed by id, so every
 * question of the form "what is in this district?" used to list the whole city
 * and throw most of it away — and those questions are asked from inside
 * per-citizen loops (a venue for a work, a ground to train on, somewhere to
 * break), which made the cost of finding one building grow with the size of
 * the city times the size of the population.
 *
 * The register only changes when the city builds or a district opens, so
 * during a reading round (`util/memo.ts`) each district's list is gathered
 * once and shared by everybody standing in it. Outside a round nothing is
 * remembered, exactly as before.
 *
 * This module is a leaf: it imports the world's shape and the round, and
 * nothing else, so anything may read it.
 */
import type { Building, DistrictId, World } from '../types.ts';
import { memo, memoBy } from '../util/memo.ts';

/** Every building in a district, in the register's own order. */
export function buildingsIn(world: World, district: DistrictId): Building[] {
  return byDistrict(world).get(district) ?? [];
}

/** Those of them still whole enough to be used, damaged, or broken further. */
export function intactBuildingsIn(world: World, district: DistrictId): Building[] {
  return memoBy(world, 'buildings:intact', district, () => buildingsIn(world, district).filter((b) => b.damage < 1));
}

/** The whole register sorted into districts, once for a reading round. */
function byDistrict(world: World): Map<DistrictId, Building[]> {
  return memo(world, 'buildings:byDistrict', () => {
    const out = new Map<DistrictId, Building[]>();
    for (const b of Object.values(world.buildings)) {
      const list = out.get(b.district);
      if (list) list.push(b);
      else out.set(b.district, [b]);
    }
    return out;
  });
}

/**
 * The first intact building of any of these kinds in a district — a venue, a
 * ground, a clinic — or null when the district has none.
 */
export function buildingOfKind(world: World, district: DistrictId, kinds: readonly Building['kind'][]): Building | null {
  for (const b of buildingsIn(world, district)) {
    if (b.damage < 1 && kinds.includes(b.kind)) return b;
  }
  return null;
}
