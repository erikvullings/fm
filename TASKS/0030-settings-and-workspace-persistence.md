# 0030 Settings service and persisted last workspace

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0019, 0026

## Context
`file-manager-coding-agent-spec.md` §26 (settings, versioned with migrations) and §16 milestone 1
(persisted last workspace). Settings are persisted by the backend, not in frontend local storage.

## Acceptance Criteria
- `fm-settings` persists versioned settings to a platform-appropriate config directory
  (`directories`/`dirs` crate), with atomic writes (temp file + rename).
- Settings schema covers the §26 list, at least: theme, font size, row height, date format, size
  format, hidden-file visibility, confirm permanent delete, default conflict policy, operation
  concurrency, pane layout, columns, keybindings, enabled plugins, plugin settings, terminal
  command, default start locations.
- A `schemaVersion` field plus a migration chain; loading an older version migrates rather than
  discarding (§26). A test migrates a v1 fixture to the current version.
- Corrupt or unreadable settings fall back to defaults, back up the bad file, and surface a
  notification — never a crash and never silent data loss.
- `GET /api/v1/settings` and `PUT /api/v1/settings` (`getSettings`, `updateSettings`) with OpenAPI
  schemas; the Tauri host exposes equivalent commands.
- The last workspace (pane locations, active pane, sort, split ratio) is saved on change (debounced)
  and restored on startup; restoring a location that no longer exists falls back to the default
  start location with a notification.
- Frontend reads settings at bootstrap and applies theme, row height, formats.

## Implementation Notes
- Workspace persistence uses the `Workspace`/`PaneState`/`TabState` domain types (§5.3) so tabs
  (0069) and multiple panes need no format change — bump `schemaVersion` when they land.
- Do not store secrets in settings.

## Agent Notes
- Not started.
