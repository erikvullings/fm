# Coding Agent Specification: Cross-Platform Dual-Pane File Manager

## 1. Objective

Build a modern, polished, keyboard-oriented dual-pane file manager inspired by:

- Marta on macOS:
  - polished appearance;
  - fast keyboard navigation;
  - command palette;
  - tabs and workspaces;
  - operation queue;
  - configurable actions;
  - plugin support.
- Total Commander:
  - broad file-management functionality;
  - directory comparison;
  - synchronization;
  - multi-rename;
  - archives;
  - extensible columns, viewers and providers.
- muCommander:
  - cross-platform operation;
  - remote filesystem concepts;
  - extensibility, but with substantially better performance and UX.

The application must run in two modes:

1. Browser/server mode:
   - Mithril frontend served separately through Vite during development.
   - Rust backend exposed through Axum.
   - REST for commands and queries.
   - Server-Sent Events for backend events.
   - Suitable for development and, later, managing files on a server or NAS.

2. Desktop mode:
   - The same frontend embedded in Tauri 2.
   - Rust engine embedded directly in the Tauri application.
   - Tauri commands and channels used instead of HTTP and SSE where appropriate.
   - Native integrations added incrementally.
   - Target platforms:
     - macOS;
     - Windows.
   - Keep Linux compatibility in the architecture, but Linux packaging is not required for the first release.

The frontend must not know whether it is running against Axum or Tauri. It must depend on a transport-neutral `FileManagerClient` interface.

The project should begin with basic local filesystem functionality and one or two simple plugins. The architecture must support later implementation of most Marta- and Total Commander-style features without redesigning the core.

---

# 2. Required technology stack

## 2.1 Frontend

Use:

- Vite 8;
- pnpm
- TypeScript 7 with strict compiler settings;
- Mithril.js;
- `mithril-materialized`;
- `mithril-inspector`;
- modern ESM modules;
- CSS variables for theming;
- Vitest for unit and component tests;
- browser-based integration tests using the coding environment's browser tooling where available.

Do not introduce React, Vue, Svelte or Angular.

Use Mithril factory components and idiomatic Mithril lifecycle methods.

Use `mithril-materialized` components when they are appropriate, but do not force Material-style widgets into file-manager interactions when a purpose-built component is more suitable.

Use `mithril-inspector` in development builds to:

- inspect the Mithril component tree;
- inspect component attributes and local state;
- select rendered elements;
- trace an element back to its source component where supported;
- assist coding agents in debugging component behaviour.

The inspector must:

- be enabled only in development;
- not be included or activated in production builds;
- not become a runtime dependency of core application behaviour;
- fail gracefully when unavailable.

## 2.2 Backend

Use:

- Rust stable;
- Tokio;
- Axum;
- Serde;
- `tracing`;
- `thiserror`;
- `anyhow` only at application boundaries or executables;
- `utoipa`;
- `utoipa-axum`;
- `utoipa-swagger-ui`;
- Server-Sent Events for browser-mode event delivery;
- `tower-http` for tracing, request limits, CORS and static assets where appropriate.

Use a code-first OpenAPI approach.

The Axum backend must expose:

- `/api/v1/openapi.json`;
- `/api/v1/docs`;
- versioned REST routes under `/api/v1`;
- an SSE endpoint under `/api/v1/events`.

All request and response DTOs must be documented in OpenAPI.

## 2.3 Generated TypeScript API client

Use Orval to generate a Fetch-based TypeScript client from the backend OpenAPI specification.

Do not use React Query generation.

Configure Orval for:

- Fetch;
- TypeScript DTOs;
- split output rather than one monolithic generated file;
- a custom Fetch mutator;
- consistent API error handling;
- an optional authentication/session header;
- cancellation using `AbortSignal`.

Generated files must not be edited manually.

Provide scripts similar to:

```json
{
  "scripts": {
    "api:export": "cargo run -p fm-server -- export-openapi frontend/openapi/openapi.json",
    "api:generate": "orval --config frontend/orval.config.ts",
    "api:check": "npm run api:export && npm run api:generate && git diff --exit-code",
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run"
  }
}
```

CI must fail when the checked-in OpenAPI document or generated client is outdated.

## 2.4 Desktop

Use Tauri 2.

Tauri must:

- embed the Vite frontend;
- expose thin command adapters around the same application services used by Axum;
- use channels or events for streaming backend events;
- use Tauri capabilities to limit frontend access;
- avoid opening a localhost port in normal desktop mode;
- use platform-specific adapters for native functionality.

Do not put application or filesystem logic directly in Tauri command handlers.

---

# 3. High-level architecture

Use the following structure:

```text
┌───────────────────────────────────────────────────────────┐
│ Shared Mithril frontend                                   │
│                                                           │
│ Components, state, workspaces, pane views, dialogs         │
│                                                           │
│ Depends only on FileManagerClient                         │
└───────────────────────────┬───────────────────────────────┘
                            │
             ┌──────────────┴───────────────┐
             │                              │
┌────────────▼─────────────┐   ┌────────────▼──────────────┐
│ HTTP client adapter      │   │ Tauri client adapter      │
│                          │   │                           │
│ Generated REST client    │   │ Tauri invoke commands     │
│ EventSource/SSE           │   │ Tauri channels/events     │
└────────────┬─────────────┘   └────────────┬──────────────┘
             │                              │
             └──────────────┬───────────────┘
                            │
┌───────────────────────────▼───────────────────────────────┐
│ Rust application services                                │
│                                                           │
│ Navigation, workspaces, actions, operations, search,      │
│ metadata, plugins, settings and event publication         │
└───────────────────────────┬───────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────┐
│ Rust domain and engine                                    │
│                                                           │
│ VFS providers, operation scheduler, conflict resolution,  │
│ directory snapshots, filesystem watching and journaling   │
└───────────────────────────────────────────────────────────┘
```

The following rules are mandatory:

1. Frontend components must not call `fetch`, `EventSource` or Tauri APIs directly.
2. Axum handlers must remain thin.
3. Tauri commands must remain thin.
4. Core engine crates must not depend on Axum or Tauri.
5. Transport DTOs must not be reused indiscriminately as internal domain models.
6. Long-running operations must be represented as jobs.
7. The backend must own authoritative filesystem and operation state.
8. The frontend may hold presentation state, but must not implement file-copy semantics.
9. Browser and Tauri transports must provide equivalent application behaviour.
10. Platform differences must be represented through explicit capabilities.

---

# 4. Suggested repository structure

Create a monorepo/workspace similar to:

```text
file-manager/
├── Cargo.toml
├── Cargo.lock
├── package.json
├── README.md
├── AGENTS.md
├── docs/
│   ├── architecture/
│   ├── decisions/
│   ├── plugin-api/
│   └── screenshots/
├── crates/
│   ├── fm-domain/
│   ├── fm-application/
│   ├── fm-events/
│   ├── fm-operations/
│   ├── fm-vfs/
│   ├── fm-vfs-local/
│   ├── fm-search/
│   ├── fm-metadata/
│   ├── fm-archive/
│   ├── fm-settings/
│   ├── fm-plugin-api/
│   ├── fm-plugin-runtime/
│   ├── fm-platform/
│   ├── fm-platform-macos/
│   ├── fm-platform-windows/
│   ├── fm-transport-dto/
│   └── fm-test-support/
├── apps/
│   ├── fm-server/
│   ├── fm-cli/
│   └── fm-desktop/
│       ├── src-tauri/
│       └── tauri.conf.json
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── vitest.config.ts
│   ├── orval.config.ts
│   ├── openapi/
│   │   └── openapi.json
│   └── src/
│       ├── api/
│       │   ├── generated/
│       │   ├── client/
│       │   │   ├── file-manager-client.ts
│       │   │   ├── http-file-manager-client.ts
│       │   │   ├── tauri-file-manager-client.ts
│       │   │   ├── mock-file-manager-client.ts
│       │   │   └── create-client.ts
│       │   ├── events/
│       │   │   ├── event-stream.ts
│       │   │   ├── sse-event-stream.ts
│       │   │   └── tauri-event-stream.ts
│       │   └── fetch-mutator.ts
│       ├── app/
│       ├── components/
│       ├── features/
│       ├── models/
│       ├── state/
│       ├── commands/
│       ├── keybindings/
│       ├── themes/
│       ├── utilities/
│       └── main.ts
├── plugins/
│   ├── sample-copy-markdown-path/
│   └── sample-file-age-column/
├── fixtures/
│   ├── directories/
│   └── mock-responses/
└── scripts/
    ├── export-openapi.sh
    ├── generate-api.sh
    └── create-large-directory-fixture.rs
```

Keep crate dependencies directional and acyclic.

A preferred dependency direction is:

```text
domain
  ↑
events / vfs traits / plugin API
  ↑
operations / providers / metadata / search
  ↑
application services
  ↑
Axum host and Tauri host
```

---

# 5. Core domain model

Use strongly typed identifiers rather than unstructured strings.

Examples:

```rust
pub struct WorkspaceId(Uuid);
pub struct PaneId(Uuid);
pub struct TabId(Uuid);
pub struct EntryId(Uuid);
pub struct OperationId(Uuid);
pub struct PluginId(String);
pub struct ActionId(String);
```

## 5.1 Location

Do not represent all locations as local `PathBuf` values.

Use a provider-neutral location:

```rust
pub struct Location {
    pub provider_id: ProviderId,
    pub uri: String,
}
```

Examples:

```text
file:///Users/erik/Documents
file:///C:/Users/Erik/Documents
archive:///Users/erik/example.zip!/docs
search://local?query=report
sftp://server.example.com/home/user
```

The exact URI syntax may evolve, but it must:

- be serializable;
- be stable enough for bookmarks and history;
- preserve platform-specific paths;
- identify the provider;
- avoid unsafe string concatenation.

## 5.2 Entry model

Define a compact summary for directory lists:

```rust
pub struct EntrySummary {
    pub id: EntryId,
    pub location: Location,
    pub name: String,
    pub kind: EntryKind,
    pub size: Option<u64>,
    pub modified_at: Option<DateTime<Utc>>,
    pub created_at: Option<DateTime<Utc>>,
    pub hidden: bool,
    pub read_only: bool,
    pub extension: Option<String>,
    pub mime_type: Option<String>,
    pub icon_key: Option<String>,
    pub metadata_revision: u64,
}
```

Do not retrieve expensive metadata eagerly.

Use a separate detailed metadata endpoint for:

- permissions;
- ownership;
- extended attributes;
- checksums;
- image dimensions;
- media metadata;
- archive information;
- plugin-provided fields.

## 5.3 Workspace and pane state

Model a workspace as serializable state:

```rust
pub struct Workspace {
    pub id: WorkspaceId,
    pub name: String,
    pub panes: Vec<PaneState>,
    pub active_pane_id: PaneId,
    pub layout: WorkspaceLayout,
}

pub struct PaneState {
    pub id: PaneId,
    pub tabs: Vec<TabState>,
    pub active_tab_id: TabId,
}

pub struct TabState {
    pub id: TabId,
    pub location: Location,
    pub history: NavigationHistory,
    pub view: DirectoryViewState,
}
```

Although the first UI has two panes, do not hard-code exactly two panes into the engine.

## 5.4 Directory snapshots

Return directory state in batches:

```rust
pub struct DirectorySnapshot {
    pub pane_id: PaneId,
    pub request_id: Uuid,
    pub revision: u64,
    pub location: Location,
    pub entries: Vec<EntrySummary>,
    pub total_known_entries: Option<u64>,
    pub has_more: bool,
    pub continuation_token: Option<String>,
    pub loading_state: LoadingState,
}
```

Use incremental events where necessary:

```rust
pub enum DirectoryDelta {
    EntriesAdded {
        revision: u64,
        entries: Vec<EntrySummary>,
    },
    EntriesUpdated {
        revision: u64,
        entries: Vec<EntrySummary>,
    },
    EntriesRemoved {
        revision: u64,
        entry_ids: Vec<EntryId>,
    },
    Reset {
        snapshot: DirectorySnapshot,
    },
}
```

Old directory requests must be cancellable. Navigating quickly must not allow an earlier request to overwrite a newer view.

---

# 6. Virtual filesystem provider model

Define a provider interface.

A simplified conceptual interface is:

```rust
#[async_trait]
pub trait FileSystemProvider: Send + Sync {
    fn id(&self) -> ProviderId;

    fn capabilities(&self) -> ProviderCapabilities;

    async fn list(
        &self,
        location: &Location,
        options: ListOptions,
        cancellation: CancellationToken,
    ) -> Result<DirectoryPage, VfsError>;

    async fn metadata(
        &self,
        entry: &EntryRef,
    ) -> Result<EntryMetadata, VfsError>;

    async fn create_directory(
        &self,
        location: &Location,
        name: &str,
    ) -> Result<EntryRef, VfsError>;

    async fn rename(
        &self,
        source: &EntryRef,
        destination: &Location,
    ) -> Result<EntryRef, VfsError>;

    async fn remove(
        &self,
        entry: &EntryRef,
        options: RemoveOptions,
    ) -> Result<(), VfsError>;

    async fn open_read(
        &self,
        entry: &EntryRef,
    ) -> Result<ProviderReadStream, VfsError>;

    async fn open_write(
        &self,
        destination: &Location,
        options: WriteOptions,
    ) -> Result<ProviderWriteStream, VfsError>;

    async fn watch(
        &self,
        location: &Location,
    ) -> Result<ProviderChangeStream, VfsError>;
}
```

Provider capabilities should include concepts such as:

```rust
bitflags! {
    pub struct ProviderCapabilities: u64 {
        const LIST = 1 << 0;
        const READ = 1 << 1;
        const WRITE = 1 << 2;
        const CREATE_DIRECTORY = 1 << 3;
        const RENAME = 1 << 4;
        const MOVE = 1 << 5;
        const SERVER_SIDE_COPY = 1 << 6;
        const DELETE = 1 << 7;
        const TRASH = 1 << 8;
        const WATCH = 1 << 9;
        const RANDOM_ACCESS = 1 << 10;
        const SET_TIMESTAMPS = 1 << 11;
        const SET_PERMISSIONS = 1 << 12;
        const CHECKSUM = 1 << 13;
    }
}
```

## Initial provider

Implement only the local filesystem provider in the first milestone.

The local provider must correctly handle:

- files;
- directories;
- hidden entries;
- symbolic links;
- Windows reparse points and junctions;
- macOS aliases as a later platform enhancement;
- unreadable directories;
- Unicode names;
- very long paths;
- empty files;
- sparse files where feasible;
- filesystem changes;
- paths containing spaces and shell-sensitive characters.

Do not follow symbolic links recursively by default.

Protect recursive traversal from cycles.

## Future providers

Design for, but do not initially implement:

- archive provider;
- SFTP;
- WebDAV;
- S3-compatible storage;
- SMB;
- search results;
- Trash/Recycle Bin;
- recent files;
- plugin-defined providers.

---

# 7. Backend service interface

Create an application service layer independent of Axum and Tauri.

Example:

```rust
pub struct FileManagerService {
    workspaces: Arc<WorkspaceService>,
    directories: Arc<DirectoryService>,
    operations: Arc<OperationService>,
    actions: Arc<ActionService>,
    plugins: Arc<PluginService>,
    events: Arc<EventBus>,
}
```

The service layer should expose methods corresponding to user intentions, not raw filesystem primitives.

Examples:

```rust
impl FileManagerService {
    pub async fn open_workspace(
        &self,
        request: OpenWorkspaceRequest,
    ) -> Result<WorkspaceDto, ApplicationError>;

    pub async fn navigate(
        &self,
        request: NavigateRequest,
    ) -> Result<DirectorySnapshotDto, ApplicationError>;

    pub async fn start_operation(
        &self,
        request: StartOperationRequest,
    ) -> Result<OperationDto, ApplicationError>;

    pub async fn cancel_operation(
        &self,
        operation_id: OperationId,
    ) -> Result<(), ApplicationError>;

    pub async fn invoke_action(
        &self,
        request: InvokeActionRequest,
    ) -> Result<ActionResultDto, ApplicationError>;
}
```

The frontend must issue semantic operations such as:

```json
{
  "type": "copy",
  "sources": [
    {
      "providerId": "local",
      "uri": "file:///Users/erik/Documents/example.txt"
    }
  ],
  "destination": {
    "providerId": "local",
    "uri": "file:///Users/erik/Archive"
  },
  "conflictPolicy": "ask"
}
```

The frontend must not recursively enumerate and copy files itself.

---

# 8. Axum REST API

Use `/api/v1`.

Initial endpoints should include:

```text
GET    /api/v1/runtime
GET    /api/v1/workspaces
POST   /api/v1/workspaces
GET    /api/v1/workspaces/{workspaceId}
PUT    /api/v1/workspaces/{workspaceId}
DELETE /api/v1/workspaces/{workspaceId}

POST   /api/v1/navigation/open
POST   /api/v1/directories/list
POST   /api/v1/directories/refresh
POST   /api/v1/entries/metadata

GET    /api/v1/operations
POST   /api/v1/operations
GET    /api/v1/operations/{operationId}
POST   /api/v1/operations/{operationId}/cancel
POST   /api/v1/operations/{operationId}/pause
POST   /api/v1/operations/{operationId}/resume
POST   /api/v1/operations/{operationId}/resolve-conflict

GET    /api/v1/actions
POST   /api/v1/actions/{actionId}/invoke

GET    /api/v1/plugins
POST   /api/v1/plugins/{pluginId}/enable
POST   /api/v1/plugins/{pluginId}/disable

GET    /api/v1/settings
PUT    /api/v1/settings

GET    /api/v1/events
GET    /api/v1/openapi.json
GET    /api/v1/docs
```

It is acceptable to implement only the endpoints required by the current milestone, but reserve consistent naming and DTO conventions.

## API design rules

- Use JSON request and response bodies.
- Use camelCase JSON fields.
- Use RFC 3339 timestamps.
- Use structured errors.
- Use string discriminators for tagged unions.
- Use idempotency keys for appropriate operation-start requests.
- Support request cancellation.
- Add request correlation IDs.
- Never expose raw OS errors directly to the frontend.
- Preserve a machine-readable error code and a user-readable message.

Example error:

```json
{
  "code": "destinationAlreadyExists",
  "message": "A file named report.pdf already exists.",
  "requestId": "e1ce66cc-64a8-4ae7-9cc1-2882bc80de4e",
  "details": {
    "destination": "file:///Users/erik/Documents/report.pdf"
  }
}
```

---

# 9. OpenAPI requirements

Use `utoipa` and `utoipa-axum`.

All REST DTOs must derive or implement the required OpenAPI schema traits.

OpenAPI operation IDs must:

- be stable;
- be unique;
- use descriptive camelCase names;
- produce readable generated client methods.

Examples:

```text
getRuntimeCapabilities
listWorkspaces
getWorkspace
navigatePane
listDirectory
startOperation
cancelOperation
resolveOperationConflict
listActions
invokeAction
listPlugins
```

Add examples to important schemas.

Export OpenAPI without starting the web server:

```bash
cargo run -p fm-server -- export-openapi frontend/openapi/openapi.json
```

The exported document must be deterministic so CI does not produce ordering-only changes.

---

# 10. SSE event stream

Use Server-Sent Events for backend-to-browser updates.

The SSE endpoint must:

- require the same authenticated session as REST endpoints;
- support keep-alive messages;
- emit stable event IDs;
- support reconnection using `Last-Event-ID` where practical;
- send typed JSON payloads;
- avoid one SSE connection per operation;
- multiplex all session events over one stream;
- filter events to the appropriate session or workspace;
- close cleanly when the session ends.

Use named SSE events:

```text
runtime.ready
workspace.updated
directory.snapshot
directory.delta
operation.created
operation.progress
operation.stateChanged
operation.conflict
operation.completed
operation.failed
plugin.changed
notification.created
```

Example:

```text
event: operation.progress
id: 1042
data: {"operationId":"...","completedBytes":1048576,"totalBytes":5242880}
```

Define a shared tagged event envelope:

```rust
pub struct EventEnvelope<T> {
    pub event_id: u64,
    pub timestamp: DateTime<Utc>,
    pub workspace_id: Option<WorkspaceId>,
    pub payload: T,
}
```

The frontend must:

- maintain one SSE connection;
- reconnect with exponential backoff;
- detect stale connections;
- expose connection status;
- batch frequent progress events before redraw;
- ignore events from older workspace revisions where relevant;
- close the connection on logout or shutdown.

Do not use SSE for requests that require immediate request/response semantics.

Conflict resolution must use:

1. SSE event notifying the frontend of a conflict;
2. REST or Tauri command submitting the user's decision.

---

# 11. Tauri adapter

Create a Tauri host around the same `FileManagerService`.

Examples:

```rust
#[tauri::command]
async fn navigate_pane(
    service: State<'_, Arc<FileManagerService>>,
    request: NavigateRequest,
) -> Result<DirectorySnapshotDto, ApplicationErrorDto> {
    service.navigate(request).await.map_err(Into::into)
}
```

Tauri commands should mirror the semantic REST API, but they do not need to reproduce HTTP concepts.

Use Tauri channels or events for:

- directory deltas;
- operation progress;
- operation conflicts;
- filesystem changes;
- plugin notifications.

Expose only explicitly permitted commands through Tauri capabilities.

The Tauri frontend client must implement the same interface as the HTTP client.

Do not start Axum inside the normal Tauri process merely to reuse HTTP.

It is acceptable to provide an optional diagnostics mode that starts a local API, but it must be disabled by default.

---

# 12. Frontend API abstraction

Define:

```ts
export interface FileManagerClient {
  getRuntimeCapabilities(
    signal?: AbortSignal,
  ): Promise<RuntimeCapabilities>;

  getWorkspace(
    workspaceId: WorkspaceId,
    signal?: AbortSignal,
  ): Promise<Workspace>;

  navigatePane(
    request: NavigateRequest,
    signal?: AbortSignal,
  ): Promise<DirectorySnapshot>;

  listDirectory(
    request: ListDirectoryRequest,
    signal?: AbortSignal,
  ): Promise<DirectorySnapshot>;

  getEntryMetadata(
    request: EntryMetadataRequest,
    signal?: AbortSignal,
  ): Promise<EntryMetadata>;

  startOperation(
    request: StartOperationRequest,
    signal?: AbortSignal,
  ): Promise<Operation>;

  cancelOperation(
    operationId: OperationId,
    signal?: AbortSignal,
  ): Promise<void>;

  resolveConflict(
    request: ResolveConflictRequest,
    signal?: AbortSignal,
  ): Promise<void>;

  listActions(
    signal?: AbortSignal,
  ): Promise<ActionDescriptor[]>;

  invokeAction(
    request: InvokeActionRequest,
    signal?: AbortSignal,
  ): Promise<ActionResult>;

  listPlugins(
    signal?: AbortSignal,
  ): Promise<PluginDescriptor[]>;

  subscribe(
    listener: (event: BackendEvent) => void,
  ): Promise<Unsubscribe>;
}
```

Implement:

```text
HttpFileManagerClient
TauriFileManagerClient
MockFileManagerClient
```

Select the implementation in one bootstrap location.

Example:

```ts
export function createFileManagerClient(
  runtime: RuntimeKind,
): FileManagerClient {
  switch (runtime) {
    case "tauri":
      return new TauriFileManagerClient();
    case "mock":
      return new MockFileManagerClient();
    case "http":
      return new HttpFileManagerClient();
    default:
      return assertNever(runtime);
  }
}
```

Use:

```text
VITE_RUNTIME=http
VITE_RUNTIME=tauri
VITE_RUNTIME=mock
```

Do not scatter Tauri runtime checks through UI components.

---

# 13. Frontend application architecture

Organize the frontend by features.

Suggested areas:

```text
features/
├── workspace/
├── panes/
├── directory-table/
├── navigation/
├── selection/
├── operations/
├── command-palette/
├── search/
├── preview/
├── plugins/
├── settings/
├── keybindings/
└── notifications/
```

Use a small, explicit application state model rather than a large generic state-management framework.

Example:

```ts
export interface AppState {
  runtime: RuntimeState;
  workspace: WorkspaceState;
  operations: OperationsState;
  plugins: PluginsState;
  notifications: NotificationState;
  connection: ConnectionState;
}
```

Use immutable replacement for major snapshots.

Batch high-frequency updates such as operation progress.

Avoid a global redraw for every file-list event when possible.

Use stable entry IDs.

---

# 14. Main user interface

The main window must contain:

```text
┌──────────────────────────────────────────────────────────────┐
│ Native/app menu or compact application bar                   │
├──────────────────────────────────────────────────────────────┤
│ Workspace tabs / toolbar / search / command palette trigger  │
├────────────────────────────┬─────────────────────────────────┤
│ Left pane                  │ Right pane                      │
│                            │                                 │
│ Tab bar                    │ Tab bar                         │
│ Breadcrumb/path input      │ Breadcrumb/path input           │
│ File table                 │ File table                      │
│ Status bar                 │ Status bar                      │
├────────────────────────────┴─────────────────────────────────┤
│ Operation centre / queue / progress                          │
├──────────────────────────────────────────────────────────────┤
│ Optional function-key/action bar                             │
└──────────────────────────────────────────────────────────────┘
```

## Visual direction

The UI should be:

- polished;
- compact without being cramped;
- keyboard-first;
- suitable for long work sessions;
- visually quieter than classic Total Commander;
- more information-dense than a mobile Material application;
- consistent across macOS and Windows;
- adaptable to native platform conventions;
- accessible in light and dark modes.

Use `mithril-materialized` for:

- dialogs;
- menus;
- buttons;
- toggles;
- forms;
- settings;
- notifications;
- tooltips where suitable.

Create custom components for:

- virtualized directory table;
- pane;
- breadcrumb path;
- tab strip;
- operation queue;
- command palette;
- file conflict dialog;
- quick filter;
- preview panel.

Do not use card-heavy layouts for the main file list.

## Themes

Create CSS variable-based themes.

At minimum:

- light;
- dark;
- follow system.

Provide design tokens for:

```css
--fm-background
--fm-surface
--fm-surface-elevated
--fm-text
--fm-text-muted
--fm-border
--fm-accent
--fm-selection
--fm-selection-inactive
--fm-hover
--fm-error
--fm-warning
--fm-success
--fm-row-height
--fm-font-family
--fm-font-size
--fm-radius
--fm-shadow
```

Do not hard-code theme colours inside components.

---

# 15. Directory table

The directory table is a critical custom component.

It must eventually support:

- virtualization;
- keyboard cursor;
- selection independent of cursor;
- single selection;
- range selection;
- discontinuous selection;
- select all;
- invert selection;
- type-to-select;
- quick filtering;
- sorting;
- multiple sort keys later;
- resizable columns;
- reorderable columns;
- configurable columns;
- custom plugin columns;
- inline rename;
- drag source and drop target;
- optional alternating rows;
- hidden-file styling;
- symlink/junction indicators;
- file icons;
- status badges;
- loading placeholders;
- empty states;
- error states.

Initial columns:

- name;
- extension or type;
- size;
- modified time.

The table must comfortably handle:

- 10,000 entries;
- 100,000 entries through virtualization;
- mocked 1,000,000-entry datasets without mounting every row.

Never render the entire list into the DOM.

Use a fixed row height for the initial version.

Make row height configurable later.

## Keyboard behaviour

Initial keyboard support:

```text
Arrow Up/Down      Move cursor
Page Up/Down       Move one viewport
Home/End           First/last entry
Enter              Open file or directory
Backspace          Parent directory
Tab                Switch active pane
Space              Toggle selection
Shift+Arrow        Extend selection
Ctrl/Cmd+A         Select all
F2                 Rename
F5                 Copy to other pane
F6                 Move to other pane
F7                 Create directory
F8/Delete          Delete or move to Trash
Ctrl/Cmd+P         Command palette
Ctrl/Cmd+L         Focus location input
Ctrl/Cmd+F         Quick filter/search
Ctrl/Cmd+T         New tab
Ctrl/Cmd+W         Close tab
```

Make all keybindings configurable through the action system.

Avoid using browser-reserved shortcuts when they cannot be intercepted reliably.

---

# 16. Initial feature scope

## Milestone 1: shell and navigation

Implement:

- Rust workspace and frontend workspace;
- Axum server;
- OpenAPI generation;
- Orval client generation;
- SSE connection;
- Tauri shell;
- HTTP and Tauri client adapters;
- mock client;
- runtime capability endpoint;
- two-pane layout;
- local filesystem listing;
- directory navigation;
- parent navigation;
- path entry;
- pane focus;
- basic sorting;
- file and directory selection;
- file metadata summary;
- persisted last workspace;
- light and dark theme;
- development-only `mithril-inspector`.

No destructive operation is required until navigation is stable.

## Milestone 2: basic file operations

Implement:

- create directory;
- rename;
- copy file;
- copy directory recursively;
- move file;
- move directory;
- duplicate;
- move to Trash/Recycle Bin where supported;
- permanent delete only after explicit confirmation;
- basic overwrite conflict dialog;
- cancellation;
- progress reporting;
- operation queue;
- completed and failed operation states;
- refresh affected directories;
- clipboard-based copy/cut/paste within the application.

Do not implement file operations directly in UI code.

## Milestone 3: productivity basics

Implement:

- tabs per pane;
- navigation history;
- favourites/bookmarks;
- recent locations;
- configurable keyboard shortcuts;
- command palette;
- quick filter;
- basic file preview;
- open file with default application;
- reveal in Finder/Explorer;
- open terminal at current directory;
- multi-rename, initially with:
  - search and replace;
  - prefix;
  - suffix;
  - sequence number;
  - case transformation;
  - preview before applying.

## Milestone 4: plugin foundation

Implement:

- plugin discovery;
- manifests;
- enable/disable;
- permissions;
- action registration;
- custom metadata columns;
- plugin error isolation;
- plugin logs;
- sample plugins.

Start with an in-process scripting solution if needed, but keep the API suitable for later Wasm isolation.

Preferred long-term model:

- Lua for small user scripts and actions;
- WebAssembly Component Model for distributable plugins;
- no public native Rust dynamic-library ABI.

## Milestone 5: advanced file-manager capabilities

Design and implement incrementally:

- directory comparison;
- directory synchronization;
- checksums;
- duplicate-file detection;
- archive browsing;
- archive creation and extraction;
- content search;
- background indexing;
- file viewer;
- hex viewer;
- image and PDF previews;
- batch attribute changes;
- symbolic-link creation;
- file splitting and joining;
- secure deletion only when technically meaningful and clearly caveated;
- remote providers;
- custom tool integration;
- workspace layouts;
- multiple panes;
- session restoration.

These are not required for the initial MVP, but the architecture must not preclude them.

---

# 17. Operation engine

Represent every mutating operation as a job.

```rust
pub struct Operation {
    pub id: OperationId,
    pub kind: OperationKind,
    pub state: OperationState,
    pub sources: Vec<EntryRef>,
    pub destination: Option<Location>,
    pub progress: OperationProgress,
    pub conflict_policy: ConflictPolicy,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}
```

Operation states:

```rust
pub enum OperationState {
    Queued,
    Planning,
    Running,
    Paused,
    WaitingForConflictResolution,
    Cancelling,
    Cancelled,
    Completed,
    CompletedWithWarnings,
    Failed,
}
```

Initial operation kinds:

```rust
pub enum OperationKind {
    CreateDirectory,
    Rename,
    Copy,
    Move,
    Duplicate,
    Trash,
    Delete,
}
```

Progress must include:

```rust
pub struct OperationProgress {
    pub completed_items: u64,
    pub total_items: Option<u64>,
    pub completed_bytes: u64,
    pub total_bytes: Option<u64>,
    pub current_entry: Option<EntryRef>,
    pub bytes_per_second: Option<u64>,
}
```

## Conflict policies

Support:

```rust
pub enum ConflictPolicy {
    Ask,
    Skip,
    Overwrite,
    RenameNew,
    KeepNewer,
}
```

The initial release only needs reliable implementations for:

- ask;
- skip;
- overwrite;
- rename new.

Conflict resolution must allow:

- apply once;
- apply to all similar conflicts;
- cancel operation.

## Safety requirements

File operations must account for:

- source and destination being the same;
- destination being within source;
- case-sensitive versus case-insensitive filesystems;
- symbolic-link cycles;
- partial destination files;
- cancellation;
- disk full;
- permission denied;
- locked files;
- concurrent changes;
- source disappearing;
- destination appearing after planning;
- cross-volume moves;
- overwrite of directories versus files;
- timestamp preservation;
- metadata preservation where supported.

Never silently replace a directory with a file or vice versa.

Use temporary destination names for copies where appropriate, followed by a final atomic rename.

Document which metadata is preserved.

Add integration tests for interrupted and failed operations.

---

# 18. Action system

Everything invokable from the UI should be an action.

```rust
pub struct ActionDescriptor {
    pub id: ActionId,
    pub title: String,
    pub description: Option<String>,
    pub category: ActionCategory,
    pub default_shortcuts: Vec<KeyChord>,
    pub context_requirements: ActionContextRequirements,
    pub parameter_schema: Option<serde_json::Value>,
    pub source: ActionSource,
}
```

Examples:

```text
core.open
core.openWith
core.copy
core.move
core.rename
core.delete
core.createDirectory
core.openTerminal
core.copyPath
core.copyRelativePath
core.calculateChecksum
core.compareDirectories
core.synchronizeDirectories
plugin.markdown.copyLink
```

Menus, context menus, toolbars, command palette and keyboard shortcuts must invoke the same action registry.

The frontend may evaluate simple availability rules for responsive rendering, but the backend remains authoritative.

---

# 19. Plugin model

## 19.1 Plugin manifest

Use a manifest such as:

```toml
id = "sample.copy-markdown-path"
name = "Copy Markdown Path"
version = "0.1.0"
api_version = "1"
description = "Copies the selected file as a Markdown link."
entrypoint = "plugin.wasm"

[permissions]
clipboard_write = true
filesystem_read = false
filesystem_write = false
network = []
process_spawn = false

[contributions]
actions = true
columns = false
providers = false
previews = false
```

The final schema may differ, but manifests must be versioned.

## 19.2 Initial contribution types

Support only:

- actions;
- context-menu entries through actions;
- command-palette entries through actions;
- custom columns;
- metadata extraction.

Do not initially allow plugins to inject arbitrary JavaScript or arbitrary UI into the primary WebView.

Future declarative UI contributions may include:

- settings sections;
- inspector sections;
- preview documents;
- provider connection forms.

## 19.3 Plugin permissions

Represent permissions explicitly:

- selected-entry metadata;
- selected-entry content read;
- filesystem read scopes;
- filesystem write scopes;
- clipboard read;
- clipboard write;
- network host allow-list;
- process execution;
- notifications;
- settings storage.

Do not provide unrestricted filesystem, process or network access by default.

## 19.4 Plugin isolation

A plugin failure must not crash the main application.

At minimum:

- catch plugin errors;
- apply execution timeouts;
- disable repeatedly failing plugins;
- log failures;
- show a non-blocking notification;
- allow users to inspect plugin diagnostics.

For the first proof of concept, a restricted Lua runtime may be simpler than Wasm.

For the distributable plugin architecture, prefer Wasmtime and the WebAssembly Component Model.

Do not expose unstable Rust ABI types to plugins.

---

# 20. Sample plugins

Implement at least two sample plugins.

## Sample plugin 1: Copy Markdown path

Action:

```text
sample.copyMarkdownPath
```

Behaviour:

- appears when one file or directory is selected;
- creates a Markdown link;
- copies the link to the clipboard;
- uses the entry name as link text;
- uses a file URI or configured relative path as target.

Example:

```markdown
[report.pdf](file:///Users/erik/Documents/report.pdf)
```

The plugin demonstrates:

- action registration;
- context requirements;
- clipboard permission;
- access to selected-entry metadata;
- success notification.

## Sample plugin 2: File age column

Column:

```text
sample.fileAge
```

Behaviour:

- adds a column displaying age in a compact form:
  - `5m`;
  - `3h`;
  - `2d`;
  - `4mo`;
  - `2y`.
- uses the modification timestamp;
- supports sorting by the raw timestamp, not by formatted text;
- updates at a reasonable interval without redrawing every second.

The plugin demonstrates:

- custom column registration;
- metadata access;
- display formatting;
- sort value versus display value.

Optionally implement a third development plugin:

## Optional sample plugin 3: Uppercase rename preview

- contributes a batch action;
- previews proposed names;
- requires explicit confirmation;
- invokes the normal operation engine instead of mutating files directly.

This demonstrates that plugins should request operations through public services rather than bypassing safety semantics.

---

# 21. Runtime capabilities

The backend must return capabilities:

```ts
export interface RuntimeCapabilities {
  runtime: "browserServer" | "tauri" | "mock";
  platform: "macos" | "windows" | "linux" | "unknown";
  nativeMenus: boolean;
  nativeFileIcons: boolean;
  nativeThumbnails: boolean;
  nativeDragOut: boolean;
  systemTrash: boolean;
  revealInSystemFileManager: boolean;
  openTerminal: boolean;
  clipboard: boolean;
  plugins: boolean;
  serverAdministration: boolean;
}
```

Components should respond to capabilities rather than directly detecting operating systems.

---

# 22. Browser/server security

The browser/server backend controls files and must not run as an unauthenticated localhost API.

Development mode may simplify setup, but production server mode must include:

- loopback-only binding by default;
- randomly generated session secret;
- strict origin validation;
- no wildcard CORS;
- authenticated SSE;
- request-size limits;
- path validation;
- explicit opt-in before LAN binding;
- TLS when accessed remotely;
- proper authentication for multi-user or remote use;
- rate limiting where appropriate;
- audit logging for destructive operations;
- separate server-mode configuration.

Do not accept arbitrary absolute paths from an untrusted remote client without access-control checks.

The backend must establish accessible roots for remote/server users.

Tauri mode may use the current OS user's filesystem permissions, but must still restrict exposed commands through capabilities.

---

# 23. Native platform integration

Create platform-adapter traits.

## macOS targets

Eventually support:

- file icons;
- Quick Look previews;
- Finder reveal;
- Trash;
- mounted volumes;
- application bundles;
- aliases;
- extended attributes;
- Finder tags;
- native menus;
- drag to and from Finder;
- terminal integration;
- signing and notarization.

## Windows targets

Eventually support:

- shell icons;
- shell thumbnails;
- Explorer reveal;
- Recycle Bin;
- drive listing;
- UNC paths;
- long paths;
- junctions;
- reparse points;
- shortcuts;
- file attributes;
- locked-file errors;
- native menus;
- drag to and from Explorer;
- terminal integration;
- installer signing.

Implement only the required subset for each milestone.

Keep unsupported native functions behind capability flags.

---

# 24. Search and filtering

Distinguish:

1. Quick filter:
   - filters the current directory;
   - entirely responsive;
   - may run in the frontend for the loaded snapshot;
   - supports plain text initially;
   - supports glob or regex later.

2. Filesystem search:
   - runs in Rust;
   - recursively traverses one or more roots;
   - streams results;
   - is cancellable;
   - supports filename first;
   - supports size/date/type filters later;
   - supports content search later.

Future search results should be exposed as a virtual location:

```text
search://local/{searchId}
```

---

# 25. Preview architecture

Define a preview service and renderer registry.

Initial preview types:

- plain text;
- common image formats;
- file metadata;
- unsupported-file placeholder.

Later:

- Markdown;
- PDF;
- audio/video metadata;
- archive summary;
- source-code syntax highlighting;
- plugin-defined previews.

Do not load entire large files into frontend memory.

Use ranged reads or streamed preview data.

Apply file-size limits.

Never execute previewed files.

---

# 26. Settings

Persist settings outside the frontend's local storage where practical.

Settings include:

- theme;
- font size;
- row height;
- date format;
- size format;
- hidden-file visibility;
- confirm permanent delete;
- default conflict policy;
- operation concurrency;
- pane layout;
- columns;
- keybindings;
- enabled plugins;
- plugin settings;
- terminal command;
- default start locations.

Use versioned settings and migrations.

Do not discard all settings when the schema changes.

---

# 27. Testing strategy

## Rust unit tests

Test:

- path normalization;
- location parsing;
- capability checks;
- operation planning;
- conflict policies;
- recursive traversal;
- symlink handling;
- event serialization;
- plugin manifest validation;
- settings migration.

## Rust integration tests

Use temporary directories.

Test:

- copying files;
- copying directory trees;
- moving within a filesystem;
- moving across simulated filesystems;
- rename conflicts;
- cancellation;
- permission errors where testable;
- destination-inside-source rejection;
- Unicode names;
- case-only renames;
- symbolic-link cycles;
- partial copy cleanup;
- concurrent modifications;
- restoring operation history.

Never run destructive integration tests against arbitrary user directories.

## Frontend tests

Use Vitest.

Test:

- selection reducer;
- keyboard navigation;
- sort behaviour;
- path editing;
- command filtering;
- operation progress updates;
- conflict-dialog state;
- event reconnection handling;
- runtime capability rendering;
- plugin column rendering.

Use the mock client for deterministic states.

## Browser interaction tests

Test:

- opening directories;
- switching panes;
- selecting ranges;
- copy from one pane to another;
- conflict resolution;
- cancelling an operation;
- command palette;
- tabs;
- theme switching;
- keyboard-only usage.

Use browser tools available to the coding agent.

Do not require Playwright when the coding environment provides a capable integrated browser. Otherwise use the project's preferred browser testing tooling.

## Tauri tests

At minimum:

- build Tauri on macOS and Windows in CI;
- test command serialization;
- test Tauri client adapter;
- smoke-test application startup;
- smoke-test navigation;
- smoke-test one file operation in a safe temporary directory.

---

# 28. Performance requirements

Establish benchmark fixtures for:

- 1,000 entries;
- 10,000 entries;
- 100,000 entries;
- 1,000,000 mocked entries;
- 10,000 small files copied;
- one multi-gigabyte sparse or generated test file;
- deeply nested directories;
- directories containing long Unicode names.

Initial performance objectives:

- application shell visible quickly;
- first directory page displayed without waiting for all metadata;
- changing pane focus feels immediate;
- keyboard navigation remains responsive;
- scrolling does not mount all rows;
- operation progress events are throttled or batched;
- no synchronous filesystem traversal on the frontend;
- no blocking filesystem calls on the Tauri UI thread;
- directory navigation cancels obsolete requests;
- large directory DTOs are transferred in pages or batches.

Add Rust benchmarks where useful.

Add frontend rendering measurements for the virtualized table.

---

# 29. Accessibility

Support:

- keyboard-only operation;
- visible focus;
- semantic roles;
- accessible labels;
- screen-reader-friendly dialogs;
- correct focus trapping in modals;
- reduced-motion preference;
- adequate contrast;
- scalable text;
- no colour-only status indicators.

The virtualized table must preserve understandable focus and row semantics.

Use platform-appropriate modifier keys:

- Command on macOS;
- Control on Windows.

---

# 30. Logging and diagnostics

Use structured tracing.

Include:

- request ID;
- operation ID;
- workspace ID;
- plugin ID;
- provider ID;
- duration;
- result status.

Do not log:

- file contents;
- authentication secrets;
- session tokens;
- excessive full paths by default in telemetry.

Provide a diagnostics view showing:

- frontend version;
- backend version;
- Tauri version where relevant;
- platform;
- runtime capabilities;
- SSE/channel state;
- loaded plugins;
- recent non-sensitive errors;
- operation queue status.

---

# 31. CI

Create GitHub Actions or equivalent workflows for:

- Rust formatting;
- Clippy with warnings denied;
- Rust tests;
- frontend formatting;
- TypeScript type checking;
- Vitest;
- OpenAPI export;
- generated-client consistency;
- frontend production build;
- Tauri build on macOS;
- Tauri build on Windows;
- dependency audits;
- packaging smoke tests later.

Use caching appropriately.

Do not require code signing for pull-request builds.

Signing and notarization should be enabled only in protected release workflows.

---

# 32. Development commands

Provide convenient root-level commands.

Examples:

```bash
npm run dev
npm run dev:mock
npm run dev:http
npm run dev:tauri
npm run test
npm run test:rust
npm run test:frontend
npm run lint
npm run api:export
npm run api:generate
npm run api:check
npm run build
npm run build:tauri
```

Recommended development flow:

```text
Terminal 1:
cargo watch -x "run -p fm-server"

Terminal 2:
npm --prefix frontend run dev
```

Use a Vite proxy for `/api`.

SSE proxying must also work in development.

---

# 33. Implementation sequence

Follow this order.

## Step 1: repository bootstrap

Create:

- Cargo workspace;
- frontend project;
- Tauri shell;
- Axum server;
- shared linting and formatting;
- CI skeleton;
- architecture documentation.

## Step 2: API pipeline

Implement:

- health endpoint;
- runtime capabilities;
- OpenAPI export;
- Swagger UI;
- Orval generation;
- generated Fetch client;
- custom Fetch mutator;
- basic API integration test.

## Step 3: transport abstraction

Implement:

- `FileManagerClient`;
- HTTP adapter;
- Tauri adapter;
- mock adapter;
- runtime selection;
- typed backend events.

## Step 4: local provider

Implement:

- local location parsing;
- directory listing;
- entry summaries;
- paging;
- cancellation;
- errors;
- basic filesystem watching.

## Step 5: frontend shell

Implement:

- two panes;
- directory table;
- path bars;
- active pane;
- basic navigation;
- loading/error states;
- theme;
- inspector integration.

## Step 6: event delivery

Implement:

- Rust event bus;
- SSE;
- frontend reconnect logic;
- Tauri channel;
- directory refresh events;
- connection indicator.

## Step 7: file operations

Implement one operation at a time:

1. create directory;
2. rename;
3. copy one file;
4. copy directory;
5. move;
6. Trash/Recycle Bin;
7. permanent delete;
8. conflict resolution;
9. cancellation;
10. queue and history.

Do not implement all operations in one unreviewable change.

## Step 8: action system

Implement:

- core action registry;
- command palette;
- keybinding dispatcher;
- context-sensitive action availability;
- context menus.

## Step 9: plugins

Implement:

- manifest loading;
- action contribution;
- column contribution;
- permission checks;
- two sample plugins;
- plugin management page.

## Step 10: desktop polish

Implement:

- native file icons;
- native menus;
- open with default application;
- reveal in Finder/Explorer;
- open terminal;
- drag-and-drop;
- system Trash/Recycle Bin;
- packaging.

---

# 34. Required architecture decision records

Create short ADRs for:

1. Browser and Tauri dual-host architecture.
2. Axum REST plus SSE.
3. OpenAPI source and generated TypeScript client.
4. VFS provider abstraction.
5. Operation scheduler and conflict handling.
6. Plugin runtime selection.
7. Frontend state management.
8. Virtualized table implementation.
9. Settings persistence.
10. Native platform adapters.

Each ADR must include:

- context;
- decision;
- alternatives;
- consequences;
- revisit conditions.

---

# 35. Coding-agent rules

The coding agent must:

- inspect existing repository conventions before changing architecture;
- prefer small, reviewable commits;
- avoid speculative abstractions not linked to a planned feature;
- include tests with each behaviour change;
- avoid unsafe filesystem assumptions;
- never test destructive operations outside temporary test roots;
- keep generated code clearly separated;
- not manually edit generated OpenAPI clients;
- document public interfaces;
- use strongly typed errors;
- add cancellation to long-running work;
- preserve browser and Tauri parity;
- run formatting, linting and relevant tests before finishing;
- report incomplete or platform-untested behaviour explicitly.

The coding agent must not:

- move application logic into Mithril components;
- make Axum the core application architecture;
- make Tauri commands the core application architecture;
- expose arbitrary filesystem methods directly to JavaScript;
- recursively copy files in TypeScript;
- expose unrestricted plugin APIs;
- use native Rust dynamic libraries as the initial public plugin ABI;
- render large directories without virtualization;
- silently overwrite user files;
- silently follow symbolic links;
- add React-specific libraries;
- introduce a generic state framework without a demonstrated need;
- rely solely on browser mode without testing Tauri regularly.

---

# 36. Definition of the first usable MVP

The first usable MVP is complete when all of the following work:

1. The application starts in:
   - browser/Axum mode;
   - Tauri mode on macOS;
   - Tauri mode on Windows.

2. The same Mithril frontend is used in both modes.

3. Two panes can independently:
   - open a local directory;
   - navigate into a directory;
   - navigate to the parent;
   - use history;
   - sort entries;
   - select entries.

4. The following operations work:
   - create directory;
   - rename;
   - copy;
   - move;
   - duplicate;
   - Trash/Recycle Bin where supported;
   - permanent delete with confirmation.

5. Operations:
   - run through the Rust operation engine;
   - report progress;
   - can be cancelled;
   - handle destination conflicts;
   - appear in an operation centre.

6. OpenAPI:
   - is generated from Rust;
   - is served by the backend;
   - produces the TypeScript client;
   - is checked in CI.

7. Events:
   - arrive through SSE in browser mode;
   - arrive through Tauri channels/events in desktop mode;
   - update operation progress and directory views.

8. The frontend includes:
   - dark and light themes;
   - configurable keyboard shortcuts;
   - a command palette;
   - a virtualized directory table;
   - development-only `mithril-inspector`.

9. The plugin system loads:
   - the Copy Markdown Path sample plugin;
   - the File Age Column sample plugin.

10. Automated tests cover:
    - navigation;
    - selection;
    - copying;
    - moving;
    - renaming;
    - cancellation;
    - conflicts;
    - event handling;
    - plugin loading.

11. No known operation can silently overwrite or permanently delete files without the documented policy or confirmation.

---

# 37. Definition of polished version 1

Version 1 should add:

- tabs;
- workspaces;
- favourites;
- recent locations;
- multi-rename;
- quick filter;
- recursive search;
- file preview;
- native icons;
- native drag-and-drop;
- open terminal;
- open with default application;
- directory comparison;
- basic directory synchronization;
- archive browsing for common formats;
- checksum calculation;
- plugin management UI;
- signed macOS and Windows installers;
- crash-safe persisted operation history where feasible;
- accessibility review;
- performance review with large directories.

Remote providers and a plugin marketplace are not required for version 1.

---

# 38. Deliverables for the first implementation pass

Produce:

1. Working Cargo workspace.
2. Working Vite 8 + Mithril + TypeScript frontend.
3. `mithril-materialized` configured and demonstrated.
4. Development-only `mithril-inspector` integration.
5. Axum server with:
   - runtime endpoint;
   - directory list endpoint;
   - SSE endpoint;
   - OpenAPI;
   - Swagger UI.
6. Orval-generated Fetch client.
7. Shared `FileManagerClient`.
8. HTTP, Tauri and mock adapters.
9. Minimal two-pane interface.
10. Local directory navigation.
11. Minimal Tauri desktop application showing the same interface.
12. Unit and integration tests.
13. README containing exact development commands.
14. ADRs for the initial architectural decisions.
15. A roadmap showing which parts remain mocked or incomplete.

The first pass should prove the architecture end to end. Do not attempt all advanced file-manager functionality before this vertical slice works.
