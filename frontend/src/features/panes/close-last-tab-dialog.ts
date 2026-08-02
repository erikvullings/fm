import m, { type FactoryComponent } from 'mithril';
import { ModalPanel } from 'mithril-materialized';

/** Confirmation gate for closing a pane's only remaining tab (spec §37). */
export interface CloseLastTabDialogAttrs {
  readonly open: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export const CloseLastTabDialog: FactoryComponent<CloseLastTabDialogAttrs> = () => ({
  view: ({ attrs }) =>
    m(ModalPanel, {
      title: 'Close the only tab?',
      description: m('p', 'This pane has no other tabs. Closing it will leave the pane empty.'),
      isOpen: attrs.open,
      closeOnEsc: true,
      onToggle: (open: boolean) => {
        if (!open) attrs.onCancel();
      },
      buttons: [
        { label: 'Cancel', onclick: attrs.onCancel, className: 'fm-close-last-tab-cancel' },
        { label: 'Close tab', onclick: attrs.onConfirm },
      ],
    }),
});
