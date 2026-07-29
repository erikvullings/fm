# 0012 HTTP FileManagerClient adapter

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0011

## Context
`file-manager-coding-agent-spec.md` §12 and §33 step 3. Wraps the Orval-generated client behind the
transport-neutral interface.

## Acceptance Criteria
- `frontend/src/api/client/http-file-manager-client.ts` implements `FileManagerClient` using only
  the generated client plus the fetch mutator.
- All calls forward `AbortSignal`; superseded requests are aborted by the caller, not swallowed.
- Errors surface as the shared typed `ApiError`; raw `Response` objects never escape the adapter.
- `subscribe()` delegates to the SSE event stream (implemented in 0033); until then it returns a
  no-op unsubscribe and is covered by a TODO referencing 0033.
- Vitest tests with a stubbed generated client cover: happy path mapping, error mapping,
  cancellation propagation.

## Implementation Notes
- Base URL comes from the mutator (dev uses the Vite `/api` proxy).
- Keep DTO → model mapping in one place so the Tauri and mock adapters can reuse it.

## Agent Notes
- Not started.
