# 0002 Frontend Vite + Mithril + TypeScript skeleton

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: none

## Context
Create the `frontend/` project described in `file-manager-coding-agent-spec.md` §2.1 and §4.
This is the shell only — no file-manager UI yet (that starts at 0024).

## Acceptance Criteria
- `frontend/` contains `index.html`, `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts` and `src/main.ts`, managed with pnpm.
- Vite 8, TypeScript 7 with `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`; ESM only.
- Mithril.js and `mithril-materialized` installed and rendering a placeholder app shell using a
  factory component and idiomatic lifecycle methods.
- Vitest runs and one smoke test passes.
- Source directories created per §4: `api/`, `app/`, `components/`, `features/`, `models/`,
  `state/`, `commands/`, `keybindings/`, `themes/`, `utilities/`.
- Vite dev server proxies `/api` to `http://127.0.0.1:<server port>`, and the proxy is configured so
  SSE responses stream without buffering (§32).
- `pnpm --dir frontend build` (i.e. `tsc --noEmit && vite build`) succeeds with no errors.
- No React/Vue/Svelte/Angular dependencies (§2.1).

## Implementation Notes
- `VITE_RUNTIME` env var (`http` | `tauri` | `mock`) is read here but only consumed in 0011.
- Keep `mithril-materialized` for dialogs/forms/menus; the file table is custom (§14).
- Reference: local `mithril`, `mithril-materialized` and `meiosis` skills.

## Agent Notes
- Not started.
