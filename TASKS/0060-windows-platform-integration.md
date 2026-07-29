# 0060 Windows platform integration

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: platform
Depends on: 0058

## Context
`file-manager-coding-agent-spec.md` §23 ("Windows targets") and §33 step 10.

## Acceptance Criteria
- Implemented in `fm-platform-windows`: shell icons, Explorer reveal, Recycle Bin, drive listing,
  native menus, terminal integration.
- Drive listing enumerates volumes (including removable and network drives) and surfaces them as
  navigable locations; unavailable drives fail with a typed error rather than hanging.
- UNC paths (`\\server\share`) and long paths (`\\?\` prefixing) work throughout listing and
  operations (§17, §23).
- Junctions, reparse points and shortcuts (`.lnk`) are identified and flagged in the entry; shortcut
  targets are resolved only on explicit open, never during listing.
- Windows file attributes (hidden, system, read-only, archive) are read and shown; hidden/system
  entries respect the hidden-file setting.
- Locked-file errors map to a distinct, user-readable error code rather than a generic I/O error
  (§8, §23).
- Shell thumbnails are declared as an unimplemented capability unless delivered here.
- Tests: UNC and long-path handling, attribute mapping, junction detection, locked-file error
  mapping (using a test that holds an exclusive handle).
- Manually verified on Windows; the task notes record the OS version tested (§35).

## Implementation Notes
- Use the `windows` crate; shell icon extraction must be cached by extension (§28).
- Installer signing is task 0063.

## Agent Notes
- Not started.
