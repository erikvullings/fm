# 0071 Preview service and initial preview panel

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0069

## Context
`file-manager-coding-agent-spec.md` §25 (preview architecture) and §16 milestone 3 (basic file
preview).

## Acceptance Criteria
- A preview service with a renderer registry supporting the initial types: plain text, common image
  formats, file metadata, and an unsupported-file placeholder (§25).
- Preview data is delivered via ranged or streamed reads; entire large files are never loaded into
  frontend memory (§25).
- A configurable file-size limit applies, with a clear "too large to preview" state.
- Previewed files are never executed, and text previews never interpret embedded HTML/script (§25).
- Binary content shown as text is detected and refused rather than rendered as garbage.
- A collapsible preview panel in the UI updates as the cursor moves, with in-flight preview requests
  cancelled on move (§35). **Superseded 2026-08-04**: automatic cursor-driven preview loading was
  explicitly removed by product direction; preview is now triggered only via F3 (task 0088), not
  automatically as the cursor moves. See Agent Notes.
- Markdown, PDF, media metadata, archive summary, syntax highlighting and plugin previews are
  designed for but not implemented; the registry makes adding them additive.
- Tests: renderer selection by MIME/extension, size-limit enforcement, cancellation on cursor move,
  binary detection.

## Implementation Notes
- Reuse `mime_type`/`icon_key` from `EntrySummary` where available, but sniff content rather than
  trusting the extension for the text/binary decision.
- Image previews should use a downscaled/streamed representation rather than the original bytes for
  very large images.

## Agent Notes
- Not started.
- 2026-08-04: The "collapsible preview panel that updates as the cursor moves" acceptance criterion
  above was explicitly reversed by product direction: automatic, cursor-driven preview loading is
  no longer wanted (it fetched file bytes for every entry the cursor passed over, even ones the
  user never intended to view). The renderer/content-preview architecture itself
  ([frontend/src/features/preview/content-preview.ts](../frontend/src/features/preview/content-preview.ts))
  is retained and is now exclusively surfaced through task 0088's F3 (`core.view`) Lister-style
  viewer — preview is opt-in per file, not automatic. The old cursor-driven wrapper
  (`content-preview-loader.ts`, its test, the `.fm-preview-panel` UI in
  [pane.ts](../frontend/src/features/panes/pane.ts) and its wiring in
  [app-shell.ts](../frontend/src/app/app-shell.ts)/[workspace-layout.ts](../frontend/src/features/workspace/workspace-layout.ts))
  were deleted as dead code once nothing called them automatically anymore.
