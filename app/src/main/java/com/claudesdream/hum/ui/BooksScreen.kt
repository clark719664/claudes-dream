package com.claudesdream.hum.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.claudesdream.hum.data.Book

private val SPEEDS = listOf(0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)

@Composable
fun BooksScreen(
    viewModel: MusicViewModel,
    contentPadding: PaddingValues,
    onOpenBook: (String) -> Unit,
) {
    val library by viewModel.library.collectAsStateWithLifecycle()

    if (library.books.isEmpty()) {
        EmptyState(
            icon = Icons.Rounded.MenuBook,
            title = "No audiobooks yet",
            message = "Hum files anything that looks like a book here — .m4b files, an Audiobooks or " +
                "Audible folder, or long chaptered tracks. You can also move any file here from its ⋮ menu.",
        )
        return
    }

    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = contentPadding) {
        items(library.books, key = { it.id }) { book ->
            val progress = viewModel.bookProgressFraction(book)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpenBook(book.id) }
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Artwork(
                    uri = book.artworkUri,
                    modifier = Modifier.size(64.dp),
                    shape = RoundedCornerShape(8.dp),
                    fallbackIcon = Icons.Rounded.MenuBook,
                )
                Spacer(Modifier.width(14.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = book.title,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = book.author,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = plural(book.chapters.size, if (book.isPodcast) "episode" else "chapter") +
                            " · " + formatTotalDuration(book.totalMs),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (progress > 0f) {
                        Spacer(Modifier.height(6.dp))
                        LinearProgressIndicator(
                            progress = { progress },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun BookDetailScreen(
    book: Book,
    viewModel: MusicViewModel,
    onBack: () -> Unit,
    bottomPadding: PaddingValues,
) {
    val playerState by viewModel.playerState.collectAsStateWithLifecycle()
    val speed by viewModel.speed.collectAsStateWithLifecycle()
    val progress = viewModel.bookProgress(book)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(book.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Rounded.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { innerPadding ->
        LazyColumn(modifier = Modifier.padding(innerPadding), contentPadding = bottomPadding) {
            item(key = "book-header") {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Artwork(
                        uri = book.artworkUri,
                        modifier = Modifier.size(170.dp),
                        shape = RoundedCornerShape(12.dp),
                        fallbackIcon = Icons.Rounded.MenuBook,
                    )
                    Spacer(Modifier.height(14.dp))
                    Text(
                        text = book.title,
                        style = MaterialTheme.typography.headlineSmall,
                        textAlign = TextAlign.Center,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = book.author,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = plural(book.chapters.size, if (book.isPodcast) "episode" else "chapter") +
                            " · " + formatTotalDuration(book.totalMs),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    Spacer(Modifier.height(16.dp))
                    Button(onClick = { viewModel.playBook(book) }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Rounded.PlayArrow, null)
                        Spacer(Modifier.width(8.dp))
                        Text(if (progress != null) "Continue listening" else "Start listening")
                    }
                    if (progress != null) {
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = { viewModel.playBookFrom(book, 0) },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Rounded.Replay, null)
                            Spacer(Modifier.width(8.dp))
                            Text("Start from the beginning")
                        }
                    }

                    Spacer(Modifier.height(16.dp))
                    Text(
                        text = "Speed",
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(6.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        SPEEDS.forEach { option ->
                            val selected = option == speed
                            AssistChip(
                                onClick = { viewModel.setSpeed(option) },
                                label = { Text(if (selected) "● " + speedLabel(option) else speedLabel(option)) },
                            )
                        }
                    }
                }
            }

            itemsIndexed(book.chapters, key = { _, chapter -> chapter.id }) { index, chapter ->
                val isCurrent = playerState.currentSongId == chapter.id
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { viewModel.playBookFrom(book, index) }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "${index + 1}",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.width(28.dp),
                    )
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = chapter.title,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal,
                            color = if (isCurrent) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                        )
                        Text(
                            text = formatDuration(chapter.durationMs),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

fun speedLabel(speed: Float): String =
    if (speed == speed.toInt().toFloat()) "${speed.toInt()}×" else "$speed×"
