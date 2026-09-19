package com.claudesdream.hum.data

import org.junit.Assert.assertEquals
import org.junit.Test

class AudioClassifierTest {

    private fun classify(
        fileName: String,
        folder: String = "/storage/emulated/0/Music",
        album: String = "Some Album",
        durationMs: Long = 4 * 60 * 1000L,
        audiobookFlag: Boolean = false,
        podcastFlag: Boolean = false,
    ) = AudioClassifier.classify(fileName, folder, album, durationMs, audiobookFlag, podcastFlag)

    @Test
    fun `m4b files are audiobooks wherever they live`() {
        assertEquals(AudioKind.AUDIOBOOK, classify("the-hobbit.m4b"))
    }

    @Test
    fun `audiobook folders win over a short duration`() {
        assertEquals(
            AudioKind.AUDIOBOOK,
            classify("part1.mp3", folder = "/storage/emulated/0/Audiobooks/Dune"),
        )
        assertEquals(
            AudioKind.AUDIOBOOK,
            classify("01.mp3", folder = "/storage/emulated/0/Audible/Neuromancer"),
        )
    }

    @Test
    fun `long chaptered files are audiobooks even with no other hint`() {
        assertEquals(
            AudioKind.AUDIOBOOK,
            classify("Chapter 4.mp3", durationMs = 55 * 60 * 1000L),
        )
    }

    @Test
    fun `a long song is still a song`() {
        assertEquals(
            AudioKind.MUSIC,
            classify("Echoes.mp3", album = "Meddle", durationMs = 23 * 60 * 1000L),
        )
    }

    @Test
    fun `the media store flags are trusted`() {
        assertEquals(AudioKind.AUDIOBOOK, classify("x.mp3", audiobookFlag = true))
        assertEquals(AudioKind.PODCAST, classify("x.mp3", podcastFlag = true))
    }

    @Test
    fun `ordinary downloads stay music`() {
        assertEquals(
            AudioKind.MUSIC,
            classify("Nova - Sunset Drive.mp3", folder = "/storage/emulated/0/Download"),
        )
    }

    @Test
    fun `chapters sort numerically, not alphabetically`() {
        val names = listOf("Chapter 10.mp3", "Chapter 2.mp3", "Chapter 1.mp3")
        val sorted = names.sortedWith { a, b -> AudioClassifier.naturalCompare(a, b) }
        assertEquals(listOf("Chapter 1.mp3", "Chapter 2.mp3", "Chapter 10.mp3"), sorted)
    }
}
