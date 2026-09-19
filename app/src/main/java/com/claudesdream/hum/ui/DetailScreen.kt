package com.claudesdream.hum.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudesdream.hum.data.Song

/** One screen shape reused for albums, artists, folders and favourites. */
@Composable
fun DetailScreen(
    title: String,
    subtitle: String,
    artworkUri: android.net.Uri?,
    fallbackIcon: ImageVector,
    circularArt: Boolean,
    songs: List<Song>,
    viewModel: MusicViewModel,
    onBack: () -> Unit,
    onOpenAlbum: ((Long) -> Unit)? = null,
    onOpenArtist: ((String) -> Unit)? = null,
    bottomPadding: PaddingValues = PaddingValues(bottom = 0.dp),
) {
    val favorites by viewModel.favorites.collectAsStateWithLifecycle()
    val playerState by viewModel.playerState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Rounded.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier.padding(innerPadding),
            contentPadding = bottomPadding,
        ) {
            item(key = "detail-header") {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Artwork(
                        uri = artworkUri,
                        modifier = Modifier.size(180.dp),
                        shape = if (circularArt) CircleShape else RoundedCornerShape(18.dp),
                        fallbackIcon = fallbackIcon,
                    )
                    Spacer(Modifier.height(14.dp))
                    Text(
                        text = title,
                        style = MaterialTheme.typography.headlineSmall,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = 24.dp),
                    )
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
                    )
                }
                PlayShuffleRow(
                    subtitle = formatTotalDuration(songs.sumOf { it.durationMs }) + " total",
                    onPlayAll = { viewModel.play(songs, 0) },
                    onShuffle = { viewModel.shuffle(songs) },
                )
            }
            items(songs, key = { it.id }) { song ->
                SongRow(
                    song = song,
                    isCurrent = playerState.currentSongId == song.id,
                    isFavorite = song.id in favorites,
                    onClick = { viewModel.play(songs, songs.indexOf(song)) },
                    onPlayNext = { viewModel.playNext(song) },
                    onAddToQueue = { viewModel.addToQueue(listOf(song)) },
                    onToggleFavorite = { viewModel.toggleFavorite(song.id) },
                    onOpenAlbum = onOpenAlbum?.let { open -> { open(song.albumId) } },
                    onOpenArtist = onOpenArtist?.let { open -> { open(song.artist) } },
                    onChangeKind = { kind -> viewModel.setKind(song.id, kind) },
                )
            }
        }
    }
}
