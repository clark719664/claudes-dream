package com.claudesdream.hum.data

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Log

/** Reads every music file the system knows about — downloads included — straight from MediaStore. */
class MediaStoreScanner(private val context: Context) {

    private val albumArtBase: Uri = Uri.parse("content://media/external/audio/albumart")

    private val projection = arrayOf(
        MediaStore.Audio.Media._ID,
        MediaStore.Audio.Media.TITLE,
        MediaStore.Audio.Media.ARTIST,
        MediaStore.Audio.Media.ALBUM,
        MediaStore.Audio.Media.ALBUM_ID,
        MediaStore.Audio.Media.DURATION,
        MediaStore.Audio.Media.TRACK,
        MediaStore.Audio.Media.YEAR,
        MediaStore.Audio.Media.DATE_ADDED,
        MediaStore.Audio.Media.DISPLAY_NAME,
        MediaStore.Audio.Media.DATA,
    )

    /**
     * @param minDurationMs anything shorter is almost certainly a notification blip, not a song.
     */
    fun scan(minDurationMs: Long = 20_000L): List<Song> {
        val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        } else {
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        }

        // Anything flagged as music, plus any other audio that is not a ringtone/alarm/notification —
        // that second half is what catches files dropped into Download/ by a browser.
        val selection = "(${MediaStore.Audio.Media.IS_MUSIC} != 0 OR (" +
            "${MediaStore.Audio.Media.IS_RINGTONE} = 0 AND " +
            "${MediaStore.Audio.Media.IS_ALARM} = 0 AND " +
            "${MediaStore.Audio.Media.IS_NOTIFICATION} = 0)) AND " +
            "${MediaStore.Audio.Media.DURATION} >= ?"
        val selectionArgs = arrayOf(minDurationMs.toString())

        val songs = ArrayList<Song>()
        try {
            context.contentResolver.query(
                collection,
                projection,
                selection,
                selectionArgs,
                "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC",
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                val artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                val albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                val albumIdCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
                val durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                val trackCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK)
                val yearCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.YEAR)
                val dateAddedCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
                val dataCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATA)
                val relativePathCol = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH)
                } else {
                    -1
                }

                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idCol)
                    val fileName = cursor.getStringOrNull(nameCol) ?: "track_$id"
                    val cleaned = TagCleaner.clean(
                        rawTitle = cursor.getStringOrNull(titleCol),
                        rawArtist = cursor.getStringOrNull(artistCol),
                        rawAlbum = cursor.getStringOrNull(albumCol),
                        fileName = fileName,
                    )
                    val fullPath = if (dataCol >= 0) cursor.getStringOrNull(dataCol) else null
                    val relativePath = if (relativePathCol >= 0) cursor.getStringOrNull(relativePathCol) else null
                    val folder = folderOf(fullPath, relativePath)
                    val albumId = cursor.getLong(albumIdCol)

                    songs += Song(
                        id = id,
                        uri = ContentUris.withAppendedId(collection, id),
                        artworkUri = ContentUris.withAppendedId(albumArtBase, albumId),
                        title = cleaned.title,
                        artist = cleaned.artist,
                        album = cleaned.album,
                        albumId = albumId,
                        durationMs = cursor.getLong(durationCol),
                        // TRACK is often encoded as disc*1000 + track.
                        track = cursor.getInt(trackCol).let { if (it > 1000) it % 1000 else it },
                        year = cursor.getInt(yearCol),
                        dateAddedSec = cursor.getLong(dateAddedCol),
                        folderName = folder.second,
                        folderPath = folder.first,
                        fileName = fileName,
                    )
                }
            }
        } catch (e: Exception) {
            // A broken provider on one device should never crash the whole library.
            Log.w(TAG, "MediaStore scan failed", e)
        }
        return songs
    }

    /** @return path used for grouping, plus the human-friendly folder name. */
    private fun folderOf(fullPath: String?, relativePath: String?): Pair<String, String> {
        val path = when {
            !fullPath.isNullOrBlank() -> fullPath.substringBeforeLast('/', "")
            !relativePath.isNullOrBlank() -> relativePath.trimEnd('/')
            else -> ""
        }
        if (path.isBlank()) return "" to "Device storage"
        val name = path.trimEnd('/').substringAfterLast('/').ifBlank { "Device storage" }
        return path to name
    }

    private fun android.database.Cursor.getStringOrNull(index: Int): String? =
        if (index >= 0 && !isNull(index)) getString(index) else null

    private companion object {
        const val TAG = "MediaStoreScanner"
    }
}
