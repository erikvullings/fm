//! The `FileManagerService` facade (specification §7).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use fm_domain::OperationId;
use fm_domain::{
    ActionContextRequirements, ActionDescriptor, ActionId, ActionSource, DirectorySnapshot,
    EntryKind, EntryMetadata, Location, PluginId,
};
use fm_events::{
    BackendEventPayload, EventAudience, EventBus, NotificationLevelPayload, NotificationPayload,
    PluginPayload,
};
use fm_operations::{
    ConflictResolution, ExecutionError, ExecutionOutcome, Operation, OperationExecutor,
    OperationPlan, OperationSnapshotObserver, PauseToken, PlanItem, Scheduler, SchedulerError,
};
use fm_platform::{FallbackPlatformAdapter, PlatformAdapter, PlatformCapabilities};
use fm_plugin_api::{ActionContribution, PluginManifest, PluginPermissions, SelectedEntryContext};
use fm_plugin_runtime::{PluginDiscovery, PluginRuntime};
use fm_search::{SearchEngine, SearchFileSystemProvider, SearchResultsStore};
use fm_settings::{
    ConflictPolicy, DateFormat, DefaultPaneLayout, IconTheme, Settings, SettingsStore, SizeFormat,
    Theme,
};
use fm_transport_dto::{
    ActionDescriptorDto, ActionResultDto, ConflictPolicyDto, ConflictResolutionDto, DateFormatDto,
    DefaultPaneLayoutDto, EntryMetadataRequest, IconThemeDto, InvokeActionRequestDto,
    ListDirectoryRequest, NavigateRequest, OperationConflictPolicyDto, OperationDto,
    OperationKindDto, OperationProgressDto, OperationStateDto, PlatformKindDto, PluginLogEntryDto,
    PluginPermissionsDto, ResolveOperationConflictRequestDto, RuntimeCapabilitiesDto,
    RuntimeKindDto, SettingsDto, SizeFormatDto, StartOperationRequestDto, StartSearchRequestDto,
    StartSearchResponseDto, ThemeDto, WorkspaceCommandDto, WorkspaceDto, WorkspaceSummaryDto,
};
use fm_vfs::{EntryRef, FileSystemProvider, ProviderCapabilities, ProviderRegistry};
use fm_vfs_local::LocalFileSystemProvider;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::DirectoryService;
use crate::action::ActionRegistry;
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
    platform: Arc<dyn PlatformAdapter>,
    workspaces: WorkspaceService<JsonFileWorkspaceRepository>,
    directories: DirectoryService,
    providers: ProviderRegistry,
    events: EventBus,
    settings_store: SettingsStore,
    settings: Mutex<Settings>,
    plugins: PluginDiscovery,
    plugin_runtime: PluginRuntime,
    operations: Scheduler,
    operation_history: Arc<OperationHistory>,
    operation_idempotency: Mutex<HashMap<String, OperationId>>,
    force_cross_volume_moves: AtomicBool,
    audit_log_path: PathBuf,
    actions: ActionRegistry,
    search: SearchEngine,
}

const OPERATION_HISTORY_FILE_NAME: &str = "operation-history.json";
const OPERATION_HISTORY_MAX_ENTRIES: usize = 100;
const OPERATION_HISTORY_MAX_AGE_DAYS: i64 = 30;

/// Crash-safe operation snapshots stored beside settings.
struct OperationHistory {
    path: PathBuf,
    operations: Mutex<Vec<Operation>>,
}

struct ApplicationOperationObserver {
    history: Arc<OperationHistory>,
    directories: DirectoryService,
}

impl OperationHistory {
    fn load(directory: &std::path::Path) -> Self {
        let path = directory.join(OPERATION_HISTORY_FILE_NAME);
        let mut operations = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<Operation>>(&bytes).ok())
            .unwrap_or_default();
        let now = chrono::Utc::now();
        for operation in &mut operations {
            if !operation.state.is_terminal() {
                operation.state = fm_operations::OperationState::Interrupted;
                operation.completed_at = Some(now);
            }
        }
        let history = Self {
            path,
            operations: Mutex::new(operations),
        };
        history.prune_and_save();
        history
    }

    fn list(&self) -> Vec<OperationDto> {
        self.operations
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .iter()
            .filter(|operation| operation.state.is_terminal())
            .cloned()
            .map(|operation| operation_dto(operation, None))
            .collect()
    }

    fn get(&self, id: OperationId) -> Option<OperationDto> {
        self.operations
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .iter()
            .find(|operation| operation.id == id && operation.state.is_terminal())
            .cloned()
            .map(|operation| operation_dto(operation, None))
    }

    fn prune_and_save(&self) {
        let mut operations = self
            .operations
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let cutoff = chrono::Utc::now() - chrono::Duration::days(OPERATION_HISTORY_MAX_AGE_DAYS);
        operations.retain(|operation| {
            !operation.state.is_terminal()
                || operation
                    .completed_at
                    .is_none_or(|completed_at| completed_at >= cutoff)
        });
        let mut terminal = operations
            .iter()
            .enumerate()
            .filter(|(_, operation)| operation.state.is_terminal())
            .map(|(index, operation)| (index, operation.completed_at))
            .collect::<Vec<_>>();
        terminal.sort_by_key(|(_, completed_at)| *completed_at);
        let excess = terminal.len().saturating_sub(OPERATION_HISTORY_MAX_ENTRIES);
        let remove = terminal
            .into_iter()
            .take(excess)
            .map(|(index, _)| index)
            .collect::<HashSet<_>>();
        if !remove.is_empty() {
            *operations = operations
                .iter()
                .enumerate()
                .filter(|(index, _)| !remove.contains(index))
                .map(|(_, operation)| operation.clone())
                .collect();
        }
        let Ok(bytes) = serde_json::to_vec_pretty(&*operations) else {
            return;
        };
        let Some(directory) = self.path.parent() else {
            return;
        };
        if fs::create_dir_all(directory).is_err() {
            return;
        }
        let temporary = directory.join(format!(
            ".{OPERATION_HISTORY_FILE_NAME}.{}.tmp",
            std::process::id()
        ));
        if fs::File::create(&temporary)
            .and_then(|mut file| {
                file.write_all(&bytes)?;
                file.sync_all()
            })
            .is_ok()
        {
            let _ = fs::rename(temporary, &self.path);
        }
    }
}

impl OperationSnapshotObserver for OperationHistory {
    fn observe(&self, operation: &Operation) {
        {
            let mut operations = self
                .operations
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if let Some(previous) = operations
                .iter_mut()
                .find(|previous| previous.id == operation.id)
            {
                *previous = operation.clone();
            } else {
                operations.push(operation.clone());
            }
        }
        self.prune_and_save();
    }
}

impl OperationSnapshotObserver for ApplicationOperationObserver {
    fn observe(&self, operation: &Operation) {
        self.history.observe(operation);
        if !operation.state.is_terminal() {
            return;
        }
        let mut affected = HashSet::new();
        for source in &operation.sources {
            affected.insert(source.location.clone());
            if let Ok(Some(parent)) = source.location.parent() {
                affected.insert(parent);
            }
        }
        if let Some(destination) = &operation.destination {
            affected.insert(destination.clone());
            if let Ok(Some(parent)) = destination.parent() {
                affected.insert(parent);
            }
        }
        if affected.is_empty() {
            return;
        }
        let directories = self.directories.clone();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                directories.refresh_affected(&affected).await;
            });
        }
    }
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
    ///
    /// Uses [`FallbackPlatformAdapter`]; hosts with real native integration
    /// available should call [`Self::with_platform_adapter`] instead.
    pub fn with_event_bus(
        runtime: RuntimeKindDto,
        workspace_directory: impl Into<PathBuf>,
        settings_directory: impl Into<PathBuf>,
        events: EventBus,
    ) -> Self {
        Self::with_platform_adapter(
            runtime,
            workspace_directory,
            settings_directory,
            events,
            Arc::new(FallbackPlatformAdapter),
        )
    }

    /// Builds a service using a caller-provided event bus and platform
    /// adapter.
    ///
    /// [`Self::runtime_capabilities`] derives its native-integration flags
    /// from `platform`, so the frontend responds to capabilities rather than
    /// detecting the operating system itself (spec §21). Browser/server mode
    /// should pass [`FallbackPlatformAdapter`] (it has no native access to a
    /// remote client's OS); a desktop host should pass a real per-OS adapter
    /// once one exists.
    pub fn with_platform_adapter(
        runtime: RuntimeKindDto,
        workspace_directory: impl Into<PathBuf>,
        settings_directory: impl Into<PathBuf>,
        events: EventBus,
        platform: Arc<dyn PlatformAdapter>,
    ) -> Self {
        let settings_directory = settings_directory.into();
        let mut providers = ProviderRegistry::new();
        providers.register(Arc::new(LocalFileSystemProvider));
        let search_store = Arc::new(SearchResultsStore::new());
        providers.register(Arc::new(SearchFileSystemProvider::new(Arc::clone(
            &search_store,
        ))));
        let settings_store = SettingsStore::new(&settings_directory);
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
        let operation_history = Arc::new(OperationHistory::load(&settings_directory));
        let directories = DirectoryService::with_event_bus(providers.clone(), events.clone());
        let operation_observer = Arc::new(ApplicationOperationObserver {
            history: operation_history.clone(),
            directories: directories.clone(),
        });
        let platform_capabilities = platform.capabilities();
        let search = SearchEngine::new(search_store, events.clone());
        Self {
            runtime,
            platform,
            workspaces: WorkspaceService::new(JsonFileWorkspaceRepository::new(
                workspace_directory,
            )),
            directories,
            providers,
            events: events.clone(),
            settings_store,
            settings: Mutex::new(loaded.settings),
            plugins: PluginDiscovery::new(settings_directory.join("plugins"))
                .with_bundled_directory(
                    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../plugins"),
                ),
            plugin_runtime: PluginRuntime::default(),
            operations: Scheduler::new(operation_concurrency, events)
                .with_observer(operation_observer),
            operation_history,
            operation_idempotency: Mutex::new(HashMap::new()),
            force_cross_volume_moves: AtomicBool::new(false),
            audit_log_path: settings_directory.join("audit.jsonl"),
            actions: ActionRegistry::with_core_actions(platform_capabilities),
            search,
        }
    }

    /// Starts a semantic operation, deduplicating retries by idempotency key.
    pub fn start_operation(
        &self,
        request: StartOperationRequestDto,
        idempotency_key: Option<String>,
    ) -> Result<OperationDto, ApplicationError> {
        if request.conflict_policy == OperationConflictPolicyDto::KeepNewer {
            return Err(ApplicationError::InvalidRequest(
                "keepNewer conflict policy is not supported yet; choose ask, skip, overwrite, or renameNew".into(),
            ));
        }
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
                if request.sources.is_empty() {
                    return Err(ApplicationError::InvalidRequest(
                        "copy requires at least one source".into(),
                    ));
                }
                let destination_directory = destination.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest("copy requires a destination directory".into())
                })?;
                let destination_provider = self
                    .providers
                    .resolve(&destination_directory)
                    .map_err(ApplicationError::from)?;
                destination_provider
                    .capabilities()
                    .require(ProviderCapabilities::WRITE)
                    .map_err(ApplicationError::from)?;
                let mut copies = Vec::new();
                for source_dto in &request.sources {
                    let source: Location = source_dto.clone().into();
                    let source_provider = self
                        .providers
                        .resolve(&source)
                        .map_err(ApplicationError::from)?;
                    source_provider
                        .capabilities()
                        .require(ProviderCapabilities::READ)
                        .map_err(ApplicationError::from)?;
                    copies.push(CopyExecutor {
                        source_provider,
                        destination_provider: Arc::clone(&destination_provider),
                        destination_directory: destination_directory.clone(),
                        temporary: Mutex::new(None),
                        planned: Mutex::new(HashMap::new()),
                        directories: Mutex::new(Vec::new()),
                        symlink_policy: request.symlink_policy,
                        root_name: Mutex::new(None),
                        source_override: Some(source),
                        continue_on_error: true,
                        completed_root_destination: Mutex::new(None),
                    });
                }
                Arc::new(CopyGroupExecutor {
                    copies,
                    stale_sources: Mutex::new(HashMap::new()),
                })
            }
            OperationKindDto::Move => {
                if request.sources.is_empty() {
                    return Err(ApplicationError::InvalidRequest(
                        "move requires at least one source".into(),
                    ));
                }
                let destination_directory = destination.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest("move requires a destination directory".into())
                })?;
                let destination_provider = self
                    .providers
                    .resolve(&destination_directory)
                    .map_err(ApplicationError::from)?;
                let mut moves = Vec::new();
                for source_dto in &request.sources {
                    let source: Location = source_dto.clone().into();
                    let source_provider = self
                        .providers
                        .resolve(&source)
                        .map_err(ApplicationError::from)?;
                    let copy = CopyExecutor {
                        source_provider: Arc::clone(&source_provider),
                        destination_provider: Arc::clone(&destination_provider),
                        destination_directory: destination_directory.clone(),
                        temporary: Mutex::new(None),
                        planned: Mutex::new(HashMap::new()),
                        directories: Mutex::new(Vec::new()),
                        symlink_policy: request.symlink_policy,
                        root_name: Mutex::new(None),
                        source_override: Some(source.clone()),
                        continue_on_error: false,
                        completed_root_destination: Mutex::new(None),
                    };
                    moves.push(MoveExecutor {
                        source,
                        source_provider,
                        destination_provider: Arc::clone(&destination_provider),
                        destination_directory: destination_directory.clone(),
                        copy,
                        fallback: Mutex::new(false),
                        force_fallback: self.force_cross_volume_moves.load(Ordering::Relaxed),
                    });
                }
                Arc::new(MoveGroupExecutor {
                    moves,
                    stale_sources: Mutex::new(HashMap::new()),
                })
            }
            OperationKindDto::Duplicate => {
                if request.sources.is_empty() {
                    return Err(ApplicationError::InvalidRequest(
                        "duplicate requires at least one source".into(),
                    ));
                }
                let mut copies = Vec::new();
                for source_dto in &request.sources {
                    let source: Location = source_dto.clone().into();
                    let parent = source
                        .parent()
                        .map_err(|error| ApplicationError::InvalidRequest(error.to_string()))?
                        .ok_or_else(|| {
                            ApplicationError::InvalidRequest(
                                "cannot duplicate a filesystem root".into(),
                            )
                        })?;
                    let provider = self
                        .providers
                        .resolve(&source)
                        .map_err(ApplicationError::from)?;
                    copies.push(CopyExecutor {
                        source_provider: Arc::clone(&provider),
                        destination_provider: provider,
                        destination_directory: parent,
                        temporary: Mutex::new(None),
                        planned: Mutex::new(HashMap::new()),
                        directories: Mutex::new(Vec::new()),
                        symlink_policy: request.symlink_policy,
                        root_name: Mutex::new(None),
                        source_override: Some(source),
                        continue_on_error: true,
                        completed_root_destination: Mutex::new(None),
                    });
                }
                Arc::new(DuplicateExecutor { copies })
            }
            OperationKindDto::Delete => {
                if request.sources.is_empty() {
                    return Err(ApplicationError::InvalidRequest(
                        "delete requires at least one source".into(),
                    ));
                }
                let requires_confirmation = self
                    .settings
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .confirm_permanent_delete;
                let mut providers = HashMap::new();
                for source in &request.sources {
                    let location: Location = source.clone().into();
                    let provider = self
                        .providers
                        .resolve(&location)
                        .map_err(ApplicationError::from)?;
                    provider
                        .capabilities()
                        .require(ProviderCapabilities::DELETE)
                        .map_err(ApplicationError::from)?;
                    providers.insert(location.provider_id.clone(), provider);
                }
                Arc::new(DeleteExecutor {
                    providers,
                    override_read_only: request.override_read_only,
                    audit_log_path: self.audit_log_path.clone(),
                    deleted: AtomicU64::new(0),
                    audited: AtomicBool::new(false),
                    requires_confirmation: requires_confirmation
                        && !request.permanent_delete_confirmed,
                })
            }
            OperationKindDto::Trash => {
                if request.sources.is_empty() {
                    return Err(ApplicationError::InvalidRequest(
                        "trash requires at least one source".into(),
                    ));
                }
                if !self
                    .platform
                    .capabilities()
                    .contains(PlatformCapabilities::TRASH)
                {
                    return Err(ApplicationError::PlatformOperationFailed(
                        fm_platform::PlatformError::Unsupported {
                            capability: PlatformCapabilities::TRASH,
                        }
                        .to_string(),
                    ));
                }
                Arc::new(TrashExecutor {
                    platform: Arc::clone(&self.platform),
                })
            }
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

    /// Lists active and retained historical operation snapshots.
    #[must_use]
    pub fn list_operations(&self) -> Vec<OperationDto> {
        let mut active = self.operations.list();
        active.retain(|operation| !operation.state.is_terminal());
        let mut queued = active
            .iter()
            .filter(|operation| operation.state == fm_operations::OperationState::Queued)
            .map(|operation| (operation.id, operation.created_at))
            .collect::<Vec<_>>();
        queued.sort_by_key(|(_, created_at)| *created_at);
        let mut result = active
            .into_iter()
            .map(|operation| {
                let queue_position = queued
                    .iter()
                    .position(|(id, _)| *id == operation.id)
                    .and_then(|position| u64::try_from(position + 1).ok());
                operation_dto(operation, queue_position)
            })
            .chain(self.operation_history.list())
            .collect::<Vec<_>>();
        result.sort_by_key(|operation| std::cmp::Reverse(operation.created_at));
        result
    }

    /// Returns a bounded page of active and retained historical operations.
    #[must_use]
    pub fn list_operation_page(
        &self,
        offset: u64,
        limit: u16,
    ) -> fm_transport_dto::OperationPageDto {
        let limit = limit.clamp(1, 100);
        let operations = self.list_operations();
        let total = u64::try_from(operations.len()).unwrap_or(u64::MAX);
        let start = usize::try_from(offset)
            .unwrap_or(usize::MAX)
            .min(operations.len());
        let end = start
            .saturating_add(usize::from(limit))
            .min(operations.len());
        fm_transport_dto::OperationPageDto {
            offset,
            limit,
            total,
            operations: operations[start..end].to_vec(),
        }
    }

    /// Gets one operation snapshot.
    pub fn get_operation(&self, id: OperationId) -> Result<OperationDto, ApplicationError> {
        self.operations
            .get(id)
            .map(|operation| operation_dto(operation, None))
            .map_err(map_scheduler_error)
            .or_else(|error| self.operation_history.get(id).ok_or(error))
    }

    /// Requests cancellation of an operation.
    pub fn cancel_operation(&self, id: OperationId) -> Result<(), ApplicationError> {
        self.operations.cancel(id).map_err(map_scheduler_error)
    }

    /// Forces move's copy/delete fallback for deterministic integration tests.
    #[doc(hidden)]
    pub fn force_cross_volume_moves_for_tests(&self, force: bool) {
        self.force_cross_volume_moves
            .store(force, Ordering::Relaxed);
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
        let resolution = match request.resolution {
            ConflictResolutionDto::Skip => ConflictResolution::Skip,
            ConflictResolutionDto::Overwrite | ConflictResolutionDto::Confirm => {
                ConflictResolution::Overwrite
            }
            ConflictResolutionDto::RenameNew => ConflictResolution::RenameNew,
            ConflictResolutionDto::CancelOperation => unreachable!("handled above"),
        };
        self.operations
            .resolve_conflict(id, resolution, request.apply_to_all_similar)
            .map_err(map_scheduler_error)
    }

    /// Lists every registered action (spec §18).
    #[must_use]
    pub fn list_actions(&self) -> Vec<ActionDescriptorDto> {
        let mut actions = self.actions.list();
        for (manifest, directory) in self.enabled_plugin_manifests() {
            match self.plugin_runtime.actions(&manifest, &directory) {
                Ok(contributions) => actions.extend(
                    contributions
                        .into_iter()
                        .map(|action| plugin_action_descriptor(&manifest, action)),
                ),
                Err(error) => {
                    self.events.publish(
                        EventAudience::Global,
                        BackendEventPayload::NotificationCreated {
                            notification: NotificationPayload {
                                id: Uuid::new_v4().to_string(),
                                level: NotificationLevelPayload::Warning,
                                message: format!("Plugin {} was isolated: {error}", manifest.id),
                            },
                        },
                    );
                }
            }
        }
        actions.sort_by(|left, right| left.id.cmp(&right.id));
        actions.into_iter().map(Into::into).collect()
    }

    /// Manifests and directories of every plugin that is both valid and
    /// enabled (spec §18/§19). Shared by [`Self::list_actions`] and plugin
    /// action dispatch in [`Self::invoke_action`] so both agree on which
    /// plugins are eligible to contribute actions.
    fn enabled_plugin_manifests(&self) -> Vec<(PluginManifest, PathBuf)> {
        let enabled = self
            .settings
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .enabled_plugins
            .clone();
        self.plugins
            .discover()
            .into_iter()
            .filter_map(|plugin| {
                let manifest = plugin.manifest?;
                enabled
                    .contains(&manifest.id)
                    .then_some((manifest, plugin.directory))
            })
            .collect()
    }

    /// Finds an enabled plugin's action contribution by id, along with the
    /// manifest and directory needed to invoke it (spec §18/§20).
    fn find_plugin_action(
        &self,
        action_id: &ActionId,
    ) -> Option<(PluginManifest, PathBuf, ActionDescriptor)> {
        self.enabled_plugin_manifests()
            .into_iter()
            .find_map(|(manifest, directory)| {
                let contributions = self.plugin_runtime.actions(&manifest, &directory).ok()?;
                let action = contributions
                    .into_iter()
                    .find(|action| action.id == action_id.as_str())?;
                let descriptor = plugin_action_descriptor(&manifest, action);
                Some((manifest, directory, descriptor))
            })
    }

    /// Runs a plugin's `invoke(action_id)` entrypoint with the caller-supplied
    /// selection (spec §20). The caller (frontend) already knows the current
    /// selection's name and file URI, so it is passed directly as invocation
    /// parameters rather than requiring the backend to resolve an
    /// [`fm_domain::EntryId`] back to metadata.
    fn invoke_plugin_action(
        &self,
        action_id: &ActionId,
        manifest: &PluginManifest,
        directory: &Path,
        parameters: Option<serde_json::Value>,
    ) -> Result<ActionResultDto, ApplicationError> {
        let selection = parameters
            .map(serde_json::from_value::<PluginActionParametersDto>)
            .transpose()
            .map_err(|error| {
                ApplicationError::InvalidRequest(format!("invalid action parameters: {error}"))
            })?
            .unwrap_or_default()
            .selected_entries;

        match self
            .plugin_runtime
            .invoke_action(manifest, directory, action_id.as_str(), &selection)
        {
            Ok(outcome) => {
                if outcome.clipboard_text.is_some() {
                    self.events.publish(
                        EventAudience::Global,
                        BackendEventPayload::NotificationCreated {
                            notification: NotificationPayload {
                                id: Uuid::new_v4().to_string(),
                                level: NotificationLevelPayload::Info,
                                message: "Copied to clipboard.".to_owned(),
                            },
                        },
                    );
                }
                Ok(ActionResultDto {
                    action_id: action_id.as_str().to_owned(),
                    invoked: true,
                    operation_id: None,
                    clipboard_text: outcome.clipboard_text,
                })
            }
            Err(error) => Err(ApplicationError::InvalidRequest(format!(
                "plugin action {action_id:?} failed: {error}"
            ))),
        }
    }

    /// Lists discovered plugins, retaining malformed manifests as disabled records.
    #[must_use]
    pub fn list_plugins(&self) -> Vec<fm_transport_dto::PluginDescriptorDto> {
        let enabled = self
            .settings
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .enabled_plugins
            .clone();
        self.plugins
            .discover()
            .into_iter()
            .map(|plugin| {
                let id = plugin.id();
                let (name, version, description) = plugin.manifest.as_ref().map_or_else(
                    || (id.clone(), String::new(), String::new()),
                    |manifest| {
                        (
                            manifest.name.clone(),
                            manifest.version.clone(),
                            manifest.description.clone(),
                        )
                    },
                );
                let columns =
                    if plugin.is_valid() && enabled.contains(&id) {
                        match plugin.manifest.as_ref().map(|manifest| {
                            self.plugin_runtime.columns(manifest, &plugin.directory)
                        }) {
                            Some(Ok(columns)) => columns
                                .into_iter()
                                .map(|column| fm_transport_dto::PluginColumnDto {
                                    id: column.id,
                                    title: column.title,
                                })
                                .collect(),
                            Some(Err(error)) => {
                                self.events.publish(
                                    EventAudience::Global,
                                    BackendEventPayload::NotificationCreated {
                                        notification: NotificationPayload {
                                            id: Uuid::new_v4().to_string(),
                                            level: NotificationLevelPayload::Warning,
                                            message: format!("Plugin {id} was isolated: {error}"),
                                        },
                                    },
                                );
                                Vec::new()
                            }
                            None => Vec::new(),
                        }
                    } else {
                        Vec::new()
                    };
                let runtime_diagnostic = self.plugin_runtime.disabled_reason(&id);
                let permissions = plugin
                    .manifest
                    .as_ref()
                    .map(|manifest| plugin_permissions_dto(&manifest.permissions))
                    .unwrap_or_default();
                fm_transport_dto::PluginDescriptorDto {
                    enabled: plugin.is_valid()
                        && enabled.contains(&id)
                        && runtime_diagnostic.is_none(),
                    id,
                    name,
                    version,
                    description,
                    diagnostic: plugin.diagnostic.or(runtime_diagnostic),
                    columns,
                    permissions,
                }
            })
            .collect()
    }

    /// Returns the bounded diagnostic log retained for one plugin (spec §19.4).
    pub fn plugin_logs(&self, plugin_id: &str) -> Result<Vec<PluginLogEntryDto>, ApplicationError> {
        let exists = self
            .plugins
            .discover()
            .into_iter()
            .any(|plugin| plugin.id() == plugin_id);
        if !exists {
            return Err(ApplicationError::NotFound);
        }
        Ok(self
            .plugin_runtime
            .logs(plugin_id)
            .into_iter()
            .map(|entry| PluginLogEntryDto {
                message: entry.message,
            })
            .collect())
    }

    /// Persists a plugin enablement decision after confirming its manifest is valid.
    pub fn set_plugin_enabled(
        &self,
        plugin_id: String,
        enabled: bool,
    ) -> Result<(), ApplicationError> {
        let plugin = self
            .plugins
            .discover()
            .into_iter()
            .find(|plugin| plugin.is_valid() && plugin.id() == plugin_id);
        let Some(plugin) = plugin else {
            return Err(ApplicationError::NotFound);
        };
        let manifest = plugin
            .manifest
            .as_ref()
            .expect("validated plugin has a manifest");
        let mut settings = self
            .settings
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        settings.enabled_plugins.retain(|id| id != &plugin_id);
        if enabled {
            self.plugin_runtime.reenable(&plugin_id);
            settings.enabled_plugins.push(plugin_id.clone());
            settings.enabled_plugins.sort();
        }
        self.settings_store
            .save(&settings)
            .map_err(|_| ApplicationError::Internal)?;
        self.events.publish(
            EventAudience::Global,
            BackendEventPayload::PluginChanged {
                plugin: PluginPayload {
                    id: PluginId::new(plugin_id),
                    name: manifest.name.clone(),
                    version: manifest.version.clone(),
                    enabled,
                },
            },
        );
        Ok(())
    }

    /// Invokes a registered action, re-validating its context requirements
    /// server-side and delegating file-mutating actions to the operation
    /// engine (spec §18). Never panics: an unknown or unavailable action is
    /// reported as a typed [`ApplicationError`].
    pub fn invoke_action(
        &self,
        action_id: String,
        request: InvokeActionRequestDto,
        idempotency_key: Option<String>,
    ) -> Result<ActionResultDto, ApplicationError> {
        let action_id = ActionId::new(action_id);
        let context = request.context.into();

        if let Some((manifest, directory, descriptor)) = self.find_plugin_action(&action_id) {
            if !descriptor.context_requirements.is_satisfied_by(&context) {
                return Err(ApplicationError::ActionUnavailable(action_id));
            }
            return self.invoke_plugin_action(
                &action_id,
                &manifest,
                &directory,
                request.parameters,
            );
        }

        self.actions.require_available(&action_id, &context)?;

        if let Some(kind) = platform_action_kind(&action_id) {
            return self.invoke_platform_action(&action_id, kind, request.parameters);
        }

        let Some(operation_type) = mutating_operation_kind(&action_id) else {
            return Ok(ActionResultDto {
                action_id: action_id.as_str().to_owned(),
                invoked: true,
                operation_id: None,
                clipboard_text: None,
            });
        };
        let parameters = request.parameters.ok_or_else(|| {
            ApplicationError::InvalidRequest(format!(
                "action {action_id:?} requires parameters describing the operation"
            ))
        })?;
        let mut operation_request: StartOperationRequestDto = serde_json::from_value(parameters)
            .map_err(|error| {
                ApplicationError::InvalidRequest(format!("invalid action parameters: {error}"))
            })?;
        operation_request.operation_type = operation_type;
        let operation = self.start_operation(operation_request, idempotency_key)?;
        Ok(ActionResultDto {
            action_id: action_id.as_str().to_owned(),
            invoked: true,
            operation_id: Some(operation.id),
            clipboard_text: None,
        })
    }

    /// Dispatches `core.open`/`core.openWith`/`core.revealInSystemFileManager`/
    /// `core.openTerminal` directly to the injected platform adapter (task
    /// 0061), rather than through the operation engine.
    ///
    /// The backend cannot resolve an opaque [`fm_domain::EntryId`] back to a
    /// path (there is no entry registry, mirroring plugin action invocation,
    /// task 0055): the caller already holds the target's [`Location`] and
    /// passes it explicitly as a `{ "uri": "file:///..." }` parameter. The
    /// URI is parsed with [`Location::parse`]/[`Location::to_native_path`]
    /// (never hand-built or shell-interpolated), so paths containing spaces,
    /// quotes or Unicode round-trip safely.
    fn invoke_platform_action(
        &self,
        action_id: &ActionId,
        kind: PlatformActionKind,
        parameters: Option<serde_json::Value>,
    ) -> Result<ActionResultDto, ApplicationError> {
        let uri = parameters
            .as_ref()
            .and_then(|value| value.get("uri"))
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                ApplicationError::InvalidRequest(format!(
                    "action {action_id:?} requires a `uri` string parameter"
                ))
            })?;
        let path = Location::parse(uri)
            .and_then(|location| location.to_native_path())
            .map_err(|error| {
                ApplicationError::InvalidRequest(format!("invalid `uri` parameter: {error}"))
            })?;

        let result = match kind {
            PlatformActionKind::Open => self.platform.open_with_default_application(&path),
            PlatformActionKind::Reveal => self.platform.reveal_in_file_manager(&path),
            PlatformActionKind::OpenTerminal => {
                let command_override = self
                    .settings
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .terminal_command
                    .clone();
                self.platform
                    .open_terminal(&path, command_override.as_deref())
            }
        };
        result.map_err(|error| map_platform_error(action_id, error))?;

        Ok(ActionResultDto {
            action_id: action_id.as_str().to_owned(),
            invoked: true,
            operation_id: None,
            clipboard_text: None,
        })
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

    /// Re-publishes unresolved conflicts when a transport reconnects.
    pub fn republish_pending_operation_conflicts(&self) {
        self.operations.republish_pending_conflicts();
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

    /// Starts a cancellable recursive filename search over one or more
    /// roots, streaming matches to `request.workspace_id` over the event
    /// bus as they are found (spec §24, task 0068).
    pub fn start_search(
        &self,
        request: StartSearchRequestDto,
    ) -> Result<StartSearchResponseDto, ApplicationError> {
        let roots: Vec<Location> = request.roots.into_iter().map(Into::into).collect();
        let (search_id, location) = self
            .search
            .start(
                roots,
                request.query,
                EventAudience::Workspace(request.workspace_id.into()),
            )
            .map_err(|error| ApplicationError::InvalidRequest(error.to_string()))?;
        Ok(StartSearchResponseDto {
            search_id,
            location: location.into(),
        })
    }

    /// Cancels a running search, stopping its traversal promptly.
    pub fn cancel_search(&self, search_id: Uuid) -> Result<(), ApplicationError> {
        self.search
            .cancel(search_id)
            .map_err(|_| ApplicationError::NotFound)
    }

    /// Reports which capabilities are available for the current runtime and
    /// platform, so the frontend can respond to capabilities rather than
    /// detecting operating systems itself (spec §21).
    pub fn runtime_capabilities(&self) -> RuntimeCapabilitiesDto {
        let capabilities = self.platform.capabilities();
        RuntimeCapabilitiesDto {
            runtime: self.runtime,
            platform: detect_platform(),
            native_menus: capabilities.contains(PlatformCapabilities::NATIVE_MENUS),
            native_file_icons: capabilities.contains(PlatformCapabilities::FILE_ICONS),
            native_thumbnails: capabilities.contains(PlatformCapabilities::THUMBNAILS),
            native_drag_out: capabilities.contains(PlatformCapabilities::NATIVE_DRAG_OUT),
            system_trash: capabilities.contains(PlatformCapabilities::TRASH),
            reveal_in_system_file_manager: capabilities
                .contains(PlatformCapabilities::REVEAL_IN_FILE_MANAGER),
            open_terminal: capabilities.contains(PlatformCapabilities::OPEN_TERMINAL),
            // Basic text/data clipboard access works through the browser
            // Clipboard API without any native bridge, on every host. This is
            // deliberately not derived from `PlatformCapabilities::
            // CLIPBOARD_FILE_REFERENCES`, which instead gates pasting actual
            // file path lists (e.g. from Finder/Explorer) - a capability
            // `RuntimeCapabilitiesDto` has no field for yet. A future task
            // adding file-reference paste support should add one rather than
            // overload this flag.
            clipboard: true,
            plugins: true,
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

#[derive(Clone)]
struct PlannedCopyEntry {
    kind: EntryKind,
    destination: Location,
    source: EntryRef,
    is_root: bool,
}

struct CopyExecutor {
    source_provider: Arc<dyn FileSystemProvider>,
    destination_provider: Arc<dyn FileSystemProvider>,
    destination_directory: fm_domain::Location,
    temporary: Mutex<Option<fm_domain::Location>>,
    planned: Mutex<HashMap<String, PlannedCopyEntry>>,
    directories: Mutex<Vec<(EntryRef, EntryRef)>>,
    symlink_policy: fm_transport_dto::SymlinkPolicyDto,
    root_name: Mutex<Option<String>>,
    source_override: Option<Location>,
    continue_on_error: bool,
    completed_root_destination: Mutex<Option<Location>>,
}

struct CopyGroupExecutor {
    copies: Vec<CopyExecutor>,
    stale_sources: Mutex<HashMap<String, EntryRef>>,
}

struct DuplicateExecutor {
    copies: Vec<CopyExecutor>,
}

struct DeleteExecutor {
    providers: HashMap<fm_domain::ProviderId, Arc<dyn FileSystemProvider>>,
    override_read_only: bool,
    audit_log_path: PathBuf,
    deleted: AtomicU64,
    audited: AtomicBool,
    requires_confirmation: bool,
}

impl DeleteExecutor {
    async fn write_audit(&self, operation: &Operation) -> Result<(), ExecutionError> {
        if self.audited.load(Ordering::Acquire) {
            return Ok(());
        }
        if let Some(parent) = self.audit_log_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(copy_stream_error)?;
        }
        let record = serde_json::json!({
            "timestamp": chrono::Utc::now(),
            "operationId": operation.id.to_string(),
            "kind": "permanentDelete",
            "sources": operation.sources.iter().map(|entry| &entry.location.uri).collect::<Vec<_>>(),
            "deletedItems": self.deleted.load(Ordering::Acquire),
        });
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.audit_log_path)
            .await
            .map_err(copy_stream_error)?;
        file.write_all(format!("{record}\n").as_bytes())
            .await
            .map_err(copy_stream_error)?;
        self.audited.store(true, Ordering::Release);
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for DeleteExecutor {
    fn requires_confirmation(&self) -> bool {
        self.requires_confirmation
    }
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let mut items = Vec::new();
        for source in &operation.sources {
            let provider = self
                .providers
                .get(&source.location.provider_id)
                .ok_or_else(|| ExecutionError::Failed("delete provider is missing".into()))?;
            let root = provider.inspect(source, cancellation.clone()).await?;
            let mut stack = vec![(root, false)];
            while let Some((summary, visited)) = stack.pop() {
                if cancellation.is_cancelled() {
                    return Err(fm_vfs::VfsError::Cancelled.into());
                }
                if summary.read_only && !self.override_read_only {
                    return Err(ExecutionError::Failed(format!(
                        "read-only entry requires explicit override: {}",
                        summary.location.uri
                    )));
                }
                let entry = EntryRef {
                    id: summary.id,
                    location: summary.location.clone(),
                };
                if summary.kind == EntryKind::Directory && !visited {
                    stack.push((summary.clone(), true));
                    let mut continuation_token = None;
                    loop {
                        let page = provider
                            .list(
                                &summary.location,
                                fm_vfs::ListOptions {
                                    page_size: 512,
                                    continuation_token,
                                },
                                cancellation.clone(),
                            )
                            .await?;
                        for child in page.entries.into_iter().rev() {
                            stack.push((child, false));
                        }
                        if !page.has_more {
                            break;
                        }
                        continuation_token = page.continuation_token;
                    }
                } else {
                    items.push(PlanItem::new(entry, summary.size.unwrap_or(0)));
                }
            }
        }
        Ok(OperationPlan::new(items))
    }

    async fn execute(
        &self,
        _operation: &Operation,
        item: &PlanItem,
        _resolution: Option<fm_operations::ConflictResolution>,
        _pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<fm_operations::ExecutionOutcome, ExecutionError> {
        let provider = self
            .providers
            .get(&item.entry.location.provider_id)
            .ok_or_else(|| ExecutionError::Failed("delete provider is missing".into()))?;
        match provider
            .remove(
                &item.entry,
                fm_vfs::RemoveOptions {
                    recursive: false,
                    use_trash: false,
                },
                cancellation.clone(),
            )
            .await
        {
            Ok(()) => {
                self.deleted.fetch_add(1, Ordering::Relaxed);
                Ok(ExecutionOutcome::Completed)
            }
            Err(error) => Err(ExecutionError::Warning {
                entry: item.entry.clone(),
                message: error.to_string(),
            }),
        }
    }

    async fn cleanup_partial(&self, operation: &Operation) -> Result<(), ExecutionError> {
        self.write_audit(operation).await
    }

    async fn finish(
        &self,
        operation: &Operation,
        _cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        self.write_audit(operation).await
    }
}

/// Moves entries to the platform trash (task 0043). Unlike [`DeleteExecutor`],
/// this bypasses [`FileSystemProvider`] entirely: the platform adapter
/// natively relocates the whole entry (file or directory tree) in one call,
/// mirroring how `core.open`/`core.revealInSystemFileManager` dispatch
/// directly to `self.platform` (task 0061). Trash is reversible, so unlike
/// permanent delete there is no mandatory confirmation, read-only override,
/// or audit log.
struct TrashExecutor {
    platform: Arc<dyn PlatformAdapter>,
}

#[async_trait]
impl OperationExecutor for TrashExecutor {
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
        item: &PlanItem,
        _resolution: Option<fm_operations::ConflictResolution>,
        _pause: &PauseToken,
        _cancellation: &CancellationToken,
    ) -> Result<fm_operations::ExecutionOutcome, ExecutionError> {
        let path = item
            .entry
            .location
            .to_native_path()
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        self.platform
            .trash(&path)
            .map_err(|error| ExecutionError::Warning {
                entry: item.entry.clone(),
                message: error.to_string(),
            })?;
        Ok(ExecutionOutcome::Completed)
    }

    async fn cleanup_partial(&self, _operation: &Operation) -> Result<(), ExecutionError> {
        Ok(())
    }
}

struct MoveExecutor {
    source: Location,
    source_provider: Arc<dyn FileSystemProvider>,
    destination_provider: Arc<dyn FileSystemProvider>,
    destination_directory: Location,
    copy: CopyExecutor,
    fallback: Mutex<bool>,
    force_fallback: bool,
}

struct MoveGroupExecutor {
    moves: Vec<MoveExecutor>,
    stale_sources: Mutex<HashMap<String, EntryRef>>,
}

#[async_trait]
impl OperationExecutor for CopyGroupExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let mut items = Vec::new();
        for executor in &self.copies {
            match executor.plan(operation, cancellation).await {
                Ok(plan) => items.extend(plan.items),
                Err(ExecutionError::Provider(fm_vfs::VfsError::NotFound { .. })) => {
                    let source = executor.source_override.clone().ok_or_else(|| {
                        ExecutionError::Failed("copy source is missing from its plan".into())
                    })?;
                    let entry = EntryRef {
                        id: fm_domain::EntryId::new(),
                        location: source,
                    };
                    self.stale_sources
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(entry.location.uri.clone(), entry.clone());
                    items.push(PlanItem::new(entry, 0));
                }
                Err(error) => return Err(error),
            }
        }
        Ok(OperationPlan::new(items))
    }

    async fn execute(
        &self,
        operation: &Operation,
        item: &PlanItem,
        resolution: Option<fm_operations::ConflictResolution>,
        pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<fm_operations::ExecutionOutcome, ExecutionError> {
        if self
            .stale_sources
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(&item.entry.location.uri)
        {
            return Err(ExecutionError::Warning {
                entry: item.entry.clone(),
                message: "Source no longer exists; skipped.".into(),
            });
        }
        for executor in &self.copies {
            if executor
                .planned
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .contains_key(&item.entry.location.uri)
            {
                return executor
                    .execute(operation, item, resolution, pause, cancellation)
                    .await;
            }
        }
        Err(ExecutionError::Failed("copy plan entry is missing".into()))
    }

    async fn cleanup_partial(&self, operation: &Operation) -> Result<(), ExecutionError> {
        for executor in &self.copies {
            executor.cleanup_partial(operation).await?;
        }
        Ok(())
    }

    async fn finish(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        for executor in &self.copies {
            executor.finish(operation, cancellation).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for MoveGroupExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let mut items = Vec::new();
        for executor in &self.moves {
            match executor.plan(operation, cancellation).await {
                Ok(plan) => items.extend(plan.items),
                Err(ExecutionError::Provider(fm_vfs::VfsError::NotFound { .. })) => {
                    let entry = EntryRef {
                        id: fm_domain::EntryId::new(),
                        location: executor.source.clone(),
                    };
                    self.stale_sources
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(entry.location.uri.clone(), entry.clone());
                    items.push(PlanItem::new(entry, 0));
                }
                Err(error) => return Err(error),
            }
        }
        Ok(OperationPlan::new(items))
    }

    async fn execute(
        &self,
        operation: &Operation,
        item: &PlanItem,
        resolution: Option<fm_operations::ConflictResolution>,
        pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<fm_operations::ExecutionOutcome, ExecutionError> {
        if self
            .stale_sources
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(&item.entry.location.uri)
        {
            return Err(ExecutionError::Warning {
                entry: item.entry.clone(),
                message: "Source no longer exists; skipped.".into(),
            });
        }
        for executor in &self.moves {
            if item.entry.location == executor.source
                || executor
                    .copy
                    .planned
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .contains_key(&item.entry.location.uri)
            {
                return executor
                    .execute(operation, item, resolution, pause, cancellation)
                    .await;
            }
        }
        Err(ExecutionError::Failed("move plan entry is missing".into()))
    }

    async fn cleanup_partial(&self, operation: &Operation) -> Result<(), ExecutionError> {
        for executor in &self.moves {
            executor.cleanup_partial(operation).await?;
        }
        Ok(())
    }

    async fn finish(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        for executor in &self.moves {
            executor.finish(operation, cancellation).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for DuplicateExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let mut items = Vec::new();
        for copy in &self.copies {
            let source_location = copy
                .source_override
                .as_ref()
                .ok_or_else(|| ExecutionError::Failed("duplicate source is missing".into()))?;
            let source_name = source_location
                .name()
                .map_err(|error| ExecutionError::Failed(error.to_string()))?;
            let mut index = 1_u32;
            loop {
                let candidate = fm_operations::duplicate_name(&source_name, index);
                let destination = copy
                    .destination_directory
                    .join(&candidate)
                    .map_err(|error| ExecutionError::Failed(error.to_string()))?;
                let probe = EntryRef {
                    id: fm_domain::EntryId::new(),
                    location: destination,
                };
                match copy
                    .destination_provider
                    .inspect(&probe, cancellation.clone())
                    .await
                {
                    Err(fm_vfs::VfsError::NotFound { .. }) => {
                        *copy.root_name.lock().unwrap_or_else(|e| e.into_inner()) = Some(candidate);
                        break;
                    }
                    Ok(_) => index = index.saturating_add(1),
                    Err(error) => return Err(error.into()),
                }
            }
            items.extend(copy.plan(operation, cancellation).await?.items);
        }
        Ok(OperationPlan::new(items))
    }

    async fn execute(
        &self,
        operation: &Operation,
        item: &PlanItem,
        resolution: Option<fm_operations::ConflictResolution>,
        pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<fm_operations::ExecutionOutcome, ExecutionError> {
        for copy in &self.copies {
            if copy
                .planned
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .contains_key(&item.entry.location.uri)
            {
                return copy
                    .execute(operation, item, resolution, pause, cancellation)
                    .await;
            }
        }
        Err(ExecutionError::Failed(
            "duplicate plan entry is missing".into(),
        ))
    }

    async fn cleanup_partial(&self, operation: &Operation) -> Result<(), ExecutionError> {
        for copy in &self.copies {
            copy.cleanup_partial(operation).await?;
        }
        Ok(())
    }

    async fn finish(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        for copy in &self.copies {
            copy.finish(operation, cancellation).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for MoveExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let source = EntryRef {
            id: fm_domain::EntryId::new(),
            location: self.source.clone(),
        };
        let name = source
            .location
            .name()
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        let destination = self
            .destination_directory
            .join(&name)
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        fm_operations::validate_paths(&source.location, &destination, cfg!(not(windows)))
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        let same_provider = self.source_provider.id() == self.destination_provider.id();
        let same_filesystem = !self.force_fallback
            && same_provider
            && self
                .source_provider
                .same_filesystem(&source, &self.destination_directory, cancellation.clone())
                .await?;
        *self.fallback.lock().unwrap_or_else(|e| e.into_inner()) = !same_filesystem;
        if same_filesystem {
            Ok(OperationPlan::new(vec![PlanItem::new(source, 0)]))
        } else {
            self.copy.plan(operation, cancellation).await
        }
    }

    async fn execute(
        &self,
        operation: &Operation,
        item: &PlanItem,
        resolution: Option<fm_operations::ConflictResolution>,
        pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<fm_operations::ExecutionOutcome, ExecutionError> {
        if *self.fallback.lock().unwrap_or_else(|e| e.into_inner()) {
            return self
                .copy
                .execute(operation, item, resolution, pause, cancellation)
                .await;
        }
        let name = item
            .entry
            .location
            .name()
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        let mut destination = self
            .destination_directory
            .join(&name)
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        let destination_entry = EntryRef {
            id: fm_domain::EntryId::new(),
            location: destination.clone(),
        };
        if let Ok(existing) = self
            .destination_provider
            .inspect(&destination_entry, cancellation.clone())
            .await
        {
            let source = self
                .source_provider
                .inspect(&item.entry, cancellation.clone())
                .await?;
            if source.kind != existing.kind {
                return Err(ExecutionError::Failed(
                    "a file and directory cannot replace one another".into(),
                ));
            }
            match effective_resolution(operation.conflict_policy, resolution) {
                None => return Err(conflict_error(&source, &existing)),
                Some(ConflictResolution::Skip) => return Ok(ExecutionOutcome::Skipped),
                Some(ConflictResolution::Overwrite) => {
                    self.destination_provider
                        .remove(
                            &destination_entry,
                            fm_vfs::RemoveOptions {
                                recursive: existing.kind == EntryKind::Directory,
                                use_trash: false,
                            },
                            cancellation.clone(),
                        )
                        .await?;
                }
                Some(ConflictResolution::RenameNew) => {
                    destination = self
                        .copy
                        .next_copy_destination(&destination, cancellation)
                        .await?;
                }
            }
        }
        self.source_provider
            .rename(&item.entry, &destination, cancellation.clone())
            .await?;
        Ok(ExecutionOutcome::Completed)
    }

    async fn cleanup_partial(&self, operation: &Operation) -> Result<(), ExecutionError> {
        self.copy.cleanup_partial(operation).await
    }

    async fn finish(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        if !*self.fallback.lock().unwrap_or_else(|e| e.into_inner()) {
            return Ok(());
        }
        self.copy.finish(operation, cancellation).await?;
        if cancellation.is_cancelled() {
            return Ok(());
        }
        let source = EntryRef {
            id: fm_domain::EntryId::new(),
            location: self.source.clone(),
        };
        let Some(destination) = self
            .copy
            .completed_root_destination
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        else {
            return Ok(());
        };
        self.destination_provider
            .inspect(
                &EntryRef {
                    id: fm_domain::EntryId::new(),
                    location: destination,
                },
                cancellation.clone(),
            )
            .await?;
        self.source_provider
            .remove(
                &source,
                fm_vfs::RemoveOptions {
                    recursive: true,
                    use_trash: false,
                },
                cancellation.clone(),
            )
            .await?;
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for CopyExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let source = if let Some(location) = &self.source_override {
            EntryRef {
                id: fm_domain::EntryId::new(),
                location: location.clone(),
            }
        } else {
            operation
                .sources
                .first()
                .cloned()
                .ok_or_else(|| ExecutionError::Failed("copy source is missing".into()))?
        };
        let summary = self
            .source_provider
            .inspect(&source, cancellation.clone())
            .await?;
        let root_name = self
            .root_name
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .unwrap_or(summary.name.clone());
        let root_destination = self
            .destination_directory
            .join(&root_name)
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        fm_operations::validate_paths(&source.location, &root_destination, cfg!(not(windows)))
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        let root_source_uri = source.location.uri.clone();
        let mut stack = vec![(summary, root_destination)];
        let mut items = Vec::new();
        let mut planned = HashMap::new();
        let mut directories = Vec::new();
        let mut followed_directories = HashSet::new();
        while let Some((summary, destination)) = stack.pop() {
            if cancellation.is_cancelled() {
                return Err(fm_vfs::VfsError::Cancelled.into());
            }
            let plan_entry = EntryRef {
                id: summary.id,
                location: summary.location.clone(),
            };
            let (summary, followed_target) = if summary.kind == EntryKind::Symlink
                && self.symlink_policy == fm_transport_dto::SymlinkPolicyDto::CopyTarget
            {
                let target = self
                    .source_provider
                    .resolve_symlink(&plan_entry, cancellation.clone())
                    .await?;
                if target.kind == EntryKind::Directory && !followed_directories.insert(target.id) {
                    continue;
                }
                (target, true)
            } else {
                (summary, false)
            };
            if summary.kind == EntryKind::Directory
                && !followed_target
                && self.symlink_policy == fm_transport_dto::SymlinkPolicyDto::CopyTarget
            {
                followed_directories.insert(summary.id);
            }
            let source_entry = EntryRef {
                id: summary.id,
                location: summary.location.clone(),
            };
            let bytes = summary.size.unwrap_or(0);
            planned.insert(
                plan_entry.location.uri.clone(),
                PlannedCopyEntry {
                    kind: summary.kind,
                    destination: destination.clone(),
                    source: source_entry.clone(),
                    is_root: plan_entry.location.uri == root_source_uri,
                },
            );
            items.push(PlanItem::new(plan_entry, bytes));
            if summary.kind == EntryKind::Directory {
                directories.push((
                    source_entry,
                    EntryRef {
                        id: fm_domain::EntryId::new(),
                        location: destination.clone(),
                    },
                ));
                let mut continuation_token = None;
                loop {
                    let page = self
                        .source_provider
                        .list(
                            &summary.location,
                            fm_vfs::ListOptions {
                                page_size: 512,
                                continuation_token,
                            },
                            cancellation.clone(),
                        )
                        .await?;
                    for child in page.entries.into_iter().rev() {
                        let child_destination = destination
                            .join(&child.name)
                            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
                        stack.push((child, child_destination));
                    }
                    if !page.has_more {
                        break;
                    }
                    continuation_token = page.continuation_token;
                }
            }
        }
        *self.planned.lock().unwrap_or_else(|e| e.into_inner()) = planned;
        *self.directories.lock().unwrap_or_else(|e| e.into_inner()) = directories;
        Ok(OperationPlan::new(items))
    }

    async fn execute(
        &self,
        operation: &Operation,
        item: &PlanItem,
        resolution: Option<fm_operations::ConflictResolution>,
        pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<fm_operations::ExecutionOutcome, ExecutionError> {
        let mut planned = self
            .planned
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&item.entry.location.uri)
            .cloned()
            .ok_or_else(|| ExecutionError::Failed("copy plan entry is missing".into()))?;
        let destination_entry = EntryRef {
            id: fm_domain::EntryId::new(),
            location: planned.destination.clone(),
        };
        let mut reuse_destination_directory = false;
        if let Ok(destination) = self
            .destination_provider
            .inspect(&destination_entry, cancellation.clone())
            .await
        {
            let source = self
                .source_provider
                .inspect(&planned.source, cancellation.clone())
                .await?;
            if source.kind != destination.kind {
                return Err(ExecutionError::Failed(
                    "a file and directory cannot replace one another".into(),
                ));
            }
            match effective_resolution(operation.conflict_policy, resolution) {
                None => return Err(conflict_error(&source, &destination)),
                Some(ConflictResolution::Skip) => return Ok(ExecutionOutcome::Skipped),
                Some(ConflictResolution::Overwrite) => {
                    if planned.kind == EntryKind::Directory {
                        reuse_destination_directory = true;
                    }
                    if planned.kind != EntryKind::File && !reuse_destination_directory {
                        self.destination_provider
                            .remove(
                                &destination_entry,
                                fm_vfs::RemoveOptions {
                                    recursive: planned.kind == EntryKind::Directory,
                                    use_trash: false,
                                },
                                cancellation.clone(),
                            )
                            .await?;
                    }
                }
                Some(ConflictResolution::RenameNew) => {
                    let renamed = self
                        .next_copy_destination(&planned.destination, cancellation)
                        .await?;
                    if planned.is_root && planned.kind == EntryKind::Directory {
                        self.rebase_planned_destinations(&planned.destination, &renamed);
                    }
                    planned.destination = renamed;
                }
            }
        }
        let result = if reuse_destination_directory {
            Ok(ExecutionOutcome::Completed)
        } else if planned.kind == EntryKind::Directory {
            let parent = planned
                .destination
                .parent()
                .map_err(|error| ExecutionError::Failed(error.to_string()))?
                .ok_or_else(|| ExecutionError::Failed("copy destination has no parent".into()))?;
            let name = planned
                .destination
                .name()
                .map_err(|error| ExecutionError::Failed(error.to_string()))?;
            self.destination_provider
                .create_directory(&parent, &name, cancellation.clone())
                .await
                .map(|_| ExecutionOutcome::Completed)
                .map_err(ExecutionError::from)
        } else if planned.kind == EntryKind::Symlink {
            self.destination_provider
                .copy_symlink(&item.entry, &planned.destination, cancellation.clone())
                .await
                .map(|_| ExecutionOutcome::Completed)
                .map_err(ExecutionError::from)
        } else {
            let source_item = PlanItem::new(planned.source.clone(), item.bytes);
            self.copy_file(
                operation,
                &source_item,
                &planned.destination,
                resolution,
                pause,
                cancellation,
            )
            .await
        };
        let outcome = match result {
            Err(error) if self.continue_on_error && !planned.is_root => {
                Err(ExecutionError::Warning {
                    entry: item.entry.clone(),
                    message: error.to_string(),
                })
            }
            other => other,
        };
        if outcome.is_ok() && planned.is_root {
            *self
                .completed_root_destination
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(planned.destination);
        }
        outcome
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

    async fn finish(
        &self,
        _operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        let mut directories = self
            .directories
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        directories.reverse();
        for (source, destination) in directories {
            self.destination_provider
                .preserve_metadata(&source, &destination, cancellation.clone())
                .await?;
        }
        Ok(())
    }
}

impl CopyExecutor {
    fn rebase_planned_destinations(&self, old_root: &Location, new_root: &Location) {
        let rebase = |location: &Location| {
            location.uri.strip_prefix(&old_root.uri).map(|suffix| {
                Location::new(
                    location.provider_id.clone(),
                    format!("{}{suffix}", new_root.uri),
                )
            })
        };
        for planned in self
            .planned
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values_mut()
        {
            if let Some(destination) = rebase(&planned.destination) {
                planned.destination = destination;
            }
        }
        for (_, destination) in self
            .directories
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter_mut()
        {
            if let Some(location) = rebase(&destination.location) {
                destination.location = location;
            }
        }
    }

    async fn next_copy_destination(
        &self,
        original: &Location,
        cancellation: &CancellationToken,
    ) -> Result<Location, ExecutionError> {
        let parent = original
            .parent()
            .map_err(|error| ExecutionError::Failed(error.to_string()))?
            .ok_or_else(|| ExecutionError::Failed("copy destination has no parent".into()))?;
        let name = original
            .name()
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        for suffix in 1_u32.. {
            let candidate = parent
                .join(&copy_name(&name, suffix))
                .map_err(|error| ExecutionError::Failed(error.to_string()))?;
            let probe = EntryRef {
                id: fm_domain::EntryId::new(),
                location: candidate.clone(),
            };
            match self
                .destination_provider
                .inspect(&probe, cancellation.clone())
                .await
            {
                Err(fm_vfs::VfsError::NotFound { .. }) => return Ok(candidate),
                Ok(_) => {}
                Err(error) => return Err(error.into()),
            }
        }
        unreachable!("u32 suffix iterator is non-empty")
    }

    async fn copy_file(
        &self,
        operation: &Operation,
        item: &PlanItem,
        final_destination: &Location,
        resolution: Option<ConflictResolution>,
        pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        let destination_directory = final_destination
            .parent()
            .map_err(|error| ExecutionError::Failed(error.to_string()))?
            .ok_or_else(|| ExecutionError::Failed("copy destination has no parent".into()))?;
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
        pause.checkpoint().await;
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
                pause.checkpoint().await;
                if cancellation.is_cancelled() {
                    return Err(fm_vfs::VfsError::Cancelled.into());
                }
                let read = tokio::select! {
                    () = cancellation.cancelled() => return Err(fm_vfs::VfsError::Cancelled.into()),
                    result = reader.read(&mut buffer) => result.map_err(copy_stream_error)?,
                };
                if read == 0 {
                    break;
                }
                tokio::select! {
                    () = cancellation.cancelled() => return Err(fm_vfs::VfsError::Cancelled.into()),
                    result = writer.write_all(&buffer[..read]) => result.map_err(copy_stream_error)?,
                }
            }
            writer.shutdown().await.map_err(copy_stream_error)?;
            drop(writer);
        }
        pause.checkpoint().await;
        if cancellation.is_cancelled() {
            return Err(fm_vfs::VfsError::Cancelled.into());
        }

        let effective = effective_resolution(operation.conflict_policy, resolution);
        let overwrite = effective == Some(ConflictResolution::Overwrite);
        let mut destination = final_destination.clone();
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
                    if effective == Some(ConflictResolution::RenameNew) =>
                {
                    let name = final_destination
                        .name()
                        .map_err(|error| ExecutionError::Failed(error.to_string()))?;
                    destination = destination_directory
                        .join(&copy_name(&name, suffix))
                        .map_err(|error| ExecutionError::Failed(error.to_string()))?;
                    suffix = suffix.saturating_add(1);
                }
                Err(fm_vfs::VfsError::AlreadyExists { .. }) if effective.is_none() => {
                    self.destination_provider
                        .discard_copy(&temporary, CancellationToken::new())
                        .await?;
                    *self.temporary.lock().unwrap_or_else(|e| e.into_inner()) = None;
                    let source = self
                        .source_provider
                        .inspect(&item.entry, cancellation.clone())
                        .await?;
                    let destination_summary = self
                        .destination_provider
                        .inspect(
                            &EntryRef {
                                id: fm_domain::EntryId::new(),
                                location: destination,
                            },
                            cancellation.clone(),
                        )
                        .await?;
                    if source.kind != destination_summary.kind {
                        return Err(ExecutionError::Failed(
                            "a file and directory cannot replace one another".into(),
                        ));
                    }
                    return Err(conflict_error(&source, &destination_summary));
                }
                Err(fm_vfs::VfsError::AlreadyExists { .. })
                    if effective == Some(ConflictResolution::Skip) =>
                {
                    self.destination_provider
                        .discard_copy(&temporary, CancellationToken::new())
                        .await?;
                    *self.temporary.lock().unwrap_or_else(|e| e.into_inner()) = None;
                    return Ok(ExecutionOutcome::Skipped);
                }
                Err(error) => return Err(error.into()),
            }
        }
        *self.temporary.lock().unwrap_or_else(|e| e.into_inner()) = None;
        Ok(ExecutionOutcome::Completed)
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

fn effective_resolution(
    policy: fm_operations::ConflictPolicy,
    resolution: Option<ConflictResolution>,
) -> Option<ConflictResolution> {
    resolution.or(match policy {
        fm_operations::ConflictPolicy::Ask => None,
        fm_operations::ConflictPolicy::Skip => Some(ConflictResolution::Skip),
        fm_operations::ConflictPolicy::Overwrite => Some(ConflictResolution::Overwrite),
        fm_operations::ConflictPolicy::RenameNew => Some(ConflictResolution::RenameNew),
        fm_operations::ConflictPolicy::KeepNewer => None,
    })
}

fn conflict_error(
    source: &fm_domain::EntrySummary,
    destination: &fm_domain::EntrySummary,
) -> ExecutionError {
    ExecutionError::Conflict(fm_operations::OperationConflict {
        id: Uuid::new_v4().to_string(),
        source: conflict_entry(source),
        destination: conflict_entry(destination),
    })
}

fn conflict_entry(entry: &fm_domain::EntrySummary) -> fm_operations::ConflictEntry {
    fm_operations::ConflictEntry {
        name: entry.name.clone(),
        kind: entry.kind,
        size: entry.size,
        modified_at: entry.modified_at,
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
        _resolution: Option<fm_operations::ConflictResolution>,
        _pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<fm_operations::ExecutionOutcome, ExecutionError> {
        let source = EntryRef {
            id: item.entry.id,
            location: self.source.clone(),
        };
        self.provider
            .rename(&source, &self.destination, cancellation.clone())
            .await?;
        Ok(ExecutionOutcome::Completed)
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
        _resolution: Option<fm_operations::ConflictResolution>,
        _pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<fm_operations::ExecutionOutcome, ExecutionError> {
        if !self.create_intermediates {
            self.provider
                .create_directory(&self.parent, &self.name, cancellation.clone())
                .await?;
            return Ok(ExecutionOutcome::Completed);
        }
        let mut parent = self.parent.clone();
        for component in self.name.split(['/', '\\']) {
            let created = self
                .provider
                .create_directory(&parent, component, cancellation.clone())
                .await?;
            parent = created.location;
        }
        Ok(ExecutionOutcome::Completed)
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

/// Maps a mutating action id to the operation kind it delegates to, or
/// `None` for actions with no backing operation (unimplemented actions, and
/// the frontend-only selection/navigation actions reserved by task 0028).
fn mutating_operation_kind(id: &ActionId) -> Option<OperationKindDto> {
    match id.as_str() {
        "core.copy" => Some(OperationKindDto::Copy),
        "core.move" => Some(OperationKindDto::Move),
        "core.rename" => Some(OperationKindDto::Rename),
        "core.trash" => Some(OperationKindDto::Trash),
        "core.delete" => Some(OperationKindDto::Delete),
        "core.createDirectory" => Some(OperationKindDto::CreateDirectory),
        _ => None,
    }
}

/// Which platform adapter method an action dispatches to (task 0061).
/// `core.openWith` shares [`PlatformActionKind::Open`] with `core.open`: no
/// platform adapter exposes a distinct "choose application" binding yet (see
/// `core_actions`'s doc comment in `action.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlatformActionKind {
    Open,
    Reveal,
    OpenTerminal,
}

/// Maps an action id to the platform adapter operation it dispatches to
/// (task 0061), or `None` for actions with no platform-adapter effect.
fn platform_action_kind(id: &ActionId) -> Option<PlatformActionKind> {
    match id.as_str() {
        "core.open" | "core.openWith" => Some(PlatformActionKind::Open),
        "core.revealInSystemFileManager" => Some(PlatformActionKind::Reveal),
        "core.openTerminal" => Some(PlatformActionKind::OpenTerminal),
        _ => None,
    }
}

/// Maps a platform adapter failure to a user-readable application error
/// (task 0061). An adapter reporting [`fm_platform::PlatformError::Unsupported`]
/// despite the registry's capability check (e.g. a race between capability
/// detection and invocation) is reported the same way as any other
/// unavailable action; any other failure keeps its sanitized, user-readable
/// message rather than a silent no-op or a generic "internal error".
fn map_platform_error(action_id: &ActionId, error: fm_platform::PlatformError) -> ApplicationError {
    match error {
        fm_platform::PlatformError::Unsupported { .. } => {
            ApplicationError::ActionUnavailable(action_id.clone())
        }
        other => ApplicationError::PlatformOperationFailed(other.to_string()),
    }
}

/// Projects a manifest's declared capability grants into the wire DTO (spec §19).
fn plugin_permissions_dto(permissions: &PluginPermissions) -> PluginPermissionsDto {
    PluginPermissionsDto {
        selected_entry_metadata: permissions.selected_entry_metadata,
        selected_entry_content_read: permissions.selected_entry_content_read,
        filesystem_read: permissions
            .filesystem_read
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        filesystem_write: permissions
            .filesystem_write
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        clipboard_read: permissions.clipboard_read,
        clipboard_write: permissions.clipboard_write,
        network: permissions.network.clone(),
        process_spawn: permissions.process_spawn,
        notifications: permissions.notifications,
        settings_storage: permissions.settings_storage,
    }
}

/// Builds an [`ActionDescriptor`] for a plugin's declared action contribution,
/// deriving the context requirement from `requires_single_selection` (spec §18/§20).
fn plugin_action_descriptor(
    manifest: &PluginManifest,
    action: ActionContribution,
) -> ActionDescriptor {
    let context_requirements = if action.requires_single_selection {
        ActionContextRequirements::single_selection()
    } else {
        ActionContextRequirements::none()
    };
    ActionDescriptor {
        id: ActionId::new(action.id),
        title: action.title,
        description: Some(action.description),
        category: "plugin".to_owned(),
        default_shortcuts: Vec::new(),
        context_requirements,
        parameter_schema: None,
        source: ActionSource::Plugin {
            plugin_id: PluginId::new(manifest.id.clone()),
        },
    }
}

/// Invocation parameters a caller supplies for a plugin action that needs
/// the current selection's metadata, e.g. `sample.copyMarkdownPath` (spec §20).
/// The frontend already has this data from pane state, so it is passed
/// directly rather than requiring the backend to resolve an `EntryId`.
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginActionParametersDto {
    #[serde(default)]
    selected_entries: Vec<SelectedEntryContext>,
}

fn operation_dto(operation: Operation, queue_position: Option<u64>) -> OperationDto {
    let result_summary = operation_result_summary(&operation);
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
            fm_operations::OperationState::Interrupted => OperationStateDto::Interrupted,
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
        errors: operation
            .errors
            .into_iter()
            .map(|error| fm_transport_dto::OperationEntryErrorDto {
                entry: fm_transport_dto::EntryRefDto {
                    id: error.entry.id.into(),
                    location: error.entry.location.into(),
                },
                message: error.message,
            })
            .collect(),
        queue_position,
        result_summary,
    }
}

fn operation_result_summary(operation: &Operation) -> Option<String> {
    match operation.state {
        fm_operations::OperationState::Completed => Some(format!(
            "Completed {} items.",
            operation.progress.completed_items
        )),
        fm_operations::OperationState::CompletedWithWarnings => Some(format!(
            "Completed with {} warnings.",
            operation.errors.len()
        )),
        fm_operations::OperationState::Cancelled => Some(format!(
            "Cancelled after {} items.",
            operation.progress.completed_items
        )),
        fm_operations::OperationState::Failed => Some("Operation failed.".into()),
        fm_operations::OperationState::Interrupted => Some(format!(
            "Interrupted after {} items; it was not resumed.",
            operation.progress.completed_items
        )),
        _ => None,
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
        icon_theme: match settings.icon_theme {
            IconTheme::Generic => IconThemeDto::Generic,
            IconTheme::Catppuccin => IconThemeDto::Catppuccin,
        },
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
        icon_theme: match settings.icon_theme {
            IconThemeDto::Generic => IconTheme::Generic,
            IconThemeDto::Catppuccin => IconTheme::Catppuccin,
        },
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
    fn enabled_plugin_actions_are_projected_into_the_shared_action_registry() {
        let (directory, service) = service();
        let plugin = directory.path().join("settings/plugins/copy-path");
        std::fs::create_dir_all(&plugin).expect("plugin directory");
        std::fs::write(
            plugin.join("plugin.toml"),
            "id='example.copy-path'\nname='Copy Path'\nversion='1'\napi_version='1'\ndescription='Copies a path'\nentrypoint='plugin.lua'\n[contributions]\nactions=true",
        )
        .expect("manifest");
        std::fs::write(
            plugin.join("plugin.lua"),
            "return { actions = function() return {{ id = 'example.copy-path.copy', title = 'Copy Path', description = 'Copies the selected path' }} end }",
        )
        .expect("script");
        service
            .set_plugin_enabled("example.copy-path".to_owned(), true)
            .expect("enable plugin");

        let action = service
            .list_actions()
            .into_iter()
            .find(|action| action.id == "example.copy-path.copy")
            .expect("plugin action");

        assert_eq!(action.title, "Copy Path");
        assert!(matches!(
            action.source,
            fm_transport_dto::ActionSourceDto::Plugin { .. }
        ));
    }

    fn write_copy_markdown_plugin(directory: &std::path::Path, clipboard_write: bool) {
        std::fs::create_dir_all(directory).expect("plugin directory");
        std::fs::write(
            directory.join("plugin.toml"),
            format!(
                "id='example.copy-markdown'\nname='Copy Markdown'\nversion='1'\napi_version='1'\ndescription='Copies a markdown link'\nentrypoint='plugin.lua'\n[permissions]\nselected_entry_metadata=true\nclipboard_write={clipboard_write}\n[contributions]\nactions=true"
            ),
        )
        .expect("manifest");
        std::fs::write(
            directory.join("plugin.lua"),
            "return { actions = function() return {{ id = 'example.copy-markdown.copy', title = 'Copy Markdown', description = 'Copies a markdown link', requires_single_selection = true }} end, invoke = function(action_id) local entries = host.selected_entry_metadata() host.clipboard_write('[' .. entries[1].name .. '](' .. entries[1].uri .. ')') end }",
        )
        .expect("script");
    }

    #[test]
    fn plugin_action_requiring_single_selection_reports_that_context_requirement() {
        let (directory, service) = service();
        write_copy_markdown_plugin(
            &directory.path().join("settings/plugins/copy-markdown"),
            true,
        );
        service
            .set_plugin_enabled("example.copy-markdown".to_owned(), true)
            .expect("enable plugin");

        let action = service
            .list_actions()
            .into_iter()
            .find(|action| action.id == "example.copy-markdown.copy")
            .expect("plugin action");

        assert!(action.context_requirements.requires_single_selection);
    }

    #[tokio::test]
    async fn invoke_action_runs_a_plugin_action_and_publishes_a_clipboard_notification() {
        let (directory, service) = service();
        write_copy_markdown_plugin(
            &directory.path().join("settings/plugins/copy-markdown"),
            true,
        );
        service
            .set_plugin_enabled("example.copy-markdown".to_owned(), true)
            .expect("enable plugin");
        // `None` (rather than `Some(0)`) skips backlog replay, since this test
        // only cares about the notification `invoke_action` publishes below and
        // `set_plugin_enabled` above now also publishes a `plugin.changed` event.
        let mut events = service
            .event_bus()
            .subscribe(SessionId::new("test"), [], None);

        let result = service
            .invoke_action(
                "example.copy-markdown.copy".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(serde_json::json!({
                        "selectedEntries": [
                            { "name": "report.pdf", "uri": "file:///Users/erik/Documents/report.pdf" }
                        ]
                    })),
                    context: fm_transport_dto::ActionInvocationContextDto {
                        selected_entry_ids: vec![uuid::Uuid::new_v4()],
                        ..Default::default()
                    },
                },
                None,
            )
            .expect("plugin action must be invoked");

        assert!(result.invoked);
        assert_eq!(
            result.clipboard_text.as_deref(),
            Some("[report.pdf](file:///Users/erik/Documents/report.pdf)")
        );

        let event = events.recv().await.expect("notification event");
        assert!(matches!(
            event,
            SubscriptionEvent::Event(envelope)
                if matches!(
                    envelope.payload,
                    BackendEventPayload::NotificationCreated {
                        notification: NotificationPayload {
                            level: NotificationLevelPayload::Info,
                            ..
                        }
                    }
                )
        ));
    }

    #[test]
    fn invoke_action_reports_a_visible_error_when_a_plugin_action_lacks_the_clipboard_write_permission()
     {
        let (directory, service) = service();
        write_copy_markdown_plugin(
            &directory.path().join("settings/plugins/copy-markdown"),
            false,
        );
        service
            .set_plugin_enabled("example.copy-markdown".to_owned(), true)
            .expect("enable plugin");

        let error = service
            .invoke_action(
                "example.copy-markdown.copy".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(serde_json::json!({
                        "selectedEntries": [
                            { "name": "report.pdf", "uri": "file:///Users/erik/Documents/report.pdf" }
                        ]
                    })),
                    context: fm_transport_dto::ActionInvocationContextDto {
                        selected_entry_ids: vec![uuid::Uuid::new_v4()],
                        ..Default::default()
                    },
                },
                None,
            )
            .expect_err("clipboard write must be denied without the permission");

        assert_eq!(
            error.code(),
            fm_transport_dto::ApplicationErrorCode::InvalidRequest
        );
        assert!(error.to_string().contains("permission denied"));
    }

    #[test]
    fn invoke_action_reports_unavailable_when_the_plugin_action_context_requirement_is_not_met() {
        let (directory, service) = service();
        write_copy_markdown_plugin(
            &directory.path().join("settings/plugins/copy-markdown"),
            true,
        );
        service
            .set_plugin_enabled("example.copy-markdown".to_owned(), true)
            .expect("enable plugin");

        let error = service
            .invoke_action(
                "example.copy-markdown.copy".to_owned(),
                InvokeActionRequestDto::default(),
                None,
            )
            .expect_err("action requires exactly one selected entry");

        assert_eq!(
            error.code(),
            fm_transport_dto::ApplicationErrorCode::ActionUnavailable
        );
    }

    #[test]
    fn enabled_plugin_columns_are_exposed_as_declarative_descriptors() {
        let (directory, service) = service();
        let plugin = directory.path().join("settings/plugins/file-age");
        std::fs::create_dir_all(&plugin).expect("plugin directory");
        std::fs::write(
            plugin.join("plugin.toml"),
            "id='example.file-age'\nname='File Age'\nversion='1'\napi_version='1'\ndescription='Shows file age'\nentrypoint='plugin.lua'\n[contributions]\ncolumns=true",
        )
        .expect("manifest");
        std::fs::write(
            plugin.join("plugin.lua"),
            "return { columns = function() return {{ id = 'sample.fileAge', title = 'Age' }} end }",
        )
        .expect("script");
        service
            .set_plugin_enabled("example.file-age".to_owned(), true)
            .expect("enable plugin");

        let plugin = service
            .list_plugins()
            .into_iter()
            .find(|plugin| plugin.id == "example.file-age")
            .expect("plugin descriptor");

        assert!(plugin.enabled);
        assert_eq!(plugin.columns.len(), 1);
        assert_eq!(plugin.columns[0].id, "sample.fileAge");
        assert_eq!(plugin.columns[0].title, "Age");
    }

    #[test]
    fn listed_plugins_project_declared_permissions_and_mark_ungranted_ones_denied() {
        let (directory, service) = service();
        let plugin = directory.path().join("settings/plugins/copy-markdown");
        write_copy_markdown_plugin(&plugin, true);
        service
            .set_plugin_enabled("example.copy-markdown".to_owned(), true)
            .expect("enable plugin");

        let descriptor = service
            .list_plugins()
            .into_iter()
            .find(|plugin| plugin.id == "example.copy-markdown")
            .expect("plugin descriptor");

        assert!(descriptor.permissions.selected_entry_metadata);
        assert!(descriptor.permissions.clipboard_write);
        assert!(
            !descriptor.permissions.clipboard_read,
            "clipboard_read was never granted"
        );
        assert!(
            !descriptor.permissions.notifications,
            "notifications was never granted"
        );
        assert!(descriptor.permissions.filesystem_read.is_empty());
    }

    #[test]
    fn an_invalid_manifest_is_listed_with_its_validation_diagnostic() {
        let (directory, service) = service();
        let plugin = directory.path().join("settings/plugins/broken");
        std::fs::create_dir_all(&plugin).expect("plugin directory");
        std::fs::write(plugin.join("plugin.toml"), "id=''\n").expect("malformed manifest");

        let descriptor = service
            .list_plugins()
            .into_iter()
            .find(|plugin| plugin.id == "broken")
            .expect("invalid plugin is still listed");

        assert!(!descriptor.enabled);
        assert!(descriptor.diagnostic.is_some());
    }

    #[test]
    fn plugin_logs_reports_not_found_for_an_undiscovered_plugin() {
        let (_directory, service) = service();

        let error = service
            .plugin_logs("unknown.plugin")
            .expect_err("unknown plugin must be reported as not found");

        assert_eq!(
            error.code(),
            fm_transport_dto::ApplicationErrorCode::NotFound
        );
    }

    #[test]
    fn plugin_logs_returns_the_bounded_diagnostic_log_after_a_failure() {
        let (directory, service) = service();
        let plugin = directory.path().join("settings/plugins/copy-path");
        std::fs::create_dir_all(&plugin).expect("plugin directory");
        std::fs::write(
            plugin.join("plugin.toml"),
            "id='example.copy-path'\nname='Copy Path'\nversion='1'\napi_version='1'\ndescription='Copies a path'\nentrypoint='plugin.lua'\n[contributions]\nactions=true",
        )
        .expect("manifest");
        std::fs::write(
            plugin.join("plugin.lua"),
            "return { actions = function() error('boom') end }",
        )
        .expect("script");
        service
            .set_plugin_enabled("example.copy-path".to_owned(), true)
            .expect("enable plugin");

        // Triggers the runtime failure that is recorded into the bounded log.
        let _ = service.list_actions();

        let logs = service
            .plugin_logs("example.copy-path")
            .expect("plugin is discovered");

        assert_eq!(logs.len(), 1);
        assert!(logs[0].message.contains("boom"));
    }

    #[tokio::test]
    async fn enabling_a_plugin_publishes_a_plugin_changed_event() {
        let (directory, service) = service();
        let plugin = directory.path().join("settings/plugins/copy-path");
        std::fs::create_dir_all(&plugin).expect("plugin directory");
        std::fs::write(
            plugin.join("plugin.toml"),
            "id='example.copy-path'\nname='Copy Path'\nversion='1'\napi_version='1'\ndescription='Copies a path'\nentrypoint='plugin.lua'\n[contributions]\nactions=true",
        )
        .expect("manifest");
        std::fs::write(
            plugin.join("plugin.lua"),
            "return { actions = function() return {} end }",
        )
        .expect("script");
        let mut events = service
            .event_bus()
            .subscribe(SessionId::new("test"), [], Some(0));

        service
            .set_plugin_enabled("example.copy-path".to_owned(), true)
            .expect("enable plugin");

        let event = events.recv().await.expect("plugin.changed event");
        let SubscriptionEvent::Event(envelope) = event else {
            panic!("expected an event envelope");
        };
        let BackendEventPayload::PluginChanged { plugin } = envelope.payload else {
            panic!("expected a PluginChanged payload");
        };
        assert_eq!(plugin.id.as_str(), "example.copy-path");
        assert_eq!(plugin.name, "Copy Path");
        assert!(plugin.enabled);
    }

    #[test]
    fn restarted_service_restores_inflight_history_as_interrupted() {
        let directory = tempfile::tempdir().expect("must create a temp dir");
        let settings_directory = directory.path().join("settings");
        fs::create_dir_all(&settings_directory).expect("must create settings directory");
        let mut operation = Operation::new(
            fm_operations::OperationKind::Copy,
            vec![],
            None,
            fm_operations::ConflictPolicy::Ask,
        );
        operation
            .transition(fm_operations::OperationState::Planning)
            .expect("queued operation starts planning");
        fs::write(
            settings_directory.join(OPERATION_HISTORY_FILE_NAME),
            serde_json::to_vec(&vec![operation]).expect("history serializes"),
        )
        .expect("must write persisted history");

        let service = FileManagerService::new(
            RuntimeKindDto::BrowserServer,
            directory.path(),
            &settings_directory,
        );
        let page = service.list_operation_page(0, 50);

        assert_eq!(page.total, 1);
        assert_eq!(page.operations[0].state, OperationStateDto::Interrupted);
        assert_eq!(
            page.operations[0].result_summary.as_deref(),
            Some("Interrupted after 0 items; it was not resumed.")
        );
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
        assert!(capabilities.plugins);
        assert!(!capabilities.server_administration);
        assert!(capabilities.clipboard);
    }

    /// A platform adapter test double reporting a hand-picked, non-uniform
    /// set of capabilities, so `runtime_capabilities` tests can distinguish
    /// "derives from the adapter" from "always reports every flag the same
    /// way" - a fixture where every flag were true or every flag were false
    /// would pass even if the mapping from bit to DTO field were wrong.
    #[derive(Debug, Clone, Copy)]
    struct StubPlatformAdapter;

    impl fm_platform::PlatformAdapter for StubPlatformAdapter {
        fn capabilities(&self) -> PlatformCapabilities {
            PlatformCapabilities::TRASH
                | PlatformCapabilities::OPEN_TERMINAL
                | PlatformCapabilities::NATIVE_DRAG_OUT
        }
    }

    #[test]
    fn runtime_capabilities_are_derived_from_the_injected_platform_adapter() {
        let dir = tempfile::tempdir().expect("must create a temp dir");
        let service = FileManagerService::with_platform_adapter(
            RuntimeKindDto::Tauri,
            dir.path(),
            dir.path().join("settings"),
            EventBus::default(),
            Arc::new(StubPlatformAdapter),
        );
        let capabilities = service.runtime_capabilities();

        assert!(capabilities.system_trash);
        assert!(capabilities.open_terminal);
        assert!(capabilities.native_drag_out);
        assert!(!capabilities.native_menus);
        assert!(!capabilities.native_file_icons);
        assert!(!capabilities.native_thumbnails);
        assert!(!capabilities.reveal_in_system_file_manager);
    }

    /// A platform adapter test double that records every call it receives
    /// (task 0061), so `invoke_action`'s platform dispatch can be asserted
    /// end to end: which path was passed (verifying `Location`
    /// parsing/round-tripping never mangles spaces, quotes or Unicode
    /// instead of shell-interpolating a string), and what terminal command
    /// override was forwarded from settings.
    struct RecordingPlatformAdapter {
        capabilities: PlatformCapabilities,
        opened: Mutex<Vec<PathBuf>>,
        revealed: Mutex<Vec<PathBuf>>,
        terminals: Mutex<Vec<(PathBuf, Option<String>)>>,
        trashed: Mutex<Vec<PathBuf>>,
        open_error: Mutex<Option<fm_platform::PlatformError>>,
        trash_error: Mutex<Option<fm_platform::PlatformError>>,
    }

    impl RecordingPlatformAdapter {
        fn new(capabilities: PlatformCapabilities) -> Self {
            Self {
                capabilities,
                opened: Mutex::new(Vec::new()),
                revealed: Mutex::new(Vec::new()),
                terminals: Mutex::new(Vec::new()),
                trashed: Mutex::new(Vec::new()),
                open_error: Mutex::new(None),
                trash_error: Mutex::new(None),
            }
        }

        fn fail_next_open_with(&self, error: fm_platform::PlatformError) {
            *self.open_error.lock().expect("lock must not be poisoned") = Some(error);
        }

        fn fail_next_trash_with(&self, error: fm_platform::PlatformError) {
            *self.trash_error.lock().expect("lock must not be poisoned") = Some(error);
        }
    }

    impl fm_platform::PlatformAdapter for RecordingPlatformAdapter {
        fn capabilities(&self) -> PlatformCapabilities {
            self.capabilities
        }

        fn open_with_default_application(
            &self,
            path: &Path,
        ) -> Result<(), fm_platform::PlatformError> {
            if let Some(error) = self
                .open_error
                .lock()
                .expect("lock must not be poisoned")
                .take()
            {
                return Err(error);
            }
            self.opened
                .lock()
                .expect("lock must not be poisoned")
                .push(path.to_path_buf());
            Ok(())
        }

        fn reveal_in_file_manager(&self, path: &Path) -> Result<(), fm_platform::PlatformError> {
            self.revealed
                .lock()
                .expect("lock must not be poisoned")
                .push(path.to_path_buf());
            Ok(())
        }

        fn trash(&self, path: &Path) -> Result<(), fm_platform::PlatformError> {
            if let Some(error) = self
                .trash_error
                .lock()
                .expect("lock must not be poisoned")
                .take()
            {
                return Err(error);
            }
            self.trashed
                .lock()
                .expect("lock must not be poisoned")
                .push(path.to_path_buf());
            Ok(())
        }

        fn open_terminal(
            &self,
            path: &Path,
            command_override: Option<&str>,
        ) -> Result<(), fm_platform::PlatformError> {
            self.terminals
                .lock()
                .expect("lock must not be poisoned")
                .push((path.to_path_buf(), command_override.map(str::to_owned)));
            Ok(())
        }
    }

    /// Builds a service backed by a [`RecordingPlatformAdapter`] reporting
    /// every platform capability task 0061/0043 cares about, and returns the
    /// adapter (still owned via a second `Arc`) so tests can inspect what it
    /// recorded.
    fn service_with_recording_adapter() -> (
        tempfile::TempDir,
        FileManagerService,
        Arc<RecordingPlatformAdapter>,
    ) {
        let dir = tempfile::tempdir().expect("must create a temp dir");
        let adapter = Arc::new(RecordingPlatformAdapter::new(
            PlatformCapabilities::OPEN_WITH_DEFAULT_APPLICATION
                | PlatformCapabilities::REVEAL_IN_FILE_MANAGER
                | PlatformCapabilities::OPEN_TERMINAL
                | PlatformCapabilities::TRASH,
        ));
        let service = FileManagerService::with_platform_adapter(
            RuntimeKindDto::Tauri,
            dir.path(),
            dir.path().join("settings"),
            EventBus::default(),
            adapter.clone(),
        );
        (dir, service, adapter)
    }

    fn single_selection_context() -> fm_transport_dto::ActionInvocationContextDto {
        fm_transport_dto::ActionInvocationContextDto {
            selected_entry_ids: vec![uuid::Uuid::new_v4()],
            ..Default::default()
        }
    }

    #[test]
    fn invoke_action_opens_the_uri_parameters_path_with_the_default_application() {
        let (dir, service, adapter) = service_with_recording_adapter();
        // Spaces, single/double quotes and non-ASCII must round-trip exactly:
        // this proves the dispatch parses the URI via `Location` rather than
        // building a shell command string.
        let target = dir.path().join("with spaces & 'quotes' café.txt");
        std::fs::write(&target, b"contents").expect("write fixture file");
        let uri = Location::from_native_path(&target)
            .expect("path must convert to a location")
            .uri;

        let result = service
            .invoke_action(
                "core.open".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(serde_json::json!({ "uri": uri })),
                    context: single_selection_context(),
                },
                None,
            )
            .expect("core.open must dispatch to the platform adapter");

        assert!(result.invoked);
        assert!(result.operation_id.is_none());
        assert_eq!(adapter.opened.lock().unwrap().as_slice(), [target]);
    }

    #[test]
    fn invoke_action_reveals_the_uri_parameters_path() {
        let (dir, service, adapter) = service_with_recording_adapter();
        let target = dir.path().join("report.pdf");
        let uri = Location::from_native_path(&target)
            .expect("path must convert to a location")
            .uri;

        service
            .invoke_action(
                "core.revealInSystemFileManager".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(serde_json::json!({ "uri": uri })),
                    context: single_selection_context(),
                },
                None,
            )
            .expect("core.revealInSystemFileManager must dispatch to the platform adapter");

        assert_eq!(adapter.revealed.lock().unwrap().as_slice(), [target]);
    }

    #[test]
    fn invoke_action_open_terminal_forwards_the_configured_terminal_command_override() {
        let (dir, service, adapter) = service_with_recording_adapter();
        let mut settings = service.get_settings();
        settings.terminal_command = Some("alacritty".to_owned());
        service
            .update_settings(settings)
            .expect("settings update must succeed");
        let uri = Location::from_native_path(dir.path())
            .expect("path must convert to a location")
            .uri;

        service
            .invoke_action(
                "core.openTerminal".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(serde_json::json!({ "uri": uri })),
                    context: fm_transport_dto::ActionInvocationContextDto::default(),
                },
                None,
            )
            .expect("core.openTerminal must dispatch to the platform adapter");

        assert_eq!(
            adapter.terminals.lock().unwrap().as_slice(),
            [(dir.path().to_path_buf(), Some("alacritty".to_owned()))]
        );
    }

    /// Builds a `Trash` request targeting the given native paths.
    fn trash_request(paths: &[&std::path::Path]) -> StartOperationRequestDto {
        StartOperationRequestDto {
            operation_type: OperationKindDto::Trash,
            sources: paths
                .iter()
                .map(|path| {
                    Location::from_native_path(path)
                        .expect("path must convert to a location")
                        .into()
                })
                .collect(),
            destination: None,
            conflict_policy: OperationConflictPolicyDto::Ask,
            name: None,
            create_intermediate_directories: false,
            symlink_policy: Default::default(),
            permanent_delete_confirmed: false,
            override_read_only: false,
        }
    }

    async fn wait_for_terminal_operation(
        service: &FileManagerService,
        id: fm_domain::OperationId,
    ) -> OperationDto {
        loop {
            let operation = service.get_operation(id).expect("operation must exist");
            if matches!(
                operation.state,
                OperationStateDto::Completed
                    | OperationStateDto::CompletedWithWarnings
                    | OperationStateDto::Failed
                    | OperationStateDto::Cancelled
            ) {
                return operation;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }

    #[tokio::test]
    async fn start_operation_trash_dispatches_every_source_to_the_platform_adapter() {
        let (dir, service, adapter) = service_with_recording_adapter();
        let first = dir.path().join("trash-me.txt");
        let second = dir.path().join("trash-me-too.txt");
        std::fs::write(&first, b"1").expect("write first fixture");
        std::fs::write(&second, b"2").expect("write second fixture");

        let started = service
            .start_operation(trash_request(&[&first, &second]), None)
            .expect("trash must be accepted when TRASH capability is available");
        let result = wait_for_terminal_operation(&service, started.id.into()).await;

        assert_eq!(result.state, OperationStateDto::Completed);
        assert_eq!(adapter.trashed.lock().unwrap().as_slice(), [first, second]);
        // Trashing never routes through a `FileSystemProvider::remove` call,
        // so the fixtures are untouched by this test double; only the real
        // macOS adapter test (`fm-platform-macos`) exercises an actual move.
    }

    #[test]
    fn start_operation_trash_is_rejected_when_the_platform_reports_no_trash_capability() {
        let dir = tempfile::tempdir().expect("must create a temp dir");
        let file = dir.path().join("trash-me.txt");
        std::fs::write(&file, b"content").expect("write fixture");
        // `FileManagerService::new` defaults to `FallbackPlatformAdapter`,
        // which reports no capabilities at all (browser/server mode).
        let service = FileManagerService::new(
            RuntimeKindDto::BrowserServer,
            dir.path().join("workspaces"),
            dir.path().join("settings"),
        );

        let error = service
            .start_operation(trash_request(&[&file]), None)
            .expect_err("trash must be rejected without the TRASH capability");

        assert_eq!(
            error.code(),
            fm_transport_dto::ApplicationErrorCode::PlatformOperationFailed
        );
        assert!(file.exists(), "no attempt to move the file must be made");
    }

    #[tokio::test]
    async fn start_operation_trash_reports_completed_with_warnings_on_a_platform_failure() {
        let (dir, service, adapter) = service_with_recording_adapter();
        let file = dir.path().join("stubborn.txt");
        std::fs::write(&file, b"content").expect("write fixture");
        adapter.fail_next_trash_with(fm_platform::PlatformError::Io {
            message: "permission denied".to_owned(),
        });

        let started = service
            .start_operation(trash_request(&[&file]), None)
            .expect("trash must be accepted when TRASH capability is available");
        let result = wait_for_terminal_operation(&service, started.id.into()).await;

        assert_eq!(result.state, OperationStateDto::CompletedWithWarnings);
    }

    #[test]
    fn invoke_action_rejects_a_missing_uri_parameter_as_invalid_request() {
        let (_dir, service, _adapter) = service_with_recording_adapter();

        let error = service
            .invoke_action(
                "core.open".to_owned(),
                InvokeActionRequestDto {
                    parameters: None,
                    context: single_selection_context(),
                },
                None,
            )
            .expect_err("a missing uri parameter must be rejected");

        assert_eq!(
            error.code(),
            fm_transport_dto::ApplicationErrorCode::InvalidRequest
        );
    }

    #[test]
    fn invoke_action_rejects_a_malformed_uri_as_invalid_request() {
        let (_dir, service, _adapter) = service_with_recording_adapter();

        let error = service
            .invoke_action(
                "core.open".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(serde_json::json!({ "uri": "not a valid uri" })),
                    context: single_selection_context(),
                },
                None,
            )
            .expect_err("a malformed uri must be rejected");

        assert_eq!(
            error.code(),
            fm_transport_dto::ApplicationErrorCode::InvalidRequest
        );
    }

    #[test]
    fn invoke_action_maps_a_genuine_platform_failure_to_a_user_readable_platform_operation_failed_error()
     {
        let (dir, service, adapter) = service_with_recording_adapter();
        adapter.fail_next_open_with(fm_platform::PlatformError::Io {
            message: "no default application is registered for .xyz files".to_owned(),
        });
        let uri = Location::from_native_path(&dir.path().join("mystery.xyz"))
            .expect("path must convert to a location")
            .uri;

        let error = service
            .invoke_action(
                "core.open".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(serde_json::json!({ "uri": uri })),
                    context: single_selection_context(),
                },
                None,
            )
            .expect_err("a genuine platform failure must be reported, not swallowed");

        assert_eq!(
            error.code(),
            fm_transport_dto::ApplicationErrorCode::PlatformOperationFailed
        );
        assert!(
            error
                .to_string()
                .contains("no default application is registered for .xyz files")
        );
    }

    #[test]
    fn invoke_action_reveal_and_terminal_are_unavailable_in_browser_server_mode() {
        let (_dir, service) = service();
        let context = single_selection_context();

        let reveal_error = service
            .invoke_action(
                "core.revealInSystemFileManager".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(serde_json::json!({ "uri": "file:///tmp/report.pdf" })),
                    context: context.clone(),
                },
                None,
            )
            .expect_err("reveal has no native access in browser/server mode");
        assert_eq!(
            reveal_error.code(),
            fm_transport_dto::ApplicationErrorCode::ActionUnavailable
        );

        let terminal_error = service
            .invoke_action(
                "core.openTerminal".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(serde_json::json!({ "uri": "file:///tmp" })),
                    context: fm_transport_dto::ActionInvocationContextDto::default(),
                },
                None,
            )
            .expect_err("openTerminal has no native access in browser/server mode");
        assert_eq!(
            terminal_error.code(),
            fm_transport_dto::ApplicationErrorCode::ActionUnavailable
        );
    }

    #[test]
    fn list_actions_includes_every_core_and_reserved_action_id() {
        let (_dir, service) = service();
        let ids: Vec<String> = service
            .list_actions()
            .into_iter()
            .map(|action| action.id)
            .collect();

        for expected in [
            "core.copy",
            "core.rename",
            "core.selectAll",
            "core.open",
            "core.paste",
            "core.refresh",
            "core.openTerminal",
        ] {
            assert!(ids.iter().any(|id| id == expected), "missing {expected}");
        }
    }

    #[test]
    fn invoke_action_reports_an_unknown_action_without_panicking() {
        let (_dir, service) = service();
        let error = service
            .invoke_action(
                "does.not.exist".to_owned(),
                InvokeActionRequestDto::default(),
                None,
            )
            .expect_err("an unregistered action must be reported, not panic");
        assert_eq!(
            error,
            ApplicationError::ActionNotFound(fm_domain::ActionId::new("does.not.exist"))
        );
    }

    #[test]
    fn invoke_action_reports_unavailable_for_a_feature_without_a_backend_implementation() {
        let (_dir, service) = service();
        let error = service
            .invoke_action(
                "core.open".to_owned(),
                InvokeActionRequestDto::default(),
                None,
            )
            .expect_err("core.open has no backend feature yet");
        assert_eq!(
            error,
            ApplicationError::ActionUnavailable(fm_domain::ActionId::new("core.open"))
        );
    }

    #[test]
    fn invoke_action_reports_unavailable_when_context_requirements_are_not_met() {
        let (_dir, service) = service();
        let error = service
            .invoke_action(
                "core.rename".to_owned(),
                InvokeActionRequestDto::default(),
                None,
            )
            .expect_err("rename requires exactly one selected entry");
        assert_eq!(
            error,
            ApplicationError::ActionUnavailable(fm_domain::ActionId::new("core.rename"))
        );
    }

    #[test]
    fn invoke_action_returns_invoked_without_an_operation_for_non_mutating_actions() {
        let (_dir, service) = service();
        let result = service
            .invoke_action(
                "core.selectAll".to_owned(),
                InvokeActionRequestDto::default(),
                None,
            )
            .expect("core.selectAll has no context requirements");
        assert_eq!(result.action_id, "core.selectAll");
        assert!(result.invoked);
        assert!(result.operation_id.is_none());
    }

    #[tokio::test]
    async fn invoke_action_delegates_create_directory_to_the_operation_engine() {
        let (dir, service) = service();
        let parent = dir.path().join("parent");
        fs::create_dir_all(&parent).expect("must create parent directory");
        let destination = fm_transport_dto::LocationDto {
            provider_id: "local".to_owned(),
            uri: format!("file://{}", parent.display()),
        };
        let parameters = serde_json::to_value(StartOperationRequestDto {
            operation_type: OperationKindDto::CreateDirectory,
            sources: Vec::new(),
            destination: Some(destination),
            conflict_policy: OperationConflictPolicyDto::Ask,
            name: Some("child".to_owned()),
            create_intermediate_directories: false,
            symlink_policy: fm_transport_dto::SymlinkPolicyDto::default(),
            permanent_delete_confirmed: false,
            override_read_only: false,
        })
        .expect("must serialize the operation request");

        let result = service
            .invoke_action(
                "core.createDirectory".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(parameters),
                    context: fm_transport_dto::ActionInvocationContextDto::default(),
                },
                None,
            )
            .expect("createDirectory has no context requirements");

        assert!(result.invoked);
        let operation_id = result
            .operation_id
            .expect("a mutating action must return an operation id");
        let operation = loop {
            let current = service
                .get_operation(OperationId::from(operation_id))
                .expect("the started operation must be retrievable");
            if matches!(
                current.state,
                OperationStateDto::Completed | OperationStateDto::Failed
            ) {
                break current;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        };
        assert_eq!(operation.state, OperationStateDto::Completed);
        assert!(parent.join("child").is_dir());
    }

    #[test]
    fn invoke_action_reports_invalid_request_when_mutating_action_parameters_are_missing() {
        let (_dir, service) = service();
        let error = service
            .invoke_action(
                "core.createDirectory".to_owned(),
                InvokeActionRequestDto::default(),
                None,
            )
            .expect_err("createDirectory requires parameters");
        assert_eq!(
            error.code(),
            fm_transport_dto::ApplicationErrorCode::InvalidRequest
        );
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
