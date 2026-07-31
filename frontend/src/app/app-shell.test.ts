import m from 'mithril';
import { ThemeManager } from 'mithril-materialized';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFileManagerClient } from '../api/client/create-client';
import { AppShell } from './app-shell';

let root: HTMLElement;

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

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
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
  });

  it('composes the complete main-window workspace regions', async () => {
    mountShell('mock');

    await vi.waitFor(() => expect(root.querySelectorAll('.fm-workspace-pane')).toHaveLength(2));
    expect(root.querySelector('.fm-app-bar')).not.toBeNull();
    expect(root.querySelector('.fm-workspace-toolbar')).not.toBeNull();
    expect(root.querySelector('.fm-operation-centre')).not.toBeNull();
    expect(root.querySelector('.fm-function-key-bar')?.textContent).toContain('F5 Copy');
    expect(root.querySelector('.fm-function-key-bar')?.textContent).toContain('F6 Move');
  });

  it('names the application and the transport it is running against', () => {
    mountShell('mock');

    expect(root.textContent).toContain('File Manager');
    expect(root.textContent).toContain('mock');
  });

  it('reports the runtime it was given rather than a hard-coded default', () => {
    mountShell('tauri');

    expect(root.textContent).toContain('tauri');
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

  it('renders the mithril-materialized theme switcher', () => {
    mountShell();

    expect(root.querySelector('.theme-switcher')).not.toBeNull();
    expect(themeButton('Light')).toBeInstanceOf(HTMLButtonElement);
    expect(themeButton('Dark')).toBeInstanceOf(HTMLButtonElement);
    expect(themeButton('Auto')).toBeInstanceOf(HTMLButtonElement);
  });

  it('applies a theme change and keeps the switcher selection in step', () => {
    const setTheme = vi.spyOn(ThemeManager, 'setTheme');

    mountShell();
    themeButton('Dark').click();
    m.redraw.sync();

    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(themeButton('Dark').classList.contains('active')).toBe(true);
    expect(themeButton('Light').classList.contains('active')).toBe(false);
  });

  it('switches light, dark and follow-system themes without remounting', () => {
    mountShell();

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
    themeButton('Dark').click();
    m.redraw.sync();
    expect(themeButton('Dark').classList.contains('active')).toBe(true);

    // A fresh mount must not inherit the previous instance's closure state.
    const second = document.createElement('div');
    document.body.appendChild(second);
    m.mount(second, {
      view: () => m(AppShell, { runtime: 'http', client: createFileManagerClient('http') }),
    });

    expect(themeButtonIn(second, 'Auto').classList.contains('active')).toBe(true);
    expect(themeButtonIn(second, 'Dark').classList.contains('active')).toBe(false);

    m.mount(second, null);
    second.remove();
  });
});
