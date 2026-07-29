# 0017 Location parsing and path normalization

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0016

## Context
`file-manager-coding-agent-spec.md` §5.1 and §33 step 4. Locations are provider-neutral URIs, not
`PathBuf`s. Correct parsing is security-critical (§22: never accept arbitrary paths without
validation) and is exercised by every later feature.

## Acceptance Criteria
- Bidirectional conversion between `Location` and a native path for the `local` provider, covering:
  - POSIX (`file:///Users/erik/Documents`),
  - Windows drive paths (`file:///C:/Users/Erik/Documents`),
  - Windows UNC paths (`file://server/share/dir`),
  - percent-encoding of spaces and shell-sensitive characters,
  - Unicode names (including non-NFC forms on macOS),
  - very long paths (Windows `\\?\` prefixing where needed).
- Normalization resolves `.`/`..` lexically without touching the filesystem and rejects escapes
  above a configured root.
- `parent()`, `join(name)` and `name()` helpers that never use unsafe string concatenation (§5.1).
- Round-trip property tests (`proptest` or table-driven) prove `path → Location → path` is lossless
  for the cases above.
- Rejects with a typed error: null bytes, empty segments, mismatched provider scheme, and reserved
  Windows device names (`CON`, `NUL`, `COM1`, ...).
- Tests run on macOS, Windows and Linux in CI; platform-specific cases are `cfg`-gated, not skipped
  silently.

## Implementation Notes
- Keep the URI syntax stable enough for bookmarks and history (§5.1); document it in
  `docs/architecture/locations.md`.
- Reserve the `archive://`, `search://` and `sftp://` schemes in the parser's provider dispatch, but
  return "unsupported provider" for them.

## Agent Notes
- Not started.
