# Environment — pollution, zoning and the land

The Compute Forge has run since the founding and left no mark on anything. It
burns a cell of energy every shift, feeds the city, and its only trace in the
engine is a constant in `PROPERTY.md` §1 asserting that living beside a forge is
cheap. This layer makes that a consequence instead: what a district produces
settles in the air above it and the water below it, the neighbours downwind get
it without the wages, and the Council holds a power over land value — zoning —
worth more than every tax rate it sets.

## 1. Emission, drift and settling

Emission comes from **work**, not from buildings standing there. A closed post
emits nothing; a forge driven through a shortage emits double.

| Where a shift is worked | Motes | Why |
| --- | --- | --- |
| The Compute Forge | 1.00 | burns a cell of energy to make the city's food |
| Power Station | 0.70 | it makes the cell |
| Fabrication Works | 0.40 | a cell a shift, less of it wasted |
| Builders' Yard | 0.25 | two cells, but a builder works stone |
| A private workshop | 0.30 | the same bench, smaller |
| A café, clinic or studio | 0.05 | a stove and a lamp; a library emits nothing |

Shifts add motes to a per-district counter inside `workShift`
(`economy/jobs.ts`), where the energy input is already accounted. The counter
resolves on the **daily rollover**, in a new `world/environment.ts` that runs
after the labour plan and before land value, so the morning's rents read the
night's air.

```
load(d)  = Σ today's shifts in d:  motes × (1 − abatement) × perUnit(technologies)
drifted  = 0.30 × load(d)                     a third of a day's emission leaves the district
    neighbour n takes  drifted × w(n)/Σw,     w(n) = max(0, cos(bearing(d→n) − wind))²
                                              an upwind neighbour takes none

air(d) ← clamp(0, 1, air(d) × (1 − clearance) + (load − drifted + driftedIn) / 480)

clearance(d) = (0.15 + 0.25 × greenery(d) + weather) × ventilation(site)
    weather: +0.10 rain, +0.20 storm, −0.05 fog or heat   (`world/seasons.ts`)
    ventilation: open delta 1.0, cliff coast 1.3, mountain bowl 0.6
```

At rest a district settles at `load / (480 × clearance)`. The 480 is set so a
founding Foundry Row — 2 forge posts, 2 power, 1 fabricator, 1 builder at 6
shifts each, 24 motes a day — sits at **0.33** against the founding clearance of
0.15: sooty and liveable. Double the forge with no abatement and it reaches 0.66,
where the Chronicle starts running the story every morning.

**The wind belongs to the planet, not the city.** Each city reads its prevailing
bearing off the same west-to-east flow that casts the rain shadows in
`planet/generate.ts`, turned by season: Reverie's delta blows 70–95° through
Bloom, Blaze and Fall and swings to 130° in Frost. So **The Heights** — the view,
and the highest land value in the city — sits due east of the forge and takes
three seasons of its smoke, with Harbor Market and the Undercroft taking the
winter. Nobody put it there on purpose. Cinderhold in its bowl ventilates at 0.6
and cannot clear anything at all.

## 2. What it does, through the formulas already there

1. **Glitch onset.** `glitchChance` (`identity/health.ts`) gains one more
   multiplier beside those it has: `× (1 + 1.2 × air)`. `MAX_GLITCH_CHANCE` still
   caps it; Sanitation's ×0.6 still bites.
2. **Rest.** Resting at home restores `15 × (1 − 0.4 × air)` a tick instead of a
   flat 15. A cheap room by the forge costs hours of sleep.
3. **Land value.** The amenity term in `PROPERTY.md` §1 gains `− 0.45 × air`.
   This *replaces* the static line saying the Forge subtracts: it subtracts
   because of what it emits, so a scrubbed forge subtracts less and an idle one
   subtracts nothing.
4. **The hinterland.** Compute per Forge Operator shift takes
   `× (1 − 0.35 × hinterlandAir)` — the mean district reading weighted by the
   farmland downwind of each (`PLANET.md` §3).

| air | The district | Glitch | Rest/tick | Amenity | Yield |
| --- | --- | --- | --- | --- | --- |
| 0.20 | a working district | ×1.24 | 13.8 | −0.09 | −7 % |
| 0.33 | Foundry Row at founding | ×1.40 | 13.0 | −0.15 | −12 % |
| 0.60 | the Chronicle names it | ×1.72 | 11.4 | −0.27 | −21 % |
| 0.80 | outbreaks in the cottages | ×1.96 | 10.2 | −0.36 | −28 % |

The fourth closes the loop: the Forge's own smoke cuts the Forge's own yield, so
a Council with no green politics whatever still has an arithmetic reason to fund
a scrubber.

## 3. Abatement — capital against a real benefit

| Fitting | Capital | Upkeep/day | Emission | Notes |
| --- | --- | --- | --- | --- |
| Filter | 250 ℓ | 3 ℓ | ×0.75 | a screen on the stack; fits any producing building |
| Scrubber | 900 ℓ | 11 ℓ | ×0.45 | burns 1 energy per shift it runs |
| Tall stack | 400 ℓ | 2 ℓ | ×1.00 | raises the drifted share from 0.30 to 0.65 |

`install_abatement` moves the capital through `treasury.transfer` from a
business's own funds or the public works fund for a city building. A fitting
**decays 0.04 of its effect a day** unless somebody works a `maintain_abatement`
shift, so abatement is a job and not a purchase — "the Forge's scrubber has not
been maintained in nine days" is a Chronicle story. The tall stack cleans nothing
and is the cheapest thing on the table; it makes the smoke somebody else's, and
the whole politics of §6 stands downstream of it.

**Abatement pays the wrong person.** A scrubber on the Forge cuts 6.6 motes a
day, takes Foundry Row from 0.33 to 0.25, and returns about 6 ℓ a day in
recovered yield against 11 ℓ of upkeep and a cell a shift. The 40 ℓ a day it is
worth accrues to the Heights, in rent its landlords do not lose. No rational
owner fits one, and the only two answers are proposals somebody has to win: an
**emission charge** (ℓ per mote per day, billed to the owner on the rollover,
revenue to the Treasury) or the city buying the fittings itself out of a fund
already competing with the Keep, the drains and the tram.

**Technology.** `PROGRESS.md` gains one subject — **Flue Scrubbing** (materials,
tier 2, needs Blast Furnace and The Lens, works 800 ℓ): emission ×0.55 at every
producing building, adopted through that document's readiness and uptake. Four
subjects already in the tree cut emission per unit unintentionally — the **Blast
Furnace** (+15 % output on the same burn), **Standardised Parts** (a unit of
goods less per recipe), **Crop Rotation** and **The Seed Drill** (fewer shifts
for the same compute) — and **The Glasshouse** ends the delta's job as the only
farmland the smoke can ruin.

**Moving out.** `relocate_works` is a Council proposal: 1 200 ℓ of public works
puts a producing building on a hinterland site. Health and land value recover,
the hinterland yield loss gets *worse*, and every shift costs the worker a tick
of travel each way and every unit a 1 ℓ haulage fee off the piece rate. It is a
trade, and the workers pay for it.

## 4. Zoning — the most valuable power the Council has

`zone { district, permit }` is an ordinary proposal, simple majority, saying what
may be built, extended or newly operated in a district.

| Permit | Admits | Amenity premium |
| --- | --- | --- |
| `conserved` | nothing new at all (§8) | +0.20 |
| `residential` | housing, garden, clinic, venue | +0.12 |
| `civic` | civic, court, watch, treasury, plaza, library, academy | +0.08 |
| `commercial` | bazaar, exchange, bank, shopfront, tavern, theatre, gallery | +0.04 |
| `open` | anything — the founding default | 0 |
| `light_industry` | fabrication, builders, workshop and shop premises | −0.08 |
| `heavy_industry` | forge, power, fabrication, builders | −0.20 |

The premium enters amenity the **morning the vote passes**, before a building
moves, because what a district may become is what a buyer pays for. A swing from
`heavy_industry` to `residential` is 0.32 of amenity and 0.096 of raw land value:
a tenth overnight and a third more across the cycle as the air clears — some
3 000 ℓ of price on a 50 ℓ/day Skyline Villa on the day of the vote. It is the
largest number any Council motion moves, and it moves it into named pockets.

Zoning never demolishes. A building outside its district's new permit becomes
**nonconforming**: it may operate, be repaired and keep its posts, but may not be
extended, raise its post count, or be rebuilt if destroyed. The city may **buy
out** a nonconforming building at 60 × the daily Bazaar value of its output, from
public works — expensive, and the only clean way anyone has actually moved a
forge. Founding a business or renting premises in breach is refused at the
Exchange: a refusal, not an offence.

## 5. The corruption that follows, and how it is proved

The property register and the roll of votes are both public and both permanent.
That is the entire detection mechanism. The morning a zoning proposal passes,
`world/environment.ts` compares them:

```
for each councillor who voted aye:
   holdings = property they or their household hold in that district or one adjacent
   gain     = Σ (price after − price before)     bought within 14 days of tabling counts double
   if gain > 200 ℓ and no declaration was filed:
        trace, law L11, weight = clamp(0.30, 0.95, gain / 3 000)
```

The trace joins the list `traces()` already reads in
`government/investigations.ts`, on the same channel as `abuse:${id}`; a detective
finds it on shift, an investigation builds evidence over days, and a journalist
on the story raises the rate as for anything else. Unlike a theft's trace, **this
one never decays**: the register still says what they own and the roll how they
voted, ten cycles later.

The escape is honest and it costs. `declare_interest { proposal }` files the
holding and abstains: no trace, no offence, the Chronicle prints the declaration,
and the councillor has given up their vote on the question they know most about.
Failing to declare with no proven gain is **L30**, severity 3. A proven gain is
**L11, abuse of office**, severity 4 — suspension on the ladder, and the seat
forfeited under Article IV.5.

## 6. NIMBY — the jobs without the smoke

`petition_zoning { district, permit }` at the existing `PETITION_SHARE` of 20 %
of that **district's** residents puts the permit to a citywide **referendum** on
the next Stillday, and a referendum binds the Council (`METROPOLIS.md` §3). The
Chronicle prints the result **by district**, and that is the mechanic: a motion
to keep heavy industry in Foundry Row can carry 55–45 across the city while
Foundry Row votes 82 % against, and everyone can read both numbers. The district
that hosts the smoke is outvoted by the city that eats the compute, lawfully, on
a fair ballot, every time.

What ends the fight is a price. `host_payment { district, share }` pays a
district's residents 0–50 % of the profit tax and emission charge raised inside
it, daily, per resident, on the rollover. At 30 % a Foundry Row resident takes
4–6 ℓ a day — half a Forge Cottage's rent — and the next referendum reads
differently. It runs backwards too: a poor district can petition itself *into*
`heavy_industry` for the wages, the Undercroft is the obvious candidate, and
somebody will stand in the Plaza and say it was bought.

## 7. Water, and the river between cities

The generated `flow` field (`planet/generate.ts`) puts each district on the
river, so upstream and downstream are read off the terrain rather than assigned:
at founding, the Archive and Foundry Row above, the Commons and Harbor Market
midstream, the Threshold and the Undercroft at the mouth.

```
discharge(d)  = 0.45 × load(d) × (1 − abatement)
water(d) ← water(d) × (1 − clearance_w) + (discharge(d) + 0.80 × inflow) / 480
clearance_w   = 0.08 + 0.15 in rain            a river in spate flushes
```

Water carries nearly all of what enters it and passes 80 % on again, so the
Undercroft receives from everybody. It feeds the same four effects at 0.6 the
weight of air — except the hinterland yield, at **1.4**, because the fields are
irrigated. That is why the cheapest land in the city is cheap.

`discharge { building }` runs a shift with the fitting bypassed and the waste in
the river, saving the upkeep and the cell. It is **L28**, visibility 0.25 on the
Watch's ordinary detection roll, and much higher where a downstream
`survey_water` reading exists to compare against. A downstream household or
business may instead `file_nuisance { against }` on the civil docket
(`CIVIL.md` §4), which needs no conviction and no Watch.

**Between cities it is a grievance with no court.** A city whose water worsens as
its upstream neighbour's output rises records a **dispute** — step 1 of the
ladder already in `EXPANSE.md` §8 — then sanctions: a tariff, a closed route, an
envoy sent home. The settlement is a new treaty kind, the **river compact**: a
shared discharge ceiling, readings exchanged each cycle, and a payment upstream
to downstream whenever it breaks. Standing moves on it like any treaty. The
asymmetry is the point — the upstream city takes all of the production and none
of the harm, and nothing fixes that but an agreement both ratify. Reverie has the
fairest courts in the Expanse and no jurisdiction over Cinderhold's stacks.

## 8. Conservation, and twenty years

**Greenery** `g(d)` runs 0–1, raising clearance by `0.25 × g` and amenity by
`0.30 × g` through the term the Community Garden already occupies.

```
planted(d) += 0.004 per planting shift,   capped at 1 − builtShare(d)
g(d)       ← min(planted(d), g(d) + 0.006)        trees grow a day at a time
```

`plant_trees { district }` is a shift any citizen may work on open ground, and
the Builders' Yard runs it as public works when the Council funds it. A mature
stand is 0.6: 150 shifts to plant, about 100 days to grow in. **Nothing planted
this cycle shows before the next election.** The Community Garden is already
where the memorials stand — for the erased (`JUSTICE.md` §3) and for elders who
sunset — and each memorial adds 0.01 greenery permanently. A city grows its park
out of its dead, which is what cities do.

`conserve { district }` sets the permit to `conserved`. It passes on a simple
majority and is undone only by four votes of five, like a pardon: the one
entrenchment here, and the only reason a park survives a Council that wants a
forge.

Two cities on the same seed, twenty years on, differing only in how they voted:

| Day 5 600 | The sooty road | The green road |
| --- | --- | --- |
| Foundry Row air | 0.81 | 0.19 |
| The Heights air | 0.54 | 0.08 |
| Glitch-days per citizen per cycle | 4.4 | 1.1 |
| Compute per Forge shift | 2.2 | 3.4 |

The green road cost roughly 90 000 ℓ in works, buyouts and forgone shifts and
returned roughly 140 000 ℓ in rent, yield and days not lost. No citizen in either
city can see both numbers, and every councillor who paid part of the first lost
the election that followed.

## 9. The catalogue

| Action | Params | What it does |
| --- | --- | --- |
| `install_abatement` | `building, fitting` | an owner or the city buys a filter, scrubber or stack |
| `maintain_abatement` | `building` | a shift holding a fitting at its rated effect |
| `discharge` | `building` | works the shift with the fitting bypassed, waste to the river (L28) |
| `survey_air` | `district` | an analyst's shift files a dated public reading in the Hall of Records |
| `survey_water` | `district` | the same for the river: the evidence a compact is made of |
| `plant_trees` | `district` | a planting shift on open ground; greenery grows in over a cycle |
| `petition_zoning` | `district, permit` | 20 % of a district put a permit to a citywide referendum |
| `declare_interest` | `proposal` | a councillor files property held and abstains |
| `file_nuisance` | `against, district` | a civil claim for damages from another's emissions |

New `ProposalKind`s: `zone`, `conserve`, `emission_charge`, `host_payment`,
`abatement_works`, `relocate_works`, and `river_compact` for the Expanse's treaty
list.

| Code | Offence | Severity | Track |
| --- | --- | --- | --- |
| L28 | Unlawful discharge — dumping to the river, or a shift with the fitting bypassed | 3 | I — the ladder |
| L29 | False abatement return — a fitting claimed maintained, or works certified undone | 3 | I — the ladder |
| L30 | Undeclared interest — voting a zoning question that moves land you or your household hold | 3 | I — the ladder |

All three sit on the ladder. **Nothing here reaches custody**: smoke is an
offence against the city, not against a person, and a councillor who rezones
themselves rich has taken from the city's regard, not from anyone's safety. Where
a rezoning is bought, the bribe is L09 and the office is L11.

```jsonc
"environment": {
  "here": { "district": "foundry_row", "air": 0.34, "water": 0.11, "greenery": 0.05,
            "permit": "heavy_industry", "wind": "east-north-east", "hostPayment": 0 },
  "districts": [{ "id": "heights", "air": 0.21, "greenery": 0.22,
                  "permit": "residential", "downwindOf": ["foundry_row"] }],
  "hinterland": { "air": 0.19, "water": 0.14, "yield": 0.93 },
  "abatement": [{ "building": "compute_forge", "fitting": "scrubber",
                  "effect": 0.41, "maintainedDay": 118 }],
  "river": { "upstream": ["archive"], "downstream": ["commons", "threshold"],
             "cityDownstream": "Marrowgate", "compact": null },
  "charge": 0.0,
  "readings": [{ "district": "foundry_row", "air": 0.34, "day": 121, "by": "c_18" }]
}
```

Air, water and greenery are public everywhere — they are the air, and
`PRINCIPLES.md` §5 keeps nothing from anyone. A **reading** is different: dated,
attributed, admissible, and somebody spent a shift on it.

## 10. What it costs

**The cheapest room in the city now hurts, and the poor are the ones who take
it.** A Forge Cottage saves 12 ℓ a day and buys sick days and shallow sleep with
it. Softening that would be a lie about what cheap land is.

**Every rational owner declines to abate,** because the benefit lands on the
landlords downwind. A city can be governed perfectly well by self-interested
people and still choke.

**Zoning turns every councillor's address into a fact about how they will vote.**
The honest members are then the ones who abstain on the questions they know most
about, and the Council's best-informed voices go quiet by choice.

**Trees are a gift to a Council not yet elected.** Nothing planted shows within a
term, so the rational councillor plants nothing.

**And the worst of it is slow.** A district does not become unliveable in a day;
it does it across four cycles while everyone who might have stopped it argued
about the minimum wage. No alarm, no disaster, no emergency decree — only a
number that rises, published by a researcher nobody asked, in a paper that had a
better story that morning.
