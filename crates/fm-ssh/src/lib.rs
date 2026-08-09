//! Reusable SSH session, authentication and host-key logic (task 0104, spec
//! §6.2, §7).
//!
//! This crate owns only session/authentication concerns: connecting,
//! authenticating (password or private key today; SSH agent is a documented
//! gap, see the crate's task notes), and host-key verification/persistence
//! (spec §6.4). It never depends on `fm-connections` (see [`types`]'s module
//! doc for why - the workspace's layer-fitness test would otherwise make it
//! impossible for `fm-application` to both wire a dialer through it *and*
//! register a provider built on it), so its types are connection-agnostic;
//! `fm-application` translates between `fm_connections`'s and this crate's
//! types.
//!
//! Consumers built on top of this crate's session/auth layer: `fm-vfs-sftp`
//! (task 0104, the only consumer implemented so far), and, per spec §7,
//! future SSH-terminal and remote-command consumers - kept out of this
//! crate's scope today but the module boundary already leaves room for them.

mod error;
mod fingerprint;
pub mod fixture;
mod known_hosts;
mod manager;
mod session;
mod types;

pub use error::SshError;
pub use fingerprint::fingerprint_of;
pub use known_hosts::{
    HostKeyVerification, InMemoryKnownHostsStore, JsonFileKnownHostsStore, KnownHostsStore,
    StoredHostKey, verify_host_key,
};
pub use manager::SshConnectionManager;
pub use session::SshSession;
pub use types::{SshConnectTarget, SshConnectionParameters, SshCredential, SshHostKeyPolicy};
