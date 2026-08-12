import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import m, { type FactoryComponent } from 'mithril';
import type { Location } from '../../models';
import type { TerminalClient } from './terminal-client';

export interface TerminalDrawerAttrs {
  readonly open: boolean;
  readonly location: Location | undefined;
  readonly client: TerminalClient;
  readonly onResize?: (height: number) => void;
  readonly onToggle: () => void;
  readonly onSwitchPane?: () => void;
  readonly onCycleTab?: (direction: 1 | -1) => void;
  readonly onFocusFolder?: () => void;
  readonly registerFocus?: (focus: () => boolean) => void;
}

type LiveTerminal = {
  terminal: Terminal;
  fit: FitAddon;
  surface: HTMLElement;
  sessionId?: string | undefined;
};

export interface TerminalKeyHandlers {
  readonly onToggle: () => void;
  readonly onSwitchPane?: () => void;
  readonly onCycleTab?: (direction: 1 | -1) => void;
  readonly onFocusFolder?: () => void;
}

/** Returns file-manager navigation chords to the application while xterm owns DOM focus. */
export function handleTerminalKeyEvent(
  event: KeyboardEvent,
  handlers: TerminalKeyHandlers,
): boolean {
  const bareModifiers = !event.altKey && !event.metaKey && !event.shiftKey;
  const toggleKey =
    bareModifiers &&
    ((!event.ctrlKey && (event.key === 'F12' || event.code === 'F12')) ||
      (event.ctrlKey && (event.key === '`' || event.code === 'Backquote')));
  if (event.type !== 'keydown') return true;
  const tabKey = event.key === 'Tab' || event.code === 'Tab';
  const handled = toggleKey || (tabKey && !event.altKey && !event.metaKey);
  if (!handled) return true;
  event.preventDefault();
  event.stopPropagation();
  if (toggleKey) handlers.onToggle();
  else if (event.ctrlKey) handlers.onCycleTab?.(event.shiftKey ? -1 : 1);
  else if (event.shiftKey) handlers.onFocusFolder?.();
  else handlers.onSwitchPane?.();
  return false;
}

/** Shows one location-owned terminal surface without confusing it with the shared drawer host. */
export function showTerminalSurface(host: HTMLElement, surface: HTMLElement): void {
  if (host.childElementCount !== 1 || host.firstElementChild !== surface) {
    host.replaceChildren(surface);
  }
}

/** A bottom drawer whose xterm instances remain mounted and keyed by backing location. */
export const TerminalDrawer: FactoryComponent<TerminalDrawerAttrs> = () => {
  const terminals = new Map<string, LiveTerminal>();
  let observer: ResizeObserver | undefined;
  let currentAttrs: TerminalDrawerAttrs | undefined;

  function ensure(attrs: TerminalDrawerAttrs, element: HTMLElement): void {
    if (!attrs.open) return;
    const location = attrs.location;
    if (location === undefined) return;
    let live = terminals.get(location.uri);
    if (live === undefined) {
      const inheritedFontSize = Number.parseFloat(getComputedStyle(element).fontSize);
      const style = getComputedStyle(element);
      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontSize: Number.isFinite(inheritedFontSize) ? inheritedFontSize : 12.88,
        theme: {
          background: style.getPropertyValue('--fm-surface').trim(),
          foreground: style.getPropertyValue('--fm-text').trim(),
          cursor: style.getPropertyValue('--fm-accent').trim(),
          selectionBackground: style.getPropertyValue('--fm-selection').trim(),
        },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      const surface = document.createElement('div');
      surface.className = 'fm-terminal-surface';
      live = { terminal, fit, surface };
      terminals.set(location.uri, live);
      terminal.attachCustomKeyEventHandler((event) =>
        handleTerminalKeyEvent(event, {
          onToggle: () => {
            attrs.onToggle();
            m.redraw();
          },
          onSwitchPane: attrs.onSwitchPane,
          onCycleTab: attrs.onCycleTab,
          onFocusFolder: attrs.onFocusFolder,
        }),
      );
      terminal.onData((data) => {
        if (live?.sessionId !== undefined)
          void attrs.client.write(live.sessionId, new TextEncoder().encode(data));
      });
      showTerminalSurface(element, surface);
      terminal.open(surface);
    } else {
      showTerminalSurface(element, live.surface);
    }
    live.fit.fit();
    if (live.sessionId === undefined) {
      void attrs.client
        .open(location, live.terminal.cols, live.terminal.rows, (event) => {
          if (event.type === 'output') live?.terminal.write(new Uint8Array(event.data));
          else if (event.type === 'exited') {
            live?.terminal.write('\r\n\x1b[90m[Terminal session ended]\x1b[0m\r\n');
            // Clear the dead session id so the next toggle/reopen redials
            // instead of silently reusing a session the backend already
            // discarded (the backend removes it from its own registry too).
            if (live !== undefined) live.sessionId = undefined;
          }
        })
        .then((id) => {
          if (live !== undefined) live.sessionId = id;
        });
    } else {
      void attrs.client.resize(live.sessionId, live.terminal.cols, live.terminal.rows);
    }
  }

  return {
    oninit: ({ attrs }) => {
      currentAttrs = attrs;
      attrs.registerFocus?.(() => {
        const uri = currentAttrs?.location?.uri;
        const live = uri === undefined ? undefined : terminals.get(uri);
        if (currentAttrs?.open !== true || live === undefined) return false;
        live.terminal.focus();
        return true;
      });
    },
    onremove: () => {
      observer?.disconnect();
      for (const live of terminals.values()) live.terminal.dispose();
    },
    view: ({ attrs }) => {
      currentAttrs = attrs;
      return m('.fm-terminal-drawer', { hidden: !attrs.open, 'aria-label': 'Terminal drawer' }, [
        m('.fm-terminal-resize-handle', {
          onpointerdown: (event: PointerEvent) => {
            const drawer = (event.currentTarget as HTMLElement).parentElement;
            if (drawer === null) return;
            const startY = event.clientY;
            const startHeight = drawer.getBoundingClientRect().height;
            const move = (moveEvent: PointerEvent) => {
              const height = Math.max(
                120,
                Math.min(window.innerHeight * 0.8, startHeight + startY - moveEvent.clientY),
              );
              drawer.style.height = `${height}px`;
              attrs.onResize?.(height);
              const live =
                attrs.location === undefined ? undefined : terminals.get(attrs.location.uri);
              live?.fit.fit();
              if (live?.sessionId !== undefined)
                void attrs.client.resize(live.sessionId, live.terminal.cols, live.terminal.rows);
            };
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          },
        }),
        attrs.location === undefined
          ? m('.fm-terminal-unavailable', 'Select a directory to open a terminal.')
          : m('.fm-terminal-host', {
              oncreate: ({ dom }) => {
                ensure(attrs, dom as HTMLElement);
                if (typeof ResizeObserver !== 'undefined') {
                  observer = new ResizeObserver(() => ensure(attrs, dom as HTMLElement));
                  observer.observe(dom as HTMLElement);
                }
              },
              onupdate: ({ dom }) => ensure(attrs, dom as HTMLElement),
            }),
      ]);
    },
  };
};
