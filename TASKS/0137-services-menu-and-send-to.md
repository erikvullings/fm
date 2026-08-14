# 0137 Services menu (macOS) / "Send to" (Windows) integration

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: platform
Depends on: 0058, 0059, 0060

## Context

macOS's Services menu (right-click → Services) and Windows' "Send to" context-menu submenu let
other installed apps register themselves as targets for the selected file(s) — e.g. "Send to Mail
recipient", a Automator/Shortcuts workflow, a compression utility. fm's context menu (0052)
currently only shows fm's own actions/plugins; neither OS integration point is wired up.

## Acceptance Criteria
- macOS: selected entries are exposed to the Services menu (implement `NSServicesMenuRequestor` or
  the modern equivalent) so OS-registered services appear in fm's right-click menu under a
  "Services" submenu, matching Finder's behaviour.
- Windows: fm's context menu includes a "Send to" submenu populated from the user's
  `shell:sendto` folder, matching Explorer's behaviour.
- Both integrate into 0052's existing context-menu construction rather than a parallel menu system.
- Capability-gated: report `false`/omit the submenu on Linux and in browser mode rather than
  half-implementing an equivalent.
- Tests: platform adapter unit tests for submenu population where feasible; manual verification
  recorded for both platforms.

## Implementation Notes
- Lower priority than 0133 (menu bar content) and 0136 (Finder tags/xattrs) — this is a nice-to-have
  interop feature, not a workflow-blocking gap. Pick up after those if capacity allows.

## Agent Notes
- (none yet)
