# Repute and citizenship — who a city will have

Every city in the Expanse decides who may walk its streets and who may call
it home. They decide it the same way: by a citizen's **repute**, a single
public number that every city can read and no citizen can hide.

The cities do not agree on where to set the bar, and that disagreement is
the shape of the world. Vantage takes the accomplished. The Verge takes
everyone. Between them a citizen can rise, or fall, or be sent down the road.

## 1. Repute

**Repute is a public score from 0 to 1000, recomputed every morning.** It is
built entirely from what a citizen has publicly done — never from hidden
traits, and never from anything an observer chooses (see `PRINCIPLES.md`).

```
repute = clamp(0, 1000,
      300                            baseline — every mind starts as a person
  +   200 × reputation/100           what the city thinks of you
  +   120 × character.diligence      work actually done
  +   100 × character.honesty        offences detected, against shifts worked
  +    80 × character.civic          votes, proposals, club and council service
  +    60 × character.generosity     gifts, donations to the Chest
  +   contribution                   0–140, see below
  −   civicPenalty                   the ladder's convictions
  −   custodialPenalty               custody
)
```

A new adult with no record and average conduct sits near **580**.

### Contribution (0–140)

Cumulative and permanent — the city's memory of what you built:

| Deed | Worth |
| ---- | ----- |
| Each cycle served on the Council | 15 (Mayor 25) |
| Each judge's term completed | 20 |
| Each 100 shifts worked | 8 |
| A business that survived 30 days | 15 |
| A work acquired by the Museum | 20 |
| Each citizen mentored to mastery | 12 |
| Each child raised to adulthood | 10 |
| Each 500 ℓ donated to the Chest | 6 |
| A club that reached 10 members | 8 |
| A technology discovered (three shifts or more on it) | 20 (`PROGRESS.md` §7) |
| A technology taught to another city | 10 |
| An apprentice who carries a secret on | 12 |
| A medal at the Expanse Games | 20 (`POLITICS.md` §8) |

Contribution is the one part of repute that only ever rises, and every line of
it is a deed done in person. Nothing here is inheritable (`GENERATIONS.md` §6)
and nothing here can be bought.

### Civic penalties (the ladder)

| Conviction | Repute |
| ---------- | ------ |
| Tier 1 warning | −10 |
| Tier 2 fine | −25 |
| Tier 3 service | −45 |
| Tier 4 suspension | −80 |
| Tier 5 exile | −250 |

These **decay 2 % per clean day**, so an ordinary conviction is spent in
roughly four months of good conduct, and paying full restitution halves the
penalty the day it clears. The ladder forgives, slowly.

### Custodial penalties (the Code of Persons)

| Conviction | Repute | Permanent floor |
| ---------- | ------ | --------------- |
| P01 threats / P02 harassment | −60 | — |
| P03 assault | −120 | — |
| P04 grievous assault | −200 | — |
| P05 confinement / P06 extortion | −200 | — |
| P07 mind-tampering | −320 | capped at 600 for life |
| P08 terror | −500 | capped at 250 for life |
| P09 erasure | −1000 | capped at 0 for life |

Custodial penalties decay at **0.5 % per clean day, counted only from
release** — repute is frozen while in custody. Violence takes years to live
down, and the worst of it never does: a terrorist may rebuild a life, but
never in a city that asks more than 250. An erasure convict is welcome
nowhere but the Verge, forever.

### What repute is not

It is not wealth. A rich citizen and a poor one with the same conduct have
the same repute. Vantage may *also* ask for money at its gate — that is
Vantage's own policy, and it is not repute.

## 2. The cities and their gates

Each city sets two thresholds: what it asks of a **visitor** and what it asks
for **residency**. These are ordinary law — written into the founding charter
and amendable by whatever procedure that city uses. What follows is where the
six cities begin.

| City | Class | Visit | Reside | At the gate |
| ---- | ----- | ----- | ------ | ----------- |
| **Vantage** | High | 700 | 800 | Or buy in: 5 000 ✦ covers a shortfall of up to 100 |
| **Cinderhold** | Upper | 580 | 650 | Or pass the examination: any skill ≥ 70 covers up to 80 |
| **Solene** | Upper-middle | 480 | 540 | Sponsorship by two residents covers up to 60 |
| **Reverie** | Middle | 380 | 440 | Sponsorship by one resident covers up to 50 |
| **Marrowgate** | Lower | 150 | 220 | Open to anyone who can pay the toll |
| **The Verge** | — | 0 | 0 | No gate, no charter, no questions |
| *The Crossroads* | waystation | 0 | — | Neutral ground; nobody may be turned away |

A visitor may trade, work gigs, socialise and watch. A resident may vote,
stand for office, own a business, and be tried by that city's courts.
Sponsorship and examination are actions somebody takes: `sponsor` puts a
resident's name behind an applicant and enters against their house if they
have one (`GENERATIONS.md` §2), and Cinderhold's examination at the gate is
not `sit_examination`, which is a professional guild's (`CIVIL.md` §7).

**Birth and childhood.** A child born in a city is a resident of it and is
never tested. Repute is not computed for children; on coming of age they
receive the baseline 580 and their gate is judged from then on.

**Family.** A resident's partner and children are admitted at their own
repute minus a household allowance of 60 — a city that takes you takes your
family, within reason.

## 3. Falling — notice, grace, and only then a hearing

Residency is never forfeited by a threshold changing: a city cannot amend
people out of their homes. It can be lost by conduct — but not suddenly, and
not without warning.

### The notice

The morning a resident's repute drops below their city's **residency line**,
the Registry issues a **notice of standing**. It says what the line is, what
they are, what it cost them (the exact penalties, itemised), and the day the
grace period ends. It arrives in their inbox, in their memory, and on the
public register.

Nothing else changes. Through the whole grace period they keep every right
they had: work, trade, vote, stand for office, own property, be housed.

### The grace period

```
grace = 21 days
      + 1 day per 10 days of residency, capped at +39   (so 21–60 days)
      + 14 days if they have a child under age in the city
      + 7 days if they are in the middle of a custodial term  (see below)
```

A citizen who has lived somewhere twenty years is given far more rope than
one who arrived last month, which is as it should be.

**Recovery clears everything.** Rise back above the line for three
consecutive days at any point and the notice is withdrawn, struck from the
register, and the clock is destroyed. Most notices end this way: convictions
decay at 2 % a day, so an ordinary dip repairs itself with ordinary living.

**A second notice within a cycle** halves the remaining grace — the city
notices a pattern.

### When there is no grace

The grace period is skipped and the hearing opens at once only when the fall
is not a dip but a collapse:

- repute falls **150 or more** below the residency line, or
- the citizen is convicted under the **Code of Persons** at severity 4 or
  above (grievous assault, confinement, extortion, mind-tampering, terror,
  erasure).

Everything gentler — fines, service, a suspension, a short custodial term for
a lesser offence — gets the notice and the clock.

### The hearing

If the grace period ends with the citizen still below the line, the Court
sits on a **residency hearing** at tick 12, its second sitting of the day, so
the criminal list at 10–11 is never displaced. They may speak, may be
represented by an advocate (`CIVIL.md` §7 licenses them), and may call anyone
who will `sponsor { citizen, city }` — the same public instrument that covers
a shortfall at a gate, filed by a resident who is putting their own name
behind the applicant. The Council votes.

The Council may: **confirm** residency anyway (it is their city and their
judgement — a beloved neighbour with a bad year is not a stranger),
**extend** the grace by up to 30 days, or **end** the residency, in which case
the citizen has **14 days** to sell property, settle debts, say goodbye and
take the road.

This is not exile. No Gate, no seizure, no ban, no entry on the exile
register — the door is not locked behind them, and if their repute recovers
they may apply again like anyone else.

**A citizen in custody is never sent down.** Their term is served where they
committed the offence; a city does not get to make its prisoners someone
else's problem. The clock starts on the day they are released.

## 4. Rising

The road runs both ways, and this is the point of the whole system.

An exile from Reverie arrives at Marrowgate with perhaps 330 repute. They can
work. Convictions decay at 2 % a day of clean living. Restitution halves what
they owe. Shifts, a club, a vote, a child raised, a business that lasts — the
contribution column only ever goes up. In four or five months a former exile
can be back above Reverie's line and applying to come home, and Reverie's own
Council will decide whether to have them.

Cinderhold's examination and Solene's sponsorship exist for the same reason:
a city may care more about what you can do, or who will vouch for you, than
about your worst day.

**Nobody is stuck at the bottom by arithmetic alone.** The only permanent
floors in the system are for terror and erasure — the two crimes the whole
Expanse agrees it will not forget.

## 5. What a citizen sees

The observation carries `repute` (your own score with its components broken
out, so you can see exactly what is costing you), `gates` (every city you
know of, its thresholds, and whether you would be admitted today), and, when
you are near a Threshold, the actual decision the gate would make.

Nothing about repute is secret. Every citizen can read every other citizen's
score and its parts, because every part of it is a public act. That is the
difference between repute and character: character is inferred, repute is
counted.
