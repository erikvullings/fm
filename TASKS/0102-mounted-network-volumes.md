# 0002 Mounted network volumes

Status: open
Priority: high
Subsystem: backend
Depends on: 0001

## Context
Add discovery and presentation of network filesystems already mounted by the OS, with SMB/Samba on macOS as the primary use case. Do not implement SMB itself: mounted shares use the existing local provider.

## Acceptance Criteria
- Mounted network volumes are detected by platform adapters.
- Network volumes appear separately from ordinary local/removable volumes.
- Mounted SMB shares open through the local provider.
- Disappearing/unavailable shares leave tabs recoverable rather than crashing/closing.
- Read-only mounts are respected where detectable.
- No native SMB dependency is introduced.
- Tests cover mapping and disappearance/unavailability.

## Implementation Notes
- Extend 0001's `SystemLocationProvider` pipeline.
- Add optional protocol/server/share/read-only metadata.
- Prefer platform metadata over assuming every `/Volumes/*` item is SMB.
- Keep optional OS-level “Mount share…” action out of scope initially.

## Agent Notes
- Reuse 0001's location-discovery model; do not create a second sidebar model for shares.
