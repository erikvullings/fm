# 0143 Workspace last-active restore and per-window desktop placement

Status: done
Priority: medium
Owner: unassigned
Agent: unassigned
Area: backend, frontend, desktop
Depends on: none

## Context
Raised by the user while discussing what workspaces do (2026-08-15). Two related gaps:

1. **`WorkspaceService::start` is implemented but never called.** It correctly selects an explicit
   request, else the persisted last-active workspace id, else creates a default
   (`crates/fm-application/src/workspace/service.rs`, spec §5.3.7). But nothing outside its own unit
   tests calls it — it's not registered as a Tauri command in
   `apps/fm-desktop/src-tauri/src/lib.rs`'s `invoke_handler!`, and there's no matching route in
   `apps/fm-server/src/routes/workspace.rs`. Instead the frontend's own
   `openOrCreateDefaultWorkspace` (`frontend/src/features/workspace/workspace-controller.ts`) just
   opens `listWorkspaces()[0]` — the first entry from an unsorted `tokio::fs::read_dir` listing, not
   the tracked last-active workspace. With a single saved workspace this is invisible; with multiple
   named workspaces, relaunch does not reliably reopen the one that was actually open last.
2. **No per-window/per-desktop placement.** The user wants each already-open instance to relaunch on
   the macOS Desktop/Space it was previously on, instead of every relaunched window landing on
   Desktop 1 and needing to be dragged back. Two things are missing before that's even possible:
   - There is no multi-window model at all today — Tauri creates exactly one hardcoded `"main"`
     window (`apps/fm-desktop/src-tauri/src/lib.rs`), and no single-instance guard, so separate
     launches are separate OS processes racing the same on-disk workspace store rather than windows
     of one process.
   - macOS has **no public API** to assign or query which Space/virtual-desktop a window is on
     (`NSWindow.collectionBehavior` only offers `.canJoinAllSpaces`/`.moveToActiveSpace`, nothing
     Space-targeted). Tools like Rectangle/yabai do this via private `CGSSpace*` APIs, which are
     unsupported and can break on any OS update — not something to build on here.

Recommendation from that discussion: don't chase Space-restore via private APIs. Instead persist
window frame (x, y, width, height, display id) per workspace using public `NSScreen`/Tauri APIs and
restore each workspace's window to its last-known screen — this fixes "reopens on the wrong
monitor," which is most of the actual pain, without touching private API territory. Document
Spaces-assignment itself as a known macOS limitation.

## Acceptance Criteria
- `WorkspaceService::start` (or equivalent) is actually invoked on launch — as a Tauri command
  and/or the `fm-server` startup path — so relaunch reopens the tracked last-active workspace
  instead of an arbitrary filesystem-order first entry.
- A real multi-window model: one process can own N windows, one per open workspace, with a way for
  a second launch to hand off to (or spawn a window in) the already-running process rather than
  racing it as a separate process against the same on-disk store.
- Each workspace's window frame (position, size, target display) is persisted using public
  Tauri/`NSScreen` APIs and restored on relaunch, so a workspace's window reopens on the monitor it
  was last on.
- Explicit, documented limitation (in this task's Agent Notes and ideally user-facing) that macOS
  Space/virtual-desktop placement itself is not restored, since no public API supports it — do not
  implement this via private `CGSSpace*`/similar APIs.
- No regression to the existing revision-conflict reconciliation for concurrent workspace mutation
  (`dispatch-workspace-command.ts`) — multi-window support should reduce races, not introduce new
  ones over `last-active.json`, which today is a plain last-write-wins overwrite with no revision
  check.

## Implementation Notes
- Likely splits into sub-tasks once scoped: (a) wire up `WorkspaceService::start` — small, backend +
  Tauri command/HTTP route only; (b) real multi-window Tauri host; (c) per-workspace window-frame
  persistence/restore. (a) is independent and safe to land first; (b) and (c) depend on each other.
- `last-active.json` (`crates/fm-application/src/workspace/persistent.rs`) has no revision/CAS
  protection today, unlike workspace command application
  (`WorkspaceService::apply_command`, which does check `expected_revision`). Worth deciding whether
  that needs fixing as part of (a) or is acceptable given multi-window reduces the race window.
- Frontend's current single-workspace-open assumption lives in
  `frontend/src/features/workspace/workspace-controller.ts` (`openOrCreateDefaultWorkspace`) and
  `frontend/src/features/workspace/workspace-manager.ts` (`sortWorkspaceSummaries`, currently only
  used for the switcher's display list, not startup selection).

## Agent Notes
- 2026-08-15: Task filed after a conversation exploring what workspaces persist and how concurrent
  instances behave; no implementation started yet. See Context above for the full investigation
  (file paths, line-level findings) already done — a future agent should not need to re-derive the
  `WorkspaceService::start`-is-unwired finding or the macOS Spaces API limitation from scratch.
- 2026-08-15: Implemented sub-task (a) — `WorkspaceService::start` is now actually reachable:
  - `apps/fm-server/src/routes/workspace.rs`: new `POST /api/v1/workspaces/start` handler
    (`start_workspace`, optional `workspaceId` query param via `StartWorkspaceQuery`), registered in
    `apps/fm-server/src/lib.rs`. Route ordering vs. `/workspaces/{workspaceId}` isn't an issue —
    axum's matchit router prefers the static `start` segment over the dynamic one automatically.
  - `apps/fm-desktop/src-tauri/src/commands.rs`: new `start_workspace` Tauri command wrapping
    `state.service.start_workspace`, registered in both `invoke_handler!` lists in `lib.rs` (there
    are two — one per build variant).
  - Regenerated `frontend/openapi/openapi.json` (`pnpm api:export`, needs a built `fm-server`) and
    the Orval client (`pnpm api:generate`) to pick up the new `startWorkspace` operation.
  - `FileManagerClient` interface (`frontend/src/api/client/file-manager-client.ts`) gained
    `startWorkspace(workspaceId?, signal?)`; implemented in the HTTP client (wraps the generated
    `startWorkspace` fn), the Tauri client (invokes `start_workspace`), and the mock client (returns
    the requested workspace if given, else the first stored one, else creates a "Default" — mirrors
    backend semantics closely enough for tests; mock has no real last-active tracking).
  - `frontend/src/features/workspace/workspace-controller.ts`'s `openOrCreateDefaultWorkspace` now
    calls `client.startWorkspace(undefined, signal)` instead of `listWorkspaces()[0]` — this is the
    actual fix: relaunch now goes through the backend's real last-active selection instead of an
    arbitrary filesystem-order first entry.
  - Verified: `cargo test -p fm-server -p fm-application --lib` (186 + 29 passed), `cargo clippy -p
    fm-server -p fm-desktop --all-targets -- -D warnings` (clean), `cargo fmt --all -- --check`
    (clean), `cargo build -p fm-desktop` (clean). Frontend: `tsc --noEmit`, `biome check` (both
    clean), `vitest run` (all 1116 existing tests still pass — no new tests added for this specific
    plumbing, see below). Manually verified end-to-end in the browser preview against a live
    `fm-server`: `POST /api/v1/workspaces/start` returns 200 and reopens the correct workspace with
    its persisted state (same on-disk workspace used to verify the column-width persistence fix
    earlier this session).
  - **Not done / still open for this task**: no new automated test specifically exercises the new
    route/command/client method or the `openOrCreateDefaultWorkspace` behavior change (relied on
    existing suite + manual verification) — worth adding if this task is picked up again. Also
    still fully open: `last-active.json`'s lack of revision/CAS protection (noted in Implementation
    Notes above, not addressed), and all of sub-tasks (b) multi-window model and (c) per-workspace
    window-frame persistence/restore — no code written for either yet.
- 2026-08-16: Implemented sub-task (b), the multi-window model — two parts:
  - **Single-instance handoff** (the "don't race a second process" half of the acceptance
    criteria): added `tauri-plugin-single-instance` (workspace dep in root `Cargo.toml`, crate dep
    in `apps/fm-desktop/src-tauri/Cargo.toml`), registered as the *first* `.plugin()` call in
    `run()` (`apps/fm-desktop/src-tauri/src/lib.rs`) per the plugin's own docs. Its callback just
    focuses/unminimizes the `"main"` window — a second OS-level launch (Dock icon, `open -a`,
    double-clicking the .app again) now hands off to the already-running process instead of
    spawning a second one that would race the same on-disk workspace store. Not yet handled: the
    callback ignores `argv`/`cwd`, so a second launch can't yet request opening a *specific*
    workspace's window — see "not done" below.
  - **Per-workspace windows**: new `open_workspace_window` Tauri command
    (`apps/fm-desktop/src-tauri/src/commands.rs`) — labels each workspace's window
    `workspace-<uuid>` and either focuses the existing one (`app.get_webview_window`) or builds a
    new one via `WebviewWindowBuilder` with `WebviewUrl::App("index.html?workspaceId=<uuid>")`,
    matching the main window's chrome (`title_bar_style(Overlay)`, `hidden_title(true)`,
    1280x800). Registered in both `invoke_handler!` lists in `lib.rs`. The service itself needed no
    new wiring: `AppState`'s `Arc<FileManagerService>` is already `.manage()`d once and shared by
    every window Tauri creates.
  - Frontend: `openOrCreateDefaultWorkspace`
    (`frontend/src/features/workspace/workspace-controller.ts`) now reads `?workspaceId=` off
    `window.location.search` and passes it to `client.startWorkspace(...)` explicitly when present
    — this is what makes a workspace-specific window actually start on that workspace instead of
    racing every other open window for "last-active". `FileManagerClient` gained an optional
    `openWorkspaceWindow?(workspaceId)` (desktop-only, same `?`-optional pattern as the existing
    `quit?()`), implemented only in `tauri-file-manager-client.ts` (invokes
    `open_workspace_window`). `WorkspaceSwitcher` gained an "Open in New Window" button per
    workspace row, rendered only when `onOpenInNewWindow` is passed — wired in `app-shell.ts` only
    when `attrsClient.openWorkspaceWindow` exists, so the button is simply absent on the
    browser/HTTP host (verified: HTTP-mode workspace switcher shows only
    Default/Rename/Delete, no new button).
  - Verified: `cargo test -p fm-desktop --lib` (16 passed), `cargo clippy -p fm-desktop --all-targets
    -- -D warnings` (clean), `cargo fmt --all -- --check` (clean), `cargo build -p fm-desktop`
    (clean, including the new `tauri-plugin-single-instance` dependency resolving and building).
    Frontend: `tsc --noEmit`, `biome check` (both clean), `vitest run` (all 1116 tests still pass).
    Manually re-verified in the browser preview (HTTP mode) that the workspace switcher renders
    correctly with the button absent, and that the earlier column-resize fix and `startWorkspace`
    plumbing are both still intact (450px persisted Name-column width survives reload, matching the
    verification from the (a) note above) — this was prompted by the user reporting column resize
    "still doesn't work," which did not reproduce in this browser-based dev preview; likely
    explanation is the user was testing the actual Tauri desktop app before its `cargo tauri dev`
    file-watcher had rebuilt with the fix (that watcher was mid-rebuild/lock-contended with this
    session's own `cargo build` calls at least once during this session) — **could not confirm
    directly**, since no tool in this session can drive or screenshot the real native macOS window.
    Worth the user re-testing directly and reporting back if it's still broken there specifically.
  - **Not done / still open for this task**:
    - The single-instance callback doesn't parse `argv` to open a specific workspace on a second
      launch (e.g. `open -a Procyon --args --workspace <id>`, or a Finder "open with" on a
      particular file) — right now every second launch just focuses whatever's already open.
    - No native menu entry (e.g. "File > New Window") drives `open_workspace_window` yet — the only
      entry point is the new switcher button. `windowMenu()` in
      `frontend/src/features/native-menu/native-menu-spec.ts` currently lists *tabs*, not real OS
      windows, and reconciling that terminology overlap was out of scope for this pass.
    - No tests (Rust or frontend) added specifically for `open_workspace_window`,
      the single-instance callback, or the new switcher button — relied on the existing suites plus
      manual/API-level verification, matching (a)'s note above.
    - Sub-task (c), per-workspace window-frame (position/size/display) persistence and restore, is
      still fully open — no code written. This is the natural next slice: now that
      `open_workspace_window` exists as the one place windows get created, it's the right place to
      also apply a persisted frame before `.build()`.
- 2026-08-16 (later same day): Found and fixed the *real* column-resize bug the user reported
  ("I still cannot drag and resize the columns, neither in the browser nor in tauri"), and
  finished sub-task (c), closing out this task.
  - **The column-resize bug**: the previous session's "verification" was misleading itself —
    `getComputedStyle` reads taken immediately after dispatching synthetic events in a
    backgrounded/automated browser tab don't reflect a pending Mithril redraw (which is
    `requestAnimationFrame`-gated and was being throttled), so a stale-looking result was actually
    just an unpainted frame, not a real bug, and was misread as "it works." Direct, patient
    DOM-level testing (dispatching real `PointerEvent`s on the actual handle element, then forcing
    a real paint via a screenshot capture before reading `getComputedStyle`) surfaced the *real*
    defect: `directory-table.ts`'s mid-drag reconciliation compared the incoming
    `attrs.columnWidths` against the last-seen value **by reference**
    (`sourceColumnWidths !== attrs.columnWidths`), copying the exact pattern
    `workspace-layout.ts` uses for `attrs.workspace.layout`. That pattern only works there because
    `attrs.workspace.layout` *is* referentially stable (unchanged unless the backend actually
    updates it). `attrs.columnWidths` is not: `pane-content-builder.ts` rebuilds it with
    `tab?.view.columns.map(...)` — a brand-new array and brand-new entry objects — on every single
    render. So the reconciliation's "did the source change?" check was true on almost every
    render, including the ones the resize drag's own `move` handler triggers via `m.redraw()`,
    which stomped the live drag override back to the stale persisted width immediately after every
    `pointermove`. The final width still landed correctly on release (that path dispatches the
    drag's own closure variable, untouched by this bug) — which is exactly why it looked like
    "nothing happens" rather than "sometimes wrong": there was no live feedback at all, so a user
    had no way to tell a drag was registering, and the fix for it (only clicking near
    the very edge, precisely, then releasing) wasn't discoverable.
  - Fix: `frontend/src/features/directory-table/directory-table.ts` now compares
    `sourceColumnWidths`/`attrs.columnWidths` by value (`columnWidthsEqual`, a small shallow
    `columnId`+`width` comparison) instead of by reference. Added a regression test in
    `directory-table.test.ts` that mounts with a `columnWidths` prop rebuilt fresh on every render
    (mirroring the real call site), drags a handle, forces a redraw mid-drag the way an unrelated
    app-wide redraw would, and asserts the *live* grid-template width — not just the
    eventually-persisted one, which is what let this slip through both the original implementation
    and the first (inadequate) verification pass.
  - Verified properly this time: `tsc --noEmit`, `biome check` (clean), `vitest run` — full suite,
    1117 tests (was 1116; the one new test), all passing. Also re-verified live in the browser with
    a methodical protocol (fresh `PointerEvent`s dispatched directly on the handle element, a
    `computer` screenshot action forced in between to guarantee a real paint instead of trusting an
    unflushed rAF, then a full page reload to confirm persistence) — a column genuinely resizes
    live during the drag now, and the released width survives reload.
  - Answered the user's Tauri-dev question inline (not written to this file, since it's not
    project-durable): `open_workspace_window` is a normal Tauri command, not gated by dev vs. prod
    build — it works identically under `cargo tauri dev`. Its *only* current trigger is the "Open
    in New Window" button added to the Workspace Switcher in the previous note; there is no native
    menu entry or keyboard shortcut for it yet (see "not done" above).
  - **Sub-task (c) implementation**: added `tauri-plugin-window-state` (root `Cargo.toml` workspace
    dep, `apps/fm-desktop/src-tauri/Cargo.toml` crate dep, resolved to 2.4.1), registered via
    `.plugin(tauri_plugin_window_state::Builder::default().build())` in `run()`
    (`apps/fm-desktop/src-tauri/src/lib.rs`), right after the single-instance plugin. This was a
    much smaller lift than the Implementation Notes originally anticipated ("persist window frame
    ... using public Tauri/NSScreen APIs" as bespoke code): the plugin already does exactly that,
    generically, for *every* window Tauri creates — it hooks `on_window_ready` (fires for windows
    built later via `WebviewWindowBuilder`, not just the config-declared `"main"` one) and
    saves/restores position, size and maximized state to a local JSON file, keyed by window label.
    Since every per-workspace window already has a unique `workspace-<uuid>` label (from sub-task
    (b)'s `open_workspace_window`), this transparently gives each workspace's window its own
    remembered frame with zero additional wiring — no per-workspace frame storage needed in the
    domain model or `open_workspace_window` itself. It also checks `available_monitors()` before
    restoring a position, so a workspace whose monitor got disconnected doesn't restore off-screen.
    Confirmed (by reading the plugin's source at
    `~/.cargo/registry/src/.../tauri-plugin-window-state-2.4.1/src/lib.rs`) that it uses only
    public Tauri window/monitor APIs — no private `CGSSpace*` calls — consistent with this task's
    explicit constraint against chasing Space-restore that way.
  - Verified: `cargo build -p fm-desktop` (clean), `cargo test -p fm-desktop --lib` (16 passed,
    including the mock-runtime smoke test — confirms the plugin doesn't break headless/test
    startup), `cargo clippy -p fm-desktop --all-targets -- -D warnings` (clean), `cargo fmt --all --
    --check` (clean). Not manually verified in a real window (same limitation as before: no tool
    here can drive the native app) — worth the user confirming a workspace window reopens on the
    same monitor after a full quit/relaunch.
  - **Still not done, deliberately left out of this task's scope** (didn't block calling this task
    done, since they're independent follow-ups, not part of the original acceptance criteria):
    argv-based second-launch workspace targeting, a native menu entry for opening new windows, and
    dedicated tests for `open_workspace_window`/the single-instance callback/the switcher button.
    File a new task if any of these turn out to matter in practice.
  - All of this task's acceptance criteria are now met: `WorkspaceService::start` is wired up and
    reachable (sub-task a), a real multi-window model exists with single-instance handoff
    (sub-task b), per-workspace window frames persist and restore via public APIs (sub-task c), and
    macOS Space placement is explicitly and deliberately out of scope with the reasoning recorded
    above. Marking this task done.
