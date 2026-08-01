use std::path::PathBuf;

/// A mounted volume or drive reported by the operating system.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MountedVolume {
    /// Human-readable volume/drive name.
    pub name: String,
    /// Filesystem path the volume is mounted at.
    pub mount_point: PathBuf,
}
