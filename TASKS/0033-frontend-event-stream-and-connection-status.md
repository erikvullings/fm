# 0033 Frontend SSE stream, reconnection and connection status

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0032, 0021

## Context
`file-manager-coding-agent-spec.md` §10 ("the frontend must ...") and §33 step 6.

## Acceptance Criteria
- `frontend/src/api/events/sse-event-stream.ts` implements `EventStream` over `EventSource`,
  maintaining exactly one connection for the app.
- Reconnects with exponential backoff and jitter, capped, resuming from the last received event id.
- Detects stale connections (no keep-alive within a timeout) and forces a reconnect.
- Connection status (`connecting | open | reconnecting | closed`) is exposed in `AppState.connection`
  and shown in a compact indicator in the UI, with text or icon rather than colour alone (§29).
- High-frequency events (`operation.progress`, `directory.delta`) are batched before redraw (§10,
  §13).
- Events from superseded workspace/snapshot revisions are ignored (§10).
- The connection closes on shutdown/logout and does not leak listeners across HMR reloads.
- On resynchronise/gap, affected panes refetch their snapshot rather than applying stale deltas.
- Vitest tests with a fake `EventSource` cover: backoff schedule, stale detection, batching, gap
  handling, revision filtering.

## Implementation Notes
- `HttpFileManagerClient.subscribe()` (0012) delegates here; the Tauri stream (0034) implements the
  same interface so features are transport-agnostic.
- Keep the reconnect policy in a pure, testable function.

## Agent Notes
- Not started.
