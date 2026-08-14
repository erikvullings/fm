# 0133 Populate native menu bar content (macOS + Windows)

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: desktop
Depends on: 0059

## Context

`PlatformAdapter::install_native_menu` (`crates/fm-platform/src/adapter.rs`) is a hook-point-only
trait method. On macOS (0059) it acquires the `MainThreadMarker`, creates an `NSMenu`, and installs
it as the app's main menu via `NSApplication::sharedApplication().setMainMenu(...)` — but the menu
is **empty**. There is no File/Edit/View/Go/Window/Help structure, no OS-level `Cmd+,` Preferences
item, no populated Window menu (so Mission Control / Cmd+backtick window switching shows a generic
app entry instead of real menu items), and no dynamic "Open Recent" in the Dock menu. On Windows,
the hook doesn't exist yet at all — see 0131, still open.

Raised during a review of macOS integration gaps: fm's context menus and command palette (0051,
0052) cover in-app discovery well, but the OS-level menu bar — which macOS users expect to reflect
the app's capabilities and which text fields/inputs rely on for their built-in Edit menu wiring
(cut/copy/paste/undo working in native text fields) — is currently a no-op.

## Acceptance Criteria
- macOS: a real menu bar with standard sections — App menu (About, Preferences `Cmd+,`, Services,
  Hide/Quit), File (New window/tab, Close), Edit (Undo/Redo/Cut/Copy/Paste/Select All — wire to the
  same actions as 0049's action registry so behaviour matches the keyboard shortcuts already bound),
  View, Go (favourites/recent locations from 0070), Window (Minimize, Zoom, real window list), Help.
- Menu items that duplicate an existing action-registry command (0049/0050) dispatch through the
  same action id as the keyboard shortcut, not a separate code path — no divergent behaviour between
  pressing `Cmd+,` from the keyboard and clicking "Preferences…" in the menu.
- Windows: once 0131's hook lands, an equivalent `HMENU`-based menu bar with the same logical
  sections adapted to Windows conventions (File/Edit/View/Go/Window/Help, no separate App menu).
- The Window menu (macOS) or equivalent reflects actual open windows/workspaces, not a static list.
- "Open Recent" (or equivalent) reflects 0070's recent-locations list.
- Menu content updates when action availability changes (e.g. Undo disabled when there's nothing to
  undo), following whatever pattern 0052's context-menu availability checks already use.
- Tests: platform adapter unit tests asserting menu structure/item ids where feasible without a real
  windowing system; manual verification recorded for both platforms (native UI trees are hard to
  assert against in CI).

## Implementation Notes
- Reuse the action registry (0049) as the source of truth for menu item labels/shortcuts/enabled
  state rather than hand-maintaining a parallel list — the command palette (0051) already does this
  and is a good reference implementation.
- Keep menu construction behind the existing `PlatformAdapter` trait; don't leak `NSMenu`/`HMENU`
  types outside `fm-platform-macos`/`fm-platform-windows`.
- The Windows half is blocked on 0131 (hook point) landing first, or can be scoped together with it
  in one PR if picked up jointly.

## Agent Notes
- (none yet)
