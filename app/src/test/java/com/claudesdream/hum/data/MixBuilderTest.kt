package com.claudesdream.hum.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MixBuilderTest {

    private val nowSec = 1_700_000_000L
    private val day = 24L * 60L * 60L

    private fun song(id: Long, artist: String = "Nova", addedDaysAgo: Long = 1) = Song(
        id = id,
        uriString = "content://media/external/audio/media/$id",
        artworkUriString = "content://media/external/audio/albumart/$id",
        title = "Track $id",
        artist = artist,
        album = "Album",
        albumId = 1L,
        durationMs = 200_000L,
        track = id.toInt(),
        year = 2024,
        dateAddedSec = nowSec - addedDaysAgo * day,
        folderName = "Music",
        folderPath = "/storage/emulated/0/Music",
        fileName = "track$id.mp3",
    )

    private fun mixOf(mixes: List<Mix>, id: String): Mix? = mixes.firstOrNull { it.id == id }

    @Test
    fun `a library with no history still gets somewhere to start`() {
        val songs = (1L..10L).map { song(it) }
        val mixes = MixBuilder.build(songs, emptyMap(), emptySet(), nowSec, hourOfDay = 10)

        assertNotNull(mixOf(mixes, "start-here"))
        assertNull("nothing is on repeat yet", mixOf(mixes, "on-repeat"))
    }

    @Test
    fun `heavily played tracks land on repeat, most played first`() {
        val songs = (1L..10L).map { song(it) }
        val stats = (1L..6L).associateWith { id ->
            SongStats(plays = id.toInt() + 1, lastPlayedSec = nowSec - day)
        }
        val mixes = MixBuilder.build(songs, stats, emptySet(), nowSec, hourOfDay = 10)

        val onRepeat = mixOf(mixes, "on-repeat")
        assertNotNull(onRepeat)
        assertEquals(6L, onRepeat!!.songs.first().id)
    }

    @Test
    fun `never played downloads become fresh finds`() {
        val songs = (1L..10L).map { song(it, addedDaysAgo = it) }
        val stats = mapOf(1L to SongStats(plays = 3, lastPlayedSec = nowSec))
        val mixes = MixBuilder.build(songs, stats, emptySet(), nowSec, hourOfDay = 10)

        val fresh = mixOf(mixes, "fresh")
        assertNotNull(fresh)
        assertTrue("played tracks are not fresh", fresh!!.songs.none { it.id == 1L })
        assertEquals("newest first", 2L, fresh.songs.first().id)
    }

    @Test
    fun `things you have not heard in months come back as rediscover`() {
        val songs = (1L..10L).map { song(it) }
        val stats = (1L..6L).associateWith { SongStats(plays = 1, lastPlayedSec = nowSec - 90 * day) }
        val mixes = MixBuilder.build(songs, stats, emptySet(), nowSec, hourOfDay = 10)

        assertNotNull(mixOf(mixes, "rediscover"))
    }

    @Test
    fun `a mix needs enough songs to be worth showing`() {
        val songs = (1L..10L).map { song(it) }
        val favorites = setOf(1L, 2L)
        val mixes = MixBuilder.build(songs, emptyMap(), favorites, nowSec, hourOfDay = 10)

        assertNull("two favourites is not a playlist", mixOf(mixes, "favourites"))
    }

    @Test
    fun `audiobooks never end up in a music mix`() {
        val music = (1L..6L).map { song(it) }
        val book = song(99L).copy(kind = AudioKind.AUDIOBOOK)
        val stats = (1L..6L).associateWith { SongStats(plays = 3, lastPlayedSec = nowSec) } +
            mapOf(99L to SongStats(plays = 20, lastPlayedSec = nowSec))

        val mixes = MixBuilder.build(music + book, stats, emptySet(), nowSec, hourOfDay = 10)

        assertTrue(mixes.isNotEmpty())
        assertTrue(mixes.all { mix -> mix.songs.none { it.id == 99L } })
    }
}
