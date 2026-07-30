import type { CreateWorkspaceRequestDto } from '../api/generated/models/createWorkspaceRequestDto';
import type { DirectoryViewConfigurationDto } from '../api/generated/models/directoryViewConfigurationDto';
import type { OperationCentrePreferencesDto } from '../api/generated/models/operationCentrePreferencesDto';
import type { WorkspaceCommandDto } from '../api/generated/models/workspaceCommandDto';
import type { WorkspaceDto } from '../api/generated/models/workspaceDto';
import type { WorkspaceLayoutDto } from '../api/generated/models/workspaceLayoutDto';
import type { WorkspaceSummaryDto } from '../api/generated/models/workspaceSummaryDto';
import type { EntryId, PaneId, TabId, WorkspaceId } from './ids';
import type { Location } from './location';

/** Persisted directory presentation settings; never contains selection or cursor state. */
export type DirectoryViewConfiguration = DirectoryViewConfigurationDto;

/** Recursive pane layout returned by the workspace backend. */
export type WorkspaceLayout = WorkspaceLayoutDto;

/** Workspace-level operation-centre presentation preferences. */
export type OperationCentrePreferences = OperationCentrePreferencesDto;

/** Lightweight item returned when listing stored workspaces. */
export type WorkspaceSummary = WorkspaceSummaryDto;

/** Input used to create a stored workspace. */
export type CreateWorkspaceRequest = CreateWorkspaceRequestDto;

/** Semantic workspace mutation accepted by every client adapter. */
export type WorkspaceCommand = WorkspaceCommandDto;

/** Normalized tab projection (spec §5.3.13). */
export interface TabProjection {
  id: TabId;
  title: string;
  location: Location;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  view: DirectoryViewConfiguration;
}

/** Normalized pane projection (spec §5.3.13). */
export interface PaneProjection {
  id: PaneId;
  tabOrder: TabId[];
  tabsById: Record<TabId, TabProjection>;
  activeTabId: TabId;
}

/** Authoritative normalized workspace projection (spec §5.3.13). */
export interface WorkspaceProjection {
  id: WorkspaceId;
  name: string;
  revision: number;
  layout: WorkspaceLayout;
  paneOrder: PaneId[];
  panesById: Record<PaneId, PaneProjection>;
  activePaneId: PaneId;
  operationCentre: OperationCentrePreferences;
}

/** Frontend-only selection and cursor state for one pane. */
export interface PaneViewState {
  selectedEntryIds: EntryId[];
  cursorEntryId?: EntryId;
}

/** Frontend-only dialog descriptor. Its payload remains owned by the invoking feature. */
export interface DialogState {
  type: string;
}

/** Frontend-only drag state shared by pane views. */
export interface DragState {
  sourceEntryIds: EntryId[];
  targetPaneId?: PaneId;
}

/** Ephemeral UI state kept separate from the serializable projection (spec §5.3.3). */
export interface WorkspaceViewState {
  focusedPaneId: PaneId;
  paneViews: Record<PaneId, PaneViewState>;
  openDialog?: DialogState;
  dragState?: DragState;
}

function titleFromLocation(location: Location): string {
  const withoutTrailingSlashes = location.uri.replace(/\/+$/, '');
  const finalSegment = withoutTrailingSlashes.slice(withoutTrailingSlashes.lastIndexOf('/') + 1);
  if (finalSegment.length === 0) {
    return location.uri;
  }
  try {
    return decodeURIComponent(finalSegment);
  } catch {
    return finalSegment;
  }
}

/** Converts the persisted DTO into the normalized, directory-free frontend projection. */
export function workspaceProjectionFromDto(workspace: WorkspaceDto): WorkspaceProjection {
  const paneOrder: PaneId[] = [];
  const panesById: Record<PaneId, PaneProjection> = {};

  for (const pane of workspace.panes) {
    paneOrder.push(pane.id);
    const tabOrder: TabId[] = [];
    const tabsById: Record<TabId, TabProjection> = {};
    for (const tab of pane.tabs) {
      tabOrder.push(tab.id);
      tabsById[tab.id] = {
        id: tab.id,
        title: tab.titleOverride ?? titleFromLocation(tab.location),
        location: tab.location,
        canNavigateBack: tab.history.back.length > 0,
        canNavigateForward: tab.history.forward.length > 0,
        view: tab.view,
      };
    }
    panesById[pane.id] = {
      id: pane.id,
      tabOrder,
      tabsById,
      activeTabId: pane.activeTabId,
    };
  }

  return {
    id: workspace.id,
    name: workspace.name,
    revision: workspace.revision,
    layout: workspace.layout,
    paneOrder,
    panesById,
    activePaneId: workspace.activePaneId,
    operationCentre: workspace.operationCentre,
  };
}
