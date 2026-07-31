//! Shared Axum handler state (spec §7: handlers only call the service).

use std::sync::Arc;

use fm_application::FileManagerService;
use tokio_util::sync::CancellationToken;

/// State injected into every Axum handler.
#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) service: Arc<FileManagerService>,
    pub(crate) cors_allowed_origins: Arc<[String]>,
    pub(crate) session_end: CancellationToken,
}
