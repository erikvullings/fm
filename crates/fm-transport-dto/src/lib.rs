//! Wire types for both hosts (task 0007).
//!
//! DTOs are converted explicitly to and from `fm-domain` types; they are never
//! reused as internal domain models (specification §3 rule 5). Keeping them in
//! one crate is what lets the Tauri commands and the REST endpoints stay
//! byte-for-byte compatible.

pub mod action;
pub mod comparison;
pub mod connection;
pub mod diagnostics;
pub mod entry;
pub mod error;
pub mod files;
pub mod health;
pub mod location;
pub mod operation;
pub mod plugin;
pub mod redaction;
pub mod requests;
pub mod runtime;
pub mod search;
pub mod settings;
pub mod snapshot;
pub mod system_location;
pub mod workspace;
pub mod workspace_command;

pub use action::{
    ActionContextRequirementsDto, ActionDescriptorDto, ActionInvocationContextDto, ActionResultDto,
    ActionSourceDto, InvokeActionRequestDto, KeyChordDto,
};
pub use comparison::{
    ApplySyncPlanRequestDto, ApplySyncPlanResponseDto, ComparisonCriteriaDto, ComparisonEntryDto,
    ComparisonEntrySideDto, ComparisonPageDto, ComparisonStatusDto, GenerateSyncPlanRequestDto,
    StartComparisonRequestDto, StartComparisonResponseDto, SyncActionDto, SyncModeDto, SyncPlanDto,
    SyncPlanItemDto,
};
pub use connection::{
    AcceptSshHostKeyRequestDto, ConnectionConfigurationDto, ConnectionDto, ConnectionKindDto,
    ConnectionSecretInputDto, ConnectionStatusDto, CreateConnectionRequestDto,
    FtpConnectionConfigurationDto, HostKeyPolicyDto, HostKeyProbeDto,
    OneDriveConnectionConfigurationDto, S3ConnectionConfigurationDto,
    SmbConnectionConfigurationDto, SshAuthenticationMethodDto, SshConnectionConfigurationDto,
    UpdateConnectionRequestDto, WebDavConnectionConfigurationDto,
};
pub use diagnostics::{
    ConnectionStateDto, DiagnosticErrorDto, DiagnosticsDto, OperationQueueStatusDto,
    PluginStatusDto,
};
pub use entry::{
    ArchiveInfoDto, EntryKindDto, EntryMetadataDto, EntrySummaryDto, ImageDimensionsDto,
    MediaMetadataDto, OwnershipInfoDto, PermissionsInfoDto,
};
pub use error::{ApplicationErrorCode, ApplicationErrorDto};
pub use files::{
    ArchiveCredentialRequestDto, CalculateFolderSizeRequestDto, CalculateFolderSizeResponseDto,
    GetFileGitHistoryRequestDto, GetFileGitHistoryResponseDto, GitLogEntryDto,
    LoadEditableFileRequestDto, LoadEditableFileResponseDto, ReadFileRangeRequestDto,
    ReadFileRangeResponseDto, SaveEditableFileRequestDto, SaveEditableFileResponseDto,
    SearchInFileMatchDto, SearchInFileRequestDto, SearchInFileResponseDto,
};
pub use health::{HealthDto, HealthStatusDto};
pub use location::LocationDto;
pub use operation::{
    ArchiveFormatDto, ConflictResolutionDto, EntryRefDto, OperationConflictPolicyDto, OperationDto,
    OperationEntryErrorDto, OperationKindDto, OperationPageDto, OperationProgressDto,
    OperationStateDto, ResolveOperationConflictRequestDto, StartOperationRequestDto,
    SymlinkPolicyDto,
};
pub use plugin::{
    PluginColumnDto, PluginDescriptorDto, PluginIconDefinitionDto, PluginIconThemeDto,
    PluginLogEntryDto, PluginPermissionsDto,
};
pub use redaction::{redact, redact_absolute_paths, redact_path};
pub use requests::{
    EntryMetadataRequest, ListDirectoryRequest, NavigateRequest, SetPaneActivityRequest,
};
pub use runtime::{PlatformKindDto, RuntimeCapabilitiesDto, RuntimeKindDto};
pub use search::{StartSearchRequestDto, StartSearchResponseDto};
pub use settings::{
    ConflictPolicyDto, DateFormatDto, DefaultPaneLayoutDto, FavouriteLocationDto, SettingsDto,
    SizeFormatDto, ThemeDto,
};
pub use snapshot::{DirectorySnapshotDto, LoadingStateDto, VolumeCapacityDto};
pub use system_location::{SystemLocationDto, SystemLocationKindDto, VolumeDto};
pub use workspace::{
    ColumnConfigurationDto, CreateWorkspaceRequestDto, DirectoryViewConfigurationDto,
    DirectoryViewModeDto, IconSizeDto, NavigationHistoryDto, OperationCentrePreferencesDto,
    PaneStateDto, PersistedFilterDto, SortDescriptorDto, SortDirectionDto, SplitAxisDto,
    TabStateDto, WorkspaceDto, WorkspaceLayoutDto, WorkspaceSummaryDto,
};
pub use workspace_command::{
    DirectoryViewPatchDto, NavigationModeDto, QuickFilterPatchDto, WorkspaceCommandDto,
};
