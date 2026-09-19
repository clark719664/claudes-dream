package com.claudesdream.hum.data

import android.net.Uri

/** What a file actually is. Books and podcasts are kept out of the music library. */
enum class AudioKind { MUSIC, AUDIOBOOK, PODCAST }

/** A single playable track that lives on the device. */
data class Song(
    val id: Long,
    /** Kept as text so the model stays plain Kotlin and can be unit-tested off-device. */
    val uriString: String,
    val artworkUriString: String,
    val title: String,
    val artist: String,
    val album: String,
    val albumId: Long,
    val durationMs: Long,
    val track: Int,
    val year: Int,
    val dateAddedSec: Long,
    val folderName: String,
    val folderPath: String,
    val fileName: String,
    val kind: AudioKind = AudioKind.MUSIC,
) {
    val uri: Uri by lazy { Uri.parse(uriString) }
    val artworkUri: Uri by lazy { Uri.parse(artworkUriString) }

    /** Everything the search box looks at, pre-lowercased once at scan time. */
    val searchKey: String = "$title $artist $album $fileName".lowercase()

    val isSpokenWord: Boolean get() = kind != AudioKind.MUSIC
}

data class Album(
    val id: Long,
    val name: String,
    val artist: String,
    val artworkUri: Uri,
    val year: Int,
    val songs: List<Song>,
)

data class Artist(
    val name: String,
    val albumCount: Int,
    val artworkUri: Uri,
    val songs: List<Song>,
)

data class MusicFolder(
    val path: String,
    val name: String,
    val songs: List<Song>,
)

/** An audiobook: chapters in listening order, tracked separately from music. */
data class Book(
    val id: String,
    val title: String,
    val author: String,
    val artworkUri: Uri,
    val chapters: List<Song>,
    val isPodcast: Boolean = false,
) {
    val totalMs: Long get() = chapters.sumOf { it.durationMs }
}

/** A generated playlist. Built fresh from listening habits, never stored. */
data class Mix(
    val id: String,
    val title: String,
    val subtitle: String,
    val songs: List<Song>,
)

/** The whole on-device library, already grouped and sorted. */
data class Library(
    val songs: List<Song> = emptyList(),
    val albums: List<Album> = emptyList(),
    val artists: List<Artist> = emptyList(),
    val folders: List<MusicFolder> = emptyList(),
    val books: List<Book> = emptyList(),
    val recentlyAdded: List<Song> = emptyList(),
    val isScanning: Boolean = false,
    val scanned: Boolean = false,
) {
    val isEmpty: Boolean get() = songs.isEmpty() && books.isEmpty()

    /** Covers music and book chapters alike, so the player can resolve anything it is playing. */
    val byId: Map<Long, Song> by lazy {
        val all = HashMap<Long, Song>(songs.size + 16)
        songs.forEach { all[it.id] = it }
        books.forEach { book -> book.chapters.forEach { all[it.id] = it } }
        all
    }

    fun bookContaining(songId: Long): Book? = books.firstOrNull { book -> book.chapters.any { it.id == songId } }
}

/** How the Songs tab is ordered. Stored in preferences so it survives restarts. */
enum class SongSort(val label: String) {
    TITLE("Title (A–Z)"),
    ARTIST("Artist"),
    ALBUM("Album"),
    RECENTLY_ADDED("Recently added"),
    DURATION("Longest first"),
    ;

    companion object {
        fun fromName(name: String?): SongSort = entries.firstOrNull { it.name == name } ?: TITLE
    }
}
