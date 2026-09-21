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

### The quick way — install the web app

No Apple or Google account, no build tools, works today.

1. In the repo on GitHub: **Settings → Pages → Source: GitHub Actions**
2. Push anything. The workflow in `.github/workflows/deploy.yml` publishes to
   `https://clark719664.github.io/claudes-dream/`
3. On the phone open that URL and:
   - **iPhone**: Safari → Share → **Add to Home Screen**
   - **Android**: Chrome → menu → **Install app**

Launch it from the icon, not the browser. It runs fullscreen with no address
bar and works with no signal.

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

**iOS**: needs **Xcode**, which only runs on macOS. There is no way around this
on a PC — not Windows, not Linux. Options are a Mac, a rented cloud Mac
(MacStadium, Scaleway and others rent them by the hour), or shipping Android
first and doing iOS when you have access to one.

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
