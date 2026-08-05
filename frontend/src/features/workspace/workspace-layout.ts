import m, { type FactoryComponent, type Vnode } from 'mithril';
import { dispatchKeybinding, type KeybindingRuntime } from '../../keybindings/dispatcher';
import type {
  ActionDescriptor,
  EntryId,
  EntrySummary,
  LoadingState,
  PaneId,
  PaneProjection,
  SortDescriptor,
  TabId,
  WorkspaceLayout,
  WorkspaceProjection,
} from '../../models';
import type { DirectoryColumnDescriptor } from '../directory-table/directory-table';
import type { NativeIconLoader } from '../directory-table/native-icon-loader';
import type { EntryFormatSettings } from '../entry-formatting/entry-formatting';
import { Pane } from '../panes/pane';
import type { SelectionPlatform } from '../selection/keybindings';
import type { SelectionAction } from '../selection/selection';
import './workspace-layout.css';

const MIN_PANE_WIDTH = 240;

/** Directory-session and view data supplied for one workspace pane. */
export interface WorkspacePaneContent {
  readonly state: LoadingState;
  readonly entries: readonly EntrySummary[];
  readonly selectedEntryIds: ReadonlySet<EntryId>;
  readonly cutEntryIds: ReadonlySet<EntryId>;
  readonly sortLabel: string;
  readonly sort: readonly SortDescriptor[];
  readonly hasMore?: boolean;
  readonly totalEntryCount: number;
  readonly totalKnownEntries?: number;
  readonly totalKnownSize?: number;
  readonly totalKnownFileCount?: number;
  readonly hiddenSelectedCount: number;
  readonly filterOpen: boolean;
  readonly filterQuery: string;
  readonly formatSettings?: EntryFormatSettings;
  readonly pluginColumns?: readonly DirectoryColumnDescriptor[];
  readonly nativeIconLoader?: NativeIconLoader;
  readonly cursorIndex?: number;
  readonly platform: SelectionPlatform;
  readonly keybindingRuntime?: KeybindingRuntime;
  readonly actions?: readonly ActionDescriptor[];
  readonly keybindingOverrides?: Readonly<Record<string, string>>;
  readonly onNavigate: (path: string) => void | Promise<void>;
  readonly onBack: () => void | Promise<void>;
  readonly onForward: () => void | Promise<void>;
  readonly onParent: () => void | Promise<void>;
  readonly onOpenEntry: (entry: EntrySummary) => void | Promise<void>;
  readonly onSelectionAction: (action: SelectionAction) => void;
  readonly onRetry: () => void | Promise<void>;
  readonly onLoadNextPage: () => void | Promise<void>;
  readonly onSortChange: (sort: readonly SortDescriptor[]) => void;
  readonly onFilterQueryChange: (query: string) => void;
  readonly onFilterCommit: () => void;
  readonly onFilterClose: () => void;
  readonly onRename: (entry: EntrySummary, name: string) => void | Promise<void>;
  readonly onContextMenu?: (entries: readonly EntrySummary[], x: number, y: number) => void;
  /** When set, replaces the pane's directory-listing surface with this content (task 0088). */
  readonly viewerContent?: m.Children;
}

/** Inputs for the recursive workspace layout renderer. */
export interface WorkspaceLayoutViewAttrs {
  readonly workspace: WorkspaceProjection;
  readonly paneContent: (paneId: PaneId) => WorkspacePaneContent;
  readonly onActivatePane: (paneId: PaneId) => void;
  readonly onUpdateLayout: (layout: WorkspaceLayout) => void;
  readonly onSelectTab: (paneId: PaneId, tabId: TabId) => void;
  readonly onCloseTab: (paneId: PaneId, tabId: TabId) => void;
  readonly onNewTab: (paneId: PaneId) => void;
  /**
   * Lets the caller force-persist an in-flight debounced layout edit (e.g.
   * before switching workspaces) by handing it a callback registered once on
   * init.
   */
  readonly registerFlush?: (flush: () => void) => void;
}

/** Clamps a horizontal split so both children retain a usable minimum width. */
export function constrainSplitRatio(
  pointerOffset: number,
  containerWidth: number,
  minimumPaneWidth = MIN_PANE_WIDTH,
): number {
  if (containerWidth <= 0) {
    return 0.5;
  }
  const minimumRatio = Math.min(minimumPaneWidth / containerWidth, 0.5);
  return Math.min(1 - minimumRatio, Math.max(minimumRatio, pointerOffset / containerWidth));
}

export function pathFromUri(uri: string): string {
  if (uri.startsWith('archive://')) {
    return decodeURIComponent(uri.slice('archive://'.length)) || '/';
  }
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice('file://'.length)) || '/';
  }
  if (uri.startsWith('mock:///')) {
    const path = decodeURIComponent(uri.slice('mock://'.length));
    return path.length === 0 ? '/' : path;
  }
  return uri;
}

function paneIdsInLayout(layout: WorkspaceLayout): readonly PaneId[] {
  if (layout.type === 'pane') {
    return [layout.paneId];
  }
  return [...paneIdsInLayout(layout.first), ...paneIdsInLayout(layout.second)];
}

/** Renders an arbitrary backend workspace layout tree using pane leaves and split nodes. */
export const WorkspaceLayoutView: FactoryComponent<WorkspaceLayoutViewAttrs> = () => {
  const paneElements = new Map<PaneId, HTMLElement>();
  let displayedLayout: WorkspaceLayout | undefined;
  let sourceLayout: WorkspaceLayout | undefined;
  let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingLayoutUpdate: { attrs: WorkspaceLayoutViewAttrs; layout: WorkspaceLayout } | undefined;
  let stopDragging: (() => void) | undefined;
  /** Frontend-only tab order overrides for drag-reorder; no backend command persists this. */
  const tabOrderOverrides = new Map<PaneId, readonly TabId[]>();

  /** Resolves the override for a pane's tab order, discarding it if the tab set has changed. */
  function resolvedTabOrder(pane: PaneProjection): readonly TabId[] {
    const override = tabOrderOverrides.get(pane.id);
    if (
      override !== undefined &&
      override.length === pane.tabOrder.length &&
      override.every((id) => pane.tabOrder.includes(id))
    ) {
      return override;
    }
    tabOrderOverrides.delete(pane.id);
    return pane.tabOrder;
  }

  function replaceSplit(
    layout: WorkspaceLayout,
    target: WorkspaceLayout,
    ratio: number,
  ): WorkspaceLayout {
    if (layout === target && layout.type === 'split') {
      return { ...layout, ratio };
    }
    if (layout.type === 'pane') {
      return layout;
    }
    return {
      ...layout,
      first: replaceSplit(layout.first, target, ratio),
      second: replaceSplit(layout.second, target, ratio),
    };
  }

  function scheduleLayoutUpdate(attrs: WorkspaceLayoutViewAttrs, layout: WorkspaceLayout): void {
    if (persistenceTimer !== undefined) {
      clearTimeout(persistenceTimer);
    }
    pendingLayoutUpdate = { attrs, layout };
    persistenceTimer = setTimeout(() => {
      persistenceTimer = undefined;
      pendingLayoutUpdate = undefined;
      attrs.onUpdateLayout(layout);
    }, 500);
  }

  /** Immediately persists a pending debounced layout edit, if any, cancelling its timer. */
  function flushPendingLayoutUpdate(): void {
    if (persistenceTimer === undefined || pendingLayoutUpdate === undefined) {
      return;
    }
    clearTimeout(persistenceTimer);
    persistenceTimer = undefined;
    const { attrs, layout } = pendingLayoutUpdate;
    pendingLayoutUpdate = undefined;
    attrs.onUpdateLayout(layout);
  }

  function beginSplitDrag(
    event: PointerEvent,
    attrs: WorkspaceLayoutViewAttrs,
    split: Extract<WorkspaceLayout, { type: 'split' }>,
  ): void {
    event.preventDefault();
    stopDragging?.();
    const container = (event.currentTarget as HTMLElement).parentElement;
    if (container === null) {
      return;
    }
    const move = (moveEvent: PointerEvent): void => {
      const bounds = container.getBoundingClientRect();
      const horizontal = split.axis === 'horizontal';
      const offset = horizontal ? moveEvent.clientX - bounds.left : moveEvent.clientY - bounds.top;
      const extent = horizontal ? bounds.width : bounds.height;
      const ratio = constrainSplitRatio(offset, extent);
      const nextLayout = replaceSplit(attrs.workspace.layout, split, ratio);
      displayedLayout = nextLayout;
      scheduleLayoutUpdate(attrs, nextLayout);
      m.redraw();
    };
    const end = (): void => stopDragging?.();
    stopDragging = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      stopDragging = undefined;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  }

  function focusAndActivate(attrs: WorkspaceLayoutViewAttrs, paneId: PaneId): void {
    attrs.onActivatePane(paneId);
    const workspacePane = paneElements.get(paneId);
    const keyboardTarget = workspacePane?.querySelector<HTMLElement>('.fm-pane');
    (keyboardTarget ?? workspacePane)?.focus();
  }

  function renderPane(
    attrs: WorkspaceLayoutViewAttrs,
    paneId: PaneId,
  ): Vnode<unknown, unknown> | undefined {
    const pane = attrs.workspace.panesById[paneId];
    if (pane === undefined) {
      return undefined;
    }
    const tab = pane.tabsById[pane.activeTabId];
    if (tab === undefined) {
      return undefined;
    }
    const content = attrs.paneContent(paneId);
    const active = attrs.workspace.activePaneId === paneId;
    return m(
      '.fm-workspace-pane',
      {
        'data-pane-id': paneId,
        'data-active': String(active),
        tabindex: active ? 0 : -1,
        oncreate: ({ dom }) => paneElements.set(paneId, dom as HTMLElement),
        onremove: () => paneElements.delete(paneId),
        onclick: (event: MouseEvent) => {
          // Clicking an interactive control (e.g. the file viewer's search box) must not steal
          // focus back to the directory table - only activate the pane, keep the DOM focus as-is.
          if (
            event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLTextAreaElement ||
            event.target instanceof HTMLSelectElement ||
            event.target instanceof HTMLButtonElement ||
            (event.target instanceof HTMLElement && event.target.isContentEditable)
          ) {
            attrs.onActivatePane(paneId);
            return;
          }
          focusAndActivate(attrs, paneId);
        },
        onkeydown: (event: KeyboardEvent) => {
          if (
            event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLTextAreaElement ||
            event.target instanceof HTMLSelectElement ||
            (event.target instanceof HTMLElement && event.target.isContentEditable)
          ) {
            return;
          }
          const actionId = dispatchKeybinding(
            event,
            {
              scope: 'table',
              platform: content.platform,
              runtime: content.keybindingRuntime ?? 'browser',
            },
            content.actions ?? [],
            content.keybindingOverrides ?? {},
          );
          if (actionId !== 'core.switchPane') {
            return;
          }
          event.preventDefault();
          const paneOrder = paneIdsInLayout(attrs.workspace.layout);
          const currentIndex = paneOrder.indexOf(paneId);
          const direction = event.shiftKey ? -1 : 1;
          const nextIndex = (currentIndex + direction + paneOrder.length) % paneOrder.length;
          const nextPaneId = paneOrder[nextIndex];
          if (nextPaneId !== undefined) {
            focusAndActivate(attrs, nextPaneId);
          }
        },
      },
      m(Pane, {
        path: pathFromUri(tab.location.uri),
        tabTitle: tab.title,
        tabs: resolvedTabOrder(pane).map((tabId) => {
          const paneTab = pane.tabsById[tabId];
          return {
            id: tabId,
            title: paneTab?.title ?? '',
            path: paneTab === undefined ? '' : pathFromUri(paneTab.location.uri),
          };
        }),
        activeTabId: pane.activeTabId,
        onSelectTab: (tabId) => attrs.onSelectTab(paneId, tabId),
        onCloseTab: (tabId) => attrs.onCloseTab(paneId, tabId),
        onNewTab: () => attrs.onNewTab(paneId),
        onReorderTabs: (order) => {
          tabOrderOverrides.set(paneId, order);
          m.redraw();
        },
        state: content.state,
        entries: content.entries,
        selectedEntryIds: content.selectedEntryIds,
        cutEntryIds: content.cutEntryIds,
        sortLabel: content.sortLabel,
        sort: content.sort,
        ...(content.hasMore === undefined ? {} : { hasMore: content.hasMore }),
        totalEntryCount: content.totalEntryCount,
        ...(content.totalKnownEntries === undefined
          ? {}
          : { totalKnownEntries: content.totalKnownEntries }),
        ...(content.totalKnownSize === undefined ? {} : { totalKnownSize: content.totalKnownSize }),
        ...(content.totalKnownFileCount === undefined
          ? {}
          : { totalKnownFileCount: content.totalKnownFileCount }),
        hiddenSelectedCount: content.hiddenSelectedCount,
        filterOpen: content.filterOpen,
        filterQuery: content.filterQuery,
        ...(content.formatSettings === undefined ? {} : { formatSettings: content.formatSettings }),
        ...(content.pluginColumns === undefined ? {} : { pluginColumns: content.pluginColumns }),
        ...(content.nativeIconLoader === undefined
          ? {}
          : { nativeIconLoader: content.nativeIconLoader }),
        ...(content.viewerContent === undefined ? {} : { viewerContent: content.viewerContent }),
        active,
        platform: content.platform,
        ...(content.keybindingRuntime === undefined
          ? {}
          : { keybindingRuntime: content.keybindingRuntime }),
        ...(content.actions === undefined ? {} : { actions: content.actions }),
        ...(content.keybindingOverrides === undefined
          ? {}
          : { keybindingOverrides: content.keybindingOverrides }),
        canNavigateBack: tab.canNavigateBack,
        canNavigateForward: tab.canNavigateForward,
        ...(content.cursorIndex === undefined ? {} : { cursorIndex: content.cursorIndex }),
        onNavigate: content.onNavigate,
        onBack: content.onBack,
        onForward: content.onForward,
        onParent: content.onParent,
        onOpenEntry: content.onOpenEntry,
        onSelectionAction: content.onSelectionAction,
        onRetry: content.onRetry,
        onLoadNextPage: content.onLoadNextPage,
        onSortChange: content.onSortChange,
        onFilterQueryChange: content.onFilterQueryChange,
        onFilterCommit: content.onFilterCommit,
        onFilterClose: content.onFilterClose,
        onRename: content.onRename,
        onContextMenu: content.onContextMenu ?? (() => undefined),
      }),
    );
  }

  function renderLayout(
    attrs: WorkspaceLayoutViewAttrs,
    layout: WorkspaceLayout,
  ): Vnode<unknown, unknown> | undefined {
    if (layout.type === 'pane') {
      return renderPane(attrs, layout.paneId);
    }
    return m(
      '.fm-workspace-split',
      {
        class: `fm-workspace-split--${layout.axis}`,
        style:
          layout.axis === 'horizontal'
            ? { gridTemplateColumns: `${layout.ratio}fr auto ${1 - layout.ratio}fr` }
            : { gridTemplateRows: `${layout.ratio}fr auto ${1 - layout.ratio}fr` },
      },
      [
        renderLayout(attrs, layout.first),
        m('.fm-workspace-splitter', {
          role: 'separator',
          'aria-orientation': layout.axis === 'horizontal' ? 'vertical' : 'horizontal',
          tabindex: 0,
          onpointerdown: (event: PointerEvent) => beginSplitDrag(event, attrs, layout),
        }),
        renderLayout(attrs, layout.second),
      ],
    );
  }

  return {
    oninit: ({ attrs }) => {
      attrs.registerFlush?.(flushPendingLayoutUpdate);
    },
    onremove: () => {
      stopDragging?.();
      if (persistenceTimer !== undefined) {
        clearTimeout(persistenceTimer);
      }
    },
    view: ({ attrs }) => {
      if (sourceLayout !== attrs.workspace.layout) {
        sourceLayout = attrs.workspace.layout;
        displayedLayout = sourceLayout;
      }
      return m('.fm-workspace-layout', { 'aria-label': `${attrs.workspace.name} workspace` }, [
        renderLayout(attrs, displayedLayout ?? attrs.workspace.layout),
      ]);
    },
  };
};
