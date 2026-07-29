//! The catch-all handler for unmatched routes (spec §8: every error carries a
//! request id).

use axum::Json;
use axum::extract::Extension;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use fm_application::ApplicationError;
use tower_http::request_id::RequestId;
use uuid::Uuid;

/// Renders unmatched routes as a structured `ApplicationErrorDto`, tagged with
/// the request id set by the `tower_http` request-id middleware.
pub(crate) async fn not_found(Extension(request_id): Extension<RequestId>) -> impl IntoResponse {
    let id = request_id
        .header_value()
        .to_str()
        .ok()
        .and_then(|value| value.parse::<Uuid>().ok())
        .unwrap_or_else(Uuid::new_v4);

    (
        StatusCode::NOT_FOUND,
        Json(ApplicationError::NotFound.into_dto(id)),
    )
}
