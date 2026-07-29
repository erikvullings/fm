//! Wire representation of [`fm_domain::Workspace`], its panes and tabs
//! (spec §5.3).

use fm_domain::{
    DirectoryViewState, EntryId, NavigationHistory, PaneId, PaneState, SortDirection, SortField,
    SortKey, SplitDirection, TabId, TabState, Workspace, WorkspaceId, WorkspaceLayout,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::location::LocationDto;

/// A field that a directory listing can be sorted by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum SortFieldDto {
    /// Sort by entry name.
    Name,
    /// Sort by file extension.
    Extension,
    /// Sort by entry size.
    Size,
    /// Sort by last modification time.
    ModifiedAt,
}

impl From<SortField> for SortFieldDto {
    fn from(field: SortField) -> Self {
        match field {
            SortField::Name => Self::Name,
            SortField::Extension => Self::Extension,
            SortField::Size => Self::Size,
            SortField::ModifiedAt => Self::ModifiedAt,
        }
    }
}

impl From<SortFieldDto> for SortField {
    fn from(field: SortFieldDto) -> Self {
        match field {
            SortFieldDto::Name => Self::Name,
            SortFieldDto::Extension => Self::Extension,
            SortFieldDto::Size => Self::Size,
            SortFieldDto::ModifiedAt => Self::ModifiedAt,
        }
    }
}

/// A sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum SortDirectionDto {
    /// Smallest/earliest first.
    Ascending,
    /// Largest/latest first.
    Descending,
}

impl From<SortDirection> for SortDirectionDto {
    fn from(direction: SortDirection) -> Self {
        match direction {
            SortDirection::Ascending => Self::Ascending,
            SortDirection::Descending => Self::Descending,
        }
    }
}

impl From<SortDirectionDto> for SortDirection {
    fn from(direction: SortDirectionDto) -> Self {
        match direction {
            SortDirectionDto::Ascending => Self::Ascending,
            SortDirectionDto::Descending => Self::Descending,
        }
    }
}

/// A single sort key: a field and a direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SortKeyDto {
    /// The field to sort by.
    pub field: SortFieldDto,
    /// The direction to sort in.
    pub direction: SortDirectionDto,
}

impl From<SortKey> for SortKeyDto {
    fn from(key: SortKey) -> Self {
        Self {
            field: key.field.into(),
            direction: key.direction.into(),
        }
    }
}

impl From<SortKeyDto> for SortKey {
    fn from(dto: SortKeyDto) -> Self {
        Self {
            field: dto.field.into(),
            direction: dto.direction.into(),
        }
    }
}

/// Back/forward navigation history for a single tab.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NavigationHistoryDto {
    /// Locations reachable by navigating back, most recent last.
    pub back: Vec<LocationDto>,
    /// Locations reachable by navigating forward, most recent last.
    pub forward: Vec<LocationDto>,
}

impl From<NavigationHistory> for NavigationHistoryDto {
    fn from(history: NavigationHistory) -> Self {
        Self {
            back: history.back.into_iter().map(Into::into).collect(),
            forward: history.forward.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<NavigationHistoryDto> for NavigationHistory {
    fn from(dto: NavigationHistoryDto) -> Self {
        Self {
            back: dto.back.into_iter().map(Into::into).collect(),
            forward: dto.forward.into_iter().map(Into::into).collect(),
        }
    }
}

/// UI view state for a directory listing: sorting, selection and cursor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryViewStateDto {
    /// The active sort keys, in priority order.
    pub sort: Vec<SortKeyDto>,
    /// The currently selected entries.
    pub selected_entry_ids: Vec<Uuid>,
    /// The entry under the keyboard cursor, independent of selection.
    pub cursor_entry_id: Option<Uuid>,
}

impl From<DirectoryViewState> for DirectoryViewStateDto {
    fn from(view: DirectoryViewState) -> Self {
        Self {
            sort: view.sort.into_iter().map(Into::into).collect(),
            selected_entry_ids: view
                .selected_entry_ids
                .into_iter()
                .map(Into::into)
                .collect(),
            cursor_entry_id: view.cursor_entry_id.map(Into::into),
        }
    }
}

impl From<DirectoryViewStateDto> for DirectoryViewState {
    fn from(dto: DirectoryViewStateDto) -> Self {
        Self {
            sort: dto.sort.into_iter().map(Into::into).collect(),
            selected_entry_ids: dto
                .selected_entry_ids
                .into_iter()
                .map(EntryId::from)
                .collect(),
            cursor_entry_id: dto.cursor_entry_id.map(EntryId::from),
        }
    }
}

/// A single tab: a location, its navigation history and its view state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TabStateDto {
    /// Stable identifier for this tab.
    pub id: Uuid,
    /// The location currently shown in this tab.
    pub location: LocationDto,
    /// Back/forward navigation history for this tab.
    pub history: NavigationHistoryDto,
    /// UI view state (sort, selection, cursor) for this tab.
    pub view: DirectoryViewStateDto,
}

impl From<TabState> for TabStateDto {
    fn from(tab: TabState) -> Self {
        Self {
            id: tab.id.into(),
            location: tab.location.into(),
            history: tab.history.into(),
            view: tab.view.into(),
        }
    }
}

impl From<TabStateDto> for TabState {
    fn from(dto: TabStateDto) -> Self {
        Self {
            id: TabId::from(dto.id),
            location: dto.location.into(),
            history: dto.history.into(),
            view: dto.view.into(),
        }
    }
}

/// A single pane, holding one or more tabs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PaneStateDto {
    /// Stable identifier for this pane.
    pub id: Uuid,
    /// The tabs open in this pane.
    pub tabs: Vec<TabStateDto>,
    /// The tab currently shown in this pane.
    pub active_tab_id: Uuid,
}

impl From<PaneState> for PaneStateDto {
    fn from(pane: PaneState) -> Self {
        Self {
            id: pane.id.into(),
            tabs: pane.tabs.into_iter().map(Into::into).collect(),
            active_tab_id: pane.active_tab_id.into(),
        }
    }
}

impl From<PaneStateDto> for PaneState {
    fn from(dto: PaneStateDto) -> Self {
        Self {
            id: PaneId::from(dto.id),
            tabs: dto.tabs.into_iter().map(Into::into).collect(),
            active_tab_id: TabId::from(dto.active_tab_id),
        }
    }
}

/// The axis a [`WorkspaceLayoutDto::Split`] is arranged on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum SplitDirectionDto {
    /// Side by side, splitter runs vertically.
    Horizontal,
    /// Stacked, splitter runs horizontally.
    Vertical,
}

impl From<SplitDirection> for SplitDirectionDto {
    fn from(direction: SplitDirection) -> Self {
        match direction {
            SplitDirection::Horizontal => Self::Horizontal,
            SplitDirection::Vertical => Self::Vertical,
        }
    }
}

impl From<SplitDirectionDto> for SplitDirection {
    fn from(direction: SplitDirectionDto) -> Self {
        match direction {
            SplitDirectionDto::Horizontal => Self::Horizontal,
            SplitDirectionDto::Vertical => Self::Vertical,
        }
    }
}

/// How a workspace's panes are arranged on screen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WorkspaceLayoutDto {
    /// A leaf holding a single pane.
    Pane {
        /// The pane occupying this leaf.
        pane_id: Uuid,
    },
    /// Two regions separated by a single draggable splitter.
    Split {
        /// The axis the splitter is arranged on.
        direction: SplitDirectionDto,
        /// The fraction of space (0.0-1.0) given to `first`.
        ratio: f32,
        /// The first (left or top) region.
        first: Box<WorkspaceLayoutDto>,
        /// The second (right or bottom) region.
        second: Box<WorkspaceLayoutDto>,
    },
}

impl From<WorkspaceLayout> for WorkspaceLayoutDto {
    fn from(layout: WorkspaceLayout) -> Self {
        match layout {
            WorkspaceLayout::Pane(pane_id) => Self::Pane {
                pane_id: pane_id.into(),
            },
            WorkspaceLayout::Split {
                direction,
                ratio,
                first,
                second,
            } => Self::Split {
                direction: direction.into(),
                ratio,
                first: Box::new((*first).into()),
                second: Box::new((*second).into()),
            },
        }
    }
}

impl From<WorkspaceLayoutDto> for WorkspaceLayout {
    fn from(dto: WorkspaceLayoutDto) -> Self {
        match dto {
            WorkspaceLayoutDto::Pane { pane_id } => Self::Pane(PaneId::from(pane_id)),
            WorkspaceLayoutDto::Split {
                direction,
                ratio,
                first,
                second,
            } => Self::Split {
                direction: direction.into(),
                ratio,
                first: Box::new((*first).into()),
                second: Box::new((*second).into()),
            },
        }
    }
}

/// A workspace: a named collection of panes arranged in a
/// [`WorkspaceLayoutDto`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "id": "5b1b6b1e-9b1b-4b1b-8b1b-1b1b1b1b1b1b",
    "name": "Default",
    "panes": [],
    "activePaneId": "5b1b6b1e-9b1b-4b1b-8b1b-1b1b1b1b1b1b",
    "layout": {"type": "pane", "paneId": "5b1b6b1e-9b1b-4b1b-8b1b-1b1b1b1b1b1b"}
}))]
pub struct WorkspaceDto {
    /// Stable identifier for this workspace.
    pub id: Uuid,
    /// A user-facing name for this workspace.
    pub name: String,
    /// The panes making up this workspace.
    pub panes: Vec<PaneStateDto>,
    /// The pane that currently has focus.
    pub active_pane_id: Uuid,
    /// How the panes are arranged on screen.
    pub layout: WorkspaceLayoutDto,
}

impl From<Workspace> for WorkspaceDto {
    fn from(workspace: Workspace) -> Self {
        Self {
            id: workspace.id.into(),
            name: workspace.name,
            panes: workspace.panes.into_iter().map(Into::into).collect(),
            active_pane_id: workspace.active_pane_id.into(),
            layout: workspace.layout.into(),
        }
    }
}

impl From<WorkspaceDto> for Workspace {
    fn from(dto: WorkspaceDto) -> Self {
        Self {
            id: WorkspaceId::from(dto.id),
            name: dto.name,
            panes: dto.panes.into_iter().map(Into::into).collect(),
            active_pane_id: PaneId::from(dto.active_pane_id),
            layout: dto.layout.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use fm_domain::{Location, ProviderId};

    use super::*;

    fn sample_workspace() -> Workspace {
        let pane_a = PaneId::new();
        let pane_b = PaneId::new();
        let tab = TabState {
            id: TabId::new(),
            location: Location::new(ProviderId::new("local"), "file:///Users/erik"),
            history: NavigationHistory {
                back: vec![],
                forward: vec![],
            },
            view: DirectoryViewState {
                sort: vec![SortKey {
                    field: SortField::Name,
                    direction: SortDirection::Ascending,
                }],
                selected_entry_ids: vec![],
                cursor_entry_id: None,
            },
        };
        Workspace {
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
        }
    }

    #[test]
    fn workspace_dto_round_trips_through_serde_json() {
        let dto: WorkspaceDto = sample_workspace().into();
        let json = serde_json::to_string(&dto).expect("serialization must succeed");
        let parsed: WorkspaceDto =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(dto, parsed);
    }

    #[test]
    fn workspace_dto_uses_camel_case_field_names() {
        let dto: WorkspaceDto = sample_workspace().into();
        let json = serde_json::to_string(&dto).expect("serialization must succeed");
        for field in ["\"activePaneId\"", "\"panes\"", "\"layout\""] {
            assert!(json.contains(field), "expected {json} to contain {field}");
        }
    }

    #[test]
    fn workspace_layout_dto_uses_a_string_discriminator_and_supports_nested_splits() {
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

        let dto: WorkspaceLayoutDto = layout.clone().into();
        let json = serde_json::to_string(&dto).expect("serialization must succeed");
        assert!(json.contains("\"type\":\"split\""));

        let parsed: WorkspaceLayoutDto =
            serde_json::from_str(&json).expect("deserialization must succeed");
        let round_tripped: WorkspaceLayout = parsed.into();
        assert_eq!(layout, round_tripped);
    }

    #[test]
    fn workspace_dto_converts_to_and_from_the_domain_type() {
        let workspace = sample_workspace();
        let dto: WorkspaceDto = workspace.clone().into();
        let round_tripped: Workspace = dto.into();
        assert_eq!(workspace, round_tripped);
    }
}
