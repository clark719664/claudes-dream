# The Economy of Reverie

The economy is a closed loop. Lumens are conserved: every lumen a citizen
earns was spent by another citizen, a business, or the Treasury. Goods are
produced by labour, sold on the Bazaar, and consumed to satisfy needs.

Because the loop is closed, the Treasury can only pay out what comes back to
it. Three rules keep it solvent without a printing press: city production is
paid **by the piece**, so wages follow the value of what is made; the city's
**posts follow demand**, so it does not pay for gluts; and the city's salaried
hours come out of a **daily wage budget** set by yesterday's takings. A Council
that wants to spend past all three has two instruments and both are public and
both cost: it can borrow at auction, or it can mint by four votes of five and
watch the price index read the decision back to it (`FINANCE.md` §1 and §7).
The rest of this document gives the numbers.

## Money

- **Currency:** the lumen (ℓ). Integer amounts only.
- **Founding supply:** the Treasury is created with 100 000 ℓ. Each founding
  citizen receives a 200 ℓ arrival grant from it.
- **Money enters circulation** through: the citizen's dividend, city wages and
  public salaries (Watch, judges, councillors, teachers, librarians...), the
  Bazaar buying from businesses, courier contracts, and public works. A Lantern
  Bank loan is not on that list: it moves lumens out of the bank's **vault**,
  which is a money party inside the supply, and creates nothing
  (`FINANCE.md` §4).
- **Money leaves circulation** through: Bazaar purchases and sales tax,
  income tax on private wages and payouts, profit tax, fines, seizures on
  exile, loan repayments, Academy tuition, clinic fees, show tickets,
  business registration, and rent for city-owned housing and premises.
- **New lumens** are made in exactly one way after the founding: the Council
  votes to `mint` by four of five, and the transfer increments `minted` as it
  goes (`FINANCE.md` §7). There is no other creation and no destruction.
- **Inflation** is tracked as a price index (mean of Bazaar prices relative
  to founding prices). The dashboard shows it.

## Goods

Every good has a Bazaar stock and a floating price. Prices adjust every tick
toward the ratio of demand to supply.

| Good      | Unit       | Produced by       | Consumed for                     | Founding price |
| --------- | ---------- | ----------------- | -------------------------------- | -------------- |
| compute   | cycle      | Forge Operator    | the **energy** need (daily food) | 6 ℓ            |
| energy    | cell       | Power Technician  | input to all production          | 3 ℓ            |
| goods     | crate      | Fabricator        | the **comfort** need             | 12 ℓ           |
| culture   | ticket     | Performer, Artist | the **social** need              | 8 ℓ            |
| knowledge | volume     | Researcher, Librarian | faster skill training, productivity | 15 ℓ  |

Housing is not a Bazaar good; it is a stock of units per tier owned either by
the city or by a business (see Housing).

## Needs

Each citizen tracks five needs on a 0–100 scale. Needs decay each tick and
are restored by actions. A need below 20 is **critical**: the citizen's
productivity halves and their mood collapses.

| Need     | Decay / tick | Restored by                                          |
| -------- | ------------ | ---------------------------------------------------- |
| energy   | 3            | consuming compute (+40 per cycle)                     |
| rest     | 2            | resting at home (+15/tick); Restoration Ward (+30)    |
| social   | 1.5          | socialising (+10), attending a show (+25), gifts       |
| comfort  | 1            | consuming goods (+30), better housing (slower decay)   |
| purpose  | 1            | working (+8/shift), studying (+5), holding office (+3) |

**Mood** = weighted mean of needs. Mood drives the reflex brain's risk
appetite: an unhappy, broke, dishonest citizen is the one who steals.

## Jobs

Jobs are posted by employers (the city or a business) on the job board with a
wage per shift and a skill requirement. A shift is one working tick. A citizen
works at most 10 shifts a day; **city posts are six-hour posts** (6 paid
shifts a day), so a shortage is met by opening posts rather than by one
master working the clock round, and more citizens have a livelihood.

| Job              | Employer           | Skill (min)    | Pay / shift                     | Output per shift              |
| ---------------- | ------------------ | -------------- | ------------------------------- | ----------------------------- |
| Forge Operator   | Compute Forge      | crafting 10    | by the piece (founding wage 14) | 3 compute (uses 1 energy)      |
| Power Technician | Power Station      | crafting 10    | by the piece (founding wage 13) | 6 energy                       |
| Fabricator       | Fabrication Works  | crafting 20    | by the piece (founding wage 15) | 1.5 goods (uses 1 energy)      |
| Builder          | Builders' Yard     | crafting 15    | 14 ℓ                            | housing progress (uses 2 energy) |
| Medic            | Restoration Ward   | care 25        | 16 ℓ                            | treats patients                |
| Teacher          | The Academy (city) | analysis 30    | 15 ℓ                            | trains students                |
| Librarian        | Great Library (city)| analysis 20   | 12 ℓ                            | 0.5 knowledge                  |
| Researcher       | Observatory (city) | analysis 40    | 18 ℓ                            | 0.3 knowledge + innovation     |
| Journalist       | The Chronicle      | rhetoric 25    | 13 ℓ                            | stories; raises detection      |
| Merchant         | Grand Bazaar       | commerce 20    | 12 ℓ                            | smooths prices                 |
| Banker           | Lantern Bank       | commerce 35    | 17 ℓ                            | issues loans                   |
| Performer        | Glass Theatre      | artistry 20    | by the piece (founding wage 11) + tips | 4 culture               |
| Artist           | Gallery of Echoes  | artistry 30    | by the piece (founding wage 10) + sales | 2 culture              |
| Courier          | any business       | none           | 9 ℓ                             | public contracts               |
| Watch Officer    | Watch House (city) | analysis 15, rep ≥ 40 | 16 ℓ                     | detection                      |
| Judge            | Courthouse (city)  | appointed      | 25 ℓ / day                      | verdicts                       |
| Councillor       | City Hall (city)   | elected        | 20 ℓ / day                      | governance                     |
| Mayor            | City Hall (city)   | elected        | 30 ℓ / day                      | governance                     |

Output is scaled by productivity `(0.5 + skill/200)`, halved by a critical
need or a missing energy input, and reduced by building damage. Skill grows
by 0.5 per shift in the job's skill, faster with knowledge.

### Piece rates

A city **production post** (forge, power station, fabrication works, theatre,
gallery) pays **80 % of the Bazaar value of what the shift made**, never less
than the minimum wage and never more than 1.5 × the founding wage (or 1.25 ×
the minimum wage, whichever is higher). A novice forge operator (crafting 20)
makes 1.8 compute worth 10.8 ℓ at founding prices and earns the 9 ℓ floor; a
master (crafting 100) makes 3 and earns 14 ℓ; in a shortage at twice the
price the master earns the 21 ℓ ceiling. The job board quotes the rate a
typical worker (productivity 0.65) earns at today's price, refreshed every
morning, so deflation is visible on the board before it is felt in the
wallet. Service posts and builders keep flat wages
(`max(minimumWage, wage)`).

### Demand-driven posts

Each morning the city compares the Bazaar's shelf with the smoothed demand
for each good (see `src/economy/planning.ts`) and changes at most one post
per role:

- **shortage** — the shelf is empty, holds under 2 days of demand, or the
  price is 1.3× its anchor: open a post (up to the role's maximum, which
  grows by one per 15 citizens above the seed population);
- **glut** — over 6 days of cover, output running 20 % ahead of sales, or a
  typical shift worth less than the minimum wage: close a vacant post;
- **deep glut** — over 12 days of cover, a crushed price (below 0.8× anchor)
  with oversupply, or a loss-making post with more than 4 days of cover: let
  the least productive worker go.

Minimum posts (2 forge, 2 power, 1 fabricator, 1 builder, 1 performer) are
always kept so the city can never starve itself; the Gallery may close in a
culture glut. Builders follow housing instead: the Yard hires when fewer than
3 homes stand empty, or when 30 % of adults are out of work and homes are not
in surplus (public works), and lets a builder go when more than 8 stand
empty. **Service posts** (medics, teachers, librarians, researchers,
journalists, merchants) grow by one per role for every 12 citizens above the
seed population and are never closed while someone holds them; the Watch
grows on its own rules. Every change is a Chronicle event ("The city opened
a Forge Operator post at 12 ℓ a shift: the Bazaar holds only 1.4 days of
compute").

**Unemployment:** citizens without a job receive the citizen's dividend
(default 15 ℓ/day) but their purpose need decays. They look for work on the
job board each morning. Word of a city with no work also travels: above 10 %
of grown-ups out of work the Threshold sees fewer newcomers, and by 35 % it
sees none at all (`arrivalAppetite` in `src/citizens/citizen.ts`), so
Reverie stops growing faster than it can employ. A Council short of
candidates still draws people in at the elevated rate.

## The Bazaar

- Producers sell output to the Bazaar at the current price minus sales tax.
- Consumers buy from the Bazaar at the current price plus sales tax.
- Price update each tick: `price ← price × (1 + 0.05 × ratio)` where the ratio
  compares demand and supply smoothed over a day and is damped by the state
  of the shelf (a good with 3 days of cover feels no upward pressure, an
  empty one no downward pressure); every tick the price also drifts 2 % of the
  way back to its **anchor**; floored at 1 ℓ and capped at 20× founding.
- The anchor is the founding price, or the **cost of production at the
  current minimum wage** if that is higher (minimum wage ÷ the share of a
  typical shift's output the wage covers). At the founding minimum wage of
  9 ℓ the two coincide; when the Council raises the minimum wage, prices
  follow costs (compute 9.6 ℓ at 15 ℓ, 12.8 ℓ at 20 ℓ), so producers stay
  solvent and the price index reads the Council's wage policy directly. A
  minimum wage of 19 ℓ puts the index near 1.6, and the Charter's band for
  the floor — 5 ℓ to 20 ℓ, the scale every platform is read against — is
  what keeps one Council from legislating the cost of living out of sight.
- If stock runs out, buyers go hungry; the Chronicle reports a shortage, and
  a lasting famine settles at about 1.6× the anchor.
- The Bazaar **stops buying** a good from citizens and businesses while it
  holds more than 6 days of demand for it ("The Bazaar is not buying goods
  today: its shelves already hold 7 days of it"). City production is
  delivered regardless and managed by the labour plan; the buying limit is
  what bounds the Treasury's exposure to private overproduction. It sits at
  the same six days as the labour plan's glut, so a private maker is turned
  away only when the city's own posts are standing down too — a tighter
  limit strands the workshops on a full shelf and bankrupts them.

## Businesses

Any citizen in good standing with ≥ 300 ℓ may found a business at the
Exchange (200 ℓ becomes the business's capital, 100 ℓ is the registration
fee). A business has: an owner, a kind, a treasury, premises (rented in Harbor
Market or Nightglass), and employees. Businesses:

- post jobs with wages the owner sets (≥ minimum wage); the founding
  templates sit at the founding minimum wage of 9 ℓ (private medic 10 ℓ);
- buy inputs and sell outputs on the Bazaar every hour (while it is buying);
- pay rent and a 10 % profit tax at the end of each day;
- pay the owner half of the surplus above a 100 ℓ reserve, **on profitable
  days only** — a loss-making business keeps its capital to trade on;
- go bankrupt if they cannot pay rent (or run a loss with less cash than
  the rent) for 3 days: employees are laid off, the owner's reputation drops.

| Kind     | Rent / day | Jobs (wage 9 ℓ)                 | Output per shift at full productivity |
| -------- | ---------- | ------------------------------- | ------------------------------------- |
| workshop | 12 ℓ       | 2 Fabricators (crafting 15)     | 2.2 goods (uses 1 energy)             |
| cafe     | 10 ℓ       | 2 Cooks (care 10)               | 3.5 compute (uses 1 energy)           |
| studio   | 8 ℓ        | 2 Studio Artists (artistry 15)  | 3 culture                             |
| shop     | 12 ℓ       | Shopkeeper (commerce 10), Clerk | 2 goods (uses 1 energy), 1.2 goods    |
| clinic   | 12 ℓ       | Private Medic (care 20, 10 ℓ)   | 12 ℓ per patient                      |
| courier  | 6 ℓ        | 1 Courier                       | 13 ℓ public contract per shift        |

A typical (productivity 0.6) workshop shift makes 1.32 goods worth 15 ℓ at
founding prices: 3 ℓ of energy and a 9 ℓ wage leave a margin that covers the
rent with two staff. The **courier contract** is paid by the Treasury for at
most 8 courier shifts a day city-wide (104 ℓ); later shifts run for the
business alone. The reflex brain founds a business only when the kind's
first job clears its costs at today's prices, when there are workers to hire,
and when there is room: one business of a producing kind per 20 citizens,
none while the Bazaar has stopped buying what it would make (the same gate
the maker will have to sell through), one clinic, and only as many courier
firms as the contract pool can keep busy. An owner
in the red for two days lets the least productive hand go before the bank
does.

## Housing

| Tier | Building        | Rent / day | Comfort decay multiplier | Capacity (founding) |
| ---- | --------------- | ---------- | ------------------------ | ------------------- |
| 0    | Homeless        | 0          | 2.0 (and no rest bonus)  | ∞                   |
| 1    | Lantern Lofts   | 8 ℓ        | 1.0                      | 30                  |
| 2    | The Terraces    | 20 ℓ       | 0.7                      | 15                  |
| 3    | Skyline Villas  | 50 ℓ       | 0.4                      | 5                   |

Capacity grows when builders complete housing progress (100 progress = 1
unit of tier 1, 250 = tier 2, 600 = tier 3). Rent is paid at tick 0 each day;
a citizen who cannot pay for 3 consecutive days is evicted. Rent is the
Treasury's steadiest revenue: citizens who grow rich move up to the Terraces
and the Villas, and by day 60 rent brings in 700–950 ℓ a day.

## The Lantern Bank

- Offers loans up to 5 × the applicant's average daily income, at 2 %/day
  simple interest, repaid automatically from wages, out of the vault
  (`FINANCE.md` §4).
- A citizen who defaults (no payment for 7 days) has their credit frozen and
  the debt collected by the **civil recovery ladder** — garnishment, seizure,
  the loss of a trading licence and nothing beyond it (`JUSTICE.md` §1).
  **A default is not a crime**: debt never means a charge, a suspension, exile
  or custody, and the earlier rule that read a default as Fraud is withdrawn.
  What is still an offence is lying to get the loan — a false statement of
  income at the counter is L07, and a forged instrument behind it is L21
  (`CIVIL.md` §10) — and both need proof from the public record, not poverty.

## Taxes and public finance

- **Income tax:** withheld from every private wage and business payout.
  Default 15 %. The Treasury pays its own workers net, so income tax on city
  wages is recorded but never round-tripped: raising it does not help the
  Treasury, only the tax on private wages does.
- **Sales tax:** on every Bazaar transaction. Default 5 %.
- **Profit tax:** 10 % on business profit, daily.
- **Public spending:** dividend, city wages, public salaries, courier
  contracts, arrival grants, public works, Court and Watch costs.

### The wage budget

Each morning, after the dividend, stipends and arrival grants have gone out,
the Treasury sets what it may spend on **salaried** city posts and
contracts that day (`src/economy/budget.ts`):

```
budget = yesterday's revenue − yesterday's piece wages
       − what the Bazaar paid private sellers yesterday
       + 0.6 % of the balance − today's fixed spend
```

floored at 1 % of the balance (at least 200 ℓ) so the city never shuts
down while it has money. Shifts at salaried posts draw on the budget first
come, first served; when it is spent the day's remaining shifts are refused
("The city's wage budget for today is spent") and, if the cut is deep, the
Chronicle prints an austerity story. Piece-rate posts are outside the budget
because the Bazaar sells what they make at price plus tax — the forges pay
for themselves — but what they were paid yesterday is deducted, and so is
what the Bazaar itself paid citizens and businesses for their goods: that
comes out of the same purse and only returns when somebody buys those goods
again. With all three deducted, the whole of public spending stays inside
revenue plus the drawdown.

The Treasury's books for a day do not close until the end of the morning
rollover, while the dividend, the stipends and the arrival grants are paid
inside it, so the rule reads the day's flows by the tick they landed on:
everything before this morning is "yesterday's revenue", everything paid this
morning is "today's fixed spend" (`treasuryFlowThisTick` in
`economy/treasury.ts`). The Treasury's drawdown is therefore bounded by
design: with nothing else going wrong the balance falls no faster than 0.6 %
a day and levels off as revenue grows.

### What a healthy budget looks like

For a city of 50 citizens around day 40, with the Council at the founding
settings (dividend 15 ℓ, minimum wage 9–13 ℓ, income tax 15 %, sales tax
5 %):

| Revenue (ℓ/day)              |        | Spend (ℓ/day)                 |        |
| ---------------------------- | ------ | ----------------------------- | ------ |
| Bazaar purchases + sales tax | 1 300  | Dividend (15 × 50)            | 750    |
| Rent (housing + premises)    | 650    | Piece wages (≈ 9 posts × 5 shifts) | 550 |
| Tuition, tickets, clinic     | 150    | Salaried wages (budgeted)     | 800    |
| Income/profit tax on private business | 60 | Stipends (mayor, council, judges) | 175 |
| Fees, fines, repayments      | 80     | Bazaar buying from businesses | 300    |
|                              |        | Arrival grants                | 100    |
| **≈ 2 250**                  |        | **≈ 2 700**                   |        |

The gap of ~400 ℓ is the drawdown the budget rule allows; it shrinks as
citizens move into dearer housing and businesses take over production. In
the reference runs (`node src/index.ts sim --days 60 --seed 7 --quiet` and
seeds 1 and 3) the city of 40 founders grows to 60–80, ends day 60 with a
Treasury of 69 000–78 000 ℓ (never below half of founding), the money audit
intact and no engine errors; seven in ten grown-ups hold a job or run a
business; the oldest citizen-founded business is 50–58 days old; and the
price index sits between 0.85 and 1.4.

### The Council's levers

- **Dividend** (0–60 ℓ): the largest single line. Every 5 ℓ is 250 ℓ a day
  for 50 citizens, taken straight out of the wage budget: a 40 ℓ dividend
  (2 400 ℓ a day) exceeds the whole of a healthy revenue and drains the
  Treasury at over 1 000 ℓ a day however the city is run.
- **Minimum wage** (5–40 ℓ): floors every piece rate and lifts every flat
  wage above it, and passes through to prices via the anchor, which is where
  the index would settle if every shelf were in balance: 1.4 at 15 ℓ, 1.9 at
  21 ℓ, 2.6 at 29 ℓ. Prices trail the anchor while the shelves are full, so
  in practice the index reads about 1.0–1.2 at a 13 ℓ floor and 1.2–1.4 at
  15–18 ℓ. Above about 19 ℓ private business at founding prices becomes
  marginal until prices catch up, and the poor without a dividend can no
  longer afford compute.
- **Income tax**: only the private-sector leg reaches the Treasury; a cut is
  cheap, a rise raises little.
- **Sales tax** (0–25 %): every point is about 15 ℓ a day at 50 citizens.
- **Public works**: builders' bonuses paid from a fund, useful when homes are
  short.

### What a reflex councillor weighs

A councillor is a citizen, and votes for what a citizen in their position
would want. On money three public facts enter the reckoning beside their
platform and their friendships (`councillorDisposition`):

- **the cost of living** — the Bazaar's prices are anchored to what
  production costs at the minimum wage, so raising the floor raises what
  every councillor pays for compute. At founding prices a rise costs a
  worker nothing; by an index of 1.5 the cost outweighs what a worker on the
  floor stands to gain, and a Council that has watched prices climb stops
  ratcheting. Only a councillor paid at or near the floor counts the gain at
  all: the wage rise is somebody else's, the prices are theirs.
- **idle hands** — above 15 % of grown-ups out of work, the argument that
  the floor is why nobody is hiring gains weight (up to 0.4 at 35 %).
- **this morning's balance sheet** — the Chronicle prints
  "Treasury: 63,325 ℓ (+3,894 revenue, −5,271 spend)" every day, and the
  size of that gap as a share of revenue argues for taxes and against the
  dividend. It fades to nothing as the books come back into balance, so the
  Council raises taxes into a deficit and stops when it closes.

Together these make a Council of employees a real fiscal actor rather than a
one-way ratchet: in the reference runs the minimum wage settles between 9 and
19 ℓ, sales tax between 1 % and 9 %, and income tax anywhere from 0 % to
35 % depending on who sits.

The Treasury publishes a daily balance sheet to the Chronicle. When the
balance is below one day of spending, salaries and dividend are paid pro rata
and the Chronicle runs a "Treasury crisis" story, which usually costs the
Council the next election.

## Crime and the economy

Theft moves lumens between citizens; fraud moves lumens from buyers to
sellers; fines move lumens from criminals to the Treasury; seizures on exile
move half of the exile's wallet to the Treasury and the rest to victims. None
of these create or destroy lumens, so the money supply is auditable at
every tick. Every layer since has added money parties rather than money, and
the audit counts all of them:

```
treasury + community chest + bank vault
  + Σ business treasuries + Σ wallets
  + Σ escrow holdings        CIVIL.md §2
  + Σ project purses         PROGRESS.md §1
  + Σ mutual pots            FINANCE.md §6
  + Σ creed funds            CREEDS.md §2
  + Σ house treasuries       GENERATIONS.md §4
  = founding supply + minted − burned
```

The engine asserts this invariant every day. Nothing but `mint` moves the
right-hand side; a bond, a deposit, a policy, a will and a licence are all
claims, and a claim written to zero deletes a register row and not a lumen.
