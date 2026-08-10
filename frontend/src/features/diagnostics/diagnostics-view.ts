/** Diagnostics view component (spec §30). */

import m from "mithril";
import type { Vnode } from "mithril";
import type { DiagnosticsView } from "./diagnostics";
import { diagnosticsFromDto } from "./diagnostics";

interface DiagnosticsState {
  diagnostics: DiagnosticsView | null;
  loading: boolean;
  error: string | null;
}

/** Diagnostics view component for troubleshooting and bug reports. */
export const DiagnosticsViewComponent = () => {
  const state: DiagnosticsState = {
    diagnostics: null,
    loading: true,
    error: null,
  };

  const loadDiagnostics = async () => {
    state.loading = true;
    state.error = null;
    try {
      const response = await fetch("/api/v1/diagnostics");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const dto: unknown = await response.json();
      state.diagnostics = diagnosticsFromDto(dto);
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Unknown error";
    } finally {
      state.loading = false;
      m.redraw();
    }
  };

  return {
    oncreate: () => {
      void loadDiagnostics();
    },
    view: (): Vnode => {
      if (state.loading) {
        return m("div.diagnostics-view", m("p", "Loading diagnostics…"));
      }

      if (state.error !== null) {
        return m("div.diagnostics-view.error", [
          m("h2", "Diagnostics Error"),
          m("p", `Failed to load diagnostics: ${state.error}`),
          m("button", { onclick: () => void loadDiagnostics() }, "Retry"),
        ]);
      }

      if (state.diagnostics === null) {
        return m("div.diagnostics-view", m("p", "No diagnostics available"));
      }

      const diag = state.diagnostics;

      return m("div.diagnostics-view", [
        m("p.diagnostics-subtitle", [
          m(
            "button.copy-btn",
            {
              onclick: () => void copyDiagnosticsToClipboard(diag),
              title: "Copy redacted diagnostics for bug reports",
            },
            "Copy for Bug Report",
          ),
        ]),

        m("section.diagnostics-section", [
          m("h2", "Version Information"),
          m("dl", [
            m("dt", "Frontend Version"),
            m("dd", diag.frontendVersion || "(unknown)"),
            m("dt", "Backend Version"),
            m("dd", diag.backendVersion || "(unknown)"),
            ...(diag.tauriVersion !== undefined
              ? [m("dt", "Tauri Version"), m("dd", diag.tauriVersion)]
              : []),
            m("dt", "Platform"),
            m("dd", diag.platform),
          ]),
        ]),

        m("section.diagnostics-section", [
          m("h2", "Runtime Capabilities"),
          m("dl", [
            m("dt", "Runtime"),
            m("dd", diag.runtimeCapabilities.runtime ?? "Unknown"),
            m("dt", "Native Menus"),
            m("dd", diag.runtimeCapabilities.nativeMenus ? "Yes" : "No"),
            m("dt", "Native File Icons"),
            m("dd", diag.runtimeCapabilities.nativeFileIcons ? "Yes" : "No"),
            m("dt", "System Trash"),
            m("dd", diag.runtimeCapabilities.systemTrash ? "Yes" : "No"),
            m("dt", "Plugins"),
            m("dd", diag.runtimeCapabilities.plugins ? "Yes" : "No"),
          ]),
        ]),

        m("section.diagnostics-section", [
          m("h2", "Connection State"),
          m("dl", [
            m("dt", "Status"),
            m(
              "dd",
              m(
                "span",
                {
                  class: diag.connectionState.connected
                    ? "status-ok"
                    : "status-error",
                },
                [
                  diag.connectionState.connected ? "✓" : "✗",
                  " ",
                  diag.connectionState.statusMessage,
                ],
              ),
            ),
            m("dt", "Events Received"),
            m("dd", diag.connectionState.eventsReceived.toString()),
            m("dt", "Uptime"),
            m("dd", formatDuration(diag.connectionState.uptimeSeconds)),
            ...(diag.connectionState.lastEventReceived !== undefined
              ? [
                  m("dt", "Last Event"),
                  m(
                    "dd",
                    new Date(
                      diag.connectionState.lastEventReceived,
                    ).toLocaleString(),
                  ),
                ]
              : []),
          ]),
        ]),

        diag.loadedPlugins.length > 0
          ? m("section.diagnostics-section", [
              m("h2", `Loaded Plugins (${diag.loadedPlugins.length})`),
              m(
                "ul.plugin-list",
                diag.loadedPlugins.map((plugin) =>
                  m("li", [
                    m("span.plugin-name", plugin.name),
                    " ",
                    m("span.plugin-status", [
                      plugin.enabled ? "Enabled" : "Disabled",
                      plugin.errorCount > 0
                        ? ` (${plugin.errorCount} errors)`
                        : "",
                    ]),
                  ]),
                ),
              ),
            ])
          : m("section.diagnostics-section", [
              m("h2", "Loaded Plugins"),
              m("p", "No plugins loaded"),
            ]),

        m("section.diagnostics-section", [
          m("h2", "Operation Queue"),
          m("dl", [
            m("dt", "Queued"),
            m("dd", diag.operationQueueStatus.queuedCount.toString()),
            m("dt", "Running"),
            m("dd", diag.operationQueueStatus.runningCount.toString()),
            m("dt", "Paused"),
            m("dd", diag.operationQueueStatus.pausedCount.toString()),
            m("dt", "Completed"),
            m("dd", diag.operationQueueStatus.completedCount.toString()),
          ]),
        ]),

        diag.recentErrors.length > 0
          ? m("section.diagnostics-section", [
              m("h2", `Recent Errors (${diag.recentErrors.length})`),
              m(
                "div.errors-list",
                diag.recentErrors.map((error) =>
                  m("div.error-entry", [
                    m("strong", error.code),
                    " ",
                    m(
                      "span.timestamp",
                      new Date(error.timestamp).toLocaleString(),
                    ),
                    m("p", error.message),
                  ]),
                ),
              ),
            ])
          : m("section.diagnostics-section", [
              m("h2", "Recent Errors"),
              m("p", "No recent errors"),
            ]),
      ]);
    },
  };
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

async function copyDiagnosticsToClipboard(diag: DiagnosticsView): Promise<void> {
  const lines = [
    "=== Application Diagnostics ===",
    `Frontend: ${diag.frontendVersion}`,
    `Backend: ${diag.backendVersion}`,
    diag.tauriVersion !== undefined ? `Tauri: ${diag.tauriVersion}` : null,
    `Platform: ${diag.platform}`,
    `Runtime: ${diag.runtimeCapabilities.runtime ?? "Unknown"}`,
    "",
    "=== Connection ===",
    `Status: ${diag.connectionState.statusMessage}`,
    `Events received: ${diag.connectionState.eventsReceived}`,
    `Uptime: ${formatDuration(diag.connectionState.uptimeSeconds)}`,
    "",
    `=== Plugins (${diag.loadedPlugins.length}) ===`,
    ...diag.loadedPlugins.map(
      (p) =>
        `  ${p.name} v${p.version} [${p.enabled ? "enabled" : "disabled"}]${p.errorCount > 0 ? ` ${p.errorCount} errors` : ""}`,
    ),
    "",
    `=== Recent Errors (${diag.recentErrors.length}) ===`,
    ...diag.recentErrors.map(
      (e) => `  [${e.timestamp}] ${e.code}: ${e.message}`,
    ),
  ]
    .filter((l) => l !== null)
    .join("\n");

  if (navigator.clipboard) {
    await navigator.clipboard.writeText(lines);
  } else {
    const ta = document.createElement("textarea");
    ta.value = lines;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}
