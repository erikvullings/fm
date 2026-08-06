# fm

Dual-pane file manager: a Rust workspace (Axum server + Tauri shell) with a Mithril/TypeScript
frontend. See [file-manager-coding-agent-spec.md](file-manager-coding-agent-spec.md) for the full
specification and [TASKS/README.md](TASKS/README.md) for the implementation task index.

[![CI](https://github.com/erikvullings/fm/actions/workflows/ci.yml/badge.svg)](https://github.com/erikvullings/fm/actions/workflows/ci.yml)

## Development

See [AGENTS.md](AGENTS.md) for repository conventions, and run `pnpm run <script>` at the repo
root (`dev`, `test`, `lint`, `build`, ...) — see the root `package.json` for the full list.

For deterministic frontend development without Axum or Tauri, run `pnpm dev:mock`. The mock
adapter provides nested and special-case directory fixtures, configurable loading/failure states,
scriptable backend events, and lazily generated directories of up to 1,000,000 entries.

The custom Mithril directory table uses fixed-height virtual rows from `--fm-row-height`, so large
and lazy mock directories mount only the visible window plus overscan. It exposes semantic grid
rows and cells, cursor/selection rendering hooks, explicit loading/empty/error states, and a
reproducible million-entry rendering check via `pnpm --dir frontend benchmark:directory-table`.
The presentation-only pane composes that table with a compact single-tab strip, clickable
filesystem breadcrumbs, Ctrl/Cmd+L path editing, inline navigation errors, and entry, selection,
size, and sort status counters.
Name, extension, size, and modified headers sort the loaded page in either direction, using stable
natural name ordering and raw metadata values; large sorts yield cooperatively to keep the UI
responsive. Folder grouping comes from the persisted tab view rather than the table component.
The cursor also drives a cancellable lazy metadata summary, while typed size/date presentation
settings keep table and summary formatting consistent.
Per-pane selection is keyed by stable entry IDs and remains independent of the keyboard cursor.
Arrow, page, edge, range, toggle, select-all, pane-switching, open and parent bindings are handled
through the action-registry keybinding dispatcher, with settings overrides, host-platform modifiers
and type-to-select. While a prefix is
active it appears behind a divider at the right of the pane footer, highlights the first matching
in-word occurrence in every matching name, and constrains keyboard cursor movement to those
matches. Backspace edits the prefix, Escape clears it and the selection, and an unmatched prefix
briefly flashes red but remains editable. Non-root directories prepend a synthetic `..` row that
navigates to the parent without entering the selectable file set.
Ctrl/Cmd+P opens a custom, keyboard-first command palette over the already-loaded action registry.
It fuzzy-filters action titles, ids and categories, ranks matches and recently used commands, shows
shortcuts and availability reasons, prompts for schema-defined parameters, and returns focus to its
previous target when closed. Enabled plugin actions use that same registry, so they automatically
appear in the palette and context menus. Plugins currently run in a restricted Lua sandbox with
resource limits and per-plugin bounded diagnostics; Lua failures create non-blocking warnings and
are auto-disabled after repeated failures. See [`docs/plugin-api/README.md`](docs/plugin-api/README.md).
The bundled File Age sample contributes a host-rendered `sample.fileAge` column, with compact age
display and raw modification-time sorting.
The main window loads its authoritative workspace projection through the shared client and renders
the recursive pane layout with a draggable, minimum-width splitter. Pane clicks and Tab traversal
move visible focus through semantic workspace commands; divider changes are sent as debounced
`UpdateLayout` commands. The event-driven operation centre shows queued, running, paused, completed,
and failed jobs with progress, transfer rate, current entry, lifecycle controls, retained results,
and expandable failure details. Completed and failed jobs remain visible until dismissed.
Application-wide settings are stored as versioned JSON in the platform configuration directory
and are shared by the Axum `GET`/`PUT /api/v1/settings` endpoints and equivalent Tauri commands.
Writes are atomic, older schemas migrate forward, and corrupt files are backed up before defaults
are loaded with a warning. Frontend bootstrap applies the stored theme, font/row dimensions, and
date/size formats; live pane layouts, tabs, and per-tab views remain workspace-owned state.

Development builds include Mithril Inspector. Open the docked inspector with the `M` toggle at the
bottom of the page, or press `Alt+Shift+M` to select a rendered element. Use it to trace elements to
their source components, inspect the component tree, and view component attrs and local state. The
inspector and its editor endpoint are excluded from production builds.

Backend-to-frontend updates use one typed event contract for both browser SSE and Tauri channels.
The frontend event-stream abstraction exposes connection status and listener registration while
ignoring unknown future event types for forward compatibility.
Shared frontend data lives in a readonly, explicit Meiosis-style state tree. Typed actions enqueue
immutable Mergerino patches through one animation-frame batch, while targeted subscriptions let
directory and operation views redraw only when their selected slice changes.
Workspace state is a normalized, directory-free projection; directory sessions and transient
cursor, selection, dialog and drag state live in separate slices. All browser, Tauri and mock
workspace mutations use the same semantic `FileManagerClient` command surface, with stale revisions
reloaded and only safely idempotent commands retried.
The Rust event bus assigns monotonic event IDs, filters each subscription by session and workspace,
retains bounded replay history for reconnects, and reports explicit gaps when a client must
resynchronise.
Browser mode exposes that bus as one multiplexed `GET /api/v1/events` SSE connection. Named events
carry the shared typed envelope and numeric replay ID, while observable named keep-alive events let
the frontend detect stale connections. Reconnects resume through `Last-Event-ID` or the browser-safe
`lastEventId` query parameter; expired IDs produce a `resynchronise` event that refetches affected
pane snapshots. Desktop mode forwards the same serialized envelope bytes over one ordered Tauri
channel; channel setup is `connecting`, an installed channel remains `open` until explicit shutdown,
and Tauri does not expose SSE-style `reconnecting`. Directory deltas and operation progress share
the frontend's animation-frame batching policy with SSE. One-off notifications remain on the same
channel to preserve total event ordering and byte parity. Closing a window or disconnecting the
client cancels its Rust subscription task. Connection state is shown textually in the application
header. The Vite `/api` development proxy forwards the stream without compression or buffering.
Until task 0064 introduces production
sessions, REST and SSE share one explicit loopback-only development session; this is not a
production authentication mechanism.

Filesystem access is isolated behind the `fm-vfs` provider contract. Providers advertise explicit
capabilities, expose cancellable asynchronous operations and streaming reads/writes, and are
resolved from provider-neutral locations through a typed registry.

Mutating filesystem work is represented by typed jobs in `fm-operations`. Its bounded scheduler
runs a planning phase before execution, publishes lifecycle and coalesced progress events through
the shared event bus, calculates a smoothed transfer rate, and cooperatively cancels at safe points
with partial-destination cleanup delegated to each operation implementation. Running work can be
paused without losing its planned totals or held scheduler locks, then resumed at the next item or
streaming chunk boundary. Cancellation is surfaced immediately as `Cancelling`, also interrupts
planning and conflict waits, and finishes as `Cancelled` with an explicit partial-progress summary.
Queued jobs expose their FIFO position in the operation centre. Terminal snapshots are retained in
an atomic JSON history beside settings (up to 100 entries and 30 days); an operation found in
flight after restart is retained as `interrupted` with its last known progress and is never resumed.
Shared preflight
checks reject same/nested destinations, case-only renames on insensitive filesystems, traversal
cycles, and file/directory replacement mismatches. Create-directory jobs now execute through the
provider, validate cross-platform-safe names, and create intermediate directories only when the
semantic request explicitly opts in. F7 opens the Materialized new-folder dialog; completion is
reflected through a directory delta that selects and scrolls the new entry into view. Remaining
mutation kinds land incrementally in tasks 0039–0044. Rename jobs use the provider's metadata
operation without copy/delete fallback, reject occupied destinations, and safely handle case-only
changes on insensitive filesystems. F2 opens an inline table editor with basename selection,
client-side validation, Esc cancellation, and Enter commit; stable entry IDs retain cursor and
selection when the directory delta arrives.
Single-file copy jobs stream through provider readers and writers into a private temporary file,
then publish atomically with collision-safe ask, overwrite, and rename-new behavior. F5 copies one
selected file to the other pane; byte/item totals, cancellation cleanup, timestamps, and supported
permissions are handled by the backend operation engine. The precise metadata contract is recorded
in `docs/architecture/file-copy-metadata.md`.
Ctrl/Cmd+C, Ctrl/Cmd+X and Ctrl/Cmd+V retain an in-application clipboard of provider-neutral
locations across panes and tabs. Paste validates the visible destination before it queues a copy or
move operation; cut rows remain dimmed until that move is accepted. System clipboard integration is
kept behind the platform-adapter capability boundary.
The shared application service now exposes semantic operation start/list/get/cancel/pause/resume
and conflict-resolution methods through matching Axum REST endpoints and Tauri commands. REST
starts accept `Idempotency-Key` so retries return the original job rather than queueing duplicates;
the generated HTTP client and the Tauri and mock adapters expose the same transport-neutral client
surface.

Local paths are represented as validated, percent-encoded `file:` locations rather than raw path
strings. Conversion preserves POSIX, Windows drive, UNC, long-path and Unicode forms; lexical
normalization is constrained to a configured root. See
[`docs/architecture/locations.md`](docs/architecture/locations.md) for the stable URI syntax.

The local provider lists directories in bounded, cancellable pages and fetches detailed metadata
separately. Listings identify dotfiles, Windows hidden attributes, symbolic links and reparse
points without following links; Finder alias detection remains a later macOS enhancement.

The application layer owns authoritative per-pane directory snapshots, including monotonic
revisions and cancellation of superseded requests. Thin Axum and Tauri adapters expose the same
list, refresh, navigation and metadata operations; listing options include server-side hidden-file
filtering, folder grouping and sorting.

Each frontend pane now loads its active tab's real directory through that shared client surface.
Directory navigation, parent traversal, backend-resolved per-tab history, retryable in-pane errors,
and continuation-token paging are coordinated outside the view components. Superseded requests are
aborted and responses are correlated by request ID before they may replace the visible snapshot.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

- **rust** (matrix: ubuntu-latest, macos-latest, windows-latest): `cargo fmt --all --check`,
  `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`. Cargo
  registry/target caching via `Swatinem/rust-cache`.
- **frontend** (ubuntu-latest): Biome format check, `tsc --noEmit`, Vitest, production build.
  pnpm store caching via `actions/setup-node`'s built-in pnpm cache.
- **audit** (ubuntu-latest, advisory-only — never blocks the workflow): `cargo audit` and
  `pnpm audit`, reporting findings without failing the run.

Pull-request builds never perform code signing or notarization; that is reserved for protected
release workflows (tracked separately).

## Desktop releases

Desktop product identity has one source: `[package.metadata.desktop]` in
`apps/fm-desktop/src-tauri/Cargo.toml`. The desktop crate inherits its version from
`[workspace.package]` in the root `Cargo.toml`; `pnpm build:tauri` resolves both through
`cargo metadata` and supplies them to Tauri. On macOS it produces a `.app` and `.dmg`; on Windows
it produces `.msi` and NSIS `-setup.exe` installers; on Linux it produces `.deb` and `.AppImage`
packages. Do not duplicate the version or product identity in `tauri.conf.json`. The base config
contains only a schema-required bootstrap copy of the identifier; the packaging contract test
requires it to match the Cargo-owned value.

To prepare a release:

1. Update `[workspace.package].version` in `Cargo.toml` and refresh `Cargo.lock` with
   `cargo check -p fm-desktop`.
2. Add the user-facing release notes to the GitHub release/tag description or the commits that
   GitHub's generated release notes will collect. Note platform limitations and manual checks.
3. Run `pnpm lint`, `pnpm test`, and `pnpm build:tauri` on a supported desktop host.
4. Commit the version change, then push an annotated `v<version>` tag (for example `v0.2.0`). The
   workflow rejects tags that do not exactly match the Cargo version.

The tag-only `.github/workflows/release-desktop.yml` workflow uses the protected
`desktop-release` GitHub environment. No Apple or Windows signing certificates are required: the
macOS and Windows artefacts are deliberately published unsigned, and the macOS build is not
notarized. Configure only:

- the `HOMEBREW_TAP_REPOSITORY` environment variable as the `owner/homebrew-tap` repository that
  will hold the cask, and `HOMEBREW_TAP_TOKEN` as a fine-grained token allowed to write to it;
- `CHOCOLATEY_API_KEY` as the API key for the `procyon` package on the Chocolatey Community
  Repository.

Pull-request CI does not reference those secrets. The workflow publishes generated release notes,
unsigned macOS and Windows installers, and Linux packages. It then calculates checksums from those
exact release assets, updates `Casks/procyon.rb` in the configured Homebrew tap, and generates and
pushes the Chocolatey package. The unsigned macOS release is a universal binary for Apple Silicon
and Intel Macs. Installing it through Homebrew does not bypass Gatekeeper: users must explicitly
approve the app in macOS Privacy & Security or remove the quarantine attribute only if they trust
the downloaded release. Windows users should expect a Microsoft Defender SmartScreen warning and
must choose to run the installer only after verifying that it came from the official release.

After the first packages have been published, users can install Procyon with:

```sh
brew tap erikvullings/tap
brew install --cask procyon
```

or, from an elevated Windows terminal:

```powershell
choco install procyon
```

New Chocolatey package versions may remain unavailable until Community Repository moderation has
completed.

CI performs an unsigned packaging smoke test on disposable macOS and Windows runners: it copies or
installs an artefact, launches the packaged executable, verifies that it remains running, and then
cleans up. Before promoting a release, also perform this manual smoke on each supported platform:

- macOS: download the `.dmg` on a different Mac, mount it, drag Procyon to Applications, confirm the
  expected Gatekeeper warning for the unsigned macOS app, explicitly approve it in Privacy &
  Security, browse a directory, and quit normally.
- Windows: download both installers on a clean Windows VM, confirm the expected SmartScreen warning
  for the unsigned publisher, install one format only after verifying its source, launch Procyon,
  browse a directory, quit, uninstall, and repeat with the other installer format.
- Linux: install the `.deb` on Ubuntu 22.04 or run the `.AppImage` after marking it executable;
  launch Procyon, browse a directory, quit, and remove the installed package or downloaded image.

Auto-update is not included in the first-release packaging design; releases are downloaded and
installed manually.
