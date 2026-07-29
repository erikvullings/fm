# 0008 Axum server with runtime capabilities, OpenAPI JSON and Swagger UI

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0007

## Context
`file-manager-coding-agent-spec.md` §2.2, §8, §9, §21 and §33 step 2. First running backend:
health, runtime capabilities, OpenAPI document and Swagger UI. Handlers must stay thin (§3 rule 2).

## Acceptance Criteria
- `apps/fm-server` starts an Axum server bound to loopback by default with a configurable port.
- Routes: `GET /api/v1/health`, `GET /api/v1/runtime`, `GET /api/v1/openapi.json`,
  `GET /api/v1/docs` (Swagger UI).
- `GET /api/v1/runtime` returns the `RuntimeCapabilities` shape from §21 with
  `runtime: "browserServer"` and the detected platform; unimplemented natives report `false`.
- `tower-http` layers for tracing, request body limits and CORS (no wildcard origin — §22).
- Every response carries a correlation/request id, also included in error bodies (§8).
- `tracing` initialised with env-filter; structured fields include request id and duration (§30).
- `fm-application` exposes a `FileManagerService` facade (§7) and the Axum handler only maps
  request → service call → DTO; no filesystem logic in `apps/fm-server`.
- Integration test using `axum::serve` on an ephemeral port asserts 200 + JSON shape for
  `/api/v1/health` and `/api/v1/runtime`, and that `/api/v1/openapi.json` parses as OpenAPI 3.1.

## Implementation Notes
- Use `utoipa-axum`'s router integration so routes and schemas cannot drift.
- Operation ids: `getHealth`, `getRuntimeCapabilities` (§9 naming rules).
- Server config (bind address, CORS origins, roots) belongs in a typed config struct now, so 0064
  can harden it without restructuring.

## Agent Notes
- Not started.
