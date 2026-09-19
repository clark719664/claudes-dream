package com.claudesdream.hum.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudesdream.hum.HumApplication
import com.claudesdream.hum.data.Album
import com.claudesdream.hum.data.Artist
import com.claudesdream.hum.data.AudioKind
import com.claudesdream.hum.data.Book
import com.claudesdream.hum.data.BookProgress
import com.claudesdream.hum.data.Library
import com.claudesdream.hum.data.ListeningStore
import com.claudesdream.hum.data.Mix
import com.claudesdream.hum.data.MixBuilder
import com.claudesdream.hum.data.Song
import com.claudesdream.hum.data.SongSort
import com.claudesdream.hum.playback.PlayerConnection
import com.claudesdream.hum.playback.PlayerState
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.Calendar

/** Search results, split so each section can be rendered with a heading. */
data class SearchResults(
    val songs: List<Song> = emptyList(),
    val albums: List<Album> = emptyList(),
    val artists: List<Artist> = emptyList(),
    val books: List<Book> = emptyList(),
) {
    val isEmpty: Boolean get() = songs.isEmpty() && albums.isEmpty() && artists.isEmpty() && books.isEmpty()
}

class MusicViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as HumApplication
    private val repository = app.repository
    private val prefs = app.prefs
    private val history = app.history
    private val connection = PlayerConnection(application, viewModelScope)

    val library: StateFlow<Library> = repository.library
    val playerState: StateFlow<PlayerState> = connection.state
    val sort: StateFlow<SongSort> = prefs.sort
    val favorites: StateFlow<Set<Long>> = prefs.favorites
    val speed: StateFlow<Float> = prefs.speed

    private val _hasPermission = MutableStateFlow(false)
    val hasPermission: StateFlow<Boolean> = _hasPermission.asStateFlow()

    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    /** The Songs tab, ordered by whatever the user picked. */
    val sortedSongs: StateFlow<List<Song>> = combine(library, sort) { lib, order ->
        when (order) {
            SongSort.TITLE -> lib.songs
            SongSort.ARTIST -> lib.songs.sortedWith(
                compareBy<Song, String>(String.CASE_INSENSITIVE_ORDER) { it.artist }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.title }
            )
            SongSort.ALBUM -> lib.songs.sortedWith(
                compareBy<Song, String>(String.CASE_INSENSITIVE_ORDER) { it.album }
                    .thenBy { if (it.track > 0) it.track else Int.MAX_VALUE }
            )
            SongSort.RECENTLY_ADDED -> lib.songs.sortedByDescending { it.dateAddedSec }
            SongSort.DURATION -> lib.songs.sortedByDescending { it.durationMs }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val favoriteSongs: StateFlow<List<Song>> = combine(library, favorites) { lib, ids ->
        lib.songs.filter { it.id in ids }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** Rebuilt whenever the library, your history or your favourites change. */
    val mixes: StateFlow<List<Mix>> = combine(
        library,
        history.stats,
        favorites,
    ) { lib, stats, favs ->
        MixBuilder.build(
            songs = lib.songs,
            stats = stats,
            favorites = favs,
            nowSec = System.currentTimeMillis() / 1000L,
            hourOfDay = Calendar.getInstance().get(Calendar.HOUR_OF_DAY),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val searchResults: StateFlow<SearchResults> = combine(library, _query) { lib, raw ->
        val q = raw.trim().lowercase()
        if (q.isBlank()) {
            SearchResults()
        } else {
            SearchResults(
                songs = lib.songs.filter { q in it.searchKey }.take(50),
                albums = lib.albums.filter { q in it.name.lowercase() || q in it.artist.lowercase() }.take(20),
                artists = lib.artists.filter { q in it.name.lowercase() }.take(20),
                books = lib.books.filter { q in it.title.lowercase() || q in it.author.lowercase() }.take(20),
            )
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SearchResults())

    val currentSong: StateFlow<Song?> = combine(library, playerState) { lib, state ->
        state.currentSongId?.let { lib.byId[it] }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val queue: StateFlow<List<Song>> = combine(library, playerState) { lib, state ->
        state.queueIds.mapNotNull { lib.byId[it] }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val isFavoriteCurrent: StateFlow<Boolean> = combine(favorites, playerState) { ids, state ->
        state.currentSongId != null && state.currentSongId in ids
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    init {
        connection.connect()
        connection.onTrackFinished = { songId, fraction ->
            history.record(
                songId = songId,
                playedFraction = fraction,
                nowSec = System.currentTimeMillis() / 1000L,
                hourOfDay = Calendar.getInstance().get(Calendar.HOUR_OF_DAY),
            )
        }
        viewModelScope.launch { repository.setKindOverrides(prefs.kindOverrides.value) }
        viewModelScope.launch {
            prefs.kindOverrides.collect { repository.setKindOverrides(it) }
        }
        viewModelScope.launch { restoreLastTrack() }
        viewModelScope.launch { rememberPositionPeriodically() }
    }

    fun onPermissionResult(granted: Boolean) {
        val hadPermission = _hasPermission.value
        _hasPermission.value = granted
        if (granted) {
            repository.startWatching()
            // Scan on the first grant and on a cold start; after that the content observer keeps up.
            if (!hadPermission || !library.value.scanned) repository.refresh()
        }
    }

    fun rescan() = repository.refresh()

    fun setQuery(value: String) {
        _query.value = value
    }

    fun setSort(value: SongSort) = prefs.setSort(value)

    fun toggleFavorite(songId: Long) = prefs.toggleFavorite(songId)

    /** Moves a file between the music library and the Books tab. */
    fun setKind(songId: Long, kind: AudioKind) = prefs.setKind(songId, kind)

    fun play(songs: List<Song>, index: Int) = connection.play(songs, index)

    fun shuffle(songs: List<Song>) {
        if (songs.isEmpty()) return
        connection.play(songs.shuffled(), 0)
    }

    /** Books start where you left off, not at chapter one. */
    fun playBook(book: Book) {
        val progress = prefs.bookProgress(book.id)
        val index = book.chapters.indexOfFirst { it.id == progress?.songId }.takeIf { it >= 0 } ?: 0
        connection.play(book.chapters, index)
        if (progress != null && progress.positionMs > 0L) connection.seekTo(progress.positionMs)
        applySpeedForCurrent()
    }

    fun playBookFrom(book: Book, index: Int) {
        connection.play(book.chapters, index)
        applySpeedForCurrent()
    }

    fun playMix(mix: Mix) = connection.play(mix.songs, 0)

    fun playPause() = connection.playPause()
    fun next() = connection.next()
    fun previous() = connection.previous()
    fun seekTo(positionMs: Long) = connection.seekTo(positionMs)
    fun seekBy(deltaMs: Long) = connection.seekBy(deltaMs)
    fun toggleShuffle() = connection.toggleShuffle()
    fun cycleRepeat() = connection.cycleRepeat()
    fun playQueueItem(index: Int) = connection.playQueueItem(index)
    fun removeFromQueue(index: Int) = connection.removeFromQueue(index)
    fun playNext(song: Song) = connection.playNext(song)
    fun addToQueue(songs: List<Song>) = connection.addToQueue(songs)

    fun setSpeed(value: Float) {
        prefs.setSpeed(value)
        connection.setSpeed(value)
    }

    private fun applySpeedForCurrent() {
        connection.setSpeed(prefs.speed.value)
    }

    fun mixById(id: String): Mix? = mixes.value.firstOrNull { it.id == id }

    fun bookProgress(book: Book): BookProgress? = prefs.bookProgress(book.id)

    /** How far through the whole book you are, for the bar on the Books tab. */
    fun bookProgressFraction(book: Book): Float {
        val progress = prefs.bookProgress(book.id) ?: return 0f
        val index = book.chapters.indexOfFirst { it.id == progress.songId }
        if (index < 0) return 0f
        val before = book.chapters.take(index).sumOf { it.durationMs }
        val total = book.totalMs
        if (total <= 0L) return 0f
        return ((before + progress.positionMs).toFloat() / total).coerceIn(0f, 1f)
    }

    fun bookById(id: String): Book? = library.value.books.firstOrNull { it.id == id }

    /** Puts the last played track back in the mini player (paused) after a cold start. */
    private suspend fun restoreLastTrack() {
        val lastId = prefs.lastSongId
        if (lastId < 0L) return
        val song = library.map { it.byId[lastId] }.filterNotNull().first()
        playerState.first { it.connected }
        if (!playerState.value.hasQueue) {
            connection.prepareOnly(song, prefs.lastPositionMs)
        }
    }

    private suspend fun rememberPositionPeriodically() {
        while (true) {
            delay(5_000L)
            val state = playerState.value
            val id = state.currentSongId ?: continue
            prefs.saveResume(id, state.positionMs)
            // Books also remember their own place, per book.
            library.value.bookContaining(id)?.let { book ->
                prefs.saveBookProgress(book.id, id, state.positionMs)
            }
        }
    }

    override fun onCleared() {
        val state = playerState.value
        state.currentSongId?.let { id ->
            prefs.saveResume(id, state.positionMs)
            library.value.bookContaining(id)?.let { book ->
                prefs.saveBookProgress(book.id, id, state.positionMs)
            }
        }
        connection.onTrackFinished = null
        connection.release()
        super.onCleared()
    }
}
