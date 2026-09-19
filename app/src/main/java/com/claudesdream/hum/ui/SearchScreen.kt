package com.claudesdream.hum.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Clear
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun SearchScreen(
    viewModel: MusicViewModel,
    onBack: () -> Unit,
    onOpenAlbum: (Long) -> Unit,
    onOpenArtist: (String) -> Unit,
    onOpenBook: (String) -> Unit,
    bottomPadding: PaddingValues = PaddingValues(bottom = 0.dp),
) {
    val query by viewModel.query.collectAsStateWithLifecycle()
    val results by viewModel.searchResults.collectAsStateWithLifecycle()
    val favorites by viewModel.favorites.collectAsStateWithLifecycle()
    val playerState by viewModel.playerState.collectAsStateWithLifecycle()
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) { runCatching { focusRequester.requestFocus() } }

    Scaffold(
        topBar = {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp, top = 40.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.Rounded.ArrowBack, contentDescription = "Back")
                }
                OutlinedTextField(
                    value = query,
                    onValueChange = viewModel::setQuery,
                    modifier = Modifier.weight(1f).focusRequester(focusRequester),
                    singleLine = true,
                    placeholder = { Text("Songs, artists, albums…") },
                    leadingIcon = { Icon(Icons.Rounded.Search, null) },
                    trailingIcon = {
                        if (query.isNotEmpty()) {
                            IconButton(onClick = { viewModel.setQuery("") }) {
                                Icon(Icons.Rounded.Clear, contentDescription = "Clear")
                            }
                        }
                    },
                )
            }
        },
    ) { innerPadding ->
        LazyColumn(modifier = Modifier.padding(innerPadding), contentPadding = bottomPadding) {
            if (query.isNotBlank() && results.isEmpty) {
                item {
                    Text(
                        text = "Nothing matched \"$query\".",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(24.dp),
                    )
                }
            }
            if (results.artists.isNotEmpty()) {
                item(key = "artists-header") { SectionHeader("Artists") }
                items(results.artists, key = { "artist-" + it.name }) { artist ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onOpenArtist(artist.name) }
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Artwork(
                            uri = artist.artworkUri,
                            modifier = Modifier.size(44.dp),
                            shape = CircleShape,
                            fallbackIcon = Icons.Rounded.Person,
                        )
                        Spacer(Modifier.width(14.dp))
                        Column {
                            Text(artist.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                text = plural(artist.songs.size, "song"),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            if (results.albums.isNotEmpty()) {
                item(key = "albums-header") { SectionHeader("Albums") }
                items(results.albums, key = { "album-" + it.id + it.name }) { album ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onOpenAlbum(album.id) }
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Artwork(
                            uri = album.artworkUri,
                            modifier = Modifier.size(44.dp),
                            fallbackIcon = Icons.Rounded.Album,
                        )
                        Spacer(Modifier.width(14.dp))
                        Column {
                            Text(album.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
            if (results.books.isNotEmpty()) {
                item(key = "books-header") { SectionHeader("Audiobooks") }
                items(results.books, key = { "book-" + it.id }) { book ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onOpenBook(book.id) }
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Artwork(
                            uri = book.artworkUri,
                            modifier = Modifier.size(44.dp),
                            fallbackIcon = Icons.Rounded.MenuBook,
                        )
                        Spacer(Modifier.width(14.dp))
                        Column {
                            Text(book.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                text = book.author + " · " + plural(book.chapters.size, "chapter"),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
            if (results.songs.isNotEmpty()) {
                item(key = "songs-header") { SectionHeader("Songs") }
                items(results.songs, key = { "song-" + it.id }) { song ->
                    SongRow(
                        song = song,
                        isCurrent = playerState.currentSongId == song.id,
                        isFavorite = song.id in favorites,
                        onClick = { viewModel.play(results.songs, results.songs.indexOf(song)) },
                        onPlayNext = { viewModel.playNext(song) },
                        onAddToQueue = { viewModel.addToQueue(listOf(song)) },
                        onToggleFavorite = { viewModel.toggleFavorite(song.id) },
                        onOpenAlbum = { onOpenAlbum(song.albumId) },
                        onOpenArtist = { onOpenArtist(song.artist) },
                        onChangeKind = { kind -> viewModel.setKind(song.id, kind) },
                    )
                }
            }
        }
    }
}
