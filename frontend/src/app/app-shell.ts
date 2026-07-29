import m, { type FactoryComponent } from 'mithril';
import { type Theme, ThemeManager, ThemeSwitcher } from 'mithril-materialized';

import type { RuntimeKind } from '../utilities/runtime';

/** Attributes of the application shell. */
export interface AppShellAttrs {
  /** Transport this build talks to, resolved from `VITE_RUNTIME`. */
  runtime: RuntimeKind;
}

const DEFAULT_THEME: Theme = 'auto';

/**
 * Placeholder application shell.
 *
 * A factory component so that per-instance state lives in the closure rather
 * than on a shared module-level object. The real window chrome — workspace
 * tabs, two panes, the operation centre and the function-key bar — is built in
 * tasks 0024 to 0026.
 */
export const AppShell: FactoryComponent<AppShellAttrs> = () => {
  let theme: Theme = DEFAULT_THEME;

  return {
    oninit: () => {
      // Specification §26 keeps settings on the backend rather than in browser
      // storage, so the theme manager's own localStorage persistence stays off;
      // task 0030 restores the theme from the settings service instead.
      ThemeManager.setUseLocalStorage(false);
      ThemeManager.initialize(theme);
    },

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
          m('p', 'Shell only. The two-pane workspace is built in tasks 0024 to 0026.'),
        ]),
      ]),
  };
};
