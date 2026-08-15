# 0143 Workspace last-active restore and per-window desktop placement

Status: open
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
