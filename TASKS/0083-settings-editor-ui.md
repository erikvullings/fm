# 0083 Settings editor UI

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0050, 0057

## Context
Task 0030 provides versioned settings persistence and equivalent HTTP/Tauri APIs, but users cannot
inspect or change those settings in the application. Tasks 0050 and 0057 own the keybinding and
plugin-management behavior that must be represented in a coherent settings experience rather than
added later as disconnected screens.

## Acceptance Criteria
- A keyboard-accessible settings surface can be opened from the application shell and closed
  without losing the current workspace state.
- Sections cover appearance (theme, font size, row height, date and size formats), file behavior
  (hidden files and permanent-delete confirmation), operations (conflict policy and concurrency),
  new-workspace defaults (pane layout, columns and start locations), terminal command, keybindings,
  and plugins.
- Initial values come from `FileManagerClient.getSettings`; saving sends one complete settings
  document through `updateSettings` and applies visible changes without an application restart.
- Editing can be cancelled without persisting changes. Save failures keep the user's draft visible
  and surface an actionable error instead of silently reverting it.
- Keybinding controls consume 0050's conflict detection and platform/browser availability model.
- The plugin section embeds or links to 0057's management UI rather than implementing a second
  enable/disable path.
- Forms use `mithril-materialized`, have associated labels and validation messages, and are usable
  with keyboard navigation.
- Vitest tests cover loading, editing and saving, cancellation, validation/error handling, live
  appearance updates, and the keybinding/plugin integration boundaries.

## Implementation Notes
- Keep draft/form state in a feature model or service; do not move application logic into Mithril
  components.
- Treat default pane layout, columns and start locations as defaults for newly created workspace
  content. Never overwrite the live layout, tabs or per-tab view configuration of an open workspace.
- Do not store secrets in settings, and do not hand-edit generated OpenAPI or Orval files.
- Implement after 0050 and 0057 are done so the editor integrates their final models. Task 0030 is
  already complete and supplies the persistence contract.

## Agent Notes
- 2026-07-31 codex: Created after 0030 delivered persistence without a user-facing editor. Best
  implementation point is immediately after 0050 and 0057; those tasks should leave reusable
  keybinding and plugin-management feature boundaries for this screen.
