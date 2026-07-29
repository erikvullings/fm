# 0032 SSE endpoint

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0031

## Context
`file-manager-coding-agent-spec.md` §10 and §33 step 6. Browser mode delivers backend events over a
single multiplexed Server-Sent Events stream.

## Acceptance Criteria
- `GET /api/v1/events` streams SSE with named events matching §10 (`directory.snapshot`,
  `operation.progress`, ...) and stable numeric `id:` values.
- One stream per session multiplexes all events; there is never one connection per operation (§10).
- Keep-alive comments are sent on an interval so proxies do not drop idle connections.
- `Last-Event-ID` on reconnect replays from the bus buffer; if the requested id is no longer
  available, the server sends a resynchronise event instead of silently skipping.
- The endpoint requires the same authenticated session as REST (§10, §22) and rejects
  cross-origin requests per the CORS policy.
- The stream closes cleanly on session end and on client disconnect, releasing the subscription
  (no task leak — asserted by a test).
- Works through the Vite dev proxy without buffering (§32) — verified manually and noted in README.
- Integration test connects, receives `runtime.ready`, triggers a directory change, and asserts the
  `directory.delta` event arrives.

## Implementation Notes
- `axum::response::Sse` with `KeepAlive`; serialize payloads with the same DTO types as REST.
- Do not use SSE for request/response semantics (§10); conflict resolution is event-in,
  REST-decision-out (§10, task 0045).

## Agent Notes
- Not started.
