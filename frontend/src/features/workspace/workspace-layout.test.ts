import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionDescriptor, EntryId, PaneId, WorkspaceProjection } from '../../models';
import {
  constrainSplitRatio,
  pathFromUri,
  WorkspaceLayoutView,
  type WorkspaceLayoutViewAttrs,
} from './workspace-layout';

describe('pathFromUri', () => {
  it('shows an archive as a navigable filesystem path plus inner path', () => {
    expect(pathFromUri('archive:///home/erik/My%20Comic.zip!/chapter')).toBe(
      '/home/erik/My Comic.zip!/chapter',
    );
  });

  it('hides the sftp connection id and returns only the remote path', () => {
    expect(pathFromUri('sftp://11111111-1111-4111-8111-111111111111/home/erik')).toBe(
      '/home/erik',
    );
  });

  it('shows sftp root as slash', () => {
    expect(pathFromUri('sftp://11111111-1111-4111-8111-111111111111/')).toBe('/');
  });
});

let root: HTMLElement;

const keybindingActions = [
  {
    id: 'core.switchPane',
    title: 'Switch pane',
    defaultShortcuts: [{ key: 'TAB' }, { key: 'TAB', shift: true }],
  },
].map(
  (action): ActionDescriptor => ({
    category: 'test',
    contextRequirements: {},
    source: { kind: 'core' },
    ...action,
  }),
);

function projection(): WorkspaceProjection {
  const emptyView = {
    sort: [],
    columns: [],
    showHidden: false,
    foldersFirst: true,
    quickFilter: null,
  };
  return {
    id: 'workspace-1',
    name: 'Development',
    revision: 7,
    layout: {
      type: 'split',
      axis: 'horizontal',
      ratio: 0.5,
      first: { type: 'pane', paneId: 'left' },
      second: { type: 'pane', paneId: 'right' },
    },
    paneOrder: ['left', 'right'],
    panesById: {
      left: {
        id: 'left',
        tabOrder: ['left-tab'],
        tabsById: {
          'left-tab': {
            id: 'left-tab',
            title: 'Home',
            location: { providerId: 'local', uri: 'file:///home' },
            canNavigateBack: false,
            canNavigateForward: false,
            view: emptyView,
          },
        },
        activeTabId: 'left-tab',
      },
      right: {
        id: 'right',
        tabOrder: ['right-tab'],
        tabsById: {
          'right-tab': {
            id: 'right-tab',
            title: 'Downloads',
            location: { providerId: 'local', uri: 'file:///downloads' },
            canNavigateBack: false,
            canNavigateForward: false,
            view: emptyView,
          },
        },
        activeTabId: 'right-tab',
      },
    },
    activePaneId: 'left',
    operationCentre: { visible: true, height: 180 },
  };
}

function attrs(overrides: Partial<WorkspaceLayoutViewAttrs> = {}): WorkspaceLayoutViewAttrs {
  return {
    workspace: projection(),
    paneContent: () => ({
      state: { type: 'loaded' },
      entries: [],
      selectedEntryIds: new Set<EntryId>(),
      cutEntryIds: new Set<EntryId>(),
      sortLabel: 'Name ascending',
      sort: [{ columnId: 'core.name', direction: 'ascending' }],
      totalEntryCount: 0,
      hiddenSelectedCount: 0,
      filterOpen: false,
      filterQuery: '',
      platform: 'linux',
      keybindingRuntime: 'desktop',
      actions: keybindingActions,
      keybindingOverrides: {},
      onNavigate: vi.fn(),
      onBack: vi.fn(),
      onForward: vi.fn(),
      onParent: vi.fn(),
      onOpenEntry: vi.fn(),
      onRename: vi.fn(),
      onSelectionAction: vi.fn(),
      onRetry: vi.fn(),
      onLoadNextPage: vi.fn(),
      onSortChange: vi.fn(),
      onFilterQueryChange: vi.fn(),
      onFilterCommit: vi.fn(),
      onFilterClose: vi.fn(),
    }),
    onActivatePane: vi.fn(),
    onUpdateLayout: vi.fn(),
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onNewTab: vi.fn(),
    ...overrides,
  };
}

function mount(viewAttrs: WorkspaceLayoutViewAttrs): void {
  m.mount(root, { view: () => m(WorkspaceLayoutView, viewAttrs) });
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  vi.useRealTimers();
  m.mount(root, null);
  root.remove();
});

describe('WorkspaceLayoutView pane focus', () => {
  it('activates a pane when anywhere inside it is clicked', () => {
    const onActivatePane = vi.fn<(paneId: PaneId) => void>();
    mount(attrs({ onActivatePane }));

    root
      .querySelector<HTMLElement>('[data-pane-id="right"] .fm-pane-status')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onActivatePane).toHaveBeenCalledExactlyOnceWith('right');
    expect(document.activeElement).toBe(root.querySelector('[data-pane-id="right"] > .fm-pane'));
  });
});

describe('WorkspaceLayoutView keyboard navigation', () => {
  it('moves active pane focus in layout order when Tab is pressed', () => {
    const onActivatePane = vi.fn<(paneId: PaneId) => void>();
    mount(attrs({ onActivatePane }));
    const left = root.querySelector<HTMLElement>('[data-pane-id="left"]');
    left?.focus();

    left?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    expect(onActivatePane).toHaveBeenCalledExactlyOnceWith('right');
    expect(document.activeElement).toBe(root.querySelector('[data-pane-id="right"] > .fm-pane'));
  });

  it('renders and traverses a future three-pane tree in layout order', () => {
    const threePane = projection();
    const right = threePane.panesById.right;
    if (right === undefined) throw new Error('fixture is missing the right pane');
    threePane.panesById.third = { ...right, id: 'third' };
    threePane.paneOrder = ['third', 'right', 'left'];
    threePane.layout = {
      type: 'split',
      axis: 'horizontal',
      ratio: 0.4,
      first: { type: 'pane', paneId: 'left' },
      second: {
        type: 'split',
        axis: 'vertical',
        ratio: 0.5,
        first: { type: 'pane', paneId: 'right' },
        second: { type: 'pane', paneId: 'third' },
      },
    };
    const onActivatePane = vi.fn<(paneId: PaneId) => void>();
    mount(attrs({ workspace: threePane, onActivatePane }));
    const left = root.querySelector<HTMLElement>('[data-pane-id="left"]');

    left?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    expect(root.querySelectorAll('.fm-workspace-pane')).toHaveLength(3);
    expect(onActivatePane).toHaveBeenCalledExactlyOnceWith('right');
  });
});

describe('tab strip wiring', () => {
  it('forwards tab select/close/new callbacks scoped to the owning pane', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const onNewTab = vi.fn();
    mount(attrs({ onSelectTab, onCloseTab, onNewTab }));

    const rightPane = root.querySelector<HTMLElement>('[data-pane-id="right"]');
    rightPane?.querySelector<HTMLElement>('[role="tab"]')?.click();
    rightPane?.querySelector<HTMLElement>('.fm-pane-tab-close')?.click();
    rightPane?.querySelector<HTMLElement>('.fm-pane-tab-new')?.click();

    expect(onSelectTab).toHaveBeenCalledExactlyOnceWith('right', 'right-tab');
    expect(onCloseTab).toHaveBeenCalledExactlyOnceWith('right', 'right-tab');
    expect(onNewTab).toHaveBeenCalledExactlyOnceWith('right');
  });

  it('keeps a drag-reordered tab order local until the backend tab set changes', () => {
    const twoTabs = projection();
    const leftPane = twoTabs.panesById.left;
    if (leftPane === undefined) throw new Error('left pane missing');
    twoTabs.panesById.left = {
      ...leftPane,
      tabOrder: ['left-tab', 'left-tab-2'],
      tabsById: {
        ...leftPane.tabsById,
        'left-tab-2': {
          id: 'left-tab-2',
          title: 'Second',
          location: { providerId: 'local', uri: 'file:///second' },
          canNavigateBack: false,
          canNavigateForward: false,
          view: leftPane.tabsById['left-tab']?.view as never,
        },
      },
    };
    mount(attrs({ workspace: twoTabs }));

    const leftPaneElement = root.querySelector<HTMLElement>('[data-pane-id="left"]');
    const tabTitles = (): (string | undefined)[] =>
      [...(leftPaneElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].map(
        (element) => element.querySelector('.fm-pane-tab-title')?.textContent ?? undefined,
      );
    expect(tabTitles()).toEqual(['Home', 'Second']);

    const tabs = leftPaneElement?.querySelectorAll<HTMLElement>('[role="tab"]');
    tabs?.[1]?.dispatchEvent(new Event('dragstart', { bubbles: true }));
    tabs?.[0]?.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    tabs?.[0]?.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    m.redraw.sync();

    expect(tabTitles()).toEqual(['Second', 'Home']);
  });
});

describe('splitter constraints', () => {
  it('keeps both sides above their minimum width', () => {
    expect(constrainSplitRatio(10, 1_000, 240)).toBeCloseTo(0.24);
    expect(constrainSplitRatio(990, 1_000, 240)).toBeCloseTo(0.76);
    expect(constrainSplitRatio(500, 1_000, 240)).toBeCloseTo(0.5);
  });

  it('debounces a dragged ratio before emitting the updated layout', () => {
    vi.useFakeTimers();
    const onUpdateLayout = vi.fn<(layout: WorkspaceProjection['layout']) => void>();
    mount(attrs({ onUpdateLayout }));
    const split = root.querySelector<HTMLElement>('.fm-workspace-split');
    const splitter = root.querySelector<HTMLElement>('.fm-workspace-splitter');
    vi.spyOn(split as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 0,
      top: 0,
      right: 1_100,
      bottom: 600,
      left: 100,
      width: 1_000,
      height: 600,
      toJSON: () => ({}),
    });

    splitter?.dispatchEvent(new MouseEvent('pointerdown', { clientX: 600, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 800 }));

    expect(onUpdateLayout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(onUpdateLayout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onUpdateLayout).toHaveBeenCalledExactlyOnceWith({
      ...projection().layout,
      ratio: 0.7,
    });
  });

  it('flushes a pending debounced layout update immediately via registerFlush', () => {
    vi.useFakeTimers();
    const onUpdateLayout = vi.fn<(layout: WorkspaceProjection['layout']) => void>();
    let flush: (() => void) | undefined;
    mount(
      attrs({
        onUpdateLayout,
        registerFlush: (registered) => {
          flush = registered;
        },
      }),
    );
    const split = root.querySelector<HTMLElement>('.fm-workspace-split');
    const splitter = root.querySelector<HTMLElement>('.fm-workspace-splitter');
    vi.spyOn(split as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 0,
      top: 0,
      right: 1_100,
      bottom: 600,
      left: 100,
      width: 1_000,
      height: 600,
      toJSON: () => ({}),
    });

    splitter?.dispatchEvent(new MouseEvent('pointerdown', { clientX: 600, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 800 }));

    expect(onUpdateLayout).not.toHaveBeenCalled();
    flush?.();

    expect(onUpdateLayout).toHaveBeenCalledExactlyOnceWith({
      ...projection().layout,
      ratio: 0.7,
    });

    vi.advanceTimersByTime(500);
    expect(onUpdateLayout).toHaveBeenCalledOnce();
  });

  it('does nothing when flushed with no pending layout update', () => {
    let flush: (() => void) | undefined;
    const onUpdateLayout = vi.fn<(layout: WorkspaceProjection['layout']) => void>();
    mount(
      attrs({
        onUpdateLayout,
        registerFlush: (registered) => {
          flush = registered;
        },
      }),
    );

    flush?.();

    expect(onUpdateLayout).not.toHaveBeenCalled();
  });
});
