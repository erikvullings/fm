import m from 'mithril';
import { ThemeManager } from 'mithril-materialized';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFileManagerClient } from '../api/client/create-client';
import { MockFileManagerClient } from '../api/client/mock-file-manager-client';
import { ApiError } from '../api/fetch-mutator';
import { AppShell } from './app-shell';

let root: HTMLElement;

class TestEventSource extends EventTarget {
  close(): void {}
}

function mountShell(runtime: 'http' | 'tauri' | 'mock' = 'http'): void {
  m.mount(root, { view: () => m(AppShell, { runtime, client: createFileManagerClient(runtime) }) });
}

/**
 * Selects a theme button by its `title` prefix rather than its text: the Auto
 * button renders a ligature icon, so its `textContent` is `brightness_autoAuto`.
 */
function themeButtonIn(container: HTMLElement, label: string): HTMLButtonElement {
  const match = container.querySelector<HTMLButtonElement>(
    `.theme-switcher button[title^="${label}"]`,
  );
  if (!match) {
    throw new Error(`no theme button titled "${label}" in: ${container.innerHTML}`);
  }
  return match;
}

function themeButton(label: string): HTMLButtonElement {
  return themeButtonIn(root, label);
}

/**
 * Opens the settings disclosure and waits for the (async) initial settings
 * load to complete, since the settings editor only renders once
 * `currentSettings` is available (§0083).
 */
async function openAppearanceSettings(container: HTMLElement = root): Promise<void> {
  container.querySelector<HTMLElement>('.fm-settings-button')?.click();
  m.redraw.sync();
  await vi.waitFor(() => expect(container.querySelector('.theme-switcher')).not.toBeNull());
}

/** Opens the workspace switcher disclosure in the toolbar (task 0084). */
async function openWorkspaceSwitcher(container: HTMLElement = root): Promise<void> {
  container.querySelector<HTMLElement>('.fm-workspace-switcher-button')?.click();
  m.redraw.sync();
  await vi.waitFor(() => expect(container.querySelector('.fm-workspace-switcher')).not.toBeNull());
}

beforeEach(() => {
  vi.stubGlobal('EventSource', TestEventSource);
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  vi.unstubAllGlobals();
  m.mount(root, null);
  root.remove();
  document.documentElement.removeAttribute('data-theme');
});

describe('AppShell', () => {
  it('shows the directory table and loads the mock root directory', async () => {
    mountShell('mock');

    expect(root.textContent).not.toContain('Shell only');

    await vi.waitFor(() => {
      expect(root.querySelectorAll('.fm-workspace-pane')).toHaveLength(2);
      expect(root.textContent).toContain('Documents');
      expect(root.textContent).toContain('日本語.txt');
    });
    expect(root.querySelector('.fm-pane-tabs')).not.toBeNull();
    expect(root.querySelector('.fm-breadcrumb')).not.toBeNull();
    expect(root.querySelector('.fm-pane-status')?.textContent).toContain('entries');
  });

  it('selects a row and opens its directory with Enter', async () => {
    mountShell('mock');

    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    const documents = [...root.querySelectorAll<HTMLElement>('.fm-directory-row')].find((row) =>
      row.textContent?.includes('Documents'),
    );
    documents?.click();
    m.redraw.sync();
    const activePane = documents?.closest<HTMLElement>('.fm-pane');
    activePane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => expect(activePane?.textContent).toContain('report.pdf'));
    expect(activePane?.querySelector('.fm-cursor-row')?.textContent).toContain('Projects');
    activePane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    m.redraw.sync();
    expect(activePane?.querySelector('.fm-cursor-row')?.textContent).toContain('report.pdf');
  });

  it('keeps cursor and selection independent while using keyboard selection', async () => {
    mountShell('mock');

    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    const activePane = root.querySelector<HTMLElement>('[data-active="true"] > .fm-pane');
    activePane?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
    );
    m.redraw.sync();

    const entryCount = activePane?.querySelectorAll('.fm-directory-row').length ?? 0;
    expect(activePane?.querySelectorAll('.fm-selected-row')).toHaveLength(entryCount);

    activePane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    m.redraw.sync();
    expect(activePane?.querySelectorAll('.fm-selected-row')).toHaveLength(1);

    activePane?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    m.redraw.sync();
    expect(activePane?.querySelectorAll('.fm-selected-row')).toHaveLength(0);
  });

  it('sorts the loaded page from a column header and reports the active direction', async () => {
    mountShell('mock');

    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    const activePane = root.querySelector<HTMLElement>('[data-active="true"] > .fm-pane');
    const nameHeader = activePane?.querySelector<HTMLButtonElement>('[data-column-id="core.name"]');
    expect(nameHeader?.getAttribute('aria-sort')).toBe('ascending');

    nameHeader?.click();

    await vi.waitFor(() =>
      expect(activePane?.querySelector('.fm-pane-status')?.textContent).toContain(
        'Name descending',
      ),
    );
    expect(nameHeader?.getAttribute('aria-sort')).toBe('descending');
  });

  it('lazily shows metadata for the cursor entry after a directory loads', async () => {
    mountShell('mock');

    await vi.waitFor(() =>
      expect(root.querySelector('[data-active="true"] .fm-entry-metadata')?.textContent).toContain(
        'Documents',
      ),
    );
    expect(
      root.querySelector('[data-active="true"] .fm-entry-metadata')?.textContent,
    ).not.toContain('Loading metadata');
  });

  it('shows a parent row outside the root and opens it with Enter', async () => {
    mountShell('mock');

    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    const documents = [...root.querySelectorAll<HTMLElement>('.fm-directory-row')].find((row) =>
      row.textContent?.includes('Documents'),
    );
    documents?.click();
    m.redraw.sync();
    const activePane = documents?.closest<HTMLElement>('.fm-pane');
    activePane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() =>
      expect(activePane?.querySelector('.fm-directory-row')?.textContent).toContain('..'),
    );
    activePane?.querySelector<HTMLElement>('.fm-directory-row')?.click();
    m.redraw.sync();
    activePane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => expect(activePane?.textContent).not.toContain('report.pdf'));
    expect(activePane?.textContent).toContain('Documents');
    expect(activePane?.querySelector('.fm-directory-row')?.textContent).not.toContain('..');
  });

  it('composes the complete main-window workspace regions', async () => {
    mountShell('mock');

    await vi.waitFor(() => expect(root.querySelectorAll('.fm-workspace-pane')).toHaveLength(2));
    expect(root.querySelector('.fm-app-bar')).toBeNull();
    expect(root.querySelector('.fm-workspace-toolbar')).not.toBeNull();
    expect(root.querySelector('.fm-navigation-controls')).not.toBeNull();
    expect(root.querySelector('.fm-operation-centre')).not.toBeNull();
    expect(root.querySelector('.fm-function-key-bar')?.textContent).toContain('F5 Copy');
    expect(root.querySelector('.fm-function-key-bar')?.textContent).toContain('F6 Move');
  });

  it('opens the command palette with Ctrl+P, supports keyboard invocation, and restores focus', async () => {
    const client = new MockFileManagerClient();
    const invokeAction = vi.spyOn(client, 'invokeAction');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));

    const trigger = root.querySelector<HTMLButtonElement>(
      '.fm-workspace-toolbar > button:last-of-type',
    );
    trigger?.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
    );
    m.redraw.sync();

    const input = root.querySelector<HTMLInputElement>('.fm-command-palette-input');
    expect(input).not.toBeNull();
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(invokeAction).toHaveBeenCalledOnce());
    expect(invokeAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'core.clearSelection' }),
    );

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
    );
    m.redraw.sync();
    root
      .querySelector('.fm-command-palette-input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('.fm-command-palette')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens F7 validation and selects the delta-added directory after creation', async () => {
    const client = new MockFileManagerClient();
    const startOperation = vi.spyOn(client, 'startOperation');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true }));
    m.redraw.sync();
    const input = document.querySelector<HTMLInputElement>('#create-directory-name');
    expect(document.activeElement).toBe(input);
    if (!input) throw new Error('create-directory input missing');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(startOperation).not.toHaveBeenCalled();
    input.value = 'New folder';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => expect(startOperation).toHaveBeenCalledOnce());
    const request = startOperation.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      type: 'createDirectory',
      name: 'New folder',
      createIntermediateDirectories: false,
    });
    const workspace = await client.getWorkspace((await client.listWorkspaces())[0]?.id ?? '');
    const paneId = workspace.activePaneId;
    const snapshot = await client.listDirectory({
      workspaceId: workspace.id,
      paneId,
      requestId: 'selection-test',
      location: request?.destination ?? { providerId: 'file', uri: 'mock:///' },
    });
    client.emit({
      eventId: 99,
      timestamp: '2026-07-31T12:00:00Z',
      payload: {
        type: 'directory.delta',
        paneId,
        delta: {
          type: 'entriesAdded',
          revision: snapshot.revision + 1,
          entries: [
            {
              id: 'created-folder',
              name: 'New folder',
              kind: 'directory',
              location: {
                providerId: request?.destination?.providerId ?? 'file',
                uri: `${request?.destination?.uri ?? 'mock://'}New%20folder`,
              },
              hidden: false,
              readOnly: false,
              metadataRevision: 0,
            },
          ],
        },
      },
    });

    await vi.waitFor(() =>
      expect(root.querySelector('.fm-selected-row')?.textContent).toContain('New folder'),
    );
  });

  it('copies one selected file to the other pane with F5', async () => {
    const client = new MockFileManagerClient();
    const startOperation = vi.spyOn(client, 'startOperation');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('.env'));
    const activePane = root.querySelector<HTMLElement>('[data-active="true"] > .fm-pane');
    const file = [...(activePane?.querySelectorAll<HTMLElement>('.fm-directory-row') ?? [])].find(
      (row) => row.textContent?.includes('.env'),
    );
    file?.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));

    await vi.waitFor(() => expect(startOperation).toHaveBeenCalledOnce());
    expect(startOperation.mock.calls[0]?.[0]).toMatchObject({
      type: 'copy',
      sources: [{ uri: 'mock:///.env' }],
      destination: { uri: 'mock:///Documents' },
      conflictPolicy: 'ask',
    });
  });

  it('trashes the selected file with F8 when core.trash owns the shortcut (task 0043)', async () => {
    const client = new MockFileManagerClient();
    vi.spyOn(client, 'listActions').mockResolvedValue([
      {
        id: 'core.trash',
        title: 'Trash',
        category: 'fileOperations',
        defaultShortcuts: [{ key: 'F8' }, { key: 'Delete' }],
        contextRequirements: {},
        source: { kind: 'core' },
      },
      {
        id: 'core.delete',
        title: 'Delete',
        category: 'fileOperations',
        defaultShortcuts: [
          { key: 'F8', shift: true },
          { key: 'Delete', shift: true },
        ],
        contextRequirements: {},
        source: { kind: 'core' },
      },
    ]);
    const startOperation = vi.spyOn(client, 'startOperation');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('.env'));
    const activePane = root.querySelector<HTMLElement>('[data-active="true"] > .fm-pane');
    const file = [...(activePane?.querySelectorAll<HTMLElement>('.fm-directory-row') ?? [])].find(
      (row) => row.textContent?.includes('.env'),
    );
    file?.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true }));

    await vi.waitFor(() => expect(startOperation).toHaveBeenCalledOnce());
    expect(startOperation.mock.calls[0]?.[0]).toMatchObject({
      type: 'trash',
      sources: [{ uri: 'mock:///.env' }],
      conflictPolicy: 'ask',
    });
  });

  it('cuts a selection, dims it, and pastes the move into the active pane', async () => {
    const client = new MockFileManagerClient();
    const startOperation = vi.spyOn(client, 'startOperation');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('.env'));
    const left = root.querySelector<HTMLElement>('[data-active="true"] > .fm-pane');
    const file = [...(left?.querySelectorAll<HTMLElement>('.fm-directory-row') ?? [])].find((row) =>
      row.textContent?.includes('.env'),
    );
    file?.click();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, bubbles: true }),
    );
    m.redraw.sync();
    expect(file?.classList.contains('fm-cut-entry')).toBe(true);

    root.querySelector<HTMLElement>('[data-pane-id="right"]')?.click();
    await vi.waitFor(() =>
      expect(root.querySelector('[data-pane-id="right"]')?.getAttribute('data-active')).toBe(
        'true',
      ),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }),
    );

    await vi.waitFor(() => expect(startOperation).toHaveBeenCalledOnce());
    expect(startOperation.mock.calls[0]?.[0]).toMatchObject({
      type: 'move',
      sources: [{ uri: 'mock:///.env' }],
      destination: { uri: 'mock:///Documents' },
      conflictPolicy: 'ask',
    });
    await vi.waitFor(() => expect(file?.classList.contains('fm-cut-entry')).toBe(false));
  });

  it('keeps runtime diagnostics out of the workspace chrome', () => {
    mountShell('mock');

    expect(root.textContent).not.toContain('File Manager');
    expect(root.textContent).not.toContain('Connection:');
    expect(root.textContent).not.toContain('mock');
  });

  it('does not render connection diagnostics in the workspace', async () => {
    const client = new MockFileManagerClient();
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });

    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    expect(root.querySelector('.fm-connection-status')).toBeNull();
  });

  it('loads operations once then updates progress from events without polling', async () => {
    const client = new MockFileManagerClient();
    const operation = await client.startOperation({
      type: 'copy',
      sources: [{ providerId: 'file', uri: 'mock:///Documents/report.pdf' }],
      destination: { providerId: 'file', uri: 'mock:///Empty' },
      conflictPolicy: 'ask',
    });
    const listOperations = vi.spyOn(client, 'listOperations');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });

    await vi.waitFor(() => expect(root.textContent).toContain('copy · running'));
    client.emit({
      eventId: 11,
      timestamp: '2026-07-31T12:00:00Z',
      payload: {
        type: 'operation.progress',
        operationId: operation.id,
        progress: { completedItems: 1, totalItems: 2, completedBytes: 512 },
      },
    });

    await vi.waitFor(() => expect(root.textContent).toContain('1 / 2 items'));
    expect(listOperations).toHaveBeenCalledTimes(1);
  });

  it('acknowledges cancel immediately while the backend request is still pending', async () => {
    const client = new MockFileManagerClient();
    const operation = await client.startOperation({
      type: 'copy',
      sources: [{ providerId: 'file', uri: 'mock:///Documents/report.pdf' }],
      destination: { providerId: 'file', uri: 'mock:///Empty' },
      conflictPolicy: 'ask',
    });
    let acknowledgeCancel: (() => void) | undefined;
    const pendingCancel = new Promise<void>((resolve) => {
      acknowledgeCancel = resolve;
    });
    const cancelOperation = vi.spyOn(client, 'cancelOperation').mockReturnValue(pendingCancel);
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('copy · running'));

    root
      .querySelector<HTMLButtonElement>(
        `[data-operation-id="${operation.id}"] [data-action="cancel"]`,
      )
      ?.click();
    m.redraw.sync();

    expect(cancelOperation).toHaveBeenCalledWith(operation.id);
    expect(root.textContent).toContain('copy · cancelling');
    expect(
      root.querySelector(`[data-operation-id="${operation.id}"] [data-action="cancel"]`),
    ).toBeNull();
    acknowledgeCancel?.();
  });

  it('presents operation conflicts and submits the selected apply-to-all decision', async () => {
    const client = new MockFileManagerClient();
    const resolveConflict = vi.spyOn(client, 'resolveConflict').mockResolvedValue();
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));

    client.emit({
      eventId: 12,
      timestamp: '2026-07-31T12:00:00Z',
      payload: {
        type: 'operation.conflict',
        operationId: 'operation-1',
        conflictId: 'conflict-1',
        message: 'report.pdf already exists',
        source: { name: 'report.pdf', kind: 'file', size: 6 },
        destination: { name: 'report.pdf', kind: 'file', size: 8 },
      },
    });

    await vi.waitFor(() => expect(root.textContent).toContain('Resolve conflict'));
    root.querySelector<HTMLInputElement>('.fm-conflict-dialog input')?.click();
    const rename = [...root.querySelectorAll<HTMLButtonElement>('.fm-conflict-dialog button')].find(
      (button) => button.textContent === 'Rename new',
    );
    rename?.click();

    await vi.waitFor(() =>
      expect(resolveConflict).toHaveBeenCalledWith({
        operationId: 'operation-1',
        resolution: 'renameNew',
        applyToAllSimilar: true,
      }),
    );
    await vi.waitFor(() => expect(root.textContent).not.toContain('Resolve conflict'));
  });

  it('ignores old directory revisions and refetches pane snapshots after a replay gap', async () => {
    const client = new MockFileManagerClient();
    const listDirectory = vi.spyOn(client, 'listDirectory');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    const summary = (await client.listWorkspaces())[0];
    if (summary === undefined) throw new Error('mock workspace fixture missing');
    const projection = await client.openWorkspace(summary.id);
    const paneId = projection.paneOrder[0];
    if (paneId === undefined) throw new Error('mock workspace pane missing');
    const initialCalls = listDirectory.mock.calls.length;
    const getWorkspace = vi.spyOn(client, 'getWorkspace');

    client.emit({
      eventId: 9,
      timestamp: '2026-07-31T12:00:00Z',
      workspaceId: projection.id,
      payload: { type: 'workspace.renamed', revision: projection.revision, name: 'Old name' },
    });
    await Promise.resolve();
    expect(getWorkspace).not.toHaveBeenCalled();

    client.emit({
      eventId: 10,
      timestamp: '2026-07-31T12:00:00Z',
      payload: {
        type: 'directory.delta',
        paneId,
        delta: { type: 'entriesRemoved', revision: 0, entryIds: [] },
      },
    });
    await Promise.resolve();
    expect(listDirectory).toHaveBeenCalledTimes(initialCalls);

    client.emitResynchronise();
    await vi.waitFor(() => expect(listDirectory.mock.calls.length).toBeGreaterThan(initialCalls));
  });

  it('does not expose the runtime in the workspace chrome', () => {
    const client = new MockFileManagerClient();
    m.mount(root, { view: () => m(AppShell, { runtime: 'tauri', client }) });

    expect(root.textContent).not.toContain('tauri');
    expect(root.textContent).not.toContain('mock');
  });

  it('initializes the theme manager from its oninit lifecycle hook', () => {
    const initialize = vi.spyOn(ThemeManager, 'initialize');
    const setUseLocalStorage = vi.spyOn(ThemeManager, 'setUseLocalStorage');

    mountShell();

    // Settings belong to the backend (§26), so browser-storage persistence is
    // switched off explicitly. `initialize` is asserted by argument rather than
    // call count, because ThemeSwitcher initializes itself as well.
    expect(setUseLocalStorage).toHaveBeenCalledExactlyOnceWith(false);
    expect(initialize).toHaveBeenCalledWith('auto');
  });

  it('loads and applies backend theme, dimensions, and entry formats at bootstrap', async () => {
    const client = new MockFileManagerClient();
    vi.spyOn(client, 'getSettings').mockResolvedValue({
      ...(await client.getSettings()),
      theme: 'dark',
      fontSize: 17,
      rowHeight: 39,
      dateFormat: 'iso',
      sizeFormat: 'bytes',
    });
    const setTheme = vi.spyOn(ThemeManager, 'setTheme');

    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });

    await vi.waitFor(() => expect(setTheme).toHaveBeenCalledWith('dark'));
    expect(document.documentElement.style.getPropertyValue('--fm-font-size')).toBe('17px');
    expect(document.documentElement.style.getPropertyValue('--fm-row-height')).toBe('39px');
    await vi.waitFor(() => expect(root.textContent).toContain('8,192 B'));
  });

  it('renders the theme switcher inside the appearance settings editor', async () => {
    m.mount(root, {
      view: () => m(AppShell, { runtime: 'mock', client: new MockFileManagerClient() }),
    });

    expect(root.querySelector<HTMLDetailsElement>('.fm-settings-disclosure')?.open).toBe(false);
    await openAppearanceSettings();
    expect(root.querySelector<HTMLDetailsElement>('.fm-settings-disclosure')?.open).toBe(true);
    expect(root.querySelector('.fm-settings-editor')?.getAttribute('role')).toBe('dialog');
    expect(root.querySelector('.theme-switcher')).not.toBeNull();
    expect(themeButton('Light')).toBeInstanceOf(HTMLButtonElement);
    expect(themeButton('Dark')).toBeInstanceOf(HTMLButtonElement);
    expect(themeButton('Auto')).toBeInstanceOf(HTMLButtonElement);
  });

  it('lists discovered plugins inside the settings editor', async () => {
    const client = new MockFileManagerClient();
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });

    await openAppearanceSettings();

    await vi.waitFor(() => expect(root.querySelector('.fm-plugin-row')).not.toBeNull());
    expect(root.querySelector('.fm-plugin-row strong')?.textContent).toBe('Mock Archive');
  });

  it('applies a plugin.changed event to the plugins already listed', async () => {
    const client = new MockFileManagerClient();
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });

    await openAppearanceSettings();
    await vi.waitFor(() => expect(root.querySelector('.fm-plugin-row')).not.toBeNull());

    client.emit({
      eventId: 1,
      timestamp: '2026-07-31T12:00:00Z',
      payload: {
        type: 'plugin.changed',
        plugin: { id: 'mock.archive', name: 'Mock Archive', version: '1.0.0', enabled: false },
      },
    });
    m.redraw.sync();

    const checkbox = root.querySelector<HTMLInputElement>('.fm-plugin-row input[type="checkbox"]');
    expect(checkbox?.checked).toBe(false);
  });

  it('applies a theme change and keeps the switcher selection in step', async () => {
    const setTheme = vi.spyOn(ThemeManager, 'setTheme');

    m.mount(root, {
      view: () => m(AppShell, { runtime: 'mock', client: new MockFileManagerClient() }),
    });
    await openAppearanceSettings();
    themeButton('Dark').click();
    m.redraw.sync();

    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(themeButton('Dark').classList.contains('active')).toBe(true);
    expect(themeButton('Light').classList.contains('active')).toBe(false);
  });

  it('switches light, dark and follow-system themes without remounting', async () => {
    m.mount(root, {
      view: () => m(AppShell, { runtime: 'mock', client: new MockFileManagerClient() }),
    });
    await openAppearanceSettings();

    themeButton('Light').click();
    m.redraw.sync();
    expect(document.documentElement.dataset.theme).toBe('light');

    themeButton('Dark').click();
    m.redraw.sync();
    expect(document.documentElement.dataset.theme).toBe('dark');

    themeButton('Auto').click();
    m.redraw.sync();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(root.querySelector('.fm-app-shell')).not.toBeNull();
  });

  it('keeps per-instance theme state in the factory closure', async () => {
    m.mount(root, {
      view: () => m(AppShell, { runtime: 'mock', client: new MockFileManagerClient() }),
    });
    await openAppearanceSettings();
    themeButton('Dark').click();
    m.redraw.sync();
    expect(themeButton('Dark').classList.contains('active')).toBe(true);

    // A fresh mount must not inherit the previous instance's closure state.
    const second = document.createElement('div');
    document.body.appendChild(second);
    m.mount(second, {
      view: () => m(AppShell, { runtime: 'mock', client: new MockFileManagerClient() }),
    });
    await openAppearanceSettings(second);

    expect(themeButtonIn(second, 'Auto').classList.contains('active')).toBe(true);
    expect(themeButtonIn(second, 'Dark').classList.contains('active')).toBe(false);

    m.mount(second, null);
    second.remove();
  });

  it('opens a file with core.open, passing its uri as a parameter (task 0061)', async () => {
    const client = new MockFileManagerClient();
    const invokeAction = vi.spyOn(client, 'invokeAction');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('日本語.txt'));

    const fileRow = [...root.querySelectorAll<HTMLElement>('.fm-directory-row')].find((row) =>
      row.textContent?.includes('日本語.txt'),
    );
    fileRow?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    m.redraw.sync();

    await vi.waitFor(() => expect(invokeAction).toHaveBeenCalledOnce());
    expect(invokeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'core.open',
        parameters: { uri: `mock:///${encodeURIComponent('日本語.txt')}` },
      }),
    );
  });

  it('reveals the selected entry via the context menu, passing its uri as a parameter (task 0061)', async () => {
    const client = new MockFileManagerClient();
    const invokeAction = vi.spyOn(client, 'invokeAction');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('日本語.txt'));

    const fileRow = [...root.querySelectorAll<HTMLElement>('.fm-directory-row')].find((row) =>
      row.textContent?.includes('日本語.txt'),
    );
    fileRow?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }),
    );
    m.redraw.sync();

    const revealButton = [
      ...root.querySelectorAll<HTMLButtonElement>('.fm-context-menu-item'),
    ].find((button) => button.textContent === 'Reveal in File Manager');
    expect(revealButton).not.toBeUndefined();
    revealButton?.click();
    m.redraw.sync();

    await vi.waitFor(() => expect(invokeAction).toHaveBeenCalledOnce());
    expect(invokeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'core.revealInSystemFileManager',
        parameters: { uri: `mock:///${encodeURIComponent('日本語.txt')}` },
      }),
    );
  });

  it('opens a terminal at the current directory via the context menu, passing its uri (task 0061)', async () => {
    const client = new MockFileManagerClient();
    vi.spyOn(client, 'getRuntimeCapabilities').mockResolvedValue({
      clipboard: false,
      nativeDragOut: false,
      nativeFileIcons: false,
      nativeMenus: false,
      nativeThumbnails: false,
      openTerminal: true,
      platform: 'linux',
      plugins: true,
      revealInSystemFileManager: false,
      runtime: 'mock',
      serverAdministration: false,
      systemTrash: false,
    });
    vi.spyOn(client, 'listActions').mockResolvedValue([
      {
        id: 'core.openTerminal',
        title: 'Open Terminal Here',
        category: 'tools',
        defaultShortcuts: [],
        contextRequirements: {},
        source: { kind: 'core' },
      },
    ]);
    const invokeAction = vi.spyOn(client, 'invokeAction');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('日本語.txt'));

    const table = root.querySelector<HTMLElement>('.fm-directory-table');
    table?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    m.redraw.sync();

    const terminalButton = [
      ...root.querySelectorAll<HTMLButtonElement>('.fm-context-menu-item'),
    ].find((button) => button.textContent === 'Open Terminal Here');
    expect(terminalButton).not.toBeUndefined();
    terminalButton?.click();
    m.redraw.sync();

    await vi.waitFor(() => expect(invokeAction).toHaveBeenCalledOnce());
    expect(invokeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'core.openTerminal',
        parameters: { uri: 'mock:///' },
      }),
    );
  });

  it('surfaces a platform action failure as a visible, user-readable error (task 0061)', async () => {
    const client = new MockFileManagerClient();
    vi.spyOn(client, 'invokeAction').mockRejectedValue(
      new Error('no default application is registered for this file type'),
    );
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('日本語.txt'));

    const fileRow = [...root.querySelectorAll<HTMLElement>('.fm-directory-row')].find((row) =>
      row.textContent?.includes('日本語.txt'),
    );
    fileRow?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    m.redraw.sync();

    await vi.waitFor(() =>
      expect(root.querySelector('.fm-command-palette-error')?.textContent).toBe(
        'no default application is registered for this file type',
      ),
    );
  });

  it('opens the quick filter with Ctrl+F, filters the active pane live, and closes with Escape (task 0067)', async () => {
    mountShell('mock');
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    const activePane = root.querySelector<HTMLElement>('[data-active="true"] > .fm-pane');
    const totalRows = activePane?.querySelectorAll('.fm-directory-row').length ?? 0;
    expect(totalRows).toBeGreaterThan(0);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
    );
    m.redraw.sync();

    const filterInput = activePane?.querySelector<HTMLInputElement>('.fm-quick-filter-input');
    expect(filterInput).not.toBeNull();
    expect(document.activeElement).toBe(filterInput);
    if (!filterInput) throw new Error('quick filter input missing');

    filterInput.value = 'doc';
    filterInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    m.redraw.sync();

    expect(activePane?.querySelectorAll('.fm-directory-row')).toHaveLength(2);
    expect(activePane?.querySelector('.fm-pane-status')?.textContent).toContain(
      `2 of ${totalRows} shown`,
    );

    filterInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    m.redraw.sync();

    expect(activePane?.querySelector('.fm-quick-filter-input')).toBeNull();
    expect(activePane?.querySelectorAll('.fm-directory-row')).toHaveLength(totalRows);
  });

  it('does nothing harmful when Ctrl+F repeats or an editable target already has focus (task 0067)', async () => {
    mountShell('mock');
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    const activePane = root.querySelector<HTMLElement>('[data-active="true"] > .fm-pane');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
    );
    m.redraw.sync();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
    );
    m.redraw.sync();
    expect(activePane?.querySelectorAll('.fm-quick-filter-input')).toHaveLength(1);

    const editButton = activePane?.querySelector<HTMLElement>('.fm-breadcrumb-edit-target');
    editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    m.redraw.sync();
    const pathInput = activePane?.querySelector<HTMLInputElement>('.fm-path-input');
    pathInput?.focus();
    pathInput?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
    );
    m.redraw.sync();

    expect(document.activeElement).toBe(pathInput);
  });

  it('persists the committed quick-filter query and restores it when the filter box reopens (task 0067)', async () => {
    const client = new MockFileManagerClient();
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    const activePane = root.querySelector<HTMLElement>('[data-active="true"] > .fm-pane');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
    );
    m.redraw.sync();
    const filterInput = activePane?.querySelector<HTMLInputElement>('.fm-quick-filter-input');
    if (!filterInput) throw new Error('quick filter input missing');
    filterInput.value = 'doc';
    filterInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    filterInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    m.redraw.sync();

    const workspaceId = (await client.listWorkspaces())[0]?.id ?? '';
    await vi.waitFor(async () => {
      const workspace = await client.getWorkspace(workspaceId);
      const pane = workspace.panesById[workspace.activePaneId];
      const tab = pane?.tabsById[pane.activeTabId];
      expect(tab?.view.quickFilter).toEqual({ query: 'doc' });
    });

    m.mount(root, null);
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    const reopenedPane = root.querySelector<HTMLElement>('[data-active="true"] > .fm-pane');
    expect(reopenedPane?.querySelectorAll('.fm-directory-row')).toHaveLength(2);
  });
});

describe('tabs per pane (task 0069)', () => {
  function activePane(): HTMLElement | null {
    return root.querySelector<HTMLElement>('[data-active="true"] > .fm-pane');
  }

  function closeLastTabDialog(): HTMLElement | undefined {
    return [...root.querySelectorAll<HTMLElement>('[role="dialog"]')].find((dialog) =>
      dialog.textContent?.includes('only tab'),
    );
  }

  it('opens a new tab in the active pane at its current location with Ctrl+T', async () => {
    const client = new MockFileManagerClient();
    const dispatchWorkspaceCommand = vi.spyOn(client, 'dispatchWorkspaceCommand');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    expect(activePane()?.querySelectorAll('[role="tab"]')).toHaveLength(1);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true }),
    );

    await vi.waitFor(() => expect(dispatchWorkspaceCommand).toHaveBeenCalledOnce());
    expect(dispatchWorkspaceCommand.mock.calls[0]?.[0]).toMatchObject({
      type: 'addTab',
      paneId: 'left',
      location: { uri: 'mock:///' },
    });
    await vi.waitFor(() => expect(activePane()?.querySelectorAll('[role="tab"]')).toHaveLength(2));
  });

  it('closes the active tab with Ctrl+W directly when another tab remains', async () => {
    const client = new MockFileManagerClient();
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true }),
    );
    await vi.waitFor(() => expect(activePane()?.querySelectorAll('[role="tab"]')).toHaveLength(2));

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true }),
    );

    await vi.waitFor(() => expect(activePane()?.querySelectorAll('[role="tab"]')).toHaveLength(1));
    expect(closeLastTabDialog()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('gates closing a pane down to zero tabs behind confirmation with Ctrl+W', async () => {
    const client = new MockFileManagerClient();
    const dispatchWorkspaceCommand = vi.spyOn(client, 'dispatchWorkspaceCommand');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    expect(activePane()?.querySelectorAll('[role="tab"]')).toHaveLength(1);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true }),
    );
    m.redraw.sync();

    expect(closeLastTabDialog()?.getAttribute('aria-hidden')).toBe('false');
    expect(dispatchWorkspaceCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'closeTab' }),
      undefined,
    );

    [...(closeLastTabDialog()?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent === 'Close tab')
      ?.click();

    await vi.waitFor(() =>
      expect(dispatchWorkspaceCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'closeTab', paneId: 'left' }),
        undefined,
      ),
    );
  });

  it('cancelling the close-last-tab dialog leaves the tab open', async () => {
    const client = new MockFileManagerClient();
    const dispatchWorkspaceCommand = vi.spyOn(client, 'dispatchWorkspaceCommand');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true }),
    );
    m.redraw.sync();
    [...(closeLastTabDialog()?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent === 'Cancel')
      ?.click();
    m.redraw.sync();

    expect(closeLastTabDialog()?.getAttribute('aria-hidden')).toBe('true');
    expect(dispatchWorkspaceCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'closeTab' }),
      undefined,
    );
  });

  it('cycles tabs with Ctrl+Tab / Ctrl+Shift+Tab and jumps to a tab with Ctrl+2', async () => {
    const client = new MockFileManagerClient();
    const dispatchWorkspaceCommand = vi.spyOn(client, 'dispatchWorkspaceCommand');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));

    function selectedTabIndex(): number {
      return [...(activePane()?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].findIndex(
        (tab) => tab.getAttribute('aria-selected') === 'true',
      );
    }

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true }),
    );
    await vi.waitFor(() => expect(activePane()?.querySelectorAll('[role="tab"]')).toHaveLength(2));
    await vi.waitFor(() => expect(selectedTabIndex()).toBe(1));
    dispatchWorkspaceCommand.mockClear();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true }),
    );
    await vi.waitFor(() =>
      expect(dispatchWorkspaceCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'activateTab', paneId: 'left' }),
        undefined,
      ),
    );
    await vi.waitFor(() => expect(selectedTabIndex()).toBe(0));

    dispatchWorkspaceCommand.mockClear();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    await vi.waitFor(() =>
      expect(dispatchWorkspaceCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'activateTab', paneId: 'left' }),
        undefined,
      ),
    );
    await vi.waitFor(() => expect(selectedTabIndex()).toBe(1));

    dispatchWorkspaceCommand.mockClear();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }),
    );
    await vi.waitFor(() =>
      expect(dispatchWorkspaceCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'activateTab', paneId: 'left' }),
        undefined,
      ),
    );
    await vi.waitFor(() => expect(selectedTabIndex()).toBe(0));
  });

  it('reopens the most recently closed tab with Ctrl+Shift+T', async () => {
    const client = new MockFileManagerClient();
    const dispatchWorkspaceCommand = vi.spyOn(client, 'dispatchWorkspaceCommand');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true }),
    );
    await vi.waitFor(() => expect(activePane()?.querySelectorAll('[role="tab"]')).toHaveLength(2));

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true }),
    );
    await vi.waitFor(() => expect(activePane()?.querySelectorAll('[role="tab"]')).toHaveLength(1));
    dispatchWorkspaceCommand.mockClear();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', ctrlKey: true, shiftKey: true, bubbles: true }),
    );

    await vi.waitFor(() =>
      expect(dispatchWorkspaceCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'addTab',
          paneId: 'left',
          location: { providerId: 'file', uri: 'mock:///' },
        }),
        undefined,
      ),
    );
    await vi.waitFor(() => expect(activePane()?.querySelectorAll('[role="tab"]')).toHaveLength(2));
  });
});

describe('workspace management (task 0084)', () => {
  function row(container: HTMLElement, workspaceId: string): HTMLElement | null {
    return container.querySelector<HTMLElement>(`[data-workspace-id="${workspaceId}"]`);
  }

  it('lists persisted workspaces in the switcher and switches the active one', async () => {
    const client = new MockFileManagerClient();
    const first = await client.createWorkspace({ name: 'Alpha' });
    const second = await client.createWorkspace({ name: 'Bravo' });
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    await openWorkspaceSwitcher();

    expect(root.textContent).toContain('Alpha');
    expect(root.textContent).toContain('Bravo');
    expect(row(root, first.id)?.getAttribute('data-active')).toBe('true');

    row(root, second.id)?.querySelector<HTMLElement>('.fm-workspace-switcher-name')?.click();

    await vi.waitFor(() =>
      expect(root.querySelector('.fm-workspace-switcher-button')?.textContent).toBe('Bravo'),
    );
    await vi.waitFor(() => expect(row(root, second.id)?.getAttribute('data-active')).toBe('true'));
  });

  it('creates a new workspace and activates it immediately', async () => {
    const client = new MockFileManagerClient();
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    await openWorkspaceSwitcher();
    const before = await client.listWorkspaces();

    root.querySelector<HTMLButtonElement>('.fm-workspace-create-button')?.click();

    await vi.waitFor(async () =>
      expect((await client.listWorkspaces()).length).toBe(before.length + 1),
    );
    await vi.waitFor(() =>
      expect(root.querySelector('.fm-workspace-switcher-button')?.textContent).toBe('Default'),
    );
  });

  it('renames the active workspace and updates the toolbar label', async () => {
    const client = new MockFileManagerClient();
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    const workspaceId = (await client.listWorkspaces())[0]?.id;
    if (workspaceId === undefined) throw new Error('no workspace to rename');
    await openWorkspaceSwitcher();

    row(root, workspaceId)
      ?.querySelector<HTMLButtonElement>('.fm-workspace-rename-button')
      ?.click();
    m.redraw.sync();
    const input = row(root, workspaceId)?.querySelector<HTMLInputElement>('input[type="text"]');
    if (input === null || input === undefined) throw new Error('rename input missing');
    input.value = 'Renamed workspace';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    row(root, workspaceId)
      ?.querySelector<HTMLFormElement>('.fm-workspace-rename-form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(root.querySelector('.fm-workspace-switcher-button')?.textContent).toBe(
        'Renamed workspace',
      ),
    );
  });

  it('deletes a workspace after confirmation and never strands the app without an active workspace', async () => {
    const client = new MockFileManagerClient();
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    const workspaceId = (await client.listWorkspaces())[0]?.id;
    if (workspaceId === undefined) throw new Error('no workspace to delete');
    await openWorkspaceSwitcher();

    row(root, workspaceId)
      ?.querySelector<HTMLButtonElement>('.fm-workspace-delete-button')
      ?.click();
    m.redraw.sync();
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent === 'Delete workspace')
      ?.click();

    await vi.waitFor(async () => {
      const summaries = await client.listWorkspaces();
      expect(summaries.find((summary) => summary.id === workspaceId)).toBeUndefined();
    });
    // Recovers by creating a fresh default workspace rather than stranding the app.
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    expect(root.querySelector('.fm-workspace-loading')).toBeNull();
  });

  it('leaves a running operation untouched when switching workspaces', async () => {
    const client = new MockFileManagerClient();
    await client.createWorkspace({ name: 'Alpha' });
    const second = await client.createWorkspace({ name: 'Bravo' });
    await client.startOperation({
      type: 'copy',
      sources: [{ providerId: 'file', uri: 'mock:///Documents/report.pdf' }],
      destination: { providerId: 'file', uri: 'mock:///Empty' },
      conflictPolicy: 'ask',
    });
    const cancelOperation = vi.spyOn(client, 'cancelOperation');
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('copy · running'));
    await openWorkspaceSwitcher();

    row(root, second.id)?.querySelector<HTMLElement>('.fm-workspace-switcher-name')?.click();

    await vi.waitFor(() =>
      expect(root.querySelector('.fm-workspace-switcher-button')?.textContent).toBe('Bravo'),
    );
    expect(root.textContent).toContain('copy · running');
    expect(cancelOperation).not.toHaveBeenCalled();
  });

  it('refreshes the switcher when another session creates, renames, and deletes a workspace', async () => {
    const client = new MockFileManagerClient();
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));

    const created = await client.createWorkspace({ name: 'Remote workspace' });
    client.emit({
      eventId: 101,
      timestamp: '2026-08-03T00:00:00Z',
      workspaceId: created.id,
      payload: { type: 'workspace.created', revision: created.revision },
    });
    await vi.waitFor(() => expect(root.textContent).toContain('Remote workspace'));

    const renamed = await client.renameWorkspace(created.id, 'Renamed remotely', created.revision);
    client.emit({
      eventId: 102,
      timestamp: '2026-08-03T00:00:00Z',
      workspaceId: created.id,
      payload: { type: 'workspace.renamed', revision: renamed.revision, name: 'Renamed remotely' },
    });
    await vi.waitFor(() => expect(root.textContent).toContain('Renamed remotely'));

    await client.deleteWorkspace(created.id, renamed.revision);
    client.emit({
      eventId: 103,
      timestamp: '2026-08-03T00:00:00Z',
      workspaceId: created.id,
      payload: { type: 'workspace.deleted', revision: renamed.revision + 1 },
    });
    await vi.waitFor(() => expect(root.textContent).not.toContain('Renamed remotely'));
  });

  it('surfaces a rename revision conflict without silently discarding the edit', async () => {
    const client = new MockFileManagerClient({
      failures: {
        dispatchWorkspaceCommand: new ApiError(409, {
          code: 'workspaceRevisionConflict',
          message: 'stale workspace revision',
        }),
      },
    });
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    const workspaceId = (await client.listWorkspaces())[0]?.id;
    if (workspaceId === undefined) throw new Error('no workspace to rename');
    await openWorkspaceSwitcher();

    row(root, workspaceId)
      ?.querySelector<HTMLButtonElement>('.fm-workspace-rename-button')
      ?.click();
    m.redraw.sync();
    const input = row(root, workspaceId)?.querySelector<HTMLInputElement>('input[type="text"]');
    if (input === null || input === undefined) throw new Error('rename input missing');
    input.value = 'New name';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    row(root, workspaceId)
      ?.querySelector<HTMLFormElement>('.fm-workspace-rename-form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(root.textContent).toContain('changed elsewhere'));
    const unchanged = await client.getWorkspace(workspaceId);
    expect(unchanged.name).not.toBe('New name');
  });

  it('surfaces a delete revision conflict without deleting the workspace', async () => {
    const client = new MockFileManagerClient({
      failures: {
        deleteWorkspace: new ApiError(409, {
          code: 'workspaceRevisionConflict',
          message: 'stale workspace revision',
        }),
      },
    });
    m.mount(root, { view: () => m(AppShell, { runtime: 'mock', client }) });
    await vi.waitFor(() => expect(root.textContent).toContain('Documents'));
    const workspaceId = (await client.listWorkspaces())[0]?.id;
    if (workspaceId === undefined) throw new Error('no workspace to delete');
    await openWorkspaceSwitcher();

    row(root, workspaceId)
      ?.querySelector<HTMLButtonElement>('.fm-workspace-delete-button')
      ?.click();
    m.redraw.sync();
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent === 'Delete workspace')
      ?.click();

    await vi.waitFor(() => expect(root.textContent).toContain('changed elsewhere'));
    const summaries = await client.listWorkspaces();
    expect(summaries.find((summary) => summary.id === workspaceId)).toBeDefined();
  });
});
