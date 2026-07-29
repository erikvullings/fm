# 0016 VFS provider trait, capabilities and errors

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0006

## Context
`file-manager-coding-agent-spec.md` §6 defines the provider abstraction that keeps the engine
independent of the local filesystem, so archives, SFTP, S3 and search results can be added later
without redesigning the core.

## Acceptance Criteria
- `fm-vfs` defines `FileSystemProvider` (async trait) with the methods from §6: `id`,
  `capabilities`, `list`, `metadata`, `create_directory`, `rename`, `remove`, `open_read`,
  `open_write`, `watch`.
- `ProviderCapabilities` bitflags exactly as listed in §6.
- Supporting types: `EntryRef`, `ListOptions`, `DirectoryPage`, `RemoveOptions`, `WriteOptions`,
  `ProviderReadStream`, `ProviderWriteStream`, `ProviderChangeStream`.
- `VfsError` is a `thiserror` enum with variants covering not-found, permission-denied,
  already-exists, not-a-directory, is-a-directory, unsupported-capability, cancelled, io,
  invalid-location — each mapping to a stable machine-readable code (§8).
- Every long-running method accepts a `CancellationToken` (§35).
- A `ProviderRegistry` resolves a `Location` to its provider and returns a typed error for unknown
  provider ids.
- Unit tests: capability checks reject unsupported operations before any I/O; registry resolution.
- `fm-vfs` does not depend on Axum, Tauri or `fm-application`.

## Implementation Notes
- Design for archive/SFTP/WebDAV/S3/SMB/search/trash/recent providers but implement none of them
  (§6 "future providers", §35 no speculative abstractions beyond planned features).
- Read/write streams should be `AsyncRead`/`AsyncWrite` based so copies can stream without buffering
  whole files.

## Agent Notes
- Not started.
