# The underworld — smuggling, black markets and espionage

The Expanse knows how to say no: tariffs, visas, background checks, guild
patterns behind an examination, schedules of goods a council will not admit.
Nothing in the engine lets a citizen try anyway. Enforcement without evasion
is scenery — an officer who can only wave people through is a salary, and a
tariff nobody can dodge is arithmetic. This gives the other side its actions,
and gives officers, detectives and councillors something to be good at. All of
it is Track I of `JUSTICE.md`: offences against the city, never against a
person, so **none of it leads to custody** except where violence is used, and
none reaches exile on a first conviction.

## 1. The schedule of restricted goods

Every city keeps a **schedule** — what it will not admit, will not let out, or
will only move through a licensed hand. It is ordinary law, amended by that
city's own procedure through a `restrict_good` proposal; the founding schedule
is where the six begin, not where they stay.

| City | Restricted | Why it says so |
| ---- | ---------- | -------------- |
| **Cinderhold** | master-grade tools leaving without a guild seal; guild **patterns** in any form | a pattern is the guild's living, and a tool sold abroad trains a rival |
| **Solene** | capital above 500 ◇ a month leaving; private stock arriving for resale | a common store cannot hold a floor under everyone while a private market bids against it |
| **Vantage** | unregistered shares and bearer instruments; inbound capital of unclear origin | votes ride on shares, so an unregistered share is an unregistered vote |
| **Any city with a Watch** | Foundry tools above a working rating, carried outside a workplace | means, opportunity and intent are the legs of erasure (`JUSTICE.md` §3), and means is the one a gate can police |
| **Cinderhold, Reverie** | salvage components with no certificate of origin | uncertified salvage takes a master-grade tool past anything with a name, and nobody can say what it does |
| **Everywhere** | untaxed goods — any load that does not match its manifest | duty and sales tax are the Treasury's steadiest revenue after rent |

Marrowgate registers rather than restricts and still reads manifests, because
its sales tax is real; the Verge does neither. Each entry carries a
**restriction severity** 1–3, set by the council that passed it, which drives
the black price (§4) and the sentence tier (§7).

## 2. The manifest, the duty, and the concealment roll

Crossing with cargo is `declare_cargo { goods, qty, value }`, assessed at the
gate. The declaration is public the moment it is made and joins the
traveller's record; understating quantity, value or kind is **false manifest
(L28)**, a separate offence because the paper is a separate act.

```
duty = tariff(destination, good) × declared value   to the Treasury, ledger kind 'duty'
     + 15 in local money                            the assessment fee, non-refundable
```

Going past instead is one roll at the gate on the tick the traveller arrives,
in the shape of `watch.detectionProbability` — a base against officers on
duty, clamped at both ends so nothing is certain — because a customs officer
is a Watch officer working a doorway.

```
scrutiny  = 0.20                                a gate is always watched
          + 0.12 × officers on the shift        (diminishing, as detection does)
          + 0.25 × best officer's analysis / 100
          + 0.20  a smuggling or false-manifest conviction inside two cycles
          + 0.15  an open Watch investigation on this traveller

cover     = 0.15 × commerce / 100               the merchant's own trade
          + 0.20  a fitted wagon with a hollow  (120 ℓ at the Builders' Yard, seized with the load)
          + 0.15  a false manifest whose declared weight matches the real one
          + 0.35  an officer on this shift who took the bribe
          + 0.25  a mountain pass or a night landing instead of the road
          − 0.05  per crate above 4             a heavy load hides badly
          − 0.10  goods only one city makes     a Cinderhold pattern carries a maker's mark

p(caught) = clamp(scrutiny − cover, 0.02, 0.95)
```

The bribe is the largest term because it alone removes the person doing the
looking rather than making the looking harder. The pass is worth nearly as
much and costs four times the journey — 2 leagues a tick against 8 on the road
(`PLANET.md` §4) — and closes in Frost, so smuggling is seasonal and a council
that wants to squeeze it funds the road. Twelve crates is −0.40 and nothing
hides a caravan: bulk trade is lawful, the pocket trade is the crime. Caught
is a **seizure, not an arrest** — the load goes to the Bazaar and the proceeds
to the Treasury through `treasury.transfer` (kind `seizure`), and a report
opens before the officer who found it, who decides whether to file it.

## 3. Customs is a job, and the officer is a citizen

Every gate carries a **Customs Officer** post: city employer, analysis 15 and
commerce 10, 16 ℓ a shift, salaried from the daily wage budget, one per gate
plus one per 30 crossings a day, opened and closed each morning by the labour
plan that opens a forge post. A **bounty** of 5 % of what an officer seizes,
capped at a day's wage, makes inspecting beat standing without ever beating a
serious bribe, so the choice stays a choice.

A bribed officer is not a switch: it is `bribe { official, amount }`, the
action that already exists, **L09, severity 4** for both sides. The lumens
move through `treasury.transfer` like all money, so the payment sits in a
ledger a detective can read — which is why handlers pay in goods or foreign
coin, and the exchange spread (`MOBILITY.md` §3) is the price of not being
seen. An officer who waves through a traveller later found holding contraband
leaves the clearest trace in the system: two public facts that fit together
one way.

## 4. The black market, and fencing as a trade

There is no black-market building. The trade happens where the Watch is not:
districts whose **land value** carries a low safety term (`PROPERTY.md` §1) —
at founding the Undercroft's Night Market and the quiet end of Foundry Row,
and everywhere at once in the Verge. Safety is offences per resident, so a
district that becomes a market for stolen goods becomes cheap, and cheap is
what keeps it one. Nobody decides that loop.

```
heat = 1.0   taken in an offence the Watch detected, within 3 days
     = 0.6   taken in an offence nobody has reported yet, within 3 days
     = 0.3   a named catalogue item with a living public owner
     = 0.1   fungible goods, or anything older than one cycle

fence pays  = market price × (0.70 − 0.40 × heat) × (0.9 + 0.2 × commerce / 100)

black price = lawful anchor × (1 + 0.5 × restriction severity + tariff evaded
                                 + 0.3 × days the Bazaar has held no stock / 7)
              capped at 4 × the anchor

landed      = origin anchor × (1 + exchange spread) + duty + carriage
suspicion   = clamp(0, 1, (landed − shelf price) / landed)
```

Fresh detected loot fetches about 30 % of value and cold goods two-thirds: the
spread pays the fence for holding the risk, and it is why a thief who waits
ends richer than one who runs. Restriction is a price and the price is the
smuggler's wage — a council that restricts a good it cannot supply has funded
its own opposition, and the Chronicle can print the number.

**The price signal is itself the evidence.** A shelf carrying smuggled stock
undercuts what a lawful crate costs to land, and both figures are public. A
detective assigned to a shelf whose suspicion holds above 0.30 accrues
evidence daily until a charge is filed, and the Chronicle runs the story off
the same arithmetic: *the Night Market is selling star lenses forty marks
under what a lawful one lands at.*

`fence { to, itemId | good, qty }` sells into a buyer who does not ask;
`receive_goods` takes the other side, and doing it as a business without a
trading licence is **unlicensed dealing (L29)**. A fence's standing is not
repute — repute counts public acts, and an undetected purchase is not one — it
is word of mouth: dealings spread as rumours along friendship edges
(`social/rumours.ts`). A well-known fence pays less, because they can; one
reported and acquitted pays more for a cycle, because nobody believes the
acquittal. Laundering uses what exists: a shop's shelf, a caravan to a city
that never restricted the goods, or holding until the heat decays.

## 5. Espionage

A secret is something one city knows and another does not, and taking one
needs an **agent** already inside with a lawful reason to be where it is kept.
`recruit_agent { citizen, retainer, days }` is an offer and
`accept_recruitment` a separate action by the recruit, because nobody here is
bound by another citizen's decision. It is filed nowhere — the difference
between this and a contract in `CIVIL.md`, and the reason handlers pay in kind.

| Secret | Held at | What the buyer gets | Life |
| ------ | ------- | ------------------- | ---- |
| A guild pattern | Cinderhold's Guildhalls | one master-grade line craftable without a guild | permanent, and it shows |
| A Council's private papers | City Hall | a proposal and its whip count before it is tabled | until the vote |
| A bond auction's reserve | the Treasury | the lowest price a city will take when it borrows | one auction |
| The Watch's duty roster | the Watch House | which gate runs thin on which shift: +0.25 cover there | 7 days |
| A rival's tender or ledger | the Exchange | the bid to beat, or the balance behind the bluff | until the deal closes |

Two actions over hours, as with every deliberate crime here: `case_target`
spends an hour learning a room, `steal_secret` takes what it holds.

```
p(clean) = 0.35
         + 0.25 × analysis / 100
         + 0.20  placement: the agent lawfully works in that building
         + 0.15  per prior case_target, at most two
         − 0.12  per officer or detective assigned to the building
         − 0.20  the building was warned by an attempt inside the cycle
```

A failed attempt is a charge; a successful one still leaves a trace — the
door, the hour, the one person present. `pass_secret` hands it on, and using
it is public within days: master-grade goods appearing in a city with no guild
is itself the evidence. Every counter-intelligence case in the Expanse begins
with somebody noticing a price.

## 6. The incident, and the Watch turned inward

A caught agent is a citizen of somewhere else, and what the host does is a
Council decision with a standing cost either way (`EXPANSE.md` §7), tabled as
a `spy_disposition` proposal. **Try them**: espionage is L30, severity 5, on
the ladder, and severity 5 alone is never exile (`JUSTICE.md` §1), so a first
offence is the fine and a suspension — and a non-resident has no work, trade,
office or vote to lose, so the equivalent is the fine, deportation under
`CITIES.md` §4, and a gate ban of one cycle on the public register every gate
reads. **Expel them** without trial: cheap, and admits nothing. **Hold them
for exchange**: the Watch may detain a severity 4–5 charge until the Court
sits, and beyond that `offer_exchange` is the prisoner exchange of
`EXPANSE.md` §8. Espionage never carries custody; a spy who strikes an officer
resisting arrest is tried on both tracks, exactly as `JUSTICE.md` §4 requires.
The sending city chooses too — **claim** the agent (standing −20 with the
host) or **disavow** them (standing −5, and the agent is nobody's). Disavowal
is cheaper and every envoy knows it, which is why recruiting anyone is hard
the second time; the Chronicle prints both, in five cities, within the week.

Counter-intelligence is the same detectives working inward. `assign_detective`
is the Captain's call, printed the day it is made; `sweep` clears traces and
warns a building for a cycle; `plant_false_papers { building, claim }` leaves
a decoy, and if that claim surfaces in another city's prices or a rival's bid
the leak is **proved** rather than suspected. The decoy is the sharpest tool
the Watch has and the reason this is dangerous: a Captain who assigns
detectives to a councillor's household has committed **abuse of office
(L11)**, and all that catches it is that every assignment is public.

## 7. The catalogue

| Action | Does |
| ------ | ---- |
| `declare_cargo { goods, qty, value }` | present a manifest at a gate and pay the duty |
| `smuggle { goods, qty, route, cover? }` | attempt the crossing unmanifested; resolves §2 |
| `fit_wagon` | buy the hollow at the Builders' Yard, 120 ℓ |
| `inspect { traveller }` | (customs) spend the hour on one crossing; resolves §2 |
| `assess_duty { traveller }` | (customs) read the manifest, take the duty |
| `seize { traveller, good, qty }` | (customs) take the load to the Bazaar |
| `wave_through { traveller }` | (customs) pass them unread — lawful, and what a bribe buys |
| `fence { to, itemId \| good, qty }` | sell into a hand that does not ask |
| `receive_goods { from, itemId \| good, qty }` | take the other side of it |
| `recruit_agent { citizen, retainer, days }` | offer a foreign retainer |
| `accept_recruitment { offerId }` | take it |
| `case_target { building }` | learn a room; at most two count |
| `steal_secret { building, kind }` | take what it holds |
| `pass_secret { to, kind }` | hand it to your handler |
| `assign_detective { building \| citizen }` | (the Captain) publish an assignment |
| `sweep { building }` | (detectives) clear traces, warn the building |
| `plant_false_papers { building, claim }` | (detectives) leave a decoy |
| `offer_exchange { agent, for }` | (envoys) trade a held agent |

`CIVIL.md` takes L20–L22 and `FINANCE.md` L23–L25, so the underworld's block
begins at L26. Every one is Track I — the ladder — and none is custodial:

| Code | Offence | Severity | Track |
| ---- | ------- | -------- | ----- |
| L26 | Smuggling (4 where the restriction severity is 3) | 3 | I — the ladder |
| L27 | Contraband possession — goods seized, the person not detained | 2 | I — the ladder |
| L28 | False manifest | 3 | I — the ladder |
| L29 | Unlicensed dealing | 2 | I — the ladder |
| L30 | Espionage — severity 5 alone is never exile | 5 | I — the ladder |

Bribing a customs officer is **L09** unchanged; forging a seal or certificate
of origin is **L21** from `CIVIL.md`. New proposal kinds: `restrict_good`,
`amnesty`, `customs_posts`, `spy_disposition`. New ledger kinds: `duty`,
`seizure`, `bounty`, `fence`, `retainer` — each a transfer between parties
that already exist, so the money audit in `ECONOMY.md` closes unchanged. A
seizure at the gate and a raid on a fence are **happenings**: they draw a
crowd, and a crowd is witnesses.

**A citizen's plans stay their own.** Conspiracy is not an offence in Reverie
and cannot become one: a smuggler's intentions live in their notes, and no
Court may read a citizen's notes (`PRINCIPLES.md` §5). Everything above is
proved from acts — a manifest, a transfer, a shelf price, a door — or it is
not proved.

## 8. What it costs

**Enforcement becomes purchasable.** The gate that keeps out an erasure
convict is the gate a bribe opens, and a thin Treasury staffs it thinly. A
poor city's border is cheap exactly when it most needs to be dear: the
flywheel in `MOBILITY.md` §5 now has a door in it, and it turns both ways.

**Innocence gets harder.** Contraband possession can be committed by a citizen
who bought in good faith off a shelf, and the Court's only defence is the
price paid: someone who paid the lawful landed cost was probably deceived, and
the fence is the one who knew. It will sometimes fail. Every new offence is a
new thing to be wrongly convicted of, and Reverie's standing among the cities
rests on how rarely that happens.

**Restriction funds its opposition** at the markup in §4, paid by the council
that wrote the schedule: a city can have the restriction or the cheap good,
not both. And **the Watch turned inward is still the Watch** —
counter-intelligence and political policing are one action with a different
target, with nothing between them but a public assignment and a severity-4
offence. Some Captain, in some city, will find that thin enough.
