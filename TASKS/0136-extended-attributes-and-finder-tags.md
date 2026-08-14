# 0136 Extended attributes, Finder tags and Spotlight comments editor

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: platform
Depends on: 0058, 0059

## Context

0059's Agent Notes explicitly deferred this: "Finder tags, extended attributes and drag-to-Finder
are declared as out of scope" for the initial macOS integration. Nobody picked it back up since.
Finder tags (colored labels) are one of the more commonly used macOS organizational features, and
reading/writing them (plus generic extended attributes / Spotlight comments) would let fm interop
properly with files a user has already tagged in Finder, rather than only seeing fm's own metadata.

## Acceptance Criteria
- Read Finder tags (`com.apple.metadata:_kMDItemUserTags` xattr) for entries in a directory listing
  and surface them as a column/badge, reusing the existing entry-icon overlay pattern from 0091
  where practical.
- Write/edit Finder tags from fm (assign an existing tag, remove a tag, create a new named tag with
  a color) — round-trips correctly with Finder (a tag set in fm is visible in Finder and vice
  versa).
- Read/edit the Spotlight comment (`kMDItemFinderComment`) for a single entry, surfaced via the
  properties/get-info surface if one exists by the time this is picked up (see 0129's Alt+Enter row
  — no properties dialog exists yet as of this writing; either build a minimal one here or land
  after that dialog exists).
- Windows/Linux: report `extendedAttributes`/`finderTags` capability as `false` rather than
  half-implementing an equivalent — this is explicitly a macOS-first feature (NTFS alternate data
  streams and Linux xattrs are different enough conventions that a shared UI abstraction should wait
  for a second concrete use case).
- Tests: xattr read/write round-trip (macOS-gated), tag color mapping, and capability-reporting
  false on non-macOS platforms.

## Implementation Notes
- Extends `fm-platform-macos`'s existing xattr-adjacent code paths (check what 0059/0091 already
  touch for icon overlays before adding a second xattr-reading code path).
- Finder tag color IDs and the user-tags plist format are undocumented-but-stable; base the
  implementation on existing open-source references (e.g. how `mdls`/`xattr` CLI tools decode them)
  rather than reverse-engineering from scratch.

## Agent Notes
- (none yet)
