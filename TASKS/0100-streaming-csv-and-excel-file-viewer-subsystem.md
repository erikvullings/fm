# 0100 Streaming CSV and Excel file viewer subsystem

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend, backend
Depends on: none

## Context
The Tauri/Web file manager currently uses `highlight.js` for internal file previews, which lacks
support for structured tabular data formats (`.csv`, `.tsv`, `.xlsx`, `.xlsb`, `.xls`). The goal
is to implement a high-performance, memory-efficient streaming tabular viewer modeled after Total
Commander's Lister (`less`-like mode) capable of opening multi-gigabyte CSVs and multi-sheet Excel
workbooks without freezing the UI or overflowing memory.

## Acceptance Criteria
- [ ] Implement Rust backend using `memmap2`, `memchr`, and `calamine` to stream tabular data
  on-demand over Tauri IPC.
- [ ] Auto-detect CSV delimiters (`,`, `;`, `\t`, `|`) and handle UTF-8 BOM markers automatically.
- [ ] Parse Excel formats (`.xlsx`, `.xlsb`, `.xls`) using `calamine`, returning sheet names and
  formatted cell values (including properly converted Excel serial dates).
- [ ] Disable column sorting for streamed/large files to avoid full-dataset in-memory loads.
- [ ] Implement frontend virtualization (e.g. TanStack Virtual) to request visible row ranges
  dynamically.
- [ ] Maintain a sticky table header (`<thead>`) that remains anchored while scrolling rows.
- [ ] Provide Excel multi-sheet navigation via bottom tab controls matching modern spreadsheet UX.
- [ ] Support row-level or stream-level keyword filtering evaluated on the backend.

## Implementation Notes

### Architecture Overview
1. **Backend Indexing (`src-tauri/src/viewer/tabular.rs`)**:
   - For CSVs: Memory-map (`memmap2`) the file. Scan newline byte-offsets (`\n`) using `memchr`
     into a `Vec<u64>` index.
   - For Excel (`calamine`): Extract sheet names, row/col bounds, and evaluate cell contents
     (convert `DataType::DateTime` or serial float dates into ISO strings).
   - Delimiter detection: Read initial 4KB buffer and count occurrences of `,`, `;`, `\t`, `|`
     outside quoted strings.
   - BOM Handling: Automatically strip UTF-8 BOM (`0xEF, 0xBB, 0xBF`) on line 0.

2. **Tauri IPC Commands**:
   - `get_tabular_metadata(path: String) -> TabularMeta` (returns format, delimiter, total_rows,
     sheet_names, headers)
   - `get_tabular_chunk(path: String, sheet: Option<String>, start_row: usize, count: usize)
     -> Vec<Vec<String>>`
   - `filter_tabular(path: String, query: String) -> Vec<usize>` (returns matching line indices)

3. **Frontend Component**:
   - Built with virtualized scrolling (TanStack Virtual or lightweight custom virtualizer).
   - Sticky CSS positioning for headers (`position: sticky; top: 0; z-index: 1`).
   - Tab strip aligned at the **bottom** of the viewer for multi-sheet Excel navigation.
   - Rainbow column tinting skipped intentionally to avoid dark/light theme contrast conflicts.

## Agent Notes
- Initial task setup. No execution attempts recorded yet.
- Key constraint: Do not attempt full-file sorting on streamed files - keep memory footprint
  minimal.
