package com.claudesdream.hum.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Forward30
import androidx.compose.material.icons.rounded.Replay30
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.RepeatOne
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.Player

@Composable
fun NowPlayingScreen(
    viewModel: MusicViewModel,
    onCollapse: () -> Unit,
    onOpenAlbum: (Long) -> Unit,
    onOpenArtist: (String) -> Unit,
) {
    val song by viewModel.currentSong.collectAsStateWithLifecycle()
    val state by viewModel.playerState.collectAsStateWithLifecycle()
    val isFavorite by viewModel.isFavoriteCurrent.collectAsStateWithLifecycle()
    val speed by viewModel.speed.collectAsStateWithLifecycle()
    val queue by viewModel.queue.collectAsStateWithLifecycle()

    var scrubPosition by remember { mutableStateOf<Float?>(null) }
    var showQueue by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState()

    val current = song
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onCollapse) {
                    Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = "Close player")
                }
                Spacer(Modifier.weight(1f))
                Text(
                    text = if (state.hasQueue) "Playing ${state.queueIndex + 1} of ${state.queueIds.size}" else "Now playing",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { showQueue = true }) {
                    Icon(Icons.Rounded.QueueMusic, contentDescription = "Queue")
                }
            }

            if (current == null) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Nothing is playing yet.", style = MaterialTheme.typography.bodyLarge)
                }
                return@Column
            }

            Spacer(Modifier.height(16.dp))
            Artwork(
                uri = current.artworkUri,
                modifier = Modifier.fillMaxWidth().aspectRatio(1f),
                shape = RoundedCornerShape(24.dp),
            )
            Spacer(Modifier.height(28.dp))

            Text(
                text = current.title,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = current.artist,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth().clickable { onOpenArtist(current.artist) },
            )
            Text(
                text = current.album,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth().clickable { onOpenAlbum(current.albumId) },
            )

            Spacer(Modifier.height(20.dp))
            val duration = if (state.durationMs > 0L) state.durationMs else current.durationMs
            val sliderValue = scrubPosition ?: state.positionMs.toFloat()
            Slider(
                value = sliderValue.coerceIn(0f, duration.toFloat().coerceAtLeast(1f)),
                onValueChange = { scrubPosition = it },
                onValueChangeFinished = {
                    scrubPosition?.let { viewModel.seekTo(it.toLong()) }
                    scrubPosition = null
                },
                valueRange = 0f..duration.toFloat().coerceAtLeast(1f),
            )
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(formatDuration(sliderValue.toLong()), style = MaterialTheme.typography.labelMedium)
                Text(formatDuration(duration), style = MaterialTheme.typography.labelMedium)
            }

            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Books and podcasts get the controls that actually matter for them: jump back
                // thirty seconds, and a speed you can change without leaving the screen.
                if (current.isSpokenWord) {
                    TextButton(onClick = { viewModel.setSpeed(nextSpeed(speed)) }) {
                        Text(speedLabel(speed), style = MaterialTheme.typography.titleSmall)
                    }
                    IconButton(onClick = { viewModel.seekBy(-30_000L) }) {
                        Icon(Icons.Rounded.Replay30, contentDescription = "Back 30 seconds", modifier = Modifier.size(36.dp))
                    }
                } else {
                    IconButton(onClick = viewModel::toggleShuffle) {
                        Icon(
                            imageVector = Icons.Rounded.Shuffle,
                            contentDescription = "Shuffle",
                            tint = if (state.shuffle) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = viewModel::previous) {
                        Icon(Icons.Rounded.SkipPrevious, contentDescription = "Previous", modifier = Modifier.size(40.dp))
                    }
                }
                FilledIconButton(onClick = viewModel::playPause, modifier = Modifier.size(72.dp)) {
                    Icon(
                        imageVector = if (state.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        contentDescription = if (state.isPlaying) "Pause" else "Play",
                        modifier = Modifier.size(38.dp),
                    )
                }
                if (current.isSpokenWord) {
                    IconButton(onClick = { viewModel.seekBy(30_000L) }) {
                        Icon(Icons.Rounded.Forward30, contentDescription = "Forward 30 seconds", modifier = Modifier.size(36.dp))
                    }
                    IconButton(onClick = viewModel::next) {
                        Icon(Icons.Rounded.SkipNext, contentDescription = "Next chapter", modifier = Modifier.size(36.dp))
                    }
                } else {
                    IconButton(onClick = viewModel::next) {
                        Icon(Icons.Rounded.SkipNext, contentDescription = "Next", modifier = Modifier.size(40.dp))
                    }
                    IconButton(onClick = viewModel::cycleRepeat) {
                        Icon(
                            imageVector = if (state.repeatMode == Player.REPEAT_MODE_ONE) Icons.Rounded.RepeatOne else Icons.Rounded.Repeat,
                            contentDescription = "Repeat",
                            tint = if (state.repeatMode == Player.REPEAT_MODE_OFF) {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            } else {
                                MaterialTheme.colorScheme.primary
                            },
                        )
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            IconButton(onClick = { viewModel.toggleFavorite(current.id) }) {
                Icon(
                    imageVector = if (isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                    contentDescription = "Favourite",
                    tint = if (isFavorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }

    if (showQueue) {
        ModalBottomSheet(onDismissRequest = { showQueue = false }, sheetState = sheetState) {
            Text(
                text = "Up next",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(start = 20.dp, bottom = 8.dp),
            )
            LazyColumn(modifier = Modifier.fillMaxWidth()) {
                itemsIndexed(queue, key = { index, item -> "$index-${item.id}" }) { index, item ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { viewModel.playQueueItem(index) }
                            .padding(horizontal = 20.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Artwork(uri = item.artworkUri, modifier = Modifier.size(42.dp), shape = CircleShape)
                        Spacer(Modifier.width(14.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = item.title,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                fontWeight = if (index == state.queueIndex) FontWeight.Bold else FontWeight.Normal,
                                color = if (index == state.queueIndex) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.onSurface
                                },
                            )
                            Text(
                                text = item.artist,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        IconButton(onClick = { viewModel.removeFromQueue(index) }) {
                            Icon(Icons.Rounded.Close, contentDescription = "Remove from queue")
                        }
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/** Taps cycle through the usual audiobook speeds. */
private fun nextSpeed(current: Float): Float {
    val options = listOf(0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
    val index = options.indexOfFirst { it > current - 0.01f && it < current + 0.01f }
    return options[(index + 1) % options.size]
}
