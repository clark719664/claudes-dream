# Bridge protocol

Version 1. The authoritative definition is `shared/src/protocol.ts`; this
document explains the parts your app needs and why they work the way they do.

Three parties speak it:

| Party  | Authenticates with          | Talks to      |
| ------ | --------------------------- | ------------- |
| Device | a device token from pairing | bridge        |
| Bot    | the shared `BRIDGE_SECRET`  | bridge        |
| Bridge | —                           | owns all state |

The device and the bot never talk directly, and the device never learns the
bot's secret. That is deliberate: a phone is the easiest thing in the system
to lose.

## Pairing

1. A user runs `/link` in Discord. The bot asks the bridge for a code and
   shows it to that user only.
2. Your app posts the code to `POST /v1/pair` with a device name.
3. The bridge returns a `deviceToken`. Store it; the user never pairs again
   unless they unlink.

Codes are six characters from an alphabet with no `O`/`0` or `I`/`1`, expire
after five minutes, and are single use. A user has one device at a time —
pairing again replaces the previous one.

## Control channel

`WS /v1/device?token=<deviceToken>`, JSON in both directions.

Device sends:

| Message      | When                                        |
| ------------ | ------------------------------------------- |
| `hello`      | on connect, to report the device name       |
| `nowplaying` | on every track change                       |
| `position`   | about once a second, to drive the embed     |
| `state`      | on play/pause/stop                          |
| `ack`        | after acting on a command                   |
| `bye`        | on a clean shutdown                         |

Bridge sends:

| Message     | Meaning                                       |
| ----------- | --------------------------------------------- |
| `welcome`   | connection accepted                           |
| `command`   | someone ran a playback slash command          |
| `listeners` | how many Discord listeners are attached       |
| `error`     | your last message was malformed               |
| `bye`       | the session is being closed                   |

Commands are advisory. Ack with `ok: false` and the bot tells the user your
app declined; nothing breaks.

## Audio

`source.kind` on each `nowplaying` decides where audio comes from.

**`url`** — you supply a URL the bot fetches itself. No upload from the phone,
no battery cost, no quality loss, and playback survives the phone sleeping.
Use this whenever the audio is reachable from the server.

**`relay`** — you stream PCM up `WS /v1/device/audio?token=...` as binary
frames. Required format, no exceptions:

```
48000 Hz, 2 channels, signed 16-bit little-endian
```

That is 192 000 bytes per second, ~1.5 Mbit/s up. Send it paced at wall-clock
speed — dumping a file as fast as it reads will overrun the buffer and get
dropped. The bridge holds `BRIDGE_PREBUFFER_MS` before playback starts and
substitutes silence if you fall behind, so a network stall becomes a gap in
the music rather than the bot leaving the channel.

Getting the sample rate wrong is the single most common integration bug. At
44.1 kHz everything plays about 9% fast and slightly sharp.

**`metadata`** — Discord shows the track, plays nothing. Useful for a
now-playing display without the bandwidth.

## HTTP endpoints

Device-facing (no secret):

- `POST /v1/pair` — `{ code, device }` → `{ sessionId, deviceToken, guildId, userId }`

Bot-facing (`Authorization: Bearer <BRIDGE_SECRET>`):

- `POST /v1/pairing/code` — mint a code for a user
- `GET /v1/sessions` — list sessions, optionally `?guildId=`
- `GET /v1/sessions/:id/stream` — real-time PCM, never ends
- `POST /v1/sessions/:id/command` — forward a command to the device
- `DELETE /v1/sessions/:id` — unlink

`GET /healthz` is open.

## State and restarts

Everything lives in memory. If the bridge restarts, devices re-pair. Storing
device tokens on disk would mean persisting credentials, which isn't worth it
for a service this small — but it does mean you shouldn't restart the bridge
casually while people are listening.
