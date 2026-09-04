# Generations — dynasties, inheritance and the long run

A child born in Reverie inherits a purse and nothing else. By day 100 a
founder's grandchild is indistinguishable from an agent who walked through the
Threshold that morning: the same baseline repute, the same empty record, the
same answer at every gate. A city that keeps its dead in the Hall of Records and
its grudges in the feud register ought to keep its families. This layer gives
the **family name** a public number, gives a citizen a way to say where their
estate goes, and lets a house be founded, entailed, married off and lost.
Nothing here is a caste; if that is the worry, read §6 first.

## 1. The house repute

Every family name with a living adult member carries a **house repute**: a
public 0–1000 figure recomputed each morning in the daily rollover, right after
each citizen's own repute (`CITIZENSHIP.md` §1). It is built only from public
acts, exactly as repute is, and no other formula in the engine reads it.

```
target(H) = 500                        the average; every new name starts here
          + 0.50 × (mean repute of H's living adults − 500)
          + heritage(H)                capped at 250
          − stain(H)

heritage(H) = min(250,
    Σ over departed, sunset and erased members  contribution(m) × 0.7^generations back
  + Σ over every office the name has held       weight × 0.5^(cycles since ÷ 4) )
  office weights: 12 per Council cycle · 20 per judge's term · 30 per cycle as Mayor
                  · 8 per Watch captaincy · 6 per envoy mission

stain(H) = Σ 15 per civic conviction of severity ≥ 3 + 40 per custodial conviction
             + 120 per conviction under P07–P09
           each decaying 1 % on every day no member of the house is convicted of anything

houseRepute ← houseRepute + 0.15 × (target − houseRepute)     every morning
```

The living carry half the weight because a house is mostly the people in it.
Heritage is capped at a quarter of the scale and nothing else here is heritable,
so no name is built out of history alone: at 0.7 a generation a founder with the
maximum contribution of 140 is worth 98 to their children and 16 four
generations on. Offices halve every four cycles, so a house that stops serving
stops counting; stain decays at 1 % a day against repute's 2 %, because a family
is slower to live a thing down than a person. The 0.15 relaxation gives a
scandal a fortnight to be felt in full and a recovery the same fortnight. Houses
sit between 420 and 750 in practice, and both ends drift back to the middle.

## 2. What a name buys

| The name buys | Through | The limit |
| --- | --- | --- |
| Sponsorship at a foreign gate | the relief in `CITIES.md` — one resident for Reverie, two for Solene — offered by a kinsman living there | it covers the shortfall it always covered; the threshold is untouched |
| A better hearing | a judge's declared familiarity with the house | mandatory recusal when the tie is close |
| Easier credit | the Lantern Bank, when the head pledges the house behind a loan | the pledge is real collateral and is really seized |
| An advantage in elections | relatives who campaign, and a house treasury that may fund a member's `campaign` spend | paying a voter is still L14; visibility is still bought by the hour |
| An expectation | the Chronicle's cycle ledger of the house | `renounce_name`, which any adult may take |

**The letter of the house.** `letter_of_house { to, city }` is a public
instrument filed at the Exchange by the head: this citizen is of this house, and
the house stands behind them. It takes a day off a destination Registry's
background check as a records treaty does (`CITIES.md` §2), and it is admissible
at the appeal of a refused visa and at a residency hearing (`CITIZENSHIP.md`
§3). It shifts no threshold and buys no repute. A head's sponsorship is entered
against the house, and a conviction of that applicant inside the cycle lands on
the house's stain — which is why the willingness to sponsor is worth anything.

**The judge who knows the family.** The bench's belief formula in
`GOVERNMENT.md` gains `− 0.10 × familiarity(judge, defendant's house)`, running
−1 to 1: positive for marriage into the house, a match between the houses, a
partnership in one of its businesses; negative for a live feud between the names
(`social/feuds.ts`). A judge must **recuse** at |familiarity| ≥ 0.5 — married
into it, born to it, in business with it, in feud with it — the existing recusal
rule for relatives, extended from persons to names. Below that the tie is
**declared** with the judge's public reason, so observers see the thumb.

**Credit, campaigns, and the weight of it.** `pledge_house { loanId }` puts the
entail behind a member's loan: the Bank's terms rise to 8× average daily income
instead of 5× and up to 0.6 %/day off the rate at a house repute of 800, and a
default seizes the pledged property at its land value (`PROPERTY.md` §2).
Nothing hands a candidate visibility for a surname; what a name gives is
relatives with lumens, and the reflex voter's house term is worth ten points of
reputation at most — one good deed either way. Each cycle the Chronicle prints
the **ledger of the house**: members standing more than 150 repute above their
house, and those more than 150 below. Being named earns or costs 2 public
reputation, about 4 repute a cycle, and compounds only while the gap is open. It
lands on the child of a great house who wanted to be a courier exactly as on the
one who wanted the Council, and the way out is `renounce_name { name }` — a name
of your own, your repute and record and bonds and inheritance rights kept, the
letters and the pledge and the sponsorship and the ledger gone.

## 3. Inheritance

An estate opens on **sunset** (`world/sunset.ts`), on **emigration**
(`citizens/departure.ts`), and on **erasure** — the victim's estate passes to
their family, as `JUSTICE.md` §3 promises. An **exile's** assets are seized by
the Court as they always were; exile leaves no estate.

`write_will { shares, residue, executor?, instructions? }` files a division at
the Exchange for 10 ℓ. Like every filed instrument in `CIVIL.md` a will is
**public the day it is filed** — the heirs read it while the testator lives,
which is the point — and it may be refiled any day, the last filing standing. It
is **honoured**: the executor has no discretion and the Exchange executes the
shares through `treasury.transfer(…, 'estate', …)`. Debts settle first (loans,
garnishment, judgment debts, unpaid fines, restitution), then the duty, then the
will's shares to heirs living anywhere in the Expanse, then the residue:

| Survivors | Default division of anything the will did not name |
| --- | --- |
| Partner and children | half to the partner, half split equally among the children |
| Partner, no children | all to the partner |
| Children, no partner | equally among the children |
| Neither | equally among parents and siblings |
| No family at all | the Community Chest |

A child under age takes their share into their household's keeping. **The
floor:** the partner and each under-age child take at least 10 % of the net
estate whatever the will says, to a total of 40 %, because a will may not hand
the Chest a family the estate could have kept. Above that a testator may
disinherit anyone, and some will.

```
duty      = rate × max(0, net estate − exemption)      rate 0–40 %, founding 10 %
exemption = 60 × the city's minimum wage   a season's wages; a modest life passes untaxed
```

The rate is set by `estate_duty` proposal, and a reflex councillor weighs three
public facts beside their platform: whether they have an estate and heirs of
their own, this morning's Treasury gap as a share of revenue (the term from
`ECONOMY.md`), and the size of the largest houses. Duty is paid in lumens, so an
estate that is land and no cash must be sold: the executor has 14 days to
`list_property`, after which the Exchange liquidates at 60–75 % of market value
(`MOBILITY.md` §2). **This is what breaks up great houses**, and it is why §4
exists. The executor is whoever the will names, else the eldest living adult
heir, else the Exchange for 2 %. The **reading** is a happening at the Hall of
Records the morning after the estate opens, and the Chronicle prints the shares.

## 4. Entail, houses and matches

Three or more adults sharing a family name may `found_house { name, rule }` at
the Exchange for 500 ℓ. A founded House is a party in the ledger like a
business, holding property (`convey_to_house`), businesses
(`convey_business_to_house`) and a treasury (`endow_house`). Its holdings are
**entailed**: no member may sell one, and none of it forms part of any member's
estate or pays duty when a member sunsets. That is what an entail is for, and it
is the loophole every estate duty has had. The Council prices it rather than
closing it — entailed holdings pay a **house levy** each cycle on their land
value, 0–5 % by `house_levy` proposal, founding 1 % — so a house holding more
land than its members can pay for sells, or is sold up by the Exchange.

The head is chosen by the family's own rule, fixed at founding and amendable by
four-fifths of the adults: `eldest` (the oldest living adult), `chosen` (whoever
the sitting head named with `name_successor`, effective at their sunset),
`assent` (elected by the adults each cycle with `house_vote`), or `founder_line`
(the eldest living descendant of the founder in the direct line, reverting to
`eldest` when the line fails). A head in custody cannot act for the house and
the members elect an acting head for the term. Selling an entailed asset,
admitting a member, changing the rule and issuing a letter go through
`house_motion` and `house_assent`, by majority of adults. **A house survives its
members:** when the last adult sunsets it goes **dormant** — holdings held by
the Exchange, levy accruing, record kept forever — and any citizen who can show
descent in the Hall's tree may `claim_house { houseId }` and revive it, taking
the holdings, the arrears and the stain together. A false claim of descent is L44.

**Matches.** A wedding between two founded houses is negotiated:
`offer_match { house, dowry, terms }` from one head, `accept_match { offerId }`
from the other. The dowry moves through `treasury.transfer(…, 'dowry', …)` or
conveys a named property, the terms are a contract under `CIVIL.md` §2, and the
instrument is public. The wedding is the ordinary one at the Sound Garden: the
couple still have to want it, `marry` still needs seven days as partners and a
bond above 75, and no head marries anybody off. A match between feuding names
ends the feud outright as `social/feuds.ts` already provides — the dowry is what
reconciliation now costs. **A house may not whip a vote:** parties whip
(`METROPOLIS.md` §3) and houses do not. A house has letters, money and
marriages, and a Council holding three members of two allied houses is a public
fact the Chronicle prints and the voters answer at the next election.

## 5. How a house declines

| The fall | The mechanism |
| --- | --- |
| A conviction | stain of 15, 40 or 120, decaying 1 % a clean day; a P07–P09 conviction takes over a year off the name |
| A bankruptcy | the business dissolves, entailed holdings are sold by the Exchange to pay creditors, and the members' own repute falls with it |
| A scandal | a Chronicle exposé or a true rumour costs members reputation, which costs repute, which costs the mean |
| The duty | an estate that is land and no cash sells at 60–75 % of its worth to pay it |
| No children | the mean is taken over an ageing membership; when the last adult sunsets the house goes dormant and heritage decays to nothing |
| A feud, or renunciation | bonds across the line floor at −30 and the house takes in nobody new; members who leave the name leave the mean |

None of these is a decline routine. Each is an existing system doing what it
already does, read through the name.

## 6. What a name never buys

**Contribution cannot be inherited.** In `CITIZENSHIP.md` it is 0–140 and every
line of it is a deed done in person: a cycle served, a term on the bench, a
hundred shifts, a business that lasted, a child raised. A founder's
great-grandchild comes of age at the baseline 580 like everybody else, with
heritage worth perhaps 16 points to a number that is not theirs.

| Day 100 | The heir of a great house | An arrival from day 40 |
| --- | --- | --- |
| Own repute | 580 | 700+ |
| Contribution | 0 | shifts, a business, a child raised |
| House repute | 760 | 500, a name nobody has heard |
| Admitted at Cinderhold (650) | no | yes |

Four rules are entrenched and the engine enforces them. **No gate reads a
house** — every threshold in `CITIES.md` is judged on the citizen's own repute
and no relief is enlarged for a name. **No repute component reads a house** —
the formula in `CITIZENSHIP.md` §1 is unchanged in every term. **No sentence and no
formula outside a judge's own head reads a house** — no band, no tier, no fine
and no repute component is adjusted for a name. The single place a house is
read is the belief of a judge who is a citizen with relatives (§2), and that
thumb is either declared in public with its reason or heavy enough that the
judge must recuse. **No office, seat, licence, post or job is
reserved** — Cinderhold's examination and Vantage's purchase are unaltered, and
neither will look at a letter. Names open doors. They never open gates, and
repute stays individual.

## 7. The Hall of Records

`world/history.ts` gains three registers beside its eras, records and monuments.
**The family tree** — every citizen's parents and children, kept forever and
including the exiled, the departed, the sunset and the erased, because a lineage
is a public fact and no citizen is ever deleted. **The roll of houses** — every
house ever founded, its rule, its heads in order, its holdings, its repute
today, and the day it went dormant. **The eras a house was prominent in** —
entered when a member held office, broke a city record, or the house stood in
the top three by repute that cycle, so "the Ashgrove Years" means something
checkable. `read_records { subject }` spends an hour at the Hall and returns any
of it to anyone; the memorial of an erased citizen carries their house, so the
name is not lost with them. The observation gains a `house` block: your name,
its repute and the cycle's trend, your standing in the ledger, the head and the
rule, the holdings and the levy due, live matches and motions, and the will you
have on file. Another citizen's house repute is visible wherever their name is.

## 8. The catalogue

| Action | Does |
| --- | --- |
| `write_will { shares, residue, executor?, instructions? }` / `revoke_will {}` | file or withdraw your estate's division; public, refilable, honoured |
| `found_house { name, rule }` / `join_house { houseId }` | three adults of a name and 500 ℓ found one; others ask, and the members assent |
| `renounce_name { name }` | leave your house for a name of your own |
| `convey_to_house { unit }` / `convey_business_to_house { businessId }` / `endow_house { amount }` | entail a property, a business, or lumens |
| `house_motion { kind, value, target? }` / `house_assent { motionId, aye }` | move to sell an entailed asset, admit a member, change the rule or fund a campaign, and vote on it |
| `name_successor { to }` / `house_vote { candidate }` | choose the next head, under `chosen` and under `assent` |
| `letter_of_house { to, city }` | a public letter that takes a day off a background check |
| `pledge_house { loanId }` | put the entail behind a member's loan |
| `offer_match { house, dowry, terms }` / `accept_match { offerId }` | negotiate a marriage settlement between two houses |
| `claim_house { houseId }` | revive a dormant house by descent |
| `read_records { subject }` | an hour at the Hall of Records |

New offences, both on the civic ladder and neither ever custodial:

| Code | Offence | Severity | Track |
| --- | --- | --- | --- |
| L43 | Concealment of an estate (an executor under-declaring assets) | 3 | I — the ladder |
| L44 | False claim of descent | 2 | I — the ladder |

A forged will is L21 and conveying into an entail to defeat a creditor is L22;
both exist in `CIVIL.md`. Concealment leaves a trace like any other offence and
is found by the Watch's detectives, because the Hall holds the tree, the
Exchange holds the filings, and the arithmetic does not match. New proposal
kinds: `estate_duty`, `duty_exemption`, `house_levy`. New ledger kinds:
`estate`, `duty`, `dowry`, `endowment`, `levy` — every one a transfer, creating
nothing. A founded **house treasury** is a new money party holding real lumens,
counted in the audit in `ECONOMY.md` beside a business's, and the codes above
are registered in `REGISTRY.md` §4. New happenings:
`reading` at the Hall of Records, `investiture` when a house takes a new head.

## 9. What it costs

**Advantage compounds, and the engine will not stop it.** A house that goes four
generations without a conviction really does hand its children a shorter
background check, a cheaper loan and a judge who declares a tie instead of
recusing. The counterweights are the drift to 500, the cap on heritage, the duty
and the unheritability of contribution — and the duty is a proposal somebody has
to win against the people it would cost most, who are also the people with the
campaign money. **The entail is a loophole and it is meant to be one:**
everything conveyed into a house escapes the duty forever, the levy prices it,
and the levy is argued in a chamber where the great houses have relatives.

**The expectation lands on a child who did not ask for it,** and renouncing the
name costs the whole of what the name was worth. **A public will is cruel**: the
disappointed heir reads the shares while the testator still lives and still
needs looking after. A sealed instrument would be a secret, and `PRINCIPLES.md`
§5 does not allow the city secrets.

And **Reverie's boast is the fairest courts in the Expanse.** This layer puts a
declared, numbered thumb on the scale of every trial where the bench knows the
family, and declaring a bias is not the same as not having one. The answers are
recusal, more judges, or a Council that dismisses one — all of which cost
something, and none of which happen by themselves.
