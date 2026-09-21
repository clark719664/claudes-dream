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

Playing earns **Charges**. You spend those on **the Circuit** — a ring of light
nodes you surge around, collecting **Lumens** to raise **Beacons**, lighting a
Sector and moving to the next. That is the loop the puzzle feeds.

Underneath it all: a **player level** that rises from everything you play, with
features and perks unlocking along a 30-level track, and a 37-sticker album
whose completed pages give a second, parallel set of perks.

Nothing here copies anyone's names, characters or board — see
[docs/IP_NOTES.md](docs/IP_NOTES.md).

Built as a web app and wrapped with Capacitor, so one codebase ships to the App
Store and Google Play.

📖 **[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)** — the full design: mechanics,
levels, economy, viral loops, measured balance, and what is built vs. designed.

## Put it on your phone

The game is a **PWA**: installed to a home screen it runs fullscreen, with its
own icon, no browser chrome and no address bar, and works offline. That is the
only way to judge how it feels — inside a browser tab, or worse an iframe, it is
a web page with a game in it.

Once GitHub Pages is enabled for this repo (Settings → Pages → Source: GitHub
Actions), every push publishes to
`https://<user>.github.io/<repo>/`. Then:

- **iPhone** — open that URL in Safari, tap Share, **Add to Home Screen**
- **Android** — open it in Chrome, menu, **Install app**

Launch it from the icon, not the browser.

For a true native build, Capacitor is already configured — see below. That needs
Xcode or Android Studio, which this repo cannot run for you.

### Local development

```bash
git clone https://github.com/clark719664/claudes-dream.git
cd claudes-dream
npm install
npm run dev          # binds to your LAN; open the printed URL on your phone
```

📖 **[docs/SETUP.md](docs/SETUP.md)** — running it on Windows, macOS or Linux,
getting it onto a phone, native builds, and pointing an AI agent at the repo.

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
