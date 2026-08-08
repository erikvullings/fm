# 0008 Cross-provider transfer planning

Status: open
Priority: high
Subsystem: backend
Depends on: 0004, 0006

## Context
Harden the operation engine for provider-specific fast paths and remote-to-remote streaming after SFTP and FTP exist.

## Acceptance Criteria
- Providers expose transfer capabilities such as server-side copy/move, resumable upload/download, and random read/write.
- Operation planning chooses safe provider-native operations when available.
- Otherwise it streams source → destination directly.
- `SFTP → FTP` and `FTP → SFTP` require no temporary local file.
- Progress remains provider-neutral.
- Cancellation reaches source and destination.
- Partial destination cleanup and conflict handling remain correct.
- Integration tests cover all supported local/SFTP/FTP direction pairs.

## Implementation Notes
- Add `TransferCapabilities` or equivalent.
- Keep strategy selection in the operation planner, not UI or individual commands.
- Test same-connection optimization separately from cross-provider streaming.

## Agent Notes
- Review the existing copy planner before changing provider interfaces; preserve local semantics.
