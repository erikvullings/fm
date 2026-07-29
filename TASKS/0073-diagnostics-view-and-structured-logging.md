# 0073 Diagnostics view and structured logging

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0036, 0054

## Context
`file-manager-coding-agent-spec.md` §30 — structured tracing plus a diagnostics view.

## Acceptance Criteria
- Structured tracing spans/fields include: request id, operation id, workspace id, plugin id,
  provider id, duration and result status (§30).
- Logging never includes file contents, authentication secrets or session tokens, and does not log
  full paths by default in telemetry-style output (§30) — a test asserts the redaction helper.
- Log level and output format configurable via env/config; a rolling file log is available in
  desktop mode.
- A diagnostics view in the app shows: frontend version, backend version, Tauri version where
  relevant, platform, runtime capabilities, SSE/channel state, loaded plugins, recent non-sensitive
  errors and operation queue status (§30).
- A "copy diagnostics" action produces a redacted text block suitable for a bug report.
- The view works in both browser and desktop modes.
- Tests: redaction helper, diagnostics DTO assembly, capability rendering (§27).

## Implementation Notes
- Reuse the runtime capabilities endpoint rather than duplicating platform detection (§21).
- Keep the recent-errors buffer bounded and in-memory.

## Agent Notes
- Not started.
