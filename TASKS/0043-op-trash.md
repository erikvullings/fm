# 0043 Operation: move to Trash / Recycle Bin

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0041

## Context
`file-manager-coding-agent-spec.md` §16 milestone 2, §23 (macOS Trash, Windows Recycle Bin) and §21
(`systemTrash` capability).

## Acceptance Criteria
- `OperationKind::Trash` moves entries to the platform trash on macOS and Windows.
- The `TRASH` provider capability and the `systemTrash` runtime capability report the truth for the
  current platform and location; where trash is unavailable (e.g. some network volumes, server
  mode), the UI offers permanent delete with explicit confirmation instead of silently falling back.
- Trashing is never used as a silent substitute for delete and vice versa (§35).
- Progress and cancellation behave like other operations.
- Integration tests run only against temporary test roots and clean up any trashed items they create
  (§27); on platforms where that cannot be done safely, the test is skipped with an explicit report
  rather than silently passing (§35).
- `F8`/`Delete` maps to trash when available, `Shift+Delete` to permanent delete (0044).

## Implementation Notes
- Use a maintained crate (e.g. `trash`) behind the `fm-platform` adapter trait (0058) rather than
  calling platform APIs from the operation directly.
- Server/browser mode should default to a configurable trash directory inside the allowed roots
  rather than the OS trash (§22).

## Agent Notes
- Not started.
