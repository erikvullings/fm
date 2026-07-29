# 0070 Favourites, bookmarks and recent locations

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0069

## Context
`file-manager-coding-agent-spec.md` §16 milestone 3 and §37.

## Acceptance Criteria
- Users can bookmark the current location with a custom label; bookmarks persist through the
  settings service (0030) and are stored as `Location`s, not raw paths (§5.1).
- A favourites list is reachable from the toolbar, the command palette and a keyboard shortcut, and
  navigates the active pane on selection.
- Recent locations are tracked per workspace, deduplicated, bounded, and exclude locations the user
  has removed.
- Bookmarks and recents to locations that no longer exist are marked unavailable rather than
  silently failing on click.
- Reordering and deleting bookmarks is supported.
- Each bookmark also appears as an invokable action so it is palette- and shortcut-accessible (§18).
- Vitest tests: persistence round-trip, dedup/bounding of recents, unavailable-location handling.

## Implementation Notes
- Bookmarks must survive a settings schema migration (§26) — add a migration test.

## Agent Notes
- Not started.
