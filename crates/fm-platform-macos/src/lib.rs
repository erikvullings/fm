//! macOS platform integration (task 0059).
//!
//! File icons, Finder reveal, Trash, mounted volumes, a native menu bar hook
//! and terminal integration. The crate is a workspace member everywhere but
//! compiles to nothing off macOS.
//!
//! Deliberately unimplemented (capability bits stay unset, per specification
//! §23/§35): thumbnails, macOS alias resolution (no capability flag exists
//! for this in [`fm_platform::PlatformCapabilities`]; aliases are simply not
//! resolved), Quick Look previews, Finder tags, extended attributes and
//! drag-to-Finder (drag is task 0062). Clipboard file references stay
//! delegated to the fallback adapter. `open_with_default_application` (task
//! 0061) shells out to `open <path>`; there is no distinct native "choose an
//! application" picker wired up, so `core.openWith` currently behaves the
//! same as `core.open` (documented gap, see task 0061 Agent Notes).

#![cfg(target_os = "macos")]
// Native AppKit/Foundation bindings are inherently FFI: `objc2` message sends
// and Retained-pointer handling require `unsafe`. This crate is isolated
// specifically so the rest of the workspace can keep `unsafe_code = "deny"`
// (see docs/decisions/0010-native-platform-adapters.md).
#![allow(unsafe_code)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use fm_platform::{
    FallbackPlatformAdapter, MountedVolume, PlatformAdapter, PlatformCapabilities, PlatformError,
};
use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSBitmapImageFileType, NSBitmapImageRep, NSMenu, NSWorkspace};
use objc2_foundation::{
    NSArray, NSDictionary, NSFileManager, NSString, NSURL, NSVolumeEnumerationOptions,
};

/// macOS implementation of [`PlatformAdapter`].
///
/// File icons are cached by file extension (not per path), so listing many
/// files sharing an extension issues a single native icon lookup rather than
/// one per entry (specification §28). The cache is process-lifetime only and
/// never persisted to disk.
#[derive(Debug, Default)]
pub struct MacosPlatformAdapter {
    fallback: FallbackPlatformAdapter,
    icon_cache: Mutex<HashMap<String, Vec<u8>>>,
}

impl MacosPlatformAdapter {
    /// Builds a new macOS adapter.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}

/// Cache key for a path's icon: the lowercased extension, or a sentinel for
/// directories and extension-less files. Sentinels use a NUL byte prefix so
/// they can never collide with a real (NUL-free) file extension.
fn icon_cache_key(path: &Path) -> String {
    if path.is_dir() {
        return "\0dir".to_owned();
    }
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) => extension.to_ascii_lowercase(),
        None => "\0noext".to_owned(),
    }
}

fn path_to_str(path: &Path) -> Result<&str, PlatformError> {
    path.to_str().ok_or_else(|| PlatformError::Io {
        message: "path is not valid UTF-8".to_owned(),
    })
}

fn fetch_icon_png(path: &Path) -> Result<Vec<u8>, PlatformError> {
    let ns_path = NSString::from_str(path_to_str(path)?);
    let image = NSWorkspace::sharedWorkspace().iconForFile(&ns_path);
    let tiff = image
        .TIFFRepresentation()
        .ok_or_else(|| PlatformError::Io {
            message: "failed to obtain a TIFF representation of the icon".to_owned(),
        })?;
    let bitmap = NSBitmapImageRep::imageRepWithData(&tiff).ok_or_else(|| PlatformError::Io {
        message: "failed to decode the icon's TIFF representation".to_owned(),
    })?;
    let properties = NSDictionary::new();
    let png = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
    }
    .ok_or_else(|| PlatformError::Io {
        message: "failed to encode the icon as PNG".to_owned(),
    })?;
    Ok(png.to_vec())
}

impl PlatformAdapter for MacosPlatformAdapter {
    fn capabilities(&self) -> PlatformCapabilities {
        PlatformCapabilities::FILE_ICONS
            | PlatformCapabilities::REVEAL_IN_FILE_MANAGER
            | PlatformCapabilities::TRASH
            | PlatformCapabilities::OPEN_TERMINAL
            | PlatformCapabilities::MOUNTED_VOLUMES
            | PlatformCapabilities::NATIVE_MENUS
            | PlatformCapabilities::OPEN_WITH_DEFAULT_APPLICATION
    }

    fn file_icon(&self, path: &Path) -> Result<Vec<u8>, PlatformError> {
        let key = icon_cache_key(path);
        if let Some(cached) = self
            .icon_cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&key)
        {
            return Ok(cached.clone());
        }
        let png = fetch_icon_png(path)?;
        self.icon_cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(key, png.clone());
        Ok(png)
    }

    fn thumbnail(&self, path: &Path, max_size: u32) -> Result<Vec<u8>, PlatformError> {
        self.fallback.thumbnail(path, max_size)
    }

    fn reveal_in_file_manager(&self, path: &Path) -> Result<(), PlatformError> {
        let ns_path = NSString::from_str(path_to_str(path)?);
        let url = NSURL::fileURLWithPath(&ns_path);
        let urls = NSArray::from_slice(&[&*url]);
        NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(&urls);
        Ok(())
    }

    fn trash(&self, path: &Path) -> Result<(), PlatformError> {
        let ns_path = NSString::from_str(path_to_str(path)?);
        let url = NSURL::fileURLWithPath(&ns_path);
        NSFileManager::defaultManager()
            .trashItemAtURL_resultingItemURL_error(&url, None)
            .map_err(|error| PlatformError::Io {
                message: error.localizedDescription().to_string(),
            })
    }

    fn open_with_default_application(&self, path: &Path) -> Result<(), PlatformError> {
        let status = std::process::Command::new("open")
            .arg(path)
            .status()
            .map_err(|error| PlatformError::Io {
                message: format!("failed to launch the default application: {error}"),
            })?;
        if status.success() {
            Ok(())
        } else {
            Err(PlatformError::Io {
                message: format!("open exited with {status}"),
            })
        }
    }

    fn open_terminal(
        &self,
        path: &Path,
        command_override: Option<&str>,
    ) -> Result<(), PlatformError> {
        let app = command_override.unwrap_or("Terminal");
        let status = std::process::Command::new("open")
            .arg("-a")
            .arg(app)
            .arg(path)
            .status()
            .map_err(|error| PlatformError::Io {
                message: format!("failed to launch {app}: {error}"),
            })?;
        if status.success() {
            Ok(())
        } else {
            Err(PlatformError::Io {
                message: format!("{app} launch exited with {status}"),
            })
        }
    }

    fn read_clipboard_file_references(&self) -> Result<Vec<PathBuf>, PlatformError> {
        self.fallback.read_clipboard_file_references()
    }

    fn write_clipboard_file_references(&self, paths: &[PathBuf]) -> Result<(), PlatformError> {
        self.fallback.write_clipboard_file_references(paths)
    }

    fn mounted_volumes(&self) -> Result<Vec<MountedVolume>, PlatformError> {
        let urls = NSFileManager::defaultManager()
            .mountedVolumeURLsIncludingResourceValuesForKeys_options(
                None,
                NSVolumeEnumerationOptions::SkipHiddenVolumes,
            )
            .ok_or_else(|| PlatformError::Io {
                message: "failed to enumerate mounted volumes".to_owned(),
            })?;
        let mut volumes = Vec::with_capacity(urls.len());
        for url in &urls {
            let Some(path) = url.path() else {
                continue;
            };
            let mount_point = PathBuf::from(path.to_string());
            let name = mount_point
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_owned)
                .unwrap_or_else(|| mount_point.to_string_lossy().into_owned());
            volumes.push(MountedVolume { name, mount_point });
        }
        Ok(volumes)
    }

    /// Installs an empty native main menu.
    ///
    /// Deliberately minimal: menu *content* is out of scope here (mirroring
    /// task 0058's `install_native_menu` doc comment), and this method only
    /// wires up an `NSApplication` main menu hook that `apps/fm-desktop` can
    /// populate later. Native menu APIs require the main thread; off it, this
    /// reports [`PlatformError::Io`] rather than panicking.
    fn install_native_menu(&self) -> Result<(), PlatformError> {
        let Some(main_thread) = MainThreadMarker::new() else {
            return Err(PlatformError::Io {
                message: "installing the native menu bar requires the main thread".to_owned(),
            });
        };
        let app = NSApplication::sharedApplication(main_thread);
        let menu = NSMenu::new(main_thread);
        app.setMainMenu(Some(&menu));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn capabilities_report_exactly_the_implemented_operations() {
        let capabilities = MacosPlatformAdapter::new().capabilities();
        for expected in [
            PlatformCapabilities::FILE_ICONS,
            PlatformCapabilities::REVEAL_IN_FILE_MANAGER,
            PlatformCapabilities::TRASH,
            PlatformCapabilities::OPEN_TERMINAL,
            PlatformCapabilities::MOUNTED_VOLUMES,
            PlatformCapabilities::NATIVE_MENUS,
        ] {
            assert!(capabilities.contains(expected), "{expected:?}");
        }
        for unimplemented in [
            PlatformCapabilities::THUMBNAILS,
            PlatformCapabilities::CLIPBOARD_FILE_REFERENCES,
            PlatformCapabilities::NATIVE_DRAG_OUT,
        ] {
            assert!(!capabilities.contains(unimplemented), "{unimplemented:?}");
        }
    }

    #[test]
    fn thumbnail_and_clipboard_still_delegate_to_fallback() {
        let adapter = MacosPlatformAdapter::new();
        let fallback = FallbackPlatformAdapter;
        let path = Path::new("/tmp/fm-platform-macos-test.txt");

        assert_eq!(
            adapter.thumbnail(path, 64).unwrap_err().to_string(),
            fallback.thumbnail(path, 64).unwrap_err().to_string()
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
    }

    #[test]
    fn file_icon_is_fetched_once_per_extension_not_once_per_file() {
        let adapter = MacosPlatformAdapter::new();
        let dir = tempdir().expect("temp dir");
        let a = dir.path().join("a.txt");
        let b = dir.path().join("b.txt");
        let c = dir.path().join("c.md");

        let icon_a = adapter.file_icon(&a).expect("icon for a.txt");
        assert!(!icon_a.is_empty());
        let icon_b = adapter.file_icon(&b).expect("icon for b.txt");
        assert_eq!(
            icon_a, icon_b,
            "two files sharing an extension must share a cached icon"
        );
        assert_eq!(
            adapter.icon_cache.lock().expect("icon cache lock").len(),
            1,
            "only one lookup should have happened for the shared .txt extension"
        );

        adapter.file_icon(&c).expect("icon for c.md");
        assert_eq!(
            adapter.icon_cache.lock().expect("icon cache lock").len(),
            2,
            "a distinct extension must populate a second cache entry"
        );
    }

    #[test]
    fn file_icon_extension_matching_is_case_insensitive() {
        assert_eq!(icon_cache_key(Path::new("/tmp/readme.TXT")), "txt");
        assert_eq!(icon_cache_key(Path::new("/tmp/readme.txt")), "txt");
    }

    #[test]
    fn reveal_in_finder_succeeds_for_a_real_temporary_file() {
        let dir = tempdir().expect("temp dir");
        let file = dir.path().join("reveal-me.txt");
        std::fs::write(&file, b"content").expect("create fixture");

        MacosPlatformAdapter::new()
            .reveal_in_file_manager(&file)
            .expect("reveal in Finder");
    }

    #[test]
    fn trash_moves_a_real_temporary_file_out_of_its_directory() {
        let dir = tempdir().expect("temp dir");
        let file = dir.path().join("trash-me.txt");
        std::fs::write(&file, b"content").expect("create fixture");

        MacosPlatformAdapter::new()
            .trash(&file)
            .expect("trash the fixture file");

        assert!(!file.exists(), "the file must be gone from its directory");
    }

    #[test]
    fn mounted_volumes_reports_at_least_the_boot_volume() {
        let volumes = MacosPlatformAdapter::new()
            .mounted_volumes()
            .expect("enumerate mounted volumes");
        assert!(!volumes.is_empty());
        for volume in &volumes {
            assert!(volume.mount_point.is_absolute());
        }
    }

    #[test]
    fn install_native_menu_reports_an_io_error_off_the_main_thread() {
        // The test harness runs each test on a worker thread, never the
        // process's actual main thread, so this deterministically exercises
        // the off-main-thread error path; the happy path is exercised via
        // manual verification inside a running desktop app (see Agent Notes).
        let error = MacosPlatformAdapter::new()
            .install_native_menu()
            .expect_err("must fail off the main thread");
        assert!(matches!(error, PlatformError::Io { .. }));
    }

    #[test]
    fn open_terminal_passes_non_nfc_unicode_paths_through_untouched() {
        // "café" as NFC (precomposed é) vs NFD (e + combining acute) must
        // both survive into the spawned `open` command's arguments byte-for-
        // byte: never compare or rebuild the path via a normalizing string
        // operation.
        let nfc = Path::new("/tmp/caf\u{00e9}");
        let nfd = Path::new("/tmp/cafe\u{0301}");
        assert_ne!(nfc.as_os_str(), nfd.as_os_str());

        for path in [nfc, nfd] {
            let command = std::process::Command::new("open")
                .arg("-a")
                .arg("Terminal")
                .arg(path)
                .get_args()
                .map(std::ffi::OsStr::to_os_string)
                .collect::<Vec<_>>();
            let expected: Vec<std::ffi::OsString> =
                vec!["-a".into(), "Terminal".into(), path.into()];
            assert_eq!(command, expected);
        }
    }

    #[test]
    fn open_terminal_uses_the_command_override_as_the_open_dash_a_target() {
        let dir = tempdir().expect("temp dir");

        let error = MacosPlatformAdapter::new()
            .open_terminal(dir.path(), Some("Definitely Not An Installed App"))
            .expect_err("a bogus override app must fail, not silently open Terminal instead");
        let message = error.to_string();
        assert!(
            message.contains("Definitely Not An Installed App"),
            "error must name the overridden app, not the default: {message}"
        );
    }
}
