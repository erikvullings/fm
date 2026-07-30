//! Authoritative directory listing state shared by every transport.

use std::cmp::Ordering;
use std::collections::HashMap;

use fm_domain::{DirectorySnapshot, EntryKind, EntryMetadata, LoadingState, PaneId};
use fm_transport_dto::{
    EntryMetadataRequest, ListDirectoryRequest, NavigateRequest, SortDescriptorDto,
    SortDirectionDto,
};
use fm_vfs::{EntryRef, ListOptions, ProviderRegistry};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::ApplicationError;

struct PaneRequest {
    request_id: Uuid,
    cancellation: CancellationToken,
    revision: u64,
}

/// Lists directories and owns per-pane cancellation and revision state.
pub struct DirectoryService {
    providers: ProviderRegistry,
    panes: Mutex<HashMap<PaneId, PaneRequest>>,
}

impl DirectoryService {
    /// Creates a directory service backed by the given provider registry.
    #[must_use]
    pub fn new(providers: ProviderRegistry) -> Self {
        Self {
            providers,
            panes: Mutex::new(HashMap::new()),
        }
    }

    /// Lists one page and publishes it only if it is still the pane's newest request.
    pub async fn list(
        &self,
        request: ListDirectoryRequest,
    ) -> Result<DirectorySnapshot, ApplicationError> {
        let pane_id = PaneId::from(request.pane_id);
        let cancellation = CancellationToken::new();
        {
            let mut panes = self.panes.lock().await;
            let revision = panes.get(&pane_id).map_or(0, |state| state.revision);
            if let Some(previous) = panes.insert(
                pane_id,
                PaneRequest {
                    request_id: request.request_id,
                    cancellation: cancellation.clone(),
                    revision,
                },
            ) {
                previous.cancellation.cancel();
            }
        }

        let location = request.location.into();
        let provider = self.providers.resolve(&location)?;
        let page = provider
            .list(
                &location,
                ListOptions {
                    continuation_token: request.continuation_token,
                    ..ListOptions::default()
                },
                cancellation,
            )
            .await?;

        let mut panes = self.panes.lock().await;
        let state = panes
            .get_mut(&pane_id)
            .filter(|state| state.request_id == request.request_id)
            .ok_or(ApplicationError::OperationCancelled)?;
        state.revision += 1;

        let mut entries = page.entries;
        if !request.show_hidden {
            entries.retain(|entry| !entry.hidden);
        }
        sort_entries(&mut entries, &request.sort, request.folders_first);

        Ok(DirectorySnapshot {
            pane_id,
            request_id: request.request_id,
            revision: state.revision,
            location,
            entries,
            total_known_entries: page.total_known_entries,
            has_more: page.has_more,
            continuation_token: page.continuation_token,
            loading_state: LoadingState::Loaded,
        })
    }

    /// Navigates a pane to a location, cancelling any older pane request.
    pub async fn navigate(
        &self,
        request: NavigateRequest,
    ) -> Result<DirectorySnapshot, ApplicationError> {
        self.list(ListDirectoryRequest {
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
}
