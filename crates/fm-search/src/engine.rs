//! Cancellable recursive filesystem traversal (spec §24).
//!
//! [`SearchEngine::start`] resolves every root eagerly (so a bad root is
//! rejected synchronously) then hands traversal to a blocking task: entries
//! are matched and streamed in batches rather than collected into memory,
//! so a 100k-file tree cannot flood the frontend or blow up backend memory.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use fm_domain::{EntryId, EntryKind, EntrySummary, Location, ProviderId};
use fm_events::{BackendEventPayload, EntrySummaryPayload, EventAudience, EventBus};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::matcher::{detect_match_mode, matches_name};
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
}

/// Starts and cancels recursive filename searches, streaming matches over
/// the event bus as they are found.
pub struct SearchEngine {
    store: Arc<SearchResultsStore>,
    events: EventBus,
}

impl SearchEngine {
    /// Creates an engine that stores results in `store` and streams batches
    /// over `events`.
    #[must_use]
    pub fn new(store: Arc<SearchResultsStore>, events: EventBus) -> Self {
        Self { store, events }
    }

    /// Starts a new cancellable search over `roots` for `query`, publishing
    /// matches to `audience` as they are found.
    ///
    /// Returns the search id and the virtual `search://local/{searchId}`
    /// location that lists its results (spec §24).
    ///
    /// # Errors
    ///
    /// Returns [`SearchError::NoRoots`] if `roots` is empty, or
    /// [`SearchError::InvalidRoot`] if a root cannot be resolved to a native
    /// path.
    pub fn start(
        &self,
        roots: Vec<Location>,
        query: String,
        audience: EventAudience,
    ) -> Result<(Uuid, Location), SearchError> {
        if roots.is_empty() {
            return Err(SearchError::NoRoots);
        }
        let mut root_paths = Vec::with_capacity(roots.len());
        for root in &roots {
            let path = root
                .to_native_path()
                .map_err(|_| SearchError::InvalidRoot(root.uri.clone()))?;
            root_paths.push(path);
        }

        let search_id = Uuid::new_v4();
        let cancellation = CancellationToken::new();
        self.store.register(search_id, cancellation.clone());

        let store = Arc::clone(&self.store);
        let events = self.events.clone();
        tokio::task::spawn_blocking(move || {
            run_search(
                search_id,
                root_paths,
                &query,
                &cancellation,
                &store,
                &events,
                &audience,
            );
        });

        let location = Location::new(
            ProviderId::new("search"),
            format!("search://local/{search_id}"),
        );
        Ok((search_id, location))
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

/// Walks every root depth-first, streaming filename matches in batches.
///
/// Symlinks are never followed (`follow_links(false)`), which both keeps
/// traversal cycle-free without a visited-inode set and matches the
/// "no symlink-following by default" requirement. Unreadable directories
/// increment a warning counter instead of aborting the whole search.
fn run_search(
    search_id: Uuid,
    roots: Vec<PathBuf>,
    query: &str,
    cancellation: &CancellationToken,
    store: &SearchResultsStore,
    events: &EventBus,
    audience: &EventAudience,
) {
    let mode = detect_match_mode(query);
    let mut buffer: Vec<EntrySummary> = Vec::with_capacity(BATCH_SIZE);
    let mut warnings_count = 0_u32;
    let mut last_flush = Instant::now();

    'roots: for root in roots {
        for entry in walkdir::WalkDir::new(&root).follow_links(false) {
            if cancellation.is_cancelled() {
                break 'roots;
            }
            match entry {
                Ok(dir_entry) => {
                    if let Some(name) = dir_entry.file_name().to_str()
                        && matches_name(name, query, mode)
                        && let Some(summary) = build_entry_summary(search_id, dir_entry.path())
                    {
                        buffer.push(summary);
                    }
                }
                Err(_) => warnings_count += 1,
            }
            if buffer.len() >= BATCH_SIZE
                || (!buffer.is_empty() && last_flush.elapsed() >= BATCH_INTERVAL)
            {
                flush(
                    search_id,
                    store,
                    events,
                    audience,
                    &mut buffer,
                    warnings_count,
                    false,
                );
                last_flush = Instant::now();
            }
        }
    }
    flush(
        search_id,
        store,
        events,
        audience,
        &mut buffer,
        warnings_count,
        true,
    );
    store.mark_complete(search_id);
}

/// Flushes buffered matches to the store and publishes them as one event.
///
/// A final (`is_complete: true`) flush is always sent, even with an empty
/// buffer, so listeners can reliably detect that no further batches follow.
fn flush(
    search_id: Uuid,
    store: &SearchResultsStore,
    events: &EventBus,
    audience: &EventAudience,
    buffer: &mut Vec<EntrySummary>,
    warnings_count: u32,
    is_complete: bool,
) {
    if buffer.is_empty() && !is_complete {
        return;
    }
    let batch = std::mem::take(buffer);
    let payload_entries: Vec<EntrySummaryPayload> = batch
        .iter()
        .cloned()
        .map(EntrySummaryPayload::from)
        .collect();
    store.append(search_id, batch, warnings_count);
    events.publish(
        audience.clone(),
        BackendEventPayload::SearchResultsBatch {
            search_id,
            entries: payload_entries,
            is_complete,
            warnings_count,
        },
    );
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

    async fn collect_batches(mut subscription: EventSubscription) -> Vec<(usize, bool, u32)> {
        let mut batches = Vec::new();
        loop {
            let event = subscription.recv().await.expect("event bus must not close");
            let SubscriptionEvent::Event(envelope) = event else {
                continue;
            };
            let BackendEventPayload::SearchResultsBatch {
                entries,
                is_complete,
                warnings_count,
                ..
            } = envelope.payload
            else {
                continue;
            };
            batches.push((entries.len(), is_complete, warnings_count));
            if is_complete {
                return batches;
            }
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
        let engine = SearchEngine::new(Arc::clone(&store), events.clone());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let (search_id, _location) = engine
            .start(
                vec![root_location],
                "report".to_owned(),
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(count, _, _)| count).sum();
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
    async fn cancellation_stops_traversal_promptly() {
        let root = tempdir().unwrap();
        for index in 0..2000 {
            fs::write(root.path().join(format!("match-{index}.txt")), b"x").unwrap();
        }

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(64);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let (search_id, _location) = engine
            .start(
                vec![root_location],
                "match".to_owned(),
                EventAudience::Global,
            )
            .unwrap();

        engine.cancel(search_id).unwrap();
        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(count, _, _)| count).sum();
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
        let engine = SearchEngine::new(Arc::clone(&store), events.clone());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let (_search_id, _location) = engine
            .start(
                vec![root_location],
                "report".to_owned(),
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(count, _, _)| count).sum();
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
        let engine = SearchEngine::new(Arc::clone(&store), events.clone());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let (_search_id, _location) = engine
            .start(
                vec![root_location],
                "report".to_owned(),
                EventAudience::Global,
            )
            .unwrap();

        let batches = tokio::time::timeout(Duration::from_secs(10), collect_batches(subscription))
            .await
            .expect("search must terminate instead of looping the symlink cycle forever");
        let total: usize = batches.iter().map(|(count, _, _)| count).sum();
        assert_eq!(total, 1);
    }

    #[tokio::test]
    async fn unicode_queries_match_unicode_filenames() {
        let root = tempdir().unwrap();
        fs::write(root.path().join("日本語ファイル.txt"), b"x").unwrap();
        fs::write(root.path().join("other.txt"), b"y").unwrap();

        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(16);
        let engine = SearchEngine::new(Arc::clone(&store), events.clone());
        let subscription = subscribe(&events);

        let root_location = Location::from_native_path(root.path()).unwrap();
        let (_search_id, _location) = engine
            .start(
                vec![root_location],
                "日本語".to_owned(),
                EventAudience::Global,
            )
            .unwrap();

        let batches = collect_batches(subscription).await;
        let total: usize = batches.iter().map(|(count, _, _)| count).sum();
        assert_eq!(total, 1);
    }

    #[tokio::test]
    async fn empty_roots_are_rejected_synchronously() {
        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(4);
        let engine = SearchEngine::new(store, events);

        let error = engine
            .start(vec![], "x".to_owned(), EventAudience::Global)
            .unwrap_err();
        assert!(matches!(error, SearchError::NoRoots));
    }

    #[tokio::test]
    async fn cancelling_an_unknown_search_reports_not_found() {
        let store = Arc::new(SearchResultsStore::new());
        let events = EventBus::new(4);
        let engine = SearchEngine::new(store, events);

        let unknown = Uuid::new_v4();
        let error = engine.cancel(unknown).unwrap_err();
        assert!(matches!(error, SearchError::NotFound(id) if id == unknown));
    }
}
