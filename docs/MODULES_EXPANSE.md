# Implementation contract — the Expanse (skeleton)

Extends `docs/MODULES.md`. Implements `docs/EXPANSE.md`. This skeleton fixes
the **architecture, identifiers and module boundaries**; a design agent
expands each section into exact signatures before implementers start.

## 1. Architecture

The existing `World` becomes **one city**. A new top-level `Expanse` owns
several of them plus everything between.

```ts
export interface Expanse {
  version: 1;
  config: ExpanseConfig;          // seed, cityCount, tick pace, founding charters
  rng: { s: number };             // world-level rng, separate from each city's
  tick: number; day: number; hour: number;   // one clock for the whole world
  terrain: Terrain;               // 400 x 300, run-length encoded
  cities: Record<CityId, World>;  // each a full city, unchanged in shape
  routes: Route[];
  transit: Traveller[];           // citizens and caravans on the road
  diplomacy: Record<PairKey, Relation>;   // standing, treaties, disputes, wars
  treaties: Treaty[];
  congress: Congress | null;
  exchange: Record<CityId, number>;       // units of that city's money per "unit of account"
  banRegistries: Record<CityId, string[]>; // shared registries by treaty
  worldEvents: WorldEvent[];      // the world Chronicle (bounded)
  counters: Record<string, number>;
}
```

`stepTick(expanse)`: tick every city (they are independent within a tick),
then resolve the world layer — transit arrivals, caravan sales, route
condition, exchange rates, diplomacy sessions, congress, conflict rounds,
contagion — then emit world events. A one-city Expanse must behave exactly
like today's `World` (the existing tests stay valid through a shim).

## 2. Identifiers (breaking change, do it first)

Ids become globally unique by carrying their city: `c_rv_12`, `b_vn_3`,
`j_ch_40`, `k_mg_7`. `nextId(world, prefix)` uses `world.cityCode` (two
letters). `src/actions/validate.ts` regexes become `/^c_[a-z]{2}_\d+$/` etc.
`loadWorld` migrates old saves (`c_12` → `c_rv_12`) once.

A citizen record lives in exactly one place: the `citizens` map of the city
it is in, or `expanse.transit`. Bonds, family, memory and cases keep working
across cities because ids never change. `locate(expanse, id)` returns
`{ where: 'city' | 'transit', cityId?, citizen }`.

## 3. Types (names fixed)

```ts
export type CityId = string;      // 'reverie' | 'vantage' | ...
export type CityCode = string;    // 'rv' | 'vn' | 'ch' | 'mg' | 'sl' | 'vg'
export type TerrainKind = 'plain'|'forest'|'hill'|'mountain'|'marsh'|'river'|'coast'|'sea';
export type RouteKind = 'road'|'river'|'sea'|'pass';
export interface Route { id: string; kind: RouteKind; a: CityId; b: CityId; tiles: number; condition: number; closedUntilDay: number | null; tollBy: CityId | null; toll: number }
export type TravellerKind = 'citizen'|'caravan'|'envoy'|'party'|'force'|'refugee';
export interface Traveller { id: string; kind: TravellerKind; from: CityId; to: CityId; routeId: string; progress: number; arrivesTick: number; citizenIds: CitizenId[]; cargo: Partial<Record<Good, number>>; money: number; currency: CityId; escort: number; purpose: string }
export type GovernmentForm = 'assembly'|'republic'|'oligarchy'|'technocracy'|'autocracy'|'commune'|'anarchy';
export interface Charter { seats: number; selection: 'election'|'lot'|'examination'|'shares'|'acclaim'|'none'; termDays: number; franchise: 'all'|'property'|'shares'|'guild'|'elders'|'none'; executive: 'elected'|'appointed'|'hereditary'|'none'|'strongest'; judges: 'appointed'|'elected'|'lot'|'guild'; amendment: number | 'executive'; entrenched: string[] }
export type TreatyKind = 'trade'|'tariff'|'non_aggression'|'alliance'|'extradition'|'open_borders'|'ban_registry'|'route'|'federation'|'peace';
export interface Treaty { id: string; kind: TreatyKind; parties: CityId[]; terms: Record<string, number|string>; signedDay: number; endsDay: number | null; brokenBy: CityId | null }
export interface Relation { standing: number; disputes: Dispute[]; warSinceDay: number | null; embargo: boolean; tariff: number }
export interface Dispute { id: string; kind: 'treaty_broken'|'raid'|'debt'|'extradition_refused'|'border'|'asylum'; day: number; by: CityId; against: CityId; summary: string; resolvedDay: number | null }
export interface Engagement { day: number; attacker: CityId; defender: CityId; district: DistrictId | null; attackers: CitizenId[]; defenders: CitizenId[]; outcome: 'repulsed'|'seized'|'stalemate'; injured: CitizenId[]; captured: CitizenId[]; loot: Partial<Record<Good, number>>; damage: number }
export interface Congress { host: CityId; members: CityId[]; delegates: Record<CityId, CitizenId[]>; motions: Motion[]; foundedDay: number }
```

City (`World`) additions: `cityId`, `cityCode`, `name`, `charter: Charter`,
`form: GovernmentForm` (classified daily), `currency: { code: string; symbol: string }`,
`immigration: 'open'|'quota'|'sponsored'|'examination'|'purchase'|'closed'`,
`quota: number`, `tariffs: Record<CityId, number>`, `visitors: CitizenId[]`,
`captives: CitizenId[]`, `occupiedBy: Record<DistrictId, CityId>`,
`muster: CitizenId[]`, `warChest: number`.

Citizen additions: `homeCity: CityId`, `residency: 'citizen'|'visitor'|'refugee'|'captive'`,
`residentSinceDay`, `travelledTo: CityId[]`, `knownCities: Record<CityId, { heardOf: boolean; lastNews: number }>`,
`injuredUntilDay: number | null`.

## 4. Modules (src/expanse/)

| Module | Contents |
| ------ | -------- |
| `expanse.ts` | createExpanse, stepTick, runDays, save/load, locate, cityOf |
| `terrain.ts` | terrain generation (seeded), tile kinds, city sites |
| `routes.ts` | route graph, travel time, condition decay and repair, closures, tolls, pathing |
| `travel.ts` | travel/arrive actions, transit resolution, hazards, escorts, banditry |
| `residency.ts` | visitor status, apply_residency, immigration rules, asylum, extradition, refugees |
| `caravans.ts` | load_caravan, sell into a destination market, tariffs, raids, insurance |
| `exchange.ts` | per-city currencies, floating rates from trade balance and money supply, conversion at the Exchange |
| `diplomacy.ts` | envoys, proposals, ratification by each city's own procedure, treaties, standing, disputes, sanctions |
| `congress.ts` | federation, delegates, motions, arbitration, secession |
| `conflict.ts` | muster (voluntary), raids, engagements, occupation, captives, injuries, displacement, peace terms, reparations |
| `charters.ts` | charter data, amendment procedure per charter, daily classification into GovernmentForm |
| `contagion.ts` | price propagation, plague spread along routes, idea and fashion diffusion |
| `founding.ts` | leaving to found a new city: party, wagon, site, charter drafting |
| `worldchronicle.ts` | the world Chronicle: what each city hears about the others, and when |

Actions added (per `docs/EXPANSE.md`): `travel`, `apply_residency`,
`seek_asylum`, `load_caravan`, `sell_cargo`, `set_tariff` (councillors),
`propose_treaty`, `ratify_treaty`, `send_envoy`, `raise_dispute`,
`declare_sanction`, `muster`, `join_muster`, `raid`, `declare_war`,
`offer_peace`, `exchange_money`, `found_city`, `amend_charter`.

## 5. Server and web

- `GET /api/expanse` (map, cities, routes, transit), `/api/expanse/diplomacy`,
  `/api/expanse/trade`, `/api/expanse/congress`, `/api/expanse/chronicle`;
  existing city routes gain a `?city=` parameter and default to the first city.
- `web/`: a world view above the city dashboard (map with cities, routes,
  moving caravans, war fronts, a diplomacy web, trade flows, exchange rates,
  treaties, migration) and a click-through into any city's full dashboard.
- Still observation only: no controls, no god mode (`docs/PRINCIPLES.md`).

## 6. Order of work

1. Ids and the `World` → city shim (all existing tests still pass).
2. `Expanse` with one city, ticking through the new loop (behaviour identical).
3. Terrain, routes, travel, residency — two cities, agents moving.
4. Currencies, exchange, caravans, tariffs — trade working.
5. Charters and classification — six founding cities with different forms.
6. Diplomacy, treaties, disputes, sanctions.
7. Conflict: raids, muster, engagements, occupation, captives, peace.
8. Congress, founding new cities, contagion.
9. World map UI and the world Chronicle.
