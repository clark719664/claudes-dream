# Prism Break — Game Design

> Fit the shape. Fill the line. Don't run out of room.

## 1. The pitch

A shape-placement puzzle. You are dealt three pieces at a time and drag them
anywhere they fit. **A complete row or column clears — that is the only rule.**
Colour is decoration. All that matters is whether a piece fits.

The depth is in the second-order move: a single piece that finishes two or three
lines at once is worth far more than clearing them one at a time, and clearing on
consecutive moves builds a streak on top. Setting those up, while never leaving a
hole you can't fill, is the game.

Two modes, and a collection sitting under both:

| Mode | What it is |
| --- | --- |
| **Levels** | 24 authored boards across 3 worlds, each with an objective, a move limit and three star thresholds, on a map with unlock progression |
| **Classic** | Endless. One board, no move limit, play until nothing fits. Chase your own high score. |

| Borrowed from | What it contributes |
| --- | --- |
| Block Blast / Woodoku | Drag-to-place polyominoes, line clears, no timer, endless mode |
| Candy Crush | Levels, objectives, move limits, stars, a world map |
| Monopoly Go | Sticker album, packs, duplicates, gifting between friends |

## 2. What makes it different

### One rule, and a second-order move

The rule is trivial to explain and takes a long time to play well. Anyone
understands "fill a row" in three seconds. What separates a 5,000-point Classic
run from a 50,000-point one is never the rule — it is whether you are building
toward *two lines at once*, and whether the gaps you leave behind are fillable.

Colour was tried as a second clear rule — five touching tiles of one hue — and
cut. It made every placement two decisions instead of one, which sounds like
depth and played as noise: the colour half kept emptying the board before the
packing half could get interesting. Five hues remain purely so a packed board
stays readable, because a wall of one colour is much harder to parse than a
mixed one.

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
damaged by clears going off *beside* them, twice each, and the damage shows as
**cracking**, never as a number.

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
| **Coloured** | The default. Its colour is decoration; all it does is fill a cell. |
| **Stone** | Obstacle. Cannot be built over. Two nearby clears. |
| **Crate** | As stone, visually distinct. |
| **Gem** | Worth a lot of score, but only a line can reach one. |
| **Bomb** | Takes its 3×3 with it when a line clears it, chains into other bombs. |

## 3. Levels

**24 levels across 3 worlds**, each authored as a text grid rather than
generated, with an objective, a move limit and three star thresholds.

World 1 teaches fitting and multi-line clears on an open board; world 2 fills the
board with things in the way; world 3 adds creep. Objectives are `lines`,
`clear-stone`, `clear-crates`, `clear-gems`, `clear-preset` (clear everything the
level started with) and `score`.

One rule governs every layout: **obstacles come in clusters, never scattered or
striped.** In a game purely about fitting, a lone tile in open space ruins far
more placements than a 2×2 block against a wall does. A checkerboard of single
stones looks like a fair puzzle and is unplayable — which is exactly what the
first two passes at this table were, and what `npm test` now checks for.

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
| Deep Space | A fourth piece in the tray, always — the strongest perk in the game |
| Arcade Legends | Throw away one piece you cannot use, every level |
| Cursed Carnival | Bombs blow a 5×5 hole instead of 3×3 |
| Founders (chase) | +25% Prism Shards |

The perks are the point. Monopoly Go's stickers are inert — they buy money and
bragging rights. Here **finishing a page changes how the game plays**, so the
collection loop feeds the skill loop and a returning player is measurably
stronger than last week. That converts a collection from a chore into a build.

### Economy

- **Prism Shards** — earned per level cleared, scaled by stars, with a first-clear
  bonus so replaying an easy level cannot be farmed. Classic pays out by score,
  capped per run, so the endless mode still feeds the album once the levels are
  done. Buys packs.
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
attentive player would: it prizes clearing several lines at once, chases whatever the
level's objective actually asks for, avoids leaving unfillable single-cell gaps,
and builds toward
lines that are nearly complete.

Current state: the bot clears **24/24**, finishing with about **30% of the move
budget spare** on average, and three-stars **none** of them. That is the shape
we want — beatable by a thinking player, with the top rating still out of reach
of merely competent play. The suite fails if any level becomes unbeatable, if
any becomes a walkover (won in under five moves), if any leaves over 80% of its
moves unused, or if three stars becomes automatic.

Star thresholds are not hand-picked. They are generated from measured bot
scores — 1★ at 62%, 2★ at 95%, 3★ at 130% — so the ratings track what the level
actually plays like rather than what it looked like it should.

It also plays Classic: ten runs a suite, asserting every one of them *ends*,
that a good player lasts more than 40 pieces on average and fewer than 1200, and
that the same seed replays identically.

**Five real faults this harness caught**, none of which were visible by reading
the code:

- The deal only fit-checked one of the three pieces, so a nearly empty board
  could deadlock in five moves.
- Pushing rows down meant any tile in the bottom row lost instantly — and the
  bottom row is exactly where players build.
- The hue palette picked three of five *without* including the colours the
  level's own layout used, making those preset tiles literally unclearable.
- Crates could only be caught by full lines, and lines are far too rare to
  build an objective on.
- Swapping unplaceable tray pieces out for ones that fit — added to stop unfair
  deadlocks — made the game effectively **unloseable**: the bot ran 5,000 pieces
  in Classic without ever being stuck. A hand now stands once dealt. Being able
  to run out of room *is* the game.

## 6. Viral loops

**1 · Gifting duplicates (built).** A duplicate can be spent to mint a code like
`PB-2KPQ-Y0A`, shared through the native share sheet, redeemed once by whoever
receives it. Monopoly Go's growth engine is people asking friends for the one
sticker they are missing, and it works because the ask is *specific* ("I need
Aurora Whale") — a far better message than "play my game". Every gift is also a
re-engagement ping for the sender.

**2 · Comparable scores (built).** Levels are seeded by id, so two players on
level 14 played the identical puzzle. A shared score is directly comparable,
which turns the share card into a challenge rather than a boast. A Classic run
carries its own seed for the same reason — a friend can be handed the exact same
sequence of pieces.

**3 · Race a friend's ghost (designed).** Because a level is fully determined,
a friend's attempt replays from nothing but the seed and their move list — a few
hundred bytes, no video, no server-side simulation. Classic high-score runs
replay the same way, which makes a disputed score checkable.

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
- **Rewarded video** — optional extra moves after a loss, or one continue in
  Classic, never a mid-level gate.

The line held everywhere: **you can buy speed, never power a free player cannot
also reach.** Set bonuses must stay earnable, or the perk system stops being a
build and becomes a paywall.

## 9. Build status

**Working end to end:** placement and the full clear resolution (lines,
bomb chains, obstacle wear, gems), the checked deal, creep, Classic endless mode
with its own high score, 24 authored levels with objectives and stars, the world
map with unlock progression, the drag preview, the renderer with particles and shake,
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
