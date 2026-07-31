import m, { type FactoryComponent } from 'mithril';
import type { ConflictResolution, OperationConflict } from '../../models';

export interface ConflictDialogAttrs {
  readonly conflict: OperationConflict | undefined;
  readonly onResolve: (resolution: ConflictResolution, applyToAllSimilar: boolean) => void;
}

/** Explicit request/response dialog for a pending filesystem conflict. */
export const ConflictDialog: FactoryComponent<ConflictDialogAttrs> = () => {
  let applyToAllSimilar = false;
  return {
    view: ({ attrs }) => {
      const conflict = attrs.conflict;
      if (conflict === undefined) return undefined;
      const resolve = (resolution: ConflictResolution) =>
        attrs.onResolve(resolution, applyToAllSimilar);
      return m('div.fm-conflict-dialog', { role: 'dialog', 'aria-modal': 'true' }, [
        m('h2', 'Resolve conflict'),
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
        m('label', [
          m('input', {
            type: 'checkbox',
            onchange: (event: Event) => {
              applyToAllSimilar = (event.currentTarget as HTMLInputElement).checked;
            },
          }),
          ' Apply to all similar conflicts',
        ]),
        m('div.fm-conflict-dialog-actions', [
          m(
            'button',
            { type: 'button', onclick: () => resolve('cancelOperation') },
            'Cancel operation',
          ),
          m('button', { type: 'button', onclick: () => resolve('skip') }, 'Skip'),
          m('button', { type: 'button', onclick: () => resolve('renameNew') }, 'Rename new'),
          m('button', { type: 'button', onclick: () => resolve('overwrite') }, 'Overwrite'),
        ]),
      ]);
    },
  };
};
