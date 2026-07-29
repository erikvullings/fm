//! Default-workspace creation and home-directory resolution (spec §5.3.7).

use std::path::{Path, PathBuf};

use chrono::Utc;
use fm_domain::{
    CURRENT_WORKSPACE_SCHEMA_VERSION, ColumnConfiguration, DirectoryViewConfiguration, Location,
    NavigationHistory, OperationCentrePreferences, PaneId, PaneState, ProviderId, SortDescriptor,
    SortDirection, SplitAxis, TabId, TabState, Workspace, WorkspaceId, WorkspaceLayout,
};

/// Resolves the current user's home directory through the `dirs` crate
/// rather than a hard-coded per-OS path (spec §5.3.7: "resolve the home
/// directory through a platform adapter"). Richer platform integration is
/// deferred to tasks 0058/0059/0060.
///
/// Falls back to `/` if the platform cannot report a home directory (for
/// example a container with no `$HOME`), so the default workspace can still
/// be built rather than failing startup outright.
#[must_use]
pub fn resolve_home_directory() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

fn location_for(path: &Path) -> Location {
    Location::new(
        ProviderId::new("file"),
        format!("file://{}", path.display()),
    )
}

fn default_directory_view() -> DirectoryViewConfiguration {
    DirectoryViewConfiguration {
        sort: vec![SortDescriptor {
            column_id: "core.name".to_owned(),
            direction: SortDirection::Ascending,
        }],
        columns: vec![
            ColumnConfiguration {
                column_id: "core.name".to_owned(),
                width: 360,
                visible: true,
            },
            ColumnConfiguration {
                column_id: "core.size".to_owned(),
                width: 100,
                visible: true,
            },
            ColumnConfiguration {
                column_id: "core.modified".to_owned(),
                width: 170,
                visible: true,
            },
        ],
        show_hidden: false,
        folders_first: true,
        quick_filter: None,
    }
}

fn default_pane(location: Location) -> PaneState {
    let tab_id = TabId::new();
    PaneState {
        id: PaneId::new(),
        title: None,
        tabs: vec![TabState {
            id: tab_id,
            location,
            title_override: None,
            history: NavigationHistory {
                back: vec![],
                forward: vec![],
            },
            view: default_directory_view(),
            pinned: false,
        }],
        active_tab_id: tab_id,
        default_view: default_directory_view(),
    }
}

/// Builds the default workspace: one workspace named `Default`, two panes in
/// a 50/50 horizontal split, one tab per pane, the home directory as the
/// initial location for both panes unless `secondary_location` overrides the
/// second pane (spec §5.3.7's "Default workspace").
///
/// The workspace is not persisted by this function; callers (`WorkspaceService`)
/// are responsible for saving it and recording it as last-active.
#[must_use]
pub fn default_workspace(home_directory: &Path, secondary_location: Option<&Path>) -> Workspace {
    let left = default_pane(location_for(home_directory));
    let right = default_pane(location_for(secondary_location.unwrap_or(home_directory)));
    let (left_id, right_id) = (left.id, right.id);
    let now = Utc::now();

    Workspace {
        schema_version: CURRENT_WORKSPACE_SCHEMA_VERSION,
        id: WorkspaceId::new(),
        name: "Default".to_owned(),
        layout: WorkspaceLayout::Split {
            axis: SplitAxis::Horizontal,
            ratio: 0.5,
            first: Box::new(WorkspaceLayout::Pane { pane_id: left_id }),
            second: Box::new(WorkspaceLayout::Pane { pane_id: right_id }),
        },
        panes: vec![left, right],
        active_pane_id: left_id,
        operation_centre: OperationCentrePreferences {
            visible: false,
            height: 240,
        },
        created_at: now,
        updated_at: now,
        revision: 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_home_directory_never_returns_an_empty_path() {
        let home = resolve_home_directory();
        assert!(!home.as_os_str().is_empty());
    }

    #[test]
    fn default_workspace_is_named_default_with_two_panes_in_a_50_50_split() {
        let workspace = default_workspace(Path::new("/Users/erik"), None);

        assert_eq!(workspace.name, "Default");
        assert_eq!(workspace.panes.len(), 2);
        assert_eq!(workspace.schema_version, CURRENT_WORKSPACE_SCHEMA_VERSION);
        match &workspace.layout {
            WorkspaceLayout::Split { axis, ratio, .. } => {
                assert_eq!(*axis, SplitAxis::Horizontal);
                assert!((*ratio - 0.5).abs() < f32::EPSILON);
            }
            WorkspaceLayout::Pane { .. } => panic!("expected a split layout"),
        }
        assert!(workspace.validate().is_ok());
    }

    #[test]
    fn default_workspace_uses_the_home_directory_for_both_panes_without_a_secondary_location() {
        let workspace = default_workspace(Path::new("/Users/erik"), None);

        for pane in &workspace.panes {
            assert_eq!(pane.tabs[0].location.uri, "file:///Users/erik");
        }
    }

    #[test]
    fn default_workspace_uses_the_secondary_location_for_the_second_pane_only() {
        let workspace = default_workspace(
            Path::new("/Users/erik"),
            Some(Path::new("/Users/erik/Downloads")),
        );

        assert_eq!(
            workspace.panes[0].tabs[0].location.uri,
            "file:///Users/erik"
        );
        assert_eq!(
            workspace.panes[1].tabs[0].location.uri,
            "file:///Users/erik/Downloads"
        );
    }
}
