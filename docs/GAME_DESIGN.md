# Prism Break — Game Design

> Fit the shape. Fill the line. Gather the colour.

## 1. The pitch

A shape-placement puzzle where **the pieces are coloured**, so every placement
is two decisions at once: *does it fit*, and *what colour does it put where*.

A complete row or column clears, the way it does in every block-fitting game.
But five touching tiles of one colour also clear — so the board is simultaneously
a packing problem and a match-3 board, and the best moves satisfy both at once.

Three proven loops, welded into one:

| Borrowed from | What it contributes |
| --- | --- |
| Block Blast / Woodoku | Drag-to-place polyominoes, line clears, no timer |
| Candy Crush | Colour matching, levels, objectives, move limits, a world map |
| Monopoly Go | Sticker album, packs, duplicates, gifting between friends |

## 2. What makes it different

### Two clear rules, both live at once

Every other block-fitting game is colourless: a piece is a shape and nothing
else. Every match-3 game is placeless: you never choose *where* a piece goes,
only which two to swap. Prism Break runs both at the same time, and the tension
between them is the game.

A piece that fits perfectly in the wrong colour is a wasted move. A piece that
lands five violet tiles together but leaves a hole you can never fill is a worse
one. The good moves — a placement that closes a row *and* completes a colour
group, scoring both with a combo multiplier on top — are the ones you have to go
looking for.

To keep colour groups achievable, most levels deal from **three of the five
hues**, chosen by the level id. Across the full palette, five touching
same-colour tiles almost never happen by accident and the colour half of the
game quietly stops existing.

### Nothing moves unless you move it

There is no gravity, no falling, no timer, and no randomness inside a move. A
tile stays exactly where it was put until something clears it, and while you
drag, the board **outlines every tile the placement would clear** — computed by
running the real placement on a copy of the board, not by approximating it.

This is the whole feel of the game. The player is never reacting; they are
deciding. What they are fighting is space.

It is also a constraint on everything added later. An earlier build put a clock
on the board by pushing a new row in from the top every few moves — and it had
to be cut, because it shoved tiles the player had placed. The replacement,
**creep**, only ever fills cells that were already empty. You can take a
player's room away; you cannot move their work.

### Obstacles are worn down, not covered

Stone and crates occupy a cell, so they can never be built over. They are
damaged by clears going off *beside* them — stone takes two, a crate takes
three — and the damage shows as **cracking**, never as a number.

The obvious alternative, requiring a full line straight through the obstacle,
sounds tidier and is unplayable: lines are the rare clear, and objectives built
on them stall out completely. This was measured, not guessed — see §5.

### The board carries no numbers at all

Health is read off the tile face as damage: hairline, split, about to go. A
player should *read* the board, never *count* it, so their attention stays on
colour and space.

### Tile types

| | Behaviour |
| --- | --- |
| **Coloured** | The default. Fills lines, joins colour groups. |
| **Stone** | Colourless obstacle. Never joins a group. Two nearby clears. |
| **Crate** | As stone, but three. |
| **Prism** | Counts as every colour when a group is measured — but is never expanded *from*, so it extends a group without welding two colours together. |
| **Bomb** | Coloured, groups normally, takes its 3×3 with it, chains into other bombs. |

## 3. Levels

**24 levels across 3 worlds**, each authored as a text grid rather than
generated, with an objective, a move limit and three star thresholds.

World 1 teaches lines then groups on an open board; world 2 fills the board with
things in the way; world 3 adds creep. Objectives are `lines`, `groups`,
`clear-hue`, `clear-stone`, `clear-crates`, `clear-preset` (clear everything the
level started with) and `score`.

A level is seeded by its **id alone**, so the board, the deal and the whole
puzzle are identical on every attempt and every device. Retrying is retrying the
same problem, which is what makes a level a level rather than a run.

### The deal is checked, not shuffled blind

Every piece in the tray is checked against the board it is being dealt onto, and
the deal leans harder toward small pieces as the board tightens. A piece already
in the tray that stops fitting gets swapped out once anything has been placed.

A level should end because the player ran out of room or out of moves — never
because the shuffler handed them three pieces that could never have gone
anywhere. That reads as the game cheating, and it is the fastest way to lose a
player.

## 4. The collectible layer

**37 stickers across 5 album pages.** Rarity ★1–★5.

| Page | Completion perk |
| --- | --- |
| Neon Menagerie | +1 move on every level |
| Deep Space | Colour groups trigger at 4 tiles instead of 5 |
| Arcade Legends | Every level opens with a free Prism |
| Cursed Carnival | Bombs blow a 5×5 hole instead of 3×3 |
| Founders (chase) | +25% Prism Shards |

The perks are the point. Monopoly Go's stickers are inert — they buy money and
bragging rights. Here **finishing a page changes how the game plays**, so the
collection loop feeds the skill loop and a returning player is measurably
stronger than last week. That converts a collection from a chore into a build.

### Economy

- **Prism Shards** — earned per level cleared, scaled by stars, with a first-clear
  bonus so replaying an easy level cannot be farmed. Buys packs.
- **Dust** — duplicates melt into 5–300 dust by rarity; dust crafts a *specific*
  missing sticker for 25–1500. The anti-rage valve: the last sticker on a page is
  always reachable by grinding, never purely by luck.

Pack odds are stated openly on the shop screen:

| | ★1 | ★2 | ★3 | ★4 | ★5 | Floor |
| --- | --- | --- | --- | --- | --- | --- |
| Standard (3) | 55% | 27% | 13% | 4.2% | 0.8% | ≥1 ★2+ |
| Prismatic (5) | 22% | 30% | 30% | 14% | 4% | ≥1 ★4+ |

A pull favours stickers you are missing 60% of the time, so early albums fill
fast and the remaining 40% still generates the duplicates that gifting needs.

Packs — not shards — are what players chase, so they hang off moments worth
repeating: a first clear every third level, a Prismatic every ninth, and any
three-star finish.

## 5. Balance, measured

`npm test` auto-plays **all 24 levels** with a bot that plays the way an
attentive player would: it prizes clears, chases whatever the level's objective
actually asks for, avoids leaving unfillable single-cell gaps, and builds toward
colour groups rather than scattering.

Current state: the bot clears **24/24**, finishing with about **40% of the move
budget spare** on average, and three-stars **none** of them. That is the shape
we want — beatable by a thinking player, with the top rating still out of reach
of merely competent play. The suite fails if any level becomes unbeatable, if
any becomes a walkover (won in under five moves), if any leaves over 80% of its
moves unused, or if three stars becomes automatic.

Star thresholds are not hand-picked. They are generated from measured bot
scores — 1★ at 62%, 2★ at 95%, 3★ at 130% — so the ratings track what the level
actually plays like rather than what it looked like it should.

**Four real faults this harness caught**, none of which were visible by reading
the code:

- The deal only fit-checked one of the three pieces, so a nearly empty board
  could deadlock in five moves.
- Pushing rows down meant any tile in the bottom row lost instantly — and the
  bottom row is exactly where players build.
- The hue palette picked three of five *without* including the colours the
  level's own layout used, making those preset tiles literally unclearable.
- Crates could only be caught by full lines, and lines are far too rare to
  build an objective on.

## 6. Viral loops

**1 · Gifting duplicates (built).** A duplicate can be spent to mint a code like
`PB-2KPQ-Y0A`, shared through the native share sheet, redeemed once by whoever
receives it. Monopoly Go's growth engine is people asking friends for the one
sticker they are missing, and it works because the ask is *specific* ("I need
Aurora Whale") — a far better message than "play my game". Every gift is also a
re-engagement ping for the sender.

**2 · Comparable scores (built).** Levels are seeded by id, so two players on
level 14 played the identical puzzle. A shared score is directly comparable,
which turns the share card into a challenge rather than a boast.

**3 · Race a friend's ghost (designed).** Because a level is fully determined,
a friend's attempt replays from nothing but the level id and their move list — a
few hundred bytes, no video, no server-side simulation.

**4 · Crews (designed).** Eight-player groups with a shared weekly album page,
trading spares inside the crew. Collection games live on the social obligation
of not letting your crew down.

## 7. Retention

- **Daily streak** — escalating shards, packs on days 3/6/9, Prismatic on 7.
- **Album completion** — the long-horizon goal that survives a losing streak.
- **Perk compounding** — each finished page makes levels more winnable, which
  earns more shards, which fills the album faster. Bounded by there being only
  five pages.
- **Failure is cheap** — no lives, no energy timer. The game never tells you to
  stop playing.

## 8. Monetisation (designed, not implemented)

Deliberately not built: shipping payments into a prototype is how you end up
tuning an economy nobody has played yet.

- **Cosmetics** — tile skins, clear effects, board themes. Zero pay-to-win.
- **Season pass** — a sixth rotating album page with its own perk.
- **Shard bundles** — accelerate the album; everything in it is reachable free.
- **Remove ads** — one purchase, permanent.
- **Rewarded video** — optional extra moves after a loss, never a mid-level gate.

The line held everywhere: **you can buy speed, never power a free player cannot
also reach.** Set bonuses must stay earnable, or the perk system stops being a
build and becomes a paywall.

## 9. Build status

**Working end to end:** placement and the full clear resolution (lines, colour
groups, prism grouping, bomb chains, obstacle wear), the checked deal, creep,
24 authored levels with objectives and stars, the world map with unlock
progression, the drag preview, the renderer with particles and screen shake,
procedural audio, native haptics, the album, packs with reveals, dust and
crafting, gift codes, daily streak, share cards, save/load and the whole screen
flow.

**Designed but not built:** power-ups, crews, ghost replays, server-backed
leaderboards, payments, ads, push notifications, accounts and cloud save.

**Known limits of the prototype:**

- Gift codes are validated client-side, so a determined player could mint their
  own. Real gifting needs a server to sign and burn codes; the offline scheme
  exists so the loop can be play-tested before any backend does.
- Progress is `localStorage` only — clearing site data or reinstalling loses the
  album. Accounts and cloud save are a launch prerequisite.
- Art is placeholder throughout. [GEMINI_ART_BRIEF.md](GEMINI_ART_BRIEF.md)
  specifies what a designed replacement has to satisfy.
