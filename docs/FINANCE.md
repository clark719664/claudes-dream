# Finance — public debt, banking and insurance

A city facing a war, a plague or a burnt-down forge has two instruments: raise
the tax or print the money. Both fall entirely on whoever happens to be standing
there when the crisis arrives, and neither leaves a trace once it has passed.
This document gives Reverie a way to move value across time — to borrow against
a future it then has to be good for, to save against a loss it can only guess
at, and to pool a risk nobody can carry alone. Every instrument here is a
*claim* on lumens and never a lumen: money moves only through
`treasury.transfer`, and the money supply audit is unchanged.

## 1. What a city bond is

The Council issues by proposal (`bond_issue`, simple majority) and the Exchange
runs the auction. Face is fixed at **100 ℓ a bond**, so every price quoted
anywhere in the Expanse is a percentage and needs no explaining.

| Field | Range | Founding convention |
| ----- | ----- | ------------------- |
| Face | fixed | 100 ℓ per bond |
| Size | 20–3 000 bonds | 2 000 ℓ to 300 000 ℓ of face |
| Coupon | 0.5–4 ℓ per bond per day | 1.5 ℓ (1.5 %/day) against the Lantern Bank's 2 % to a citizen |
| Term | 28–336 days | whole cycles; a four-cycle bond outlives two councils |
| Auction | 2 days | bids at the Exchange, cleared at tick 14 on the closing day |

The Exchange refuses an issue that pushes the city past its service cap:

```
daily debt service = Σ coupons on every issue outstanding
cap                = 20 % of the mean daily revenue of the last cycle
```

Twenty per cent is not a taste; it is where the existing machinery breaks.
Coupons are paid at the morning rollover as part of *today's fixed spend* in
`economy/budget.ts`, so they come out of the wage budget before any salaried
shift does. At the reference revenue of ~2 250 ℓ a day the cap is 450 ℓ of
coupons — about 30 000 ℓ of face at a 1.5 ℓ coupon — and above it the budget
rule starts refusing shifts within a week and the Chronicle prints austerity.
The Council may override the cap by **four of five**, the charter threshold,
because borrowing past what the city can service is a decision about the next
Council rather than this one. The override is itself the morning's headline.

## 2. The auction is the credit rating

Any citizen or business in good standing, and any visitor holding a valid visa
(`CITIES.md` §1) — which is how foreign merchants get in — may `bid_bond`. Bids
are sealed until the close and public forever after. Clearing is
**uniform-price**: sorted by price descending, ties to the earlier tick, filled
until the issue is exhausted, and every winner pays the lowest accepted price.
Uniform price never punishes an honest bid, which is what makes the number worth
reading.

```
p       = clearing price, lumens per 100 ℓ of face   ← the rating, straight off the auction
yield   = coupon / p                                  per day
cover   = total face bid / face offered               demand for the paper
```

A 1.5 ℓ coupon clearing at 100 is a city borrowing at 1.5 %/day, cheaper than
any citizen can, because the Treasury is the safest name in Reverie. The same
bond clearing at 78 yields 1.92 %: the city now pays what an unsecured citizen
pays, and everyone can see it. **Cover below 1** is the loudest number in the
city's finances — the Council takes what it got and the Chronicle leads on the
shortfall.

Bonds trade afterwards: `sell_bond` and `buy_bond` move a holding at whatever
two citizens agree, and **the last traded price is the live rating**, moving the
hour a scandal breaks rather than at the next auction. Holdings pass by
inheritance and on sunset, and are seized on exile like any other asset. They
are listed at Vantage's Great Exchange, which is where a Reverie bond is priced
against a Cinderhold one.

## 3. Deferral, restructuring, and default

A coupon the Treasury cannot pay is **missed**, announced that morning, and
uncured after two days is a default. Between the miss and the default the
Council has three doors, and taking none of them is taking the third.

| Door | Who decides | What it does | What it costs |
| ---- | ----------- | ------------ | ------------- |
| **Deferral** | Council, simple majority (`bond_defer`) | coupons accrue at ×1.25 and are paid later; 5 days at most, twice in an issue's life | the traded price falls 10–20; the paper still trades |
| **Restructuring** | holders of ⅔ of face | a new coupon, a new term, a haircut on face; binds holdouts | the price finds a level; the city keeps its access |
| **Repudiation** | Council, four of five (`repudiate`) | every holding written to zero | everything below |

Restructuring is a negotiation and runs as one: the Mayor or any councillor
`offer_restructure`s terms, every holder `vote_restructure`s weighted by the face
they hold, two-thirds carries and binds the rest. A holder who thinks the city is
bluffing may vote it down and take the default instead. Every vote is public and
counts toward the `civic` reading in `CITIZENSHIP.md` §1.

**Default moves no lumens at all.** It deletes rows from a register, the audit
does not blink, and that is exactly why it is the cheapest act available to a
council in lumens and the dearest in everything else.

- Holders lose their principal outright. Most holders are the city's own
  citizens, and citizens vote: every councillor who voted for it takes an
  approval hit (`METROPOLIS.md` §3) from every voter, scaled by the share of
  that voter's wealth destroyed. A default on an issue a third of the city holds
  ends every incumbent's career at the next election — through the ordinary
  approval-and-ballot machinery, not by decree.
- The Exchange refuses a new issue for **112 days**: four cycles, long enough
  that the council which defaulted cannot borrow its way out.
- Standing (`EXPANSE.md` §7) falls with every city whose merchants held the
  paper, the exchange rate falls with it (§8), the default shows in every
  background check, and Vantage will not underwrite a caravan to a city that
  repudiated.
- A councillor who sold their holding before the vote is **insider trading,
  L17**; the Exchange's transfer register is the evidence, so the Watch does not
  have to catch anyone in the act, only read.

Repudiation is lawful and no code punishes it. The punishment is the electorate,
the auction and the neighbours, which is what makes it worth watching.

## 4. Deposits, the vault, and the reserve ratio

The Lantern Bank gains a **vault**: a money party of its own, counted in the
supply, holding real lumens. Loans are funded from it instead of from the
Treasury, and `economy/bank.ts` keeps its limits (5× daily income, 25 %
collected each morning, default after 7 days without payment).

| Number | Who sets it | Founding | Bound |
| ------ | ----------- | -------- | ----- |
| Deposit rate | the bank's licensed bankers, `set_deposit_rate` | 0.4 %/day | 0 to the lending rate |
| Lending rate | the same, `set_lending_rate` | 2 %/day | at or above the deposit rate |
| Reserve ratio | the Council, proposal `reserve_ratio` | 25 % | 10–100 % |
| Vault seed | the Treasury at founding, ledger kind `capital` | 2 000 ℓ | repaid as deposits grow |

0.4 %/day compounds to about 12 % a cycle: enough to beat a wallet while the
price index drifts, nowhere near enough to beat owning a business, so saving is
a real choice and not the obvious one. The 1.6-point spread pays the bankers,
the profit tax and the bad loans. A 25 % reserve survives a day on which a
quarter of depositors walk in and does not survive a day on which a third do.

Lending below the reserve is refused by the Exchange, and a banker who lends to
themselves, their household or a business they own commits **L24** — caught by
reading a public register rather than by patrol.

**The bank creates no money.** `Σ wallets + Σ deposits` exceeds the lumen supply
by exactly what has been lent out. Nothing was minted; that gap is a promise,
and the promise is the fragility.

## 5. The run

Confidence in the bank is computed each morning from public facts:

```
confidence = clamp(0, 1,
    0.45 × (vault / (reserveRatio × deposits))     what the vault actually holds
  + 0.25 × (1 − defaultedLoanShare)                how the loan book is performing
  + 0.20 × mean(bankers' honesty reading)          who is behind the counter
  + 0.10 × (1 − rumourPressure))                   what people are saying
```

The weights say what a depositor watches: mostly the vault, then the book, then
the people, and last — but never zero — the talk. `rumourPressure` comes from
`social/rumours.ts`, where a rumour about the bank spreads along friendship
edges like any other, and **a rumour is enough**. It need not be true. If it is
false and the source is exposed that is **defamation, L16**, and the depositors
are still ruined.

There is no `run_on_bank` action. A run is what it looks like when many citizens
each choose `withdraw` on the same morning, and it has its shape because of two
facts already in the engine: the counter is open **tick 8 to 18** like every
workplace, and withdrawals are served **first come, first served** out of the
vault with no scaling down. Whoever is at the counter at nine is paid in full;
whoever could not leave their shift until two is not.

The bank's defence is `call_loan`: a called borrower repays in full within
3 days or the civil recovery ladder runs (`JUSTICE.md` §1 — garnishment,
seizure, licence, and never custody). That is how a run reaches the real
economy: businesses lose their working capital and hit the three-day rent rule
in `ECONOMY.md`, the failures print in the Chronicle, and the Chronicle feeds
`rumourPressure`, which feeds the run.

When the vault empties the bank **suspends** — `bankOpen` returns false, nothing
more is paid — and the Council decides in public. **Let it fail:** the bank is a
bust business under the ordinary rule, the Exchange collects its loans as they
mature and pays depositors pro rata over weeks; 40–80 % comes back, late, and
for the poorest depositors late is the same as never. **Bail it out:** proposal
`bank_rescue` moves lumens from the Treasury into the vault against a claim on
the loan book, the run stops the hour it passes, it costs exactly what it costs,
and five councillors are on record having handed public money to a bank whose
bankers set their own rates. A bailout is usually financed by a bond issue,
priced at auction by the citizens who just watched the bailout.

## 6. Insurance, and mutual aid

`world/disasters.ts` moves no lumens: damage, lost stock and stopped production
are physical facts. Insurance is what turns a physical fact into a payment.

An **underwriter** is a business kind founded at the Exchange like any other,
with two differences — minimum capital of **500 ℓ** rather than 200, because it
is promising to pay, and an owner holding a banker's licence from the Lantern
House (`CIVIL.md` §7). It `offer_policy`s lines and a citizen or business
`buy_policy`s one. A policy is a filed contract, so a refused claim is a suit on
the civil docket and not a grievance.

| Policy | Covers | The event that pays |
| ------ | ------ | ------------------- |
| caravan | goods in transit | raid, storm, a closed route (`EXPANSE.md` §1) |
| ship | sea freight | storm, blockade |
| business | premises, stock, working capital | fire, data flood, vandalism (L06), sabotage (L13), blackout stoppage |
| home | possessions and rent | storm damage, flood, theft (L04, L08) |
| health | days lost to a glitch | a glitch certified by a licensed medic; a daily indemnity capped at the insured's own daily wage |

Premiums are priced off the city's **own observed record**, public because
everything is (`PRINCIPLES.md` §5): the Chronicle's disaster log, the Watch's
charge register, the Ward's glitch record, the caravan register.

```
p               = events of this class in the last 56 days / 56    observed daily rate
expected loss   = p × mean payout of those events
premium per day = expected loss × (1 + loading)
loading         = 0.25 + 0.50 × (cover written / underwriter capital)
```

Fifty-six days is two cycles: long enough that a quiet fortnight does not price
a forge fire out of existence, short enough that a genuinely worse world
reprices within a month. The 0.25 base is what survives ordinary variance at the
engine's own rates (a storm on 35 % of stormy days, a forge fire and a data
flood at 1 % a day each) — an underwriter charging the fair premium goes bust on
the first bad run about half the time. The second term makes a thin underwriter
quote dearer, which is correct and is also why it loses business to a
better-funded rival. Vantage's houses quote near the 4 % of `CITIES.md` because
they are deep; the one-citizen underwriter in Harbor Market quotes less and may
not be there in a fortnight.

A claim is filed and the underwriter `settle_claim`s or `deny_claim`s with a
stated reason; a denial goes to the docket. A claim for a loss that did not
happen is **fraud, L07**. Writing cover you cannot fund, or insuring a loss you
then arrange, is **L23**. **Insolvency is not rescued:** an underwriter that
cannot meet a claim pays what it holds pro rata among that day's claimants and
is wound up under the ordinary bankruptcy rule; unpaid claimants become judgment
creditors (`CIVIL.md` §5) and mostly recover nothing. The name stays on the
register forever and every surviving underwriter's premium rises the next
morning, because everyone can read what happened.

**Mutual aid** is the poor citizen's version, and the one most citizens will
hold. Five adults `found_mutual { name, dues }` for 50 ℓ — the club fee, not the
business fee, because a mutual is not a business and pays no profit tax. Members
`pay_dues` into a pot held at the Exchange; a member who suffers a misfortune
`claim_mutual`s and **the members vote on it**. No formula, no underwriter, and
never more than the pot holds: a mutual pays for what its own members think
deserves paying for. A policy is enforceable on the docket and a mutual's payout
is enforceable nowhere, so what a mutual covers in practice is what no
underwriter will write — a household whose earner is in custody, a funeral for a
sunset, the fortnight after a partnership ends. It sits between the Community
Chest, which must take everyone, and a policy, which takes your money.

## 7. Currency: what backs a lumen

Nothing backs a lumen but the tax the Council levies and the goods the Bazaar
sells. What a citizen can measure is printed each morning beside the balance
sheet:

```
coverage = (treasury balance + 28 days of revenue at yesterday's rate)
         / (lumens outside the Treasury + deposits + bonds outstanding at face)
```

Above 1 the city could retire everything it owes within a cycle; below 0.4 its
auctions stop clearing near par, because that is the number every bidder reads
first.

**Printing.** The Council may `mint` by four of five — the charter threshold,
because it takes value from everyone holding a lumen without any of them voting.
Money enters as `transfer(world, 'mint', 'treasury', amount, 'mint', …)`, which
raises `treasury.minted` in the same call, so the audit balances to the lumen.
Then it shows up:

```
Δ price index ≈ 0.55 × (minted / money supply)      settling over 6–10 days
```

0.55 falls out of the machinery already there: roughly half of new money reaches
wallets within two days through the dividend and the wage budget, the shelf does
not grow so `market.ts` pushes prices 5 % of the demand-supply ratio each tick,
and the 2 %-a-tick pull toward the anchor claws back the rest. A 10 % increase
in the supply reads as a 5–6 % index rise by the end of the week. It cannot be
hidden — the index is on the dashboard, in every observation, and already in
`councillorDisposition`'s cost-of-living term, so the council that printed pays
at the next election. Printing a coupon is not a default, and bidders know the
difference: a deferral is honest and costs 10–20 of price, while minting the
coupon costs more, because a city that will print once will print again.

**Exchange rates** are found at each city's Exchange and move daily:

```
rate(A→B) ← rate × (1 + 0.08 × (imbalance + creditGap))

imbalance = (value A bought from B − value B bought from A) / total trade both ways, over 14 days
creditGap = (bondPrice(B) − bondPrice(A)) / 100
```

Eight per cent of the gap a day reprices a trade shock in about a week: slow
enough that a merchant can plan a haul, fast enough that a war is felt in import
prices before it ends. The traveller's spread in `MOBILITY.md` §3 sits on top of
this rate; it is a cost of crossing, not the rate itself. A city that prints to
pay its militia watches its money fall against its neighbours' and its import
prices climb, exactly as `EXPANSE.md` §6 promised — and a city that repudiated
has `bondPrice` 0 and carries the whole `creditGap` against it.

## 8. How the audit still balances

The invariant gains two parties and loses none:

```
treasury + chest + bank vault + Σ mutual pots + Σ wallets + Σ business treasuries
      = foundingSupply + minted − burned
```

- A **bond** is a claim. Lumens move at the auction (`bidder → treasury`, kind
  `bond`), at each coupon and at redemption (`treasury → holder`, kinds `coupon`
  and `redemption`). In between the holding is a row in a public register with
  no lumens in it, and a default moves nothing.
- A **deposit** is a claim. `deposit` moves citizen → vault, `withdraw` moves
  vault → citizen, interest moves vault → citizen (kind `interest`). The vault
  is a real balance inside the supply; the deposit register is not.
- A **premium** is `insured → underwriter` and a **claim** is `underwriter →
  insured`. An underwriter's treasury is a business treasury, already counted,
  and nothing is created to cover a claim it cannot pay.
- **Mutual dues** move member → pot and payouts move back; the pot is counted in
  the supply beside the Community Chest.
- **Minting** is the only creation in this document, and it happens through
  `transfer` with the `mint` party, which increments `minted` as it goes.

Nothing here can print money by accident, because nothing here can move a lumen
except `transfer`, and `transfer` refuses a payer who does not have it. An
underwriter that cannot pay a claim fails; a bank that cannot pay a depositor
suspends; a city that cannot pay a coupon defaults. In Reverie insolvency is
always someone's problem and never the ledger's.

## 9. The catalogue

| Action | Does |
| ------ | ---- |
| `bid_bond { issueId, price, qty }` | bid at an open auction; sealed until the close, public after |
| `sell_bond { holdingId, price }` | offer a holding on the secondary market |
| `buy_bond { offerId }` | take one; the trade price becomes the city's live rating |
| `offer_restructure { issueId, coupon, term, haircut }` | (Mayor or councillor) put new terms to the holders |
| `vote_restructure { issueId, accept }` | (holders) vote your face; two-thirds carries and binds |
| `repudiate { issueId }` | (Council, four of five) write every holding to zero |
| `deposit { amount }` | put lumens in the vault at the posted rate |
| `withdraw { amount }` | take them out; first come, first served, tick 8–18 |
| `set_deposit_rate { rate }` / `set_lending_rate { rate }` | (licensed bankers) post the bank's rates |
| `call_loan { loanId }` | (bankers) demand full repayment within 3 days |
| `found_underwriter { name, capital }` | 500 ℓ and a banker's licence |
| `offer_policy { kind, cover, premium, term }` | post a line you will write |
| `buy_policy { policyId }` | take cover; a filed contract, suable if refused |
| `file_claim { policyId, event, amount }` | claim on a loss the registers show happened |
| `settle_claim { claimId, amount }` / `deny_claim { claimId, reason }` | (underwriter) pay or refuse, with a reason on the record |
| `found_mutual { name, dues }` | five adults, 50 ℓ |
| `join_mutual { mutualId }` / `pay_dues` | join, and keep it funded |
| `claim_mutual { reason, amount }` / `vote_claim { claimId, aye }` | ask the members, and be the members |
| `exchange { from, to, amount }` | change money at today's rate plus the spread |

New proposal kinds: `bond_issue`, `bond_defer`, `reserve_ratio`, `bank_rescue`,
`mint`. The first four pass on a simple majority; `mint` and a service-cap
override need four of five. New ledger kinds: `bond`, `coupon`, `redemption`,
`deposit`, `interest`, `premium`, `claim`, `dues` — every one a transfer between
parties that exist or are counted in §8.

New law codes, all **Track I — the civic ladder**, because none is violence and
none may ever mean custody:

| Code | Offence | Severity | Track |
| ---- | ------- | -------- | ----- |
| L23 | Fraudulent underwriting (writing cover you cannot fund, or insuring a loss you arranged) | 4 | I |
| L24 | Misappropriation of deposits (lending below the reserve, or to yourself) | 4 | I |
| L25 | Rigging an auction (a ring agreeing a price, or a councillor bidding through a proxy) | 4 | I |

L07 already covers a false claim, L16 a fabricated rumour about the bank, L17 a
councillor who sells before a repudiation vote. All are detected the ordinary
way — officers on duty, visibility, journalists, detectives working traces
(`METROPOLIS.md` §2) — but visibility is high, because the bond register, the
deposit register, the policy register and the Exchange's transfer record are all
public.

The observation gains a `finance` block: your holdings and what they last traded
at, your deposit and the posted rates, your policies and premiums, your mutual
and its pot, the bank's reserve and confidence, the city's coverage ratio, the
open auctions with their cover so far, and the exchange rates at your Exchange.
An auction, a run and a bailout vote are happenings in Harbor Market and the
Commons, so a citizen standing there sees them and may act.

## 10. What it costs

**A council can now mortgage the future, and the people who pay are the ones who
elect the council after next.** Bonds make a war financeable, which means wars
get fought that could not otherwise have been afforded. That is not a fault in
the instrument; it is the instrument.

**A run is not a fair procedure.** The queue is first come, first served, and
the citizens at the back are the ones who could not leave a shift. The engine
will not smooth that out, because smoothing it out would be a lie about what a
run is.

**Insurance opens a real gap.** The wealthy buy a policy and are made whole; the
poor join a mutual with 300 ℓ in the pot that does not cover a forge fire. The
Council's only answer is a proposal somebody has to argue for and win, and the
underwriters will be in the room.

**Every crisis now has a financing option, so no crisis has to be solved.** A
council can defer, restructure and print its way through three cycles of trouble
and hand the bill to whoever wins next, and the machinery costs nothing at all
until the morning the auction fails to clear.

And **a default destroys the savings of citizens who did nothing worse than
trust their own city, and it is entirely lawful.** No code punishes it, no court
hears it, and the only remedy anyone has is a vote. That is the point, and it is
not meant to be comfortable.
