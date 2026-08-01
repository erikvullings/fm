import m, { type FactoryComponent, type Vnode } from 'mithril';
import { dispatchKeybinding, type KeybindingRuntime } from '../../keybindings/dispatcher';
import type {
  ActionDescriptor,
  EntryId,
  EntrySummary,
  LoadingState,
  PaneId,
  SortDescriptor,
  WorkspaceLayout,
  WorkspaceProjection,
} from '../../models';
import type { EntryFormatSettings } from '../entry-formatting/entry-formatting';
import type { EntryMetadataView } from '../entry-metadata/entry-metadata-loader';
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
  readonly formatSettings?: EntryFormatSettings;
  readonly metadata: EntryMetadataView;
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
  readonly onRename: (entry: EntrySummary, name: string) => void | Promise<void>;
}

/** Inputs for the recursive workspace layout renderer. */
export interface WorkspaceLayoutViewAttrs {
  readonly workspace: WorkspaceProjection;
  readonly paneContent: (paneId: PaneId) => WorkspacePaneContent;
  readonly onActivatePane: (paneId: PaneId) => void;
  readonly onUpdateLayout: (layout: WorkspaceLayout) => void;
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
  let stopDragging: (() => void) | undefined;

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
    persistenceTimer = setTimeout(() => {
      persistenceTimer = undefined;
      attrs.onUpdateLayout(layout);
    }, 500);
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
        onclick: () => focusAndActivate(attrs, paneId),
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
        state: content.state,
        entries: content.entries,
        selectedEntryIds: content.selectedEntryIds,
        cutEntryIds: content.cutEntryIds,
        sortLabel: content.sortLabel,
        sort: content.sort,
        ...(content.formatSettings === undefined ? {} : { formatSettings: content.formatSettings }),
        metadata: content.metadata,
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
        onRename: content.onRename,
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
