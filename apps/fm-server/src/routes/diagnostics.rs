//! `GET /api/v1/diagnostics` - Diagnostics view for troubleshooting (spec §30).

use axum::{extract::State, Json};
use fm_transport_dto::{
    ConnectionStateDto, DiagnosticErrorDto, DiagnosticsDto, OperationQueueStatusDto,
    PluginStatusDto,
};

/// Provides comprehensive diagnostics information for troubleshooting and bug reports.
///
/// Includes version info, platform detection, runtime capabilities, and recent errors.
/// All paths and sensitive fields are redacted for safe sharing in bug reports.
#[utoipa::path(
    get,
    path = "/api/v1/diagnostics",
    operation_id = "getDiagnostics",
    responses((status = 200, description = "Diagnostics information", body = DiagnosticsDto))
)]
pub(crate) async fn get_diagnostics(
    State(state): State<crate::state::AppState>,
) -> Json<DiagnosticsDto> {
    // Get runtime capabilities from the service
    let runtime_capabilities = state.service.runtime_capabilities();

    // Build plugin status
    let plugins = state.service.list_plugins();
    let loaded_plugins: Vec<PluginStatusDto> = plugins
        .iter()
        .map(|plugin| PluginStatusDto {
            plugin_id: plugin.id.clone(),
            name: plugin.name.clone(),
            enabled: plugin.enabled,
            version: plugin.version.clone(),
            error_count: 0, // TODO: get from plugin runtime error log
        })
        .collect();

    // Get operation queue status from operation page (placeholder for now)
    // TODO: Implement proper operation queue status tracking
    let operation_queue_status = OperationQueueStatusDto {
        queued_count: 0,
        running_count: 0,
        paused_count: 0,
        completed_count: 0,
        total_pending_size: 0,
    };

    // Build connection state (SSE state)
    // TODO: Track actual SSE connection state in AppState
    let connection_state = ConnectionStateDto {
        connected: true,
        last_event_received: None,
        uptime_seconds: 0, // TODO: track app uptime
        events_received: 0, // TODO: count events
        status_message: "Connected".to_string(),
    };

    // Placeholder recent errors (TODO: implement error buffer in application state)
    let recent_errors: Vec<DiagnosticErrorDto> = vec![];

    // Convert platform to string representation
    let platform_str = match runtime_capabilities.platform {
        fm_transport_dto::PlatformKindDto::Macos => "macOS".to_string(),
        fm_transport_dto::PlatformKindDto::Windows => "Windows".to_string(),
        fm_transport_dto::PlatformKindDto::Linux => "Linux".to_string(),
        fm_transport_dto::PlatformKindDto::Unknown => "Unknown".to_string(),
    };

    Json(DiagnosticsDto {
        frontend_version: env!("CARGO_PKG_VERSION").to_string(),
        backend_version: env!("CARGO_PKG_VERSION").to_string(),
        tauri_version: None, // Set by Tauri host in desktop mode
        platform: platform_str,
        runtime_capabilities,
        connection_state,
        loaded_plugins,
        recent_errors,
        operation_queue_status,
    })
}


