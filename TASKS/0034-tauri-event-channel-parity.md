# 0034 Tauri channel event delivery and transport parity

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: desktop
Depends on: 0033, 0015

## Context
`file-manager-coding-agent-spec.md` §11 and §3 rule 9: browser and Tauri transports must provide
equivalent application behaviour.

## Acceptance Criteria
- The Tauri host subscribes to the `EventBus` and forwards envelopes over a Tauri channel/event for:
  directory deltas, operation progress, operation conflicts, filesystem changes and plugin
  notifications (§11).
- `tauri-event-stream.ts` implements `EventStream` with the same status model as SSE; since the
  channel cannot "disconnect" the same way, status transitions are documented and the indicator
  behaves sensibly.
- Payload JSON is byte-identical to the SSE payloads — asserted by a shared fixture test run against
  both transports.
- A parity test suite runs the same frontend scenario (navigate → external file change → delta
  applied) against both the HTTP and Tauri adapters, using the mock where a real host is
  unavailable, and reports explicitly which parts were platform-untested (§35).
- No filesystem or application logic in the command handlers (§3 rule 3).
- Channel subscriptions are released on window close; no task leaks.

## Implementation Notes
- Prefer Tauri channels for high-frequency streams and events for one-off notifications; document
  which is used where.
- Batching happens in the frontend (0033) so both transports share one throttling policy.

## Agent Notes
- Not started.
