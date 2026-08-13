# 0129 Total Commander shortcut parity — features requiring new subsystems

Status: open
Priority: low
Subsystem: frontend
Depends on: none

## Context

Companion to [0128](0128-total-commander-shortcuts-quick-wins.md). That task covers shortcuts fm
already has (or can add cheaply by reusing existing operations/UI). This task covers shortcuts
from https://tutorialtactic.com/blog/total-commander-shortcuts/ whose Total Commander behavior
requires a genuinely new piece of functionality — a new dialog, a new pane/view mode, new backend
capability, or a platform integration (system tray, etc.) fm does not have today.

Each row below is independently schedulable; split into its own task file when picked up, using
`Depends on: 0129` if the breakdown is kept as a parent/subtask structure, or just reference this
file's context if promoted directly.

## Candidate features

**Corrections from initial triage:** two rows originally listed here were wrong — both features
already exist or are already tracked elsewhere in `TASKS/`:
- **Ctrl+M (Multi Rename Tool)** — already implemented, see [0072](0072-multi-rename.md) (done).
  Triggered via F2 with more than one entry selected rather than a dedicated Ctrl+M chord. Moved to
  [0128](0128-total-commander-shortcuts-quick-wins.md) as an "already implemented" entry; binding
  Ctrl+M as an additional alias to the same dialog is a cheap addition if wanted, also tracked in 0128.
- **Shift+F2 (Compare file lists)** — already tracked as its own open task, see
  [0075](0075-directory-comparison-and-synchronization.md) (directory comparison and
  synchronization). Not duplicated here; 0075 should also register the Shift+F2 shortcut once
  implemented.

| TC shortcut(s) | TC behavior | What's missing in fm | Notes |
|---|---|---|---|
| Ctrl+Q | Quick View panel (live inline preview) | A preview pane rendered alongside the file list, updating as the cursor moves | **Declined by prior product direction**, not just "missing": [0071](0071-file-preview-architecture.md)'s Agent Notes record that cursor-driven automatic preview loading was explicitly reversed on 2026-08-04 (it fetched bytes for every entry the cursor passed over). Preview is intentionally opt-in via F3 only (0088). Re-adding a TC-style auto-follow Quick View would need that product decision revisited first — don't implement this row without re-confirming that. |
| Alt+F10 / Ctrl+F8 | Directory tree dialog / sidebar tree view | No tree-view UI exists; only flat pane listings | Moderate-to-large: tree component, lazy expansion, sync with active pane location. |
| Alt+F8 | Command-line history dropdown | fm has no built-in command-line/console input at all | Would need an actual command bar first, not just a shortcut; likely superseded by the existing [embedded terminal drawer](0126-embedded-terminal-drawer.md) — evaluate whether a real command bar is still wanted or whether the terminal drawer already fills this role. |
| Alt+F1 / Alt+F2 | Switch left/right panel to a different drive letter | fm has no "drive" concept (VFS locations/connections instead) | Nearest equivalent would be a quick-switch menu over configured connections/roots per pane — needs UX design before implementation, not just a shortcut binding. |
| Ctrl+I | Switch current directory to the path shown in the opposite panel | Overlaps with the cheap Ctrl+Left/Right "duplicate path" addition in [0128](0128-total-commander-shortcuts-quick-wins.md) | Revisit after 0128 lands — may turn out to already be covered and this row can be dropped. |
| Alt+Enter | File/folder Properties dialog | No properties dialog exists; only inline status-bar metadata | Needs a new modal showing size, dates, permissions, per-provider metadata (varies a lot across VFS providers — local/SFTP/FTP/S3/etc.). |
| Shift+F1 | Custom columns view menu | fm's directory table has a fixed column set; no per-view column picker | Needs a column-configuration UI plus persisted per-pane (or global) column layout. |
| Shift+F2 | Compare file lists (diff two panes, highlight differences) | No directory-comparison logic exists | Needs a comparison algorithm (by name/size/date) plus highlighting in both panes' tables. |
| Shift+F3 | List only the file under cursor when multiple files are selected | The Lister viewer (F3) always targets the cursor entry; TC's nuance is about selection vs cursor interaction when multiple are selected | Small viewer-behavior change, but grouped here because it's viewer-internals work, not a pure keybinding addition. |
| Shift+Ctrl+F5 | Create shortcuts/symlinks of selected files | No shortcut/symlink-creation operation exists | Platform-asymmetric: Windows `.lnk` creation is nontrivial; POSIX symlinks are simpler. Needs a new operation type in the operation planner plus per-platform backend support. |
| Ctrl+Z (file-list context) | Edit a per-file "comment" (TC's `descript.ion` sidecar file convention) | fm has no file-comment/metadata-sidecar feature | Niche; would need a new metadata store and UI surface, low priority. |
| Ctrl+Shift+F1 | Thumbnails view | No thumbnail generation/caching exists | Needs image (and possibly video/PDF) thumbnail generation, caching, and a grid/thumbnail pane layout — this is a substantial feature on its own. |
| Ctrl+F1 / Ctrl+F2 | Brief view / full-details view (pane layout modes) | Pane only renders one table layout today | Needs a view-mode architecture (layout switch per pane) before any of the F1/F2/thumbnail view modes can exist; do this one first if picking up the view-mode cluster. |
| Ctrl+Shift+F2 | "Comments" column view | Depends on the Ctrl+Z file-comment feature above | Low priority; only meaningful once file comments exist. |
| Ctrl+F11 | Filter to show only executables | Cross-platform "executable" isn't well-defined (macOS `.app` bundles are directories, Linux relies on the exec bit, Windows on `.exe`) | Needs a platform-aware predicate; low value, evaluate before building. |
| Ctrl+F12 | User-defined, savable filter presets | fm's Quick Filter (Ctrl+F) is ad hoc/session-only, no saved presets | Needs a small persistence layer (named filter presets in settings) plus a management UI. |
| Ctrl+F9 | Print the file under cursor | No print integration | Low value for a modern file manager; consider explicitly declining rather than implementing. |
| Shift+Esc | Minimize the app to the system tray | fm has no system-tray integration | Needs Tauri tray-icon setup (icon, context menu, restore-on-click) — a genuine new platform integration, desktop-only. |
| F9 / bare F10 | Activate the classic pull-down menu bar | fm has no traditional menu-bar UI at all — the command palette + context menus fill this role | Open design question: does fm want a menu bar, or is this TC convention obsolete for this app? Recommend explicitly deciding "not applicable" rather than treating as a backlog item, unless a menu bar is independently wanted. |
| Ctrl+Shift+F / Ctrl+Shift+M | Disconnect from FTP / toggle FTP transfer mode (ASCII vs binary) | FTP is a VFS provider with no dedicated connect/disconnect or transfer-mode actions bound to keys | Binary vs ASCII transfer mode is a legacy FTP concept fm's VFS abstraction doesn't currently model; would need provider-level support before any shortcut makes sense. |

## Acceptance Criteria

This is a tracking/scoping task, not an implementation task — "done" means each row has been
triaged into one of: (a) split into its own numbered task with `Depends on: 0129` noted where
relevant, (b) explicitly declined with a one-line reason recorded in this file's Agent Notes
(e.g. "Ctrl+F9 print — declined, low value"), or (c) merged into an existing task (e.g. the
thumbnails-view work might fold into a future gallery/preview task).

## Implementation Notes

- Several rows cluster naturally and should probably be scoped together rather than one-shortcut-
  one-task: the "view mode" cluster (Ctrl+F1/Ctrl+F2/Ctrl+Shift+F1 thumbnails), the "FTP session"
  cluster (Ctrl+Shift+F/Ctrl+Shift+M), and the "file comments" cluster (Ctrl+Z/Ctrl+Shift+F2).
- Check [0118](0118-integrate-parallel-disk-usage-windirstat.md) before scoping the Alt+F10/Ctrl+F8
  tree-view work — a treemap/tree sidebar component built there may be directly reusable.
- Check [0126](0126-embedded-terminal-drawer.md) (done) before scoping Alt+F8 command-line
  history — the terminal drawer may already satisfy the underlying need TC's command line serves.

## Agent Notes

- (none yet)
