# 0064 Browser/server mode security hardening

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0032, 0044

## Context
`file-manager-coding-agent-spec.md` §22 — the browser/server backend controls files and must not run
as an unauthenticated localhost API. This must be in place before the server mode is used for
anything beyond local development.

## Acceptance Criteria
- Loopback-only binding by default; LAN binding requires an explicit opt-in flag and logs a warning.
- A randomly generated session secret per run (persisted only where the deployment configures it),
  with authenticated sessions required for all `/api/v1` routes including SSE (§10, §22).
- Strict origin validation and a non-wildcard CORS policy.
- Request-size limits and rate limiting on mutating endpoints.
- Configured accessible roots: every incoming `Location` is validated to resolve inside an allowed
  root after normalization and symlink resolution; absolute paths from clients are never trusted
  (§22).
- TLS supported for remote access, with documentation on how to enable it.
- Audit logging for destructive operations (delete, trash, overwrite) including who, what and when —
  without file contents or secrets (§30).
- Separate server-mode configuration file/section, distinct from desktop defaults.
- Security tests: path-traversal attempts (`..`, encoded, symlink escape, UNC, `\\?\`), unauthorised
  REST and SSE access, disallowed origin, oversized request.
- `docs/architecture/security.md` documents the model and the dev-mode relaxations.

## Implementation Notes
- Development mode may relax auth, but the relaxation must be explicit, logged at startup and
  impossible when a non-loopback bind is configured.
- Tauri mode uses OS user permissions but still restricts exposed commands via capabilities (§22).

## Agent Notes
- Not started.
