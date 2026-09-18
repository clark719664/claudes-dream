package com.claudesdream.hum.ui

import java.util.Locale
import java.util.concurrent.TimeUnit

/** 3:07 / 1:02:33 */
fun formatDuration(ms: Long): String {
    if (ms <= 0L) return "0:00"
    val totalSeconds = TimeUnit.MILLISECONDS.toSeconds(ms)
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) {
        String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
    } else {
        String.format(Locale.US, "%d:%02d", minutes, seconds)
    }
}

fun plural(count: Int, singular: String, pluralForm: String = singular + "s"): String =
    "$count " + if (count == 1) singular else pluralForm

/** "1 hr 12 min" — used for album / folder totals. */
fun formatTotalDuration(ms: Long): String {
    val minutes = TimeUnit.MILLISECONDS.toMinutes(ms)
    return if (minutes >= 60) {
        val hours = minutes / 60
        val rest = minutes % 60
        if (rest == 0L) "$hours hr" else "$hours hr $rest min"
    } else {
        "$minutes min"
    }
}
