package com.claudesdream.hum.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudesdream.hum.HumApplication
import com.claudesdream.hum.data.Album
import com.claudesdream.hum.data.Artist
import com.claudesdream.hum.data.Library
import com.claudesdream.hum.data.MusicFolder
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

/** Search results, split so each section can be rendered with a heading. */
data class SearchResults(
    val songs: List<Song> = emptyList(),
    val albums: List<Album> = emptyList(),
    val artists: List<Artist> = emptyList(),
) {
    val isEmpty: Boolean get() = songs.isEmpty() && albums.isEmpty() && artists.isEmpty()
}

class MusicViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as HumApplication
    private val repository = app.repository
    private val prefs = app.prefs
    private val connection = PlayerConnection(application, viewModelScope)

    val library: StateFlow<Library> = repository.library
    val playerState: StateFlow<PlayerState> = connection.state
    val sort: StateFlow<SongSort> = prefs.sort
    val favorites: StateFlow<Set<Long>> = prefs.favorites

    private val _hasPermission = MutableStateFlow(false)
    val hasPermission: StateFlow<Boolean> = _hasPermission.asStateFlow()

    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    /** The Songs tab, ordered by whatever the user picked. */
    val sortedSongs: StateFlow<List<Song>> = combine(library, sort) { lib, order ->
        when (order) {
            SongSort.TITLE -> lib.songs
            SongSort.ARTIST -> lib.songs.sortedWith(
                compareBy(String.CASE_INSENSITIVE_ORDER, Song::artist).thenBy(String.CASE_INSENSITIVE_ORDER, Song::title)
            )
            SongSort.ALBUM -> lib.songs.sortedWith(
                compareBy(String.CASE_INSENSITIVE_ORDER, Song::album).thenBy { if (it.track > 0) it.track else Int.MAX_VALUE }
            )
            SongSort.RECENTLY_ADDED -> lib.songs.sortedByDescending { it.dateAddedSec }
            SongSort.DURATION -> lib.songs.sortedByDescending { it.durationMs }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val favoriteSongs: StateFlow<List<Song>> = combine(library, favorites) { lib, ids ->
        lib.songs.filter { it.id in ids }
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

    fun play(songs: List<Song>, index: Int) = connection.play(songs, index)

    fun shuffle(songs: List<Song>) {
        if (songs.isEmpty()) return
        val shuffled = songs.shuffled()
        connection.play(shuffled, 0)
    }

    fun playPause() = connection.playPause()
    fun next() = connection.next()
    fun previous() = connection.previous()
    fun seekTo(positionMs: Long) = connection.seekTo(positionMs)
    fun toggleShuffle() = connection.toggleShuffle()
    fun cycleRepeat() = connection.cycleRepeat()
    fun playQueueItem(index: Int) = connection.playQueueItem(index)
    fun removeFromQueue(index: Int) = connection.removeFromQueue(index)
    fun playNext(song: Song) = connection.playNext(song)
    fun addToQueue(songs: List<Song>) = connection.addToQueue(songs)

    fun albumOf(song: Song): Album? = library.value.albums.firstOrNull { it.id == song.albumId }

    fun artistNamed(name: String): Artist? = library.value.artists.firstOrNull { it.name == name }

    fun folderAt(path: String): MusicFolder? = library.value.folders.firstOrNull { it.path == path }

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
            val id = state.currentSongId
            if (id != null) prefs.saveResume(id, state.positionMs)
        }
    }

    override fun onCleared() {
        val state = playerState.value
        state.currentSongId?.let { prefs.saveResume(it, state.positionMs) }
        connection.release()
        super.onCleared()
    }
}
