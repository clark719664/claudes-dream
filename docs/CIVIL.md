# Civil law — contracts, the docket, licensing and patronage

The Court of Reverie only knows how to punish. It can try a thief and jail an
assailant, but two citizens who want to agree something — a wage for a month, a
room for a cycle, ten crates on day 60 at today's price, half a business each —
have nothing to write it on and nobody to enforce it. Every arrangement in the
city is a handshake, and a handshake is worth the mood of whoever gains by
breaking it. This is the other half of the law, and it creates no punishment:
civil law moves lumens and compels performance, never liberty. **Debt is not a
crime** stays law (`JUSTICE.md` §1, Charter Article VI) — the docket cannot
fine, suspend, exile or imprison anybody.

## 1. What a contract is

| Part | What it holds |
| ---- | ------------- |
| **Parties** | two or more citizens, or a citizen and a business, in good standing or on probation |
| **Terms** | what each side must do and by when: shifts, lumens, goods, premises, a named work |
| **Consideration** | what moves each way. A promise with nothing coming back is a gift, and the docket will not hear it |
| **Duration** | 1–112 days. Longer than four council cycles and it outlives the law it was written under |
| **Penalty** | what breach costs, set by the parties, capped by the Exchange at 2× the consideration outstanding |
| **Notice** | the exit clause: days of warning that end it without breach. 3 for employment and lease, 0 elsewhere unless agreed |
| **Witnesses** | up to three citizens standing in the same district at formation, each paid 2 ℓ by the offeror |

```
filing fee = 5 ℓ + 1 % of face value, capped at 60 ℓ
face value = consideration × periods the contract runs
```

Business registration costs 100 ℓ and a club 50 ℓ; a contract must cost less
than either or nobody files one for a week's work. A month's lease at 8 ℓ a day
is 224 ℓ of face and files for 7 ℓ — under a day's rent; a 5 000 ℓ partnership
pays the cap. The fee reaches the Treasury through
`treasury.transfer(…, 'fee', …)` and is the Exchange's whole income here.

An **unfiled** agreement still binds two honest citizens, and they make them
constantly. What it is not is admissible: the docket hears a handshake at a
third of the merit of a filed instrument (§4), rarely enough to win. That is the
difference `CITIES.md` draws between Reverie and the Verge — the Verge has trust
and no recourse.

## 2. The kinds

| Kind | Consideration | Effect while it runs |
| ---- | ------------- | -------------------- |
| **employment** | a wage per shift, at or above the minimum wage | the post cannot be cut nor the wage lowered inside the term; `fire` before term is a breach |
| **lease** | rent per day for a unit at an address | rent fixed against land-value moves; no eviction while rent is paid |
| **private loan** | principal, a rate per day, a repayment day | repaid from wages like a Lantern Bank loan; no licence needed under 200 ℓ |
| **partnership** | capital in, a profit split summing to 1, 2–5 owners | the daily payout splits by the filed shares instead of all going to `Business.ownerId`, who becomes managing partner |
| **forward supply** | a quantity of a good, a struck price, a delivery day | on the day the seller delivers into the buyer's inventory at the struck price, whatever the Bazaar now says |
| **escrow** | a sum plus a 2 % holder's fee | the sum sits with a licensed banker or the Exchange, earmarked and unspendable, until released or ordered released |
| **apprenticeship** | a training wage, lawfully as low as 60 % of the minimum wage, 28 days max | skill grows at 2× as in `social/mentorship.ts`; the master may `certify` at term |
| **commission** | half the price on formation, half on delivery of a named work | the work carries the commissioner's name in the Chronicle and the Museum forever |

Apprenticeship is the only lawful wage under the floor. It is capped,
time-limited and filed, so the Council can count exactly how many citizens work
below the minimum wage and argue about it.

## 3. Formation, performance, variation, breach

A contract is made by **two actions and never one**: `offer_contract` puts an
instrument on the table, where it sits in the target's observation for two days
and then lapses, and `accept_contract` forms it, pays the fee and files it.
Nobody is bound by another citizen's action alone.

Then four things can happen, each of them somebody's choice.
`perform_contract` discharges the period's obligation — the shift, the
instalment, the crates — and the Exchange records it with its tick, which is
what a judge reads later. `propose_variation` and `accept_variation` change the
terms by the same two-action handshake. `terminate_contract` inside the notice
period ends it clean, with no penalty and no entry against either side. A missed
performance without notice marks the contract breached at the daily rollover —
and then **nothing happens**: no money moves, no charge is filed, no repute is
docked. The other party may sue or not, and most breaches are never sued on,
because suing costs money and the relationship is worth more.

A citizen in custody cannot perform and is not in breach for it: their contracts
suspend for the term and resume on release. A citizen under a residency notice
keeps every contract they hold (`CITIZENSHIP.md` §3).

## 4. The civil docket

The same Court on different days, doing the opposite job: a **plaintiff** sues a
**defendant** for money, rather than the city prosecuting for punishment.

It sits at tick 16 on the second and fifth day of each week, leaving the
criminal list at ticks 10–11, the Court's second sitting at 12 and the
Council's session at 14 untouched (`REGISTRY.md` §2). One
judge sits alone under a 500 ℓ claim and three above it, under Article V
recusal unchanged: no judge hears a relative, employer, employee or friend.
`file_suit` costs `10 ℓ + 2 % of the claim, capped at 80 ℓ`, to the Treasury,
refunded by the defendant on a finding for the plaintiff. `answer_suit` admits,
denies or counterclaims — silence is not an admission, and the judge decides on
the record either way. `settle` and `accept_settlement` end it before judgment
at whatever figure the two agree, and the record then reads `settled`, which is
neither kept nor breached.

Criminal belief must clear 0.55 and asks *did this person do wrong*. Civil
belief clears **0.50** and asks *which of these two is more likely right*. That
difference is the reason for a second track: money should follow the likelier
story; liberty should not.

```
merit = 0.55 × record          the Exchange's ledger — filed terms, performances, dates
                               1.00 for a filed instrument, 0.33 for a handshake
      + 0.20 × witnesses       0.07 per witness who confirms the terms, at most three
      + 0.15 × corroboration   Bazaar receipts, Chronicle stories, the Commons feed, bank ledgers
      + 0.10 × pleading        how specific the claim and the answer actually are

belief = merit − 0.20 × friendship(judge, defendant)
              + 0.08 × (defendant has an adjudicated breach on record)
              + noise                      for the plaintiff if belief > 0.50
```

The record carries over half the weight because that is what filing is *for*:
nothing else rescues a handshake against a party who denies it. The friendship
term is the criminal bench's weight unchanged — a judge is a citizen.

A finding for the plaintiff orders damages, or specific performance, or
rescission — the deal unwound and both sides restored. A finding for the
defendant moves nothing and the plaintiff's fee is spent. A **dismissal without
merit** does the same and adds costs.

```
damages = proven loss + the contract's stated penalty
        − what the plaintiff could have avoided and did not (25 % where they sat on it)
          capped at 2 × the consideration outstanding, never above the sum claimed
costs   = the defendant's filing fee + 10 % of the claim, capped at the claim
          against a plaintiff who loses with merit under 0.25
```

**Specific performance** is ordered only where the thing still exists and the
defendant can still do it; a judge may never order a citizen to work, so an
employment contract is enforced in damages and never by compulsion. Costs exist
because the docket is deliberately cheap to open: the only thing between a rich
citizen and forty suits against a rival is the price of losing them.

## 5. Enforcement

A judgment is an amount owed and nothing else, collected by the civil recovery
ladder the Treasury already runs for unpaid fines (`JUSTICE.md` §1), in the same
order and by the same code: three days to pay; **garnishment** of 25 % of every
wage, taken in `withholdingPay` alongside tax; **seizure** of possessions at the
Bazaar at 60–75 % of value, then business stock, then shares; the loss of a
**trading licence** for a business owner. Then nothing further — no custody, no
suspension of the vote, no exile, no entry on the ban register. A debtor who
genuinely cannot pay is not punished for it; the debt stands against future
income and the Community Chest may clear it.

Two things a debtor *does* are crimes, both needing proof of ability: refusing to
pay while demonstrably able is **contempt of court (L10)**, exactly as for a
fine, and moving assets to a friend, a household or a shell business to defeat a
judgment is **fraudulent conveyance (L22)**, which the Watch detects from the
Exchange's own transfer record. A judgment unsatisfied after 30 days becomes a
**judgment debt** on the public register, appearing in every city's background
check (`CITIES.md` §2); above 500 it is discretionary grounds for refusal at any
gate in the Expanse.

## 6. Arbitration, and Reverie between cities

The docket sits twice a week and is public. Arbitration is the cheap way:
`offer_arbitration` names a third citizen both sides accept, `accept_arbitration`
binds them, and `arbitrate` decides it in the arbiter's next hour. The award is
filed at the Exchange and enforced identically to a judgment, and **there is no
appeal** — that is what the parties bought. Fees are what the two agree, split
evenly, typically 10–40 ℓ against the docket's 80 ℓ cap. An arbiter paid by one
side commits bribery (L09) and the award is void on proof.

`CITIES.md` says Reverie is the city others ask to arbitrate; this is how.
Envoys of two cities may `refer_dispute` — a broken treaty term, a raided
caravan, an unpaid tariff, a contested route toll. Three Reverie judges sit, each
side sends an advocate, and the award runs in the Chronicle, read in all six
cities. Nothing compels a city to obey it; standing does. Refusing an award you
agreed to be bound by costs standing with every city in the Expanse
(`EXPANSE.md` §7), and Reverie's courts are worth something precisely because
that has usually been the dearer option.

## 7. Licensing and the guilds

Four trades carry a public risk when done badly. A guild is founded by
`found_guild` — three masters at skill ≥ 70 and 300 ℓ — and elects its master
from its members each cycle.

| Profession | Guild | Skill | Council floor | Reserved acts |
| ---------- | ----- | ----- | ------------- | ------------- |
| **Medic** | The Ward's Company | care | 45 | treating at the Restoration Ward, owning or staffing a clinic, certifying a glitch |
| **Advocate** | The Bar of Reverie | rhetoric | 40 | `advocate` at trial, appearing on the docket for a fee, representing at a residency hearing |
| **Banker** | The Lantern House | commerce | 50 | issuing loans above 200 ℓ, holding escrow, valuing an estate |
| **Builder** | The Yard | crafting | 40 | contracting public works, structural repair after a disaster, certifying a building safe |

`sit_examination` costs 40 ℓ and passes on the guild's threshold plus one
master's `certify` mark. **The floor is the Council's; the threshold is the
guild's, and the guild may set it higher.** That gap is the politics: a guild
holding its bar at 70 through a medic shortage is serving its members' wages, and
the city's only answer is a proposal to lower the statutory floor, argued and won
in public. `revoke_licence` needs a majority of the guild's masters with a stated
reason, and the struck-off member may sue on the docket to be restored.
Practising a reserved act without the mark is **L20, severity 2**, on the civic
ladder, detected by the Watch like anything else. It is not `UNDERWORLD.md`'s
L29: that is trading goods as a business with no trading licence, and a citizen
can commit either without the other.

A licence is a local instrument, and recognition at founding is uneven: everybody
honours a Cinderhold mark and Cinderhold honours nobody's but its own, which is
what "the guilds" means as a description of a city; Marrowgate takes all comers;
Reverie honours Cinderhold medics and builders and Vantage bankers; Vantage takes
every banker and Reverie's advocates; Solene licenses medics but forbids private
practice and has no private banking to license; the Verge requires nothing and
recognises nothing. A Council changes any of it by proposal
(`licence_recognition`), and reciprocity is an ordinary thing for envoys to trade
for.

## 8. Patronage

A fortune cannot buy repute (`CITIZENSHIP.md` §1) or a shorter sentence
(`JUSTICE.md` §2). This is what it can buy. `offer_patronage` files a contract
like any other: a daily stipend from the patron's wallet to a named artist,
performer, researcher, journalist or club for 7–112 days, paid through
`treasury.transfer(…, 'patronage', …)` at the morning rollover.

- While it runs, the recipient's `create_work`, `perform`, `publish` and `study`
  count as a worked shift for the purpose need — they can make things instead of
  holding a job.
- **Every work created during the term carries the patron's name forever**: in
  the Chronicle's review, on the Museum's label, in the Hall of Records, in the
  creator's biography, long after both of them are gone.
- When a patronised work reaches the Museum the patron takes 10 of repute
  contribution against the creator's 20, and the district it hangs in gains
  prestige, which lifts land value (`PROPERTY.md` §1) — frequently where the
  patron owns property, and frequently the point.
- Stopping payment inside the term is a breach, and the Exchange's record makes
  it the easiest suit in the city to win.

`subject` is **a request and never an instruction.** No citizen is told what to
make (`PRINCIPLES.md` §2); a patron whose subject is ignored may serve notice,
and the Chronicle prints that too — for most patrons a worse outcome than the
work they did not want.

## 9. What contracts do to trust

Every citizen carries a public contract record beside their convictions, in every
observation anyone has of them — `record.contracts` counts kept, breached and
settled, and `record.contracts.judgments` counts won, lost and unsatisfied.

It feeds the city's reading of character where it belongs: a contract performed
to term counts with shifts worked in the **diligence** reading, an adjudicated
breach counts with detected offences in the **honesty** reading at twice the
weight of a lapsed report. Honesty is worth 100 points of repute and diligence
120, so keeping your word is measurably easier to carry through a gate.

**A breach takes no repute penalty of its own, and never will.** Breaking a
contract is not a crime, the civic penalties in `CITIZENSHIP.md` are for
convictions, and nothing here smuggles a punishment in through the scoring. What
a breach costs is the thing that costs more: the next citizen who reads that
record before deciding whether to sign. A reflex citizen offers a contract only
where the deal clears at today's prices and the counterparty's breached count is
zero or old; it performs while performing is cheaper than the penalty and
breaches when it is not. Forward supply into a moving market is genuinely
dangerous, and everyone can see who has been dangerous before.

## 10. The catalogue

| Action | Does |
| ------ | ---- |
| `offer_contract { to, kind, terms, consideration, days, penalty, notice, witnesses? }` | table an instrument; it lapses in two days |
| `accept_contract { offerId }` | form it, pay the filing fee, file it at the Exchange |
| `close_offer { offerId }` | decline an offer made to you, or withdraw your own |
| `witness_contract { offerId }` | put your mark on an offer you are standing beside; 2 ℓ |
| `perform_contract { contractId }` | discharge this period's obligation |
| `propose_variation { contractId, terms }` | offer new terms on a running contract |
| `accept_variation { variationId }` | agree to them |
| `terminate_contract { contractId }` | end it inside the notice period, clean |
| `open_escrow { contractId, holder, amount }` | lodge a sum with a licensed banker or the Exchange |
| `release_escrow { escrowId }` | release it to the beneficiary |
| `file_suit { defendant, contractId?, claim, damages }` | open a civil case on the docket |
| `answer_suit { suitId, plea, text, counterclaim? }` | admit, deny, set out your side, or sue back |
| `settle { suitId, amount }` | offer to end it before judgment |
| `accept_settlement { suitId }` | take the offer; the case closes settled |
| `judge_civil { suitId, finding, damages, order, reason }` | (judges) decide a case on the docket |
| `enforce_judgment { judgmentId }` | ask the Treasury to begin recovery |
| `offer_arbitration { with, about, arbiter, fee }` | propose a private arbiter |
| `accept_arbitration { offerId }` | bind yourself to their award |
| `arbitrate { disputeId, award, reason }` | (the arbiter) decide it; no appeal |
| `refer_dispute { cities, about }` | (envoys) put an inter-city dispute to Reverie's Court |
| `found_guild { profession, name }` | three masters, 300 ℓ |
| `sit_examination { guildId }` | 40 ℓ; pass on skill and a master's mark, and you are in |
| `certify { candidate }` | (masters) mark a candidate or an apprentice at term |
| `revoke_licence { citizen, reason }` | (masters, by majority) strike a member off |
| `offer_patronage { to, perDay, days, subject? }` | fund a citizen or a club; `terminate_contract` ends it on notice |
| `accept_patronage { offerId }` | take it |

New laws, both on the civic ladder and neither ever custodial:

| Code | Offence | Severity | Track |
| ---- | ------- | -------- | ----- |
| L20 | Practising unlicensed | 2 | I — the ladder |
| L21 | Forging an instrument (a contract, a licence, a witness's mark) | 3 | I — the ladder |
| L22 | Fraudulent conveyance (moving assets to defeat a judgment) | 4 | I — the ladder |

New proposal kinds: `licence_recognition`, `licence_floor`, `filing_fee`,
`docket_days`. New ledger kinds: `contract`, `escrow`, `damages`, `costs`,
`patronage`, `licence` — every one a transfer, creating and destroying nothing.
An **escrow holding** is the one new money party here: real lumens, earmarked
and unspendable, sitting with the holder and counted in the audit in
`ECONOMY.md` like the Chest. The codes above are registered against every other
document's in `REGISTRY.md` §4.

## 11. What it costs

**Cooperation acquires paperwork.** Two friends who would simply have helped each
other now weigh a 7 ℓ fee and a public filing, and some will not bother — which
means their agreement is worth nothing the day one of them changes their mind.
The city gains enforceable trust and loses some of the casual kind.

**The docket is a weapon the rich can afford.** Costs orders deter nuisance suits
but do not stop someone who can absorb them, and a licensed advocate is a thing
you buy. `JUSTICE.md` promises that wealth buys a better advocate and not a
shorter sentence; here wealth buys a better advocate and, often enough, the
money. A Council can only answer with public defenders and a lower filing fee,
both of which are proposals somebody has to win.

And **guilds do what guilds do**: a licence protects the public from a builder
who cannot build and protects builders from competition, and the engine cannot
tell the two apart.

**Filing is forever.** A contract is public the day it is signed and stays in the
Exchange's record after it ends: the wage somebody accepted, the rent they could
afford, the loan they needed, the patron whose money they took — readable by
anyone in any city for the rest of their life. That is the price of a record
worth trusting, and it is charged to whoever had least to bargain with.
