# File-copy metadata preservation

Single-file copy streams bytes into a private destination-side temporary file and publishes that
file only after the stream is closed. For a non-overwriting copy, publication uses an atomic
same-filesystem hard-link operation followed by removal of the private name; an existing destination
therefore wins the race without being overwritten. Explicit overwrite uses the platform's rename
replacement semantics.

The local provider preserves the source file's logical contents, last-access time, last-modified
time, and permission object. On Unix this includes the mode bits. Creation/birth time, ownership,
ACLs, extended attributes, alternate data streams, Finder metadata, and platform file flags are not
currently copied. Sparse-file layout is best-effort: the logical bytes and length are preserved, but
the streaming fallback may allocate holes. Symbolic links and directories are rejected by the
single-file operation rather than followed.

The provider advertises timestamp and permission preservation separately. A future provider may
omit either capability and document its own supported subset. Server-side cloning is also
capability-gated. On macOS the local provider first asks `cp -c` for an APFS clone and falls back to
the bounded-memory stream when the volume does not support it. ReFS extent duplication is not yet
available through a safe standard-library API, so Windows currently uses the streaming path.
