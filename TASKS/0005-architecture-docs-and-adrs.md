# 0005 Architecture documentation and initial ADRs

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: docs
Depends on: 0001, 0002

## Context
`file-manager-coding-agent-spec.md` §34 requires ten short architecture decision records, and §33
step 1 requires architecture documentation as part of the bootstrap.

## Acceptance Criteria
- `docs/architecture/overview.md` describes the layering diagram from §3 and restates the ten
  mandatory rules.
- `docs/decisions/` contains one ADR per item in §34:
  1. browser + Tauri dual-host architecture;
  2. Axum REST plus SSE;
  3. OpenAPI source of truth and generated TypeScript client;
  4. VFS provider abstraction;
  5. operation scheduler and conflict handling;
  6. plugin runtime selection;
  7. frontend state management;
  8. virtualized table implementation;
  9. settings persistence;
  10. native platform adapters.
- Every ADR includes: context, decision, alternatives, consequences, revisit conditions.
- ADRs are numbered `0001-*.md` within `docs/decisions/` and marked `Status: accepted|proposed`.
- `docs/plugin-api/` and `docs/screenshots/` directories exist with a placeholder README.

## Implementation Notes
- The crate layering is already enforced in code by `crates/fm-test-support/src/architecture.rs`
  (task 0001). `docs/architecture/overview.md` should describe and link to it rather than restating
  the layer map, so the prose and the test cannot drift apart.
- ADRs are short (roughly one page). They record intent, not implementation detail.
- ADR 7 (frontend state) should record the decision to use a small explicit state model
  (Meiosis-style patch updates) rather than a generic state framework (§13, §35).
- Later tasks that contradict an ADR must supersede it rather than edit history.

## Agent Notes
- Not started.
