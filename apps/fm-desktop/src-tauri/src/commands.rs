//! Tauri commands: thin wrappers over `FileManagerService`, mirroring the
//! semantic REST API rather than reproducing HTTP concepts (spec §11).
//!
use tauri::ipc::Channel;
use tauri::{Runtime, State, Window};
use uuid::Uuid;

use fm_domain::OperationId;
use fm_transport_dto::{
    ActionDescriptorDto, ActionResultDto, ApplicationErrorDto, CreateWorkspaceRequestDto,
    DirectorySnapshotDto, EntryMetadataDto, EntryMetadataRequest, InvokeActionRequestDto,
    ListDirectoryRequest, NavigateRequest, OperationDto, PluginDescriptorDto, PluginLogEntryDto,
    ResolveOperationConflictRequestDto, RuntimeCapabilitiesDto, SettingsDto,
    StartOperationRequestDto, StartSearchRequestDto, StartSearchResponseDto, WorkspaceCommandDto,
    WorkspaceDto, WorkspaceSummaryDto,
};

use crate::{AppState, event_stream::EventSubscriptionRegistry};

/// Starts one ordered EventBus-to-IPC channel subscription for this window.
#[tauri::command]
pub(crate) fn subscribe_events<R: Runtime>(
    state: State<'_, AppState>,
    subscriptions: State<'_, EventSubscriptionRegistry>,
    window: Window<R>,
    on_event: Channel<String>,
) -> Uuid {
    let id = subscriptions.subscribe(
        state.service.event_bus(),
        window.label().to_owned(),
        on_event,
    );
    state.service.republish_pending_operation_conflicts();
    id
}

/// Releases a desktop event subscription created by [`subscribe_events`].
#[tauri::command]
pub(crate) fn unsubscribe_events(
    subscriptions: State<'_, EventSubscriptionRegistry>,
    subscription_id: Uuid,
) {
    subscriptions.unsubscribe(subscription_id);
}

/// Reports the capabilities available for the current runtime and platform
/// (spec §21), identical in shape to `GET /api/v1/runtime`.
#[tauri::command]
pub(crate) fn get_runtime_capabilities(state: State<'_, AppState>) -> RuntimeCapabilitiesDto {
    state.service.runtime_capabilities()
}

/// Returns the same settings document as `GET /api/v1/settings`.
#[tauri::command]
pub(crate) fn get_settings(state: State<'_, AppState>) -> SettingsDto {
    state.service.get_settings()
}

/// Atomically persists the same settings document as `PUT /api/v1/settings`.
#[tauri::command]
pub(crate) fn update_settings(
    state: State<'_, AppState>,
    settings: SettingsDto,
) -> Result<SettingsDto, ApplicationErrorDto> {
    state
        .service
        .update_settings(settings)
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Lists a directory through the same application service as Axum.
#[tauri::command]
pub(crate) async fn list_directory(
    state: State<'_, AppState>,
    request: ListDirectoryRequest,
) -> Result<DirectorySnapshotDto, ApplicationErrorDto> {
    state
        .service
        .list_directory(request)
        .await
        .map(Into::into)
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Refreshes a directory through the same application service as Axum.
#[tauri::command]
pub(crate) async fn refresh_directory(
    state: State<'_, AppState>,
    request: ListDirectoryRequest,
) -> Result<DirectorySnapshotDto, ApplicationErrorDto> {
    state
        .service
        .refresh_directory(request)
        .await
        .map(Into::into)
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Navigates a pane through the same application service as Axum.
#[tauri::command]
pub(crate) async fn navigate_pane(
    state: State<'_, AppState>,
    request: NavigateRequest,
) -> Result<DirectorySnapshotDto, ApplicationErrorDto> {
    state
        .service
        .navigate_pane(request)
        .await
        .map(Into::into)
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Fetches entry metadata through the same application service as Axum.
#[tauri::command]
pub(crate) async fn get_entry_metadata(
    state: State<'_, AppState>,
    request: EntryMetadataRequest,
) -> Result<EntryMetadataDto, ApplicationErrorDto> {
    state
        .service
        .get_entry_metadata(request)
        .await
        .map(Into::into)
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Lists every stored workspace as a lightweight summary, identical in shape
/// to `GET /api/v1/workspaces`.
#[tauri::command]
pub(crate) async fn list_workspaces(
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceSummaryDto>, ApplicationErrorDto> {
    state
        .service
        .list_workspaces()
        .await
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Creates and persists a new workspace, identical in shape to
/// `POST /api/v1/workspaces`.
#[tauri::command]
pub(crate) async fn create_workspace(
    state: State<'_, AppState>,
    request: CreateWorkspaceRequestDto,
) -> Result<WorkspaceDto, ApplicationErrorDto> {
    state
        .service
        .create_workspace(request.name)
        .await
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Loads a single workspace by id, identical in shape to
/// `GET /api/v1/workspaces/{workspaceId}`.
#[tauri::command]
pub(crate) async fn get_workspace(
    state: State<'_, AppState>,
    workspace_id: Uuid,
) -> Result<WorkspaceDto, ApplicationErrorDto> {
    state
        .service
        .get_workspace(workspace_id)
        .await
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Deletes a workspace, identical in shape to
/// `DELETE /api/v1/workspaces/{workspaceId}`.
#[tauri::command]
pub(crate) async fn delete_workspace(
    state: State<'_, AppState>,
    workspace_id: Uuid,
    expected_revision: Option<u64>,
) -> Result<(), ApplicationErrorDto> {
    state
        .service
        .delete_workspace(workspace_id, expected_revision)
        .await
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Selects an existing workspace as the last-active workspace, identical in
/// shape to `POST /api/v1/workspaces/{workspaceId}/open`.
#[tauri::command]
pub(crate) async fn open_workspace(
    state: State<'_, AppState>,
    workspace_id: Uuid,
) -> Result<WorkspaceDto, ApplicationErrorDto> {
    state
        .service
        .open_workspace(workspace_id)
        .await
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Applies a workspace command, identical in shape to
/// `POST /api/v1/workspaces/{workspaceId}/commands`.
#[tauri::command]
pub(crate) async fn apply_workspace_command(
    state: State<'_, AppState>,
    command: WorkspaceCommandDto,
) -> Result<WorkspaceDto, ApplicationErrorDto> {
    state
        .service
        .apply_workspace_command(command)
        .await
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Starts an operation through the same service method as REST.
///
/// Must be `async` (not a plain blocking command): `Scheduler::submit` calls
/// `tokio::spawn` internally, which panics without a live Tokio reactor.
/// Tauri only guarantees that context for `async fn` commands.
#[tauri::command]
pub(crate) async fn start_operation(
    state: State<'_, AppState>,
    request: StartOperationRequestDto,
    idempotency_key: Option<String>,
) -> Result<OperationDto, ApplicationErrorDto> {
    state
        .service
        .start_operation(request, idempotency_key)
        .map_err(|e| e.into_dto(Uuid::new_v4()))
}
/// Lists operation snapshots through the shared service.
#[tauri::command]
pub(crate) fn list_operations(state: State<'_, AppState>) -> Vec<OperationDto> {
    state.service.list_operations()
}
/// Gets one operation through the shared service.
#[tauri::command]
pub(crate) fn get_operation(
    state: State<'_, AppState>,
    operation_id: Uuid,
) -> Result<OperationDto, ApplicationErrorDto> {
    state
        .service
        .get_operation(OperationId::from(operation_id))
        .map_err(|e| e.into_dto(Uuid::new_v4()))
}
macro_rules! operation_command {
    ($name:ident) => {
        #[doc = "Applies an operation lifecycle command through the shared service."]
        #[tauri::command]
        pub(crate) fn $name(
            state: State<'_, AppState>,
            operation_id: Uuid,
        ) -> Result<(), ApplicationErrorDto> {
            state
                .service
                .$name(OperationId::from(operation_id))
                .map_err(|e| e.into_dto(Uuid::new_v4()))
        }
    };
}
operation_command!(cancel_operation);
operation_command!(pause_operation);
operation_command!(resume_operation);
/// Resolves a pending operation conflict through the shared service.
#[tauri::command]
pub(crate) fn resolve_operation_conflict(
    state: State<'_, AppState>,
    operation_id: Uuid,
    request: ResolveOperationConflictRequestDto,
) -> Result<(), ApplicationErrorDto> {
    state
        .service
        .resolve_operation_conflict(OperationId::from(operation_id), request)
        .map_err(|e| e.into_dto(Uuid::new_v4()))
}

/// Lists the registered actions through the same service method as REST.
#[tauri::command]
pub(crate) fn list_actions(state: State<'_, AppState>) -> Vec<ActionDescriptorDto> {
    state.service.list_actions()
}

/// Invokes a registered action through the same service method as REST.
///
/// Must be `async`: mutating actions delegate to `start_operation`, which
/// calls `Scheduler::submit` (`tokio::spawn`) and panics without a live
/// Tokio reactor outside an `async fn` command.
#[tauri::command]
pub(crate) async fn invoke_action(
    state: State<'_, AppState>,
    action_id: String,
    request: InvokeActionRequestDto,
    idempotency_key: Option<String>,
) -> Result<ActionResultDto, ApplicationErrorDto> {
    state
        .service
        .invoke_action(action_id, request, idempotency_key)
        .map_err(|e| e.into_dto(Uuid::new_v4()))
}

/// Lists plugins through the shared discovery service.
#[tauri::command]
pub(crate) fn list_plugins(state: State<'_, AppState>) -> Vec<PluginDescriptorDto> {
    state.service.list_plugins()
}

/// Persists plugin enablement through the shared service.
#[tauri::command]
pub(crate) fn enable_plugin(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<(), ApplicationErrorDto> {
    state
        .service
        .set_plugin_enabled(plugin_id, true)
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Persists plugin disablement through the shared service.
#[tauri::command]
pub(crate) fn disable_plugin(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<(), ApplicationErrorDto> {
    state
        .service
        .set_plugin_enabled(plugin_id, false)
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Returns one plugin's bounded diagnostic log through the shared service.
#[tauri::command]
pub(crate) fn get_plugin_logs(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<Vec<PluginLogEntryDto>, ApplicationErrorDto> {
    state
        .service
        .plugin_logs(&plugin_id)
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Starts a cancellable recursive filename search through the same service
/// method as REST (task 0068).
#[tauri::command]
pub(crate) fn start_search(
    state: State<'_, AppState>,
    request: StartSearchRequestDto,
) -> Result<StartSearchResponseDto, ApplicationErrorDto> {
    state
        .service
        .start_search(request)
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}

/// Cancels a running search through the shared service.
#[tauri::command]
pub(crate) fn cancel_search(
    state: State<'_, AppState>,
    search_id: Uuid,
) -> Result<(), ApplicationErrorDto> {
    state
        .service
        .cancel_search(search_id)
        .map_err(|error| error.into_dto(Uuid::new_v4()))
}
