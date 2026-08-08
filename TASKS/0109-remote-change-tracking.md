# 0009 Remote change tracking

Status: open
Priority: medium
Subsystem: backend
Depends on: 0004, 0006

## Context
Generalize directory change tracking so remote providers can use polling or future delta APIs instead of pretending to support native filesystem watch semantics.

## Acceptance Criteria
- Provider change tracking is explicit: native watch, delta API, poll, or unsupported.
- Local behavior remains native watch.
- SFTP/FTP can use conservative polling.
- Polling is cancellable and stops with the directory session.
- Inactive/background tabs can poll less frequently.
- Failures back off.
- Unchanged polls do not emit unnecessary revisions/redraws.
- SSE/Tauri event behavior stays transport-neutral.
- Tests cover polling lifecycle and backoff.

## Implementation Notes
- Introduce `ChangeTracking` or equivalent.
- Keep provider-specific refresh behind the directory service.
- Do not create per-row/per-file timers.
- Design so future native OneDrive can use delta tokens without another redesign.

## Agent Notes
- Inspect directory-session cancellation/lifecycle before adding timers.
