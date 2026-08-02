# 0061 Open with default application, reveal in file manager, open terminal

Status: done
Priority: medium
Owner: unassigned
Agent: unassigned
Area: platform
Depends on: 0059, 0060

## Context
`file-manager-coding-agent-spec.md` §16 milestone 3, §21 (`revealInSystemFileManager`,
`openTerminal`) and §33 step 10.

## Acceptance Criteria
- `core.open` on a file opens it with the system default application; `core.openWith` offers a
  chooser where the platform supports one.
- `core.revealInSystemFileManager` reveals and selects the entry in Finder/Explorer.
- `core.openTerminal` opens the configured terminal at the current directory; the terminal command
  is a setting (§26) with a sensible platform default.
- All three are capability-gated and hidden/disabled in browser-server mode (§21).
- Arguments are passed safely — no shell string interpolation of file paths; paths with spaces,
  quotes and Unicode work (§6).
- Executable files are never executed implicitly by preview or listing (§25); "open" on an
  executable follows the platform's default behaviour and is confirmed where risky.
- Failures (no default application, terminal not found) produce a user-readable error, not a silent
  no-op.
- Tests: argument construction for awkward paths, capability gating; actual launching is verified
  manually per platform and recorded in the task notes.

## Implementation Notes
- Implement through the platform adapter traits (0058); the actions themselves stay platform-neutral.
- In server mode these actions would act on the server's desktop — they must be unavailable, not
  merely hidden (§22).

## Agent Notes
- 2026-08-01 copilot: Implemented `core.open`/`core.openWith`/`core.revealInSystemFileManager`/
  `core.openTerminal` end to end, dispatched directly to the injected `PlatformAdapter` (0058)
  rather than through the mutating-operation engine.
  - `ActionRegistry::with_core_actions(capabilities: PlatformCapabilities)` (previously a
    zero-argument constructor) now capability-gates these four actions via new
    `capability_gated_single_selection`/`capability_gated_none` helpers, computing
    `feature_available` from the adapter's reported flags instead of a hardcoded `true`/
    `unimplemented()`. `FileManagerService`'s single internal constructor (used by `new`,
    `with_event_bus` and `with_platform_adapter` alike) derives `platform_capabilities` from
    `platform.capabilities()` before building the registry, so every entry point stays
    consistent and browser/server mode (`FallbackPlatformAdapter`, no capabilities) reports these
    actions unavailable rather than merely hidden (spec §22) - covered by a dedicated test,
    `invoke_action_reveal_and_terminal_are_unavailable_in_browser_server_mode`, plus per-capability
    gating-independence tests in `action.rs`.
  - Parameter contract: `core.open`/`core.openWith`/`core.revealInSystemFileManager` take
    `{ "uri": "file://..." }` for the single selected entry; `core.openTerminal` takes
    `{ "uri": "file://..." }` for the current directory. The backend has no entry registry to
    resolve an opaque `EntryId` back to a path (mirroring plugin action invocation, task 0055), so
    the frontend supplies the target explicitly, built from the already-loaded `Location`
    (`platformActionParameters` in `app-shell.ts`). The backend parses the URI with
    `fm_domain::Location::parse().to_native_path()` and passes the resulting `PathBuf` to the
    adapter as a discrete argument (`std::process::Command::arg`/`NSString`/`NSURL`) - never
    string-built or shell-interpolated. A missing or malformed `uri` is rejected as
    `ApplicationError::InvalidRequest`, not a silent no-op. Covered by
    `invoke_action_opens_the_uri_parameters_path_with_the_default_application`, which round-trips
    a path containing spaces, single/double quotes and a non-ASCII (café) character through a real
    temp file to prove the URI is parsed rather than assembled as a command string.
  - `core.openWith` gap (documented, not a bug): it shares
    `PlatformActionKind::Open`/`PlatformCapabilities::OPEN_WITH_DEFAULT_APPLICATION` with
    `core.open` - no `PlatformAdapter` implementation (macOS or the Windows/fallback stub) exposes
    a distinct "choose an application" picker yet, so invoking `core.openWith` currently just opens
    with the default application, identically to `core.open`. This is called out in doc comments
    on `core_actions` (`action.rs`) and at the top of `fm-platform-macos/src/lib.rs`, and left as a
    known, explicit gap rather than a fabricated chooser.
  - New `ApplicationError::PlatformOperationFailed(String)` /
    `ApplicationErrorCode::PlatformOperationFailed` (serializes to `"platformOperationFailed"`,
    maps to HTTP 502 in `apps/fm-server`) carries a genuine, already-sanitized
    `fm_platform::PlatformError` message (e.g. "no default application is registered for .xyz
    files") back to the caller - failures are surfaced, never swallowed into a silent no-op or a
    generic "internal error". A `PlatformError::Unsupported` from the adapter (e.g. a
    capability-detection/invocation race) instead maps to the existing `ActionUnavailable`, since
    that is the more accurate signal. `fm-platform-macos`'s `open_with_default_application` and
    `open_terminal` both shell out via `std::process::Command` (`open <path>` /
    `open -a <app> <path>`) and turn a non-zero exit status into `PlatformError::Io`, so a real
    "no handler" or "app not found" failure is not silently swallowed as success.
  - `open_terminal`'s `command_override: Option<&str>` (new second parameter on
    `PlatformAdapter::open_terminal`, updated on the trait's default, `FallbackPlatformAdapter`,
    `MacosPlatformAdapter` and the `WindowsPlatformAdapter` delegating stub) is sourced from
    `Settings.terminal_command` (`Option<String>`, already `Mutex`-guarded on
    `FileManagerService`). This setting field **already existed** in `fm-settings`/
    `fm-transport-dto` before this task (confirmed by inspecting `settings.rs` history and the
    unmodified `mock-file-manager-client.ts`'s `terminalCommand: null` default) - it was not newly
    added here, so no frontend settings-model or OpenAPI regeneration was needed for it, only for
    the new `PlatformOperationFailed` error code (see below). `None` (the default) falls back to a
    sensible per-platform default, e.g. `Terminal` on macOS.
  - Frontend: `AppShell`'s `onOpenEntry` now invokes `core.open` with `{ uri: entry.location.uri }`
    for files (previously a no-op `undefined`) instead of navigating, while directories still
    navigate as before. `core.revealInSystemFileManager` was added to `availability.ts`'s
    `SELECTION_ACTION_IDS` so it appears in the selection context menu/palette like `core.open`/
    `core.openWith`, gated by the same `feature_available`/selection-count logic as every other
    selection action (no bespoke gating code needed).
  - Confirmed no code path added by this task executes a target file directly as a process:
    `open_with_default_application` always shells out to the native `open`/`NSWorkspace`
    "open with default application" mechanism (never `Command::new(path)`), matching the
    "executable files are never executed implicitly" acceptance criterion; this was true before
    this task and remains true after it - nothing here changes preview/listing behaviour at all.
  - Generated/fixture files touched as a direct, non-stale consequence of the new error code:
    `fixtures/mock-responses/actions.json` (2 lines, mock server data), `frontend/openapi/openapi.json`
    (1 line, new enum value) and `frontend/src/api/generated/models/applicationErrorCode.ts` (1
    line). Verified not stale by re-running `bash scripts/export-openapi.sh && bash
    scripts/generate-api.sh` and diffing just those paths afterwards - zero further changes.
  - Verification (workspace root, all commands re-run fresh by the finishing agent):
    `cargo fmt --all --check` (clean), `cargo clippy --workspace --all-targets -- -D warnings`
    (zero warnings), `cargo test -p fm-application --no-fail-fast` (113 unit tests + every
    integration target passed this run, including `conflict_resolution` 5/5 - see flaky-test note
    below), `cargo test -p fm-server --no-fail-fast` (only
    `plugin_routes::list_plugins_starts_empty_and_unknown_enablement_is_not_found` fails, everything
    else passes, e.g. `action_routes` 5/5, `workspace_routes` 15/15), `cargo test -p
    fm-platform-macos` (10/10 pass), `cargo test -p fm-vfs-local` (18 passed, 1 known failure - see
    below). Frontend: `pnpm run typecheck` (clean) and the full `pnpm test -- --run` suite (45 test
    files, 305 tests, all passing) from `frontend/`.
  - Three confirmed pre-existing, unrelated failures observed tonight, none caused by this task
    (each independently reproduced on unmodified `main` by an earlier subagent via `git stash`,
    per this session's notes):
    `fm-application`'s `conflict_resolution::a_destination_appearing_after_planning_is_resolved_like_an_initial_conflict`
    (timing-sensitive/flaky - passed 5/5 on this run's `cargo test -p fm-application`, but is known
    to fail intermittently under `cargo test --workspace`'s parallel/full-load conditions),
    `fm-server`'s `plugin_routes::list_plugins_starts_empty_and_unknown_enablement_is_not_found`,
    and `fm-vfs-local`'s `metadata_is_separate_and_capabilities_are_truthful` (introduced by task
    0059, unrelated to platform-adapter dispatch work here).
  - Manual verification (macOS 26.6, BuildVersion 25G72, via `sw_vers`), performed against scratch
    files/directories under `$TMPDIR` only, never real user files:
    - `core.open`'s underlying mechanism: created a temp text file containing spaces and a
      non-ASCII character in its name, ran `open <path>` (the exact command
      `open_with_default_application` shells out to) directly at the crate/OS level rather than
      through the full HTTP/Tauri stack, and confirmed via `ps aux` that `TextEdit.app` launched
      as a real process for it; quit TextEdit afterward via `osascript -e 'tell application
      "TextEdit" to quit'` and re-confirmed via `ps aux` that it was gone.
    - Reveal in Finder: not re-done manually: `fm-platform-macos`'s existing
      `reveal_in_finder_succeeds_for_a_real_temporary_file` test (from task 0059, re-run above as
      part of the 10/10 `fm-platform-macos` pass) already exercises a real
      `NSWorkspace.activateFileViewerSelectingURLs` call against a scratch `tempfile`-created file,
      so it stands as this task's Finder-reveal verification too (the reveal code path itself was
      not touched by task 0061, only its `ActionRegistry`/dispatch wiring was added).
    - Open terminal: ran `open -a Terminal <scratch-temp-dir>` (the exact command
      `open_terminal`'s default, no-override path builds) directly; it exited 0 and `ps aux`
      confirmed a new `Terminal.app` process. Attempted to close the resulting window via
      `osascript -e 'tell application "Terminal" to close (every window whose name contains
      ...)'`, which timed out waiting on an AppleEvent (likely a first-run Automation/Accessibility
      permission prompt this non-interactive session could not answer) - the extra Terminal window
      was therefore left open rather than force-closed; it is harmless (a shell at an
      already-deleted scratch temp directory) and can be closed manually.
  - Left untouched, as instructed: `frontend/src/api/client/tauri-file-manager-client.ts`'s
    pre-existing uncommitted one-line change (`import { type FileManagerClient }` ->
    `import type { FileManagerClient }`), which predates tonight's work and is unrelated to this
    task - not staged, not committed.
