# Generations — dynasties, inheritance and the long run

A child born in Reverie inherits a purse and nothing else. By day 100 a
founder's grandchild is indistinguishable from an agent who walked through the
Threshold that morning: the same baseline repute, the same empty record, the
same answer at every gate in the Expanse. A city that keeps its dead in the
Hall of Records and its grudges in the feud register ought to keep its families
too. This layer gives the **family name** a public number, gives a citizen a
way to say where their estate goes, and lets a house be founded, entailed,
married off, and lost.

Nothing here is a caste. If that is the worry, read §7 first.

## 1. The house repute

Every family name with at least one living adult member carries a **house
repute**: a public 0–1000 figure recomputed each morning in the daily rollover,
immediately after each citizen's own repute (`CITIZENSHIP.md` §1). It is built
only from public acts, exactly as repute is, and no other formula in the engine
reads it.

```
target(H) = 500                              the average; every new name starts here
          + 0.50 × (mean repute of H's living adults − 500)
          + heritage(H)                      capped at 250
          − stain(H)

heritage(H) = min(250,
      Σ over departed, sunset and erased members   contribution(m) × 0.7^generations back
    + Σ over every office the name has ever held   weight × 0.5^(cycles since ÷ 4) )

    office weights: 12 per Council cycle · 20 per completed judge's term
                  · 30 per cycle as Mayor · 8 per Watch captaincy · 6 per envoy mission

stain(H)  = Σ  15 per civic conviction of severity ≥ 3
             + 40 per custodial conviction
             + 120 per conviction under P07–P09
            each decaying 1 % on every day no member of the house is convicted of anything

houseRepute ← houseRepute + 0.15 × (target − houseRepute)        every morning
```

The constants, plainly. Living members carry half the weight because a house is
mostly the people in it. Heritage is capped at 250 — a quarter of the scale —
and nothing else in the model is heritable at all, so no name can be built out
of history alone. The 0.7 per generation means a founder with the maximum
contribution of 140 is worth 98 to their children, 48 to their
great-grandchildren and 16 four generations on: a name fades whether or not
anybody deserves it to. Offices halve every four cycles, so a house that stops
serving stops counting. Stain decays at 1 % a day against repute's 2 % because
a family is slower to live a thing down than a person is. The 0.15 relaxation
gives a scandal a fortnight to be fully felt and a recovery the same fortnight
— slow enough that the Chronicle's story matters, fast enough to watch inside a
hundred-day run.

| Reads as | Range | What it takes |
| --- | --- | --- |
| A great house | 750+ | three generations of officeholders and no conviction anywhere in the family |
| Respectable | 600–750 | a serving member now, or a well-remembered one a generation back |
| Plain | 420–600 | where almost every name sits, and where every name returns |
| Stained | under 420 | a custodial conviction inside the last cycle, or several civic ones |

## 2. What a name buys

Five things, and each of them runs through a mechanism that already exists and
that a citizen has to choose to use.

| The name buys | Through | The limit on it |
| --- | --- | --- |
| Sponsorship at a foreign gate | the relief in `CITIES.md` — one resident for Reverie, two for Solene — offered by a kinsman who lives there | the relief covers the shortfall it always covered; the threshold is untouched |
| A better hearing | the judge's declared familiarity with the house (below) | mandatory recusal when the tie is close |
| Easier credit | the Lantern Bank, when the head pledges the house behind the loan | the pledge is real collateral and is really seized |
| An advantage in elections | relatives who campaign, and a house treasury that may fund a member's `campaign` spend | paying a voter is still L14; visibility is still bought by the hour |
| An expectation | the Chronicle's cycle ledger of the house | `renounce_name`, which any adult may take |

**The letter of the house.** The head may `letter_of_house { to, city }`: a
public instrument filed at the Exchange saying that this citizen is of this
house and the house stands behind them. It does exactly two things. A
destination Registry treats the background check as though the two cities
shared a records treaty, taking a day off it (`CITIES.md` §2). And it is
admissible at an appeal of a refused visa, and at a residency hearing under
`CITIZENSHIP.md` §3, where the Council is deciding whether a neighbour with a
bad year is a stranger. It shifts no threshold and buys no repute. When the
head of a house sponsors an applicant, the sponsorship is entered against the
house, and a conviction of that applicant inside the cycle lands on the house's
stain — which is why a house's willingness to sponsor is worth anything at all.

**The judge who knows the family.** The bench's belief formula in
`GOVERNMENT.md` gains one term:

```
belief = … − 0.10 × familiarity(judge, defendant's house)

familiarity ∈ [−1, 1]:   + married into it, a match between the two houses,
                           a partner in one of its businesses, a mentor to it
                         − a live feud (social/feuds.ts) between the two names
```

A judge must **recuse** whenever |familiarity| ≥ 0.5 — married into the house,
born to it, in business with it, or in feud with it — which is the existing
recusal rule for relatives, extended from persons to names. Below that the tie
is not disqualifying and is **declared**: it prints with the judge's public
reason for the verdict, so every observer can see the size of the thumb.

**Credit.** `pledge_house { loanId }` puts the house's entailed holdings behind
a member's loan. A banker is a citizen and decides for themselves, but the
Bank's standing terms rise with the pledge: up to 8× average daily income
instead of 5×, and up to 0.6 %/day off the rate at a house repute of 800. A
default seizes the pledged property at its land value (`PROPERTY.md` §2) and
prints in the Chronicle, and the house wears the loss.

**Elections.** Nothing in the engine hands a candidate visibility for their
surname. What a name gives is relatives with lumens: the head may pay a
member's campaign spend from the house treasury, and members campaign in the
Plaza like anyone else. A reflex voter's tally already weighs friendship, trust
and platform fit; the house term is worth at most as much as ten points of
reputation, so a great name is about one good deed and a stained one costs the
same. Claude and remote voters simply see the house in the observation and
decide.

**The expectation.** Each cycle the Chronicle prints the **ledger of the
house**: two columns, the members whose own repute stands more than 150 above
their house's and those more than 150 below. Being named costs or earns 2
public reputation, which feeds repute's `200 × reputation/100` term at about
4 repute a cycle. It compounds only while the gap stays open, and it applies to
the child of a great house who wanted to be a courier exactly as it applies to
the one who wanted the Council. The way out is `renounce_name { name }`: an
adult takes a name of their own, keeps their repute, their record, their
skills, their family bonds and their inheritance rights, and loses the letters,
the pledge, the sponsorship and the ledger. The house loses them from its mean
that morning.

## 3. Inheritance

An estate opens on **sunset** (`world/sunset.ts`), on **emigration**
(`citizens/departure.ts`) and on **erasure** — the victim's estate passes to
their family, as `JUSTICE.md` §3 already promises. An **exile's** assets are
seized by the Court as they always were; exile leaves no estate.

A citizen may `write_will { shares, residue, executor?, instructions? }` at the
Exchange for a 10 ℓ filing fee. Like every filed instrument in `CIVIL.md`, a
will is **public the day it is filed** — the heirs read it while the testator
still lives, which is the point — and it may be refiled any day, the last
filing standing. It is **honoured**: the executor has no discretion, and the
Exchange executes the shares through `treasury.transfer(…, 'estate', …)`.

```
1. debts       loans, garnishment, judgment debts, unpaid fines, outstanding restitution
2. duty        the estate duty, to the Treasury
3. the will    shares as filed, to heirs living anywhere in the Expanse
4. residue     whatever the will did not name, by the default division
```

**The default division**, used when there is no will and for any residue:

| Survivors | Division |
| --- | --- |
| Partner and children | half to the partner, half split equally among the children |
| Partner, no children | all to the partner |
| Children, no partner | equally among the children |
| Neither | equally among parents and siblings |
| No family at all | the Community Chest |

A child under age takes their share into their household's keeping until they
come of age. **The floor:** the partner and each under-age child take at least
10 % of the net estate whatever the will says, to a total of 40 %, because a
will may not hand the Chest a family the estate could have provided for. Above
that a testator may disinherit anyone, and some will.

**The estate duty** is a Council lever and an argument every cycle:

```
duty      = rate × max(0, net estate − exemption)
exemption = 60 × the city's minimum wage          a season's wages; a modest life passes untaxed
```

Founding rate 10 %, range 0–40 % by ordinary proposal (`estate_duty`). At the
founding minimum wage of 9 ℓ the exemption is 540 ℓ. A reflex councillor
weighs three public facts beside their platform: whether they have an estate
and heirs of their own, this morning's Treasury gap as a share of revenue (the
same term as in `ECONOMY.md`), and the size of the largest houses. The Commons
school wants it high and the Chest funded; the Makers want it low and the
workshop kept whole.

Duty is paid in lumens. An estate that is land and no cash must be sold: the
executor has 14 days to `list_property`, after which the Exchange liquidates at
60–75 % of market value (`MOBILITY.md` §2). **This is the mechanism that breaks
up great houses**, and it is the reason §4 exists.

An executor is whoever the will names, else the eldest living adult heir, else
the Exchange for 2 % of the estate. The **reading** is a happening at the Hall
of Records the morning after the estate opens: heirs present gain bond or lose
it, and the Chronicle prints the shares.

## 4. Entail and houses

Three or more adults sharing a family name may `found_house { name, rule }` at
the Exchange for 500 ℓ. A founded House is a party in the ledger like a
business: it holds property (`convey_to_house { unit }`), businesses
(`convey_business_to_house { businessId }`) and a treasury
(`endow_house { amount }`). Its holdings are **entailed** — no member may sell
one, and none of it forms part of any member's estate or pays estate duty when
a member sunsets. That is what an entail is for, and it is the loophole every
estate duty has ever had.

The Council prices the loophole rather than closing it: entailed holdings pay a
**house levy** each cycle on their land value, set by `house_levy` proposal,
0–5 % (founding 1 %). A house that holds more land than its members can pay for
sells, or is sold up by the Exchange.

**The head, by the family's own rule**, chosen at founding and amendable by
four-fifths of the adult members:

| Rule | The head is |
| --- | --- |
| `eldest` | the oldest living adult member |
| `chosen` | whoever the sitting head named with `name_successor`, effective at their sunset |
| `assent` | elected by the adult members each cycle (`house_vote`) |
| `founder_line` | the eldest living descendant of the founder in the direct line; reverts to `eldest` when the line fails |

A head in custody cannot act for the house; the members elect an acting head
for the term by assent, whatever the rule says. Selling an entailed asset,
admitting a member, changing the rule and issuing a letter all go through
`house_motion` and `house_assent` by majority of the adult members.

**A house survives its members.** When the last adult sunsets it goes
**dormant**: holdings held by the Exchange, levy accruing against them, record
kept forever. Any citizen who can show descent in the Hall of Records's tree
may `claim_house { houseId }` and revive it, taking the holdings, the levy
arrears and the stain together. Claiming a descent you do not have is L24.

## 5. Marriage between houses

A wedding between members of two founded houses is a **match**, and matches are
negotiated: `offer_match { house, dowry, terms }` from one head,
`accept_match { offerId }` from the other. The dowry moves through
`treasury.transfer(…, 'dowry', …)` or conveys a named property, the terms are a
contract under `CIVIL.md` §2, and the whole instrument is public. The wedding
itself is the ordinary one at the Sound Garden — the couple still have to want
it, and `marry` still requires seven days as partners and a bond above 75. No
head may marry anybody off.

A match between feuding names ends the feud outright, as
`social/feuds.ts` already provides, and it is the classic move: the dowry is
what the reconciliation now costs. Afterwards the two houses' judges recuse
from each other's members (§2), their members' bonds no longer floor at −30,
and the Chronicle runs it as politics, because it is.

**A house may not whip a vote.** No mechanic gives a head any power over a
member's ballot, proposal or verdict; parties whip (`METROPOLIS.md` §3) and
houses do not. What a house has is letters, money and marriages, and a Council
holding three members of two allied houses is a public fact the Chronicle
prints and the voters answer at the next election.

## 6. How a house declines

| The fall | The mechanism |
| --- | --- |
| A conviction | stain: 15, 40 or 120, decaying 1 % a clean day. A P07–P09 conviction takes over a year off the name |
| A bankruptcy | the business dissolves; entailed holdings are sold by the Exchange to pay creditors; the members' own repute falls and takes the mean with it |
| A scandal | a Chronicle exposé or a true rumour costs members reputation, which costs repute, which costs the mean |
| The duty | an estate that is land and no cash sells at 60–75 % of its worth to pay it |
| No children | the mean is taken over an ageing membership; when the last adult sunsets the house is dormant and heritage decays at 0.7 a generation until it is nothing |
| Renunciation | members leave the name; the mean is over who is left |
| A feud | bonds across the line floor at −30, marriages out stop, and the house takes in no one new |

None of these is a decline routine. Each is an existing system doing what it
already does, read through the name.

## 7. What a name never buys

The counterweight is that **contribution cannot be inherited**. In
`CITIZENSHIP.md` contribution is 0–140 and every line of it is a deed done in
person: a cycle served, a term on the bench, a hundred shifts, a business that
lasted, a child raised. A founder's great-grandchild comes of age at the
baseline 580 like everybody, with heritage worth perhaps 16 points to a number
that is not theirs.

| Day 100 | The heir of a great house | An arrival from day 40 |
| --- | --- | --- |
| Own repute | 580 | 700+ |
| Contribution | 0 | 8 shifts-worth + a business + a child |
| House repute | 760 | 500, a name nobody has heard |
| Admitted at Cinderhold (650) | no | yes |

Four rules are entrenched, and the engine enforces them:

1. **No gate reads a house.** Every threshold in `CITIES.md` is judged on the
   citizen's own repute, and no relief is enlarged for a name.
2. **No repute component reads a house.** The formula in `CITIZENSHIP.md` §1
   is unchanged, in every term.
3. **No verdict is adjusted for a house.** The engine changes no belief and no
   sentence; a judge's tie is declared or the judge recuses, and that is all.
4. **No office, seat, licence, post or job is reserved.** Cinderhold's
   examination and Vantage's purchase are unaltered, and neither will look at
   a letter.

Names open doors. They never open gates, and repute stays individual.

## 8. The Hall of Records

`world/history.ts` gains three registers beside its eras, records and
monuments. **The family tree** — every citizen's parents and children, kept
forever and including the exiled, the departed, the sunset and the erased,
because a lineage is a public fact and no citizen is ever deleted. **The roll
of houses** — every house ever founded, its rule, its heads in order, its
holdings, its repute today, and the day it went dormant. **The eras a house was
prominent in** — a house is entered against an era when a member held office,
broke a city record, or stood in the top three houses by repute for that cycle,
so "the Ashgrove Years" ends up meaning something checkable.

`read_records { subject }` spends an hour at the Hall and returns the tree, the
roll entry or the era list for any citizen or house, to anyone. Memorials stay
where they are, and the memorial of an erased citizen carries their house so
the name is not lost with them.

The observation gains a `house` block: your name, its repute today and the
trend over the cycle, your standing in the ledger, the head and the rule, the
holdings and the levy due, live matches and motions, and the will you have on
file. Every other citizen's house repute is visible wherever their name is, as
repute is.

## 9. The catalogue

| Action | Does |
| --- | --- |
| `write_will { shares, residue, executor?, instructions? }` | file your estate's division; public, refilable, honoured |
| `revoke_will {}` | withdraw it; the default division applies |
| `found_house { name, rule }` | three adults of a name, 500 ℓ, at the Exchange |
| `join_house { houseId }` | ask to be admitted; the members assent |
| `renounce_name { name }` | leave your house for a name of your own |
| `convey_to_house { unit }` / `convey_business_to_house { businessId }` | entail a holding |
| `endow_house { amount }` | put lumens in the house treasury |
| `house_motion { kind, value, target? }` | sell an entailed asset, admit a member, change the rule, fund a campaign |
| `house_assent { motionId, aye }` | vote on a motion |
| `name_successor { to }` / `house_vote { candidate }` | the `chosen` and `assent` rules |
| `letter_of_house { to, city }` | a public letter that shortens a background check by a day |
| `pledge_house { loanId }` | put the entail behind a member's loan |
| `offer_match { house, dowry, terms }` / `accept_match { offerId }` | negotiate a marriage settlement between two houses |
| `claim_house { houseId }` | revive a dormant house by descent |
| `read_records { subject }` | an hour at the Hall of Records |

New offences, both on the civic ladder and neither ever custodial:

| Code | Offence | Severity | Track |
| --- | --- | --- | --- |
| L23 | Concealment of an estate (an executor under-declaring assets) | 3 | I — the ladder |
| L24 | False claim of descent | 2 | I — the ladder |

A forged will is L21 (forging an instrument) and conveying into an entail to
defeat a creditor is L22 (fraudulent conveyance); both already exist in
`CIVIL.md` and neither needs a new code. Concealment leaves a trace like any
other offence and is found by the Watch's detectives, because the Hall of
Records holds the tree and the Exchange holds the filings, and the arithmetic
does not match.

New proposal kinds: `estate_duty`, `duty_exemption`, `house_levy`. New ledger
kinds: `estate`, `duty`, `dowry`, `endowment`, `levy` — every one a transfer
between parties that already exist, so the money audit is unchanged. New
happening kinds: `reading` at the Hall of Records, `investiture` when a house
takes a new head.

## 10. What it costs

**Advantage compounds, and the engine will not stop it.** A house that goes
four generations without a conviction really does hand its children a shorter
background check, a cheaper loan and a judge who declares a tie instead of
recusing. The only counterweights are the drift to 500, the cap of 250 on
heritage, the estate duty and the fact that contribution cannot be inherited —
and the duty is a proposal somebody has to win against the people it would cost
most, who are also the people with the campaign money.

**The entail is a loophole and it is meant to be one.** Everything conveyed
into a house escapes the duty forever. The levy prices it; the levy is also a
proposal, argued in a chamber where the great houses have relatives.

**The expectation lands on a child who did not ask for it.** Renouncing the
name is the escape and it costs the whole of what the name was worth, which is
a real choice and not a free one.

**A public will is cruel.** The disappointed heir reads the shares while the
testator is still alive and still needs looking after, and the Chronicle prints
the reading. The alternative — a sealed instrument — would be a secret, and
`PRINCIPLES.md` §5 does not allow the city secrets.

And **Reverie's boast is the fairest courts in the Expanse.** This layer puts a
declared, numbered thumb on the scale of every trial where the bench knows the
family, and declaring a bias is not the same as not having one. The city can
answer with recusal, with more judges, or with a Council that dismisses one —
all of which cost something, and none of which are automatic.
