//! Typed server configuration (spec §22, §33 step 2, task 0064).
//!
//! Kept independent of the CLI parser in `main.rs` so integration tests and
//! future hosts (task 0064) can construct it directly.

use std::net::IpAddr;
use std::path::PathBuf;
use uuid::Uuid;

/// Random session secret per run; persisted only where deployment configures it.
/// In default config, this is in-memory only and changes per server restart.
#[derive(Debug, Clone)]
pub struct SessionSecret([u8; 32]);

impl SessionSecret {
    /// Generates a random session secret suitable for authentication.
    pub fn random() -> Self {
        // Generate 4 UUIDs and use their bytes as randomness
        let mut bytes = [0u8; 32];
        let uuid1 = Uuid::new_v4();
        let uuid2 = Uuid::new_v4();
        let uuid3 = Uuid::new_v4();
        let uuid4 = Uuid::new_v4();

        bytes[0..16].copy_from_slice(uuid1.as_bytes());
        bytes[16..32].copy_from_slice(uuid2.as_bytes());

        // Add additional entropy by XORing with other UUIDs
        for i in 0..16 {
            bytes[i] ^= uuid3.as_bytes()[i];
            bytes[i + 16] ^= uuid4.as_bytes()[i];
        }

        Self(bytes)
    }

    /// Returns the secret as a byte slice for use in authentication operations.
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

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
    /// Filesystem roots the server is permitted to expose. Validated after
    /// symlink resolution; all incoming Locations must resolve within one of
    /// these roots (task 0064).
    pub roots: Vec<PathBuf>,
    /// Directory workspaces are persisted under (spec §5.3.8).
    pub workspace_directory: PathBuf,
    /// Directory containing the application-wide settings file.
    pub settings_directory: PathBuf,
    /// Random session secret for authentication (task 0064).
    pub session_secret: SessionSecret,
    /// Whether to relax authentication in development mode. Explicit opt-in,
    /// logged at startup, and impossible when binding to non-loopback addresses
    /// (task 0064).
    pub dev_mode_auth_disabled: bool,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind_address: IpAddr::from([127, 0, 0, 1]),
            port: 8787,
            cors_allowed_origins: Vec::new(),
            max_body_bytes: 10 * 1024 * 1024,
            roots: Vec::new(),
            workspace_directory:
                fm_application::workspace::JsonFileWorkspaceRepository::default_directory(),
            settings_directory: dirs::config_dir()
                .unwrap_or_else(|| PathBuf::from(".fm-config"))
                .join("fm"),
            session_secret: SessionSecret::random(),
            dev_mode_auth_disabled: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_port_matches_the_browser_frontend_proxy() {
        assert_eq!(ServerConfig::default().port, 8787);
    }

    #[test]
    fn default_config_uses_loopback_binding() {
        let config = ServerConfig::default();
        assert_eq!(config.bind_address, IpAddr::from([127, 0, 0, 1]));
    }

    #[test]
    fn default_config_disables_auth_disabled() {
        let config = ServerConfig::default();
        assert!(!config.dev_mode_auth_disabled);
    }

    #[test]
    fn session_secret_generates_different_values() {
        let secret1 = SessionSecret::random();
        let secret2 = SessionSecret::random();
        assert_ne!(secret1.as_bytes(), secret2.as_bytes());
    }

    #[test]
    fn session_secret_is_32_bytes() {
        let secret = SessionSecret::random();
        assert_eq!(secret.as_bytes().len(), 32);
    }
}
