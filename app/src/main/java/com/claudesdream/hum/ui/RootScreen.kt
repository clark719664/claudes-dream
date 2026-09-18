package com.claudesdream.hum.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudesdream.hum.data.SongSort
import com.claudesdream.hum.data.TagCleaner

/** Screens stacked on top of the tabbed library. */
sealed interface Screen {
    data class AlbumDetail(val albumId: Long) : Screen
    data class ArtistDetail(val name: String) : Screen
    data class FolderDetail(val path: String) : Screen
    data object Favorites : Screen
    data object Search : Screen
}

private enum class Tab(val label: String) { SONGS("Songs"), ALBUMS("Albums"), ARTISTS("Artists"), FOLDERS("Folders") }

@Composable
fun RootScreen(viewModel: MusicViewModel, onRequestPermission: () -> Unit) {
    val hasPermission by viewModel.hasPermission.collectAsStateWithLifecycle()
    if (!hasPermission) {
        WelcomeScreen(onRequestPermission)
        return
    }

    val library by viewModel.library.collectAsStateWithLifecycle()
    val stack = remember { mutableStateListOf<Screen>() }
    var tab by remember { mutableStateOf(Tab.SONGS) }
    var showPlayer by remember { mutableStateOf(false) }

    val openAlbum: (Long) -> Unit = { stack.add(Screen.AlbumDetail(it)); showPlayer = false }
    val openArtist: (String) -> Unit = { stack.add(Screen.ArtistDetail(it)); showPlayer = false }
    val openFolder: (String) -> Unit = { stack.add(Screen.FolderDetail(it)) }
    val pop: () -> Unit = { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) }

    BackHandler(enabled = showPlayer) { showPlayer = false }
    BackHandler(enabled = !showPlayer && stack.isNotEmpty()) { pop() }

    Box(modifier = Modifier.fillMaxSize()) {
    Scaffold(
        bottomBar = {
            Column {
                MiniPlayer(viewModel = viewModel, onExpand = { showPlayer = true })
                NavigationBar {
                    Tab.entries.forEach { entry ->
                        NavigationBarItem(
                            selected = tab == entry && stack.isEmpty(),
                            onClick = {
                                tab = entry
                                stack.clear()
                            },
                            icon = { Icon(entry.icon(), contentDescription = entry.label) },
                            label = { Text(entry.label) },
                        )
                    }
                }
            }
        },
    ) { innerPadding ->
        val bottomInset = PaddingValues(bottom = innerPadding.calculateBottomPadding() + 12.dp)
        Box(modifier = Modifier.fillMaxSize().padding(bottom = innerPadding.calculateBottomPadding())) {
            when (val screen = stack.lastOrNull()) {
                null -> LibraryHome(
                    viewModel = viewModel,
                    tab = tab,
                    contentPadding = bottomInset,
                    onOpenAlbum = openAlbum,
                    onOpenArtist = openArtist,
                    onOpenFolder = openFolder,
                    onOpenSearch = { stack.add(Screen.Search) },
                    onOpenFavorites = { stack.add(Screen.Favorites) },
                )

                is Screen.AlbumDetail -> {
                    val album = library.albums.firstOrNull { it.id == screen.albumId }
                    DetailScreen(
                        title = album?.name ?: TagCleaner.UNKNOWN_ALBUM,
                        subtitle = (album?.artist ?: "") + " · " + plural(album?.songs?.size ?: 0, "song"),
                        artworkUri = album?.artworkUri,
                        fallbackIcon = Icons.Rounded.Album,
                        circularArt = false,
                        songs = album?.songs.orEmpty(),
                        viewModel = viewModel,
                        onBack = pop,
                        onOpenArtist = openArtist,
                        bottomPadding = bottomInset,
                    )
                }

                is Screen.ArtistDetail -> {
                    val artist = library.artists.firstOrNull { it.name == screen.name }
                    DetailScreen(
                        title = artist?.name ?: screen.name,
                        subtitle = plural(artist?.songs?.size ?: 0, "song") + " · " +
                            plural(artist?.albumCount ?: 0, "album"),
                        artworkUri = artist?.artworkUri,
                        fallbackIcon = Icons.Rounded.Person,
                        circularArt = true,
                        songs = artist?.songs.orEmpty(),
                        viewModel = viewModel,
                        onBack = pop,
                        onOpenAlbum = openAlbum,
                        bottomPadding = bottomInset,
                    )
                }

                is Screen.FolderDetail -> {
                    val folder = library.folders.firstOrNull { it.path == screen.path }
                    DetailScreen(
                        title = folder?.name ?: "Folder",
                        subtitle = folder?.path?.removePrefix("/storage/emulated/0/") ?: screen.path,
                        artworkUri = folder?.songs?.firstOrNull()?.artworkUri,
                        fallbackIcon = Icons.Rounded.Folder,
                        circularArt = false,
                        songs = folder?.songs.orEmpty(),
                        viewModel = viewModel,
                        onBack = pop,
                        onOpenAlbum = openAlbum,
                        onOpenArtist = openArtist,
                        bottomPadding = bottomInset,
                    )
                }

                Screen.Favorites -> {
                    val favorites by viewModel.favoriteSongs.collectAsStateWithLifecycle()
                    DetailScreen(
                        title = "Favourites",
                        subtitle = plural(favorites.size, "song"),
                        artworkUri = favorites.firstOrNull()?.artworkUri,
                        fallbackIcon = Icons.Rounded.Favorite,
                        circularArt = false,
                        songs = favorites,
                        viewModel = viewModel,
                        onBack = pop,
                        onOpenAlbum = openAlbum,
                        onOpenArtist = openArtist,
                        bottomPadding = bottomInset,
                    )
                }

                Screen.Search -> SearchScreen(
                    viewModel = viewModel,
                    onBack = pop,
                    onOpenAlbum = openAlbum,
                    onOpenArtist = openArtist,
                    bottomPadding = bottomInset,
                )
            }
        }
    }

    AnimatedVisibility(
        visible = showPlayer,
        enter = slideInVertically(initialOffsetY = { it }),
        exit = slideOutVertically(targetOffsetY = { it }),
    ) {
        NowPlayingScreen(
            viewModel = viewModel,
            onCollapse = { showPlayer = false },
            onOpenAlbum = openAlbum,
            onOpenArtist = openArtist,
        )
    }
    }
}

@Composable
private fun LibraryHome(
    viewModel: MusicViewModel,
    tab: Tab,
    contentPadding: PaddingValues,
    onOpenAlbum: (Long) -> Unit,
    onOpenArtist: (String) -> Unit,
    onOpenFolder: (String) -> Unit,
    onOpenSearch: () -> Unit,
    onOpenFavorites: () -> Unit,
) {
    val library by viewModel.library.collectAsStateWithLifecycle()
    val sort by viewModel.sort.collectAsStateWithLifecycle()
    var menuOpen by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(tab.label) },
            actions = {
                IconButton(onClick = onOpenSearch) {
                    Icon(Icons.Rounded.Search, contentDescription = "Search")
                }
                IconButton(onClick = onOpenFavorites) {
                    Icon(Icons.Rounded.Favorite, contentDescription = "Favourites")
                }
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Rounded.MoreVert, contentDescription = "More")
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        Text(
                            text = "Sort songs by",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(start = 16.dp, top = 8.dp, bottom = 4.dp),
                        )
                        SongSort.entries.forEach { option ->
                            DropdownMenuItem(
                                text = { Text(option.label) },
                                trailingIcon = {
                                    if (option == sort) Icon(Icons.Rounded.Check, contentDescription = null)
                                },
                                onClick = {
                                    viewModel.setSort(option)
                                    menuOpen = false
                                },
                            )
                        }
                        HorizontalDivider()
                        DropdownMenuItem(
                            text = { Text("Rescan device") },
                            leadingIcon = { Icon(Icons.Rounded.Refresh, contentDescription = null) },
                            onClick = {
                                viewModel.rescan()
                                menuOpen = false
                            },
                        )
                    }
                }
            },
        )

        if (library.isScanning && library.isEmpty) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }

        Box(modifier = Modifier.fillMaxSize()) {
            when (tab) {
                Tab.SONGS -> SongsTab(viewModel, contentPadding, onOpenAlbum, onOpenArtist)
                Tab.ALBUMS -> AlbumsTab(library.albums, contentPadding, onOpenAlbum)
                Tab.ARTISTS -> ArtistsTab(library.artists, contentPadding, onOpenArtist)
                Tab.FOLDERS -> FoldersTab(library.folders, contentPadding, onOpenFolder)
            }
        }
    }
}

@Composable
private fun WelcomeScreen(onRequestPermission: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(112.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Rounded.LibraryMusic,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(56.dp),
                )
            }
            Spacer(Modifier.height(28.dp))
            Text("Welcome to Hum", style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            Text(
                text = "Hum plays the music already on your phone — downloads included. " +
                    "Allow access to your audio files and everything sorts itself out.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(32.dp))
            Button(onClick = onRequestPermission) { Text("Find my music") }
        }
    }
}

private fun Tab.icon() = when (this) {
    Tab.SONGS -> Icons.Rounded.MusicNote
    Tab.ALBUMS -> Icons.Rounded.Album
    Tab.ARTISTS -> Icons.Rounded.Person
    Tab.FOLDERS -> Icons.Rounded.Folder
}
