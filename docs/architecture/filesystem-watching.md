# Filesystem watching

Open local directories are watched through `fm-vfs` provider invalidations. Providers do not
construct `DirectoryDelta` values: `fm-application` owns the pane snapshot, revision, filtering,
sorting, diffing, workspace routing, and reset policy.

`fm-vfs-local` uses notify's polling watcher with a bounded callback channel and a 75 ms debounce.
Polling is intentional for the first cross-platform implementation: it gives Linux, macOS, and
Windows the same overflow semantics and avoids depending on a host event-loop integration. A
callback-channel overflow or notify rescan flag becomes `ResetRequired`; the application then
lists the directory again and publishes `DirectoryDelta::Reset` with a fresh snapshot.

Native watcher backends may replace polling after regular Tauri testing is available. Their
platform behavior must remain hidden behind the same invalidation contract:

- macOS FSEvents coalesces changes and can report only that a directory changed. It can also report
  a historical-event gap, which must map to `ResetRequired`.
- Windows `ReadDirectoryChangesW` uses a finite kernel buffer. Buffer overflow loses filenames and
  must map to `ResetRequired`, never a guessed incremental delta.
- Linux inotify reports queue overflow explicitly and has per-user watch limits. Both conditions
  require reset or a surfaced watch-start failure.

Registrations are shared by location and reference-counted. Each pane independently diffs its
filtered/sorted snapshot; the provider watcher is cancelled when the last pane leaves.

Local `EntryId` values are UUIDv5 values derived from filesystem identity (`device + inode` on
Unix, volume serial + file index on Windows), so a rename is emitted as an update rather than a
remove/add pair.
