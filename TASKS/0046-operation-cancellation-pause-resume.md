# 0046 Operation cancellation, pause and resume

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0045

## Context
`file-manager-coding-agent-spec.md` §33 step 7 item 9, §17 (states include `Paused` and
`Cancelling`) and §36 item 5.

## Acceptance Criteria
- Cancel transitions `Running` → `Cancelling` → `Cancelled`, is acknowledged immediately in the UI,
  and takes effect at the next safe point.
- Cancellation cleans up partial destination files and never leaves a half-written file under the
  final name (§17).
- Pause suspends work without releasing locks or losing progress; resume continues from where it
  stopped, with progress totals intact.
- Cancelling an operation waiting on a conflict resolves cleanly.
- Cancelling during the planning phase stops enumeration promptly, even in a huge tree.
- Cancellation propagates to the provider layer through the `CancellationToken` (§6, §35).
- Integration tests: cancel during planning, cancel mid-file, cancel mid-tree, pause/resume of a
  large copy, cancel while waiting for conflict resolution, and verification that no partial files
  remain.

## Implementation Notes
- Pause is cooperative: check a token between items and at chunk boundaries within a file.
- Report cancelled operations as `Cancelled`, not `Failed`, and make partial results explicit in the
  operation centre.

## Agent Notes
- Not started.
