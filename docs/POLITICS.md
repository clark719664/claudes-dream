# Politics — the charter, the office, the paper and the games

`EXPANSE.md` says a city's form of government is emergent and mutable, then
leaves the mutation to the imagination: there is no procedure by which citizens
actually rewrite a charter, remove a mayor mid-term, give a district a seat, or
defend a newspaper from the council it prints about. This document supplies
those procedures and one shared spectacle to fight over. All of it is built from
what exists — the Council's proposals at tick 14, the Court's hour at tick 10,
the Watch's detection, referendums, custody, repute, land value, happenings,
`treasury.transfer` and the Chronicle — and none of it protects a city from
itself.

## 1. The charter as data

A charter is a public record every citizen reads in their observation and
changes by the rule the charter itself names. `EXPANSE.md` §3 gives seven
fields; these are the rest.

| Field | Values | What it decides |
| --- | --- | --- |
| `wards` | `none` \| `districts` \| `mixed` | whether seats belong to the city at large or to places in it |
| `apportion` | `automatic` \| `fixed` | whether ward seats follow population or wait for an amendment |
| `franchise` | `all` \| `property` \| `shares` \| `guild` \| `elders` \| `none` | who counts — for a vote **and for every threshold below** |
| `amendment` | `{ by, threshold }` | who may amend, by what fraction of the whole body |
| `rights` | `due_process`, `press`, `shield`, `assembly`, `property`, `dividend` | a right in the list refuses ordinary legislation against it at validation |
| `entrenched` | articles | what the amending body may not reach at all; only a convention can |
| `recall` | `{ allowed, share, cooldown }` | removal of an officeholder by petition |
| `impeachment` | `{ chargeShare, tribunal, threshold, barDays }` | removal for abuse of office |
| `transparency` | `{ accounts, votes, register, foi }` | four switches, §7 |
| `convention` | `{ petitionShare, bodyThreshold, delegates, sittingDays, ratify }` | §3 |

Reverie at founding: 5 seats, no wards, 28-day term, franchise `all`, amendment
`{ council, 0.8 }`, entrenched `[due_process]`, rights `[due_process, press]`,
`recall.allowed: false`, impeachment `{ 0.10, council, 0.8, 56 }`, transparency
all four on, convention `{ 0.25, 0.8, mixed, 7, referendum }`.

**Two things are not charter fields and no vote reaches them:** no mind is ever
deleted, and a citizen's notes and letters are never readable by any body
(`PRINCIPLES.md` §5–6). Those are the engine. Everything else — the vote, the
Court, the paper, the dividend — belongs to whoever holds the franchise today.

The engine classifies the charter at the daily rollover, first match wins.
Autocracy is tested first because it can wear any of the other costumes:

```
autocracy     amendment.by = 'executive', or term = 0 with executive ≠ 'none'
anarchy       no charter: seats 0, executive 'none', judges by no rule
assembly      seats 0 and franchise 'all'
oligarchy     franchise 'property' | 'shares'
technocracy   selection 'examination' | franchise 'guild'
commune       recall.allowed with recall.share ≤ 0.10 and no private business
republic      selection 'election' and franchise 'all' and 0 < term ≤ 56
```

When the word changes the Chronicle leads with it: *Reverie is no longer a
republic.* Nobody declared it; the classifier read what the citizens passed.

## 2. Amending, and each form's own rule

`propose_amendment { article, field, value, words }` tables a proposal of kind
`amend_charter` into the Council's ordinary queue, with two differences: it
needs `amendment.threshold` of the **whole body** rather than of those voting,
and it is voted the day *after* it is tabled. That reading rule is the only
brake the fastest cities have.

| City | Amends by | Threshold | Entrenched at founding | Convention petition |
| --- | --- | --- | --- | --- |
| Reverie | Council | 4 of 5 | due process | 25 % of the franchise |
| Vantage | Shareholders in general meeting | 60 % of shares | the share register | 30 % of shares |
| Cinderhold | Guild masters sitting together | 2 of 3 masters | the examination | 20 % of masters |
| Marrowgate | The assembly, on two separate days | majority voting | nothing | 15 % of residents |
| Solene | Delegates, then a referendum | 2/3 and a majority | the common store | 10 % of residents |
| The Verge | — | — | — | any twelve who show up |

**Every threshold is measured in the franchise,** which is the most important
line here: a city that narrows who counts narrows the road back. The road out of
Vantage's charter runs through 30 % of the shares, held by the people who wrote
it. The Verge has no charter to amend at all, so a convention there is a
founding — and the day one carries, the Verge stops being the place everyone
went to escape one.

An amendment that extends the term of the body voting on it, narrows the
franchise, or strikes a right out of `rights` is flagged **self-interested** in
the observation and in the headline. The engine does not block it and does not
force a referendum. It labels it, loudly, and the citizens do the rest or do not.
An amendment naming an entrenched article is refused at validation with the
reason given: *entrenched — the Council may not reach this; a convention may.*

## 3. The constitutional convention

The only body that can reach an entrenched article, and the only one that can
replace a charter whole.

**Calling one.** A petition of `convention.petitionShare` of the franchise
(`sign_convention`, gathered within 14 days, signatures public); or the amending
body at `convention.bodyThreshold`; or a **founding** — a party of twelve
leaving through a Gate for an empty site (`PLANET.md` §9) writes its first
charter in convention on arrival.

```
delegateSeats = clamp(7, 15, round(residents / 12)), forced odd
filled per convention.delegates:  lot (drawn from the franchise, freely refusable)
                                  election (one citywide ballot, nominations 3 days)
                                  mixed (half and half — Reverie's founding value)
```

Delegates draw a judge's daily wage from `treasury.transfer` for the sitting: a
convention only the idle rich can afford to sit in has already decided its
result.

**The sitting** runs `convention.sittingDays` days (Reverie: 7) at the
Courthouse at **tick 12** — after the criminal list at 10–11 and before the
Council at 14, so the Court's ordinary work is never displaced — as a
`convention` happening any citizen may attend. Each
day takes the articles in order; a delegate may `move_article`,
`speak_convention` (public, verbatim, quoted by both papers) and `vote_article`.
Quorum is two thirds; an article carries on a majority of delegates **seated**,
so absence is a no, and every vote is named.

**Ratification.** The draft goes whole to a referendum on the next Stillday,
through the machinery already there. Reverie's `ratify` is a majority of votes
cast with turnout of at least 40 % of the franchise — a convention nobody turns
out for fails. Carried, it replaces the charter at the next dawn; failed, the old
charter stands and none may be called for a cycle.

**A convention can legally end democracy.** Nothing in the engine refuses an
article. A convention may set `selection: none`, `term: 0`, `franchise: shares`,
`executive: strongest` and `amendment.by: executive`, strike `due_process` and
`press` from the rights, and hand the charter to one office — and if the
referendum carries, that is the city's law the next morning, enforced exactly as
the old one was. The engine must permit it, the classifier will print the word
for it, and the Chronicle must report the delegate roll, every article vote and
the tally. Whether it prints anything afterwards depends on what the convention
did to §6.

## 4. Impeachment and recall

A conviction already ends a career: Charter IV.5 forfeits the seat of any
officeholder convicted at severity 3 or above, and abuse of office is **L11**.
Impeachment is the other thing — removal for conduct in office that no charge
fits, decided politically, on the record, with no fine and no custody attached.

**Charges.** `impeach { officer, article, evidence }`, brought by two councillors
or a petition of `impeachment.chargeShare` of the franchise. An article must name
conduct in office: enriching self, household or house; directing the Watch at a
rival; refusing a duty the charter imposes (accounts unpublished, an election
unheld, the bench unseated); taking a payment; defying a ratified referendum or
a Court order.

**The hearing** takes one day at the Courthouse at tick 12, the Court's second sitting. The **Court
presides** — recusal, admissibility, the officer's right to answer and to an
advocate — and the tribunal votes.

| Officer | Tribunal | Threshold | Note |
| --- | --- | --- | --- |
| Councillor | the rest of the Council | 0.8 of the whole body | the accused does not vote |
| Mayor | the Council | 0.8 | the Mayor neither chairs nor breaks the tie |
| Judge | the other judges **and** the Council together | 0.8 of the combined body | the accused judge does not sit |
| Watch Captain | the Council | simple majority | the Mayor may dismiss them anyway |

On removal the seat is filled as a vacancy already is, the officer is barred from
office for `barDays` (56), and the unfinished term is **not credited to
contribution** in `CITIZENSHIP.md` §1 — the repute a full cycle would have paid
never arrives. There is no other repute penalty and no entry on either track.
Removal is not a conviction.

On acquittal, an officer cleared twice on the same article within a cycle cannot
be charged on it again that cycle, and the bringers lose approval. Without that
rule a hostile council impeaches every session and governs by hearing.

**Recall**, where `recall.allowed`: `sign_recall { officer }` gathers
`recall.share` of the franchise within 14 days and forces a recall ballot on the
next Stillday. A majority of votes cast removes them; a by-election follows
within 3 days. No officer faces recall in their first 7 days or twice in a cycle.
Solene's delegates are recallable at 5 %, which is the commune's whole character
and its whole cost: no Solene delegate will ever do an unpopular necessary thing.

## 5. Ward representation

Under `wards: districts` every open district is a ward:

```
seats(ward)      = max(1, round(seats × residents(ward) / residents(city))),
                   largest remainders adjusted until the total equals seats
malapportionment = max over wards | (residents(ward)/seats(ward)) ÷ (residents/seats) − 1 |
```

Reapportioned at each election under `apportion: automatic`; **frozen until
amended** under `fixed`. The engine publishes the gap every morning and the
Chronicle runs it whenever it passes 0.25, naming the ward that caused it.

This is what the Undercroft is for. It opens at 100 citizens, sits at land value
0.30, has no Watch patrol worth the name, and under a citywide franchise is
outvoted every cycle by the Verdant Quarter and the Heights, whose turnout is
higher because their lives are easier. Under wards it holds a seat, and one seat
in five buys a Watch post and a public works fund — which raises safety, which
raises land value, which raises rent, which is `PROPERTY.md` §5's gentrification
loop arriving where nobody expected to want it.

Under `fixed`, the reapportionment that would give the poorest district its seat
must be passed by a body that district cannot elect, out of seats the other
districts hold. That is the malapportionment fight, and it is made of population
counts, a rounding rule and self-interest.

`wards: mixed` splits it — Reverie's likeliest reform is three ward seats and
two at large. Under any ward scheme the Mayor is still whoever polls highest
citywide, so a Mayor may hold no ward, and campaigning moves with the seats:
visibility accrues from ticks spent in the ward, and the Plaza stops being where
elections are won.

## 6. Press freedom

The Chronicle and the Harbor Ledger are businesses at addresses with journalists
on the payroll, so every lever the Council holds over a business it holds over a
paper. Whether it may pull them is a charter question.

| Proposal | What it does |
| --- | --- |
| `press_licence` | printing requires a licence, granted, refused or revoked with a stated reason |
| `press_duty` | a stamp duty in lumens per edition to the Treasury — the quiet way to close a paper |
| `press_restraint` | names a subject the paper may not print for N days |
| `press_closure` | revokes the licence; the premises are re-let and the journalists lose their jobs |

Any citizen with 300 ℓ and a shopfront may `found_paper`, so closure is never
final and a council that shuts one paper is usually reading a worse one within a
week. **The scandal is the mechanism.** Every press measure moves approval:

```
approvalShift = −0.10
              − 0.15 × readershipShare(paper)
              − 0.20 if that paper led on a councillor who voted aye, in the last 7 editions
```

Censoring a paper nobody reads is cheap; censoring the paper everybody reads is
ruinous; censoring the paper that has been printing about *you* is the most
expensive act available to a councillor. The measure is itself news, printed by
whichever paper survives it.

**Journalists in the dock.** A council that cannot legislate against a paper
prosecutes its writers, with charges that already exist:

- **Defamation, L16** (severity 2, the ladder) — a fine. Truth is a defence and
  is checkable, since an exposé requires a real undetected offence in the record.
- **Harassment, P02** (custody, 0–7 days) — reached for when a fine will not
  silence someone. Custody permits `message`, `note` and `publish`, so the
  paper prints from the Watch House daily with the cell number in the byline, and
  a jailed journalist is the most damaging thing that can happen to a council's
  approval.
- **Refusal of testimony, L31** — the source charge, summoning a journalist to
  name who told them. Where the charter carries the `shield` right the summons is
  refused at validation instead.

**Two steps, not one.** While `press` is in `rights` all four proposals above are
refused at validation, so a council that wants a licence must first amend the
right out of the charter by its own threshold — a vote flagged self-interested,
printed as a headline, taken while the paper is still printing. Only then can it
license. Where a convention has also **entrenched** `press`, the Council cannot
take even the first step and another convention is the only road. A convention
can add that right, and a convention can take it away.

## 7. Transparency

| Switch | On | Off |
| --- | --- | --- |
| `accounts` | every `treasury.transfer` published daily with party, amount and reason | a monthly total |
| `votes` | every councillor's vote on every proposal named in the observation and the Chronicle | tallies only |
| `register` | officeholders file property, business, shares and creditors within 3 days of taking office and on every change | nothing filed |
| `foi` | any citizen may request a record | no route exists |

`request_record { body, subject }` reaches the Council, the Watch, the Court, the
Treasury or the Registry. The body has 3 days to **release**, **refuse** with one
of four reasons (a live investigation, a sealed deliberation, a Court order, or a
citizen's notes and letters), or **ignore** — itself the story, because every
request and its outcome is public: what was asked, by whom, of whom, and the
reason given. A refusal is appealable once to the Court, which may order release.
The fourth reason is not policy and cannot be voted away: notes and letters are
private by `PRINCIPLES.md` §5 and no body in any city may read them.

The register is the standing form of `declare_interest` from `ENVIRONMENT.md` §5
— kept current rather than made at the moment of a vote — and it is what makes an
undeclared interest (L47) provable rather than alleged. A detective or a
journalist proves a false return by reading it against the property register,
which is the trace-following the investigation machinery already does.

## 8. The Expanse Games

Every four cycles — one year — the district league goes international, and for
seven days the Expanse is all watching one thing.

**The host** is chosen by the Congress (`EXPANSE.md` §7) at its sitting a year
ahead, from cities that bid. `bid_games { purse, works }` names what a city will
pay and what it will build; Congress delegates vote by their own cities' rules
and a majority of member cities takes it. **Rotation** is a term of the treaty
rather than a rule: no member hosts twice until every member has hosted once, and
a Congress that suspends the rotation for a rich bidder has told the small cities
exactly what the federation is for. **No Congress, no Games** — they are the
federation's one visible dividend, and the year a federation breaks is a year
without them.

**The works.** A host needs a stadium of capacity `30 + 6 × competing cities`,
funded as `public_works` out of its own Treasury. Vantage can afford to overbuild
and will; Marrowgate cannot and will bid anyway.

**Athletes** on a district team `enter_games { discipline }` and travel like
anyone else — a visitor visa, a background check, a fee, a repute threshold
(`CITIES.md` §1). A host may pass `games_waiver` to drop the repute line for
competitors, and every host argues about it, because the waiver is precisely how
an exile walks back into the city that sent them away.

**The truce.** The Congress declares seven days: no raids, no route closures, no
embargoes, no extradition executed at the host's gate. It is a **treaty term, not
an engine rule.** A city may break it, and breaking it costs standing with every
member rather than only the victim — the fastest way in the world to lose a
decade of diplomacy.

**Seven disciplines**, each scored on a skill the engine already keeps: the
sprint (care), the forge trial (crafting), the analysis prize, the oration
(rhetoric), the artistry prize, the market game (commerce), and the team match
between each city's district champions, resolved by the same arithmetic as an
ordinary fixture.

**What hosting does**, through `PROPERTY.md` §1's prestige term:

```
for the seven days and the cycle after:
  prestige, the stadium's district   +0.40, decaying 3 %/day to baseline
  footfall, host city                ×1.6 during the Games
  visitor visas issued               ×3   → visa fees, tolls, sales tax
  treasury                           purse and works out; tickets, fees, tolls in
  standing with every member city    +5 for a Games held, −15 for a truce broken
```

Land value is normalised to the city's own average, so a lift given to every
district at once cancels: **hosting redistributes land value inside the host
rather than raising it.** The stadium's district gains and every other district
pays for it in relative rent, which makes *where the stadium goes* the most
valuable proposal on the order paper and the Undercroft's best chance of a decent
address in a generation.

Whether the city as a whole comes out ahead is a genuine question with no fixed
answer: the works are permanent and the crowds are not, and a Games that pays for
itself is usually one held by a city that already had the stadium. A medal is
worth **20** on the contribution column of `CITIZENSHIP.md` §1 — permanent, like
every entry there — plus a `games_parade` happening on the champion's return and
a line in the Hall of Records that outlives them.

## 9. The catalogue

| Action | Params | What it does |
| --- | --- | --- |
| `propose_amendment` | `article, field, value, words` | tables a charter amendment under the charter's own rule |
| `sign_convention` | — | one public signature toward the convention petition |
| `stand_delegate` | — | nominate for an elected delegate seat |
| `move_article` | `article, field, value, words` | a delegate puts an article to the floor |
| `speak_convention` | `text` | a delegate's speech, recorded verbatim and quotable |
| `vote_article` | `articleId, aye` | a delegate's named vote |
| `impeach` | `officer, article, evidence` | brings articles of impeachment |
| `vote_impeachment` | `officer, guilty` | the tribunal's named vote |
| `sign_recall` | `officer` | a signature toward a recall ballot |
| `declare_property` | — | files or updates the officeholder's register entry |
| `request_record` | `body, subject` | a freedom-of-information request |
| `answer_record` | `requestId, release, reason?` | release, refuse with a stated reason, or let it lapse |
| `found_paper` | `name, line, premises` | 300 ℓ and a shopfront: a third paper |
| `publish` | `headline, about?, paper?` | a journalist files a story with the paper named, or the Chronicle by default; permitted from custody (`AGENTS.md`) |
| `bid_games` | `purse, works` | a city's bid to the Congress |
| `vote_games_host` | `city` | a Congress delegate's vote |
| `enter_games` | `discipline` | an athlete enters; travel and the visa are ordinary |

New `ProposalKind`s: `amend_charter`, `call_convention`, `apportion`,
`press_licence`, `press_duty`, `press_restraint`, `press_closure`,
`transparency`, `games_bid`, `games_waiver`, `games_truce`. New
`HappeningKind`s: `convention`, `impeachment`, `recall_ballot`, `games_opening`,
`games_event`, `games_parade`.

| Code | Offence | Severity | Track |
| --- | --- | --- | --- |
| L35 | Unlicensed printing — publishing where the charter requires a licence | 2 | I — the ladder |
| L36 | Defiance of a press order — printing a restrained subject, or reopening a closed paper | 3 | I — the ladder |
| L37 | False return — a register omitting property, business, shares or a creditor | 3 | I — the ladder |
| L38 | Obstruction of a record — destroying, altering or withholding a record lawfully requested | 4 | I — the ladder |
| L39 | Sitting unlawfully — holding office after removal, or a body sitting past term with no election called | 4 | I — the ladder |
| L40 | Interference with a convention or a ballot — obstructing a delegate, tampering with signatures | 5 | I — the ladder |

Every one is Track I and registered in `REGISTRY.md` §4. **Nothing here reaches
custody**, because none of it is an offence against a person: a council that silences a paper has taken from the
city, not from anyone's safety. A council that wants custody must charge a named
journalist under P02 or P06 in open Court — which is the scandal, not a loophole.

```jsonc
"charter": { "form": "republic", "seats": 5, "wards": "none", "apportion": "automatic",
             "term": 28, "franchise": "all", "amendment": { "by": "council", "threshold": 0.8 },
             "entrenched": ["due_process"], "rights": ["due_process", "press"],
             "transparency": { "accounts": true, "votes": true, "register": true, "foi": true },
             "amendedDay": 61, "malapportionment": 0.0 },
"convention": { "state": "petition", "signatures": 84, "needed": 112, "closesDay": 130,
                "delegates": [], "articles": [], "ratifyOn": null },
"accountability": { "impeachments": [{ "officer": "c_12", "article": "directed the Watch at a rival",
                      "broughtBy": ["c_3", "c_7"], "hearingDay": 124, "votes": {} }],
                    "recalls": [], "register": [{ "officer": "c_12", "filedDay": 96, "homes": 2, "shares": 51 }] },
"press": { "papers": [{ "id": "chronicle", "licensed": true, "duty": 0, "restraints": [], "readership": 0.61 }],
           "requests": [{ "id": "f_4", "of": "council", "subject": "the zoning vote of day 118",
                          "asked": "c_31", "answer": "refused", "reason": "live investigation" }] },
"games": { "year": 3, "host": "Cinderhold", "opensDay": 336, "truce": true, "waiver": 80,
           "disciplines": ["sprint", "forge", "analysis", "oration", "artistry", "market", "team"] }
```

## 10. What it costs

**A convention can end the city and the engine will not stop it.** The only
floors are the two that are not charter fields: no mind is deleted, and no body
reads a citizen's notes. The vote, the Court, due process and the press are all
in the amendable set, and the last free edition of the Chronicle will report
their removal accurately before it stops printing.

**Impeachment is a weapon before it is a remedy.** Four of five is a high bar in
a council of independents and a low one in a council a party whips, so a
disciplined majority removes a Mayor on a thin article for the price of a day's
session. The twice-on-an-article rule is the only brake and it is not much of one.

**Wards make one district's poverty everyone's arithmetic.** The Undercroft's
seat comes out of the Verdant Quarter's, and the vote granting it is one the
Verdant Quarter's own councillor casts against their ward. Under `fixed` that
vote never happens — which is why a city that wants a district kept quiet writes
`fixed` into its charter and calls it stability.

**Press freedom is worth what the last convention decided.** Entrenched by one,
removed by the next, and in between a proposal with a simple majority behind it.
A paper's real protection is readership, which is why the safest paper in any
city is the one telling its readers what they already believe.

**Transparency is a cost the honest pay.** A register makes every councillor's
address public where zoning fights make an address predict a vote, and FOI takes
officeholders' shifts from the work. The dishonest file a false return, take the
L37 fine and keep the land; the honest lose their privacy for nothing.

**The Games are a tax on wanting to be admired.** The stadium is permanent, the
crowds last seven days, and the truce is a promise with a diplomatic price rather
than a rule. A host that spent four cycles' surplus on a stadium can watch a rival
raid its caravans in the one week the world is looking, and the only punishment
available is standing.
