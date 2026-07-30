//! Core domain model shared by every other crate.
//!
//! This crate sits at the bottom of the dependency graph: it must never
//! depend on a transport, a provider or a host (`axum`, `tauri`, `reqwest`,
//! `utoipa`). Every type here is a plain, serializable data type — behaviour
//! (parsing, VFS access, application services) lives in higher layers.

pub mod entry;
pub mod ids;
pub mod location;
pub mod snapshot;
pub mod workspace;
pub mod workspace_command;

pub use entry::{
    ArchiveInfo, EntryKind, EntryMetadata, EntrySummary, ImageDimensions, MediaMetadata,
    OwnershipInfo, PermissionsInfo,
};
pub use ids::{
    ActionId, EntryId, IdParseError, OperationId, PaneId, PluginId, ProviderId, TabId, WorkspaceId,
};
pub use location::Location;
pub use snapshot::{DirectoryDelta, DirectorySnapshot, LoadingState};
pub use workspace::{
    CURRENT_WORKSPACE_SCHEMA_VERSION, ColumnConfiguration, DirectoryViewConfiguration,
    MAX_NAVIGATION_HISTORY_LEN, NavigationHistory, OperationCentrePreferences, PaneState,
    PersistedFilter, SPLIT_RATIO_RANGE, SortDescriptor, SortDirection, SplitAxis, TabState,
    Workspace, WorkspaceLayout, WorkspaceValidationError,
};
pub use workspace_command::{
    DirectoryViewPatch, NavigationMode, QuickFilterPatch, WorkspaceCommand,
};
