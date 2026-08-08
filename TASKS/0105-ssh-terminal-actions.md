# 0005 SSH terminal actions

Status: open
Priority: medium
Subsystem: backend
Depends on: 0003, 0004

## Context
Add terminal and optional remote-command actions to SSH connections without adding shell concepts to `FileSystemProvider`. Initial implementation may launch an external terminal; embedded terminal emulation is not required.

## Acceptance Criteria
- SSH connections expose `Open Terminal` and `Open Terminal Here`.
- From an SFTP tab, `Open Terminal Here` uses the active remote directory where possible.
- Behavior goes through a remote-shell/SSH service, not VFS methods.
- Command/path escaping is safe.
- Credentials are not placed in shell command lines when avoidable.
- Remote command execution, if included, uses structured SSH channels and explicit permissions.
- Actions are capability/context aware.
- Tests mock terminal launch/session creation.

## Implementation Notes
- Reuse `fm-ssh` from 0004 and add `RemoteShellService`.
- External terminal first; embedded terminal later.
- Do not give untrusted plugins arbitrary remote command execution.

## Agent Notes
- Inspect the action registry and current-directory argument handling before implementing UI actions.
