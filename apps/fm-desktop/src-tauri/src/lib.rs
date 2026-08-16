//! Library surface for the Tauri desktop host (spec §11, task 0015).
//!
//! Mirrors `apps/fm-server`'s `lib.rs`/`main.rs` split: `run()` is the real
//! entry point `main.rs` calls, and is also what the mock-runtime smoke test
//! below builds, so both exercise the exact same `Builder`.

mod commands;
mod credentials;
mod event_stream;
mod platform;
mod terminal;

use std::sync::Arc;

use fm_application::FileManagerService;
use fm_events::EventBus;
use fm_transport_dto::RuntimeKindDto;
use tauri::Manager;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// State injected into every Tauri command (spec §7: commands only call the
/// service).
pub struct AppState {
    pub(crate) service: Arc<FileManagerService>,
}

/// Generates the app's `tauri.conf.json`-derived context.
///
/// `tauri::generate_context!()` must be invoked exactly once per source
/// location in this crate — each textual invocation embeds a fixed-name
/// static (e.g. `_EMBED_INFO_PLIST` on macOS), so calling the macro directly
/// from both [`run`] and the test module would collide. Both call this
/// function instead.
fn build_context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

/// Builds and runs the desktop application.
///
/// No Axum server is started in-process to reuse HTTP (spec §11) — the
/// Tauri commands in [`commands`] call `FileManagerService` directly.
pub fn run() {
    init_tracing();
    tauri::Builder::default()
        .manage(AppState {
            service: Arc::new(
                FileManagerService::with_platform_adapter_and_credential_store(
                    RuntimeKindDto::Tauri,
                    fm_application::workspace::JsonFileWorkspaceRepository::default_directory(),
                    fm_application::workspace::JsonFileWorkspaceRepository::default_directory()
                        .parent()
                        .unwrap_or_else(|| std::path::Path::new(".fm-config/fm"))
                        .to_path_buf(),
                    EventBus::default(),
                    platform::build_platform_adapter(),
                    credentials::build_credential_store(),
                ),
            ),
        })
        .manage(event_stream::EventSubscriptionRegistry::default())
        .manage(terminal::TerminalRegistry::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window
                    .state::<event_stream::EventSubscriptionRegistry>()
                    .unsubscribe_window(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::subscribe_events,
            commands::unsubscribe_events,
            commands::get_runtime_capabilities,
            commands::get_system_locations,
            commands::start_native_drag,
            commands::native_drag_locations,
            commands::get_file_icon,
            commands::get_settings,
            commands::update_settings,
            commands::list_directory,
            commands::refresh_directory,
            commands::navigate_pane,
            commands::get_entry_metadata,
            commands::set_pane_activity,
            commands::read_file_range,
            commands::load_editable_file,
            commands::save_editable_file,
            commands::search_in_file,
            commands::calculate_folder_size,
            commands::cache_archive_password,
            commands::list_workspaces,
            commands::create_workspace,
            commands::get_workspace,
            commands::delete_workspace,
            commands::open_workspace,
            commands::apply_workspace_command,
            commands::start_operation,
            commands::list_operations,
            commands::get_operation,
            commands::cancel_operation,
            commands::pause_operation,
            commands::resume_operation,
            commands::resolve_operation_conflict,
            commands::list_actions,
            commands::invoke_action,
            commands::list_plugins,
            commands::enable_plugin,
            commands::disable_plugin,
            commands::get_plugin_logs,
            commands::get_plugin_icon_theme_asset,
            commands::start_search,
            commands::cancel_search,
            commands::start_comparison,
            commands::get_comparison,
            commands::cancel_comparison,
            commands::generate_sync_plan,
            commands::apply_sync_plan,
            commands::start_checksums,
            commands::get_checksums,
            commands::cancel_checksums,
            commands::render_checksum_file,
            commands::save_checksum_file,
            commands::verify_checksum_file,
            commands::start_duplicate_scan,
            commands::get_duplicate_scan,
            commands::cancel_duplicate_scan,
            commands::list_connections,
            commands::create_connection,
            commands::get_connection,
            commands::update_connection,
            commands::delete_connection,
            commands::connect_connection,
            commands::disconnect_connection,
            commands::test_connection,
            commands::probe_ssh_host_key,
            commands::accept_ssh_host_key,
            commands::open_embedded_terminal,
            commands::write_embedded_terminal,
            commands::resize_embedded_terminal,
            commands::set_caption_colours,
        ])
        .run(build_context())
        .expect("error while running the Tauri application");
}

/// Initialises structured tracing for the desktop host (spec §30).
///
/// - `RUST_LOG` controls level filter (default: `info`).
/// - `FM_LOG_FORMAT` controls output format: `compact` (default) or `pretty`.
/// - `FM_LOG_FILE` writes a rolling daily log to the given path prefix (desktop mode).
fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let format = std::env::var("FM_LOG_FORMAT").unwrap_or_default();
    let log_file = std::env::var("FM_LOG_FILE").ok().or_else(|| {
        // Default desktop log location: OS data dir / fm / fm-desktop.log
        dirs::data_dir().map(|d| {
            d.join("fm")
                .join("fm-desktop.log")
                .to_string_lossy()
                .into_owned()
        })
    });

    match log_file {
        Some(path) => {
            let dir = std::path::Path::new(&path)
                .parent()
                .unwrap_or(std::path::Path::new("."));
            let prefix = std::path::Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("fm-desktop");
            let file_appender = tracing_appender::rolling::daily(dir, prefix);
            let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
            std::mem::forget(_guard);
            tracing_subscriber::registry()
                .with(filter)
                .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
                .init();
        }
        None => match format.as_str() {
            "pretty" => tracing_subscriber::registry()
                .with(filter)
                .with(tracing_subscriber::fmt::layer().pretty())
                .init(),
            _ => tracing_subscriber::registry()
                .with(filter)
                .with(tracing_subscriber::fmt::layer().compact())
                .init(),
        },
    }
}

#[cfg(test)]
mod tests {
    use tauri::Manager;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder};
    use tauri::webview::InvokeRequest;

    use super::*;

    fn create_app<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::App<R> {
        let workspace_directory =
            tempfile::tempdir().expect("must create a temp workspace directory");
        let settings_directory = workspace_directory.path().join("settings");
        let workspace_directory = workspace_directory.keep();
        builder
            .manage(AppState {
                service: Arc::new(
                    FileManagerService::with_platform_adapter_and_credential_store(
                        RuntimeKindDto::Tauri,
                        workspace_directory,
                        settings_directory,
                        EventBus::default(),
                        platform::build_platform_adapter(),
                        credentials::build_credential_store(),
                    ),
                ),
            })
            .manage(event_stream::EventSubscriptionRegistry::default())
            .invoke_handler(tauri::generate_handler![
                commands::subscribe_events,
                commands::unsubscribe_events,
                commands::get_runtime_capabilities,
                commands::get_system_locations,
                commands::start_native_drag,
                commands::native_drag_locations,
                commands::get_file_icon,
                commands::get_settings,
                commands::update_settings,
                commands::list_directory,
                commands::refresh_directory,
                commands::navigate_pane,
                commands::get_entry_metadata,
                commands::set_pane_activity,
                commands::read_file_range,
                commands::load_editable_file,
                commands::save_editable_file,
                commands::search_in_file,
                commands::calculate_folder_size,
                commands::cache_archive_password,
                commands::list_workspaces,
                commands::create_workspace,
                commands::get_workspace,
                commands::delete_workspace,
                commands::open_workspace,
                commands::apply_workspace_command,
                commands::start_operation,
                commands::list_operations,
                commands::get_operation,
                commands::cancel_operation,
                commands::pause_operation,
                commands::resume_operation,
                commands::resolve_operation_conflict,
                commands::list_actions,
                commands::invoke_action,
                commands::list_plugins,
                commands::enable_plugin,
                commands::disable_plugin,
                commands::get_plugin_logs,
                commands::get_plugin_icon_theme_asset,
                commands::start_search,
                commands::cancel_search,
                commands::start_comparison,
                commands::get_comparison,
                commands::cancel_comparison,
                commands::generate_sync_plan,
                commands::apply_sync_plan,
                commands::start_checksums,
                commands::get_checksums,
                commands::cancel_checksums,
                commands::render_checksum_file,
                commands::save_checksum_file,
                commands::verify_checksum_file,
                commands::start_duplicate_scan,
                commands::get_duplicate_scan,
                commands::cancel_duplicate_scan,
                commands::list_connections,
                commands::create_connection,
                commands::get_connection,
                commands::update_connection,
                commands::delete_connection,
                commands::connect_connection,
                commands::disconnect_connection,
                commands::test_connection,
                commands::probe_ssh_host_key,
                commands::accept_ssh_host_key,
            ])
            // Uses the app's real `tauri.conf.json` config (same as `run()`)
            // rather than `mock_context(noop_assets())`'s empty default config,
            // so `is_local_url` resolves the same dev/prod URLs production does.
            .build(build_context())
            .expect("failed to build mock app")
    }

    /// The URL the webview really serves the frontend from, which is the only
    /// origin the app's ACL grants commands to. Windows and Android use the
    /// `http://tauri.localhost` workaround rather than the `tauri://` scheme
    /// (see `WebviewManager::tauri_protocol_url`).
    fn local_protocol_url() -> tauri::Url {
        let url = if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };
        url.parse().expect("valid url")
    }

    /// Smoke test (task 0015's acceptance criteria): the app starts, on a
    /// headless `MockRuntime` (no real window), and `getRuntimeCapabilities`
    /// reports `runtime: "tauri"`.
    #[test]
    fn app_starts_and_reports_the_tauri_runtime() {
        let app = create_app(mock_builder());
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("failed to build mock webview");

        let response = get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "get_runtime_capabilities".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                // The app's ACL only grants commands to the platform's own local
                // protocol URL; anything else counts as remote and is rejected.
                url: local_protocol_url(),
                body: InvokeBody::default(),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .expect("command must succeed")
        .deserialize::<fm_transport_dto::RuntimeCapabilitiesDto>()
        .expect("response must deserialize");

        assert_eq!(response.runtime, RuntimeKindDto::Tauri);
        app.state::<AppState>();
    }

    #[test]
    fn file_icon_command_returns_a_typed_error_for_an_invalid_location() {
        let app = create_app(mock_builder());
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("failed to build mock webview");

        let error = get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "get_file_icon".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: local_protocol_url(),
                body: InvokeBody::Json(serde_json::json!({ "uri": "not a location" })),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .expect_err("invalid location must reject the command");

        assert!(error.to_string().contains("invalidRequest"));
    }
}
