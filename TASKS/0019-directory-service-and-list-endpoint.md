# 0019 Directory service, snapshots and request cancellation

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0018, 0008

## Context
`file-manager-coding-agent-spec.md` §5.4, §7 and §8. The backend owns authoritative directory state
(§3 rule 7). Navigating quickly must never let an earlier request overwrite a newer view (§5.4).

## Acceptance Criteria
- `DirectoryService` in `fm-application` produces `DirectorySnapshot`s with monotonic `revision`,
  `request_id`, `has_more`, `continuation_token` and `loading_state`.
- Starting a new request for a pane cancels the in-flight request for that pane, and a late response
  from a superseded request is discarded rather than published.
- REST endpoints implemented with thin handlers and stable operation ids:
  - `POST /api/v1/directories/list` → `listDirectory`
  - `POST /api/v1/directories/refresh` → `refreshDirectory`
  - `POST /api/v1/navigation/open` → `navigatePane`
  - `POST /api/v1/entries/metadata` → `getEntryMetadata`
- Errors map to `ApplicationErrorDto` with stable codes; raw OS errors are never exposed (§8).
- Sorting and hidden-file filtering options are accepted server-side, with the frontend free to sort
  the loaded page for responsiveness.
- Integration tests: paging through a large temp directory, cancellation of a superseded request,
  unreadable directory → typed error, non-existent path → `notFound`.
- OpenAPI regenerated and `api:check` passes.

## Implementation Notes
- Snapshots are immutable values; incremental updates arrive as `DirectoryDelta` events (0032).
- Keep per-pane request bookkeeping in the service, not in the Axum layer, so Tauri gets the same
  behaviour (§3 rule 9).

## Agent Notes
- Not started.
