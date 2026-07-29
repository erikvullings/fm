# 0044 Operation: permanent delete with confirmation

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0043

## Context
`file-manager-coding-agent-spec.md` §16 milestone 2 ("permanent delete only after explicit
confirmation"), §36 item 11 (no silent permanent deletion) and §17 safety requirements.

## Acceptance Criteria
- `OperationKind::Delete` removes files and directory trees recursively, with planning-phase counts
  so the confirmation dialog can state exactly what will be deleted.
- A confirmation dialog is mandatory unless the user has explicitly disabled the confirm-permanent-
  delete setting; the dialog states the item count, total size and the fact that it is irreversible,
  and defaults to cancel.
- Symbolic links are removed, never followed into their target (§35).
- Read-only entries require an explicit override rather than being force-deleted silently.
- Cancellation stops between entries; the result reports exactly what was deleted.
- Partial failures produce `CompletedWithWarnings` with a per-entry error list.
- Destructive integration tests run only inside temporary roots (§27, §35).
- Audit log entry written for every permanent delete (§22, §30) without logging file contents.

## Implementation Notes
- Deleting a large tree must not block the async runtime; iterate on the blocking pool with
  cancellation checks.
- The dialog is a `mithril-materialized` modal with correct focus trapping (§29).

## Agent Notes
- Not started.
