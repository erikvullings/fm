# 0055 Sample plugin: Copy Markdown Path

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: plugins
Depends on: 0054

## Context
`file-manager-coding-agent-spec.md` §20 sample plugin 1 and §36 item 9.

## Acceptance Criteria
- `plugins/sample-copy-markdown-path/` contains a manifest and implementation registering the action
  `sample.copyMarkdownPath`.
- The action is available only when exactly one file or directory is selected.
- It produces `[report.pdf](file:///Users/erik/Documents/report.pdf)` using the entry name as link
  text and a file URI (or a configured relative path) as the target.
- It copies the result to the clipboard using only the `clipboard_write` permission and fails
  visibly if that permission is not granted.
- A success notification is shown.
- The action appears in the command palette and context menu without any core code change.
- Special characters in names are correctly escaped for Markdown and percent-encoded in the URI.
- Tests: action availability rules, generated link for names with spaces/parentheses/Unicode,
  permission denial path.

## Implementation Notes
- This plugin exists to demonstrate action registration, context requirements, clipboard permission,
  selected-entry metadata access and notifications (§20) — keep it minimal and readable.

## Agent Notes
- Not started.
