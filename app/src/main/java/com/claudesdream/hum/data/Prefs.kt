package com.claudesdream.hum.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Small, boring persistence: sort order, favourites and where playback left off. */
class Prefs(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences("hum_prefs", Context.MODE_PRIVATE)

    private val _sort = MutableStateFlow(SongSort.fromName(prefs.getString(KEY_SORT, null)))
    val sort: StateFlow<SongSort> = _sort.asStateFlow()

    private val _favorites = MutableStateFlow(readFavorites())
    val favorites: StateFlow<Set<Long>> = _favorites.asStateFlow()

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

    fun isFavorite(songId: Long): Boolean = songId in _favorites.value

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

    private companion object {
        const val KEY_SORT = "song_sort"
        const val KEY_FAVORITES = "favorites"
        const val KEY_LAST_SONG = "last_song"
        const val KEY_LAST_POSITION = "last_position"
    }
}
