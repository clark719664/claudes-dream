# Discord music bridge

Plays audio from an external music app into a Discord voice channel.

## Why it's built this way

Discord has exactly two extension points: **bots**, which run on a server, and
**Activities**, which are web pages in an iframe. Neither can host an Android
app. So an APK cannot be "ported into" Discord — there is nowhere for it to
run.

What works instead: your app tells a small bridge service what it's playing,
and a Discord bot plays that into a voice channel. Your app stays your app. It
implements four method calls and nothing else; no source is shared, nothing is
decompiled, and the bridge never sees anything you don't send it.

```
   your app  ──── pairing code + now-playing ────►  bridge  ──►  bot  ──►  voice channel
   (Android)  ──── audio, if you choose relay ───►
```

## Layout

| Package     | What it is                                                      |
| ----------- | --------------------------------------------------------------- |
| `shared/`   | the wire protocol, shared by everything TypeScript               |
| `bridge/`   | the service: pairing, sessions, audio buffering                  |
| `bot/`      | the Discord bot: slash commands and voice playback               |
| `simulator/`| a fake device, for testing the Discord half without your app     |
| `android/`  | Kotlin client to drop into your app, plus an integration guide   |

## Setup

```bash
npm install
npm run build
cp .env.example .env    # then fill it in
```

You need a Discord application from
[the developer portal](https://discord.com/developers/applications): create
one, add a bot, copy the token and application ID into `.env`. Invite it with
the `bot` and `applications.commands` scopes and the **Connect** and **Speak**
permissions.

Generate the shared secret with `openssl rand -base64 32`.

Then run both processes:

```bash
set -a && source .env && set +a
npm run bridge   # in one terminal
npm run bot      # in another
```

## Commands

| Command        | What it does                                      |
| -------------- | ------------------------------------------------- |
| `/link`        | shows a pairing code, visible only to you         |
| `/unlink`      | disconnects your device                           |
| `/play`        | brings your app's audio into your voice channel   |
| `/stop`        | stops and leaves                                  |
| `/nowplaying`  | shows the current track                           |
| `/status`      | lists devices linked to this server               |
| `/skip` `/previous` `/pause` `/resume` | forwarded to your app     |

## Testing without your app

The simulator impersonates a device on the same protocol your app will use.
Run it to prove the Discord half works before you write any integration code —
then if something breaks after you wire your app in, you know which side.

```bash
# In Discord: /link, which gives you a six-character code.
npm run simulator -- --code ABC123                      # a test tone
npm run simulator -- --code ABC123 --file ./track.mp3   # a real file
npm run simulator -- --code ABC123 --url https://…/s.mp3
```

Then `/play` in Discord. The tone steps in pitch every two seconds, so
stuttering, looping, and wrong-sample-rate problems are all audible
immediately.

## Connecting your own app

See [`android/README.md`](android/README.md). The short version: pair once
with a code, then call `publish()` on every track change. Choose **URL mode**
unless your audio exists only on the device — it costs no upload bandwidth, no
battery, and keeps playing when the screen is off.

The wire format is documented in [`docs/PROTOCOL.md`](docs/PROTOCOL.md). If
your app isn't Android, that document is all you need; nothing about the
bridge is Android-specific.

## Deployment notes

- **The bridge needs to be reachable from both the phone and the bot.** On a
  VPS put it behind TLS; `wss://` is required if your app targets modern
  Android without a network security exception.
- **State is in memory.** A bridge restart means everyone re-pairs. That's a
  deliberate trade — persisting device tokens means storing credentials — but
  don't restart it casually mid-session.
- **`BRIDGE_SECRET` authenticates the bot, not devices.** Never ship it in
  your APK.

## Known issue

`@discordjs/opus` pulls in an old `tar` through its native build chain, which
has a critical advisory and no upstream fix. It's install-time only and never
handles untrusted input here. If you'd rather not have it in your tree, swap
it for `opusscript` — pure JavaScript, somewhat more CPU per stream, no native
build step.
