# 0001 OS cloud-backed locations

Status: open
Priority: high
Subsystem: backend
Depends on: none

## Context
Add first-class discovery and presentation of cloud-backed filesystem locations already exposed by the operating system, including OneDrive, iCloud Drive, Dropbox, Google Drive, and similar providers. This is intentionally an easy win and must not depend on the remote `ConnectionManager`. These locations continue to use the existing local `FileSystemProvider`.

## Acceptance Criteria
- A platform-facing system-location discovery abstraction exists.
- macOS discovers common cloud-backed locations without hard-coded user-specific paths.
- Windows has an equivalent adapter or documented fallback.
- Discovered cloud locations resolve to the existing `local` provider.
- The frontend shows them in a `CLOUD`/Locations section.
- Opening one behaves like opening a normal local directory.
- Missing/offline providers produce recoverable states.
- No vendor API credentials or `ConnectionProfile` are required.
- Tests cover classification and graceful fallback.

## Implementation Notes
- Introduce `SystemLocationProvider`, `SystemLocation`, and `SystemLocationKind`.
- Add optional advisory `provider_hint` values; never couple file semantics to them.
- Likely areas: `fm-system-locations`, platform adapters, `frontend/src/features/locations`.
- Add `GET /api/v1/system-locations` and equivalent Tauri service path if appropriate.

## Agent Notes
- Inspect current platform adapters, local-provider URI handling, and sidebar/navigation components first.
