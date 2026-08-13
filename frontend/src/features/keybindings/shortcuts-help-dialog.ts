import m, { type FactoryComponent } from 'mithril';
import { ModalPanel } from 'mithril-materialized';
import { getLiveBindings, type KeybindingRuntime } from '../../keybindings/dispatcher';
import type { ActionDescriptor } from '../../models';
import type { SelectionPlatform } from '../selection/keybindings';

export interface ShortcutsHelpDialogAttrs {
  readonly open: boolean;
  readonly actions: readonly ActionDescriptor[];
  readonly keybindings: Readonly<Record<string, string>>;
  readonly platform: SelectionPlatform;
  readonly runtime: KeybindingRuntime;
  readonly onClose: () => void;
}

/**
 * Read-only F1 "keyboard shortcuts" overlay (Total Commander parity, task 0128). Reuses
 * `getLiveBindings` - the same live-binding resolution the settings editor's conflict-detection
 * view is built on - rather than a second hardcoded shortcut list that could drift from the
 * actual registry.
 */
export const ShortcutsHelpDialog: FactoryComponent<ShortcutsHelpDialogAttrs> = () => {
  return {
    view: ({ attrs }) => {
      const context = { scope: 'table' as const, platform: attrs.platform, runtime: attrs.runtime };
      const bindings = getLiveBindings(attrs.actions, attrs.keybindings, context)
        .filter((binding) => binding.available)
        .flatMap((binding) => {
          const action = attrs.actions.find((candidate) => candidate.id === binding.actionId);
          return action === undefined ? [] : [{ binding, action }];
        })
        .sort((a, b) => a.action.title.localeCompare(b.action.title));
      return m(ModalPanel, {
        title: 'Keyboard Shortcuts',
        className: 'fm-shortcuts-help-modal',
        description: m(
          'table.fm-shortcuts-help-table',
          m(
            'tbody',
            bindings.map(({ binding, action }) =>
              m('tr', { key: `${action.id}:${binding.shortcut}` }, [
                m('td', action.title),
                m('td', m('kbd', binding.shortcut)),
              ]),
            ),
          ),
        ),
        isOpen: attrs.open,
        closeOnEsc: true,
        onToggle: (open: boolean) => {
          if (!open) attrs.onClose();
        },
        buttons: [{ label: 'Close', onclick: () => attrs.onClose() }],
      });
    },
  };
};
