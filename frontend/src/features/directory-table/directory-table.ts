import m, { type FactoryComponent, type VnodeDOM } from 'mithril';

import type { EntryId, EntrySummary, LoadingState, SortDescriptor } from '../../models';
import {
  DEFAULT_ENTRY_FORMAT_SETTINGS,
  type EntryFormatSettings,
  formatEntryModifiedAt,
  formatEntrySize,
} from '../entry-formatting/entry-formatting';
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
  readonly nameMatchPrefix?: string;
  readonly sort?: readonly SortDescriptor[];
  readonly onSortChange?: (sort: readonly SortDescriptor[]) => void;
  readonly formatSettings?: EntryFormatSettings;
  readonly onCursorChange?: (index: number) => void;
  readonly onActivate?: (index: number) => void;
  readonly onRetry?: () => void;
  readonly onEndReached?: () => void;
  readonly renamingEntryId?: EntryId;
  readonly renameValue?: string;
  readonly renameError?: string;
  readonly onRenameInput?: (value: string) => void;
  readonly onRenameCancel?: () => void;
  readonly onRenameCommit?: () => void;
}

function readRowHeight(element: HTMLElement): number {
  const configured = Number.parseFloat(
    getComputedStyle(element).getPropertyValue('--fm-row-height'),
  );
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_ROW_HEIGHT;
}

function typeLabel(entry: EntrySummary): string {
  if (entry.kind === 'directory') {
    return '';
  }
  if (entry.kind === 'symlink') {
    return 'Link';
  }
  return entry.extension ?? entry.mimeType ?? 'File';
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
  readonly id: 'core.name' | 'core.extension' | 'core.size' | 'core.modified';
  readonly label: string;
  readonly cellClass: string;
  render(
    entry: EntrySummary,
    nameMatchPrefix?: string,
    formatSettings?: EntryFormatSettings,
  ): m.Children;
}

const INITIAL_COLUMNS: readonly DirectoryColumn[] = [
  {
    id: 'core.name',
    label: 'Name',
    cellClass: 'fm-directory-name',
    render: (entry, nameMatchPrefix) => {
      const statuses = [
        entry.hidden ? 'Hidden' : undefined,
        entry.kind === 'symlink' ? 'Link' : undefined,
      ].filter((status): status is string => status !== undefined);
      const matchIndex =
        nameMatchPrefix === undefined
          ? -1
          : entry.name.toLocaleLowerCase().indexOf(nameMatchPrefix.toLocaleLowerCase());
      return [
        m('span.fm-entry-name', [
          matchIndex < 0 || nameMatchPrefix === undefined
            ? entry.name
            : [
                entry.name.slice(0, matchIndex),
                m(
                  'span.fm-typeahead-match',
                  entry.name.slice(matchIndex, matchIndex + nameMatchPrefix.length),
                ),
                entry.name.slice(matchIndex + nameMatchPrefix.length),
              ],
        ]),
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
    id: 'core.extension',
    label: 'Extension',
    cellClass: 'fm-directory-type',
    render: typeLabel,
  },
  {
    id: 'core.size',
    label: 'Size',
    cellClass: 'fm-directory-size',
    render: (entry, _nameMatchPrefix, settings = DEFAULT_ENTRY_FORMAT_SETTINGS) =>
      formatEntrySize(entry, settings),
  },
  {
    id: 'core.modified',
    label: 'Modified',
    cellClass: 'fm-directory-modified',
    render: (entry, _nameMatchPrefix, settings = DEFAULT_ENTRY_FORMAT_SETTINGS) =>
      formatEntryModifiedAt(entry.modifiedAt, settings),
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

function nextSort(
  columnId: DirectoryColumn['id'],
  sort: readonly SortDescriptor[] | undefined,
): readonly SortDescriptor[] {
  const active = sort?.[0];
  return [
    {
      columnId,
      direction:
        active?.columnId === columnId && active.direction === 'ascending'
          ? 'descending'
          : 'ascending',
    },
  ];
}

function headerView(attrs: DirectoryTableAttrs): m.Children {
  return m(
    '.fm-directory-header',
    { role: 'row' },
    INITIAL_COLUMNS.map((column) =>
      m(
        `button.fm-directory-cell.${column.cellClass}`,
        {
          key: column.id,
          type: 'button',
          role: 'columnheader',
          'data-column-id': column.id,
          'aria-sort': attrs.sort?.[0]?.columnId === column.id ? attrs.sort[0].direction : 'none',
          onclick: () => attrs.onSortChange?.(nextSort(column.id, attrs.sort)),
          onkeydown: (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              attrs.onSortChange?.(nextSort(column.id, attrs.sort));
            }
          },
        },
        [
          column.label,
          attrs.sort?.[0]?.columnId === column.id
            ? m(
                'svg.fm-sort-indicator',
                {
                  'aria-hidden': 'true',
                  viewBox: '0 0 16 16',
                  width: 12,
                  height: 12,
                },
                m('path', {
                  d: attrs.sort[0].direction === 'ascending' ? 'M4 9 8 5l4 4' : 'M4 7l4 4 4-4',
                  fill: 'none',
                  stroke: 'currentColor',
                  'stroke-width': 1.5,
                  'stroke-linecap': 'round',
                  'stroke-linejoin': 'round',
                }),
              )
            : undefined,
        ],
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
      viewportHeight: attrs.viewportHeight ?? (element.clientHeight || DEFAULT_VIEWPORT_HEIGHT),
    });
    if (nextBodyScrollTop === bodyScrollTop) {
      return;
    }
    const nextScrollTop = nextBodyScrollTop === 0 ? 0 : nextBodyScrollTop + rowHeight;
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
      const viewportHeight =
        attrs.viewportHeight ?? (element?.clientHeight || DEFAULT_VIEWPORT_HEIGHT);
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
                'data-row-stripe': index % 2 === 1 ? 'alternate' : undefined,
                onclick: () => attrs.onCursorChange?.(index),
                ondblclick: () => attrs.onActivate?.(index),
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
                  column.id === 'core.name' && attrs.renamingEntryId === entry.id
                    ? [
                        m('input.fm-inline-rename-input', {
                          value: attrs.renameValue ?? entry.name,
                          'aria-label': `Rename ${entry.name}`,
                          'aria-invalid': attrs.renameError === undefined ? undefined : 'true',
                          oncreate: ({ dom }: VnodeDOM) => {
                            const input = dom as HTMLInputElement;
                            input.focus();
                            const dot = entry.kind === 'file' ? entry.name.lastIndexOf('.') : -1;
                            input.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
                          },
                          oninput: (event: InputEvent) =>
                            attrs.onRenameInput?.((event.currentTarget as HTMLInputElement).value),
                          onkeydown: (event: KeyboardEvent) => {
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              event.stopPropagation();
                              attrs.onRenameCancel?.();
                            } else if (event.key === 'Enter') {
                              event.preventDefault();
                              event.stopPropagation();
                              attrs.onRenameCommit?.();
                            }
                          },
                        }),
                        attrs.renameError === undefined
                          ? undefined
                          : m('.fm-inline-rename-error', { role: 'alert' }, attrs.renameError),
                      ]
                    : column.render(entry, attrs.nameMatchPrefix, attrs.formatSettings),
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
          style: { height: attrs.viewportHeight === undefined ? '100%' : `${viewportHeight}px` },
          onscroll: (event: Event) => {
            const target = event.currentTarget as HTMLElement;
            scrollTop = target.scrollTop;
            if (target.scrollTop + target.clientHeight >= target.scrollHeight - rowHeight) {
              attrs.onEndReached?.();
            }
          },
        },
        [
          headerView(attrs),
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
