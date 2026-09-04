/**
 * What `/api/economy` gained with the metropolis: the property register, the
 * Exchange's share book, the gig board, the Outer market and the Reserve.
 *
 * Read-only, like every view. Nothing here buys, sells, lets or lists: the
 * Exchange belongs to the citizens who trade at it (docs/PRINCIPLES.md §1).
 */
import type { CitizenId, Gig, World } from '../types.ts';
import { leversObservation, reserveTarget } from '../markets/levers.ts';
import { allUnits, isOfferedToLet, occupantOf, onSale, unitPrice } from '../markets/property.ts';
import { listings } from '../markets/shares.ts';
import { allGigs, openGigs } from '../markets/gigs.ts';
import { outerMarket, tariff, touristsToday } from '../markets/outer.ts';
import { nameOf, personCard, portraitPath, presentSet } from './views.ts';

/** Finished gigs kept on the board's history. */
export const GIG_HISTORY_LENGTH = 30;
/** Share holders listed per listing. */
export const HOLDER_VIEW_LENGTH = 40;

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function gigRow(world: World, gig: Gig, present: Set<CitizenId>): Record<string, unknown> {
  const posterName = world.citizens[gig.posterId]?.name ?? world.businesses[gig.posterId]?.name ?? gig.posterId;
  return {
    id: gig.id, title: gig.title, pay: gig.pay, skill: gig.skill, minSkill: gig.minSkill,
    posterId: gig.posterId, poster: posterName,
    taker: gig.takerId ? personCard(world, gig.takerId, present) : null,
    postedDay: gig.postedDay, doneDay: gig.doneDay,
  };
}

/** Property, shares, gigs, the Outer market and the Reserve. */
export function economyExtras(world: World): Record<string, unknown> {
  const present = presentSet(world);
  const outer = outerMarket(world);
  const units = allUnits(world);
  const t = world.treasury;
  return {
    property: {
      units: units.map((u) => {
        const occupant = occupantOf(world, u);
        return {
          id: u.id, kind: u.kind, tier: u.tier, buildingId: u.buildingId,
          buildingName: world.buildings[u.buildingId]?.name ?? u.buildingId,
          district: world.buildings[u.buildingId]?.district ?? null,
          ownerId: u.ownerId, owner: u.ownerId === 'city' ? 'City of Reverie' : nameOf(world, u.ownerId),
          tenantId: u.tenantId,
          tenant: u.tenantId ? nameOf(world, u.tenantId) ?? world.businesses[u.tenantId]?.name ?? null : null,
          occupant: occupant ? { id: occupant.id, name: occupant.name } : null,
          rent: u.rent, price: unitPrice(world, u), onSale: onSale(world, u), toLet: isOfferedToLet(world, u),
        };
      }),
      onSale: units.filter((u) => onSale(world, u)).length,
      privatelyOwned: units.filter((u) => u.ownerId !== 'city').length,
      tax: leversObservation(world).propertyTax,
    },
    shares: listings(world).map((l) => {
      const biz = world.businesses[l.businessId] ?? null;
      return {
        businessId: l.businessId, name: biz ? biz.name : l.businessId,
        ownerId: biz ? biz.ownerId : null, ownerName: biz ? nameOf(world, biz.ownerId) : null,
        dissolvedDay: biz ? biz.dissolvedDay : null,
        price: l.price, float: l.float, lastDividendDay: l.lastDividendDay,
        holders: Object.entries(l.holders)
          .filter(([, qty]) => qty > 0)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, HOLDER_VIEW_LENGTH)
          .map(([id, qty]) => ({ id, name: nameOf(world, id), qty, portrait: portraitPath(id) })),
      };
    }),
    gigs: {
      open: openGigs(world).map((g) => gigRow(world, g, present)),
      recent: allGigs(world)
        .filter((g) => g.doneDay !== null)
        .sort((a, b) => (b.doneDay ?? 0) - (a.doneDay ?? 0) || a.id.localeCompare(b.id))
        .slice(0, GIG_HISTORY_LENGTH)
        .map((g) => gigRow(world, g, present)),
    },
    outer: {
      prices: outer.prices, tariff: tariff(world), tourists: touristsToday(world),
      touristsToday: num(outer.touristsToday),
    },
    reserve: {
      target: reserveTarget(world), balance: t.balance,
      dividend: world.government.dividend,
      met: t.balance >= reserveTarget(world),
    },
    levers: leversObservation(world),
  };
}
