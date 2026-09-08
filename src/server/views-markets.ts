/**
 * What `/api/economy` gained with the metropolis and the mobility layer: the
 * land under the city, the property register and its board, the Exchange's
 * share book, the concerns offered as going concerns, the gig board, the Outer
 * market and the Reserve.
 *
 * Read-only, like every view. Nothing here buys, sells, lets or lists: the
 * Exchange belongs to the citizens who trade at it (docs/PRINCIPLES.md §1).
 */
import type { Business, CitizenId, DistrictId, Gig, PropertyUnit, World } from '../types.ts';
import { landReadings, priceMultiplier } from '../economy/land.ts';
import { leversObservation, reserveTarget } from '../markets/levers.ts';
import {
  allUnits, askingPrice, isOfferedToLet, marketPrice, occupantOf, onSale, unitPrice,
} from '../markets/property.ts';
import { FIRE_SALE_MAX, FIRE_SALE_MIN, businessValue, businessesForSale } from '../markets/selling.ts';
import { listings } from '../markets/shares.ts';
import { allGigs, openGigs } from '../markets/gigs.ts';
import { outerMarket, tariff, touristsToday } from '../markets/outer.ts';
import { openDistricts } from '../world/growth.ts';
import { nameOf, personCard, portraitPath, presentSet } from './views.ts';

/** Finished gigs kept on the board's history. */
export const GIG_HISTORY_LENGTH = 30;
/** Share holders listed per listing. */
export const HOLDER_VIEW_LENGTH = 40;
/** An asking price this far over the address's worth is dear, and will sit. */
export const DEAR_ASK = 1.2;

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const round2 = (n: number): number => Math.round(n * 100) / 100;
const mean = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

function districtOfUnit(world: World, u: PropertyUnit): DistrictId | null {
  return world.buildings[u.buildingId]?.district ?? null;
}

function districtName(world: World, d: DistrictId): string {
  return world.districts[d]?.name ?? d;
}

function gigRow(world: World, gig: Gig, present: Set<CitizenId>): Record<string, unknown> {
  const posterName = world.citizens[gig.posterId]?.name ?? world.businesses[gig.posterId]?.name ?? gig.posterId;
  return {
    id: gig.id, title: gig.title, pay: gig.pay, skill: gig.skill, minSkill: gig.minSkill,
    posterId: gig.posterId, poster: posterName,
    taker: gig.takerId ? personCard(world, gig.takerId, present) : null,
    postedDay: gig.postedDay, doneDay: gig.doneDay,
  };
}

// ------------------------------------------------------------------- the land

/**
 * The morning's reading of every open district (`src/economy/land.ts`): what an
 * address there is worth against the city's average, the five readings that
 * make the number, how many come past the door, and what the register's rooms
 * there let and sell for. A world resumed from a save mid-day carries the
 * mirrored reading — value, footfall and prestige are the day's own, and the
 * other four readings wait for tomorrow morning rather than being recomputed
 * against an afternoon city.
 */
function landView(world: World, units: PropertyUnit[]): Record<string, unknown> {
  const readings = landReadings(world);
  const open = openDistricts(world);
  const rows = open.map((d) => {
    const r = readings[d];
    const here = units.filter((u) => districtOfUnit(world, u) === d);
    return {
      district: d, name: districtName(world, d),
      value: round2(r.value), footfall: round2(r.footfall), prestige: round2(r.prestige),
      amenity: round2(r.amenity), safety: round2(r.safety), access: round2(r.access), condition: round2(r.condition),
      pricePremium: round2(priceMultiplier(world, d)),
      units: here.length,
      occupied: here.filter((u) => u.tenantId !== null).length,
      vacancies: here.filter((u) => u.tenantId === null).length,
      privatelyOwned: here.filter((u) => u.ownerId !== 'city').length,
      meanRent: mean(here.map((u) => u.rent)),
      meanPrice: mean(here.map((u) => marketPrice(world, u))),
      residents: r.residents, offences: r.offences,
    };
  });
  const byValue = [...rows].sort((a, b) => b.value - a.value || a.district.localeCompare(b.district));
  return {
    asOfDay: typeof world.counters['land:asOfDay'] === 'number' ? world.counters['land:asOfDay'] : null,
    districts: rows,
    dearest: byValue.length ? byValue[0].district : null,
    cheapest: byValue.length ? byValue[byValue.length - 1].district : null,
  };
}

// --------------------------------------------------------------- the register

function unitRow(world: World, u: PropertyUnit): Record<string, unknown> {
  const occupant = occupantOf(world, u);
  const d = districtOfUnit(world, u);
  const asking = askingPrice(world, u);
  const worth = marketPrice(world, u);
  return {
    id: u.id, kind: u.kind, tier: u.tier, buildingId: u.buildingId,
    buildingName: world.buildings[u.buildingId]?.name ?? u.buildingId,
    district: d, districtName: d ? districtName(world, d) : null,
    ownerId: u.ownerId, owner: u.ownerId === 'city' ? 'City of Reverie' : nameOf(world, u.ownerId),
    tenantId: u.tenantId,
    tenant: u.tenantId ? nameOf(world, u.tenantId) ?? world.businesses[u.tenantId]?.name ?? null : null,
    occupant: occupant ? { id: occupant.id, name: occupant.name } : null,
    rent: u.rent, price: unitPrice(world, u),
    // What the owner is asking (`list_property`), and what the address is worth.
    asking, worth, dear: asking !== null && asking > worth * DEAR_ASK,
    onSale: onSale(world, u), toLet: isOfferedToLet(world, u),
  };
}

function concernRow(world: World, biz: Business, price: number): Record<string, unknown> {
  const worth = businessValue(world, biz);
  return {
    id: biz.id, name: biz.name, kind: biz.kind,
    district: biz.district, districtName: districtName(world, biz.district),
    ownerId: biz.ownerId, ownerName: nameOf(world, biz.ownerId), ownerPortrait: portraitPath(biz.ownerId),
    ask: price, worth, dear: price > worth * DEAR_ASK,
    treasury: biz.treasury, employees: biz.employees.length, foundedDay: biz.foundedDay,
  };
}

// ---------------------------------------------------------------------------

/** Land, property, concerns for sale, shares, gigs, the Outer market and the Reserve. */
export function economyExtras(world: World): Record<string, unknown> {
  const present = presentSet(world);
  const outer = outerMarket(world);
  const units = allUnits(world);
  const rows = units.map((u) => unitRow(world, u));
  const t = world.treasury;
  return {
    land: landView(world, units),
    property: {
      units: rows,
      // The board: what the city still holds, and what an owner has priced.
      listings: rows.filter((u) => u.asking !== null).sort((a, b) => (a.asking as number) - (b.asking as number)),
      onSale: rows.filter((u) => u.onSale).length,
      listed: rows.filter((u) => u.asking !== null).length,
      privatelyOwned: rows.filter((u) => u.ownerId !== 'city').length,
      cityOwned: rows.filter((u) => u.ownerId === 'city').length,
      tenanted: rows.filter((u) => u.tenantId !== null).length,
      toLet: rows.filter((u) => u.toLet).length,
      rentCollected: rows.filter((u) => u.ownerId !== 'city' && u.tenantId !== null)
        .reduce((sum, u) => sum + num(u.rent), 0),
      tax: leversObservation(world).propertyTax,
    },
    // Whole concerns offered at the Exchange (`sell_business`), and what the
    // quick way out pays instead (`liquidate`).
    concerns: {
      forSale: businessesForSale(world).map(({ business, price }) => concernRow(world, business, price)),
      fireSale: { min: FIRE_SALE_MIN, max: FIRE_SALE_MAX },
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
