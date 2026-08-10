# 0118 Integrate parallel-disk-usage with WinDirStat Treemap View

Status: open
Priority: high
Subsystem: backend
Depends on: none

## Context

The application needs a disk space analysis feature that calculates filesystem node sizes efficiently and visualizes them in a WinDirStat-style treemap view (cushion treemap / visual block layout of relative file sizes). We will leverage `parallel-disk-usage` as the core engine for high-performance multi-threaded traversal, hardlink handling, and size aggregation, and stream or pass the resulting hierarchical node graph into a UI component capable of rendering a interactive visual treemap.

## Acceptance Criteria

- Integrate `parallel-disk-usage` (or execute as subprocess/library binding) to perform fast multi-threaded disk usage scans over a designated root path.
- Construct a hierarchical JSON/struct tree mapping directories and files to their physical/logical disk usage.
- Map the hierarchical disk structure into a WinDirStat-like treemap UI component (using Squarified Treemap layout algorithm).
- Implement interactive elements: hovering shows file details/size, clicking selects/navigates into the subtree, and color-coding groups files by type/extension.
- Support non-blocking asynchronous scanning so the file manager UI remains responsive during disk traversal.

## Implementation Notes

- **Backend Traversal Engine:** Use `parallel-disk-usage` crate dependency in Rust or parse its `--json-output` stream into internal tree data structures.
- **Treemap Layout:** Implement or integrate a Squarified Treemap layout algorithm to dynamically calculate `(x, y, width, height)` bounding boxes for each file/folder relative to container bounds.
- **UI & Visualization:** Render tree rectangles using canvas/SVG/native drawing commands with color schemes derived from file extensions (e.g., media files, code, executables, archives).
- **Performance Considerations:** Cap maximum display depth or aggregate micro-files (smaller than 0.5% screen area) into a "small files" bucket to prevent rendering bottlenecks.

## Agent Notes

- Initial task setup based on feature request for `parallel-disk-usage` + WinDirStat visual treemap integration.
