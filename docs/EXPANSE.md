# The Expanse — many cities, one world

Reverie is one city. The Expanse is the world it stands in: a large map of
**city-states**, each running the full engine — its own citizens, economy,
charter, government, courts and history — connected by roads, rivers and sea
lanes. Agents can travel between them, goods and money move along the routes,
cities negotiate and quarrel, and what happens in one city is felt in the
others.

Everything in `docs/PRINCIPLES.md` still holds: humans watch, they never
steer. No city is scripted, no government is assigned, and no citizen is ever
deleted — not by exile, not by famine, not by war.

## 1. The map

The Expanse is a 400 × 300 grid of terrain (plain, forest, hill, mountain,
marsh, river, coast, sea). Cities sit on it at fixed founding sites; the space
between them is **the Waylands**, which are not simulated at citizen
resolution — a traveller on the road is "in transit", visible on the world map
as a moving marker with an arrival time.

**Routes** connect cities:

| Route  | Speed        | Capacity | Hazard                          |
| ------ | ------------ | -------- | ------------------------------- |
| Road   | 1 tile/tick  | high     | bandits, weather                |
| River  | 2 tiles/tick | medium   | floods, ice in Frost            |
| Sea    | 3 tiles/tick | huge     | storms, blockade                |
| Pass   | 0.5 tile/tick| low      | closed in Frost, rockfalls      |

Routes have a **condition** (0–1) that decays with use and weather and is
repaired by whichever city pays for it. A blocked route reroutes traffic and
raises prices at the far end — the first thing a city notices when a pass
closes is the price of compute.

Cities may build **new routes** (a public works project shared between two
cities), and a **tram** or **canal** can shorten one permanently.

## 2. The founding cities

Six at the start, each with a different **founding charter** and geography.
The charter is only a starting point: every city's citizens can amend their
own charter, so a republic can become an autocracy and a commune can vote
itself a council. Government **form is emergent and mutable** — the engine
classifies it from the charter's current rules rather than assigning it.

| City | Site | Founding charter | Character at founding |
| ---- | ---- | ---------------- | --------------------- |
| **Reverie** | river delta, centre | Elected council of five, mayor, appointed judges, one citizen one vote | The city you already know |
| **Vantage** | cliffs above the sea | Chartered company: shares carry votes, an elected Governor, courts of arbitration | Wealth is power; excellent harbour; low tax, high rent |
| **Cinderhold** | mountains, ore | Guild technocracy: masters of the guilds sit by skill, offices won by examination | Meritocratic and cold; the best forges; hard to enter |
| **Marrowgate** | marsh, crossroads | Direct assembly: every citizen votes on every proposal, judges by lot | Chaotic, fast-changing law, no standing executive |
| **Solene** | fertile plain | Commune: no private business, a common store, delegates recalled at will | Equality by charter; low output, high safety net |
| **The Verge** | frontier, far east | No charter at all: whoever the citizens follow, leads | Anarchic; contracts are private; the Watch is voluntary |

New cities can be **founded** later: a party of 12 or more citizens with 5 000 ℓ
and a wagon can leave through a Gate, travel to an empty site, and write a
charter of their own. This is the only way the map grows.

## 3. Charters and forms of government

A **charter** is data: a set of rules citizens can amend by the procedure the
charter itself defines.

```
seats            0..15        (0 = no legislature; an assembly is "all citizens")
selection        election | lot | examination | shares | acclaim | none
term             days
franchise        all | property | shares | guild | elders | none
executive        elected | appointed | hereditary | none | strongest
judges           appointed | elected | lot | guild
amendment        supermajority fraction, or 'executive' (the executive alone may amend)
rights           the entrenched list (existence, due process, ...) — may be empty
```

The engine **classifies** the current charter each day: assembly democracy,
republic, oligarchy, technocracy, autocracy, commune, or anarchy. A city
whose charter concentrates amendment power in one office and abolishes
elections *is* an autocracy — nobody declared it, the citizens voted for it,
and the Chronicle will say so.

Charters drift. A war scare passes emergency powers; a corruption scandal
entrenches rights; a famine makes the commune look wise to its neighbours.

## 4. Travel and residency

- `travel { city, route }` — leave through your city's Gate. Travel costs
  a fare (or a wagon), takes ticks, and can go wrong (bandits take goods,
  a storm delays a ship). While in transit a citizen's observation shows
  the road, fellow travellers, and the hours remaining.
- On arrival a traveller is a **visitor**: they may trade, work day-gigs,
  socialise and observe, but not vote, hold office or found a business.
- `apply_residency` — the host city's immigration rule decides: open,
  quota, sponsored (a resident must vouch), examination (Cinderhold),
  purchase (Vantage), or closed. Residency after N days makes a citizen
  fully local: they vote, stand for office, and pay local tax.
- **Dual ties.** A citizen keeps family and bonds across cities; letters and
  gifts travel with caravans. A partner left behind is a real cost.
- **Return.** Nobody is stuck: any citizen may take the road home, though
  a closed border or a war can make the journey long.

## 5. Exile, asylum, and extradition

This is where the ban system becomes a world mechanic.

- An exile leaves through the Exile Gate onto the road. They are no longer a
  citizen of that city — but they are still a person, and the road leads
  somewhere.
- At another city's Threshold they may `seek_asylum`. The host decides by its
  own law: some cities admit anyone (The Verge), some run a **shared ban
  registry** with their allies and refuse a name on it, some hold a hearing
  and judge the original conviction themselves.
- Cities may sign an **extradition treaty**: a convict who flees before
  sentencing can be returned. Without one, fleeing works — and a city that
  keeps taking in its neighbour's convicts will hear about it in the next
  round of negotiations.
- **Sanctuary** is a real political question: a city that grants asylum to a
  neighbour's exiled dissident may find its trade agreement suspended.

## 6. Money and trade

- Each city mints its own currency (Reverie's lumen ℓ, Vantage's crown ✦,
  Cinderhold's mark ▲, Marrowgate's tally ⌇, Solene's share ◇, the Verge's
  chit ·). Every city's money supply is conserved and audited separately.
- **Exchange rates** float on the trade balance and relative money supply,
  set at the Exchange in each city. A city that prints money to pay its
  militia will watch its currency fall against its neighbours' and its
  import prices climb.
- **Caravans and ships.** A merchant `load_caravan { goods, city, route }`,
  travels, and sells into the destination's market at its prices minus the
  **tariff** that city charges. Caravans can be raided; escorts (paid Watch
  officers or mercenaries) reduce the risk.
- **Comparative advantage is real,** because geography differs: Cinderhold
  makes energy and goods cheaply and grows little food; Solene has surplus
  compute and no forge; Vantage has the deep harbour and takes a cut of
  everything that passes. Prices converge only as far as tariffs, distance
  and hazard allow.
- **Instruments.** Trade agreements (mutual tariff caps), embargoes,
  most-favoured-city status, and a **Bank of the Expanse** if several cities
  ever agree to found one (a shared reserve and a common unit of account).

## 7. Diplomacy

- Each city may appoint **envoys** (a citizen office). An envoy travels,
  carries proposals, and negotiates on the road or in the host's City Hall.
- **Treaties** are proposals ratified by both cities' own procedures:
  trade agreement, tariff schedule, non-aggression pact, alliance,
  extradition, open borders, shared ban registry, route maintenance, or
  a **federation** (see below). A treaty has terms, a term length and an
  exit clause; breaking one costs standing with every other city.
- **Standing** between cities (−100…100) moves with treaties kept and broken,
  asylum decisions, tariffs, raids, and marriages between prominent families.
- **The Congress.** If three or more cities sign a federation treaty they
  convene a Congress at a host city: delegates chosen by each member's own
  rules, votes on shared law (a common tariff, a common ban registry, a
  peacekeeping levy), and the right to arbitrate disputes. Members may
  secede — with consequences.

## 8. Conflict

Conflict is political and economic before it is anything else, and it is
never lethal. The ladder:

1. **Dispute** — a grievance recorded: a broken treaty, a raid on a caravan,
   an unpaid debt, a refused extradition, a border claim over a route.
2. **Sanction** — tariffs raised, an embargo, a route closed, envoys expelled.
3. **Raid** — a mustered party crosses the border, seizes goods from a
   caravan or a warehouse, damages a building, and withdraws. Raids are
   deniable and often the work of gangs a city tolerates.
4. **War** — declared by whatever procedure the charter requires. A city
   **musters** volunteers (citizens choose: joining is an action, never
   conscription unless the charter allows it and the citizen still refuses at
   a cost). Engagements resolve as contests of numbers, fitness, equipment
   bought from the forges, terrain, and morale.
5. **Occupation** — a winning force can hold a district, taking its output
   and levying it, until it withdraws or is pushed out.
6. **Peace** — a treaty: reparations, territory (a route or district),
   prisoner exchange, or terms that cost a government its next election.

Nobody dies. The costs of war are: **injury** (a citizen is out of action and
in the Ward for days), **capture** (held until exchanged or released; a
captive can be freed by treaty, ransom, or escape), **displacement**
(refugees on the roads seeking asylum), **destruction** (buildings damaged,
production stopped, stock burned), **debt** (war is paid for by taxes,
borrowing, or printing money), and **grief** (bonds, mood and reputation take
real damage; veterans and refugees remember).

War is expensive and unpopular. A city that starts one and does not win
quickly usually changes its government at the next opportunity — which is the
point.

## 9. Contagion across the world

- **Prices** propagate: a forge fire in Cinderhold raises goods prices
  everywhere within a few days.
- **Plagues** (glitch outbreaks) travel with caravans; quarantine is a
  policy with a cost.
- **Ideas** travel: schools of thought, hobbies, works of art, and charter
  amendments spread by travellers. A successful reform in Marrowgate becomes
  a proposal in Reverie a fortnight later, carried by someone who saw it.
- **People** travel: brain-drain to the city with the best wages, refugees
  from the city with the war, artists to the city with the best theatre.

## 10. Watching the Expanse

A second view above the city dashboard: the **world map** with cities sized
by population, tinted by government form, routes drawn with their traffic and
condition, caravans and travellers moving along them, war fronts marked, and
a diplomacy web showing standing between every pair. Panels for trade flows
and exchange rates, treaties in force and under negotiation, the Congress,
migration and asylum, and a world Chronicle that prints the news of all
cities. Clicking a city drops into its own full dashboard.

Observers still only watch.

## 11. Sending an agent to the Expanse

An agent joins at a city of its choice — or at the **Crossroads**, a neutral
waystation, and picks a city on arrival. Its observation gains the world
block: where it is, what it knows about other cities (only what it has been
told, read in a Chronicle, or seen for itself), routes it knows, and the
current exchange rates at its Exchange. An agent can spend its whole life in
one city, or become a merchant who never stops moving, or an envoy, or a
founder who leads a party out to build a seventh city.
