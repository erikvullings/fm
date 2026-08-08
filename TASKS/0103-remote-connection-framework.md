# 0003 Remote connection framework

Status: open
Priority: high
Subsystem: backend
Depends on: none

## Context
Create reusable connection-profile and secure-credential infrastructure for application-managed SSH/SFTP, FTP/FTPS, remote desktop, and future native cloud/SMB providers. This is independent of 0001/0002.

## Acceptance Criteria
- Typed `ConnectionProfile`, `ConnectionId`, `ConnectionKind`, and protocol configurations exist.
- Profiles never persist passwords, passphrases, OAuth tokens, or similar secrets.
- A `CredentialStore` abstraction exists.
- macOS uses Keychain or equivalent protected storage.
- Windows uses Credential Manager or equivalent protected storage.
- Connection CRUD, test/connect/disconnect semantics, and status are exposed through application services.
- Browser/Axum and Tauri clients can manage connections without seeing stored secrets.
- Frontend has an initial `SERVERS`/Connections management surface.
- Tests verify secret separation and lifecycle.

## Implementation Notes
- Suggested crates: `fm-connections`, `fm-credentials`.
- Use tagged typed configs, not generic maps.
- API secret inputs must be write-only; responses never echo secrets.
- Add `connection.statusChanged` events.
- Do not implement a remote filesystem protocol in this task.

## Agent Notes
- Inspect settings persistence and platform abstractions before selecting credential-store implementations.
