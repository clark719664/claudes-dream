package com.dreambridge

import okhttp3.*
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Connects your music app to a Discord voice channel.
 *
 * Nothing here reads your player, your library, or your UI. You call it when
 * your playback state changes, and optionally hand it PCM. That is the whole
 * integration surface.
 *
 * Typical use:
 * ```
 * val bridge = DiscordBridge("https://bridge.example.com")
 * val result = bridge.pair(codeFromDiscord, DeviceInfo("Pixel 8 - Stash"))
 * prefs.edit().putString("deviceToken", result.deviceToken).apply()
 *
 * bridge.connect(result.deviceToken)
 * bridge.onCommand = { command -> stashPlayer.handle(command); true }
 * bridge.publish(nowPlaying)
 * ```
 *
 * Every method is safe to call from any thread. Callbacks arrive on an OkHttp
 * dispatcher thread, so hop to your own thread before touching UI or a player.
 */
class DiscordBridge(
    baseUrl: String,
    private val client: OkHttpClient = defaultClient(),
) {
    private val httpBase = baseUrl.trimEnd('/')
    private val wsBase = httpBase.replaceFirst("http", "ws")

    private var control: WebSocket? = null
    private var audio: WebSocket? = null
    private var token: String? = null
    private val connected = AtomicBoolean(false)

    /**
     * Called when someone runs a playback slash command in Discord.
     * Return true if you acted on it, false to tell Discord you refused.
     * Leave it null to ignore remote control entirely.
     */
    var onCommand: ((RemoteCommand) -> Boolean)? = null

    /** Called with the number of Discord listeners currently attached. */
    var onListeners: ((Int) -> Unit)? = null

    /** Called when the connection drops. The bridge does not auto-reconnect for you. */
    var onDisconnected: ((reason: String) -> Unit)? = null

    /**
     * Exchange a `/link` code for a device token. Blocking; call off the main
     * thread. Persist the returned token so the user pairs only once.
     */
    @Throws(BridgeException::class)
    fun pair(code: String, device: DeviceInfo): PairResult {
        val body = JSONObject()
            .put("code", code.trim().uppercase())
            .put("device", device.toJson())
            .toString()

        val request = Request.Builder()
            .url("$httpBase/v1/pair")
            .post(RequestBody.create(JSON_MEDIA, body))
            .build()

        try {
            client.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                val json = if (text.isEmpty()) JSONObject() else JSONObject(text)
                if (!response.isSuccessful) {
                    throw BridgeException(json.optString("error", "pairing failed (${response.code})"))
                }
                return PairResult(
                    sessionId = json.getString("sessionId"),
                    deviceToken = json.getString("deviceToken"),
                    guildId = json.getString("guildId"),
                    userId = json.getString("userId"),
                )
            }
        } catch (e: IOException) {
            throw BridgeException("could not reach the bridge: ${e.message}", e)
        }
    }

    /** Open the control channel. Call [publish] afterwards to report a track. */
    fun connect(deviceToken: String, device: DeviceInfo? = null) {
        disconnect()
        token = deviceToken
        val request = Request.Builder()
            .url("$wsBase/v1/device?token=$deviceToken")
            .build()

        control = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                connected.set(true)
                device?.let {
                    webSocket.send(
                        JSONObject()
                            .put("t", "hello")
                            .put("protocol", PROTOCOL_VERSION)
                            .put("device", it.toJson())
                            .toString()
                    )
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleBridgeMessage(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                connected.set(false)
                onDisconnected?.invoke(t.message ?: "connection failed")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                connected.set(false)
                onDisconnected?.invoke(reason.ifEmpty { "closed" })
            }
        })
    }

    private fun handleBridgeMessage(text: String) {
        val json = runCatching { JSONObject(text) }.getOrNull() ?: return
        when (json.optString("t")) {
            "command" -> {
                val name = RemoteCommand.Name.fromWire(json.optString("name")) ?: return
                val requester = json.optJSONObject("requestedBy")
                val command = RemoteCommand(
                    commandId = json.optString("commandId"),
                    name = name,
                    positionMs = if (json.has("positionMs")) json.optLong("positionMs") else null,
                    requestedByUserId = requester?.optString("userId").orEmpty(),
                    requestedByUsername = requester?.optString("username").orEmpty(),
                )
                val handler = onCommand
                val ok = handler?.invoke(command) ?: false
                control?.send(
                    JSONObject()
                        .put("t", "ack")
                        .put("commandId", command.commandId)
                        .put("ok", ok)
                        .apply { if (!ok) put("error", "not handled by the app") }
                        .toString()
                )
            }
            "listeners" -> onListeners?.invoke(json.optInt("count"))
            "bye" -> onDisconnected?.invoke(json.optString("reason", "bridge closed the session"))
        }
    }

    /** Report the current track. Call this on every track change. */
    fun publish(nowPlaying: NowPlaying) {
        send(JSONObject().put("t", "nowplaying").put("nowPlaying", nowPlaying.toJson()))
    }

    /** Report the playhead. Once a second is plenty; this only drives the embed. */
    fun updatePosition(positionMs: Long) {
        send(JSONObject().put("t", "position").put("positionMs", positionMs))
    }

    /** Report play/pause/stop without resending the whole track. */
    fun updateState(state: PlaybackState) {
        send(JSONObject().put("t", "state").put("state", state.wire))
    }

    private fun send(json: JSONObject) {
        val socket = control
        if (socket == null || !connected.get()) return
        socket.send(json.toString())
    }

    /**
     * Open the audio relay. Only needed for [SourceKind.RELAY]; a URL source
     * needs none of this.
     */
    fun openAudioRelay() {
        val deviceToken = token ?: throw BridgeException("connect() must be called first")
        if (audio != null) return
        val request = Request.Builder().url("$wsBase/v1/device/audio?token=$deviceToken").build()
        audio = client.newWebSocket(request, object : WebSocketListener() {})
    }

    /**
     * Push PCM to Discord. Must be 48 kHz, 2-channel, signed 16-bit
     * little-endian — exactly [PCM_SAMPLE_RATE] / [PCM_CHANNELS]. Anything
     * else plays at the wrong speed.
     *
     * Returns false when the socket is backed up, which means the network
     * can't keep up and this chunk was dropped. Dropping is correct for live
     * audio; queueing would only drift further behind.
     */
    fun sendPcm(data: ByteArray, length: Int = data.size): Boolean {
        val socket = audio ?: return false
        if (socket.queueSize() > MAX_QUEUED_BYTES) return false
        return socket.send(data.toByteString(0, length))
    }

    /** Same as [sendPcm] but avoids a copy when you already hold a ByteString. */
    fun sendPcm(data: ByteString): Boolean {
        val socket = audio ?: return false
        if (socket.queueSize() > MAX_QUEUED_BYTES) return false
        return socket.send(data)
    }

    fun closeAudioRelay() {
        audio?.close(1000, "done")
        audio = null
    }

    /** Tear everything down. Safe to call when already disconnected. */
    fun disconnect(reason: String = "app closing") {
        connected.set(false)
        closeAudioRelay()
        control?.let {
            runCatching { it.send(JSONObject().put("t", "bye").put("reason", reason).toString()) }
            it.close(1000, "bye")
        }
        control = null
    }

    companion object {
        const val PROTOCOL_VERSION = 1

        /** Discord voice format. Send exactly this or it will sound wrong. */
        const val PCM_SAMPLE_RATE = 48_000
        const val PCM_CHANNELS = 2
        const val PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * PCM_CHANNELS * 2

        /** Drop audio rather than queue more than this on a slow network. */
        private const val MAX_QUEUED_BYTES = 512L * 1024L

        private val JSON_MEDIA = MediaType.get("application/json; charset=utf-8")

        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            // Keep the socket alive through doze and network handover.
            .pingInterval(20, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }
}

private fun DeviceInfo.toJson(): JSONObject = JSONObject()
    .put("name", name)
    .putOpt("appVersion", appVersion)
    .putOpt("platform", platform)

private fun TrackSource.toJson(): JSONObject {
    val json = JSONObject().put("kind", kind.wire).putOpt("url", url)
    if (headers.isNotEmpty()) json.put("headers", JSONObject(headers as Map<*, *>))
    return json
}

private fun NowPlaying.toJson(): JSONObject = JSONObject()
    .put("trackId", trackId)
    .put("title", title)
    .putOpt("artist", artist)
    .putOpt("album", album)
    .putOpt("durationMs", durationMs)
    .putOpt("positionMs", positionMs)
    .putOpt("artworkUrl", artworkUrl)
    .put("state", state.wire)
    .put("source", source.toJson())
