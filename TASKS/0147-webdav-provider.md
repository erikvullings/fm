# 0147 WebDAV provider

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0103, 0108, 0109

## Context

Identified alongside [0146](0146-s3-compatible-object-storage-provider.md) from a competitive
feature scan against ForkLift (2026-08-19 product-page discussion). ForkLift connects to WebDAV
servers directly. fm has SFTP (0104) and FTP/FTPS (0106) but no WebDAV client.

WebDAV is the protocol behind self-hosted Nextcloud/ownCloud instances and a number of managed
storage products, none of which fm's target audience can reach today except by mounting them at
the OS level first (where supported at all — WebDAV OS-mount support is inconsistent across
platforms, unlike the iCloud/OneDrive conventions 0101 already leans on). Same reasoning as 0146:
this is not covered by the "let the OS mount it" logic that froze 0110/0111, because there is no
reliable OS mount to lean on.

## Acceptance Criteria

- New `FileSystemProvider` for WebDAV (RFC 4918), tested against at least one real server
  implementation (e.g. a Nextcloud test container) rather than a hand-rolled fixture only.
- Connection profile: URL, username, password (Basic or Digest auth — WebDAV has no single
  standard auth scheme, so support both), optional path prefix. Credentials stored only as an
  opaque `CredentialStore` reference, matching the SFTP (0104) and FTP (0106) connection profiles.
- `PROPFIND` (depth 1) drives directory listing; `MKCOL`/`PUT`/`GET`/`DELETE`/`MOVE`/`COPY` drive
  the corresponding file operations, dispatched through the shared operation engine.
- `TransferCapabilities` (0108) reports `server_side_move`/`server_side_copy` true (WebDAV's
  native `MOVE`/`COPY` methods), `random_read` true if the server advertises `Range` support
  (probe via response headers, don't assume), `random_write` false.
- TLS certificate validation is real (no blanket accept-all), matching the "host keys/certs are
  never silently accepted" posture the SSH provider (0104) already established.
- Locked-resource responses (WebDAV `LOCK`/423 status) surface as a clear conflict rather than a
  generic failure.
- Provider capability reporting is accurate.
- Integration tests use an isolated WebDAV fixture server, not a live third-party service.

## Implementation Notes

- Suggested crate: `fm-vfs-webdav`, following the `fm-vfs-sftp`/`fm-vfs-ftp` split.
- Check crates.io for an existing maintained Rust WebDAV client before writing one from scratch;
  if nothing suitable exists, this reduces to XML-over-HTTP (`PROPFIND` response parsing) on top of
  `reqwest`, which is already a workspace dependency via the FTP/HTTP paths.
- Reuse `crates/fm-domain/src/location.rs`'s `Parsed*Uri` pattern for a new `webdav://
  <connection-id>/<path>` scheme, mirroring `ParsedSftpUri`.
- Cross-reference [0146](0146-s3-compatible-object-storage-provider.md) — same motivation,
  separate protocol, separate crate, no shared code expected beyond the `FileSystemProvider` trait.

## Agent Notes

- Initial task setup. No execution attempts recorded yet. Before starting, survey the current Rust
  WebDAV client ecosystem on crates.io (last-updated dates, `PROPFIND`/lock support) — this space
  has historically had few well-maintained options, so a build-vs-adopt decision needs a fresh
  check rather than assuming a library exists.
