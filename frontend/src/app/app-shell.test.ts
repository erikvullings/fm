import m from 'mithril';
import { ThemeManager } from 'mithril-materialized';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFileManagerClient } from '../api/client/create-client';
import { MockFileManagerClient } from '../api/client/mock-file-manager-client';
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

function openAppearanceSettings(container: HTMLElement = root): void {
  container.querySelector<HTMLElement>('.fm-settings-button')?.click();
  m.redraw.sync();
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

  it('renders the theme switcher inside the appearance settings editor', () => {
    mountShell();

    expect(root.querySelector<HTMLDetailsElement>('.fm-settings-disclosure')?.open).toBe(false);
    openAppearanceSettings();
    expect(root.querySelector<HTMLDetailsElement>('.fm-settings-disclosure')?.open).toBe(true);
    expect(root.querySelector('.fm-settings-editor')?.getAttribute('role')).toBe('dialog');
    expect(root.querySelector('.theme-switcher')).not.toBeNull();
    expect(themeButton('Light')).toBeInstanceOf(HTMLButtonElement);
    expect(themeButton('Dark')).toBeInstanceOf(HTMLButtonElement);
    expect(themeButton('Auto')).toBeInstanceOf(HTMLButtonElement);
  });

  it('applies a theme change and keeps the switcher selection in step', () => {
    const setTheme = vi.spyOn(ThemeManager, 'setTheme');

    mountShell();
    openAppearanceSettings();
    themeButton('Dark').click();
    m.redraw.sync();

    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(themeButton('Dark').classList.contains('active')).toBe(true);
    expect(themeButton('Light').classList.contains('active')).toBe(false);
  });

  it('switches light, dark and follow-system themes without remounting', () => {
    mountShell();
    openAppearanceSettings();

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

  it('keeps per-instance theme state in the factory closure', () => {
    mountShell();
    openAppearanceSettings();
    themeButton('Dark').click();
    m.redraw.sync();
    expect(themeButton('Dark').classList.contains('active')).toBe(true);

    // A fresh mount must not inherit the previous instance's closure state.
    const second = document.createElement('div');
    document.body.appendChild(second);
    m.mount(second, {
      view: () => m(AppShell, { runtime: 'http', client: createFileManagerClient('http') }),
    });
    openAppearanceSettings(second);

    expect(themeButtonIn(second, 'Auto').classList.contains('active')).toBe(true);
    expect(themeButtonIn(second, 'Dark').classList.contains('active')).toBe(false);

    m.mount(second, null);
    second.remove();
  });
});
