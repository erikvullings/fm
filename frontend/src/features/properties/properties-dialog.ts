import m, { type FactoryComponent } from 'mithril';
import { ModalPanel } from 'mithril-materialized';

type PropertiesVnode = m.Vnode<unknown, unknown>;

import type { EntryId, EntryMetadata, EntrySummary, Location, PermissionsInfo } from '../../models';
import {
  DEFAULT_ENTRY_FORMAT_SETTINGS,
  type EntryFormatSettings,
  formatEntryModifiedAt,
  formatEntrySize,
} from '../entry-formatting/entry-formatting';
import { computeSelectionAggregate } from './selection-aggregate';

/** The slice of `FileManagerClient` the dialog needs, so tests can supply a minimal stub. */
export interface PropertiesMetadataClient {
  getEntryMetadata(
    request: { entryId: EntryId; location: Location },
    signal?: AbortSignal,
  ): Promise<EntryMetadata>;
}

export interface PropertiesDialogAttrs {
  readonly open: boolean;
  /** One entry shows detailed per-entry properties; more than one shows an aggregate. */
  readonly entries: readonly EntrySummary[];
  readonly client: PropertiesMetadataClient;
  readonly formatSettings?: EntryFormatSettings;
  readonly onCancel: () => void;
}

function kindLabel(entry: EntrySummary): string {
  switch (entry.kind) {
    case 'directory':
      return 'Folder';
    case 'symlink':
      return 'Symbolic link';
    default:
      return 'File';
  }
}

function exactSizeLabel(size: number | undefined): string | undefined {
  if (size === undefined) return undefined;
  return `${new Intl.NumberFormat().format(size)} bytes`;
}

function unixModeLabel(mode: number | undefined): string | undefined {
  if (mode === undefined) return undefined;
  return `0${(mode & 0o777).toString(8)}`;
}

function permissionsLabel(permissions: PermissionsInfo): string {
  const flags = `${permissions.readable ? 'r' : '-'}${permissions.writable ? 'w' : '-'}${
    permissions.executable ? 'x' : '-'
  }`;
  const mode = unixModeLabel(permissions.unixMode);
  return mode === undefined ? flags : `${flags} (${mode})`;
}

function blurActive(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

function propertyRow(label: string, value: string | undefined): PropertiesVnode | undefined {
  return value === undefined ? undefined : m('tr', [m('th', label), m('td', value)]);
}

function sizeRowValue(
  size: number | undefined,
  settings: EntryFormatSettings,
  entryKind: EntrySummary['kind'],
): string | undefined {
  if (size === undefined) return undefined;
  const exact = exactSizeLabel(size);
  return `${exact} (${formatEntrySize({ kind: entryKind, size }, settings)})`;
}

function renderSingle(
  entry: EntrySummary,
  settings: EntryFormatSettings,
  metadata: EntryMetadata | undefined,
  metadataError: string | undefined,
): PropertiesVnode {
  const generalRows = [
    propertyRow('Name', entry.name),
    propertyRow('Kind', kindLabel(entry)),
    propertyRow('Size', sizeRowValue(entry.size, settings, entry.kind)),
    propertyRow(
      'Modified',
      entry.modifiedAt === undefined
        ? undefined
        : formatEntryModifiedAt(entry.modifiedAt, settings),
    ),
    propertyRow(
      'Created',
      entry.createdAt === undefined ? undefined : formatEntryModifiedAt(entry.createdAt, settings),
    ),
    propertyRow('Location', entry.location.uri),
  ];

  const permissionRows = [
    metadata?.permissions === undefined
      ? undefined
      : propertyRow('Permissions', permissionsLabel(metadata.permissions)),
    propertyRow('Owner', metadata?.ownership?.owner),
    propertyRow('Group', metadata?.ownership?.group),
  ].filter((row): row is PropertiesVnode => row !== undefined);

  const archiveRows = [
    propertyRow('Compressed size', exactSizeLabel(metadata?.archive?.compressedSize)),
    propertyRow('Uncompressed size', exactSizeLabel(metadata?.archive?.uncompressedSize)),
    propertyRow('Compression method', metadata?.archive?.compressionMethod),
  ].filter((row): row is PropertiesVnode => row !== undefined);

  return m('.fm-properties-body', [
    m('table.fm-properties-table', m('tbody', generalRows)),
    permissionRows.length === 0
      ? undefined
      : [
          m('h5', 'Permissions & ownership'),
          m('table.fm-properties-table', m('tbody', permissionRows)),
        ],
    archiveRows.length === 0
      ? undefined
      : [m('h5', 'Archive'), m('table.fm-properties-table', m('tbody', archiveRows))],
    metadataError === undefined ? undefined : m('.fm-field-error', metadataError),
  ]);
}

function renderAggregate(
  entries: readonly EntrySummary[],
  settings: EntryFormatSettings,
): PropertiesVnode {
  const aggregate = computeSelectionAggregate(entries);
  const rows = [
    propertyRow('Items', `${aggregate.itemCount}`),
    propertyRow('Files', `${aggregate.fileCount}`),
    propertyRow('Folders', `${aggregate.folderCount}`),
    propertyRow('Total size', sizeRowValue(aggregate.totalSize, settings, 'file')),
  ];
  return m('.fm-properties-body', m('table.fm-properties-table', m('tbody', rows)));
}

/**
 * Alt+Enter Properties dialog (task 0140): per-entry detail for a single selection (byte-precise
 * size, timestamps, permissions, provider-specific metadata fetched lazily via
 * `getEntryMetadata`), or a 0097-style size/count aggregate for a multi-selection.
 */
export const PropertiesDialog: FactoryComponent<PropertiesDialogAttrs> = () => {
  let wasOpen = false;
  let requestedEntryId: EntryId | undefined;
  let metadata: EntryMetadata | undefined;
  let metadataError: string | undefined;
  let abortController: AbortController | undefined;

  function cancel(attrs: PropertiesDialogAttrs): void {
    blurActive();
    attrs.onCancel();
  }

  return {
    view: ({ attrs }) => {
      const singleEntry = attrs.entries.length === 1 ? attrs.entries[0] : undefined;

      if (!attrs.open && wasOpen) {
        abortController?.abort();
        abortController = undefined;
        requestedEntryId = undefined;
        metadata = undefined;
        metadataError = undefined;
      }
      wasOpen = attrs.open;

      if (attrs.open && singleEntry !== undefined && requestedEntryId !== singleEntry.id) {
        requestedEntryId = singleEntry.id;
        metadata = undefined;
        metadataError = undefined;
        abortController?.abort();
        const controller = new AbortController();
        abortController = controller;
        attrs.client
          .getEntryMetadata(
            { entryId: singleEntry.id, location: singleEntry.location },
            controller.signal,
          )
          .then((result) => {
            if (controller.signal.aborted) return;
            metadata = result;
            m.redraw();
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            metadataError = error instanceof Error ? error.message : 'Unable to load metadata';
            m.redraw();
          });
      }

      const settings = attrs.formatSettings ?? DEFAULT_ENTRY_FORMAT_SETTINGS;

      return m(ModalPanel, {
        title: 'Properties',
        className: 'fm-dense-modal fm-properties-dialog',
        description:
          singleEntry === undefined
            ? renderAggregate(attrs.entries, settings)
            : renderSingle(singleEntry, settings, metadata, metadataError),
        isOpen: attrs.open,
        closeOnEsc: true,
        onToggle: (open: boolean) => {
          if (!open) cancel(attrs);
        },
        buttons: [{ label: 'Close', onclick: () => cancel(attrs) }],
      });
    },
  };
};
