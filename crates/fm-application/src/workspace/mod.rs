//! Workspace persistence, validation and lifecycle (spec §5.3, tasks 0079,
//! 0080).
//!
//! [`WorkspaceService`] is the entry point: it wraps a [`WorkspaceRepository`]
//! (an in-memory implementation for tests, a JSON-file-backed one for real
//! persistence) and owns the startup lifecycle, default-workspace creation,
//! the create/load/list/delete surface and semantic mutation commands
//! (`WorkspaceCommand`/`apply_command`, spec §5.3.9). Event emission beyond
//! the injectable [`WorkspaceCommandPublisher`] seam is task 0081's concern.

mod command;
mod default_workspace;
mod error;
mod memory;
mod migration;
mod persistent;
mod publisher;
mod repository;
mod service;

pub use default_workspace::{default_workspace, resolve_home_directory};
pub use error::WorkspaceError;
pub use memory::InMemoryWorkspaceRepository;
pub use persistent::{JsonFileWorkspaceRepository, NoopWorkspaceNotifier, WorkspaceNotifier};
pub use publisher::{NoopWorkspaceCommandPublisher, WorkspaceCommandPublisher};
pub use repository::{LastActiveWorkspaceStore, WorkspaceRepository, WorkspaceSummary};
pub use service::WorkspaceService;
