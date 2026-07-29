# 0013 Mock FileManagerClient adapter and fixtures

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0011

## Context
`file-manager-coding-agent-spec.md` §12, §27 (frontend tests use the mock client for deterministic
states) and §28 (mocked 1,000,000-entry datasets must not mount every row).

## Acceptance Criteria
- `frontend/src/api/client/mock-file-manager-client.ts` implements the full `FileManagerClient`
  with deterministic in-memory data.
- Fixtures under `fixtures/mock-responses/` and generators for 1,000 / 10,000 / 100,000 /
  1,000,000-entry directories, generated lazily rather than materialised eagerly where practical.
- Mock supports: nested directories, hidden files, symlink-flagged entries, Unicode names, empty
  directories, unreadable directories (error state), and a slow/loading mode.
- `subscribe()` can emit scripted backend events (directory deltas, operation progress) on demand so
  tests can drive event handling without a server.
- Configurable artificial latency and failure injection for loading/error state testing.
- `pnpm dev:mock` starts the frontend against this adapter with no backend running.

## Implementation Notes
- Keep fixture generation pure and seeded so tests are reproducible.
- The mock is production code used by tests — type it as strictly as the real adapters.

## Agent Notes
- Not started.
