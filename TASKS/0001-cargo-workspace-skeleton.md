# 0001 Cargo workspace skeleton and crate stubs

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: none

## Context
Bootstrap the Rust side of the monorepo described in `file-manager-coding-agent-spec.md` §4
(repository structure) and §33 step 1. Nothing exists yet except the spec.

Crate dependencies must stay directional and acyclic, per the preferred direction in §4:
domain → events / vfs traits / plugin API → operations / providers / metadata / search →
application services → Axum and Tauri hosts.

## Acceptance Criteria
- Root `Cargo.toml` defines a workspace with resolver 2 and shared `[workspace.dependencies]`
  (tokio, serde, tracing, thiserror, utoipa, uuid, chrono, async-trait, ...).
- The crates from §4 exist under `crates/` as compiling stubs with a `lib.rs` and a doc comment
  stating the crate's responsibility: `fm-domain`, `fm-application`, `fm-events`, `fm-operations`,
  `fm-vfs`, `fm-vfs-local`, `fm-search`, `fm-metadata`, `fm-archive`, `fm-settings`,
  `fm-plugin-api`, `fm-plugin-runtime`, `fm-platform`, `fm-transport-dto`, `fm-test-support`.
- `crates/fm-platform-macos` and `crates/fm-platform-windows` exist and are only built on their
  target platform (target-specific workspace members or cfg-gated deps).
- `apps/fm-server` and `apps/fm-cli` exist as binary stubs.
- `cargo build --workspace` and `cargo clippy --workspace --all-targets -- -D warnings` pass.
- `rust-toolchain.toml` pins a stable toolchain; `rustfmt.toml` and `clippy.toml` are checked in.

## Implementation Notes
- Do not create `apps/fm-desktop` here; that is task 0015.
- Empty crates that are not needed until later milestones (`fm-archive`, `fm-search`) may be
  placeholders, but must not accumulate speculative abstractions (§35).
- `anyhow` only in `apps/*` binaries; libraries use `thiserror` (§2.2).

## Agent Notes
- Not started.
