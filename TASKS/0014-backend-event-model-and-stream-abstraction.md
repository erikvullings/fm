# 0014 Typed backend event model and event-stream abstraction

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0011

## Context
`file-manager-coding-agent-spec.md` §10 and §33 step 3. Both transports must deliver the same typed
events, so the event model and the `EventStream` abstraction are defined before either SSE (0032) or
Tauri channels (0034) exist.

## Acceptance Criteria
- `frontend/src/api/events/event-stream.ts` defines an `EventStream` interface with
  `connect()`, `close()`, a status observable (`connecting | open | reconnecting | closed`) and a
  listener registry.
- `BackendEvent` is a discriminated union over the named events from §10:
  `runtime.ready`, `workspace.updated`, `directory.snapshot`, `directory.delta`,
  `operation.created`, `operation.progress`, `operation.stateChanged`, `operation.conflict`,
  `operation.completed`, `operation.failed`, `plugin.changed`, `notification.created`.
- Events are wrapped in the `EventEnvelope { eventId, timestamp, workspaceId?, payload }` shape.
- The Rust counterpart (`fm-events` envelope + payload enum) serializes to exactly this JSON; a
  cross-checked test fixture (Rust-generated JSON consumed by a Vitest test) proves parity.
- Unknown/future event types are ignored without throwing, and are logged once in development.
- Vitest tests cover envelope parsing, unknown-event tolerance and listener dispatch.

## Implementation Notes
- Event payload types should be generated or derived from the OpenAPI schemas where possible so they
  stay in sync; if `utoipa` cannot express the union cleanly, document the manual mapping.
- Do not use events for request/response semantics (§10).

## Agent Notes
- Not started.
