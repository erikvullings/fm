//! Application services (specification §7).
//!
//! `FileManagerService` exposes methods corresponding to user intentions -
//! navigate, start an operation, invoke an action - rather than raw filesystem
//! primitives. Both the Axum host and the Tauri host are thin adapters over
//! this crate, which is what guarantees the two behave identically.

mod action;
mod comparison_mapping;
mod connection_dto;
mod connection_facade;
mod directory;
mod error;
mod file_editor;
mod ftp;
mod operation_history;
mod operation_planner;
mod operation_requests;
mod platform_mapping;
mod plugin_manager;
mod remote_terminal;
mod service;
mod settings_mapping;
mod ssh;
pub mod workspace;

pub use action::{ActionRegistry, DuplicateActionId};
pub use directory::DirectoryService;
pub use error::ApplicationError;
pub use fm_ssh::{RemoteShellChannel, RemoteShellEvent, RemoteShellReader, RemoteShellWriter};
pub use service::FileManagerService;
