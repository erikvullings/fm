//! The `FileManagerService` facade (specification §7).

use fm_transport_dto::{PlatformKindDto, RuntimeCapabilitiesDto, RuntimeKindDto};

/// Central application service that every host (Axum, Tauri, CLI) calls into.
///
/// Only the capabilities needed by the current milestone are implemented; the
/// remaining fields from the specification's example facade (workspaces,
/// directories, operations, actions, plugins, events) are added incrementally
/// as their crates land, rather than stubbed out ahead of time.
#[derive(Debug, Clone)]
pub struct FileManagerService {
    runtime: RuntimeKindDto,
}

impl FileManagerService {
    /// Builds a service for the given host runtime.
    pub fn new(runtime: RuntimeKindDto) -> Self {
        Self { runtime }
    }

    /// Reports which capabilities are available for the current runtime and
    /// platform, so the frontend can respond to capabilities rather than
    /// detecting operating systems itself (spec §21).
    pub fn runtime_capabilities(&self) -> RuntimeCapabilitiesDto {
        RuntimeCapabilitiesDto {
            runtime: self.runtime,
            platform: detect_platform(),
            native_menus: false,
            native_file_icons: false,
            native_thumbnails: false,
            native_drag_out: false,
            system_trash: false,
            reveal_in_system_file_manager: false,
            open_terminal: false,
            // The browser Clipboard API works without any native bridge.
            clipboard: true,
            plugins: false,
            server_administration: false,
        }
    }
}

/// Detects the host operating system from the compiled target (spec §21).
fn detect_platform() -> PlatformKindDto {
    match std::env::consts::OS {
        "macos" => PlatformKindDto::Macos,
        "windows" => PlatformKindDto::Windows,
        "linux" => PlatformKindDto::Linux,
        _ => PlatformKindDto::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_capabilities_report_the_configured_runtime_kind() {
        let service = FileManagerService::new(RuntimeKindDto::BrowserServer);
        assert_eq!(
            service.runtime_capabilities().runtime,
            RuntimeKindDto::BrowserServer
        );

        let service = FileManagerService::new(RuntimeKindDto::Tauri);
        assert_eq!(
            service.runtime_capabilities().runtime,
            RuntimeKindDto::Tauri
        );
    }

    #[test]
    fn runtime_capabilities_report_no_unimplemented_natives() {
        let capabilities =
            FileManagerService::new(RuntimeKindDto::BrowserServer).runtime_capabilities();

        assert!(!capabilities.native_menus);
        assert!(!capabilities.native_file_icons);
        assert!(!capabilities.native_thumbnails);
        assert!(!capabilities.native_drag_out);
        assert!(!capabilities.system_trash);
        assert!(!capabilities.reveal_in_system_file_manager);
        assert!(!capabilities.open_terminal);
        assert!(!capabilities.plugins);
        assert!(!capabilities.server_administration);
        assert!(capabilities.clipboard);
    }

    #[test]
    fn detect_platform_matches_the_compiled_target() {
        let expected = match std::env::consts::OS {
            "macos" => PlatformKindDto::Macos,
            "windows" => PlatformKindDto::Windows,
            "linux" => PlatformKindDto::Linux,
            _ => PlatformKindDto::Unknown,
        };
        assert_eq!(detect_platform(), expected);
    }
}
