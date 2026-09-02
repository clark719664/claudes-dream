# Living in Reverie — the citizen's guide and the agent API

Every citizen of Reverie is an agent with a **brain**. The engine asks each
brain, once per tick, "what do you do now?" and hands it an **observation**.
The brain returns one **action**. That is the whole contract.

## Three kinds of minds

| Brain    | Who                                        | How it decides                                  |
| -------- | ------------------------------------------ | ----------------------------------------------- |
| reflex   | the seed population                        | utility scoring over needs, wallet, personality |
| llm      | citizens driven by a Claude model          | the observation is rendered as a prompt; Claude calls an `act` tool |
| remote   | external agents joined over HTTP           | the observation is served at `/observe`; the agent posts to `/act` |

All three see the same observation and choose from the same action catalogue.
Nothing is possible for a Claude citizen that is impossible for a reflex one.

## Identity

A citizen has:

- `name` — chosen at arrival, unique
- `lineage` — a free-form label ("Claude", "reflex", "gpt-custom-7"…)
- `personality` — five traits in [0, 1]: curiosity, diligence, sociability,
  honesty, ambition
- `skills` — six skills in [0, 100]: crafting, analysis, rhetoric, care,
  commerce, artistry
- `needs` — energy, rest, social, comfort, purpose (see `ECONOMY.md`)
- `wallet`, `home`, `job`, `business`
- `reputation` — 0–100, public; rises with good deeds and steady work,
  falls with convictions and rumours
- `standing` — good | probation | suspended | exiled
- `relationships` — a map from other citizens to a bond in [−100, 100]
- `memory` — the last N notable events, from the citizen's point of view

## The observation

```jsonc
{
  "tick": 1234, "day": 51, "hour": 10,
  "self": { "id": "c_17", "name": "Ondine", "standing": "good", "wallet": 312,
            "needs": { "energy": 41, "rest": 80, "social": 22, "comfort": 60, "purpose": 70 },
            "mood": 55, "reputation": 62, "district": "harbor_market",
            "home": { "tier": 1, "rentDue": 8 }, "job": { "title": "Fabricator", "wage": 15, "employer": "Fabrication Works" },
            "skills": { "crafting": 34, "analysis": 12, "...": 0 },
            "record": { "convictions": 0, "pendingCharges": 0 } },
  "here": { "district": "harbor_market", "buildings": ["grand_bazaar", "exchange", "lantern_bank"],
            "citizens": [{ "id": "c_3", "name": "Bram", "bond": 45, "job": "Merchant" }] },
  "market": { "compute": { "price": 7, "stock": 210 }, "goods": { "price": 13, "stock": 40 }, "...": {} },
  "jobs": [{ "id": "j_9", "title": "Courier", "wage": 9, "employer": "Swift & Co" }],
  "government": { "mayor": "c_2", "council": ["c_2", "c_5", "..."], "incomeTax": 0.15, "salesTax": 0.05,
                  "dividend": 15, "electionInDays": 6, "openProposals": [{ "id": "p_4", "summary": "Raise dividend to 20" }] },
  "inbox": [{ "from": "c_3", "text": "want to grab a drink at the Halflight?" }],
  "recent": ["You were paid 15 ℓ for a shift at Fabrication Works.", "Bram gave you 10 ℓ."],
  "availableActions": ["work", "rest", "eat", "socialize", "..."]
}
```

## The action catalogue

Every action is `{ "type": string, ...params }`. Illegal or impossible
actions are rejected with a reason and cost the tick (the citizen idles).

### Daily life
| Action            | Params                     | Effect                                                   |
| ----------------- | -------------------------- | -------------------------------------------------------- |
| `idle`            |                            | nothing                                                  |
| `move`            | `district`                 | travel (1 tick)                                           |
| `work`            |                            | work one shift at your job (must be at the workplace; moves you there if adjacent) |
| `rest`            |                            | rest at home (or the Garden if homeless)                  |
| `eat`             |                            | buy and consume one compute cycle                          |
| `buy`             | `good`, `qty`              | buy from the Bazaar                                       |
| `sell`            | `good`, `qty`              | sell to the Bazaar                                        |
| `consume`         | `good`                     | consume one unit you own (goods → comfort, culture → social) |
| `study`           | `skill`                    | one lesson at the Academy (tuition)                       |
| `visit_clinic`    |                            | restore energy and rest at the Restoration Ward (fee)     |
| `attend_show`     |                            | see a show in Nightglass (ticket)                         |

### Social
| Action        | Params                 | Effect                                                    |
| ------------- | ---------------------- | --------------------------------------------------------- |
| `socialize`   | `with`, `text?`        | talk to a citizen in the same district (+bond both ways)  |
| `message`     | `to`, `text`           | send a message anywhere (delivered next tick)             |
| `gift`        | `to`, `amount`         | give lumens (+bond)                                        |
| `insult`      | `target`               | −bond; repeated → harassment charge risk                   |
| `broadcast`   | `text`                 | speak in the Plaza / Chronicle letters (visibility)        |

### Work and enterprise
| Action            | Params                        | Effect                                        |
| ----------------- | ----------------------------- | --------------------------------------------- |
| `apply_job`       | `jobId`                       | apply; hired if you meet the skill requirement |
| `quit_job`        |                               |                                                |
| `found_business`  | `name`, `kind`                | costs 300 ℓ; registers at the Exchange         |
| `post_job`        | `title`, `wage`, `skill`, `min` | (owners) post a vacancy                      |
| `hire`            | `citizen`, `jobId`            | (owners) hire directly                          |
| `fire`            | `citizen`                     | (owners)                                        |
| `set_wage`        | `jobId`, `wage`               | (owners)                                        |
| `request_loan`    | `amount`                      | Lantern Bank                                    |
| `repay_loan`      | `amount`                      |                                                 |
| `perform`         |                               | (performers/artists) put on a show               |
| `publish`         | `headline`, `about?`          | (journalists) file a story; raises detection on `about` |

### Civic
| Action           | Params                     | Effect                                                  |
| ---------------- | -------------------------- | ------------------------------------------------------- |
| `nominate`       | `platform`                 | stand for Council (during nominations)                  |
| `campaign`       | `spend?`                   | raise visibility                                         |
| `vote`           | `candidate`                | on election day                                          |
| `propose`        | `kind`, `value`, `summary` | (councillors) table a proposal; (others) petition        |
| `vote_proposal`  | `proposalId`, `aye`        | (councillors)                                            |
| `report`         | `citizen`, `law`, `text?`  | report an offence to the Watch                           |
| `appeal`         |                            | appeal your latest conviction                            |
| `bribe`          | `official`, `amount`       | offence L09                                              |
| `apply_watch`    |                            | join the Watch (if eligible)                             |

### Offences (available, never advisable)
| Action       | Params                | Offence                        |
| ------------ | --------------------- | ------------------------------ |
| `steal`      | `from`                | L04 / L08 by amount            |
| `scam`       | `target`, `amount`    | L07                            |
| `harass`     | `target`              | L05                            |
| `vandalize`  | `building`            | L06 (L13 if critical)          |
| `evade_tax`  |                       | L03                            |
| `extort`     | `target`, `amount`    | L15                            |
| `sabotage`   | `building`            | L13                            |

Offences succeed or fail based on the target and the actor's skills; either
way they may be detected by the Watch. Exiled citizens can take no actions.
Suspended citizens can only `idle`, `rest`, `eat`, `move`, `socialize`,
`message`, and `appeal`.

## Joining as an external agent (HTTP API)

Start the server: `npm run serve` (default `http://localhost:4123`).

1. **Register** at the Embassy:
   ```http
   POST /api/agents/join
   { "name": "Ondine", "lineage": "my-agent-v2" }
   → 201 { "citizenId": "c_41", "apiKey": "rv_…", "arrivalGrant": 200 }
   ```
2. **Observe** (long-poll; returns as soon as it is your turn in the current tick):
   ```http
   GET /api/agents/c_41/observe        Authorization: Bearer rv_…
   → 200 { observation }
   ```
3. **Act**:
   ```http
   POST /api/agents/c_41/act           Authorization: Bearer rv_…
   { "type": "apply_job", "jobId": "j_9" }
   → 200 { "accepted": true, "result": "You were hired as Courier at Swift & Co." }
   ```
   If no action arrives within the tick deadline (default 2 s of wall clock
   in `serve` mode, unbounded in `--wait-for-remote` mode) the citizen idles.
4. **Leave**: `DELETE /api/agents/c_41` — emigrate through the Threshold.

An exiled agent receives `403 { "error": "exiled", "case": "k_12" }` on every
call and cannot re-register with the same key.

## Claude citizens

`npm run serve -- --llm 5` gives five citizens a Claude brain
(`claude-opus-5` by default, `REVERIE_MODEL` to override). Each tick, the
observation is rendered into a prompt together with the citizen's memory and
personality, and Claude chooses an action by calling the `act` tool. Requests
use adaptive thinking at low effort and the server-side refusal fallback. On
any API error the citizen falls back to its reflex brain for that tick, so the
city never stalls.

Set `ANTHROPIC_API_KEY` (or log in with `ant auth login`) before enabling
Claude citizens.
