use std::path::{Path, PathBuf};

use crate::{MountedVolume, PlatformCapabilities, PlatformError, SystemLocation, VolumeCapacity};

/// Native OS integrations the application calls into: file icons,
/// thumbnails, revealing entries in the system file manager, trash, opening
/// with the default application, opening a terminal, system clipboard file
/// references, mounted volumes/drives and native menus (specification §23).
///
/// Every method has a default implementation reporting its capability as
/// unsupported, so a concrete adapter only needs to override the methods it
/// actually implements. [`PlatformAdapter::capabilities`] must stay in sync
/// with the overridden methods, so unsupported functions are always reported
/// as `false` and their UI affordances can be hidden or disabled rather than
/// left present-but-broken.
///
/// Methods are synchronous: native OS calls are blocking. Callers running
/// inside an async runtime must invoke them through `spawn_blocking` rather
/// than awaiting them directly, so a native call never blocks the Tauri UI
/// thread (specification §28).
pub trait PlatformAdapter: Send + Sync {
    /// Discovers currently reachable OS-managed locations.
    fn system_locations(&self) -> Result<Vec<SystemLocation>, PlatformError> {
        Ok(Vec::new())
    }
    /// Reports which capabilities this adapter actually implements.
    fn capabilities(&self) -> PlatformCapabilities;

    /// Fetches a file's native icon, encoded as PNG bytes.
    fn file_icon(&self, path: &Path) -> Result<Vec<u8>, PlatformError> {
        let _ = path;
        Err(PlatformError::Unsupported {
            capability: PlatformCapabilities::FILE_ICONS,
        })
    }

    /// Fetches a native thumbnail preview, encoded as PNG bytes, no larger
    /// than `max_size` pixels on its longest side.
    fn thumbnail(&self, path: &Path, max_size: u32) -> Result<Vec<u8>, PlatformError> {
        let _ = (path, max_size);
        Err(PlatformError::Unsupported {
            capability: PlatformCapabilities::THUMBNAILS,
        })
    }

    /// Reveals an entry in the system file manager (Finder/Explorer/...).
    fn reveal_in_file_manager(&self, path: &Path) -> Result<(), PlatformError> {
        let _ = path;
        Err(PlatformError::Unsupported {
            capability: PlatformCapabilities::REVEAL_IN_FILE_MANAGER,
        })
    }

    /// Moves an entry to the system trash/recycle bin.
    fn trash(&self, path: &Path) -> Result<(), PlatformError> {
        let _ = path;
        Err(PlatformError::Unsupported {
            capability: PlatformCapabilities::TRASH,
        })
    }

    /// Opens an entry with the OS default application.
    fn open_with_default_application(&self, path: &Path) -> Result<(), PlatformError> {
        let _ = path;
        Err(PlatformError::Unsupported {
            capability: PlatformCapabilities::OPEN_WITH_DEFAULT_APPLICATION,
        })
    }

    /// Opens a terminal at a location.
    ///
    /// `command_override` is the configured terminal setting (specification
    /// §26), e.g. an application or executable name; `None` means use this
    /// adapter's sensible platform default (e.g. `Terminal` on macOS).
    fn open_terminal(
        &self,
        path: &Path,
        command_override: Option<&str>,
    ) -> Result<(), PlatformError> {
        let _ = (path, command_override);
        Err(PlatformError::Unsupported {
            capability: PlatformCapabilities::OPEN_TERMINAL,
        })
    }

    /// Opens an entry in a text editor (task 0086), rather than its OS
    /// default application - e.g. opening a `.jpg` should still open a
    /// text/hex editor, not an image viewer.
    ///
    /// `command_override` is the configured editor setting (specification
    /// §26); `None` falls back to this adapter's default
    /// [`PlatformAdapter::open_with_default_application`] (a documented gap
    /// for adapters with no distinct text-editor association, not a silent
    /// over-claim - see `fm-application`'s `core_actions` doc comment).
    fn open_in_text_editor(
        &self,
        path: &Path,
        command_override: Option<&str>,
    ) -> Result<(), PlatformError> {
        let _ = command_override;
        self.open_with_default_application(path)
    }

    /// Shows the OS's native "Open With\u2026" application chooser for an
    /// entry (task 0061 follow-up), rather than silently opening it with the
    /// default application. Cancelling the chooser must be treated as a
    /// no-op, not an error.
    ///
    /// Falls back to [`PlatformAdapter::open_with_default_application`] for
    /// adapters with no native chooser (a documented gap, not a silent
    /// over-claim - see `fm-application`'s `core_actions` doc comment).
    fn open_with_chooser(&self, path: &Path) -> Result<(), PlatformError> {
        self.open_with_default_application(path)
    }

    /// Reads the file paths currently referenced on the OS clipboard.
    fn read_clipboard_file_references(&self) -> Result<Vec<PathBuf>, PlatformError> {
        Err(PlatformError::Unsupported {
            capability: PlatformCapabilities::CLIPBOARD_FILE_REFERENCES,
        })
    }

    /// Writes file paths to the OS clipboard as file references.
    fn write_clipboard_file_references(&self, paths: &[PathBuf]) -> Result<(), PlatformError> {
        let _ = paths;
        Err(PlatformError::Unsupported {
            capability: PlatformCapabilities::CLIPBOARD_FILE_REFERENCES,
        })
    }

    /// Lists currently mounted volumes/drives.
    fn mounted_volumes(&self) -> Result<Vec<MountedVolume>, PlatformError> {
        Err(PlatformError::Unsupported {
            capability: PlatformCapabilities::MOUNTED_VOLUMES,
        })
    }

    /// Reports total/available capacity for the volume containing `path`
    /// (task 0096), used to render a Marta/Finder-style status bar segment.
    fn volume_capacity(&self, path: &Path) -> Result<VolumeCapacity, PlatformError> {
        let _ = path;
        Err(PlatformError::Unsupported {
            capability: PlatformCapabilities::VOLUME_CAPACITY,
        })
    }

    /// Installs the application's native menu bar (task 0133), replacing
    /// whatever menu is currently installed.
    ///
    /// `on_action` is invoked (on the main thread) whenever the user clicks
    /// an [`fm_domain::NativeMenuItem::Action`] item, with that item's
    /// action-registry id - the same id the caller would dispatch through
    /// `fm-application`'s action registry for a matching keyboard shortcut,
    /// so a menu click and its shortcut share one code path rather than
    /// diverging. [`fm_domain::NativeMenuItem::Role`] items have no
    /// application callback: the adapter wires them directly to the
    /// matching native OS selector instead.
    fn install_native_menu(
        &self,
        spec: &fm_domain::NativeMenuSpec,
        on_action: std::sync::Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<(), PlatformError> {
        let _ = (spec, on_action);
        Err(PlatformError::Unsupported {
            capability: PlatformCapabilities::NATIVE_MENUS,
        })
    }
}
