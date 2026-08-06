import m, { type FactoryComponent, type VnodeDOM } from 'mithril';
import { IconButton } from 'mithril-materialized';
import { heartIcon, plusIcon } from '../../components/tabler-icons';
import {
  dispatchKeybinding,
  hasPrimaryModifier,
  type KeybindingRuntime,
} from '../../keybindings/dispatcher';
import type {
  ActionDescriptor,
  EntryId,
  EntrySummary,
  FavouriteLocation,
  LoadingState,
  Location,
  SortDescriptor,
  TabId,
} from '../../models';
import {
  type DirectoryColumnDescriptor,
  DirectoryTable,
  entryArraySource,
} from '../directory-table/directory-table';
import type { NativeIconLoader } from '../directory-table/native-icon-loader';
import type { EntryFormatSettings } from '../entry-formatting/entry-formatting';
import { truncateLocationForDisplay } from '../favourites/favourites';
import { validateDirectoryName } from '../operations/create-directory-dialog';
import { QuickFilterInput } from '../quick-filter/quick-filter-input';
import {
  reduceTypeahead,
  type SelectionPlatform,
  type TypeaheadState,
} from '../selection/keybindings';
import type { SelectionAction } from '../selection/selection';
import { isParentEntry } from './parent-entry';
import { reorderedTabIds } from './tab-navigation';
import './pane.css';

/** A cumulative, clickable part of a filesystem path. */
export interface BreadcrumbSegment {
  readonly label: string;
  readonly path: string;
}

/** One entry in a pane's tab strip (spec §37). */
export interface PaneTab {
  readonly id: TabId;
  readonly title: string;
  /** Full path shown as the tab's tooltip. */
  readonly path: string;
}

/** Inputs for the presentation-only pane surface. */
export interface PaneAttrs {
  readonly path: string;
  readonly tabTitle: string;
  readonly tabs: readonly PaneTab[];
  readonly activeTabId: TabId;
  readonly onSelectTab: (tabId: TabId) => void;
  readonly onCloseTab: (tabId: TabId) => void;
  readonly onNewTab: () => void;
  readonly onReorderTabs: (order: readonly TabId[]) => void;
  /** The active tab's provider-neutral location, used by the favourites menu. */
  readonly location?: Location;
  readonly favouriteLocations?: readonly FavouriteLocation[];
  readonly recentLocations?: readonly Location[];
  readonly unavailableLocations?: ReadonlySet<string>;
  readonly onNavigateLocation?: (location: Location) => void | Promise<void>;
  readonly onAddFavourite?: (label: string, location: Location) => void | Promise<void>;
  readonly onDeleteFavourite?: (location: Location) => void | Promise<void>;
  readonly onReorderFavourites?: (from: number, to: number) => void | Promise<void>;
  readonly state: LoadingState;
  readonly entries: readonly EntrySummary[];
  readonly sortLabel: string;
  readonly sort: readonly SortDescriptor[];
  readonly formatSettings?: EntryFormatSettings;
  readonly pluginColumns?: readonly DirectoryColumnDescriptor[];
  readonly nativeIconLoader?: NativeIconLoader;
  readonly selectedEntryIds: ReadonlySet<EntryId>;
  readonly cutEntryIds: ReadonlySet<EntryId>;
  readonly active: boolean;
  readonly cursorIndex?: number;
  readonly platform: SelectionPlatform;
  readonly keybindingRuntime?: KeybindingRuntime;
  readonly actions?: readonly ActionDescriptor[];
  readonly keybindingOverrides?: Readonly<Record<string, string>>;
  readonly canNavigateBack: boolean;
  readonly canNavigateForward: boolean;
  /** Whether the loaded directory has more unfetched pages (spec-required paging clarity). */
  readonly hasMore?: boolean;
  /** Total loaded ordinary entries before filtering, for the "N of M shown" status. */
  readonly totalEntryCount: number;
  /**
   * The directory's real entry count reported by the backend, known from the first page even
   * before every page has loaded — sizes the scrollbar/virtualized content height correctly up
   * front instead of only once all pages have been fetched.
   */
  readonly totalKnownEntries?: number;
  /** Combined byte size of every file/symlink entry in the directory, known from the backend. */
  readonly totalKnownSize?: number;
  /** Number of file/symlink entries (directories excluded) in the directory, known from the backend. */
  readonly totalKnownFileCount?: number;
  /** Selected entries hidden by the active filter (still selected, just not rendered). */
  readonly hiddenSelectedCount: number;
  readonly filterOpen: boolean;
  readonly filterQuery: string;
  readonly onFilterQueryChange: (query: string) => void;
  readonly onFilterCommit: () => void;
  readonly onFilterClose: () => void;
  readonly onNavigate: (path: string) => void | Promise<void>;
  readonly onBack: () => void | Promise<void>;
  readonly onForward: () => void | Promise<void>;
  readonly onParent: () => void | Promise<void>;
  readonly onOpenEntry: (entry: EntrySummary) => void | Promise<void>;
  readonly onSelectionAction: (action: SelectionAction) => void;
  readonly onRetry: () => void | Promise<void>;
  readonly onLoadNextPage: () => void | Promise<void>;
  readonly onSortChange: (sort: readonly SortDescriptor[]) => void;
  readonly onRename: (entry: EntrySummary, name: string) => void | Promise<void>;
  /** F2 with more than one entry selected opens the multi-rename dialog (task 0072) instead of
   * the single-entry inline rename input. */
  readonly onMultiRename?: (entries: readonly EntrySummary[]) => void;
  readonly onContextMenu: (entries: readonly EntrySummary[], x: number, y: number) => void;
  /** When set, replaces the entire directory-listing surface with this content (task 0088's
   * Lister-style viewer, opened in the opposite pane). */
  readonly viewerContent?: m.Children;
}

/** Uses the visible folder name as the initial, editable favourite label. */
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

function posixSegments(path: string): readonly BreadcrumbSegment[] {
  if (path === '/') {
    return [{ label: '/', path: '/' }];
  }
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === '~') {
    return parts.map((label, index) => ({
      label,
      path: index === 0 ? '~' : `~/${parts.slice(1, index + 1).join('/')}`,
    }));
  }
  return [
    { label: '/', path: '/' },
    ...parts.map((label, index) => ({
      label,
      path: `/${parts.slice(0, index + 1).join('/')}`,
    })),
  ];
}

function windowsSegments(path: string): readonly BreadcrumbSegment[] {
  const separator = '\\';
  const parts = path.split(separator).filter(Boolean);
  if (path.startsWith('\\\\') && parts.length >= 2) {
    const root = `\\\\${parts[0]}\\${parts[1]}`;
    return [
      { label: root, path: root },
      ...parts.slice(2).map((label, index) => ({
        label,
        path: `${root}\\${parts.slice(2, index + 3).join('\\')}`,
      })),
    ];
  }
  const root = parts[0] ?? path;
  return [
    { label: root, path: root.endsWith(':') ? `${root}\\` : root },
    ...parts.slice(1).map((label, index) => ({
      label,
      path: `${root}\\${parts.slice(1, index + 2).join('\\')}`,
    })),
  ];
}

/** Produces cumulative breadcrumb targets for POSIX, drive-letter and UNC paths. */
export function breadcrumbSegments(path: string): readonly BreadcrumbSegment[] {
  return path.includes('\\') ? windowsSegments(path) : posixSegments(path);
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

/** Formats a Marta-style status summary from already-aggregated counts. */
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

/** Aggregates the currently listed (loaded/shown) entries into a Marta-style status summary:
 * total size of files plus separate file/folder counts. Symlinks are counted as files since
 * they're visually indistinguishable from them in the table. */
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

/** Compact pane containing its single tab, path controls, directory grid, and status. */
export const Pane: FactoryComponent<PaneAttrs> = () => {
  let editing = false;
  let draftPath = '';
  let draggedTabId: TabId | undefined;
  let pathError: string | undefined;
  let inputElement: HTMLInputElement | undefined;
  let typeahead: TypeaheadState | undefined;
  let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;
  let typeaheadError = false;
  /** The path the current `typeahead` prefix was typed against; a path change resets it. */
  let typeaheadPath: string | undefined;
  let renamingEntry: EntrySummary | undefined;
  let renameValue = '';
  let renameError: string | undefined;
  let favouritesOpen = false;
  let favouriteLabel = '';
  let favouriteError: string | undefined;
  /** Restored when the favourites menu closes, so keyboard users don't lose their place. */
  let favouritesPreviousFocus: HTMLElement | undefined;

  function openFavourites(attrs: PaneAttrs): void {
    favouritesPreviousFocus = document.activeElement as HTMLElement;
    favouriteLabel = defaultFavouriteLabel(attrs.path);
    favouriteError = undefined;
    favouritesOpen = true;
  }

  function closeFavourites(): void {
    favouritesOpen = false;
    favouritesPreviousFocus?.focus();
    favouritesPreviousFocus = undefined;
  }

  async function navigateFavourite(location: Location, attrs: PaneAttrs): Promise<void> {
    if (attrs.onNavigateLocation === undefined) return;
    try {
      await attrs.onNavigateLocation(location);
      favouriteError = undefined;
      closeFavourites();
    } catch (error: unknown) {
      favouriteError = errorMessage(error);
    }
    m.redraw();
  }

  function addCurrentFavourite(attrs: PaneAttrs): void {
    if (attrs.location === undefined || attrs.onAddFavourite === undefined) return;
    const label = favouriteLabel.trim() || defaultFavouriteLabel(attrs.path);
    void attrs.onAddFavourite(label, attrs.location);
    favouriteLabel = '';
  }

  /** Focuses the first selectable favourite/recent so Enter navigates immediately (TC hotlist-style). */
  function focusFirstFavouritesItem(menu: HTMLElement): void {
    const first = menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    if (first === null) {
      menu.focus();
      return;
    }
    first.focus();
  }

  /** Moves focus between favourites and recent locations as one continuous, wrapping list. */
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

  function locationKey(location: Location): string {
    return `${location.providerId}:${location.uri}`;
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
    renamingEntry = entry;
    renameValue = entry.name;
    renameError = undefined;
    m.redraw();
  }

  function cancelRename(): void {
    renamingEntry = undefined;
    renameError = undefined;
    m.redraw();
  }

  function commitRename(attrs: PaneAttrs): void {
    renameError = validateDirectoryName(renameValue);
    if (renameError !== undefined || renamingEntry === undefined) {
      m.redraw();
      return;
    }
    const entry = renamingEntry;
    renamingEntry = undefined;
    void attrs.onRename(entry, renameValue);
  }

  function clearTypeaheadTimer(): void {
    if (typeaheadTimer !== undefined) {
      clearTimeout(typeaheadTimer);
      typeaheadTimer = undefined;
    }
  }

  function flashRejectedTypeahead(): void {
    clearTypeaheadTimer();
    typeaheadError = true;
    typeaheadTimer = setTimeout(() => {
      typeaheadError = false;
      typeaheadTimer = undefined;
      m.redraw();
    }, 400);
  }

  function moveWithinMatches(
    attrs: PaneAttrs,
    offset: number,
    edge?: 'first' | 'last',
    extend = false,
  ): boolean {
    if (typeahead === undefined) {
      return false;
    }
    const matches = attrs.entries.filter((entry) =>
      entry.name.toLocaleLowerCase().includes(typeahead?.prefix ?? ''),
    );
    if (matches.length === 0) {
      return true;
    }
    const cursorEntry =
      attrs.cursorIndex === undefined ? undefined : attrs.entries[attrs.cursorIndex];
    const currentMatchIndex = matches.findIndex((entry) => entry.id === cursorEntry?.id);
    const targetIndex =
      edge === 'first'
        ? 0
        : edge === 'last'
          ? matches.length - 1
          : Math.max(
              0,
              Math.min(
                (currentMatchIndex < 0 ? (offset < 0 ? matches.length : -1) : currentMatchIndex) +
                  offset,
                matches.length - 1,
              ),
            );
    const target = matches[targetIndex];
    if (target === undefined) {
      return true;
    }
    if (extend && cursorEntry !== undefined) {
      const cursorIndex = attrs.entries.indexOf(cursorEntry);
      const targetEntryIndex = attrs.entries.indexOf(target);
      attrs.onSelectionAction({ type: 'extendRange', offset: targetEntryIndex - cursorIndex });
    } else {
      attrs.onSelectionAction({ type: 'setCursor', entryId: target.id });
    }
    return true;
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
      await attrs.onNavigate(path);
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
      clearTypeaheadTimer();
    },
    view: ({ attrs }) => {
      if (attrs.viewerContent !== undefined) {
        // Bypasses the directory-listing grid entirely (tabs/breadcrumb/table/status) - the
        // Lister-style viewer (task 0088) owns its own header/body layout via `.fm-pane-viewer`.
        return m(
          'section.fm-pane.fm-pane-viewer',
          { 'data-active': String(attrs.active), tabindex: -1 },
          attrs.viewerContent,
        );
      }
      // The quick filter occupies the breadcrumb bar's slot while active, so an in-progress
      // path edit (started before the filter was invoked) would otherwise reappear, stale, once
      // the filter closes — drop it silently instead.
      if (attrs.filterOpen && editing) {
        editing = false;
        pathError = undefined;
      }
      // Entering a different directory (however navigation happened: opening an entry, ..,
      // breadcrumb, back/forward, or switching tabs) makes any typed prefix meaningless for the
      // new listing, and stale error highlighting to boot — reset it once per path change.
      if (typeaheadPath !== attrs.path) {
        typeaheadPath = attrs.path;
        clearTypeaheadTimer();
        typeahead = undefined;
        typeaheadError = false;
      }
      const ordinaryEntries = attrs.entries.filter((entry) => !isParentEntry(entry.id));
      const selectedCount = attrs.selectedEntryIds.size;
      const totalSelectedSize = selectedSize(ordinaryEntries, attrs.selectedEntryIds);
      // `attrs.totalKnownEntries` counts the synthetic ".." row the same way `attrs.entries`
      // does (app-shell adds +1 for it), while the backend-reported size/file-count totals never
      // do — subtract the same adjustment so the counts stay comparable. Only used unfiltered:
      // while filtering, the backend total can't be projected onto the filtered subset, so the
      // status bar falls back to aggregating the filtered/shown entries directly (see below).
      const parentEntryAdjustment = attrs.entries.length - ordinaryEntries.length;
      const backendTotalEntries =
        attrs.totalKnownEntries === undefined
          ? undefined
          : attrs.totalKnownEntries - parentEntryAdjustment;
      const backendListingSummary =
        attrs.filterQuery.trim() === '' &&
        attrs.totalKnownSize !== undefined &&
        attrs.totalKnownFileCount !== undefined &&
        backendTotalEntries !== undefined
          ? formatListingSummary(
              attrs.totalKnownFileCount,
              backendTotalEntries - attrs.totalKnownFileCount,
              attrs.totalKnownSize,
            )
          : undefined;
      return m(
        'section.fm-pane',
        {
          'data-active': String(attrs.active),
          tabindex: -1,
          onkeydown: (event: KeyboardEvent) => {
            if (isEditableTarget(event.target)) return;
            // Ctrl/Cmd+D opens the favourites menu directly, TC hotlist-style, regardless of
            // whether it's also bound as a palette-visible action.
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
              clearTypeaheadTimer();
              typeahead = undefined;
              typeaheadError = false;
              attrs.onSelectionAction({ type: 'clear' });
              m.redraw();
              return;
            }
            if (event.key === 'Backspace' && typeahead !== undefined) {
              event.preventDefault();
              clearTypeaheadTimer();
              const prefix = typeahead.prefix.slice(0, -1);
              typeahead =
                prefix.length === 0 ? undefined : { prefix, lastInputAt: typeahead.lastInputAt };
              typeaheadError = false;
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
                                  : actionId === 'core.open'
                                    ? { type: 'open' as const }
                                    : actionId === 'core.parent'
                                      ? { type: 'parent' as const }
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
              void attrs.onParent();
            } else if (command?.type === 'moveCursor') {
              event.preventDefault();
              if (!moveWithinMatches(attrs, command.offset)) {
                attrs.onSelectionAction(command);
              }
            } else if (command?.type === 'moveCursorByPage') {
              event.preventDefault();
              const offset = command.pages * 10;
              if (!moveWithinMatches(attrs, offset)) {
                attrs.onSelectionAction({ type: 'moveCursor', offset });
              }
            } else if (command?.type === 'moveCursorTo') {
              event.preventDefault();
              if (!moveWithinMatches(attrs, 0, command.edge)) {
                attrs.onSelectionAction(command);
              }
            } else if (command?.type === 'extendRange') {
              event.preventDefault();
              if (!moveWithinMatches(attrs, command.offset, undefined, true)) {
                attrs.onSelectionAction(command);
              }
            } else if (command?.type === 'toggleCursorSelection') {
              const entry =
                attrs.cursorIndex === undefined ? undefined : attrs.entries[attrs.cursorIndex];
              if (entry !== undefined && !isParentEntry(entry.id)) {
                event.preventDefault();
                attrs.onSelectionAction({ type: 'toggle', entryId: entry.id });
              }
            } else if (command?.type === 'selectAll') {
              event.preventDefault();
              attrs.onSelectionAction({ type: 'selectAll' });
            } else if (event.altKey && event.key === 'ArrowLeft') {
              event.preventDefault();
              void attrs.onBack();
            } else if (event.altKey && event.key === 'ArrowRight') {
              event.preventDefault();
              void attrs.onForward();
            } else if (
              event.key.length === 1 &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              const result = reduceTypeahead(
                typeahead,
                event.key,
                attrs.entries,
                Date.now(),
                Number.POSITIVE_INFINITY,
              );
              typeahead = result.state;
              if (result.matchedEntryId !== undefined) {
                clearTypeaheadTimer();
                typeaheadError = false;
                event.preventDefault();
                attrs.onSelectionAction({ type: 'selectOnly', entryId: result.matchedEntryId });
              } else {
                flashRejectedTypeahead();
              }
              m.redraw();
            }
          },
          onauxclick: (event: MouseEvent) => {
            if (event.button === 3) {
              event.preventDefault();
              void attrs.onBack();
            } else if (event.button === 4) {
              event.preventDefault();
              void attrs.onForward();
            }
          },
        },
        [
          m('.fm-pane-tabs', { role: 'tablist', 'aria-label': 'Pane tabs' }, [
            ...attrs.tabs.map((tab) =>
              m(
                '.fm-pane-tab',
                {
                  key: tab.id,
                  role: 'tab',
                  tabindex: 0,
                  draggable: true,
                  title: tab.path,
                  'aria-selected': tab.id === attrs.activeTabId ? 'true' : 'false',
                  onclick: () => attrs.onSelectTab(tab.id),
                  onkeydown: (event: KeyboardEvent) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      attrs.onSelectTab(tab.id);
                    }
                  },
                  ondragstart: (event: DragEvent) => {
                    draggedTabId = tab.id;
                    event.dataTransfer?.setData('text/plain', tab.id);
                  },
                  ondragover: (event: DragEvent) => {
                    event.preventDefault();
                  },
                  ondrop: (event: DragEvent) => {
                    event.preventDefault();
                    const sourceId =
                      draggedTabId ?? (event.dataTransfer?.getData('text/plain') as TabId | '');
                    draggedTabId = undefined;
                    if (sourceId !== undefined && sourceId !== '' && sourceId !== tab.id) {
                      attrs.onReorderTabs(
                        reorderedTabIds(
                          attrs.tabs.map((candidate) => candidate.id),
                          sourceId,
                          tab.id,
                        ),
                      );
                    }
                  },
                  ondragend: () => {
                    draggedTabId = undefined;
                  },
                },
                [
                  m('span.fm-pane-tab-title', tab.title),
                  m(
                    'button.fm-pane-tab-close',
                    {
                      type: 'button',
                      'aria-label': `Close ${tab.title}`,
                      onclick: (event: MouseEvent) => {
                        event.stopPropagation();
                        attrs.onCloseTab(tab.id);
                      },
                    },
                    '×',
                  ),
                ],
              ),
            ),
            m(
              'button.fm-pane-tab-new',
              {
                key: '__new-tab__',
                type: 'button',
                'aria-label': 'New tab',
                onclick: () => attrs.onNewTab(),
              },
              '+',
            ),
            m(
              IconButton,
              {
                key: '__favourites__',
                className: 'fm-pane-tab-favourites',
                'aria-label': 'Favourites',
                tooltip: 'Favourites',
                'aria-expanded': String(favouritesOpen),
                onclick: () => {
                  if (favouritesOpen) closeFavourites();
                  else openFavourites(attrs);
                },
              },
              heartIcon(),
            ),
          ]),
          favouritesOpen
            ? [
                m('.fm-favourites-menu-backdrop', { onclick: () => closeFavourites() }),
                m(
                  '.fm-favourites-menu',
                  {
                    role: 'menu',
                    tabindex: -1,
                    'aria-label': 'Favourites',
                    oncreate: ({ dom }: VnodeDOM) => focusFirstFavouritesItem(dom as HTMLElement),
                    onkeydown: (event: KeyboardEvent) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        closeFavourites();
                        m.redraw();
                      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        event.stopPropagation();
                        moveFavouritesFocus(
                          event.currentTarget as HTMLElement,
                          event.key === 'ArrowDown' ? 1 : -1,
                        );
                      }
                    },
                  },
                  [
                    attrs.location !== undefined && attrs.onAddFavourite !== undefined
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
                            m(
                              IconButton,
                              {
                                className: 'fm-favourites-add-button',
                                'aria-label': 'Add current location',
                                'data-tooltip': 'Add current location',
                                onclick: () => addCurrentFavourite(attrs),
                              },
                              plusIcon(),
                            ),
                          ],
                        )
                      : undefined,
                    ...(attrs.favouriteLocations ?? []).map((favourite, index) =>
                      m('.fm-favourites-item', [
                        m(
                          'button',
                          {
                            type: 'button',
                            role: 'menuitem',
                            onclick: () => void navigateFavourite(favourite.location, attrs),
                            disabled: attrs.unavailableLocations?.has(
                              locationKey(favourite.location),
                            ),
                          },
                          attrs.unavailableLocations?.has(locationKey(favourite.location))
                            ? `${favourite.label} (unavailable)`
                            : favourite.label,
                        ),
                        attrs.onReorderFavourites === undefined
                          ? undefined
                          : m(
                              'button',
                              {
                                type: 'button',
                                disabled: index === 0,
                                'aria-label': `Move ${favourite.label} up`,
                                onclick: () => void attrs.onReorderFavourites?.(index, index - 1),
                              },
                              '↑',
                            ),
                        attrs.onDeleteFavourite === undefined
                          ? undefined
                          : m(
                              'button',
                              {
                                type: 'button',
                                'aria-label': `Remove ${favourite.label}`,
                                onclick: () => void attrs.onDeleteFavourite?.(favourite.location),
                              },
                              '×',
                            ),
                      ]),
                    ),
                    (attrs.recentLocations?.length ?? 0) > 0
                      ? m('.fm-favourites-recents', [
                          m('strong', 'Recent locations'),
                          ...(attrs.recentLocations ?? []).map((location) =>
                            m(
                              'button',
                              {
                                type: 'button',
                                role: 'menuitem',
                                title: location.uri,
                                onclick: () => void navigateFavourite(location, attrs),
                                disabled: attrs.unavailableLocations?.has(locationKey(location)),
                              },
                              attrs.unavailableLocations?.has(locationKey(location))
                                ? `${truncateLocationForDisplay(location.uri)} (unavailable)`
                                : truncateLocationForDisplay(location.uri),
                            ),
                          ),
                        ])
                      : undefined,
                    favouriteError === undefined
                      ? undefined
                      : m('.fm-path-error', { role: 'alert' }, favouriteError),
                  ],
                ),
              ]
            : // A text vnode keeps this sibling slot present without becoming a grid item. Mithril
              // otherwise treats the conditional `undefined` as a fragment hole beside keyed tab
              // descendants during redraw.
              '',
          attrs.filterOpen
            ? m(QuickFilterInput, {
                query: attrs.filterQuery,
                onQueryChange: attrs.onFilterQueryChange,
                onCommit: attrs.onFilterCommit,
                onClose: attrs.onFilterClose,
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
                  m(
                    '.fm-breadcrumb-segments',
                    {
                      ondblclick: () => beginEditing(attrs.path),
                    },
                    breadcrumbSegments(attrs.path).map((segment) =>
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
          m(DirectoryTable, {
            state: attrs.state,
            source: entryArraySource(attrs.entries, attrs.totalKnownEntries),
            selectedEntryIds: attrs.selectedEntryIds,
            cutEntryIds: attrs.cutEntryIds,
            active: attrs.active,
            sort: attrs.sort,
            ...(attrs.pluginColumns === undefined ? {} : { pluginColumns: attrs.pluginColumns }),
            ...(attrs.formatSettings === undefined ? {} : { formatSettings: attrs.formatSettings }),
            ...(attrs.nativeIconLoader === undefined
              ? {}
              : { nativeIconLoader: attrs.nativeIconLoader }),
            label: `${attrs.tabTitle} directory`,
            showFullPath: attrs.path.startsWith('search://'),
            ...(renamingEntry === undefined ? {} : { renamingEntryId: renamingEntry.id }),
            renameValue,
            ...(renameError === undefined ? {} : { renameError }),
            onRenameInput: (value) => {
              renameValue = value;
              renameError = validateDirectoryName(value);
            },
            onRenameCancel: cancelRename,
            onRenameCommit: () => commitRename(attrs),
            ...(typeahead === undefined ? {} : { nameMatchPrefix: typeahead.prefix }),
            onRetry: () => void attrs.onRetry(),
            onEndReached: () => void attrs.onLoadNextPage(),
            onCursorChange: (index, modifiers) => {
              const entry = attrs.entries[index];
              if (entry === undefined) {
                return;
              }
              if (isParentEntry(entry.id)) {
                attrs.onSelectionAction({ type: 'setCursor', entryId: entry.id });
              } else if (modifiers?.shiftKey === true) {
                attrs.onSelectionAction({ type: 'extendRangeTo', entryId: entry.id });
              } else if (modifiers?.ctrlKey === true) {
                attrs.onSelectionAction({ type: 'toggle', entryId: entry.id });
              } else {
                attrs.onSelectionAction({ type: 'selectOnly', entryId: entry.id });
              }
            },
            onActivate: (index) => {
              const entry = attrs.entries[index];
              if (entry !== undefined) {
                void attrs.onOpenEntry(entry);
              }
            },
            onContextMenu: (index, x, y) => {
              // A right-click on empty space below/around the rows always means
              // the location-level menu, regardless of which entry happens to be
              // selected (the cursor/selection now always lands somewhere).
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
            onSortChange: attrs.onSortChange,
            ...(attrs.cursorIndex === undefined ? {} : { cursorIndex: attrs.cursorIndex }),
          }),
          m('.fm-pane-status', { role: 'status' }, [
            m(
              'span',
              attrs.filterQuery.trim() === ''
                ? (backendListingSummary ?? listingSummary(ordinaryEntries))
                : `${listingSummary(ordinaryEntries)} (${ordinaryEntries.length} of ${attrs.totalEntryCount} shown${
                    attrs.hasMore === true ? ', more available' : ''
                  })`,
            ),
            selectedCount === 0
              ? undefined
              : m(
                  'span',
                  `${sizeLabel(totalSelectedSize)} in ${selectedCount} selected${
                    attrs.hiddenSelectedCount > 0
                      ? ` (${attrs.hiddenSelectedCount} hidden by filter)`
                      : ''
                  }`,
                ),
            typeahead === undefined
              ? undefined
              : m(
                  `span.fm-typeahead-status${typeaheadError ? '.fm-typeahead-status-error' : ''}`,
                  typeahead.prefix,
                ),
          ]),
        ],
      );
    },
  };
};
