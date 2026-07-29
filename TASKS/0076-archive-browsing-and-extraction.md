# 0076 Archive provider: browsing, extraction and creation

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0047

## Context
`file-manager-coding-agent-spec.md` §16 milestone 5, §6 (archive provider is the first designed-for
future provider) and §37 (archive browsing for common formats in version 1).

## Acceptance Criteria
- `fm-archive` implements a `FileSystemProvider` for the `archive://` scheme so archives are
  navigable as directories (`archive:///path/to/example.zip!/docs`) using the existing panes and
  table with no UI special-casing (§5.1, §6).
- Read support for at least zip and tar (with gzip/bzip2/xz) — declared capabilities reflect exactly
  what is supported per format.
- Extraction runs as a normal engine operation with progress, cancellation and conflict handling.
- Archive creation from a selection, with format and compression-level options.
- Security: entry paths are validated so extraction cannot escape the destination
  ("zip slip"), symlink entries are not followed, and absolute paths in archives are rejected —
  covered by explicit tests.
- Resource limits guard against decompression bombs (uncompressed-size and ratio caps) with a clear
  error.
- Encrypted archives are detected and reported as unsupported rather than failing obscurely.
- Integration tests: browse, extract, create, zip-slip attempt, bomb guard, Unicode entry names,
  corrupt archive.

## Implementation Notes
- Reading must be lazy: browsing an archive should not extract it to a temp directory wholesale.
- This is the second real provider — expect it to expose any local-filesystem assumptions leaked
  into the engine, and record them in the notes.

## Agent Notes
- Not started.
