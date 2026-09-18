package com.claudesdream.hum.data

import org.junit.Assert.assertEquals
import org.junit.Test

class TagCleanerTest {

    @Test
    fun `strips download noise from the title`() {
        val result = TagCleaner.clean(
            rawTitle = "Sunset Drive (Official Music Video) [HD]",
            rawArtist = "Nova",
            rawAlbum = "Night Roads",
            fileName = "sunset.mp3",
        )
        assertEquals("Sunset Drive", result.title)
        assertEquals("Nova", result.artist)
    }

    @Test
    fun `falls back to the file name and splits artist from title`() {
        val result = TagCleaner.clean(
            rawTitle = "<unknown>",
            rawArtist = "<unknown>",
            rawAlbum = null,
            fileName = "03. Nova - Sunset Drive (Official Video) [320kbps].mp3",
        )
        assertEquals("Nova", result.artist)
        assertEquals("Sunset Drive", result.title)
        assertEquals(TagCleaner.UNKNOWN_ALBUM, result.album)
    }

    @Test
    fun `keeps meaningful bracketed parts`() {
        val result = TagCleaner.clean(
            rawTitle = "Sunset Drive (Live) (Official Audio)",
            rawArtist = "Nova - Topic",
            rawAlbum = "Night Roads",
            fileName = "sunset.mp3",
        )
        assertEquals("Sunset Drive (Live)", result.title)
        assertEquals("Nova", result.artist)
    }

    @Test
    fun `drops site prefixes and underscores`() {
        val result = TagCleaner.clean(
            rawTitle = null,
            rawArtist = null,
            rawAlbum = null,
            fileName = "www.songsite.com - Nova_-_Sunset_Drive.mp3",
        )
        assertEquals("Nova", result.artist)
        assertEquals("Sunset Drive", result.title)
    }
}
