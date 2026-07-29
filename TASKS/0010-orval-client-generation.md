# 0010 Orval-generated Fetch client and api:check

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0009

## Context
`file-manager-coding-agent-spec.md` §2.3 and §33 step 2. Generate a Fetch-based TypeScript client
from the exported OpenAPI document. Generated files are never edited by hand (§35).

## Acceptance Criteria
- `frontend/orval.config.ts` configured for: Fetch client, TypeScript DTOs, split output into
  `frontend/src/api/generated/`, and a custom mutator — explicitly **not** React Query.
- `frontend/src/api/fetch-mutator.ts` implements: base URL resolution, JSON handling,
  `AbortSignal` cancellation pass-through, optional auth/session header, and mapping non-2xx
  responses to a typed `ApiError` carrying `code`, `message`, `requestId` and `details` (§8).
- `pnpm api:generate` regenerates the client; generated output is checked into git.
- `pnpm api:check` (export + generate + `git diff --exit-code`) passes locally and runs in CI,
  failing when the checked-in document or client is stale (§2.3, §31).
- `frontend/src/api/generated/` carries a header/README stating it is generated and must not be
  edited, and is excluded from lint autofix and formatting churn.
- A Vitest unit test covers the mutator's error mapping and abort behaviour with a stubbed `fetch`.

## Implementation Notes
- The generated client is an implementation detail of `HttpFileManagerClient` (0012); feature code
  must never import from `api/generated/` directly.
- Keep the mutator free of Mithril imports so it is testable in isolation.

## Agent Notes
- Not started.
