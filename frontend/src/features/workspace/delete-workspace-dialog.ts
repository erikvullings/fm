import m, { type FactoryComponent } from 'mithril';
import { ModalPanel } from 'mithril-materialized';

export interface DeleteWorkspaceDialogAttrs {
  readonly open: boolean;
  readonly workspaceName: string | undefined;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Destructive-deletion confirmation, mirroring `CloseLastTabDialog`'s pattern. */
export const DeleteWorkspaceDialog: FactoryComponent<DeleteWorkspaceDialogAttrs> = () => ({
  view: ({ attrs }) =>
    m(ModalPanel, {
      title: 'Delete this workspace?',
      description: m(
        'p',
        `This permanently deletes "${attrs.workspaceName ?? 'this workspace'}" and its saved ` +
          'layout. This cannot be undone.',
      ),
      isOpen: attrs.open,
      closeOnEsc: true,
      onToggle: (open: boolean) => {
        if (!open) attrs.onCancel();
      },
      buttons: [
        { label: 'Cancel', onclick: attrs.onCancel, className: 'fm-delete-workspace-cancel' },
        { label: 'Delete workspace', onclick: attrs.onConfirm },
      ],
    }),
});
