//! Library surface for the Tauri desktop host (spec §11, task 0015).
//!
//! Mirrors `apps/fm-server`'s `lib.rs`/`main.rs` split: `run()` is the real
//! entry point `main.rs` calls, and is also what the mock-runtime smoke test
//! below builds, so both exercise the exact same `Builder`.

mod commands;
mod event_stream;
mod platform;

use std::sync::Arc;

use fm_application::FileManagerService;
use fm_events::EventBus;
use fm_transport_dto::RuntimeKindDto;
use tauri::Manager;

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
    tauri::Builder::default()
        .manage(AppState {
            service: Arc::new(FileManagerService::with_platform_adapter(
                RuntimeKindDto::Tauri,
                fm_application::workspace::JsonFileWorkspaceRepository::default_directory(),
                fm_application::workspace::JsonFileWorkspaceRepository::default_directory()
                    .parent()
                    .unwrap_or_else(|| std::path::Path::new(".fm-config/fm"))
                    .to_path_buf(),
                EventBus::default(),
                platform::build_platform_adapter(),
            )),
        })
        .manage(event_stream::EventSubscriptionRegistry::default())
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
            commands::get_settings,
            commands::update_settings,
            commands::list_directory,
            commands::refresh_directory,
            commands::navigate_pane,
            commands::get_entry_metadata,
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
            commands::start_search,
            commands::cancel_search,
        ])
        .run(build_context())
        .expect("error while running the Tauri application");
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
                service: Arc::new(FileManagerService::with_platform_adapter(
                    RuntimeKindDto::Tauri,
                    workspace_directory,
                    settings_directory,
                    EventBus::default(),
                    platform::build_platform_adapter(),
                )),
            })
            .manage(event_stream::EventSubscriptionRegistry::default())
            .invoke_handler(tauri::generate_handler![
                commands::subscribe_events,
                commands::unsubscribe_events,
                commands::get_runtime_capabilities,
                commands::get_settings,
                commands::update_settings,
                commands::list_directory,
                commands::refresh_directory,
                commands::navigate_pane,
                commands::get_entry_metadata,
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
                commands::start_search,
                commands::cancel_search,
            ])
            // Uses the app's real `tauri.conf.json` config (same as `run()`)
            // rather than `mock_context(noop_assets())`'s empty default config,
            // so `is_local_url` resolves the same dev/prod URLs production does.
            .build(build_context())
            .expect("failed to build mock app")
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
                // `tauri://localhost` on macOS/Linux; only Windows/Android use the
                // `http(s)://tauri.localhost` workaround URL (see
                // `WebviewManager::tauri_protocol_url`). A URL that doesn't
                // match the platform's local protocol is treated as remote and
                // rejected by the app's ACL (no capability grants it there).
                url: "tauri://localhost".parse().expect("valid url"),
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
}
