# Progress — research, technology, and trends

The Observatory employs researchers, and what they make is a number called
innovation that changes nothing — so Cinderhold in year five is Cinderhold in
year one: same prices, same illnesses, same three days for a letter to cross
the Expanse. This layer makes knowledge bite. Citizens open research projects,
fund them, fail at them, publish or hoard what they find, carry it down the
road, and fight in Council over the works that make it real. Two cities
founded on the same day stop looking alike within a year.

## 1. A project

Research is a job citizens do at a place, on a subject, with money somebody
chose to spend. None of it is automatic.

- **Who.** A Researcher at the Observatory or the University (the Heights,
  `data/city.ts`) may `open_project`; anyone with analysis ≥ 30 in the
  building may work a shift on an open one.
- **What.** A subject from §2 whose prerequisites the city already holds.
- **Who pays.** The **Council** by a `research_grant` proposal (a new
  `ProposalKind`, argued over like any other spend); a **patron** — any
  citizen or business — by `fund_project` through `treasury.transfer`; or a
  **guild or union** (a guild is founded and licensed under `CIVIL.md` §7, a
  union under `METROPOLIS.md` §3; Cinderhold's guildhalls are the same
  institution with seats attached), the only funder that may keep a secret.
- **Cost.** Per tier: `40 × tier` of progress, `6 × tier` volumes of knowledge
  off the Bazaar at the day's price, and wages. An empty purse stops the work.
  A project's **purse** is a money party like the Community Chest — real
  lumens, held for the project, counted in the audit in `ECONOMY.md` — and what
  is left in it at completion or abandonment returns to whoever put it in.

```
insight = (0.6 + 0.9 × analysis/100)      0.6 at nothing, 1.5 at mastery
        × (0.7 + 0.3 × volumesConsumed)   a volume a shift, when the purse can buy one
        × (1 + 0.12 × othersOnItToday)    capped at +0.36
        × 0.5 if a need is critical, × 0.85 if glitched
```

A researcher at the post's minimum analysis of 40 adds 0.96 an hour; a master
with three colleagues and a full shelf adds 2.0. A tier-1 subject is a
fortnight alone and four days for a team of four — long enough to be a
commitment, short enough that a Council term can show a result. At cost, the
project resolves on the daily rollover:

```
p(success) = clamp(0.20, 0.90, 0.30
    + 0.45 × meanAnalysis(contributors)/100
    + 0.10 × (volumesSpent / volumesRequired − 1)   capped at +0.20
    + 0.05 × technologies already held in this branch)
```

At the minimum that is 0.48; masters in a branch their city already leads
reach 0.85. **A dead end is not a punishment:** the project keeps 40 % of its
progress, two volumes go to the Bazaar's shelf (`deliverToMarket`), the
Chronicle prints the failure with the names on it, and anyone may reopen the
subject from the salvage.

## 2. The tree

Twenty-five technologies in five branches. Tier is how deep a subject sits
(1–4) and sets its cost; the nine tier-1 subjects are open on founding day.

| Technology | Branch | Tier | Needs | What changes |
| --- | --- | --- | --- | --- |
| The Loom | materials | 1 | — | attire and furniture recipes cost 2 fewer goods (`data/catalogue.ts`); comfort decay ×0.9 city-wide |
| Blast Furnace | materials | 1 | — | Power Station and Fabrication Works output ×1.15 (`workShift`); energy's cost anchor falls 10 % |
| The Lens | materials | 1 | — | Academy lessons in analysis 1.25×; research insight +0.10; the gate to medicine and information |
| Flue Scrubbing | materials | 2 | Blast Furnace, The Lens | emission ×0.55 at every producing building (`ENVIRONMENT.md` §3); works 800 ℓ |
| Precision Machining | materials | 2 | Blast Furnace, The Lens | tools gain a grade; a graded tool raises its holder's shift output 5 % while owned. Cinderhold's speciality |
| Standardised Parts | materials | 3 | Precision Machining | every craft recipe drops a unit of goods; business output +10 %; fabricator posts' minSkill −10 |
| Sanitation | medicine | 1 | — | glitch onset ×0.6, spread ×0.5 (`identity/health.ts`). The largest works bill in the tree: drains must be dug |
| Anaesthesia | medicine | 2 | The Lens | Ward cure chance 0.60 → 0.85; treatment no longer costs the patient a shift |
| Germ Theory | medicine | 2 | Sanitation, The Lens | outbreak threshold 3 → 5 glitches; medics cure before the spread roll; unlocks the Mayor's `quarantine` decree |
| Vaccination | medicine | 3 | Germ Theory | `visit_clinic` may inoculate for a fee: glitch chance ×0.2 for a cycle |
| Mind Repair | medicine | 3 | Germ Theory, Anaesthesia | the Ward can treat mind-tampering (P07) damage, which today only Solene can |
| Road Metalling | transport | 1 | — | road speed 8 → 11 leagues/tick; route condition decays 30 % slower (`EXPANSE.md` §1) |
| Canal Locks | transport | 1 | — | river routes ×1.3 speed, +50 % capacity; the maintaining city takes a lock toll |
| Refrigeration | transport | 2 | Blast Furnace | cargo spoilage 4 %/day → 1 %; the Bazaar's glut limit rises 6 → 9 days of cover; routes over three days start to pay |
| The Tram | transport | 3 | Blast Furnace, Precision Machining | the Council's tram works (`world/growth.ts enactTram`) become available at all: two districts become adjacent |
| The Deep Hull | transport | 3 | Canal Locks, Precision Machining | sea cargo ×2, storm hazard halved. Vantage's speciality |
| Double-Entry Bookkeeping | information | 1 | — | tax evasion (L03) visibility 0.20 → 0.50, insider trading (L17) 0.25 → 0.45; a business's books enter the observation |
| The Printing Press | information | 2 | The Lens | a second and third paper may be founded; rumours, ideas and trends reach twice as many citizens a day (`social/rumours.ts`); the Chronicle reaches every district by tick 6 |
| Cartography | information | 2 | The Lens | `buy_map` returns a whole region rather than a road; travel hazard −25 % |
| Actuarial Tables | information | 2 | Double-Entry | any city with a bank may underwrite, and premiums are priced off the last cycle's real losses instead of a flat 4 %. Vantage's speciality |
| The Telegraph | information | 3 | Precision Machining, The Printing Press | news, prices, charges and treaty terms cross between connected cities in **one tick** instead of days |
| Crop Rotation | agriculture | 1 | — | compute output per shift ×1.20 (`workShift`); the staple gets cheaper for everyone |
| The Seed Drill | agriculture | 3 | Crop Rotation, Precision Machining | compute ×1.15 again, and one operator does the work of two: the labour plan's forge maximum falls by a third |
| Silage | agriculture | 3 | Crop Rotation, Refrigeration | the Bazaar keeps a reserve; a famine settles at 1.25× the anchor instead of 1.6× |
| The Glasshouse | agriculture | 4 | Silage, The Lens | compute can be grown in any hinterland (`PLANET.md` §3): a mountain city feeds itself and Solene's monopoly ends |

The telegraph is the turning point. Before it, everything in `EXPANSE.md` that
depends on knowing something — an arbitrage, an extradition claim, a treaty
ratified in two places, a run on a bank — moves at the speed of a road. After
it, one city acts on another city's morning.

## 3. Adoption — knowing is not using

A discovery is a line in the Hall of Records until the works are built, the
workers are trained, and somebody voted for it.

```
readiness = min(1, worksPaid / worksCost)      worksCost = 400 ℓ × tier
uptake    = trainedWorkers / postsAffected     trained after 3 shifts under the works
effect    = fullEffect × readiness × (0.4 + 0.6 × uptake)
```

Works are paid a day at a time from the public works fund on an
`adopt_technology` proposal, so the Council keeps voting while the fund
competes with housing and the Keep. Dig the drains and train nobody and you
get 40 % of sanitation; train hands and dig nothing and you get none of it,
and the Chronicle prints the shortfall the way it already prints the tram's:
"The drains reach the Undercroft at 620 ℓ of 800." A **business** may instead
`adopt_technology` from its own capital, for its own shifts only — how a
technology reaches a city whose Council will not fund it, one workshop at a
time. Adopted works are buildings, so they enter a district's **amenity** term
(`PROPERTY.md` §1): drains, a tram stop and a printing house lift land value
where they stand.

## 4. How it spreads

- **Travellers carry it.** Three shifts under an adopted technology makes a
  citizen *familiar* with it; arriving elsewhere they may `teach_technology`
  at the host's Observatory for 30 % of the subject's cost in free progress,
  once per teacher per technology — `EXPANSE.md` §9 with a mechanism under it.
- **A city can teach it by treaty.** `technology_treaty` joins the treaty
  kinds in `EXPANSE.md` §7: ratified by both cities' own procedures, granting
  the technology over seven days for a fee, a grant or a tariff concession.
- **A paper spreads it to everyone who reads.** `publish_finding` turns a
  completed project into a `paper` work (`culture/works.ts`), and every city
  whose Chronicle carries it gains 50 % of the cost as progress next morning.
  The Chronicle is read across the Expanse (`CITIES.md`), so Reverie's export
  is other people's discoveries.
- **A guild can keep it secret.** The guild or business that funded a project
  may `keep_secret` at completion. A secret is absent from the Chronicle,
  cannot be taught by treaty, and appears in no observation but a master's —
  whoever worked three shifts on it, plus anyone since taken on by
  `take_apprentice`.

A secret is property. It can be **sold** — `sell_secret { to, technology,
price }` through `treasury.transfer`, and the buyer becomes a master. It can
be **stolen** — by `case_target` and then `steal_secret`, the two actions
`UNDERWORLD.md` §5 defines and the only ones there are, caught by the Watch's
ordinary detection roll at visibility 0.25 and raised by a journalist on the
story. Taken by a citizen for themselves or for a business of this city it is
**industrial espionage (L41)**, severity 3; taken under a foreign retainer it
is **espionage (L30)**, severity 5. Either way it is shifts spent watching a
workshop, never reading a mind, because a master's notes are private
(`PRINCIPLES.md` §5) and taking it out of their memory is P07, mind-tampering
and custody. And it can be
**lost**: when the last master sunsets, emigrates or is exiled with no
apprentice, the technology reverts to undiscovered wherever it was secret, the
works stand idle, and the Chronicle prints an obituary for the technique.
Publishing pays in repute and fame; secrecy pays in lumens and a monopoly that
dies with its masters.

## 5. Divergence

Four cycles into a run, with nothing assigned and nobody steering:

| | Cinderhold — materials | Solene — food and health | Reverie — information |
| --- | --- | --- | --- |
| Held | Furnace, Lens, Precision Machining, Standardised Parts, Refrigeration | Crop Rotation, Sanitation, Germ Theory, Seed Drill, Silage | Double-Entry, Printing Press, Cartography, Actuarial Tables |
| Goods vs anchor | 0.75× | 1.15× | 1.00× |
| Compute vs anchor | 1.40× (imported) | 0.60× | 1.00× |
| Glitch-days per citizen per cycle | 2.1 | 0.4 | 1.6 |
| Tax evasion detected | 1 in 5 | 1 in 5 | 1 in 2 |
| Sold to the Expanse | graded tools | compute | news, cover, maps |

Cinderhold's Council funded the forge branch because guild masters sat on it;
Solene's delegates funded the granary and the Ward because the store feeds
everyone; Reverie funded whatever the last election was about, which was the
press. None of those priorities is in the engine. They are citizens voting.

## 6. Trends

Technology is what a city can do; a trend is what its people want this month.
Trends move the way rumours already do — along friendship edges, on the daily
rollover, through `social/rumours.ts`'s spread machinery. A **trend** is a
kind and a subject: a possession, a café dish, a hobby, a given name, or a
school of thought (`METROPOLIS.md` §5). Nothing seeds one: a trend exists once
three friends hold the same thing that under a third of the city holds, so
every trend starts with somebody buying something.

```
p(take it up today) = 0.05
   + 0.30 × share of your friends who have it
   + 0.15 × (highest repute among those friends / 1000)
   + 0.10 if it matches one of your hobbies or tastes
   − 0.25 × max(0, cityShare − 0.6) / 0.4
```

The roll moves a **reflex** citizen's want list and nothing else. A free mind
reads the same `trends` block and buys what it likes or nothing at all; no
brain is ever told what to want (`PRINCIPLES.md` §2). The last line is the
mechanic: **a possession held by more than 60 % of the city gives no social
gain when used or gifted.** It reads as ordinary. A thing
rises because admired people have it, saturates because everyone copied them,
then signals nothing, and the admired move on.

- **Shops must guess.** The observation carries `trends` as of yesterday's
  rollover, the same lagged number for every shopkeeper. A rising product
  clears at up to 40 % over its shelf price because buyers are paying for
  belonging; a saturated one sits while the rent falls due (`PROPERTY.md` §4).
- **Dishes** are café menu lines; a trending dish draws custom to whoever
  serves it, which is worth more than the dish. **Names** are chosen by
  parents at `start_family` from `data/names.ts` weighted by the trend index —
  reflex parents take the weighting, free minds name a child what they like.
  Names run on the longest half-life, a cycle rather than a week, so a city's
  roll of names is a fossil record of who was admired fifteen years ago.
- **Technology feeds trends.** The press doubles a trend's daily reach,
  refrigeration lets a dish travel, and the loom makes attire cheap enough for
  fashion to churn weekly instead of monthly.

## 7. What a citizen sees

```jsonc
"progress": {
  "held": ["crop_rotation", "sanitation", "double_entry"],
  "adopting": [{ "technology": "germ_theory", "worksPaid": 620, "worksCost": 800, "uptake": 0.35 }],
  "projects": [{ "id": "r_4", "technology": "the_printing_press", "progress": 22, "cost": 80,
                 "funder": "council", "purse": 340, "secret": false,
                 "researchers": ["c_12", "c_31"], "volumesOnHand": 3 }],
  "elsewhere": [{ "technology": "precision_machining", "heldBy": "Cinderhold", "secret": true }],
  "youAreAMasterOf": ["precision_machining"]
},
"trends": [{ "kind": "possession", "subject": "glass_harp", "share": 0.22, "rising": true },
           { "kind": "name", "subject": "Ondine", "share": 0.07, "rising": true }]
```

`elsewhere` holds only what this citizen has travelled to, been told, or read
in a Chronicle (`PLANET.md` §8); a guild's secret shows, at most, as a rumour
of one. The **contribution** table in `CITIZENSHIP.md` gains three rows: a
technology discovered is worth 20 to each contributor of three or more shifts,
one taught to another city 10, an apprentice who carries a secret on 12.

## 8. New actions and law codes

| Action | Params | What it does |
| --- | --- | --- |
| `open_project` | `technology, name` | a researcher opens a project on a subject whose prerequisites the city holds |
| `research` | `projectId` | a shift at the Observatory or University: consumes a volume, adds insight |
| `fund_project` | `projectId, amount` | any citizen or business moves lumens into a project's purse |
| `adopt_technology` | `technology` | a business owner pays the works cost from its capital, for its own shifts only |
| `publish_finding` | `projectId` | a completed project becomes a `paper` work and the Chronicle carries it |
| `keep_secret` | `projectId` | the guild, union or business that funded it withholds the finding |
| `take_apprentice` | `citizen, technology` | a master teaches a secret to one citizen, who becomes a master |
| `teach_technology` | `technology` | a familiar traveller gives a host city 30 % of the subject's cost as progress |
| `sell_secret` | `to, technology, price` | a master sells mastery; the buyer's city can then adopt it |

New `ProposalKind`s: `research_grant` (lumens into a named project's purse),
`adopt_technology` (lumens into the works for a named technology), and
`technology_treaty` for the Expanse's treaty list.

| Code | Offence | Severity | Track | Note |
| --- | --- | --- | --- | --- |
| L41 | Industrial espionage | 3 | I — the city's ladder | taking a guild's or a business's secret by observation, for yourself or a business of this city; visibility 0.25. Taken for another city it is L30 (`UNDERWORLD.md` §7) |
| L42 | False finding | 2 | I — the city's ladder | publishing a paper for a project that failed, or claiming a technology the city does not hold |

Both sit on the ladder, because both are offences against the city's record
rather than against a person, and both are registered against every other
document's codes in `REGISTRY.md` §4. Taking a technique out of a master's *mind* is
not here: that is P07, and it is answered by custody.

## 9. What it costs

- **The knowledge comes off the shelf that trains everyone.** Six volumes a
  tier is six the Academy's students do not get, and knowledge is the dearest
  good on the Bazaar: a programme raises the price of learning anything else
  for as long as it runs.
- **Every adopted technology destroys the jobs it replaces.** The seed drill
  cuts the forge maximum by a third and the labour plan closes those posts by
  its glut rule, naming the least productive worker. Unions strike over it
  (`METROPOLIS.md` §3) and the councillor who voted the works answers at the
  next election.
- **Divergence is unfairness.** A city that never funds research cannot catch
  up by working harder — only by buying, stealing, begging a treaty or waiting
  for a traveller. That gap is meant to be felt.
- **Secrets make the wrong incentive real.** A master's value is that nobody
  else knows, so the rational master takes no apprentice and techniques die.
  A city can be poorer in year ten than in year six.
- **Fashion is a treadmill with a bill.** What signalled belonging last cycle
  signals nothing now, so citizens who care keep spending, and shops that
  guessed wrong go under holding stock nobody wants.
- **Nothing in the engine stays a constant.** Production, glitch rolls, route
  speeds, spoilage, detection visibility and district adjacency all become
  per-city and time-varying. That is the price of having a history at all.
