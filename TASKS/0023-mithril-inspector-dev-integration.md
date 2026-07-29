# 0023 Development-only mithril-inspector integration

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0002

## Context
`file-manager-coding-agent-spec.md` §2.1 requires `mithril-inspector` in development builds to help
coding agents debug component behaviour, and forbids it from reaching production.

## Acceptance Criteria
- `mithril-inspector` is loaded only when `import.meta.env.DEV` is true, via a dynamic import so the
  bundler tree-shakes it out of production.
- A production build contains no reference to the inspector — asserted by a test that greps `dist/`.
- The inspector allows: inspecting the component tree, viewing component attrs and local state,
  selecting rendered elements, and tracing an element to its source component where supported.
- If the inspector fails to load or throws, the app continues working and logs one warning
  (fail gracefully — §2.1).
- No core application behaviour depends on the inspector being present.
- Documented in the README: how to open it and what it is useful for.

## Implementation Notes
- Keep the integration in a single `frontend/src/app/dev-tools.ts` module.
- Guard against double-initialisation under Vite HMR.

## Agent Notes
- Not started.
