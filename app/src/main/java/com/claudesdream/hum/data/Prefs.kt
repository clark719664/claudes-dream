package com.claudesdream.hum.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Small, boring persistence: sort order, favourites, book progress and where playback left off. */
class Prefs(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences("hum_prefs", Context.MODE_PRIVATE)

    private val _sort = MutableStateFlow(SongSort.fromName(prefs.getString(KEY_SORT, null)))
    val sort: StateFlow<SongSort> = _sort.asStateFlow()

    private val _favorites = MutableStateFlow(readFavorites())
    val favorites: StateFlow<Set<Long>> = _favorites.asStateFlow()

    /** Files the user has moved between Music and Audiobooks by hand; these always win. */
    private val _kindOverrides = MutableStateFlow(readKindOverrides())
    val kindOverrides: StateFlow<Map<Long, AudioKind>> = _kindOverrides.asStateFlow()

    private val _speed = MutableStateFlow(prefs.getFloat(KEY_SPEED, 1f))
    val speed: StateFlow<Float> = _speed.asStateFlow()

    fun setSort(sort: SongSort) {
        _sort.value = sort
        prefs.edit().putString(KEY_SORT, sort.name).apply()
    }

    fun toggleFavorite(songId: Long) {
        val updated = _favorites.value.toMutableSet()
        if (!updated.add(songId)) updated.remove(songId)
        _favorites.value = updated
        prefs.edit().putStringSet(KEY_FAVORITES, updated.map { it.toString() }.toSet()).apply()
    }

    fun setKind(songId: Long, kind: AudioKind) {
        val updated = _kindOverrides.value.toMutableMap()
        updated[songId] = kind
        _kindOverrides.value = updated
        prefs.edit()
            .putStringSet(KEY_KINDS, updated.map { "${it.key}:${it.value.name}" }.toSet())
            .apply()
    }

    fun setSpeed(value: Float) {
        _speed.value = value
        prefs.edit().putFloat(KEY_SPEED, value).apply()
    }

    /** Books resume per book, not globally — that is the whole point of a book. */
    fun saveBookProgress(bookId: String, songId: Long, positionMs: Long) {
        prefs.edit()
            .putString(KEY_BOOK_PREFIX + bookId, "$songId:$positionMs")
            .apply()
    }

    fun bookProgress(bookId: String): BookProgress? {
        val raw = prefs.getString(KEY_BOOK_PREFIX + bookId, null) ?: return null
        val parts = raw.split(':')
        val songId = parts.getOrNull(0)?.toLongOrNull() ?: return null
        val position = parts.getOrNull(1)?.toLongOrNull() ?: 0L
        return BookProgress(songId, position)
    }

    fun saveResume(songId: Long, positionMs: Long) {
        prefs.edit()
            .putLong(KEY_LAST_SONG, songId)
            .putLong(KEY_LAST_POSITION, positionMs)
            .apply()
    }

    val lastSongId: Long get() = prefs.getLong(KEY_LAST_SONG, -1L)
    val lastPositionMs: Long get() = prefs.getLong(KEY_LAST_POSITION, 0L)

    private fun readFavorites(): Set<Long> =
        prefs.getStringSet(KEY_FAVORITES, emptySet())
            .orEmpty()
            .mapNotNull { it.toLongOrNull() }
            .toSet()

    private fun readKindOverrides(): Map<Long, AudioKind> =
        prefs.getStringSet(KEY_KINDS, emptySet())
            .orEmpty()
            .mapNotNull { entry ->
                val parts = entry.split(':')
                val id = parts.getOrNull(0)?.toLongOrNull() ?: return@mapNotNull null
                val kind = AudioKind.entries.firstOrNull { it.name == parts.getOrNull(1) } ?: return@mapNotNull null
                id to kind
            }
            .toMap()

    private companion object {
        const val KEY_SORT = "song_sort"
        const val KEY_FAVORITES = "favorites"
        const val KEY_KINDS = "kind_overrides"
        const val KEY_SPEED = "playback_speed"
        const val KEY_BOOK_PREFIX = "book_progress_"
        const val KEY_LAST_SONG = "last_song"
        const val KEY_LAST_POSITION = "last_position"
    }
}

data class BookProgress(val songId: Long, val positionMs: Long)
