//! Thin REST adapter for backend-owned operations (specification §8).

use crate::{
    error::{ApiError, extract_request_id},
    state::AppState,
};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
};
use fm_domain::OperationId;
use fm_transport_dto::{
    ApplicationErrorDto, OperationDto, ResolveOperationConflictRequestDto, StartOperationRequestDto,
};
use tower_http::request_id::RequestId;
use uuid::Uuid;

#[utoipa::path(
    get,
    path = "/api/v1/operations",
    operation_id = "listOperations",
    responses((status = 200, body = Vec<OperationDto>))
)]
pub(crate) async fn list_operations(State(state): State<AppState>) -> Json<Vec<OperationDto>> {
    Json(state.service.list_operations())
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
    let key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    state
        .service
        .start_operation(request, key)
        .map(|operation| (StatusCode::CREATED, Json(operation)))
        .map_err(|error| ApiError::new(error, correlation_id))
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
    state
        .service
        .cancel_operation(OperationId::from(id))
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(|error| ApiError::new(error, extract_request_id(&request_id)))
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
    state
        .service
        .pause_operation(OperationId::from(id))
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(|error| ApiError::new(error, extract_request_id(&request_id)))
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
    state
        .service
        .resume_operation(OperationId::from(id))
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(|error| ApiError::new(error, extract_request_id(&request_id)))
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
    state
        .service
        .resolve_operation_conflict(OperationId::from(id), request)
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(|e| ApiError::new(e, extract_request_id(&request_id)))
}
