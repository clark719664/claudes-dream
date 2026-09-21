# Prism Break — Game Design

> Chain the colours. Collapse the wall. Fill the album.

## 1. The pitch

A one-thumb brick breaker where **the ball takes on the colour of whatever it
hits**, and hitting your own colour shatters the block instantly and lets you
carry straight on through it. The wall then collapses like a match-3 board, and
every collapse pays out currency for a Monopoly-Go-style sticker album whose
completed pages give you permanent gameplay perks.

Three proven loops, welded into one:

| Borrowed from | What it contributes |
| --- | --- |
| Ballz / Bricks n Balls | Turn-based aim-and-shoot, readable on a phone, one thumb |
| Candy Crush | Colour matching, gravity collapse, cascade chains |
| Monopoly Go | Sticker album, packs, duplicates, gifting between friends |

## 2. The two rules that make it different

Everything in the game falls out of two sentences:

1. **Same colour → shatter and pierce.** The block dies whatever its health, the
   ball does not bounce, and it speeds up. Consecutive pierces build a streak.
2. **Different colour → chip and repaint.** You take one health off, you bounce,
   and **you become that colour.**

That second rule is the whole design. In every other brick breaker, the ball is
a constant and the wall is the variable. Here the wall *edits your ball*. You
are not aiming at a block — you are aiming at a block **in order to become the
colour that unlocks the next four**. It turns a reflex game into a routing
puzzle you solve in the half-second before you release your thumb.

### The energy budget

A ball carries **11 energy**. Every bounce — wall or block — costs one, and the
ball burns out at zero. A resonance pierce costs nothing and refunds one, up to
a cap of 17.

This is the balancing spine of the game. Flailing ends a volley in about four
seconds. A well-read colour chain keeps one ball alive across the whole board.
It means skill expresses itself as *volley length*, which is the most legible,
most satisfying thing a player can watch happen.

### The wall hangs from the ceiling

Gravity pulls blocks **up**, not down. The wall is anchored to the top of the
screen and grows toward you.

- Each turn a new row is inserted at the ceiling and shoves everything one row
  closer to the danger line.
- Carving a hole anywhere makes the blocks below it rise to fill it, so the
  wall's leading edge **recedes away from you**.

Clearing therefore buys back distance directly, and the screen reads as one
mass being eaten from inside rather than a row-by-row grind.

### Cascades

When the volley ends, gravity settles and any orthogonally-connected group of
**5+ blocks of one colour detonates on its own**, which collapses the wall
again, which can form another group. Each chain step multiplies score by
`1 + 0.75 × (chain − 1)`.

Crucially, cascades resolve **after** the volley, not during it. The volley is
the input; the collapse is the payoff. That separation gives every turn a clean
two-beat rhythm: *tension while the ball flies, release when the wall falls in.*

### Health without digits

The board carries no numbers. Health is read off the block's face: a **stud** is
worth 1 and a **plate** frame is worth 4, so 3 is two studs, 5 is a plate, and 7
is a plate and two studs. Every hit visibly strips a mark, which teaches the
scheme without a line of tutorial text, and keeps the player *reading* the wall
rather than *counting* it. The current marks are placeholder art;
[GEMINI_ART_BRIEF.md](GEMINI_ART_BRIEF.md) specifies what a designed
replacement has to satisfy.

### Block types

| | Behaviour |
| --- | --- |
| **Coloured** | The default. Resonates with its own hue, joins cascades. |
| **◈ Prism** | Resonates with *every* hue and leaves your colour alone. Joins a cascade group but never bridges two colours together. |
| **✦ Bomb** | Coloured, one health, takes its 3×3 neighbourhood with it. Chains into other bombs. |
| **Grey stone** | Never resonates, never cascades. Pure health. The thing that makes a board hard. |

## 3. Session shape

A run is 2–5 minutes, ends in failure, and hands you currency on the way out —
the arcade/roguelite shape that makes "one more go" the default.

Pacing levers, all in `src/game/config.ts`:

- Rows get denser and gain health as waves climb.
- Grey stone creeps in from 0% to 22%.
- From wave 16, **two** rows arrive per turn; from wave 32, three.
- `+1 BALL` pickups appear every fourth wave, capped at 12 balls so the volley
  cannot snowball into an auto-win.

### Measured balance

From `npm test`, which auto-plays full runs headlessly:

| Play style | Waves survived (avg) | Range |
| --- | --- | --- |
| Random aiming | 22.5 | 15–33 |
| Simple targeting heuristic | 39.8 | 27–61 |

A crude bot that just aims at the lowest resonant block nearly doubles a random
player's run. That gap **is** the skill ceiling, and it is checked on every test
run so a balance change cannot quietly flatten it.

## 4. The collectible layer

**37 stickers across 5 album pages.** Rarity ★1–★5.

| Page | Completion perk |
| --- | --- |
| Neon Menagerie | +1 ball in every volley |
| Deep Space | Cascades trigger at 4 blocks instead of 5 |
| Arcade Legends | Every run opens with a free Prism row |
| Cursed Carnival | Bombs blow a 5×5 hole instead of 3×3 |
| Founders (chase) | +25% Prism Shards from every run |

The perks are the point. Monopoly Go's stickers are inert — they buy you money
and bragging rights. Here **finishing a page changes how the game plays**, so
the collection loop feeds the skill loop and a returning player is measurably
stronger than they were last week. That is what converts a collection from a
chore into a build.

### Economy

- **Prism Shards** — the run currency. Earned per block, per cascade block, per
  wave, and a 150-shard bonus for a full-board clear. Buys packs.
- **Dust** — duplicate currency. A duplicate melts into 5–300 dust by rarity;
  dust crafts a *specific* missing sticker for 25–1500. This is the anti-rage
  valve: the last sticker on a page is always reachable by grinding, never
  purely by luck.

Pack odds are stated openly on the shop screen (required in several
jurisdictions anyway, and players trust a game that volunteers them):

| | ★1 | ★2 | ★3 | ★4 | ★5 | Floor |
| --- | --- | --- | --- | --- | --- | --- |
| Standard (3) | 55% | 27% | 13% | 4.2% | 0.8% | ≥1 ★2+ |
| Prismatic (5) | 22% | 30% | 30% | 14% | 4% | ≥1 ★4+ |

A pull favours stickers you are missing 60% of the time, so early albums fill
fast and the remaining 40% still generates the duplicates that gifting needs.

### Where packs come from

Packs — not shards — are the thing players chase, so they are attached to the
moments worth repeating: wave 12, 24 and 36 in a single run; a new personal
best; any chain of ×4 or higher; day 3, 6, 9… of a login streak, with a
Prismatic pack every 7th day.

## 5. Viral loops

This is the part that decides whether the game grows, and it is designed as
four separate loops rather than one share button.

**1 · Gifting duplicates (built).** Any duplicate can be spent to mint a code
like `PB-2CZC-F0J`, shared through the native share sheet, and redeemed once by
whoever receives it. Monopoly Go's growth engine is people asking friends for
the one sticker they are missing, and it works because the ask is *specific*
("I need Aurora Whale"), which is a far better message than "play my game".
Every gift is also a re-engagement ping for the sender.

**2 · Seeded daily challenge (built).** Everyone in the world plays the exact
same board each UTC day, because the level generator is a seeded PRNG. Same
seed, same wall, no excuses — which makes a shared score directly comparable
and turns the share card into a genuine challenge rather than a boast.

**3 · Ghost races (designed).** Because a run is fully determined by its seed,
a friend's run can be replayed as a translucent ghost alongside yours from
nothing but the seed and their input list — a few hundred bytes, no video, no
server-side simulation.

**4 · Crews (designed).** Eight-player groups with a shared weekly album page.
Members trade spares inside the crew. Collection games live or die on the
social obligation of not letting your crew down.

The share card carries score, wave, best chain and the day's seed, so a
screenshot is playable content rather than a static brag.

## 6. Retention

- **Daily streak** — escalating shards, packs on days 3/6/9, Prismatic on 7.
- **Album completion** — the long-horizon goal that survives losing streaks.
- **Perk compounding** — each finished page makes runs longer, which earns more
  shards, which fills the album faster. A deliberate positive feedback loop for
  returning players, bounded by there being only five pages.
- **Failure is cheap** — every run pays out. There is no lives system and no
  energy timer; the game never tells you to stop playing.

## 7. Monetisation (designed, not implemented)

Deliberately not built: shipping payments into a prototype is how you end up
tuning an economy nobody has played yet.

- **Cosmetics** — ball trails, block skins, shatter effects. Pure expression,
  zero pay-to-win.
- **Season pass** — a sixth, rotating album page with its own perk.
- **Shard bundles** — accelerate the album; everything in it is reachable free.
- **Remove ads** — one purchase, permanent.
- **Rewarded video** — optional double-shards at the end of a run, never a
  gate mid-run.

The line held everywhere: **you can buy speed, never power that a free player
cannot also reach.** Set bonuses must stay earnable, or the perk system stops
being a build and starts being a paywall.

## 8. Build status

**Working end to end:** the full simulation (physics, resonance, absorb, energy,
gravity, cascades, bomb chains, pickups, wave ramp, danger line), the renderer
with particles and screen shake, procedural audio, native haptics, the album,
packs with reveals, dust and crafting, gift codes, daily streak, daily
challenge, share cards, save/load, and the whole screen flow.

**Designed but not built:** crews, ghost races, server-backed leaderboards,
payments, ads, push notifications, accounts and cloud save.

**Known limits of the prototype:**

- Gift codes are validated client-side, so a determined player could mint their
  own. Real gifting needs a server to sign and burn codes. The offline scheme
  exists so the loop can be play-tested before any backend exists.
- Progress is `localStorage` only — clearing site data or reinstalling loses the
  album. Accounts and cloud save are a prerequisite for launch.
- No tutorial beyond the How-to-play card; the real version should teach the
  repaint rule by making the first board a single guaranteed chain.
