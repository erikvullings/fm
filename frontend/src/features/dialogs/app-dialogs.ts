import m from 'mithril';
import type { FileManagerClient } from '../../api/client/file-manager-client';
import type {
  Connection,
  Location,
  OperationConflict,
  OperationId,
  PaneId,
  TabId,
} from '../../models';
import { ConnectionsManager } from '../connections/connection-editor';
import {
  acceptSshHostKey as acceptSshHostKeyRequest,
  connectConnection as connectConnectionRequest,
  deleteConnection as deleteConnectionRequest,
  disconnectConnection as disconnectConnectionRequest,
  loadConnections,
  probeSshHostKey as probeSshHostKeyRequest,
  saveConnection,
  testConnection as testConnectionRequest,
  upsertConnection,
  withoutConnection,
} from '../connections/connections-model';
import type { DialogUIController } from '../dialogs/dialog-ui-controller';
import type { FinderTagsLoader } from '../directory-table/finder-tags-loader';
import { FinderTagsDialog } from '../entry-metadata/finder-tags-dialog';
import { SpotlightCommentDialog } from '../entry-metadata/spotlight-comment-dialog';
import { ArchivePasswordDialog } from '../navigation/archive-password-dialog';
import { ArchiveCreateDialog, type ArchiveFormat } from '../operations/archive-create-dialog';
import { ConflictDialog } from '../operations/conflict-dialog';
import { CreateDirectoryDialog } from '../operations/create-directory-dialog';
import { CreateFileDialog } from '../operations/create-file-dialog';
import { MultiRenameDialog } from '../operations/multi-rename-dialog';
import { OperationCentre } from '../operations/operation-centre';
import {
  dismissOperation,
  type OperationCentreState,
  transitionOperationState,
} from '../operations/operation-state';
import type { OperationsController } from '../operations/operations-controller';
import { PermanentDeleteDialog } from '../operations/permanent-delete-dialog';
import { CloseLastTabDialog } from '../panes/close-last-tab-dialog';
import type { TabController } from '../panes/tab-controller';
import type { FindFilesController } from '../search/find-files-controller';
import type { FindFilesSearchParams } from '../search/find-files-dialog';
import { FindFilesDialog } from '../search/find-files-dialog';
import { pathFromUri } from '../workspace/workspace-layout';

export interface AppDialogsContext {
  getOperations(): OperationCentreState;
  setOperations(next: OperationCentreState): void;
  getPendingConflict(): OperationConflict | undefined;
  setPendingConflict(conflict: OperationConflict | undefined): void;
  getConnections(): readonly Connection[];
  setConnections(conns: readonly Connection[]): void;
  getConnectionsManagerOpen(): boolean;
  setConnectionsManagerOpen(open: boolean): void;
  getFindFilesOpen(): boolean;
  getFindFilesRoot(): Location | undefined;
  getFindFilesError(): string | undefined;
  getCloseTabConfirmation(): { readonly paneId: PaneId; readonly tabId: TabId } | undefined;
  setCloseTabConfirmation(conf?: { readonly paneId: PaneId; readonly tabId: TabId }): void;
  getDialogs(): DialogUIController;
  getFinderTagsLoader(): FinderTagsLoader | undefined;
  getFindFilesController(): FindFilesController;
  getTabController(): TabController;
  getOpsController(): OperationsController;
  getActiveDirectoryLocation(): Location | undefined;
  /** Opens the just-created file (Shift+F4) in the active pane's editor. */
  openEditorForCreatedFile(location: Location, name: string): void;
  cancelAutoDismiss(operationId: OperationId): void;
  rememberDismissedOperation(operationId: OperationId): void;
  refetchAffectedPanes(): void;
  redraw(): void;
}

export function renderAppDialogs(
  client: FileManagerClient,
  pendingDelete: OperationCentreState['byId'][string],
  ctx: AppDialogsContext,
): m.Children[] {
  const dialogs = ctx.getDialogs();
  const ds = dialogs.getState();

  return [
    m(OperationCentre, {
      state: ctx.getOperations(),
      onCancel: (operationId) => {
        ctx.setOperations(transitionOperationState(ctx.getOperations(), operationId, 'cancelling'));
        void client.cancelOperation(operationId).catch(() => undefined);
      },
      onPause: (operationId) => {
        ctx.setOperations(transitionOperationState(ctx.getOperations(), operationId, 'paused'));
        void client.pauseOperation(operationId).catch(() => undefined);
      },
      onResume: (operationId) => {
        ctx.setOperations(transitionOperationState(ctx.getOperations(), operationId, 'running'));
        void client.resumeOperation(operationId).catch(() => undefined);
      },
      onDismiss: (operationId) => {
        ctx.cancelAutoDismiss(operationId);
        ctx.rememberDismissedOperation(operationId);
        ctx.setOperations(dismissOperation(ctx.getOperations(), operationId));
      },
    }),
    m(CreateDirectoryDialog, {
      open: ds.createDirectoryOpen,
      onCancel: () => dialogs.cancelCreateDirectory(),
      onConfirm: (name: string) =>
        dialogs.confirmCreateDirectory(name, ctx.getActiveDirectoryLocation(), (loc, n) =>
          ctx
            .getOpsController()
            .createDirectory(loc, n)
            .then(() => undefined),
        ),
    }),
    m(CreateFileDialog, {
      open: ds.createFileOpen,
      onCancel: () => dialogs.cancelCreateFile(),
      onConfirm: (name: string) =>
        dialogs.confirmCreateFile(name, ctx.getActiveDirectoryLocation(), (loc, n) =>
          ctx
            .getOpsController()
            .createFile(loc, n)
            .then(() => {
              ctx.openEditorForCreatedFile(loc, n);
            }),
        ),
    }),
    m(ArchiveCreateDialog, {
      open: ds.archiveCreateRequest !== undefined,
      moveSources: ds.archiveCreateRequest?.moveSources ?? false,
      onCancel: () => dialogs.cancelArchiveCreate(),
      onConfirm: (name: string, format: ArchiveFormat, compressionLevel?: number) => {
        const request = ds.archiveCreateRequest;
        if (request === undefined) return;
        dialogs.cancelArchiveCreate();
        void ctx.getOpsController().pack(
          request.sources,
          {
            ...request.destinationDirectory,
            uri: `${request.destinationDirectory.uri.replace(/\/$/u, '')}/${encodeURIComponent(name)}`,
          },
          request.moveSources,
          format,
          compressionLevel,
        );
      },
    }),
    m(MultiRenameDialog, {
      open: ds.multiRenameOpen,
      entries: ds.multiRenameEntries,
      existingSiblingNames: ds.multiRenameExistingNames,
      onCancel: () => dialogs.cancelMultiRename(),
      onApply: (renamed) => {
        const { multiRenameLocation: location, multiRenameEntries: entries } = ds;
        dialogs.cancelMultiRename();
        if (location === undefined) return;
        const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
        const sources: Location[] = [];
        const destinations: Location[] = [];
        for (const { id, newName } of renamed) {
          const entry = entriesById.get(id);
          if (entry === undefined) continue;
          sources.push(entry.location);
          destinations.push({
            ...entry.location,
            uri: `${location.uri.replace(/\/$/u, '')}/${encodeURIComponent(newName)}`,
          });
        }
        if (sources.length === 0) return;
        void ctx.getOpsController().multiRename(sources, destinations);
      },
    }),
    m(ArchivePasswordDialog, {
      open: ds.pendingArchiveCredential !== undefined,
      invalid: ds.pendingArchiveCredential?.invalid ?? false,
      archiveLabel:
        ds.pendingArchiveCredential === undefined
          ? ''
          : pathFromUri(ds.pendingArchiveCredential.location.uri),
      ...(ds.archiveCredentialError === undefined ? {} : { error: ds.archiveCredentialError }),
      onCancel: () => {
        const pending = ds.pendingArchiveCredential;
        dialogs.clearArchiveCredential();
        pending?.resolve(false);
      },
      onConfirm: (password: string) => {
        const pending = ds.pendingArchiveCredential;
        if (pending === undefined) return;
        void client
          .cacheArchivePassword({ location: pending.location, password })
          .then(() => {
            if (ds.pendingArchiveCredential === pending) {
              dialogs.clearArchiveCredential();
              pending.resolve(true);
              ctx.redraw();
            }
          })
          .catch((error: unknown) => {
            dialogs.setArchiveCredentialError(
              error instanceof Error ? error.message : 'Unable to cache archive password',
            );
            ctx.redraw();
          });
      },
    }),
    m(ConnectionsManager, {
      open: ctx.getConnectionsManagerOpen(),
      connections: ctx.getConnections(),
      onRefresh: async () => {
        ctx.setConnections(await loadConnections(client));
      },
      onClose: () => {
        ctx.setConnectionsManagerOpen(false);
        ctx.redraw();
      },
      onSave: async (draft, editingId) => {
        const result = await saveConnection(client, draft, editingId);
        if (result.ok)
          ctx.setConnections(upsertConnection(ctx.getConnections(), result.connection));
        return result;
      },
      onDelete: async (id) => {
        await deleteConnectionRequest(client, id);
        ctx.setConnections(withoutConnection(ctx.getConnections(), id));
      },
      onConnect: async (id) => {
        const updated = await connectConnectionRequest(client, id);
        ctx.setConnections(upsertConnection(ctx.getConnections(), updated));
        return updated;
      },
      onDisconnect: async (id) => {
        const updated = await disconnectConnectionRequest(client, id);
        ctx.setConnections(upsertConnection(ctx.getConnections(), updated));
        return updated;
      },
      onTest: async (id) => {
        const updated = await testConnectionRequest(client, id);
        ctx.setConnections(upsertConnection(ctx.getConnections(), updated));
        return updated;
      },
      onProbeHostKey: (id) => probeSshHostKeyRequest(client, id),
      onAcceptHostKey: (id, fingerprint) => acceptSshHostKeyRequest(client, id, fingerprint),
    }),
    m(
      FindFilesDialog,
      (() => {
        const findFilesRoot = ctx.getFindFilesRoot();
        const findFilesError = ctx.getFindFilesError();
        return {
          open: ctx.getFindFilesOpen(),
          scopeLabel: findFilesRoot === undefined ? '' : pathFromUri(findFilesRoot.uri),
          ...(findFilesError === undefined ? {} : { error: findFilesError }),
          onSearch: (params: FindFilesSearchParams) =>
            ctx.getFindFilesController().startFindFilesSearch(params),
          onCancel: () => ctx.getFindFilesController().closeFindFiles(),
        };
      })(),
    ),
    m(PermanentDeleteDialog, {
      open: pendingDelete !== undefined,
      itemCount: pendingDelete?.progress.totalItems ?? 0,
      totalBytes: pendingDelete?.progress.totalBytes ?? 0,
      onCancel: () => {
        if (pendingDelete !== undefined) void client.cancelOperation(pendingDelete.id);
      },
      onConfirm: () => {
        if (pendingDelete !== undefined) {
          const id = pendingDelete.id;
          ctx.setOperations(transitionOperationState(ctx.getOperations(), id, 'running'));
          ctx.redraw();
          void client
            .resolveConflict({
              operationId: id,
              resolution: 'confirm',
              applyToAllSimilar: false,
            })
            .then(() => {
              ctx.refetchAffectedPanes();
              ctx.redraw();
            })
            .catch(() => {
              ctx.setOperations(
                transitionOperationState(ctx.getOperations(), id, 'waitingForConflictResolution'),
              );
              ctx.redraw();
            });
        }
      },
    }),
    m(ConflictDialog, {
      conflict: ctx.getPendingConflict(),
      onResolve: (resolution, applyToAllSimilar) => {
        const conflict = ctx.getPendingConflict();
        if (conflict === undefined) return;
        void client
          .resolveConflict({ operationId: conflict.operationId, resolution, applyToAllSimilar })
          .then(() => {
            if (ctx.getPendingConflict()?.conflictId === conflict.conflictId) {
              ctx.setPendingConflict(undefined);
              ctx.refetchAffectedPanes();
              ctx.redraw();
            }
          });
      },
    }),
    m(CloseLastTabDialog, {
      open: ctx.getCloseTabConfirmation() !== undefined,
      onConfirm: () => {
        const confirmation = ctx.getCloseTabConfirmation();
        ctx.setCloseTabConfirmation(undefined);
        if (confirmation !== undefined) {
          ctx.getTabController().performCloseTab(confirmation.paneId, confirmation.tabId);
        }
      },
      onCancel: () => ctx.setCloseTabConfirmation(undefined),
    }),
    m(FinderTagsDialog, {
      open: ds.finderTagsDialog !== undefined,
      entryName: ds.finderTagsDialog?.entry.name ?? '',
      initialTags: ds.finderTagsDialog?.tags ?? [],
      onCancel: () => dialogs.cancelFinderTagsDialog(),
      onConfirm: (tags) => {
        const request = ds.finderTagsDialog;
        dialogs.cancelFinderTagsDialog();
        if (request === undefined) return;
        void client
          .setFinderTags(request.entry.location.uri, { tags: [...tags] })
          .then((persisted) => {
            ctx.getFinderTagsLoader()?.setCached(request.entry.location.uri, persisted);
          })
          .catch(() => undefined);
      },
    }),
    m(SpotlightCommentDialog, {
      open: ds.spotlightCommentDialog !== undefined,
      entryName: ds.spotlightCommentDialog?.entry.name ?? '',
      initialComment: ds.spotlightCommentDialog?.comment ?? '',
      onCancel: () => dialogs.cancelSpotlightCommentDialog(),
      onConfirm: (comment) => {
        const request = ds.spotlightCommentDialog;
        dialogs.cancelSpotlightCommentDialog();
        if (request === undefined) return;
        void client
          .setSpotlightComment(request.entry.location.uri, {
            comment: comment.trim().length === 0 ? null : comment,
          })
          .catch(() => undefined);
      },
    }),
  ];
}
