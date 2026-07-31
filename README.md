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
through typed semantic commands, with host-platform modifiers and type-to-select. While a prefix is
active it appears behind a divider at the right of the pane footer, highlights the first matching
in-word occurrence in every matching name, and constrains keyboard cursor movement to those
matches. Backspace edits the prefix, Escape clears it and the selection, and an unmatched prefix
briefly flashes red but remains editable. Non-root directories prepend a synthetic `..` row that
navigates to the parent without entering the selectable file set.
The main window loads its authoritative workspace projection through the shared client and renders
the recursive pane layout with a draggable, minimum-width splitter. Pane clicks and Tab traversal
move visible focus through semantic workspace commands; divider changes are sent as debounced
`UpdateLayout` commands. Compact workspace, operation-centre placeholder, and function-key rows
complete the initial two-pane shell.

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

Filesystem access is isolated behind the `fm-vfs` provider contract. Providers advertise explicit
capabilities, expose cancellable asynchronous operations and streaming reads/writes, and are
resolved from provider-neutral locations through a typed registry.

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
