# Hum — a sideloadable Android music player

Hum plays the music that is already on your phone. Point it at your storage once and it finds
every audio file — including whatever landed in `Download/` — cleans up the messy names, and
sorts it into songs, albums, artists and folders by itself. No accounts, no cloud, no ads.

## What it does

- **Finds everything automatically.** One permission prompt, then it reads the whole device
  library through MediaStore. Music downloaded later shows up on its own — a content observer
  watches for new audio and rescans in the background.
- **Cleans up downloaded filenames.** `01. Artist - Song Name (Official Music Video) [320kbps].mp3`
  becomes **Song Name** by **Artist**. Junk like `(Official Video)`, `[HD]`, `www.site.com -`,
  track-number prefixes and `- Topic` channel suffixes gets stripped, while meaningful parts such
  as `(Live)` or `(Remix)` are kept. Untagged files get their artist parsed out of the filename.
- **Sorts itself.** Songs, Albums, Artists and Folders tabs, all derived at scan time.
  Sort songs by title, artist, album, recently added or length.
- **Simple playback.** Big artwork, scrub bar, shuffle, repeat, queue you can reorder by removing
  and re-adding, play next / add to queue, favourites.
- **Plays in the background** with lock-screen, notification and Bluetooth controls, and it
  remembers what you were listening to when you reopen it.
- **Material You theming** on Android 12+, light and dark.

## Requirements

- Android 7.0 (API 24) or newer.

## Getting the APK — from your phone, no computer needed

Every push builds the APK on GitHub Actions and publishes it as a release, so the download is a
plain `.apk` file you can tap.

1. On your phone, open the repo's **Releases** page and pick **Hum (latest build)**:
   <https://github.com/clark719664/claudes-dream/releases/tag/latest>
2. Tap `hum.apk` under Assets. (Sign in to GitHub in the browser first if the repo is private.)
3. Open the download from the notification shade.

That's the whole loop — build in the cloud, download on the phone, install. A computer is only
needed if you want to change the code yourself.

The same APK is also attached to each Actions run as the **Hum-APK** artifact, but that one comes
as a zip, so the release link above is the easier route on mobile.

To cut a versioned release with the APK attached, push a tag starting with `v`:

```bash
git tag v1.0 && git push origin v1.0
```

## Installing it on your phone (sideloading)

1. Open the APK from the notification shade or your Files app.
2. Android will ask whether to allow installs from that app (your browser, usually) — tap
   **Settings**, turn on **Allow from this source**, then go back and tap **Install**.
3. Open Hum and tap **Find my music**, then allow access to audio files. That's it.

On Android 13+ the permission is "Music and audio". On Android 12 and below it's "Files and media".

## Building it yourself

```bash
./gradlew assembleRelease     # APK lands in app/build/outputs/apk/release/
./gradlew testDebugUnitTest   # filename/tag cleanup tests
```

You need JDK 17 and the Android SDK (API 35). Android Studio provides both.

### Signing

`keystore/sideload.jks` is a plain signing key with the password `sideload` — deliberately not a
secret. Its only job is to make every build sign identically so a new APK installs as an update
over the old one instead of being rejected. If the file is missing, CI generates a throwaway key,
which means that build can't be installed over an earlier one without uninstalling first.

To create the stable key once and commit it:

```bash
keytool -genkeypair -v -keystore keystore/sideload.jks -storetype PKCS12 \
  -alias sideload -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass sideload -keypass sideload \
  -dname "CN=Hum Sideload, OU=Hum, O=Hum, L=Somewhere, ST=Somewhere, C=US"
```

If you ever publish the app, replace this with a real key you keep private.

## How it is put together

| Piece | What it does |
| --- | --- |
| `data/MediaStoreScanner.kt` | Queries MediaStore for every music file, resolves folders and artwork |
| `data/TagCleaner.kt` | Turns messy filenames and missing tags into clean title / artist / album |
| `data/MusicRepository.kt` | Groups the library, watches for new downloads, debounces rescans |
| `playback/PlaybackService.kt` | Media3 `MediaSessionService` — background playback, notification, lock screen |
| `playback/PlayerConnection.kt` | `MediaController` bridge exposing player state to Compose |
| `ui/` | Jetpack Compose Material 3 UI: tabs, search, detail screens, mini and full player |

Kotlin, Jetpack Compose, Material 3, Media3/ExoPlayer, Coil. No backend, no analytics, nothing
leaves the device.
