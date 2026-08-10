/** Diagnostics view component (spec §30). */

import m, { Vnode } from "mithril";
import { FileManagerClient } from "../../api/file-manager-client";
import { DiagnosticsView, diagnosticsFromDto } from "./diagnostics";
import { Spinner } from "../common/spinner";

interface DiagnosticsViewComponentState {
  diagnostics: DiagnosticsView | null;
  loading: boolean;
  error: string | null;
}

/** Diagnostics view component for troubleshooting and bug reports. */
export const DiagnosticsViewComponent = (client: FileManagerClient) => {
  const state: DiagnosticsViewComponentState = {
    diagnostics: null,
    loading: true,
    error: null,
  };

  const loadDiagnostics = async () => {
    try {
      state.loading = true;
      state.error = null;
      const response = await fetch("/api/v1/diagnostics");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const dto = await response.json();
      state.diagnostics = diagnosticsFromDto(dto);
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Unknown error";
    } finally {
      state.loading = false;
    }
  };

  return {
    oncreate: () => {
      loadDiagnostics();
    },
    view: (): Vnode => {
      if (state.loading) {
        return m("div.diagnostics-view", [m(Spinner)]);
      }

      if (state.error) {
        return m("div.diagnostics-view.error", [
          m("h2", "Diagnostics Error"),
          m("p", `Failed to load diagnostics: ${state.error}`),
          m(
            "button",
            {
              onclick: () => loadDiagnostics(),
            },
            "Retry"
          ),
        ]);
      }

      if (!state.diagnostics) {
        return m("div.diagnostics-view", m("p", "No diagnostics available"));
      }

      const diag = state.diagnostics;

      return m("div.diagnostics-view", [
        m("h1", "Application Diagnostics"),
        m("p.diagnostics-subtitle", [
          "Diagnostic information for troubleshooting. ",
          m(
            "button.copy-btn",
            {
              onclick: () => copyDiagnosticsToClipboard(diag),
              title: "Copy redacted diagnostics for bug reports",
            },
            "Copy for Bug Report"
          ),
        ]),

        // Version info section
        m("section.diagnostics-section", [
          m("h2", "Version Information"),
          m("dl", [
            m("dt", "Frontend Version"),
            m("dd", diag.frontendVersion || "(unknown)"),
            m("dt", "Backend Version"),
            m("dd", diag.backendVersion || "(unknown)"),
            diag.tauriVersion
              ? [
                  m("dt", "Tauri Version"),
                  m("dd", diag.tauriVersion),
                ]
              : [],
            m("dt", "Platform"),
            m("dd", diag.platform),
          ]),
        ]),

        // Runtime capabilities section
        m("section.diagnostics-section", [
          m("h2", "Runtime Capabilities"),
          m("dl", [
            m("dt", "Runtime"),
            m(
              "dd",
              diag.runtimeCapabilities.runtime?.charAt(0).toUpperCase() +
                diag.runtimeCapabilities.runtime?.slice(1) || "Unknown"
            ),
            m("dt", "Native Menus"),
            m("dd", diag.runtimeCapabilities.nativeMenus ? "Yes" : "No"),
            m("dt", "Native File Icons"),
            m("dd", diag.runtimeCapabilities.nativeFileIcons ? "Yes" : "No"),
            m("dt", "Native Thumbnails"),
            m("dd", diag.runtimeCapabilities.nativeThumbnails ? "Yes" : "No"),
            m("dt", "System Trash"),
            m("dd", diag.runtimeCapabilities.systemTrash ? "Yes" : "No"),
            m("dt", "Plugins"),
            m("dd", diag.runtimeCapabilities.plugins ? "Yes" : "No"),
          ]),
        ]),

        // Connection state section
        m("section.diagnostics-section", [
          m("h2", "Connection State"),
          m("dl", [
            m("dt", "Status"),
            m(
              "dd",
              m("span", { class: diag.connectionState.connected ? "status-ok" : "status-error" }, [
                diag.connectionState.connected ? "✓" : "✗",
                " ",
                diag.connectionState.statusMessage,
              ])
            ),
            m("dt", "Events Received"),
            m("dd", diag.connectionState.eventsReceived.toString()),
            m("dt", "Uptime"),
            m("dd", formatDuration(diag.connectionState.uptimeSeconds)),
            diag.connectionState.lastEventReceived
              ? [
                  m("dt", "Last Event"),
                  m("dd", new Date(diag.connectionState.lastEventReceived).toLocaleString()),
                ]
              : [],
          ]),
        ]),

        // Loaded plugins section
        diag.loadedPlugins.length > 0
          ? m("section.diagnostics-section", [
              m("h2", `Loaded Plugins (${diag.loadedPlugins.length})`),
              m(
                "ul.plugin-list",
                diag.loadedPlugins.map((plugin) =>
                  m("li", [
                    m("span.plugin-name", plugin.name),
                    m("span.plugin-status", [
                      plugin.enabled ? "Enabled" : "Disabled",
                      plugin.errorCount > 0 ? ` (${plugin.errorCount} errors)` : "",
                    ]),
                  ])
                )
              ),
            ])
          : [],

        // Operation queue status section
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
            m("dt", "Total Pending Size"),
            m("dd", formatBytes(diag.operationQueueStatus.totalPendingSize)),
          ]),
        ]),

        // Recent errors section
        diag.recentErrors.length > 0
          ? m("section.diagnostics-section", [
              m("h2", `Recent Errors (${diag.recentErrors.length})`),
              m(
                "div.errors-list",
                diag.recentErrors.map((error) =>
                  m("div.error-entry", [
                    m("strong", error.code),
                    m("span.timestamp", new Date(error.timestamp).toLocaleString()),
                    m("p", error.message),
                    error.context
                      ? m("small.error-context", `Context: ${error.context}`)
                      : [],
                  ])
                )
              ),
            ])
          : m("section.diagnostics-section", [m("p", "No recent errors")]),
      ]);
    },
  };
};

/** Format bytes to human-readable format. */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/** Format seconds to human-readable duration. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Copy redacted diagnostics to clipboard. */
async function copyDiagnosticsToClipboard(diag: DiagnosticsView): Promise<void> {
  // Import redaction from transport DTO (when available in frontend)
  const text = `=== Application Diagnostics ===
Frontend: ${diag.frontendVersion}
Backend: ${diag.backendVersion}
${diag.tauriVersion ? `Tauri: ${diag.tauriVersion}` : ""}
Platform: ${diag.platform}
Runtime: ${diag.runtimeCapabilities.runtime}

Connection: ${diag.connectionState.statusMessage}
Events: ${diag.connectionState.eventsReceived}
Uptime: ${formatDuration(diag.connectionState.uptimeSeconds)}

Plugins: ${diag.loadedPlugins.length} loaded
Operations: ${diag.operationQueueStatus.queuedCount} queued, ${diag.operationQueueStatus.runningCount} running

${diag.recentErrors.length > 0 ? `Recent Errors: ${diag.recentErrors.length}` : "No recent errors"}
`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      alert("Diagnostics copied to clipboard");
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      // Fallback: select text manually
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }
}
