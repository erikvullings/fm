# 0077 Checksums and duplicate-file detection

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0047

## Context
`file-manager-coding-agent-spec.md` §16 milestone 5, §18 (`core.calculateChecksum`) and §37
(checksum calculation in version 1).

## Acceptance Criteria
- Checksum calculation for the selection (at least SHA-256 and BLAKE3, plus CRC32/MD5 for
  compatibility) as a cancellable engine job with progress.
- Results can be copied, saved to a checksum file, and verified against an existing checksum file,
  reporting per-entry match/mismatch/missing.
- `CHECKSUM` provider capability gates availability (§6).
- Duplicate detection across one or more roots using a staged strategy: group by size, then compare
  a partial hash, then a full hash — never hashing everything up front.
- Duplicate results are presented as a reviewable list with grouping; any deletion of duplicates goes
  through the normal delete operation with confirmation (§35).
- Hashing streams files and does not load them into memory; throughput is benchmarked (0065).
- Integration tests: known-vector checksums, verification of a checksum file, duplicate grouping on
  a fixture tree (including same-size-different-content and hardlinked files), cancellation.

## Implementation Notes
- Hardlinks and identical inodes should be reported distinctly from true duplicates.
- Checksum results feed the content-comparison mode of 0075 — share the implementation.

## Agent Notes
- Not started.
