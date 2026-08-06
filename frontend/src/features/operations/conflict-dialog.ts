import m, { type FactoryComponent } from 'mithril';
import { ModalPanel } from 'mithril-materialized';
import type { ConflictResolution, OperationConflict } from '../../models';

export interface ConflictDialogAttrs {
  readonly conflict: OperationConflict | undefined;
  readonly onResolve: (resolution: ConflictResolution, applyToAllSimilar: boolean) => void;
}

/**
 * Explicit request/response dialog for a pending filesystem conflict.
 *
 * Uses mm's `ModalPanel` (like every other dialog) rather than a bare
 * `role="dialog"` div, so it gets the app's shared modal chrome (backdrop,
 * centering, button styling) for free instead of rendering inline/unstyled.
 * Unlike the other dialogs, this component is only mounted at all while a
 * conflict is pending (`isOpen` is always true when rendered) -- mm's
 * ModalPanel keeps its title/description text in the DOM even while closed
 * (only toggled via CSS `display`), which would otherwise leak the dialog's
 * text into `textContent` between conflicts.
 */
export const ConflictDialog: FactoryComponent<ConflictDialogAttrs> = () => {
  let applyToAllSimilar = false;
  return {
    view: ({ attrs }) => {
      const conflict = attrs.conflict;
      if (conflict === undefined) return undefined;
      const resolve = (resolution: ConflictResolution) =>
        attrs.onResolve(resolution, applyToAllSimilar);
      return m(ModalPanel, {
        id: 'conflict-dialog',
        title: 'Resolve conflict',
        className: 'fm-conflict-dialog',
        isOpen: true,
        showCloseButton: false,
        closeOnBackdropClick: false,
        closeOnEsc: false,
        description: m('div', [
          m('p', conflict.message),
          m('dl.fm-conflict-dialog-entries', [
            m('dt', 'Source'),
            m(
              'dd',
              `${conflict.source.name} · ${conflict.source.size ?? 'size unavailable'} · ${conflict.source.modifiedAt ?? 'modified time unavailable'}`,
            ),
            m('dt', 'Destination'),
            m(
              'dd',
              `${conflict.destination.name} · ${conflict.destination.size ?? 'size unavailable'} · ${conflict.destination.modifiedAt ?? 'modified time unavailable'}`,
            ),
          ]),
          m('label.fm-conflict-dialog-checkbox', [
            m('input', {
              type: 'checkbox',
              onchange: (event: Event) => {
                applyToAllSimilar = (event.currentTarget as HTMLInputElement).checked;
              },
            }),
            m('span', 'Apply to all similar conflicts'),
          ]),
        ]),
        buttons: [
          { label: 'Cancel operation', onclick: () => resolve('cancelOperation') },
          { label: 'Skip', onclick: () => resolve('skip') },
          { label: 'Rename new', onclick: () => resolve('renameNew') },
          { label: 'Overwrite', onclick: () => resolve('overwrite') },
        ],
      });
    },
  };
};
