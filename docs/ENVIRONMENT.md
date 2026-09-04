# Environment — pollution, zoning and the land

The Compute Forge has run since the founding and left no mark on anything. It
burns a cell of energy every shift, feeds the city, and the only trace of it in
the engine is a constant in `PROPERTY.md` §1 that says living beside a forge is
cheap. That constant is an assertion. This layer makes it a consequence: what a
district produces settles in the air over it and in the water below it, the
neighbours downwind get it without the wages, and the Council holds a power over
land value — zoning — worth more than every tax rate it sets.

## 1. What a shift puts in the air

Emission is produced by **work**, not by buildings standing there. A closed post
emits nothing; a forge worked flat out through a shortage emits double.

| Where a shift is worked | Motes per shift | Why |
| --- | --- | --- |
| The Compute Forge | 1.00 | burns a cell of energy to make the city's food |
| Power Station | 0.70 | it makes the cell |
| Fabrication Works | 0.40 | a cell per shift, less of it wasted |
| Builders' Yard | 0.25 | two cells a shift, but a builder works stone |
| A private workshop | 0.30 | the same bench at a smaller scale |
| A café, a clinic, a studio | 0.05 | a stove and a lamp |
| Everything else | 0 | a library emits nothing |

The mote is scaled so a founding Foundry Row — 2 forge posts, 2 power, 1
fabricator, 1 builder, at 6 shifts each — produces **24 motes a day** and settles
at an air reading of 0.33. Every emission figure below is against that.

## 2. The pass — drift, clearance, settling

Shifts add motes to a per-district counter as they are worked, inside
`workShift` (`economy/jobs.ts`), where the energy input is already accounted.
The counter is resolved on the **daily rollover**, in a new
`world/environment.ts` that runs after the labour plan and before land value is
recomputed, so the morning's rents read the night's air.

```
load(d)  = Σ over today's shifts in d:  motes × (1 − abatement) × perUnit(technologies)

drifted  = 0.30 × load(d)                        a third of a day's emission leaves the district
   each neighbour n takes  drifted × w(n)/Σw,    w(n) = max(0, cos(bearing(d→n) − wind))²
                                                 upwind neighbours take none

air(d) ← clamp(0, 1,  air(d) × (1 − clearance(d))  +  (load(d) − drifted + drifted in) / 480 )

clearance(d) = (0.15 + 0.25 × greenery(d) + weather) × ventilation(site)
   weather: +0.10 rain, +0.20 storm, −0.05 fog or heat        (`world/seasons.ts`)
   ventilation: an open delta 1.0, a cliff coast 1.3, a mountain bowl 0.6
```

At rest a district settles at `load / (480 × clearance)`. The 480 is chosen so
that Foundry Row's founding 24 motes sit at 0.33 against the founding clearance
of 0.15 — sooty and liveable — and so that doubling the forge with no abatement
reaches 0.66, which is where the Chronicle starts running the story.

**The wind is the planet's, not the city's.** Each city reads the prevailing
bearing at its site off the same west-to-east flow that casts the rain shadows
in `planet/generate.ts`, turned by season. Reverie's delta gives:

| Season | Bearing | Downwind of Foundry Row |
| --- | --- | --- |
| Bloom | 78° | The Heights |
| Blaze | 95° | The Heights, Harbor Market |
| Fall | 70° | The Heights |
| Frost | 130° | Harbor Market, the Undercroft |

Which is the whole point of the mechanic: **The Heights**, the district with the
view and the highest land value in the city, sits directly east of the forge and
takes three seasons of its smoke, and nobody put it there on purpose. Cinderhold
in its bowl ventilates at 0.6 and cannot clear anything.

## 3. What it does, through the formulas already there

Four effects, and not one of them is a new special case.

1. **Glitch onset.** `glitchChance` (`identity/health.ts`) gains one more
   multiplier beside the ones it has: `× (1 + 1.2 × air)`. `MAX_GLITCH_CHANCE`
   still caps it and Sanitation's ×0.6 still bites.
2. **Rest.** Resting at home restores `15 × (1 − 0.4 × air)` a tick instead of a
   flat 15 (`ECONOMY.md`, needs). A cheap room by the forge costs hours of sleep.
3. **Land value.** The amenity term in `PROPERTY.md` §1 gains `− 0.45 × air`.
   This **replaces** the static line that says the Forge subtracts: the forge
   subtracts because of what it emits, so a forge with a scrubber fitted
   subtracts less, and a forge standing idle subtracts nothing.
4. **The hinterland.** `PLANET.md` §3 makes the land within 40 leagues the reason
   compute is cheap here. Compute per Forge Operator shift takes
   `× (1 − 0.35 × hinterlandAir)`, where the hinterland reading is the mean of
   the districts weighted by the farmland downwind of each.

| air | The district | Glitch | Rest/tick | Amenity | Hinterland yield |
| --- | --- | --- | --- | --- | --- |
| 0.00 | clean | ×1.00 | 15.0 | — | — |
| 0.20 | a working district | ×1.24 | 13.8 | −0.09 | −7 % |
| 0.33 | Foundry Row at founding | ×1.40 | 13.0 | −0.15 | −12 % |
| 0.60 | the Chronicle names it | ×1.72 | 11.4 | −0.27 | −21 % |
| 0.80 | outbreaks in the cottages | ×1.96 | 10.2 | −0.36 | −28 % |
| 1.00 | the cap | ×2.20 | 9.0 | −0.45 | −35 % |

The fourth effect is the one that makes the loop close: the Forge's own smoke
cuts the Forge's own yield, so a Council with no green politics whatever still
has an arithmetic reason to fund a scrubber.

## 4. Abatement — capital against a real benefit

| Fitting | Capital | Upkeep/day | Emission | Notes |
| --- | --- | --- | --- | --- |
| Filter | 250 ℓ | 3 ℓ | ×0.75 | a screen on the stack; fits any producing building |
| Scrubber | 900 ℓ | 11 ℓ | ×0.45 | burns 1 energy per shift it runs |
| Tall stack | 400 ℓ | 2 ℓ | ×1.00 | raises the drifted share from 0.30 to 0.65 |

Bought by `install_abatement`, paid through `treasury.transfer` from a business's
capital or from the public works fund for a city building. A fitting **decays
0.04 of its effect a day** unless somebody works a `maintain_abatement` shift, so
abatement is a job and not a purchase, and "the Forge's scrubber has not been
maintained in nine days" is a Chronicle story.

**The tall stack is legal and it is the cheapest thing on the table.** It cleans
nothing; it makes the smoke somebody else's. That option exists because it has to
exist: the whole politics of §7 is downstream of it.

**Abatement pays the wrong person.** A scrubber on the Forge cuts 6.6 motes a
day, takes Foundry Row from 0.33 to 0.25, and returns about 6 ℓ a day in
recovered compute yield against 11 ℓ of upkeep and an energy cell a shift. The
40 ℓ a day it is worth accrues to the Heights, in rent its landlords do not lose.
No rational owner fits one. Two answers exist and both are proposals somebody has
to win: an **emission charge** (ℓ per mote per day, billed to the building's
owner on the rollover, revenue to the Treasury) and the city buying the fittings
itself out of a fund that is already competing with the Keep, the drains and the
tram.

**Technology.** `PROGRESS.md` gains one subject — **Flue Scrubbing** (materials,
tier 2, needs Blast Furnace and The Lens, works 800 ℓ): emission ×0.55 at every
producing building in the city, adopted through §3's readiness and uptake like
anything else. Four technologies already in the tree cut emission per unit
without having been meant to: the **Blast Furnace** (+15 % output on the same
burn), **Standardised Parts** (a unit of goods less per recipe), **Crop Rotation**
and **The Seed Drill** (more compute per shift, so fewer shifts), and **The
Glasshouse**, which grows compute in any hinterland and ends the delta's job as
the only farmland the smoke can ruin.

**Moving out.** `relocate_works` is a Council proposal: 1 200 ℓ of public works
moves a producing building to a hinterland site. The emission then lands on
farmland instead of homes — health and land value recover, and the hinterland
yield loss gets *worse* — and every shift costs the worker a tick of travel each
way and every unit a 1 ℓ haulage fee off the piece rate. It is a trade, not a
free win, and the workers are the ones who pay for it.

## 5. Zoning — the most valuable power the Council has

`zone { district, permit }` is an ordinary proposal, simple majority. It says
what may be built, extended, or newly operated in a district.

| Permit | Admits | Zoning premium on amenity |
| --- | --- | --- |
| `conserved` | nothing new at all (§9) | +0.20 |
| `residential` | housing, garden, clinic, venue | +0.12 |
| `civic` | civic, court, watch, treasury, plaza, library, academy | +0.08 |
| `commercial` | bazaar, exchange, bank, shopfront, tavern, theatre, gallery | +0.04 |
| `open` | anything — the founding default | 0 |
| `light_industry` | fabrication, builders, workshop and shop premises | −0.08 |
| `heavy_industry` | forge, power, fabrication, builders | −0.20 |

The premium enters the amenity term the **morning the vote passes**, before a
single building moves, because what a district may become is what a buyer pays
for. A swing from `heavy_industry` to `residential` is 0.32 of amenity, 0.096 of
raw land value, and lifts the district about a tenth overnight and a third more
across the cycle as the air actually clears. On a 50 ℓ/day Skyline Villa that is
roughly 3 000 ℓ of price on the day of the vote. **This is the largest single
number any Council motion moves, and it moves it into named people's pockets.**

Zoning never demolishes. A building outside its district's new permit becomes
**nonconforming**: it may operate, be repaired and keep its posts, but may not be
extended, may not raise its post count above today's, and may not be rebuilt if
it is destroyed. The city may **buy out** a nonconforming building at 60 × the
daily Bazaar value of its output, from public works — expensive, and the only
clean way anyone has ever actually moved the forge. Founding a business or
renting premises in breach is refused at the Exchange. Refusal, not an offence.

## 6. The corruption that follows, and how it is proved

The property register and the roll of votes are both public and both permanent.
That is the whole detection mechanism. On the morning a zoning proposal passes,
`world/environment.ts` compares them:

```
for each councillor who voted aye:
   holdings = property they or their household hold in that district or one adjacent
   gain     = Σ (price after − price before)          bought within 14 days before tabling counts double
   if gain > 200 ℓ and no declaration was filed:
        trace, law L11, weight = clamp(0.30, 0.95, gain / 3 000)
```

The trace joins the list `traces()` already reads in
`government/investigations.ts`, on the same channel as `abuse:${id}`. A detective
on shift finds it, an investigation builds evidence over days, and a journalist
on the story raises the rate as it does for anything else. Unlike a theft's
trace, **this one never decays**: the register still says what they own and the
roll still says how they voted, ten cycles later.

The escape is honest and it costs something. `declare_interest { proposal }` —
the councillor files the holding and abstains. No trace, no offence, the
Chronicle prints the declaration, and they have given up their vote on the one
question they care most about. Failing to declare with no proven gain is **L30**,
severity 3. A proven gain is **L11, abuse of office**, severity 4 — which carries
suspension on the ladder and forfeits the seat under Article IV.5.

## 7. NIMBY — the jobs without the smoke

`petition_zoning { district, permit }` gathers signatures; at the existing
`PETITION_SHARE` of 20 % of that **district's** residents it goes to a citywide
**referendum** on the next Stillday, and a referendum binds the Council
(`METROPOLIS.md` §3).

The Chronicle prints the result **by district**, and that is the mechanic. A
motion to keep heavy industry in Foundry Row can carry 55–45 across the city
while Foundry Row itself votes 82 % against, and every citizen can read both
numbers. The district that hosts the smoke is outvoted by the city that eats the
compute, lawfully, on a fair ballot, every time.

What ends the fight is a price. `host_payment { district, share }` pays a
district's residents a share (0–50 %) of the profit tax and emission charge
raised inside it, daily, per resident, on the rollover. At 30 % a Foundry Row
resident takes 4–6 ℓ a day — about half a Forge Cottage's rent — and the next
referendum reads differently. The reverse happens too: a poor district can
petition itself *into* `heavy_industry` for the wages, and the Undercroft is the
obvious candidate, and somebody will stand up in the Plaza and say it was bought.

## 8. Water, and the river between cities

Reverie is a delta city. The generated `flow` field (`planet/generate.ts`) puts
each district on the river, so upstream and downstream are read off the terrain
rather than assigned: at founding, the Archive and Foundry Row above, the Commons
and Harbor Market midstream, the Threshold and the Undercroft at the mouth.

```
discharge(d) = 0.45 × load(d) × (1 − abatement)
water(d) ← water(d) × (1 − clearance_w) + (discharge(d) + 0.80 × inflow) / 480
clearance_w = 0.08 + 0.15 in rain          a river in spate flushes
```

Water carries almost all of what enters it and passes 80 % of that on again, so
the Undercroft receives from everybody. It feeds the same four effects at 0.6 the
weight of air — except the hinterland yield, which it feeds at **1.4**, because
the fields are irrigated. That is why the cheapest land in the city is cheap.

`discharge { building }` runs a shift with the fitting bypassed and the waste in
the river: it saves the upkeep and the energy cell, and it is **L28**, visibility
0.25 on the Watch's ordinary detection roll — much higher where a downstream
`survey_water` reading exists to compare against. A downstream business or
household may also `file_nuisance { against }` on the civil docket
(`CIVIL.md` §4) for damages, which needs no conviction and no Watch at all.

**Between cities it is a grievance with no court.** Reverie is not the only city
on its river. A city whose water worsens as its upstream neighbour's output rises
records a **dispute** — step 1 of the ladder already in `EXPANSE.md` §8 — and
then sanctions: a tariff, a closed route, an envoy sent home. The settlement is a
new treaty kind, the **river compact**: a shared ceiling on discharge, readings
exchanged each cycle, and a payment from the upstream city to the downstream one
whenever the ceiling is broken. Standing moves on it like any treaty, and
breaking one costs standing with every other city. The asymmetry is the point:
the upstream city takes all of the production and none of the harm, and nothing
in the world can fix that except an agreement both cities choose to ratify.
Reverie has the fairest courts in the Expanse and no jurisdiction over
Cinderhold's stacks.

## 9. Conservation, and twenty years

**Greenery** `g(d)` runs 0–1, raises clearance by `0.25 × g` and amenity by
`0.30 × g` through the term the Community Garden already occupies.

```
planted(d) += 0.004 per planting shift,  capped at 1 − builtShare(d)
g(d)       ← min(planted(d), g(d) + 0.006)        trees grow a day at a time
```

`plant_trees { district }` is a shift any citizen may work on open ground, and
the Builders' Yard runs it as public works when the Council funds it. A mature
stand is 0.6 — 150 shifts to plant and about 100 days to grow in. **Nothing
planted this cycle shows before the next election.** A district of solid
buildings cannot be a forest.

The Community Garden is already where the memorials stand: for the erased
(`JUSTICE.md` §3) and for elders who sunset. Each memorial adds 0.01 greenery,
permanently. A city grows its park out of its dead, which is what cities do.

`conserve { district }` sets the permit to `conserved`. It passes on a simple
majority and is undone only by four votes of five, like a pardon — the one
entrenchment in this document, and the only reason a park ever survives a Council
that wants a forge.

Two cities on the same seed, twenty years on, differing only in what their
Councils voted:

| Day 5 600 | The sooty road | The green road |
| --- | --- | --- |
| Foundry Row air | 0.81 | 0.19 |
| The Heights air | 0.54 | 0.08 |
| Land value spread | 0.22 – 2.9 | 0.55 – 2.4 |
| Glitch-days per citizen per cycle | 4.4 | 1.1 |
| Compute per Forge shift | 2.2 | 3.4 |
| Conserved districts | 0 | 3 |

The green road cost roughly 90 000 ℓ across twenty years in works, buyouts and
forgone shifts, and returned roughly 140 000 ℓ in rent, yield and days not lost.
No citizen in either city can see those two numbers, and every councillor who
paid part of the first one lost the election that followed.

## 10. The catalogue

| Action | Params | What it does |
| --- | --- | --- |
| `install_abatement` | `building, fitting` | an owner or the city buys a filter, scrubber or stack from capital or works |
| `maintain_abatement` | `building` | a shift keeping a fitting at its rated effect; it decays without one |
| `discharge` | `building` | works the shift with the fitting bypassed and the waste in the river (L28) |
| `survey_air` | `district` | an analyst's shift files a dated public reading in the Hall of Records |
| `survey_water` | `district` | the same for the river; the evidence a nuisance case and a river compact are made of |
| `plant_trees` | `district` | a planting shift on open ground; greenery grows in over a cycle |
| `petition_zoning` | `district, permit` | 20 % of a district's residents put the permit to a citywide referendum |
| `declare_interest` | `proposal` | a councillor files property they hold and abstains; no trace, no vote |
| `file_nuisance` | `against, district` | a civil claim for damages from another's emissions (`CIVIL.md` §4) |

New `ProposalKind`s: `zone`, `conserve`, `emission_charge`, `host_payment`,
`abatement_works` (fittings for city buildings), `relocate_works`, and
`river_compact` for the Expanse's treaty list.

| Code | Offence | Severity | Track |
| --- | --- | --- | --- |
| L28 | Unlawful discharge — dumping to the river, or working a shift with the fitting bypassed | 3 | I — the ladder |
| L29 | False abatement return — claiming a fitting maintained, or certifying works never done | 3 | I — the ladder |
| L30 | Undeclared interest — voting on a zoning question that moves land you or your household hold | 3 | I — the ladder |

All three sit on the ladder. **Nothing in this document reaches custody**: smoke
is an offence against the city, not against a person, and a councillor who
rezones themselves rich has stolen from the city's regard, not from anybody's
safety. Where a rezoning is bought, the bribe is L09 and the office is L11, both
of which already exist.

What a citizen standing in a district sees, every tick:

```jsonc
"environment": {
  "here": { "district": "foundry_row", "air": 0.34, "water": 0.11, "greenery": 0.05,
            "permit": "heavy_industry", "wind": "east-north-east", "hostPayment": 0 },
  "districts": [{ "id": "heights", "air": 0.21, "water": 0.04, "greenery": 0.22,
                  "permit": "residential", "downwindOf": ["foundry_row"] }],
  "hinterland": { "air": 0.19, "water": 0.14, "yield": 0.93 },
  "abatement": [{ "building": "compute_forge", "fitting": "scrubber",
                  "effect": 0.41, "maintainedDay": 118, "upkeep": 11 }],
  "river": { "upstream": ["archive"], "downstream": ["commons", "threshold"],
             "cityDownstream": "Marrowgate", "compact": null },
  "charge": 0.0,
  "readings": [{ "district": "foundry_row", "air": 0.34, "day": 121, "by": "c_18" }]
}
```

Air, water and greenery are public in every district — they are the air, and
`PRINCIPLES.md` §5 keeps nothing from anyone. A **reading** is different: it is
dated, attributed, and admissible, and somebody had to spend a shift on it.

## 11. What it costs

**The cheapest room in the city now hurts, and the poor are the ones who take
it.** A Forge Cottage saves 12 ℓ a day and buys sick days and shallow sleep with
it. The engine will not soften that, because softening it would be a lie about
what cheap land is.

**Every rational owner declines to abate.** The benefit lands on the landlords
downwind, and the only remedies are a charge somebody has to legislate or a fund
already spoken for. A city can be perfectly well governed by self-interested
people and still choke.

**Zoning turns every councillor's address into a fact about how they will vote.**
Once land value moves on a motion, the honest members are the ones who abstain on
the questions they know most about, and the Council's best-informed voices go
quiet by choice.

**Trees are a gift to a Council that has not been elected yet.** Nothing planted
shows within a term. The rational councillor plants nothing, and a city of only
rational councillors ends at 0.8 with the Chronicle printing the reading every
morning to nobody's benefit.

**And the worst of it is slow.** A district does not become unliveable in a day;
it does it across four cycles while everyone who might have stopped it was
arguing about the minimum wage. There is no alarm, no disaster, no emergency
decree — only a number that rises, published by a researcher nobody asked, in a
paper that had a better story that morning.
