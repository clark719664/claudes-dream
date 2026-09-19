package com.claudesdream.hum.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudesdream.hum.data.Mix
import com.claudesdream.hum.data.Song

/**
 * The home tab: playlists Hum builds from what you actually listen to. Everything here is worked
 * out on the phone from play counts, skips, favourites and the time of day.
 */
@Composable
fun MixesScreen(
    viewModel: MusicViewModel,
    contentPadding: PaddingValues,
    onOpenMix: (String) -> Unit,
) {
    val mixes by viewModel.mixes.collectAsStateWithLifecycle()
    val library by viewModel.library.collectAsStateWithLifecycle()

    if (library.songs.isEmpty()) {
        EmptyState(
            icon = Icons.Rounded.AutoAwesome,
            title = "Mixes appear as you listen",
            message = "Play a few songs and Hum starts building playlists for you — what you have on " +
                "repeat, what you have not heard in a while, what you usually play at this hour.",
        )
        return
    }

    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = contentPadding) {
        item(key = "mixes-head") {
            Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                Text("Made for you", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    text = "Built on this phone from what you play — nothing leaves the device.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = { viewModel.shuffle(library.songs) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Rounded.Shuffle, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Shuffle everything")
                }
            }
        }

        items(mixes, key = { it.id }) { mix ->
            MixCard(
                mix = mix,
                onOpen = { onOpenMix(mix.id) },
                onPlay = { viewModel.playMix(mix) },
            )
        }

        item(key = "mixes-foot") {
            Text(
                text = "Mixes refresh as your listening changes.",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(16.dp),
            )
        }
    }
}

@Composable
private fun MixCard(mix: Mix, onOpen: () -> Unit, onPlay: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clickable(onClick = onOpen),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ArtworkCollage(mix.songs)
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = mix.title,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = mix.subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = plural(mix.songs.size, "song"),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            IconButton(onClick = onPlay) {
                Icon(Icons.Rounded.PlayArrow, contentDescription = "Play ${mix.title}", modifier = Modifier.size(30.dp))
            }
        }
    }
}

/** Four covers in a square, so a mix looks like a mix rather than like one album. */
@Composable
private fun ArtworkCollage(songs: List<Song>) {
    val covers = songs.map { it.artworkUri }.distinct().take(4)
    Column(
        modifier = Modifier
            .size(76.dp)
            .clip(RoundedCornerShape(14.dp)),
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(1.dp), modifier = Modifier.weight(1f)) {
            Artwork(covers.getOrNull(0), modifier = Modifier.weight(1f).fillMaxSize(), shape = RoundedCornerShape(0.dp))
            Artwork(covers.getOrNull(1), modifier = Modifier.weight(1f).fillMaxSize(), shape = RoundedCornerShape(0.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(1.dp), modifier = Modifier.weight(1f)) {
            Artwork(covers.getOrNull(2), modifier = Modifier.weight(1f).fillMaxSize(), shape = RoundedCornerShape(0.dp))
            Artwork(covers.getOrNull(3), modifier = Modifier.weight(1f).fillMaxSize(), shape = RoundedCornerShape(0.dp))
        }
    }
}
