//! Thin directory and metadata REST handlers (task 0019).

use axum::Json;
use axum::extract::{Extension, State};
use fm_transport_dto::{
    ApplicationErrorDto, DirectorySnapshotDto, EntryMetadataDto, EntryMetadataRequest,
    ListDirectoryRequest, NavigateRequest,
};
use tower_http::request_id::RequestId;

use crate::error::{ApiError, extract_request_id};
use crate::state::AppState;

/// Lists one directory page.
#[utoipa::path(
    post,
    path = "/api/v1/directories/list",
    operation_id = "listDirectory",
    request_body = ListDirectoryRequest,
    responses(
        (status = 200, description = "A directory snapshot", body = DirectorySnapshotDto),
        (status = 400, description = "The request was invalid", body = ApplicationErrorDto),
        (status = 403, description = "The directory is unreadable", body = ApplicationErrorDto),
        (status = 404, description = "The directory does not exist", body = ApplicationErrorDto),
    )
)]
pub(crate) async fn list_directory(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Json(request): Json<ListDirectoryRequest>,
) -> Result<Json<DirectorySnapshotDto>, ApiError> {
    let request_id = extract_request_id(&request_id);
    state
        .service
        .list_directory(request)
        .await
        .map(DirectorySnapshotDto::from)
        .map(Json)
        .map_err(|error| ApiError::new(error, request_id))
}

/// Refreshes one directory page.
#[utoipa::path(
    post,
    path = "/api/v1/directories/refresh",
    operation_id = "refreshDirectory",
    request_body = ListDirectoryRequest,
    responses(
        (status = 200, description = "A refreshed directory snapshot", body = DirectorySnapshotDto),
        (status = 400, description = "The request was invalid", body = ApplicationErrorDto),
        (status = 403, description = "The directory is unreadable", body = ApplicationErrorDto),
        (status = 404, description = "The directory does not exist", body = ApplicationErrorDto),
    )
)]
pub(crate) async fn refresh_directory(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Json(request): Json<ListDirectoryRequest>,
) -> Result<Json<DirectorySnapshotDto>, ApiError> {
    let request_id = extract_request_id(&request_id);
    state
        .service
        .refresh_directory(request)
        .await
        .map(DirectorySnapshotDto::from)
        .map(Json)
        .map_err(|error| ApiError::new(error, request_id))
}

/// Navigates a pane and returns the destination's first page.
#[utoipa::path(
    post,
    path = "/api/v1/navigation/open",
    operation_id = "navigatePane",
    request_body = NavigateRequest,
    responses(
        (status = 200, description = "The destination directory snapshot", body = DirectorySnapshotDto),
        (status = 400, description = "The request was invalid", body = ApplicationErrorDto),
        (status = 403, description = "The directory is unreadable", body = ApplicationErrorDto),
        (status = 404, description = "The directory does not exist", body = ApplicationErrorDto),
    )
)]
pub(crate) async fn navigate_pane(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Json(request): Json<NavigateRequest>,
) -> Result<Json<DirectorySnapshotDto>, ApiError> {
    let request_id = extract_request_id(&request_id);
    state
        .service
        .navigate_pane(request)
        .await
        .map(DirectorySnapshotDto::from)
        .map(Json)
        .map_err(|error| ApiError::new(error, request_id))
}

/// Fetches detailed metadata for one entry.
#[utoipa::path(
    post,
    path = "/api/v1/entries/metadata",
    operation_id = "getEntryMetadata",
    request_body = EntryMetadataRequest,
    responses(
        (status = 200, description = "Detailed entry metadata", body = EntryMetadataDto),
        (status = 400, description = "The request was invalid", body = ApplicationErrorDto),
        (status = 403, description = "The entry is unreadable", body = ApplicationErrorDto),
        (status = 404, description = "The entry does not exist", body = ApplicationErrorDto),
    )
)]
pub(crate) async fn get_entry_metadata(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Json(request): Json<EntryMetadataRequest>,
) -> Result<Json<EntryMetadataDto>, ApiError> {
    let request_id = extract_request_id(&request_id);
    state
        .service
        .get_entry_metadata(request)
        .await
        .map(EntryMetadataDto::from)
        .map(Json)
        .map_err(|error| ApiError::new(error, request_id))
}
