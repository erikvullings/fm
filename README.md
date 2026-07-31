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
