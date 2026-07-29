# 0075 Directory comparison and synchronization

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0047

## Context
`file-manager-coding-agent-spec.md` §16 milestone 5 and §37 (directory comparison and basic
synchronization are part of polished version 1). Total Commander parity feature.

## Acceptance Criteria
- Compare the two panes' directories, producing a per-entry status: only-left, only-right, newer,
  older, different size, identical, and type-mismatch.
- Comparison criteria are selectable: name only, size + timestamp, and content hash (the hash mode
  reuses 0077).
- Comparison of large trees is a cancellable job with progress, run in the engine — not in the UI.
- The result is presented in the panes with clear, non-colour-only status indicators (§29) and can
  be filtered to differences only.
- Synchronization proposes a concrete plan (copy left→right, right→left, delete, skip) that the user
  reviews and edits before anything runs; nothing is applied without confirmation (§35).
- Applying a plan runs through the operation engine with the normal conflict, progress and
  cancellation semantics.
- Integration tests: comparison correctness on a fixture pair, sync plan generation, cancellation,
  and a dry-run assertion that no files change until applied.

## Implementation Notes
- Recursive comparison must reuse the cycle-protected traversal from 0018/0040.
- Keep the comparison result a value object so a future "compare against a remote provider" needs no
  redesign (§6).

## Agent Notes
- Not started.
