//! Workspace, pane and tab state (spec §5.3).
//!
//! The engine never assumes exactly two panes: [`WorkspaceLayout`] is a
//! recursive binary split tree, so a three-or-more-pane layout nests further
//! splits instead of requiring a data-model rewrite.
//!
//! Only the durable, persisted configuration lives here (spec §5.3.3's
//! `WorkspaceDefinition` layer). Process-local runtime state (`WorkspaceRuntime`)
//! and frontend-only cursor/selection/dialog state (`WorkspaceViewState`, task
//! 0082) are deliberately out of scope for this crate: [`DirectoryViewConfiguration`]
//! holds only persisted view configuration and cannot represent selection or
//! cursor state.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::ids::{PaneId, TabId, WorkspaceId};
use crate::location::Location;

/// A workspace: a named collection of panes arranged in a [`WorkspaceLayout`]
/// (spec §5.3.3's `WorkspaceDefinition`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Workspace {
    /// Version of the persisted workspace schema, for migrations.
    pub schema_version: u32,
    /// Stable identifier for this workspace.
    pub id: WorkspaceId,
    /// A user-facing name for this workspace.
    pub name: String,
    /// How the panes are arranged on screen.
    pub layout: WorkspaceLayout,
    /// The panes making up this workspace. Never assumed to be exactly two.
    pub panes: Vec<PaneState>,
    /// The pane that currently has focus.
    pub active_pane_id: PaneId,
    /// Operation-centre visibility and sizing preferences for this workspace.
    pub operation_centre: OperationCentrePreferences,
    /// When this workspace was first created.
    pub created_at: DateTime<Utc>,
    /// When this workspace was last persisted.
    pub updated_at: DateTime<Utc>,
    /// Monotonically increasing revision, used for optimistic conflict checks.
    pub revision: u64,
}

/// Workspace-level operation-centre visibility and sizing preferences.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct OperationCentrePreferences {
    /// Whether the operation centre panel is visible.
    pub visible: bool,
    /// The panel's height in pixels.
    pub height: u32,
}

/// A single pane, holding one or more tabs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaneState {
    /// Stable identifier for this pane.
    pub id: PaneId,
    /// An optional user-facing title override for this pane.
    pub title: Option<String>,
    /// The tabs open in this pane.
    pub tabs: Vec<TabState>,
    /// The tab currently shown in this pane.
    pub active_tab_id: TabId,
    /// The view configuration new tabs in this pane start from.
    pub default_view: DirectoryViewConfiguration,
}

/// A single tab: a location, its navigation history and its view configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TabState {
    /// Stable identifier for this tab.
    pub id: TabId,
    /// The location currently shown in this tab.
    pub location: Location,
    /// An optional user-facing title override for this tab.
    pub title_override: Option<String>,
    /// Back/forward navigation history for this tab.
    pub history: NavigationHistory,
    /// Persisted view configuration (sort, columns, filters) for this tab.
    pub view: DirectoryViewConfiguration,
    /// Whether this tab is pinned (protected from ordinary "close tab" actions).
    pub pinned: bool,
}

/// Back/forward navigation history for a single tab.
///
/// Deviation from spec §5.3.4: the spec's `NavigationHistory` adds an explicit
/// `current: Location` field. This type deliberately omits it and keeps
/// [`TabState::location`] as the single source of truth for the current
/// location, so navigating never requires updating two fields in lockstep.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NavigationHistory {
    /// Locations reachable by navigating back, most recent last.
    pub back: Vec<Location>,
    /// Locations reachable by navigating forward, most recent last.
    pub forward: Vec<Location>,
}

/// Persisted view configuration for a directory listing: sorting, columns and
/// filters (spec §5.3.4).
///
/// Contains no frontend-only fields: current row selection and keyboard
/// cursor are frontend session state (spec §5.3.2) and are never represented
/// here, so a workspace save can never persist them by accident.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DirectoryViewConfiguration {
    /// The active sort descriptors, in priority order. A single element
    /// today; kept as a list so multiple sort keys (spec §15) need no
    /// data-model change.
    pub sort: Vec<SortDescriptor>,
    /// Per-column width and visibility.
    pub columns: Vec<ColumnConfiguration>,
    /// Whether hidden entries are shown.
    pub show_hidden: bool,
    /// Whether directories are grouped before files.
    pub folders_first: bool,
    /// A persisted quick-filter query, if one is saved with the tab.
    pub quick_filter: Option<PersistedFilter>,
}

/// A single sort descriptor: a column and a direction.
///
/// Uses an open, string-valued `column_id` (matching [`ColumnConfiguration`])
/// rather than a closed field enum, so plugin-provided columns can be sorted
/// on the same footing as built-in ones (spec §5.3.6 invariant 12).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SortDescriptor {
    /// The column to sort by, e.g. `"core.name"` or a plugin-provided column.
    pub column_id: String,
    /// The direction to sort in.
    pub direction: SortDirection,
}

/// A sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SortDirection {
    /// Smallest/earliest first.
    Ascending,
    /// Largest/latest first.
    Descending,
}

/// Persisted width and visibility for a single directory-table column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnConfiguration {
    /// The column's identifier, e.g. `"core.name"` or a plugin-provided column.
    pub column_id: String,
    /// The column's width in pixels.
    pub width: u32,
    /// Whether the column is currently visible.
    pub visible: bool,
}

/// A persisted quick-filter query (spec §24: plain text initially, glob or
/// regex support is a later addition).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersistedFilter {
    /// The filter's plain-text query.
    pub query: String,
}

/// How a workspace's panes are arranged on screen.
///
/// A recursive binary tree of splits: each [`WorkspaceLayout::Split`] is
/// exactly the two sides of one draggable splitter, so any number of panes
/// can be represented by nesting further splits, without hard-coding an
/// assumption of exactly two panes at the workspace level.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WorkspaceLayout {
    /// A leaf holding a single pane.
    #[serde(rename_all = "camelCase")]
    Pane {
        /// The pane occupying this leaf.
        pane_id: PaneId,
    },
    /// Two regions separated by a single draggable splitter.
    #[serde(rename_all = "camelCase")]
    Split {
        /// The axis the splitter is arranged on.
        axis: SplitAxis,
        /// The fraction of space (0.0-1.0) given to `first`.
        ratio: f32,
        /// The first (left or top) region.
        first: Box<WorkspaceLayout>,
        /// The second (right or bottom) region.
        second: Box<WorkspaceLayout>,
    },
}

/// The axis a [`WorkspaceLayout::Split`] is arranged on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SplitAxis {
    /// Side by side, splitter runs vertically.
    Horizontal,
    /// Stacked, splitter runs horizontally.
    Vertical,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::ProviderId;

    fn sample_view() -> DirectoryViewConfiguration {
        DirectoryViewConfiguration {
            sort: vec![SortDescriptor {
                column_id: "core.name".to_owned(),
                direction: SortDirection::Ascending,
            }],
            columns: vec![ColumnConfiguration {
                column_id: "core.name".to_owned(),
                width: 360,
                visible: true,
            }],
            show_hidden: true,
            folders_first: true,
            quick_filter: None,
        }
    }

    fn sample_tab() -> TabState {
        TabState {
            id: TabId::new(),
            location: Location::new(ProviderId::new("file"), "file:///Users/erik"),
            title_override: None,
            history: NavigationHistory {
                back: vec![Location::new(ProviderId::new("file"), "file:///Users")],
                forward: vec![],
            },
            view: sample_view(),
            pinned: false,
        }
    }

    fn sample_workspace() -> Workspace {
        let pane_a = PaneId::new();
        let pane_b = PaneId::new();
        let tab = sample_tab();
        Workspace {
            schema_version: 1,
            id: WorkspaceId::new(),
            name: "Default".to_owned(),
            panes: vec![
                PaneState {
                    id: pane_a,
                    title: None,
                    tabs: vec![tab.clone()],
                    active_tab_id: tab.id,
                    default_view: sample_view(),
                },
                PaneState {
                    id: pane_b,
                    title: None,
                    tabs: vec![tab.clone()],
                    active_tab_id: tab.id,
                    default_view: sample_view(),
                },
            ],
            active_pane_id: pane_a,
            layout: WorkspaceLayout::Split {
                axis: SplitAxis::Horizontal,
                ratio: 0.5,
                first: Box::new(WorkspaceLayout::Pane { pane_id: pane_a }),
                second: Box::new(WorkspaceLayout::Pane { pane_id: pane_b }),
            },
            operation_centre: OperationCentrePreferences {
                visible: true,
                height: 180,
            },
            created_at: Utc::now(),
            updated_at: Utc::now(),
            revision: 1,
        }
    }

    #[test]
    fn workspace_round_trips_through_serde_json_with_a_two_pane_layout() {
        let workspace = sample_workspace();

        let json = serde_json::to_string(&workspace).expect("serialization must succeed");
        let parsed: Workspace = serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(workspace, parsed);
    }

    #[test]
    fn workspace_layout_supports_more_than_two_panes_via_nested_splits() {
        let layout = WorkspaceLayout::Split {
            axis: SplitAxis::Horizontal,
            ratio: 0.33,
            first: Box::new(WorkspaceLayout::Pane {
                pane_id: PaneId::new(),
            }),
            second: Box::new(WorkspaceLayout::Split {
                axis: SplitAxis::Vertical,
                ratio: 0.5,
                first: Box::new(WorkspaceLayout::Pane {
                    pane_id: PaneId::new(),
                }),
                second: Box::new(WorkspaceLayout::Pane {
                    pane_id: PaneId::new(),
                }),
            }),
        };

        let json = serde_json::to_string(&layout).expect("serialization must succeed");
        let parsed: WorkspaceLayout =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(layout, parsed);
    }

    #[test]
    fn workspace_layout_pane_is_a_struct_variant_matching_the_spec_json_shape() {
        let pane_id = PaneId::new();
        let layout = WorkspaceLayout::Pane { pane_id };

        let json = serde_json::to_string(&layout).expect("serialization must succeed");
        assert_eq!(json, format!(r#"{{"type":"pane","paneId":"{pane_id}"}}"#));
    }

    #[test]
    fn navigation_history_round_trips_with_empty_stacks() {
        let history = NavigationHistory {
            back: vec![],
            forward: vec![],
        };
        let json = serde_json::to_string(&history).expect("serialization must succeed");
        let parsed: NavigationHistory =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(history, parsed);
    }

    #[test]
    fn directory_view_configuration_multi_key_sort_can_hold_a_single_key_without_rewrite() {
        let view = DirectoryViewConfiguration {
            sort: vec![SortDescriptor {
                column_id: "core.modified".to_owned(),
                direction: SortDirection::Descending,
            }],
            ..sample_view()
        };
        assert_eq!(view.sort.len(), 1);

        let json = serde_json::to_string(&view).expect("serialization must succeed");
        let parsed: DirectoryViewConfiguration =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(view, parsed);
    }

    #[test]
    fn directory_view_configuration_cannot_represent_selection_or_cursor_state() {
        let json = serde_json::json!({
            "sort": [],
            "columns": [],
            "showHidden": false,
            "foldersFirst": false,
            "quickFilter": null,
            "selectedEntryIds": ["not-a-real-field"],
            "cursorEntryId": "also-not-real",
        });

        let result: Result<DirectoryViewConfiguration, _> = serde_json::from_value(json);
        assert!(
            result.is_err(),
            "DirectoryViewConfiguration must reject selection/cursor fields, got {result:?}"
        );
    }

    /// Literal example from spec §5.3.15 (timestamps normalized to a fixed
    /// offset, values otherwise verbatim).
    /// Content transcribed from the spec §5.3.15 example, using this crate's
    /// own field-naming convention (snake_case, matching every other
    /// `fm-domain` type such as [`Location`]) rather than the wire-facing
    /// camelCase JSON shown in the spec. `WorkspaceLayout` is the one
    /// exception: it already carries `#[serde(tag = "type", rename_all =
    /// "camelCase")]` directly (verbatim from §5.3.5), so its keys stay
    /// camelCase here too. The literal, byte-for-byte camelCase JSON from
    /// §5.3.15 is exercised against `WorkspaceDto` in `fm-transport-dto`,
    /// which is the layer responsible for wire compatibility.
    const SPEC_EXAMPLE_JSON: &str = r#"{
      "schema_version": 1,
      "id": "985d4d6e-c37b-4135-90a0-ce0afe165fd9",
      "name": "Development",
      "revision": 12,
      "layout": {
        "type": "split",
        "axis": "horizontal",
        "ratio": 0.52,
        "first": { "type": "pane", "paneId": "11e67e3e-813c-44c5-9426-53be347ad5da" },
        "second": { "type": "pane", "paneId": "479ec0f0-0ea6-4a34-b67e-f654373596af" }
      },
      "panes": [
        {
          "id": "11e67e3e-813c-44c5-9426-53be347ad5da",
          "title": null,
          "active_tab_id": "97512c58-9cf8-4f17-a931-94f0be87a1da",
          "default_view": {
            "sort": [{ "column_id": "core.name", "direction": "Ascending" }],
            "columns": [
              { "column_id": "core.name", "width": 360, "visible": true },
              { "column_id": "core.size", "width": 100, "visible": true },
              { "column_id": "core.modified", "width": 170, "visible": true }
            ],
            "show_hidden": true,
            "folders_first": true,
            "quick_filter": null
          },
          "tabs": [
            {
              "id": "97512c58-9cf8-4f17-a931-94f0be87a1da",
              "location": { "provider_id": "local", "uri": "file:///Users/erik/dev" },
              "title_override": null,
              "history": { "back": [], "forward": [] },
              "view": {
                "sort": [{ "column_id": "core.name", "direction": "Ascending" }],
                "columns": [
                  { "column_id": "core.name", "width": 360, "visible": true },
                  { "column_id": "core.size", "width": 100, "visible": true },
                  { "column_id": "core.modified", "width": 170, "visible": true }
                ],
                "show_hidden": true,
                "folders_first": true,
                "quick_filter": null
              },
              "pinned": false
            }
          ]
        },
        {
          "id": "479ec0f0-0ea6-4a34-b67e-f654373596af",
          "title": null,
          "active_tab_id": "5e8be42f-d6ef-45fb-89ea-d77122076bc3",
          "default_view": {
            "sort": [{ "column_id": "core.modified", "direction": "Descending" }],
            "columns": [
              { "column_id": "core.name", "width": 340, "visible": true },
              { "column_id": "core.size", "width": 100, "visible": true },
              { "column_id": "core.modified", "width": 170, "visible": true }
            ],
            "show_hidden": false,
            "folders_first": true,
            "quick_filter": null
          },
          "tabs": [
            {
              "id": "5e8be42f-d6ef-45fb-89ea-d77122076bc3",
              "location": { "provider_id": "local", "uri": "file:///Users/erik/Downloads" },
              "title_override": null,
              "history": { "back": [], "forward": [] },
              "view": {
                "sort": [{ "column_id": "core.modified", "direction": "Descending" }],
                "columns": [
                  { "column_id": "core.name", "width": 340, "visible": true },
                  { "column_id": "core.size", "width": 100, "visible": true },
                  { "column_id": "core.modified", "width": 170, "visible": true }
                ],
                "show_hidden": false,
                "folders_first": true,
                "quick_filter": null
              },
              "pinned": false
            }
          ]
        }
      ],
      "active_pane_id": "11e67e3e-813c-44c5-9426-53be347ad5da",
      "operation_centre": { "visible": true, "height": 180 },
      "created_at": "2026-07-29T18:00:00+02:00",
      "updated_at": "2026-07-29T18:40:00+02:00"
    }"#;

    #[test]
    fn workspace_round_trips_against_the_literal_spec_example_json() {
        let workspace: Workspace =
            serde_json::from_str(SPEC_EXAMPLE_JSON).expect("the §5.3.15 example must deserialize");

        assert_eq!(workspace.schema_version, 1);
        assert_eq!(workspace.name, "Development");
        assert_eq!(workspace.revision, 12);
        assert_eq!(workspace.panes.len(), 2);
        assert!(workspace.operation_centre.visible);
        assert_eq!(workspace.operation_centre.height, 180);
        assert_eq!(
            workspace.panes[0].tabs[0].view.sort[0].column_id,
            "core.name"
        );
        assert!(!workspace.panes[0].tabs[0].pinned);

        let json = serde_json::to_string(&workspace).expect("serialization must succeed");
        let round_tripped: Workspace =
            serde_json::from_str(&json).expect("re-deserialization must succeed");
        assert_eq!(workspace, round_tripped);
    }
}
