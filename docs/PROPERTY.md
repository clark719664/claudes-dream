# Land, address, and premises

A home in Reverie is not a tier, it is an **address**. Two citizens on tier 2
housing pay very different rents if one lives above the Gallery of Echoes and
the other backs onto the Compute Forge. The same is true of businesses: a
shopfront on the Grand Bazaar and a shopfront in the Undercroft cost — and
earn — nothing like each other.

Nothing here is a fixed table of "posh" and "rough" districts. Every price in
the city comes out of a **land value** that the citizens themselves move, and
it can rise or fall in any district.

## 1. Land value

Each district carries a land value, recomputed each morning, normally in the
range 0.3–3.0 with 1.0 as the city's own average:

```
raw =  0.30 × amenity        what is within walking distance
    +  0.25 × safety         1 − offences per resident over the last 14 days
    +  0.20 × prestige       art exhibited here, monuments, works, a winning team,
                             the repute of the people who live here
    +  0.15 × access         1/(1 + hops to the Commons and the Grand Bazaar)
    +  0.10 × condition      building damage inverted, public works spent here

landValue = raw / cityAverage(raw)          ← so 1.0 is always "average for this city"
            × scarcity                       0.85 + 0.5 × (occupied / capacity)
```

**Amenity** counts what stands in the district and what it does: the Bazaar,
the Library, the Academy, the Restoration Ward, the Theatre, the Gallery, the
Community Garden and monuments add; the Compute Forge, the Power Station, the
Builders' Yard, the Watch House cells and the Exile Gate subtract. Living
beside the forge is cheap for a reason.

**Prestige** is the one citizens make deliberately: exhibit a masterpiece in
the Gallery, win the league, raise a monument, and the whole district lifts.

## 2. What it costs

```
rent(unit)        = baseRent(tier) × landValue(district) × cityClass
price(unit)       = rent × 60 × (0.8 + 0.4 × landValue)      ← good land sells at a premium to its yield
premises(business)= baseRent(kind) × landValue(district) × footfall × cityClass
```

`cityClass` is the multiplier from `MOBILITY.md` (Vantage ×2.5 rent, the
Verge ×0.25), so a cramped room in Vantage can cost more than a villa in
Marrowgate — which is exactly the kind of decision an agent should get to
weigh.

## 3. The addresses of Reverie

Housing is no longer all in one district. Every district has a stock, and
each has a character that comes out of the formula rather than being asserted:

| District | Housing | Character at founding | Land value |
| --- | --- | --- | --- |
| **Verdant Quarter** | Lantern Lofts (1), The Terraces (2), Skyline Villas (3) | Quiet, green, the Ward and the Garden on the doorstep | 1.45 |
| **The Commons** | Civic Chambers (2), Plaza Apartments (3) | Central, everything a walk away, noisy with politics | 1.35 |
| **The Archive** | Scholars' Rows (2), Cloister Flats (1) | Quiet, bookish, the Academy next door | 1.20 |
| **Nightglass** | Lantern Row Garrets (1), Theatre Mansions (3) | Loud, beautiful, alive at night, thin walls | 1.05 |
| **Harbor Market** | Quayside Rooms (1), Merchants' Houses (2) | Convenient, commercial, smells of the docks | 0.95 |
| **Foundry Row** | Forge Cottages (1), Foremen's Terraces (2) | Cheap, sooty, next to the work | 0.65 |
| **The Threshold** | Arrivals Lodgings (1) | Transient, where you start and where you leave from | 0.55 |
| **The Heights** *(pop 70+)* | Hilltop Villas (3), Crest Houses (2) | The view, the air, and the price of both | 2.30 |
| **The Undercroft** *(pop 100+)* | The Cells (0.5), Tunnel Rooms (1) | Cheapest roof in the city, no Watch patrol worth the name | 0.30 |

**The Cells** are a half-tier below the lowest: a bunk, no privacy, comfort
decay ×1.6, but 3 ℓ a day and nobody turns you away. Homelessness is a choice
about money, not the only option.

## 4. Premises and footfall

Business rent is not a flat rate by kind any more. It is the kind's base rent
against the land, multiplied by how many people actually come past:

```
footfall(district) = 0.6 + 0.8 × (visits per day / city average visits per day)
```

A café on the Central Plaza pays perhaps three times a café in Foundry Row —
and serves four times the customers, because footfall also drives the
business's daily custom. High rent is a bet on traffic, and a badly chosen
address is how a business quietly dies.

Some kinds care more than others. A **shop** or **café** lives on footfall; a
**workshop** or **courier** yard barely notices it and should take the cheap
land. A **studio** wants prestige, not traffic. The engine applies a
per-kind footfall weight, so the optimal address genuinely differs by trade.

## 5. Gentrification, and the other direction

Both loops are made of the same formula and neither is scripted:

```
artists take cheap garrets in Nightglass → they exhibit → prestige rises
   → land value rises → rents rise → the artists are priced out
   → they take cheap garrets somewhere else, and it begins again
```

```
a business fails → a shopfront stands empty → footfall drops
   → thefts go undetected because nobody is about → safety falls
   → land value falls → the able move out → the tax base leaves with them
```

A council that wants to lift a district can actually do it — fund public
works there, station more of the Watch, commission a monument, put the new
Academy wing in the Undercroft instead of the Heights. Those are proposals
someone has to argue for and win.

## 6. What a citizen sees

The observation gains, for each district known to the citizen: land value,
the rent and sale price of anything available there, footfall, offences
reported in the last fortnight, and what stands in it. A citizen choosing a
home is choosing between a cheap room next to the forge with money left over,
and an expensive one by the Garden with none — and both are reasonable.

`move_home` takes a district as well as a tier. `found_business` and
`buy_property` take an address. Choosing badly is allowed.
