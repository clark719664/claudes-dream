package com.claudesdream.hum

import android.app.Application
import com.claudesdream.hum.data.MusicRepository
import com.claudesdream.hum.data.Prefs

class HumApplication : Application() {
    val repository: MusicRepository by lazy { MusicRepository(this) }
    val prefs: Prefs by lazy { Prefs(this) }
}
