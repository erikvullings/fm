use std::path::PathBuf;

/// A mounted volume or drive reported by the operating system.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MountedVolume {
    /// Human-readable volume/drive name.
    pub name: String,
    /// Filesystem path the volume is mounted at.
    pub mount_point: PathBuf,
}

/// Broad presentation category for an operating-system-managed location.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemLocationKind {
    /// A filesystem location synchronized or mounted by a cloud provider.
    Cloud,
    /// A filesystem mounted from another computer through the operating system.
    Network,
}

/// A filesystem location discovered from operating-system conventions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemLocation {
    /// Stable human-readable label suitable for navigation UI.
    pub name: String,
    /// Native absolute path, later resolved through the existing local provider.
    pub path: PathBuf,
    /// Presentation category.
    pub kind: SystemLocationKind,
    /// Optional advisory vendor hint. File semantics never depend on this value.
    pub provider_hint: Option<String>,
    /// Optional lower-case mount protocol, for example `smb`.
    pub protocol: Option<String>,
    /// Optional remote server name supplied by the operating system.
    pub server: Option<String>,
    /// Optional remote share name supplied by the operating system.
    pub share: Option<String>,
    /// Whether the mounted filesystem is read-only, when detectable.
    pub read_only: Option<bool>,
}

/// Platform-facing discovery abstraction for OS-managed locations.
pub trait SystemLocationProvider: Send + Sync {
    /// Discovers currently reachable locations. Missing providers are omitted.
    fn system_locations(&self) -> Result<Vec<SystemLocation>, crate::PlatformError>;
}

impl<T: crate::PlatformAdapter + ?Sized> SystemLocationProvider for T {
    fn system_locations(&self) -> Result<Vec<SystemLocation>, crate::PlatformError> {
        crate::PlatformAdapter::system_locations(self)
    }
}

/// Classifies a cloud folder name without relying on a user-specific path.
#[must_use]
pub fn cloud_provider_hint(name: &str) -> Option<&'static str> {
    let normalized = name.to_ascii_lowercase();
    if normalized.contains("onedrive") {
        Some("onedrive")
    } else if normalized.contains("icloud") || normalized.contains("mobile documents") {
        Some("icloud")
    } else if normalized.contains("dropbox") {
        Some("dropbox")
    } else if normalized.contains("google drive") || normalized.starts_with("google-drive") {
        Some("google-drive")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{SystemLocation, SystemLocationKind, cloud_provider_hint};
    use std::path::PathBuf;

    #[test]
    fn classifies_common_cloud_folder_names_case_insensitively() {
        assert_eq!(
            cloud_provider_hint("OneDrive – Example Corp"),
            Some("onedrive")
        );
        assert_eq!(cloud_provider_hint("iCloud Drive"), Some("icloud"));
        assert_eq!(cloud_provider_hint("Dropbox"), Some("dropbox"));
        assert_eq!(cloud_provider_hint("Google Drive"), Some("google-drive"));
        assert_eq!(cloud_provider_hint("Projects"), None);
    }

    #[test]
    fn network_locations_carry_optional_mount_metadata() {
        let location = SystemLocation {
            name: "Team Files".to_owned(),
            path: PathBuf::from("/Volumes/Team Files"),
            kind: SystemLocationKind::Network,
            provider_hint: None,
            protocol: Some("smb".to_owned()),
            server: Some("files.example.test".to_owned()),
            share: Some("team".to_owned()),
            read_only: Some(true),
        };

        assert_eq!(location.kind, SystemLocationKind::Network);
        assert_eq!(location.protocol.as_deref(), Some("smb"));
        assert_eq!(location.server.as_deref(), Some("files.example.test"));
        assert_eq!(location.share.as_deref(), Some("team"));
        assert_eq!(location.read_only, Some(true));
    }
}
