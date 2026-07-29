# 0068 Recursive filesystem search

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0067, 0032

## Context
`file-manager-coding-agent-spec.md` §24 item 2 and §37 (recursive search is part of version 1).

## Acceptance Criteria
- `fm-search` performs cancellable recursive traversal of one or more roots in Rust, streaming
  results as they are found rather than collecting the whole result set.
- Filename matching first (substring and glob); size/date/type filters and content search are
  designed for but explicitly deferred (§24).
- Results stream to the frontend over the event stream with backpressure/batching so a search
  matching 100,000 files does not flood the UI (§28).
- Traversal is cycle-protected, does not follow symlinks by default, and skips unreadable
  directories with a counted warning instead of aborting.
- A search is cancellable from the UI and cancels promptly mid-traversal.
- Results are exposed as a virtual location `search://local/{searchId}` so the existing pane and
  table render them unchanged (§24).
- Opening a result navigates to its containing directory with the entry selected.
- Integration tests: match counts on a fixture tree, cancellation, unreadable directory handling,
  symlink cycle, Unicode queries.

## Implementation Notes
- The search provider is the first non-local provider — it exercises the VFS abstraction (0016) and
  will reveal any leaked local-filesystem assumptions.
- Bound concurrency so search cannot starve navigation or operations.

## Agent Notes
- Not started.
