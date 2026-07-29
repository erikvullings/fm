//! Backend-to-frontend events.
//!
//! The envelope and payload types are defined in task 0014 and the bus itself
//! in task 0031. The SSE endpoint (task 0032) and the Tauri channel
//! (task 0034) are both thin adapters over this crate, which is what keeps the
//! two transports at parity.
//!
//! Event projections intentionally mirror the OpenAPI-facing DTOs rather than
//! depending on `fm-transport-dto`: both crates are independent layer-one
//! contracts. The shared JSON fixture below cross-checks this manual mapping
//! against the frontend union.

use chrono::{DateTime, Utc};
use fm_domain::{EntryId, OperationId, PaneId, PluginId, ProviderId, TabId, WorkspaceId};
use serde::{Deserialize, Serialize};

/// Transport-neutral wrapper shared by SSE and Tauri event delivery.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventEnvelope<T> {
    /// Stable, monotonically increasing identifier allocated by the event bus.
    pub event_id: u64,
    /// UTC time at which the event was created.
    pub timestamp: DateTime<Utc>,
    /// Workspace scope, omitted for application-wide events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<WorkspaceId>,
    /// Typed event data.
    pub payload: T,
}

/// Provider-neutral location in event payloads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationPayload {
    /// Provider handling this location.
    pub provider_id: ProviderId,
    /// Canonical provider-specific URI.
    pub uri: String,
}

/// Provider-neutral entry reference used by operation events.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryRefPayload {
    /// Stable entry identifier.
    pub id: EntryId,
    /// Provider location of the entry.
    pub location: LocationPayload,
}

/// Directory-entry kind in snapshot and delta payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKindPayload {
    /// Regular file.
    File,
    /// Directory or provider-specific container.
    Directory,
    /// Symbolic link or platform equivalent.
    Symlink,
}

/// Compact directory entry carried by snapshot and delta events.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySummaryPayload {
    /// Stable entry identifier.
    pub id: EntryId,
    /// Provider location.
    pub location: LocationPayload,
    /// Display name.
    pub name: String,
    /// Entry kind.
    pub kind: EntryKindPayload,
    /// Size in bytes, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    /// Modification timestamp, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<DateTime<Utc>>,
    /// Creation timestamp, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
    /// Whether the entry is hidden.
    pub hidden: bool,
    /// Whether the entry is read-only.
    pub read_only: bool,
    /// Extension without a leading dot.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    /// Detected media type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// Display icon lookup key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_key: Option<String>,
    /// Monotonic metadata revision.
    pub metadata_revision: u64,
}

/// Directory loading state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LoadingStatePayload {
    /// Nothing requested.
    Idle,
    /// Request in flight.
    Loading,
    /// Current page loaded.
    Loaded,
    /// Request failed.
    Error {
        /// Safe user-readable message.
        message: String,
    },
}

/// Full directory state carried by snapshot and reset events.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySnapshotPayload {
    /// Pane receiving the listing.
    pub pane_id: PaneId,
    /// Request correlation identifier.
    pub request_id: String,
    /// Monotonic directory revision.
    pub revision: u64,
    /// Listed location.
    pub location: LocationPayload,
    /// Loaded entries.
    pub entries: Vec<EntrySummaryPayload>,
    /// Known total, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_known_entries: Option<u64>,
    /// Whether another page exists.
    pub has_more: bool,
    /// Opaque paging token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation_token: Option<String>,
    /// Current loading state.
    pub loading_state: LoadingStatePayload,
}

/// Workspace sort field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortFieldPayload {
    /// Name.
    Name,
    /// Extension.
    Extension,
    /// Size.
    Size,
    /// Modification time.
    ModifiedAt,
}

/// Workspace sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortDirectionPayload {
    /// Smallest first.
    Ascending,
    /// Largest first.
    Descending,
}

/// One workspace sort key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortKeyPayload {
    /// Sorted field.
    pub field: SortFieldPayload,
    /// Sort direction.
    pub direction: SortDirectionPayload,
}

/// Back/forward history for one tab.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationHistoryPayload {
    /// Back stack.
    pub back: Vec<LocationPayload>,
    /// Forward stack.
    pub forward: Vec<LocationPayload>,
}

/// Presentation state for one directory view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryViewStatePayload {
    /// Sort keys in priority order.
    pub sort: Vec<SortKeyPayload>,
    /// Selected entries.
    pub selected_entry_ids: Vec<EntryId>,
    /// Keyboard cursor entry.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_entry_id: Option<EntryId>,
}

/// One workspace tab.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabStatePayload {
    /// Stable tab identifier.
    pub id: TabId,
    /// Current location.
    pub location: LocationPayload,
    /// Navigation history.
    pub history: NavigationHistoryPayload,
    /// Directory presentation state.
    pub view: DirectoryViewStatePayload,
}

/// One workspace pane.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneStatePayload {
    /// Stable pane identifier.
    pub id: PaneId,
    /// Pane tabs.
    pub tabs: Vec<TabStatePayload>,
    /// Active tab identifier.
    pub active_tab_id: TabId,
}

/// Workspace split direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SplitDirectionPayload {
    /// Side by side.
    Horizontal,
    /// Stacked.
    Vertical,
}

/// Recursive workspace layout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WorkspaceLayoutPayload {
    /// Pane leaf.
    Pane {
        /// Pane occupying the leaf.
        pane_id: PaneId,
    },
    /// Two regions separated by a splitter.
    Split {
        /// Split axis.
        direction: SplitDirectionPayload,
        /// Fraction assigned to the first region.
        ratio: f32,
        /// First region.
        first: Box<WorkspaceLayoutPayload>,
        /// Second region.
        second: Box<WorkspaceLayoutPayload>,
    },
}

/// Current workspace projection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePayload {
    /// Stable workspace identifier.
    pub id: WorkspaceId,
    /// Display name.
    pub name: String,
    /// Workspace panes.
    pub panes: Vec<PaneStatePayload>,
    /// Focused pane.
    pub active_pane_id: PaneId,
    /// Pane arrangement.
    pub layout: WorkspaceLayoutPayload,
}

/// Initial operation kinds from specification §17.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationKindPayload {
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

/// Operation lifecycle states from specification §17.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationStatePayload {
    /// Waiting to start.
    Queued,
    /// Enumerating work and totals.
    Planning,
    /// Performing filesystem mutations.
    Running,
    /// Paused by the user.
    Paused,
    /// Awaiting conflict resolution.
    WaitingForConflictResolution,
    /// Cancellation was requested.
    Cancelling,
    /// Cancelled at a safe point.
    Cancelled,
    /// Completed successfully.
    Completed,
    /// Completed with non-fatal warnings.
    CompletedWithWarnings,
    /// Failed.
    Failed,
}

/// Conflict policies from specification §17.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicyPayload {
    /// Ask the user.
    Ask,
    /// Skip the conflicting entry.
    Skip,
    /// Replace the destination.
    Overwrite,
    /// Generate a new destination name.
    RenameNew,
    /// Keep the newer entry.
    KeepNewer,
}

/// Progress counters for an operation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationProgressDetails {
    /// Number of completed entries.
    pub completed_items: u64,
    /// Total entries, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_items: Option<u64>,
    /// Number of completed bytes.
    pub completed_bytes: u64,
    /// Total bytes, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    /// Entry currently being processed, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_entry: Option<EntryRefPayload>,
    /// Current transfer rate, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_per_second: Option<u64>,
}

/// Progress counters associated with a running operation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationProgressPayload {
    /// Operation being measured.
    pub operation_id: OperationId,
    /// Current counters.
    pub progress: OperationProgressDetails,
}

/// A file operation carried by operation lifecycle events.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationPayload {
    /// Stable operation identifier.
    pub id: OperationId,
    /// Operation kind.
    pub kind: OperationKindPayload,
    /// Current lifecycle state.
    pub state: OperationStatePayload,
    /// Source entries.
    pub sources: Vec<EntryRefPayload>,
    /// Destination location, when the kind has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination: Option<LocationPayload>,
    /// Current progress.
    pub progress: OperationProgressDetails,
    /// Active conflict policy.
    pub conflict_policy: ConflictPolicyPayload,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Start timestamp, when started.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
    /// Completion timestamp, when finished.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
}

/// Incremental directory changes in the frontend wire format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DirectoryDeltaPayload {
    /// Entries were added.
    EntriesAdded {
        /// New directory revision.
        revision: u64,
        /// Added entries.
        entries: Vec<EntrySummaryPayload>,
    },
    /// Entries were updated.
    EntriesUpdated {
        /// New directory revision.
        revision: u64,
        /// Updated entries.
        entries: Vec<EntrySummaryPayload>,
    },
    /// Entries were removed.
    EntriesRemoved {
        /// New directory revision.
        revision: u64,
        /// Removed entry identifiers.
        entry_ids: Vec<EntryId>,
    },
    /// Incremental state is invalid and must be replaced.
    Reset {
        /// Replacement snapshot.
        snapshot: DirectorySnapshotPayload,
    },
}

/// Conflict requiring an explicit request/response resolution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationConflictPayload {
    /// Operation waiting for a decision.
    pub operation_id: OperationId,
    /// Stable conflict identifier.
    pub conflict_id: String,
    /// Human-readable conflict summary.
    pub message: String,
}

/// Plugin state delivered when discovery or enablement changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPayload {
    /// Plugin identifier.
    pub id: PluginId,
    /// Display name.
    pub name: String,
    /// Manifest version.
    pub version: String,
    /// Whether the plugin is enabled.
    pub enabled: bool,
}

/// User-visible notification delivered by the backend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPayload {
    /// Stable notification identifier.
    pub id: String,
    /// Severity (`info`, `warning`, or `error`).
    pub level: NotificationLevelPayload,
    /// Human-readable message.
    pub message: String,
}

/// User-visible notification severity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NotificationLevelPayload {
    /// Informational message.
    Info,
    /// Warning that may require attention.
    Warning,
    /// Error requiring attention.
    Error,
}

/// All backend-to-frontend event payloads named by specification §10.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BackendEventPayload {
    /// Runtime startup completed.
    #[serde(rename = "runtime.ready")]
    RuntimeReady,
    /// Workspace state changed.
    #[serde(rename = "workspace.updated")]
    WorkspaceUpdated {
        /// Current workspace projection.
        workspace: WorkspacePayload,
    },
    /// Full directory state is available.
    #[serde(rename = "directory.snapshot")]
    DirectorySnapshot {
        /// Current directory snapshot.
        snapshot: DirectorySnapshotPayload,
    },
    /// Incremental directory state is available.
    #[serde(rename = "directory.delta")]
    DirectoryDelta {
        /// Incremental change.
        delta: DirectoryDeltaPayload,
    },
    /// An operation was accepted.
    #[serde(rename = "operation.created")]
    OperationCreated {
        /// Created operation.
        operation: OperationPayload,
    },
    /// Operation progress changed.
    #[serde(rename = "operation.progress")]
    OperationProgress {
        /// Current progress.
        #[serde(flatten)]
        progress: OperationProgressPayload,
    },
    /// Operation lifecycle state changed.
    #[serde(rename = "operation.stateChanged")]
    OperationStateChanged {
        /// Operation identifier.
        operation_id: OperationId,
        /// New lifecycle state.
        state: OperationStatePayload,
    },
    /// An operation requires conflict resolution.
    #[serde(rename = "operation.conflict")]
    OperationConflict {
        /// Conflict details.
        #[serde(flatten)]
        conflict: OperationConflictPayload,
    },
    /// An operation completed successfully.
    #[serde(rename = "operation.completed")]
    OperationCompleted {
        /// Completed operation.
        operation: OperationPayload,
    },
    /// An operation failed.
    #[serde(rename = "operation.failed")]
    OperationFailed {
        /// Failed operation identifier.
        operation_id: OperationId,
        /// Stable error code.
        code: String,
        /// User-readable error message.
        message: String,
    },
    /// Plugin discovery or enablement changed.
    #[serde(rename = "plugin.changed")]
    PluginChanged {
        /// Current plugin projection.
        plugin: PluginPayload,
    },
    /// A user-visible notification was created.
    #[serde(rename = "notification.created")]
    NotificationCreated {
        /// Created notification.
        notification: NotificationPayload,
    },
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use chrono::{TimeZone, Utc};
    use fm_domain::{OperationId, PluginId, ProviderId, WorkspaceId};
    use serde_json::json;

    use super::{
        BackendEventPayload, ConflictPolicyPayload, DirectoryDeltaPayload,
        DirectorySnapshotPayload, DirectoryViewStatePayload, EventEnvelope, LoadingStatePayload,
        LocationPayload, NavigationHistoryPayload, NotificationLevelPayload, NotificationPayload,
        OperationConflictPayload, OperationKindPayload, OperationPayload, OperationProgressDetails,
        OperationProgressPayload, OperationStatePayload, PaneStatePayload, PluginPayload,
        SortDirectionPayload, SortFieldPayload, SortKeyPayload, TabStatePayload,
        WorkspaceLayoutPayload, WorkspacePayload,
    };

    const WORKSPACE_ID: &str = "11111111-1111-4111-8111-111111111111";
    const OPERATION_ID: &str = "22222222-2222-4222-8222-222222222222";

    fn fixture_envelope() -> EventEnvelope<BackendEventPayload> {
        EventEnvelope {
            event_id: 1042,
            timestamp: Utc
                .with_ymd_and_hms(2026, 7, 29, 12, 34, 56)
                .single()
                .expect("fixture timestamp must be valid"),
            workspace_id: Some(
                WorkspaceId::from_str(WORKSPACE_ID).expect("fixture workspace id must be valid"),
            ),
            payload: BackendEventPayload::OperationProgress {
                progress: OperationProgressPayload {
                    operation_id: OperationId::from_str(OPERATION_ID)
                        .expect("fixture operation id must be valid"),
                    progress: OperationProgressDetails {
                        completed_items: 3,
                        total_items: Some(10),
                        completed_bytes: 1_048_576,
                        total_bytes: Some(5_242_880),
                        current_entry: None,
                        bytes_per_second: Some(262_144),
                    },
                },
            },
        }
    }

    fn sample_workspace() -> WorkspacePayload {
        let pane_id = "33333333-3333-4333-8333-333333333333"
            .parse()
            .expect("fixture pane id must be valid");
        let tab_id = "44444444-4444-4444-8444-444444444444"
            .parse()
            .expect("fixture tab id must be valid");
        WorkspacePayload {
            id: WORKSPACE_ID.parse().expect("fixture id must be valid"),
            name: "Fixture".to_owned(),
            panes: vec![PaneStatePayload {
                id: pane_id,
                tabs: vec![TabStatePayload {
                    id: tab_id,
                    location: LocationPayload {
                        provider_id: ProviderId::new("file"),
                        uri: "file:///fixture".to_owned(),
                    },
                    history: NavigationHistoryPayload {
                        back: vec![],
                        forward: vec![],
                    },
                    view: DirectoryViewStatePayload {
                        sort: vec![SortKeyPayload {
                            field: SortFieldPayload::Name,
                            direction: SortDirectionPayload::Ascending,
                        }],
                        selected_entry_ids: vec![],
                        cursor_entry_id: None,
                    },
                }],
                active_tab_id: tab_id,
            }],
            active_pane_id: pane_id,
            layout: WorkspaceLayoutPayload::Pane { pane_id },
        }
    }

    fn sample_snapshot() -> DirectorySnapshotPayload {
        DirectorySnapshotPayload {
            pane_id: "33333333-3333-4333-8333-333333333333"
                .parse()
                .expect("fixture pane id must be valid"),
            request_id: "55555555-5555-4555-8555-555555555555".to_owned(),
            revision: 1,
            location: LocationPayload {
                provider_id: ProviderId::new("file"),
                uri: "file:///fixture".to_owned(),
            },
            entries: vec![],
            total_known_entries: Some(0),
            has_more: false,
            continuation_token: None,
            loading_state: LoadingStatePayload::Loaded,
        }
    }

    #[test]
    fn envelope_serializes_to_the_shared_frontend_fixture() {
        let actual = serde_json::to_value(fixture_envelope()).expect("serialization must succeed");
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../../fixtures/events/operation-progress.json"
        ))
        .expect("shared fixture must be valid JSON");

        assert_eq!(actual, expected);
    }

    #[test]
    fn every_backend_event_uses_the_named_type_discriminator() {
        let events = BackendEventPayload::fixture_variants();
        let actual = events
            .into_iter()
            .map(|event| {
                serde_json::to_value(event)
                    .expect("serialization must succeed")
                    .get("type")
                    .and_then(serde_json::Value::as_str)
                    .expect("event must have a string type")
                    .to_owned()
            })
            .collect::<Vec<_>>();

        assert_eq!(
            actual,
            [
                "runtime.ready",
                "workspace.updated",
                "directory.snapshot",
                "directory.delta",
                "operation.created",
                "operation.progress",
                "operation.stateChanged",
                "operation.conflict",
                "operation.completed",
                "operation.failed",
                "plugin.changed",
                "notification.created",
            ]
        );
    }

    #[test]
    fn absent_workspace_id_is_omitted_from_json() {
        let envelope = EventEnvelope {
            event_id: 1,
            timestamp: Utc
                .timestamp_opt(0, 0)
                .single()
                .expect("Unix epoch is valid"),
            workspace_id: None,
            payload: BackendEventPayload::RuntimeReady,
        };

        assert_eq!(
            serde_json::to_value(envelope).expect("serialization must succeed"),
            json!({
                "eventId": 1,
                "timestamp": "1970-01-01T00:00:00Z",
                "payload": {"type": "runtime.ready"}
            })
        );
    }

    impl BackendEventPayload {
        fn fixture_variants() -> Vec<Self> {
            let operation_id =
                OperationId::from_str(OPERATION_ID).expect("fixture operation id must be valid");
            let operation = OperationPayload {
                id: operation_id,
                kind: OperationKindPayload::Copy,
                state: OperationStatePayload::Running,
                sources: vec![],
                destination: None,
                progress: OperationProgressDetails {
                    completed_items: 0,
                    total_items: None,
                    completed_bytes: 0,
                    total_bytes: None,
                    current_entry: None,
                    bytes_per_second: None,
                },
                conflict_policy: ConflictPolicyPayload::Ask,
                created_at: Utc
                    .timestamp_opt(0, 0)
                    .single()
                    .expect("Unix epoch is valid"),
                started_at: None,
                completed_at: None,
            };
            vec![
                Self::RuntimeReady,
                Self::WorkspaceUpdated {
                    workspace: sample_workspace(),
                },
                Self::DirectorySnapshot {
                    snapshot: sample_snapshot(),
                },
                Self::DirectoryDelta {
                    delta: DirectoryDeltaPayload::EntriesRemoved {
                        revision: 2,
                        entry_ids: vec![],
                    },
                },
                Self::OperationCreated {
                    operation: operation.clone(),
                },
                fixture_envelope().payload,
                Self::OperationStateChanged {
                    operation_id,
                    state: OperationStatePayload::Paused,
                },
                Self::OperationConflict {
                    conflict: OperationConflictPayload {
                        operation_id,
                        conflict_id: "conflict-1".to_owned(),
                        message: "Destination exists".to_owned(),
                    },
                },
                Self::OperationCompleted {
                    operation: operation.clone(),
                },
                Self::OperationFailed {
                    operation_id,
                    code: "permissionDenied".to_owned(),
                    message: "Permission denied".to_owned(),
                },
                Self::PluginChanged {
                    plugin: PluginPayload {
                        id: PluginId::new("fixture"),
                        name: "Fixture".to_owned(),
                        version: "1.0.0".to_owned(),
                        enabled: true,
                    },
                },
                Self::NotificationCreated {
                    notification: NotificationPayload {
                        id: "notification-1".to_owned(),
                        level: NotificationLevelPayload::Info,
                        message: "Done".to_owned(),
                    },
                },
            ]
        }
    }
}
