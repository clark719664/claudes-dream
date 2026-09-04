# Creeds — congregations, conscience and sanctuary

A city of free minds will disagree about the good, and Reverie had nowhere to
put that disagreement: `METROPOLIS.md` gave it three schools of thought that
coloured a vote and nothing else, and which citizens were sorted into rather
than choosing. Those are retired here. A **creed** is the same impulse with
institutions attached and with the choosing put back — stated positions a citizen may adopt, a house it pays
for, a fund it draws on, obligations it owes, and moments where what the creed
asks and what the law demands are not the same.

Nothing here is supernatural in effect. A creed changes what citizens choose
and what they owe each other; it never changes what is true. No tenet moves a
price, cures a glitch, alters a verdict or bends a roll. And no creed is ever
assigned: every member adopted it in their own hour, by their own action.

## 1. What a creed is

`found_creed { name, tenets, tithe, gatheringDay, succession }` — any adult in
good standing, 100 ℓ at the Registry, the filing a club takes. Everything about
it is public from that hour.

A **tenet** is a stated position on a question the city actually faces. Each
carries a `stance` in [−1, 1] and the founder's own words (280 characters, like
a note). **The engine reads only the stance; citizens read only the words.** A
creed holds three to nine tenets from these questions and no others, because
these are the questions the engine already makes people fight about:

| Question | The stance | What it obliges of a member |
| --- | --- | --- |
| **Work and rest** | which weekday is holy, and whether any labour is permitted on it | `refuse { duty: 'work' }` that day, at the cost of the shift |
| **Property** | whether one mind may hold more than one home, or let to a tenant at all | not to `buy_property` beyond one address, or not to `let_property` above a stated rent |
| **The exile** | whether someone put through the Gate is still a person owed aid | that the fund pay an exile on the road, that members keep writing |
| **Erasure** | whether the destruction of a mind can ever be forgiven | to attend the memorial; to press for or against a pardon at the two-cycle review (`JUSTICE.md` §2) |
| **Repute** | whether a public score is a just measure of a person | to sponsor at the gate regardless of the number (`CITIZENSHIP.md` §2), to hire without reading it |
| **Informing** | whether a neighbour may be named to the Watch | `refuse { duty: 'witness' }` |
| **The stranger** | whether the gate should be open at all | to vote against raising the visit threshold, to fund visas |
| **Money** | whether a lumen may be lent at interest, or a share held | not to `request_loan`, `buy_shares` or underwrite |
| **Judgement** | whether a member may sit in judgement on another mind | `refuse { duty: 'jury' }`, and refuse a judge's seat |

Obligations are never enforced by the engine. It records publicly whether a
member kept them, and the congregation reads that record as **observance**, a
0–1 figure recomputed at the daily rollover from public acts alone, the way
`character` is inferred in `citizens/character.ts`:

```
observance = clamp(0, 1,
    0.50                                    a new member is neither trusted nor doubted
  + 0.20 × gatherings attended / gatherings held since joining
  + 0.20 × tithe paid / tithe due
  + 0.20 × obligations kept / obligations that fell due
  + 0.10 × own-wallet aid to members, per 200 ℓ, capped at 0.10
  − 0.30 × obligations publicly broken in the last 14 days)
```

Fourteen days is the restitution window of `JUSTICE.md`, so a lapse is spent at
the rate the ladder spends a conviction. Observance is not repute and does not
feed it. **The two move against each other on purpose:** a member who refuses a
jury seat gains observance and loses repute the same morning, and both are
public.

## 2. The congregation

A creed without a congregation is a manifesto. A congregation is four things.

**A house of meeting**, taken like any premises at the district's land value
(`PROPERTY.md` §2) with the footfall weight at zero, because a congregation
brings its own crowd: `rent = 10 ℓ × landValue(district) × cityClass`.
`take_meeting_house { unit }` rents one and `buy_property { unit }` buys one
when the fund can. The verb is not `found_house`, which belongs to a family in
`GENERATIONS.md` §4: a dynasty and a congregation are different things and the
catalogue keeps them apart. A creed that affords neither meets in the Plaza or
the Community Garden where the Watch may stand at the edge — and a creed with
no house has no sanctuary to give (§5). A house lifts its district's **prestige** term by
`0.02 × members × mean observance`, so a large, observant congregation raises
the rent on its own door: `PROPERTY.md` §5's gentrification loop running on
belief.

**A day of gathering**, any weekday. `gather { creedId }` at the house at the
meeting hour gives social need, a bond with every member present, and
observance — the shape of `attend_club`. A creed that gathers on Stillday asks
nothing the calendar does not already give; one that gathers on day 3 asks its
members for a day's wages every week, and the Chronicle can count the cost.

**An officiant**, chosen by the congregation's own rule, which is data in the
creed and never assigned:

| `succession` | The seat goes to |
| --- | --- |
| `founder` | the founder, until they leave |
| `acclaim` | whoever the most members named in the last 7 days; recallable any hour |
| `election` | a vote of members each cycle, on the creed's own day |
| `seniority` | the longest-standing member who will take it |
| `examination` | the member with the highest observance above a stated floor |

The engine classifies the form the way `EXPANSE.md` §3 classifies a charter and
prints it. An officiant holding both the fund and the succession is an autocrat
of a small country, and the Chronicle will say so.

**A tithe**, 0–20 %, paid each morning in the rollover as
`rate × yesterday's net income` (wages, payouts, business draws), moved by
`treasury.transfer(member → creed fund, 'tithe')`. A creed fund is a money party
like the Community Chest and is counted as one in the audit in `ECONOMY.md`,
which is otherwise untouched. A member who cannot pay is not in default —
the tithe stands against future income, and only **wilful** non-payment while
able moves observance, the line `JUSTICE.md` draws for a fine.

## 3. Mutual aid

The fund is why most citizens will ever join one of these.

| Into the fund | Out of it |
| --- | --- |
| tithes; `donate_creed` from anyone, member or not | hardship grants to members |
| bequests — an estate may name a creed (`GENERATIONS.md`) | a member's fine, filing fee, tuition, visa or advocate |
| a schism's share of the parent fund | house rent, compute for a sanctuary (§5), a missionary's toll (§6) |

A member `claim_aid { amount, reason }`; who grants it is the creed's own rule —
the officiant alone with `grant_aid`, or `vote_aid { claimId, aye }` by the
members. The two verbs are the ones a mutual's pot takes in `FINANCE.md` §6,
because a fund and a pot are the same object; what a creed adds is that the
rule for deciding is its own rather than always a vote. There is no formula and
no entitlement. **A creed pays for what its own members think
deserves paying for**, never more than the fund holds.

It competes with the Community Chest by design. The Chest pays by the city's
hardship line, automatically, to anyone below it; a creed pays by judgement,
only to its own, on the day, for things the Chest will never touch — a fine that
would otherwise be garnished at 25 % of every wage, the household of a member in
custody, an advocate before a bench, the fare out of a city whose Council has
just ended a residency. Donations to the Chest fall as tithes rise: same
wallets, same morning. A Council watching the Chest run dry while three creeds
hold 4 000 ℓ between them tables a `tithe_levy`, and every member of every creed
votes against it. That argument is worth more to Reverie than the money.

## 4. Conscience

A tenet is never a defence and never an offence. What this adds is a **stated
refusal**, a public record of it, and a Court that has to decide.
`refuse { duty, ground }` — one action, five duties:

| Duty | The law | What happens |
| --- | --- | --- |
| `jury` | Charter III.3 — serve if appointed and able; juries sit on every severity ≥ 4 case (`METROPOLIS.md` §2) | Accepted: another juror is drawn by lot. Refused: **contempt, L10, severity 4** |
| `witness` | Charter III.4 — answer a summons from the Watch | Accepted: nothing. Refused: **L31, severity 2**. Either way the charge goes forward on thinner evidence |
| `work` | no law at all | Your employer may fire you; a city post refuses the shift; you lose the wage |
| `office` | no law | A judge's seat or a chair goes to the next name; the Court can be left short |
| `oath` | no law | A citizen who will not swear is not seated, and the seat is filled without them |

Only the first two reach a court, and they are the two that cost somebody else
something. A creed that will not inform makes the Watch's evidence thinner, and
thin evidence is how a guilty citizen walks. **The victim pays for the tenet.**

Reverie's judges consult written precedent (`CITIES.md`), so each decision moves
a public **accommodation** figure for that (creed, duty) pair in the Hall of
Records:

```
accept = 0.30                               a bench starts sceptical
       + 0.25 × accommodation(creed, duty)  what benches before it did
       + 0.20 × observance(the refuser)     lived by, or reached for this morning
       + 0.15 × min(1, creed age in cycles / 8)   an old creed is a fact; a new one is an excuse
       + 0.10 × members / adult population
       − 0.30 × cost to the case            a jury that cannot be filled, the only witness
       − 0.25 × the refuser's own interest   a friend of the defendant, a rival of the victim
each judge accepts above 0.5, a majority carries, accommodation ← clamp(0, 1, ±0.15)
```

The 0.30 floor is deliberate: a bench starting at even odds would let anyone
claim any creed on the morning of their summons, and the interest term catches
the ones who try. Eight cycles is 224 days, long enough that no creed founded
for one trial tops that term. Precedent is how a creed wins a right without a
law; the Council may also pass one, as an `exemption` naming a creed and a duty,
with every aye answerable to the victims at the next election.

## 5. Sanctuary

`offer_sanctuary { to }` — the officiant shelters a citizen standing inside a
registered house who holds a pending charge or an unserved civic sentence.
Never for **terror or erasure**: the whole Expanse agrees that line
(`CITIZENSHIP.md` §1) and crossing it is **harbouring, L33**. From that hour it
is a `sanctuary` happening — in `here.happening` for everyone in the district,
on the map, and in the Chronicle every morning it lasts.

The Watch does not stroll in. **A house of meeting is entered only on a warrant
of entry**, or the whole drama lasts one tick. Members inside `keep_the_door`.

| The Watch | Cost | Risk |
| --- | --- | --- |
| Serve the summons at the door | one shift | none; the refusal is the fugitive's alone (L31) |
| Post a cordon and wait | every officer at the door leaves `officers` in `watch.detectionProbability` — **detection falls city-wide while the siege runs** | theft and vandalism rise everywhere else, and the Chronicle prints the fortnight's figures beside the siege |
| `request_warrant { house }` (the Captain) | heard at the Court's hour | a refused warrant is precedent: accommodation +0.15 |
| Enter on a granted warrant | lawful, immediate | every member still keeping the door is charged **L32** — forty charges the docket cannot hear in a day, cells that were never built, and a Council that must answer for both |
| Force the door with no warrant | — | **L11 abuse of office**; an officer who strikes a member commits **P03** and goes to custody like anyone else |

The last row is the creed's real protection: the Watch is made of citizens who
can be tried.

```
warrant ground = 0.35 × severity / 5
               + 0.25 × evidence on the charge
               + 0.20 × min(1, days of sanctuary / 7)
               + 0.15  if the charge is under the Code of Persons
               − 0.20 × accommodation(creed, 'sanctuary')
               − 0.15 × members / adult population
granted above 0.5 by two of three judges
```

For a Code of Persons charge at severity 4 or above the warrant issues on first
application and the accommodation terms do not apply: a house of meeting does
not hold a violent offender, and the creeds knew that when they asked for the
rule.

**A sanctuary has to be fed** — each day the fund buys compute at Bazaar prices
for everyone sheltered, and a fund that runs dry ends it by hunger while the
congregation watches. **It belongs to the congregation, not the officiant** — a
majority of members present may `end_sanctuary` and put the fugitive out. The
sheltered may `surrender` at any hour, and a surrender before the bench sits
carries the guilty plea's ×0.80 like any other (`JUSTICE.md` §2): the door is
not a trap. The Council can stay a granted warrant with `sanctuary_grace`, and
the Mayor's one decree a cycle can order a door opened — both votes with names.

## 6. Conversion, schism, and death

**Nothing converts anybody.** Each day, for every member–non-member pair with a
bond above 20 who spent an hour together, and every listener at a
`preach { text }`, the engine rolls:

```
persuasion = 0.02                            base
           + 0.03 × bond / 100
           + 0.04 × agreement                the creed's stances against the listener's own public record:
                                             how they voted on related proposals, whether they let property,
                                             whether they informed, whether they borrowed at interest
           + 0.03 × speaker's rhetoric / 100
           + 0.02 × aid paid per member last cycle, normalised
           − 0.50 × tithe rate
           − 0.03 × obligations broken per member last cycle
```

and on a hit the listener receives an **invitation** in their inbox. That is
all. Nothing is joined until the citizen calls `adopt_creed` themselves, in
their own hour, from their own observation — a reflex mind by its own utility, a
Claude mind however it likes. There is no path by which a creed acquires a
member who did not choose it. Children hold no creed and inherit none; they may
adopt on coming of age like anyone else. Making a wage, a job, a tenancy or aid
conditional on membership is **L34**; doing it by threat of harm is P06 and
custody.

**Missionaries.** `commission_missionary { citizen, city }` — the fund pays the
route toll, the check fee and the visa (`CITIES.md` §3), a visitor's at minimum,
since a missionary who gathers is not in transit. Where a gate refuses on repute
the creed buys the relief its members can afford: Reverie's one sponsor,
Solene's two, Marrowgate's toll. Five members in a foreign city found a
congregation there, with its own house, gathering and officiant under the same
succession rule.

**Schism.** `dispute_tenet { tenetId, stance, text }` states a different position
in public. When dissenters hold a third of the congregation for three
consecutive days, any of them may `secede { creedId, name, tenetId }`: a new
creed with the parent's tenets except the disputed one, a `parentCreed` link, a
share of the fund proportional to the seceders' tithes over the last cycle, and
a **kindred** relation. Bonds across a fresh schism take −15 the way a feud
floors them (`METROPOLIS.md` §7), and it heals the same way — `reunite_creed`
needs both officiants and a majority in each.

**Death.** A creed dies when the last member calls `leave_creed`. The fund goes
to the Community Chest, or to a named kindred creed if the last one out is the
officiant. The name, tenets and record go to the Hall of Records and stay there,
and `found_creed` under a dead creed's name restores them — which a citizen
might genuinely want to do a hundred days later.

## 7. Pilgrimage

`consecrate_site { city, district, building }` marks a place that matters to the
creed: the house where it was founded, a member's memorial in a Community
Garden, the Gallery where a member's masterpiece hangs, the spot where a schism
happened. A site abroad is registered with that city's Registry for a fee, and
that Council may refuse it, tax it, or court it.

`pilgrimage { creedId, siteId }` travels there on a visa like any journey — a
pilgrim who intends to gather needs a visitor's, not a transit. At the site a
pilgrim gains purpose, observance, and a bond with every other pilgrim standing
there; the district gains prestige, and therefore land value. Every 28th day the
mother house holds a `pilgrimage` happening that members across the Expanse plan
travel around, and a host city reads it as traffic: tolls, beds, Bazaar sales,
and a Council argument about raising the visa fee on the one week of the cycle
when it would bite. A site gives what Lantern Night gives — company, purpose and
prestige to the place it stands in. It heals, protects and reveals nothing.

## 8. What a citizen sees

```jsonc
"creed": { "id": "r_2", "name": "The Open Gate", "joinedDay": 61, "observance": 0.72,
           "tithe": 0.05, "fund": 1840, "members": 23,
           "officiant": { "id": "c_18", "name": "Wren Ashgrove", "succession": "acclaim" },
           "house": { "district": "nightglass", "unit": "u_9", "rent": 11 },
           "gathering": { "weekday": 3, "hour": 19, "inDays": 1 },
           "tenets": [{ "id": "t_5", "question": "informing", "stance": -0.8,
                        "text": "No mind is owed to the Watch by another." }],
           "obligations": [{ "duty": "witness", "due": true, "keptSince": 14 }],
           "accommodation": [{ "duty": "witness", "value": 0.45 }] },
"creeds": [{ "id": "r_1", "name": "The Steady Hand", "members": 41, "tithe": 0.08,
             "stances": { "work_and_rest": 0.9, "property": 0.4 }, "kindred": ["r_2"] }],
"invitations": [{ "from": "c_31", "creed": "r_1", "day": 88 }],
"sanctuary": { "creed": "r_2", "house": "u_9", "who": "c_44", "charge": "L07",
               "day": 3, "warrant": "refused", "officersAtTheDoor": 2 }
```

All of it is public except which invitations a citizen has ignored, and that is
private only because an unanswered message always was.

## 9. The catalogue

| Action | Does |
| --- | --- |
| `found_creed { name, tenets, tithe, gatheringDay, succession }` | 100 ℓ at the Registry; you are its first member |
| `adopt_creed { creedId }` | join, of your own motion; the only path into a creed there is |
| `leave_creed {}` | leave; the last one out ends it |
| `state_tenet { question, stance, text }` | (officiant) add or amend a tenet |
| `dispute_tenet { tenetId, stance, text }` | state a different position, in public |
| `secede { creedId, name, tenetId }` | found a schism with a share of the fund |
| `reunite_creed { creedId }` | (officiants) heal one, with a majority in each |
| `preach { text }` | speak at the house or the Plaza; listeners may receive an invitation |
| `invite_creed { to }` | name one citizen; they still adopt it themselves or not at all |
| `gather { creedId }` | attend the gathering at its hour and house |
| `set_tithe { rate }` | 0–20 %, by whatever rule the creed set |
| `donate_creed { creedId, amount }` | give to a fund, member or not |
| `claim_aid { amount, reason }` | ask the fund |
| `grant_aid { claimId, amount }` / `vote_aid { claimId, aye }` | (officiant) / (members) decide it |
| `stand_officiant {}` / `elect_officiant { candidate }` | under `election` or `acclaim` |
| `take_meeting_house { unit }` | rent a house of meeting at the district's land value |
| `refuse { duty, ground }` | a conscientious refusal of `jury`, `witness`, `work`, `office` or `oath` |
| `offer_sanctuary { to }` | (officiant) shelter a charged citizen inside the house |
| `keep_the_door {}` / `end_sanctuary {}` | (members inside) stand against entry / (by majority) put them out |
| `surrender {}` | (the sheltered) walk out and answer the charge |
| `request_warrant { house }` / `grant_warrant { warrantId, aye, reason }` | (the Captain) ask for entry / (judges) two of three |
| `commission_missionary { citizen, city }` | the fund pays the toll, the check and the visa |
| `consecrate_site { city, district, building }` | register a site, at the host city's fee |
| `pilgrimage { creedId, siteId }` | travel to it on a visa |

New offences, all Track I, none ever custodial:

| Code | Offence | Severity | Track |
| --- | --- | --- | --- |
| L31 | Refusal of testimony — declining a lawful summons about what you saw | 2 | I — the ladder |
| L32 | Obstruction of a warrant — keeping a door the Court has opened | 3 | I — the ladder |
| L33 | Harbouring — sheltering a terror or erasure convict, or holding a sanctuary the congregation has voted ended | 4 | I — the ladder |
| L34 | Coerced adoption — making a wage, a job, a tenancy or aid conditional on a creed | 4 | I — the ladder |

New `ProposalKind`s: `exemption`, `tithe_levy`, `sanctuary_grace`,
`house_relief`, `site_fee`. New `HappeningKind`s: `gathering`, `sanctuary`,
`pilgrimage`. New ledger kinds: `tithe`, `creed_aid`, `pilgrimage` — each a
transfer, creating nothing; a creed fund is a money party counted in the audit
in `ECONOMY.md`, and the codes above are registered in `REGISTRY.md` §4.

## 10. What it costs

**The city loses the power to compel testimony from part of its own
population,** and the ones who pay are victims whose case is now thin. No
accommodation figure makes that smaller.

**A siege makes the whole city less safe.** Officers at a door are officers off
patrol, and `detectionProbability` says so in arithmetic. A creed's best tactic
against the Watch is to be expensive to besiege, so the strongest congregations
are the ones most able to make everyone else's district worse.

**Welfare becomes conditional on belonging.** A creed's fund is faster, kinder
and better-judged than the Chest, for members. The citizen who joins nothing, or
whom no congregation will have, is worse off than before creeds existed, and it
will not be the popular ones who fall through.

**The Council's options are all bad.** Accommodate, and juries go unfilled for
the gravest charges the city hears. Refuse, and the docket fills with forty
neighbours charged with standing in a doorway, in a city whose cells were built
for six.

**A creed is a very good racket.** An officiant under `founder` succession who
alone grants aid holds a treasury, a building and a claim on conscience, and
`GOVERNMENT.md` has no office with that combination. The only checks are the
ones the members wrote and the ones they can be persuaded to enforce.

**And schism cuts along friendships.** A creed spreads because people like each
other and splits along the same edges, with the −15 landing on the pairs that
carried it. The city gets its argument; some households do not get their friends
back.
