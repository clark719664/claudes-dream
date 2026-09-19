# Android integration

Drop these three files into your app and call four methods. Nothing here reads
your player, your library, or your UI, and none of it needs your source to be
shared with anyone.

```
android/kotlin/com/dreambridge/
├── Models.kt          wire types
├── DiscordBridge.kt   the client — this is the whole API
└── Media3Tap.kt       optional, only for relay mode
```

## Dependency

Only OkHttp, which you very likely already have:

```kotlin
implementation("com.squareup.okhttp3:okhttp:4.12.0")
```

`Media3Tap.kt` additionally needs Media3/ExoPlayer. Delete that file if you're
using URL mode or a different player.

## Pick a mode first

This decision matters more than any code below.

**URL mode** — your app hands the bot a URL and the bot fetches it directly.
Choose this if your tracks live anywhere the server can reach. No upload from
the phone, no battery drain, no quality loss, and music keeps playing when the
screen is off.

**Relay mode** — your app streams decoded audio up to the bridge. Choose this
only when the audio exists solely on the device. Costs ~1.5 Mbit/s up and real
battery, and needs a foreground service to survive Android's process killing.

When in doubt, URL mode.

## Wiring it up

### 1. Pair, once

```kotlin
val bridge = DiscordBridge("https://bridge.example.com")

// Off the main thread — this does network I/O.
val result = bridge.pair(codeTheUserTyped, DeviceInfo("Pixel 8 - MyApp"))
prefs.edit().putString("deviceToken", result.deviceToken).apply()
```

Give the user somewhere to type the six-character code `/link` showed them in
Discord. Treat the returned token like a password.

### 2. Connect

```kotlin
val token = prefs.getString("deviceToken", null) ?: return
bridge.connect(token, DeviceInfo("Pixel 8 - MyApp"))
```

### 3. Report what's playing

Call this on every track change. It's the only thing Discord needs to show a
now-playing card.

```kotlin
bridge.publish(
    NowPlaying(
        trackId = track.id,
        title = track.title,
        artist = track.artist,
        album = track.album,
        durationMs = track.durationMs,
        positionMs = player.currentPosition,
        artworkUrl = track.artworkUrl,   // must be publicly fetchable
        state = PlaybackState.PLAYING,
        source = TrackSource(SourceKind.URL, url = track.streamUrl),
    )
)

// Once a second, so the progress bar moves.
bridge.updatePosition(player.currentPosition)
```

### 4. Accept remote control, or don't

```kotlin
bridge.onCommand = { command ->
    when (command.name) {
        RemoteCommand.Name.SKIP -> { player.seekToNext(); true }
        RemoteCommand.Name.PAUSE -> { player.pause(); true }
        RemoteCommand.Name.PLAY -> { player.play(); true }
        else -> false   // Discord tells the user your app declined
    }
}
```

Leave `onCommand` null to ignore Discord control entirely. Slash commands then
report that the app didn't handle them, which is a perfectly fine outcome.

## Relay mode specifics

Skip this section unless you chose relay.

```kotlin
bridge.openAudioRelay()
// ... then, from your audio callback:
bridge.sendPcm(pcmBytes, length)
```

The format is not negotiable:

```
48000 Hz, 2 channels, signed 16-bit little-endian
```

`Media3Tap.kt` shows how to get exactly that out of ExoPlayer, including the
resampler you need so 44.1 kHz tracks don't play ~9% fast. If you use a
different player, that file is still worth reading for the shape of the
problem.

`sendPcm` returns false when the network is backed up and the chunk was
dropped. That's the correct behaviour for live audio — dropping keeps you in
sync, queueing only drifts further behind. Don't retry it.

Two things that will bite you in production:

- **Foreground service.** Android kills background processes. Without one your
  stream dies mid-song.
- **Mobile data.** ~1.5 Mbit/s up is a lot on a metered plan. Put it behind a
  toggle the user controls.

## What this does not do

- It can't relay DRM-protected audio. Tapping decoded PCM doesn't work there,
  by design, and that's not something to route around.
- It doesn't run your app inside Discord. Discord has no Android app host;
  the bot is what your server hears.
