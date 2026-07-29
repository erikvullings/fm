//! Workspace persistence, validation and lifecycle (spec §5.3, task 0079).
//!
//! [`WorkspaceService`] is the entry point: it wraps a [`WorkspaceRepository`]
//! (an in-memory implementation for tests, a JSON-file-backed one for real
//! persistence) and owns the startup lifecycle, default-workspace creation
//! and the create/load/list/delete surface. Semantic mutation commands
//! (`WorkspaceCommand`) and event emission are task 0080/0081's concern.

mod default_workspace;
mod error;
mod memory;
mod migration;
mod persistent;
mod repository;
mod service;

pub use default_workspace::{default_workspace, resolve_home_directory};
pub use error::WorkspaceError;
pub use memory::InMemoryWorkspaceRepository;
pub use persistent::{JsonFileWorkspaceRepository, NoopWorkspaceNotifier, WorkspaceNotifier};
pub use repository::{LastActiveWorkspaceStore, WorkspaceRepository, WorkspaceSummary};
pub use service::WorkspaceService;
