//! Cancellable recursive filesystem traversal with optional content search
//! (spec §24, task 0089).
//!
//! [`SearchEngine::start`] resolves every root eagerly (so a bad root is
//! rejected synchronously) then hands traversal to either:
//! - A blocking task using `ignore::WalkBuilder` for `file://` roots (optimal
//!   local-filesystem path with `.gitignore` awareness), or
//! - An async task using provider-neutral VFS calls (`list`/`open_read`) for
//!   non-local roots (spec §6, task 0125).
//!
//! Entries are matched and streamed in batches rather than collected into
//! memory, so a 100k-file tree cannot flood the frontend or blow up backend
//! memory.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use fm_domain::{EntryId, EntryKind, EntrySummary, Location, OperationId, ProviderId};
use fm_events::{
    BackendEventPayload, ContentMatchSummary, EntryRefPayload, EntrySummaryPayload, EventAudience,
    EventBus, OperationProgressDetails, OperationProgressPayload, OperationStatePayload,
};
use fm_vfs::{
    ContentMatch, ContentQuery, EntryRef, FileSystemProvider, ListOptions, ProviderCapabilities,
    ProviderRegistry, looks_like_binary, search_content,
};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, BufReader};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::matcher::{detect_match_mode, matches_name};
use crate::scanner::{FileScanError, scan_file};
use crate::store::SearchResultsStore;

/// Maximum number of matches buffered before a batch is flushed.
const BATCH_SIZE: usize = 500;
/// Maximum time a partial batch is held before being flushed anyway, so a
/// slow-to-fill search still streams results promptly.
const BATCH_INTERVAL: Duration = Duration::from_millis(100);

/// Errors starting or controlling a search.
#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    /// No root locations were provided.
    #[error("a search requires at least one root location")]
    NoRoots,
    /// A root location cannot be resolved to a native filesystem path.
    #[error("root location is not addressable on the local filesystem: {0}")]
    InvalidRoot(String),
    /// No search is tracked under this id.
    #[error("no search is tracked with id {0}")]
    NotFound(Uuid),
    /// Content query is invalid (empty or bad regex).
    #[error("invalid content query: {0}")]
    InvalidContentQuery(String),
}

/// Starts and cancels recursive searches (filename and/or content), streaming
/// matches over the event bus as they are found.
pub struct SearchEngine {
    store: Arc<SearchResultsStore>,
    events: EventBus,
    providers: ProviderRegistry,
}

/// Parameters for a search request.
#[derive(Debug, Clone)]
pub struct SearchOptions {
    /// Filename query. Empty string means "match all filenames".
    pub filename_query: String,
    /// Optional content query. When present, matching files are scanned for
    /// the content pattern.
    pub content_query: Option<ContentQuery>,
    /// When false, only search the root directories themselves without
    /// descending into subdirectories.
    pub recurse: bool,
    /// When false, hidden files/directories (dotfiles, and anything ignored
    /// by `.gitignore`/`.ignore`) are never descended into or matched,
    /// mirroring the pane's "show hidden files" setting. Defaults to `true`
    /// (search everything) for back-compat with callers that don't set it.
    pub show_hidden: bool,
    /// When present, the engine emits `operation.*` events for progress
    /// tracking in the operation centre.
    pub operation_id: Option<OperationId>,
}

impl SearchEngine {
    /// Creates an engine that stores results in `store` and streams batches
    /// over `events`.
    #[must_use]
    pub fn new(
        store: Arc<SearchResultsStore>,
        events: EventBus,
        providers: ProviderRegistry,
    ) -> Self {
        Self {
            store,
            events,
            providers,
        }
    }

    /// Starts a new cancellable search over `roots` with `options`, publishing
    /// matches to `audience` as they are found.
    ///
    /// `search_id` doubles as the search's `operation_id` (see
    /// [`SearchOptions::operation_id`]) so the generic `/operations/{id}/cancel`
    /// route and the operation centre can address a running search without a
    /// separate id space.
    ///
    /// Returns the virtual `search://local/{searchId}` location that lists
    /// its results (spec §24).
    ///
    /// # Errors
    ///
    /// Returns [`SearchError::NoRoots`] if `roots` is empty,
    /// [`SearchError::InvalidRoot`] if a root cannot be resolved, or
    /// [`SearchError::InvalidContentQuery`] if the content query is malformed.
    pub fn start(
        &self,
        search_id: Uuid,
        roots: Vec<Location>,
        options: SearchOptions,
        audience: EventAudience,
    ) -> Result<Location, SearchError> {
        if roots.is_empty() {
            return Err(SearchError::NoRoots);
        }

        // Partition roots into native (file://) and VFS (non-local) paths.
        let mut root_paths = Vec::new();
        let mut vfs_roots = Vec::new();
        for root in &roots {
            match root.to_native_path() {
                Ok(path) => root_paths.push(path),
                Err(_) => vfs_roots.push(root.clone()),
            }
        }

        let cancellation = CancellationToken::new();
        self.store.register(search_id, cancellation.clone());

        // Count how many traversal paths are active for completion coordination.
        let active_paths =
            (usize::from(!root_paths.is_empty())) + (usize::from(!vfs_roots.is_empty()));
        let coord = CompletionCoordinator {
            total_paths: active_paths,
            finished_paths: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        };

        // Spawn blocking task for native (file://) roots using WalkBuilder.
        if !root_paths.is_empty() {
            let store = Arc::clone(&self.store);
            let events = self.events.clone();
            let options = options.clone();
            let cancellation = cancellation.clone();
            let audience = audience.clone();
            let coord = coord.clone();
            tokio::task::spawn_blocking(move || {
                run_search_native(
                    search_id,
                    root_paths,
                    &options,
                    &cancellation,
                    &store,
                    &events,
                    &audience,
                    coord,
                );
            });
        }

        // Spawn async task for VFS (non-local) roots.
        if !vfs_roots.is_empty() {
            let store = Arc::clone(&self.store);
            let events = self.events.clone();
            let providers = self.providers.clone();
            let options = options.clone();
            let cancellation = cancellation.clone();
            let audience = audience.clone();
            let coord = coord.clone();
            tokio::spawn(async move {
                run_search_vfs(
                    search_id,
                    vfs_roots,
                    &options,
                    &cancellation,
                    &store,
                    &events,
                    &audience,
                    providers,
                    coord,
                )
                .await;
            });
        }

        let location = Location::new(
            ProviderId::new("search"),
            format!("search://local/{search_id}"),
        );
        Ok(location)
    }

    /// Requests prompt cancellation of a running search.
    ///
    /// # Errors
    ///
    /// Returns [`SearchError::NotFound`] if no search is tracked with this
    /// id.
    pub fn cancel(&self, search_id: Uuid) -> Result<(), SearchError> {
        self.store
            .cancel(search_id)
            .ok_or(SearchError::NotFound(search_id))
    }
}

/// Walks every root depth-first, streaming matches in batches.
///
/// When a content query is provided, files that pass the filename filter
/// (or all files if the filename query is empty) are scanned for content
/// matches. Binary files and oversized files are skipped.
///
/// Symlinks are never followed (`follow_links(false)`), which both keeps
/// traversal cycle-free without a visited-inode set and matches the
/// "no symlink-following by default" requirement. Unreadable directories
/// increment a warning counter instead of aborting the whole search.
///
/// Traversal uses the `ignore` crate (the same traversal engine ripgrep is
/// built on) rather than a plain recursive walk: it respects `.gitignore`/
/// `.ignore`/global git-ignore rules, so build output and dependency
/// directories (`target/`, `node_modules/`, `dist/`, ...) are pruned
/// entirely instead of being descended into on every search — this was the
/// dominant cost of a repository-rooted search, far more than raw syscall
/// overhead. `.git` is pruned explicitly (`filter_entry`) as a belt-and-
/// braces measure regardless of hidden-file settings, since its object
/// database is never useful search content. When `show_hidden` is `false`,
/// dotfiles/dot-directories are pruned too (`hidden(true)`); when `true`,
/// only ignored/`.git` content is skipped.
/// Immutable context shared by every [`flush`] call within a single search run.
struct SearchContext<'a> {
    search_id: Uuid,
    store: &'a SearchResultsStore,
    events: &'a EventBus,
    audience: &'a EventAudience,
    operation_id: Option<OperationId>,
}

/// Shared completion state for coordinated multi-path searches.
///
/// When both native and VFS paths are active, each owns a handle. Completion
/// is only emitted when the last handle finishes.
#[derive(Clone)]
struct CompletionCoordinator {
    total_paths: usize,
    /// Atomic tracking is needed since native runs on blocking thread,
    /// VFS runs on async thread.
    finished_paths: Arc<std::sync::atomic::AtomicUsize>,
}

impl CompletionCoordinator {
    fn finished_when_current_ends(&self) -> usize {
        self.finished_paths
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            + 1
    }

    fn is_last(self) -> bool {
        self.finished_when_current_ends() == self.total_paths
    }
}

fn run_search_native(
    search_id: Uuid,
    roots: Vec<PathBuf>,
    options: &SearchOptions,
    cancellation: &CancellationToken,
    store: &SearchResultsStore,
    events: &EventBus,
    audience: &EventAudience,
    completion: CompletionCoordinator,
) {
    let ctx = SearchContext {
        search_id,
        store,
        events,
        audience,
        operation_id: options.operation_id,
    };
    let filename_mode = detect_match_mode(&options.filename_query);
    let has_filename_filter = !options.filename_query.is_empty();
    let has_content_query = options.content_query.is_some();
    // Buffer carries (entry, optional content matches).
    let mut buffer: Vec<(EntrySummary, Option<Vec<ContentMatchSummary>>)> =
        Vec::with_capacity(BATCH_SIZE);
    let mut warnings_count = 0_u32;
    let mut last_flush = Instant::now();
    // Files added to the results so far; this is what the operation centre
    // shows as the search's progress count (task 0089 follow-up).
    let mut matches_found: u64 = 0;
    // The most recently examined entry, so progress events can show "currently
    // scanning: <file>" even while a long content scan finds nothing yet.
    let mut current_entry: Option<EntryRefPayload> = None;

    let max_depth = if options.recurse { None } else { Some(1) };
    'roots: for root in roots {
        let walker = ignore::WalkBuilder::new(&root)
            .follow_links(false)
            .max_depth(max_depth)
            .hidden(!options.show_hidden)
            .filter_entry(|entry| entry.file_name().to_str() != Some(".git"))
            .build();
        for entry in walker {
            if cancellation.is_cancelled() {
                break 'roots;
            }
            match entry {
                Ok(dir_entry) => {
                    let path = dir_entry.path();
                    // Skip directories (and anything `ignore` couldn't stat, e.g. stdin) —
                    // content search only applies to regular files.
                    if dir_entry.file_type().is_none_or(|ft| !ft.is_file()) {
                        continue;
                    }

                    // Check filename match (if a filter is given).
                    if has_filename_filter {
                        let name = match dir_entry.file_name().to_str() {
                            Some(n) => n,
                            None => continue,
                        };
                        if !matches_name(name, &options.filename_query, filename_mode) {
                            continue;
                        }
                    }

                    // Build entry summary first.
                    let Some(summary) = build_entry_summary(search_id, path) else {
                        continue;
                    };

                    current_entry = Some(EntryRefPayload {
                        id: summary.id,
                        location: summary.location.clone().into(),
                    });

                    // Scan content if requested.
                    if has_content_query {
                        let content_query = options
                            .content_query
                            .as_ref()
                            .expect("has_content_query guarantees content_query is Some");
                        let runtime = tokio::runtime::Handle::current();
                        let matches =
                            match runtime.block_on(scan_file(path, content_query, cancellation)) {
                                Ok(result) => {
                                    if !result.matches.is_empty() {
                                        Some(
                                            result
                                                .matches
                                                .iter()
                                                .map(|m| ContentMatchSummary {
                                                    line_number: m.line_number,
                                                    offset: m.match_start,
                                                    length: m.match_len,
                                                })
                                                .collect(),
                                        )
                                    } else {
                                        None
                                    }
                                }
                                Err(FileScanError::Cancelled) => {
                                    cancellation.cancel();
                                    break 'roots;
                                }
                                Err(_) => {
                                    // Binary, too large, or I/O error — skip silently.
                                    None
                                }
                            };

                        // Only emit entry if we found content matches.
                        if let Some(cm) = matches {
                            matches_found += 1;
                            buffer.push((summary, Some(cm)));
                        }
                    } else {
                        // Filename-only search.
                        matches_found += 1;
                        buffer.push((summary, None));
                    }
                }
                Err(_) => warnings_count += 1,
            }
            // Flush on a timer regardless of whether the buffer has anything
            // in it, so a long content scan with sparse (or zero) matches
            // still reports live progress instead of appearing stalled.
            if buffer.len() >= BATCH_SIZE || last_flush.elapsed() >= BATCH_INTERVAL {
                flush(
                    &ctx,
                    &mut buffer,
                    warnings_count,
                    false,
                    matches_found,
                    current_entry.clone(),
                );
                last_flush = Instant::now();
            }
        }
    }
    let is_last = completion.is_last();
    flush(
        &ctx,
        &mut buffer,
        warnings_count,
        is_last,
        matches_found,
        current_entry.clone(),
    );

    if is_last {
        if let Some(op_id) = ctx.operation_id {
            let state = if cancellation.is_cancelled() {
                OperationStatePayload::Cancelled
            } else {
                OperationStatePayload::Completed
            };
            events.publish(
                audience.clone(),
                BackendEventPayload::OperationStateChanged {
                    operation_id: op_id,
                    state,
                },
            );
        }
    }
}

/// Maximum bytes to scan per file during VFS content search.
const VFS_MAX_SCAN_BYTES: u64 = 10 * 1024 * 1024; // 10 MiB
/// Bytes to read for binary sniff over VFS streams.
const VFS_SNIFF_BYTES: usize = 8192;

/// Recursively traverses VFS roots using provider-neutral API.
///
/// Uses `list()` for directory enumeration and `open_read()` for content
/// scanning. No `.gitignore` awareness (not available over VFS). Symlinks
/// are tracked by URI to prevent cycles.
async fn run_search_vfs(
    search_id: Uuid,
    roots: Vec<Location>,
    options: &SearchOptions,
    cancellation: &CancellationToken,
    store: &SearchResultsStore,
    events: &EventBus,
    audience: &EventAudience,
    providers: ProviderRegistry,
    completion: CompletionCoordinator,
) {
    let ctx = SearchContext {
        search_id,
        store,
        events,
        audience,
        operation_id: options.operation_id,
    };
    let filename_mode = detect_match_mode(&options.filename_query);
    let has_filename_filter = !options.filename_query.is_empty();
    let has_content_query = options.content_query.is_some();
    let mut buffer: Vec<(EntrySummary, Option<Vec<ContentMatchSummary>>)> =
        Vec::with_capacity(BATCH_SIZE);
    let mut warnings_count = 0_u32;
    let mut last_flush = Instant::now();
    let mut matches_found: u64 = 0;
    let mut current_entry: Option<EntryRefPayload> = None;
    let mut visited: HashSet<String> = HashSet::new();

    for root in roots {
        if cancellation.is_cancelled() {
            break;
        }
        let Ok(provider) = providers.resolve(&root) else {
            warnings_count += 1;
            continue;
        };
        let Ok(capabilities) = provider.capabilities_for(&root) else {
            warnings_count += 1;
            continue;
        };
        // Need LIST to enumerate; need READ if content search is requested.
        if !capabilities.contains(ProviderCapabilities::LIST)
            || (has_content_query && !capabilities.contains(ProviderCapabilities::READ))
        {
            warnings_count += 1;
            continue;
        }
        if !visited.insert(root.uri.clone()) {
            continue;
        }
        let mut depth = 0;
        let mut stack = vec![root];
        while let Some(location) = stack.pop() {
            if cancellation.is_cancelled() {
                break;
            }
            // List directory.
            let page = match provider
                .list(
                    &location,
                    ListOptions {
                        page_size: 1024,
                        continuation_token: None,
                    },
                    cancellation.clone(),
                )
                .await
            {
                Ok(p) => p,
                Err(_) => {
                    warnings_count += 1;
                    continue;
                }
            };

            for entry in page.entries {
                if entry.kind == EntryKind::Directory {
                    // Track visited directories to prevent cycles (no symlinks
                    // following, but providers may return circular refs).
                    if options.recurse && visited.insert(entry.location.uri.clone()) {
                        stack.push(entry.location);
                    }
                    continue;
                }
                // Check recurse depth.
                if depth == 0 && !options.recurse {
                    // For non-recursive, only the root directory contents.
                    // Directories are already counted above; files at root depth
                    // are processable.
                }

                // Check filename match.
                if has_filename_filter {
                    if !matches_name(&entry.name, &options.filename_query, filename_mode) {
                        continue;
                    }
                }

                current_entry = Some(EntryRefPayload {
                    id: entry.id,
                    location: entry.location.clone().into(),
                });

                if has_content_query {
                    let content_query = options.content_query.as_ref().expect("safe");
                    let entry_ref = EntryRef {
                        id: entry.id,
                        location: entry.location.clone(),
                    };
                    let matches =
                        match scan_vfs_file(&*provider, &entry_ref, content_query, cancellation)
                            .await
                        {
                            Ok(m) => {
                                if !m.is_empty() {
                                    Some(
                                        m.iter()
                                            .map(|m| ContentMatchSummary {
                                                line_number: m.line_number,
                                                offset: m.match_start,
                                                length: m.match_len,
                                            })
                                            .collect(),
                                    )
                                } else {
                                    None
                                }
                            }
                            Err(_) => None,
                        };
                    if let Some(cm) = matches {
                        matches_found += 1;
                        buffer.push((entry, Some(cm)));
                    }
                } else {
                    matches_found += 1;
                    buffer.push((entry, None));
                }
            }

            // Flush periodically.
            if buffer.len() >= BATCH_SIZE || last_flush.elapsed() >= BATCH_INTERVAL {
                flush(
                    &ctx,
                    &mut buffer,
                    warnings_count,
                    false,
                    matches_found,
                    current_entry.clone(),
                );
                last_flush = Instant::now();
            }

            depth += 1;
        }
    }

    let is_last = completion.is_last();
    flush(
        &ctx,
        &mut buffer,
        warnings_count,
        is_last,
        matches_found,
        current_entry.clone(),
    );

    if is_last {
        if let Some(op_id) = ctx.operation_id {
            let state = if cancellation.is_cancelled() {
                OperationStatePayload::Cancelled
            } else {
                OperationStatePayload::Completed
            };
            events.publish(
                audience.clone(),
                BackendEventPayload::OperationStateChanged {
                    operation_id: op_id,
                    state,
                },
            );
        }
    }
}

/// VFS content scan errors.
#[derive(Debug)]
enum VfsScanError {
    FileTooLarge,
    Binary,
    Io,
}

/// Scans a single VFS file's content for `query`.
///
/// Reads first chunk for binary sniff, then scans the full content line by
/// line. Bounded by `VFS_MAX_SCAN_BYTES`.
async fn scan_vfs_file(
    provider: &dyn FileSystemProvider,
    entry: &EntryRef,
    query: &ContentQuery,
    cancellation: &CancellationToken,
) -> Result<Vec<ContentMatch>, VfsScanError> {
    let reader = provider
        .open_read(entry, cancellation.clone())
        .await
        .map_err(|_| VfsScanError::Io)?;

    // Binary sniff: read first chunk via collector.
    let mut buf_reader = BufReader::with_capacity(VFS_SNIFF_BYTES, reader);
    let mut sniff_buf = vec![0_u8; VFS_SNIFF_BYTES];
    let sniffed = buf_reader
        .read(&mut sniff_buf)
        .await
        .map_err(|_| VfsScanError::Io)?;
    if sniffed == 0 {
        return Ok(Vec::new());
    }
    let sniff = &sniff_buf[..sniffed];
    if looks_like_binary(sniff) {
        return Err(VfsScanError::Binary);
    }

    // Size check: try to get known size first.
    // Since we already have a BufReader wrapping the original stream, we
    // need to create a new reader for the content scan.
    let reader2 = provider
        .open_read(entry, cancellation.clone())
        .await
        .map_err(|_| VfsScanError::Io)?;

    // Scan using fm_vfs::search_content (already handles size bounds internally
    // but we need to check file_size if available).
    let size = provider.file_size(entry, cancellation.clone()).await.ok();
    if let Some(s) = size {
        if s > VFS_MAX_SCAN_BYTES {
            return Err(VfsScanError::FileTooLarge);
        }
    }

    let outcome = search_content(reader2, query, 500, cancellation)
        .await
        .map_err(|_| VfsScanError::Io)?;
    Ok(outcome.matches)
}
///
/// A final (`is_complete: true`) flush is always sent, even with an empty
/// buffer, so listeners can reliably detect that no further batches follow.
/// Progress is published independently of the results batch whenever an
/// `operation_id` is tracked, even if this particular flush found no new
/// matches — otherwise a sparse or unmatched content search would appear
/// to make no progress at all.
fn flush(
    ctx: &SearchContext<'_>,
    buffer: &mut Vec<(EntrySummary, Option<Vec<ContentMatchSummary>>)>,
    warnings_count: u32,
    is_complete: bool,
    matches_found: u64,
    current_entry: Option<EntryRefPayload>,
) {
    if !buffer.is_empty() || is_complete {
        let batch = std::mem::take(buffer);
        let payload_entries: Vec<EntrySummaryPayload> = batch
            .iter()
            .map(|(entry, matches_list)| match matches_list {
                Some(list) => EntrySummaryPayload::with_matches(entry, list.clone()),
                None => entry.clone().into(),
            })
            .collect();
        let summary_batch: Vec<EntrySummary> = batch.into_iter().map(|(e, _)| e).collect();
        ctx.store
            .append(ctx.search_id, summary_batch, warnings_count);
        // Mark the store complete before publishing, so a subscriber that reacts to
        // `is_complete: true` by immediately paging the store never observes stale
        // `has_more: true` from a completion race.
        if is_complete {
            ctx.store.mark_complete(ctx.search_id);
        }

        ctx.events.publish(
            ctx.audience.clone(),
            BackendEventPayload::SearchResultsBatch {
                search_id: ctx.search_id,
                entries: payload_entries,
                is_complete,
                warnings_count,
            },
        );
    }

    // Emit operation progress if the operation centre is tracking this search,
    // regardless of whether this flush produced any new matches — a sparse or
    // zero-match content search must still show it's making progress.
    if let Some(op_id) = ctx.operation_id {
        ctx.events.publish(
            ctx.audience.clone(),
            BackendEventPayload::OperationProgress {
                progress: OperationProgressPayload {
                    operation_id: op_id,
                    progress: OperationProgressDetails {
                        completed_items: matches_found,
                        total_items: None,
                        completed_bytes: 0,
                        total_bytes: None,
                        current_entry,
                        bytes_per_second: None,
                    },
                },
            },
        );
    }
}

/// Builds an [`EntrySummary`] for a matched path, or `None` if its metadata
/// can no longer be read (for example, removed mid-traversal).
///
/// The entry's `location` is the real `file://` location of the matched
/// file, not a synthetic search-space location: this is what lets "open
/// this result" resolve to its containing directory for free via
/// [`Location::parent`], with no dedicated result-resolution endpoint.
fn build_entry_summary(search_id: Uuid, path: &Path) -> Option<EntrySummary> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    let location = Location::from_native_path(path).ok()?;
    let name = location.name().ok()?;
    let kind = if metadata.file_type().is_symlink() {
        EntryKind::Symlink
    } else if metadata.is_dir() {
        EntryKind::Directory
    } else {
        EntryKind::File
    };
    let id = EntryId::from(Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("search:{search_id}:{}", location.uri).as_bytes(),
    ));
    let extension = Path::new(&name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_owned);
    let hidden = is_hidden(&name);

    Some(EntrySummary {
        id,
        location,
        name,
        kind,
        size: (kind == EntryKind::File).then_some(metadata.len()),
        modified_at: metadata
            .modified()
            .ok()
            .map(chrono::DateTime::<chrono::Utc>::from),
        created_at: metadata
            .created()
            .ok()
            .map(chrono::DateTime::<chrono::Utc>::from),
        hidden,
        read_only: metadata.permissions().readonly(),
        extension,
        mime_type: None,
        icon_key: None,
        metadata_revision: 0,
    })
}

#[cfg(not(windows))]
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

#[cfg(windows)]
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

#[cfg(test)]
mod tests {
    use super::*;
    use fm_events::{EventSubscription, SessionId, SubscriptionEvent};
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::{PermissionsExt, symlink};
    use tempfile::tempdir;

    fn subscribe(events: &EventBus) -> EventSubscription {
        events.subscribe_all_workspaces(SessionId::new("test"), None)
    }

    async fn collect_batches(
        mut subscription: EventSubscription,
    ) -> Vec<(Vec<EntrySummaryPayload>, bool, u32)> {
        let mut batches = Vec::new();
        loop {
            let event = subscription.recv().await.expect("event bus must not close");
            let SubscriptionEvent::Event(envelope) = event else {
                continue;
            };
            let BackendEventPayload::SearchResultsBatch {
                search_id: _,
                entries,
                is_complete,
                warnings_count,
            } = envelope.payload
            else {
                continue;
            };
            batches.push((entries, is_complete, warnings_count));
            if is_complete {
                return batches;
            }
        }
    }

    fn base_options(filename: &str) -> SearchOptions {
        SearchOptions {
            filename_query: filename.to_owned(),
            content_query: None,
            recurse: true,
            show_hidden: true,
            operation_id: None,
        }
    }

    #[tokio::test]
    async fn streams_matches_across_nested_directories() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join("sub")).unwrap();
        fs::write(root.path().join("report.txt"), b"a").unwrap();
        fs::write(root.path().join("sub/report-final.txt"), b"b").unwrap();
        fs::write(root.path().join("sub/invoice.txt"), b"c").unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let search_id = Uuid::new_v4();
        let _location = engine
            .start(
                search_id,
                vec![root_location],
                base_options("report"),
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        assert_eq!(total, 2);
        assert!(
            batches.last().unwrap().1,
            "final batch must be marked complete"
        );

        let (page, has_more) = store.page(search_id, 0, 10).unwrap();
        assert_eq!(page.len(), 2);
        assert!(!has_more);
    }

    #[tokio::test]
    async fn skips_git_directories() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join(".git/objects")).unwrap();
        fs::write(root.path().join(".git/objects/report.txt"), b"a").unwrap();
        fs::write(root.path().join("report.txt"), b"b").unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let search_id = Uuid::new_v4();
        let _location = engine
            .start(
                search_id,
                vec![root_location],
                base_options("report"),
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        assert_eq!(total, 1, "the .git directory must not be descended into");
    }

    #[tokio::test]
    async fn hidden_files_are_skipped_when_show_hidden_is_false() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join(".hidden-dir")).unwrap();
        fs::write(root.path().join(".hidden-dir/report.txt"), b"a").unwrap();
        fs::write(root.path().join(".report.txt"), b"b").unwrap();
        fs::write(root.path().join("report.txt"), b"c").unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let search_id = Uuid::new_v4();
        let _location = engine
            .start(
                search_id,
                vec![root_location],
                SearchOptions {
                    filename_query: "report".to_owned(),
                    content_query: None,
                    recurse: true,
                    show_hidden: false,
                    operation_id: None,
                },
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let names: Vec<_> = batches
            .iter()
            .flat_map(|(entries, _, _)| entries.iter())
            .map(|e| e.name.clone())
            .collect();
        assert_eq!(
            names,
            vec!["report.txt".to_string()],
            "dotfiles and dot-directories must be skipped when show_hidden is false"
        );
    }

    #[tokio::test]
    async fn hidden_files_are_included_when_show_hidden_is_true() {
        let root = tempdir().unwrap();
        fs::write(root.path().join(".report.txt"), b"a").unwrap();
        fs::write(root.path().join("report.txt"), b"b").unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let search_id = Uuid::new_v4();
        let _location = engine
            .start(
                search_id,
                vec![root_location],
                base_options("report"),
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        assert_eq!(
            total, 2,
            "both the dotfile and the regular file match when show_hidden is true"
        );
    }

    #[tokio::test]
    async fn gitignored_paths_are_skipped() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join(".git")).unwrap();
        fs::write(root.path().join(".gitignore"), b"ignored-dir/\n").unwrap();
        fs::create_dir_all(root.path().join("ignored-dir")).unwrap();
        fs::write(root.path().join("ignored-dir/report.txt"), b"a").unwrap();
        fs::write(root.path().join("report.txt"), b"b").unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let search_id = Uuid::new_v4();
        let _location = engine
            .start(
                search_id,
                vec![root_location],
                base_options("report"),
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        assert_eq!(
            total, 1,
            "paths matched by .gitignore must not be descended into"
        );
    }

    #[tokio::test]
    async fn cancellation_stops_traversal_promptly() {
        let root = tempdir().unwrap();
        for index in 0..2000 {
            fs::write(root.path().join(format!("match-{index}.txt")), b"x").unwrap();
        }

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(64);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let search_id = Uuid::new_v4();
        let _location = engine
            .start(
                search_id,
                vec![root_location],
                base_options("match"),
                EventAudience::Global,
            )
            .unwrap();

        engine.cancel(search_id).unwrap();
        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        assert!(
            total < 2000,
            "cancellation must stop traversal before it finds every match"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn unreadable_directories_are_skipped_with_a_warning_not_an_abort() {
        let root = tempdir().unwrap();
        let locked = root.path().join("locked");
        fs::create_dir(&locked).unwrap();
        fs::write(locked.join("secret-report.txt"), b"x").unwrap();
        fs::write(root.path().join("report.txt"), b"x").unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let _search_id = Uuid::new_v4();
        let _location = engine
            .start(
                _search_id,
                vec![root_location],
                base_options("report"),
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        let warnings = batches.last().unwrap().2;

        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(total, 1, "only the readable report.txt should be found");
        assert!(warnings >= 1, "the unreadable directory must be counted");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlink_cycles_do_not_cause_infinite_traversal() {
        let root = tempdir().unwrap();
        let sub = root.path().join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("report.txt"), b"x").unwrap();
        symlink(root.path(), sub.join("cycle")).unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let _search_id = Uuid::new_v4();
        let _location = engine
            .start(
                _search_id,
                vec![root_location],
                base_options("report"),
                EventAudience::Global,
            )
            .unwrap();

        let batches = tokio::time::timeout(Duration::from_secs(10), collect_batches(subscription))
            .await
            .expect("search must terminate instead of looping the symlink cycle forever");
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        assert_eq!(total, 1);
    }

    #[tokio::test]
    async fn unicode_queries_match_unicode_filenames() {
        let root = tempdir().unwrap();
        fs::write(root.path().join("日本語ファイル.txt"), b"x").unwrap();
        fs::write(root.path().join("other.txt"), b"y").unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let _search_id = Uuid::new_v4();
        let _location = engine
            .start(
                _search_id,
                vec![root_location],
                base_options("日本語"),
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        assert_eq!(total, 1);
    }

    #[tokio::test]
    async fn empty_roots_are_rejected_synchronously() {
        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(4);
        let engine = SearchEngine::new(store, events, ProviderRegistry::new());

        let error = engine
            .start(
                Uuid::new_v4(),
                vec![],
                base_options("x"),
                EventAudience::Global,
            )
            .unwrap_err();
        assert!(matches!(error, SearchError::NoRoots));
    }

    #[tokio::test]
    async fn cancelling_an_unknown_search_reports_not_found() {
        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(4);
        let engine = SearchEngine::new(store, events, ProviderRegistry::new());

        let unknown = Uuid::new_v4();
        let error = engine.cancel(unknown).unwrap_err();
        assert!(matches!(error, SearchError::NotFound(id) if id == unknown));
    }

    // --- Content search tests ---

    #[tokio::test]
    async fn content_search_finds_text_in_files() {
        let root = tempdir().unwrap();
        fs::write(root.path().join("a.txt"), b"alpha\nneedle here\nbeta\n").unwrap();
        fs::write(root.path().join("b.txt"), b"no match here\n").unwrap();
        fs::write(root.path().join("c.txt"), b"another needle\n").unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let _search_id = Uuid::new_v4();
        let _location = engine
            .start(
                _search_id,
                vec![root_location],
                SearchOptions {
                    filename_query: String::new(),
                    content_query: Some(ContentQuery::new("needle", false, false, false).unwrap()),
                    recurse: true,
                    show_hidden: true,
                    operation_id: None,
                },
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        assert_eq!(total, 2, "only a.txt and c.txt should match");

        // Verify content_matches are present with correct line numbers.
        let entries_by_name: std::collections::HashMap<_, _> = batches
            .iter()
            .flat_map(|(entries, _, _)| entries.iter())
            .map(|e| (e.name.clone(), e))
            .collect();
        assert_eq!(entries_by_name.len(), 2, "two entries with match info");
        let a_matches = entries_by_name
            .get("a.txt")
            .and_then(|e| e.content_matches.as_ref())
            .expect("a.txt must have content matches");
        let c_matches = entries_by_name
            .get("c.txt")
            .and_then(|e| e.content_matches.as_ref())
            .expect("c.txt must have content matches");
        assert_eq!(a_matches[0].line_number, 2);
        assert_eq!(c_matches[0].line_number, 1);
    }

    #[tokio::test]
    async fn content_search_with_filename_filter_only_scans_matching_files() {
        let root = tempdir().unwrap();
        fs::write(root.path().join("report.txt"), b"needle").unwrap();
        fs::write(root.path().join("data.csv"), b"needle").unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let _search_id = Uuid::new_v4();
        let _location = engine
            .start(
                _search_id,
                vec![root_location],
                SearchOptions {
                    filename_query: "report".to_owned(),
                    content_query: Some(ContentQuery::new("needle", false, false, false).unwrap()),
                    recurse: true,
                    show_hidden: true,
                    operation_id: None,
                },
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        assert_eq!(
            total, 1,
            "only report.txt matches filename filter, data.csv is skipped"
        );
    }

    #[tokio::test]
    async fn content_search_skips_binary_files() {
        let root = tempdir().unwrap();
        fs::write(root.path().join("data.bin"), [0x00, 0x01, b'n', b'e', 0x02]).unwrap();
        fs::write(root.path().join("text.txt"), b"needle").unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let _search_id = Uuid::new_v4();
        let _location = engine
            .start(
                _search_id,
                vec![root_location],
                SearchOptions {
                    filename_query: String::new(),
                    content_query: Some(ContentQuery::new("needle", false, false, false).unwrap()),
                    recurse: true,
                    show_hidden: true,
                    operation_id: None,
                },
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        assert_eq!(total, 1, "binary file skipped, only text.txt matches");
        let names: Vec<_> = batches
            .iter()
            .flat_map(|(entries, _, _)| entries.iter())
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(names, ["text.txt"]);
    }

    #[tokio::test]
    async fn non_recursive_search_only_scans_root_directories() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join("sub")).unwrap();
        fs::write(root.path().join("top.txt"), b"match").unwrap();
        fs::write(root.path().join("sub/deep.txt"), b"match").unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let _search_id = Uuid::new_v4();
        let _location = engine
            .start(
                _search_id,
                vec![root_location],
                SearchOptions {
                    filename_query: String::new(),
                    content_query: Some(ContentQuery::new("match", false, false, false).unwrap()),
                    recurse: false,
                    show_hidden: true,
                    operation_id: None,
                },
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        assert_eq!(
            total, 1,
            "non-recursive: only top.txt found, sub/deep.txt skipped"
        );
    }

    #[tokio::test]
    async fn content_search_regex_matches() {
        let root = tempdir().unwrap();
        fs::write(
            root.path().join("log.txt"),
            b"ERROR: something failed\nINFO: ok\nERROR: another fail\n",
        )
        .unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let _search_id = Uuid::new_v4();
        let _location = engine
            .start(
                _search_id,
                vec![root_location],
                SearchOptions {
                    filename_query: String::new(),
                    content_query: Some(ContentQuery::new("ERROR.*", true, false, false).unwrap()),
                    recurse: true,
                    show_hidden: true,
                    operation_id: None,
                },
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let all_matches: Vec<_> = batches
            .iter()
            .flat_map(|(entries, _, _)| entries.iter())
            .filter_map(|e| e.content_matches.clone())
            .collect();
        assert_eq!(all_matches.len(), 1, "one file with matches");
        assert_eq!(all_matches[0].len(), 2, "two ERROR lines matched");
        assert_eq!(all_matches[0][0].line_number, 1);
        assert_eq!(all_matches[0][1].line_number, 3);
    }

    #[tokio::test]
    async fn content_search_large_file_is_bounded() {
        let root = tempdir().unwrap();
        // Write a file just under the scan limit with no matches.
        let content = "x".repeat(9 * 1024 * 1024);
        fs::write(root.path().join("large.txt"), content.into_bytes()).unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let _search_id = Uuid::new_v4();
        let _location = engine
            .start(
                _search_id,
                vec![root_location],
                SearchOptions {
                    filename_query: String::new(),
                    content_query: Some(
                        ContentQuery::new("nonexistent_needle", false, false, false).unwrap(),
                    ),
                    recurse: true,
                    show_hidden: true,
                    operation_id: None,
                },
                EventAudience::Global,
            )
            .unwrap();

        // Should complete promptly (bounded scan) rather than hang.
        let batches = tokio::time::timeout(Duration::from_secs(10), collect_batches(subscription))
            .await
            .expect("large file scan must be bounded");
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        assert_eq!(total, 0, "no matches in large file without the needle");
    }

    #[tokio::test]
    async fn content_search_does_not_break_when_file_removed_mid_search() {
        let root = tempdir().unwrap();
        let path = root.path().join("fleeting.txt");
        fs::write(&path, b"needle").unwrap();
        // Remove before scan starts (race condition handled gracefully).
        fs::remove_file(&path).unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let _search_id = Uuid::new_v4();
        let _location = engine
            .start(
                _search_id,
                vec![root_location],
                SearchOptions {
                    filename_query: String::new(),
                    content_query: Some(ContentQuery::new("needle", false, false, false).unwrap()),
                    recurse: true,
                    show_hidden: true,
                    operation_id: None,
                },
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(entries, _, _)| entries.len()).sum();
        assert_eq!(total, 0, "deleted file should not crash the search");
    }

    // --- VFS provider-based traversal tests ---

    /// Minimal mock provider for testing VFS traversal.
    struct MockVfsProvider {
        uris_to_entries: std::sync::Mutex<(
            std::collections::HashMap<String, Vec<fm_domain::EntrySummary>>,
            fm_domain::ProviderId,
        )>,
        uris_to_content: std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>,
    }

    impl MockVfsProvider {
        fn with_root(root_uri: &str) -> Self {
            let root_id = fm_domain::ProviderId::new("mock");
            let mut files = std::collections::HashMap::new();
            files.insert(
                root_uri.to_string(),
                vec![
                    fm_domain::EntrySummary {
                        id: fm_domain::EntryId::new(),
                        location: fm_domain::Location::new(
                            root_id.clone(),
                            format!("{root_uri}/a.txt"),
                        ),
                        name: "a.txt".to_string(),
                        kind: EntryKind::File,
                        size: Some(4),
                        modified_at: None,
                        created_at: None,
                        hidden: false,
                        read_only: false,
                        extension: Some("txt".to_string()),
                        mime_type: None,
                        icon_key: None,
                        metadata_revision: 0,
                    },
                    fm_domain::EntrySummary {
                        id: fm_domain::EntryId::new(),
                        location: fm_domain::Location::new(
                            root_id.clone(),
                            format!("{root_uri}/sub"),
                        ),
                        name: "sub".to_string(),
                        kind: EntryKind::Directory,
                        size: None,
                        modified_at: None,
                        created_at: None,
                        hidden: false,
                        read_only: false,
                        extension: None,
                        mime_type: None,
                        icon_key: None,
                        metadata_revision: 0,
                    },
                ],
            );
            files.insert(
                format!("{root_uri}/sub"),
                vec![fm_domain::EntrySummary {
                    id: fm_domain::EntryId::new(),
                    location: fm_domain::Location::new(
                        root_id.clone(),
                        format!("{root_uri}/sub/b.txt"),
                    ),
                    name: "b.txt".to_string(),
                    kind: EntryKind::File,
                    size: Some(6),
                    modified_at: None,
                    created_at: None,
                    hidden: false,
                    read_only: false,
                    extension: Some("txt".to_string()),
                    mime_type: None,
                    icon_key: None,
                    metadata_revision: 0,
                }],
            );

            let mut content = std::collections::HashMap::new();
            content.insert(format!("{root_uri}/a.txt"), b"alpha\n".to_vec());
            content.insert(
                format!("{root_uri}/sub/b.txt"),
                b"needle here\nanother needle\n".to_vec(),
            );

            Self {
                uris_to_entries: std::sync::Mutex::new((files, root_id.clone())),
                uris_to_content: std::sync::Mutex::new(content),
            }
        }
    }

    #[async_trait::async_trait]
    impl FileSystemProvider for MockVfsProvider {
        fn id(&self) -> fm_domain::ProviderId {
            self.uris_to_entries.lock().unwrap().1.clone()
        }

        fn capabilities(&self) -> ProviderCapabilities {
            ProviderCapabilities::LIST | ProviderCapabilities::READ
        }

        async fn list(
            &self,
            location: &Location,
            _options: ListOptions,
            _cancellation: CancellationToken,
        ) -> Result<fm_vfs::DirectoryPage, fm_vfs::VfsError> {
            let entries = self
                .uris_to_entries
                .lock()
                .unwrap()
                .0
                .get(&location.uri)
                .cloned()
                .unwrap_or_default();
            Ok(fm_vfs::DirectoryPage {
                entries,
                total_known_entries: None,
                has_more: false,
                continuation_token: None,
            })
        }

        async fn open_read(
            &self,
            entry: &EntryRef,
            _cancellation: CancellationToken,
        ) -> Result<fm_vfs::ProviderReadStream, fm_vfs::VfsError> {
            let content = self
                .uris_to_content
                .lock()
                .unwrap()
                .get(&entry.location.uri)
                .cloned()
                .unwrap_or_default();
            let reader = std::io::Cursor::new(content);
            Ok(Box::pin(reader))
        }

        async fn metadata(
            &self,
            _entry: &EntryRef,
            _cancellation: CancellationToken,
        ) -> Result<fm_domain::EntryMetadata, fm_vfs::VfsError> {
            unimplemented!("mock provider does not support metadata")
        }

        async fn create_directory(
            &self,
            _location: &Location,
            _name: &str,
            _cancellation: CancellationToken,
        ) -> Result<fm_vfs::EntryRef, fm_vfs::VfsError> {
            unimplemented!("mock provider does not support create_directory")
        }

        async fn rename(
            &self,
            _source: &EntryRef,
            _destination: &Location,
            _cancellation: CancellationToken,
        ) -> Result<fm_vfs::EntryRef, fm_vfs::VfsError> {
            unimplemented!("mock provider does not support rename")
        }

        async fn remove(
            &self,
            _entry: &EntryRef,
            _options: fm_vfs::RemoveOptions,
            _cancellation: CancellationToken,
        ) -> Result<(), fm_vfs::VfsError> {
            unimplemented!("mock provider does not support remove")
        }

        async fn open_write(
            &self,
            _destination: &Location,
            _options: fm_vfs::WriteOptions,
            _cancellation: CancellationToken,
        ) -> Result<fm_vfs::ProviderWriteStream, fm_vfs::VfsError> {
            unimplemented!("mock provider does not support open_write")
        }

        async fn watch(
            &self,
            _location: &Location,
            _cancellation: CancellationToken,
        ) -> Result<fm_vfs::ProviderChangeStream, fm_vfs::VfsError> {
            unimplemented!("mock provider does not support watch")
        }
    }

    /// Helper to test VFS search with a mock provider registered.
    async fn test_vfs_search_with_content(
        root_uri: &str,
        filename_query: &str,
        content_query: Option<ContentQuery>,
    ) -> Vec<(Vec<EntrySummaryPayload>, bool, u32)> {
        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let mut providers = ProviderRegistry::new();
        providers.register(Arc::new(MockVfsProvider::with_root(root_uri)));
        let engine = SearchEngine::new(store.clone(), events.clone(), providers);
        let subscription = subscribe(&events);

        let root_location =
            fm_domain::Location::new(fm_domain::ProviderId::new("mock"), root_uri.to_string());
        let search_id = Uuid::new_v4();
        let _ = engine.start(
            search_id,
            vec![root_location],
            SearchOptions {
                filename_query: filename_query.to_string(),
                content_query,
                recurse: true,
                show_hidden: true,
                operation_id: None,
            },
            EventAudience::Global,
        );

        // Give it time to complete.
        tokio::time::timeout(Duration::from_secs(5), collect_batches(subscription))
            .await
            .expect("VFS search must complete promptly")
    }

    #[tokio::test]
    async fn vfs_traversal_finds_files_via_list_and_content_scan() {
        let batches = test_vfs_search_with_content(
            "mock://test-root",
            "",
            Some(ContentQuery::new("needle", false, false, false).unwrap()),
        )
        .await;
        let total: usize = batches.iter().map(|(e, _, _)| e.len()).sum();
        assert_eq!(total, 1, "only b.txt contains 'needle'");
        let names: Vec<_> = batches
            .iter()
            .flat_map(|(entries, _, _)| entries.iter())
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(names, ["b.txt"]);

        // Verify content matches.
        let b_matches = batches
            .iter()
            .flat_map(|(entries, _, _)| entries.iter())
            .find(|e| e.name == "b.txt")
            .and_then(|e| e.content_matches.as_ref())
            .expect("b.txt must have content matches");
        assert_eq!(b_matches.len(), 2);
        assert_eq!(b_matches[0].line_number, 1);
        assert_eq!(b_matches[1].line_number, 2);
    }

    #[tokio::test]
    async fn vfs_traversal_respects_filename_filter() {
        let batches = test_vfs_search_with_content("mock://filter-root", "a.txt", None).await;
        let total: usize = batches.iter().map(|(e, _, _)| e.len()).sum();
        assert_eq!(total, 1, "only a.txt should match by filename");
        assert!(
            batches
                .iter()
                .flat_map(|(entries, _, _)| entries.iter())
                .any(|e| e.name == "a.txt")
        );
    }

    #[tokio::test]
    async fn vfs_traversal_handles_unknown_providers_with_warning() {
        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(store.clone(), events.clone(), ProviderRegistry::new());
        let subscription = subscribe(&events);

        let unknown_location =
            fm_domain::Location::new(fm_domain::ProviderId::new("unknown"), "unknown://somewhere");
        let search_id = Uuid::new_v4();
        let _ = engine
            .start(
                search_id,
                vec![unknown_location],
                SearchOptions {
                    filename_query: String::new(),
                    content_query: None,
                    recurse: true,
                    show_hidden: true,
                    operation_id: None,
                },
                EventAudience::Global,
            )
            .unwrap();

        let batches = tokio::time::timeout(Duration::from_secs(5), collect_batches(subscription))
            .await
            .expect("search must complete");
        let total: usize = batches.iter().map(|(e, _, _)| e.len()).sum();
        let warnings = batches.last().unwrap().2;
        assert_eq!(total, 0, "no matches for unknown provider");
        assert!(warnings >= 1, "unknown provider must produce a warning");
    }
}
