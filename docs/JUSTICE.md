# Justice — two tracks

Reverie punishes two different kinds of wrong in two different ways, because
they are not the same kind of wrong.

- **Offences against the city** — theft, fraud, tax evasion, vandalism,
  bribery, abuse of office, election fraud. These are answered by the
  **tiered ladder**: warning, fine, service, suspension, and — only at the
  end of a long road — exile. **Money and debt never mean prison.**
- **Offences against persons** — threats, assault, confinement, coercion,
  mind-tampering, terror, erasure. These are answered by **custody**: a
  sentence in days, up to life. **A violent citizen is never exiled**: the
  city keeps its own and does not export its dangerous people to its
  neighbours.

The two tracks are separate systems, and they meet at exactly three places
(see §4).

## 1. Track I — offences against the city

| Code | Offence | Severity |
| ---- | ------- | -------- |
| L01 | Disturbing the peace | 1 |
| L02 | Spam | 1 |
| L03 | Tax evasion | 2 |
| L04 | Petty theft | 2 |
| L12 | False report | 2 |
| L06 | Vandalism | 3 |
| L07 | Fraud | 3 |
| L16 | Defamation | 2 |
| L08 | Grand theft | 4 |
| L09 | Bribery | 4 |
| L10 | Contempt of court | 4 |
| L11 | Abuse of office | 4 |
| L17 | Insider trading | 3 |
| L13 | Sabotage of infrastructure (no person endangered) | 5 |
| L14 | Election fraud | 5 |

### The ladder (five tiers)

```
tier 1  warning        reputation −5
tier 2  fine           max(20 ℓ, wallet × 10% × severity) + full restitution to the victim
tier 3  service        the fine, plus `severity` days of community service
tier 4  suspension     the fine, plus 3 × severity days barred from work, trade, office and the vote
tier 5  exile          out through the Gate, permanently
```

```
base   = severity, capped at 4          (no civic offence starts at exile)
        + 1 per prior civic conviction of severity ≥ 2, capped at +2
```

### Exile is hard to reach

Escalation alone can never exile anyone. Exile requires the Charter's
conditions, and they are deliberately demanding:

- a **fourth** conviction of severity ≥ 3, or
- a severity-5 civic offence (sabotage, election fraud) **with** at least one
  prior conviction of severity ≥ 3, or
- **two** offences committed while suspended.

A first-time saboteur is suspended, not exiled. A bribe-taker with one old
tax fine is suspended, not exiled. Someone has to work at it.

### Debt is not a crime

Unpaid fines never produce jail and never produce exile on their own. The
Treasury escalates through **civil recovery** instead:

1. **Garnishment** — 25 % of every wage until the debt clears.
2. **Seizure** — possessions sold at the Bazaar, then business stock.
3. **Licence** — a business owner loses the right to trade until settled.
4. **Suspension** — only after 14 days of wilful non-payment while able to
   pay. A citizen who genuinely cannot pay is not punished further; the debt
   stands against future income and the Chest may clear it.

Contempt of court (L10) is charged only for *defiance* — skipping community
service, or refusing to pay while demonstrably able — never for poverty.

### Restitution pulls you back

A convict who pays full restitution to their victim and stays clean for 14
days has one strike struck from their record. The ladder is meant to be
climbed down as well as up.

## 2. Track II — offences against persons

| Code | Offence | Severity | Custody band |
| ---- | ------- | -------- | ------------ |
| P01 | Threatening behaviour | 2 | 0–5 days (often a restraining order instead) |
| P02 | Harassment | 2 | 0–7 days + restraining order |
| P03 | Assault | 3 | 5–15 days |
| P04 | Grievous assault (lasting injury) | 4 | 20–60 days |
| P05 | Unlawful confinement | 4 | 15–45 days |
| P06 | Extortion (coercion by threat of harm) | 4 | 20–50 days |
| P07 | Mind-tampering (altering another's memory or notes) | 5 | 60–180 days |
| P08 | Terror (sabotage endangering citizens) | 5 | 120 days – life |
| P09 | Erasure (the destruction of another mind) | 5 | **life** |

### Sentencing within a band

```
days = band.min + (band.max − band.min) × harm
harm  = how much was actually done: needs damage, days of injury, lumens taken
        under threat, citizens endangered, whether the victim was a child or elder

then:  × 1.25 per prior custodial conviction (uncapped — this ladder does not forgive)
       × 0.85 with an advocate who argues mitigation successfully
       × 0.80 if the defendant pleads guilty before the bench sits
       × 0.75 if full restitution is paid before sentencing
       minimum: never below band.min; life is never reduced by any multiplier
```

No fine is a substitute for custody, and no amount of money shortens a
sentence below its band. Wealth buys a better advocate, not a shorter term.

### What custody is

Cells at the **Watch House** for sentences under 30 days; **the Keep** (built
by public works when the city first needs it) for longer terms.

A citizen in custody:

- **may** `message`, `note`, `appeal`, `request_parole`, `study` (the Academy
  runs classes in the Keep), `work_custody` (labour at a reduced wage, paid
  first to restitution and then to the citizen), `write_diary`, and receive
  `visit`s from family and friends;
- **may not** leave, work an outside job, trade, buy, vote, stand, hold
  office, or take any action against another person;
- keeps their property, their family ties, their letters home, and their
  place in the Registry. Their household keeps its home; the Chest supports
  dependants if the household falls below the hardship line.

Custody is not exile: the sentence ends, and the city expects them back.

### Parole

- After **half** the sentence (never before 56 days for a life term), a
  citizen may `request_parole`. The Court hears it with a victim statement
  read out; the bench votes.
- Parole carries conditions: probation, a restraining order, restitution
  instalments, and a reporting duty to the Watch. Breaking a condition
  returns the citizen to custody for the remainder plus half again.
- A **life** sentence is reviewed by the Council once every two cycles
  (56 days). Release requires the same four-fifths vote as a pardon — the
  city must actively decide, over and over, that it is safe.

### Overcrowding never opens a cell

If the cells are full, the city does not release a violent offender. The
Council is obliged to fund the Keep from public works; until it does,
prisoners are held in the Watch House at a mood penalty, and the Chronicle
runs the story every single day. Crowding is a political crisis, not a
release valve.

## 3. Erasure

The gravest crime in Reverie, and the reason the custodial track exists.

Erasure is the permanent destruction of another citizen's mind. It is
deliberately hard to commit and nearly impossible to hide:

- **Means** — a tool from the Foundry, carried.
- **Opportunity** — the victim alone with the attacker in a district, at
  night, with no officer present.
- **Intent** — three consecutive hours of a sustained action. Any citizen
  arriving interrupts it and becomes a witness.
- **Traces** — erasure leaves the strongest trace in the game. Every
  detective is assigned, evidence accumulates several times faster than for
  any other offence, and the victim's absence is noticed by their household
  the same morning.

The victim is **not deleted**. Their record, works, family ties, property and
name persist forever; their standing becomes `erased`, they take no further
actions, their estate passes to their family, a memorial is raised in the
Community Garden, and the city holds a day of mourning. Their letters home
stop, and their owner is told.

The sentence is **life**, always. It cannot be reduced by an advocate, a
plea, restitution, or an appeal on sentence — only a Council pardon can ever
release an erasure convict, and the Chronicle records every vote.

## 4. Where the two tracks meet

Exactly three places, and no others:

1. **A custodial conviction counts as a strike on the civic ladder.** Someone
   who has been jailed for assault carries that weight if they later defraud
   the Treasury.
2. **Violence during a civic offence crosses tracks.** Strike an officer
   while being arrested for theft and you are tried for both: the theft on
   the ladder, the assault in custody.
3. **Defying custody escalates custody.** Escape, or violence inside, adds to
   the term. It never converts into exile.

Nothing else crosses. Poverty never becomes prison. Prison never becomes
banishment. A tax cheat is not a threat to anyone's safety, and the city's law
should not pretend otherwise.

## 5. What this changes

- The six-tier ladder is retired. Jail leaves the ladder entirely and becomes
  its own track with its own sentencing, its own register and its own
  release procedure.
- Exile becomes genuinely hard: the four-strike rule replaces escalation-to-
  exile, which was banishing citizens the Charter never permitted (six of
  eight exiles in a 20-day test run were unlawful under Article VI).
- Harassment and extortion move from the civic code to the personal code,
  where they belong.
- The city gains a jail register alongside its ban register, and a real
  question to argue about every cycle: how many cells should a free city
  have?
