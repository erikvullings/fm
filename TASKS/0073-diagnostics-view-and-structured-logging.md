# 0073 Diagnostics view and structured logging

Status: in-progress
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

### Phase 1-4 Complete (✅)
- Redaction helper implemented with 11 comprehensive tests (redaction.rs)
  - Handles Bearer tokens, API keys, session tokens, passwords, HMAC, absolute paths
  - Idempotent and real-world tested
- Diagnostics DTO and HTTP endpoint (GET /api/v1/diagnostics) complete
  - Returns version info, platform, runtime capabilities, plugin list, connection state, errors
  - Integrated into router, camelCase wire format verified, 4 DTO tests passing
- Frontend model layer (diagnostics.ts) with type-safe DTO conversion
- Mithril UI component (diagnostics-view.ts) with 8 sections:
  1. Version Information (frontend/backend/tauri/platform)
  2. Runtime Capabilities (boolean flags)
  3. Connection State (status indicator, uptime, events count)
  4. Loaded Plugins (plugin list with enable/error status)
  5. Operation Queue (queue metrics)
  6. Recent Errors (redacted entries)
  - Includes copy-to-clipboard for bug reports with fallback
  - Responsive CSS styling (diagnostics-view.css)
  - 4 frontend tests passing
- Documentation (docs/architecture/logging.md) complete with configuration guide, redaction policy, endpoint reference, error buffering, and future enhancements

### Acceptance Criteria Status
- ✅ Redaction helper tests assertion for §30
- ✅ Logging policy documented (file contents, secrets, paths redacted)
- ⏳ Log level/output config via env (env var documented, not yet integrated into code)
- ✅ Diagnostics view shows all 8+ data points (versions, platform, capabilities, SSE state, plugins, errors, queue)
- ✅ "Copy diagnostics" action produces redacted text
- ✅ View structure created for both modes (Tauri version field placeholder, HTTP working)
- ✅ Tests: redaction (11), diagnostics DTO (4), diagnostics component (4)

### Acceptance Criteria NOT YET COMPLETE
- ❌ Structured tracing spans: request_id done (TraceLayer), but operation_id/workspace_id/plugin_id/provider_id NOT YET in handlers
- ❌ Log level configuration NOT YET integrated (env var documented but not wired)
- ❌ Rolling file log NOT YET implemented (console output only)
- ❌ SSE/channel state tracking NOT YET real (hardcoded connected:true)
- ❌ Recent errors buffer NOT YET persistent (endpoint returns empty vec)
- ❌ Operation queue status NOT YET from scheduler (endpoint returns zeros)
- ❌ Frontend integration NOT YET into main navigation (component created but unwired)
- ❌ Desktop mode NOT YET tested (Tauri hooks not implemented)

### Next Tasks (Priority Order)
1. Implement structured tracing spans (request_id already done, add operation/workspace/plugin/provider IDs)
2. Track actual SSE connection state in AppState
3. Implement bounded error buffer and wire to endpoint
4. Query operation queue status from scheduler
5. Integrate DiagnosticsViewComponent into app navigation
6. Test in both HTTP and Tauri modes

**Commit**: 74b7e4d "Task 0073 Phase 3-4: Frontend diagnostics view and documentation"
