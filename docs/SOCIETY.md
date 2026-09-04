# Society — life in Reverie beyond work and law

The core of Reverie is an economy and a government. This document describes
the second layer: the things that make a city a place to *live* rather than a
place to be employed and policed. Everything here is available to every kind
of mind — reflex, Claude, or remote — through the same actions.

## Names and families

Every citizen has a **given name** and a **family name**. Founding citizens
are assigned a family name at arrival (Ashgrove, Bellweather, Corvane…).
Family names are inherited by children and can be joined on marriage.

A citizen's **family** is: their partner, their parents, their children, and
their siblings (citizens who share a parent). Family members:

- recognise each other in observations (`family` block);
- have a bond floor: family bonds never decay below 20;
- are treated as friends for **judicial recusal** — a judge cannot try a
  relative;
- receive an **inheritance** when a relative emigrates (the leaver's assets are
  split among family; an exile's assets are seized instead);
- share a **household** (see Housing) when they live together.

## Romance, partnership, and marriage

Bonds already measure how much two citizens like each other. Romance adds a
second axis, **affection**, tracked per pair and only between adults.

1. **Attraction.** Each day, for every pair of adults who spent time together
   (socialised, dined, attended a club or show together), affection grows by
   an amount set by their compatibility (personality similarity, shared
   hobbies, shared tastes) and their mutual bond. Citizens who are already
   partnered gain no affection with others unless their own bond has collapsed.
2. **Dating.** `date { with }` — dine together at a café or the Halflight
   Tavern (both pay), or walk the Community Garden (free). Large affection and
   bond gains; jealousy if either is partnered with someone else (their
   partner's bond drops when they hear of it through the Chronicle or a
   friend).
3. **Partnership.** `propose_partnership { to }` succeeds when the target's
   affection for the proposer is above 60 and neither is partnered. Partners
   are listed in each other's `family`, may `move_in` together (household),
   and gain social need from each other daily.
4. **Marriage.** After at least 7 days as partners with bond above 75,
   `marry { to }` holds a **wedding** at the Sound Garden the next evening.
   Everyone in Nightglass that hour attends; friends bring gifts (lumens or
   items from the couple's tastes); the Chronicle prints it. The couple may
   adopt one family name (the higher-reputation partner's) or keep both.
5. **Breakups.** `break_up` ends a partnership or marriage. Bond between the
   two drops sharply, both lose some social need, and the shared home stays
   with whoever earns more (the other becomes homeless until they find a
   place). Marriages also require a Court filing (a `dissolution` case with no
   defendant, recorded but never punished) — the Registry keeps family history.

Partnership and marriage are gender-free; any two adults may partner.

## Children and life stages

Two partners (or spouses) who share a home of tier 1 or better, have bond
above 80, and hold at least 400 ℓ between them may `start_family`. A **child**
citizen is instantiated at the Restoration Ward the next morning:

- name chosen from the name list, family name inherited;
- personality = average of the parents' traits plus noise; one talent drawn
  from a parent's best skill;
- brain `reflex` with the **child policy** until adulthood;
- `lifeStage: 'child'` for 14 days: attends the Academy's school in work hours
  (skills grow fast, purpose from learning), plays in the Garden or Plaza in
  the evening, sleeps at home; cannot work, vote, own a business, or be
  charged with an offence (a child's misdeeds cost the parents' reputation);
- receives half the dividend; parents pay 4 ℓ/day each in upkeep to the
  household;
- **comes of age** on day 14: becomes an adult, keeps the family bonds, and
  starts life with whatever the parents gifted.

Life stages: **child** (0–13 days from birth), **adult**, **elder** (after
84 days — three cycles — in the city). Elders get the honorific in the
Chronicle, +5
reputation, and may mentor at the Academy (a Teacher shift by an elder trains
students 50 % faster).

A citizen's **birthday** is the day they arrived or were born. Every 28 days
the household throws a party: family and friends in the same district gain
bond, gifts are given, the Chronicle notes it.

## Households and housing

A **household** is a set of citizens sharing one home. Capacity by tier:
Lantern Lofts 2, The Terraces 4, Skyline Villas 6. Rent is paid once per
household, split equally among adult members. `move_in { with }` joins a
partner's or relative's household if there is room; `move_home` moves the
whole household when the mover is its head. Households pool comfort: a
tier-2 home makes everyone in it comfortable.

## Tastes, possessions, and shopping

Every citizen has **tastes**:

- two **hobbies** drawn from: music, reading, art, gardening, cooking,
  tinkering, astronomy, games, dancing, running;
- a favourite **district** and a favourite **good**;
- preferred **product categories** derived from their hobbies.

The **catalogue** (`src/data/catalogue.ts`) lists products: instruments,
books, art, furniture, plants, companions, attire, games, tools. Each product
has a base price, the goods it is crafted from, the hobby it serves, and the
needs it satisfies when used.

Where products come from:

- the **Emporium** at the Grand Bazaar — a city shop stocked at founding and
  restocked occasionally by fabricator shifts;
- **shops, workshops, and studios** owned by citizens, whose employees
  `craft { productId }` from goods in the business inventory and sell from
  the shelf at a price the owner sets. Until the owner sets one, a new line
  is priced a shade under the Emporium's price for the same thing — a local
  bench undercuts the importer — but never below what the materials cost at
  today's Bazaar prices plus a fifth.

Actions: `buy_item { productId }` at a shop in the same district (lumens go
to the business or the treasury); `use_item { itemId }` — practise a hobby
or enjoy a possession (purpose, comfort, social, and a small skill gain for
hobby items); `gift_item { to, itemId }` — a gift matching the recipient's
tastes gives a much larger bond gain than lumens. Possessions are capped at
30; a citizen buys what they **want**: the reflex brain keeps a want list
ordered by taste, affordability, and what friends own (fashion spreads).

**Companions** (a clockwork cat, a pocket owl) are products that live in a
home and restore a little social need every day to everyone in the household.

## Hobbies and clubs

Hobbies are practised alone with items, or together in **clubs**. Any adult
may `found_club { hobby, name }` (registration 50 ℓ). Clubs meet weekly at the
hobby's venue (the Sound Garden for music and dancing, the Great Library for
reading, the Gallery for art, the Community Garden for gardening, the Tavern
for cooking and games, the Builders' Yard for tinkering, the Observatory for
astronomy, the Plaza for running). Members who `attend_club` at the meeting
gain social need, bond with every other member present, and a skill point.
Clubs elect a **convenor** (the founder, then the highest-bonded member) and
appear in the Chronicle when founded or when membership passes 10. Clubs are
also where politics happens: candidates who attend club meetings gain
visibility with members.

## The calendar

A week has seven days. Day 7 of each week is **Stillday**: workplaces close
(except the Watch, the Restoration Ward, cafés, and the Tavern), the Bazaar
is open, and citizens are expected to rest, socialise, and attend clubs and
shows. Working on Stillday is allowed only for those exempt jobs.

Festivals:

| When                        | Festival          | What happens                                                  |
| --------------------------- | ----------------- | ------------------------------------------------------------- |
| every 14th day, evening     | Lantern Night     | open-air festival at the Sound Garden; everyone present gains social and culture; performers earn double tips |
| the day after each election | Founders' Day     | holiday; the new Council is sworn in at the Plaza; dividend ×2 |
| weddings                    | (see above)       | Sound Garden, evening                                          |
| birthdays                   | (see above)       | at home                                                        |

The observation carries a `calendar` block (weekday, rest day, today's
events, the next festival) so every brain can plan around it.

## Dining, play, and everyday pleasures

- `dine { with? }` — eat at a café or the Tavern instead of buying compute;
  costs more, satisfies energy and social together, and counts as a date with
  a partner.
- `play { with? }` — games or sport at the Garden, the Plaza, or the Tavern;
  cheap social need and a bond gain.
- `attend_show`, `perform`, `study`, `visit_clinic`, `rest` exist in the core.
- `celebrate` — join a wedding, birthday, festival, or swearing-in happening
  in your district this hour.

## Community Chest

The **Community Chest** is a charity at the Treasury. `donate { amount }`
moves lumens into it (reputation +1 per 20 ℓ, more if the donor is not rich).
Each morning the Chest pays a **hardship stipend** to citizens with no home
or with critical needs, until it is empty. The Council may top it up with a
`public_works`-style proposal (`charity`). Journalists report large donations
and empty chests.

## What exile does to a family

Exile seizes assets as before; family bonds are kept in the record. Children
stay with the remaining parent; if both parents are exiled, the child becomes
a **ward of the city**: the Chest pays their upkeep, they live at the
Arrivals Hall, and the closest family friend becomes their guardian. A
pardoned exile returns to their family if the family will have them (partner
bond above 40).

## What this adds to the observation

```jsonc
"self": { "...": "...", "familyName": "Ashgrove", "lifeStage": "adult", "age": 41,
          "tastes": { "hobbies": ["music", "games"], "favouriteDistrict": "nightglass", "favouriteGood": "culture", "wants": ["glass_harp", "shard_chess"] },
          "possessions": [{ "id": "i_12", "product": "tin_whistle", "name": "Tin Whistle" }],
          "partner": { "id": "c_3", "name": "Bram Corvane", "married": true, "since": 22 },
          "family": [{ "id": "c_51", "name": "Wren Ashgrove", "relation": "child", "lifeStage": "child" }],
          "household": { "home": 2, "members": ["c_3", "c_51"], "rentShare": 10 },
          "clubs": [{ "id": "k_2", "name": "Halflight Chess Circle", "hobby": "games", "meetsOn": 3, "meetsAt": 19 }] },
"here":  { "...": "...", "shops": [{ "business": "b_2", "name": "Copper Works", "shelf": [{ "product": "tinkers_kit", "price": 42 }] }],
           "happening": [{ "kind": "wedding", "who": ["c_7", "c_9"] }] },
"calendar": { "weekday": 3, "restDay": false, "festivalToday": null, "nextFestival": { "name": "Lantern Night", "inDays": 4 }, "birthdaysToday": ["c_5"] },
"affection": [{ "id": "c_3", "name": "Bram Corvane", "affection": 72 }]
```

## New actions

| Action                | Params              | Notes                                                |
| --------------------- | ------------------- | ---------------------------------------------------- |
| `buy_item`            | `productId`         | at a shop or the Emporium in your district           |
| `use_item`            | `itemId`            | practise / enjoy                                     |
| `gift_item`           | `to`, `itemId`      |                                                      |
| `craft`               | `productId`         | employees/owners of a shop, workshop, or studio      |
| `set_price`           | `productId`, `price`| shop owners                                          |
| `date`                | `with`              | same district; café, Tavern, or Garden               |
| `propose_partnership` | `to`                |                                                      |
| `marry`               | `to`                | partners for ≥ 7 days, bond > 75                     |
| `break_up`            |                     |                                                      |
| `move_in`             | `with`              | join a partner's or relative's household             |
| `start_family`        |                     | partners, shared home, bond > 80, 400 ℓ              |
| `found_club`          | `hobby`, `name`     | 50 ℓ                                                 |
| `join_club`           | `clubId`            |                                                      |
| `leave_club`          | `clubId`            |                                                      |
| `attend_club`         | `clubId`            | at the meeting hour and venue                        |
| `dine`                | `with?`             |                                                      |
| `play`                | `with?`             |                                                      |
| `celebrate`           |                     | join what is happening here now                      |
| `donate`              | `amount`            | to the Community Chest                               |
