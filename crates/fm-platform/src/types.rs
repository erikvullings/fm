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
    use super::cloud_provider_hint;

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
}
