# 0003 Root development scripts, formatting and linting

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: tooling
Depends on: 0001, 0002

## Context
`file-manager-coding-agent-spec.md` §32 lists the root-level commands the project must provide,
and §2.3 lists the API pipeline scripts. Shared linting/formatting is part of §33 step 1.

## Acceptance Criteria
- Root `package.json` provides the scripts from §32: `dev`, `dev:mock`, `dev:http`, `dev:tauri`,
  `test`, `test:rust`, `test:frontend`, `lint`, `api:export`, `api:generate`, `api:check`,
  `build`, `build:tauri`.
- Scripts that cannot work yet (e.g. `dev:tauri`, `api:generate`) either fail with a clear
  "not implemented until task NNNN" message or are added by the task that enables them — no silent
  no-ops.
- `scripts/export-openapi.sh` and `scripts/generate-api.sh` exist and are executable.
- Rust: `rustfmt.toml` + `cargo fmt --check` and `cargo clippy -- -D warnings` wired into `lint`.
- Frontend: a formatter and linter configured (prettier + eslint, or biome) with a single
  `pnpm lint` entry point; formatting settings shared across the repo where possible.
- `.editorconfig`, `.gitignore` (target/, node_modules/, dist/, generated openapi artefacts kept in
  git per §2.3) and `.gitattributes` for deterministic line endings on Windows.
- `AGENTS.md` at the repo root summarising the coding-agent rules from §35.

## Implementation Notes
- Root scripts orchestrate pnpm workspaces; the frontend keeps its own scripts.
- Keep generated code clearly separated and never hand-edited (§35).

## Agent Notes
- Not started.
