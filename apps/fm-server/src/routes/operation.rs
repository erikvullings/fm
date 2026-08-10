//! Thin REST adapter for backend-owned operations (specification §8).

use crate::{
    error::{ApiError, extract_request_id},
    state::AppState,
};
use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use fm_domain::OperationId;
use fm_transport_dto::{
    ApplicationErrorDto, OperationDto, OperationPageDto, ResolveOperationConflictRequestDto,
    StartOperationRequestDto,
};
use serde::Deserialize;
use std::time::Instant;
use tower_http::request_id::RequestId;
use tracing::{info, warn};
use uuid::Uuid;

#[utoipa::path(
    get,
    path = "/api/v1/operations",
    operation_id = "listOperations",
    params(OperationPageQuery),
    responses((status = 200, body = OperationPageDto))
)]
pub(crate) async fn list_operations(
    State(state): State<AppState>,
    Query(query): Query<OperationPageQuery>,
) -> Json<OperationPageDto> {
    Json(
        state
            .service
            .list_operation_page(query.offset.unwrap_or(0), query.limit.unwrap_or(50)),
    )
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OperationPageQuery {
    /// Zero-based entry offset.
    offset: Option<u64>,
    /// Page size, clamped to 1 through 100.
    limit: Option<u16>,
}

#[utoipa::path(
    post,
    path = "/api/v1/operations",
    operation_id = "startOperation",
    request_body = StartOperationRequestDto,
    responses(
        (status = 201, body = OperationDto),
        (status = 400, body = ApplicationErrorDto)
    )
)]
pub(crate) async fn start_operation(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    Json(request): Json<StartOperationRequestDto>,
) -> Result<(StatusCode, Json<OperationDto>), ApiError> {
    let correlation_id = extract_request_id(&request_id);
    let started = Instant::now();
    let operation_kind = request.operation_type.clone();
    let key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    info!(
        request_id = %correlation_id,
        operation_kind = ?operation_kind,
        has_idempotency_key = key.is_some(),
        "start_operation received"
    );
    match state.service.start_operation(request, key) {
        Ok(operation) => {
            info!(
                request_id = %correlation_id,
                operation_id = %operation.id,
                operation_kind = ?operation_kind,
                elapsed_ms = started.elapsed().as_millis(),
                "start_operation honored"
            );
            Ok((StatusCode::CREATED, Json(operation)))
        }
        Err(error) => {
            warn!(
                request_id = %correlation_id,
                operation_kind = ?operation_kind,
                elapsed_ms = started.elapsed().as_millis(),
                error = ?error,
                "start_operation failed"
            );
            Err(ApiError::new(error, correlation_id))
        }
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/operations/{operationId}",
    operation_id = "getOperation",
    params(("operationId" = Uuid, Path)),
    responses(
        (status = 200, body = OperationDto),
        (status = 404, body = ApplicationErrorDto)
    )
)]
pub(crate) async fn get_operation(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(id): Path<Uuid>,
) -> Result<Json<OperationDto>, ApiError> {
    state
        .service
        .get_operation(OperationId::from(id))
        .map(Json)
        .map_err(|e| ApiError::new(e, extract_request_id(&request_id)))
}

#[utoipa::path(
    post,
    path = "/api/v1/operations/{operationId}/cancel",
    operation_id = "cancelOperation",
    params(("operationId" = Uuid, Path)),
    responses(
        (status = 204),
        (status = 404, body = ApplicationErrorDto),
        (status = 400, body = ApplicationErrorDto)
    )
)]
pub(crate) async fn cancel_operation(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let correlation_id = extract_request_id(&request_id);
    let started = Instant::now();
    let operation_id = OperationId::from(id);
    info!(request_id = %correlation_id, operation_id = %operation_id, "cancel_operation received");
    match state.service.cancel_operation(operation_id) {
        Ok(()) => {
            info!(
                request_id = %correlation_id,
                operation_id = %operation_id,
                elapsed_ms = started.elapsed().as_millis(),
                "cancel_operation honored"
            );
            Ok(StatusCode::NO_CONTENT)
        }
        Err(error) => {
            warn!(
                request_id = %correlation_id,
                operation_id = %operation_id,
                elapsed_ms = started.elapsed().as_millis(),
                error = ?error,
                "cancel_operation failed"
            );
            Err(ApiError::new(error, correlation_id))
        }
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/operations/{operationId}/pause",
    operation_id = "pauseOperation",
    params(("operationId" = Uuid, Path)),
    responses(
        (status = 204),
        (status = 404, body = ApplicationErrorDto),
        (status = 400, body = ApplicationErrorDto)
    )
)]
pub(crate) async fn pause_operation(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let correlation_id = extract_request_id(&request_id);
    let started = Instant::now();
    let operation_id = OperationId::from(id);
    info!(request_id = %correlation_id, operation_id = %operation_id, "pause_operation received");
    match state.service.pause_operation(operation_id) {
        Ok(()) => {
            info!(
                request_id = %correlation_id,
                operation_id = %operation_id,
                elapsed_ms = started.elapsed().as_millis(),
                "pause_operation honored"
            );
            Ok(StatusCode::NO_CONTENT)
        }
        Err(error) => {
            warn!(
                request_id = %correlation_id,
                operation_id = %operation_id,
                elapsed_ms = started.elapsed().as_millis(),
                error = ?error,
                "pause_operation failed"
            );
            Err(ApiError::new(error, correlation_id))
        }
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/operations/{operationId}/resume",
    operation_id = "resumeOperation",
    params(("operationId" = Uuid, Path)),
    responses(
        (status = 204),
        (status = 404, body = ApplicationErrorDto),
        (status = 400, body = ApplicationErrorDto)
    )
)]
pub(crate) async fn resume_operation(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let correlation_id = extract_request_id(&request_id);
    let started = Instant::now();
    let operation_id = OperationId::from(id);
    info!(request_id = %correlation_id, operation_id = %operation_id, "resume_operation received");
    match state.service.resume_operation(operation_id) {
        Ok(()) => {
            info!(
                request_id = %correlation_id,
                operation_id = %operation_id,
                elapsed_ms = started.elapsed().as_millis(),
                "resume_operation honored"
            );
            Ok(StatusCode::NO_CONTENT)
        }
        Err(error) => {
            warn!(
                request_id = %correlation_id,
                operation_id = %operation_id,
                elapsed_ms = started.elapsed().as_millis(),
                error = ?error,
                "resume_operation failed"
            );
            Err(ApiError::new(error, correlation_id))
        }
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/operations/{operationId}/resolve-conflict",
    operation_id = "resolveOperationConflict",
    params(("operationId" = Uuid, Path)),
    request_body = ResolveOperationConflictRequestDto,
    responses(
        (status = 204),
        (status = 404, body = ApplicationErrorDto),
        (status = 400, body = ApplicationErrorDto)
    )
)]
pub(crate) async fn resolve_operation_conflict(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(id): Path<Uuid>,
    Json(request): Json<ResolveOperationConflictRequestDto>,
) -> Result<StatusCode, ApiError> {
    let correlation_id = extract_request_id(&request_id);
    let started = Instant::now();
    let operation_id = OperationId::from(id);
    info!(
        request_id = %correlation_id,
        operation_id = %operation_id,
        resolution = ?request.resolution,
        apply_to_all = request.apply_to_all_similar,
        "resolve_operation_conflict received"
    );
    match state
        .service
        .resolve_operation_conflict(operation_id, request)
    {
        Ok(()) => {
            info!(
                request_id = %correlation_id,
                operation_id = %operation_id,
                elapsed_ms = started.elapsed().as_millis(),
                "resolve_operation_conflict honored"
            );
            Ok(StatusCode::NO_CONTENT)
        }
        Err(error) => {
            warn!(
                request_id = %correlation_id,
                operation_id = %operation_id,
                elapsed_ms = started.elapsed().as_millis(),
                error = ?error,
                "resolve_operation_conflict failed"
            );
            Err(ApiError::new(error, correlation_id))
        }
    }
}
