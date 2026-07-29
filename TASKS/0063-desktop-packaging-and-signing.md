# 0063 Desktop packaging, signing and notarization

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: desktop
Depends on: 0062

## Context
`file-manager-coding-agent-spec.md` §31 (signing only in protected release workflows), §33 step 10
and §37 (signed macOS and Windows installers).

## Acceptance Criteria
- `pnpm build:tauri` produces installable artefacts on macOS (`.dmg`/`.app`) and Windows
  (`.msi`/`.exe`).
- Product metadata, icons, bundle identifier and version are set from a single source shared with
  the Rust crate version.
- A protected release workflow signs and notarizes the macOS build and signs the Windows installer,
  using repository secrets; PR builds remain unsigned (§31).
- A packaging smoke test installs and launches the artefact in CI where feasible, otherwise the
  manual verification steps are documented.
- Linux packaging is explicitly out of scope for the first release but the build is not broken for
  Linux (§1).
- Release notes/versioning process documented in the README.

## Implementation Notes
- Keep signing credentials out of PR-triggered workflows entirely (not merely conditional).
- Auto-update is not in scope; note the decision.

## Agent Notes
- Not started.
