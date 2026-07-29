# 0047 Operation queue and history

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0046

## Context
`file-manager-coding-agent-spec.md` §33 step 7 item 10, §16 milestone 2 (queue, completed and failed
states, refresh affected directories) and §27 ("restoring operation history").

## Acceptance Criteria
- Operations queue when concurrency is saturated and start in FIFO order; the queue position is
  visible in the operation centre.
- Completed, cancelled and failed operations move to a bounded history with their result summary and
  per-entry warnings.
- History survives a backend restart where feasible (§37 "crash-safe persisted operation history"),
  stored alongside settings with the same atomic-write discipline.
- On restart, interrupted operations are shown as interrupted with what is known about their partial
  effect — never silently resumed and never reported as completed.
- Each finished operation triggers a refresh/delta for every affected directory currently open
  (§16 milestone 2).
- `GET /api/v1/operations` returns active and historical operations with paging.
- Integration test: restart the service with a persisted history and assert it restores correctly.

## Implementation Notes
- Bound the history (count and age) and document the policy.
- Do not persist file contents or full paths beyond what the history needs; respect the logging
  restrictions in §30.

## Agent Notes
- Not started.
