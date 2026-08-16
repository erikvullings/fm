import m, { type FactoryComponent } from 'mithril';
import { IconButton } from 'mithril-materialized';

import { externalLinkIcon, pencilIcon, trashIcon } from '../../components/tabler-icons';
import { tooltip } from '../../components/tooltip';
import type { WorkspaceId, WorkspaceSummary } from '../../models';
import { DeleteWorkspaceDialog } from './delete-workspace-dialog';

export interface WorkspaceSwitcherAttrs {
  readonly summaries: readonly WorkspaceSummary[];
  readonly activeWorkspaceId: WorkspaceId | undefined;
  readonly error: string | undefined;
  readonly onSwitch: (workspaceId: WorkspaceId) => void;
  readonly onCreate: () => void;
  readonly onRename: (workspaceId: WorkspaceId, name: string) => void;
  readonly onDelete: (workspaceId: WorkspaceId) => void;
  /** Opens the workspace in its own OS window (task 0143 sub-task (b)); omitted entirely on hosts
   * with no window concept (browser/HTTP), so the button below only renders on desktop. */
  readonly onOpenInNewWindow?: (workspaceId: WorkspaceId) => void;
}

/**
 * Lists persisted workspaces, and lets the user switch, create, rename and
 * delete them through the semantic `FileManagerClient` operations owned by
 * `app-shell.ts` (task 0084) — this component only renders UI-local state
 * (which row is being renamed or confirmed for deletion).
 */
export const WorkspaceSwitcher: FactoryComponent<WorkspaceSwitcherAttrs> = () => {
  let renamingId: WorkspaceId | undefined;
  let renameDraft = '';
  let pendingDeleteId: WorkspaceId | undefined;

  function beginRename(summary: WorkspaceSummary): void {
    renamingId = summary.id;
    renameDraft = summary.name;
  }

  function submitRename(attrs: WorkspaceSwitcherAttrs, workspaceId: WorkspaceId): void {
    const trimmed = renameDraft.trim();
    renamingId = undefined;
    if (trimmed.length > 0) attrs.onRename(workspaceId, trimmed);
  }

  return {
    view: ({ attrs }) => {
      const pendingDelete = attrs.summaries.find((summary) => summary.id === pendingDeleteId);
      return m('.fm-workspace-switcher', { 'aria-label': 'Workspaces' }, [
        attrs.error === undefined
          ? undefined
          : m('.fm-workspace-switcher-error', { role: 'alert' }, attrs.error),
        attrs.summaries.length === 0
          ? m('.fm-workspace-switcher-empty', 'No workspaces yet.')
          : m(
              'ul.fm-workspace-switcher-list',
              attrs.summaries.map((summary) => {
                const active = summary.id === attrs.activeWorkspaceId;
                const renaming = renamingId === summary.id;
                return m(
                  'li.fm-workspace-switcher-row',
                  {
                    key: summary.id,
                    'data-workspace-id': summary.id,
                    'data-active': String(active),
                  },
                  [
                    renaming
                      ? m(
                          'form.fm-workspace-rename-form',
                          {
                            onsubmit: (event: SubmitEvent) => {
                              event.preventDefault();
                              submitRename(attrs, summary.id);
                            },
                          },
                          [
                            m('input', {
                              type: 'text',
                              'aria-label': `Rename ${summary.name}`,
                              value: renameDraft,
                              oninput: (event: InputEvent) => {
                                renameDraft = (event.target as HTMLInputElement).value;
                              },
                            }),
                            m('button', { type: 'submit' }, 'Save'),
                            m(
                              'button',
                              {
                                type: 'button',
                                onclick: () => {
                                  renamingId = undefined;
                                },
                              },
                              'Cancel',
                            ),
                          ],
                        )
                      : m(
                          'button.fm-workspace-switcher-name',
                          {
                            type: 'button',
                            'aria-current': active ? 'true' : undefined,
                            onclick: () => {
                              if (!active) attrs.onSwitch(summary.id);
                            },
                          },
                          summary.name,
                        ),
                    renaming || attrs.onOpenInNewWindow === undefined
                      ? undefined
                      : tooltip(
                          `Open ${summary.name} in a new window`,
                          m(
                            IconButton,
                            {
                              type: 'button',
                              className: 'fm-workspace-open-window-button',
                              'aria-label': `Open ${summary.name} in a new window`,
                              onclick: () => attrs.onOpenInNewWindow?.(summary.id),
                            },
                            externalLinkIcon({ size: 16 }),
                          ),
                        ),
                    renaming
                      ? undefined
                      : tooltip(
                          `Rename ${summary.name}`,
                          m(
                            IconButton,
                            {
                              type: 'button',
                              className: 'fm-workspace-rename-button',
                              'aria-label': `Rename ${summary.name}`,
                              onclick: () => beginRename(summary),
                            },
                            pencilIcon({ size: 16 }),
                          ),
                        ),
                    renaming
                      ? undefined
                      : tooltip(
                          `Delete ${summary.name}`,
                          m(
                            IconButton,
                            {
                              type: 'button',
                              className: 'fm-workspace-delete-button',
                              'aria-label': `Delete ${summary.name}`,
                              onclick: () => {
                                pendingDeleteId = summary.id;
                              },
                            },
                            trashIcon({ size: 16 }),
                          ),
                        ),
                  ],
                );
              }),
            ),
        m(
          'button.fm-workspace-create-button',
          { type: 'button', onclick: attrs.onCreate },
          'New workspace',
        ),
        m(DeleteWorkspaceDialog, {
          open: pendingDeleteId !== undefined,
          workspaceName: pendingDelete?.name,
          onConfirm: () => {
            const workspaceId = pendingDeleteId;
            pendingDeleteId = undefined;
            if (workspaceId !== undefined) attrs.onDelete(workspaceId);
          },
          onCancel: () => {
            pendingDeleteId = undefined;
          },
        }),
      ]);
    },
  };
};
