# 0010 Native OneDrive provider

Status: open
Priority: low
Subsystem: backend
Depends on: 0003, 0008, 0009

## Context
Optional future direct OneDrive access without the installed sync client/OS filesystem representation. Task 0001 already provides useful OneDrive access when exposed by the OS.

## Acceptance Criteria
- OAuth authorization/token refresh works without exposing secrets.
- Refresh tokens use `CredentialStore`.
- Personal OneDrive browsing, streaming download/upload, paging, throttling/backoff and appropriate resumable upload work.
- Change/delta tracking plugs into the generalized change-tracking abstraction.
- Locations reference saved accounts/connections and never include tokens.
- Transfers participate in the shared operation engine.
- Tests mock or safely fixture provider API behavior.

## Implementation Notes
- Suggested crates: `fm-auth-oauth`, `fm-vfs-onedrive`.
- OneDrive Business/SharePoint can be follow-up scope.
- Do not duplicate 0001's OS-exposed OneDrive path.

## Agent Notes
- Before starting, verify there is a real product requirement for direct API access; otherwise keep this open.
