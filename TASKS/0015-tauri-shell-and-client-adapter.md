# 0015 Tauri 2 shell application and Tauri client adapter

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: desktop
Depends on: 0012, 0014

## Context
`file-manager-coding-agent-spec.md` §2.4, §11, §12 and §33 steps 1 and 3. The desktop host embeds
the same frontend and calls the same `FileManagerService` through thin command adapters.

## Acceptance Criteria
- `apps/fm-desktop/src-tauri` builds a Tauri 2 application embedding the Vite frontend; the window
  shows the same app as browser mode.
- Commands mirror the semantic API: at minimum `get_runtime_capabilities` and `navigate_pane`,
  implemented as thin wrappers over `FileManagerService` (§11) with no filesystem logic.
- `RuntimeCapabilities.runtime` is `"tauri"` in desktop mode and reports the real platform.
- Errors map to `ApplicationErrorDto`, identical in shape to the REST errors.
- `frontend/src/api/client/tauri-file-manager-client.ts` implements `FileManagerClient` via
  `invoke`, and `frontend/src/api/events/tauri-event-stream.ts` implements `EventStream` via Tauri
  channels/events.
- Tauri capabilities file allow-lists only the commands actually used; no default full-filesystem
  plugin access (§22).
- Normal desktop mode opens no localhost port; any diagnostics HTTP mode is off by default (§11).
- `pnpm dev:tauri` and `pnpm build:tauri` work on macOS; CI adds Tauri build jobs for macOS and
  Windows (§31).
- A smoke test asserts the app starts and `getRuntimeCapabilities()` returns `runtime: "tauri"`.

## Implementation Notes
- Do not start Axum inside the Tauri process to reuse HTTP (§11).
- Keep `apps/fm-desktop/src-tauri` dependent on `fm-application` only, never on `fm-server`.
- Icons and product metadata can be placeholders until 0063.

## Agent Notes
- Not started.
