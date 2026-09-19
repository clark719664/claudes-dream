package com.dreambridge

/**
 * Wire types for the Discord bridge.
 *
 * These mirror `shared/src/protocol.ts` on the server. If you change one side,
 * change the other.
 */

/** How the bridge should get audio for a track. */
enum class SourceKind(val wire: String) {
    /** You give a URL the bot fetches directly. Cheapest, best quality. */
    URL("url"),

    /** You stream PCM up from the device in real time. Works for anything. */
    RELAY("relay"),

    /** Metadata only: Discord shows the track but plays nothing. */
    METADATA("metadata"),
}

data class TrackSource(
    val kind: SourceKind,
    /** Required when [kind] is [SourceKind.URL]. Must be reachable from the bot's host. */
    val url: String? = null,
    /** Optional headers the bot sends when fetching [url], e.g. an auth token. */
    val headers: Map<String, String> = emptyMap(),
)

enum class PlaybackState(val wire: String) {
    PLAYING("playing"),
    PAUSED("paused"),
    STOPPED("stopped"),
}

data class NowPlaying(
    /** Stable id from your app; used to detect track changes. */
    val trackId: String,
    val title: String,
    val artist: String? = null,
    val album: String? = null,
    val durationMs: Long? = null,
    val positionMs: Long? = null,
    /** Must be publicly fetchable for Discord to render it. */
    val artworkUrl: String? = null,
    val state: PlaybackState,
    val source: TrackSource,
)

data class DeviceInfo(
    /** Shown in Discord, e.g. "Pixel 8 - MyMusicApp". */
    val name: String,
    val appVersion: String? = null,
    val platform: String? = "android",
)

/** A playback command that originated from a Discord slash command. */
data class RemoteCommand(
    val commandId: String,
    val name: Name,
    /** Present only for [Name.SEEK]. */
    val positionMs: Long? = null,
    val requestedByUserId: String,
    val requestedByUsername: String,
) {
    enum class Name(val wire: String) {
        PLAY("play"),
        PAUSE("pause"),
        SKIP("skip"),
        PREVIOUS("previous"),
        SEEK("seek"),
        STOP("stop");

        companion object {
            fun fromWire(value: String): Name? = entries.firstOrNull { it.wire == value }
        }
    }
}

/** Returned by [DiscordBridge.pair]. Persist [deviceToken]; treat it as a password. */
data class PairResult(
    val sessionId: String,
    val deviceToken: String,
    val guildId: String,
    val userId: String,
)

/** Thrown for any bridge-side failure so callers have one thing to catch. */
class BridgeException(message: String, cause: Throwable? = null) : Exception(message, cause)
