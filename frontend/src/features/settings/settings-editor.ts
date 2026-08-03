import m, { type FactoryComponent } from 'mithril';
import { NumberInput, Select, Switch, TextInput, ThemeSwitcher } from 'mithril-materialized';

import {
  detectBindingConflicts,
  getLiveBindings,
  type KeybindingRuntime,
} from '../../keybindings/dispatcher';
import type {
  ActionDescriptor,
  PluginDescriptor,
  PluginId,
  PluginLogEntry,
  Settings,
} from '../../models';
import { PluginManagement } from '../plugin-management/plugin-management';
import type { SelectionPlatform } from '../selection/keybindings';
import {
  cloneSettings,
  formatListInput,
  parseListInput,
  setKeybindingOverride,
  validateSettingsDraft,
} from './settings-model';

export interface SettingsEditorAttrs {
  readonly settings: Settings;
  readonly actions: readonly ActionDescriptor[];
  readonly platform: SelectionPlatform;
  readonly runtime: KeybindingRuntime;
  readonly plugins: readonly PluginDescriptor[];
  /** Called on every draft change so appearance fields can preview live without persisting. */
  readonly onPreview: (draft: Settings) => void;
  readonly onSave: (draft: Settings) => Promise<void>;
  readonly onCancel: () => void;
  readonly onTogglePlugin: (pluginId: PluginId, enabled: boolean) => Promise<void>;
  readonly onRequestPluginLogs: (pluginId: PluginId) => Promise<readonly PluginLogEntry[]>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Complete settings editor (task 0083): appearance, file behavior, operations,
 * new-workspace defaults, terminal command, keybindings, and plugins. Draft
 * edits preview live (appearance) but only persist through one `onSave` call
 * on the whole document; `onCancel` discards them.
 */
export const SettingsEditor: FactoryComponent<SettingsEditorAttrs> = () => {
  // Seeded lazily from the first real `view()` call rather than the factory's
  // own vnode argument, since only the former is guaranteed to carry attrs.
  let draft: Settings | undefined;
  let columnsText = '';
  let startLocationsText = '';
  let saving = false;
  let saveError: string | undefined;

  function resetDraft(current: SettingsEditorAttrs): void {
    draft = cloneSettings(current.settings);
    columnsText = formatListInput(draft.defaultColumns);
    startLocationsText = formatListInput(draft.defaultStartLocations);
    saveError = undefined;
  }

  function update(current: SettingsEditorAttrs, patch: Partial<Settings>): void {
    if (draft === undefined) return;
    draft = { ...draft, ...patch };
    current.onPreview(draft);
    m.redraw();
  }

  function handleCancel(current: SettingsEditorAttrs): void {
    resetDraft(current);
    current.onCancel();
  }

  function handleSave(current: SettingsEditorAttrs): void {
    if (draft === undefined) return;
    saving = true;
    saveError = undefined;
    current.onSave(draft).then(
      () => {
        saving = false;
        m.redraw();
      },
      (error: unknown) => {
        saving = false;
        saveError = errorMessage(error, 'Failed to save settings.');
        m.redraw();
      },
    );
  }

  return {
    view: ({ attrs: current }) => {
      if (draft === undefined) {
        resetDraft(current);
      }
      const activeDraft = draft as Settings;
      const errors = validateSettingsDraft(activeDraft);
      const errorsByField = new Map<string, string>(
        errors.map((error): [string, string] => [error.field, error.message]),
      );
      // exactOptionalPropertyTypes forbids assigning `dataError: string | undefined`
      // directly; spread this instead so the key is omitted entirely when unset.
      function errorAttrs(field: string): { dataError?: string } {
        const message = errorsByField.get(field);
        return message === undefined ? {} : { dataError: message };
      }
      const context = {
        scope: 'table' as const,
        platform: current.platform,
        runtime: current.runtime,
      };
      const liveBindings = getLiveBindings(current.actions, activeDraft.keybindings, context);
      const conflicts = detectBindingConflicts(current.actions, activeDraft.keybindings, context);
      const conflictedActionIds = new Set(conflicts.flatMap((conflict) => conflict.actionIds));

      return m('.fm-settings-editor-body', { 'aria-label': 'Settings editor' }, [
        m('h4.fm-settings-section-heading', 'Appearance'),
        m(ThemeSwitcher, {
          theme: activeDraft.theme,
          showLabels: true,
          onThemeChange: (next: Settings['theme']) => update(current, { theme: next }),
        }),
        m('.row', [
          m(NumberInput, {
            className: 'col s6',
            label: 'Font size (px)',
            value: activeDraft.fontSize,
            min: 8,
            max: 32,
            oninput: (value: number) => update(current, { fontSize: value }),
            onchange: (value: number) => update(current, { fontSize: value }),
            ...errorAttrs('fontSize'),
          }),
          m(NumberInput, {
            className: 'col s6',
            label: 'Row height (px)',
            value: activeDraft.rowHeight,
            min: 16,
            max: 64,
            oninput: (value: number) => update(current, { rowHeight: value }),
            onchange: (value: number) => update(current, { rowHeight: value }),
            ...errorAttrs('rowHeight'),
          }),
        ]),
        m('.row', [
          m(Select<Settings['dateFormat']>, {
            className: 'col s6',
            label: 'Date format',
            options: [
              { id: 'short', label: 'Short' },
              { id: 'medium', label: 'Medium' },
              { id: 'iso', label: 'ISO 8601' },
            ],
            checkedId: activeDraft.dateFormat,
            onchange: ([value]) => value !== undefined && update(current, { dateFormat: value }),
          }),
          m(Select<Settings['sizeFormat']>, {
            className: 'col s6',
            label: 'Size format',
            options: [
              { id: 'binary', label: 'Binary (KiB, MiB, ...)' },
              { id: 'decimal', label: 'Decimal (KB, MB, ...)' },
              { id: 'bytes', label: 'Bytes' },
            ],
            checkedId: activeDraft.sizeFormat,
            onchange: ([value]) => value !== undefined && update(current, { sizeFormat: value }),
          }),
        ]),

        m('h4.fm-settings-section-heading', 'File behavior'),
        m(Switch, {
          label: 'Show hidden files',
          checked: activeDraft.showHiddenFiles,
          left: 'Hidden',
          right: 'Shown',
          onchange: (checked: boolean) => update(current, { showHiddenFiles: checked }),
        }),
        m(Switch, {
          label: 'Confirm permanent delete',
          checked: activeDraft.confirmPermanentDelete,
          left: 'Off',
          right: 'On',
          onchange: (checked: boolean) => update(current, { confirmPermanentDelete: checked }),
        }),

        m('h4.fm-settings-section-heading', 'Operations'),
        m('.row', [
          m(Select<Settings['defaultConflictPolicy']>, {
            className: 'col s6',
            label: 'Default conflict policy',
            options: [
              { id: 'ask', label: 'Ask' },
              { id: 'overwrite', label: 'Overwrite' },
              { id: 'keepBoth', label: 'Keep both' },
              { id: 'skip', label: 'Skip' },
            ],
            checkedId: activeDraft.defaultConflictPolicy,
            onchange: ([value]) =>
              value !== undefined && update(current, { defaultConflictPolicy: value }),
          }),
          m(NumberInput, {
            className: 'col s6',
            label: 'Operation concurrency',
            value: activeDraft.operationConcurrency,
            min: 1,
            oninput: (value: number) => update(current, { operationConcurrency: value }),
            onchange: (value: number) => update(current, { operationConcurrency: value }),
            ...errorAttrs('operationConcurrency'),
          }),
        ]),

        m('h4.fm-settings-section-heading', 'New workspace defaults'),
        m(Select<Settings['defaultPaneLayout']>, {
          label: 'Default pane layout',
          options: [
            { id: 'dual', label: 'Dual pane' },
            { id: 'single', label: 'Single pane' },
          ],
          checkedId: activeDraft.defaultPaneLayout,
          onchange: ([value]) =>
            value !== undefined && update(current, { defaultPaneLayout: value }),
        }),
        m(TextInput, {
          label: 'Default columns (comma-separated)',
          value: columnsText,
          oninput: (value: string) => {
            columnsText = value;
          },
          onchange: (value: string) => {
            columnsText = value;
            update(current, { defaultColumns: parseListInput(value) });
          },
        }),
        m(TextInput, {
          label: 'Default start locations (comma-separated)',
          value: startLocationsText,
          oninput: (value: string) => {
            startLocationsText = value;
          },
          onchange: (value: string) => {
            startLocationsText = value;
            update(current, { defaultStartLocations: parseListInput(value) });
          },
        }),

        m('h4.fm-settings-section-heading', 'Terminal'),
        m(TextInput, {
          label: 'Terminal command',
          value: activeDraft.terminalCommand ?? '',
          placeholder: 'System default',
          oninput: (value: string) =>
            update(current, { terminalCommand: value.trim().length === 0 ? null : value }),
          onchange: (value: string) =>
            update(current, { terminalCommand: value.trim().length === 0 ? null : value }),
        }),

        m('h4.fm-settings-section-heading', 'Keybindings'),
        conflicts.length === 0
          ? undefined
          : m(
              'ul.fm-settings-keybinding-conflicts',
              { role: 'alert' },
              conflicts.map((conflict) =>
                m(
                  'li',
                  `"${conflict.shortcut}" is bound to more than one action: ${conflict.actionIds.join(', ')}`,
                ),
              ),
            ),
        m(
          'ul.fm-settings-keybindings',
          current.actions.map((action) => {
            const shortcut = liveBindings.find((binding) => binding.actionId === action.id);
            return m(
              'li.fm-settings-keybinding-row',
              {
                'data-action-id': action.id,
                'data-conflict': String(conflictedActionIds.has(action.id)),
              },
              [
                m('span.fm-settings-keybinding-title', action.title),
                m(TextInput, {
                  label: `${action.title} shortcut`,
                  value: activeDraft.keybindings[action.id] ?? '',
                  placeholder: shortcut?.shortcut ?? 'None',
                  oninput: (value: string) =>
                    update(current, {
                      keybindings: setKeybindingOverride(activeDraft.keybindings, action.id, value),
                    }),
                  onchange: (value: string) =>
                    update(current, {
                      keybindings: setKeybindingOverride(activeDraft.keybindings, action.id, value),
                    }),
                }),
                shortcut?.available === false
                  ? m('span.fm-settings-keybinding-unavailable', 'Unavailable in the browser')
                  : undefined,
              ],
            );
          }),
        ),

        m('h4.fm-settings-section-heading', 'Plugins'),
        m(PluginManagement, {
          plugins: current.plugins,
          onToggle: current.onTogglePlugin,
          onRequestLogs: current.onRequestPluginLogs,
        }),

        errors.length === 0
          ? undefined
          : m(
              'ul.fm-settings-validation-errors',
              { role: 'alert' },
              errors.map((error) => m('li', error.message)),
            ),
        saveError === undefined
          ? undefined
          : m('.fm-settings-save-error', { role: 'alert' }, saveError),
        m('.fm-settings-editor-actions', [
          m(
            'button.fm-settings-cancel',
            { type: 'button', onclick: () => handleCancel(current) },
            'Cancel',
          ),
          m(
            'button.fm-settings-save',
            {
              type: 'button',
              disabled: errors.length > 0 || saving,
              onclick: () => handleSave(current),
            },
            saving ? 'Saving…' : 'Save',
          ),
        ]),
      ]);
    },
  };
};
