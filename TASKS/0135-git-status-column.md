# 0135 Git status column/badges

Status: done
Priority: medium
Owner: unassigned
Agent: claude
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
- Prefer `git2` (libgit2 bindings) over shelling out to the `git` CLI for reliability and to avoid
  parsing porcelain output.
- Decide column-vs-plugin placement early: a first-party column is simpler to ship and keep in sync
  with the rest of the table, but a plugin keeps `fm-application` free of a `git2` dependency for
  users who don't want it — check 0053's plugin permission model for whether a plugin can watch the
  filesystem and read arbitrary repo metadata within its granted directory scope before committing
  to the plugin route.

## Agent Notes
- 2026-08-16 claude: Shipped as a first-party column (0053's plugin `HostServices` has no
  filesystem-watch or arbitrary-repo-metadata capability, and columns are only "id + title" from a
  plugin with the value computed host/frontend-side from data already in `EntrySummary` — nowhere
  near enough for stateful, cached, watch-invalidated git2 status, and the task explicitly says this
  should always ship). New crate `crates/fm-vcs-status` (`GitStatusService`) discovers each listed
  directory's git working-tree root via `git2::Repository::discover`, caches that lookup (including
  the "not a working tree" fact) per directory, and computes the whole repo's non-clean paths with
  one `repo.statuses()` walk per repository, cached per repo root and aggregated up to every
  ancestor directory (highest-priority status wins: Modified > Staged > Untracked > Ignored > Clean).
  `fm_domain::GitFileStatus` carries the five states end-to-end through `EntrySummary`,
  `EntrySummaryDto`/`GitFileStatusDto` (OpenAPI-generated), and the frontend `EntrySummary` model.
  `fm-application`'s `DirectoryService` annotates entries right after every `list_all` pass (the
  single per-listing hook all four callers already share) and calls `GitStatusService::invalidate`
  first on every watch-triggered relist (pane watch, poll-tracked relist, `refresh_affected` after
  an operation), so a real change is never served stale while a plain re-navigation reuses the
  cached repo status. Local provider only, gated on `Location::provider_id == "local"`; non-local
  and non-git directories leave `git_status: None` and cost exactly one cached discovery probe.
  Frontend: `core.gitStatus` sits in `INITIAL_COLUMNS` immediately before `core.modified` (always
  rendered, single-letter badge M/S/U/I, blank for clean or `undefined`), styled via
  `--fm-warning`/`--fm-success`/`--fm-accent`/`--fm-text-muted` for theme-aware colors in both modes.
  Verified: 10 new `fm-vcs-status` unit tests (`cargo test -p fm-vcs-status`) covering every git
  state, directory aggregation (including a mixed-priority descendant case), cache reuse until
  `invalidate`, and the non-git fast path; 3 new `fm-application` integration tests against a real
  `git2`-initialized temp repo through `DirectoryService::list`/`refresh_affected`
  (`cargo test -p fm-application directory::`, 18 passed); full `cargo test --workspace` (all green
  after fixing two more `EntrySummary` literals this touched); `cargo fmt --all --check` and
  `cargo clippy --workspace --all-targets -- -D warnings` clean. One `fm-application` integration
  test (`conflict_resolution::a_destination_appearing_after_planning_is_resolved_like_an_initial_conflict`)
  failed once under heavy concurrent CPU load from another active worktree session and passed cleanly
  on retry in isolation — a pre-existing timing flake, not a regression from this change. Frontend:
  47 tests in `directory-table.test.ts` (2 pre-existing column-count assertions updated for the new
  column, 1 new test added) plus the full `pnpm test:frontend` (1124 passed); `tsc --noEmit` and
  `biome check` clean (one pre-existing, unrelated `noDescendingSpecificity` warning in
  `theme.css`). OpenAPI spec and the Orval client were regenerated (`pnpm api:export && pnpm
  api:generate`).
