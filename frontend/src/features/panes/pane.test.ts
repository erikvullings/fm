import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeybindingRuntime } from '../../keybindings/dispatcher';
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
import type { DirectoryColumnDescriptor } from '../directory-table/directory-table';
import type { NativeIconLoader } from '../directory-table/native-icon-loader';
import type { EntryFormatSettings } from '../entry-formatting/entry-formatting';
import type { SelectionPlatform } from '../selection/keybindings';
import type { SelectionAction } from '../selection/selection';
import {
  breadcrumbSegments,
  Pane,
  type PaneAttrs,
  type PaneTab,
  searchBreadcrumbSegments,
} from './pane';

let root: HTMLElement;

const entries: readonly EntrySummary[] = [
  {
    id: 'one' as EntryId,
    location: { providerId: 'file', uri: 'file:///home/erik/one.txt' },
    name: 'one.txt',
    kind: 'file',
    size: 1_024,
    hidden: false,
    readOnly: false,
    metadataRevision: 1,
  },
  {
    id: 'two' as EntryId,
    location: { providerId: 'file', uri: 'file:///home/erik/two.txt' },
    name: 'two.txt',
    kind: 'file',
    size: 2_048,
    hidden: false,
    readOnly: false,
    metadataRevision: 1,
  },
];

const keybindingActions = [
  { id: 'core.rename', title: 'Rename', defaultShortcuts: [{ key: 'F2' }] },
  {
    id: 'core.focusLocation',
    title: 'Focus location',
    defaultShortcuts: [{ key: 'L', ctrl: true }],
  },
  { id: 'core.open', title: 'Open', defaultShortcuts: [{ key: 'ENTER' }] },
  { id: 'core.parent', title: 'Parent directory', defaultShortcuts: [{ key: 'BACKSPACE' }] },
  { id: 'core.moveCursorDown', title: 'Move down', defaultShortcuts: [{ key: 'ARROWDOWN' }] },
  { id: 'core.moveCursorUp', title: 'Move up', defaultShortcuts: [{ key: 'ARROWUP' }] },
  { id: 'core.moveCursorPageDown', title: 'Page down', defaultShortcuts: [{ key: 'PAGEDOWN' }] },
  { id: 'core.moveCursorPageUp', title: 'Page up', defaultShortcuts: [{ key: 'PAGEUP' }] },
  { id: 'core.moveCursorFirst', title: 'First', defaultShortcuts: [{ key: 'HOME' }] },
  { id: 'core.moveCursorLast', title: 'Last', defaultShortcuts: [{ key: 'END' }] },
  {
    id: 'core.extendSelectionDown',
    title: 'Extend down',
    defaultShortcuts: [{ key: 'ARROWDOWN', shift: true }],
  },
  {
    id: 'core.extendSelectionUp',
    title: 'Extend up',
    defaultShortcuts: [{ key: 'ARROWUP', shift: true }],
  },
  { id: 'core.toggleSelection', title: 'Toggle selection', defaultShortcuts: [{ key: ' ' }] },
  { id: 'core.selectAll', title: 'Select all', defaultShortcuts: [{ key: 'A', ctrl: true }] },
  {
    id: 'core.invertSelection',
    title: 'Invert',
    defaultShortcuts: [{ key: '*' }, { key: '*', shift: true }],
  },
  {
    id: 'core.selectByMask',
    title: 'Select by mask',
    defaultShortcuts: [{ key: '+' }, { key: '+', shift: true }],
  },
  { id: 'core.deselectByMask', title: 'Deselect by mask', defaultShortcuts: [{ key: '-' }] },
  {
    id: 'core.toggleSelectionAndAdvance',
    title: 'Toggle selection and advance',
    defaultShortcuts: [{ key: 'INSERT' }],
  },
  {
    id: 'core.restoreSelection',
    title: 'Restore previous selection',
    defaultShortcuts: [{ key: '/' }],
  },
].map(
  (action): ActionDescriptor => ({
    category: 'test',
    contextRequirements: {},
    source: { kind: 'core' },
    ...action,
  }),
);

const defaultTabs: readonly PaneTab[] = [
  { id: 'tab-1' as TabId, title: 'erik', path: '/home/erik' },
];

function sampleConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'connection-1',
    name: 'Home Server',
    kind: 'ssh',
    configuration: {
      kind: 'ssh',
      host: 'example.test',
      port: 22,
      username: 'erik',
      startPath: null,
      authentication: 'password',
      hostKeyPolicy: 'promptOnFirstUse',
      keepaliveSeconds: null,
    },
    hasCredential: true,
    status: 'disconnected',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Flat input shape accepted by the test factory — mirrors the old flat PaneAttrs API. */
type FlatAttrsInput = Partial<{
  // Location
  path: string;
  locationUri: string;
  tabTitle: string;
  searchQuery: string;
  // Tabs
  tabs: readonly PaneTab[];
  activeTabId: TabId;
  onSelectTab: (tabId: TabId) => void;
  onCloseTab: (tabId: TabId) => void;
  onNewTab: () => void;
  onReorderTabs: (order: readonly TabId[]) => void;
  onTabDragOver: (tabId: TabId, event: DragEvent) => boolean;
  onTabDrop: (tabId: TabId, event: DragEvent) => void;
  // Favourites props (flat for test convenience)
  location: Location;
  favouriteLocations: readonly FavouriteLocation[];
  recentLocations: readonly Location[];
  systemLocations: readonly SystemLocation[];
  systemLocationsError: string;
  onRetrySystemLocations: () => void | Promise<void>;
  connections: readonly Connection[];
  onManageConnections: () => void;
  onRefreshConnections: () => void | Promise<void>;
  unavailableLocations: ReadonlySet<string>;
  onNavigateLocation: (location: Location) => void | Promise<void>;
  onAddFavourite: (label: string, location: Location) => void | Promise<void>;
  onDeleteFavourite: (location: Location) => void | Promise<void>;
  onReorderFavourites: (from: number, to: number) => void | Promise<void>;
  // Table config props
  sortLabel: string;
  sort: readonly SortDescriptor[];
  formatSettings: EntryFormatSettings;
  pluginColumns: readonly DirectoryColumnDescriptor[];
  nativeIconLoader: NativeIconLoader;
  // Directory summary props
  hasMore: boolean;
  totalEntryCount: number;
  totalKnownEntries: number;
  totalKnownSize: number;
  totalKnownFileCount: number;
  volumeCapacity: VolumeCapacity;
  hiddenSelectedCount: number;
  // Filter props
  filterOpen: boolean;
  filterQuery: string;
  onFilterQueryChange: (query: string) => void;
  onFilterCommit: () => void;
  onFilterClose: () => void;
  // Navigation props
  onNavigate: (path: string) => void | Promise<void>;
  onBack: () => void | Promise<void>;
  onForward: () => void | Promise<void>;
  onParent: () => void | Promise<void>;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  // Directory data
  state: LoadingState;
  entries: readonly EntrySummary[];
  selectedEntryIds: ReadonlySet<EntryId>;
  cutEntryIds: ReadonlySet<EntryId>;
  active: boolean;
  cursorIndex: number;
  platform: SelectionPlatform;
  keybindingRuntime: KeybindingRuntime;
  actions: readonly ActionDescriptor[];
  keybindingOverrides: Readonly<Record<string, string>>;
  // Operations
  onOpenEntry: (entry: EntrySummary) => void | Promise<void>;
  onSelectionAction: (action: SelectionAction) => void;
  onRetry: () => void | Promise<void>;
  onLoadNextPage: () => void | Promise<void>;
  onSortChange: (sort: readonly SortDescriptor[]) => void;
  onRename: (entry: EntrySummary, name: string) => void | Promise<void>;
  onMultiRename: (entries: readonly EntrySummary[]) => void;
  onContextMenu: (entries: readonly EntrySummary[], x: number, y: number) => void;
  onDragStart: (entries: readonly EntrySummary[], event: DragEvent) => void;
  onDragOver: (entry: EntrySummary | undefined, event: DragEvent) => boolean;
  onDrop: (entry: EntrySummary | undefined, event: DragEvent) => void;
  viewerContent: m.Children;
}>;

/** Builds a PaneAttrs from a flat legacy-style input, keeping test call sites unchanged. */
function attrs(input: FlatAttrsInput = {}): PaneAttrs {
  return {
    path: input.path ?? '/home/erik',
    ...(input.locationUri === undefined ? {} : { locationUri: input.locationUri }),
    tabTitle: input.tabTitle ?? 'erik',
    ...(input.searchQuery === undefined ? {} : { searchQuery: input.searchQuery }),
    tabs: input.tabs ?? defaultTabs,
    activeTabId: input.activeTabId ?? ('tab-1' as TabId),
    onSelectTab: input.onSelectTab ?? vi.fn(),
    onCloseTab: input.onCloseTab ?? vi.fn(),
    onNewTab: input.onNewTab ?? vi.fn(),
    onReorderTabs: input.onReorderTabs ?? vi.fn(),
    ...(input.onTabDragOver === undefined ? {} : { onTabDragOver: input.onTabDragOver }),
    ...(input.onTabDrop === undefined ? {} : { onTabDrop: input.onTabDrop }),
    favourites: {
      location: input.location,
      favouriteLocations: input.favouriteLocations,
      recentLocations: input.recentLocations,
      systemLocations: input.systemLocations,
      systemLocationsError: input.systemLocationsError,
      onRetrySystemLocations: input.onRetrySystemLocations,
      connections: input.connections,
      onManageConnections: input.onManageConnections,
      onRefreshConnections: input.onRefreshConnections,
      unavailableLocations: input.unavailableLocations,
      onNavigateLocation: input.onNavigateLocation,
      onAddFavourite: input.onAddFavourite,
      onDeleteFavourite: input.onDeleteFavourite,
      onReorderFavourites: input.onReorderFavourites,
    },
    tableConfig: {
      sortLabel: input.sortLabel ?? 'Name ascending',
      sort: input.sort ?? [{ columnId: 'core.name', direction: 'ascending' }],
      formatSettings: input.formatSettings,
      pluginColumns: input.pluginColumns,
      nativeIconLoader: input.nativeIconLoader,
    },
    directorySummary: {
      hasMore: input.hasMore,
      totalEntryCount: input.totalEntryCount ?? entries.length,
      totalKnownEntries: input.totalKnownEntries,
      totalKnownSize: input.totalKnownSize,
      totalKnownFileCount: input.totalKnownFileCount,
      volumeCapacity: input.volumeCapacity,
      hiddenSelectedCount: input.hiddenSelectedCount ?? 0,
    },
    filter: {
      filterOpen: input.filterOpen ?? false,
      filterQuery: input.filterQuery ?? '',
      onFilterQueryChange: input.onFilterQueryChange ?? vi.fn(),
      onFilterCommit: input.onFilterCommit ?? vi.fn(),
      onFilterClose: input.onFilterClose ?? vi.fn(),
    },
    navigation: {
      onNavigate: input.onNavigate ?? vi.fn(),
      onBack: input.onBack ?? vi.fn(),
      onForward: input.onForward ?? vi.fn(),
      onParent: input.onParent ?? vi.fn(),
      canNavigateBack: input.canNavigateBack ?? true,
      canNavigateForward: input.canNavigateForward ?? true,
    },
    state: input.state ?? { type: 'loaded' },
    entries: input.entries ?? entries,
    selectedEntryIds: input.selectedEntryIds ?? new Set<EntryId>(),
    cutEntryIds: input.cutEntryIds ?? new Set<EntryId>(),
    active: input.active ?? true,
    ...(input.cursorIndex === undefined ? {} : { cursorIndex: input.cursorIndex }),
    platform: input.platform ?? 'linux',
    keybindingRuntime: input.keybindingRuntime ?? 'desktop',
    actions: input.actions ?? keybindingActions,
    keybindingOverrides: input.keybindingOverrides ?? {},
    onOpenEntry: input.onOpenEntry ?? vi.fn(),
    onSelectionAction: input.onSelectionAction ?? vi.fn(),
    onRetry: input.onRetry ?? vi.fn(),
    onLoadNextPage: input.onLoadNextPage ?? vi.fn(),
    onSortChange: input.onSortChange ?? vi.fn(),
    onRename: input.onRename ?? vi.fn(),
    ...(input.onMultiRename === undefined ? {} : { onMultiRename: input.onMultiRename }),
    onContextMenu: input.onContextMenu ?? vi.fn(),
    ...(input.onDragStart === undefined ? {} : { onDragStart: input.onDragStart }),
    ...(input.onDragOver === undefined ? {} : { onDragOver: input.onDragOver }),
    ...(input.onDrop === undefined ? {} : { onDrop: input.onDrop }),
    ...(input.viewerContent === undefined ? {} : { viewerContent: input.viewerContent }),
  };
}

describe('Pane inline rename', () => {
  it('starts with F2, preselects the basename, validates, cancels, and commits with Enter', () => {
    const onRename = vi.fn();
    mount(attrs({ cursorIndex: 0, selectedEntryIds: new Set(['one' as EntryId]), onRename }));
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    m.redraw.sync();
    let input = root.querySelector<HTMLInputElement>('.fm-inline-rename-input');
    expect(input?.value).toBe('one.txt');
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe(3);

    if (input === null) throw new Error('rename input missing');
    input.value = '../bad';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('single');
    expect(onRename).not.toHaveBeenCalled();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('.fm-inline-rename-input')).toBeNull();

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    m.redraw.sync();
    input = root.querySelector<HTMLInputElement>('.fm-inline-rename-input');
    if (input === null) throw new Error('rename input missing');
    input.value = 'renamed.txt';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onRename).toHaveBeenCalledWith(entries[0], 'renamed.txt');
  });

  it('opens the multi-rename dialog instead of inline rename when F2 is pressed with more than one entry selected', () => {
    const onRename = vi.fn();
    const onMultiRename = vi.fn();
    mount(
      attrs({
        cursorIndex: 0,
        selectedEntryIds: new Set(['one' as EntryId, 'two' as EntryId]),
        onRename,
        onMultiRename,
      }),
    );
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    m.redraw.sync();

    expect(onMultiRename).toHaveBeenCalledWith([entries[0], entries[1]]);
    expect(onRename).not.toHaveBeenCalled();
    expect(root.querySelector('.fm-inline-rename-input')).toBeNull();
  });
});

function mount(paneAttrs: PaneAttrs): void {
  m.mount(root, { view: () => m(Pane, paneAttrs) });
}

/** Mounts with `rerender(nextAttrs)` support, keeping the same `Pane` instance across updates. */
function mountUpdating(initial: PaneAttrs): (next: PaneAttrs) => void {
  let current = initial;
  m.mount(root, { view: () => m(Pane, current) });
  return (next) => {
    current = next;
    m.redraw.sync();
  };
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  m.mount(root, null);
  root.remove();
});

describe('breadcrumbSegments', () => {
  it('represents a POSIX root as one clickable segment', () => {
    expect(breadcrumbSegments('/')).toEqual([{ label: '/', path: '/' }]);
  });

  it('builds cumulative paths for POSIX segments', () => {
    expect(breadcrumbSegments('/home/erik/My Files')).toEqual([
      { label: '/', path: '/' },
      { label: 'home', path: '/home' },
      { label: 'erik', path: '/home/erik' },
      { label: 'My Files', path: '/home/erik/My Files' },
    ]);
  });

  it('preserves the UNC server and share root', () => {
    expect(breadcrumbSegments('\\\\server\\share\\Projects')).toEqual([
      { label: '\\\\server\\share', path: '\\\\server\\share' },
      { label: 'Projects', path: '\\\\server\\share\\Projects' },
    ]);
  });

  it('uses home and drive roots as breadcrumb targets', () => {
    expect(breadcrumbSegments('~/My Files')).toEqual([
      { label: '~', path: '~' },
      { label: 'My Files', path: '~/My Files' },
    ]);
    expect(breadcrumbSegments('C:\\Users\\Erik')).toEqual([
      { label: 'C:', path: 'C:\\' },
      { label: 'Users', path: 'C:\\Users' },
      { label: 'Erik', path: 'C:\\Users\\Erik' },
    ]);
  });
});

describe('searchBreadcrumbSegments', () => {
  it('shows the originating query in place of the opaque search id', () => {
    expect(searchBreadcrumbSegments('search://local/abc-123', '*.svg')).toEqual([
      { label: '/', path: '/' },
      { label: 'search', path: 'search' },
      { label: 'local', path: 'local' },
      { label: '*.svg', path: '*.svg' },
    ]);
  });

  it('falls back to the raw search id when the query is not known', () => {
    expect(searchBreadcrumbSegments('search://local/abc-123', undefined)).toEqual([
      { label: '/', path: '/' },
      { label: 'search', path: 'search' },
      { label: 'local', path: 'local' },
      { label: 'abc-123', path: 'abc-123' },
    ]);
  });
});

describe('Pane search breadcrumb rendering', () => {
  it('renders search:// breadcrumbs as non-clickable spans instead of navigable buttons', () => {
    mount(
      attrs({
        path: 'search://local/abc-123',
        searchQuery: '*.svg',
        tabs: [{ id: 'tab-1' as TabId, title: 'search: *.svg', path: 'search://local/abc-123' }],
      }),
    );

    const segments = [...root.querySelectorAll<HTMLElement>('.fm-breadcrumb-segment')];
    expect(segments.map((segment) => segment.tagName)).toEqual(['SPAN', 'SPAN', 'SPAN', 'SPAN']);
    expect(segments.map((segment) => segment.textContent)).toEqual([
      '/',
      'search',
      'local',
      '*.svg',
    ]);

    segments[3]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('.fm-path-input')).toBeNull();
  });
});

describe('Pane SFTP breadcrumb rendering', () => {
  it('shows an sftp:// prefix while keeping only remote path segments in the breadcrumb', () => {
    mount(
      attrs({
        path: '/home/erik',
        locationUri: 'sftp://11111111-1111-4111-8111-111111111111/home/erik',
      }),
    );

    expect(root.querySelector('.fm-breadcrumb-scheme')?.textContent).toBe('sftp://');
    expect(
      [...root.querySelectorAll<HTMLElement>('.fm-breadcrumb-segment')].map(
        (segment) => segment.textContent,
      ),
    ).toEqual(['home', 'erik']);
  });

  it('keeps the root segment when the displayed SFTP path is exactly /', () => {
    mount(
      attrs({
        path: '/',
        locationUri: 'sftp://11111111-1111-4111-8111-111111111111/',
      }),
    );

    expect(
      [...root.querySelectorAll<HTMLElement>('.fm-breadcrumb-segment')].map(
        (segment) => segment.textContent,
      ),
    ).toEqual(['/']);
  });
});

describe('Pane breadcrumb editing', () => {
  it('enters edit mode on breadcrumb double-click and cancels with Escape', () => {
    mount(attrs());

    root
      .querySelector<HTMLElement>('.fm-breadcrumb-segments')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector<HTMLInputElement>('.fm-path-input')?.value).toBe('/home/erik');

    root
      .querySelector<HTMLInputElement>('.fm-path-input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('.fm-path-input')).toBeNull();
    expect(root.querySelectorAll('.fm-breadcrumb-segment')).toHaveLength(3);
  });

  it('enters edit mode with Ctrl+L and submits paths containing spaces', async () => {
    const onNavigate = vi.fn();
    mount(attrs({ onNavigate }));

    root
      .querySelector<HTMLElement>('.fm-pane')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true }));
    m.redraw.sync();
    const input = root.querySelector<HTMLInputElement>('.fm-path-input');
    expect(input).not.toBeNull();
    if (input === null) return;
    input.value = '~/My Files';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => expect(onNavigate).toHaveBeenCalledWith('~/My Files'));
    await vi.waitFor(() => expect(root.querySelector('.fm-path-input')).toBeNull());
  });

  it('navigates to a clicked breadcrumb target', async () => {
    const onNavigate = vi.fn();
    mount(attrs({ onNavigate }));

    root.querySelectorAll<HTMLButtonElement>('.fm-breadcrumb-segment')[1]?.click();

    await vi.waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/home'));
  });

  it('shows rejected paths inline without replacing the current directory', async () => {
    mount(attrs({ onNavigate: () => Promise.reject(new Error('Path does not exist')) }));

    root
      .querySelector<HTMLElement>('.fm-breadcrumb-segments')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    m.redraw.sync();
    const input = root.querySelector<HTMLInputElement>('.fm-path-input');
    if (input === null) return;
    input.value = '/missing path';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() =>
      expect(root.querySelector('.fm-path-error')?.textContent).toBe('Path does not exist'),
    );
    expect(root.textContent).toContain('one.txt');
  });

  it('places a mithril-materialized Tabler heart IconButton beside the new-tab button', () => {
    mount(attrs());

    expect(root.querySelector('.fm-breadcrumb-edit-target')).toBeNull();
    expect(root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.ariaLabel).toBe(
      'Favourites',
    );
    expect(root.querySelector('.fm-pane-tab-favourites')?.classList.contains('btn-icon')).toBe(
      true,
    );
    expect(
      root
        .querySelector('.fm-pane-tab-new')
        ?.closest('.fm-tooltip')
        ?.nextElementSibling?.querySelector('.fm-pane-tab-favourites'),
    ).not.toBeNull();
    expect(root.querySelector('.fm-icon-heart')).not.toBeNull();
  });

  it('shows heart-plus when the current folder can be added', () => {
    mount(
      attrs({
        location: { providerId: 'local', uri: 'file:///home/erik/Projects' },
        onAddFavourite: vi.fn(),
      }),
    );

    expect(root.querySelector('.fm-icon-heart-plus')).not.toBeNull();
    expect(root.querySelector('.fm-icon-heart')).toBeNull();
  });

  it('does not offer to add a discovered cloud location', () => {
    const location = { providerId: 'local' as const, uri: 'file:///home/erik/OneDrive' };
    const onAddFavourite = vi.fn();
    mount(
      attrs({
        location,
        onAddFavourite,
        systemLocations: [{ name: 'OneDrive', kind: 'cloud', location }],
      }),
    );

    expect(root.querySelector('.fm-icon-heart')).not.toBeNull();
    expect(root.querySelector('.fm-icon-heart-plus')).toBeNull();
    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();
    expect(root.querySelector('.fm-favourites-add')).toBeNull();
    expect(onAddFavourite).not.toHaveBeenCalled();
  });

  it('does not offer to add an existing favourite again', () => {
    const location = { providerId: 'local' as const, uri: 'file:///home/erik/Projects' };
    mount(
      attrs({
        location,
        onAddFavourite: vi.fn(),
        favouriteLocations: [{ label: 'Projects', location }],
      }),
    );

    expect(root.querySelector('.fm-icon-heart')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();
    expect(root.querySelector('.fm-favourites-add')).toBeNull();
  });

  it('opens the favourites menu and navigates to a selected favourite', async () => {
    const location = { providerId: 'local' as const, uri: 'file:///home/erik/Projects' };
    const onNavigateLocation = vi.fn();
    mount(
      attrs({
        location,
        favouriteLocations: [{ label: 'Projects', location }],
        onNavigateLocation,
      }),
    );

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();
    expect(root.querySelector('[role="menu"]')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click();
    await vi.waitFor(() => expect(onNavigateLocation).toHaveBeenCalledWith(location));
  });

  it('prefills the add-favourite name with the current folder name', () => {
    mount(
      attrs({
        path: '/home/erik/Projects',
        location: { providerId: 'local', uri: 'file:///home/erik/Projects' },
        onAddFavourite: vi.fn(),
      }),
    );

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();

    expect(root.querySelector<HTMLInputElement>('[aria-label="Favourite name"]')?.value).toBe(
      'Projects',
    );
  });

  it('adds the current location when the plus IconButton is clicked', () => {
    const location = { providerId: 'local' as const, uri: 'file:///home/erik/Projects' };
    const onAddFavourite = vi.fn();
    mount(attrs({ path: '/home/erik/Projects', location, onAddFavourite }));

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();
    root.querySelector<HTMLButtonElement>('.fm-favourites-add-button')?.click();

    expect(onAddFavourite).toHaveBeenCalledWith('Projects', location);
  });

  it('marks unavailable favourites and allows retrying them', async () => {
    const location = { providerId: 'local' as const, uri: 'file:///gone' };
    const onNavigateLocation = vi.fn();
    mount(
      attrs({
        favouriteLocations: [{ label: 'Gone', location }],
        unavailableLocations: new Set(['local:file:///gone']),
        onNavigateLocation,
      }),
    );

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();

    const favourite = root.querySelector<HTMLButtonElement>('[role="menuitem"]');
    expect(favourite?.disabled).toBe(false);
    expect(favourite?.textContent).toContain('unavailable');
    favourite?.click();
    await vi.waitFor(() => expect(onNavigateLocation).toHaveBeenCalledWith(location));
  });

  it('opens with Ctrl+D and closes with Ctrl+D again', () => {
    mount(attrs());
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('[role="menu"]')).not.toBeNull();

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('[role="menu"]')).toBeNull();
  });

  it('focuses the first favourite so Enter navigates immediately, and Down arrow reaches recents', async () => {
    const location = { providerId: 'local' as const, uri: 'file:///home/erik/Projects' };
    const recent = { providerId: 'local' as const, uri: 'file:///home/erik/Recent' };
    const onNavigateLocation = vi.fn();
    mount(
      attrs({
        location,
        favouriteLocations: [{ label: 'Projects', location }],
        recentLocations: [recent],
        onNavigateLocation,
      }),
    );

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();

    const menuItems = root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    expect(document.activeElement).toBe(menuItems[0]);

    menuItems[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(menuItems[1]);

    document.activeElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(onNavigateLocation).toHaveBeenCalledWith(recent));
  });

  it('closes the favourites menu on Escape and on an outside click', () => {
    mount(attrs({ favouriteLocations: [] }));

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();
    expect(root.querySelector('.fm-favourites-menu')).not.toBeNull();

    root
      .querySelector('.fm-favourites-menu')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('.fm-favourites-menu')).toBeNull();

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();
    expect(root.querySelector('.fm-favourites-menu')).not.toBeNull();

    root
      .querySelector<HTMLElement>('.fm-favourites-menu-backdrop')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('.fm-favourites-menu')).toBeNull();
  });

  it('truncates long recent-location paths from the middle, keeping the scheme and trailing segment', () => {
    const longUri = `file:///Users/erik/dev/${'sub/'.repeat(20)}project`;
    mount(attrs({ recentLocations: [{ providerId: 'local', uri: longUri }] }));

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();

    const recentButton = root.querySelector<HTMLButtonElement>(
      '.fm-favourites-recents [role="menuitem"]',
    );
    expect(recentButton?.textContent).not.toBe(longUri);
    expect(recentButton?.textContent?.startsWith('file://')).toBe(true);
    expect(recentButton?.textContent?.endsWith('project')).toBe(true);
    expect(recentButton?.title).toBe(longUri);
  });
});

describe('Pane status bar', () => {
  it('renders the directory status without a separate cursor-metadata row', () => {
    mount(attrs());

    expect(root.querySelector('.fm-pane-status')).not.toBeNull();
    expect(root.querySelector('.fm-entry-metadata')).toBeNull();
  });

  it('shows entry, selection, selected-size and sort counters', () => {
    mount(attrs({ selectedEntryIds: new Set<EntryId>(['one' as EntryId]) }));

    const status = root.querySelector('.fm-pane-status')?.textContent;
    expect(status).toContain('3 KB in 2 files');
    expect(status).toContain('1 KB in 1 selected');
  });

  it('marks active and inactive panes for selection styling', () => {
    mount(attrs({ active: false, selectedEntryIds: new Set<EntryId>(['one' as EntryId]) }));

    expect(root.querySelector('.fm-pane')?.getAttribute('data-active')).toBe('false');
    expect(root.querySelector('.fm-selected-row')).not.toBeNull();
  });

  it('appends a Marta/Finder-style available-capacity segment when the backend reports one', () => {
    mount(
      attrs({
        volumeCapacity: { totalBytes: 2_053_470_000_000, availableBytes: 616_040_000_000 },
      }),
    );

    const capacity = root.querySelector('.fm-pane-volume-capacity');
    expect(capacity).not.toBeNull();
    expect(capacity?.textContent).toBe('573.7 GB (30%) available');
  });

  it('omits the available-capacity segment (not a broken placeholder) when unsupported', () => {
    mount(attrs());

    expect(root.querySelector('.fm-pane-volume-capacity')).toBeNull();
  });
});

describe('Pane quick filter', () => {
  it('renders the inline filter box only when open, focused and controlled', () => {
    mount(attrs({ filterOpen: false }));
    expect(root.querySelector('.fm-quick-filter-input')).toBeNull();

    mount(attrs({ filterOpen: true, filterQuery: 'one' }));
    const input = root.querySelector<HTMLInputElement>('.fm-quick-filter-input');
    expect(input?.value).toBe('one');
    expect(document.activeElement).toBe(input);
  });

  it('reports typed input, commit and close through the matching callbacks', () => {
    const onFilterQueryChange = vi.fn();
    const onFilterCommit = vi.fn();
    const onFilterClose = vi.fn();
    mount(
      attrs({
        filterOpen: true,
        onFilterQueryChange,
        onFilterCommit,
        onFilterClose,
      }),
    );
    const input = root.querySelector<HTMLInputElement>('.fm-quick-filter-input');
    if (input === null) throw new Error('quick filter input missing');

    input.value = 'on';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(onFilterQueryChange).toHaveBeenCalledWith('on');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onFilterCommit).toHaveBeenCalledOnce();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onFilterClose).toHaveBeenCalledOnce();

    input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(onFilterCommit).toHaveBeenCalledTimes(2);
  });

  it('shows "N of M shown", the paging note, and reverts to the plain count when cleared', () => {
    mount(
      attrs({
        filterOpen: true,
        filterQuery: 'one',
        entries: [entries[0] as EntrySummary],
        totalEntryCount: 2,
        hasMore: true,
      }),
    );
    expect(root.querySelector('.fm-pane-status')?.textContent).toContain(
      '1 KB in 1 file (1 of 2 shown, more available)',
    );

    mount(attrs({ filterOpen: false, filterQuery: '' }));
    expect(root.querySelector('.fm-pane-status')?.textContent).toContain('3 KB in 2 files');
  });

  it('never exposes pagination progress in the status bar, even while more pages remain unfiltered', () => {
    mount(attrs({ filterQuery: '', totalKnownEntries: 459 }));
    const status = root.querySelector('.fm-pane-status')?.textContent;
    expect(status).toContain('3 KB in 2 files');
    expect(status).not.toContain('loaded');

    mount(attrs({ filterQuery: '', totalKnownEntries: 2 }));
    expect(root.querySelector('.fm-pane-status')?.textContent).toContain('3 KB in 2 files');
  });

  it('prefers the backend-reported directory totals over the loaded-so-far count when unfiltered', () => {
    // Regression test: only two of a real 468-entry directory's pages have loaded so far, but
    // the backend already knows the true totals from the first response — the status bar must
    // show those, not just an aggregate of the entries paged in so far.
    mount(
      attrs({
        filterQuery: '',
        totalKnownEntries: 468,
        totalKnownSize: 8_160_437_760,
        totalKnownFileCount: 445,
      }),
    );
    const status = root.querySelector('.fm-pane-status')?.textContent;
    expect(status).toContain('7.6 GB in 445 files, and 23 folders');
    expect(status).not.toContain('3 KB in 2 files');
  });

  it('falls back to the loaded-so-far aggregate while filtering, even with backend totals known', () => {
    mount(
      attrs({
        filterOpen: true,
        filterQuery: 'one',
        entries: [entries[0] as EntrySummary],
        totalEntryCount: 2,
        totalKnownEntries: 468,
        totalKnownSize: 8_160_437_760,
        totalKnownFileCount: 445,
      }),
    );
    expect(root.querySelector('.fm-pane-status')?.textContent).toContain(
      '1 KB in 1 file (1 of 2 shown)',
    );
  });

  it('reports hidden-but-selected entries alongside the plain selected count', () => {
    mount(
      attrs({
        selectedEntryIds: new Set<EntryId>(['one', 'two'] as EntryId[]),
        hiddenSelectedCount: 1,
      }),
    );
    expect(root.querySelector('.fm-pane-status')?.textContent).toContain(
      '3 KB in 2 selected (1 hidden by filter)',
    );

    mount(attrs({ selectedEntryIds: new Set<EntryId>(['one'] as EntryId[]) }));
    const status = root.querySelector('.fm-pane-status')?.textContent;
    expect(status).toContain('1 KB in 1 selected');
    expect(status).not.toContain('hidden by filter');
  });
});

describe('Pane navigation input', () => {
  it('emits cursor, page and edge movement actions', () => {
    const onSelectionAction = vi.fn();
    mount(attrs({ cursorIndex: 0, onSelectionAction }));
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));

    expect(onSelectionAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'moveCursor', offset: 1 },
      { type: 'moveCursor', offset: -1 },
      { type: 'moveCursor', offset: 10 },
      { type: 'moveCursor', offset: -10 },
      { type: 'moveCursorTo', edge: 'first' },
      { type: 'moveCursorTo', edge: 'last' },
    ]);
  });

  it('emits range, toggle and platform select-all actions', () => {
    const onSelectionAction = vi.fn();
    mount(attrs({ cursorIndex: 0, platform: 'macos', onSelectionAction }));
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }),
    );
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));

    expect(onSelectionAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'extendRange', offset: 1 },
      { type: 'toggle', entryId: 'one' },
      { type: 'selectAll' },
    ]);
  });

  it('dispatches invert for numpad star and its Shift+8 fallback', () => {
    const onSelectionAction = vi.fn();
    mount(attrs({ onSelectionAction }));
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(
      new KeyboardEvent('keydown', { key: '*', code: 'NumpadMultiply', bubbles: true }),
    );
    pane?.dispatchEvent(
      new KeyboardEvent('keydown', { key: '*', code: 'Digit8', shiftKey: true, bubbles: true }),
    );

    expect(onSelectionAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'invert' },
      { type: 'invert' },
    ]);
  });

  it('Insert toggles the cursor entry and advances the cursor', () => {
    const onSelectionAction = vi.fn();
    mount(attrs({ cursorIndex: 0, onSelectionAction }));
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Insert', bubbles: true }));

    expect(onSelectionAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'toggle', entryId: 'one' },
      { type: 'moveCursor', offset: 1 },
    ]);
  });

  it('Numpad / restores the selection as it was before the current keystroke', () => {
    const onSelectionAction = vi.fn();
    mount(
      attrs({
        cursorIndex: 0,
        selectedEntryIds: new Set<EntryId>(['one', 'two'] as EntryId[]),
        onSelectionAction,
      }),
    );
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));

    expect(onSelectionAction).toHaveBeenCalledWith({
      type: 'restore',
      entryIds: ['one', 'two'],
    });
  });

  it('prompts for a mask and dispatches visible matching entry ids', () => {
    const prompt = vi
      .spyOn(window, 'prompt')
      .mockReturnValueOnce('*.txt')
      .mockReturnValueOnce('two.*');
    const onSelectionAction = vi.fn();
    mount(attrs({ onSelectionAction }));
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(
      new KeyboardEvent('keydown', { key: '+', code: 'NumpadAdd', bubbles: true }),
    );
    pane?.dispatchEvent(
      new KeyboardEvent('keydown', { key: '-', code: 'NumpadSubtract', bubbles: true }),
    );

    expect(prompt).toHaveBeenNthCalledWith(1, 'Select files matching mask', '*.*');
    expect(prompt).toHaveBeenNthCalledWith(2, 'Deselect files matching mask', '*.*');
    expect(onSelectionAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'selectByMask', matchingEntryIds: ['one', 'two'] },
      { type: 'deselectByMask', matchingEntryIds: ['two'] },
    ]);
  });

  it('selects clicked rows and type-selects the first in-word match', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const onSelectionAction = vi.fn();
    mount(attrs({ cursorIndex: 0, onSelectionAction }));

    root.querySelectorAll<HTMLElement>('.fm-directory-row')[1]?.click();
    root
      .querySelector<HTMLElement>('.fm-pane')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));

    expect(onSelectionAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'selectOnly', entryId: 'two' },
      { type: 'selectOnly', entryId: 'one' },
    ]);
    vi.useRealTimers();
  });

  it('opens a double-clicked row', () => {
    const onOpenEntry = vi.fn();
    mount(attrs({ onOpenEntry }));

    root
      .querySelector<HTMLElement>('.fm-directory-row')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(onOpenEntry).toHaveBeenCalledWith(entries[0]);
  });

  it('extends the selection range on a shift-click and toggles on a ctrl-click', () => {
    const onSelectionAction = vi.fn();
    mount(attrs({ cursorIndex: 0, onSelectionAction }));

    root
      .querySelectorAll<HTMLElement>('.fm-directory-row')[1]
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    root
      .querySelectorAll<HTMLElement>('.fm-directory-row')[0]
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));

    expect(onSelectionAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'extendRangeTo', entryId: 'two' },
      { type: 'toggle', entryId: 'one' },
    ]);
  });

  it('keeps and highlights a matching typeahead prefix until explicitly cleared', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    mount(
      attrs({
        entries: [
          ...entries,
          {
            ...(entries[0] as EntrySummary),
            id: 'document',
            name: 'document.txt',
          },
        ],
      }),
    );
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    for (const typed of 'docu') {
      pane?.dispatchEvent(new KeyboardEvent('keydown', { key: typed, bubbles: true }));
    }
    m.redraw.sync();

    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('docu');
    expect(root.querySelector('.fm-typeahead-match')?.textContent).toBe('docu');

    vi.advanceTimersByTime(5_000);
    m.redraw.sync();
    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('docu');
    expect(root.querySelector('.fm-typeahead-match')?.textContent).toBe('docu');
    vi.useRealTimers();
  });

  it('briefly marks an unmatched prefix as an error, then keeps it editable', () => {
    vi.useFakeTimers();
    mount(
      attrs({
        entries: [{ ...(entries[0] as EntrySummary), id: 'document', name: 'document.txt' }],
      }),
    );
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    for (const typed of 'dox') {
      pane?.dispatchEvent(new KeyboardEvent('keydown', { key: typed, bubbles: true }));
    }
    m.redraw.sync();

    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('dox');
    expect(root.querySelector('.fm-typeahead-status')?.classList).toContain(
      'fm-typeahead-status-error',
    );

    vi.runAllTimers();
    m.redraw.sync();
    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('dox');
    expect(root.querySelector('.fm-typeahead-status')?.classList).not.toContain(
      'fm-typeahead-status-error',
    );

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('do');
    expect(root.querySelector('.fm-typeahead-match')?.textContent).toBe('do');
    vi.useRealTimers();
  });

  it('uses Backspace to edit typeahead before navigating to the parent', () => {
    const onParent = vi.fn();
    mount(
      attrs({
        onParent,
        entries: [{ ...(entries[0] as EntrySummary), id: 'document', name: 'document.txt' }],
      }),
    );
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    for (const typed of 'doc') {
      pane?.dispatchEvent(new KeyboardEvent('keydown', { key: typed, bubbles: true }));
    }
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    m.redraw.sync();

    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('do');
    expect(onParent).not.toHaveBeenCalled();
  });

  it('resets typeahead once the pane navigates to a different directory', () => {
    const rerender = mountUpdating(
      attrs({
        entries: [{ ...(entries[0] as EntrySummary), id: 'document', name: 'document.txt' }],
      }),
    );
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    for (const typed of 'do') {
      pane?.dispatchEvent(new KeyboardEvent('keydown', { key: typed, bubbles: true }));
    }
    m.redraw.sync();
    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('do');

    // Entering "document.txt" (or any other navigation: parent, breadcrumb, back/forward, tab
    // switch) changes the displayed path — the stale prefix from the old directory must not
    // survive into the new one.
    rerender(
      attrs({
        path: '/home/erik/document.txt',
        entries: [{ ...(entries[1] as EntrySummary), id: 'nested', name: 'nested.txt' }],
      }),
    );

    expect(root.querySelector('.fm-typeahead-status')).toBeNull();

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('n');
  });

  it('clears typeahead and the file selection with Escape', () => {
    const onSelectionAction = vi.fn();
    mount(
      attrs({
        selectedEntryIds: new Set(['one']),
        onSelectionAction,
      }),
    );
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    m.redraw.sync();

    expect(root.querySelector('.fm-typeahead-status')).toBeNull();
    expect(onSelectionAction).toHaveBeenLastCalledWith({ type: 'clear' });
  });

  it('limits cursor navigation to entries containing the active text', () => {
    const onSelectionAction = vi.fn();
    mount(
      attrs({
        cursorIndex: 0,
        onSelectionAction,
        entries: [
          { ...(entries[0] as EntrySummary), id: 'document', name: 'document.txt' },
          { ...(entries[0] as EntrySummary), id: 'other', name: 'other.txt' },
          { ...(entries[0] as EntrySummary), id: 'amendment', name: 'amendment.txt' },
        ],
      }),
    );
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    for (const typed of 'men') {
      pane?.dispatchEvent(new KeyboardEvent('keydown', { key: typed, bubbles: true }));
    }
    onSelectionAction.mockClear();
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));

    expect(onSelectionAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'setCursor', entryId: 'amendment' },
      { type: 'setCursor', entryId: 'amendment' },
      { type: 'setCursor', entryId: 'document' },
      { type: 'setCursor', entryId: 'amendment' },
    ]);
  });

  it('opens the directory under the cursor with Enter and navigates parent with Backspace', () => {
    const onOpenEntry = vi.fn();
    const onParent = vi.fn();
    mount(attrs({ cursorIndex: 0, onOpenEntry, onParent }));
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));

    expect(onOpenEntry).toHaveBeenCalledWith(entries[0]);
    expect(onParent).toHaveBeenCalledOnce();
  });

  it('supports history keyboard shortcuts and auxiliary mouse buttons', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    mount(attrs({ onBack, onForward }));
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }),
    );
    pane?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }),
    );
    pane?.dispatchEvent(new MouseEvent('auxclick', { button: 3, bubbles: true }));
    pane?.dispatchEvent(new MouseEvent('auxclick', { button: 4, bubbles: true }));

    expect(onBack).toHaveBeenCalledTimes(2);
    expect(onForward).toHaveBeenCalledTimes(2);
  });
});

describe('Pane tab strip', () => {
  const tabs: readonly PaneTab[] = [
    { id: 'tab-1' as TabId, title: 'erik', path: '/home/erik' },
    { id: 'tab-2' as TabId, title: 'downloads', path: '/home/erik/downloads' },
  ];

  it('renders every tab, marking only the active one selected', () => {
    mount(attrs({ tabs, activeTabId: 'tab-2' as TabId }));

    const tabElements = root.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(tabElements).toHaveLength(2);
    expect(tabElements[0]?.getAttribute('aria-selected')).toBe('false');
    expect(tabElements[1]?.getAttribute('aria-selected')).toBe('true');
    expect(tabElements[0]?.textContent).toContain('erik');
  });

  it('selects a tab on click and creates a new tab from the trailing button', () => {
    const onSelectTab = vi.fn();
    const onNewTab = vi.fn();
    mount(attrs({ tabs, activeTabId: 'tab-1' as TabId, onSelectTab, onNewTab }));

    root.querySelectorAll<HTMLElement>('[role="tab"]')[1]?.click();
    expect(onSelectTab).toHaveBeenCalledWith('tab-2');

    root.querySelector<HTMLElement>('.fm-pane-tab-new')?.click();
    expect(onNewTab).toHaveBeenCalledOnce();
  });

  it('closes a tab from its close button without also selecting it', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    mount(attrs({ tabs, activeTabId: 'tab-1' as TabId, onSelectTab, onCloseTab }));

    root.querySelectorAll<HTMLElement>('.fm-pane-tab-close')[1]?.click();

    expect(onCloseTab).toHaveBeenCalledWith('tab-2');
    expect(onSelectTab).not.toHaveBeenCalled();
  });

  it('reorders tabs by dragging one onto another', () => {
    const onReorderTabs = vi.fn();
    mount(attrs({ tabs, activeTabId: 'tab-1' as TabId, onReorderTabs }));

    const tabElements = root.querySelectorAll<HTMLElement>('[role="tab"]');
    tabElements[1]?.dispatchEvent(new Event('dragstart', { bubbles: true }));
    tabElements[0]?.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    tabElements[0]?.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));

    expect(onReorderTabs).toHaveBeenCalledWith(['tab-2', 'tab-1']);
  });

  it('shows discovered cloud locations and opens them as normal local locations', async () => {
    const onNavigateLocation = vi.fn();
    const location = { providerId: 'local', uri: 'file:///Users/example/Cloud' };
    mount(
      attrs({
        systemLocations: [
          { name: 'Example Drive', kind: 'cloud', location, providerHint: 'example' },
        ],
        onNavigateLocation,
      }),
    );

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();
    expect(root.querySelector('.fm-cloud-locations strong')?.textContent).toBe('Cloud');
    root.querySelector<HTMLButtonElement>('.fm-cloud-locations [role="menuitem"]')?.click();
    await Promise.resolve();

    expect(onNavigateLocation).toHaveBeenCalledWith(location);
  });

  it('renders the favourites close button as an overlay, not a dedicated menu row', () => {
    mount(
      attrs({
        systemLocations: [
          {
            name: 'Example Drive',
            kind: 'cloud',
            location: { providerId: 'local', uri: 'file:///Users/example/Cloud' },
          },
        ],
      }),
    );

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();

    const menu = root.querySelector<HTMLElement>('.fm-favourites-menu');
    const closeButton = root.querySelector<HTMLButtonElement>('.fm-favourites-close');
    expect(menu).not.toBeNull();
    expect(closeButton).not.toBeNull();
    expect(root.querySelector('.fm-favourites-menu-header')).toBeNull();
    expect(closeButton?.parentElement).toBe(menu);
  });

  it.each(['Enter', 'double-click'] as const)(
    'keeps %s on a discovered location inside the favourites menu',
    async (activation) => {
      const location = { providerId: 'local', uri: 'file:///Users/example/OneDrive' } as const;
      const onNavigateLocation = vi.fn();
      const onOpenEntry = vi.fn();
      mount(
        attrs({
          systemLocations: [{ name: 'OneDrive', kind: 'cloud', location }],
          cursorIndex: 0,
          onNavigateLocation,
          onOpenEntry,
        }),
      );
      root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
      m.redraw.sync();
      const item = root.querySelector<HTMLButtonElement>('.fm-cloud-locations [role="menuitem"]');

      if (activation === 'Enter') {
        item?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        item?.click();
      } else {
        item?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        item?.click();
      }
      await Promise.resolve();

      expect(onNavigateLocation).toHaveBeenCalledWith(location);
      expect(onOpenEntry).not.toHaveBeenCalled();
    },
  );

  it('shows network volumes separately and keeps disappeared shares recoverable', () => {
    const location = { providerId: 'local', uri: 'file:///Volumes/Team%20Files' };
    mount(
      attrs({
        systemLocations: [
          {
            name: 'Team Files',
            kind: 'network',
            location,
            protocol: 'smb',
            server: 'files.example.test',
            share: 'team',
            readOnly: true,
          },
        ],
        unavailableLocations: new Set(['local:file:///Volumes/Team%20Files']),
      }),
    );

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();
    expect(root.querySelector('.fm-network-locations strong')?.textContent).toBe('Network');
    const share = root.querySelector<HTMLButtonElement>('.fm-network-locations [role="menuitem"]');
    expect(share?.textContent).toContain('Team Files (unavailable)');
    expect(share?.disabled).toBe(false);
  });

  it('shows a recoverable cloud discovery state', () => {
    const onRetrySystemLocations = vi.fn();
    mount(attrs({ systemLocationsError: 'offline', onRetrySystemLocations }));
    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();
    root.querySelector<HTMLButtonElement>('.fm-cloud-locations-error button')?.click();
    expect(onRetrySystemLocations).toHaveBeenCalledOnce();
  });

  it('opens an SSH server from the Servers section at /home/<username>', async () => {
    const onNavigateLocation = vi.fn();
    mount(
      attrs({
        connections: [sampleConnection({ id: 'server-1', name: 'Spark', status: 'connected' })],
        onNavigateLocation,
      }),
    );

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();
    root.querySelector<HTMLButtonElement>('.fm-servers-locations .fm-server-item')?.click();
    await Promise.resolve();

    expect(onNavigateLocation).toHaveBeenCalledWith({
      providerId: 'sftp',
      uri: 'sftp://server-1/home/erik',
    });
  });

  it('opens an SSH server at its configured startPath override', async () => {
    const onNavigateLocation = vi.fn();
    mount(
      attrs({
        connections: [
          sampleConnection({
            id: 'server-1',
            name: 'Spark',
            status: 'connected',
            configuration: {
              kind: 'ssh',
              host: 'example.test',
              port: 22,
              username: 'erik',
              startPath: '/srv/spark',
              authentication: 'password',
              hostKeyPolicy: 'promptOnFirstUse',
              keepaliveSeconds: null,
            },
          }),
        ],
        onNavigateLocation,
      }),
    );

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();
    root.querySelector<HTMLButtonElement>('.fm-servers-locations .fm-server-item')?.click();
    await Promise.resolve();

    expect(onNavigateLocation).toHaveBeenCalledWith({
      providerId: 'sftp',
      uri: 'sftp://server-1/srv/spark',
    });
  });

  it('shows a connected server indicator when a tab is currently open on that SFTP connection', () => {
    mount(
      attrs({
        tabs: [
          {
            id: 'tab-1' as TabId,
            title: 'Spark',
            path: '/home/tno',
            locationUri: 'sftp://server-1/home/tno',
          },
        ],
        connections: [sampleConnection({ id: 'server-1', name: 'Spark', status: 'disconnected' })],
      }),
    );

    root.querySelector<HTMLButtonElement>('.fm-pane-tab-favourites')?.click();
    m.redraw.sync();

    expect(root.querySelector('.fm-servers-locations .fm-server-status')?.textContent).toBe('●');
  });
});
