# Task index

Derived from `file-manager-coding-agent-spec.md`. One file per task; every task cites the spec
sections it implements. Ordering follows the spec's implementation sequence (§33).

Pick the lowest-numbered `open` task whose `Depends on` tasks are all `done`.
Note the out-of-order dependencies: **0020** needs the event bus from **0031**; **0078**–**0082**
(workspace service, §5.3) are numbered late but only depend on already-`done` tasks (0006, 0008) —
pick them up early, ideally right after Step 2, since later steps 5, 6 and 7 assume the real
`WorkspaceService` exists (see the note under Step 2 below).

```bash
# Terminal 1
cargo watch -x "run -p fm-server"
# Terminal 2
pnpm run dev:http
```

## Recommended near-term priority (2026-08-15)

Not a new milestone, just a reading order through the currently-open tasks that matter most right
now, agreed after a review of feature gaps against other "state-of-the-art" file managers (Marta,
Total Commander, ForkLift, Finder/Explorer). Superseded by whatever's actually picked up next —
update this list if priorities shift rather than treating it as fixed.

1. **0134** — thumbnails + grid/icon view. Was paired with 0071 (now done); closes an explicit gap
   flagged on both 0059 and 0060.
2. **0077** — checksums and duplicate-file detection. Commonly expected, self-contained, no blocking
   dependencies.
3. **0098** — frontend i18n. Gets more expensive to retrofit the more UI strings accumulate; worth
   doing before the app grows much further.

0135–0138 (git status column, Finder tags/xattrs, Services menu/Send to, mount-share action) and
0141–0142 (archive-summary preview, plugin-contributed preview renderers — split out of 0071 on
2026-08-15) are real gaps but lower priority than the above — pick up opportunistically.

## Step 1 — Repository bootstrap (§33.1)

- [x] 0001 Cargo workspace skeleton and crate stubs
- [x] 0002 Frontend Vite + Mithril + TypeScript skeleton
- [x] 0003 Root development scripts, formatting and linting
- [x] 0004 CI skeleton
- [x] 0005 Architecture documentation and initial ADRs

## Step 2 — API pipeline (§33.2)

- [x] 0006 Core domain model in fm-domain
- [x] 0007 Transport DTOs and OpenAPI schemas
- [x] 0008 Axum server with runtime capabilities, OpenAPI JSON and Swagger UI
- [x] 0009 Deterministic OpenAPI export command
- [x] 0010 Orval-generated Fetch client and api:check

## Step 2b — Workspace service (§5.3)

Added after §5.3 was fleshed out in detail; numbered late (next free ids) but only depends on
already-`done` work, so tackle it here rather than at the end. 0030 was narrowed to drop workspace
persistence, 0069 now depends on 0080 instead of 0030, and 0026's split-ratio note points at 0080 —
see each file's Context/Implementation Notes for details.

- [x] 0078 Workspace domain model refinement (aligns 0006's types with the detailed §5.3)
- [x] 0079 Workspace repository, validation and default-workspace lifecycle
- [x] 0080 Workspace semantic commands, revisions and REST/Tauri surface
- [x] 0081 Workspace events over the shared event bus *(needs 0031)*
- [x] 0082 Frontend WorkspaceProjection, state slice and command dispatch

## Step 3 — Transport abstraction (§33.3)

- [x] 0011 FileManagerClient interface and runtime selection
- [x] 0012 HTTP FileManagerClient adapter
- [x] 0013 Mock FileManagerClient adapter and fixtures
- [x] 0014 Typed backend event model and event-stream abstraction
- [x] 0015 Tauri 2 shell application and Tauri client adapter

## Step 4 — Local provider (§33.4)

- [x] 0016 VFS provider trait, capabilities and errors
- [x] 0017 Location parsing and path normalization
- [x] 0018 Local filesystem provider: listing, paging and metadata
- [x] 0019 Directory service, snapshots and request cancellation
- [x] 0020 Filesystem watching and directory deltas *(needs 0031)*

## Step 5 — Frontend shell (§33.5)

- [x] 0021 Frontend application state model
- [x] 0022 CSS variable themes: light, dark and follow-system
- [x] 0023 Development-only mithril-inspector integration
- [x] 0024 Virtualized directory table component
- [x] 0025 Pane component: tab strip, breadcrumb path bar and status bar
- [x] 0026 Two-pane workspace layout and pane focus
- [x] 0027 Directory navigation, parent navigation and history
- [x] 0028 Selection model and keyboard navigation
- [x] 0029 Sorting and file metadata summary
- [x] 0030 Settings service

**Milestone 1 (§16) is complete after 0030 and 0078–0082** (persisted-workspace restore moved to
the workspace-service tasks; see Step 2b above).

## Step 6 — Event delivery (§33.6)

- [x] 0031 Rust event bus
- [x] 0032 SSE endpoint
- [x] 0033 Frontend SSE stream, reconnection and connection status
- [x] 0034 Tauri channel event delivery and transport parity

## Step 7 — File operations, one at a time (§33.7)

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

**Milestone 2 (§16) is complete after 0048.**

## Step 8 — Action system (§33.8)

- [x] 0049 Backend action registry
- [x] 0050 Configurable keybinding dispatcher
- [x] 0051 Command palette
- [x] 0052 Context menus and context-sensitive action availability

## Step 9 — Plugins (§33.9)

- [x] 0053 Plugin API, manifest, discovery and permissions
- [x] 0054 Plugin runtime with error isolation
- [x] 0055 Sample plugin: Copy Markdown Path
- [x] 0056 Sample plugin: File Age column
- [x] 0057 Plugin management UI
- [x] 0083 Settings editor UI *(after 0050 and 0057)*

## Step 10 — Desktop polish (§33.10)

- [x] 0058 Platform adapter traits and capability reporting
- [x] 0059 macOS platform integration
- [x] 0060 Windows platform integration *(shell icons split out to 0130, native menu bar to 0131; thumbnails remain an unimplemented capability)*
- [x] 0061 Open with default application, reveal in file manager, open terminal
- [ ] 0062 Drag and drop within the app and with the OS *(in_progress — in-app and native drag-in/out implemented; interactive Finder/Explorer manual verification still outstanding)*
- [x] 0063 Desktop packaging, signing and notarization

## Cross-cutting quality

- [x] 0064 Browser/server mode security hardening (§22)
- [x] 0065 Performance fixtures and benchmarks (§28)
- [ ] 0066 Accessibility review (§29) *(in_progress — automated axe-core phase complete; manual keyboard/screen-reader passes still outstanding)*
- [x] 0073 Diagnostics view and structured logging (§30)
- [x] 0074 README, development commands and roadmap (§38)
- [x] 0085 Directory entry icons (themeable, with optional native-icon overlay)
- [x] 0086 F4 edit-in-external-editor action
- [x] 0087 F3 view action
- [x] 0088 Lister-style instant large-file viewer with lazy search
- [x] 0089 Content search across files
- [x] 0090 Total Commander-style selection toggles (invert, select/deselect by mask)
- [x] 0091 Native file icon overlay (backend-served, layered over 0085) *(after 0085; needs 0059)*
- [x] 0092 Catppuccin icon theme *(after 0085)*
- [x] 0093 Copy filename and path actions
- [x] 0094 Tabler icons toolbar
- [x] 0095 Distributable icon theme plugins *(after 0053, 0085, 0092)*
- [x] 0096 Mounted volume capacity
- [x] 0097 Directory aggregate totals
- [ ] 0098 Frontend i18n with translate.js
- [x] 0099 In-app text file editor with Markdown preview *(after 0088)*
- [ ] 0100 Streaming CSV and Excel file viewer subsystem

## Milestone 3 / version 1 features (§16.3, §37)

- [x] 0067 Quick filter
- [x] 0068 Recursive filesystem search
- [x] 0069 Tabs per pane
- [x] 0070 Favourites, bookmarks and recent locations
- [x] 0071 Preview service and initial preview panel *(archive-summary/plugin-preview extensibility split out to 0141/0142)*
- [x] 0072 Multi-rename tool
- [x] 0084 Workspace management UI *(after 0069; 0082 already complete)*

## Milestone 5 backlog (§16.5, §37)

- [x] 0075 Directory comparison and synchronization
- [x] 0076 Archive provider: browse, mutate and passwords
- [ ] 0077 Checksums and duplicate-file detection

## Milestone 6 — OS-integrated locations

These are the quickest wins and deliberately do **not** depend on the remote connection framework.

- [x] 0101 OS cloud-backed locations
- [x] 0102 Mounted network volumes

## Milestone 7 — Remote connection foundation

- [x] 0103 Remote connection framework

## Milestone 8 — Remote protocols and actions

- [x] 0104 SFTP provider
- [x] 0105 SSH terminal actions *(extended the embedded terminal drawer to run on the remote host over SSH)*
- [x] 0106 FTP and FTPS provider
- [ ] 0107 External remote desktop launch

## Milestone 9 — Remote transfer/runtime hardening

- [x] 0108 Cross-provider transfer planning *(needs 0104, 0106)*
- [x] 0109 Remote change tracking *(needs 0104, 0106)*

## Milestone 10 — Optional native providers

OneDrive is already useful through 0101 when exposed by the OS, and SMB through 0102 when mounted by the OS.
0110 and 0111 have been moved to the Freezer below — not planned near-term.

## Freezer

Parked by product decision — not declined outright, just not going to happen in the near term.
Revisit only if a concrete need surfaces. (Note: 0118, the WinDirStat treemap integration, is
*not* here — it's a liked feature and stays live in the Backlog above.)

- [ ] 0110 Native OneDrive provider *(frozen 2026-08-14 — 0101's OS-mediated cloud locations already
  cover the common case; building a bespoke Graph API client for marginal gain over "let the OS
  mount it" isn't worth it right now; optional, needs 0103, 0108, 0109)*
- [ ] 0111 Native SMB provider *(frozen 2026-08-14 — same reasoning: 0102's OS-mediated mounted
  shares already cover the common case; optional, needs 0103, 0108, 0109)*

## Architecture deepening — frontend

Cross-cutting refactors to increase module depth, testability, and AI-navigability. All complete.
AppShell reduced from 3,351 lines to ~1,816 lines (−46%) through extraction of 12 focused modules
(WorkspaceController, TabController, SettingsController, GlobalKeydownHandler, PaneContentBuilder,
FindFilesController, ActionCommandController, DialogUIController, AppDialogs, and others).

- [x] 0112 Extract Operations Controller from AppShell
- [x] 0113 Extract EventHandler Registry from AppShell
- [x] 0114 Decompose Pane Component *(1,324 lines → sub-modules)*
- [x] 0115 Migrate AppShell Closure State to Meiosis Store *(gradual, slice-by-slice)*
- [x] 0116 Centralize Selections-to-Locations Translation
- [x] 0117 Deepen Connections Model with Full Lifecycle

## Backlog

Features not yet implemented.

- [ ] 0118 Integrate parallel-disk-usage with WinDirStat Treemap View
- [x] 0126-embedded-terminal-drawer
- [ ] 0127 External terminal application choice *(pick a specific app, e.g. ghostty/Warp, from the context menu)*
- [x] 0128 Total Commander shortcut parity — quick wins *(reuses existing functionality; also documents conflicts/already-implemented shortcuts)*
- [ ] 0129 Total Commander shortcut parity — major features *(scoping task; triage each row into its own task, decline, or merge)*
- [x] 0130 Windows native file icon extraction *(split out of 0060; layers onto the 0091 overlay pipeline)*
- [ ] 0131 Windows native menu bar *(split out of 0060; hook-point-only, mirrors the macOS 0058 implementation)*
- [x] 0132 Windows defect: operation routes return 500 / deadlock *(pre-existing, found while verifying 0060; blocks the Windows pre-commit hook)*
- [x] 0133 Populate native menu bar content (macOS + Windows) *(macOS done; Windows half deferred, still needs 0131)*
- [ ] 0134 Thumbnails for images/video and a grid/icon view mode
- [ ] 0135 Git status column/badges
- [x] 0136 Extended attributes, Finder tags and Spotlight comments editor
- [ ] 0137 Services menu (macOS) / "Send to" (Windows) integration
- [ ] 0138 OS-level "Mount share…" action *(needs 0102; low priority — only if OS-native mounting causes friction)*
- [ ] 0139 Directory tree dialog / sidebar tree view *(split out of 0129)*
- [x] 0140 File/folder Properties dialog *(split out of 0129)*
- [ ] 0141 Archive summary preview *(split out of 0071)*
- [ ] 0142 Plugin-contributed preview renderers *(split out of 0071)*
- [x] 0143 Workspace last-active restore and per-window desktop placement *(wire up unused `WorkspaceService::start`; multi-window support; per-workspace window-frame restore via tauri-plugin-window-state; macOS Space placement explicitly out of scope, no public API)*
- [ ] 0144 Volumes in Favourites/Go menu, plus Go menu Servers/Cloud/Network sections
- [ ] 0145 Surface Finder tags/Spotlight comment editing in the Properties dialog *(split out of 0136; 0140 landed mid-task, after 0136's own standalone dialogs were already built)*

## Architecture deepening — backend

Cross-cutting refactors to increase module depth, testability, and AI-navigability.
`FileManagerService` (~5,800 lines) is the primary target. 0119 coordinates the decomposition;
0120–0123 each extract one capability and can land in any order once 0119's composition plan is
decided. 0124 and 0125 are independent and can be picked up early. 0120–0125 are all done; 0119
itself is in progress — three verified passes on 2026-08-14 extracted the operation-history/observer
cluster, four pure mapping-function modules, and every remaining single-field method (system
locations, runtime capabilities, byte-range/content-search reads, volume capacity), taking the
facade from ~3,836 to ~2,957 lines (~23%) across six new modules. A dedicated final-sweep pass
confirmed nothing low-risk is left: what remains (constructors, operations management, search/
comparison coordination, action invocation — ~750–1000 lines combined) genuinely needs new
sub-service types designed with the same care as `ConnectionFacade`/`PluginManager`, not more
mechanical extraction. See 0119's Agent Notes for the full breakdown before starting that work.

- [ ] 0119 Decompose FileManagerService into capability sub-services *(paused 2026-08-14 — facade down to ~2,957 lines across 6 new modules; remaining work needs real sub-service design (not more extraction) and is deferred to a future dedicated session)*
- [x] 0120 Extract Operation Planner module *(needs 0119)*
- [x] 0121 Extract File Editor Service *(needs 0119)*
- [x] 0122 Extract Connection Facade *(needs 0119)*
- [x] 0123 Extract Plugin Manager module *(needs 0119)*
- [x] 0124 Narrow Location URI parsing in fm-domain *(independent)*
- [x] 0125 Make Search Engine VFS-provider agnostic *(independent)*
