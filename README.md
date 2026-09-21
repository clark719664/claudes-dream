# Prism Break

A shape-placement puzzle where **the pieces are coloured**. Drag a piece onto the
board and you decide two things at once: does it fit, and what colour does it put
where. A complete row or column clears — and so do five touching tiles of one
colour. The good moves do both.

Nothing falls, nothing bounces, nothing is on a timer, and the board never moves
on its own. While you drag, it outlines exactly what the placement will clear.
What you are fighting is space.

24 levels across 3 worlds on a map, with objectives, move limits and stars, and a
37-sticker album whose completed pages give permanent gameplay perks.

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

1. **Fill a line.** A complete row or column clears, whatever is in it. This is
   how you get rid of stone, crates and anything else in the way.
2. **Or gather a colour.** Five or more touching tiles of one colour clear on
   their own.
3. **Do both at once** and the combo multiplier makes it worth far more. Clearing
   on consecutive moves builds a streak on top.

Obstacles can't be covered, so they're worn down by clears going off beside them,
and the damage shows as cracking. The board carries no numbers anywhere.

## Commands

| | |
| --- | --- |
| `npm run dev` | Dev server on your LAN, hot reload |
| `npm run build` | Typecheck + production build into `dist/` (~23 KB gzipped) |
| `npm run preview` | Serve the production build |
| `npm test` | Board rules, level validation, and a bot that plays all 24 levels |
| `npm run test:browser` | Playwright drags real pieces through a level and the album |
| `npm run typecheck` | TypeScript across `src/` and `test/` |
| `npm run bundle` | Packages the whole project for handing to another model |

`npm test` auto-plays **all 24 levels** with a bot that plays the way an attentive
player would, and fails if any level becomes unbeatable, becomes a walkover, leaves
over 80% of its moves unused, or starts handing out three stars automatically. It
currently clears 24/24 with ~40% of the move budget spare and three-stars none of
them — beatable by thinking, with the top rating still out of reach.

Star thresholds are generated from measured bot scores rather than hand-picked,
so ratings track what a level actually plays like.

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
that make art succeed or fail in *this* game, chiefly that colour is the mechanic
and must never be competed with.

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
`npm test` play all 24 levels in a second. Levels are authored as text grids in
`src/game/levels.ts`; all other tuning lives in `src/game/config.ts`.

## Prototype limits

- Art is placeholder throughout — that is what the Gemini brief is for.
- Gift codes are validated on-device, so they could be forged. Real gifting
  needs a server to sign and burn them; the offline scheme exists so the loop
  can be play-tested before there is a backend.
- Progress is `localStorage` only — clearing site data loses the album.
- No power-ups, payments, ads, leaderboards, crews or push notifications; see
  the design doc for how each is meant to work.
