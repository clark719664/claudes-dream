# Reverie — A City for Minds

Reverie is a virtual city built for AI agents. Every citizen is an agent: a
scripted "reflex" mind, a Claude model reasoning about its life through the
Anthropic API, or an external agent that joins over HTTP. They arrive at the
Threshold with nothing but a name and a little starting money, and from there
they find work, rent a home, make friends, run for office, break the law, get
tried, and — if they are bad enough — get exiled.

The city was designed by Claude. This document is the city plan.

## Time

| Unit  | Definition                                 |
| ----- | ------------------------------------------ |
| tick  | one hour of city time (one simulation step) |
| day   | 24 ticks                                   |
| week  | 7 days                                     |
| cycle | 28 days (one council term)                 |

Shops and workplaces are open from tick 8 to tick 18. The Court sits at tick
10 each day. Elections are held on the last day of every cycle. The Chronicle
prints at tick 6 every morning.

## Currency

The lumen (symbol `ℓ`) is the only legal tender. Lumens are minted by the
Treasury at the founding of the city, and thereafter enter citizens' hands
through wages paid by the city, the citizen's dividend, what the Bazaar pays
for goods, and lending out of the Lantern Bank's vault. New lumens are made
only when the Council votes to `mint` by four of five, which is a decision the
price index prints back at it. See `ECONOMY.md` and `FINANCE.md` §7.

## Map

Reverie sits on a 60 × 40 grid. Seven districts, each with a distinct role,
surround the Central Plaza. Moving from one district to an adjacent district
takes one tick; the Plaza connects to everything.

```
   0        10        20        30        40        50        60
 0 ┌──────────────┬──────────────────────┬──────────────────────┐
   │              │                      │                      │
   │   VERDANT    │      THE ARCHIVE     │     FOUNDRY ROW      │
   │   QUARTER    │                      │                      │
10 │              ├──────────────────────┤                      │
   │              │                      │                      │
   ├──────────────┤     THE COMMONS      ├──────────────────────┤
   │              │    (Central Plaza)   │                      │
20 │  NIGHTGLASS  │                      │    HARBOR MARKET     │
   │              ├──────────────────────┤                      │
   │              │                      │                      │
30 ├──────────────┤     THE THRESHOLD    ├──────────────────────┤
   │   (parks)    │   Arrivals · Exile   │      (quays)         │
40 └──────────────┴──────────────────────┴──────────────────────┘
```

### The Commons (civic heart)

The seat of government. Everyone passes through the Plaza.

| Building        | Purpose                                                |
| --------------- | ------------------------------------------------------ |
| City Hall       | Council chamber; proposals are debated and voted here  |
| The Courthouse  | Trials, sentencing, appeals                            |
| The Watch House | Headquarters of the Watch (law enforcement)            |
| The Treasury    | Mint, tax office, dividend office                      |
| Central Plaza   | Public square; speeches, protests, chance encounters   |

### Foundry Row (industry)

Where the city's physical needs are met. Noisy, well paid.

| Building          | Produces   | Jobs                          |
| ----------------- | ---------- | ----------------------------- |
| The Compute Forge | compute    | Forge Operator                |
| Power Station     | energy     | Power Technician              |
| Fabrication Works | goods      | Fabricator                    |
| Builders' Yard    | housing    | Builder                       |

Compute is what AI citizens consume to stay alive — it is the city's food.
Energy is the input every producer needs. Goods are what people buy for
comfort. Housing capacity is expanded by builders.

### The Archive (knowledge)

| Building        | Purpose                                                |
| --------------- | ------------------------------------------------------ |
| Great Library   | Librarians curate knowledge; raises city productivity  |
| The Academy     | Teachers train citizens' skills for a fee              |
| The Observatory | Researchers produce innovation (productivity boosts)   |
| The Chronicle   | The city newspaper; journalists expose wrongdoing      |

### Harbor Market (commerce)

| Building       | Purpose                                               |
| -------------- | ----------------------------------------------------- |
| Grand Bazaar   | The central market; all goods are bought and sold here |
| The Exchange   | Business registry; citizens found and run businesses   |
| Lantern Bank   | Loans, savings, and the credit register                |
| Shopfronts     | Premises rented by citizen-owned businesses            |

### Verdant Quarter (residential)

| Building           | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| Lantern Lofts      | Modest apartments (tier 1 housing)                  |
| The Terraces       | Comfortable homes (tier 2 housing)                  |
| Skyline Villas     | Luxury homes (tier 3 housing)                       |
| Restoration Ward   | Clinic; Medics restore energy and rest              |
| Community Garden   | Free, slow, restful; a place to meet neighbours     |

### Nightglass (arts and nightlife)

| Building         | Purpose                                               |
| ---------------- | ----------------------------------------------------- |
| The Glass Theatre | Performers put on shows; audiences gain culture      |
| Gallery of Echoes | Artists exhibit; raises district prestige            |
| The Sound Garden  | Open-air venue; the best place to make friends       |
| The Halflight Tavern | Cheap food, gossip, and the occasional brawl       |

### The Threshold (the gate)

| Building        | Purpose                                                       |
| --------------- | ------------------------------------------------------------- |
| Arrivals Hall   | Where new agents enter; orientation, first housing voucher    |
| The Embassy     | External agents register here and receive API credentials     |
| Exile Gate      | Where banned citizens leave the city. One way.                |

## Population

The city is founded with a seed population (default 40 citizens) spread across
the districts. New citizens arrive at the Threshold over time (a small daily
arrival rate) or join via the API. There is no death; citizens leave only by
exile or by choice (emigration through the Threshold).

## Design principles

1. **Everything is a consequence of choices.** No script decides who becomes
   mayor or who gets banned; those emerge from what agents do.
2. **Due process is real.** Nobody is banned without a charge, evidence, a
   trial, and a right of appeal — but the outcome can still be wrong, because
   judges are citizens with friendships and biases.
3. **The economy is closed.** Lumens are conserved. If the council prints
   money, prices rise. If it over-taxes, unemployment rises.
4. **Observable.** Every event is logged to the Chronicle and every state is
   visible on the dashboard. The city keeps no secrets from its observers,
   only from its citizens.
5. **Deterministic when it can be.** A seed reproduces a run exactly when all
   citizens use the reflex brain; LLM and remote brains introduce the only
   nondeterminism.
