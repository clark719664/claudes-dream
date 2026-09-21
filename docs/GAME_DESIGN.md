# Prism Break — Game Design

> Fit the shape. Fill the line. Don't run out of room.

## 1. The pitch

A shape-placement puzzle. You are dealt three pieces at a time and drag them
anywhere they fit. **A complete row or column clears — that is the only rule.**
Colour never decides *whether* a line clears. All that matters is whether a
piece fits.

The depth is in the second-order move. Three bonuses sit on top of the one rule,
and chasing them is what separates a 5,000-point run from a 50,000-point one:

| Bonus | Why it is there |
| --- | --- |
| **Multi-line multiplier** — ×2.5 for a double, ×4.5 a triple, ×7 a quad | Makes setting up one big placement strictly better than taking clears as they come |
| **Pure line** — every tile in the cleared line the same colour | Gives colour something to be worth without ever letting it gate a move |
| **Board clear** — the placement empties the board outright | The rarest thing a player can do, and the one they will tell someone about |

Plus a streak multiplier for clearing on consecutive moves.

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

Colour was tried as a second *clear* rule — five touching tiles of one hue — and
cut. It made every placement two decisions instead of one, which sounds like
depth and played as noise: the colour half kept emptying the board before the
packing half got interesting. What replaced it is the **pure line** bonus, which
is the same idea demoted to where it belongs. Colour is now worth *noticing*
without ever being worth *obeying*: a player who ignores it entirely still plays
the game correctly, and one who spots a free pure line gets paid for it.

### The drag is one object, and it is magnetic

The piece you pick up is a single thing for the whole gesture. Over a legal spot
it eases onto the grid; elsewhere it follows your hand. It never switches
between a copy under the finger and a separate ghost in the cells, and it never
jumps between the two — that swap was most of what made dragging feel like two
interactions stitched together.

It grows from tray size to board size as you lift it, a dark footprint shows
where it will land, and anything the placement would clear is ringed before you
let go. One source of truth decides where a drag lands, shared by the renderer
and the input code, so what is drawn and what is placed cannot disagree.

### Animation runs on a clock, not on frames

Every effect advances by elapsed time rather than once per rendered frame.

This was a real bug, not a nicety: on a device managing 30fps, every animation
in the game — the clear sweeps, tiles settling, the drag magnet — ran at exactly
half speed. The game got mushier the slower the device, which is the opposite of
what it should do.

### No pause between moves

The board settles the instant a piece lands — clears resolve inside the
placement — so the next piece can go down immediately. Nothing in the game ever
holds input while an animation finishes.

An earlier build froze input for 18 frames after every clear so the shatter
could play. Three hundred milliseconds sounds like nothing written down; in the
hand it read as the game stopping to think after every good move, which is the
worst possible moment to interrupt someone. The fix is that the animation does
not own the simulation: the board is already settled, and the renderer keeps
drawing the departed tiles on its own for a few frames after they are gone.

What that buys, all of it independent of the game state: cleared tiles swell and
flash white as they leave rather than blinking out, staggered along the line so a
clear travels; a bright wipe runs down the row or column that went; and a placed
piece overshoots its size slightly before settling, so it reads as being put down
rather than appearing.

The drag has one rule of its own: **one piece on screen, not two.** While a
placement is invalid the piece follows the finger, lifted clear of the hand. The
moment it snaps to a legal spot, the floating copy disappears and the tiles draw
in their real cells. Showing both — even faintly — puts two answers to the same
question a cell and a half apart.

### The deal never looks at the board

Three pieces, drawn purely at random from the weighted shape pool. The board is
not consulted, the pieces are not filtered for fit, and nothing shrinks when
space gets tight.

Two earlier versions did help. One fit-checked every dealt piece; another
swapped unplaceable leftovers for something that fitted. The second made the
game **unloseable** — a bot ran 5,000 pieces without ever being stuck. But the
first was the worse mistake, because it was invisible: any deal that reads the
board is the game quietly playing for you, and once a player suspects that,
every good hand feels unearned and every bad one feels rigged.

So the hand is the hand. It can be three pieces that do not fit, and that is the
run. That possibility is what makes the rest of it matter.

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

## 3. The player level

A single track that rises from everything you do — clearing a level, replaying
one, or any Classic run — with rewards hung off it at 13 milestones up to level
30.

This exists because 24 authored levels are finite. Without a track, a player who
finishes them has nothing left to climb and Classic is just a scoreboard. With
it, every run still moves a bar, and the next thing unlocking is always visible
and always close. It is the Monopoly Go shape, and it is the single most
reliable retention structure in the genre.

Early milestones **open features** — packs at 2, gifting at 4, Prismatic packs at
7 — which doubles as onboarding: a new player sees one screen at a time instead
of nine. Later ones **change how the game plays**: extra moves, a fourth and
eventually fifth tray slot, discards for pieces with nowhere to go, bigger
bombs, better shard rates.

The XP curve is deliberately shallow at the start, so the first reward lands
inside the first session, and steepens after, so the track still has somewhere
to go at level 20.

The album is the **other** ladder, deliberately separate: the track rewards
showing up, the album rewards collecting, and their perks stack.

## 4. Levels

**24 levels across 3 worlds**, each authored as a text grid rather than
generated, with an objective, a move limit and three star thresholds.

World 1 teaches fitting and multi-line clears on an open board; world 2 fills the
board with things in the way; world 3 adds creep. Objectives are `lines`,
`clear-stone`, `clear-crates`, `clear-gems`, `clear-preset` (clear everything the
level started with) and `score`.

Two rules govern every layout. **Obstacles come in clusters, never scattered or
striped**, and **a cluster set spans at most four rows.** In a game purely about fitting, a lone tile in open space ruins far
more placements than a 2×2 block against a wall does. A checkerboard of single
stones looks like a fair puzzle and is unplayable — which is exactly what the
first two passes at this table were, and what `npm test` now checks for.

The four-row rule was the surprise: twelve obstacles across six rows chokes the
board dead, while *sixteen* across four rows plays fine. It is rows spanned, not
cell count, that decides whether a layout leaves anywhere to put a piece.

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

## 5. The Circuit

The puzzle is the engine; the Circuit is what it drives.

Clearing a level or finishing a Classic run earns **Charges**. On the Circuit
you spend a Charge to surge forward a few nodes around a ring of lights, and
whatever you land on pays out: **Lumens**, shards, a pack, free Charges, a Relay
that throws you further on, a Prism that doubles your next landing, or a Drain
that takes a cut. Lumens raise **Beacons**, and lighting every Beacon in a
**Sector** opens the next one — three of them, each paying and costing more.

This is the structure that turns a good puzzle into a game people come back to,
and it is worth being precise about why:

- **The puzzle stops being the whole reward.** A level clear now pays into
  something that visibly moves, which is far stronger than a number going up.
- **Two loops on different clocks.** Charges tick back one every 18 minutes to a
  cap of 30. That is the only timer in the game, and it gates **the Circuit
  alone** — levels and Classic are always free and unlimited, because they are
  how you *earn* Charges. A player who wants to keep playing never hits a wall;
  a player who wants a reason to open the app tomorrow has one.
- **Payouts are lumpy on purpose.** A Vault after a Prism pays several times a
  Cache. Lumpy payouts are what make spending a Charge feel like something
  rather than an increment.
- **A Drain can never bankrupt you.** It takes a proportion, never a fixed sum,
  so it is a setback and not a wall.

### On originality

The loop — spend a currency to move round a track, collect where you land, spend
the proceeds on structures, finish a location, move on — is a mechanic, and
mechanics are not what copyright and trademark protect. Expression is: names,
characters, artwork, trade dress.

So none of that is borrowed. The track is a **ring of light nodes**, not a
square board with corner squares and coloured property bands. There is no
mascot, no jail, no chance or community chest by any name, no rent between
players, no houses or hotels. Every currency, Sector and node name is original
and fits this game's own prism-and-light theme.
[docs/IP_NOTES.md](IP_NOTES.md) records the full list of what was avoided and
the rules for keeping it that way. It is not legal advice.

## 6. The collectible layer

**37 stickers across 5 album pages.** Rarity ★1–★5.

| Page | Completion perk |
| --- | --- |
| Neon Menagerie | +1 move on every level |
| Deep Space | One more piece in the tray, always — the strongest perk in the game |
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

## 7. Performance

`npm run test:perf` measures frame times under CPU throttling; `npm run profile`
takes a real CPU profile of a drag on a full board.

Current state: a steady **16.7ms — a clean 60fps — unthrottled**, 22.7ms at 4×.
The JS is about 1% of a frame; the rest is rasterisation.

Three things came out of profiling rather than guessing:

- Tiles were drawn live, each with a fresh gradient and a `shadowBlur` fill.
  They are pre-rendered once and blitted now. A glow is cheap once and ruinous
  sixty-four times a frame.
- The first version of that cache was **slower than no cache at all**: it was
  keyed by the size being drawn, and since a piece being picked up animates its
  scale, the cache invalidated itself every frame and re-rendered every glow.
  Sprites are now rendered once at board size and scaled on the way out.
- The renderer asked the board where every tray piece could fit, and cloned the
  whole board for the drag preview, on every frame. Both are cached against a
  board version counter.

One caveat on the numbers: the test container has **no GPU**, so under heavy
throttling it is software-rasterising two megapixels a frame and the figures
there are pessimistic against any real device.

## 8. Balance, measured

`npm test` auto-plays **all 24 levels** with a bot that plays the way an
attentive player would: it prizes clearing several lines at once, chases whatever the
level's objective actually asks for, avoids leaving unfillable single-cell gaps,
and builds toward
lines that are nearly complete.

Current state: the bot clears **24/24**, finishing with about **11% of the move
budget spare** on average, and three-stars **none** of them. That is the shape
we want — beatable by a thinking player, with the top rating still out of reach
of merely competent play. The suite fails if any level becomes unbeatable, if
any becomes a walkover (won in under five moves), if any leaves over 80% of its
moves unused, or if three stars becomes automatic.

Neither move budgets nor star thresholds are hand-picked. A level is handed an
unlimited budget, the bot plays it, and the budget is set at **112% of what it
needed** — tight enough that a good line is required, with retries free. Stars
come from measured scores at 60%, 95% and 135%.

Levels are seeded by id, so a level is the same puzzle on every attempt; the
measurement is therefore exact rather than an average over luck.

It also plays Classic: ten runs a suite, asserting every one of them *ends*,
that a good player lasts more than 40 pieces on average and fewer than 1200, and
that the same seed replays identically.

**Seven real faults this harness caught**, none of which were visible by reading
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
- An obstacle caught inside a cleared line was deleted outright, so an entire
  cluster vanished in one move and obstacle levels finished before they had
  started. Obstacles are now chipped by a line running through them exactly as
  they are by one going off beside them.
- Move budgets calibrated under the old helping deal were far too tight once the
  deal went random; three levels became unwinnable and four became trivial. Both
  budgets and star thresholds are now measured over seven attempts per level,
  budgeted on the *worst* observed run rather than the median, so an unlucky
  hand is survivable rather than fatal.

## 9. Viral loops

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

## 10. Retention

- **The Circuit** — the primary one. Charges regenerate, so there is always
  something waiting, and spending them is quick and lumpy and satisfying.
- **The player level** — always a next unlock, always close.
- **Daily streak** — escalating shards, packs on days 3/6/9, Prismatic on 7.
- **Album completion** — the long-horizon goal that survives a losing streak.
- **Perk compounding** — each finished page makes levels more winnable, which
  earns more shards, which fills the album faster. Bounded by there being only
  five pages.
- **Failure is cheap** — no lives, no energy timer. The game never tells you to
  stop playing.

## 11. Monetisation (designed, not implemented)

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

## 12. Build status

**Working end to end:** placement and the full clear resolution (lines,
bomb chains, obstacle wear, gems, pure-line and board-clear bonuses), the random
deal, creep, the player level and its 13-step unlock track, Classic endless mode
with its own high score, 24 authored levels with objectives and stars, the world
map with unlock progression, the Circuit with its three Sectors and Beacons,
the drag preview, the renderer with particles and shake,
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
