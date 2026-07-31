//! Shared wire types for semantic file operations (specification §7, §8).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::LocationDto;

/// A request to start one backend-owned semantic operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartOperationRequestDto {
    /// Semantic operation discriminator. `type` is the stable JSON field name.
    #[serde(rename = "type")]
    pub operation_type: OperationKindDto,
    /// Provider-neutral source locations.
    pub sources: Vec<LocationDto>,
    /// Optional target directory or entry.
    pub destination: Option<LocationDto>,
    /// Conflict behavior selected before execution.
    pub conflict_policy: OperationConflictPolicyDto,
    /// New child name for `createDirectory`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Whether a multi-component create-directory name may create missing parents.
    #[serde(default)]
    pub create_intermediate_directories: bool,
}

/// Initial semantic operation kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(missing_docs)]
pub enum OperationKindDto {
    CreateDirectory,
    Rename,
    Copy,
    Move,
    Duplicate,
    Trash,
    Delete,
}

/// Conflict policy carried by an operation request and snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(missing_docs)]
pub enum OperationConflictPolicyDto {
    Ask,
    Skip,
    Overwrite,
    RenameNew,
    KeepNewer,
}

/// Observable operation lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(missing_docs)]
pub enum OperationStateDto {
    Queued,
    Planning,
    Running,
    Paused,
    WaitingForConflictResolution,
    Cancelling,
    Cancelled,
    Completed,
    CompletedWithWarnings,
    Failed,
}

/// Progress counters for an operation snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OperationProgressDto {
    /// Completed plan items.
    pub completed_items: u64,
    /// Planned item count.
    pub total_items: Option<u64>,
    /// Completed bytes.
    pub completed_bytes: u64,
    /// Planned bytes.
    pub total_bytes: Option<u64>,
    /// Entry currently processed.
    pub current_entry: Option<EntryRefDto>,
    /// Smoothed byte rate.
    pub bytes_per_second: Option<u64>,
}

/// Complete transport snapshot of an operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OperationDto {
    /// Stable operation identifier.
    pub id: Uuid,
    #[serde(rename = "type")]
    /// Semantic operation discriminator.
    pub operation_type: OperationKindDto,
    /// Current lifecycle state.
    pub state: OperationStateDto,
    /// Stable source references.
    pub sources: Vec<EntryRefDto>,
    /// Optional destination.
    pub destination: Option<LocationDto>,
    /// Latest progress.
    pub progress: OperationProgressDto,
    /// Selected conflict policy.
    pub conflict_policy: OperationConflictPolicyDto,
    /// Acceptance timestamp.
    pub created_at: DateTime<Utc>,
    /// Planning start timestamp.
    pub started_at: Option<DateTime<Utc>>,
    /// Terminal timestamp.
    pub completed_at: Option<DateTime<Utc>>,
}

/// Stable provider-neutral reference included in operation snapshots.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntryRefDto {
    /// Stable entry identifier assigned by the backend.
    pub id: Uuid,
    /// Provider-neutral entry location.
    pub location: LocationDto,
}

/// Reserved conflict-resolution request for the dialog introduced by task 0045.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolveOperationConflictRequestDto {
    /// Decision for this conflict.
    pub resolution: ConflictResolutionDto,
    /// Whether the decision applies to subsequent similar conflicts.
    pub apply_to_all_similar: bool,
}

/// User decision for a pending conflict.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(missing_docs)]
pub enum ConflictResolutionDto {
    Skip,
    Overwrite,
    RenameNew,
    CancelOperation,
}
