//! The `FileManagerService` facade (specification §7).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use fm_archive::ArchiveFileSystemProvider;
use fm_comparison::{
    ComparisonEngine, ComparisonResultsStore, SyncAction, generate_sync_plan as compute_sync_plan,
};
use fm_connections::{ConnectionService, JsonFileConnectionRepository};
use fm_credentials::{CredentialStore, InMemoryCredentialStore, SessionCredentialStore};
use fm_domain::OperationId;
use fm_domain::{ActionId, DirectorySnapshot, EntryId, EntryMetadata, Location, PaneId};
use fm_events::{
    BackendEventPayload, ConflictPolicyPayload, EntryRefPayload, EventAudience, EventBus,
    NotificationLevelPayload, NotificationPayload, OperationKindPayload, OperationPayload,
    OperationProgressDetails, OperationStatePayload,
};
use fm_operations::{ConflictResolution, Operation, Scheduler, SchedulerError};
use fm_platform::{FallbackPlatformAdapter, PlatformAdapter};
use fm_plugin_runtime::{PluginDiscovery, PluginRuntime};
use fm_search::{SearchEngine, SearchFileSystemProvider, SearchResultsStore};
use fm_settings::{Settings, SettingsStore};
use fm_transport_dto::{
    ActionDescriptorDto, ActionResultDto, ApplySyncPlanRequestDto, ApplySyncPlanResponseDto,
    ComparisonPageDto, ConflictResolutionDto, ConnectionDto, CreateConnectionRequestDto,
    DirectorySnapshotDto, EntryMetadataRequest, GenerateSyncPlanRequestDto, InvokeActionRequestDto,
    ListDirectoryRequest, NavigateRequest, OperationConflictPolicyDto, OperationDto,
    PluginDescriptorDto, PluginLogEntryDto, ReadFileRangeRequestDto, ReadFileRangeResponseDto,
    ResolveOperationConflictRequestDto, RuntimeCapabilitiesDto, RuntimeKindDto,
    SearchInFileRequestDto, SearchInFileResponseDto, SetPaneActivityRequest, SettingsDto,
    StartComparisonRequestDto, StartComparisonResponseDto, StartOperationRequestDto,
    StartSearchRequestDto, StartSearchResponseDto, SyncPlanDto, UpdateConnectionRequestDto,
    WorkspaceCommandDto, WorkspaceDto, WorkspaceSummaryDto,
};
use fm_vfs::{EntryRef, ProviderRegistry};
use fm_vfs_local::LocalFileSystemProvider;
use uuid::Uuid;

use crate::DirectoryService;
use crate::action::ActionRegistry;
use crate::comparison_mapping::{
    comparison_criteria, comparison_criteria_dto, comparison_entry_dto, sync_action, sync_mode,
    sync_plan_item_dto,
};
use crate::connection_facade::ConnectionFacade;
use crate::content_streaming;
use crate::error::ApplicationError;
use crate::file_editor::FileEditorService;
use crate::operation_history::{ApplicationOperationObserver, OperationHistory, operation_dto};
use crate::operation_planner::OperationPlanner;
use crate::operation_requests::{
    conflict_policy, copy_request, delete_request, map_scheduler_error, mutating_operation_kind,
    operation_kind,
};
use crate::platform_mapping::{
    PlatformActionKind, discover_system_locations, map_file_icon_error, map_native_menu_error,
    map_platform_error, platform_action_kind, runtime_capabilities_dto, volume_capacity,
};
use crate::plugin_manager::PluginManager;
use crate::remote_terminal::RemoteTerminalService;
use crate::settings_mapping::{settings_from_dto, settings_to_dto};
use crate::thumbnails::ThumbnailService;
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
    connections: ConnectionFacade,
    remote_terminals: RemoteTerminalService,
    directories: DirectoryService,
    editor: FileEditorService,
    providers: ProviderRegistry,
    archive_provider: Arc<ArchiveFileSystemProvider>,
    events: EventBus,
    settings_store: SettingsStore,
    settings: Arc<Mutex<Settings>>,
    plugin_manager: PluginManager,
    operations: Scheduler,
    operation_history: Arc<OperationHistory>,
    planner: OperationPlanner,
    operation_idempotency: Mutex<HashMap<String, OperationId>>,
    force_cross_volume_moves: Arc<AtomicBool>,
    actions: ActionRegistry,
    search: SearchEngine,
    comparison: ComparisonEngine,
    comparison_store: Arc<ComparisonResultsStore>,
    thumbnails: ThumbnailService,
}

impl FileManagerService {
    /// Discovers OS-managed locations and maps their native paths to the existing local provider.
    pub async fn system_locations(
        &self,
    ) -> Result<Vec<fm_transport_dto::SystemLocationDto>, ApplicationError> {
        discover_system_locations(Arc::clone(&self.platform)).await
    }

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
    ///
    /// Credentials are stored through [`InMemoryCredentialStore`] - a real
    /// host on macOS/Windows must call
    /// [`Self::with_platform_adapter_and_credential_store`] instead to get
    /// Keychain/Credential Manager-backed storage (task 0103's acceptance
    /// criterion); this constructor exists for callers (mainly this crate's
    /// own tests) that do not care which credential store is used.
    pub fn with_platform_adapter(
        runtime: RuntimeKindDto,
        workspace_directory: impl Into<PathBuf>,
        settings_directory: impl Into<PathBuf>,
        events: EventBus,
        platform: Arc<dyn PlatformAdapter>,
    ) -> Self {
        Self::with_platform_adapter_and_credential_store(
            runtime,
            workspace_directory,
            settings_directory,
            events,
            platform,
            Arc::new(InMemoryCredentialStore::new()),
        )
    }

    /// Builds a service using a caller-provided event bus, platform adapter
    /// and credential store.
    ///
    /// Every real host (`apps/fm-server`, `apps/fm-desktop`) should call this
    /// constructor with the OS-appropriate [`CredentialStore`] (`dev.fm`'s
    /// `fm-credentials-macos`/`fm-credentials-windows`, selected the same way
    /// each host already selects its [`PlatformAdapter`] - see each host's
    /// `credentials` module), not [`Self::with_platform_adapter`], which
    /// defaults to the non-protected in-memory store.
    pub fn with_platform_adapter_and_credential_store(
        runtime: RuntimeKindDto,
        workspace_directory: impl Into<PathBuf>,
        settings_directory: impl Into<PathBuf>,
        events: EventBus,
        platform: Arc<dyn PlatformAdapter>,
        credential_store: Arc<dyn CredentialStore>,
    ) -> Self {
        let settings_directory = settings_directory.into();
        let credential_store: Arc<dyn CredentialStore> =
            Arc::new(SessionCredentialStore::new(credential_store));
        let mut providers = ProviderRegistry::new();
        providers.register(Arc::new(LocalFileSystemProvider));
        let archive_provider = Arc::new(ArchiveFileSystemProvider::new());
        providers.register(archive_provider.clone());
        let search_store = Arc::new(SearchResultsStore::new());
        providers.register(Arc::new(SearchFileSystemProvider::new(Arc::clone(
            &search_store,
        ))));
        // SSH/SFTP (task 0104, spec §6). `known_hosts` is a sibling of
        // `connections` under the same settings directory, following that
        // repository's own convention; `ssh_connections` is shared between
        // the dialer (connect/test from the Connections UI) and the SFTP
        // provider (browsing), so a successful connect/test and a later
        // browse reuse the same pooled session instead of dialing twice.
        let ssh_known_hosts = Arc::new(fm_ssh::JsonFileKnownHostsStore::new(
            settings_directory.join("ssh-known-hosts.json"),
        ));
        let ssh_connections = Arc::new(fm_ssh::SshConnectionManager::new(ssh_known_hosts));
        providers.register(Arc::new(fm_vfs_sftp::SftpFileSystemProvider::new(
            ssh_connections.clone(),
            Arc::new(crate::ssh::SshResolver::new(
                JsonFileConnectionRepository::new(settings_directory.join("connections")),
                credential_store.clone(),
            )),
        )));
        providers.register(Arc::new(fm_vfs_ftp::FtpFileSystemProvider::new(Arc::new(
            crate::ftp::FtpResolver::new(
                JsonFileConnectionRepository::new(settings_directory.join("connections")),
                credential_store.clone(),
            ),
        ))));
        // A second, independently-constructed `SshResolver` for the embedded
        // terminal's remote shell channel (task 0105) - safe to construct
        // separately for the same reason `SshResolver::new` above is: a
        // stateless, file-per-connection repository with no in-memory cache
        // to desynchronize.
        let remote_terminals = RemoteTerminalService::new(
            ssh_connections.clone(),
            Arc::new(crate::ssh::SshResolver::new(
                JsonFileConnectionRepository::new(settings_directory.join("connections")),
                credential_store.clone(),
            )),
        );
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
        let operation_observer = Arc::new(ApplicationOperationObserver::new(
            operation_history.clone(),
            directories.clone(),
        ));
        let platform_capabilities = platform.capabilities();
        let search = SearchEngine::new(search_store, events.clone(), providers.clone());
        let comparison_store = Arc::new(ComparisonResultsStore::new());
        let comparison = ComparisonEngine::new(
            Arc::clone(&comparison_store),
            events.clone(),
            providers.clone(),
        );
        let audit_log_path = settings_directory.join("audit.jsonl");
        let settings_mutex = Arc::new(Mutex::new(loaded.settings));
        let force_cross_volume_moves = Arc::new(AtomicBool::new(false));
        let planner = OperationPlanner::new(
            providers.clone(),
            Arc::clone(&platform),
            Arc::clone(&settings_mutex),
            audit_log_path.clone(),
            Arc::clone(&force_cross_volume_moves),
        );
        Self {
            runtime,
            platform,
            workspaces: WorkspaceService::new(JsonFileWorkspaceRepository::new(
                workspace_directory,
            )),
            connections: ConnectionFacade::new(
                ConnectionService::new(
                    JsonFileConnectionRepository::new(settings_directory.join("connections")),
                    credential_store,
                    events.clone(),
                )
                .with_dialer(
                    fm_connections::ConnectionKind::Ssh,
                    Arc::new(crate::ssh::SshDialer::new(ssh_connections.clone())),
                )
                .with_dialer(
                    fm_connections::ConnectionKind::Ftp,
                    Arc::new(crate::ftp::FtpDialer),
                )
                .with_dialer(
                    fm_connections::ConnectionKind::Ftps,
                    Arc::new(crate::ftp::FtpDialer),
                ),
                ssh_connections,
            ),
            remote_terminals,
            directories,
            editor: FileEditorService::new(providers.clone(), audit_log_path.clone()),
            providers,
            archive_provider,
            events: events.clone(),
            settings_store: settings_store.clone(),
            settings: settings_mutex.clone(),
            plugin_manager: PluginManager::new(
                PluginDiscovery::new(settings_directory.join("plugins")).with_bundled_directory(
                    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../plugins"),
                ),
                PluginRuntime::default(),
                settings_mutex,
                settings_store.clone(),
                events.clone(),
            ),
            operations: Scheduler::new(operation_concurrency, events)
                .with_observer(operation_observer),
            operation_history,
            planner,
            operation_idempotency: Mutex::new(HashMap::new()),
            force_cross_volume_moves,
            actions: ActionRegistry::with_core_actions(platform_capabilities),
            search,
            comparison,
            comparison_store,
            thumbnails: ThumbnailService::new(settings_directory.join("thumbnails")),
        }
    }

    /// Generates (or reuses a cached) downscaled preview for an image or
    /// CBZ/CBR comic archive entry (task 0134). `size` must be `"small"`,
    /// `"medium"` or `"large"`. Every unsupported/oversized/undecodable
    /// input is reported as [`ApplicationError::NotFound`], matching
    /// [`Self::file_icon`]'s convention - the frontend falls back to the
    /// generic type icon rather than treating it as a hard error.
    pub async fn thumbnail(&self, uri: &str, size: &str) -> Result<Vec<u8>, ApplicationError> {
        let location = Location::parse(uri)
            .map_err(|error| ApplicationError::InvalidRequest(format!("invalid `uri`: {error}")))?;
        let size = fm_metadata::ThumbnailSize::parse(size).ok_or_else(|| {
            ApplicationError::InvalidRequest(format!(
                "invalid `size`: must be `small`, `medium` or `large`, got {size:?}"
            ))
        })?;
        let thumbnail = self
            .thumbnails
            .thumbnail(&self.providers, &location, size)
            .await?;
        Ok(thumbnail.bytes)
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
        let executor = self.planner.plan(request.operation_type, &request)?;
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
    ///
    /// Searches and comparisons are not registered with the mutation
    /// [`Scheduler`], so an unknown id is retried against the search engine,
    /// then the comparison engine (both share their `operation_id` with
    /// their own id, see [`Self::start_search`] and
    /// [`Self::start_comparison`]) before giving up.
    pub fn cancel_operation(&self, id: OperationId) -> Result<(), ApplicationError> {
        match self.operations.cancel(id) {
            Ok(()) => Ok(()),
            Err(SchedulerError::UnknownOperation(_)) => self
                .search
                .cancel(id.into_inner())
                .or_else(|_| self.comparison.cancel(id.into_inner()).map_err(|_| ()))
                .map_err(|()| ApplicationError::NotFound),
            Err(error) => Err(map_scheduler_error(error)),
        }
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
        if request.resolution == ConflictResolutionDto::Confirm {
            return self.operations.confirm(id).map_err(map_scheduler_error);
        }
        let resolution = match request.resolution {
            ConflictResolutionDto::Skip => ConflictResolution::Skip,
            ConflictResolutionDto::Overwrite => ConflictResolution::Overwrite,
            ConflictResolutionDto::RenameNew => ConflictResolution::RenameNew,
            ConflictResolutionDto::Confirm | ConflictResolutionDto::CancelOperation => {
                unreachable!("handled above")
            }
        };
        self.operations
            .resolve_conflict(id, resolution, request.apply_to_all_similar)
            .map_err(map_scheduler_error)
    }

    /// Lists every registered action (spec §18).
    #[must_use]
    pub fn list_actions(&self) -> Vec<ActionDescriptorDto> {
        let mut actions = self.actions.list();
        let plugin_actions = self.plugin_manager.list_plugin_actions();
        for (descriptor, _, _) in plugin_actions {
            actions.push(descriptor);
        }
        actions.sort_by(|left, right| left.id.cmp(&right.id));
        actions.into_iter().map(Into::into).collect()
    }

    /// Lists discovered plugins, retaining malformed manifests as disabled records.
    #[must_use]
    pub fn list_plugins(&self) -> Vec<PluginDescriptorDto> {
        self.plugin_manager.list_plugins()
    }

    /// Reads one asset referenced by an enabled plugin's icon theme (task 0095), rejecting any
    /// path that is not exactly one of the theme's declared icon definitions and any path that
    /// escapes the plugin's own directory.
    pub fn plugin_icon_theme_asset(
        &self,
        plugin_id: &str,
        asset_path: &str,
    ) -> Result<String, ApplicationError> {
        self.plugin_manager
            .plugin_icon_theme_asset(plugin_id, asset_path)
    }

    /// Returns the bounded diagnostic log retained for one plugin (spec §19.4).
    pub fn plugin_logs(&self, plugin_id: &str) -> Result<Vec<PluginLogEntryDto>, ApplicationError> {
        self.plugin_manager.plugin_logs(plugin_id)
    }

    /// Persists a plugin enablement decision after confirming its manifest is valid.
    pub fn set_plugin_enabled(
        &self,
        plugin_id: String,
        enabled: bool,
    ) -> Result<(), ApplicationError> {
        self.plugin_manager.set_plugin_enabled(plugin_id, enabled)
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

        if let Some((manifest, directory, descriptor)) =
            self.plugin_manager.find_plugin_action(&action_id)
        {
            if !descriptor.context_requirements.is_satisfied_by(&context) {
                return Err(ApplicationError::ActionUnavailable(action_id));
            }
            return self.plugin_manager.invoke_plugin_action(
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

    /// Dispatches `core.open`/`core.openWith`/`core.view`/`core.edit`/
    /// `core.revealInSystemFileManager`/`core.openTerminal` directly to the
    /// injected platform adapter (task 0061), rather than through the
    /// operation engine.
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
            PlatformActionKind::OpenWithChooser => self.platform.open_with_chooser(&path),
            PlatformActionKind::Reveal => self.platform.reveal_in_file_manager(&path),
            PlatformActionKind::EditInTextEditor => {
                let command_override = self
                    .settings
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .editor_command
                    .clone();
                self.platform
                    .open_in_text_editor(&path, command_override.as_deref())
            }
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

    /// Supplies an archive credential to the backend-session cache.
    ///
    /// The secret is passed directly to the provider and is never added to operation history or
    /// an event payload.
    pub fn cache_archive_password(
        &self,
        request: fm_transport_dto::ArchiveCredentialRequestDto,
    ) -> Result<(), ApplicationError> {
        self.archive_provider
            .cache_password(&Location::from(request.location), request.password)
            .map_err(ApplicationError::from)
    }

    /// Lists one page of a directory.
    pub async fn list_directory(
        &self,
        request: ListDirectoryRequest,
    ) -> Result<DirectorySnapshotDto, ApplicationError> {
        let snapshot = self.directories.list(request).await?;
        Ok(self.enrich_snapshot(snapshot).await)
    }

    /// Refreshes a directory using the same options as a listing.
    pub async fn refresh_directory(
        &self,
        request: ListDirectoryRequest,
    ) -> Result<DirectorySnapshotDto, ApplicationError> {
        let snapshot = self.directories.refresh(request).await?;
        Ok(self.enrich_snapshot(snapshot).await)
    }

    /// Navigates a pane and lists its first page.
    pub async fn navigate_pane(
        &self,
        request: NavigateRequest,
    ) -> Result<DirectorySnapshotDto, ApplicationError> {
        let snapshot = self.directories.navigate(request).await?;
        Ok(self.enrich_snapshot(snapshot).await)
    }

    /// Marks whether a pane is currently in the foreground, so a
    /// poll-tracked directory watch can poll less often while backgrounded
    /// (task 0109).
    pub async fn set_pane_activity(
        &self,
        request: SetPaneActivityRequest,
    ) -> Result<(), ApplicationError> {
        self.directories
            .set_pane_activity(PaneId::from(request.pane_id), request.active)
            .await
    }

    /// Converts a domain snapshot to its wire DTO, attaching the backing
    /// volume's total/available capacity (task 0096) when the platform
    /// adapter and location support it.
    async fn enrich_snapshot(&self, snapshot: DirectorySnapshot) -> DirectorySnapshotDto {
        let volume_capacity = volume_capacity(&self.platform, &snapshot.location).await;
        DirectorySnapshotDto {
            volume_capacity,
            ..DirectorySnapshotDto::from(snapshot)
        }
    }

    /// Fetches detailed metadata for one entry.
    pub async fn get_entry_metadata(
        &self,
        request: EntryMetadataRequest,
    ) -> Result<EntryMetadata, ApplicationError> {
        self.directories.metadata(request).await
    }

    /// Reads one bounded chunk of a file's raw bytes, for the in-app large
    /// file viewer (task 0088).
    pub async fn read_file_range(
        &self,
        request: ReadFileRangeRequestDto,
    ) -> Result<ReadFileRangeResponseDto, ApplicationError> {
        content_streaming::read_file_range(&self.providers, request).await
    }

    /// Loads a complete text file only when it fits the bounded editor budget.
    pub async fn load_editable_file(
        &self,
        request: fm_transport_dto::LoadEditableFileRequestDto,
    ) -> Result<fm_transport_dto::LoadEditableFileResponseDto, ApplicationError> {
        self.editor.load(request).await
    }

    /// Safely replaces editable content through a sibling temporary file and optimistic revision.
    pub async fn save_editable_file(
        &self,
        request: fm_transport_dto::SaveEditableFileRequestDto,
    ) -> Result<fm_transport_dto::SaveEditableFileResponseDto, ApplicationError> {
        self.editor.save(request).await
    }

    /// Searches a single file's content for a substring or regex, for the
    /// in-app large file viewer (task 0088). Only requires
    /// [`ProviderCapabilities::READ`], so it works for every provider.
    pub async fn search_in_file(
        &self,
        request: SearchInFileRequestDto,
    ) -> Result<SearchInFileResponseDto, ApplicationError> {
        content_streaming::search_in_file(&self.providers, request).await
    }

    /// Recursively sums a directory's total size (task 0071), for the Total Commander-style
    /// "press a key on a folder to see how much space it consumes" behaviour. Provider-agnostic -
    /// works for any location whose provider reports `ProviderCapabilities::LIST`.
    pub async fn calculate_folder_size(
        &self,
        request: fm_transport_dto::CalculateFolderSizeRequestDto,
    ) -> Result<fm_transport_dto::CalculateFolderSizeResponseDto, ApplicationError> {
        crate::folder_size::calculate_folder_size(&self.providers, request.location.into()).await
    }

    /// Starts a cancellable recursive filename search over one or more
    /// roots, streaming matches to `request.workspace_id` over the event
    /// bus as they are found (spec §24, task 0068).
    pub fn start_search(
        &self,
        request: StartSearchRequestDto,
    ) -> Result<StartSearchResponseDto, ApplicationError> {
        let roots: Vec<Location> = request.roots.into_iter().map(Into::into).collect();
        let content_query = request
            .content_query
            .as_ref()
            .map(|q| {
                fm_vfs::ContentQuery::new(
                    q,
                    request.content_regex,
                    request.content_case_sensitive,
                    request.content_whole_word,
                )
                .map_err(|e| ApplicationError::InvalidRequest(e.to_string()))
            })
            .transpose()?;
        // The search id doubles as the operation id (see `SearchEngine::start`),
        // so the generic `/operations/{id}/cancel` route can cancel a search.
        let search_id = Uuid::new_v4();
        let operation_id = OperationId::from(search_id);
        let audience = EventAudience::Workspace(request.workspace_id.into());

        // Emit operation.created so the operation centre tracks this search.
        let op_payload = OperationPayload {
            id: operation_id,
            kind: OperationKindPayload::Search,
            state: OperationStatePayload::Running,
            sources: roots
                .iter()
                .map(|loc| EntryRefPayload {
                    id: EntryId::from(operation_id.into_inner()),
                    location: loc.clone().into(),
                })
                .collect(),
            destination: None,
            progress: OperationProgressDetails {
                completed_items: 0,
                total_items: None,
                completed_bytes: 0,
                total_bytes: None,
                current_entry: None,
                bytes_per_second: None,
            },
            conflict_policy: ConflictPolicyPayload::Ask,
            created_at: chrono::Utc::now(),
            started_at: None,
            completed_at: None,
        };
        self.events.publish(
            audience.clone(),
            BackendEventPayload::OperationCreated {
                operation: op_payload,
            },
        );

        let options = fm_search::SearchOptions {
            filename_query: request.query,
            content_query,
            recurse: request.recurse,
            show_hidden: request.show_hidden,
            operation_id: Some(operation_id),
        };
        let location = self
            .search
            .start(search_id, roots, options, audience)
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

    /// Starts a new cancellable directory comparison, streaming compared
    /// entries to `request.workspace_id` over the event bus as they are
    /// found (spec §16 milestone 5, task 0075).
    pub fn start_comparison(
        &self,
        request: StartComparisonRequestDto,
    ) -> Result<StartComparisonResponseDto, ApplicationError> {
        let left: Location = request.left.into();
        let right: Location = request.right.into();
        let criteria = comparison_criteria(request.criteria);
        // The comparison id doubles as the operation id (mirrors
        // `start_search`), so the generic `/operations/{id}/cancel` route
        // and the operation centre can address a running comparison without
        // a separate id space.
        let comparison_id = Uuid::new_v4();
        let operation_id = OperationId::from(comparison_id);
        let audience = EventAudience::Workspace(request.workspace_id.into());

        // Emit operation.created so the operation centre tracks this comparison.
        let op_payload = OperationPayload {
            id: operation_id,
            kind: OperationKindPayload::Compare,
            state: OperationStatePayload::Running,
            sources: vec![EntryRefPayload {
                id: EntryId::from(operation_id.into_inner()),
                location: left.clone().into(),
            }],
            destination: Some(right.clone().into()),
            progress: OperationProgressDetails {
                completed_items: 0,
                total_items: None,
                completed_bytes: 0,
                total_bytes: None,
                current_entry: None,
                bytes_per_second: None,
            },
            conflict_policy: ConflictPolicyPayload::Ask,
            created_at: chrono::Utc::now(),
            started_at: None,
            completed_at: None,
        };
        self.events.publish(
            audience.clone(),
            BackendEventPayload::OperationCreated {
                operation: op_payload,
            },
        );

        let options = fm_comparison::ComparisonOptions {
            criteria,
            show_hidden: request.show_hidden,
            operation_id: Some(operation_id),
        };
        self.comparison
            .start(comparison_id, left, right, options, audience)
            .map_err(|error| ApplicationError::InvalidRequest(error.to_string()))?;
        Ok(StartComparisonResponseDto { comparison_id })
    }

    /// Cancels a running comparison, stopping its traversal promptly.
    pub fn cancel_comparison(&self, comparison_id: Uuid) -> Result<(), ApplicationError> {
        self.comparison
            .cancel(comparison_id)
            .map_err(|_| ApplicationError::NotFound)
    }

    /// Returns a bounded page of a comparison's results, optionally
    /// restricted to non-identical entries (spec §16 milestone 5: "can be
    /// filtered to differences only").
    pub fn get_comparison_page(
        &self,
        comparison_id: Uuid,
        offset: u64,
        limit: u16,
        differences_only: bool,
    ) -> Result<ComparisonPageDto, ApplicationError> {
        let limit = limit.clamp(1, 500);
        let page = self
            .comparison_store
            .page(
                comparison_id,
                usize::try_from(offset).unwrap_or(usize::MAX),
                usize::from(limit),
                differences_only,
            )
            .ok_or(ApplicationError::NotFound)?;
        Ok(ComparisonPageDto {
            comparison_id,
            left: page.left_root.into(),
            right: page.right_root.into(),
            criteria: comparison_criteria_dto(page.criteria),
            offset,
            limit,
            total: u64::try_from(page.total).unwrap_or(u64::MAX),
            entries: page.entries.iter().map(comparison_entry_dto).collect(),
            is_complete: page.is_complete,
            warnings_count: page.warnings_count,
        })
    }

    /// Proposes a sync plan from a comparison's current results. Never
    /// touches a filesystem (spec §35): it only reads the comparison's
    /// already-computed results.
    pub fn generate_sync_plan(
        &self,
        comparison_id: Uuid,
        request: GenerateSyncPlanRequestDto,
    ) -> Result<SyncPlanDto, ApplicationError> {
        let entries = self
            .comparison_store
            .all_entries(comparison_id)
            .ok_or(ApplicationError::NotFound)?;
        let mode = sync_mode(request.mode);
        let items = compute_sync_plan(&entries, mode);
        Ok(SyncPlanDto {
            comparison_id,
            items: items.iter().map(sync_plan_item_dto).collect(),
        })
    }

    /// Applies a (possibly user-edited) sync plan: every non-`skip` row
    /// starts one ordinary `copy` or `trash` operation through the existing
    /// operation engine, with the normal conflict, progress and
    /// cancellation semantics (spec §35: nothing runs without this explicit,
    /// reviewed call).
    pub fn apply_sync_plan(
        &self,
        comparison_id: Uuid,
        request: ApplySyncPlanRequestDto,
    ) -> Result<ApplySyncPlanResponseDto, ApplicationError> {
        let (left_root, right_root) = self
            .comparison_store
            .roots(comparison_id)
            .ok_or(ApplicationError::NotFound)?;
        let mut operation_ids = Vec::with_capacity(request.items.len());
        for item in request.items {
            let start_request = match sync_action(item.action) {
                SyncAction::Skip => continue,
                SyncAction::CopyLeftToRight => {
                    copy_request(&left_root, &right_root, &item.relative_path)?
                }
                SyncAction::CopyRightToLeft => {
                    copy_request(&right_root, &left_root, &item.relative_path)?
                }
                SyncAction::DeleteLeft => delete_request(&left_root, &item.relative_path)?,
                SyncAction::DeleteRight => delete_request(&right_root, &item.relative_path)?,
            };
            let operation = self.start_operation(start_request, None)?;
            operation_ids.push(operation.id);
        }
        Ok(ApplySyncPlanResponseDto { operation_ids })
    }

    /// Reports which capabilities are available for the current runtime and
    /// platform, so the frontend can respond to capabilities rather than
    /// detecting operating systems itself (spec §21).
    pub fn runtime_capabilities(&self) -> RuntimeCapabilitiesDto {
        runtime_capabilities_dto(self.runtime, self.platform.capabilities())
    }

    /// Returns the active platform adapter's PNG icon for one sample entry.
    /// The adapter owns extension-level caching; this service deliberately
    /// adds no second cache layer (task 0091).
    pub fn file_icon(&self, uri: &str) -> Result<Vec<u8>, ApplicationError> {
        let path = Location::parse(uri)
            .and_then(|location| location.to_native_path())
            .map_err(|error| ApplicationError::InvalidRequest(format!("invalid `uri`: {error}")))?;
        self.platform.file_icon(&path).map_err(map_file_icon_error)
    }

    /// Installs the native menu bar from `spec` (task 0133), a thin
    /// passthrough to the platform adapter. `on_action` is invoked whenever
    /// the user clicks a `NativeMenuItem::Action` item, with that item's
    /// action-registry id, so the caller can dispatch it exactly like an
    /// `invoke_action` call from the keyboard.
    pub fn install_native_menu(
        &self,
        spec: &fm_domain::NativeMenuSpec,
        on_action: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<(), ApplicationError> {
        self.platform
            .install_native_menu(spec, on_action)
            .map_err(map_native_menu_error)
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

    /// Lists every stored connection profile with its current runtime status
    /// (spec §16 `GET /api/v1/connections`, task 0103).
    pub async fn list_connections(&self) -> Result<Vec<ConnectionDto>, ApplicationError> {
        self.connections.list_connections().await
    }

    /// Loads a single connection profile with its current runtime status
    /// (spec §16 `GET /api/v1/connections/{connectionId}`, task 0103).
    pub async fn get_connection(&self, id: Uuid) -> Result<ConnectionDto, ApplicationError> {
        self.connections.get_connection(id).await
    }

    /// Creates and persists a new connection profile (spec §16
    /// `POST /api/v1/connections`, task 0103).
    pub async fn create_connection(
        &self,
        request: CreateConnectionRequestDto,
    ) -> Result<ConnectionDto, ApplicationError> {
        self.connections.create_connection(request).await
    }

    /// Updates an existing connection profile, optionally replacing its
    /// stored credential (spec §16 `PUT /api/v1/connections/{connectionId}`,
    /// task 0103).
    pub async fn update_connection(
        &self,
        id: Uuid,
        request: UpdateConnectionRequestDto,
    ) -> Result<ConnectionDto, ApplicationError> {
        self.connections.update_connection(id, request).await
    }

    /// Deletes a connection profile and its stored credential, if any (spec
    /// §16 `DELETE /api/v1/connections/{connectionId}`, task 0103).
    pub async fn delete_connection(&self, id: Uuid) -> Result<(), ApplicationError> {
        self.connections.delete_connection(id).await
    }

    /// Attempts to connect (spec §16
    /// `POST /api/v1/connections/{connectionId}/connect`, task 0103).
    pub async fn connect_connection(&self, id: Uuid) -> Result<ConnectionDto, ApplicationError> {
        self.connections.connect_connection(id).await
    }

    /// Marks a connection as disconnected (spec §16
    /// `POST /api/v1/connections/{connectionId}/disconnect`, task 0103).
    pub async fn disconnect_connection(&self, id: Uuid) -> Result<ConnectionDto, ApplicationError> {
        self.connections.disconnect_connection(id).await
    }

    /// Checks whether a connection's configuration and credential are
    /// currently usable, without changing its tracked status (spec §16
    /// `POST /api/v1/connections/{connectionId}/test`, task 0103).
    pub async fn test_connection(&self, id: Uuid) -> Result<ConnectionDto, ApplicationError> {
        self.connections.test_connection(id).await
    }

    /// Probes an SSH connection's currently presented host key without
    /// authenticating (task 0104, spec §6.4's mandatory explicit
    /// confirmation flow).
    pub async fn probe_ssh_host_key(
        &self,
        id: Uuid,
    ) -> Result<fm_transport_dto::HostKeyProbeDto, ApplicationError> {
        self.connections.probe_ssh_host_key(id).await
    }

    /// Accepts (persists) a host-key fingerprint for an SSH connection (task
    /// 0104, spec §6.4) - the only path that ever writes to the known-hosts
    /// store, and only after re-probing to confirm the host is still
    /// presenting exactly the fingerprint being accepted (defense against
    /// confirming a stale or attacker-supplied value passed by a caller).
    ///
    /// A connection configured with
    /// [`fm_connections::HostKeyPolicy::RequireKnownHost`] refuses to
    /// establish first-time trust through this call (it only ever succeeds
    /// once a fingerprint is already known by some other means); it may
    /// still be used to re-confirm a changed key that was previously known.
    pub async fn accept_ssh_host_key(
        &self,
        id: Uuid,
        fingerprint: String,
    ) -> Result<(), ApplicationError> {
        self.connections.accept_ssh_host_key(id, fingerprint).await
    }

    /// Opens an interactive remote shell channel on an SSH connection for
    /// the embedded terminal drawer (task 0105, extending task 0126),
    /// starting in `remote_path` if given.
    ///
    /// Reuses the same pooled SSH session an open SFTP browse for
    /// `connection_id` already established rather than dialing again, and
    /// reports [`ApplicationError::InvalidRequest`] (not a silent local
    /// fallback) if `connection_id` does not name an SSH connection.
    pub async fn open_remote_shell(
        &self,
        connection_id: Uuid,
        remote_path: Option<&str>,
        term: &str,
        cols: u16,
        rows: u16,
    ) -> Result<fm_ssh::RemoteShellChannel, ApplicationError> {
        self.remote_terminals
            .open_shell(connection_id, remote_path, term, cols, rows)
            .await
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    use fm_events::{SessionId, SubscriptionEvent};
    use fm_transport_dto::{
        LoadEditableFileRequestDto, OperationKindDto, OperationStateDto, PlatformKindDto,
        SaveEditableFileRequestDto,
    };

    use fm_platform::PlatformCapabilities;

    use crate::content_streaming::MAX_RANGE_LENGTH;
    use crate::file_editor::MAX_EDITABLE_FILE_BYTES;
    use crate::platform_mapping::detect_platform;

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
        std::fs::create_dir_all(&settings_directory).expect("must create settings directory");
        let mut operation = Operation::new(
            fm_operations::OperationKind::Copy,
            vec![],
            None,
            fm_operations::ConflictPolicy::Ask,
        );
        operation
            .transition(fm_operations::OperationState::Planning)
            .expect("queued operation starts planning");
        std::fs::write(
            settings_directory.join(crate::operation_history::OPERATION_HISTORY_FILE_NAME),
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

    fn location_dto_for(path: &std::path::Path) -> fm_transport_dto::LocationDto {
        Location::from_native_path(path)
            .expect("path must convert to a location")
            .into()
    }

    #[tokio::test]
    async fn read_file_range_reads_the_requested_bytes_at_an_offset() {
        let (dir, service) = service();
        let target = dir.path().join("report.txt");
        std::fs::write(&target, b"0123456789").expect("write fixture file");

        let response = service
            .read_file_range(ReadFileRangeRequestDto {
                location: location_dto_for(&target),
                offset: 4,
                length: 3,
            })
            .await
            .expect("range read must succeed");

        assert_eq!(response.data, b"456");
        assert_eq!(response.offset, 4);
        assert_eq!(response.length, 3);
        assert!(!response.eof);
        assert_eq!(response.probably_binary, None);
    }

    #[tokio::test]
    async fn read_file_range_reports_eof_and_sniffs_binary_only_at_offset_zero() {
        let (dir, service) = service();
        let target = dir.path().join("short.bin");
        std::fs::write(&target, [b'a', b'b', 0, b'c']).expect("write fixture file");

        let first_chunk = service
            .read_file_range(ReadFileRangeRequestDto {
                location: location_dto_for(&target),
                offset: 0,
                length: 1000,
            })
            .await
            .expect("range read must succeed");
        assert_eq!(first_chunk.data, [b'a', b'b', 0, b'c']);
        assert!(first_chunk.eof);
        assert_eq!(first_chunk.probably_binary, Some(true));

        let later_chunk = service
            .read_file_range(ReadFileRangeRequestDto {
                location: location_dto_for(&target),
                offset: 2,
                length: 2,
            })
            .await
            .expect("range read must succeed");
        assert_eq!(later_chunk.probably_binary, None);
    }

    #[tokio::test]
    async fn read_file_range_rejects_a_zero_or_oversized_length() {
        let (dir, service) = service();
        let target = dir.path().join("report.txt");
        std::fs::write(&target, b"contents").expect("write fixture file");

        assert!(matches!(
            service
                .read_file_range(ReadFileRangeRequestDto {
                    location: location_dto_for(&target),
                    offset: 0,
                    length: 0,
                })
                .await,
            Err(ApplicationError::InvalidRequest(_))
        ));
        assert!(matches!(
            service
                .read_file_range(ReadFileRangeRequestDto {
                    location: location_dto_for(&target),
                    offset: 0,
                    length: MAX_RANGE_LENGTH + 1,
                })
                .await,
            Err(ApplicationError::InvalidRequest(_))
        ));
    }

    #[tokio::test]
    async fn editable_file_save_uses_revision_and_preserves_external_changes() {
        let (dir, service) = service();
        let target = dir.path().join("note.json");
        std::fs::write(&target, b"{\"value\":1}").expect("write fixture file");
        let location = location_dto_for(&target);
        let loaded = service
            .load_editable_file(LoadEditableFileRequestDto {
                location: location.clone(),
            })
            .await
            .expect("editable load must succeed");
        assert_eq!(loaded.content, "{\"value\":1}");

        std::fs::write(&target, b"external").expect("simulate external edit");
        let result = service
            .save_editable_file(SaveEditableFileRequestDto {
                location,
                destination: None,
                content: "editor".to_owned(),
                expected_revision: loaded.revision,
                overwrite_conflict: false,
            })
            .await;
        assert!(matches!(
            result,
            Err(ApplicationError::FileRevisionConflict { .. })
        ));
        assert_eq!(
            std::fs::read_to_string(&target).expect("read target"),
            "external"
        );
    }

    #[tokio::test]
    async fn editable_file_explicit_overwrite_is_reported_and_audited() {
        let (dir, service) = service();
        let target = dir.path().join("note.txt");
        std::fs::write(&target, b"one").expect("write fixture file");
        let location = location_dto_for(&target);
        let loaded = service
            .load_editable_file(LoadEditableFileRequestDto {
                location: location.clone(),
            })
            .await
            .expect("load");
        std::fs::write(&target, b"two").expect("external edit");
        let saved = service
            .save_editable_file(SaveEditableFileRequestDto {
                location,
                destination: None,
                content: "three".to_owned(),
                expected_revision: loaded.revision,
                overwrite_conflict: true,
            })
            .await
            .expect("explicit overwrite");
        assert!(saved.overwrote_conflict);
        assert_eq!(
            std::fs::read_to_string(&target).expect("read target"),
            "three"
        );
        let audit =
            std::fs::read_to_string(dir.path().join("settings/audit.jsonl")).expect("audit log");
        assert!(audit.contains("note.txt"));
    }

    #[tokio::test]
    async fn editable_file_load_rejects_binary_and_oversized_files() {
        let (dir, service) = service();
        let binary = dir.path().join("binary.txt");
        std::fs::write(&binary, [1, 0, 2]).expect("write binary fixture");
        assert!(
            service
                .load_editable_file(LoadEditableFileRequestDto {
                    location: location_dto_for(&binary)
                })
                .await
                .is_err()
        );
        let large = dir.path().join("large.txt");
        std::fs::File::create(&large)
            .expect("create large fixture")
            .set_len(MAX_EDITABLE_FILE_BYTES + 1)
            .expect("size fixture");
        assert!(matches!(
            service
                .load_editable_file(LoadEditableFileRequestDto {
                    location: location_dto_for(&large)
                })
                .await,
            Err(ApplicationError::InvalidRequest(_))
        ));
    }

    #[tokio::test]
    async fn editable_file_save_as_creates_a_sibling_without_changing_the_source() {
        let (dir, service) = service();
        let source = dir.path().join("source.txt");
        let destination = dir.path().join("copy.txt");
        std::fs::write(&source, b"source").expect("write fixture");
        let location = location_dto_for(&source);
        let loaded = service
            .load_editable_file(LoadEditableFileRequestDto {
                location: location.clone(),
            })
            .await
            .expect("load");
        service
            .save_editable_file(SaveEditableFileRequestDto {
                location,
                destination: Some(location_dto_for(&destination)),
                content: "copy".to_owned(),
                expected_revision: loaded.revision,
                overwrite_conflict: false,
            })
            .await
            .expect("save as");
        assert_eq!(std::fs::read_to_string(source).expect("source"), "source");
        assert_eq!(
            std::fs::read_to_string(destination).expect("destination"),
            "copy"
        );
    }

    #[tokio::test]
    async fn search_in_file_finds_substring_matches_across_lines() {
        let (dir, service) = service();
        let target = dir.path().join("log.txt");
        std::fs::write(
            &target,
            b"first line\nsecond ERROR line\nthird error line\n",
        )
        .expect("write fixture file");

        let response = service
            .search_in_file(SearchInFileRequestDto {
                location: location_dto_for(&target),
                query: "error".to_owned(),
                regex: false,
                case_sensitive: false,
                whole_word: false,
            })
            .await
            .expect("search must succeed");

        assert_eq!(response.matches.len(), 2);
        assert_eq!(response.matches[0].line_number, 2);
        assert_eq!(response.matches[1].line_number, 3);
        assert!(!response.truncated);
    }

    #[tokio::test]
    async fn search_in_file_whole_word_excludes_matches_inside_a_larger_word() {
        let (dir, service) = service();
        let target = dir.path().join("log.txt");
        std::fs::write(&target, b"cat concatenate cats\n").expect("write fixture file");

        let response = service
            .search_in_file(SearchInFileRequestDto {
                location: location_dto_for(&target),
                query: "cat".to_owned(),
                regex: false,
                case_sensitive: false,
                whole_word: true,
            })
            .await
            .expect("search must succeed");

        assert_eq!(response.matches.len(), 1);
        assert_eq!(response.matches[0].offset, 0);
    }

    #[tokio::test]
    async fn search_in_file_rejects_an_invalid_regex() {
        let (dir, service) = service();
        let target = dir.path().join("log.txt");
        std::fs::write(&target, b"contents").expect("write fixture file");

        assert!(matches!(
            service
                .search_in_file(SearchInFileRequestDto {
                    location: location_dto_for(&target),
                    query: "(unclosed".to_owned(),
                    regex: true,
                    case_sensitive: false,
                    whole_word: false,
                })
                .await,
            Err(ApplicationError::InvalidRequest(_))
        ));
    }

    #[tokio::test]
    async fn calculate_folder_size_sums_nested_files_recursively() {
        let (dir, service) = service();
        // A dedicated subdirectory, isolated from whatever `service()` itself writes into the
        // temp dir's root (e.g. its settings file), so the walk only ever sees this test's fixtures.
        let root = dir.path().join("root");
        std::fs::create_dir(&root).expect("create root dir");
        std::fs::write(root.join("top.txt"), [0_u8; 10]).expect("write top-level fixture");
        let nested = root.join("nested");
        std::fs::create_dir(&nested).expect("create nested dir");
        std::fs::write(nested.join("a.txt"), [0_u8; 20]).expect("write nested fixture a");
        std::fs::write(nested.join("b.txt"), [0_u8; 5]).expect("write nested fixture b");
        let deeper = nested.join("deeper");
        std::fs::create_dir(&deeper).expect("create deeper dir");
        std::fs::write(deeper.join("c.txt"), [0_u8; 7]).expect("write deeper fixture c");

        let response = service
            .calculate_folder_size(fm_transport_dto::CalculateFolderSizeRequestDto {
                location: location_dto_for(&root),
            })
            .await
            .expect("calculate_folder_size must succeed");

        assert_eq!(response.total_bytes, 10 + 20 + 5 + 7);
        assert_eq!(response.file_count, 4);
    }

    #[tokio::test]
    async fn calculate_folder_size_reports_not_found_for_a_missing_directory() {
        let (dir, service) = service();
        let missing = dir.path().join("does-not-exist");

        let result = service
            .calculate_folder_size(fm_transport_dto::CalculateFolderSizeRequestDto {
                location: location_dto_for(&missing),
            })
            .await;

        assert!(result.is_err());
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

    /// A platform adapter test double reporting a fixed volume capacity
    /// (task 0096), so `list_directory` tests can distinguish "the service
    /// actually calls into the adapter and forwards its result" from a
    /// coincidentally-passing empty default.
    #[derive(Debug, Clone, Copy)]
    struct VolumeCapacityPlatformAdapter {
        capabilities: PlatformCapabilities,
    }

    impl fm_platform::PlatformAdapter for VolumeCapacityPlatformAdapter {
        fn capabilities(&self) -> PlatformCapabilities {
            self.capabilities
        }

        fn volume_capacity(
            &self,
            _path: &Path,
        ) -> Result<fm_platform::VolumeCapacity, fm_platform::PlatformError> {
            Ok(fm_platform::VolumeCapacity {
                total_bytes: 1_000_000_000_000,
                available_bytes: 616_040_000_000,
            })
        }
    }

    fn list_directory_request(location: Location) -> ListDirectoryRequest {
        ListDirectoryRequest {
            workspace_id: fm_domain::WorkspaceId::new().into(),
            pane_id: fm_domain::PaneId::new().into(),
            request_id: Uuid::new_v4(),
            location: location.into(),
            continuation_token: None,
            sort: Vec::new(),
            show_hidden: false,
            folders_first: true,
        }
    }

    #[tokio::test]
    async fn list_directory_attaches_volume_capacity_when_the_platform_adapter_supports_it() {
        let dir = tempfile::tempdir().expect("must create a temp dir");
        let service = FileManagerService::with_platform_adapter(
            RuntimeKindDto::BrowserServer,
            dir.path(),
            dir.path().join("settings"),
            EventBus::default(),
            Arc::new(VolumeCapacityPlatformAdapter {
                capabilities: PlatformCapabilities::VOLUME_CAPACITY,
            }),
        );
        let location = Location::from_native_path(dir.path()).expect("native path location");

        let snapshot = service
            .list_directory(list_directory_request(location))
            .await
            .expect("list directory");

        let capacity = snapshot
            .volume_capacity
            .expect("volume capacity must be attached");
        assert_eq!(capacity.total_bytes, 1_000_000_000_000);
        assert_eq!(capacity.available_bytes, 616_040_000_000);
    }

    #[tokio::test]
    async fn list_directory_omits_volume_capacity_when_the_adapter_lacks_the_capability() {
        let dir = tempfile::tempdir().expect("must create a temp dir");
        let service = FileManagerService::with_platform_adapter(
            RuntimeKindDto::BrowserServer,
            dir.path(),
            dir.path().join("settings"),
            EventBus::default(),
            Arc::new(VolumeCapacityPlatformAdapter {
                capabilities: PlatformCapabilities::empty(),
            }),
        );
        let location = Location::from_native_path(dir.path()).expect("native path location");

        let snapshot = service
            .list_directory(list_directory_request(location))
            .await
            .expect("list directory");

        assert!(snapshot.volume_capacity.is_none());
    }

    #[tokio::test]
    async fn list_directory_omits_volume_capacity_for_a_non_local_location() {
        let dir = tempfile::tempdir().expect("must create a temp dir");
        let service = FileManagerService::with_platform_adapter(
            RuntimeKindDto::BrowserServer,
            dir.path(),
            dir.path().join("settings"),
            EventBus::default(),
            Arc::new(VolumeCapacityPlatformAdapter {
                capabilities: PlatformCapabilities::VOLUME_CAPACITY,
            }),
        );
        // A search location has no backing native path, so capacity lookup must
        // degrade gracefully rather than erroring the whole listing.
        let location = Location::new(
            fm_domain::ProviderId::new("search"),
            "search://local/example-search",
        );

        let capacity = volume_capacity(&service.platform, &location).await;

        assert!(capacity.is_none());
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
        opened_with_chooser: Mutex<Vec<PathBuf>>,
        revealed: Mutex<Vec<PathBuf>>,
        terminals: Mutex<Vec<(PathBuf, Option<String>)>>,
        edited: Mutex<Vec<(PathBuf, Option<String>)>>,
        trashed: Mutex<Vec<PathBuf>>,
        open_error: Mutex<Option<fm_platform::PlatformError>>,
        trash_error: Mutex<Option<fm_platform::PlatformError>>,
        installed_menus: Mutex<Vec<fm_domain::NativeMenuSpec>>,
        install_native_menu_error: Mutex<Option<fm_platform::PlatformError>>,
    }

    impl RecordingPlatformAdapter {
        fn new(capabilities: PlatformCapabilities) -> Self {
            Self {
                capabilities,
                opened: Mutex::new(Vec::new()),
                opened_with_chooser: Mutex::new(Vec::new()),
                revealed: Mutex::new(Vec::new()),
                terminals: Mutex::new(Vec::new()),
                edited: Mutex::new(Vec::new()),
                trashed: Mutex::new(Vec::new()),
                open_error: Mutex::new(None),
                trash_error: Mutex::new(None),
                installed_menus: Mutex::new(Vec::new()),
                install_native_menu_error: Mutex::new(None),
            }
        }

        fn fail_next_open_with(&self, error: fm_platform::PlatformError) {
            *self.open_error.lock().expect("lock must not be poisoned") = Some(error);
        }

        fn fail_next_trash_with(&self, error: fm_platform::PlatformError) {
            *self.trash_error.lock().expect("lock must not be poisoned") = Some(error);
        }

        fn fail_next_install_native_menu_with(&self, error: fm_platform::PlatformError) {
            *self
                .install_native_menu_error
                .lock()
                .expect("lock must not be poisoned") = Some(error);
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

        fn open_in_text_editor(
            &self,
            path: &Path,
            command_override: Option<&str>,
        ) -> Result<(), fm_platform::PlatformError> {
            self.edited
                .lock()
                .expect("lock must not be poisoned")
                .push((path.to_path_buf(), command_override.map(str::to_owned)));
            Ok(())
        }

        fn open_with_chooser(&self, path: &Path) -> Result<(), fm_platform::PlatformError> {
            self.opened_with_chooser
                .lock()
                .expect("lock must not be poisoned")
                .push(path.to_path_buf());
            Ok(())
        }

        fn install_native_menu(
            &self,
            spec: &fm_domain::NativeMenuSpec,
            on_action: Arc<dyn Fn(String) + Send + Sync>,
        ) -> Result<(), fm_platform::PlatformError> {
            if let Some(error) = self
                .install_native_menu_error
                .lock()
                .expect("lock must not be poisoned")
                .take()
            {
                return Err(error);
            }
            self.installed_menus
                .lock()
                .expect("lock must not be poisoned")
                .push(spec.clone());
            // Exercises the wiring end to end: a real caller's `on_action`
            // would forward this to the frontend over a Tauri `Channel`.
            on_action("recorded-action-id".to_owned());
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

    #[test]
    fn invoke_action_views_the_uri_parameters_path_with_the_default_application() {
        // core.view (task 0087) is a documented stopgap that dispatches
        // exactly like core.open until a real in-app viewer (task 0088) exists.
        let (dir, service, adapter) = service_with_recording_adapter();
        let target = dir.path().join("report.pdf");
        let uri = Location::from_native_path(&target)
            .expect("path must convert to a location")
            .uri;

        service
            .invoke_action(
                "core.view".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(serde_json::json!({ "uri": uri })),
                    context: single_selection_context(),
                },
                None,
            )
            .expect("core.view must dispatch to the platform adapter");

        assert_eq!(adapter.opened.lock().unwrap().as_slice(), [target]);
    }

    #[test]
    fn invoke_action_open_with_shows_the_chooser_not_the_default_application() {
        // core.openWith (task 0061 follow-up) dispatches to the platform
        // adapter's distinct open_with_chooser method, not the same
        // open_with_default_application path as core.open/core.view.
        let (dir, service, adapter) = service_with_recording_adapter();
        let target = dir.path().join("report.pdf");
        let uri = Location::from_native_path(&target)
            .expect("path must convert to a location")
            .uri;

        service
            .invoke_action(
                "core.openWith".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(serde_json::json!({ "uri": uri })),
                    context: single_selection_context(),
                },
                None,
            )
            .expect("core.openWith must dispatch to the platform adapter");

        assert_eq!(
            adapter.opened_with_chooser.lock().unwrap().as_slice(),
            [target]
        );
        assert!(
            adapter.opened.lock().unwrap().is_empty(),
            "core.openWith must not dispatch through open_with_default_application"
        );
    }

    #[test]
    fn invoke_action_edit_opens_the_uri_parameters_path_in_a_text_editor() {
        let (dir, service, adapter) = service_with_recording_adapter();
        let target = dir.path().join("notes.txt");
        let uri = Location::from_native_path(&target)
            .expect("path must convert to a location")
            .uri;

        service
            .invoke_action(
                "core.edit".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(serde_json::json!({ "uri": uri })),
                    context: single_selection_context(),
                },
                None,
            )
            .expect("core.edit must dispatch to the platform adapter");

        assert_eq!(adapter.edited.lock().unwrap().as_slice(), [(target, None)]);
    }

    #[test]
    fn invoke_action_edit_forwards_the_configured_editor_command_override() {
        let (dir, service, adapter) = service_with_recording_adapter();
        let mut settings = service.get_settings();
        settings.editor_command = Some("code --wait".to_owned());
        service
            .update_settings(settings)
            .expect("settings update must succeed");
        let target = dir.path().join("notes.txt");
        let uri = Location::from_native_path(&target)
            .expect("path must convert to a location")
            .uri;

        service
            .invoke_action(
                "core.edit".to_owned(),
                InvokeActionRequestDto {
                    parameters: Some(serde_json::json!({ "uri": uri })),
                    context: single_selection_context(),
                },
                None,
            )
            .expect("core.edit must dispatch to the platform adapter");

        assert_eq!(
            adapter.edited.lock().unwrap().as_slice(),
            [(target, Some("code --wait".to_owned()))]
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
            destinations: vec![],
            conflict_policy: OperationConflictPolicyDto::Ask,
            name: None,
            archive_format: None,
            archive_compression_level: None,
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

    /// `install_native_menu` (task 0133) is a thin passthrough: it forwards
    /// the spec and callback unchanged to the platform adapter, and maps
    /// whatever failure the adapter reports to a user-readable
    /// `PlatformOperationFailed` error rather than swallowing it.
    #[test]
    fn install_native_menu_forwards_the_spec_and_maps_adapter_failures() {
        let (_dir, service, adapter) = service_with_recording_adapter();
        let spec = fm_domain::NativeMenuSpec {
            menus: vec![fm_domain::NativeMenu {
                title: "File".to_owned(),
                items: vec![fm_domain::NativeMenuItem::Action {
                    id: "core.newWindow".to_owned(),
                    title: "New Window".to_owned(),
                    shortcut: None,
                    enabled: true,
                    checked: false,
                }],
            }],
        };
        let received_ids = Arc::new(Mutex::new(Vec::new()));
        let received_ids_clone = Arc::clone(&received_ids);
        let on_action: Arc<dyn Fn(String) + Send + Sync> =
            Arc::new(move |id| received_ids_clone.lock().unwrap().push(id));

        service
            .install_native_menu(&spec, Arc::clone(&on_action))
            .expect("the recording adapter always succeeds by default");

        assert_eq!(
            adapter.installed_menus.lock().unwrap().as_slice(),
            std::slice::from_ref(&spec)
        );
        assert_eq!(
            received_ids.lock().unwrap().as_slice(),
            &["recorded-action-id".to_owned()]
        );

        adapter.fail_next_install_native_menu_with(fm_platform::PlatformError::Unsupported {
            capability: PlatformCapabilities::NATIVE_MENUS,
        });
        let error = service
            .install_native_menu(&spec, on_action)
            .expect_err("an adapter failure must be reported, not swallowed");
        assert_eq!(
            error.code(),
            fm_transport_dto::ApplicationErrorCode::PlatformOperationFailed
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

        for action_id in ["core.view", "core.edit"] {
            let error = service
                .invoke_action(
                    action_id.to_owned(),
                    InvokeActionRequestDto {
                        parameters: Some(serde_json::json!({ "uri": "file:///tmp/report.pdf" })),
                        context: context.clone(),
                    },
                    None,
                )
                .expect_err("view/edit have no native access in browser/server mode");
            assert_eq!(
                error.code(),
                fm_transport_dto::ApplicationErrorCode::ActionUnavailable
            );
        }
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
        std::fs::create_dir_all(&parent).expect("must create parent directory");
        let destination = fm_transport_dto::LocationDto {
            provider_id: "local".to_owned(),
            uri: Location::from_native_path(&parent)
                .expect("path must convert to a location")
                .uri,
        };
        let parameters = serde_json::to_value(StartOperationRequestDto {
            operation_type: OperationKindDto::CreateDirectory,
            sources: Vec::new(),
            destination: Some(destination),
            destinations: vec![],
            conflict_policy: OperationConflictPolicyDto::Ask,
            name: Some("child".to_owned()),
            archive_format: None,
            archive_compression_level: None,
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
