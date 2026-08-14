//! Maps action ids to platform-adapter operations (task 0061), platform-adapter failures to
//! user-readable application errors, and detects the host OS (spec §21).
//!
//! Split out of the `FileManagerService` facade (task 0119) — a self-contained cluster of pure
//! functions with no dependency on the rest of the facade.

use fm_domain::ActionId;
use fm_transport_dto::PlatformKindDto;

use crate::error::ApplicationError;

/// Which platform adapter method an action dispatches to (task 0061).
/// `core.view` shares [`PlatformActionKind::Open`] with `core.open`: it is
/// an explicit stopgap for a real viewer (task 0088). `core.openWith`
/// dispatches to [`PlatformActionKind::OpenWithChooser`], a native "choose
/// application" dialog (see `core_actions`'s doc comment in `action.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PlatformActionKind {
    Open,
    OpenWithChooser,
    Reveal,
    OpenTerminal,
    EditInTextEditor,
}

/// Maps an action id to the platform adapter operation it dispatches to
/// (task 0061), or `None` for actions with no platform-adapter effect.
pub(crate) fn platform_action_kind(id: &ActionId) -> Option<PlatformActionKind> {
    match id.as_str() {
        "core.open" | "core.view" => Some(PlatformActionKind::Open),
        "core.openWith" => Some(PlatformActionKind::OpenWithChooser),
        "core.edit" => Some(PlatformActionKind::EditInTextEditor),
        "core.revealInSystemFileManager" => Some(PlatformActionKind::Reveal),
        "core.openTerminal" => Some(PlatformActionKind::OpenTerminal),
        _ => None,
    }
}

/// Maps a platform adapter failure to a user-readable application error
/// (task 0061). An adapter reporting [`fm_platform::PlatformError::Unsupported`]
/// despite the registry's capability check (e.g. a race between capability
/// detection and invocation) is reported the same way as any other
/// unavailable action; any other failure keeps its sanitized, user-readable
/// message rather than a silent no-op or a generic "internal error".
pub(crate) fn map_platform_error(
    action_id: &ActionId,
    error: fm_platform::PlatformError,
) -> ApplicationError {
    match error {
        fm_platform::PlatformError::Unsupported { .. } => {
            ApplicationError::ActionUnavailable(action_id.clone())
        }
        other => ApplicationError::PlatformOperationFailed(other.to_string()),
    }
}

/// Missing native icon support is an expected fallback condition rather than
/// a host failure; genuine platform errors remain visible as a 502/IPC error.
pub(crate) fn map_file_icon_error(error: fm_platform::PlatformError) -> ApplicationError {
    match error {
        fm_platform::PlatformError::Unsupported { .. } => ApplicationError::NotFound,
        other => ApplicationError::PlatformOperationFailed(other.to_string()),
    }
}

/// Detects the host operating system from the compiled target (spec §21).
pub(crate) fn detect_platform() -> PlatformKindDto {
    match std::env::consts::OS {
        "macos" => PlatformKindDto::Macos,
        "windows" => PlatformKindDto::Windows,
        "linux" => PlatformKindDto::Linux,
        _ => PlatformKindDto::Unknown,
    }
}
