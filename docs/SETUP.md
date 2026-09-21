# Running this on your own machine

Everything here works on Windows, macOS and Linux. Where they differ it says so.

## 1. Install the two things it needs

**Node.js 20.19 or newer** — <https://nodejs.org> → the LTS installer.
On Windows, tick *"Automatically install the necessary tools"* when the
installer offers; it is harmless and saves a headache later.

**Git** — <https://git-scm.com/downloads>.
On Windows this also installs **Git Bash**, which is a far nicer terminal than
`cmd`, and it gives you `zip`, `grep` and friends.

Check both, in a fresh terminal:

```bash
node -v      # v20.19.0 or higher
git --version
```

## 2. Get the code

```bash
git clone https://github.com/clark719664/claudes-dream.git
cd claudes-dream
git checkout claude/viral-mobile-game-collectibles-i538fb
npm install
```

`npm install` takes a minute or two. It pulls in Vite, TypeScript, Playwright
and Capacitor.

## 3. Run it

```bash
npm run dev
```

It prints two addresses:

```
➜  Local:   http://localhost:5173/
➜  Network: http://192.168.1.42:5173/      ← this one
```

Open the **Network** address on your phone, with the phone on the same Wi-Fi.
That is the fastest way to feel whether a change worked. Edits to the source
appear on the phone within a second, no rebuild.

If the phone cannot reach it, it is almost always the Windows firewall — allow
Node.js on private networks when it prompts, or run
`npm run dev -- --host 0.0.0.0`.

## 4. The rest of the commands

| | |
| --- | --- |
| `npm run build` | Typechecks, builds into `dist/`, writes the service worker |
| `npm run preview` | Serves the built version, which is what actually ships |
| `npm test` | Board rules, all 24 levels auto-played, Classic runs. A second or two |
| `npm run typecheck` | TypeScript over `src/` and `test/` |
| `npm run test:browser` | Drives a real browser through the game, the album, the Circuit and the offline install |
| `npm run test:perf` | Frame times under CPU throttling |
| `npm run profile` | A CPU profile of a drag on a full board |
| `npm run icons` | Regenerates the app icons |
| `npm run bundle` | Packages the whole project into one file for handing to another model |

The browser commands need Chromium once:

```bash
npm run setup:browser
```

## 5. Getting it onto a phone as a real app

### A real Android APK — no Mac, no Android Studio, no store account

`.github/workflows/android.yml` builds an installable APK on a free Linux
runner on every push. To get it onto a phone:

1. GitHub → **Actions** → **Android APK** → the latest run
2. Download the **prism-break-debug-apk** artifact and unzip it
3. Put the `.apk` on the phone (email, Drive, USB) and tap it
4. Android will ask you to allow installing from that source — allow it once

That is a genuine native app: its own icon in the launcher, fullscreen, no
browser anywhere in it. It is a *debug* build, so it is signed with Android's
debug key — fine for your own device, not for the Play Store.

### The web app — works on both, installs in seconds

1. Host the built `dist/` somewhere. **This repo is private, and GitHub Pages
   on a private repo needs a paid plan** — so either make the repo public, or
   use **Netlify**, **Vercel** or **Cloudflare Pages**, all of which serve a
   private repo free. Point any of them at this repo with build command
   `npm run build` and publish directory `dist`.
2. On the phone, open the URL and:
   - **iPhone**: Safari → Share → **Add to Home Screen**
   - **Android**: Chrome → menu → **Install app**

Launch it from the icon, not the browser. Fullscreen, no address bar, works
with no signal.

### The full way — a native build

Capacitor is already configured (`capacitor.config.ts`). It wraps the same web
build in a native shell you can put in a store.

```bash
npm run cap:add      # one time: creates ./android and ./ios
npm run android      # build, sync, open in Android Studio
npm run ios          # build, sync, open in Xcode   (macOS only)
```

**Android, on a PC**: install [Android Studio](https://developer.android.com/studio).
First launch, let it download the SDK and a virtual device. `npm run android`
then opens the project and you press Run.

**iOS** needs **Xcode**, which only runs on macOS.

A quick word on the obvious workaround: running macOS in a VM on a PC. It is
technically possible, and it **breaches Apple's software licence**, which
permits virtualising macOS only on Apple-branded hardware. Worth knowing before
you build a release pipeline on top of it.

The ways that do work:

| | What it costs | Good for |
| --- | --- | --- |
| **GitHub Actions macOS runner** | Free minutes, billed at 10× | Building and testing in CI. `.github/workflows/ios.yml` already does this |
| **Rented cloud Mac** | Roughly £0.10–£0.60/hour (Scaleway, MacStadium, AWS EC2 Mac) | Interactive Xcode when you need the simulator or the debugger |
| **A Mac** | Mac mini from ~£599 | Everything, if iOS becomes the main platform |
| **macOS VM on a Mac** | Free, licensed for up to 2 VMs | Clean build environments, once you have a Mac |

`.github/workflows/ios.yml` compiles the app unsigned on a GitHub Mac — real
Apple hardware, properly licensed — which proves it builds. Run it from the
Actions tab. It is manual-trigger only because macOS minutes bill at 10× and go
quickly on a private repo.

Turning that into something installable needs an **Apple Developer account**
($99/year). With one, the same workflow can sign the build and push it to
TestFlight, and you never touch a Mac directly.

For either store you will also need: app icons and splash screens, a signing
certificate, a developer account (Apple $99/year, Google $25 once), a privacy
policy, and store listing copy.

## 6. Pointing an AI agent at it

If you want an assistant working in this repo with a real terminal — able to
run the tests, drive the browser, and open Android Studio — install
[Claude Code](https://claude.ai/code) and run it from the project folder:

```bash
cd claudes-dream
claude
```

It then has the same terminal you do, on your machine, with whatever is
installed on it. That is the main thing a cloud sandbox cannot give you: it has
no GPU, no Android SDK, no Xcode, and no phone to test on.

Worth knowing before you start:

- `npm test` is the guard rail. It auto-plays every level and fails if any
  becomes unwinnable, becomes a walkover, or starts handing out three stars for
  free. Ask for it to be run after any change to `src/game/`.
- `src/game/` is deliberately free of any DOM or canvas reference, which is what
  lets the tests play thousands of moves headlessly. Keep it that way.
- Balance numbers are generated, not hand-picked — see the scripts referenced in
  `docs/GAME_DESIGN.md` §8.
- `docs/IP_NOTES.md` lists what must not be copied. It matters most when asking
  any tool for art.

## Troubleshooting

**`npm install` fails on Windows with node-gyp errors** — usually a stale Node.
Uninstall it, install the current LTS, delete `node_modules` and
`package-lock.json`, try again.

**`npm run dev` says the port is in use** — something else has 5173.
`npm run dev -- --port 5180`.

**Browser tests fail with "executable doesn't exist"** — run
`npm run setup:browser`.

**The phone loads an old version after an update** — the service worker is
serving its cache. Close the app fully and reopen; it takes the new build on
the next launch.
