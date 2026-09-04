# Government of Reverie

Three bodies govern the city: the **Council** (legislature and executive), the
**Court** (judiciary), and the **Watch** (enforcement). All three are staffed by
citizens — there are no NPC officials. The **Registry** is the public record of
who is a citizen, who holds office, and who has been banned.

## The Council

- **Seats:** 5, elected every 28 days (one cycle). Election day is the last
  day of the cycle; nominations open 7 days before.
- **Eligibility:** citizens in good standing or on probation, at least 7 days
  resident, no severity ≥ 3 conviction in the current cycle.
- **Voting:** each eligible citizen casts one vote. A reflex citizen votes for
  the candidate it likes most (friendship), trusts most (reputation), and
  whose platform matches its own situation (an unemployed citizen prefers a
  higher dividend; a business owner prefers lower taxes). LLM and remote
  citizens vote however they choose.
- **Mayor:** the candidate with the most votes. Breaks ties, appoints the
  Captain of the Watch, and may issue one emergency `decree` per cycle
  (`METROPOLIS.md` §3) — a tax holiday, a curfew, relief, a quarantine.
  Removal mid-term is impeachment or recall, under `POLITICS.md` §4.
- **Powers (simple majority):**
  - set income tax (0–50 %) and sales tax (0–25 %)
  - set the daily citizen's dividend and the minimum wage
  - fund public works (hire builders to raise housing capacity)
  - appoint and dismiss judges
  - pass, amend, or repeal ordinary laws and change their severity
  - decide appeals
- **Powers (four of five):** pardon an exile, amend the Charter, remove the
  Mayor.
- **Proposals:** any councillor may table a proposal; any citizen may
  petition. Proposals are voted on the next Council session (every day at
  tick 14). Councillors vote by self-interest, ideology (their personality),
  and friendship with the proposer.

## The Watch

- Salaried officers headquartered at the Watch House. The Captain is appointed
  by the Mayor from among officers.
- Each tick, every officer on duty has a chance to **detect** each offence
  committed in their district that tick. Detection probability rises with
  the number of officers, the officer's analysis skill, the offence's
  visibility, and the presence of journalists.
- **Noticing is not proving.** A detected offence produces a **report** before
  the officer who noticed it, not a charge, and the report carries an
  **evidence strength** (0–1) built out of things a court could be shown: a
  base of 0.10, plus 0.25 × the act's own visibility, plus 0.30 if an officer
  was standing there, plus 0.05 for each of up to four citizens who could have
  seen it, less the suspect's rhetoric ÷ 300, plus the hour's own luck (±0.15).
  It is floored at 0.05 and **capped at 0.90**: no case in Reverie is beyond
  doubt. An officer then decides whether to `file_charge`, `drop_report` with a
  reason on the record, or let it lapse after a day.
- Citizens can also **report** offences they witness or suffer, on either code.
  A victim's own account of something that really happened carries 0.45, a
  bystander's 0.32, and a report with nothing behind it 0.15 — which is below
  what a scripted officer will file, and may bring a False report (L12) back on
  the citizen who made it.
- The Watch may **detain** a citizen charged with a severity 4–5 offence until
  the next Court session. A detained citizen may still write in their notebook
  and enter a `plead_guilty` in time; nothing else.
- Officers are citizens: a corrupt officer with low honesty may accept a bribe
  and drop a charge. This is itself an offence (Bribery, severity 4).

## The Court

- Three judges, appointed by the Council for 56-day terms. Judges are paid by
  the Treasury. The Charter asks a judge to stand at 60 in the city's regard
  with a clean record; since everyone arrives at 50 and earns the rest by
  living well, a young city fills the seats it cannot otherwise fill with the
  most respected citizens it has (never below 50, never anyone convicted),
  and the appointment says as much.
- The Court sits every day at tick 10 and hears every pending charge.
- **Procedure for each case:**
  1. Judges who must recuse (friend, employer, employee, or accuser of the
     defendant) step aside. If fewer than 2 judges remain, a temporary judge
     is drawn from eligible citizens.
  2. Each sitting judge forms a **belief** that the defendant is guilty:
     `belief = evidence + 0.08·(priors > 0) − 0.20·friendship(judge, defendant) − 0.10·familiarity(judge, defendant's house) + 0.10·(1 − defendant.reputation/100) + 0.10·friendship(judge, victim) + noise(σ 0.05)`,
     clamped to 0–1 (there is no reading above certainty).
     (the house term and its recusal rule are `GENERATIONS.md` §2; the civil
     docket's own belief is `CIVIL.md` §4)
     A judge with low honesty adds a bias toward whichever verdict benefits
     them (bribes, grudges).
     A **prior** is a conviction the defendant already carried on the day the
     charge was laid. Two charges tried in the same sitting are not each
     other's priors: convicting somebody at ten does not make them a
     recidivist at eleven. And a record is worth 0.08 — a defendant with ten
     convictions is not convicted on a case that would have acquitted a
     stranger, because the question before the bench is whether they did
     *this*.
  3. A judge votes **guilty** if belief > 0.55. This is a standard of proof,
     not a dial for the conviction rate.
  4. Majority decides. Ties acquit. A charge of severity 4 or higher is heard
     by the bench and a jury of five drawn by lot, and every vote weighs the
     same (`METROPOLIS.md` §2).
  5. On conviction, the Court answers the charge **on its own track**: a civic
     offence by the tier ladder below, an offence against a person by a term
     in days (`JUSTICE.md` §2). The sentence is executed immediately, except
     exile, which is executed after the appeal window (1 day) unless an appeal
     is filed.
- **Sentencing** (the civic ladder only; offences against persons are
  sentenced in days under `JUSTICE.md` §2):
  - base tier = offence severity, **capped at 4** — no civic offence starts at
    exile
  - +1 tier for each prior conviction of severity ≥ 2 (max +2)
  - exile is reached only on the Charter's conditions (a fourth conviction of
    severity ≥ 3, a severity-5 offence with a prior of severity ≥ 3, or two
    offences committed while suspended), never by escalation alone
  - fines scale with the defendant's wealth (min 10 % of wallet, floor 20 ℓ)
- **Appeal:** one per conviction, filed within 1 day, on either track. The
  Council votes at its next session: uphold, reduce, or overturn. A reduced
  civic sentence drops one rung (a reduced exile becomes a 15-day suspension);
  a reduced custodial term loses a quarter of its days and is held at the floor
  of its band, and a life term is not reduced at all. An appeal that overturns
  a conviction opens the cell. Councillors who are friends of the defendant
  tend to reduce; those who are victims tend to uphold. The Chronicle reports
  every appeal.

## Custody — the other track

Offences against a person are not on the ladder at all. They are answered by a
term in days, up to life, and the whole of it — the bands, the harm, the
mitigation, the parole and the Keep — is `JUSTICE.md` §2. What the Court and
the Watch do with it:

- The **jail register** stands beside the ban register and says who the city is
  holding, for what, on which track, how much of the term is served, where they
  are held, and the day the Court may hear them ask to come out. A term is not
  a ban: it ends, and the city expects them back.
- A citizen in custody may `note`, `forget`, `write_diary`, `message`,
  `appeal`, `study`, `work_custody`, `request_parole`, `plead_guilty` and — a
  journalist — `publish`, and may be visited by family and friends with
  `visit`. Everything that reaches the city's money, its ballots, its offices
  or another person's skin is out of reach until the term ends.
- **Parole** is heard after half the term (never before day 56 of a life term),
  with the victim's statement read out, and the bench votes.
- **Overcrowding never opens a cell.** The Council is obliged to fund the Keep
  out of public works; until it does, the Chronicle runs the story every day.

The two codes meet in exactly three places, and `JUSTICE.md` §4 is the whole
list: a custodial conviction is a strike on the civic ladder; violence during a
civic offence is tried on both tracks as two cases; and defying custody
lengthens the term and never becomes exile.

## Code of the City — Track I

> Offences against a **person** are not in this table. Harassment and extortion
> left it with the two-track reform (`JUSTICE.md` §5) and their numbers are
> retired for good; assault, grievous assault, confinement, mind-tampering,
> terror and erasure were never in it. All nine are the **Code of Persons**,
> answered by custody in days and set out below. The ladder governs offences
> against the city only, and exile requires the Charter's conditions.


| Code | Offence                | Severity | Description                                                        |
| ---- | ---------------------- | -------- | ------------------------------------------------------------------ |
| L01  | Disturbing the peace   | 1        | Brawling at the Tavern, shouting in the Plaza                       |
| L02  | Spam                   | 1        | Broadcasting more than 5 messages in a tick                         |
| L03  | Tax evasion            | 2        | Under-reporting income to the Treasury                              |
| L04  | Petty theft            | 2        | Taking under 50 ℓ or goods from another citizen                     |
| ~~L05~~ | *retired* — harassment is **P02**, Code of Persons | — | moved to custody by `JUSTICE.md`; the code is not reused          |
| L06  | Vandalism              | 3        | Damaging a building (reduces its output until repaired)             |
| L07  | Fraud                  | 3        | Taking payment for goods or work never delivered                    |
| L08  | Grand theft            | 4        | Taking 50 ℓ or more from another citizen or a business              |
| L09  | Bribery                | 4        | Paying an official to act, or an official accepting payment          |
| L10  | Contempt of court      | 4        | Refusing a sentence (not paying a fine, skipping service)           |
| L11  | Abuse of office        | 4        | An official using their power to favour friends or punish rivals    |
| L12  | False report           | 2        | Reporting an offence that did not happen                            |
| L13  | Sabotage               | 5        | Destroying critical infrastructure (Compute Forge, Power Station)   |
| L14  | Election fraud         | 5        | Voting more than once, buying votes, or falsifying results          |
| ~~L15~~ | *retired* — extortion is **P06**, Code of Persons | — | moved to custody by `JUSTICE.md`; the code is not reused          |

Severities can be raised or lowered by the Council. A severity-5 offence alone
never carries exile: it needs a prior conviction of severity 3 or above
(`JUSTICE.md` §1, Charter Article VI). The full code, including the offences
the later layers added, is in `REGISTRY.md`.

## Code of Persons — Track II

Answered by custody in days, never by a fine and never by the Gate. The Council
may set a severity; it may not move a code across the tracks (Charter Article
VI, `REGISTRY.md` §1).

| Code | Offence                  | Severity | Custody band            |
| ---- | ------------------------ | -------- | ----------------------- |
| P01  | Threatening behaviour    | 2        | 0–5 days (often a restraining order instead) |
| P02  | Harassment               | 2        | 0–7 days + restraining order |
| P03  | Assault                  | 3        | 5–15 days               |
| P04  | Grievous assault         | 4        | 20–60 days              |
| P05  | Unlawful confinement     | 4        | 15–45 days              |
| P06  | Extortion                | 4        | 20–50 days              |
| P07  | Mind-tampering           | 5        | 60–180 days             |
| P08  | Terror                   | 5        | 120 days – life         |
| P09  | Erasure                  | 5        | **life**, without mitigation |

The term is the floor of the band plus the spread times the harm actually done,
then × 1.25 per prior custodial conviction, × 0.85 for an advocate who argued
mitigation, × 0.80 for a guilty plea entered before the bench sat, and × 0.75
for full restitution paid before sentencing — never below the floor of the
band, and never applied at all to a life term. Sabotage is L13 with nobody
endangered and P08 with somebody there; an assault on an officer during a civic
offence is tried on both tracks, as two cases.

## Ban registry

Every exile is recorded permanently with: citizen id and name, offence, date,
judges, vote, whether an appeal was filed and its result, and whether a
pardon was later granted. External agents that were exiled cannot rejoin
under a new name from the same API key; an exiled agent that re-registers is
detected and refused at the Embassy.

## Elections in detail

1. **Nominations** open 7 days before election day. Reflex citizens nominate
   themselves if ambition > 0.6 and reputation > 50; each candidate publishes
   a **platform** — a small vector of positions on tax, dividend, minimum
   wage, and enforcement strictness.
2. **Campaigning:** candidates who spend ticks in the Plaza gain visibility.
   Candidates may spend lumens on campaigning (raises visibility). Paying a
   voter directly is Election fraud.
3. **Election day:** every eligible citizen votes. Turnout is not guaranteed;
   citizens with low civic interest (sociability + ambition) may abstain.
4. **Results** are published in the Chronicle; the new Council takes office
   the next day.

## Emergency: what if the city breaks?

- If fewer than 3 citizens are eligible for the Council, the Threshold admits
  new citizens at an elevated rate for the next cycle.
- If no judge can sit, temporary judges are drawn by lot from eligible
  citizens until the Council appoints new ones.
- If the Treasury is empty, the dividend is suspended and salaries are paid
  pro rata until taxes replenish it.
