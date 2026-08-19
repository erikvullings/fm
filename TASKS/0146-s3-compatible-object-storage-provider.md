# 0146 S3-compatible object storage provider

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0103, 0108, 0109

## Context

Identified from a competitive feature scan against ForkLift (2026-08-19 product-page discussion).
ForkLift connects directly to Amazon S3, Backblaze B2, Rackspace CloudFiles and other S3-API
buckets as first-class remote locations. fm has SFTP (0104) and FTP/FTPS (0106), but nothing that
speaks the S3 API.

This is a genuinely different case from the frozen OneDrive/SMB providers (0110/0111): those are
parked because the OS already mounts them as regular folders, so a bespoke API client buys little.
Object storage buckets (S3, Backblaze B2, Cloudflare R2, DigitalOcean Spaces, MinIO — all speak the
same S3-compatible API) have **no** OS-native mount without a third-party tool (e.g. Mountain Duck,
`s3fs`), so "let the OS mount it" doesn't apply here. Given fm's existing audience — SSH/SFTP,
keyboard-first, dev/ops-leaning — buckets are plausibly a more relevant remote target than the
frozen consumer-cloud providers.

## Acceptance Criteria

- New `FileSystemProvider` for S3-compatible object storage (works against real AWS S3 and at
  least one non-AWS S3-compatible endpoint — e.g. MinIO or Cloudflare R2 — via a configurable
  endpoint URL, not hardcoded to `amazonaws.com`).
- Connection profile: access key id, secret access key, region, endpoint URL (optional, defaults
  to AWS), bucket, and optional path prefix. Credentials stored only as an opaque `CredentialStore`
  reference (macOS Keychain / Windows Credential Manager / in-memory fallback), matching the SFTP
  (0104) and FTP (0106) connection profiles — never embedded in the `Location` URI.
- Buckets browse like folders: prefix-based "directory" listing (S3 has no real directories — keys
  with a shared `/`-delimited prefix behave as one), paged, with `ListObjectsV2` delimiter/prefix
  semantics.
- Upload, download, delete, and rename-via-copy-then-delete (S3 has no native rename) work through
  the shared operation engine.
- `TransferCapabilities` (0108) reports what S3 actually supports: no `server_side_move` (no native
  rename), `server_side_copy` true only within the same bucket/region if using S3's native
  server-side `CopyObject`, `random_read` true (ranged GET), `random_write` false.
- Multipart upload for files above S3's single-PUT limit (5 GiB) or above a configurable threshold,
  so large-file transfers don't buffer the whole file in memory.
- Provider capability reporting is accurate (no directories, no in-place rename, etc. — the UI
  should not offer operations the provider can't actually do).
- Integration tests run against a local S3-compatible fixture (e.g. MinIO in a test container, or
  an in-process mock server) rather than requiring real AWS credentials in CI.

## Implementation Notes

- Suggested crate: `fm-vfs-s3`, following the `fm-vfs-sftp`/`fm-vfs-ftp` split (a provider crate
  implementing `FileSystemProvider` from `fm-vfs`, plus a thin transport layer).
- The AWS Rust SDK (`aws-sdk-s3`) works against any S3-compatible endpoint when given a custom
  endpoint URL and path-style addressing; weigh it against a lighter presigned-request client (e.g.
  `rusty-s3`) — the SDK pulls in a large dependency tree for what is fundamentally a handful of
  signed HTTP calls, and this workspace's other VFS providers (`fm-vfs-sftp`, `fm-vfs-ftp`) are
  comparatively lean. Check crates.io directly for current maintenance status before picking either
  (per 0104's own precedent of verifying library choices against the live registry, not assumption).
- Reuse `crates/fm-domain/src/location.rs`'s `Parsed*Uri` pattern for a new `s3://<connection-id>/
  <key-prefix>` scheme, mirroring `ParsedSftpUri`.
- No real filesystem "directory" exists — `mkdir` should either no-op (a prefix isn't a real
  object) or create a zero-byte marker object, matching what most S3 clients do. Decide and
  document the choice rather than silently picking one.
- Cross-reference [0147](0147-webdav-provider.md) — same "remote-provider breadth" motivation,
  separate protocol, separate crate. Land independently; no shared code expected beyond the
  `FileSystemProvider` trait itself.

## Agent Notes

- Initial task setup. No execution attempts recorded yet. Before starting, confirm the SDK/library
  choice (aws-sdk-s3 vs. a lighter presigned client) and validate the MinIO-based test fixture
  approach works in this project's CI sandbox before writing provider code against it.
