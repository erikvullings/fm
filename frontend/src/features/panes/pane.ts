import m, { type FactoryComponent, type VnodeDOM } from 'mithril';
import { editIcon } from '../../components/icons';
import type { EntryId, EntrySummary, LoadingState, SortDescriptor } from '../../models';
import { DirectoryTable, entryArraySource } from '../directory-table/directory-table';
import {
  DEFAULT_ENTRY_FORMAT_SETTINGS,
  type EntryFormatSettings,
  formatEntryModifiedAt,
  formatEntrySize,
} from '../entry-formatting/entry-formatting';
import type { EntryMetadataView } from '../entry-metadata/entry-metadata-loader';
import { validateDirectoryName } from '../operations/create-directory-dialog';
import {
  interpretSelectionKey,
  reduceTypeahead,
  type SelectionPlatform,
  type TypeaheadState,
} from '../selection/keybindings';
import type { SelectionAction } from '../selection/selection';
import { isParentEntry } from './parent-entry';
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
  readonly sort: readonly SortDescriptor[];
  readonly formatSettings?: EntryFormatSettings;
  readonly metadata: EntryMetadataView;
  readonly selectedEntryIds: ReadonlySet<EntryId>;
  readonly cutEntryIds: ReadonlySet<EntryId>;
  readonly active: boolean;
  readonly cursorIndex?: number;
  readonly platform: SelectionPlatform;
  readonly canNavigateBack: boolean;
  readonly canNavigateForward: boolean;
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
  let typeahead: TypeaheadState | undefined;
  let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;
  let typeaheadError = false;
  let renamingEntry: EntrySummary | undefined;
  let renameValue = '';
  let renameError: string | undefined;

  function beginRename(attrs: PaneAttrs): void {
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
      const ordinaryEntries = attrs.entries.filter((entry) => !isParentEntry(entry.id));
      const selectedCount = attrs.selectedEntryIds.size;
      const totalSelectedSize = selectedSize(ordinaryEntries, attrs.selectedEntryIds);
      return m(
        'section.fm-pane',
        {
          'data-active': String(attrs.active),
          tabindex: -1,
          onkeydown: (event: KeyboardEvent) => {
            if (event.key === 'F2') {
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
            if (event.key.toLowerCase() === 'l' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              beginEditing(attrs.path);
              return;
            }
            const command = interpretSelectionKey(event, attrs.platform);
            if (command?.type === 'switchPane') {
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
                attrs.onSelectionAction({ type: 'setCursor', entryId: result.matchedEntryId });
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
            m(
              'button.fm-pane-tab',
              { type: 'button', role: 'tab', 'aria-selected': 'true' },
              attrs.tabTitle,
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
                  editIcon(),
                ),
                pathError === undefined
                  ? undefined
                  : m('.fm-path-error', { role: 'alert' }, pathError),
              ]),
          m(DirectoryTable, {
            state: attrs.state,
            source: entryArraySource(attrs.entries),
            selectedEntryIds: attrs.selectedEntryIds,
            cutEntryIds: attrs.cutEntryIds,
            active: attrs.active,
            sort: attrs.sort,
            ...(attrs.formatSettings === undefined ? {} : { formatSettings: attrs.formatSettings }),
            label: `${attrs.tabTitle} directory`,
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
            onCursorChange: (index) => {
              const entry = attrs.entries[index];
              if (entry !== undefined) {
                attrs.onSelectionAction(
                  isParentEntry(entry.id)
                    ? { type: 'setCursor', entryId: entry.id }
                    : { type: 'selectOnly', entryId: entry.id },
                );
              }
            },
            onActivate: (index) => {
              const entry = attrs.entries[index];
              if (entry !== undefined) {
                void attrs.onOpenEntry(entry);
              }
            },
            onSortChange: attrs.onSortChange,
            ...(attrs.cursorIndex === undefined ? {} : { cursorIndex: attrs.cursorIndex }),
          }),
          attrs.metadata.state === 'idle'
            ? undefined
            : m('.fm-entry-metadata', { 'aria-label': 'Cursor entry metadata' }, [
                m('strong', attrs.metadata.entry.name),
                m(
                  'span',
                  formatEntrySize(
                    attrs.metadata.entry,
                    attrs.formatSettings ?? DEFAULT_ENTRY_FORMAT_SETTINGS,
                  ),
                ),
                m(
                  'span',
                  formatEntryModifiedAt(
                    attrs.metadata.entry.modifiedAt,
                    attrs.formatSettings ?? DEFAULT_ENTRY_FORMAT_SETTINGS,
                  ),
                ),
                attrs.metadata.state === 'loading'
                  ? m('span', 'Loading metadata…')
                  : attrs.metadata.state === 'error'
                    ? m('span', attrs.metadata.message)
                    : [
                        attrs.metadata.metadata.ownership?.owner === undefined
                          ? undefined
                          : m('span', `Owner: ${attrs.metadata.metadata.ownership.owner}`),
                        attrs.metadata.metadata.permissions === undefined
                          ? undefined
                          : m(
                              'span',
                              `Permissions: ${[
                                attrs.metadata.metadata.permissions.readable ? 'read' : undefined,
                                attrs.metadata.metadata.permissions.writable ? 'write' : undefined,
                                attrs.metadata.metadata.permissions.executable
                                  ? 'execute'
                                  : undefined,
                              ]
                                .filter(
                                  (permission): permission is string => permission !== undefined,
                                )
                                .join(', ')}`,
                            ),
                      ],
              ]),
          m('.fm-pane-status', { role: 'status' }, [
            m(
              'span',
              `${ordinaryEntries.length} ${ordinaryEntries.length === 1 ? 'entry' : 'entries'}`,
            ),
            m('span', `${selectedCount} selected`),
            m('span', `${sizeLabel(totalSelectedSize)} selected`),
            m('span', `Sort: ${attrs.sortLabel}`),
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
