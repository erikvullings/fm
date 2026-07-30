//! Tauri commands: thin wrappers over `FileManagerService`, mirroring the
//! semantic REST API rather than reproducing HTTP concepts (spec §11).
//!
//! `navigate_pane` — listed in task 0015's acceptance criteria alongside this
//! command — is deliberately **not** implemented here yet: `FileManagerService`
//! has no `navigate` method (directory listing lands in tasks 0018/0019), so
//! there is nothing to thinly wrap without inventing filesystem logic in this
//! crate ahead of its owning task. Flagged as a known gap rather than guessed
//! at; add it once 0019 lands the backing service method.

use tauri::State;
use uuid::Uuid;

use fm_transport_dto::{
    ApplicationErrorDto, CreateWorkspaceRequestDto, RuntimeCapabilitiesDto, WorkspaceCommandDto,
    WorkspaceDto, WorkspaceSummaryDto,
};

use crate::AppState;

/// Reports the capabilities available for the current runtime and platform
/// (spec §21), identical in shape to `GET /api/v1/runtime`.
#[tauri::command]
pub(crate) fn get_runtime_capabilities(state: State<'_, AppState>) -> RuntimeCapabilitiesDto {
    state.service.runtime_capabilities()
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
