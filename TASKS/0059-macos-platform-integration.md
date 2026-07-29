# 0059 macOS platform integration

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: platform
Depends on: 0058

## Context
`file-manager-coding-agent-spec.md` §23 ("macOS targets") and §33 step 10. Implement only the subset
needed for the MVP/version 1; keep the rest behind capability flags.

## Acceptance Criteria
- Implemented in `fm-platform-macos`: native file icons, Finder reveal, Trash, mounted volumes,
  native menu bar, terminal integration.
- File icons are fetched lazily per file type and cached by extension/UTI, not per file, so a
  100,000-entry listing does not issue 100,000 icon lookups (§28).
- Application bundles (`.app`) are shown as single items, not directories, unless the user chooses
  to enter them.
- macOS aliases are resolved or clearly flagged (§6); if not implemented, the capability reports
  `false` and this is stated in the roadmap (§35).
- Quick Look previews, Finder tags, extended attributes and drag-to-Finder are declared as
  unimplemented capabilities unless delivered here (drag is 0062).
- Non-NFC Unicode filenames round-trip correctly through the UI and operations.
- Tests: capability reporting, icon cache behaviour, path handling for volumes under `/Volumes`.
- Manually verified on macOS; the task notes record the OS version tested (§35).

## Implementation Notes
- Prefer `objc2`/`core-foundation` bindings over shelling out; where shelling out is unavoidable
  (e.g. terminal launch), quote arguments safely.
- Signing/notarization is task 0063.

## Agent Notes
- Not started.
