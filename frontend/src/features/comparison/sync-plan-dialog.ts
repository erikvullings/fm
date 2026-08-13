import m, { type FactoryComponent } from 'mithril';
import { ModalPanel, Select } from 'mithril-materialized';

import type { ComparisonStatus, SyncAction, SyncPlanItem } from '../../models';

export interface SyncPlanDialogAttrs {
  readonly open: boolean;
  /** The freshly generated proposal; reset into local editable state on open. */
  readonly items: readonly SyncPlanItem[];
  readonly applying?: boolean;
  readonly error?: string;
  readonly onApply: (items: readonly SyncPlanItem[]) => void;
  readonly onCancel: () => void;
}

const STATUS_LABEL: Record<ComparisonStatus, string> = {
  onlyLeft: 'Only left',
  onlyRight: 'Only right',
  newer: 'Left is newer',
  older: 'Left is older',
  differentSize: 'Different size',
  identical: 'Identical',
  typeMismatch: 'Type mismatch',
};

const ACTION_OPTIONS: { id: SyncAction; label: string }[] = [
  { id: 'skip', label: 'Skip' },
  { id: 'copyLeftToRight', label: 'Copy left → right' },
  { id: 'copyRightToLeft', label: 'Copy right → left' },
  { id: 'deleteLeft', label: 'Delete left' },
  { id: 'deleteRight', label: 'Delete right' },
];

function sizeLabel(item: SyncPlanItem): string {
  const left = item.left?.size;
  const right = item.right?.size;
  const format = (value: number | undefined): string => (value === undefined ? '—' : `${value} B`);
  return `${format(left)} / ${format(right)}`;
}

/**
 * Moves focus away from the input before the modal closes, so the browser
 * never has to apply aria-hidden to an ancestor of the focused element.
 */
function blurActive(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/**
 * Reviews and edits a proposed sync plan before applying it (spec §16 milestone 5, §35: nothing
 * runs without this explicit, reviewed confirmation). Every row is independently editable; the
 * plan is applied exactly as shown, never silently.
 */
export const SyncPlanDialog: FactoryComponent<SyncPlanDialogAttrs> = () => {
  let items: SyncPlanItem[] = [];
  let wasOpen = false;

  function setAction(relativePath: string, action: SyncAction): void {
    items = items.map((item) => (item.relativePath === relativePath ? { ...item, action } : item));
  }

  function cancel(attrs: SyncPlanDialogAttrs): void {
    blurActive();
    attrs.onCancel();
  }

  function apply(attrs: SyncPlanDialogAttrs): void {
    blurActive();
    attrs.onApply(items);
  }

  return {
    view: ({ attrs }) => {
      // ModalPanel keeps this component permanently mounted and only toggles CSS visibility, so
      // reset local editable state on the false->true open transition here, mirroring
      // MultiRenameDialog's rationale for doing the same in `view` rather than `onupdate`.
      if (attrs.open && !wasOpen) items = [...attrs.items];
      wasOpen = attrs.open;

      const actionableCount = items.filter((item) => item.action !== 'skip').length;

      return m(ModalPanel, {
        title: 'Review sync plan',
        className: 'fm-dense-modal fm-sync-plan-dialog',
        description: m('.fm-sync-plan-body', [
          items.length === 0
            ? m('p', 'The two directories are identical; there is nothing to synchronize.')
            : m('table.fm-sync-plan-table', [
                m(
                  'thead',
                  m('tr', [
                    m('th', 'Path'),
                    m('th', 'Status'),
                    m('th', 'Size (L / R)'),
                    m('th', 'Action'),
                  ]),
                ),
                m(
                  'tbody',
                  items.map((item) =>
                    m('tr', { key: item.relativePath }, [
                      m('td.fm-sync-plan-path', item.relativePath),
                      m('td', STATUS_LABEL[item.status]),
                      m('td', sizeLabel(item)),
                      m(
                        'td',
                        m(Select, {
                          id: `sync-plan-action-${item.relativePath}`,
                          label: '',
                          options: ACTION_OPTIONS,
                          checkedId: item.action,
                          onchange: (value) => setAction(item.relativePath, value[0] as SyncAction),
                        }),
                      ),
                    ]),
                  ),
                ),
              ]),
          attrs.error === undefined ? undefined : m('.fm-field-error', attrs.error),
        ]),
        isOpen: attrs.open,
        closeOnEsc: true,
        onToggle: (open: boolean) => {
          if (!open) cancel(attrs);
        },
        buttons: [
          { label: 'Cancel', onclick: () => cancel(attrs) },
          {
            label: (attrs.applying ?? false) ? 'Applying…' : `Apply (${actionableCount})`,
            disabled: (attrs.applying ?? false) || actionableCount === 0,
            onclick: () => apply(attrs),
          },
        ],
      });
    },
  };
};
