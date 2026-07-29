//! Workspace, pane and tab state (spec §5.3).
//!
//! The engine never assumes exactly two panes: [`WorkspaceLayout`] is a
//! recursive binary split tree, so a three-or-more-pane layout nests further
//! splits instead of requiring a data-model rewrite.

use serde::{Deserialize, Serialize};

use crate::ids::{EntryId, PaneId, TabId, WorkspaceId};
use crate::location::Location;

/// A workspace: a named collection of panes arranged in a [`WorkspaceLayout`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Workspace {
    /// Stable identifier for this workspace.
    pub id: WorkspaceId,
    /// A user-facing name for this workspace.
    pub name: String,
    /// The panes making up this workspace. Never assumed to be exactly two.
    pub panes: Vec<PaneState>,
    /// The pane that currently has focus.
    pub active_pane_id: PaneId,
    /// How the panes are arranged on screen.
    pub layout: WorkspaceLayout,
}

/// A single pane, holding one or more tabs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaneState {
    /// Stable identifier for this pane.
    pub id: PaneId,
    /// The tabs open in this pane.
    pub tabs: Vec<TabState>,
    /// The tab currently shown in this pane.
    pub active_tab_id: TabId,
}

/// A single tab: a location, its navigation history and its view state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TabState {
    /// Stable identifier for this tab.
    pub id: TabId,
    /// The location currently shown in this tab.
    pub location: Location,
    /// Back/forward navigation history for this tab.
    pub history: NavigationHistory,
    /// UI view state (sort, selection, cursor) for this tab.
    pub view: DirectoryViewState,
}

/// Back/forward navigation history for a single tab.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NavigationHistory {
    /// Locations reachable by navigating back, most recent last.
    pub back: Vec<Location>,
    /// Locations reachable by navigating forward, most recent last.
    pub forward: Vec<Location>,
}

/// UI view state for a directory listing: sorting, selection and cursor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirectoryViewState {
    /// The active sort keys, in priority order. A single element today; kept
    /// as a list so multiple sort keys (spec §15) need no data-model change.
    pub sort: Vec<SortKey>,
    /// The currently selected entries.
    pub selected_entry_ids: Vec<EntryId>,
    /// The entry under the keyboard cursor, independent of selection.
    pub cursor_entry_id: Option<EntryId>,
}

/// A single sort key: a field and a direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SortKey {
    /// The field to sort by.
    pub field: SortField,
    /// The direction to sort in.
    pub direction: SortDirection,
}

/// A field that a directory listing can be sorted by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SortField {
    /// Sort by entry name.
    Name,
    /// Sort by file extension.
    Extension,
    /// Sort by entry size.
    Size,
    /// Sort by last modification time.
    ModifiedAt,
}

/// A sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SortDirection {
    /// Smallest/earliest first.
    Ascending,
    /// Largest/latest first.
    Descending,
}

/// How a workspace's panes are arranged on screen.
///
/// A recursive binary tree of splits: each [`WorkspaceLayout::Split`] is
/// exactly the two sides of one draggable splitter, so any number of panes
/// can be represented by nesting further splits, without hard-coding an
/// assumption of exactly two panes at the workspace level.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum WorkspaceLayout {
    /// A leaf holding a single pane.
    Pane(PaneId),
    /// Two regions separated by a single draggable splitter.
    Split {
        /// The axis the splitter is arranged on.
        direction: SplitDirection,
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
pub enum SplitDirection {
    /// Side by side, splitter runs vertically.
    Horizontal,
    /// Stacked, splitter runs horizontally.
    Vertical,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::ProviderId;

    fn sample_tab() -> TabState {
        TabState {
            id: TabId::new(),
            location: Location::new(ProviderId::new("file"), "file:///Users/erik"),
            history: NavigationHistory {
                back: vec![Location::new(ProviderId::new("file"), "file:///Users")],
                forward: vec![],
            },
            view: DirectoryViewState {
                sort: vec![SortKey {
                    field: SortField::Name,
                    direction: SortDirection::Ascending,
                }],
                selected_entry_ids: vec![EntryId::new()],
                cursor_entry_id: None,
            },
        }
    }

    #[test]
    fn workspace_round_trips_through_serde_json_with_a_two_pane_layout() {
        let pane_a = PaneId::new();
        let pane_b = PaneId::new();
        let tab = sample_tab();
        let workspace = Workspace {
            id: WorkspaceId::new(),
            name: "Default".to_owned(),
            panes: vec![
                PaneState {
                    id: pane_a,
                    tabs: vec![tab.clone()],
                    active_tab_id: tab.id,
                },
                PaneState {
                    id: pane_b,
                    tabs: vec![tab.clone()],
                    active_tab_id: tab.id,
                },
            ],
            active_pane_id: pane_a,
            layout: WorkspaceLayout::Split {
                direction: SplitDirection::Horizontal,
                ratio: 0.5,
                first: Box::new(WorkspaceLayout::Pane(pane_a)),
                second: Box::new(WorkspaceLayout::Pane(pane_b)),
            },
        };

        let json = serde_json::to_string(&workspace).expect("serialization must succeed");
        let parsed: Workspace = serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(workspace, parsed);
    }

    #[test]
    fn workspace_layout_supports_more_than_two_panes_via_nested_splits() {
        let layout = WorkspaceLayout::Split {
            direction: SplitDirection::Horizontal,
            ratio: 0.33,
            first: Box::new(WorkspaceLayout::Pane(PaneId::new())),
            second: Box::new(WorkspaceLayout::Split {
                direction: SplitDirection::Vertical,
                ratio: 0.5,
                first: Box::new(WorkspaceLayout::Pane(PaneId::new())),
                second: Box::new(WorkspaceLayout::Pane(PaneId::new())),
            }),
        };

        let json = serde_json::to_string(&layout).expect("serialization must succeed");
        let parsed: WorkspaceLayout =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(layout, parsed);
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
    fn directory_view_state_multi_key_sort_can_hold_a_single_key_without_rewrite() {
        let view = DirectoryViewState {
            sort: vec![SortKey {
                field: SortField::ModifiedAt,
                direction: SortDirection::Descending,
            }],
            selected_entry_ids: vec![],
            cursor_entry_id: None,
        };
        assert_eq!(view.sort.len(), 1);

        let json = serde_json::to_string(&view).expect("serialization must succeed");
        let parsed: DirectoryViewState =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(view, parsed);
    }
}
