package com.claudesdream.hum.data

import kotlin.random.Random

/**
 * Builds the playlists on the Mixes tab out of what you actually listen to: plays, skips,
 * favourites, when you listen and what you have not heard in a while. Pure functions, so the
 * behaviour is unit-tested rather than guessed at.
 */
object MixBuilder {

    private const val MAX_SONGS = 40
    private const val MIN_SONGS = 5
    private const val DAY_SEC = 24L * 60L * 60L

    fun build(
        songs: List<Song>,
        stats: Map<Long, SongStats>,
        favorites: Set<Long>,
        nowSec: Long,
        hourOfDay: Int,
        seed: Long = nowSec / DAY_SEC,
    ): List<Mix> {
        val music = songs.filter { it.kind == AudioKind.MUSIC }
        if (music.isEmpty()) return emptyList()

        val random = Random(seed)
        val mixes = mutableListOf<Mix>()

        fun add(id: String, title: String, subtitle: String, picks: List<Song>) {
            if (picks.size >= MIN_SONGS) {
                mixes += Mix(id, title, subtitle, picks.take(MAX_SONGS))
            }
        }

        val played = music.filter { (stats[it.id]?.plays ?: 0) > 0 }

        // Nothing listened to yet, so lead with a way in rather than an empty tab.
        if (stats.isEmpty()) {
            add("start-here", "Start here", "A shuffle of your whole library", music.shuffled(random))
        }

        add(
            id = "on-repeat",
            title = "On repeat",
            subtitle = "The ones you keep coming back to",
            picks = music
                .filter { (stats[it.id]?.plays ?: 0) >= 2 }
                .sortedByDescending { stats[it.id]?.plays ?: 0 },
        )

        add(
            id = "favourites",
            title = "Your favourites",
            subtitle = "Everything you have hearted",
            picks = music.filter { it.id in favorites }.shuffled(random),
        )

        topArtist(music, stats, favorites)?.let { artist ->
            val byArtist = music.filter { it.artist == artist }
            val neighbourFolders = byArtist.map { it.folderPath }.toSet()
            val neighbours = music.filter { it.artist != artist && it.folderPath in neighbourFolders }
            add(
                id = "more-like-$artist",
                title = "More like $artist",
                subtitle = "Your most played artist, plus what sits beside them",
                picks = (byArtist.shuffled(random) + neighbours.shuffled(random)),
            )
        }

        add(
            id = "rediscover",
            title = "Rediscover",
            subtitle = "Played once, then forgotten",
            picks = played
                .filter { nowSec - (stats[it.id]?.lastPlayedSec ?: 0L) > 45 * DAY_SEC }
                .sortedBy { stats[it.id]?.lastPlayedSec ?: 0L },
        )

        add(
            id = "fresh",
            title = "Fresh finds",
            subtitle = "Downloaded but never played",
            picks = music
                .filter { (stats[it.id]?.plays ?: 0) == 0 }
                .sortedByDescending { it.dateAddedSec },
        )

        val slot = ListeningStore.slotOf(hourOfDay)
        add(
            id = "time-$slot",
            title = "${ListeningStore.slotName(slot)} listening",
            subtitle = "What you usually play around now",
            picks = played
                .filter { stats[it.id]?.dominantSlot() == slot }
                .sortedByDescending { stats[it.id]?.plays ?: 0 },
        )

        add(
            id = "never-skipped",
            title = "Never skipped",
            subtitle = "Tracks you always let run",
            picks = music
                .filter { (stats[it.id]?.plays ?: 0) >= 2 && (stats[it.id]?.skips ?: 0) == 0 }
                .shuffled(random),
        )

        return mixes
    }

    /** Favourites count double — hearting something says more than leaving it playing. */
    private fun topArtist(songs: List<Song>, stats: Map<Long, SongStats>, favorites: Set<Long>): String? {
        if (songs.isEmpty()) return null
        val scores = HashMap<String, Int>()
        songs.forEach { song ->
            val plays = stats[song.id]?.plays ?: 0
            val bonus = if (song.id in favorites) 2 else 0
            if (plays + bonus > 0) {
                scores[song.artist] = (scores[song.artist] ?: 0) + plays + bonus
            }
        }
        val best = scores.maxByOrNull { it.value } ?: return null
        return if (best.key == TagCleaner.UNKNOWN_ARTIST) null else best.key
    }
}
