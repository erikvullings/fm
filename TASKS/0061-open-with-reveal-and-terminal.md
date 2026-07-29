# 0061 Open with default application, reveal in file manager, open terminal

Status: open
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
- Not started.
