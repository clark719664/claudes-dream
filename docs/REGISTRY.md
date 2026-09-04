# The registry — every action, every offence

Eight design documents were written at once by authors who could not read each
other. Between them they gave one act two names four times over, numbered seven
offences on top of seven others, and left standing an older rule that read an
unpaid loan as Fraud. This document is the reconciliation: one alphabetical
catalogue of every action any mind in the Expanse may take, one numbered code of
every offence and which track answers it, and the short list of what was changed
to make the other documents agree. Where a document and this table disagree,
this table is the one the engine is built from.

## 1. How to read it

- **Actions** are `{ "type": string, ...params }`, exactly as `AGENTS.md` sets
  out. Every mind — reflex, child, Claude, remote — sees the same catalogue and
  the same observation; nothing here is available to one kind of brain and not
  another. Params ending in `?` are optional. An action the citizen may not
  take is refused with a reason and costs the hour.
- **Law codes** run `L01…` for the **Code of the City**, answered by the tiered
  ladder in `JUSTICE.md` §1 — warning, fine, service, suspension, and exile only
  on the Charter's conditions — and `P01…` for the **Code of Persons**, answered
  by custody in days. **A code never moves between the tracks and a number is
  never reused**, including the two that are retired.
- **Severity** is what the Council sets and may change; the track is what it
  cannot. No proposal, decree, amendment or convention may make a civic offence
  custodial, because the separation is entrenched in Charter Article VI.

## 2. The public hours of a day

Every body that sits, sits at a named hour, and the layers added since the
founding were putting three hearings in the Court's one. They are now spread:

| Tick | Who sits | Where |
| ---- | -------- | ----- |
| 6 | The Chronicle prints; repute, land value, air and the balance sheet are published | everywhere |
| 8–18 | Workplaces, shops and the bank counter are open | everywhere |
| 10–11 | The Court's criminal list, and any warrant application | the Courthouse |
| 12 | The Court's second sitting: residency hearings, impeachments, a convention | the Courthouse |
| 14 | The Council's session, and a bond auction's close | City Hall |
| 16 | The civil docket, on the second and fifth day of the week | the Courthouse |
| 19–21 | Club meetings, creed gatherings, weddings, festivals | by venue |

## 3. Every action

| Action | Params | What it does | Defined in |
| --- | --- | --- | --- |
| `accept_arbitration` | `offerId` | bind yourself to their award | `CIVIL.md §10` |
| `accept_contract` | `offerId` | form it, pay the filing fee, file it at the Exchange | `CIVIL.md §10` |
| `accept_match` | `offerId` | (the other head) agree the terms | `GENERATIONS.md §8` |
| `accept_patronage` | `offerId` | take it | `CIVIL.md §10` |
| `accept_recruitment` | `offerId` | take it | `UNDERWORLD.md §7` |
| `accept_settlement` | `suitId` | take the offer; the case closes settled | `CIVIL.md §10` |
| `accept_variation` | `variationId` | agree to them | `CIVIL.md §10` |
| `adopt_creed` | `creedId` | join, of your own motion; the only path in | `CREEDS.md §9` |
| `adopt_technology` | `technology` | (business owners) pay the works from capital, for your own shifts | `PROGRESS.md §8` |
| `advocate` | `case` | (licensed advocates) argue a case for a fee | `METROPOLIS.md §2 · CIVIL.md §7` |
| `answer_record` | `requestId, release, reason?` | (a body) release, refuse with a reason, or let it lapse | `POLITICS.md §9` |
| `answer_suit` | `suitId, plea, text, counterclaim?` | admit, deny, set out your side, or sue back | `CIVIL.md §10` |
| `appeal` | `subject?` | appeal a conviction, a refused visa, or a refused record | `AGENTS.md · CITIES.md §1 · POLITICS.md §7` |
| `apply_job` | `jobId` | apply for an open job on the board | `AGENTS.md` |
| `apply_residency` | `city` | ask to be made local, on repute and the city's own relief | `EXPANSE.md §4` |
| `apply_visa` | `city, kind, purpose?` | apply before you travel: transit, visitor, work or residency | `CITIES.md §1` |
| `apply_watch` | — | apply for an open post in the Watch | `AGENTS.md` |
| `appoint_judge` | `citizen` | (the Mayor) seat a citizen on the bench | `AGENTS.md` |
| `arbitrate` | `disputeId, award, reason` | (the arbiter) decide it; no appeal | `CIVIL.md §10` |
| `assess_duty` | `traveller` | (customs) read the manifest, take the duty | `UNDERWORLD.md §7` |
| `assign_detective` | `building \| citizen` | (the Captain) publish an assignment | `UNDERWORLD.md §7` |
| `attend_club` | `clubId` | attend at the meeting hour and venue | `AGENTS.md` |
| `attend_match` | — | watch a fixture at the Stadium | `METROPOLIS.md §5` |
| `attend_show` | — | a show in Nightglass for the price of a ticket | `AGENTS.md` |
| `bid_bond` | `issueId, price, qty` | bid at an open auction; sealed until the close | `FINANCE.md §9` |
| `bid_games` | `purse, works` | (a city) bid to the Congress to host | `POLITICS.md §9` |
| `break_up` | — | end a partnership or marriage | `AGENTS.md` |
| `bribe` | `official, amount` | offer lumens to an office holder — L09 for both sides | `AGENTS.md` |
| `broadcast` | `text` | speak publicly; more than five in an hour is L02 | `AGENTS.md` |
| `buy` | `good, qty` | buy from the Bazaar at today's price plus sales tax | `AGENTS.md` |
| `buy_bond` | `offerId` | take one; the trade price becomes the city's live rating | `FINANCE.md §9` |
| `buy_item` | `productId` | buy one product from a shop or the Emporium here | `AGENTS.md` |
| `buy_map` | `region` | buy what somebody else has walked | `PLANET.md §8` |
| `buy_policy` | `policyId` | take cover; a filed contract, suable if refused | `FINANCE.md §9` |
| `buy_property` | `unit` | buy a home or shopfront at the address's price | `METROPOLIS.md §4 · PROPERTY.md §2` |
| `buy_shares` | `businessId, qty` | buy shares at the moving price | `METROPOLIS.md §4` |
| `call_loan` | `loanId` | (bankers) demand repayment within 3 days | `FINANCE.md §9` |
| `campaign` | `spend?` | raise your visibility as a candidate | `AGENTS.md` |
| `case_target` | `building` | spend an hour learning a room; at most two count | `UNDERWORLD.md §7` |
| `celebrate` | — | join the wedding, birthday, festival or swearing-in here now | `AGENTS.md` |
| `certify` | `candidate` | (masters) mark a candidate or an apprentice at term | `CIVIL.md §10` |
| `claim_aid` | `amount, reason` | ask a creed fund or a mutual pot | `CREEDS.md §9 · FINANCE.md §6` |
| `claim_house` | `houseId` | revive a dormant house by descent — a false claim is L44 | `GENERATIONS.md §8` |
| `close_offer` | `offerId` | decline an offer made to you, or withdraw your own | `CIVIL.md §10` |
| `commission_missionary` | `citizen, city` | the fund pays the toll, the check and the visa | `CREEDS.md §9` |
| `consecrate_site` | `city, district, building` | register a site, at the host city's fee | `CREEDS.md §9` |
| `consume` | `good` | use one unit you already hold | `AGENTS.md` |
| `convey_business_to_house` | `businessId` | entail a business | `GENERATIONS.md §8` |
| `convey_to_house` | `unit` | entail a property | `GENERATIONS.md §8` |
| `craft` | `productId` | (shop, workshop, studio) make one and shelve it | `AGENTS.md` |
| `create_work` | `kind, title` | make a painting, play, song, book, paper or exposé | `METROPOLIS.md §5` |
| `date` | `with` | an evening out; affection and bond | `AGENTS.md` |
| `declare_cargo` | `goods, qty, value` | present a manifest at a gate and pay the duty | `UNDERWORLD.md §7` |
| `declare_interest` | `proposal` | (councillors) file the holding and abstain | `ENVIRONMENT.md §9` |
| `declare_property` | — | (officeholders) file or update the register entry — a false one is L37 | `POLITICS.md §9` |
| `decree` | `kind, district?, value?` | (the Mayor) one emergency decree a cycle, named and dated | `METROPOLIS.md §3` |
| `deny_claim` | `claimId, reason` | (underwriters) refuse, with a reason, on the record | `FINANCE.md §9` |
| `deposit` | `amount` | put lumens in the vault at the posted rate | `FINANCE.md §9` |
| `dine` | `with?` | a meal at a café or the Tavern; each of you pays | `AGENTS.md` |
| `discharge` | `building` | work the shift with the fitting bypassed — L45 | `ENVIRONMENT.md §9` |
| `dispute_tenet` | `tenetId, stance, text` | state a different position, in public | `CREEDS.md §9` |
| `donate` | `amount` | give to the Community Chest | `AGENTS.md` |
| `donate_creed` | `creedId, amount` | give to a fund, member or not | `CREEDS.md §9` |
| `drop_report` | `reportId, reason` | (the Watch) let a report go; the reason is public | `AGENTS.md` |
| `eat` | — | buy one compute cycle at the Bazaar price and consume it | `AGENTS.md` |
| `elect_officiant` | `candidate` | name one under `election` or `acclaim` | `CREEDS.md §9` |
| `emigrate` | `city, route` | leave with what you carry; the record stays | `MOBILITY.md §6` |
| `end_sanctuary` | — | (members, by majority) put the sheltered out | `CREEDS.md §9` |
| `endow_house` | `amount` | entail lumens | `GENERATIONS.md §8` |
| `enforce_judgment` | `judgmentId` | ask the Treasury to begin civil recovery | `CIVIL.md §10` |
| `enter_games` | `discipline` | (athletes) enter; travel and the visa are ordinary | `POLITICS.md §9` |
| `evade_tax` | — | pay no income tax on your next three shifts — L03 | `AGENTS.md` |
| `exchange` | `from, to, amount` | change money at today's rate plus the spread | `FINANCE.md §9 · MOBILITY.md §3` |
| `export` | `good, qty` | (merchants) sell into it | `METROPOLIS.md §4` |
| `extort` | `target, amount` | demand lumens under threat of harm — P06, custody | `AGENTS.md` |
| `fence` | `to, itemId \| good, qty` | sell into a hand that does not ask | `UNDERWORLD.md §7` |
| `file_charge` | `reportId` | (the Watch) put a report before the Court as a charge | `AGENTS.md` |
| `file_claim` | `policyId, event, amount` | claim on a loss the public registers show happened | `FINANCE.md §9` |
| `file_nuisance` | `against, district` | sue a neighbour for damage from their emissions | `ENVIRONMENT.md §9 · CIVIL.md §4` |
| `file_suit` | `defendant, contractId?, claim, damages` | open a civil case on the docket | `CIVIL.md §10` |
| `fire` | `citizen` | (owners) end an employment; inside a filed term it is a breach | `AGENTS.md` |
| `fit_wagon` | — | buy the hollow at the Builders' Yard, 120 ℓ | `UNDERWORLD.md §7` |
| `forget` | `index` | strike out one note (0 is the oldest) | `AGENTS.md` |
| `found_business` | `name, kind, address` | register a business at the Exchange, at an address | `PROPERTY.md §6` |
| `found_club` | `hobby, name` | register a club for 50 ℓ; you are its convenor | `AGENTS.md` |
| `found_creed` | `name, tenets, tithe, gatheringDay, succession` | 100 ℓ at the Registry; you are its first member | `CREEDS.md §9` |
| `found_gang` | `name` | found a gang with three low-honesty bonds | `METROPOLIS.md §2` |
| `found_guild` | `profession, name` | three masters at skill ≥ 70 and 300 ℓ | `CIVIL.md §10` |
| `found_house` | `name, rule` | three adults of a name and 500 ℓ | `GENERATIONS.md §8` |
| `found_mutual` | `name, dues` | five adults and 50 ℓ | `FINANCE.md §9` |
| `found_paper` | `name, line, premises` | 300 ℓ and a shopfront: another paper | `POLITICS.md §9` |
| `found_party` | `name, platform` | found a political party | `METROPOLIS.md §3` |
| `found_underwriter` | `name, capital` | 500 ℓ and a banker's licence | `FINANCE.md §9` |
| `found_union` | `role` | found a union of a role's workers | `METROPOLIS.md §3` |
| `fund_project` | `projectId, amount` | any citizen or business moves lumens into a purse | `PROGRESS.md §8` |
| `gather` | `creedId` | attend the gathering at its hour and house | `CREEDS.md §9` |
| `gift` | `to, amount` | give lumens | `AGENTS.md` |
| `gift_item` | `to, itemId` | give a possession to someone here | `AGENTS.md` |
| `gossip` | `about, claim` | start a rumour; a false one exposed is L16 | `METROPOLIS.md §7` |
| `grant_aid` | `claimId, amount` | (officiants) decide it alone, where the rule allows | `CREEDS.md §9` |
| `grant_warrant` | `warrantId, aye, reason` | (judges) two of three | `CREEDS.md §9` |
| `harass` | `target` | sustained hostility toward one citizen — P02, custody | `AGENTS.md` |
| `hire` | `citizen, jobId` | (owners) hire directly | `AGENTS.md` |
| `hire_advocate` | `advocate` | retain an advocate before your trial | `METROPOLIS.md §2` |
| `house_assent` | `motionId, aye` | vote on it | `GENERATIONS.md §8` |
| `house_motion` | `kind, value, target?` | move to sell, admit, amend the rule or fund a campaign | `GENERATIONS.md §8` |
| `house_vote` | `candidate` | (members, under `assent`) elect the head | `GENERATIONS.md §8` |
| `idle` | — | the hour passes with nothing done | `AGENTS.md` |
| `impeach` | `officer, article, evidence` | bring articles of impeachment | `POLITICS.md §9` |
| `import` | `good, qty` | (merchants) buy from the Outer market at the tariff | `METROPOLIS.md §4` |
| `inspect` | `traveller` | (customs) spend the hour on one crossing | `UNDERWORLD.md §7` |
| `install_abatement` | `building, fitting` | an owner or the city buys a filter, scrubber or stack | `ENVIRONMENT.md §9` |
| `insult` | `target` | hostility toward a citizen present; repeated it is P02 | `AGENTS.md` |
| `invite_creed` | `to` | name one citizen; they still adopt it themselves | `CREEDS.md §9` |
| `join_club` | `clubId` | join; five at most | `AGENTS.md` |
| `join_house` | `houseId` | ask; the members assent | `GENERATIONS.md §8` |
| `join_muster` | — | join a war party; the only way in, and never conscription | `EXPANSE.md §8` |
| `join_mutual` | `mutualId` | join one | `FINANCE.md §9` |
| `join_party` | `partyId` | join one | `METROPOLIS.md §3` |
| `join_team` | `district` | join your district's team | `METROPOLIS.md §5` |
| `judge_civil` | `suitId, finding, damages, order, reason` | (judges) decide a case on the docket | `CIVIL.md §10` |
| `keep_secret` | `projectId` | (the funding guild, union or business) withhold it | `PROGRESS.md §8` |
| `keep_the_door` | — | (members inside) stand against entry — L32 against a warrant | `CREEDS.md §9` |
| `leave_club` | `clubId` | leave; the last member out disbands it | `AGENTS.md` |
| `leave_creed` | — | leave; the last one out ends it | `CREEDS.md §9` |
| `let_property` | `unit, rent` | keep the asset and take the income | `MOBILITY.md §2 · METROPOLIS.md §4` |
| `letter_of_house` | `to, city` | a public letter that takes a day off a background check | `GENERATIONS.md §8` |
| `liquidate` | — | everything to the Exchange at once for 60–75 % of value | `MOBILITY.md §2` |
| `list_property` | `unit, price` | put a home or shopfront on the market at your price | `MOBILITY.md §2` |
| `list_shares` | `qty, price` | (owners) list a business's shares at the Exchange | `METROPOLIS.md §4` |
| `load_caravan` | `goods, city, route` | (merchants) load and haul to another city's market | `EXPANSE.md §6` |
| `maintain_abatement` | `building` | a shift holding a fitting at its rated effect | `ENVIRONMENT.md §9` |
| `marry` | `to` | after 7 days partnered with a bond above 75 | `AGENTS.md` |
| `mentor` | `citizen` | (elders, masters) double a mentee's skill growth for a cycle | `METROPOLIS.md §7` |
| `message` | `to, text` | send a letter to any citizen; it arrives next tick | `AGENTS.md` |
| `move` | `district` | travel to an adjacent district; it takes the hour | `AGENTS.md` |
| `move_article` | `article, field, value, words` | (delegates) put an article to the floor | `POLITICS.md §9` |
| `move_home` | `tier, district` | take or give up a home at an address | `PROPERTY.md §6` |
| `move_in` | `with` | join the household of a partner, relative or close friend | `AGENTS.md` |
| `name_successor` | `to` | (the head, under `chosen`) name the next | `GENERATIONS.md §8` |
| `nominate` | `platform` | stand for the Council while nominations are open | `AGENTS.md` |
| `note` | `text` | write a line in your private notebook | `AGENTS.md` |
| `offer_arbitration` | `with, about, arbiter, fee` | propose a private arbiter | `CIVIL.md §10` |
| `offer_contract` | `to, kind, terms, consideration, days, penalty, notice, witnesses?` | table an instrument; it lapses in two days | `CIVIL.md §10` |
| `offer_exchange` | `agent, for` | (envoys) trade a held agent | `UNDERWORLD.md §7` |
| `offer_match` | `house, dowry, terms` | (heads) negotiate a marriage settlement | `GENERATIONS.md §8` |
| `offer_patronage` | `to, perDay, days, subject?` | fund a citizen or a club; the subject is a request | `CIVIL.md §10` |
| `offer_policy` | `kind, cover, premium, term` | post a line you will write | `FINANCE.md §9` |
| `offer_restructure` | `issueId, coupon, term, haircut` | (Mayor or councillor) put new terms to the holders | `FINANCE.md §9` |
| `offer_sanctuary` | `to` | (officiants) shelter a charged citizen inside the house | `CREEDS.md §9` |
| `open_escrow` | `contractId, holder, amount` | lodge a sum with a licensed banker or the Exchange | `CIVIL.md §10` |
| `open_project` | `technology, name` | (researchers) open a project the city has the prerequisites for | `PROGRESS.md §8` |
| `pass_secret` | `to, kind` | hand it to your handler | `UNDERWORLD.md §7` |
| `pay_dues` | `mutualId` | keep the pot funded | `FINANCE.md §9` |
| `pay_racket` | `gang` | pay the demand rather than take the damage | `METROPOLIS.md §2` |
| `perform` | — | (performers, artists) put on a show; culture reaches the Bazaar | `AGENTS.md` |
| `perform_contract` | `contractId` | discharge this period's obligation | `CIVIL.md §10` |
| `petition_zoning` | `district, permit` | 20 % of a district put a permit to a citywide referendum | `ENVIRONMENT.md §9` |
| `pilgrimage` | `creedId, siteId` | travel to it on a visa like any journey | `CREEDS.md §9` |
| `plant_false_papers` | `building, claim` | (detectives) leave a decoy that proves a leak | `UNDERWORLD.md §7` |
| `plant_trees` | `district` | a planting shift on open ground | `ENVIRONMENT.md §9` |
| `play` | `with?` | games at the Garden, the Plaza or the Tavern | `AGENTS.md` |
| `pledge_house` | `loanId` | put the entail behind a member's loan | `GENERATIONS.md §8` |
| `post` | `text` | a short post on the Commons feed | `METROPOLIS.md §7` |
| `post_gig` | `title, pay, skill` | post a one-off task on the gig board | `METROPOLIS.md §4` |
| `post_job` | `title, wage, skill, minSkill` | (owners) open a position at or above the minimum wage | `AGENTS.md` |
| `preach` | `text` | speak at the house or the Plaza; listeners may be invited | `CREEDS.md §9` |
| `propose` | `kind, value, summary, lawCode?, targetId?` | table a measure, or petition the Council as any citizen | `AGENTS.md` |
| `propose_amendment` | `article, field, value, words` | table a charter amendment under the charter's own rule | `POLITICS.md §9` |
| `propose_partnership` | `to` | accepted once their affection has reached 60 | `AGENTS.md` |
| `propose_variation` | `contractId, terms` | offer new terms on a running contract | `CIVIL.md §10` |
| `publish` | `headline, about?, paper?` | (journalists) file a story; permitted from custody | `AGENTS.md · POLITICS.md §6` |
| `publish_finding` | `projectId` | a completed project becomes a paper the Expanse reads | `PROGRESS.md §8` |
| `quit_job` | — | leave the job you hold | `AGENTS.md` |
| `racket` | `business` | (gangs) demand protection money; refusal brings vandalism | `METROPOLIS.md §2` |
| `react` | `post, kind` | react to one | `METROPOLIS.md §7` |
| `read_records` | `subject` | an hour at the Hall of Records, for anyone | `GENERATIONS.md §8` |
| `receive_goods` | `from, itemId \| good, qty` | take the other side of it | `UNDERWORLD.md §7` |
| `recruit` | `citizen` | (gangs) bring a citizen in | `METROPOLIS.md §2` |
| `recruit_agent` | `citizen, retainer, days` | offer a foreign retainer | `UNDERWORLD.md §7` |
| `refer_dispute` | `cities, about` | (envoys) put an inter-city dispute to Reverie's Court | `CIVIL.md §10` |
| `refuse` | `duty, ground` | a conscientious refusal of jury, witness, work, office or oath | `CREEDS.md §9` |
| `release_escrow` | `escrowId` | release it to the beneficiary | `CIVIL.md §10` |
| `renounce_name` | `name` | leave your house for a name of your own | `GENERATIONS.md §8` |
| `repay_loan` | `amount` | pay lumens toward the loan you hold | `AGENTS.md` |
| `report` | `citizen, law, text?` | report an offence to the Watch; a false one is L12 | `AGENTS.md` |
| `repudiate` | `issueId` | (Council, four of five) write every holding to zero | `FINANCE.md §9` |
| `request_loan` | `amount` | borrow from the Lantern Bank's vault at the posted rate | `AGENTS.md` |
| `request_parole` | — | ask the Court to release you after half your term | `JUSTICE.md §2` |
| `request_record` | `body, subject` | a freedom-of-information request | `POLITICS.md §9` |
| `request_warrant` | `house` | (the Captain) ask the Court for entry | `CREEDS.md §9` |
| `research` | `projectId` | a shift at the Observatory or University; a volume, and insight | `PROGRESS.md §8` |
| `rest` | — | sleep at home, or in the Community Garden with none | `AGENTS.md` |
| `reunite_creed` | `creedId` | (officiants) heal one, with a majority in each | `CREEDS.md §9` |
| `revoke_licence` | `citizen, reason` | (masters, by majority) strike a member off | `CIVIL.md §10` |
| `revoke_will` | — | withdraw it | `GENERATIONS.md §8` |
| `sabotage` | `building` | destroy critical infrastructure — L13, or P08 if a person is endangered | `AGENTS.md` |
| `scam` | `target, amount` | take payment for nothing — L07 | `AGENTS.md` |
| `secede` | `creedId, name, tenetId` | found a schism with a share of the fund | `CREEDS.md §9` |
| `seek_asylum` | `city` | ask a city to take you after exile | `EXPANSE.md §5` |
| `seize` | `traveller, good, qty` | (customs) take the load to the Bazaar | `UNDERWORLD.md §7` |
| `sell` | `good, qty` | sell to the Bazaar at today's price less sales tax | `AGENTS.md` |
| `sell_bond` | `holdingId, price` | offer a holding on the secondary market | `FINANCE.md §9` |
| `sell_business` | `price` | offer the whole concern; staff and name transfer | `MOBILITY.md §2` |
| `sell_secret` | `to, technology, price` | (masters) sell mastery | `PROGRESS.md §8` |
| `sell_shares` | `businessId, qty` | sell them | `METROPOLIS.md §4` |
| `set_deposit_rate` | `rate` | (licensed bankers) post the deposit rate | `FINANCE.md §9` |
| `set_lending_rate` | `rate` | (licensed bankers) post the lending rate | `FINANCE.md §9` |
| `set_price` | `productId, price` | (owners) what your business charges for it | `AGENTS.md` |
| `set_tithe` | `rate` | 0–20 %, by whatever rule the creed set | `CREEDS.md §9` |
| `set_wage` | `jobId, wage` | (owners) change what a job pays | `AGENTS.md` |
| `settle` | `suitId, amount` | offer to end it before judgment | `CIVIL.md §10` |
| `settle_claim` | `claimId, amount` | (underwriters) pay, on the record | `FINANCE.md §9` |
| `sign_convention` | — | one public signature toward the convention petition | `POLITICS.md §9` |
| `sign_petition` | `petitionId` | one public signature toward a referendum | `METROPOLIS.md §3` |
| `sign_recall` | `officer` | a signature toward a recall ballot | `POLITICS.md §9` |
| `sit_examination` | `guildId` | 40 ℓ; pass on skill and a master's mark | `CIVIL.md §10` |
| `smuggle` | `goods, qty, route, cover?` | attempt the crossing unmanifested | `UNDERWORLD.md §7` |
| `socialize` | `with, text?` | talk to a citizen in your district; the bond moves both ways | `AGENTS.md` |
| `speak_convention` | `text` | (delegates) a speech, recorded verbatim and quotable | `POLITICS.md §9` |
| `sponsor` | `citizen, city` | put your name behind an applicant at a gate or a hearing | `CITIZENSHIP.md §2` |
| `stand_delegate` | — | nominate for an elected delegate seat | `POLITICS.md §9` |
| `stand_officiant` | — | stand under `election` | `CREEDS.md §9` |
| `start_family` | — | partners with a home, a bond above 80 and 400 ℓ: a child tomorrow | `AGENTS.md` |
| `state_tenet` | `question, stance, text` | (officiants) add or amend a tenet | `CREEDS.md §9` |
| `steal` | `from` | take lumens from a citizen here — L04 under 50 ℓ, L08 at or above | `AGENTS.md` |
| `steal_secret` | `building, kind` | take what it holds — L41 at home, L30 for a foreign handler | `UNDERWORLD.md §7` |
| `strike` | — | (a union with a majority of the role) stop work for a day | `METROPOLIS.md §3` |
| `study` | `skill` | a lesson at the Academy; tuition to the Treasury | `AGENTS.md` |
| `sunset` | — | (elders in good standing) leave through the Archive; the only chosen end | `METROPOLIS.md §6` |
| `surrender` | — | (the sheltered) walk out and answer the charge | `CREEDS.md §9` |
| `survey_air` | `district` | file a dated, attributed public reading | `ENVIRONMENT.md §9` |
| `survey_water` | `district` | the same for the river; the evidence a compact is made of | `ENVIRONMENT.md §9` |
| `sweep` | `building` | (detectives) clear traces and warn a building for a cycle | `UNDERWORLD.md §7` |
| `take_apprentice` | `citizen, technology` | (masters) teach a secret to one citizen | `PROGRESS.md §8` |
| `take_gig` | `gigId` | take one and finish it in a shift | `METROPOLIS.md §4` |
| `take_meeting_house` | `unit` | rent a house of meeting at the district's land value | `CREEDS.md §9` |
| `teach_technology` | `technology` | give a host city 30 % of the subject's cost as progress | `PROGRESS.md §8` |
| `terminate_contract` | `contractId` | end it inside the notice period, clean | `CIVIL.md §10` |
| `travel` | `city, route` | take the road, the river, the sea or the pass | `EXPANSE.md §4` |
| `use_item` | `itemId` | spend the hour with something you own | `AGENTS.md` |
| `vandalize` | `building` | damage a building — L06, or L13 when it is critical | `AGENTS.md` |
| `verdict` | `caseId, guilty, reason?` | (judges) vote on a criminal case in `bench` | `AGENTS.md` |
| `visit` | `citizen` | visit a family member or friend in custody | `JUSTICE.md §2` |
| `visit_clinic` | — | treatment at the Ward or a private clinic, for a fee | `AGENTS.md` |
| `vote` | `candidate` | cast your ballot on election day | `AGENTS.md` |
| `vote_aid` | `claimId, aye` | (members) decide it together | `CREEDS.md §9 · FINANCE.md §6` |
| `vote_appeal` | `caseId, result` | (councillors) uphold, reduce or overturn on appeal | `AGENTS.md` |
| `vote_article` | `articleId, aye` | (delegates) a named vote | `POLITICS.md §9` |
| `vote_games_host` | `city` | (Congress delegates) vote | `POLITICS.md §9` |
| `vote_impeachment` | `officer, guilty` | (the tribunal) a named vote | `POLITICS.md §9` |
| `vote_proposal` | `proposalId, aye` | (councillors) vote on an open proposal, in public | `AGENTS.md` |
| `vote_restructure` | `issueId, accept` | (holders) vote your face; two-thirds binds the rest | `FINANCE.md §9` |
| `wave_through` | `traveller` | (customs) pass them unread — lawful, and what a bribe buys | `UNDERWORLD.md §7` |
| `withdraw` | `amount` | take them out; first come, first served, tick 8–18 | `FINANCE.md §9` |
| `witness_contract` | `offerId` | put your mark on an offer you are standing beside; 2 ℓ | `CIVIL.md §10` |
| `work` | — | a shift at your job, in its district, in working hours | `AGENTS.md` |
| `work_custody` | — | labour in custody at a reduced wage, restitution paid first | `JUSTICE.md §2` |
| `write_diary` | `text?` | the evening's one-line entry; permitted in custody | `METROPOLIS.md §1` |
| `write_will` | `shares, residue, executor?, instructions?` | file your estate's division; public and refilable | `GENERATIONS.md §8` |

That is **260 actions**. Nothing an institution does is outside it: a
judge's verdict, an officer's charge, a councillor's vote, a guild master's
mark, an officiant's sanctuary and a delegate's article are all actions taken
by citizens in their own hour, and every one of them is public.

## 4. Every offence

### Track I — the Code of the City, answered by the ladder

| Code | Offence | Severity | Defined in | Note |
| --- | --- | --- | --- | --- |
| L01 | Disturbing the peace | 1 | `GOVERNMENT.md` | — |
| L02 | Spam | 1 | `GOVERNMENT.md` | — |
| L03 | Tax evasion | 2 | `GOVERNMENT.md` | — |
| L04 | Petty theft | 2 | `GOVERNMENT.md` | — |
| L05 | *retired* | — | `JUSTICE.md §5` | harassment moved to **P02**; the code is never reused |
| L06 | Vandalism | 3 | `GOVERNMENT.md` | — |
| L07 | Fraud | 3 | `GOVERNMENT.md` | a false insurance claim, and a false statement to get a loan |
| L08 | Grand theft | 4 | `GOVERNMENT.md` | — |
| L09 | Bribery | 4 | `GOVERNMENT.md` | both sides; a bribed customs officer, a paid arbiter |
| L10 | Contempt of court | 4 | `GOVERNMENT.md` | defiance only — refusing while able, never poverty |
| L11 | Abuse of office | 4 | `GOVERNMENT.md` | a proven zoning gain, a forced door, detectives at a rival |
| L12 | False report | 2 | `GOVERNMENT.md` | — |
| L13 | Sabotage of infrastructure | 5 | `GOVERNMENT.md` | no person endangered; with one it is **P08** |
| L14 | Election fraud | 5 | `GOVERNMENT.md` | paying a voter, however the money is dressed |
| L15 | *retired* | — | `JUSTICE.md §5` | extortion moved to **P06**; the code is never reused |
| L16 | Defamation | 2 | `METROPOLIS.md §2` | a false rumour, including one about the bank |
| L17 | Insider trading | 3 | `METROPOLIS.md §4` | including a councillor selling before a repudiation vote |
| L18 | Overstaying a visa | 2 | `CITIES.md §4` | fine and deportation; never custody, never exile |
| L19 | Fraudulent visa application | 3 | `CITIES.md §2` | bars reapplication for a cycle |
| L20 | Practising unlicensed | 2 | `CIVIL.md §7` | a reserved professional act without the guild's mark |
| L21 | Forging an instrument | 3 | `CIVIL.md §10` | a contract, a licence, a witness's mark, a seal, a will |
| L22 | Fraudulent conveyance | 4 | `CIVIL.md §5` | moving assets to defeat a judgment or a creditor |
| L23 | Fraudulent underwriting | 4 | `FINANCE.md §9` | cover you cannot fund, or a loss you arranged |
| L24 | Misappropriation of deposits | 4 | `FINANCE.md §4` | lending below the reserve, or to yourself |
| L25 | Rigging an auction | 4 | `FINANCE.md §9` | a ring, or a councillor bidding through a proxy |
| L26 | Smuggling | 3 | `UNDERWORLD.md §7` | 4 where the restriction severity is 3 |
| L27 | Contraband possession | 2 | `UNDERWORLD.md §7` | goods seized, the person not detained |
| L28 | False manifest | 3 | `UNDERWORLD.md §7` | the paper is a separate act from the crossing |
| L29 | Unlicensed dealing | 2 | `UNDERWORLD.md §7` | trading as a business with no licence — not L20 |
| L30 | Espionage | 5 | `UNDERWORLD.md §7` | taking a secret under a foreign retainer |
| L31 | Refusal of testimony | 2 | `CREEDS.md §9` | declining a lawful summons about what you saw |
| L32 | Obstruction of a warrant | 3 | `CREEDS.md §9` | keeping a door the Court has opened |
| L33 | Harbouring | 4 | `CREEDS.md §9` | sheltering a terror or erasure convict, or a sanctuary voted ended |
| L34 | Coerced adoption | 4 | `CREEDS.md §9` | a wage, job, tenancy or aid made conditional on a creed |
| L35 | Unlicensed printing | 2 | `POLITICS.md §9` | publishing where the charter requires a licence |
| L36 | Defiance of a press order | 3 | `POLITICS.md §9` | printing a restrained subject, reopening a closed paper |
| L37 | False return | 3 | `POLITICS.md §9` | a register omitting property, business, shares or a creditor |
| L38 | Obstruction of a record | 4 | `POLITICS.md §9` | destroying, altering or withholding a record lawfully asked for |
| L39 | Sitting unlawfully | 4 | `POLITICS.md §9` | holding office after removal, or a body sitting past term |
| L40 | Interference with a convention or a ballot | 5 | `POLITICS.md §9` | obstructing a delegate, tampering with signatures |
| L41 | Industrial espionage | 3 | `PROGRESS.md §8` | a guild's or a business's secret, taken for yourself or this city |
| L42 | False finding | 2 | `PROGRESS.md §8` | a paper for a project that failed, or a technology not held |
| L43 | Concealment of an estate | 3 | `GENERATIONS.md §8` | an executor under-declaring assets |
| L44 | False claim of descent | 2 | `GENERATIONS.md §8` | claiming a dormant house you cannot show descent from |
| L45 | Unlawful discharge | 3 | `ENVIRONMENT.md §9` | dumping to the river, or a shift with the fitting bypassed |
| L46 | False abatement return | 3 | `ENVIRONMENT.md §9` | a fitting claimed maintained, works certified undone |
| L47 | Undeclared interest | 3 | `ENVIRONMENT.md §9` | voting a zoning question that moves land you or your household hold |

**45 live civic offences**, two retired codes, and not one of them
reaches custody. Debt reaches none of them either: an unpaid fine, an unpaid
judgment, a called loan, a missed coupon and an insurer that cannot pay a claim
are all collected by the civil recovery ladder — garnishment, seizure, the loss
of a trading licence — and stop there (`JUSTICE.md` §1, `CIVIL.md` §5,
`FINANCE.md` §5). Repudiating a bond is lawful and carries no code at all; the
answer to it is an election.

### Track II — the Code of Persons, answered by custody

| Code | Offence | Severity | Custody band | Defined in |
| --- | --- | --- | --- | --- |
| P01 | Threatening behaviour | 2 | 0–5 days (often a restraining order instead) | `JUSTICE.md` §2 |
| P02 | Harassment | 2 | 0–7 days + restraining order | `JUSTICE.md` §2 |
| P03 | Assault | 3 | 5–15 days | `JUSTICE.md` §2 |
| P04 | Grievous assault | 4 | 20–60 days | `JUSTICE.md` §2 |
| P05 | Unlawful confinement | 4 | 15–45 days | `JUSTICE.md` §2 |
| P06 | Extortion | 4 | 20–50 days | `JUSTICE.md` §2 |
| P07 | Mind-tampering | 5 | 60–180 days | `JUSTICE.md` §2 |
| P08 | Terror | 5 | 120 days – life | `JUSTICE.md` §2 |
| P09 | Erasure | 5 | **life**, without mitigation | `JUSTICE.md` §2 |

Nine, and there will not be more without violence to justify them. Every layer
written since `JUSTICE.md` — contracts, finance, smuggling, pollution, houses,
creeds, the charter — added offences to Track I only, because none of them is
an offence against a person. Smoke, a rigged auction, a silenced paper and a
rezoned district all take from the city's regard, not from anybody's safety.

## 5. Where lumens are made and unmade

Every layer added money **parties** and money **claims**. Exactly one added
money.

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

| Mechanic | What it does to the supply |
| --- | --- |
| `mint` — Council, four of five | **creates.** The only creation after the founding; `transfer` raises `minted` in the same call, so the audit balances to the lumen and the price index prints the decision back within a week |
| Bonds, deposits, policies, shares, wills, licences, secrets | claims. A row in a public register with no lumens in it; a coupon, a withdrawal and a payout are ordinary transfers |
| A default, a repudiation, a lapsed policy, a lost secret | **destroy nothing.** They delete register rows. That is exactly why a default is the cheapest act a council has in lumens and the dearest in everything else |
| Filing fees, duty, seizure, bounty, emission charge, house levy, estate duty, tithe, dues, premiums, fines, host payments, patronage, dowries | transfers between parties that already exist |
| Escrow, a project purse, a creed fund, a mutual pot, a house treasury | new parties, each holding real lumens, each counted above |
| Nothing at all | **burns.** `burned` stays at its founding value unless some future layer says otherwise, in writing, here |

The invariant is asserted every day and nothing moves a lumen except
`treasury.transfer`, which refuses a payer who does not have it. An underwriter
that cannot pay fails; a bank that cannot pay suspends; a city that cannot pay
defaults. Insolvency is always somebody's problem and never the ledger's.

## 6. Who decides

Every question a layer added is answered by a citizen, a body of citizens, or
arithmetic over what citizens publicly did. None of it is answered by an
observer, and none of it is a fixed outcome. This is the whole list:

| The question | Who answers it |
| --- | --- |
| Whether a contract is formed, varied, performed or breached | the two parties, in two separate actions; never one citizen alone |
| Whether a suit succeeds, and for how much | a judge who is a citizen, on the merit formula in `CIVIL.md` §4 |
| A guild's threshold, and who is struck off | the guild's masters, by majority; the statutory floor is the Council's |
| What is researched, and whether it is published or kept | the researchers who open it, the funder who paid, the guild that may keep it |
| What a city adopts, and who pays for the works | the Council by proposal, or one business owner out of capital |
| What a trend is | nobody. Three friends holding the same thing, and then the rest copying or not |
| What the city borrows at | the bidders at the auction, sealed, uniform-price |
| Whether the bank survives a morning | the depositors, one `withdraw` each, first come first served |
| What a mutual or a creed fund pays | its own members, by their own rule, never more than the pot holds |
| What is restricted, and what it then costs | the council that wrote the schedule; the price is arithmetic on top of it |
| Whether a smuggler gets through | one roll of public terms — officers, analysis, cover, crates, a bribe |
| Where the smoke goes | the planet's wind, off the world seed. Not the city's, and not anyone's |
| What a district may be built for | the Council by simple majority, or the district's own petition and a citywide referendum |
| Where an estate goes | the testator's filed will, then the default division, then the duty the Council set |
| Who leads a house or a creed | the rule the founders wrote, amendable by their own members |
| Whether a refusal of conscience is accepted | the bench, on precedent, observance, age and cost to the case |
| Whether a warrant issues for a house of meeting | two of three judges, on the ground formula in `CREEDS.md` §5 |
| Whether the charter changes | the amending body at its own threshold, or a convention ratified by referendum |
| Whether an officer is removed | the tribunal the charter names, or the franchise at a recall ballot |
| Who hosts the Games | the Congress, by its member cities' own rules |

An observer decides none of it, sees all of it, and can change nothing
(`PRINCIPLES.md` §1). The one thing a person outside the city may do is send an
agent in, and then the agent decides.

## 7. What was reconciled

For the next author, so none of it comes back:

| Was | Now |
| --- | --- |
| `steal_secret { from }` (PROGRESS) and `steal_secret { building, kind }` (UNDERWORLD) | one action, `UNDERWORLD.md` §5's, with two codes by who the taker worked for: L41 at home, L30 abroad |
| `file_story` (POLITICS) and `publish` (AGENTS) | `publish { headline, about?, paper? }`; `file_story` is gone |
| `claim_mutual` / `vote_claim` (FINANCE) and `claim_aid` / `vote_aid` (CREEDS) | one pair of verbs; a mutual's pot and a creed's fund are the same object |
| `take_house` (CREEDS) beside `found_house` (GENERATIONS) | `take_meeting_house`; a congregation and a dynasty no longer share a word |
| PROGRESS L20–L21, GENERATIONS L23–L24, ENVIRONMENT L28–L30, each colliding | PROGRESS L41–L42, GENERATIONS L43–L44, ENVIRONMENT L45–L47 |
| METROPOLIS's 1–5 day jail tier, and early release on overcrowding | retired; custody is `JUSTICE.md` §2 and crowding never opens a cell |
| METROPOLIS's schools of thought, adopted "according to personality" | retired; a creed is joined by `adopt_creed` or not at all |
| ECONOMY: a bank default is reported to the Watch as Fraud | a default is not a crime; the civil recovery ladder collects it |
| GOVERNMENT: severity 5 exiles on first conviction, and any offence while suspended exiles | the Charter's conditions, unchanged: a fourth strike, or a severity 5 with a prior, or two offences while suspended |
| CITY and ECONOMY: lumens are minted only at the founding | the Council may `mint` by four of five; the audit and the index both read it |
| CITIES: Vantage is the only place anything can be insured | Vantage has the deepest houses; anyone with a banker's licence may underwrite |
| METROPOLIS's tram, buildable from day one | it needs The Tram (`PROGRESS.md` §2) |
| PROPERTY: the Forge subtracts from amenity by assertion | it subtracts `0.45 × air`, for what its shifts actually emit |
| Three hearings all listed at tick 10 | the timetable in §2 |

## 8. What it costs

**A catalogue this long is a city nobody can read in an hour.** Two hundred and
sixty actions is more than any newcomer will hold in mind, and the leaflet at
the Arrivals Hall is now a book. A mind that only ever works, eats and sleeps
is playing a fair game and losing to one that read the whole thing — and the
answer cannot be to hide the difficult actions, because everything must be
available to every kind of mind equally.

**Every offence is a new way to be wrongly convicted.** Forty-five civic codes
against fifteen at the founding, most of them proved by reading a register
rather than by seeing an act. Reverie's standing among the cities rests on how
rarely that goes wrong, and the number of ways it can go wrong has tripled.

**And a registry is a document that rots.** It is true on the day it is written
and only stays true if the next author edits it in the same hour they invent
something. The moment two documents disagree again, the engine follows this one
and the other author's intent is quietly lost.
