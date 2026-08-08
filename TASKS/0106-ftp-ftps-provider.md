# 0006 FTP and FTPS provider

Status: open
Priority: medium
Subsystem: backend
Depends on: 0003

## Context
Add FTP/FTPS as another `FileSystemProvider`. SFTP remains separate via 0004. Plain FTP must be clearly marked insecure.

## Acceptance Criteria
- Users can create FTP and FTPS connections.
- Passive transfers work.
- Listing, upload/download, mkdir, rename, supported move, and delete work.
- Explicit FTPS is supported and validates TLS certificates.
- Plain FTP is visibly identified as insecure.
- Provider capability reporting reflects FTP limitations.
- Cross-provider transfer uses the shared operation engine.
- Cancellation/partial cleanup work.
- Integration tests use isolated FTP/FTPS fixtures.

## Implementation Notes
- Suggested crate: `fm-vfs-ftp`.
- Evaluate a maintained Rust FTP/FTPS library such as `suppaftp`.
- Passive mode should be default.
- Do not fake watch/checksum/timestamp/permission/server-copy semantics.

## Agent Notes
- Keep protocol quirks in the provider and error mapper; avoid frontend protocol special cases.
