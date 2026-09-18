package com.claudesdream.hum.data

import android.content.Context
import android.database.ContentObserver
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Owns the device library. Scans MediaStore, groups it into albums/artists/folders, and rescans
 * on its own whenever the system reports new audio — so a song downloaded while the app is open
 * shows up without the user doing anything.
 */
class MusicRepository(context: Context) {

    private val appContext = context.applicationContext
    private val scanner = MediaStoreScanner(appContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val scanLock = Mutex()

    private val _library = MutableStateFlow(Library())
    val library: StateFlow<Library> = _library.asStateFlow()

    private var observer: ContentObserver? = null
    private var pendingRescan: Boolean = false

    fun refresh() {
        scope.launch {
            scanLock.withLock {
                _library.value = _library.value.copy(isScanning = true)
                val songs = scanner.scan()
                _library.value = buildLibrary(songs)
            }
        }
    }

    /** Watch MediaStore so newly downloaded music appears by itself. */
    fun startWatching() {
        if (observer != null) return
        val handler = Handler(Looper.getMainLooper())
        val contentObserver = object : ContentObserver(handler) {
            override fun onChange(selfChange: Boolean, uri: Uri?) {
                scheduleRescan()
            }
        }
        observer = contentObserver
        val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        } else {
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        }
        runCatching { appContext.contentResolver.registerContentObserver(uri, true, contentObserver) }
    }

    fun stopWatching() {
        observer?.let { runCatching { appContext.contentResolver.unregisterContentObserver(it) } }
        observer = null
    }

    /** Downloading an album fires dozens of change events; collapse them into one rescan. */
    private fun scheduleRescan() {
        if (pendingRescan) return
        pendingRescan = true
        scope.launch {
            kotlinx.coroutines.delay(1_500)
            pendingRescan = false
            refresh()
        }
    }

    private fun buildLibrary(songs: List<Song>): Library {
        val byTitle = songs.sortedWith(compareBy<Song, String>(String.CASE_INSENSITIVE_ORDER) { it.title })

        val albums = songs
            // Group by album id where MediaStore has one, otherwise by name so loose downloads
            // from the same album still land together.
            .groupBy { if (it.albumId > 0L) "id:${it.albumId}" else "name:${it.album.lowercase()}" }
            .map { (_, tracks) ->
                val ordered = tracks.sortedWith(
                    compareBy<Song> { if (it.track > 0) it.track else Int.MAX_VALUE }
                        .thenBy(String.CASE_INSENSITIVE_ORDER) { it.title }
                )
                Album(
                    id = tracks.first().albumId,
                    name = tracks.first().album,
                    artist = dominantArtist(tracks),
                    artworkUri = ordered.first().artworkUri,
                    year = tracks.maxOfOrNull { it.year } ?: 0,
                    songs = ordered,
                )
            }
            .sortedWith(compareBy<Album, String>(String.CASE_INSENSITIVE_ORDER) { it.name })

        val artists = songs
            .groupBy { it.artist }
            .map { (name, tracks) ->
                Artist(
                    name = name,
                    albumCount = tracks.map { it.album }.distinct().size,
                    artworkUri = tracks.first().artworkUri,
                    songs = tracks.sortedWith(compareBy<Song, String>(String.CASE_INSENSITIVE_ORDER) { it.title }),
                )
            }
            .sortedWith(compareBy<Artist, String>(String.CASE_INSENSITIVE_ORDER) { it.name })

        val folders = songs
            .groupBy { it.folderPath }
            .map { (path, tracks) ->
                MusicFolder(
                    path = path,
                    name = tracks.first().folderName,
                    songs = tracks.sortedWith(compareBy<Song, String>(String.CASE_INSENSITIVE_ORDER) { it.title }),
                )
            }
            .sortedWith(compareByDescending<MusicFolder> { it.songs.size }.thenBy { it.name })

        return Library(
            songs = byTitle,
            albums = albums,
            artists = artists,
            folders = folders,
            recentlyAdded = songs.sortedByDescending { it.dateAddedSec }.take(60),
            isScanning = false,
            scanned = true,
        )
    }

    /** Compilations end up with one artist per track; show the one that appears most. */
    private fun dominantArtist(tracks: List<Song>): String {
        val counts = tracks.groupingBy { it.artist }.eachCount()
        val top = counts.maxByOrNull { it.value }
        return when {
            top == null -> TagCleaner.UNKNOWN_ARTIST
            counts.size > 2 && top.value < tracks.size / 2 -> "Various artists"
            else -> top.key
        }
    }
}
