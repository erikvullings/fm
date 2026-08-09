# 0004 SFTP provider

Status: done
Priority: high
Subsystem: backend
Depends on: 0003

## Context
Add SSH-based file management via SFTP as a new `FileSystemProvider`. The product may call this SSH/SFTP, but legacy SCP is not the primary implementation.

## Acceptance Criteria
- SSH connections support host, port, username, and initial auth methods.
- SSH host keys are verified, first use is confirmable/persisted, and changed keys are never silently accepted.
- SFTP locations open in either pane.
- Listing, metadata, mkdir, rename, upload, download, supported moves, and delete work.
- `local → SFTP`, `SFTP → local`, and same-connection SFTP transfers use the shared operation engine.
- Cancellation and partial-file cleanup work.
- Provider capability reporting is accurate.
- No credentials are embedded in `Location` URIs.
- Integration tests use an isolated SSH/SFTP fixture.

## Implementation Notes
- Suggested crates: `fm-ssh`, `fm-vfs-sftp`.
- Evaluate current async Rust SSH/SFTP libraries such as `russh`/`russh-sftp`.
- Prefer locations referencing `ConnectionId`.
- Start with password/private-key auth; agent/jump-host/resume can follow.
- Keep recursive copy semantics in the operation engine.

## Agent Notes
- Validate current VFS stream interfaces before coding so remote reads/writes plug into existing transfer planning.
- 2026-08-09: Implemented end to end with TDD. New crates: `crates/fm-ssh` (session/authentication/host-key
  logic - connection-agnostic, deliberately never depends on `fm-connections`/`fm-credentials`, see
  design decision below) and `crates/fm-vfs-sftp` (the `SftpFileSystemProvider` `FileSystemProvider`
  implementation). `fm-domain/src/location.rs` gained real `sftp://<connection-id>/<path>` parsing
  (`ParsedSftpUri`, mirroring `ParsedFileUri`/`ParsedArchiveUri`'s style exactly): removed `"sftp"`
  from `RESERVED_SCHEMES` (now empty, kept as the seam a future task, e.g. FTP, can reserve its own
  scheme ahead of implementing it), added `SFTP_PROVIDER`/`SFTP_SCHEME` and full `join`/`parent`/`name`
  support. The connection id is validated as UUID text via the `uuid` crate directly (already a
  `fm-domain` dependency), not via `fm_connections::ConnectionId` - `fm-domain` must not depend on
  `fm-connections`.
- 2026-08-09: **Library choice**: `russh` 0.62.5 + `russh-sftp` 2.4.0 (both added to
  `[workspace.dependencies]`), plus `rand` 0.10 for in-process key generation. Chosen after checking
  crates.io directly (network-verified, not assumed) and confirming both compile and work together on
  this toolchain (Rust 1.97.1, edition 2024); `russh-sftp` itself lists `russh` as a dev-dependency,
  confirming the pairing is actively tested upstream. Both support client *and* server roles for the
  same wire protocol, which drove the fixture choice below. Auth: password via
  `Handle::authenticate_password`; private key via `russh::keys::decode_secret_key(pem_text, passphrase)`
  (parses PEM text directly, never a file path - credentials stay in memory only) +
  `authenticate_publickey`. SSH agent auth is a named, explicit gap (`SshError::UnsupportedAuthenticationMethod`),
  matching the task's own "start with password/private-key; agent can follow" note.
- 2026-08-09: **Test fixture choice**: an in-process `russh`/`russh-sftp` **server** (`fm_ssh::fixture`,
  unconditionally `pub`, not `#[cfg(test)]`, so `fm-vfs-sftp` and `fm-application` can depend on it too),
  over spawning the system `sshd`/`sftp-server` (task's option (b)). Chosen because it needs no external
  process or privileged config file (works identically in a sandboxed environment), and because it is a
  genuinely independent implementation from the client code under test (real `SSH_FXP_*` wire packets,
  real KEX/auth negotiation, real ed25519 host + client keys generated fresh per fixture via
  `PrivateKey::random`) - an actual protocol round trip, not a mock. The fixture serves a real temporary
  directory using the client-presented path as-is (no virtual-root translation), so tests address remote
  files by joining real paths under `fixture.root`.
- 2026-08-09: **Host-key confirmation design** (spec §6.4, the task's flagged open design fork):
  - `fm_ssh::KnownHostsStore` (`JsonFileKnownHostsStore`, one JSON file, atomic temp-file-then-rename
    writes) persists `{fingerprint, accepted_at}` keyed by an opaque caller-chosen string - documented
    choice: keyed by `ConnectionId` text, not host:port, so editing a connection's host/port fails
    closed (reverifies from scratch) rather than silently reusing a stale trust decision.
  - `fm_ssh::verify_host_key` compares a freshly presented fingerprint against the store, returning
    `Trusted`/`Unverified`/`Mismatch` - a pure function, never itself mutating the store. `SshSession::connect`'s
    `client::Handler::check_server_key` calls it *before* any credential is sent; `Unverified`/`Mismatch`
    reject the handshake and the caller-visible error is `SshError::HostKeyUnverified{fingerprint}` /
    `SshError::HostKeyMismatch{fingerprint, expected_fingerprint}` - two distinct variants, verified by
    dedicated tests, so a caller can never confuse "never seen" with "changed" or with a wrong
    password/network failure (which fall through to `SshError::Connect`/`AuthenticationFailed`).
  - `SshSession::probe_host_key`/`SshConnectionManager::probe_host_key` connect and verify the host key
    *without* authenticating, then disconnect - lets a caller ask "what is this host presenting right
    now" before it necessarily has a working credential, sharing the exact same verification code path
    as a real `connect` (refactored into a shared `establish_transport` helper) so the probe answer is
    never a separate, potentially-diverging code path.
  - The only way a fingerprint is ever persisted is `KnownHostsStore::accept` - `fm-application`'s new
    `FileManagerService::accept_ssh_host_key(connection_id, fingerprint)` facade method re-probes the
    host itself and refuses to persist if the presented fingerprint no longer matches the one being
    accepted (defense against confirming a stale/attacker-supplied value), and additionally refuses a
    *first-time* accept outright when the connection's `HostKeyPolicy` is `RequireKnownHost` (that
    policy "only succeeds if the fingerprint is already stored", so it never gets a first-trust UI path);
    it *does* allow `RequireKnownHost` to re-confirm a `Mismatch`, treating that as an explicit
    administrative correction rather than first trust. Exposed as `POST
    /api/v1/connections/{connectionId}/hostKey/probe` (→ `HostKeyProbeDto`) and `POST
    .../hostKey/accept` (body `AcceptSshHostKeyRequestDto{fingerprint}`), mirrored 1:1 as Tauri commands
    `probe_ssh_host_key`/`accept_ssh_host_key`, registered in both `invoke_handler` lists.
  - `fm_connections::ConnectionStatus`/`ConnectionError` and `fm_events::ConnectionStatusPayload`/
    `fm_transport_dto::ConnectionStatusDto`/`ApplicationErrorCode` all gained matching
    `HostKeyUnverified`/`HostKeyMismatch` variants, so `connect_connection`/`test_connection` report a
    status distinct from the generic `failed` bucket (never propagated as an `Err` from `connect`/`test`
    themselves - `ConnectionService::evaluate` already converts every dialer outcome into a tracked
    status, a pattern task 0103 established; this task only added two new status values to that existing
    conversion, it did not change the shape of the conversion itself).
- 2026-08-09: **`fm-ssh`/`fm-vfs-sftp` never depend on `fm-connections`/`fm-credentials`** - a deliberate
  layering decision forced by `fm-test-support`'s architecture fitness test (strictly-downward layers
  only). `fm-connections` sits at layer 2; if `fm-ssh` depended on it directly it would need layer ≥3,
  pushing `fm-vfs-sftp` (which depends on `fm-ssh`) to layer ≥4 - one layer *above* `fm-application`
  (layer 3), making it impossible for `fm-application` to register the provider at all. Resolution:
  `fm-ssh` defines its own connection-agnostic types (`SshConnectTarget`/`SshCredential`/
  `SshHostKeyPolicy`/`SshConnectionParameters`), mirroring how `fm-events::ConnectionStatusPayload`
  already duplicates `fm_connections::ConnectionStatus` for the identical reason. `fm-vfs-sftp` defines
  its own `SshConnectionResolver` trait (given an opaque connection-id string, resolve dial parameters)
  instead of looking up `ConnectionProfile`s itself. `fm-ssh` is layer 1 (zero internal workspace
  deps, like `fm-credentials`); `fm-vfs-sftp` is layer 2 (alongside `fm-vfs-local`). `fm-application`
  (layer 3, the one crate allowed to depend on all four) implements both seams in a new
  `crates/fm-application/src/ssh.rs`: `SshDialer` (`fm_connections::ConnectionDialer` for
  `ConnectionKind::Ssh`, calling `SshConnectionManager::verify_connectivity`) and `SshResolver`
  (`fm_vfs_sftp::SshConnectionResolver`, backed by a second, independent `JsonFileConnectionRepository`
  instance rooted at the same `connections` directory `ConnectionService` itself uses - safe, since the
  repository is a stateless, file-per-connection store with no in-memory cache a second instance could
  desynchronize from). Verified for real: `fm-test-support`'s `workspace_crates_respect_the_documented_layering`
  test (which runs `cargo metadata` against the actual workspace, not a hand-built graph) passes with
  `fm-ssh`/`fm-vfs-sftp` added to `CRATE_LAYERS`.
- 2026-08-09: **Provider implementation** (`SftpFileSystemProvider`, mirrors `fm-vfs-local`'s shape):
  `list`/`metadata`/`inspect`/`file_size`/`create_directory`/`rename`/`remove` (recursive remove
  walks the tree itself via `read_dir`+`remove_file`/`remove_dir`, since SFTPv3 has no native recursive
  delete - mirrors `fm-vfs-local`'s own `remove_dir_all` for the identical reason, not a violation of
  "keep recursive *copy* semantics in the operation engine", which is honoured: the provider never
  walks a directory tree to copy files itself, only `fm-operations`'/`fm-application`'s `CopyExecutor`
  does, via ordinary `list()` calls)/`open_read`/`open_write`/`commit_copy`/`discard_copy`/
  `same_filesystem`/`watch` are all implemented for real; `server_side_copy` is left at its default
  (spec §6.6 "usually limited/unsupported", no portable SFTPv3 primitive exists). `commit_copy`
  publishes a `.fm-copy-{uuid}` file that is itself a *remote* temporary (uploaded by streaming directly
  to it, never staged on local disk) next to the real destination, then `rename`s it into place -
  satisfying spec §6.7 "do not require temporary local files" the same way `fm-vfs-local` does on its
  own filesystem. `capabilities()` reports `LIST | READ | WRITE | CREATE_DIRECTORY | RENAME | MOVE |
  DELETE` only; `RANDOM_ACCESS`/`SET_TIMESTAMPS`/`SET_PERMISSIONS`/`CHECKSUM` are left unset (SFTPv3
  could technically support seek/`fsetstat`, but nothing exercises them against a real server in this
  task, and under-advertising is safer than claiming an unverified capability) - all choices documented
  inline in `provider.rs`'s module doc. `watch` always returns `VfsError::UnsupportedCapability` (no
  default exists on the trait for it; real polling is task 0109's job per the task notes). Transport-level
  errors (`IO`/`Timeout`/`UnexpectedPacket`/`UnexpectedBehavior`) trigger exactly one silent
  reconnect-and-retry per operation (`SftpFileSystemProvider::with_sftp`, backed by
  `SshConnectionManager::invalidate`+`session`); protocol-level responses (`NoSuchFile`,
  `PermissionDenied`, ...) never retry. `same_filesystem` compares the connection-id segment of two
  `sftp://` locations, letting `MoveExecutor` use the provider's own server-native `rename` for a
  same-connection move exactly as it already does for local moves.
- 2026-08-09: **Bug found and fixed during integration testing, not before**: `fm-operations`'s
  `validate_paths` safety preflight (`crates/fm-operations/src/safety.rs`) had a special case comparing
  `archive://` locations by their scheme-stripped text (since they have no native path), but fell
  through to `Location::to_native_path()` - local-filesystem-only - for every *other* provider,
  including the new `sftp` one. A same-connection `SFTP → SFTP` copy therefore failed at the planning
  stage (`SafetyError::IncomparableLocations`) with an opaque "Operation failed" summary and no
  per-item error, purely because both locations shared the `sftp` provider id and hit the local-path
  fallback. Fixed by adding the same kind of scheme-stripped-text special case for `sftp` (keeping the
  connection id as the path's first component, so two different connections are never mistaken for the
  same/nested entry even with textually identical remote paths); regression-tested directly in
  `fm-operations` (`safety_compares_sftp_locations_by_connection_and_path_not_native_path`) and
  indirectly via the real end-to-end same-connection copy/move tests below. This is exactly why the task
  asked for a real `fm-operations`/`fm-application`-level integration test rather than trusting the
  provider-level tests alone - the provider's own isolated tests could not have caught this.
- 2026-08-09: **Frontend**: `frontend/src/features/connections/connections-model.ts` gained
  `isBrowsable(connection)` (true only for `kind === 'ssh'`, the one kind with a real provider - the
  other six are honestly excluded rather than offered as a dead click) and `sftpRootLocation(connectionId)`
  (builds `sftp://<connection-id>/`; the initial path is always `/` - undocumented and un-probeable ahead
  of listing, so it is the one path guaranteed listable regardless of the server's actual home directory,
  and a user can navigate deeper from there like any other pane location), plus the two new status labels.
  `frontend/src/features/panes/pane.ts`'s `SERVERS` group item changed from a static, non-interactive
  `div` into a `button` that calls the same `navigateFavourite(location, attrs)` already used by
  `CLOUD`/`NETWORK`, disabled (with an explanatory `title`) for any non-SSH connection - satisfying "SFTP
  locations open in either pane" while keeping the addition scoped to "open a pane on this connection's
  root" (full context-menu actions are task 0105/spec §5.5, explicitly out of scope here).
  `pnpm run api:export`/`api:generate` regenerated `frontend/openapi/openapi.json` and
  `frontend/src/api/generated/**` (new `HostKeyProbeDto`/`AcceptSshHostKeyRequestDto` models, two new
  `connectionStatusDto`/`applicationErrorCode` enum members, two new client methods); re-running both a
  second time produced no further diff, confirming the checked-in output is stable/in sync.
- 2026-08-09: **Known gaps, documented rather than silent**: (1) SSH agent authentication is not
  implemented (`SshCredential::Agent` reports `SshError::UnsupportedAuthenticationMethod` explicitly,
  never silently ignored) - matches the task's own "start with password/private-key; agent can follow".
  (2) Jump hosts and transfer resume are not implemented - also explicitly named as follow-on work by
  the task. (3) `RANDOM_ACCESS`/`SET_TIMESTAMPS`/`SET_PERMISSIONS`/`CHECKSUM`/`SERVER_SIDE_COPY`/`TRASH`/
  `WATCH` capabilities are all honestly unadvertised (see the provider-implementation note above); no
  caller can be surprised by a claimed-but-unverified capability. (4) No visual "trust this host key?"
  frontend dialog was built - the task's own wording treats plumbing a frontend prompt as optional
  ("if you choose to plumb one through"); the complete, tested backend mechanism (distinct connection
  status, probe/accept REST endpoints mirrored as Tauri commands, generated TypeScript types for both)
  is in place and ready for a future task to build a UI on top of, but today a host-key-pending
  connection surfaces only as a distinguishable status in the connections manager, not an actionable
  prompt. (5) Windows-runtime behaviour of `fm-ssh`/`fm-vfs-sftp` is unverified - both crates are
  ordinary cross-platform crates (not `cfg(target_os = ...)`-gated like `fm-credentials-windows`), and
  SFTP paths are POSIX-style on the wire regardless of client OS by protocol definition, but this was
  only run and tested on macOS; only `cargo check`/`clippy` breadth across the workspace (which does not
  cross-compile) was possible here, matching every other task's identical limitation on this host.
  (6) "No credentials embedded in `Location` URIs" is a structural guarantee (`ParsedSftpUri` has no
  field that could hold one; secrets live only behind a `CredentialStore` reference) rather than a
  dedicated regression test - the same approach task 0103 used for `ConnectionProfile` itself.
- 2026-08-09: Verified (exact commands, not whole-suite totals): `cargo test -p fm-ssh` → 13 passed
  (`src/known_hosts.rs` + `src/fingerprint.rs` unit tests) + `cargo test -p fm-ssh --test
  session_and_host_keys` → 20 passed (password/key auth with/without passphrase, host-key first-use/
  reject/accept/mismatch, probe, connection-manager reuse/reconnect, keepalive, closed-port error
  path); `cargo test -p fm-vfs-sftp --test provider` → 18 passed (capabilities, watch-unsupported,
  mkdir/list/metadata, pagination, upload/download round trip, overwrite refusal, rename, delete
  (file/recursive/non-recursive-non-empty/trash-unsupported), Unicode names, same_filesystem,
  commit_copy/discard_copy, pre-cancelled rejection, dropped-session reconnect); `cargo test -p
  fm-domain --test location_contract` → 12 passed (3 new: `sftp_locations_reference_a_connection_id_rather_than_a_host`,
  `sftp_locations_support_safe_path_navigation`, `sftp_locations_reject_traversal_and_reserved_names`,
  `try_new_validates_the_sftp_provider_matches_the_scheme`); `cargo test -p fm-connections` → 53 passed
  (2 new host-key-status dialer tests); `cargo test -p fm-operations` → 17 passed (1 new safety
  regression test); `cargo test -p fm-application --test ssh_sftp_operations` → 6 passed
  (`local_to_sftp`/`sftp_to_local`/`same_connection_sftp_to_sftp` copies and a same-connection move
  through the real operation engine, mid-transfer cancellation leaving no partial file anywhere, host-key
  probe/accept round trip through the facade, stale-fingerprint rejection); `cargo test -p
  fm-transport-dto` → 71 passed (4 new: `HostKeyProbeDto` tag/camelCase/round-trip, `AcceptSshHostKeyRequestDto`
  round-trip); `cargo test -p fm-server --test connection_routes` → 9 passed (one pre-existing test,
  `connect_then_disconnect_transitions_the_status`, updated: connecting to the fixture's `example.test`
  host now genuinely dials and reports `failed` rather than the pre-0104 "no dialer registered" stand-in
  `connected` - proving the REST layer reaches the real dialer end to end). Full-suite regressions
  checked: `cargo test --workspace` → 743 passed, 0 failed (up from 0103's 718+ baseline, no prior test
  broken by this task's changes beyond the one intentionally-updated assertion above); `cargo clippy
  --workspace --all-targets -- -D warnings` clean; `cargo fmt --all --check` clean.
  `pnpm exec vitest run` (full frontend suite) → 722 passed / 3 failed, the exact same three
  pre-existing failures already documented in 0102's/0103's Agent Notes (theme selector formatting, a
  stale mock action list, the content-search viewer assertion) - confirmed by diffing the failing test
  names against 0103's notes, not just the count; `pnpm exec tsc --noEmit` retains only the same three
  pre-existing errors already documented there (archive creation, a conflict-dialog fixture, the Vite
  configuration); `pnpm exec vitest run src/features/connections/connections-model.test.ts` → 16 passed
  (4 new: distinct host-key-status labels, `isBrowsable` true/false, `sftpRootLocation`); `biome check`
  clean for every file this task touched (generated API files are biome-ignored by design, matching
  `AGENTS.md`'s "never hand-edited" convention).
