//! Thin byte-range read and content-search REST handlers for the in-app
//! large file viewer (task 0088).

use axum::extract::{Extension, State};
use axum::{Json, http::StatusCode};
use fm_transport_dto::{
    ApplicationErrorDto, ArchiveCredentialRequestDto, CalculateFolderSizeRequestDto,
    CalculateFolderSizeResponseDto, GetFileGitHistoryRequestDto, GetFileGitHistoryResponseDto,
    LoadEditableFileRequestDto, LoadEditableFileResponseDto, ReadFileRangeRequestDto,
    ReadFileRangeResponseDto, SaveEditableFileRequestDto, SaveEditableFileResponseDto,
    SearchInFileRequestDto, SearchInFileResponseDto,
};
use tower_http::request_id::RequestId;

use crate::error::{ApiError, extract_request_id};
use crate::state::AppState;

/// Caches an archive password for this backend session only.
#[utoipa::path(
    post,
    path = "/api/v1/archives/credential",
    operation_id = "cacheArchivePassword",
    request_body = ArchiveCredentialRequestDto,
    responses(
        (status = 204, description = "Credential cached for this backend session"),
        (status = 400, description = "The archive location was invalid", body = ApplicationErrorDto),
    )
)]
pub(crate) async fn cache_archive_password(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Json(request): Json<ArchiveCredentialRequestDto>,
) -> Result<StatusCode, ApiError> {
    let request_id = extract_request_id(&request_id);
    crate::error::require_within_roots(&request.location, &state.accessible_roots, request_id)?;
    state
        .service
        .cache_archive_password(request)
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(|error| ApiError::new(error, request_id))
}

/// Reads one bounded byte range from a single file.
#[utoipa::path(
    post,
    path = "/api/v1/files/range",
    operation_id = "readFileRange",
    request_body = ReadFileRangeRequestDto,
    responses(
        (status = 200, description = "The requested byte range", body = ReadFileRangeResponseDto),
        (status = 400, description = "The request was invalid", body = ApplicationErrorDto),
        (status = 403, description = "The file is unreadable", body = ApplicationErrorDto),
        (status = 404, description = "The file does not exist", body = ApplicationErrorDto),
    )
)]
pub(crate) async fn read_file_range(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Json(request): Json<ReadFileRangeRequestDto>,
) -> Result<Json<ReadFileRangeResponseDto>, ApiError> {
    let request_id = extract_request_id(&request_id);
    crate::error::require_within_roots(&request.location, &state.accessible_roots, request_id)?;
    state
        .service
        .read_file_range(request)
        .await
        .map(Json)
        .map_err(|error| ApiError::new(error, request_id))
}

#[utoipa::path(post, path = "/api/v1/files/editable/load", operation_id = "loadEditableFile",
    request_body = LoadEditableFileRequestDto,
    responses((status = 200, body = LoadEditableFileResponseDto), (status = 400, body = ApplicationErrorDto), (status = 404, body = ApplicationErrorDto)))]
pub(crate) async fn load_editable_file(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Json(request): Json<LoadEditableFileRequestDto>,
) -> Result<Json<LoadEditableFileResponseDto>, ApiError> {
    let request_id = extract_request_id(&request_id);
    crate::error::require_within_roots(&request.location, &state.accessible_roots, request_id)?;
    state
        .service
        .load_editable_file(request)
        .await
        .map(Json)
        .map_err(|error| ApiError::new(error, request_id))
}

#[utoipa::path(post, path = "/api/v1/files/editable/save", operation_id = "saveEditableFile",
    request_body = SaveEditableFileRequestDto,
    responses((status = 200, body = SaveEditableFileResponseDto), (status = 400, body = ApplicationErrorDto), (status = 409, body = ApplicationErrorDto)))]
pub(crate) async fn save_editable_file(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    session_id: crate::audit::SessionIdHeader,
    Json(request): Json<SaveEditableFileRequestDto>,
) -> Result<Json<SaveEditableFileResponseDto>, ApiError> {
    let request_id = extract_request_id(&request_id);
    crate::error::require_within_roots(&request.location, &state.accessible_roots, request_id)?;
    if let Some(destination) = &request.destination {
        crate::error::require_within_roots(destination, &state.accessible_roots, request_id)?;
    }
    let audit_target = request
        .destination
        .as_ref()
        .unwrap_or(&request.location)
        .uri
        .clone();
    let result = state
        .service
        .save_editable_file(request)
        .await
        .map(Json)
        .map_err(|error| ApiError::new(error, request_id));
    if result.is_ok() {
        crate::audit::AuditEvent::new(
            crate::audit::AuditOperation::Overwrite,
            audit_target,
            session_id.0,
        )
        .log();
    }
    result
}

/// Searches a single file's content for a substring or regex.
#[utoipa::path(
    post,
    path = "/api/v1/files/search",
    operation_id = "searchInFile",
    request_body = SearchInFileRequestDto,
    responses(
        (status = 200, description = "Matches found in the file", body = SearchInFileResponseDto),
        (status = 400, description = "The request was invalid", body = ApplicationErrorDto),
        (status = 403, description = "The file is unreadable", body = ApplicationErrorDto),
        (status = 404, description = "The file does not exist", body = ApplicationErrorDto),
    )
)]
pub(crate) async fn search_in_file(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Json(request): Json<SearchInFileRequestDto>,
) -> Result<Json<SearchInFileResponseDto>, ApiError> {
    let request_id = extract_request_id(&request_id);
    crate::error::require_within_roots(&request.location, &state.accessible_roots, request_id)?;
    state
        .service
        .search_in_file(request)
        .await
        .map(Json)
        .map_err(|error| ApiError::new(error, request_id))
}

/// Recursively sums a directory's total size (task 0071's Total Commander-style folder-size key).
#[utoipa::path(
    post,
    path = "/api/v1/directories/size",
    operation_id = "calculateFolderSize",
    request_body = CalculateFolderSizeRequestDto,
    responses(
        (status = 200, description = "The directory's recursive total size", body = CalculateFolderSizeResponseDto),
        (status = 400, description = "The request was invalid", body = ApplicationErrorDto),
        (status = 403, description = "The directory is unreadable", body = ApplicationErrorDto),
        (status = 404, description = "The directory does not exist", body = ApplicationErrorDto),
    )
)]
pub(crate) async fn calculate_folder_size(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Json(request): Json<CalculateFolderSizeRequestDto>,
) -> Result<Json<CalculateFolderSizeResponseDto>, ApiError> {
    let request_id = extract_request_id(&request_id);
    crate::error::require_within_roots(&request.location, &state.accessible_roots, request_id)?;
    state
        .service
        .calculate_folder_size(request)
        .await
        .map(Json)
        .map_err(|error| ApiError::new(error, request_id))
}

/// Fetches a file's git commit history, for the Alt+Space metadata panel's history section
/// (task 0135). Local provider only; returns an empty commit list (never an error) when the
/// file is outside a git working tree, on a non-local provider, or not yet committed.
#[utoipa::path(
    post,
    path = "/api/v1/files/git-history",
    operation_id = "getFileGitHistory",
    request_body = GetFileGitHistoryRequestDto,
    responses(
        (status = 200, description = "Commits touching the file, newest first", body = GetFileGitHistoryResponseDto),
        (status = 400, description = "The request was invalid", body = ApplicationErrorDto),
    )
)]
pub(crate) async fn get_file_git_history(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Json(request): Json<GetFileGitHistoryRequestDto>,
) -> Result<Json<GetFileGitHistoryResponseDto>, ApiError> {
    let request_id = extract_request_id(&request_id);
    crate::error::require_within_roots(&request.location, &state.accessible_roots, request_id)?;
    Ok(Json(state.service.git_file_history(request).await))
}
