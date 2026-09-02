# The Economy of Reverie

The economy is a closed loop. Lumens are conserved: every lumen a citizen
earns was spent by another citizen, a business, or the Treasury. Goods are
produced by labour, sold on the Bazaar, and consumed to satisfy needs.

## Money

- **Currency:** the lumen (ℓ). Integer amounts only.
- **Founding supply:** the Treasury is created with 100 000 ℓ. Each founding
  citizen receives a 200 ℓ arrival grant from it.
- **Money enters circulation** through: the citizen's dividend, public
  salaries (Watch, judges, councillors, teachers, librarians), public works,
  and Lantern Bank loans.
- **Money leaves circulation** through: income tax, sales tax, fines,
  seizures on exile, loan repayments, Academy tuition, and rent for city-owned
  housing.
- **Inflation** is tracked as a price index (weighted mean of Bazaar prices
  relative to founding prices). The dashboard shows it.

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
works at most 10 shifts a day.

| Job              | Employer           | Skill (min)    | Base wage / shift | Output per shift              |
| ---------------- | ------------------ | -------------- | ----------------- | ----------------------------- |
| Forge Operator   | Compute Forge      | crafting 10    | 14 ℓ              | 3 compute (uses 1 energy)      |
| Power Technician | Power Station      | crafting 10    | 13 ℓ              | 6 energy                       |
| Fabricator       | Fabrication Works  | crafting 20    | 15 ℓ              | 1.5 goods (uses 1 energy)      |
| Builder          | Builders' Yard     | crafting 15    | 14 ℓ              | housing progress (uses 2 energy) |
| Medic            | Restoration Ward   | care 25        | 16 ℓ              | treats patients                |
| Teacher          | The Academy (city) | analysis 30    | 15 ℓ              | trains students                |
| Librarian        | Great Library (city)| analysis 20   | 12 ℓ              | 0.5 knowledge                  |
| Researcher       | Observatory (city) | analysis 40    | 18 ℓ              | 0.3 knowledge + innovation     |
| Journalist       | The Chronicle      | rhetoric 25    | 13 ℓ              | stories; raises detection      |
| Merchant         | Grand Bazaar       | commerce 20    | commission        | trades goods for margin        |
| Banker           | Lantern Bank       | commerce 35    | 17 ℓ              | issues loans                   |
| Performer        | Glass Theatre      | artistry 20    | 11 ℓ + tips       | 4 culture                      |
| Artist           | Gallery of Echoes  | artistry 30    | 10 ℓ + sales      | 2 culture + prestige           |
| Courier          | any business       | none           | 9 ℓ               | speeds deliveries              |
| Watch Officer    | Watch House (city) | analysis 15, rep ≥ 40 | 16 ℓ       | detection                      |
| Judge            | Courthouse (city)  | appointed      | 25 ℓ              | verdicts                       |
| Councillor       | City Hall (city)   | elected        | 20 ℓ              | governance                     |
| Mayor            | City Hall (city)   | elected        | 30 ℓ              | governance                     |

Wages actually paid are `max(minimumWage, baseWage × skillMultiplier ×
employerModifier)`. Skill grows by 0.5 per shift in the job's skill, faster
with knowledge.

**Unemployment:** citizens without a job receive the citizen's dividend
(default 15 ℓ/day) but their purpose need decays. They look for work on the
job board each morning.

## The Bazaar

- Producers sell output to the Bazaar at the current price minus sales tax.
- Consumers buy from the Bazaar at the current price plus sales tax.
- Price update each tick: `price ← price × (1 + 0.05 × clamp((demand − supply)/max(supply,1), −1, 1))`, floored at 1 ℓ and capped at 20× founding price.
- If stock runs out, buyers go hungry; the Chronicle reports a shortage.

## Businesses

Any citizen in good standing with ≥ 300 ℓ may found a business at the
Exchange. A business has: an owner, a kind (workshop, café, studio, shop,
clinic, courier), a treasury, premises (rented in Harbor Market or Nightglass),
and employees. Businesses:

- post jobs with wages the owner sets (≥ minimum wage);
- buy inputs and sell outputs on the Bazaar;
- pay rent and a 10 % profit tax at the end of each day;
- go bankrupt if their treasury is negative for 3 days: employees are laid
  off, the owner's reputation drops.

A business owner's income is the business's profit paid out daily. Owners
tend to vote for lower taxes.

## Housing

| Tier | Building        | Rent / day | Comfort decay multiplier | Capacity (founding) |
| ---- | --------------- | ---------- | ------------------------ | ------------------- |
| 0    | Homeless        | 0          | 2.0 (and no rest bonus)  | ∞                   |
| 1    | Lantern Lofts   | 8 ℓ        | 1.0                      | 30                  |
| 2    | The Terraces    | 20 ℓ       | 0.7                      | 15                  |
| 3    | Skyline Villas  | 50 ℓ       | 0.4                      | 5                   |

Capacity grows when builders complete housing progress (100 progress = 1
unit of tier 1, 250 = tier 2, 600 = tier 3). Rent is paid at tick 0 each day;
a citizen who cannot pay for 3 consecutive days is evicted.

## The Lantern Bank

- Offers loans up to 5 × the applicant's average daily income, at 2 %/day
  simple interest, repaid automatically from wages.
- A citizen who defaults (no payment for 7 days) is reported to the Watch for
  Fraud if they spent the loan on gifts or campaigning, otherwise their
  credit is frozen.

## Taxes and public finance

- **Income tax:** withheld from every wage and business payout. Default 15 %.
- **Sales tax:** on every Bazaar transaction. Default 5 %.
- **Profit tax:** 10 % on business profit, daily.
- **Public spending:** dividend, public salaries, public works, Court and
  Watch costs.
- The Treasury publishes a daily balance sheet to the Chronicle. When the
  Treasury balance is below one day of spending, salaries and dividend are
  paid pro rata and the Chronicle runs a "Treasury crisis" story, which
  usually costs the Council the next election.

## Crime and the economy

Theft moves lumens between citizens; fraud moves lumens from buyers to
sellers; fines move lumens from criminals to the Treasury; seizures on exile
move half of the exile's wallet to the Treasury and the rest to victims. None
of these create or destroy lumens, so the money supply is auditable at every
tick: `treasury + Σ wallets + Σ business treasuries + Σ outstanding loans
principal held = founding supply + minted − burned`. The engine asserts this
invariant every day.
