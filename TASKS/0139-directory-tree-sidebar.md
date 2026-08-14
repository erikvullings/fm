# 0139 Directory tree dialog / sidebar tree view

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0129

## Context

Split out of [0129](0129-total-commander-shortcuts-major-features.md) (Alt+F10 / Ctrl+F8 row) in the
2026-08-14 re-triage — confirmed still genuinely missing, not just undiscovered. Total Commander's
Alt+F10/Ctrl+F8 open a directory tree (dialog or sidebar) for fast hierarchical navigation and
jump-to. fm's panes today only render a flat listing of the active directory (0024's virtualized
table) plus the favourites menu (0070) for jumping to saved locations — there is no way to see or
navigate the surrounding directory structure without opening each level in turn.

Meaningfully sized (a new component, not a shortcut binding), and a commonly-expected feature in a
"state-of-the-art" file manager (Finder's sidebar, Explorer's tree pane, most dual-pane managers).

## Acceptance Criteria
- A tree view (sidebar or toggleable dialog — pick one; a persistent sidebar is more discoverable
  and more consistent with Finder/Explorer, a dialog is cheaper to build and closer to TC's actual
  behaviour) showing the directory hierarchy from the active pane's provider root downward.
- Lazy expansion: child nodes are fetched only when a branch is expanded, not eagerly for the whole
  tree (reuse the existing `VfsProvider`/`DirectoryService` listing path, not a bespoke walk).
- Selecting/activating a tree node navigates the active pane to that directory, and the tree stays
  in sync when the active pane navigates by other means (breadcrumbs, history, favourites) — the
  tree's expanded/highlighted path always reflects the active pane's current location.
- Works across VFS providers (local, SFTP, FTP, archive, etc.), not just the local filesystem —
  reuse the same provider abstraction the table view already depends on.
- Keyboard-navigable (arrow keys to expand/collapse/move, matching the accessibility bar set by the
  rest of the app per 0066).
- Tests: lazy-expansion fetch behaviour, active-pane-location sync in both directions, provider
  parity (at least local + one remote provider), keyboard navigation.

## Implementation Notes
- Check [0134](0134-thumbnails-and-grid-view.md) before starting — it introduces a general
  view-mode/layout question for panes; keep the tree view's layout integration aware of whatever
  that task lands, even though they're separate UI surfaces (tree sidebar vs. grid/icon view).
- Favour reusing 0024's virtualized list primitives for rendering large flat runs of siblings within
  an expanded node, rather than a fully custom tree-rendering component, if that keeps the
  implementation simpler.
- Decide sidebar vs. dialog early — this materially changes the pane layout work involved (0026)
  vs. a self-contained modal.

## Agent Notes
- (none yet)
