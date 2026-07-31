import m, { type FactoryComponent } from 'mithril';
import { ModalPanel } from 'mithril-materialized';

export interface PermanentDeleteDialogAttrs {
  readonly open: boolean;
  readonly itemCount: number;
  readonly totalBytes: number;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Irreversible-delete confirmation shown only after backend planning completes. */
export const PermanentDeleteDialog: FactoryComponent<PermanentDeleteDialogAttrs> = () => {
  let keydownHandler: ((event: KeyboardEvent) => void) | undefined;

  const removeFocusTrap = () => {
    if (keydownHandler !== undefined) document.removeEventListener('keydown', keydownHandler);
    keydownHandler = undefined;
  };

  const updateFocusTrap = (dom: Element, open: boolean) => {
    removeFocusTrap();
    if (!open) return;
    const dialog = dom.closest('[role="dialog"]');
    const cancel = dialog?.querySelector<HTMLButtonElement>('.fm-permanent-delete-cancel');
    cancel?.focus();
    keydownHandler = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || dialog === null) return;
      const focusable = [...dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydownHandler);
  };

  return {
    view: ({ attrs }) =>
      m(ModalPanel, {
        title: 'Permanently delete?',
        description: m(
          '.fm-permanent-delete-warning',
          {
            oncreate: ({ dom }) => updateFocusTrap(dom, attrs.open),
            onupdate: ({ dom }) => updateFocusTrap(dom, attrs.open),
            onremove: removeFocusTrap,
          },
          [
            m(
              'p',
              `This will permanently delete ${attrs.itemCount} items (${attrs.totalBytes} bytes).`,
            ),
            m('strong', 'This action is irreversible.'),
          ],
        ),
        isOpen: attrs.open,
        closeOnEsc: true,
        onToggle: (open: boolean) => {
          if (!open) attrs.onCancel();
        },
        buttons: [
          {
            label: 'Cancel',
            onclick: attrs.onCancel,
            className: 'fm-permanent-delete-cancel',
          },
          { label: 'Delete permanently', onclick: attrs.onConfirm },
        ],
      }),
  };
};
