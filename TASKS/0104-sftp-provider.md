# 0004 SFTP provider

Status: open
Priority: high
Subsystem: backend
Depends on: 0003

## Context
Add SSH-based file management via SFTP as a new `FileSystemProvider`. The product may call this SSH/SFTP, but legacy SCP is not the primary implementation.

## Acceptance Criteria
- SSH connections support host, port, username, and initial auth methods.
- SSH host keys are verified, first use is confirmable/persisted, and changed keys are never silently accepted.
- SFTP locations open in either pane.
- Listing, metadata, mkdir, rename, upload, download, supported moves, and delete work.
- `local → SFTP`, `SFTP → local`, and same-connection SFTP transfers use the shared operation engine.
- Cancellation and partial-file cleanup work.
- Provider capability reporting is accurate.
- No credentials are embedded in `Location` URIs.
- Integration tests use an isolated SSH/SFTP fixture.

## Implementation Notes
- Suggested crates: `fm-ssh`, `fm-vfs-sftp`.
- Evaluate current async Rust SSH/SFTP libraries such as `russh`/`russh-sftp`.
- Prefer locations referencing `ConnectionId`.
- Start with password/private-key auth; agent/jump-host/resume can follow.
- Keep recursive copy semantics in the operation engine.

## Agent Notes
- Validate current VFS stream interfaces before coding so remote reads/writes plug into existing transfer planning.
