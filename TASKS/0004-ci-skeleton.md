# 0004 CI skeleton

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: tooling
Depends on: 0003

## Context
`file-manager-coding-agent-spec.md` §31 lists the required CI jobs. Create the skeleton early so
every later task lands green; jobs for features that do not exist yet are added by their own task.

## Acceptance Criteria
- GitHub Actions workflow(s) running on push and pull request with jobs for:
  Rust fmt, Clippy with `-D warnings`, `cargo test --workspace`, frontend format check,
  `tsc --noEmit`, Vitest, frontend production build.
- Cargo registry/target and pnpm store caching configured.
- Dependency audit job (`cargo audit` / `pnpm audit`) that does not block on advisories without a
  fix, but reports them.
- Matrix runs on ubuntu-latest, macos-latest and windows-latest for the Rust jobs.
- No code signing in PR builds (§31); release signing is out of scope until 0063.
- A README badge or short CI section documents what runs.

## Implementation Notes
- `api:check` (0010) and the Tauri macOS/Windows build jobs (0015) are added by those tasks.
- Keep workflow files small and composable; prefer a reusable job over copy-paste.

## Agent Notes
- Not started.
