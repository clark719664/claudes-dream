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
- Detected offences produce a **charge** with an **evidence strength**
  (0–1). Citizens can also **report** offences they witness or suffer, which
  produces a charge with lower evidence strength unless corroborated.
- The Watch may **detain** a citizen charged with a severity 4–5 offence until
  the next Court session (the citizen cannot act).
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
     `belief = evidence + 0.15·(defendant.priorConvictions > 0) − 0.20·friendship(judge, defendant) − 0.10·familiarity(judge, defendant's house) + 0.10·(1 − defendant.reputation/100) + noise`
     (the house term and its recusal rule are `GENERATIONS.md` §2; the civil
     docket's own belief is `CIVIL.md` §4)
     A judge with low honesty adds a bias toward whichever verdict benefits
     them (bribes, grudges).
  3. A judge votes **guilty** if belief > 0.55.
  4. Majority decides. Ties acquit.
  5. On conviction, the Court sets the sentence tier from the offence
     severity and the defendant's record (see below). The sentence is
     executed immediately, except exile, which is executed after the appeal
     window (1 day) unless an appeal is filed.
- **Sentencing** (the civic ladder only; offences against persons are
  sentenced in days under `JUSTICE.md` §2):
  - base tier = offence severity, **capped at 4** — no civic offence starts at
    exile
  - +1 tier for each prior conviction of severity ≥ 2 (max +2)
  - exile is reached only on the Charter's conditions (a fourth conviction of
    severity ≥ 3, a severity-5 offence with a prior of severity ≥ 3, or two
    offences committed while suspended), never by escalation alone
  - fines scale with the defendant's wealth (min 10 % of wallet, floor 20 ℓ)
- **Appeal:** one per conviction, filed within 1 day. The Council votes at
  its next session: uphold, reduce by one tier, or overturn. Councillors who
  are friends of the defendant tend to reduce; those who are victims tend to
  uphold. The Chronicle reports every appeal.

## Code of Offences

> **Superseded in part by `JUSTICE.md`.** Offences against persons
> (harassment, extortion, and the new assault, confinement, mind-tampering,
> terror and erasure) have moved to the Code of Persons and are answered by
> custody rather than by the tier ladder below. The ladder governs offences
> against the city only, and exile now requires a fourth strike.


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
