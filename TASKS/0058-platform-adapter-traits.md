# 0058 Platform adapter traits and capability reporting

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: platform
Depends on: 0043

## Context
`file-manager-coding-agent-spec.md` §23 ("create platform-adapter traits"), §21 (runtime
capabilities) and §3 rule 10 (platform differences are represented through explicit capabilities).

## Acceptance Criteria
- `fm-platform` defines traits for the native integrations the app will use: file icons,
  thumbnails, reveal in system file manager, trash, open with default application, open terminal,
  system clipboard file references, mounted volumes/drives, native menus.
- A no-op/fallback implementation exists so browser/server mode and unsupported platforms work
  without `cfg` branches at every call site.
- `RuntimeCapabilities` (§21) is derived from the active adapter, so the frontend responds to
  capabilities rather than detecting the operating system (§21).
- Unsupported functions are reported as `false` and their UI affordances are hidden or disabled —
  never present-but-broken (§23).
- `fm-platform-macos` and `fm-platform-windows` are wired up as the platform-specific
  implementations, initially delegating everything to the fallback.
- Unit tests assert capability reporting matches the adapter's actual implementation set.

## Implementation Notes
- Keep the traits synchronous-friendly but callable from async contexts via `spawn_blocking`; native
  calls must never block the Tauri UI thread (§28).
- Existing platform-touching code (trash in 0043) should be refactored onto these traits as part of
  this task.

## Agent Notes
- Not started.
