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
  cancelled on move (§35).
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
