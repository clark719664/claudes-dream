package com.claudesdream.hum.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudesdream.hum.data.Album
import com.claudesdream.hum.data.Artist
import com.claudesdream.hum.data.MusicFolder
import com.claudesdream.hum.data.Song

/** Shared list body: a header, then every song, wired up to playback and the overflow menu. */
@Composable
fun SongListBody(
    songs: List<Song>,
    viewModel: MusicViewModel,
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
    headerSubtitle: String? = null,
    onOpenAlbum: ((Long) -> Unit)? = null,
    onOpenArtist: ((String) -> Unit)? = null,
) {
    val favorites by viewModel.favorites.collectAsStateWithLifecycle()
    val playerState by viewModel.playerState.collectAsStateWithLifecycle()

    LazyColumn(modifier = modifier.fillMaxSize(), contentPadding = contentPadding) {
        if (headerSubtitle != null) {
            item(key = "header") {
                PlayShuffleRow(
                    subtitle = headerSubtitle,
                    onPlayAll = { viewModel.play(songs, 0) },
                    onShuffle = { viewModel.shuffle(songs) },
                )
            }
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
            )
        }
    }
}

@Composable
fun SongsTab(
    viewModel: MusicViewModel,
    contentPadding: PaddingValues,
    onOpenAlbum: (Long) -> Unit,
    onOpenArtist: (String) -> Unit,
) {
    val songs by viewModel.sortedSongs.collectAsStateWithLifecycle()
    if (songs.isEmpty()) {
        EmptyState(
            icon = Icons.Rounded.LibraryMusic,
            title = "No music yet",
            message = "Download or copy some music onto your phone and Hum will pick it up automatically.",
            actionLabel = "Scan again",
            onAction = viewModel::rescan,
        )
        return
    }
    SongListBody(
        songs = songs,
        viewModel = viewModel,
        contentPadding = contentPadding,
        headerSubtitle = plural(songs.size, "song") + " on this device",
        onOpenAlbum = onOpenAlbum,
        onOpenArtist = onOpenArtist,
    )
}

@Composable
fun AlbumsTab(
    albums: List<Album>,
    contentPadding: PaddingValues,
    onOpenAlbum: (Long) -> Unit,
) {
    if (albums.isEmpty()) {
        EmptyState(
            icon = Icons.Rounded.Album,
            title = "No albums",
            message = "Albums appear here as soon as there is music on the device.",
        )
        return
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 150.dp),
        contentPadding = contentPadding,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
    ) {
        items(albums, key = { it.name + it.id }) { album ->
            Column(modifier = Modifier.clickable { onOpenAlbum(album.id) }) {
                Artwork(
                    uri = album.artworkUri,
                    modifier = Modifier.fillMaxWidth().aspectRatio(1f),
                    fallbackIcon = Icons.Rounded.Album,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = album.name,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = album.artist,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
fun ArtistsTab(
    artists: List<Artist>,
    contentPadding: PaddingValues,
    onOpenArtist: (String) -> Unit,
) {
    if (artists.isEmpty()) {
        EmptyState(
            icon = Icons.Rounded.Person,
            title = "No artists",
            message = "Artists are worked out from your files — even untagged downloads.",
        )
        return
    }
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = contentPadding) {
        items(artists, key = { it.name }) { artist ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpenArtist(artist.name) }
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Artwork(
                    uri = artist.artworkUri,
                    modifier = Modifier.size(52.dp),
                    shape = CircleShape,
                    fallbackIcon = Icons.Rounded.Person,
                )
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(artist.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        text = plural(artist.songs.size, "song") + " · " + plural(artist.albumCount, "album"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
fun FoldersTab(
    folders: List<MusicFolder>,
    contentPadding: PaddingValues,
    onOpenFolder: (String) -> Unit,
) {
    if (folders.isEmpty()) {
        EmptyState(
            icon = Icons.Rounded.Folder,
            title = "No folders",
            message = "Folders show where your music actually lives — Download, Music, WhatsApp Audio and so on.",
        )
        return
    }
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = contentPadding) {
        items(folders, key = { it.path }) { folder ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpenFolder(folder.path) }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Rounded.Folder,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(34.dp),
                )
                Spacer(Modifier.width(16.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(folder.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        text = plural(folder.songs.size, "song") + " · " + folder.path.removePrefix("/storage/emulated/0/"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}
