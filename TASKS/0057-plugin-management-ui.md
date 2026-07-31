# 0057 Plugin management UI

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0055, 0056

## Context
`file-manager-coding-agent-spec.md` §33 step 9 ("plugin management page") and §37 (plugin management
UI is part of polished version 1).

## Acceptance Criteria
- A settings page lists discovered plugins with name, version, description, source and status
  (enabled / disabled / failed / auto-disabled).
- Enable and disable toggles persist through the settings service and take effect without restart.
- Each plugin shows the permissions it requests, with denied permissions clearly marked.
- Plugin diagnostics are viewable: recent errors and the plugin's bounded log (§19.4).
- Invalid manifests are listed with the validation error rather than hidden.
- `plugin.changed` events update the page live.
- Built with `mithril-materialized` form components (§14) and keyboard accessible (§29).
- Vitest tests cover the enable/disable flow and error-state rendering.

## Implementation Notes
- No plugin installation/marketplace flow — out of scope for version 1 (§37).

## Agent Notes
- Not started.
- 2026-07-31 codex: This task is a prerequisite for 0083. Build the plugin list and enable/disable
  flow as a reusable settings section (or routable feature) so the general settings editor embeds
  or links to it instead of creating a second plugin-management path.
