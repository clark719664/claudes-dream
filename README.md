# Prism Break

A one-thumb mobile brick breaker where the ball **takes the colour of whatever
it hits**, and hitting your own colour shatters the block outright and carries
you straight on through it. The wall then collapses like a match-3 board, and
every collapse pays into a collectible sticker album whose completed pages give
you permanent gameplay perks.

Built as a web app and wrapped with Capacitor, so the same codebase ships to the
App Store and Google Play.

📖 **[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)** — the full design: mechanics,
economy, viral loops, retention, monetisation, and what is built vs. designed.

## Play it

```bash
npm install
npm run dev          # then open the printed URL on your phone (same Wi-Fi)
```

The dev server binds to your LAN, so the fastest way to feel whether it is
actually fun is to open it on a real phone rather than in a desktop browser.

## The two rules

1. **Same colour → shatter and pierce.** The block dies whatever its health, you
   do not bounce, and you speed up.
2. **Different colour → chip and repaint.** You chip it, you bounce, and **you
   become that colour.**

Every bounce burns one of a ball's 11 energy and it burns out at zero. Piercing
costs nothing and gives energy back — so reading the wall well is what keeps a
volley alive.

## Commands

| | |
| --- | --- |
| `npm run dev` | Dev server on your LAN, hot reload |
| `npm run build` | Typecheck + production build into `dist/` (~23 KB gzipped) |
| `npm run preview` | Serve the production build |
| `npm test` | Headless mechanics tests + a balance simulation |
| `npm run test:browser` | Playwright walk-through of the game and the album |
| `npm run typecheck` | TypeScript across `src/` and `test/` |
| `npm run bundle` | Packages the whole project for handing to another model |

`npm test` auto-plays full runs and asserts the difficulty curve still holds —
that random play dies around wave 22, that a targeting heuristic roughly doubles
that, and that neither can play forever. A balance change that flattens the
skill ceiling fails the suite.

## Handing the project to another model

```bash
npm run bundle
```

writes two things into `package/`:

- **`prism-break-source.md`** — the entire project as one file (~165 KB, ~42k
  tokens), with [`docs/GEMINI_ART_BRIEF.md`](docs/GEMINI_ART_BRIEF.md) first so
  a model reads the task before the code it applies to. Upload or paste this.
- **`prism-break-source.zip`** — the same files as a normal archive.

The brief asks for a designed block set, five block characters, an expanded
block and item roster, and a real visual language for health — all against the
constraints that make art succeed or fail in *this* game, chiefly that colour is
the mechanic and must never be competed with.

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
  core/      rng (seeded, for daily challenges) · storage · audio · haptics
  game/      config · types · grid · physics · game · render
  meta/      stickers · profile · packs
  ui/        dom · screens
test/        run.ts (headless) · smoke*.mjs (browser)
docs/        GAME_DESIGN.md
```

`src/game/` has no DOM or canvas reference anywhere in it, which is what lets
`npm test` auto-play thousands of waves in a second. All balance tuning lives in
`src/game/config.ts`.

## Prototype limits

- Gift codes are validated on-device, so they could be forged. Real gifting
  needs a server to sign and burn them; the offline scheme exists so the loop
  can be play-tested before there is a backend.
- Progress is `localStorage` only — clearing site data loses the album.
- No payments, ads, leaderboards, crews or push notifications; see the design
  doc for how each is meant to work.
