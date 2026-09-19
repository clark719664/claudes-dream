package com.claudesdream.hum.data

/**
 * Decides whether a file is music, an audiobook or a podcast.
 *
 * MediaStore only sometimes flags audiobooks, and only on Android 10+, so the flags are backed up
 * with the signals that actually show up in the wild: .m4b files, folders called Audiobooks or
 * Audible, and very long tracks whose names look like chapters.
 */
object AudioClassifier {

    private val BOOK_FOLDER = Regex("(?i)(audio ?books?|audible|librivox|hoerbuch|hörbuch|/books?(/|$))")
    private val PODCAST_FOLDER = Regex("(?i)(podcasts?)")
    private val BOOK_FILE = Regex("(?i)\\.(m4b|aa|aax)$")
    private val CHAPTER_NAME = Regex("(?i)(chapter|chap\\.? ?\\d|part ?\\d|book ?\\d|disc ?\\d|\\bcd ?\\d|unabridged)")

    /** Past this, a file is almost never a song. */
    private const val LONG_TRACK_MS = 40L * 60L * 1000L

    fun classify(
        fileName: String,
        folderPath: String,
        album: String,
        durationMs: Long,
        mediaStoreAudiobook: Boolean,
        mediaStorePodcast: Boolean,
    ): AudioKind {
        if (mediaStoreAudiobook) return AudioKind.AUDIOBOOK
        if (BOOK_FILE.containsMatchIn(fileName)) return AudioKind.AUDIOBOOK
        if (BOOK_FOLDER.containsMatchIn(folderPath)) return AudioKind.AUDIOBOOK

        if (mediaStorePodcast) return AudioKind.PODCAST
        if (PODCAST_FOLDER.containsMatchIn(folderPath)) return AudioKind.PODCAST

        // A 40-minute file called "Chapter 3" is a book even with nothing else to go on.
        if (durationMs >= LONG_TRACK_MS &&
            (CHAPTER_NAME.containsMatchIn(fileName) || CHAPTER_NAME.containsMatchIn(album))
        ) {
            return AudioKind.AUDIOBOOK
        }
        return AudioKind.MUSIC
    }

    /**
     * Orders chapters the way a person would: by track number when tagged, otherwise by the
     * numbers inside the file name, so "Chapter 2" sorts before "Chapter 10".
     */
    fun chapterOrder(): Comparator<Song> = Comparator { a, b ->
        val byTrack = trackOf(a).compareTo(trackOf(b))
        if (byTrack != 0) byTrack else naturalCompare(a.fileName, b.fileName)
    }

    private fun trackOf(song: Song): Int = if (song.track > 0) song.track else Int.MAX_VALUE

    /** Compares strings with embedded numbers numerically: "ch2" < "ch10". */
    fun naturalCompare(left: String, right: String): Int {
        var i = 0
        var j = 0
        while (i < left.length && j < right.length) {
            val a = left[i]
            val b = right[j]
            if (a.isDigit() && b.isDigit()) {
                var endA = i
                while (endA < left.length && left[endA].isDigit()) endA++
                var endB = j
                while (endB < right.length && right[endB].isDigit()) endB++
                // Trim leading zeros so 007 and 7 compare equal.
                val numA = left.substring(i, endA).trimStart('0')
                val numB = right.substring(j, endB).trimStart('0')
                if (numA.length != numB.length) return numA.length - numB.length
                val cmp = numA.compareTo(numB)
                if (cmp != 0) return cmp
                i = endA
                j = endB
            } else {
                val cmp = a.lowercaseChar().compareTo(b.lowercaseChar())
                if (cmp != 0) return cmp
                i++
                j++
            }
        }
        return (left.length - i) - (right.length - j)
    }
}
