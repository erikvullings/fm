# 0011 FileManagerClient interface and runtime selection

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0010

## Context
`file-manager-coding-agent-spec.md` §12 and §33 step 3. The frontend must be transport-neutral:
components depend only on `FileManagerClient`, never on `fetch`, `EventSource` or Tauri APIs
(§3 rule 1, §35).

## Acceptance Criteria
- `frontend/src/api/client/file-manager-client.ts` declares the interface from §12, with every
  method accepting an optional `AbortSignal` and `subscribe(listener)` returning `Promise<Unsubscribe>`.
- Methods not implemented in the current milestone are declared but may throw a typed
  `NotImplementedError` in the adapters that do not support them yet.
- `frontend/src/api/client/create-client.ts` selects the implementation from
  `VITE_RUNTIME` (`http` | `tauri` | `mock`) with an `assertNever` default (§12).
- Client selection happens in exactly one bootstrap location; a lint rule or test asserts no other
  module imports the concrete adapters.
- Frontend-facing model types live in `frontend/src/models/` and are re-exported from the generated
  DTOs where they match, so features never import `api/generated/` directly.
- Vitest test asserts `createFileManagerClient` returns the right adapter per runtime value and
  throws on an unknown value.

## Implementation Notes
- Do not scatter Tauri runtime checks through UI components (§12).
- Keep the interface aligned with the backend's semantic operations, not HTTP concepts (§7).

## Agent Notes
- Not started.
