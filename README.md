# Prism Break

A shape-placement puzzle. You're dealt three pieces at a time and drag them
anywhere they fit. **A complete row or column clears — that's the only rule.**
Colour never decides whether a line clears. All that matters is whether a piece
fits.

The depth is the second-order move. One piece that finishes two or three lines
at once is worth ×2.5, ×4.5 or more — far better than taking clears as they
come. A line where every tile happens to be the same colour pays a bonus, and
emptying the board outright pays a big one. Setting those up without leaving a
hole you can't fill is the game.

The three pieces in your tray are drawn purely at random. The deal never looks
at the board, never filters for fit, and never shrinks pieces when you're
cornered — so a good hand is earned and a bad one is real.

Nothing falls, nothing is on a timer, and the board never moves on its own.
While you drag, it outlines exactly what the placement will clear.

| Mode | |
| --- | --- |
| **Levels** | 24 authored boards across 3 worlds — objective, move limit, three stars, on a map |
| **Classic** | Endless. No move limit. Play until nothing fits and chase your own high score. |

Underneath both: a **player level** that rises from everything you play, with
features and perks unlocking along a 30-level track — and a 37-sticker album
whose completed pages give a second, parallel set of perks.

Built as a web app and wrapped with Capacitor, so one codebase ships to the App
Store and Google Play.

📖 **[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)** — the full design: mechanics,
levels, economy, viral loops, measured balance, and what is built vs. designed.

## Play it

```bash
npm install
npm run dev          # then open the printed URL on your phone (same Wi-Fi)
```

The dev server binds to your LAN, so the fastest way to feel whether it is
actually fun is to open it on a real phone rather than in a desktop browser.

## The rules

1. **Fill a row or column** and it clears. That's it.
2. **Clear more than one at a time** — a double is ×2.5, a triple ×4.5. Clearing
   on consecutive moves builds a streak on top, a same-colour line pays a bonus,
   and emptying the board pays a big one.
3. **Watch the gaps.** When none of your three pieces fits anywhere, it's over —
   so single-cell holes are what actually kill you.

Obstacles can't be built over, so they're worn down by clears going off beside
them, and the damage shows as cracking. The board carries no numbers anywhere.

## Commands

| | |
| --- | --- |
| `npm run dev` | Dev server on your LAN, hot reload |
| `npm run build` | Typecheck + production build into `dist/` (~23 KB gzipped) |
| `npm run preview` | Serve the production build |
| `npm test` | Board rules, level validation, and a bot that plays all 24 levels + Classic |
| `npm run test:browser` | Playwright drags real pieces through a level and the album |
| `npm run typecheck` | TypeScript across `src/` and `test/` |
| `npm run test:perf` | Frame times under CPU throttling |
| `npm run profile` | CPU profile of a drag on a full board |
| `npm run bundle` | Packages the whole project for handing to another model |

`npm test` auto-plays **all 24 levels plus Classic** with a bot that plays the way
an attentive player would. It fails if any level becomes unbeatable, becomes a
walkover, leaves over 80% of its moves unused, starts handing out three stars
automatically, or scatters lone obstacles where clusters belong. For Classic it
asserts every run actually *ends*, that a good player lasts 40+ pieces but under
1200, and that a seed replays identically.

It currently clears 24/24 with ~11% of the move budget spare and three-stars none
of them. Move budgets and star thresholds are both generated from measured bot
play — the budget is set at 112% of what the bot needed — so levels are tight by
construction rather than by guesswork.

## Handing the project to another model

```bash
npm run bundle
```

writes two things into `package/`:

- **`prism-break-source.md`** — the entire project as one file (~165 KB, ~42k
  tokens), with [`docs/GEMINI_ART_BRIEF.md`](docs/GEMINI_ART_BRIEF.md) first so
  a model reads the task before the code it applies to. Upload or paste this.
- **`prism-break-source.zip`** — the same files as a normal archive.

The brief asks for a designed tile set, five tile characters, an expanded tile and
item roster, and a real cracking language for damage — all against the constraints
that make art succeed or fail in *this* game, chiefly that the contrast which must
never be compromised is **filled against empty**, not one colour against another.

## Shipping to iOS and Android

Capacitor is configured; the native projects are generated on a machine with the
platform SDKs (Xcode for iOS, Android Studio for Android):

```bash
npm run cap:add      # one time: creates ./ios and ./android
npm run android      # build, sync, open in Android Studio
npm run ios          # build, sync, open in Xcode
```

`npm run cap:sync` rebuilds the web bundle and pushes it into both native
projects. App id and native theming live in `capacitor.config.ts`.

Still required before a store submission: app icons and splash screens,
signing certificates, store listings, a privacy policy, and an accounts/cloud
save backend so an album survives a reinstall.

## Layout

```
src/
  core/      rng (seeded) · storage · audio · haptics
  game/      config · types · shapes · board · levels · game · render
  meta/      stickers · profile · packs
  ui/        dom · screens
test/        run.ts + bot.ts (headless) · smoke*.mjs (browser)
docs/        GAME_DESIGN.md · GEMINI_ART_BRIEF.md
```

`src/game/` has no DOM or canvas reference anywhere in it, which is what lets
`npm test` play all 24 levels and dozens of Classic runs in a second. Levels are authored as text grids in
`src/game/levels.ts`; all other tuning lives in `src/game/config.ts`.

## Prototype limits

- Art is placeholder throughout — that is what the Gemini brief is for.
- Gift codes are validated on-device, so they could be forged. Real gifting
  needs a server to sign and burn them; the offline scheme exists so the loop
  can be play-tested before there is a backend.
- Progress is `localStorage` only — clearing site data loses the album.
- No power-ups, payments, ads, leaderboards, crews or push notifications; see
  the design doc for how each is meant to work.
