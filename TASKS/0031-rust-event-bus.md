# 0031 Rust event bus

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0014, 0008

## Context
`file-manager-coding-agent-spec.md` §10 and §33 step 6. One event model feeds both SSE and Tauri
channels, so the bus lives in `fm-events` and knows nothing about either transport.

## Acceptance Criteria
- `fm-events` provides an `EventBus` with publish and per-session subscribe, backed by a bounded
  broadcast channel.
- `EventEnvelope<T> { event_id, timestamp, workspace_id, payload }` per §10, with a monotonic
  `event_id` allocated by the bus.
- A `BackendEventPayload` enum covering the named events in §10, serializing to the exact JSON the
  frontend union expects (0014) — verified by a shared fixture test.
- Events are filtered per session/workspace before delivery (§10).
- A bounded replay buffer supports `Last-Event-ID` reconnection; when a subscriber falls too far
  behind, it receives an explicit "gap" signal so the frontend can resynchronise rather than showing
  stale state.
- Slow subscribers cannot block publishers or grow memory without bound.
- Unit tests: ordering, per-session filtering, replay from an event id, lagging-subscriber gap
  signalling.

## Implementation Notes
- `tokio::sync::broadcast` with a documented capacity; the gap signal maps to `RecvError::Lagged`.
- Progress-style events should be coalescable — a `should_coalesce` hint on the payload keeps the
  throttling policy in one place (§28).

## Agent Notes
- Not started.
