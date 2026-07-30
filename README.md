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

Backend-to-frontend updates use one typed event contract for both browser SSE and Tauri channels.
The frontend event-stream abstraction exposes connection status and listener registration while
ignoring unknown future event types for forward compatibility.

Filesystem access is isolated behind the `fm-vfs` provider contract. Providers advertise explicit
capabilities, expose cancellable asynchronous operations and streaming reads/writes, and are
resolved from provider-neutral locations through a typed registry.

Local paths are represented as validated, percent-encoded `file:` locations rather than raw path
strings. Conversion preserves POSIX, Windows drive, UNC, long-path and Unicode forms; lexical
normalization is constrained to a configured root. See
[`docs/architecture/locations.md`](docs/architecture/locations.md) for the stable URI syntax.

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
