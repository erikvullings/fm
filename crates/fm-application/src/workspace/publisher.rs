//! An injectable seam for publishing workspace mutation events (spec §5.3.9
//! step 7, §5.3.11).
//!
//! Building the real fine-grained `workspace.*` event set (§5.3.11) is task
//! 0081's concern, once `fm-events`' event bus exists. `WorkspaceService`
//! only needs somewhere to call after every successful [`fm_domain::WorkspaceCommand`]
//! so 0081 can wire in real publishing without changing `apply_command`'s
//! signature again.

use fm_domain::WorkspaceId;

/// Notified after a [`fm_domain::WorkspaceCommand`] is applied and persisted.
///
/// `command_kind` is the applied variant's name (for example
/// `"renameWorkspace"`), a lightweight stand-in for the real per-variant
/// event payloads task 0081 will add.
pub trait WorkspaceCommandPublisher: Send + Sync {
    /// Called once, after the mutated workspace has been persisted.
    fn publish(&self, workspace_id: WorkspaceId, revision: u64, command_kind: &'static str);
}

/// Default publisher used until a host wires in a real event bus (task
/// 0081).
#[derive(Debug, Clone, Copy, Default)]
pub struct NoopWorkspaceCommandPublisher;

impl WorkspaceCommandPublisher for NoopWorkspaceCommandPublisher {
    fn publish(&self, _workspace_id: WorkspaceId, _revision: u64, _command_kind: &'static str) {}
}
