import m, { type FactoryComponent } from 'mithril';
import { type Theme, ThemeManager, ThemeSwitcher } from 'mithril-materialized';

import type { FileManagerClient } from '../api/client/file-manager-client';
import { DirectoryTable, entryArraySource } from '../features/directory-table/directory-table';
import type { EntrySummary, LoadingState } from '../models';
import type { RuntimeKind } from '../utilities/runtime';

/** Attributes of the application shell. */
export interface AppShellAttrs {
  /** Transport this build talks to, resolved from `VITE_RUNTIME`. */
  runtime: RuntimeKind;
  /** Transport-neutral client selected once by the application bootstrap. */
  client: FileManagerClient;
}

const DEFAULT_THEME: Theme = 'auto';

/**
 * A factory component so that per-instance state lives in the closure rather
 * than on a shared module-level object.
 */
export const AppShell: FactoryComponent<AppShellAttrs> = () => {
  let theme: Theme = DEFAULT_THEME;
  let directoryState: LoadingState = { type: 'idle' };
  let entries: readonly EntrySummary[] = [];
  let directoryRequest: AbortController | undefined;

  function loadMockDirectory(client: FileManagerClient): void {
    directoryRequest = new AbortController();
    directoryState = { type: 'loading' };
    void client
      .listDirectory(
        {
          workspaceId: 'mock-workspace',
          paneId: 'left',
          requestId: 'app-shell-root',
          location: { providerId: 'file', uri: 'mock:///' },
        },
        directoryRequest.signal,
      )
      .then(
        (snapshot) => {
          entries = snapshot.entries;
          directoryState = snapshot.loadingState;
          m.redraw();
        },
        (error: unknown) => {
          if (directoryRequest?.signal.aborted === true) {
            return;
          }
          directoryState = {
            type: 'error',
            message: error instanceof Error ? error.message : 'Unknown directory error',
          };
          m.redraw();
        },
      );
  }

  return {
    oninit: ({ attrs }) => {
      // Specification §26 keeps settings on the backend rather than in browser
      // storage, so the theme manager's own localStorage persistence stays off;
      // task 0030 restores the theme from the settings service instead.
      ThemeManager.setUseLocalStorage(false);
      ThemeManager.initialize(theme);
      if (attrs.runtime === 'mock') {
        loadMockDirectory(attrs.client);
      }
    },

    onremove: () => directoryRequest?.abort(),

    view: ({ attrs }) =>
      m('.fm-app-shell', [
        m('header.fm-app-bar', [
          m('h1.fm-app-title', 'File Manager'),
          m(
            'span.fm-runtime-badge',
            { title: 'Active transport, from VITE_RUNTIME' },
            attrs.runtime,
          ),
          m(ThemeSwitcher, {
            theme,
            showLabels: true,
            onThemeChange: (next: Theme) => {
              theme = next;
              ThemeManager.setTheme(next);
            },
          }),
        ]),
        m('main.fm-workspace', [
          m('section.fm-directory-preview', [
            m('h2', 'Directory'),
            m(DirectoryTable, {
              state: directoryState,
              source: entryArraySource(entries),
              active: true,
              label: 'Current directory',
              ...(entries.length > 0 ? { cursorIndex: 0 } : {}),
            }),
          ]),
        ]),
      ]),
  };
};
