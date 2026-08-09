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
- [ ] 0060 Windows platform integration
- [x] 0061 Open with default application, reveal in file manager, open terminal
- [x] 0062 Drag and drop within the app and with the OS
- [x] 0063 Desktop packaging, signing and notarization

## Cross-cutting quality

- [ ] 0064 Browser/server mode security hardening (§22)
- [ ] 0065 Performance fixtures and benchmarks (§28)
- [ ] 0066 Accessibility review (§29)
- [ ] 0073 Diagnostics view and structured logging (§30)
- [ ] 0074 README, development commands and roadmap (§38)
- [x] 0085 Directory entry icons (themeable, with optional native-icon overlay)
- [x] 0086 F4 edit-in-external-editor action
- [x] 0087 F3 view action
- [x] 0088 Lister-style instant large-file viewer with lazy search
- [x] 0089 Content search across files
- [ ] 0090 Total Commander-style selection toggles (invert, select/deselect by mask)
- [x] 0091 Native file icon overlay (backend-served, layered over 0085) *(after 0085; needs 0059)*
- [x] 0092 Catppuccin icon theme *(after 0085)*
- [x] 0093 Copy filename and path actions
- [x] 0094 Tabler icons toolbar
- [x] 0095 Distributable icon theme plugins *(after 0053, 0085, 0092)*
- [ ] 0096 Mounted volume capacity
- [x] 0097 Directory aggregate totals
- [ ] 0098 Frontend i18n with translate.js
- [x] 0099 In-app text file editor with Markdown preview *(after 0088)*
- [ ] 0100 Streaming CSV and Excel file viewer subsystem

## Milestone 3 / version 1 features (§16.3, §37)

- [x] 0067 Quick filter
- [x] 0068 Recursive filesystem search
- [x] 0069 Tabs per pane
- [x] 0070 Favourites, bookmarks and recent locations
- [ ] 0071 Preview service and initial preview panel
- [x] 0072 Multi-rename tool
- [x] 0084 Workspace management UI *(after 0069; 0082 already complete)*

## Milestone 5 backlog (§16.5, §37)

- [ ] 0075 Directory comparison and synchronization
- [x] 0076 Archive provider: browse, mutate and passwords
- [ ] 0077 Checksums and duplicate-file detection

## Milestone 6 — OS-integrated locations

These are the quickest wins and deliberately do **not** depend on the remote connection framework.

- [x] 0101 OS cloud-backed locations
- [ ] 0102 Mounted network volumes

## Milestone 7 — Remote connection foundation

- [x] 0103 Remote connection framework

## Milestone 8 — Remote protocols and actions

- [ ] 0104 SFTP provider
- [ ] 0105 SSH terminal actions *(needs 0103, 0104)*
- [ ] 0106 FTP and FTPS provider
- [ ] 0107 External remote desktop launch

## Milestone 9 — Remote transfer/runtime hardening

- [ ] 0108 Cross-provider transfer planning *(needs 0104, 0106)*
- [ ] 0109 Remote change tracking *(needs 0104, 0106)*

## Milestone 10 — Optional native providers

OneDrive is already useful through 0101 when exposed by the OS, and SMB through 0102 when mounted by the OS.

- [ ] 0010 Native OneDrive provider *(optional; needs 0103, 0108, 0109)*
- [ ] 0011 Native SMB provider *(optional; needs 0103, 0108, 0109)*
