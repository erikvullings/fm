import type { EntryId, PaneId, TabId, WorkspaceId } from './ids';
import type { Location } from './location';

/** A field a directory listing can be sorted by. */
export type SortField = 'name' | 'extension' | 'size' | 'modifiedAt';

/** A sort direction. */
export type SortDirection = 'ascending' | 'descending';

/** A single sort key: a field and a direction. */
export interface SortKey {
  field: SortField;
  direction: SortDirection;
}

/** Back/forward navigation history for a single tab. */
export interface NavigationHistory {
  back: Location[];
  forward: Location[];
}

/** UI view state for a directory listing: sorting, selection and cursor. */
export interface DirectoryViewState {
  sort: SortKey[];
  selectedEntryIds: EntryId[];
  cursorEntryId?: EntryId;
}

/** A single tab: a location, its navigation history and its view state. */
export interface TabState {
  id: TabId;
  location: Location;
  history: NavigationHistory;
  view: DirectoryViewState;
}

/** A single pane, holding one or more tabs. */
export interface PaneState {
  id: PaneId;
  tabs: TabState[];
  activeTabId: TabId;
}

/** The axis a {@link WorkspaceLayout} split is arranged on. */
export type SplitDirection = 'horizontal' | 'vertical';

/**
 * How a workspace's panes are arranged on screen: a recursive binary tree of
 * splits, mirroring `fm_transport_dto::WorkspaceLayoutDto`'s `type` tag.
 */
export type WorkspaceLayout =
  | { type: 'pane'; paneId: PaneId }
  | {
      type: 'split';
      direction: SplitDirection;
      ratio: number;
      first: WorkspaceLayout;
      second: WorkspaceLayout;
    };

/** A workspace: a named collection of panes arranged in a {@link WorkspaceLayout} (spec §5.3). */
export interface Workspace {
  id: WorkspaceId;
  name: string;
  panes: PaneState[];
  activePaneId: PaneId;
  layout: WorkspaceLayout;
}
