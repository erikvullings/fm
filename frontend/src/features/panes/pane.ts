import m, { type FactoryComponent, type VnodeDOM } from 'mithril';
import { IconButton } from 'mithril-materialized';
import {
  heartIcon,
  heartPlusIcon,
  layoutGridIcon,
  listIcon,
  plusIcon,
} from '../../components/tabler-icons';
import { tooltip } from '../../components/tooltip';
import {
  dispatchKeybinding,
  hasPrimaryModifier,
  type KeybindingRuntime,
} from '../../keybindings/dispatcher';
import type {
  ActionDescriptor,
  Connection,
  EntryId,
  EntrySummary,
  FavouriteLocation,
  LoadingState,
  Location,
  SortDescriptor,
  SystemLocation,
  TabId,
  VolumeCapacity,
} from '../../models';
import {
  connectionStatusGlyph,
  connectionStatusLabel,
  isBrowsable,
  remoteRootLocation,
} from '../connections/connections-model';
import { DirectoryGrid, type GridIconSize } from '../directory-table/directory-grid';
import {
  type CursorClickModifiers,
  type DirectoryColumnDescriptor,
  DirectoryTable,
  entryArraySource,
} from '../directory-table/directory-table';
import type { NativeIconLoader } from '../directory-table/native-icon-loader';
import type { ThumbnailLoader } from '../directory-table/thumbnail-loader';
import type { EntryFormatSettings } from '../entry-formatting/entry-formatting';
import { truncateLocationForDisplay } from '../favourites/favourites';
import { matchesGlobMask } from '../quick-filter/quick-filter';
import { QuickFilterInput } from '../quick-filter/quick-filter-input';
import type { SelectionPlatform } from '../selection/keybindings';
import type { SelectionAction } from '../selection/selection';
import { breadcrumbSegments, searchBreadcrumbSegments } from './breadcrumb-view';
import { isParentEntry } from './parent-entry';
import { createRenameEditingController } from './rename-edit-controller';
import type { PaneTab } from './tab-strip';
import { TabStrip } from './tab-strip';
import { createTypeaheadController } from './typeahead-controller';
import './pane.css';

export type { BreadcrumbSegment } from './breadcrumb-view';
export { breadcrumbSegments, searchBreadcrumbSegments } from './breadcrumb-view';
export type { PaneTab } from './tab-strip';

// ── Sub-object interfaces ──────────────────────────────────────────────────────

/** Favourites-menu data — all fields optional since menus may be fully or partially unavailable. */
export interface FavouritesAttrs {
  readonly location?: Location | undefined;
  readonly favouriteLocations?: readonly FavouriteLocation[] | undefined;
  readonly recentLocations?: readonly Location[] | undefined;
  readonly systemLocations?: readonly SystemLocation[] | undefined;
  readonly systemLocationsError?: string | undefined;
  readonly onRetrySystemLocations?: (() => void | Promise<void>) | undefined;
  readonly connections?: readonly Connection[] | undefined;
  readonly onManageConnections?: (() => void) | undefined;
  readonly onRefreshConnections?: (() => void | Promise<void>) | undefined;
  readonly unavailableLocations?: ReadonlySet<string> | undefined;
  readonly onNavigateLocation?: ((location: Location) => void | Promise<void>) | undefined;
  readonly onAddFavourite?:
    | ((label: string, location: Location) => void | Promise<void>)
    | undefined;
  readonly onDeleteFavourite?: ((location: Location) => void | Promise<void>) | undefined;
  readonly onReorderFavourites?: ((from: number, to: number) => void | Promise<void>) | undefined;
}

/** Quick-filter bar state and callbacks. */
export interface FilterAttrs {
  readonly filterOpen: boolean;
  readonly filterQuery: string;
  readonly onFilterQueryChange: (query: string) => void;
  readonly onFilterCommit: () => void;
  readonly onFilterClose: () => void;
}

/** Backend-reported directory totals used by the status bar. */
export interface DirectorySummaryAttrs {
  readonly hasMore?: boolean | undefined;
  readonly totalEntryCount: number;
  readonly totalKnownEntries?: number | undefined;
  readonly totalKnownSize?: number | undefined;
  readonly totalKnownFileCount?: number | undefined;
  /** Backing volume's total/available capacity, when known (task 0096). */
  readonly volumeCapacity?: VolumeCapacity | undefined;
  readonly hiddenSelectedCount: number;
}

/** Sort, format and column configuration passed through to the directory table. */
export interface TableConfigAttrs {
  readonly sortLabel: string;
  readonly sort: readonly SortDescriptor[];
  readonly formatSettings?: EntryFormatSettings | undefined;
  readonly pluginColumns?: readonly DirectoryColumnDescriptor[] | undefined;
  readonly nativeIconLoader?: NativeIconLoader | undefined;
  readonly thumbnailLoader?: ThumbnailLoader | undefined;
  /** Table vs. thumbnail grid (task 0134). Defaults to `'table'`. */
  readonly viewMode?: 'table' | 'grid' | undefined;
  /** Grid tile size; only meaningful while `viewMode` is `'grid'`. Defaults to `'medium'`. */
  readonly iconSize?: GridIconSize | undefined;
  readonly onViewModeChange?:
    | ((viewMode: 'table' | 'grid', iconSize: GridIconSize) => void)
    | undefined;
}

/** Path navigation callbacks and history state. */
export interface PaneNavigationAttrs {
  readonly onNavigate: (path: string) => void | Promise<void>;
  readonly onBack: () => void | Promise<void>;
  readonly onForward: () => void | Promise<void>;
  readonly onParent: () => void | Promise<void>;
  readonly canNavigateBack: boolean;
  readonly canNavigateForward: boolean;
}

/** Inputs for the presentation-only pane surface (39 properties, < 40). */
export interface PaneAttrs {
  // Location display (4)
  readonly path: string;
  readonly locationUri?: string;
  readonly tabTitle: string;
  readonly searchQuery?: string;
  // Tab strip kept flat — primary identity controls (8)
  readonly tabs: readonly PaneTab[];
  readonly activeTabId: TabId;
  readonly onSelectTab: (tabId: TabId) => void;
  readonly onCloseTab: (tabId: TabId) => void;
  readonly onNewTab: () => void;
  readonly onReorderTabs: (order: readonly TabId[]) => void;
  readonly onTabDragOver?: ((tabId: TabId, event: DragEvent) => boolean) | undefined;
  readonly onTabDrop?: ((tabId: TabId, event: DragEvent) => void) | undefined;
  // Sub-objects (5)
  readonly favourites: FavouritesAttrs;
  readonly tableConfig: TableConfigAttrs;
  readonly directorySummary: DirectorySummaryAttrs;
  readonly filter: FilterAttrs;
  readonly navigation: PaneNavigationAttrs;
  // Directory data (6)
  readonly state: LoadingState;
  readonly entries: readonly EntrySummary[];
  readonly selectedEntryIds: ReadonlySet<EntryId>;
  readonly cutEntryIds: ReadonlySet<EntryId>;
  readonly active: boolean;
  readonly cursorIndex?: number;
  // Keyboard / action dispatch (4)
  readonly platform: SelectionPlatform;
  readonly keybindingRuntime?: KeybindingRuntime;
  readonly actions?: readonly ActionDescriptor[];
  readonly keybindingOverrides?: Readonly<Record<string, string>>;
  // Entry operations (8)
  readonly onOpenEntry: (entry: EntrySummary) => void | Promise<void>;
  readonly onSelectionAction: (action: SelectionAction) => void;
  readonly onRetry: () => void | Promise<void>;
  readonly onLoadNextPage: () => void | Promise<void>;
  readonly onSortChange: (sort: readonly SortDescriptor[]) => void;
  readonly onRename: (entry: EntrySummary, name: string) => void | Promise<void>;
  readonly onMultiRename?: (entries: readonly EntrySummary[]) => void;
  readonly onContextMenu: (entries: readonly EntrySummary[], x: number, y: number) => void;
  // Drag/drop into the directory table (3)
  readonly onDragStart?: (entries: readonly EntrySummary[], event: DragEvent) => void;
  readonly onDragOver?: (entry: EntrySummary | undefined, event: DragEvent) => boolean;
  readonly onDrop?: (entry: EntrySummary | undefined, event: DragEvent) => void;
  /** When set, replaces the entire directory-listing surface (task 0088). */
  readonly viewerContent?: m.Children;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function defaultFavouriteLabel(path: string): string {
  const segments = path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .filter(Boolean);
  return segments.at(-1) ?? path;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isAcceptedPath(path: string): boolean {
  return (
    path === '~' ||
    path.startsWith('~/') ||
    path.startsWith('/') ||
    path.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to open path';
}

function selectedSize(
  entries: readonly EntrySummary[],
  selectedEntryIds: ReadonlySet<EntryId>,
): number {
  return entries.reduce(
    (total, entry) => total + (selectedEntryIds.has(entry.id) ? (entry.size ?? 0) : 0),
    0,
  );
}

function sizeLabel(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1_024)), units.length - 1);
  const value = bytes / 1_024 ** unitIndex;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`;
}

function formatListingSummary(fileCount: number, folderCount: number, totalSize: number): string {
  const filesPart = `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
  const foldersPart = `${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`;
  const countsText =
    folderCount === 0
      ? filesPart
      : fileCount === 0
        ? foldersPart
        : `${filesPart}, and ${foldersPart}`;
  return `${sizeLabel(totalSize)} in ${countsText}`;
}

function volumeCapacityLabel(capacity: VolumeCapacity): string | undefined {
  if (capacity.totalBytes <= 0) return undefined;
  const percentAvailable = Math.round((capacity.availableBytes / capacity.totalBytes) * 100);
  return `${sizeLabel(capacity.availableBytes)} (${percentAvailable}%) available`;
}

function listingSummary(entries: readonly EntrySummary[]): string {
  let fileCount = 0;
  let folderCount = 0;
  let totalSize = 0;
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      folderCount += 1;
    } else {
      fileCount += 1;
      totalSize += entry.size ?? 0;
    }
  }
  return formatListingSummary(fileCount, folderCount, totalSize);
}

function locationKey(location: Location): string {
  return `${location.providerId}:${location.uri}`;
}

function canAddCurrentFavourite(favourites: FavouritesAttrs): boolean {
  if (favourites.location === undefined || favourites.onAddFavourite === undefined) return false;
  const currentKey = locationKey(favourites.location);
  const alreadyFavourite = favourites.favouriteLocations?.some(
    ({ location }) => locationKey(location) === currentKey,
  );
  const permanentCloudLocation = favourites.systemLocations?.some(
    ({ kind, location }) => kind === 'cloud' && locationKey(location) === currentKey,
  );
  return alreadyFavourite !== true && permanentCloudLocation !== true;
}

// ── Component ─────────────────────────────────────────────────────────────────

/** Compact pane containing its single tab, path controls, directory grid, and status. */
export const Pane: FactoryComponent<PaneAttrs> = () => {
  let editing = false;
  let draftPath = '';
  let pathError: string | undefined;
  let inputElement: HTMLInputElement | undefined;
  let favouritesOpen = false;
  let favouriteLabel = '';
  let favouriteError: string | undefined;
  let favouritesPreviousFocus: HTMLElement | undefined;
  let viewMenuOpen = false;
  let typeaheadPath: string | undefined;
  /** The pane's own `section.fm-pane` DOM node - the actual keyboard target (`onkeydown` is bound
   * here, see the view below). Mouse row clicks only ever changed selection *state*; nothing moved
   * real DOM focus here to match, so a keypress immediately after a click could still be racing (or
   * entirely missing) this element's focus depending on whatever had focus beforehand. Captured so
   * `onCursorChange` can call `.focus()` itself instead of relying on incidental browser behaviour. */
  let sectionElement: HTMLElement | undefined;

  const typeaheadCtrl = createTypeaheadController(() => m.redraw());
  const renameCtrl = createRenameEditingController();
  /** Selection just before the current keystroke, for the Numpad `/` "restore" shortcut. */
  let previousSelectionSnapshot: readonly EntryId[] = [];

  function openFavourites(attrs: PaneAttrs): void {
    favouritesPreviousFocus = document.activeElement as HTMLElement;
    favouriteLabel = defaultFavouriteLabel(attrs.path);
    favouriteError = undefined;
    favouritesOpen = true;
    void attrs.favourites.onRefreshConnections?.();
  }

  function closeFavourites(): void {
    favouritesOpen = false;
    favouritesPreviousFocus?.focus();
    favouritesPreviousFocus = undefined;
  }

  async function navigateFavourite(location: Location, attrs: PaneAttrs): Promise<void> {
    if (attrs.favourites.onNavigateLocation === undefined) return;
    try {
      await attrs.favourites.onNavigateLocation(location);
      favouriteError = undefined;
      closeFavourites();
    } catch (error: unknown) {
      favouriteError = errorMessage(error);
    }
    m.redraw();
  }

  function addCurrentFavourite(attrs: PaneAttrs): void {
    const { favourites } = attrs;
    if (!canAddCurrentFavourite(favourites) || favourites.location === undefined) return;
    const label = favouriteLabel.trim() || defaultFavouriteLabel(attrs.path);
    void favourites.onAddFavourite?.(label, favourites.location);
    favouriteLabel = '';
  }

  function focusFirstFavouritesItem(menu: HTMLElement): void {
    const first = menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    if (first === null) {
      menu.focus();
      return;
    }
    first.focus();
  }

  function moveFavouritesFocus(menu: HTMLElement, offset: 1 | -1): void {
    const items = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + offset + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  function beginRename(attrs: PaneAttrs): void {
    const selectedEntries = attrs.entries.filter(
      (entry) => attrs.selectedEntryIds.has(entry.id) && !isParentEntry(entry.id),
    );
    if (selectedEntries.length > 1) {
      attrs.onMultiRename?.(selectedEntries);
      return;
    }
    const entry = attrs.cursorIndex === undefined ? undefined : attrs.entries[attrs.cursorIndex];
    if (entry === undefined || isParentEntry(entry.id)) return;
    renameCtrl.open(entry);
    m.redraw();
  }

  function beginEditing(path: string): void {
    editing = true;
    draftPath = path;
    pathError = undefined;
    m.redraw();
  }

  function cancelEditing(): void {
    editing = false;
    pathError = undefined;
    m.redraw();
  }

  async function navigate(path: string, attrs: PaneAttrs, keepEditing: boolean): Promise<void> {
    if (!isAcceptedPath(path)) {
      pathError = 'Enter an absolute path or a path beginning with ~';
      m.redraw();
      return;
    }
    pathError = undefined;
    try {
      await attrs.navigation.onNavigate(path);
      editing = keepEditing ? false : editing;
    } catch (error: unknown) {
      pathError = errorMessage(error);
      editing = keepEditing || editing;
    }
    m.redraw();
  }

  return {
    onupdate: () => {
      if (editing && inputElement !== undefined && document.activeElement !== inputElement) {
        inputElement.focus();
        inputElement.select();
      }
    },
    onremove: () => {
      typeaheadCtrl.clearTimer();
    },
    view: ({ attrs }) => {
      if (attrs.viewerContent !== undefined) {
        return m(
          'section.fm-pane.fm-pane-viewer',
          {
            'data-active': String(attrs.active),
            tabindex: -1,
            oncreate: ({ dom }: VnodeDOM) => {
              sectionElement = dom as HTMLElement;
            },
            // Guard against a stale removal firing after a replacement node's `oncreate` (this
            // vnode has no explicit `key`, so a positional diff can create-then-remove rather
            // than patch in place) - an unconditional clear here would wipe the fresh reference
            // and leave clicks unable to grab keyboard focus until a full remount.
            onremove: ({ dom }: VnodeDOM) => {
              if (sectionElement === dom) sectionElement = undefined;
            },
          },
          [
            m(TabStrip, {
              tabs: attrs.tabs,
              activeTabId: attrs.activeTabId,
              onSelectTab: attrs.onSelectTab,
              onCloseTab: attrs.onCloseTab,
              onNewTab: attrs.onNewTab,
              onReorderTabs: attrs.onReorderTabs,
              onTabDragOver: attrs.onTabDragOver,
              onTabDrop: attrs.onTabDrop,
              favouritesOpen: false,
              canAddFavourite: false,
              onToggleFavourites: () => undefined,
            }),
            attrs.viewerContent,
          ],
        );
      }
      if (attrs.filter.filterOpen && editing) {
        editing = false;
        pathError = undefined;
      }
      if (typeaheadPath !== attrs.path) {
        typeaheadPath = attrs.path;
        typeaheadCtrl.reset();
      }
      const activeLocationUri = attrs.locationUri ?? attrs.path;
      const isSearchLocation = activeLocationUri.startsWith('search://');
      const isSftpLocation = activeLocationUri.startsWith('sftp://');
      const ordinaryEntries = attrs.entries.filter((entry) => !isParentEntry(entry.id));
      const selectedCount = attrs.selectedEntryIds.size;
      const totalSelectedSize = selectedSize(ordinaryEntries, attrs.selectedEntryIds);
      const { directorySummary: ds } = attrs;
      const parentEntryAdjustment = attrs.entries.length - ordinaryEntries.length;
      const backendTotalEntries =
        ds.totalKnownEntries === undefined
          ? undefined
          : ds.totalKnownEntries - parentEntryAdjustment;
      const backendListingSummary =
        attrs.filter.filterQuery.trim() === '' &&
        ds.totalKnownSize !== undefined &&
        ds.totalKnownFileCount !== undefined &&
        backendTotalEntries !== undefined
          ? formatListingSummary(
              ds.totalKnownFileCount,
              backendTotalEntries - ds.totalKnownFileCount,
              ds.totalKnownSize,
            )
          : undefined;
      const volumeCapacityText =
        ds.volumeCapacity === undefined ? undefined : volumeCapacityLabel(ds.volumeCapacity);

      return m(
        'section.fm-pane',
        {
          'data-active': String(attrs.active),
          tabindex: -1,
          oncreate: ({ dom }: VnodeDOM) => {
            sectionElement = dom as HTMLElement;
          },
          // Guard against a stale removal firing after a replacement node's `oncreate` (this
          // vnode has no explicit `key`, so a positional diff can create-then-remove rather than
          // patch in place) - an unconditional clear here would wipe the fresh reference and
          // leave clicks unable to grab keyboard focus until a full remount.
          onremove: ({ dom }: VnodeDOM) => {
            if (sectionElement === dom) sectionElement = undefined;
          },
          onkeydown: (event: KeyboardEvent) => {
            if (isEditableTarget(event.target)) return;
            previousSelectionSnapshot = [...attrs.selectedEntryIds];
            if (
              hasPrimaryModifier(event, attrs.platform) &&
              !event.altKey &&
              !event.shiftKey &&
              event.key.toLowerCase() === 'd'
            ) {
              event.preventDefault();
              if (favouritesOpen) closeFavourites();
              else openFavourites(attrs);
              m.redraw();
              return;
            }
            const actionId = dispatchKeybinding(
              event,
              {
                scope: 'table',
                platform: attrs.platform,
                runtime: attrs.keybindingRuntime ?? 'browser',
              },
              attrs.actions ?? [],
              attrs.keybindingOverrides ?? {},
            );
            if (actionId === 'core.rename') {
              event.preventDefault();
              beginRename(attrs);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              typeaheadCtrl.reset();
              attrs.onSelectionAction({ type: 'clear' });
              m.redraw();
              return;
            }
            if (event.key === 'Backspace' && typeaheadCtrl.prefix !== undefined) {
              event.preventDefault();
              typeaheadCtrl.handleBackspace();
              m.redraw();
              return;
            }
            if (actionId === 'core.focusLocation') {
              event.preventDefault();
              beginEditing(attrs.path);
              return;
            }
            const command =
              actionId === 'core.moveCursorUp'
                ? { type: 'moveCursor' as const, offset: -1 as const }
                : actionId === 'core.moveCursorDown'
                  ? { type: 'moveCursor' as const, offset: 1 as const }
                  : actionId === 'core.moveCursorPageUp'
                    ? { type: 'moveCursorByPage' as const, pages: -1 as const }
                    : actionId === 'core.moveCursorPageDown'
                      ? { type: 'moveCursorByPage' as const, pages: 1 as const }
                      : actionId === 'core.moveCursorFirst'
                        ? { type: 'moveCursorTo' as const, edge: 'first' as const }
                        : actionId === 'core.moveCursorLast'
                          ? { type: 'moveCursorTo' as const, edge: 'last' as const }
                          : actionId === 'core.extendSelectionUp'
                            ? { type: 'extendRange' as const, offset: -1 as const }
                            : actionId === 'core.extendSelectionDown'
                              ? { type: 'extendRange' as const, offset: 1 as const }
                              : actionId === 'core.toggleSelection'
                                ? { type: 'toggleCursorSelection' as const }
                                : actionId === 'core.selectAll'
                                  ? { type: 'selectAll' as const }
                                  : actionId === 'core.invertSelection'
                                    ? { type: 'invert' as const }
                                    : actionId === 'core.selectByMask'
                                      ? { type: 'selectByMask' as const }
                                      : actionId === 'core.deselectByMask'
                                        ? { type: 'deselectByMask' as const }
                                        : actionId === 'core.open'
                                          ? { type: 'open' as const }
                                          : actionId === 'core.parent'
                                            ? { type: 'parent' as const }
                                            : actionId === 'core.toggleSelectionAndAdvance'
                                              ? { type: 'toggleCursorSelectionAndAdvance' as const }
                                              : actionId === 'core.restoreSelection'
                                                ? { type: 'restoreSelection' as const }
                                                : undefined;
            if (actionId === 'core.switchPane') {
              return;
            }
            if (command?.type === 'open' && attrs.cursorIndex !== undefined) {
              const entry = attrs.entries[attrs.cursorIndex];
              if (entry !== undefined) {
                event.preventDefault();
                void attrs.onOpenEntry(entry);
              }
            } else if (command?.type === 'parent') {
              event.preventDefault();
              void attrs.navigation.onParent();
            } else if (command?.type === 'moveCursor') {
              event.preventDefault();
              const cursorEntry =
                attrs.cursorIndex === undefined ? undefined : attrs.entries[attrs.cursorIndex];
              const taResult = typeaheadCtrl.moveWithinMatches(
                attrs.entries,
                cursorEntry,
                command.offset,
                undefined,
                false,
              );
              if (taResult === false) {
                attrs.onSelectionAction(command);
              } else if (taResult !== undefined) {
                attrs.onSelectionAction(taResult);
              }
            } else if (command?.type === 'moveCursorByPage') {
              event.preventDefault();
              const offset = command.pages * 10;
              const cursorEntry =
                attrs.cursorIndex === undefined ? undefined : attrs.entries[attrs.cursorIndex];
              const taResult = typeaheadCtrl.moveWithinMatches(
                attrs.entries,
                cursorEntry,
                offset,
                undefined,
                false,
              );
              if (taResult === false) {
                attrs.onSelectionAction({ type: 'moveCursor', offset });
              } else if (taResult !== undefined) {
                attrs.onSelectionAction(taResult);
              }
            } else if (command?.type === 'moveCursorTo') {
              event.preventDefault();
              const cursorEntry =
                attrs.cursorIndex === undefined ? undefined : attrs.entries[attrs.cursorIndex];
              const taResult = typeaheadCtrl.moveWithinMatches(
                attrs.entries,
                cursorEntry,
                0,
                command.edge,
                false,
              );
              if (taResult === false) {
                attrs.onSelectionAction(command);
              } else if (taResult !== undefined) {
                attrs.onSelectionAction(taResult);
              }
            } else if (command?.type === 'extendRange') {
              event.preventDefault();
              const cursorEntry =
                attrs.cursorIndex === undefined ? undefined : attrs.entries[attrs.cursorIndex];
              const taResult = typeaheadCtrl.moveWithinMatches(
                attrs.entries,
                cursorEntry,
                command.offset,
                undefined,
                true,
              );
              if (taResult === false) {
                attrs.onSelectionAction(command);
              } else if (taResult !== undefined) {
                attrs.onSelectionAction(taResult);
              }
            } else if (command?.type === 'toggleCursorSelection') {
              const entry =
                attrs.cursorIndex === undefined ? undefined : attrs.entries[attrs.cursorIndex];
              if (entry !== undefined && !isParentEntry(entry.id)) {
                event.preventDefault();
                attrs.onSelectionAction({ type: 'toggle', entryId: entry.id });
              }
            } else if (command?.type === 'toggleCursorSelectionAndAdvance') {
              // Insert/Space: toggle the entry under the cursor and move down one row, as a
              // single atomic `toggleAndAdvance` dispatch (Total Commander parity) - not two
              // separate `toggle`/`moveCursor` dispatches, which observably dropped the toggle in
              // practice despite each individually reading fresh selection state.
              const entry =
                attrs.cursorIndex === undefined ? undefined : attrs.entries[attrs.cursorIndex];
              if (entry !== undefined && !isParentEntry(entry.id)) {
                event.preventDefault();
                attrs.onSelectionAction({ type: 'toggleAndAdvance', entryId: entry.id, offset: 1 });
              }
            } else if (command?.type === 'restoreSelection') {
              event.preventDefault();
              attrs.onSelectionAction({ type: 'restore', entryIds: previousSelectionSnapshot });
            } else if (command?.type === 'selectAll') {
              event.preventDefault();
              attrs.onSelectionAction({ type: 'selectAll' });
            } else if (command?.type === 'invert') {
              event.preventDefault();
              attrs.onSelectionAction({ type: 'invert' });
            } else if (command?.type === 'selectByMask' || command?.type === 'deselectByMask') {
              event.preventDefault();
              const selecting = command.type === 'selectByMask';
              const pattern = window.prompt(
                selecting ? 'Select files matching mask' : 'Deselect files matching mask',
                '*.*',
              );
              if (pattern !== null) {
                attrs.onSelectionAction({
                  type: command.type,
                  matchingEntryIds: attrs.entries
                    .filter(
                      (entry) => !isParentEntry(entry.id) && matchesGlobMask(entry.name, pattern),
                    )
                    .map((entry) => entry.id),
                });
              }
            } else if (event.altKey && event.key === 'ArrowLeft') {
              event.preventDefault();
              void attrs.navigation.onBack();
            } else if (event.altKey && event.key === 'ArrowRight') {
              event.preventDefault();
              void attrs.navigation.onForward();
            } else if (
              event.key.length === 1 &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              event.preventDefault();
              const action = typeaheadCtrl.handleChar(event.key, attrs.entries, Date.now());
              if (action !== undefined) {
                attrs.onSelectionAction(action);
              }
              m.redraw();
            }
          },
          onauxclick: (event: MouseEvent) => {
            if (event.button === 3) {
              event.preventDefault();
              void attrs.navigation.onBack();
            } else if (event.button === 4) {
              event.preventDefault();
              void attrs.navigation.onForward();
            }
          },
        },
        [
          m(TabStrip, {
            tabs: attrs.tabs,
            activeTabId: attrs.activeTabId,
            onSelectTab: attrs.onSelectTab,
            onCloseTab: attrs.onCloseTab,
            onNewTab: attrs.onNewTab,
            onReorderTabs: attrs.onReorderTabs,
            onTabDragOver: attrs.onTabDragOver,
            onTabDrop: attrs.onTabDrop,
            favouritesOpen,
            canAddFavourite: canAddCurrentFavourite(attrs.favourites),
            onToggleFavourites: () => {
              if (favouritesOpen) closeFavourites();
              else openFavourites(attrs);
              m.redraw();
            },
            showActions: false,
          }),
          favouritesOpen && [
            m('.fm-favourites-menu-backdrop', { onclick: () => closeFavourites() }),
            m(
              '.fm-favourites-menu',
              {
                role: 'menu',
                tabindex: -1,
                'aria-label': 'Favourites',
                oncreate: ({ dom }: VnodeDOM) => focusFirstFavouritesItem(dom as HTMLElement),
                onclick: (event: MouseEvent) => event.stopPropagation(),
                ondblclick: (event: MouseEvent) => event.stopPropagation(),
                onkeydown: (event: KeyboardEvent) => {
                  event.stopPropagation();
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeFavourites();
                    m.redraw();
                  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    moveFavouritesFocus(
                      event.currentTarget as HTMLElement,
                      event.key === 'ArrowDown' ? 1 : -1,
                    );
                  }
                },
              },
              [
                m(
                  'button.fm-favourites-close',
                  {
                    type: 'button',
                    'aria-label': 'Close favourites menu',
                    onclick: () => {
                      closeFavourites();
                      m.redraw();
                    },
                  },
                  '×',
                ),
                (attrs.favourites.systemLocations?.some(({ kind }) => kind === 'cloud') ?? false) &&
                  m('.fm-favourites-recents.fm-cloud-locations', [
                    m('strong', 'Cloud'),
                    ...(attrs.favourites.systemLocations ?? [])
                      .filter(({ kind }) => kind === 'cloud')
                      .map((systemLocation) =>
                        m(
                          'button',
                          {
                            type: 'button',
                            role: 'menuitem',
                            title: systemLocation.location.uri,
                            onclick: () => void navigateFavourite(systemLocation.location, attrs),
                          },
                          attrs.favourites.unavailableLocations?.has(
                            locationKey(systemLocation.location),
                          )
                            ? `${systemLocation.name} (unavailable)`
                            : systemLocation.name,
                        ),
                      ),
                  ]),
                (attrs.favourites.systemLocations?.some(({ kind }) => kind === 'network') ??
                  false) &&
                  m('.fm-favourites-recents.fm-network-locations', [
                    m('strong', 'Network'),
                    ...(attrs.favourites.systemLocations ?? [])
                      .filter(({ kind }) => kind === 'network')
                      .map((systemLocation) =>
                        m(
                          'button',
                          {
                            type: 'button',
                            role: 'menuitem',
                            title: systemLocation.location.uri,
                            onclick: () => void navigateFavourite(systemLocation.location, attrs),
                          },
                          attrs.favourites.unavailableLocations?.has(
                            locationKey(systemLocation.location),
                          )
                            ? `${systemLocation.name} (unavailable)`
                            : systemLocation.readOnly === true
                              ? `${systemLocation.name} (read-only)`
                              : systemLocation.name,
                        ),
                      ),
                  ]),
                (attrs.favourites.connections?.length ?? 0) > 0 &&
                  m('.fm-favourites-recents.fm-servers-locations', [
                    m('strong', { key: '__servers_label__' }, 'Servers'),
                    ...(attrs.favourites.connections ?? []).map((connection) =>
                      (() => {
                        const openInPane = attrs.tabs.some(
                          (tab) => tab.locationUri?.includes(`://${connection.id}/`) === true,
                        );
                        const status = openInPane ? 'connected' : connection.status;
                        return m(
                          'button.fm-server-item',
                          {
                            key: connection.id,
                            type: 'button',
                            role: 'menuitem',
                            title: isBrowsable(connection)
                              ? `${connectionStatusLabel(status)} — open ${connection.name}`
                              : connectionStatusLabel(status),
                            disabled: !isBrowsable(connection),
                            onclick: isBrowsable(connection)
                              ? () => void navigateFavourite(remoteRootLocation(connection), attrs)
                              : undefined,
                          },
                          [
                            m('span.fm-server-name', connection.name),
                            m('span.fm-server-status', connectionStatusGlyph(status)),
                          ],
                        );
                      })(),
                    ),
                  ]),
                attrs.favourites.systemLocationsError === undefined
                  ? undefined
                  : m('.fm-path-error.fm-cloud-locations-error', { role: 'status' }, [
                      'System locations unavailable. ',
                      m(
                        'button',
                        {
                          type: 'button',
                          onclick: () => void attrs.favourites.onRetrySystemLocations?.(),
                        },
                        'Retry',
                      ),
                    ]),
                canAddCurrentFavourite(attrs.favourites)
                  ? m(
                      'form.fm-favourites-add',
                      {
                        onsubmit: (event: SubmitEvent) => {
                          event.preventDefault();
                          addCurrentFavourite(attrs);
                        },
                      },
                      [
                        m('input[type=text]', {
                          value: favouriteLabel,
                          placeholder: 'Favourite name',
                          'aria-label': 'Favourite name',
                          oninput: (event: InputEvent) => {
                            favouriteLabel = (event.currentTarget as HTMLInputElement).value;
                          },
                        }),
                        tooltip(
                          'Add current location',
                          m(
                            IconButton,
                            {
                              className: 'fm-favourites-add-button',
                              'aria-label': 'Add current location',
                              onclick: () => addCurrentFavourite(attrs),
                            },
                            plusIcon(),
                          ),
                        ),
                      ],
                    )
                  : undefined,
                (attrs.favourites.favouriteLocations?.length ?? 0) > 0 &&
                  m('.fm-favourites-recents', [
                    m('strong', 'Favorites'),
                    ...(attrs.favourites.favouriteLocations ?? []).map((favourite, index) =>
                      m('.fm-favourites-item', [
                        m(
                          'button',
                          {
                            type: 'button',
                            role: 'menuitem',
                            onclick: () => void navigateFavourite(favourite.location, attrs),
                          },
                          attrs.favourites.unavailableLocations?.has(
                            locationKey(favourite.location),
                          )
                            ? `${favourite.label} (unavailable)`
                            : favourite.label,
                        ),
                        attrs.favourites.onReorderFavourites === undefined
                          ? undefined
                          : m(
                              'button',
                              {
                                type: 'button',
                                disabled: index === 0,
                                'aria-label': `Move ${favourite.label} up`,
                                onclick: () =>
                                  void attrs.favourites.onReorderFavourites?.(index, index - 1),
                              },
                              '↑',
                            ),
                        attrs.favourites.onDeleteFavourite === undefined
                          ? undefined
                          : m(
                              'button',
                              {
                                type: 'button',
                                'aria-label': `Remove ${favourite.label}`,
                                onclick: () =>
                                  void attrs.favourites.onDeleteFavourite?.(favourite.location),
                              },
                              '×',
                            ),
                      ]),
                    ),
                  ]),
                (attrs.favourites.recentLocations?.length ?? 0) > 0 &&
                  m('.fm-favourites-recents', [
                    m('strong', 'Recent locations'),
                    ...(attrs.favourites.recentLocations ?? []).map((location) =>
                      m(
                        'button',
                        {
                          type: 'button',
                          role: 'menuitem',
                          title: location.uri,
                          onclick: () => void navigateFavourite(location, attrs),
                        },
                        attrs.favourites.unavailableLocations?.has(locationKey(location))
                          ? `${truncateLocationForDisplay(location.uri)} (unavailable)`
                          : truncateLocationForDisplay(location.uri),
                      ),
                    ),
                  ]),
                favouriteError === undefined
                  ? undefined
                  : m('.fm-path-error', { role: 'alert' }, favouriteError),
                attrs.favourites.onManageConnections === undefined
                  ? undefined
                  : m(
                      'button.fm-manage-connections',
                      {
                        type: 'button',
                        role: 'menuitem',
                        onclick: () => {
                          closeFavourites();
                          attrs.favourites.onManageConnections?.();
                        },
                      },
                      'Manage connections…',
                    ),
              ],
            ),
          ],
          m('.fm-breadcrumb-row', [
            attrs.filter.filterOpen
              ? m(QuickFilterInput, {
                  query: attrs.filter.filterQuery,
                  onQueryChange: attrs.filter.onFilterQueryChange,
                  onCommit: attrs.filter.onFilterCommit,
                  onClose: attrs.filter.onFilterClose,
                })
              : editing
                ? m('.fm-path-editor', [
                    m('input[type=text].fm-path-input', {
                      value: draftPath,
                      'aria-label': 'Path',
                      'aria-invalid': pathError === undefined ? undefined : 'true',
                      oncreate: (vnode: VnodeDOM) => {
                        inputElement = vnode.dom as HTMLInputElement;
                        inputElement.focus();
                        inputElement.select();
                      },
                      oninput: (event: InputEvent) => {
                        draftPath = (event.currentTarget as HTMLInputElement).value;
                        pathError = undefined;
                      },
                      onkeydown: (event: KeyboardEvent) => {
                        event.stopPropagation();
                        if (event.key === 'Escape') {
                          cancelEditing();
                        } else if (event.key === 'Enter') {
                          event.preventDefault();
                          void navigate(draftPath, attrs, true);
                        }
                      },
                    }),
                    pathError === undefined
                      ? undefined
                      : m('.fm-path-error', { role: 'alert' }, pathError),
                  ])
                : m('nav.fm-breadcrumb', { 'aria-label': 'Current path' }, [
                    isSftpLocation
                      ? m('span.fm-breadcrumb-scheme', { 'aria-hidden': 'true' }, 'sftp://')
                      : undefined,
                    m(
                      '.fm-breadcrumb-segments',
                      {
                        ondblclick: isSearchLocation ? undefined : () => beginEditing(attrs.path),
                      },
                      isSearchLocation
                        ? searchBreadcrumbSegments(activeLocationUri, attrs.searchQuery).map(
                            (segment) =>
                              m('span.fm-breadcrumb-segment', { key: segment.path }, segment.label),
                          )
                        : (isSftpLocation && attrs.path !== '/'
                            ? breadcrumbSegments(attrs.path).slice(1)
                            : breadcrumbSegments(attrs.path)
                          ).map((segment) =>
                            m(
                              'button.fm-breadcrumb-segment',
                              {
                                key: segment.path,
                                type: 'button',
                                onclick: () => void navigate(segment.path, attrs, false),
                              },
                              segment.label,
                            ),
                          ),
                    ),
                    pathError === undefined
                      ? undefined
                      : m('.fm-path-error', { role: 'alert' }, pathError),
                  ]),
            tooltip(
              'New tab',
              m(
                IconButton,
                {
                  className: 'fm-pane-tab-new',
                  'aria-label': 'New tab',
                  onclick: () => attrs.onNewTab(),
                },
                plusIcon(),
              ),
            ),
            m('.fm-view-mode-menu-wrapper', [
              tooltip(
                'View',
                m(
                  IconButton,
                  {
                    className: 'fm-pane-view-mode',
                    'aria-label': 'View',
                    'aria-haspopup': 'menu',
                    'aria-expanded': String(viewMenuOpen),
                    onclick: () => {
                      viewMenuOpen = !viewMenuOpen;
                      m.redraw();
                    },
                  },
                  (attrs.tableConfig.viewMode ?? 'table') === 'table'
                    ? listIcon()
                    : layoutGridIcon(),
                ),
              ),
              viewMenuOpen
                ? [
                    m('.fm-view-mode-menu-backdrop', { onclick: () => (viewMenuOpen = false) }),
                    m(
                      '.fm-view-mode-menu',
                      { role: 'menu', 'aria-label': 'View mode' },
                      (
                        [
                          { label: 'List', viewMode: 'table', icon: listIcon() },
                          { label: 'Small icons', viewMode: 'grid', size: 'small' },
                          { label: 'Medium icons', viewMode: 'grid', size: 'medium' },
                          { label: 'Large icons', viewMode: 'grid', size: 'large' },
                        ] as const
                      ).map((option) => {
                        const active =
                          option.viewMode === 'table'
                            ? (attrs.tableConfig.viewMode ?? 'table') === 'table'
                            : (attrs.tableConfig.viewMode ?? 'table') === 'grid' &&
                              (attrs.tableConfig.iconSize ?? 'medium') === option.size;
                        return m(
                          'button.fm-view-mode-menu-item',
                          {
                            key: option.label,
                            type: 'button',
                            role: 'menuitemradio',
                            'aria-checked': String(active),
                            onclick: () => {
                              viewMenuOpen = false;
                              attrs.tableConfig.onViewModeChange?.(
                                option.viewMode,
                                option.viewMode === 'grid' ? option.size : 'medium',
                              );
                            },
                          },
                          option.label,
                        );
                      }),
                    ),
                  ]
                : undefined,
            ]),
            tooltip(
              'Favourites',
              m(
                IconButton,
                {
                  className: 'fm-pane-tab-favourites',
                  'aria-label': 'Favourites',
                  'aria-expanded': String(favouritesOpen),
                  onclick: () => {
                    if (favouritesOpen) closeFavourites();
                    else openFavourites(attrs);
                    m.redraw();
                  },
                },
                canAddCurrentFavourite(attrs.favourites) ? heartPlusIcon() : heartIcon(),
              ),
            ),
          ]),
          (() => {
            const isGridView = attrs.tableConfig.viewMode === 'grid';
            const sharedListAttrs = {
              state: attrs.state,
              source: entryArraySource(attrs.entries, ds.totalKnownEntries),
              selectedEntryIds: attrs.selectedEntryIds,
              cutEntryIds: attrs.cutEntryIds,
              ...(attrs.tableConfig.nativeIconLoader === undefined
                ? {}
                : { nativeIconLoader: attrs.tableConfig.nativeIconLoader }),
              ...(attrs.tableConfig.thumbnailLoader === undefined
                ? {}
                : { thumbnailLoader: attrs.tableConfig.thumbnailLoader }),
              label: `${attrs.tabTitle} directory`,
              onRetry: () => void attrs.onRetry(),
              onEndReached: () => void attrs.onLoadNextPage(),
              onCursorChange: (index: number, modifiers?: CursorClickModifiers) => {
                const entry = attrs.entries[index];
                if (entry === undefined) return;
                // A mouse click only ever changed selection *state* - nothing moved real DOM focus
                // to match, so a keypress immediately after clicking a row could race (or entirely
                // miss) this pane's `onkeydown` handler depending on whatever had focus beforehand.
                // Grabbing focus here makes a click reliably prime keyboard input the same way
                // clicking anywhere else in the app already does.
                if (document.activeElement !== sectionElement) sectionElement?.focus();
                if (isParentEntry(entry.id)) {
                  attrs.onSelectionAction({ type: 'selectOnly', entryId: entry.id });
                } else if (modifiers?.shiftKey === true) {
                  attrs.onSelectionAction({ type: 'extendRangeTo', entryId: entry.id });
                } else if (modifiers?.ctrlKey === true) {
                  attrs.onSelectionAction({ type: 'toggle', entryId: entry.id });
                } else {
                  // A plain click only repositions the cursor (Total Commander parity) - it must
                  // not mark the row, or the very next Space (a toggle) would immediately un-mark
                  // whatever the click just landed on instead of marking it. `positionCursor` (not
                  // `setCursor`, which typeahead uses and leaves marks untouched) also drops a
                  // stale lone mark left over from elsewhere, matching `moveCursor`'s convention.
                  attrs.onSelectionAction({ type: 'positionCursor', entryId: entry.id });
                }
              },
              onActivate: (index: number) => {
                const entry = attrs.entries[index];
                if (entry !== undefined) {
                  void attrs.onOpenEntry(entry);
                }
              },
              onContextMenu: (index: number | undefined, x: number, y: number) => {
                if (index === undefined) {
                  attrs.onContextMenu([], x, y);
                  return;
                }
                const target = attrs.entries[index];
                if (
                  target !== undefined &&
                  !isParentEntry(target.id) &&
                  !attrs.selectedEntryIds.has(target.id)
                ) {
                  attrs.onSelectionAction({ type: 'selectOnly', entryId: target.id });
                  attrs.onContextMenu([target], x, y);
                  return;
                }
                attrs.onContextMenu(
                  attrs.entries.filter(
                    (entry) => !isParentEntry(entry.id) && attrs.selectedEntryIds.has(entry.id),
                  ),
                  x,
                  y,
                );
              },
              onDragStart: (index: number, event: DragEvent) => {
                const dragged = attrs.entries[index];
                if (dragged === undefined || isParentEntry(dragged.id)) return;
                const selection = attrs.selectedEntryIds.has(dragged.id)
                  ? attrs.entries.filter(
                      (entry) => !isParentEntry(entry.id) && attrs.selectedEntryIds.has(entry.id),
                    )
                  : [dragged];
                attrs.onDragStart?.(selection, event);
              },
              onDragOver: (index: number | undefined, event: DragEvent) =>
                attrs.onDragOver?.(index === undefined ? undefined : attrs.entries[index], event) ??
                false,
              onDrop: (index: number | undefined, event: DragEvent) =>
                attrs.onDrop?.(index === undefined ? undefined : attrs.entries[index], event),
              ...(attrs.cursorIndex === undefined ? {} : { cursorIndex: attrs.cursorIndex }),
            };

            return isGridView
              ? m(DirectoryGrid, {
                  ...sharedListAttrs,
                  iconSize: attrs.tableConfig.iconSize ?? 'medium',
                })
              : m(DirectoryTable, {
                  ...sharedListAttrs,
                  active: attrs.active,
                  sort: attrs.tableConfig.sort,
                  ...(attrs.tableConfig.pluginColumns === undefined
                    ? {}
                    : { pluginColumns: attrs.tableConfig.pluginColumns }),
                  ...(attrs.tableConfig.formatSettings === undefined
                    ? {}
                    : { formatSettings: attrs.tableConfig.formatSettings }),
                  showFullPath: isSearchLocation,
                  ...(renameCtrl.entry === undefined
                    ? {}
                    : { renamingEntryId: renameCtrl.entry.id }),
                  renameValue: renameCtrl.value,
                  ...(renameCtrl.error === undefined ? {} : { renameError: renameCtrl.error }),
                  onRenameInput: (value: string) => {
                    renameCtrl.updateValue(value);
                  },
                  onRenameCancel: () => {
                    renameCtrl.cancel();
                    m.redraw();
                  },
                  onRenameCommit: () => {
                    const committed = renameCtrl.commit();
                    if (committed !== undefined) {
                      void attrs.onRename(committed.entry, committed.name);
                    } else {
                      m.redraw();
                    }
                  },
                  ...(typeaheadCtrl.prefix === undefined
                    ? {}
                    : { nameMatchPrefix: typeaheadCtrl.prefix }),
                  onSortChange: attrs.onSortChange,
                });
          })(),
          m('.fm-pane-status', { role: 'status' }, [
            m(
              'span',
              attrs.filter.filterQuery.trim() === ''
                ? (backendListingSummary ?? listingSummary(ordinaryEntries))
                : `${listingSummary(ordinaryEntries)} (${ordinaryEntries.length} of ${ds.totalEntryCount} shown${
                    ds.hasMore === true ? ', more available' : ''
                  })`,
            ),
            selectedCount === 0
              ? undefined
              : m(
                  'span',
                  `${sizeLabel(totalSelectedSize)} in ${selectedCount} selected${
                    ds.hiddenSelectedCount > 0
                      ? ` (${ds.hiddenSelectedCount} hidden by filter)`
                      : ''
                  }`,
                ),
            volumeCapacityText === undefined
              ? undefined
              : m('span.fm-pane-volume-capacity', volumeCapacityText),
            typeaheadCtrl.prefix === undefined
              ? undefined
              : m(
                  `span.fm-typeahead-status${typeaheadCtrl.hasError ? '.fm-typeahead-status-error' : ''}`,
                  typeaheadCtrl.prefix,
                ),
          ]),
        ],
      );
    },
  };
};
