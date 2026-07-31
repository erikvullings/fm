import m, { type FactoryComponent, type VnodeDOM } from 'mithril';
import type { EntryId, EntrySummary, LoadingState } from '../../models';
import { DirectoryTable, entryArraySource } from '../directory-table/directory-table';
import './pane.css';

/** A cumulative, clickable part of a filesystem path. */
export interface BreadcrumbSegment {
  readonly label: string;
  readonly path: string;
}

/** Inputs for the presentation-only pane surface. */
export interface PaneAttrs {
  readonly path: string;
  readonly tabTitle: string;
  readonly state: LoadingState;
  readonly entries: readonly EntrySummary[];
  readonly sortLabel: string;
  readonly selectedEntryIds: ReadonlySet<EntryId>;
  readonly active: boolean;
  readonly cursorIndex?: number;
  readonly canNavigateBack: boolean;
  readonly canNavigateForward: boolean;
  readonly onNavigate: (path: string) => void | Promise<void>;
  readonly onBack: () => void | Promise<void>;
  readonly onForward: () => void | Promise<void>;
  readonly onParent: () => void | Promise<void>;
  readonly onOpenEntry: (entry: EntrySummary) => void | Promise<void>;
  readonly onCursorChange: (index: number) => void;
  readonly onRetry: () => void | Promise<void>;
  readonly onLoadNextPage: () => void | Promise<void>;
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

/** Compact pane containing its single tab, path controls, directory grid, and status. */
export const Pane: FactoryComponent<PaneAttrs> = () => {
  let editing = false;
  let draftPath = '';
  let pathError: string | undefined;
  let inputElement: HTMLInputElement | undefined;

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
    view: ({ attrs }) => {
      const selectedCount = attrs.selectedEntryIds.size;
      const totalSelectedSize = selectedSize(attrs.entries, attrs.selectedEntryIds);
      return m(
        'section.fm-pane',
        {
          'data-active': String(attrs.active),
          tabindex: -1,
          onkeydown: (event: KeyboardEvent) => {
            if (event.key.toLowerCase() === 'l' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              beginEditing(attrs.path);
            } else if (event.key === 'ArrowDown' && attrs.entries.length > 0) {
              event.preventDefault();
              attrs.onCursorChange(
                Math.min((attrs.cursorIndex ?? -1) + 1, attrs.entries.length - 1),
              );
            } else if (event.key === 'ArrowUp' && attrs.entries.length > 0) {
              event.preventDefault();
              attrs.onCursorChange(Math.max((attrs.cursorIndex ?? 0) - 1, 0));
            } else if (event.key === 'Enter' && attrs.cursorIndex !== undefined) {
              const entry = attrs.entries[attrs.cursorIndex];
              if (entry !== undefined) {
                event.preventDefault();
                void attrs.onOpenEntry(entry);
              }
            } else if (event.key === 'Backspace') {
              event.preventDefault();
              void attrs.onParent();
            } else if (event.altKey && event.key === 'ArrowLeft') {
              event.preventDefault();
              void attrs.onBack();
            } else if (event.altKey && event.key === 'ArrowRight') {
              event.preventDefault();
              void attrs.onForward();
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
            m(
              'button.fm-pane-tab',
              { type: 'button', role: 'tab', 'aria-selected': 'true' },
              attrs.tabTitle,
            ),
          ]),
          m('.fm-navigation-controls', [
            m(
              'button',
              {
                type: 'button',
                disabled: !attrs.canNavigateBack,
                'aria-label': 'Back',
                onclick: () => void attrs.onBack(),
              },
              '←',
            ),
            m(
              'button',
              {
                type: 'button',
                disabled: !attrs.canNavigateForward,
                'aria-label': 'Forward',
                onclick: () => void attrs.onForward(),
              },
              '→',
            ),
            m(
              'button',
              {
                type: 'button',
                'aria-label': 'Parent directory',
                onclick: () => void attrs.onParent(),
              },
              '↑',
            ),
          ]),
          editing
            ? m('.fm-path-editor', [
                m('input.fm-path-input', {
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
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      cancelEditing();
                    } else if (event.key === 'Enter') {
                      event.preventDefault();
                      event.stopPropagation();
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
                m(
                  'button.fm-breadcrumb-edit-target',
                  {
                    type: 'button',
                    'aria-label': 'Edit path',
                    title: 'Edit path (Ctrl/Cmd+L)',
                    onclick: () => beginEditing(attrs.path),
                  },
                  '✎',
                ),
                pathError === undefined
                  ? undefined
                  : m('.fm-path-error', { role: 'alert' }, pathError),
              ]),
          m(DirectoryTable, {
            state: attrs.state,
            source: entryArraySource(attrs.entries),
            selectedEntryIds: attrs.selectedEntryIds,
            active: attrs.active,
            label: `${attrs.tabTitle} directory`,
            onRetry: () => void attrs.onRetry(),
            onEndReached: () => void attrs.onLoadNextPage(),
            onCursorChange: attrs.onCursorChange,
            ...(attrs.cursorIndex === undefined ? {} : { cursorIndex: attrs.cursorIndex }),
          }),
          m('.fm-pane-status', { role: 'status' }, [
            m(
              'span',
              `${attrs.entries.length} ${attrs.entries.length === 1 ? 'entry' : 'entries'}`,
            ),
            m('span', `${selectedCount} selected`),
            m('span', `${sizeLabel(totalSelectedSize)} selected`),
            m('span', `Sort: ${attrs.sortLabel}`),
          ]),
        ],
      );
    },
  };
};
