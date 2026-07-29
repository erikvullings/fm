//! Typed server configuration (spec §22, §33 step 2).
//!
//! Kept independent of the CLI parser in `main.rs` so integration tests and
//! future hosts (task 0064) can construct it directly.

use std::net::IpAddr;
use std::path::PathBuf;

/// Runtime configuration for the Axum host.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Address to bind to; defaults to loopback so the server is never
    /// reachable from the network without explicit opt-in (spec §22).
    pub bind_address: IpAddr,
    /// TCP port to bind to. Use `0` to let the OS choose an ephemeral port.
    pub port: u16,
    /// Origins allowed to make cross-origin requests. Empty means no
    /// cross-origin requests are allowed; a wildcard is never accepted (spec
    /// §22).
    pub cors_allowed_origins: Vec<String>,
    /// Maximum accepted request body size, in bytes.
    pub max_body_bytes: usize,
    /// Filesystem roots the server is permitted to expose. Not yet consumed
    /// by the VFS layer; recorded now so task 0064 can harden access without
    /// restructuring this type.
    pub roots: Vec<PathBuf>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind_address: IpAddr::from([127, 0, 0, 1]),
            port: 4180,
            cors_allowed_origins: Vec::new(),
            max_body_bytes: 10 * 1024 * 1024,
            roots: Vec::new(),
        }
    }
}
