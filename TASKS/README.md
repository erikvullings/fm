# Task index

Derived from `file-manager-coding-agent-spec.md`. One file per task; every task cites the spec
sections it implements. Tasks are grouped below by functional area for readability — this
grouping carries no ordering weight. What determines pick order is each task's own `Depends on`
header: **pick the lowest-numbered `open` task whose `Depends on` tasks are all `done`.** Check
`TASKS/NNNN-*.md`'s own `Status:` line for ground truth; the checkboxes here are a convenience
index and can lag a live edit by one pass.

```bash
# Terminal 1
cargo watch -x "run -p fm-server"
# Terminal 2
pnpm run dev:http
```

Historically this index was organized by the spec's implementation sequence (§33, "Step 1"
through "Step 10") and by milestone (§16). That ordering is no longer reflected here — the project
has shipped past the original milestone boundaries and grouping by function is more useful for
finding related work. If you need the original sequencing rationale, see git history for this
file before the 2026-08-18 reorganization.

## Foundations & core architecture

Repository bootstrap, the domain model, transport layer (REST/SSE/Tauri), the VFS provider
contract, the event bus, and the workspace service. Everything else depends on this layer.

- [x] 0001 Cargo workspace skeleton and crate stubs
- [x] 0002 Frontend Vite + Mithril + TypeScript skeleton
- [x] 0003 Root development scripts, formatting and linting
- [x] 0004 CI skeleton
- [x] 0005 Architecture documentation and initial ADRs
- [x] 0074 README, development commands and roadmap
- [x] 0006 Core domain model in fm-domain
- [x] 0007 Transport DTOs and OpenAPI schemas
- [x] 0008 Axum server with runtime capabilities, OpenAPI JSON and Swagger UI
- [x] 0009 Deterministic OpenAPI export command
- [x] 0010 Orval-generated Fetch client and api:check
- [x] 0011 FileManagerClient interface and runtime selection
- [x] 0012 HTTP FileManagerClient adapter
- [x] 0013 Mock FileManagerClient adapter and fixtures
- [x] 0014 Typed backend event model and event-stream abstraction
- [x] 0015 Tauri 2 shell application and Tauri client adapter
- [x] 0016 VFS provider trait, capabilities and errors
- [x] 0017 Location parsing and path normalization
- [x] 0018 Local filesystem provider: listing, paging and metadata
- [x] 0019 Directory service, snapshots and request cancellation
- [x] 0020 Filesystem watching and directory deltas *(needs 0031)*
- [x] 0031 Rust event bus
- [x] 0032 SSE endpoint
- [x] 0033 Frontend SSE stream, reconnection and connection status
- [x] 0034 Tauri channel event delivery and transport parity
- [x] 0078 Workspace domain model refinement (§5.3)
- [x] 0079 Workspace repository, validation and default-workspace lifecycle
- [x] 0080 Workspace semantic commands, revisions and REST/Tauri surface
- [x] 0081 Workspace events over the shared event bus *(needs 0031)*
- [x] 0082 Frontend WorkspaceProjection, state slice and command dispatch

## Browsing & navigation

The dual-pane shell: layout, panes, tabs, sorting, selection, and finding things.

- [x] 0021 Frontend application state model
- [x] 0022 CSS variable themes: light, dark and follow-system
- [x] 0024 Virtualized directory table component
- [x] 0025 Pane component: tab strip, breadcrumb path bar and status bar
- [x] 0026 Two-pane workspace layout and pane focus
- [x] 0027 Directory navigation, parent navigation and history
- [x] 0028 Selection model and keyboard navigation
- [x] 0029 Sorting and file metadata summary
- [x] 0067 Quick filter
- [x] 0068 Recursive filesystem search
- [x] 0069 Tabs per pane
- [x] 0070 Favourites, bookmarks and recent locations
- [x] 0089 Content search across files
- [x] 0090 Total Commander-style selection toggles (invert, select/deselect by mask)
- [x] 0144 Volumes in Favourites/Go menu, plus Go menu Servers/Cloud/Network sections
- [x] 0139 Directory tree dialog / sidebar tree view *(split out of 0129)*

## File operations

Copy, move, rename, delete, and everything that mutates the filesystem — plus the operation
engine, conflict handling, clipboard, drag-and-drop, comparison and checksums that back it.

- [x] 0035 Operation engine core: jobs, scheduler, progress
- [x] 0036 Operations API and operation centre UI
- [x] 0037 Operation: create directory
- [x] 0038 Operation: rename
- [x] 0039 Operation: copy a single file
- [x] 0040 Operation: copy a directory tree
- [x] 0041 Operation: move files and directories
- [x] 0042 Operation: duplicate
- [x] 0043 Operation: move to Trash / Recycle Bin
- [x] 0044 Operation: permanent delete with confirmation
- [x] 0045 Conflict detection, policies and resolution dialog
- [x] 0046 Operation cancellation, pause and resume
- [x] 0047 Operation queue and history
- [x] 0048 In-application clipboard copy / cut / paste
- [x] 0075 Directory comparison and synchronization
- [x] 0077 Checksums and duplicate-file detection
- [x] 0093 Copy filename and path actions
- [x] 0062 Drag and drop within the app and with the OS *(in_progress — in-app and native
  drag-in/out implemented; interactive Finder/Explorer manual verification still outstanding)*

## Actions, shortcuts & command palette

The action registry that everything (menus, palette, keybindings, plugin contributions) is built
on, plus Total Commander shortcut-parity work.

- [x] 0049 Backend action registry
- [x] 0050 Configurable keybinding dispatcher
- [x] 0051 Command palette
- [x] 0052 Context menus and context-sensitive action availability
- [x] 0128 Total Commander shortcut parity — quick wins
- [ ] 0129 Total Commander shortcut parity — features requiring new subsystems *(scoping task;
  triage each row into its own task, decline, or merge)*

## Viewing, editing & preview

Looking at and editing file contents without leaving the app.

- [x] 0071 Preview service and initial preview panel *(archive-summary/plugin-preview
  extensibility split out to 0141/0142)*
- [x] 0072 Multi-rename tool
- [x] 0076 Archive provider: browse, mutate and passwords
- [x] 0086 F4 edit-in-external-editor action
- [x] 0087 F3 view action
- [x] 0088 Lister-style instant large-file viewer with lazy search
- [x] 0099 In-app text file editor with Markdown preview *(after 0088)*
- [x] 0140 File/folder Properties dialog *(split out of 0129)*
- [ ] 0100 Streaming CSV and Excel file viewer subsystem
- [ ] 0141 Archive summary preview *(split out of 0071)*
- [ ] 0142 Plugin-contributed preview renderers *(split out of 0071)*
- [ ] 0149 Saved Multi-Rename presets *(needs 0072; quick win layered on the existing rule engine)*
- [ ] 0150 Video playback in the F3 Lister viewer *(needs 0088; native `<video>`, mirrors the
  existing `<audio>` path — see the task for the large-file caveat)*

## Metadata, icons & views

How entries are represented: icons, thumbnails, grid view, git status, extended attributes, and
disk-usage visualization.

- [x] 0085 Directory entry icons (themeable, with optional native-icon overlay)
- [x] 0091 Native file icon overlay (backend-served, layered over 0085) *(after 0085; needs 0059)*
- [x] 0094 Tabler icon subset for the workspace toolbar
- [x] 0096 Mounted volume capacity
- [x] 0097 Directory aggregate totals (size/file count) independent of pagination
- [x] 0130 Windows native file icon extraction *(split out of 0060; layers onto the 0091 overlay
  pipeline)*
- [x] 0134 Thumbnails for images/video and a grid/icon view mode
- [x] 0135 Git status column/badges
- [x] 0136 Extended attributes, Finder tags and Spotlight comments editor
- [ ] 0118 Integrate parallel-disk-usage with WinDirStat Treemap View
- [ ] 0145 Surface Finder tags/Spotlight comment editing in the Properties dialog *(split out of
  0136; 0140 landed mid-task, after 0136's own standalone dialogs were already built)*
- [ ] 0151 Fix Windows git-status/history: `canonicalize()` vs. `git2` path mismatch *(needs 0135;
  surfaced 2026-08-19 once removing sccache from CI stopped masking real Windows test results —
  diagnosed from source, needs verification on a real Windows machine)*

## Plugins & extensibility

The Lua plugin runtime, sample plugins, and icon-theme plugins.

- [x] 0053 Plugin API, manifest, discovery and permissions
- [x] 0054 Plugin runtime with error isolation
- [x] 0055 Sample plugin: Copy Markdown Path
- [x] 0056 Sample plugin: File Age column
- [x] 0057 Plugin management UI
- [x] 0092 Catppuccin icon theme *(after 0085)*
- [x] 0095 Distributable icon theme plugins *(after 0053, 0085, 0092)*

## Remote & cloud connections

Everything that reaches a filesystem that isn't the local disk: SSH/SFTP, FTP/FTPS, OS-mediated
cloud and network locations, and the connection framework underneath them.

- [x] 0101 OS cloud-backed locations
- [x] 0102 Mounted network volumes
- [x] 0103 Remote connection framework
- [x] 0104 SFTP provider
- [x] 0105 SSH terminal actions *(extended the embedded terminal drawer to run on the remote host
  over SSH)*
- [x] 0106 FTP and FTPS provider
- [x] 0109 Remote change tracking *(needs 0104, 0106)*
- [ ] 0107 External remote desktop launch
- [x] 0108 Cross-provider transfer planning *(needs 0104, 0106)*
- [ ] 0138 OS-level "Mount share…" action *(needs 0102; low priority — only if OS-native mounting
  causes friction)*
- [ ] 0146 S3-compatible object storage provider *(needs 0103, 0108, 0109 — unlike 0110/0111, no
  OS mount covers this)*
- [ ] 0147 WebDAV provider *(needs 0103, 0108, 0109 — same reasoning as 0146)*

**Parked (freezer)** — not declined outright, just not planned near-term; revisit only if a
concrete need surfaces:

- [ ] 0110 Native OneDrive provider *(frozen 2026-08-14 — 0101's OS-mediated cloud locations
  already cover the common case; building a bespoke Graph API client for marginal gain over "let
  the OS mount it" isn't worth it right now; optional, needs 0103, 0108, 0109)*
- [ ] 0111 Native SMB provider *(frozen 2026-08-14 — same reasoning: 0102's OS-mediated mounted
  shares already cover the common case; optional, needs 0103, 0108, 0109)*

## Desktop & platform integration

Native OS hooks (Finder/Explorer, Trash, menu bar, terminal), packaging, and desktop-only
behavior.

- [x] 0058 Platform adapter traits and capability reporting
- [x] 0059 macOS platform integration
- [x] 0060 Windows platform integration *(shell icons split out to 0130, native menu bar to 0131;
  thumbnails remain an unimplemented capability)*
- [x] 0061 Open with default application, reveal in file manager, open terminal
- [x] 0063 Desktop packaging, signing and notarization
- [x] 0126 Embedded terminal drawer
- [x] 0132 Windows defect: operation routes return 500 / deadlock *(pre-existing, found while
  verifying 0060; blocked the Windows pre-commit hook)*
- [x] 0133 Populate native menu bar content (macOS + Windows) *(macOS done; Windows half deferred,
  still needs 0131)*
- [ ] 0127 External terminal application choice *(pick a specific app, e.g. ghostty/Warp, from the
  context menu)*
- [ ] 0131 Windows native menu bar *(split out of 0060; hook-point-only, mirrors the macOS 0058
  implementation)*
- [ ] 0137 Services menu (macOS) / "Send to" (Windows) integration
- [ ] 0148 Application deleter (macOS) *(needs 0059, 0061; macOS-only — Windows/Linux already have
  their own uninstall conventions)*

## Settings & workspace management

Persisted app configuration and multi-workspace/window state.

- [x] 0030 Settings service
- [x] 0083 Settings editor UI *(after 0050 and 0057)*
- [x] 0084 Workspace management UI *(after 0069; 0082 already complete)*
- [x] 0143 Workspace last-active restore and per-window desktop placement *(wired up unused
  `WorkspaceService::start`; multi-window support; per-workspace window-frame restore via
  tauri-plugin-window-state; macOS Space placement explicitly out of scope, no public API)*

## Quality, security & accessibility

Cross-cutting non-feature work: hardening, performance, a11y, diagnostics, i18n, and the
dev-only inspector.

- [x] 0023 Development-only mithril-inspector integration
- [x] 0064 Browser/server mode security hardening (§22)
- [x] 0065 Performance fixtures and benchmarks (§28)
- [x] 0073 Diagnostics view and structured logging (§30)
- [x] 0098 Frontend i18n with translate.js
- [ ] 0066 Accessibility review (§29) *(in_progress — automated axe-core phase complete; manual
  keyboard/screen-reader passes still outstanding)*

## Architecture deepening (internal, non-user-facing)

Refactors to increase module depth, testability, and AI-navigability. No behavior change.

**Frontend** — all complete. AppShell reduced from 3,351 lines to ~1,816 lines (−46%) through
extraction of 12 focused modules (WorkspaceController, TabController, SettingsController,
GlobalKeydownHandler, PaneContentBuilder, FindFilesController, ActionCommandController,
DialogUIController, AppDialogs, and others).

- [x] 0112 Extract Operations Controller from AppShell
- [x] 0113 Extract EventHandler Registry from AppShell
- [x] 0114 Decompose Pane Component *(1,324 lines → sub-modules)*
- [x] 0115 Migrate AppShell Closure State to Meiosis Store *(gradual, slice-by-slice)*
- [x] 0116 Centralize Selections-to-Locations Translation
- [x] 0117 Deepen Connections Model with Full Lifecycle

**Backend** — `FileManagerService` (~5,800 lines originally) is the primary target. 0119
coordinates the decomposition; 0120–0123 each extract one capability; 0124 and 0125 are
independent. 0120–0125 are done; 0119 itself is paused — three verified passes took the facade
from ~3,836 to ~2,957 lines (~23%) across six new modules, extracting the operation-history/
observer cluster, four pure mapping-function modules, and every remaining single-field method.
What remains (constructors, operations management, search/comparison coordination, action
invocation — ~750–1000 lines combined) needs real sub-service design, not more mechanical
extraction — see 0119's Agent Notes before picking it back up.

- [x] 0120 Extract Operation Planner module *(needs 0119)*
- [x] 0121 Extract File Editor Service *(needs 0119)*
- [x] 0122 Extract Connection Facade *(needs 0119)*
- [x] 0123 Extract Plugin Manager module *(needs 0119)*
- [x] 0124 Narrow Location URI parsing in fm-domain *(independent)*
- [x] 0125 Make Search Engine VFS-provider agnostic *(independent)*
- [ ] 0119 Decompose FileManagerService into capability sub-services *(paused 2026-08-14 — facade
  down to ~2,957 lines across 6 new modules; remaining work needs real sub-service design and is
  deferred to a future dedicated session)*
