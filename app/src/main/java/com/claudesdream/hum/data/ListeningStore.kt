package com.claudesdream.hum.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

/** What Hum has learned about one track. Everything here stays on the phone. */
data class SongStats(
    val plays: Int = 0,
    val skips: Int = 0,
    val lastPlayedSec: Long = 0L,
    /** Plays per part of day: 0 morning, 1 afternoon, 2 evening, 3 night. */
    val byTimeOfDay: List<Int> = listOf(0, 0, 0, 0),
) {
    fun dominantSlot(): Int = byTimeOfDay.indices.maxByOrNull { byTimeOfDay[it] } ?: 0
}

/**
 * Listening history, kept as one small JSON blob in SharedPreferences. It feeds the mixes;
 * nothing is uploaded anywhere.
 */
class ListeningStore(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences("hum_history", Context.MODE_PRIVATE)

    private val _stats = MutableStateFlow(read())
    val stats: StateFlow<Map<Long, SongStats>> = _stats.asStateFlow()

    /** A track counts as played once most of it has gone by; bailing early counts as a skip. */
    fun record(songId: Long, playedFraction: Float, nowSec: Long, hourOfDay: Int) {
        val current = _stats.value[songId] ?: SongStats()
        val played = playedFraction >= PLAYED_FRACTION
        val skipped = playedFraction < SKIPPED_FRACTION
        if (!played && !skipped) return

        val slots = current.byTimeOfDay.toMutableList()
        if (played) slots[slotOf(hourOfDay)] = slots[slotOf(hourOfDay)] + 1

        val updated = current.copy(
            plays = current.plays + if (played) 1 else 0,
            skips = current.skips + if (skipped) 1 else 0,
            lastPlayedSec = if (played) nowSec else current.lastPlayedSec,
            byTimeOfDay = slots,
        )
        _stats.value = _stats.value + (songId to updated)
        write(_stats.value)
    }

    fun clear() {
        _stats.value = emptyMap()
        prefs.edit().remove(KEY).apply()
    }

    private fun read(): Map<Long, SongStats> {
        val raw = prefs.getString(KEY, null) ?: return emptyMap()
        return try {
            val root = JSONObject(raw)
            val out = HashMap<Long, SongStats>()
            root.keys().forEach { key ->
                val id = key.toLongOrNull() ?: return@forEach
                val entry = root.getJSONObject(key)
                val slots = entry.optString("d", "0,0,0,0").split(',').map { it.toIntOrNull() ?: 0 }
                out[id] = SongStats(
                    plays = entry.optInt("p", 0),
                    skips = entry.optInt("s", 0),
                    lastPlayedSec = entry.optLong("t", 0L),
                    byTimeOfDay = if (slots.size == 4) slots else listOf(0, 0, 0, 0),
                )
            }
            out
        } catch (e: Exception) {
            emptyMap()
        }
    }

    private fun write(stats: Map<Long, SongStats>) {
        try {
            val root = JSONObject()
            stats.forEach { (id, value) ->
                root.put(
                    id.toString(),
                    JSONObject()
                        .put("p", value.plays)
                        .put("s", value.skips)
                        .put("t", value.lastPlayedSec)
                        .put("d", value.byTimeOfDay.joinToString(",")),
                )
            }
            prefs.edit().putString(KEY, root.toString()).apply()
        } catch (e: Exception) {
            // Losing history is never worth a crash.
        }
    }

    companion object {
        private const val KEY = "stats"
        const val PLAYED_FRACTION = 0.6f
        const val SKIPPED_FRACTION = 0.25f

        /** 0 morning (5–11), 1 afternoon (12–17), 2 evening (18–22), 3 night (23–4). */
        fun slotOf(hourOfDay: Int): Int = when (hourOfDay) {
            in 5..11 -> 0
            in 12..17 -> 1
            in 18..22 -> 2
            else -> 3
        }

        fun slotName(slot: Int): String = when (slot) {
            0 -> "Morning"
            1 -> "Afternoon"
            2 -> "Evening"
            else -> "Late night"
        }
    }
}
