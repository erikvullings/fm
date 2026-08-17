# 0144 Volumes in Favourites/Go menu, plus Go menu Servers/Cloud/Network sections

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: cross-cutting
Depends on: 0070, 0096, 0102, 0133

## Context

User request (parity with Marta's Go menu "Volumes" list, which shows every currently mounted
local volume — internal disks, external/USB drives, mounted disk images):

- The pane favourites dropdown (`frontend/src/features/panes/pane.ts`) already shows Servers
  (saved connections), Cloud, and Network sections below the user's own Favourites (task 0070/0102),
  but has no "Volumes" section for ordinary local/removable/mounted-image volumes.
- The native Go menu (`native-menu-spec.ts`'s `goMenu`) is built only from
  `favouriteActions()` (app-shell.ts) — i.e. only the user's saved favourites plus the
  `core.favourites` launcher. It has no equivalent of the favourites dropdown's Servers/Cloud/
  Network sections at all, so it's currently a strict subset of what the dropdown shows.

`PlatformAdapter::mounted_volumes()` (`crates/fm-platform/src/adapter.rs`) and `MountedVolume`
(`crates/fm-platform/src/types.rs`, `{ name, mount_point }`) already exist per-platform (macOS via
`mountedVolumeURLsIncludingResourceValuesForKeys_options`, Windows via drive enumeration — see
task 0096's capacity work, which reused this same discovery) but are **not exposed anywhere**
above the platform crate: no DTO, no `FileManagerService` method, no HTTP route, no Tauri command,
no frontend client method, no model type. This task is the "expose it" follow-up.

## Acceptance Criteria

### Backend: expose mounted volumes as navigable locations

- New `VolumeDto` (or reuse/extend `SystemLocationDto` with a third `SystemLocationKindDto::Volume`
  variant — pick whichever keeps `SystemLocationKind`'s Cloud/Network semantics from task 0102
  clean; a plain third variant is likely simplest since volumes need no protocol/server/share
  metadata) mapping each `MountedVolume` to a navigable `Location` via
  `Location::from_native_path`, mirroring `discover_system_locations` in
  `crates/fm-application/src/platform_mapping.rs`.
- `FileManagerService` gains a method analogous to `system_locations()` (reuse the existing
  `mounted_volumes()` trait method already on `PlatformAdapter`, do not add a second discovery
  path).
- New HTTP route (`apps/fm-server`) and Tauri command (`apps/fm-desktop/src-tauri`), matching the
  existing system-locations route/command pattern exactly (auth, error mapping, OpenAPI docs).
- Regenerate OpenAPI (`pnpm run api:export`) and the Orval client (`pnpm run api:generate`) — do
  not hand-edit `frontend/openapi/openapi.json` or `frontend/src/api/generated/**` (`AGENTS.md`).
- All three `FileManagerClient` implementations (`http-`, `tauri-`, `mock-file-manager-client.ts`)
  implement the new method; the mock client returns plausible synthetic volumes.
- The boot/system volume is always included (mirrors task 0096's
  `mounted_volumes_are_reported_and_always_include_the_system_drive` Windows test and the macOS
  equivalent) and disappearing/unmounted volumes behave like disappearing network shares (task
  0102): recoverable, not a hard failure.

### Frontend: Favourites dropdown "Volumes" section

- `frontend/src/features/workspace/workspace-controller.ts` and `pane-content-builder.ts` gain
  `volumes`/`loadVolumes` state, following the exact `systemLocations`/`loadSystemLocations`
  pattern already there.
- `pane.ts`'s favourites dropdown renders a `.fm-volumes-locations` section titled "Volumes",
  positioned directly under the user's own Favourites list and above Servers (per the user's
  explicit "add them, by default, to the Favourites menu, under Favourites" — i.e. always-visible,
  dynamically discovered, not persisted into `settingsDto.favouriteLocations`, exactly like the
  existing Cloud/Network sections are not persisted either).
- Each volume navigates the active pane on click, same as an existing system-location button.

### Native Go menu: add Volumes, Servers, Cloud (and Network) sections

- `NativeMenuInputs` (`native-menu-spec.ts`) gains the data already available in app-shell.ts's
  closures: `volumes`, `connections` (for Servers), and `systemLocations` (for Cloud/Network) —
  same shape the favourites dropdown already consumes.
- `goMenu()` renders these as additional groups, separated with `{ kind: 'separator' }`, after the
  existing favourite-location items: Volumes, then Servers, then Cloud, then Network — matching
  the favourites dropdown's section order (Favourites, Volumes, Servers, Cloud, Network, Recent —
  Recent is intentionally omitted from the Go menu, it's not currently there either).
- Each new group needs its own synthetic, stable menu-item id (mirroring
  `core.favourite.<index>`'s pattern, e.g. `ui.goMenu.volume.<index>`,
  `ui.goMenu.connection.<connectionId>`, `ui.goMenu.systemLocation.<index>`) and a matching branch
  in `dispatchNativeMenuAction` (`native-menu-dispatch.ts`) that resolves the id back to a
  `Location` and calls the same navigation path `pane.ts`'s `navigateFavourite` uses (do not
  duplicate that logic — extract/share it, e.g. via a callback on `NativeMenuDispatchContext` like
  `navigateToLocation(location: Location)`).
- Unavailable/disconnected servers and system locations should render disabled/labelled the same
  way the dropdown already does (`(unavailable)` / `(read-only)` suffixes), not silently omitted.

### Tests

- Backend: DTO round-trip/camelCase/schema test, service test (volumes surfaced, empty when
  adapter lacks the capability), route/command tests.
- Frontend: workspace-controller/pane-content-builder wiring test; `pane.test.ts` Volumes-section
  render test (present/absent, click navigates); `native-menu-spec.test.ts` coverage for the new
  Go-menu groups (separators, ordering, unavailable labelling); `native-menu-dispatch.test.ts`
  coverage for the new synthetic id branches.

## Implementation Notes

- Reuse, don't duplicate: `PlatformAdapter::mounted_volumes()`, `SystemLocation`/`SystemLocationDto`
  discovery plumbing (task 0102), and `pane.ts`'s existing favourite-navigation/unavailable-marking
  logic are all directly reusable — this task is almost entirely "expose existing backend
  discovery through one more surface", not new discovery logic.
- Keep `PlatformCapabilities::MOUNTED_VOLUMES` gating: hosts/adapters without it should surface an
  empty list, not an error, exactly like `runtime_capabilities_dto` gates other optional features.
- The Go menu currently has no separator before its favourite-location items (see
  `goMenu()` in `native-menu-spec.ts`); decide whether the new sections need a separator before the
  first one too for visual grouping against the existing favourites.

## Agent Notes

- 2026-08-16: A same-session sibling change (no task file — small enough to ship directly) added a
  native **Tools** menu (`toolsMenu()` in `native-menu-spec.ts`, between View and Go) listing
  `core.copyName`/`core.copyPath`/`core.copyRelativePath`/`core.openTerminal`/
  `core.revealInSystemFileManager` — all pre-existing registered actions, so it required no
  backend or dispatch changes. Not part of this task's scope; noted here only so this task's Go
  menu changes don't reintroduce/duplicate a Tools section.
