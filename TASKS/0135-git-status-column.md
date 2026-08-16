# 0135 Git status column/badges

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: cross-cutting
Depends on: 0056

## Context

A per-entry git status indicator (modified/staged/untracked/ignored/clean) is a common
differentiator in file managers aimed at developers — Marta, ForkLift, and Directory Opus all offer
it. No task in `TASKS/` covers this today. It's a natural fit for the existing plugin column
system (0056's sample "File Age column" plugin already demonstrates the extension point) — this
could ship either as a first-party column (always available) or as a reference plugin that
showcases the column API for third-party authors, matching the "sample plugin" pattern from 0055/
0056.

## Acceptance Criteria

- For any directory inside a git working tree (local provider only — remote/archive providers are
  out of scope), each entry's row gains a status indicator: modified, staged, untracked, ignored,
  or clean/unmodified, matching `git status --porcelain` semantics.
- Status is computed per-directory-listing (not one `git status` invocation per row) and cached,
  invalidated on filesystem-watch events (0020) touching the working tree.
- Directories aggregate their descendants' status (e.g. a folder containing a modified file shows a
  "contains changes" indicator), matching common IDE file-tree conventions.
- No performance regression on large non-git directories: the git check is skipped entirely once a
  directory is confirmed outside any working tree (cache that fact, don't re-probe every listing).
- Tests: status computation for each git state, aggregation up the tree, cache invalidation on file
  change, and a no-op fast path for non-git directories.

## Implementation Notes

- This feature should always ship. Should be displayed as a single letter column, before the
  Modified column. Should only be displayed in .git folders.
- Prefer `git2` (libgit2 bindings) over shelling out to the `git` CLI for reliability and to avoid
  parsing porcelain output.
- Decide column-vs-plugin placement early: a first-party column is simpler to ship and keep in sync
  with the rest of the table, but a plugin keeps `fm-application` free of a `git2` dependency for
  users who don't want it — check 0053's plugin permission model for whether a plugin can watch the
  filesystem and read arbitrary repo metadata within its granted directory scope before committing
  to the plugin route.

## Agent Notes

- (none yet)
