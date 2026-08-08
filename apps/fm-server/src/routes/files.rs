//! Thin byte-range read and content-search REST handlers for the in-app
//! large file viewer (task 0088).

use axum::extract::{Extension, State};
use axum::{Json, http::StatusCode};
use fm_transport_dto::{
    ApplicationErrorDto, ArchiveCredentialRequestDto, LoadEditableFileRequestDto,
    LoadEditableFileResponseDto, ReadFileRangeRequestDto, ReadFileRangeResponseDto,
    SaveEditableFileRequestDto, SaveEditableFileResponseDto, SearchInFileRequestDto,
    SearchInFileResponseDto,
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
    Json(request): Json<SaveEditableFileRequestDto>,
) -> Result<Json<SaveEditableFileResponseDto>, ApiError> {
    let request_id = extract_request_id(&request_id);
    state
        .service
        .save_editable_file(request)
        .await
        .map(Json)
        .map_err(|error| ApiError::new(error, request_id))
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
    state
        .service
        .search_in_file(request)
        .await
        .map(Json)
        .map_err(|error| ApiError::new(error, request_id))
}
