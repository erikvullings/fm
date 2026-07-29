# Task index

Derived from `file-manager-coding-agent-spec.md`. One file per task; every task cites the spec
sections it implements. Ordering follows the spec's implementation sequence (§33).

Pick the lowest-numbered `open` task whose `Depends on` tasks are all `done`.
Note the one out-of-order dependency: **0020** needs the event bus from **0031**.

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
- 0030 Settings service and persisted last workspace

**Milestone 1 (§16) is complete after 0030.**

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

## Milestone 3 / version 1 features (§16.3, §37)

- 0067 Quick filter
- 0068 Recursive filesystem search
- 0069 Tabs per pane
- 0070 Favourites, bookmarks and recent locations
- 0071 Preview service and initial preview panel
- 0072 Multi-rename tool

## Milestone 5 backlog (§16.5, §37)

- 0075 Directory comparison and synchronization
- 0076 Archive provider: browsing, extraction and creation
- 0077 Checksums and duplicate-file detection

## MVP definition (§36)

The MVP is met once 0001–0057 plus 0064 are `done`: both hosts start, two panes navigate the local
filesystem, the seven operations run through the engine with progress/cancel/conflicts, OpenAPI and
the generated client are CI-checked, events flow over both transports, and both sample plugins load.
