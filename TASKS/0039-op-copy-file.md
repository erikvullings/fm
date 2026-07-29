# 0039 Operation: copy a single file

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0038

## Context
`file-manager-coding-agent-spec.md` §33 step 7 item 3 and §17 safety requirements. Single-file copy
establishes the streaming, temp-name and metadata-preservation pattern that directory copy reuses.

## Acceptance Criteria
- `OperationKind::Copy` for one file, streaming through the provider's read/write streams without
  loading the file into memory.
- Copies to a temporary destination name, then performs a final atomic rename (§17).
- On cancellation or failure, the temporary file is removed — no partial destination files remain
  (integration test asserts this).
- Byte and item progress reported and throttled (§28).
- Handles: source disappearing mid-copy, destination appearing after planning, disk full,
  permission denied, locked files (Windows), zero-byte files, and very large files.
- Timestamps preserved; permissions preserved where the platform supports it. `docs/architecture/`
  documents exactly which metadata is preserved and which is not (§17).
- Conflict detection reports a conflict rather than overwriting; policy handling arrives in 0045, so
  for now anything other than an explicit `overwrite`/`renameNew` fails safely.
- `F5` copies the selection to the other pane (single file for now).
- Integration tests cover every bullet above using temp directories only.

## Implementation Notes
- Use a copy-on-write / server-side clone fast path where the platform offers one
  (`clonefile` on APFS, `FSCTL_DUPLICATE_EXTENTS` on ReFS), falling back to streaming; keep it
  behind the `SERVER_SIDE_COPY` capability flag (§6).
- Sparse-file preservation is best-effort; document the behaviour rather than claiming support.

## Agent Notes
- Not started.
