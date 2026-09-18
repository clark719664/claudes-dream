package com.claudesdream.hum.data

/**
 * Downloaded music is messy: files arrive named things like
 * "01. Artist - Song Name (Official Music Video) [320kbps].mp3" and often carry no tags at all.
 * This turns that into a clean title / artist pair so the library sorts itself sensibly.
 */
object TagCleaner {

    const val UNKNOWN_ARTIST = "Unknown artist"
    const val UNKNOWN_ALBUM = "Unknown album"

    private val UNKNOWN_VALUES = setOf("<unknown>", "unknown", "unknown artist", "untitled", "")

    private val EXTENSION = Regex("(?i)\\.(mp3|m4a|m4b|aac|flac|wav|ogg|oga|opus|wma|mp4|mkv|3gp|amr|aif{1,2})$")

    /** "www.somesite.com - " / "[MySite.in] " style prefixes that download sites glue on. */
    private val SITE_PREFIX = Regex(
        "(?i)^\\s*[\\[(]?\\s*(www\\.)?[a-z0-9-]{2,}\\.(com|net|org|info|in|co|io|me|to|ru|pk|biz|xyz)\\s*[\\])]?\\s*[-_~:|]*\\s*"
    )

    /** Leading track numbers: "01 - ", "07.", "3) ". */
    private val TRACK_PREFIX = Regex("^\\s*\\d{1,3}\\s*[-._)\\]]\\s+")

    /** Noise words that carry no musical meaning. "(Live)", "(Remix)", "(Acoustic)" are kept. */
    private const val JUNK_WORDS =
        "official\\s*(music\\s*)?video|official\\s*audio|official\\s*visuali[sz]er|official\\s*lyrics?\\s*video|" +
            "music\\s*video|lyrics?\\s*video|with\\s*lyrics|lyrics?|visuali[sz]er|audio\\s*only|full\\s*audio|" +
            "hd\\s*video|full\\s*hd|hd|hq|4k|1080p|720p|high\\s*quality|" +
            "\\d{2,3}\\s*kbps|mp3|m4a|flac|free\\s*download|download|copyright\\s*free|no\\s*copyright|" +
            "full\\s*song|full\\s*video\\s*song|video\\s*song|new\\s*song|explicit|clean|" +
            "youtube|yt|dailymotion|tiktok"

    /**
     * A narrower set, used when the noise is NOT wrapped in brackets, so real titles such as
     * "Mr. Clean" or "The Download" survive.
     */
    private const val JUNK_WORDS_STRICT =
        "official\\s*(music\\s*)?video|official\\s*audio|official\\s*visuali[sz]er|official\\s*lyrics?\\s*video|" +
            "lyrics?\\s*video|with\\s*lyrics|music\\s*video|video\\s*song|full\\s*song|" +
            "\\d{2,3}\\s*kbps|free\\s*download|copyright\\s*free|no\\s*copyright|high\\s*quality|" +
            "hd\\s*video|full\\s*hd|hd|hq|4k|1080p|720p"

    private val JUNK_BRACKET = Regex("(?i)[\\[({]\\s*(?:$JUNK_WORDS)(?:\\s*[-|,/]\\s*(?:$JUNK_WORDS))*\\s*[\\])}]")
    private val JUNK_TRAILING = Regex("(?i)\\s*[-–—|~]\\s*(?:$JUNK_WORDS_STRICT)\\s*$")
    private val JUNK_BARE_SUFFIX = Regex("(?i)\\s+(?:$JUNK_WORDS_STRICT)\\s*$")
    private val EMPTY_BRACKETS = Regex("[\\[({]\\s*[\\])}]")
    private val MULTI_SPACE = Regex("\\s{2,}")
    private val TOPIC_CHANNEL = Regex("(?i)\\s*-\\s*topic\\s*$")

    data class Cleaned(val title: String, val artist: String, val album: String)

    fun clean(rawTitle: String?, rawArtist: String?, rawAlbum: String?, fileName: String): Cleaned {
        val fromTags = rawTitle?.takeIf { it.isMeaningful() }
        val base = tidy(fromTags ?: fileName.removeExtension())

        var artist = rawArtist?.takeIf { it.isMeaningful() }?.let { tidyArtist(it) }
        var title = base

        // No artist tag? Downloaded files almost always encode it as "Artist - Title".
        if (artist == null) {
            val split = splitArtistAndTitle(base)
            if (split != null) {
                artist = tidyArtist(split.first)
                title = split.second
            }
        } else if (title.startsWith("$artist - ", ignoreCase = true)) {
            // Tagged files sometimes repeat the artist inside the title.
            title = title.removeRange(0, artist.length + 3).trim()
        }

        val album = rawAlbum?.takeIf { it.isMeaningful() }?.let { tidy(it) } ?: UNKNOWN_ALBUM

        return Cleaned(
            title = title.ifBlank { fileName.removeExtension().ifBlank { "Untitled" } },
            artist = artist?.takeIf { it.isNotBlank() } ?: UNKNOWN_ARTIST,
            album = album.ifBlank { UNKNOWN_ALBUM },
        )
    }

    private fun String.isMeaningful(): Boolean = trim().lowercase() !in UNKNOWN_VALUES

    private fun String.removeExtension(): String = EXTENSION.replace(this, "")

    private fun splitArtistAndTitle(value: String): Pair<String, String>? {
        val separators = listOf(" - ", " – ", " — ", " _ ")
        for (separator in separators) {
            val index = value.indexOf(separator)
            if (index > 0) {
                val left = value.substring(0, index).trim()
                val right = value.substring(index + separator.length).trim()
                // Guard against titles that merely contain a dash, e.g. "Song - Part 2".
                if (left.isNotEmpty() && right.isNotEmpty() && left.length <= 60) {
                    return left to right
                }
            }
        }
        return null
    }

    private fun tidy(value: String): String {
        var out = value.trim().replace('_', ' ')
        out = SITE_PREFIX.replace(out, "")
        out = out.removeExtension()
        out = TRACK_PREFIX.replace(out, "")
        // Junk can be layered: "(Official Video) [HD] 320kbps" — keep peeling until stable.
        for (pass in 0 until 4) {
            val before = out
            out = JUNK_BRACKET.replace(out, " ")
            out = JUNK_TRAILING.replace(out, "")
            out = JUNK_BARE_SUFFIX.replace(out, "")
            out = EMPTY_BRACKETS.replace(out, " ")
            out = out.trim().trim('-', '|', '~', '–', '—', '·', ',').trim()
            if (out == before) break
        }
        out = MULTI_SPACE.replace(out, " ").trim()
        return out
    }

    private fun tidyArtist(value: String): String {
        val out = TOPIC_CHANNEL.replace(tidy(value), "").trim()
        return out.ifBlank { UNKNOWN_ARTIST }
    }

    /** First letter used by the fast-scroll index; everything non A–Z lands under "#". */
    fun initialOf(value: String): String {
        val first = value.trim().firstOrNull()?.uppercaseChar() ?: return "#"
        return if (first in 'A'..'Z') first.toString() else "#"
    }
}
