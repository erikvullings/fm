//! Windows platform integration (task 0060).
//!
//! Shell icons, Explorer reveal, Recycle Bin, drive listing, UNC and long path
//! handling, junctions and shortcuts. The crate is a workspace member
//! everywhere but compiles to nothing off Windows.

#![cfg(target_os = "windows")]
#![allow(unsafe_code)]

use std::ffi::OsString;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};

use fm_platform::{
    FallbackPlatformAdapter, MountedVolume, PlatformAdapter, PlatformCapabilities, PlatformError,
    SystemLocation, SystemLocationKind, VolumeCapacity,
};
use windows_sys::Win32::NetworkManagement::WNet::WNetGetConnectionW;
use windows_sys::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives,
};

fn mapped_network_locations() -> Vec<SystemLocation> {
    let drives = unsafe { GetLogicalDrives() };
    let mut locations = Vec::new();
    for index in 0..26_u32 {
        if drives & (1 << index) == 0 {
            continue;
        }
        let letter = char::from_u32(u32::from(b'A') + index).expect("drive letter");
        let root = format!("{letter}:\\");
        let root_wide: Vec<u16> = root.encode_utf16().chain(Some(0)).collect();
        if unsafe { GetDriveTypeW(root_wide.as_ptr()) } != 4 {
            continue;
        }
        let local = format!("{letter}:");
        let local_wide: Vec<u16> = local.encode_utf16().chain(Some(0)).collect();
        let mut remote = vec![0_u16; 32_768];
        let mut length = u32::try_from(remote.len()).expect("fixed buffer length fits u32");
        if unsafe { WNetGetConnectionW(local_wide.as_ptr(), remote.as_mut_ptr(), &mut length) } != 0
        {
            continue;
        }
        let end = remote
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(remote.len());
        let source = OsString::from_wide(&remote[..end])
            .to_string_lossy()
            .into_owned();
        let mut components = source.trim_start_matches('\\').split('\\');
        let server = components
            .next()
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        let share = components
            .next()
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        locations.push(SystemLocation {
            name: share.clone().unwrap_or(local),
            path: PathBuf::from(root),
            kind: SystemLocationKind::Network,
            provider_hint: None,
            protocol: Some("smb".to_owned()),
            server,
            share,
            read_only: None,
        });
    }
    locations
}

/// Windows implementation of [`PlatformAdapter`].
///
/// Native drag-to-Explorer is provided by the Tauri window host. The
/// remaining methods currently delegate to [`FallbackPlatformAdapter`].
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
    fn system_locations(&self) -> Result<Vec<SystemLocation>, PlatformError> {
        let candidates = [
            ("OneDrive", "onedrive"),
            ("OneDriveConsumer", "onedrive"),
            ("OneDriveCommercial", "onedrive"),
        ];
        let mut locations = Vec::new();
        for (variable, hint) in candidates {
            let Some(path) = std::env::var_os(variable).map(PathBuf::from) else {
                continue;
            };
            if !path.is_dir()
                || locations
                    .iter()
                    .any(|location: &SystemLocation| location.path == path)
            {
                continue;
            }
            let name = path
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| "OneDrive".to_owned());
            locations.push(SystemLocation {
                name,
                path,
                kind: SystemLocationKind::Cloud,
                provider_hint: Some(hint.to_owned()),
                protocol: None,
                server: None,
                share: None,
                read_only: None,
            });
        }
        locations.extend(mapped_network_locations());
        Ok(locations)
    }

    fn capabilities(&self) -> PlatformCapabilities {
        self.fallback.capabilities()
            | PlatformCapabilities::NATIVE_DRAG_OUT
            | PlatformCapabilities::VOLUME_CAPACITY
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

    fn open_in_text_editor(
        &self,
        path: &Path,
        command_override: Option<&str>,
    ) -> Result<(), PlatformError> {
        self.fallback.open_in_text_editor(path, command_override)
    }

    fn open_with_chooser(&self, path: &Path) -> Result<(), PlatformError> {
        self.fallback.open_with_chooser(path)
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

    fn volume_capacity(&self, path: &Path) -> Result<VolumeCapacity, PlatformError> {
        let wide_path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut available_bytes: u64 = 0;
        let mut total_bytes: u64 = 0;
        let succeeded = unsafe {
            GetDiskFreeSpaceExW(
                wide_path.as_ptr(),
                &raw mut available_bytes,
                &raw mut total_bytes,
                std::ptr::null_mut(),
            )
        };
        if succeeded == 0 {
            return Err(PlatformError::NotFound {
                path: path.display().to_string(),
            });
        }
        Ok(VolumeCapacity {
            total_bytes,
            available_bytes,
        })
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
    fn capabilities_include_native_drag_out_and_volume_capacity() {
        assert_eq!(
            WindowsPlatformAdapter::new().capabilities(),
            PlatformCapabilities::NATIVE_DRAG_OUT | PlatformCapabilities::VOLUME_CAPACITY
        );
    }

    #[test]
    fn volume_capacity_reports_plausible_totals_for_the_system_drive() {
        let capacity = WindowsPlatformAdapter::new()
            .volume_capacity(&std::env::temp_dir())
            .expect("query system drive capacity");
        assert!(capacity.total_bytes > 0);
        assert!(capacity.available_bytes <= capacity.total_bytes);
    }

    #[test]
    fn volume_capacity_reports_not_found_for_a_missing_drive() {
        let error = WindowsPlatformAdapter::new()
            .volume_capacity(Path::new("Z:\\no-such-fm-platform-windows-test-path"))
            .unwrap_err();
        assert!(matches!(error, PlatformError::NotFound { .. }));
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
                .open_in_text_editor(path, None)
                .unwrap_err()
                .to_string(),
            fallback
                .open_in_text_editor(path, None)
                .unwrap_err()
                .to_string()
        );
        assert_eq!(
            adapter.open_with_chooser(path).unwrap_err().to_string(),
            fallback.open_with_chooser(path).unwrap_err().to_string()
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
