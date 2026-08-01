//! Thin REST adapter for plugin discovery and persisted enablement.

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
};
use fm_transport_dto::{ApplicationErrorDto, PluginDescriptorDto, PluginLogEntryDto};
use tower_http::request_id::RequestId;

use crate::{
    error::{ApiError, extract_request_id},
    state::AppState,
};

/// Lists valid and disabled discovered plugins.
#[utoipa::path(get, path = "/api/v1/plugins", operation_id = "listPlugins", responses((status = 200, body = Vec<PluginDescriptorDto>)))]
pub(crate) async fn list_plugins(State(state): State<AppState>) -> Json<Vec<PluginDescriptorDto>> {
    Json(state.service.list_plugins())
}

#[utoipa::path(get, path = "/api/v1/plugins/{pluginId}/logs", operation_id = "getPluginLogs", params(("pluginId" = String, Path)), responses((status = 200, body = Vec<PluginLogEntryDto>), (status = 404, body = ApplicationErrorDto)))]
pub(crate) async fn get_plugin_logs(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(plugin_id): Path<String>,
) -> Result<Json<Vec<PluginLogEntryDto>>, ApiError> {
    state
        .service
        .plugin_logs(&plugin_id)
        .map(Json)
        .map_err(|error| ApiError::new(error, extract_request_id(&request_id)))
}

#[utoipa::path(post, path = "/api/v1/plugins/{pluginId}/enable", operation_id = "enablePlugin", params(("pluginId" = String, Path)), responses((status = 204), (status = 404, body = ApplicationErrorDto)))]
pub(crate) async fn enable_plugin(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(plugin_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .set_plugin_enabled(plugin_id, true)
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(|error| ApiError::new(error, extract_request_id(&request_id)))
}

#[utoipa::path(post, path = "/api/v1/plugins/{pluginId}/disable", operation_id = "disablePlugin", params(("pluginId" = String, Path)), responses((status = 204), (status = 404, body = ApplicationErrorDto)))]
pub(crate) async fn disable_plugin(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(plugin_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .set_plugin_enabled(plugin_id, false)
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(|error| ApiError::new(error, extract_request_id(&request_id)))
}
