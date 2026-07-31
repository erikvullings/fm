import m, { type FactoryComponent, type VnodeDOM } from 'mithril';

import type { EntryId, EntrySummary, LoadingState } from '../../models';
import { calculateVisibleWindow, scrollOffsetForIndex } from './windowing';
import './directory-table.css';

const DEFAULT_ROW_HEIGHT = 30;
const DEFAULT_VIEWPORT_HEIGHT = 300;
const DEFAULT_OVERSCAN = 3;

/** Random-access entry collection; large mock sources need not materialize an array. */
export interface DirectoryEntrySource {
  readonly length: number;
  entryAt(index: number): EntrySummary | undefined;
}

/** Adapts an ordinary directory snapshot to the random-access table surface. */
export function entryArraySource(entries: readonly EntrySummary[]): DirectoryEntrySource {
  return {
    length: entries.length,
    entryAt: (index) => entries[index],
  };
}

/** Rendering inputs. Cursor and selection behavior are owned by tasks 0028/0029. */
export interface DirectoryTableAttrs {
  readonly state: LoadingState;
  readonly source?: DirectoryEntrySource;
  readonly cursorIndex?: number;
  readonly selectedEntryIds?: ReadonlySet<EntryId>;
  readonly active?: boolean;
  readonly viewportHeight?: number;
  readonly overscan?: number;
  readonly label?: string;
  readonly onCursorChange?: (index: number) => void;
  readonly onRetry?: () => void;
  readonly onEndReached?: () => void;
}

function readRowHeight(element: HTMLElement): number {
  const configured = Number.parseFloat(
    getComputedStyle(element).getPropertyValue('--fm-row-height'),
  );
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_ROW_HEIGHT;
}

function typeLabel(entry: EntrySummary): string {
  if (entry.kind === 'directory') {
    return 'Folder';
  }
  if (entry.kind === 'symlink') {
    return 'Link';
  }
  return entry.extension ?? entry.mimeType ?? 'File';
}

function sizeLabel(entry: EntrySummary): string {
  if (entry.size === undefined) {
    return '—';
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(entry.size);
}

function modifiedLabel(entry: EntrySummary): string {
  if (entry.modifiedAt === undefined) {
    return '—';
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(entry.modifiedAt));
}

function rowId(entryId: EntryId): string {
  let hash = 2_166_136_261;
  for (const character of entryId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `fm-directory-row-${(hash >>> 0).toString(36)}`;
}

interface DirectoryColumn {
  readonly id: 'name' | 'type' | 'size' | 'modified';
  readonly label: string;
  readonly cellClass: string;
  render(entry: EntrySummary): m.Children;
}

const INITIAL_COLUMNS: readonly DirectoryColumn[] = [
  {
    id: 'name',
    label: 'Name',
    cellClass: 'fm-directory-name',
    render: (entry) => {
      const statuses = [
        entry.hidden ? 'Hidden' : undefined,
        entry.kind === 'symlink' ? 'Link' : undefined,
      ].filter((status): status is string => status !== undefined);
      return [
        m('span.fm-entry-name', entry.name),
        statuses.map((status) =>
          m(
            'span.fm-entry-status',
            { key: status, title: `${status} entry` },
            status === 'Link' ? ['↗ ', status] : status,
          ),
        ),
      ];
    },
  },
  {
    id: 'type',
    label: 'Type',
    cellClass: 'fm-directory-type',
    render: typeLabel,
  },
  {
    id: 'size',
    label: 'Size',
    cellClass: 'fm-directory-size',
    render: sizeLabel,
  },
  {
    id: 'modified',
    label: 'Modified',
    cellClass: 'fm-directory-modified',
    render: modifiedLabel,
  },
];

function stateView(attrs: DirectoryTableAttrs, rowHeight: number): m.Children | undefined {
  if (attrs.state.type === 'loading') {
    const count = Math.max(
      1,
      Math.ceil((attrs.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT) / rowHeight),
    );
    return m('.fm-directory-state', { role: 'status', 'aria-live': 'polite' }, [
      m('.fm-visually-hidden', 'Loading directory'),
      Array.from({ length: count }, (_, index) =>
        m('.fm-directory-placeholder', {
          key: index,
          'aria-hidden': 'true',
          style: { height: `${rowHeight}px` },
        }),
      ),
    ]);
  }
  if (attrs.state.type === 'error') {
    return m('.fm-directory-state.fm-directory-error', { role: 'alert' }, [
      m('strong', 'Unable to load directory.'),
      m('span', attrs.state.message),
      attrs.onRetry === undefined
        ? undefined
        : m('button.fm-directory-retry', { type: 'button', onclick: attrs.onRetry }, 'Retry'),
    ]);
  }
  if (attrs.state.type === 'idle') {
    return m('.fm-directory-state', { role: 'status' }, 'Directory not loaded.');
  }
  if ((attrs.source?.length ?? 0) === 0) {
    return m('.fm-directory-state', { role: 'status' }, 'This directory is empty.');
  }
  return undefined;
}

function headerView(): m.Children {
  return m(
    '.fm-directory-header',
    { role: 'row' },
    INITIAL_COLUMNS.map((column) =>
      m(
        `.fm-directory-cell.${column.cellClass}`,
        { key: column.id, role: 'columnheader' },
        column.label,
      ),
    ),
  );
}

/**
 * Fixed-row virtualized directory grid. It mounts only the visible window and
 * accepts random-access sources so million-entry fixtures remain lazy.
 */
export const DirectoryTable: FactoryComponent<DirectoryTableAttrs> = () => {
  let element: HTMLElement | undefined;
  let rowHeight = DEFAULT_ROW_HEIGHT;
  let scrollTop = 0;
  let previousCursorIndex: number | undefined;

  function syncCursor(attrs: DirectoryTableAttrs): void {
    if (
      element === undefined ||
      attrs.cursorIndex === undefined ||
      attrs.cursorIndex === previousCursorIndex ||
      attrs.source === undefined
    ) {
      return;
    }
    previousCursorIndex = attrs.cursorIndex;
    const bodyScrollTop = Math.max(0, element.scrollTop - rowHeight);
    const nextBodyScrollTop = scrollOffsetForIndex({
      index: attrs.cursorIndex,
      entryCount: attrs.source.length,
      rowHeight,
      scrollTop: bodyScrollTop,
      viewportHeight: attrs.viewportHeight ?? element.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT,
    });
    const nextScrollTop = nextBodyScrollTop + rowHeight;
    if (nextScrollTop !== element.scrollTop) {
      element.scrollTop = nextScrollTop;
      scrollTop = nextScrollTop;
    }
  }

  return {
    oncreate: (vnode: VnodeDOM<DirectoryTableAttrs>) => {
      element = vnode.dom as HTMLElement;
      rowHeight = readRowHeight(element);
      syncCursor(vnode.attrs);
      m.redraw();
    },
    onbeforeupdate: (vnode: VnodeDOM<DirectoryTableAttrs>) => {
      syncCursor(vnode.attrs);
      return true;
    },
    view: ({ attrs }) => {
      const state = stateView(attrs, rowHeight);
      const source = attrs.source;
      const cursorEntry =
        attrs.cursorIndex === undefined ? undefined : source?.entryAt(attrs.cursorIndex);
      const bodyScrollTop = Math.max(0, scrollTop - rowHeight);
      const viewportHeight = attrs.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT;
      const window =
        source === undefined
          ? undefined
          : calculateVisibleWindow({
              entryCount: source.length,
              rowHeight,
              scrollTop: bodyScrollTop,
              viewportHeight,
              overscan: attrs.overscan ?? DEFAULT_OVERSCAN,
            });
      const rows: m.Children[] = [];
      if (source !== undefined && window !== undefined && state === undefined) {
        for (let index = window.start; index < window.end; index += 1) {
          const entry = source.entryAt(index);
          if (entry === undefined) {
            continue;
          }
          const cursor = index === attrs.cursorIndex;
          const selected = attrs.selectedEntryIds?.has(entry.id) ?? false;
          rows.push(
            m(
              '.fm-directory-row',
              {
                key: entry.id,
                id: rowId(entry.id),
                role: 'row',
                'aria-rowindex': index + 2,
                'aria-selected': selected ? 'true' : 'false',
                onclick: () => attrs.onCursorChange?.(index),
                class: [
                  entry.hidden ? 'fm-hidden-entry' : '',
                  cursor ? 'fm-cursor-row' : '',
                  selected ? 'fm-selected-row' : '',
                ].join(' '),
                style: {
                  height: `${rowHeight}px`,
                  transform: `translateY(${window.offsetTop + (index - window.start) * rowHeight}px)`,
                },
              },
              INITIAL_COLUMNS.map((column) =>
                m(
                  `.fm-directory-cell.${column.cellClass}`,
                  { key: column.id, role: 'gridcell' },
                  column.render(entry),
                ),
              ),
            ),
          );
        }
      }

      return m(
        '.fm-directory-table',
        {
          role: 'grid',
          tabindex: 0,
          'aria-label': attrs.label ?? 'Directory contents',
          'aria-rowcount': (source?.length ?? 0) + 1,
          'aria-colcount': INITIAL_COLUMNS.length,
          'aria-activedescendant': cursorEntry === undefined ? undefined : rowId(cursorEntry.id),
          'data-active': attrs.active ? 'true' : 'false',
          style: { height: `${viewportHeight}px` },
          onscroll: (event: Event) => {
            const target = event.currentTarget as HTMLElement;
            scrollTop = target.scrollTop;
            if (target.scrollTop + target.clientHeight >= target.scrollHeight - rowHeight) {
              attrs.onEndReached?.();
            }
          },
        },
        [
          headerView(),
          state ??
            m(
              '.fm-directory-body',
              { role: 'rowgroup', style: { height: `${window?.totalHeight ?? 0}px` } },
              rows,
            ),
          m(
            '.fm-visually-hidden',
            { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
            cursorEntry === undefined ? '' : `Focused ${cursorEntry.name}`,
          ),
        ],
      );
    },
  };
};
