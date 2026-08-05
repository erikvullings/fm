//! Authoritative directory listing state shared by every transport.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use fm_domain::{DirectorySnapshot, EntryId, EntryKind, EntryMetadata, LoadingState, PaneId};
use fm_events::{
    BackendEventPayload, DirectoryDeltaPayload, EntrySummaryPayload, EventAudience, EventBus,
};
use fm_transport_dto::{
    EntryMetadataRequest, ListDirectoryRequest, NavigateRequest, SortDescriptorDto,
    SortDirectionDto,
};
use fm_vfs::{
    EntryRef, FileSystemProvider, ListOptions, ProviderChange, ProviderRegistry, VfsError,
};
use futures::StreamExt;
use tokio::sync::{Mutex, broadcast};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::ApplicationError;

/// Maximum entries returned per `list()` response. The full directory is always enumerated and
/// sorted first (see `list()` docs); this only bounds response/DOM size for very large
/// directories, it never affects sort correctness across pages.
const LIST_PAGE_SIZE: usize = 256;

struct PaneRequest {
    request_id: Uuid,
    workspace_id: fm_domain::WorkspaceId,
    cancellation: CancellationToken,
    watch_cancellation: CancellationToken,
    revision: u64,
    show_hidden: bool,
    folders_first: bool,
    sort: Vec<SortDescriptorDto>,
    snapshot: Option<DirectorySnapshot>,
    /// The complete, filtered, globally-sorted listing for the pane's current directory,
    /// computed once (via [`list_all`]) and then sliced per page — never per-provider-page
    /// sorted, since provider enumeration order is arbitrary (spec: see `list()` docs).
    full_entries: Option<Arc<Vec<fm_domain::EntrySummary>>>,
}

struct SharedWatch {
    sender: broadcast::Sender<ProviderChange>,
    cancellation: CancellationToken,
    references: usize,
}

#[derive(Default)]
struct WatchHub {
    watches: Mutex<HashMap<fm_domain::Location, SharedWatch>>,
}

/// Lists directories and owns per-pane cancellation and revision state.
#[derive(Clone)]
pub struct DirectoryService {
    providers: ProviderRegistry,
    panes: Arc<Mutex<HashMap<PaneId, PaneRequest>>>,
    watches: Arc<WatchHub>,
    events: EventBus,
}

impl DirectoryService {
    /// Creates a directory service backed by the given provider registry.
    #[must_use]
    pub fn new(providers: ProviderRegistry) -> Self {
        Self::with_event_bus(providers, EventBus::default())
    }

    /// Creates a directory service publishing changes through `events`.
    #[must_use]
    pub fn with_event_bus(providers: ProviderRegistry, events: EventBus) -> Self {
        Self {
            providers,
            panes: Arc::new(Mutex::new(HashMap::new())),
            watches: Arc::new(WatchHub::default()),
            events,
        }
    }

    /// Lists one page of a directory, publishing it only if it is still the pane's newest
    /// request.
    ///
    /// The entire directory is enumerated and globally sorted once per navigation (mirroring
    /// [`list_all`], used by the watch-triggered refresh path), cached on the pane, and then
    /// sliced into bounded [`LIST_PAGE_SIZE`] pages for the wire — sorting only cannot be done
    /// per provider page, since providers enumerate in arbitrary (e.g. filesystem/inode) order:
    /// that previously surfaced as an initial listing showing only a filesystem-order prefix of
    /// entries, with more (and out-of-order) entries appearing as the pane scrolled. Slicing an
    /// already-fully-sorted cached list keeps that fixed while still bounding per-response size
    /// for very large directories; later pages reuse the cached list rather than re-enumerating
    /// the provider.
    pub async fn list(
        &self,
        request: ListDirectoryRequest,
    ) -> Result<DirectorySnapshot, ApplicationError> {
        let pane_id = PaneId::from(request.pane_id);
        let location: fm_domain::Location = request.location.clone().into();
        let first_page = request.continuation_token.is_none();
        let cancellation = CancellationToken::new();
        let cached_full_entries = {
            let mut panes = self.panes.lock().await;
            let revision = panes.get(&pane_id).map_or(0, |state| state.revision);
            let previous = panes.remove(&pane_id);
            let continuing_same_listing = !first_page
                && previous.as_ref().is_some_and(|state| {
                    state
                        .snapshot
                        .as_ref()
                        .is_some_and(|snapshot| snapshot.location == location)
                        && state.show_hidden == request.show_hidden
                        && state.folders_first == request.folders_first
                        && state.sort == request.sort
                });
            let (watch_cancellation, snapshot, full_entries) = if continuing_same_listing {
                let previous = previous.as_ref().expect("checked above");
                (
                    previous.watch_cancellation.clone(),
                    previous.snapshot.clone(),
                    previous.full_entries.clone(),
                )
            } else {
                (CancellationToken::new(), None, None)
            };
            panes.insert(
                pane_id,
                PaneRequest {
                    request_id: request.request_id,
                    workspace_id: request.workspace_id.into(),
                    cancellation: cancellation.clone(),
                    watch_cancellation,
                    revision,
                    show_hidden: request.show_hidden,
                    folders_first: request.folders_first,
                    sort: request.sort.clone(),
                    snapshot,
                    full_entries,
                },
            );
            if let Some(previous) = previous {
                previous.cancellation.cancel();
                if !continuing_same_listing {
                    previous.watch_cancellation.cancel();
                }
            }
            panes
                .get(&pane_id)
                .and_then(|state| state.full_entries.clone())
        };

        let provider = self.providers.resolve(&location)?;
        let full_entries = match cached_full_entries {
            Some(cached) => cached,
            None => {
                let mut entries =
                    list_all(provider.clone(), &location, cancellation.clone()).await?;
                if !request.show_hidden {
                    entries.retain(|entry| !entry.hidden);
                }
                sort_entries(&mut entries, &request.sort, request.folders_first);
                Arc::new(entries)
            }
        };
        let offset = decode_page_offset(request.continuation_token.as_deref())?;
        if offset > full_entries.len() {
            return Err(ApplicationError::InvalidRequest(
                "continuation token is out of range".to_owned(),
            ));
        }
        let end = full_entries.len().min(offset + LIST_PAGE_SIZE);
        let has_more = end < full_entries.len();

        let mut panes = self.panes.lock().await;
        let state = panes
            .get_mut(&pane_id)
            .filter(|state| state.request_id == request.request_id)
            .ok_or(ApplicationError::OperationCancelled)?;
        state.revision += 1;
        state.full_entries = Some(Arc::clone(&full_entries));

        let writable = provider
            .inspect(
                &EntryRef {
                    id: EntryId::new(),
                    location: location.clone(),
                },
                cancellation.clone(),
            )
            .await
            .map(|entry| !entry.read_only)
            .unwrap_or(false);

        let snapshot = DirectorySnapshot {
            pane_id,
            request_id: request.request_id,
            revision: state.revision,
            location,
            writable,
            entries: full_entries[offset..end].to_vec(),
            total_known_entries: Some(full_entries.len() as u64),
            has_more,
            continuation_token: has_more.then(|| end.to_string()),
            loading_state: LoadingState::Loaded,
        };
        state.snapshot = Some(snapshot.clone());
        let watch_cancellation = state.watch_cancellation.clone();
        drop(panes);

        if first_page
            && provider
                .capabilities()
                .contains(fm_vfs::ProviderCapabilities::WATCH)
        {
            let receiver = self
                .watches
                .acquire(provider.clone(), snapshot.location.clone())
                .await?;
            spawn_pane_watch(PaneWatch {
                provider,
                location: snapshot.location.clone(),
                workspace_id: request.workspace_id.into(),
                pane_id,
                show_hidden: request.show_hidden,
                folders_first: request.folders_first,
                sort: request.sort,
                cancellation: watch_cancellation,
                receiver,
                panes: Arc::clone(&self.panes),
                watches: Arc::clone(&self.watches),
                events: self.events.clone(),
            });
        }

        Ok(snapshot)
    }

    /// Navigates a pane to a location, cancelling any older pane request.
    pub async fn navigate(
        &self,
        request: NavigateRequest,
    ) -> Result<DirectorySnapshot, ApplicationError> {
        self.list(ListDirectoryRequest {
            workspace_id: request.workspace_id,
            pane_id: request.pane_id,
            request_id: request.request_id,
            location: request.location,
            continuation_token: None,
            sort: Vec::new(),
            show_hidden: false,
            folders_first: true,
        })
        .await
    }

    /// Refreshes a pane using the same listing options and cancellation semantics.
    pub async fn refresh(
        &self,
        request: ListDirectoryRequest,
    ) -> Result<DirectorySnapshot, ApplicationError> {
        self.list(request).await
    }

    /// Re-lists every open pane whose directory was affected by an operation.
    ///
    /// Operation engines do not depend on provider watch support, so this emits
    /// a reset delta explicitly after each terminal operation as well as the
    /// normal provider-originated deltas.
    pub async fn refresh_affected(&self, locations: &HashSet<fm_domain::Location>) {
        let refreshes = {
            let panes = self.panes.lock().await;
            panes
                .iter()
                .filter_map(|(pane_id, state)| {
                    let snapshot = state.snapshot.as_ref()?;
                    if !locations.contains(&snapshot.location) {
                        return None;
                    }
                    Some(PaneWatch {
                        provider: self.providers.resolve(&snapshot.location).ok()?,
                        location: snapshot.location.clone(),
                        workspace_id: state.workspace_id,
                        pane_id: *pane_id,
                        show_hidden: state.show_hidden,
                        folders_first: state.folders_first,
                        sort: state.sort.clone(),
                        cancellation: state.cancellation.clone(),
                        receiver: broadcast::channel(1).1,
                        panes: Arc::clone(&self.panes),
                        watches: Arc::clone(&self.watches),
                        events: self.events.clone(),
                    })
                })
                .collect::<Vec<_>>()
        };
        for refresh in refreshes {
            let entries = match list_all(
                Arc::clone(&refresh.provider),
                &refresh.location,
                refresh.cancellation.clone(),
            )
            .await
            {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            publish_changes(&refresh, ProviderChange::ResetRequired, entries).await;
        }
    }

    /// Fetches detailed metadata from the provider that owns the entry.
    pub async fn metadata(
        &self,
        request: EntryMetadataRequest,
    ) -> Result<EntryMetadata, ApplicationError> {
        let location = request.location.into();
        let provider = self.providers.resolve(&location)?;
        provider
            .metadata(
                &EntryRef {
                    id: request.entry_id.into(),
                    location,
                },
                CancellationToken::new(),
            )
            .await
            .map_err(Into::into)
    }
}

impl WatchHub {
    async fn acquire(
        &self,
        provider: Arc<dyn FileSystemProvider>,
        location: fm_domain::Location,
    ) -> Result<broadcast::Receiver<ProviderChange>, VfsError> {
        let mut watches = self.watches.lock().await;
        if let Some(watch) = watches.get_mut(&location) {
            watch.references += 1;
            return Ok(watch.sender.subscribe());
        }

        let cancellation = CancellationToken::new();
        let mut stream = provider.watch(&location, cancellation.clone()).await?;
        let (sender, receiver) = broadcast::channel(16);
        let forward = sender.clone();
        let source_cancellation = cancellation.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    () = source_cancellation.cancelled() => break,
                    item = stream.next() => match item {
                        Some(Ok(change)) => { let _ = forward.send(change); }
                        Some(Err(_)) => { let _ = forward.send(ProviderChange::ResetRequired); }
                        None => break,
                    }
                }
            }
        });
        watches.insert(
            location,
            SharedWatch {
                sender,
                cancellation,
                references: 1,
            },
        );
        Ok(receiver)
    }

    async fn release(&self, location: &fm_domain::Location) {
        let mut watches = self.watches.lock().await;
        let remove = watches.get_mut(location).is_some_and(|watch| {
            watch.references -= 1;
            watch.references == 0
        });
        if remove && let Some(watch) = watches.remove(location) {
            watch.cancellation.cancel();
        }
    }

    #[cfg(test)]
    async fn registration_count(&self) -> usize {
        self.watches.lock().await.len()
    }
}

struct PaneWatch {
    provider: Arc<dyn FileSystemProvider>,
    location: fm_domain::Location,
    workspace_id: fm_domain::WorkspaceId,
    pane_id: PaneId,
    show_hidden: bool,
    folders_first: bool,
    sort: Vec<SortDescriptorDto>,
    cancellation: CancellationToken,
    receiver: broadcast::Receiver<ProviderChange>,
    panes: Arc<Mutex<HashMap<PaneId, PaneRequest>>>,
    watches: Arc<WatchHub>,
    events: EventBus,
}

fn spawn_pane_watch(mut watch: PaneWatch) {
    tokio::spawn(async move {
        loop {
            let change = tokio::select! {
                () = watch.cancellation.cancelled() => break,
                received = watch.receiver.recv() => match received {
                    Ok(change) => change,
                    Err(broadcast::error::RecvError::Lagged(_)) => ProviderChange::ResetRequired,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            };
            let entries = match list_all(
                Arc::clone(&watch.provider),
                &watch.location,
                watch.cancellation.clone(),
            )
            .await
            {
                Ok(entries) => entries,
                Err(VfsError::Cancelled) => break,
                Err(_) => continue,
            };
            publish_changes(&watch, change, entries).await;
        }
        watch.watches.release(&watch.location).await;
    });
}

async fn list_all(
    provider: Arc<dyn FileSystemProvider>,
    location: &fm_domain::Location,
    cancellation: CancellationToken,
) -> Result<Vec<fm_domain::EntrySummary>, VfsError> {
    let mut entries = Vec::new();
    let mut continuation_token = None;
    loop {
        let page = provider
            .list(
                location,
                ListOptions {
                    page_size: 1_024,
                    continuation_token,
                },
                cancellation.clone(),
            )
            .await?;
        entries.extend(page.entries);
        if !page.has_more {
            return Ok(entries);
        }
        continuation_token = page.continuation_token;
    }
}

async fn publish_changes(
    watch: &PaneWatch,
    change: ProviderChange,
    mut entries: Vec<fm_domain::EntrySummary>,
) {
    if !watch.show_hidden {
        entries.retain(|entry| !entry.hidden);
    }
    sort_entries(&mut entries, &watch.sort, watch.folders_first);

    let mut panes = watch.panes.lock().await;
    let Some(state) = panes.get_mut(&watch.pane_id).filter(|state| {
        state
            .snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.location == watch.location)
    }) else {
        return;
    };
    let Some(previous) = state.snapshot.clone() else {
        return;
    };
    state.revision += 1;
    let revision = state.revision;
    let snapshot = DirectorySnapshot {
        revision,
        entries: entries.clone(),
        total_known_entries: Some(entries.len() as u64),
        has_more: false,
        continuation_token: None,
        ..previous.clone()
    };
    let mut deltas = deltas_for_change(change, &previous, snapshot.clone(), entries, revision);
    let final_revision = deltas.last().map_or(revision, delta_revision);
    let mut snapshot = snapshot;
    snapshot.revision = final_revision;
    if let [
        DirectoryDeltaPayload::Reset {
            snapshot: reset_snapshot,
        },
    ] = &mut deltas[..]
    {
        reset_snapshot.revision = final_revision;
    }
    state.revision = final_revision;
    state.full_entries = Some(Arc::new(snapshot.entries.clone()));
    state.snapshot = Some(snapshot);
    drop(panes);

    for delta in deltas {
        watch.events.publish(
            EventAudience::Workspace(watch.workspace_id),
            BackendEventPayload::DirectoryDelta {
                pane_id: watch.pane_id,
                delta,
            },
        );
    }
}

fn deltas_for_change(
    change: ProviderChange,
    previous: &DirectorySnapshot,
    snapshot: DirectorySnapshot,
    entries: Vec<fm_domain::EntrySummary>,
    revision: u64,
) -> Vec<DirectoryDeltaPayload> {
    if change == ProviderChange::ResetRequired {
        vec![DirectoryDeltaPayload::Reset {
            snapshot: snapshot.into(),
        }]
    } else {
        diff_entries(&previous.entries, entries, revision)
    }
}

fn diff_entries(
    previous: &[fm_domain::EntrySummary],
    current: Vec<fm_domain::EntrySummary>,
    revision: u64,
) -> Vec<DirectoryDeltaPayload> {
    let previous_by_id: HashMap<_, _> = previous.iter().map(|entry| (entry.id, entry)).collect();
    let current_ids: HashSet<_> = current.iter().map(|entry| entry.id).collect();
    let added: Vec<_> = current
        .iter()
        .filter(|entry| !previous_by_id.contains_key(&entry.id))
        .cloned()
        .map(EntrySummaryPayload::from)
        .collect();
    let updated: Vec<_> = current
        .iter()
        .filter(|entry| {
            previous_by_id
                .get(&entry.id)
                .is_some_and(|old| *old != *entry)
        })
        .cloned()
        .map(EntrySummaryPayload::from)
        .collect();
    let removed: Vec<_> = previous
        .iter()
        .filter(|entry| !current_ids.contains(&entry.id))
        .map(|entry| entry.id)
        .collect();
    let mut deltas = Vec::with_capacity(3);
    let mut next_revision = revision;
    if !added.is_empty() {
        deltas.push(DirectoryDeltaPayload::EntriesAdded {
            revision: next_revision,
            entries: added,
        });
        next_revision += 1;
    }
    if !updated.is_empty() {
        deltas.push(DirectoryDeltaPayload::EntriesUpdated {
            revision: next_revision,
            entries: updated,
        });
        next_revision += 1;
    }
    if !removed.is_empty() {
        deltas.push(DirectoryDeltaPayload::EntriesRemoved {
            revision: next_revision,
            entry_ids: removed,
        });
    }
    deltas
}

fn delta_revision(delta: &DirectoryDeltaPayload) -> u64 {
    match delta {
        DirectoryDeltaPayload::EntriesAdded { revision, .. }
        | DirectoryDeltaPayload::EntriesUpdated { revision, .. }
        | DirectoryDeltaPayload::EntriesRemoved { revision, .. } => *revision,
        DirectoryDeltaPayload::Reset { snapshot } => snapshot.revision,
    }
}

fn sort_entries(
    entries: &mut [fm_domain::EntrySummary],
    sort: &[SortDescriptorDto],
    folders_first: bool,
) {
    entries.sort_by(|left, right| {
        if folders_first {
            let folder_order = matches!(right.kind, EntryKind::Directory)
                .cmp(&matches!(left.kind, EntryKind::Directory));
            if folder_order != Ordering::Equal {
                return folder_order;
            }
        }
        for descriptor in sort {
            let ordering = compare_entry(left, right, &descriptor.column_id);
            if ordering != Ordering::Equal {
                return match descriptor.direction {
                    SortDirectionDto::Ascending => ordering,
                    SortDirectionDto::Descending => ordering.reverse(),
                };
            }
        }
        left.name.cmp(&right.name)
    });
}

fn compare_entry(
    left: &fm_domain::EntrySummary,
    right: &fm_domain::EntrySummary,
    column_id: &str,
) -> Ordering {
    match column_id {
        "core.extension" => left.extension.cmp(&right.extension),
        "core.size" => left.size.cmp(&right.size),
        "core.modified" => left.modified_at.cmp(&right.modified_at),
        _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
    }
}

/// Decodes `list()`'s continuation token: a plain index offset into the pane's cached, fully
/// sorted entry list (opaque to callers, but simple since it addresses an in-memory `Vec` rather
/// than a provider-specific cursor).
fn decode_page_offset(token: Option<&str>) -> Result<usize, ApplicationError> {
    match token {
        None => Ok(0),
        Some(raw) => raw
            .parse()
            .map_err(|_| ApplicationError::InvalidRequest("invalid continuation token".to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

    use async_trait::async_trait;
    use fm_domain::{EntryMetadata, Location, ProviderId};
    use fm_transport_dto::LocationDto;
    use fm_vfs::{
        DirectoryPage, FileSystemProvider, ProviderCapabilities, ProviderChangeStream,
        ProviderReadStream, ProviderWriteStream, RemoveOptions, VfsError, WriteOptions,
    };
    use tokio::sync::Notify;

    use super::*;

    struct LateProvider {
        calls: AtomicUsize,
        first_started: Notify,
        release_first: Notify,
    }

    impl LateProvider {
        fn new() -> Self {
            Self {
                calls: AtomicUsize::new(0),
                first_started: Notify::new(),
                release_first: Notify::new(),
            }
        }
    }

    #[async_trait]
    impl FileSystemProvider for LateProvider {
        fn id(&self) -> ProviderId {
            ProviderId::new("late")
        }

        fn capabilities(&self) -> ProviderCapabilities {
            ProviderCapabilities::LIST
        }

        async fn list(
            &self,
            _location: &Location,
            _options: ListOptions,
            _cancellation: CancellationToken,
        ) -> Result<DirectoryPage, VfsError> {
            if self.calls.fetch_add(1, AtomicOrdering::SeqCst) == 0 {
                self.first_started.notify_one();
                self.release_first.notified().await;
            }
            Ok(DirectoryPage {
                entries: Vec::new(),
                total_known_entries: Some(0),
                has_more: false,
                continuation_token: None,
            })
        }

        async fn metadata(
            &self,
            _entry: &EntryRef,
            _cancellation: CancellationToken,
        ) -> Result<EntryMetadata, VfsError> {
            Err(unsupported())
        }

        async fn create_directory(
            &self,
            _location: &Location,
            _name: &str,
            _cancellation: CancellationToken,
        ) -> Result<EntryRef, VfsError> {
            Err(unsupported())
        }

        async fn rename(
            &self,
            _source: &EntryRef,
            _destination: &Location,
            _cancellation: CancellationToken,
        ) -> Result<EntryRef, VfsError> {
            Err(unsupported())
        }

        async fn remove(
            &self,
            _entry: &EntryRef,
            _options: RemoveOptions,
            _cancellation: CancellationToken,
        ) -> Result<(), VfsError> {
            Err(unsupported())
        }

        async fn open_read(
            &self,
            _entry: &EntryRef,
            _cancellation: CancellationToken,
        ) -> Result<ProviderReadStream, VfsError> {
            Err(unsupported())
        }

        async fn open_write(
            &self,
            _destination: &Location,
            _options: WriteOptions,
            _cancellation: CancellationToken,
        ) -> Result<ProviderWriteStream, VfsError> {
            Err(unsupported())
        }

        async fn watch(
            &self,
            _location: &Location,
            _cancellation: CancellationToken,
        ) -> Result<ProviderChangeStream, VfsError> {
            Err(unsupported())
        }
    }

    fn unsupported() -> VfsError {
        VfsError::UnsupportedCapability {
            capability: ProviderCapabilities::LIST,
        }
    }

    fn request(pane_id: PaneId, request_id: Uuid) -> ListDirectoryRequest {
        ListDirectoryRequest {
            workspace_id: Uuid::new_v4(),
            pane_id: pane_id.into(),
            request_id,
            location: LocationDto {
                provider_id: "late".to_owned(),
                uri: "late:///directory".to_owned(),
            },
            continuation_token: None,
            sort: Vec::new(),
            show_hidden: true,
            folders_first: false,
        }
    }

    #[tokio::test]
    async fn a_late_superseded_response_is_discarded() {
        let provider = Arc::new(LateProvider::new());
        let mut providers = ProviderRegistry::new();
        providers.register(provider.clone());
        let service = Arc::new(DirectoryService::new(providers));
        let pane_id = PaneId::new();
        let first_id = Uuid::new_v4();
        let second_id = Uuid::new_v4();

        let first_service = service.clone();
        let first =
            tokio::spawn(async move { first_service.list(request(pane_id, first_id)).await });
        provider.first_started.notified().await;

        let second = service
            .list(request(pane_id, second_id))
            .await
            .expect("newest request must be published");
        provider.release_first.notify_one();
        let first = first
            .await
            .expect("task must join")
            .expect_err("superseded response must be discarded");

        assert_eq!(second.request_id, second_id);
        assert_eq!(second.revision, 1);
        assert_eq!(first, ApplicationError::OperationCancelled);
    }

    #[tokio::test]
    async fn repeated_navigation_releases_superseded_watch_registrations() {
        let root = tempfile::tempdir().expect("temporary directory");
        let mut providers = ProviderRegistry::new();
        providers.register(Arc::new(fm_vfs_local::LocalFileSystemProvider));
        let service = DirectoryService::new(providers);
        let pane_id = PaneId::new();

        for index in 0..100 {
            let path = root.path().join(format!("directory-{index}"));
            std::fs::create_dir(&path).expect("create watched directory");
            let location = Location::from_native_path(&path).expect("local location");
            let mut request = request(pane_id, Uuid::new_v4());
            request.location = LocationDto::from(location);
            service.list(request).await.expect("navigate and watch");
        }

        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                if service.watches.registration_count().await == 1 {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("superseded watches must be released");
    }

    #[tokio::test]
    async fn listing_a_directory_larger_than_one_page_paginates_a_globally_sorted_cache() {
        let root = tempfile::tempdir().expect("temporary directory");
        for index in 0..257 {
            std::fs::write(root.path().join(format!("entry-{index:03}")), b"")
                .expect("create paged entry");
        }
        let mut providers = ProviderRegistry::new();
        providers.register(Arc::new(fm_vfs_local::LocalFileSystemProvider));
        let service = DirectoryService::new(providers);
        let pane_id = PaneId::new();
        let workspace_id = Uuid::new_v4();
        let location =
            LocationDto::from(Location::from_native_path(root.path()).expect("local location"));

        let mut first_request = request(pane_id, Uuid::new_v4());
        first_request.workspace_id = workspace_id;
        first_request.location = location.clone();
        let first = service.list(first_request).await.expect("first page");

        assert!(first.has_more);
        assert_eq!(first.total_known_entries, Some(257));
        assert_eq!(first.entries.len(), 256);
        assert_eq!(service.watches.registration_count().await, 1);

        let mut second_request = request(pane_id, Uuid::new_v4());
        second_request.workspace_id = workspace_id;
        second_request.location = location;
        second_request.continuation_token = first.continuation_token;
        let second = service.list(second_request).await.expect("second page");

        assert!(!second.has_more);
        assert_eq!(second.continuation_token, None);
        assert_eq!(second.total_known_entries, Some(257));
        assert_eq!(second.entries.len(), 1);
        // The two pages must be a contiguous slice of one globally sorted list: no gaps,
        // no duplicates, and page 2 continues immediately after page 1 in sort order.
        assert!(first.entries.last().unwrap().name < second.entries[0].name);
        let mut names: Vec<_> = first
            .entries
            .iter()
            .chain(second.entries.iter())
            .map(|entry| entry.name.clone())
            .collect();
        let unique_count = {
            names.sort();
            names.dedup();
            names.len()
        };
        assert_eq!(unique_count, 257);
        assert_eq!(service.watches.registration_count().await, 1);
    }

    #[test]
    fn ten_thousand_added_entries_are_one_batched_delta() {
        let entries = (0..10_000)
            .map(|index| fm_domain::EntrySummary {
                id: fm_domain::EntryId::new(),
                location: Location::new(
                    ProviderId::new("late"),
                    format!("late:///directory/{index}"),
                ),
                name: format!("entry-{index}"),
                kind: EntryKind::File,
                size: Some(0),
                modified_at: None,
                created_at: None,
                hidden: false,
                read_only: false,
                extension: None,
                mime_type: None,
                icon_key: None,
                metadata_revision: 0,
            })
            .collect();

        let deltas = diff_entries(&[], entries, 2);

        assert_eq!(deltas.len(), 1);
        assert!(matches!(
            &deltas[0],
            DirectoryDeltaPayload::EntriesAdded { revision: 2, entries }
                if entries.len() == 10_000
        ));
    }

    #[test]
    fn dropped_provider_events_force_a_fresh_snapshot_reset() {
        let pane_id = PaneId::new();
        let location = Location::new(ProviderId::new("late"), "late:///directory");
        let previous = DirectorySnapshot {
            pane_id,
            request_id: Uuid::new_v4(),
            revision: 1,
            location: location.clone(),
            writable: false,
            entries: Vec::new(),
            total_known_entries: Some(0),
            has_more: false,
            continuation_token: None,
            loading_state: LoadingState::Loaded,
        };
        let fresh = DirectorySnapshot {
            revision: 2,
            ..previous.clone()
        };

        let deltas = deltas_for_change(
            ProviderChange::ResetRequired,
            &previous,
            fresh,
            Vec::new(),
            2,
        );

        assert!(matches!(
            &deltas[..],
            [DirectoryDeltaPayload::Reset { snapshot }]
                if snapshot.pane_id == pane_id && snapshot.revision == 2
        ));
    }
}
