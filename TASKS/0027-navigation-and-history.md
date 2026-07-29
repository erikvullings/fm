# 0027 Directory navigation, parent navigation and history

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0026, 0019

## Context
`file-manager-coding-agent-spec.md` §33 step 5, §36 item 3, and §5.3 (`NavigationHistory` lives in
tab state). This is the first task where the real backend replaces the mock end to end.

## Acceptance Criteria
- Each pane lists a real local directory through `FileManagerClient.listDirectory` / `navigatePane`.
- `Enter` opens the entry under the cursor (directory → navigate, file → open is task 0061).
- `Backspace` navigates to the parent; at the filesystem root it is a no-op, not an error.
- Back/forward history per tab, with keyboard and mouse-button support where available.
- Rapid navigation cancels the superseded request via `AbortSignal`; a late response never
  overwrites a newer view (§5.4) — covered by a test that resolves responses out of order.
- Loading state appears within one frame; the first page renders without waiting for all metadata
  (§28).
- Error states (permission denied, not found, disconnected) render in-pane with a retry affordance
  and a user-readable message from the error DTO.
- Paging: scrolling to the end of a partially loaded directory requests the next page via
  `continuation_token`.
- Vitest tests with the mock client cover: navigate, parent, history back/forward, out-of-order
  responses, error rendering.

## Implementation Notes
- Navigation logic belongs in `features/navigation/`, not in the table or pane components (§35).
- Keep pane → backend request correlation by `requestId` so stale snapshots can be dropped.

## Agent Notes
- Not started.
