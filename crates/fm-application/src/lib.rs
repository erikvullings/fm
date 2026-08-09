//! Application services (specification §7).
//!
//! `FileManagerService` exposes methods corresponding to user intentions -
//! navigate, start an operation, invoke an action - rather than raw filesystem
//! primitives. Both the Axum host and the Tauri host are thin adapters over
//! this crate, which is what guarantees the two behave identically.

mod action;
mod connection_dto;
mod directory;
mod error;
mod service;
mod ssh;
pub mod workspace;

pub use action::{ActionRegistry, DuplicateActionId};
pub use directory::DirectoryService;
pub use error::ApplicationError;
pub use service::FileManagerService;
