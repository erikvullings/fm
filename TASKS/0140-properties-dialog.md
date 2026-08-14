# 0140 File/folder Properties dialog

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: cross-cutting
Depends on: 0129

## Context

Split out of [0129](0129-total-commander-shortcuts-major-features.md) (Alt+Enter row) in the
2026-08-14 re-triage — confirmed still genuinely missing, not just undiscovered. fm currently only
shows inline status-bar metadata (aggregate totals from 0097) and per-row columns (size, modified,
extension); there is no per-entry detail view showing everything the app and provider know about a
single file or folder — permissions, exact byte-precise size, full timestamps, provider-specific
metadata (e.g. SFTP file mode, S3 storage class, archive entry compression ratio). This is a
commonly-expected feature (Finder's Get Info `Cmd+I`, Explorer's Properties, TC's Alt+Enter).

## Acceptance Criteria
- A modal (consistent with the app's existing `ModalPanel` dialog chrome, per the other dialogs)
  showing, at minimum: name, kind, exact size (byte-precise, not the rounded display in the table),
  created/modified/accessed timestamps (whichever the provider actually exposes — not every
  provider has all three), full path/location URI, and permission bits where the provider exposes
  them (local filesystem at least).
- For a multi-selection, shows an aggregate: total size, item count, and a folder/file breakdown —
  reuse 0097's aggregate-computation approach rather than a second implementation.
- Provider-specific metadata section that's additive per provider (local: POSIX permissions/owner
  where available; SFTP: remote file mode; archive: compressed/uncompressed size and compression
  method; S3-like: storage class/ETag if exposed) — design the DTO so providers can contribute
  fields without every provider needing to support every field.
- Timestamps respect the same locale/time-zone-aware formatting already used elsewhere in the app
  (`frontend/src/features/entry-formatting/entry-formatting.ts`'s `formatEntryModifiedAt`) — don't
  introduce a second, divergent date-formatting path.
- Bound to `Alt+Enter` (desktop convention) with a menu/palette entry as well.
- Tests: DTO assembly for each provider type, aggregate computation for multi-selection, dialog
  rendering for a representative entry of each supported provider.

## Implementation Notes
- Check whether 0136 (extended attributes / Finder tags / Spotlight comments, if picked up first)
  wants to surface its data through this same dialog rather than a separate surface — likely yes,
  but not a hard dependency; this task can ship without it and 0136 can extend the dialog later.
- Reuse `EntrySummary`/`DirectorySnapshot`'s existing per-provider metadata fields where already
  present (check `crates/fm-domain/src/entry.rs`) before adding new backend DTO fields — some of
  this may already be threaded through and simply not surfaced in the UI yet.

## Agent Notes
- (none yet)
