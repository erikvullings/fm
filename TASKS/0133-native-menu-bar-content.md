# 0133 Populate native menu bar content (macOS + Windows)

Status: in-progress (automated phase complete, manual testing required)
Priority: high
Owner: unassigned
Agent: claude
Area: desktop
Depends on: 0059

## Context

`PlatformAdapter::install_native_menu` (`crates/fm-platform/src/adapter.rs`) is a hook-point-only
trait method. On macOS (0059) it acquires the `MainThreadMarker`, creates an `NSMenu`, and installs
it as the app's main menu via `NSApplication::sharedApplication().setMainMenu(...)` — but the menu
is **empty**. There is no File/Edit/View/Go/Window/Help structure, no OS-level `Cmd+,` Preferences
item, no populated Window menu (so Mission Control / Cmd+backtick window switching shows a generic
app entry instead of real menu items), and no dynamic "Open Recent" in the Dock menu. On Windows,
the hook doesn't exist yet at all — see 0131, still open.

Raised during a review of macOS integration gaps: fm's context menus and command palette (0051,
0052) cover in-app discovery well, but the OS-level menu bar — which macOS users expect to reflect
the app's capabilities and which text fields/inputs rely on for their built-in Edit menu wiring
(cut/copy/paste/undo working in native text fields) — is currently a no-op.

## Acceptance Criteria
- macOS: a real menu bar with standard sections — App menu (About, Preferences `Cmd+,`, Services,
  Hide/Quit), File (New window/tab, Close), Edit (Undo/Redo/Cut/Copy/Paste/Select All — wire to the
  same actions as 0049's action registry so behaviour matches the keyboard shortcuts already bound),
  View, Go (favourites/recent locations from 0070), Window (Minimize, Zoom, real window list), Help.
- Menu items that duplicate an existing action-registry command (0049/0050) dispatch through the
  same action id as the keyboard shortcut, not a separate code path — no divergent behaviour between
  pressing `Cmd+,` from the keyboard and clicking "Preferences…" in the menu.
- Windows: once 0131's hook lands, an equivalent `HMENU`-based menu bar with the same logical
  sections adapted to Windows conventions (File/Edit/View/Go/Window/Help, no separate App menu).
- The Window menu (macOS) or equivalent reflects actual open windows/workspaces, not a static list.
- "Open Recent" (or equivalent) reflects 0070's recent-locations list.
- Menu content updates when action availability changes (e.g. Undo disabled when there's nothing to
  undo), following whatever pattern 0052's context-menu availability checks already use.
- Tests: platform adapter unit tests asserting menu structure/item ids where feasible without a real
  windowing system; manual verification recorded for both platforms (native UI trees are hard to
  assert against in CI).

## Implementation Notes
- Reuse the action registry (0049) as the source of truth for menu item labels/shortcuts/enabled
  state rather than hand-maintaining a parallel list — the command palette (0051) already does this
  and is a good reference implementation.
- Keep menu construction behind the existing `PlatformAdapter` trait; don't leak `NSMenu`/`HMENU`
  types outside `fm-platform-macos`/`fm-platform-windows`.
- The Windows half is blocked on 0131 (hook point) landing first, or can be scoped together with it
  in one PR if picked up jointly.

## Agent Notes
- 2026-08-15 claude: Implemented the macOS half end-to-end; Windows explicitly deferred (see
  below). Scope and two architectural decisions were confirmed with the user before implementation
  (not guessed): (1) macOS only in this task, Windows left as a documented gap pending 0131, which
  is still open/unstarted; (2) menu content/availability is computed entirely on the frontend
  (which already has tested availability logic in `frontend/src/features/commands/availability.ts`)
  and pushed to Rust as a plain spec — Rust never re-derives menu content, it only renders whatever
  tree it's handed. A third gap surfaced during implementation: the Edit menu's acceptance-criteria
  wording names Undo/Redo/Cut, none of which exist anywhere in this codebase (no undo-stack
  feature, no cut action) — confirmed with the user to omit them rather than invent placeholders;
  the Edit menu ships Copy/Paste/Select All only (native AppKit still gives Cut/Copy/Paste/Undo for
  free inside text fields via the standard responder chain). Preferences has no backend action
  either (`Cmd+,` was already frontend-only, calling `openSettingsDialog()` directly) — the native
  menu's Preferences item carries a synthetic `ui.openSettings` id routed to the same call, not a
  registry dispatch.
  - **fm-domain** (`crates/fm-domain/src/menu.rs`, new): `NativeMenuSpec`/`NativeMenu`/
    `NativeMenuItem`/`NativeMenuRole`, serializable, camelCase, pinned by explicit
    `serde_json::to_string` assertions (not just round-trip) since the frontend hand-writes
    matching TS types against this exact shape. `NativeMenuItem::Role` is a struct variant
    (`Role { role: NativeMenuRole }`), not a newtype — serde's internally-tagged representation
    can't nest a newtype's own unit-variant serialization under a field, so a newtype here would
    silently produce `{"kind":"role","quit":null}` instead of `{"kind":"role","role":"quit"}`; this
    was caught and fixed during integration (see below).
  - **fm-platform** (`adapter.rs`, `fallback.rs`, `Cargo.toml`): `install_native_menu` now takes
    `(&NativeMenuSpec, on_action: Arc<dyn Fn(String) + Send + Sync>)`; added an `fm-domain`
    dependency (layer 0 → layer 1, allowed by the architecture fitness test).
  - **fm-platform-macos** (`lib.rs`): real `NSMenu`/`NSMenuItem` construction from the spec via
    objc2's `define_class!` (a `MenuActionTarget` NSObject subclass handles every `Action` item's
    click through one process-wide callback slot — documented in-code as an honest design, since
    there is only ever one native menu bar per process). `Role` items get no callback at all: nil
    target routes them through the standard first-responder chain (`terminate:`, `hide:`,
    `orderFrontStandardAboutPanel:`, etc.), and `Services` registers its submenu via
    `NSApplication::setServicesMenu`. `key_equivalent` (KeyChord → key + `NSEventModifierFlags`
    bits) is factored out as a pure function specifically so it's unit-testable without a real
    windowing system — full `NSMenu` construction itself isn't (no windowing system in CI),
    matching the task's own acknowledgement of this limit.
  - **fm-platform-windows** (`lib.rs`): signature updated to match, still delegates to the fallback
    adapter (`Unsupported`) — no menu content, per the confirmed decision above.
  - **fm-application** (`service.rs`, `platform_mapping.rs`): thin `FileManagerService::
    install_native_menu` passthrough plus `map_native_menu_error`, following the exact convention
    already used by `file_icon`/`map_file_icon_error`.
  - **fm-desktop** (`native_menu.rs` new, `commands.rs`, `lib.rs`): two Tauri commands —
    `subscribe_native_menu_actions` (frontend subscribes a `Channel` once at startup) and
    `set_native_menu` (rebuilds the whole menu from a pushed spec, via the same
    `run_on_main_thread` + oneshot pattern already used by `start_native_drag`, since AppKit menu
    APIs require the main thread). No DTO mirror was added in `fm-transport-dto` — this isn't
    exposed over HTTP/OpenAPI, so the Tauri command takes `fm_domain::NativeMenuSpec` directly.
  - **Frontend** (`frontend/src/models/native-menu.ts`, `frontend/src/features/native-menu/*`,
    `app-shell.ts`): `buildNativeMenuSpec` (pure) builds the full menu tree from
    `registeredActions`/`favouriteActions()`/open tabs; `dispatchNativeMenuAction` routes incoming
    clicks to `openSettingsDialog()`, tab activation, or `actionCommandController
    .invokePaletteAction` (the same dispatch path the command palette already uses, satisfying the
    "no divergent behaviour" acceptance criterion). Menu sync uses a memoized `syncNativeMenu()`
    called from the existing state-mutation sites in `app-shell.ts` (not a genuine Meiosis service —
    confirmed with the user that `frontend/src/state/store.ts`'s Meiosis store isn't actually wired
    into `app-shell.ts`'s runtime, so this is the faithful equivalent: recompute on relevant change,
    skip the IPC call if the computed spec is unchanged from the last one sent). View menu content
    (no dedicated "view" category exists in the registry) uses the five sort-order toggle actions;
    Window menu flattens tabs across all panes with no pane-name prefixing — both judgment calls,
    called out here for future revisit rather than left silently undocumented.
  - **Integration fix**: two agents built the Rust and frontend halves in parallel against a fixed
    contract. The frontend caught a real bug in the originally-specified Rust `Role(NativeMenuRole)`
    newtype shape (documented above) and built against the corrected struct-variant shape; the
    fix was applied to `fm-domain` and `fm-platform-macos` during integration.
  - Tests (verified via targeted `cargo test`/`vitest run` invocations, not whole-suite totals):
    `fm-domain` 5 new (`menu::tests::*`), `fm-platform-macos` 2 new pure-function tests
    (`key_equivalent_*`), `fm-application` 1 new (`install_native_menu_forwards_the_spec_and_maps_
    adapter_failures`), `fm-desktop` 3 new (`native_menu_action_callback_*`,
    `native_menu::tests::has_no_subscription_until_one_is_set_then_returns_the_latest_one`),
    frontend 15 new (`native-menu-spec.test.ts` 11, `native-menu-dispatch.test.ts` 4). Full affected
    suites also re-run and green: `fm-domain`/`fm-platform`/`fm-platform-macos`(27 passed, 1
    pre-existing ignored)/`fm-platform-windows`/`fm-application`/`fm-desktop` lib and integration
    tests, the `fm-test-support` architecture fitness test (confirms the new `fm-platform` →
    `fm-domain` dependency respects crate layering), and the full frontend `vitest run` (1112
    passed) plus `tsc --noEmit` (clean). `cargo clippy --all-targets` clean across every touched
    crate (fixed a `missing_docs`, a `type_complexity` on the process-wide callback static, two
    `doc_lazy_continuation` formatting issues, and one `cloned_ref_to_slice_refs` along the way). A
    `copy_directory_operation` integration test flaked once under heavy concurrent build load
    (timing-sensitive, unrelated file) and passed cleanly in isolation on retest.
  - **Known gap**: manual visual verification of the actual running macOS menu bar was not
    performed by the agent — this sandboxed session has no screen-recording/automation permission
    (`osascript`/`screencapture` calls hang on a permission prompt with no way to grant it
    non-interactively), confirmed with the user, who will do a `pnpm run dev:tauri` visual check
    themselves. Everything short of that visual check (compilation, unit/integration tests,
    lint, architecture fitness, an actual `fm-desktop` boot test asserting the Tauri runtime starts
    with the new commands registered) is green.
  - **Follow-up**: Windows menu content (task 0131, still open/unstarted).
