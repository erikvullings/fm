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

## Step 1 — Repository bootstrap (§33.1)

- 0001 Cargo workspace skeleton and crate stubs
- 0002 Frontend Vite + Mithril + TypeScript skeleton
- 0003 Root development scripts, formatting and linting
- 0004 CI skeleton
- 0005 Architecture documentation and initial ADRs

## Step 2 — API pipeline (§33.2)

- 0006 Core domain model in fm-domain
- 0007 Transport DTOs and OpenAPI schemas
- 0008 Axum server with runtime capabilities, OpenAPI JSON and Swagger UI
- 0009 Deterministic OpenAPI export command
- 0010 Orval-generated Fetch client and api:check

## Step 2b — Workspace service (§5.3)

Added after §5.3 was fleshed out in detail; numbered late (next free ids) but only depends on
already-`done` work, so tackle it here rather than at the end. 0030 was narrowed to drop workspace
persistence, 0069 now depends on 0080 instead of 0030, and 0026's split-ratio note points at 0080 —
see each file's Context/Implementation Notes for details.

- 0078 Workspace domain model refinement (aligns 0006's types with the detailed §5.3)
- 0079 Workspace repository, validation and default-workspace lifecycle
- 0080 Workspace semantic commands, revisions and REST/Tauri surface
- 0081 Workspace events over the shared event bus *(needs 0031)*
- 0082 Frontend WorkspaceProjection, state slice and command dispatch

## Step 3 — Transport abstraction (§33.3)

- 0011 FileManagerClient interface and runtime selection
- 0012 HTTP FileManagerClient adapter
- 0013 Mock FileManagerClient adapter and fixtures
- 0014 Typed backend event model and event-stream abstraction
- 0015 Tauri 2 shell application and Tauri client adapter

## Step 4 — Local provider (§33.4)

- 0016 VFS provider trait, capabilities and errors
- 0017 Location parsing and path normalization
- 0018 Local filesystem provider: listing, paging and metadata
- 0019 Directory service, snapshots and request cancellation
- 0020 Filesystem watching and directory deltas *(needs 0031)*

## Step 5 — Frontend shell (§33.5)

- 0021 Frontend application state model
- 0022 CSS variable themes: light, dark and follow-system
- 0023 Development-only mithril-inspector integration
- 0024 Virtualized directory table component
- 0025 Pane component: tab strip, breadcrumb path bar and status bar
- 0026 Two-pane workspace layout and pane focus
- 0027 Directory navigation, parent navigation and history
- 0028 Selection model and keyboard navigation
- 0029 Sorting and file metadata summary
- 0030 Settings service

**Milestone 1 (§16) is complete after 0030 and 0078–0082** (persisted-workspace restore moved to
the workspace-service tasks; see Step 2b above).

## Step 6 — Event delivery (§33.6)

- 0031 Rust event bus
- 0032 SSE endpoint
- 0033 Frontend SSE stream, reconnection and connection status
- 0034 Tauri channel event delivery and transport parity

## Step 7 — File operations, one at a time (§33.7)

- 0035 Operation engine core: jobs, scheduler, progress
- 0036 Operations API and operation centre UI
- 0037 Operation: create directory
- 0038 Operation: rename
- 0039 Operation: copy a single file
- 0040 Operation: copy a directory tree
- 0041 Operation: move files and directories
- 0042 Operation: duplicate
- 0043 Operation: move to Trash / Recycle Bin
- 0044 Operation: permanent delete with confirmation
- 0045 Conflict detection, policies and resolution dialog
- 0046 Operation cancellation, pause and resume
- 0047 Operation queue and history
- 0048 In-application clipboard copy / cut / paste

**Milestone 2 (§16) is complete after 0048.**

## Step 8 — Action system (§33.8)

- 0049 Backend action registry
- 0050 Configurable keybinding dispatcher
- 0051 Command palette
- 0052 Context menus and context-sensitive action availability

## Step 9 — Plugins (§33.9)

- 0053 Plugin API, manifest, discovery and permissions
- 0054 Plugin runtime with error isolation
- 0055 Sample plugin: Copy Markdown Path
- 0056 Sample plugin: File Age column
- 0057 Plugin management UI
- 0083 Settings editor UI *(after 0050 and 0057)*

## Step 10 — Desktop polish (§33.10)

- 0058 Platform adapter traits and capability reporting
- 0059 macOS platform integration
- 0060 Windows platform integration
- 0061 Open with default application, reveal in file manager, open terminal
- 0062 Drag and drop within the app and with the OS
- 0063 Desktop packaging, signing and notarization

## Cross-cutting quality

- 0064 Browser/server mode security hardening (§22)
- 0065 Performance fixtures and benchmarks (§28)
- 0066 Accessibility review (§29)
- 0073 Diagnostics view and structured logging (§30)
- 0074 README, development commands and roadmap (§38)
- 0085 Directory entry icons (themeable, with optional native-icon overlay)
- 0086 F4 edit-in-external-editor action
- 0087 F3 view action
- 0088 Lister-style instant large-file viewer with lazy search
- 0089 Content search across files
- 0090 Total Commander-style selection toggles (invert, select/deselect by mask)
- 0091 Native file icon overlay (backend-served, layered over 0085) *(after 0085; needs 0059)*
- 0092 Catppuccin icon theme *(after 0085)*
- 0093 Copy filename and path actions
- 0094 Tabler icons toolbar
- 0095 Distributable icon theme plugins *(after 0053, 0085, 0092)*

## Milestone 3 / version 1 features (§16.3, §37)

- 0067 Quick filter
- 0068 Recursive filesystem search
- 0069 Tabs per pane
- 0070 Favourites, bookmarks and recent locations
- 0071 Preview service and initial preview panel
- 0072 Multi-rename tool
- 0084 Workspace management UI *(after 0069; 0082 already complete)*

## Milestone 5 backlog (§16.5, §37)

- 0075 Directory comparison and synchronization
- 0076 Archive provider: browsing, extraction and creation
- 0077 Checksums and duplicate-file detection

## MVP definition (§36)

The MVP is met once 0001–0057 plus 0064 are `done`: both hosts start, two panes navigate the local
filesystem, the seven operations run through the engine with progress/cancel/conflicts, OpenAPI and
the generated client are CI-checked, events flow over both transports, and both sample plugins load.
