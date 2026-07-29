# 0054 Plugin runtime with error isolation

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: plugins
Depends on: 0053

## Context
`file-manager-coding-agent-spec.md` §19.4 — a plugin failure must not crash the main application.

## Acceptance Criteria
- `fm-plugin-runtime` loads and executes plugins through the `fm-plugin-api` contract using a
  restricted Lua runtime (per ADR 6), with the Wasmtime path documented as the migration target.
- The runtime sandbox denies filesystem, process and network access except through permitted host
  calls; the Lua standard library is trimmed accordingly.
- Every plugin call has an execution timeout and a memory/instruction budget; exceeding it aborts
  that call only.
- Plugin errors are caught, logged with `plugin_id` (§30), and shown as a non-blocking
  notification — never a crash and never a blocked UI.
- A plugin that fails repeatedly is auto-disabled with a clear reason, and can be re-enabled
  manually.
- Per-plugin logs are retained (bounded) and retrievable for the diagnostics view (§19.4, §30).
- Plugin-contributed actions appear in the registry, palette and context menus automatically.
- Tests: a deliberately panicking plugin, an infinite-loop plugin (timeout), a permission-violating
  plugin, and a plugin that returns malformed data — all isolated, all reported.

## Implementation Notes
- Run plugin calls off the request path where possible so a slow plugin cannot stall navigation or
  the operation engine.
- Column contributions must degrade to an empty cell, never block row rendering (0056).

## Agent Notes
- Not started.
