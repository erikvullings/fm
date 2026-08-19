# 0148 Application deleter (macOS)

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: cross-cutting
Depends on: 0059, 0061

## Context

Identified from a competitive feature scan against ForkLift (2026-08-19 product-page discussion).
ForkLift can uninstall a macOS app along with its scattered support files; plain drag-to-Trash on
macOS only removes the `.app` bundle and leaves preferences, caches, application-support data, and
launch agents behind.

This is a macOS-specific win — Windows already has a real uninstaller convention (Programs &
Features / MSI uninstall) and Linux has package-manager removal, so neither platform has the same
gap. Scope this as a macOS-only feature behind the existing capability-flag pattern
(`PlatformCapabilities`), not a cross-platform subsystem.

## Acceptance Criteria

- A new action (e.g. `core.uninstallApplication`), available only when the selected entry is a
  `.app` bundle on macOS (gated by a new `PlatformCapabilities::APPLICATION_UNINSTALL` bit or
  equivalent, following the existing capability-gating pattern used for Trash/Reveal/Open-With in
  `crates/fm-application/src/action.rs`).
- Related-file discovery scans well-known locations for files/folders whose name matches the app's
  bundle identifier (`CFBundleIdentifier` from `Info.plist`) or product name: `~/Library/
  Application Support/`, `~/Library/Caches/`, `~/Library/Preferences/` (`.plist` files), `~/
  Library/Saved Application State/`, `~/Library/LaunchAgents/` and `/Library/LaunchAgents/` (listed
  only — writing to `/Library` requires elevation, out of scope for this task), `~/Library/Logs/`.
- The user reviews a checklist of discovered related files (each with its path and size) **before**
  anything is deleted — matching, an explicit confirm-then-act flow, not a scan of an entire
  filesystem, silent auto-delete. Nothing outside the well-known locations above is ever touched.
- Deletion goes through the same Trash/Recycle-Bin-first path as every other delete in the app
  (0061's `TRASH` capability), not a permanent unlink — an accidental match should be recoverable.
- False-positive risk is handled conservatively: prefer under-matching (miss a stray file) over
  over-matching (catch an unrelated file that happens to share a name fragment) — match on exact
  bundle identifier where available, and require a whole-path-segment match rather than a substring
  match when falling back to product-name matching.
- Tests: bundle-identifier extraction from a fixture `Info.plist`, related-file discovery against a
  fixture directory tree (including a deliberate false-positive case that must NOT match), and the
  confirm-then-trash flow.

## Implementation Notes

- `Info.plist` parsing: macOS `.app` bundles are directories: `<AppName>.app/Contents/Info.plist`.
  A `plist` crate (already common in the Rust ecosystem) reads `CFBundleIdentifier` /
  `CFBundleName` without shelling out.
- This is a self-contained, additive feature — no changes to the operation engine's core
  copy/move/delete semantics, just a new discovery step that produces a list of `Location`s to feed
  into the existing delete-to-Trash path.
- Consider whether the review checklist reuses the existing multi-selection Properties/delete-
  confirmation UI patterns rather than inventing new dialog chrome.

## Agent Notes

- Initial task setup. No execution attempts recorded yet.
