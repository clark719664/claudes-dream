package com.claudesdream.hum.data

import android.net.Uri

/** A single playable track that lives on the device. */
data class Song(
    val id: Long,
    val uri: Uri,
    val artworkUri: Uri,
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
) {
    /** Everything the search box looks at, pre-lowercased once at scan time. */
    val searchKey: String = "$title $artist $album $fileName".lowercase()
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

/** The whole on-device library, already grouped and sorted. */
data class Library(
    val songs: List<Song> = emptyList(),
    val albums: List<Album> = emptyList(),
    val artists: List<Artist> = emptyList(),
    val folders: List<MusicFolder> = emptyList(),
    val recentlyAdded: List<Song> = emptyList(),
    val isScanning: Boolean = false,
    val scanned: Boolean = false,
) {
    val isEmpty: Boolean get() = songs.isEmpty()

    /** Built once per scan so queue lookups stay cheap. */
    val byId: Map<Long, Song> by lazy { songs.associateBy { it.id } }
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
