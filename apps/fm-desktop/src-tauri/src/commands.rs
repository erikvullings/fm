//! Tauri commands: thin wrappers over `FileManagerService`, mirroring the
//! semantic REST API rather than reproducing HTTP concepts (spec §11).
//!
//! `navigate_pane` — listed in task 0015's acceptance criteria alongside this
//! command — is deliberately **not** implemented here yet: `FileManagerService`
//! has no `navigate` method (directory listing lands in tasks 0018/0019), so
//! there is nothing to thinly wrap without inventing filesystem logic in this
//! crate ahead of its owning task. Flagged as a known gap rather than guessed
//! at; add it once 0019 lands the backing service method.

use tauri::State;

use fm_transport_dto::RuntimeCapabilitiesDto;

use crate::AppState;

/// Reports the capabilities available for the current runtime and platform
/// (spec §21), identical in shape to `GET /api/v1/runtime`.
#[tauri::command]
pub(crate) fn get_runtime_capabilities(state: State<'_, AppState>) -> RuntimeCapabilitiesDto {
    state.service.runtime_capabilities()
}
