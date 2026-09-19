package com.dreambridge

import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import android.content.Context
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Example: relay ExoPlayer's decoded output to Discord.
 *
 * Use this only if you can't give the bot a URL. A URL source is better in
 * every way — no upload bandwidth, no battery cost, no quality loss, and it
 * keeps playing when the phone sleeps. Reach for the relay when your audio is
 * DRM-free but not fetchable by the server: local files, or anything you
 * decode yourself.
 *
 * Wire it up once, where you build your player:
 * ```
 * val player = buildTappedPlayer(context, bridge)
 * ```
 *
 * Caveats worth knowing before you ship this:
 *  - This taps decoded PCM, so it will not work on DRM-protected content,
 *    by design.
 *  - Relaying uses roughly 1.5 Mbit/s up. On mobile data that is real money
 *    and real battery. Gate it behind a user-visible toggle.
 *  - Audio keeps flowing only while your process does. Run it from a
 *    foreground service or Android will kill it mid-song.
 */
@UnstableApi
fun buildTappedPlayer(context: Context, bridge: DiscordBridge): ExoPlayer {
    // Sonic resamples whatever the decoder produces to Discord's 48 kHz.
    // Without this, a 44.1 kHz track plays about 9% fast.
    val resampler = SonicAudioProcessor().apply {
        setOutputSampleRateHz(DiscordBridge.PCM_SAMPLE_RATE)
    }
    val tee = TeeAudioProcessor(BridgeSink(bridge))

    val renderers = object : DefaultRenderersFactory(context) {
        override fun buildAudioProcessors(): Array<AudioProcessor> =
            arrayOf(resampler, tee)
    }

    return ExoPlayer.Builder(context, renderers).build()
}

/**
 * Receives decoded PCM and forwards it to the bridge.
 *
 * TeeAudioProcessor hands us whatever channel count the source had, so this
 * normalises to stereo. It does not resample: that is the Sonic processor's
 * job upstream, and doing it here would fight with it.
 */
@UnstableApi
private class BridgeSink(private val bridge: DiscordBridge) : TeeAudioProcessor.AudioBufferSink {

    private var channelCount = 2
    private var sampleRate = DiscordBridge.PCM_SAMPLE_RATE
    private var scratch = ByteArray(0)

    override fun flush(sampleRateHz: Int, channelCount: Int, encoding: Int) {
        this.sampleRate = sampleRateHz
        this.channelCount = channelCount
        if (sampleRateHz != DiscordBridge.PCM_SAMPLE_RATE) {
            // Means the resampler isn't in the chain ahead of us. Audio would
            // play at the wrong speed, so it's better to know loudly.
            android.util.Log.w(
                "BridgeSink",
                "expected ${DiscordBridge.PCM_SAMPLE_RATE} Hz but got $sampleRateHz Hz; " +
                    "audio will play at the wrong speed",
            )
        }
    }

    override fun handleBuffer(buffer: ByteBuffer) {
        val frame = buffer.order(ByteOrder.LITTLE_ENDIAN)
        val remaining = frame.remaining()
        if (remaining <= 0) return

        val out = when (channelCount) {
            2 -> take(frame, remaining)
            1 -> upmixMonoToStereo(frame, remaining)
            else -> downmixToStereo(frame, remaining)
        }
        bridge.sendPcm(out.first, out.second)
    }

    /** Already stereo: copy straight out. */
    private fun take(frame: ByteBuffer, bytes: Int): Pair<ByteArray, Int> {
        val out = ensure(bytes)
        frame.get(out, 0, bytes)
        return out to bytes
    }

    /** Duplicate each mono sample into both channels. */
    private fun upmixMonoToStereo(frame: ByteBuffer, bytes: Int): Pair<ByteArray, Int> {
        val samples = bytes / 2
        val out = ensure(samples * 4)
        var w = 0
        repeat(samples) {
            val sample = frame.short
            out[w++] = (sample.toInt() and 0xFF).toByte()
            out[w++] = ((sample.toInt() shr 8) and 0xFF).toByte()
            out[w++] = (sample.toInt() and 0xFF).toByte()
            out[w++] = ((sample.toInt() shr 8) and 0xFF).toByte()
        }
        return out to w
    }

    /**
     * Surround content: keep the front two channels.
     *
     * A proper downmix would fold in centre and surrounds with the standard
     * coefficients. This is the cheap version; multichannel music is rare
     * enough that it isn't worth the CPU on a phone.
     */
    private fun downmixToStereo(frame: ByteBuffer, bytes: Int): Pair<ByteArray, Int> {
        val frames = bytes / (channelCount * 2)
        val out = ensure(frames * 4)
        var w = 0
        repeat(frames) {
            val left = frame.short
            val right = frame.short
            out[w++] = (left.toInt() and 0xFF).toByte()
            out[w++] = ((left.toInt() shr 8) and 0xFF).toByte()
            out[w++] = (right.toInt() and 0xFF).toByte()
            out[w++] = ((right.toInt() shr 8) and 0xFF).toByte()
            // Skip the channels we're dropping.
            repeat(channelCount - 2) { frame.short }
        }
        return out to w
    }

    /** Reuse one buffer; handleBuffer runs on the audio thread, so don't allocate per call. */
    private fun ensure(size: Int): ByteArray {
        if (scratch.size < size) scratch = ByteArray(size)
        return scratch
    }
}
