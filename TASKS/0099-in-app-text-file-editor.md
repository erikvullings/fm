# 0099 In-app text file editor with Markdown preview

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: cross-cutting
Depends on: 0088

## Context
Add safe, simple in-app editing for text-like files such as plain text, Markdown, XML, JSON and
GeoJSON. The existing `core.edit`/F4 flow from 0086 launches an external text editor, while 0088
provides an in-app, ranged-read viewer for large files. This task must decide the product entry
point explicitly: either change F4 to open the in-app editor for supported files with an external
editor fallback, or add a distinct in-app action while preserving F4's current contract.

Monaco is a candidate because it provides mature language modes and editing behaviour, but its
bundle size and worker setup may be excessive for this file manager. Evaluate it against at least
one lighter alternative before implementation. Markdown editing should offer an instant preview;
`slimdown-js` is the preferred lightweight parser, subject to its incomplete CommonMark support
and the requirement to sanitize its HTML output.

## Acceptance Criteria
- A short decision record compares Monaco with at least one lighter editor on bundle size,
  accessibility, Mithril integration, language support, worker/runtime complexity and maintenance,
  and records the chosen editor before the dependency is added.
- Supported text-like files open in an in-app editor with appropriate language mode where
  available, covering at least `.txt`, `.md`/`.markdown`, `.xml`, `.json` and `.geojson`.
  Unsupported/binary files fail safely or retain the existing external-editor fallback.
- Loading is bounded by a configurable editable-file size limit. Large files continue to use the
  0088 viewer/external editor rather than being loaded wholesale into frontend memory, with a
  clear explanation to the user.
- Add a host-agnostic application/VFS write contract and thin REST and Tauri adapters with matching
  behaviour. Saving uses safe replacement semantics (write a sibling temporary file, flush as
  appropriate, then replace) and never silently follows symlinks or overwrites a file that changed
  externally after it was loaded.
- The load response carries a revision token or equivalent metadata. Save detects stale content
  and presents an explicit reload/overwrite/save-as/cancel resolution rather than silently losing
  either version. Any explicit overwrite is auditable and tested.
- Dirty state is visible. Closing the editor, replacing its pane, navigating away or closing the
  app with unsaved changes requires a discard/save/cancel decision. Save progress and errors are
  shown without discarding the editable buffer.
- JSON and GeoJSON can be formatted and receive syntax diagnostics from the selected editor when
  supported; invalid content remains editable and is never silently rewritten on save.
- Markdown files support an instant, toggleable or split preview powered by `slimdown-js` unless
  the decision record rejects it with a documented reason. Preview updates are debounced, raw
  Markdown is treated as untrusted, rendered HTML is sanitized before DOM insertion, and links or
  images cannot execute script or bypass the server-mode security boundary.
- Editor keyboard handling coexists with global shortcuts: normal text-editing commands and undo/
  redo stay inside the editor, while intentionally global commands remain discoverable. The UI is
  keyboard accessible and respects existing theme tokens.
- Tests cover type detection, size/binary refusal, read/save parity for HTTP and Tauri, atomic-save
  failure, external-modification conflict, dirty-close decisions, editor shortcut isolation and
  safe/debounced Markdown preview rendering.

## Implementation Notes
- Reuse 0088's file viewer surface and ranged-read/type-detection infrastructure where it reduces
  duplication, but do not turn the large-file viewer into an unbounded editor. Check 0071 for the
  preview renderer boundary before adding competing preview logic.
- `slimdown-js` is a small regex-based Markdown renderer rather than a full CommonMark/GFM parser.
  Its `render(markdown)` output is HTML and it does not escape raw HTML by default, so use a proven
  sanitizer (for example DOMPurify with a restrictive policy); parser output must never be assigned
  directly to trusted HTML. Test code fences and raw HTML/script payloads specifically.
- Keep application logic in a controller/state module, not the Mithril editor component. Ensure
  long-running reads/saves and preview updates can be cancelled or superseded.
- Do not hand-edit `frontend/openapi/openapi.json` or `frontend/src/api/`; regenerate both after
  adding transport DTOs/endpoints.
- Decide whether save participates in the operation engine/history or is a focused content-write
  command. Whichever is chosen must preserve browser/Tauri parity and the repository's rule against
  silent overwrite.

## Agent Notes
- 2026-08-05 codex: Created as a follow-up to 0086 (external F4 edit) and 0088 (in-app ranged
  viewer). Dependency is only 0088 because its final UI/controller contract should be settled
  before the editor reuses or extends it. The editor-library and F4-entry-point choices are
  intentionally left as recorded design decisions rather than prematurely fixed in this task.
