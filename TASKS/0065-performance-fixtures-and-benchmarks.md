# 0065 Performance fixtures and benchmarks

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: testing
Depends on: 0027, 0040

## Context
`file-manager-coding-agent-spec.md` §28 — benchmark fixtures and performance objectives.

## Acceptance Criteria
- `scripts/create-large-directory-fixture.rs` (or an equivalent cargo xtask) generates fixtures for:
  1,000 / 10,000 / 100,000 entries, 10,000 small files to copy, one multi-gigabyte sparse or
  generated file, deeply nested directories, and directories with long Unicode names.
- Fixtures are created under a temp/ignored path, are reproducible, and are never committed as
  binary blobs.
- Rust benchmarks (criterion) for: directory listing throughput, plan enumeration of a large tree,
  copy throughput for many small files, and Location parsing.
- Frontend rendering measurements for the virtualized table: time-to-first-paint of a directory,
  scroll frame timings, and DOM node count under load.
- Measured results for each §28 objective are recorded in `docs/architecture/performance.md` with
  the machine and dataset used — including the mocked 1,000,000-entry case.
- A CI job runs a reduced benchmark set and fails on a large regression (thresholds documented, not
  flaky).

## Implementation Notes
- The 1,000,000-entry case uses the mock client (0013); do not create a million real files in CI.
- Benchmarks measure, they do not gate correctness — keep them separate from the test suite.

## Agent Notes
- Not started.
