//! Windows platform integration (task 0060).
//!
//! Shell icons, Explorer reveal, Recycle Bin, drive listing, UNC and long path
//! handling, junctions and shortcuts. The crate is a workspace member
//! everywhere but compiles to nothing off Windows.

#![cfg(target_os = "windows")]

use std::path::{Path, PathBuf};

use fm_platform::{
    FallbackPlatformAdapter, MountedVolume, PlatformAdapter, PlatformCapabilities, PlatformError,
};

/// Windows implementation of [`PlatformAdapter`].
///
/// Task 0058 only defines the trait and wires this crate in: every method
/// still delegates to [`FallbackPlatformAdapter`]. Real Explorer/Recycle
/// Bin/menu integration is task 0060's job.
#[derive(Debug, Clone, Copy, Default)]
pub struct WindowsPlatformAdapter {
    fallback: FallbackPlatformAdapter,
}

impl WindowsPlatformAdapter {
    /// Builds a new Windows adapter.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}

impl PlatformAdapter for WindowsPlatformAdapter {
    fn capabilities(&self) -> PlatformCapabilities {
        self.fallback.capabilities()
    }

    fn file_icon(&self, path: &Path) -> Result<Vec<u8>, PlatformError> {
        self.fallback.file_icon(path)
    }

    fn thumbnail(&self, path: &Path, max_size: u32) -> Result<Vec<u8>, PlatformError> {
        self.fallback.thumbnail(path, max_size)
    }

    fn reveal_in_file_manager(&self, path: &Path) -> Result<(), PlatformError> {
        self.fallback.reveal_in_file_manager(path)
    }

    fn trash(&self, path: &Path) -> Result<(), PlatformError> {
        self.fallback.trash(path)
    }

    fn open_with_default_application(&self, path: &Path) -> Result<(), PlatformError> {
        self.fallback.open_with_default_application(path)
    }

    fn open_terminal(
        &self,
        path: &Path,
        command_override: Option<&str>,
    ) -> Result<(), PlatformError> {
        self.fallback.open_terminal(path, command_override)
    }

    fn read_clipboard_file_references(&self) -> Result<Vec<PathBuf>, PlatformError> {
        self.fallback.read_clipboard_file_references()
    }

    fn write_clipboard_file_references(&self, paths: &[PathBuf]) -> Result<(), PlatformError> {
        self.fallback.write_clipboard_file_references(paths)
    }

    fn mounted_volumes(&self) -> Result<Vec<MountedVolume>, PlatformError> {
        self.fallback.mounted_volumes()
    }

    fn install_native_menu(&self) -> Result<(), PlatformError> {
        self.fallback.install_native_menu()
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn capabilities_delegate_to_the_fallback_adapter() {
        assert_eq!(
            WindowsPlatformAdapter::new().capabilities(),
            FallbackPlatformAdapter.capabilities()
        );
    }

    #[test]
    fn every_operation_delegates_to_the_fallback_adapter() {
        let adapter = WindowsPlatformAdapter::new();
        let fallback = FallbackPlatformAdapter;
        let path = Path::new("C:\\fm-platform-windows-test.txt");

        assert_eq!(
            adapter.file_icon(path).unwrap_err().to_string(),
            fallback.file_icon(path).unwrap_err().to_string()
        );
        assert_eq!(
            adapter.thumbnail(path, 64).unwrap_err().to_string(),
            fallback.thumbnail(path, 64).unwrap_err().to_string()
        );
        assert_eq!(
            adapter
                .reveal_in_file_manager(path)
                .unwrap_err()
                .to_string(),
            fallback
                .reveal_in_file_manager(path)
                .unwrap_err()
                .to_string()
        );
        assert_eq!(
            adapter.trash(path).unwrap_err().to_string(),
            fallback.trash(path).unwrap_err().to_string()
        );
        assert_eq!(
            adapter
                .open_with_default_application(path)
                .unwrap_err()
                .to_string(),
            fallback
                .open_with_default_application(path)
                .unwrap_err()
                .to_string()
        );
        assert_eq!(
            adapter.open_terminal(path, None).unwrap_err().to_string(),
            fallback.open_terminal(path, None).unwrap_err().to_string()
        );
        assert_eq!(
            adapter
                .read_clipboard_file_references()
                .unwrap_err()
                .to_string(),
            fallback
                .read_clipboard_file_references()
                .unwrap_err()
                .to_string()
        );
        assert_eq!(
            adapter
                .write_clipboard_file_references(&[path.to_path_buf()])
                .unwrap_err()
                .to_string(),
            fallback
                .write_clipboard_file_references(&[path.to_path_buf()])
                .unwrap_err()
                .to_string()
        );
        assert_eq!(
            adapter.mounted_volumes().unwrap_err().to_string(),
            fallback.mounted_volumes().unwrap_err().to_string()
        );
        assert_eq!(
            adapter.install_native_menu().unwrap_err().to_string(),
            fallback.install_native_menu().unwrap_err().to_string()
        );
    }
}
