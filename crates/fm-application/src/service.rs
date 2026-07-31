//! The `FileManagerService` facade (specification §7).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use fm_domain::OperationId;
use fm_domain::{DirectorySnapshot, EntryMetadata};
use fm_events::{
    BackendEventPayload, EventAudience, EventBus, NotificationLevelPayload, NotificationPayload,
};
use fm_operations::{
    ExecutionError, Operation, OperationExecutor, OperationPlan, PlanItem, Scheduler,
    SchedulerError,
};
use fm_settings::{
    ConflictPolicy, DateFormat, DefaultPaneLayout, Settings, SettingsStore, SizeFormat, Theme,
};
use fm_transport_dto::{
    ConflictPolicyDto, ConflictResolutionDto, DateFormatDto, DefaultPaneLayoutDto,
    EntryMetadataRequest, ListDirectoryRequest, NavigateRequest, OperationDto, OperationKindDto,
    OperationProgressDto, OperationStateDto, PlatformKindDto, ResolveOperationConflictRequestDto,
    RuntimeCapabilitiesDto, RuntimeKindDto, SettingsDto, SizeFormatDto, StartOperationRequestDto,
    ThemeDto, WorkspaceCommandDto, WorkspaceDto, WorkspaceSummaryDto,
};
use fm_vfs::{EntryRef, FileSystemProvider, ProviderCapabilities, ProviderRegistry};
use fm_vfs_local::LocalFileSystemProvider;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::DirectoryService;
use crate::error::ApplicationError;
use crate::workspace::{JsonFileWorkspaceRepository, WorkspaceService, WorkspaceSummary};

/// Central application service that every host (Axum, Tauri, CLI) calls into.
///
/// Only the capabilities needed by the current milestone are implemented; the
/// remaining fields from the specification's example facade (directories,
/// operations, actions, plugins, events) are added incrementally as their
/// crates land, rather than stubbed out ahead of time.
///
/// Holds a concrete [`WorkspaceService<JsonFileWorkspaceRepository>`] rather
/// than being generic over the repository type: making this facade generic
/// would propagate a type parameter into every host's `AppState`, for no
/// benefit since every host uses the same JSON-file-backed repository.
pub struct FileManagerService {
    runtime: RuntimeKindDto,
    workspaces: WorkspaceService<JsonFileWorkspaceRepository>,
    directories: DirectoryService,
    providers: ProviderRegistry,
    events: EventBus,
    settings_store: SettingsStore,
    settings: Mutex<Settings>,
    operations: Scheduler,
    operation_idempotency: Mutex<HashMap<String, OperationId>>,
}

impl FileManagerService {
    /// Builds a service for the given host runtime, persisting workspaces
    /// under `workspace_directory`.
    pub fn new(
        runtime: RuntimeKindDto,
        workspace_directory: impl Into<PathBuf>,
        settings_directory: impl Into<PathBuf>,
    ) -> Self {
        Self::with_event_bus(
            runtime,
            workspace_directory,
            settings_directory,
            EventBus::default(),
        )
    }

    /// Builds a service using a caller-provided event bus.
    pub fn with_event_bus(
        runtime: RuntimeKindDto,
        workspace_directory: impl Into<PathBuf>,
        settings_directory: impl Into<PathBuf>,
        events: EventBus,
    ) -> Self {
        let mut providers = ProviderRegistry::new();
        providers.register(Arc::new(LocalFileSystemProvider));
        let settings_store = SettingsStore::new(settings_directory);
        let loaded = settings_store
            .load()
            .unwrap_or_else(|_| fm_settings::LoadOutcome {
                settings: Settings::default(),
                warning: Some(
                    "Settings could not be read. Application defaults were loaded.".into(),
                ),
            });
        if let Some(message) = loaded.warning {
            events.publish(
                EventAudience::Global,
                BackendEventPayload::NotificationCreated {
                    notification: NotificationPayload {
                        id: Uuid::new_v4().to_string(),
                        level: NotificationLevelPayload::Warning,
                        message,
                    },
                },
            );
        }
        let operation_concurrency = loaded.settings.operation_concurrency;
        Self {
            runtime,
            workspaces: WorkspaceService::new(JsonFileWorkspaceRepository::new(
                workspace_directory,
            )),
            directories: DirectoryService::with_event_bus(providers.clone(), events.clone()),
            providers,
            events: events.clone(),
            settings_store,
            settings: Mutex::new(loaded.settings),
            operations: Scheduler::new(operation_concurrency, events),
            operation_idempotency: Mutex::new(HashMap::new()),
        }
    }

    /// Starts a semantic operation, deduplicating retries by idempotency key.
    pub fn start_operation(
        &self,
        request: StartOperationRequestDto,
        idempotency_key: Option<String>,
    ) -> Result<OperationDto, ApplicationError> {
        let mut idempotency = self
            .operation_idempotency
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(existing) = idempotency_key
            .as_ref()
            .and_then(|key| idempotency.get(key).copied())
        {
            return self.get_operation(existing);
        }
        let destination = request.destination.clone().map(Into::into);
        let executor: Arc<dyn OperationExecutor> = match request.operation_type {
            OperationKindDto::CreateDirectory => {
                let parent = destination.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest(
                        "createDirectory requires a destination directory".into(),
                    )
                })?;
                let name = request.name.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest("createDirectory requires a name".into())
                })?;
                let provider = self
                    .providers
                    .resolve(&parent)
                    .map_err(ApplicationError::from)?;
                provider
                    .capabilities()
                    .require(ProviderCapabilities::CREATE_DIRECTORY)
                    .map_err(ApplicationError::from)?;
                Arc::new(CreateDirectoryExecutor {
                    provider,
                    parent,
                    name,
                    create_intermediates: request.create_intermediate_directories,
                })
            }
            OperationKindDto::Rename => {
                if request.sources.len() != 1 {
                    return Err(ApplicationError::InvalidRequest(
                        "rename requires exactly one source".into(),
                    ));
                }
                let destination = destination.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest("rename requires a destination".into())
                })?;
                let source: fm_domain::Location = request.sources[0].clone().into();
                let provider = self
                    .providers
                    .resolve(&source)
                    .map_err(ApplicationError::from)?;
                if source.provider_id != destination.provider_id {
                    return Err(ApplicationError::InvalidRequest(
                        "rename cannot cross providers".into(),
                    ));
                }
                provider
                    .capabilities()
                    .require(ProviderCapabilities::RENAME)
                    .map_err(ApplicationError::from)?;
                Arc::new(RenameExecutor {
                    provider,
                    source,
                    destination,
                })
            }
            OperationKindDto::Copy => {
                if request.sources.len() != 1 {
                    return Err(ApplicationError::InvalidRequest(
                        "single-file copy requires exactly one source".into(),
                    ));
                }
                let destination_directory = destination.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest("copy requires a destination directory".into())
                })?;
                let source: fm_domain::Location = request.sources[0].clone().into();
                let source_provider = self
                    .providers
                    .resolve(&source)
                    .map_err(ApplicationError::from)?;
                let destination_provider = self
                    .providers
                    .resolve(&destination_directory)
                    .map_err(ApplicationError::from)?;
                source_provider
                    .capabilities()
                    .require(ProviderCapabilities::READ)
                    .map_err(ApplicationError::from)?;
                destination_provider
                    .capabilities()
                    .require(ProviderCapabilities::WRITE)
                    .map_err(ApplicationError::from)?;
                Arc::new(CopyFileExecutor {
                    source_provider,
                    destination_provider,
                    destination_directory,
                    temporary: Mutex::new(None),
                })
            }
            _ => Arc::new(NoOpExecutor),
        };
        let sources: Vec<EntryRef> = request
            .sources
            .into_iter()
            .map(|location| EntryRef {
                id: fm_domain::EntryId::new(),
                location: location.into(),
            })
            .collect();
        let operation = Operation::new(
            operation_kind(request.operation_type),
            sources,
            destination,
            conflict_policy(request.conflict_policy),
        );
        let id = self
            .operations
            .submit(operation, executor)
            .map_err(map_scheduler_error)?;
        if let Some(key) = idempotency_key {
            idempotency.insert(key, id);
        }
        self.get_operation(id)
    }

    /// Lists all operation snapshots.
    #[must_use]
    pub fn list_operations(&self) -> Vec<OperationDto> {
        self.operations
            .list()
            .into_iter()
            .map(operation_dto)
            .collect()
    }

    /// Gets one operation snapshot.
    pub fn get_operation(&self, id: OperationId) -> Result<OperationDto, ApplicationError> {
        self.operations
            .get(id)
            .map(operation_dto)
            .map_err(map_scheduler_error)
    }

    /// Requests cancellation of an operation.
    pub fn cancel_operation(&self, id: OperationId) -> Result<(), ApplicationError> {
        self.operations.cancel(id).map_err(map_scheduler_error)
    }

    /// Pauses a running operation.
    pub fn pause_operation(&self, id: OperationId) -> Result<(), ApplicationError> {
        self.operations.pause(id).map_err(map_scheduler_error)
    }

    /// Resumes a paused operation.
    pub fn resume_operation(&self, id: OperationId) -> Result<(), ApplicationError> {
        self.operations.resume(id).map_err(map_scheduler_error)
    }

    /// Applies a reserved conflict decision through the shared operation service.
    pub fn resolve_operation_conflict(
        &self,
        id: OperationId,
        request: ResolveOperationConflictRequestDto,
    ) -> Result<(), ApplicationError> {
        if request.resolution == ConflictResolutionDto::CancelOperation {
            return self.cancel_operation(id);
        }
        self.operations
            .resolve_conflict(id)
            .map_err(map_scheduler_error)
    }

    /// Returns the current application-wide settings.
    pub fn get_settings(&self) -> SettingsDto {
        let settings = self
            .settings
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        settings_to_dto(settings)
    }

    /// Atomically persists and returns a complete settings replacement.
    pub fn update_settings(&self, settings: SettingsDto) -> Result<SettingsDto, ApplicationError> {
        let settings = settings_from_dto(settings);
        self.settings_store
            .save(&settings)
            .map_err(|_| ApplicationError::Internal)?;
        let mut current = self
            .settings
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *current = settings;
        Ok(settings_to_dto(current.clone()))
    }

    /// Returns the shared backend event bus used by both host adapters.
    #[must_use]
    pub fn event_bus(&self) -> EventBus {
        self.events.clone()
    }

    /// Lists one page of a directory.
    pub async fn list_directory(
        &self,
        request: ListDirectoryRequest,
    ) -> Result<DirectorySnapshot, ApplicationError> {
        self.directories.list(request).await
    }

    /// Refreshes a directory using the same options as a listing.
    pub async fn refresh_directory(
        &self,
        request: ListDirectoryRequest,
    ) -> Result<DirectorySnapshot, ApplicationError> {
        self.directories.refresh(request).await
    }

    /// Navigates a pane and lists its first page.
    pub async fn navigate_pane(
        &self,
        request: NavigateRequest,
    ) -> Result<DirectorySnapshot, ApplicationError> {
        self.directories.navigate(request).await
    }

    /// Fetches detailed metadata for one entry.
    pub async fn get_entry_metadata(
        &self,
        request: EntryMetadataRequest,
    ) -> Result<EntryMetadata, ApplicationError> {
        self.directories.metadata(request).await
    }

    /// Reports which capabilities are available for the current runtime and
    /// platform, so the frontend can respond to capabilities rather than
    /// detecting operating systems itself (spec §21).
    pub fn runtime_capabilities(&self) -> RuntimeCapabilitiesDto {
        RuntimeCapabilitiesDto {
            runtime: self.runtime,
            platform: detect_platform(),
            native_menus: false,
            native_file_icons: false,
            native_thumbnails: false,
            native_drag_out: false,
            system_trash: false,
            reveal_in_system_file_manager: false,
            open_terminal: false,
            // The browser Clipboard API works without any native bridge.
            clipboard: true,
            plugins: false,
            server_administration: false,
        }
    }

    /// Runs the workspace startup lifecycle (spec §5.3.7): selects an
    /// explicitly requested workspace, otherwise the last-active one,
    /// otherwise creates a default.
    pub async fn start_workspace(
        &self,
        requested_workspace_id: Option<Uuid>,
    ) -> Result<WorkspaceDto, ApplicationError> {
        let workspace = self
            .workspaces
            .start(requested_workspace_id.map(Into::into))
            .await?;
        Ok(workspace.into())
    }

    /// Lists every stored workspace as a lightweight summary (spec §5.3.12
    /// `listWorkspaces`).
    pub async fn list_workspaces(&self) -> Result<Vec<WorkspaceSummaryDto>, ApplicationError> {
        let summaries = self.workspaces.list().await?;
        Ok(summaries.into_iter().map(Into::into).collect())
    }

    /// Loads a single workspace by id (spec §5.3.12 `getWorkspace`).
    pub async fn get_workspace(&self, id: Uuid) -> Result<WorkspaceDto, ApplicationError> {
        let workspace = self.workspaces.load(id.into()).await?;
        Ok(workspace.into())
    }

    /// Creates and persists a new workspace (spec §5.3.12 `createWorkspace`).
    pub async fn create_workspace(
        &self,
        name: Option<String>,
    ) -> Result<WorkspaceDto, ApplicationError> {
        let workspace = self.workspaces.create(name).await?;
        Ok(workspace.into())
    }

    /// Deletes a workspace (spec §5.3.12 `deleteWorkspace`).
    pub async fn delete_workspace(
        &self,
        id: Uuid,
        expected_revision: Option<u64>,
    ) -> Result<(), ApplicationError> {
        self.workspaces.delete(id.into(), expected_revision).await?;
        Ok(())
    }

    /// Selects an existing workspace as the last-active workspace (spec
    /// §5.3.12 `openWorkspace`).
    pub async fn open_workspace(&self, id: Uuid) -> Result<WorkspaceDto, ApplicationError> {
        let workspace = self.workspaces.open(id.into()).await?;
        Ok(workspace.into())
    }

    /// Applies a semantic workspace mutation command (spec §5.3.9, §5.3.12
    /// `applyWorkspaceCommand`).
    pub async fn apply_workspace_command(
        &self,
        command: WorkspaceCommandDto,
    ) -> Result<WorkspaceDto, ApplicationError> {
        let workspace = self.workspaces.apply_command(command.into()).await?;
        Ok(workspace.into())
    }
}

impl From<WorkspaceSummary> for WorkspaceSummaryDto {
    fn from(summary: WorkspaceSummary) -> Self {
        Self {
            id: summary.id.into(),
            name: summary.name,
            updated_at: summary.updated_at,
            revision: summary.revision,
        }
    }
}

struct NoOpExecutor;

struct CreateDirectoryExecutor {
    provider: Arc<dyn FileSystemProvider>,
    parent: fm_domain::Location,
    name: String,
    create_intermediates: bool,
}

struct RenameExecutor {
    provider: Arc<dyn FileSystemProvider>,
    source: fm_domain::Location,
    destination: fm_domain::Location,
}

struct CopyFileExecutor {
    source_provider: Arc<dyn FileSystemProvider>,
    destination_provider: Arc<dyn FileSystemProvider>,
    destination_directory: fm_domain::Location,
    temporary: Mutex<Option<fm_domain::Location>>,
}

#[async_trait]
impl OperationExecutor for CopyFileExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let source = operation
            .sources
            .first()
            .cloned()
            .ok_or_else(|| ExecutionError::Failed("copy source is missing".into()))?;
        let size = self
            .source_provider
            .file_size(&source, cancellation.clone())
            .await?;
        Ok(OperationPlan::new(vec![PlanItem::new(source, size)]))
    }

    async fn execute(
        &self,
        operation: &Operation,
        item: &PlanItem,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        let name = item
            .entry
            .location
            .name()
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        let temporary = self
            .destination_directory
            .join(&format!(".fm-copy-{}", Uuid::new_v4()))
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        *self.temporary.lock().unwrap_or_else(|e| e.into_inner()) = Some(temporary.clone());
        let cloned = self.source_provider.id() == self.destination_provider.id()
            && self
                .source_provider
                .capabilities()
                .contains(ProviderCapabilities::SERVER_SIDE_COPY)
            && self
                .source_provider
                .server_side_copy(&item.entry, &temporary, cancellation.clone())
                .await?;
        if !cloned {
            let mut reader = self
                .source_provider
                .open_read(&item.entry, cancellation.clone())
                .await?;
            let mut writer = self
                .destination_provider
                .open_write(
                    &temporary,
                    fm_vfs::WriteOptions::default(),
                    cancellation.clone(),
                )
                .await?;
            let mut buffer = vec![0_u8; 128 * 1024];
            loop {
                if cancellation.is_cancelled() {
                    return Ok(());
                }
                let read = tokio::select! {
                    () = cancellation.cancelled() => return Ok(()),
                    result = reader.read(&mut buffer) => result.map_err(copy_stream_error)?,
                };
                if read == 0 {
                    break;
                }
                tokio::select! {
                    () = cancellation.cancelled() => return Ok(()),
                    result = writer.write_all(&buffer[..read]) => result.map_err(copy_stream_error)?,
                }
            }
            writer.shutdown().await.map_err(copy_stream_error)?;
            drop(writer);
        }
        if cancellation.is_cancelled() {
            return Ok(());
        }

        let overwrite = operation.conflict_policy == fm_operations::ConflictPolicy::Overwrite;
        let mut destination = self
            .destination_directory
            .join(&name)
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        let mut suffix = 1_u32;
        loop {
            match self
                .destination_provider
                .commit_copy(
                    &item.entry,
                    &temporary,
                    &destination,
                    fm_vfs::CopyCommitOptions {
                        overwrite,
                        preserve_metadata: true,
                    },
                    cancellation.clone(),
                )
                .await
            {
                Ok(_) => break,
                Err(fm_vfs::VfsError::AlreadyExists { .. })
                    if operation.conflict_policy == fm_operations::ConflictPolicy::RenameNew =>
                {
                    destination = self
                        .destination_directory
                        .join(&copy_name(&name, suffix))
                        .map_err(|error| ExecutionError::Failed(error.to_string()))?;
                    suffix = suffix.saturating_add(1);
                }
                Err(error) => return Err(error.into()),
            }
        }
        *self.temporary.lock().unwrap_or_else(|e| e.into_inner()) = None;
        Ok(())
    }

    async fn cleanup_partial(&self, _operation: &Operation) -> Result<(), ExecutionError> {
        let temporary = self
            .temporary
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(temporary) = temporary {
            self.destination_provider
                .discard_copy(&temporary, CancellationToken::new())
                .await?;
        }
        Ok(())
    }
}

fn copy_name(name: &str, suffix: u32) -> String {
    let path = std::path::Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(name);
    match path.extension().and_then(|value| value.to_str()) {
        Some(extension) => format!("{stem} (copy {suffix}).{extension}"),
        None => format!("{stem} (copy {suffix})"),
    }
}

fn copy_stream_error(error: std::io::Error) -> ExecutionError {
    fm_vfs::VfsError::Io {
        message: error.to_string(),
    }
    .into()
}

#[async_trait]
impl OperationExecutor for RenameExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        _cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let entry = operation
            .sources
            .first()
            .cloned()
            .ok_or_else(|| ExecutionError::Failed("rename source is missing".into()))?;
        Ok(OperationPlan::new(vec![PlanItem::new(entry, 0)]))
    }

    async fn execute(
        &self,
        _operation: &Operation,
        item: &PlanItem,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        let source = EntryRef {
            id: item.entry.id,
            location: self.source.clone(),
        };
        self.provider
            .rename(&source, &self.destination, cancellation.clone())
            .await?;
        Ok(())
    }

    async fn cleanup_partial(&self, _operation: &Operation) -> Result<(), ExecutionError> {
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for CreateDirectoryExecutor {
    async fn plan(
        &self,
        _operation: &Operation,
        _cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        Ok(OperationPlan::new(vec![PlanItem::new(
            EntryRef {
                id: fm_domain::EntryId::new(),
                location: self.parent.clone(),
            },
            0,
        )]))
    }

    async fn execute(
        &self,
        _operation: &Operation,
        _item: &PlanItem,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        if !self.create_intermediates {
            self.provider
                .create_directory(&self.parent, &self.name, cancellation.clone())
                .await?;
            return Ok(());
        }
        let mut parent = self.parent.clone();
        for component in self.name.split(['/', '\\']) {
            let created = self
                .provider
                .create_directory(&parent, component, cancellation.clone())
                .await?;
            parent = created.location;
        }
        Ok(())
    }

    async fn cleanup_partial(&self, _operation: &Operation) -> Result<(), ExecutionError> {
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for NoOpExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        _cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        Ok(OperationPlan::new(
            operation
                .sources
                .iter()
                .cloned()
                .map(|entry| PlanItem::new(entry, 0))
                .collect(),
        ))
    }
    async fn execute(
        &self,
        _operation: &Operation,
        _item: &PlanItem,
        _cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        Ok(())
    }
    async fn cleanup_partial(&self, _operation: &Operation) -> Result<(), ExecutionError> {
        Ok(())
    }
}

fn map_scheduler_error(error: SchedulerError) -> ApplicationError {
    match error {
        SchedulerError::UnknownOperation(_) => ApplicationError::NotFound,
        SchedulerError::Transition(error) => ApplicationError::InvalidRequest(error.to_string()),
        SchedulerError::Execution(_) => ApplicationError::Internal,
    }
}

const fn operation_kind(kind: OperationKindDto) -> fm_operations::OperationKind {
    match kind {
        OperationKindDto::CreateDirectory => fm_operations::OperationKind::CreateDirectory,
        OperationKindDto::Rename => fm_operations::OperationKind::Rename,
        OperationKindDto::Copy => fm_operations::OperationKind::Copy,
        OperationKindDto::Move => fm_operations::OperationKind::Move,
        OperationKindDto::Duplicate => fm_operations::OperationKind::Duplicate,
        OperationKindDto::Trash => fm_operations::OperationKind::Trash,
        OperationKindDto::Delete => fm_operations::OperationKind::Delete,
    }
}

const fn conflict_policy(
    policy: fm_transport_dto::OperationConflictPolicyDto,
) -> fm_operations::ConflictPolicy {
    match policy {
        fm_transport_dto::OperationConflictPolicyDto::Ask => fm_operations::ConflictPolicy::Ask,
        fm_transport_dto::OperationConflictPolicyDto::Skip => fm_operations::ConflictPolicy::Skip,
        fm_transport_dto::OperationConflictPolicyDto::Overwrite => {
            fm_operations::ConflictPolicy::Overwrite
        }
        fm_transport_dto::OperationConflictPolicyDto::RenameNew => {
            fm_operations::ConflictPolicy::RenameNew
        }
        fm_transport_dto::OperationConflictPolicyDto::KeepNewer => {
            fm_operations::ConflictPolicy::KeepNewer
        }
    }
}

fn operation_dto(operation: Operation) -> OperationDto {
    OperationDto {
        id: operation.id.into(),
        operation_type: match operation.kind {
            fm_operations::OperationKind::CreateDirectory => OperationKindDto::CreateDirectory,
            fm_operations::OperationKind::Rename => OperationKindDto::Rename,
            fm_operations::OperationKind::Copy => OperationKindDto::Copy,
            fm_operations::OperationKind::Move => OperationKindDto::Move,
            fm_operations::OperationKind::Duplicate => OperationKindDto::Duplicate,
            fm_operations::OperationKind::Trash => OperationKindDto::Trash,
            fm_operations::OperationKind::Delete => OperationKindDto::Delete,
        },
        state: match operation.state {
            fm_operations::OperationState::Queued => OperationStateDto::Queued,
            fm_operations::OperationState::Planning => OperationStateDto::Planning,
            fm_operations::OperationState::Running => OperationStateDto::Running,
            fm_operations::OperationState::Paused => OperationStateDto::Paused,
            fm_operations::OperationState::WaitingForConflictResolution => {
                OperationStateDto::WaitingForConflictResolution
            }
            fm_operations::OperationState::Cancelling => OperationStateDto::Cancelling,
            fm_operations::OperationState::Cancelled => OperationStateDto::Cancelled,
            fm_operations::OperationState::Completed => OperationStateDto::Completed,
            fm_operations::OperationState::CompletedWithWarnings => {
                OperationStateDto::CompletedWithWarnings
            }
            fm_operations::OperationState::Failed => OperationStateDto::Failed,
        },
        sources: operation
            .sources
            .into_iter()
            .map(|entry| fm_transport_dto::EntryRefDto {
                id: entry.id.into(),
                location: entry.location.into(),
            })
            .collect(),
        destination: operation.destination.map(Into::into),
        progress: OperationProgressDto {
            completed_items: operation.progress.completed_items,
            total_items: operation.progress.total_items,
            completed_bytes: operation.progress.completed_bytes,
            total_bytes: operation.progress.total_bytes,
            current_entry: operation.progress.current_entry.map(|entry| {
                fm_transport_dto::EntryRefDto {
                    id: entry.id.into(),
                    location: entry.location.into(),
                }
            }),
            bytes_per_second: operation.progress.bytes_per_second,
        },
        conflict_policy: match operation.conflict_policy {
            fm_operations::ConflictPolicy::Ask => fm_transport_dto::OperationConflictPolicyDto::Ask,
            fm_operations::ConflictPolicy::Skip => {
                fm_transport_dto::OperationConflictPolicyDto::Skip
            }
            fm_operations::ConflictPolicy::Overwrite => {
                fm_transport_dto::OperationConflictPolicyDto::Overwrite
            }
            fm_operations::ConflictPolicy::RenameNew => {
                fm_transport_dto::OperationConflictPolicyDto::RenameNew
            }
            fm_operations::ConflictPolicy::KeepNewer => {
                fm_transport_dto::OperationConflictPolicyDto::KeepNewer
            }
        },
        created_at: operation.created_at,
        started_at: operation.started_at,
        completed_at: operation.completed_at,
    }
}

fn settings_to_dto(settings: Settings) -> SettingsDto {
    SettingsDto {
        schema_version: settings.schema_version,
        theme: match settings.theme {
            Theme::Auto => ThemeDto::Auto,
            Theme::Light => ThemeDto::Light,
            Theme::Dark => ThemeDto::Dark,
        },
        font_size: settings.font_size,
        row_height: settings.row_height,
        date_format: match settings.date_format {
            DateFormat::Short => DateFormatDto::Short,
            DateFormat::Medium => DateFormatDto::Medium,
            DateFormat::Iso => DateFormatDto::Iso,
        },
        size_format: match settings.size_format {
            SizeFormat::Binary => SizeFormatDto::Binary,
            SizeFormat::Decimal => SizeFormatDto::Decimal,
            SizeFormat::Bytes => SizeFormatDto::Bytes,
        },
        show_hidden_files: settings.show_hidden_files,
        confirm_permanent_delete: settings.confirm_permanent_delete,
        default_conflict_policy: match settings.default_conflict_policy {
            ConflictPolicy::Ask => ConflictPolicyDto::Ask,
            ConflictPolicy::Overwrite => ConflictPolicyDto::Overwrite,
            ConflictPolicy::KeepBoth => ConflictPolicyDto::KeepBoth,
            ConflictPolicy::Skip => ConflictPolicyDto::Skip,
        },
        operation_concurrency: settings.operation_concurrency,
        default_pane_layout: match settings.default_pane_layout {
            DefaultPaneLayout::Dual => DefaultPaneLayoutDto::Dual,
            DefaultPaneLayout::Single => DefaultPaneLayoutDto::Single,
        },
        default_columns: settings.default_columns,
        keybindings: settings.keybindings,
        enabled_plugins: settings.enabled_plugins,
        plugin_settings: serde_json::to_value(settings.plugin_settings)
            .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new())),
        terminal_command: settings.terminal_command,
        default_start_locations: settings.default_start_locations,
    }
}

fn settings_from_dto(settings: SettingsDto) -> Settings {
    Settings {
        schema_version: fm_settings::CURRENT_SCHEMA_VERSION,
        theme: match settings.theme {
            ThemeDto::Auto => Theme::Auto,
            ThemeDto::Light => Theme::Light,
            ThemeDto::Dark => Theme::Dark,
        },
        font_size: settings.font_size,
        row_height: settings.row_height,
        date_format: match settings.date_format {
            DateFormatDto::Short => DateFormat::Short,
            DateFormatDto::Medium => DateFormat::Medium,
            DateFormatDto::Iso => DateFormat::Iso,
        },
        size_format: match settings.size_format {
            SizeFormatDto::Binary => SizeFormat::Binary,
            SizeFormatDto::Decimal => SizeFormat::Decimal,
            SizeFormatDto::Bytes => SizeFormat::Bytes,
        },
        show_hidden_files: settings.show_hidden_files,
        confirm_permanent_delete: settings.confirm_permanent_delete,
        default_conflict_policy: match settings.default_conflict_policy {
            ConflictPolicyDto::Ask => ConflictPolicy::Ask,
            ConflictPolicyDto::Overwrite => ConflictPolicy::Overwrite,
            ConflictPolicyDto::KeepBoth => ConflictPolicy::KeepBoth,
            ConflictPolicyDto::Skip => ConflictPolicy::Skip,
        },
        operation_concurrency: settings.operation_concurrency,
        default_pane_layout: match settings.default_pane_layout {
            DefaultPaneLayoutDto::Dual => DefaultPaneLayout::Dual,
            DefaultPaneLayoutDto::Single => DefaultPaneLayout::Single,
        },
        default_columns: settings.default_columns,
        keybindings: settings.keybindings,
        enabled_plugins: settings.enabled_plugins,
        plugin_settings: serde_json::from_value(settings.plugin_settings).unwrap_or_default(),
        terminal_command: settings.terminal_command,
        default_start_locations: settings.default_start_locations,
    }
}

/// Detects the host operating system from the compiled target (spec §21).
fn detect_platform() -> PlatformKindDto {
    match std::env::consts::OS {
        "macos" => PlatformKindDto::Macos,
        "windows" => PlatformKindDto::Windows,
        "linux" => PlatformKindDto::Linux,
        _ => PlatformKindDto::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fm_events::{SessionId, SubscriptionEvent};

    fn service() -> (tempfile::TempDir, FileManagerService) {
        let dir = tempfile::tempdir().expect("must create a temp dir");
        let service = FileManagerService::new(
            RuntimeKindDto::BrowserServer,
            dir.path(),
            dir.path().join("settings"),
        );
        (dir, service)
    }

    #[test]
    fn runtime_capabilities_report_the_configured_runtime_kind() {
        let (_dir, service) = service();
        assert_eq!(
            service.runtime_capabilities().runtime,
            RuntimeKindDto::BrowserServer
        );

        let dir = tempfile::tempdir().expect("must create a temp dir");
        let service = FileManagerService::new(
            RuntimeKindDto::Tauri,
            dir.path(),
            dir.path().join("settings"),
        );
        assert_eq!(
            service.runtime_capabilities().runtime,
            RuntimeKindDto::Tauri
        );
    }

    #[tokio::test]
    async fn corrupt_settings_surface_a_global_warning_notification() {
        let directory = tempfile::tempdir().expect("must create a temp dir");
        let settings_directory = directory.path().join("settings");
        std::fs::create_dir_all(&settings_directory).expect("create settings directory");
        std::fs::write(
            settings_directory.join(fm_settings::SETTINGS_FILE_NAME),
            "{broken",
        )
        .expect("write corrupt settings");
        let service = FileManagerService::new(
            RuntimeKindDto::BrowserServer,
            directory.path().join("workspaces"),
            settings_directory,
        );
        let mut events = service
            .event_bus()
            .subscribe(SessionId::new("test"), [], Some(0));

        let event = events.recv().await.expect("warning event");
        assert!(matches!(
            event,
            SubscriptionEvent::Event(envelope)
                if matches!(
                    envelope.payload,
                    BackendEventPayload::NotificationCreated {
                        notification: NotificationPayload {
                            level: NotificationLevelPayload::Warning,
                            ..
                        }
                    }
                )
        ));
    }

    #[test]
    fn runtime_capabilities_report_no_unimplemented_natives() {
        let (_dir, service) = service();
        let capabilities = service.runtime_capabilities();

        assert!(!capabilities.native_menus);
        assert!(!capabilities.native_file_icons);
        assert!(!capabilities.native_thumbnails);
        assert!(!capabilities.native_drag_out);
        assert!(!capabilities.system_trash);
        assert!(!capabilities.reveal_in_system_file_manager);
        assert!(!capabilities.open_terminal);
        assert!(!capabilities.plugins);
        assert!(!capabilities.server_administration);
        assert!(capabilities.clipboard);
    }

    #[test]
    fn detect_platform_matches_the_compiled_target() {
        let expected = match std::env::consts::OS {
            "macos" => PlatformKindDto::Macos,
            "windows" => PlatformKindDto::Windows,
            "linux" => PlatformKindDto::Linux,
            _ => PlatformKindDto::Unknown,
        };
        assert_eq!(detect_platform(), expected);
    }

    #[tokio::test]
    async fn create_list_open_and_delete_workspace_round_trip_through_dtos() {
        let (_dir, service) = service();

        let created = service
            .create_workspace(Some("Photos".to_owned()))
            .await
            .expect("create must succeed");
        assert_eq!(created.name, "Photos");

        let summaries = service.list_workspaces().await.expect("list must succeed");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, created.id);

        let opened = service
            .open_workspace(created.id)
            .await
            .expect("open must succeed");
        assert_eq!(opened.id, created.id);

        service
            .delete_workspace(created.id, Some(created.revision))
            .await
            .expect("delete must succeed");
        assert!(service.list_workspaces().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn apply_workspace_command_reports_a_stale_revision_conflict() {
        let (_dir, service) = service();
        let created = service
            .create_workspace(None)
            .await
            .expect("create must succeed");

        let command = fm_transport_dto::WorkspaceCommandDto::RenameWorkspace {
            workspace_id: created.id,
            name: "Renamed".to_owned(),
            expected_revision: created.revision + 1,
        };

        let error = service
            .apply_workspace_command(command)
            .await
            .expect_err("a stale revision must be rejected");

        assert!(matches!(
            error,
            ApplicationError::WorkspaceRevisionConflict { .. }
        ));
    }
}
