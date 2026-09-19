package com.claudesdream.hum.playback

import android.content.ComponentName
import android.content.Context
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.claudesdream.hum.data.Song
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PlayerState(
    val connected: Boolean = false,
    val isPlaying: Boolean = false,
    val currentSongId: Long? = null,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val shuffle: Boolean = false,
    val repeatMode: Int = Player.REPEAT_MODE_OFF,
    val speed: Float = 1f,
    val queueIds: List<Long> = emptyList(),
    val queueIndex: Int = 0,
) {
    val hasQueue: Boolean get() = queueIds.isNotEmpty()
    val progress: Float
        get() = if (durationMs > 0L) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
}

/**
 * Thin bridge between the UI and [PlaybackService]. Everything here must be touched from the main
 * thread — [MediaController] requires it.
 */
class PlayerConnection(context: Context, private val scope: CoroutineScope) {

    private val appContext = context.applicationContext
    private var future: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null

    private val _state = MutableStateFlow(PlayerState())
    val state: StateFlow<PlayerState> = _state.asStateFlow()

    /** Fired when playback moves off a track, with how much of it actually played (0f–1f). */
    var onTrackFinished: ((songId: Long, playedFraction: Float) -> Unit)? = null

    private var trackedId: Long? = null
    private var trackedPositionMs: Long = 0L
    private var trackedDurationMs: Long = 0L

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) = pushState()
    }

    fun connect() {
        if (future != null) return
        val token = SessionToken(appContext, ComponentName(appContext, PlaybackService::class.java))
        val pending = MediaController.Builder(appContext, token).buildAsync()
        future = pending
        pending.addListener(
            {
                controller = runCatching { pending.get() }.getOrNull()
                controller?.addListener(listener)
                pushState()
                startTicking()
            },
            ContextCompat.getMainExecutor(appContext),
        )
    }

    fun release() {
        controller?.removeListener(listener)
        future?.let { MediaController.releaseFuture(it) }
        future = null
        controller = null
    }

    /** Replaces the queue with [songs] and starts at [index]. */
    fun play(songs: List<Song>, index: Int) {
        val player = controller ?: return
        if (songs.isEmpty()) return
        val start = index.coerceIn(0, songs.lastIndex)
        player.setMediaItems(songs.map { it.toMediaItem() }, start, 0L)
        player.prepare()
        player.play()
        pushState()
    }

    /** Loads a track without starting it — used to restore what was playing last time. */
    fun prepareOnly(song: Song, positionMs: Long) {
        val player = controller ?: return
        if (player.mediaItemCount > 0) return
        player.setMediaItem(song.toMediaItem(), positionMs)
        player.prepare()
        pushState()
    }

    fun playPause() {
        val player = controller ?: return
        if (player.isPlaying) {
            player.pause()
        } else {
            if (player.playbackState == Player.STATE_IDLE) player.prepare()
            player.play()
        }
        pushState()
    }

    fun next() {
        controller?.seekToNextMediaItem()
        pushState()
    }

    /** Standard behaviour: restart the song unless we are near the start. */
    fun previous() {
        val player = controller ?: return
        if (player.currentPosition > 4_000L || !player.hasPreviousMediaItem()) {
            player.seekTo(0L)
        } else {
            player.seekToPreviousMediaItem()
        }
        pushState()
    }

    fun seekTo(positionMs: Long) {
        controller?.seekTo(positionMs)
        pushState()
    }

    fun toggleShuffle() {
        val player = controller ?: return
        player.shuffleModeEnabled = !player.shuffleModeEnabled
        pushState()
    }

    fun setSpeed(speed: Float) {
        val player = controller ?: return
        player.setPlaybackSpeed(speed)
        pushState()
    }

    /** Jump by a fixed amount — the ±30s buttons audiobooks live on. */
    fun seekBy(deltaMs: Long) {
        val player = controller ?: return
        val target = (player.currentPosition + deltaMs).coerceAtLeast(0L)
        val duration = player.duration
        player.seekTo(if (duration > 0L) target.coerceAtMost(duration) else target)
        pushState()
    }

    fun cycleRepeat() {
        val player = controller ?: return
        player.repeatMode = when (player.repeatMode) {
            Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
            Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
        pushState()
    }

    fun playQueueItem(index: Int) {
        val player = controller ?: return
        if (index in 0 until player.mediaItemCount) {
            player.seekTo(index, 0L)
            player.play()
            pushState()
        }
    }

    fun addToQueue(songs: List<Song>) {
        val player = controller ?: return
        player.addMediaItems(songs.map { it.toMediaItem() })
        if (player.playbackState == Player.STATE_IDLE) player.prepare()
        pushState()
    }

    fun playNext(song: Song) {
        val player = controller ?: return
        val at = (player.currentMediaItemIndex + 1).coerceAtMost(player.mediaItemCount)
        player.addMediaItem(at, song.toMediaItem())
        if (player.playbackState == Player.STATE_IDLE) player.prepare()
        pushState()
    }

    fun removeFromQueue(index: Int) {
        val player = controller ?: return
        if (index in 0 until player.mediaItemCount) player.removeMediaItem(index)
        pushState()
    }

    private fun startTicking() {
        scope.launch {
            while (true) {
                if (controller?.isPlaying == true) pushState()
                delay(500L)
            }
        }
    }

    private fun pushState() {
        val player = controller
        if (player == null) {
            _state.value = PlayerState()
            return
        }
        val queueIds = ArrayList<Long>(player.mediaItemCount)
        for (i in 0 until player.mediaItemCount) {
            queueIds += player.getMediaItemAt(i).mediaId.toLongOrNull() ?: -1L
        }
        val currentId = player.currentMediaItem?.mediaId?.toLongOrNull()
        trackListening(currentId, player.currentPosition, player.duration)

        _state.value = PlayerState(
            connected = true,
            isPlaying = player.isPlaying,
            currentSongId = currentId,
            positionMs = player.currentPosition.coerceAtLeast(0L),
            durationMs = player.duration.takeIf { it > 0L } ?: 0L,
            shuffle = player.shuffleModeEnabled,
            repeatMode = player.repeatMode,
            speed = player.playbackParameters.speed,
            queueIds = queueIds,
            queueIndex = player.currentMediaItemIndex,
        )
    }

    /**
     * Watches for the current track changing and reports how much of the previous one played, so
     * the mixes can tell a real listen from a skip.
     */
    private fun trackListening(currentId: Long?, positionMs: Long, durationMs: Long) {
        val previous = trackedId
        if (previous != null && previous != currentId) {
            val fraction = if (trackedDurationMs > 0L) {
                (trackedPositionMs.toFloat() / trackedDurationMs).coerceIn(0f, 1f)
            } else {
                0f
            }
            onTrackFinished?.invoke(previous, fraction)
        }
        if (currentId != previous) {
            trackedId = currentId
            trackedPositionMs = 0L
            trackedDurationMs = 0L
        }
        if (currentId != null) {
            // Keep the high-water mark: seeking back before a track ends should not erase it.
            if (positionMs > trackedPositionMs) trackedPositionMs = positionMs
            if (durationMs > 0L) trackedDurationMs = durationMs
        }
    }

    private fun Song.toMediaItem(): MediaItem = MediaItem.Builder()
        .setMediaId(id.toString())
        .setUri(uri)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(title)
                .setArtist(artist)
                .setAlbumTitle(album)
                .setArtworkUri(artworkUri)
                .setIsBrowsable(false)
                .setIsPlayable(true)
                .build(),
        )
        .build()
}
