# 0009 Deterministic OpenAPI export command

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0008

## Context
`file-manager-coding-agent-spec.md` §9: the OpenAPI document must be exportable without starting the
web server, and the output must be deterministic so CI does not produce ordering-only diffs.

## Acceptance Criteria
- `cargo run -p fm-server -- export-openapi frontend/openapi/openapi.json` writes the document and
  exits 0 without binding a port.
- Output is byte-for-byte stable across runs: sorted keys, stable operation id order, fixed
  indentation, trailing newline.
- Re-running the command twice produces no diff; a Rust test asserts this.
- `frontend/openapi/openapi.json` is checked into git.
- `scripts/export-openapi.sh` and the root `api:export` script call this command.
- A test asserts every route registered on the Axum router appears in the exported document.

## Implementation Notes
- Use a small CLI arg parser (`clap`) in `apps/fm-server`; keep the server and export paths sharing
  one `ApiDoc` definition.
- Serialize through `serde_json::Value` with a `BTreeMap`-backed object representation if
  `utoipa`'s ordering is not already deterministic.

## Agent Notes
- Not started.
