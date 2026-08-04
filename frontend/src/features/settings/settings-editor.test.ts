import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionDescriptor, Settings } from '../../models';
import { SettingsEditor } from './settings-editor';

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  m.mount(root, null);
  root.remove();
});

function fixtureSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    schemaVersion: 2,
    theme: 'auto',
    fontSize: 13,
    rowHeight: 22,
    dateFormat: 'medium',
    sizeFormat: 'binary',
    showHiddenFiles: false,
    confirmPermanentDelete: true,
    defaultConflictPolicy: 'ask',
    operationConcurrency: 2,
    defaultPaneLayout: 'dual',
    defaultColumns: ['core.name', 'core.size'],
    keybindings: {},
    enabledPlugins: [],
    pluginSettings: {},
    terminalCommand: null,
    editorCommand: null,
    defaultStartLocations: [],
    iconTheme: 'generic',
    ...overrides,
  };
}

const actions: readonly ActionDescriptor[] = [
  {
    id: 'core.rename',
    title: 'Rename',
    category: 'fileOperations',
    defaultShortcuts: [{ key: 'F2' }],
    contextRequirements: {},
    source: { kind: 'core' },
  },
  {
    id: 'core.copy',
    title: 'Copy',
    category: 'fileOperations',
    defaultShortcuts: [{ key: 'F5' }],
    contextRequirements: {},
    source: { kind: 'core' },
  },
];

function mountEditor(overrides: Partial<Parameters<typeof SettingsEditor>[0]['attrs']> = {}) {
  const onPreview = vi.fn();
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  const onTogglePlugin = vi.fn();
  const onRequestPluginLogs = vi.fn();
  m.mount(root, {
    view: () =>
      m(SettingsEditor, {
        settings: fixtureSettings(),
        actions,
        platform: 'windows',
        runtime: 'desktop',
        plugins: [],
        onPreview,
        onSave,
        onCancel,
        onTogglePlugin,
        onRequestPluginLogs,
        ...overrides,
      }),
  });
  m.redraw.sync();
  return { onPreview, onSave, onCancel, onTogglePlugin, onRequestPluginLogs };
}

function numberInput(label: string): HTMLInputElement {
  const input = [...root.querySelectorAll('input')].find(
    (candidate) => candidate.closest('.input-field')?.querySelector('label')?.textContent === label,
  );
  if (!(input instanceof HTMLInputElement)) throw new Error(`no number input labeled ${label}`);
  return input;
}

function fireChange(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  m.redraw.sync();
}

describe('SettingsEditor', () => {
  it('renders initial appearance values from the loaded settings', () => {
    mountEditor({ settings: fixtureSettings({ fontSize: 17, rowHeight: 30 }) });

    expect(numberInput('Font size (px)').value).toBe('17');
    expect(numberInput('Row height (px)').value).toBe('30');
  });

  it('previews an edited field immediately without saving', () => {
    const { onPreview, onSave } = mountEditor();

    fireChange(numberInput('Font size (px)'), '20');

    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 20 }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('reverts the draft and calls onCancel without persisting', () => {
    const { onCancel, onSave } = mountEditor();

    fireChange(numberInput('Font size (px)'), '20');
    root.querySelector<HTMLButtonElement>('.fm-settings-cancel')?.click();
    m.redraw.sync();

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    expect(numberInput('Font size (px)').value).toBe('13');
  });

  it('saves the whole edited document as one call', async () => {
    const { onSave } = mountEditor();

    fireChange(numberInput('Font size (px)'), '20');
    root.querySelector<HTMLButtonElement>('.fm-settings-save')?.click();
    m.redraw.sync();

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 20 }));
  });

  it('keeps the draft visible and shows an error when saving fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('backend refused the request'));
    mountEditor({ onSave });

    fireChange(numberInput('Font size (px)'), '20');
    root.querySelector<HTMLButtonElement>('.fm-settings-save')?.click();
    await Promise.resolve();
    await Promise.resolve();
    m.redraw.sync();

    expect(root.querySelector('.fm-settings-save-error')?.textContent).toBe(
      'backend refused the request',
    );
    expect(numberInput('Font size (px)').value).toBe('20');
  });

  it('disables saving and shows a validation message for an out-of-range field', () => {
    mountEditor();

    fireChange(numberInput('Font size (px)'), '4');

    expect(root.querySelector('.fm-settings-validation-errors')?.textContent).toContain(
      'Font size',
    );
    expect(root.querySelector<HTMLButtonElement>('.fm-settings-save')?.disabled).toBe(true);
  });

  it('lists the effective keybindings and flags a conflict between two actions', () => {
    mountEditor({
      settings: fixtureSettings({ keybindings: { 'core.copy': 'F2' } }),
    });

    const rows = [...root.querySelectorAll('.fm-settings-keybinding-row')];
    expect(rows).toHaveLength(2);
    const conflicted = rows.filter((row) => row.getAttribute('data-conflict') === 'true');
    expect(conflicted.map((row) => row.getAttribute('data-action-id')).sort()).toEqual([
      'core.copy',
      'core.rename',
    ]);
    expect(root.querySelector('.fm-settings-keybinding-conflicts')?.textContent).toContain('F2');
  });

  it('embeds plugin management for enable/disable rather than a second path', () => {
    mountEditor({
      plugins: [
        {
          id: 'example.plugin',
          name: 'Example plugin',
          version: '1.0.0',
          description: 'An example plugin.',
          enabled: true,
        },
      ],
    });

    expect(root.querySelector('.fm-plugin-row strong')?.textContent).toBe('Example plugin');
  });
});
