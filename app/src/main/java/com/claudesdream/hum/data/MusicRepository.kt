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
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Owns the device library. Scans MediaStore, splits music from audiobooks, groups the rest into
 * albums/artists/folders, and rescans on its own whenever the system reports new audio — so a song
 * downloaded while the app is open shows up without the user doing anything.
 */
class MusicRepository(context: Context) {

    private val appContext = context.applicationContext
    private val scanner = MediaStoreScanner(appContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val scanLock = Mutex()

    private val _library = MutableStateFlow(Library())
    val library: StateFlow<Library> = _library.asStateFlow()

    /** Raw scan results, kept so re-categorising a file does not need a rescan. */
    private var scanned: List<Song> = emptyList()
    private var overrides: Map<Long, AudioKind> = emptyMap()

    private var observer: ContentObserver? = null
    private var pendingRescan: Boolean = false

    fun refresh() {
        scope.launch {
            scanLock.withLock {
                _library.value = _library.value.copy(isScanning = true)
                scanned = scanner.scan()
                _library.value = buildLibrary(applyOverrides(scanned))
            }
        }
    }

    /** Called when the user moves a file between Music and Audiobooks by hand. */
    fun setKindOverrides(map: Map<Long, AudioKind>) {
        if (map == overrides) return
        overrides = map
        scope.launch {
            scanLock.withLock {
                if (scanned.isNotEmpty()) {
                    _library.value = buildLibrary(applyOverrides(scanned))
                }
            }
        }
    }

    private fun applyOverrides(songs: List<Song>): List<Song> {
        if (overrides.isEmpty()) return songs
        return songs.map { song ->
            val override = overrides[song.id]
            if (override != null && override != song.kind) song.copy(kind = override) else song
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
            delay(1_500)
            pendingRescan = false
            refresh()
        }
    }

    private fun buildLibrary(all: List<Song>): Library {
        val music = all.filter { it.kind == AudioKind.MUSIC }
        val spokenWord = all.filter { it.kind != AudioKind.MUSIC }

        val byTitle = music.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.title })

        val albums = music
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
            .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })

        val artists = music
            .groupBy { it.artist }
            .map { (name, tracks) ->
                Artist(
                    name = name,
                    albumCount = tracks.map { it.album }.distinct().size,
                    artworkUri = tracks.first().artworkUri,
                    songs = tracks.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.title }),
                )
            }
            .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })

        val folders = music
            .groupBy { it.folderPath }
            .map { (path, tracks) ->
                MusicFolder(
                    path = path,
                    name = tracks.first().folderName,
                    songs = tracks.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.title }),
                )
            }
            .sortedWith(compareByDescending<MusicFolder> { it.songs.size }.thenBy { it.name })

        return Library(
            songs = byTitle,
            albums = albums,
            artists = artists,
            folders = folders,
            books = buildBooks(spokenWord),
            recentlyAdded = music.sortedByDescending { it.dateAddedSec }.take(60),
            isScanning = false,
            scanned = true,
        )
    }

    /** One book per album, falling back to the folder for the untagged rips people actually have. */
    private fun buildBooks(spokenWord: List<Song>): List<Book> = spokenWord
        .groupBy { song ->
            if (song.album != TagCleaner.UNKNOWN_ALBUM && song.album.isNotBlank()) {
                "album:${song.album.lowercase()}"
            } else {
                "folder:${song.folderPath}"
            }
        }
        .map { (key, chapters) ->
            val ordered = chapters.sortedWith(AudioClassifier.chapterOrder())
            val first = ordered.first()
            Book(
                id = key,
                title = if (key.startsWith("album:")) first.album else first.folderName,
                author = dominantArtist(chapters),
                artworkUri = first.artworkUri,
                chapters = ordered,
                isPodcast = chapters.all { it.kind == AudioKind.PODCAST },
            )
        }
        .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.title })

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
