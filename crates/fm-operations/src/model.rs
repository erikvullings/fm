use chrono::{DateTime, Utc};
use fm_domain::{Location, OperationId};
use fm_vfs::EntryRef;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// A backend-owned mutating filesystem job (specification §17).
#[derive(Debug, Clone, PartialEq)]
pub struct Operation {
    /// Stable job identifier.
    pub id: OperationId,
    /// Semantic mutation requested by the caller.
    pub kind: OperationKind,
    /// Current lifecycle state.
    pub state: OperationState,
    /// Entries affected by the mutation.
    pub sources: Vec<EntryRef>,
    /// Destination, when the operation has one.
    pub destination: Option<Location>,
    /// Current counters and rate.
    pub progress: OperationProgress,
    /// Conflict behavior selected by the caller.
    pub conflict_policy: ConflictPolicy,
    /// Time the job was accepted.
    pub created_at: DateTime<Utc>,
    /// Time planning began.
    pub started_at: Option<DateTime<Utc>>,
    /// Time a terminal state was reached.
    pub completed_at: Option<DateTime<Utc>>,
}

impl Operation {
    /// Creates a queued operation with no reported work.
    #[must_use]
    pub fn new(
        kind: OperationKind,
        sources: Vec<EntryRef>,
        destination: Option<Location>,
        conflict_policy: ConflictPolicy,
    ) -> Self {
        Self {
            id: OperationId::new(),
            kind,
            state: OperationState::Queued,
            sources,
            destination,
            progress: OperationProgress::default(),
            conflict_policy,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
        }
    }

    /// Applies a legal lifecycle transition and timestamps lifecycle edges.
    pub fn transition(&mut self, next: OperationState) -> Result<(), TransitionError> {
        if !self.state.can_transition_to(next) {
            return Err(TransitionError {
                from: self.state,
                to: next,
            });
        }
        self.state = next;
        let now = Utc::now();
        if next == OperationState::Planning && self.started_at.is_none() {
            self.started_at = Some(now);
        }
        if next.is_terminal() {
            self.completed_at = Some(now);
        }
        Ok(())
    }
}

/// Operation lifecycle states from specification §17.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationState {
    /// Waiting for a scheduler permit.
    Queued,
    /// Enumerating work and computing totals.
    Planning,
    /// Performing mutations.
    Running,
    /// Cooperatively paused.
    Paused,
    /// Waiting for a user conflict decision.
    WaitingForConflictResolution,
    /// Cancellation requested; finishing the current safe unit.
    Cancelling,
    /// Cancelled without a partial destination file.
    Cancelled,
    /// Finished successfully.
    Completed,
    /// Finished with non-fatal warnings.
    CompletedWithWarnings,
    /// Finished unsuccessfully.
    Failed,
}

impl OperationState {
    /// Whether this state may legally advance to `next`.
    #[must_use]
    pub const fn can_transition_to(self, next: Self) -> bool {
        use OperationState::{
            Cancelled, Cancelling, Completed, CompletedWithWarnings, Failed, Paused, Planning,
            Queued, Running, WaitingForConflictResolution,
        };
        matches!(
            (self, next),
            (Queued, Planning | Cancelling | Failed)
                | (Planning, Running | Cancelling | Failed)
                | (
                    Running,
                    Paused
                        | WaitingForConflictResolution
                        | Cancelling
                        | Completed
                        | CompletedWithWarnings
                        | Failed
                )
                | (Paused, Running | Cancelling | Failed)
                | (WaitingForConflictResolution, Running | Cancelling | Failed)
                | (Cancelling, Cancelled | Failed)
        )
    }

    /// Whether no further transition is permitted.
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Cancelled | Self::Completed | Self::CompletedWithWarnings | Self::Failed
        )
    }
}

/// Initial operation kinds from specification §17.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationKind {
    /// Create a directory.
    CreateDirectory,
    /// Rename one entry.
    Rename,
    /// Copy entries.
    Copy,
    /// Move entries.
    Move,
    /// Duplicate entries.
    Duplicate,
    /// Send entries to trash.
    Trash,
    /// Permanently delete entries.
    Delete,
}

/// Observable progress for one operation.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct OperationProgress {
    /// Completed plan items.
    pub completed_items: u64,
    /// Planned item count, if feasible to compute.
    pub total_items: Option<u64>,
    /// Completed payload bytes.
    pub completed_bytes: u64,
    /// Planned payload bytes, if feasible to compute.
    pub total_bytes: Option<u64>,
    /// Entry currently being processed.
    pub current_entry: Option<EntryRef>,
    /// Exponentially smoothed transfer rate.
    pub bytes_per_second: Option<u64>,
}

/// Conflict policies from specification §17.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicy {
    /// Ask the user.
    #[default]
    Ask,
    /// Skip a conflicting source.
    Skip,
    /// Replace an existing destination of the same entry kind.
    Overwrite,
    /// Generate a non-conflicting destination name.
    RenameNew,
    /// Keep whichever entry is newer.
    KeepNewer,
}

/// A rejected operation lifecycle transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[error("illegal operation state transition from {from:?} to {to:?}")]
pub struct TransitionError {
    /// Current state.
    pub from: OperationState,
    /// Requested state.
    pub to: OperationState,
}
