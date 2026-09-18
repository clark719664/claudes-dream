package com.claudesdream.hum.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val LightColors = lightColorScheme(
    primary = Color(0xFF6A53D8),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE6DEFF),
    onPrimaryContainer = Color(0xFF21005D),
    secondary = Color(0xFF615B71),
    surface = Color(0xFFFFFBFF),
    surfaceVariant = Color(0xFFE7E0EB),
    background = Color(0xFFFFFBFF),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFC9BDFF),
    onPrimary = Color(0xFF34275E),
    primaryContainer = Color(0xFF4B3D77),
    onPrimaryContainer = Color(0xFFE8DEFF),
    secondary = Color(0xFFCBC3DB),
    surface = Color(0xFF141218),
    surfaceVariant = Color(0xFF2A2732),
    background = Color(0xFF131016),
)

@Composable
fun HumTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    // Material You colours on Android 12+, a purple fallback everywhere else.
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        darkTheme -> DarkColors
        else -> LightColors
    }
    MaterialTheme(colorScheme = colorScheme, content = content)
}
