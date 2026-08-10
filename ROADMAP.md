# Roadmap

This file tracks which features are **done**, which are **mocked** (UI exists but backed by
in-process fixtures), and what is **not yet implemented** — including every capability currently
reported as `false` by the platform adapter and every area that is platform-untested.

Milestone boundaries follow specification §16. Update this file when a milestone task lands.

---

## Milestone 1 — Shell and navigation ✅ COMPLETE

**Implemented and production-ready:**

- Rust workspace and all crate stubs
- Axum HTTP server with health, runtime-capabilities, directory, settings, workspace, and SSE endpoints
- OpenAPI generation (`pnpm api:export`) and Orval Fetch client (`pnpm api:generate`)
- `FileManagerClient` interface with HTTP, Tauri, and mock adapters; runtime selection via `VITE_RUNTIME`
- Tauri 2 desktop shell — same frontend served by both hosts
- Backend event bus with monotonic IDs, session filtering, bounded replay history, and explicit gap reporting
- SSE endpoint (`GET /api/v1/events`) with reconnect via `Last-Event-ID` or `lastEventId` query param
- Tauri channel event delivery (same typed envelope as SSE, byte-level parity)
- Two-pane layout with draggable splitter and pane-focus traversal
- Virtualized directory table — only visible rows rendered; tested to 1 M entries
- Meiosis-style unidirectional state tree with Mergerino patches and animation-frame batching
- Directory navigation (open, parent, breadcrumb path-bar, history)
- Type-to-select quick prefix filter with in-word highlighting and red flash on no match
- Selection model (per-pane, keyed by stable IDs, independent of cursor)
- Keyboard navigation: arrow/page/edge/range/toggle/select-all/pane-switch/open/parent
- Basic sorting (name, extension, size, modified) with stable natural ordering and folder grouping
- File metadata summary (lazy, cancellable, driven by cursor position)
- Light/dark/follow-system CSS variable themes
- Persisted workspace (last open paths and layout) via `GET`/`PUT /api/v1/settings`
- Settings service: versioned JSON, atomic writes, forward migrations, corrupt-file backup
- `mithril-inspector` integrated (dev builds only; excluded from production)
- Connection status shown in the application header

**Not yet implemented in Milestone 1 scope:**
- None — all Milestone 1 tasks are complete.

---

## Milestone 2 — Basic file operations ✅ COMPLETE

**Implemented and production-ready:**

- Create directory (F7), rename (F2), copy file (F5), copy directory tree, move, duplicate
- Move to Trash/Recycle Bin (macOS and Windows where the platform adapter supports it)
- Permanent delete with confirmation dialog
- Conflict detection and resolution dialog (ask / overwrite / rename-new / skip)
- Operation cancellation, pause, and resume at safe boundaries
- Progress reporting with smoothed transfer rate; partial-progress summary on cancel
- Operation centre: queued, running, paused, completed, failed jobs; expandable failure detail
- Operation queue and terminal history (up to 100 entries / 30 days, JSON beside settings)
- In-application clipboard (Ctrl/Cmd+C, X, V) with cut-row dimming and cross-pane paste
- All mutations run through the Rust operation engine; no filesystem mutation in TypeScript
- Idempotency-Key support on REST operation start endpoints

**Mocked / partial:**
- None — the full operation set is backed by the real Rust engine.

---

## Milestone 3 — Productivity basics (mostly complete)

**Implemented:**

- Tabs per pane (multiple tabs, per-tab history, per-tab directory state)
- Navigation history (back/forward per tab, backend-resolved)
- Favourites / bookmarks and recent locations (`fm-connections` / sidebar panel)
- Configurable keyboard shortcuts (action registry, settings overrides, host-platform modifiers)
- Command palette (Ctrl/Cmd+P) — fuzzy filter, rank, recently used, parameter prompts
- Quick filter (type-to-select prefix narrowing in active pane)
- Recursive filesystem search (backend `fm-search` provider, real-time results)
- Basic file preview — F3 opens a Lister-style large-file viewer with lazy search
- F4 opens an in-external-editor action
- In-app text editor with Markdown preview (F4 / command palette)
- Open with default application, Reveal in Finder/Explorer, Open terminal at location
- Multi-rename (search/replace, prefix/suffix, sequence, case, preview before apply)
- Native file icons (backend-served, themeable, layered over icon-set)
- Catppuccin icon theme (distributable as a plugin)
- Native drag-and-drop within the app and with macOS Finder / Windows Explorer
- Workspace management UI (rename, delete, switch workspaces)
- Settings editor UI

**Not yet implemented in Milestone 3 scope:**

- `0071` File preview service and preview panel (architecture task; auto-cursor-driven preview
  was superseded — manual F3/viewer is complete but the preview panel component is not)
- `0098` Frontend i18n (translate.js integration)
- `0100` Streaming CSV and Excel file viewer

---

## Milestone 4 — Plugin foundation ✅ COMPLETE

**Implemented:**

- Plugin discovery, manifests (`plugin.toml`), enable/disable, permissions
- Action contributions (command palette + context menu integration)
- Custom metadata columns (host-rendered; see `sample-file-age-column`)
- Plugin error isolation (restricted Lua sandbox, resource limits, per-plugin diagnostics,
  auto-disable after repeated failures)
- Plugin management UI
- Sample plugins: Copy Markdown Path, File Age Column, Catppuccin icon theme

**Not yet implemented:**

- WebAssembly Component Model runtime (spec §19.4 long-term goal; Lua is the current runtime)
- No public native Rust dynamic-library ABI (by design; spec §35)

---

## Milestone 5 — Advanced capabilities (partial)

| Task | Feature | Status |
|---|---|---|
| 0075 | Directory comparison and synchronization | **Not started** |
| 0076 | Archive browsing (zip, tar, …) | ✅ Done |
| 0077 | Checksums and duplicate-file detection | **Not started** |
| 0088 | Large-file viewer (Lister-style, lazy search) | ✅ Done |
| 0089 | Content search across files | ✅ Done |
| 0096 | Mounted volume capacity | **Not started** |
| 0097 | Directory aggregate totals | ✅ Done |
| 0099 | In-app text editor with Markdown preview | ✅ Done |
| 0100 | Streaming CSV/Excel viewer | **Not started** |
| 0118 | Parallel-disk-usage / WinDirStat treemap | **Not started** |

---

## Milestone 6 — OS-integrated locations (partial)

| Task | Feature | Status |
|---|---|---|
| 0101 | OS cloud-backed locations (Finder sidebar / OneDrive env vars) | ✅ Done |
| 0102 | Mounted network volumes (macOS volume metadata / Windows mapped drives) | **Not started** |

---

## Milestones 7–10 — Remote connections (partial)

| Task | Feature | Status |
|---|---|---|
| 0103 | Remote connection framework (profiles, credentials, REST surface) | ✅ Done |
| 0104 | SFTP provider (`fm-vfs-sftp`, session pool, host-key verification) | ✅ Done |
| 0105 | SSH terminal actions | **Not started** |
| 0106 | FTP and FTPS provider | **Not started** |
| 0107 | External remote desktop launch | **Not started** |
| 0108 | Cross-provider transfer planning | **Not started** |
| 0109 | Remote change tracking | **Not started** |
| 0110 | Native OneDrive provider (optional) | **Not started** |
| 0111 | Native SMB provider (optional) | **Not started** |

---

## Platform capabilities

The table below lists every `PlatformCapabilities` bit defined in `fm-platform/src/capabilities.rs`
and whether each host currently reports it as `true`.

| Capability | macOS | Windows | Linux / other |
|---|---|---|---|
| `FILE_ICONS` (native file icons) | ✅ | ❌ not implemented | ❌ not implemented |
| `THUMBNAILS` (native thumbnail previews) | ❌ not implemented | ❌ not implemented | ❌ not implemented |
| `REVEAL_IN_FILE_MANAGER` (Reveal in Finder/Explorer) | ✅ | ❌ not implemented | ❌ not implemented |
| `TRASH` (move to Trash/Recycle Bin) | ✅ | ❌ not implemented | ❌ not implemented |
| `OPEN_WITH_DEFAULT_APPLICATION` | ✅ | ❌ not implemented | ❌ not implemented |
| `OPEN_TERMINAL` (open terminal at location) | ✅ | ❌ not implemented | ❌ not implemented |
| `CLIPBOARD_FILE_REFERENCES` (OS clipboard file-path lists) | ❌ not implemented | ❌ not implemented | ❌ not implemented |
| `MOUNTED_VOLUMES` (list mounted volumes/drives) | ✅ | ❌ not implemented | ❌ not implemented |
| `NATIVE_MENUS` (native app menu bar) | ✅ | ❌ not implemented | ❌ not implemented |
| `NATIVE_DRAG_OUT` (drag entries to other apps) | ✅ | ✅ (Tauri only) | ❌ not implemented |

> **Windows note:** `WindowsPlatformAdapter` currently delegates to `FallbackPlatformAdapter`
> for all capabilities except `NATIVE_DRAG_OUT`. Task `0060` (Windows platform integration) is
> open.

---

## Platform-untested areas (§35)

The following areas have been implemented but not verified on all target platforms. Tests that
could not be run on a given platform are noted explicitly in the relevant task's Agent Notes.

| Area | macOS | Windows | Linux |
|---|---|---|---|
| Full build (`cargo build --workspace --release`) | ✅ | CI only (no manual smoke) | CI only |
| Tauri desktop packaging and launch | ✅ | CI smoke (unsigned) | ✅ (AppImage / .deb) |
| Native file icons (`fm-platform-macos`) | ✅ | N/A (not implemented) | N/A |
| Trash / Recycle Bin | ✅ | N/A (not implemented) | N/A |
| Reveal in file manager | ✅ | N/A (not implemented) | N/A |
| Open terminal at location | ✅ | N/A (not implemented) | N/A |
| Drag-out to Finder/Explorer | ✅ | CI only — no manual smoke | N/A |
| Credential store (Keychain/Credential Manager) | ✅ macOS Keychain | Not manually verified | In-memory fallback only |
| SSH host-key verification flow | ✅ | Not manually verified | Not manually verified |
| `fm-platform-windows` (task 0060) | N/A | **Open task — untested** | N/A |
| Windows-specific path normalization (UNC, long paths) | N/A | CI only | N/A |
| Cross-platform case-only rename on NTFS | macOS (APFS) ✅ | Not manually verified | N/A |
| `CLIPBOARD_FILE_REFERENCES` | Not implemented | Not implemented | Not implemented |

---

## Cross-cutting quality tasks

| Task | Feature | Status |
|---|---|---|
| 0060 | Windows platform integration | **Open** |
| 0064 | Browser/server mode security hardening | **Open** |
| 0065 | Performance fixtures and benchmarks | **Open** |
| 0066 | Accessibility review | **Open** |
| 0073 | Diagnostics view and structured logging | **Open** (backend+model+component done; not wired into navigation) |
| 0090 | Selection toggles (invert, select/deselect by mask) | **Open** |
| 0098 | Frontend i18n | **Open** |

---

## Further reading

- [TASKS/README.md](TASKS/README.md) — full task index with milestone grouping
- [docs/decisions/](docs/decisions/) — Architecture Decision Records
- [docs/plugin-api/README.md](docs/plugin-api/README.md) — Plugin API reference
- [AGENTS.md](AGENTS.md) — repository conventions and coding-agent rules
- [README.md](README.md) — development setup and commands
