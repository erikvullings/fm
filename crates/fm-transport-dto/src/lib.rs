//! Wire types for both hosts (task 0007).
//!
//! DTOs are converted explicitly to and from `fm-domain` types; they are never
//! reused as internal domain models (specification §3 rule 5). Keeping them in
//! one crate is what lets the Tauri commands and the REST endpoints stay
//! byte-for-byte compatible.

pub mod entry;
pub mod error;
pub mod health;
pub mod location;
pub mod requests;
pub mod runtime;
pub mod settings;
pub mod snapshot;
pub mod workspace;
pub mod workspace_command;

pub use entry::{
    ArchiveInfoDto, EntryKindDto, EntryMetadataDto, EntrySummaryDto, ImageDimensionsDto,
    MediaMetadataDto, OwnershipInfoDto, PermissionsInfoDto,
};
pub use error::{ApplicationErrorCode, ApplicationErrorDto};
pub use health::{HealthDto, HealthStatusDto};
pub use location::LocationDto;
pub use requests::{EntryMetadataRequest, ListDirectoryRequest, NavigateRequest};
pub use runtime::{PlatformKindDto, RuntimeCapabilitiesDto, RuntimeKindDto};
pub use settings::{
    ConflictPolicyDto, DateFormatDto, DefaultPaneLayoutDto, SettingsDto, SizeFormatDto, ThemeDto,
};
pub use snapshot::{DirectorySnapshotDto, LoadingStateDto};
pub use workspace::{
    ColumnConfigurationDto, CreateWorkspaceRequestDto, DirectoryViewConfigurationDto,
    NavigationHistoryDto, OperationCentrePreferencesDto, PaneStateDto, PersistedFilterDto,
    SortDescriptorDto, SortDirectionDto, SplitAxisDto, TabStateDto, WorkspaceDto,
    WorkspaceLayoutDto, WorkspaceSummaryDto,
};
pub use workspace_command::{
    DirectoryViewPatchDto, NavigationModeDto, QuickFilterPatchDto, WorkspaceCommandDto,
};
