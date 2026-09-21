# Prism Break — notes for whoever picks this up

A shape-placement puzzle (drag polyominoes onto an 8×8 grid, complete a row or
column to clear it) feeding a travel-and-build progression loop. Built as a web
app, wrapped with Capacitor for native, installable as a PWA.

Start with [docs/SETUP.md](docs/SETUP.md) to get it running, then
[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) for why it is the way it is.

## The one thing to do first

**Get the APK onto a real phone.** Actions → *Android APK* → download the
artifact → sideload it. Everything before this was judged inside an artifact
iframe on claude.ai, which is a page nested in another page — a bad harness,
and very likely the source of the "clunky" complaint that three rounds of
tuning did not fix. Until it has been played as a real app, treat feel feedback
as unattributed.

## Guard rails

- **`npm test` is the contract.** It auto-plays all 24 levels and Classic runs,
  and fails if a level becomes unwinnable, becomes a walkover, leaves over 35%
  of its move budget unused, hands out three stars automatically, or scatters
  lone obstacles where clusters belong. Run it after anything in `src/game/`.
- **`src/game/` has no DOM or canvas reference.** That is what lets the tests
  play thousands of moves headlessly. `render.ts` is the only file that draws.
- **Balance numbers are generated, not chosen.** Move budgets are 112% of what
  the bot needed; star thresholds come from measured scores. Do not hand-edit
  them — re-measure. The scripts are described in `docs/GAME_DESIGN.md` §8.

## Things learned the hard way

Each of these was a real bug found by measuring, not by reading:

- **The deal must never read the board.** Fit-checking dealt pieces, or
  shrinking them when space runs short, is the game quietly playing for the
  player. A version that swapped unplaceable pieces out made it *unloseable* —
  the bot ran 5,000 pieces without being stuck. There is a test for this.
- **Obstacle layouts: clusters, and at most four rows spanned.** Twelve
  obstacles across six rows chokes the board dead; sixteen across four plays
  fine. Rows spanned, not cell count.
- **Obstacles are chipped, never deleted outright by a line.** Deleting made a
  whole cluster vanish in one move and obstacle levels ended before they began.
- **Nothing may hold input while an animation plays.** A 300ms freeze after
  each clear read as the game stopping to think after every good move.
- **Renderer animation runs on elapsed time, not per frame.** Per-frame meant
  everything ran at half speed on a 30fps device.
- **Sprite caches keyed by draw size are worse than no cache.** A piece being
  picked up animates its scale, so the cache invalidated every frame.
- Profile before optimising: `npm run profile`. JS is ~1% of a frame here.

## Do not copy anything

Read [docs/IP_NOTES.md](docs/IP_NOTES.md) before adding content or briefing any
art tool. No existing game is named anywhere in this repo, deliberately — an
artist told to match a named game will reproduce its trade dress. The track is
a ring of light nodes, not a square board with corner squares and coloured
property bands. Not legal advice; a solicitor should see it before release.

## State

Working: the puzzle, 24 levels across 3 worlds, endless Classic, the Circuit
(3 sectors, Charges/Lumens/Beacons), a 30-level player track with 13 unlocks,
a 37-sticker album with packs, dust, crafting and offline gift codes, PWA
install with offline play, and CI for an Android APK and an iOS compile.

Not built: power-ups, crews, leaderboards, payments, ads, accounts and cloud
save (progress is `localStorage` only — it does not survive a reinstall).
Art is placeholder throughout; `docs/GEMINI_ART_BRIEF.md` is the brief for
replacing it.

Open question: whether it actually feels good on a phone. Nobody has played it
as an installed app yet.
