//! Local filesystem implementation of the virtual filesystem provider.
//!
//! Directory entries are inspected without following symbolic links. macOS
//! Finder aliases are not detected yet and are treated as regular files.

use std::{
    collections::BTreeMap,
    io,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use fm_domain::{
    EntryId, EntryKind, EntryMetadata, EntrySummary, Location, PermissionsInfo, ProviderId,
};
use fm_vfs::{
    DirectoryPage, EntryRef, FileSystemProvider, ListOptions, ProviderCapabilities, ProviderChange,
    ProviderChangeStream, ProviderReadStream, ProviderWriteStream, RemoveOptions, VfsError,
    WriteOptions,
};
use futures::stream;
use notify::{Event, RecursiveMode, Watcher};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const WATCH_DEBOUNCE: Duration = Duration::from_millis(75);
const WATCH_INPUT_CAPACITY: usize = 64;

/// Provider for the host's local filesystem.
#[derive(Debug, Default)]
pub struct LocalFileSystemProvider;

impl LocalFileSystemProvider {
    /// Creates a local filesystem provider.
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

#[async_trait]
impl FileSystemProvider for LocalFileSystemProvider {
    fn id(&self) -> ProviderId {
        ProviderId::new("local")
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities::LIST
            | ProviderCapabilities::WATCH
            | ProviderCapabilities::CREATE_DIRECTORY
            | ProviderCapabilities::RENAME
    }

    async fn list(
        &self,
        location: &Location,
        options: ListOptions,
        cancellation: CancellationToken,
    ) -> Result<DirectoryPage, VfsError> {
        if cancellation.is_cancelled() {
            return Err(VfsError::Cancelled);
        }
        if options.page_size == 0 {
            return Err(VfsError::InvalidLocation {
                location: location.uri.clone(),
            });
        }
        let path = location
            .to_native_path()
            .map_err(|_| invalid_location(location))?;
        let offset = decode_token(options.continuation_token.as_deref(), location)?;
        let mut directory = tokio::fs::read_dir(&path)
            .await
            .map_err(|error| map_io_error(error, &location.uri))?;
        let mut skipped = 0_usize;
        while skipped < offset {
            if cancellation.is_cancelled() {
                return Err(VfsError::Cancelled);
            }
            match directory
                .next_entry()
                .await
                .map_err(|error| map_io_error(error, &location.uri))?
            {
                Some(_) => skipped += 1,
                None => return Ok(empty_page()),
            }
        }

        let mut entries = Vec::with_capacity(options.page_size);
        while entries.len() < options.page_size {
            if cancellation.is_cancelled() {
                return Err(VfsError::Cancelled);
            }
            let Some(entry) = directory
                .next_entry()
                .await
                .map_err(|error| map_io_error(error, &location.uri))?
            else {
                break;
            };
            entries.push(summarize_entry(entry, location).await?);
        }
        let has_more = directory
            .next_entry()
            .await
            .map_err(|error| map_io_error(error, &location.uri))?
            .is_some();
        let continuation_token = has_more.then(|| (offset + entries.len()).to_string());
        Ok(DirectoryPage {
            entries,
            total_known_entries: None,
            has_more,
            continuation_token,
        })
    }

    async fn metadata(
        &self,
        entry: &EntryRef,
        cancellation: CancellationToken,
    ) -> Result<EntryMetadata, VfsError> {
        if cancellation.is_cancelled() {
            return Err(VfsError::Cancelled);
        }
        let path = entry
            .location
            .to_native_path()
            .map_err(|_| invalid_location(&entry.location))?;
        let metadata = tokio::fs::symlink_metadata(path)
            .await
            .map_err(|error| map_io_error(error, &entry.location.uri))?;
        Ok(EntryMetadata {
            entry_id: entry.id,
            permissions: Some(permissions(&metadata)),
            ownership: None,
            extended_attributes: BTreeMap::new(),
            checksums: BTreeMap::new(),
            image_dimensions: None,
            media: None,
            archive: None,
            plugin_fields: BTreeMap::new(),
        })
    }

    async fn create_directory(
        &self,
        location: &Location,
        name: &str,
        cancellation: CancellationToken,
    ) -> Result<EntryRef, VfsError> {
        if cancellation.is_cancelled() {
            return Err(VfsError::Cancelled);
        }
        validate_directory_name(name)?;
        let parent = location
            .to_native_path()
            .map_err(|_| invalid_location(location))?;
        let path = parent.join(name);
        tokio::fs::create_dir(&path)
            .await
            .map_err(|error| map_io_error(error, &location.uri))?;
        let child = location
            .join(name)
            .map_err(|_| invalid_location(location))?;
        let metadata = tokio::fs::symlink_metadata(&path)
            .await
            .map_err(|error| map_io_error(error, &child.uri))?;
        Ok(EntryRef {
            id: stable_entry_id(&metadata, &child),
            location: child,
        })
    }

    async fn rename(
        &self,
        source: &EntryRef,
        destination: &Location,
        cancellation: CancellationToken,
    ) -> Result<EntryRef, VfsError> {
        if cancellation.is_cancelled() {
            return Err(VfsError::Cancelled);
        }
        let destination_name = destination
            .name()
            .map_err(|_| invalid_location(destination))?;
        validate_directory_name(&destination_name)?;
        let source_path = source
            .location
            .to_native_path()
            .map_err(|_| invalid_location(&source.location))?;
        let destination_path = destination
            .to_native_path()
            .map_err(|_| invalid_location(destination))?;
        let case_only = source_path != destination_path
            && source_path
                .to_string_lossy()
                .eq_ignore_ascii_case(&destination_path.to_string_lossy());
        if destination_path.exists() && !case_only {
            return Err(VfsError::AlreadyExists {
                location: destination.uri.clone(),
            });
        }
        if case_only {
            let parent = source_path
                .parent()
                .ok_or_else(|| invalid_location(&source.location))?;
            let temporary = parent.join(format!(".fm-rename-{}", Uuid::new_v4()));
            tokio::fs::rename(&source_path, &temporary)
                .await
                .map_err(|error| map_io_error(error, &source.location.uri))?;
            if let Err(error) = tokio::fs::rename(&temporary, &destination_path).await {
                let _ = tokio::fs::rename(&temporary, &source_path).await;
                return Err(map_io_error(error, &destination.uri));
            }
        } else {
            tokio::fs::rename(&source_path, &destination_path)
                .await
                .map_err(|error| map_io_error(error, &destination.uri))?;
        }
        Ok(EntryRef {
            id: source.id,
            location: destination.clone(),
        })
    }

    async fn remove(
        &self,
        _entry: &EntryRef,
        _options: RemoveOptions,
        _cancellation: CancellationToken,
    ) -> Result<(), VfsError> {
        unsupported(ProviderCapabilities::DELETE)
    }

    async fn open_read(
        &self,
        _entry: &EntryRef,
        _cancellation: CancellationToken,
    ) -> Result<ProviderReadStream, VfsError> {
        unsupported(ProviderCapabilities::READ)
    }

    async fn open_write(
        &self,
        _destination: &Location,
        _options: WriteOptions,
        _cancellation: CancellationToken,
    ) -> Result<ProviderWriteStream, VfsError> {
        unsupported(ProviderCapabilities::WRITE)
    }

    async fn watch(
        &self,
        location: &Location,
        cancellation: CancellationToken,
    ) -> Result<ProviderChangeStream, VfsError> {
        if cancellation.is_cancelled() {
            return Err(VfsError::Cancelled);
        }
        let path = location
            .to_native_path()
            .map_err(|_| invalid_location(location))?;
        let (input_tx, mut input_rx) = mpsc::channel(WATCH_INPUT_CAPACITY);
        let (output_tx, output_rx) = mpsc::channel(8);
        let reset_required = Arc::new(AtomicBool::new(false));
        let callback_reset = Arc::clone(&reset_required);
        let handler = move |result: notify::Result<Event>| {
            let reset = result.as_ref().map_or(true, |event| event.need_rescan());
            if reset {
                callback_reset.store(true, Ordering::Release);
            }
            if input_tx.try_send(()).is_err() {
                callback_reset.store(true, Ordering::Release);
            }
        };
        let mut watcher = notify::PollWatcher::new(
            handler,
            notify::Config::default().with_poll_interval(Duration::from_millis(100)),
        )
        .map_err(|error| watch_error(error, location))?;
        watcher
            .watch(&path, RecursiveMode::Recursive)
            .map_err(|error| watch_error(error, location))?;

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    () = cancellation.cancelled() => break,
                    signal = input_rx.recv() => {
                        if signal.is_none() {
                            break;
                        }
                        tokio::time::sleep(WATCH_DEBOUNCE).await;
                        while input_rx.try_recv().is_ok() {}
                        let change = if reset_required.swap(false, Ordering::AcqRel) {
                            ProviderChange::ResetRequired
                        } else {
                            ProviderChange::Changed
                        };
                        if output_tx.send(Ok(change)).await.is_err() {
                            break;
                        }
                    }
                }
            }
            drop(watcher);
        });

        Ok(Box::pin(stream::unfold(output_rx, |mut receiver| async {
            receiver.recv().await.map(|change| (change, receiver))
        })))
    }
}

async fn summarize_entry(
    entry: tokio::fs::DirEntry,
    parent: &Location,
) -> Result<EntrySummary, VfsError> {
    let name = entry
        .file_name()
        .into_string()
        .map_err(|_| VfsError::InvalidLocation {
            location: parent.uri.clone(),
        })?;
    let location = parent.join(&name).map_err(|_| invalid_location(parent))?;
    let metadata = tokio::fs::symlink_metadata(entry.path())
        .await
        .map_err(|error| map_io_error(error, &location.uri))?;
    let file_type = entry
        .file_type()
        .await
        .map_err(|error| map_io_error(error, &location.uri))?;
    let kind = if is_link(&file_type, &metadata) {
        EntryKind::Symlink
    } else if file_type.is_dir() {
        EntryKind::Directory
    } else {
        EntryKind::File
    };
    Ok(EntrySummary {
        id: stable_entry_id(&metadata, &location),
        location,
        extension: Path::new(&name)
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_owned),
        hidden: is_hidden(&name, &metadata),
        name,
        kind,
        size: (kind == EntryKind::File).then_some(metadata.len()),
        modified_at: metadata.modified().ok().map(DateTime::<Utc>::from),
        created_at: metadata.created().ok().map(DateTime::<Utc>::from),
        read_only: metadata.permissions().readonly(),
        mime_type: None,
        icon_key: None,
        metadata_revision: 0,
    })
}

fn stable_entry_id(metadata: &std::fs::Metadata, _location: &Location) -> EntryId {
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        format!("local:{}:{}", metadata.dev(), metadata.ino())
    };
    #[cfg(windows)]
    let identity = {
        use std::os::windows::fs::MetadataExt;
        format!(
            "local:{}:{}",
            metadata.volume_serial_number().unwrap_or_default(),
            metadata.file_index().unwrap_or_default()
        )
    };
    #[cfg(not(any(unix, windows)))]
    let identity = format!("local:{}", _location.uri);

    EntryId::from(Uuid::new_v5(&Uuid::NAMESPACE_URL, identity.as_bytes()))
}

fn watch_error(error: notify::Error, location: &Location) -> VfsError {
    VfsError::Io {
        message: format!("{}: {error}", location.uri),
    }
}

#[cfg(windows)]
fn is_link(file_type: &std::fs::FileType, metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    file_type.is_symlink() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_link(file_type: &std::fs::FileType, _metadata: &std::fs::Metadata) -> bool {
    file_type.is_symlink()
}

fn decode_token(token: Option<&str>, location: &Location) -> Result<usize, VfsError> {
    token.map_or(Ok(0), |value| {
        value.parse().map_err(|_| invalid_location(location))
    })
}

fn empty_page() -> DirectoryPage {
    DirectoryPage {
        entries: Vec::new(),
        total_known_entries: None,
        has_more: false,
        continuation_token: None,
    }
}

fn permissions(metadata: &std::fs::Metadata) -> PermissionsInfo {
    PermissionsInfo {
        readable: true,
        writable: !metadata.permissions().readonly(),
        executable: executable(metadata),
        unix_mode: unix_mode(metadata),
    }
}

#[cfg(unix)]
fn executable(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn executable(_metadata: &std::fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn unix_mode(metadata: &std::fs::Metadata) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    Some(metadata.permissions().mode())
}

#[cfg(not(unix))]
fn unix_mode(_metadata: &std::fs::Metadata) -> Option<u32> {
    None
}

#[cfg(windows)]
fn is_hidden(name: &str, metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    name.starts_with('.') || metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(not(windows))]
fn is_hidden(name: &str, _metadata: &std::fs::Metadata) -> bool {
    name.starts_with('.')
}

fn invalid_location(location: &Location) -> VfsError {
    VfsError::InvalidLocation {
        location: location.uri.clone(),
    }
}

fn validate_directory_name(name: &str) -> Result<(), VfsError> {
    if name.is_empty() {
        return Err(VfsError::EmptyName);
    }
    if name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err(VfsError::PathTraversalName);
    }
    if name.contains('\0') || cfg!(windows) && name.chars().any(|c| "<>:\"|?*".contains(c)) {
        return Err(VfsError::InvalidNameCharacters);
    }
    let stem = name.split('.').next().unwrap_or_default();
    let upper = stem.trim_end_matches([' ', '.']).to_ascii_uppercase();
    let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .or_else(|| upper.strip_prefix("LPT"))
            .is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            });
    if reserved {
        return Err(VfsError::ReservedName);
    }
    Ok(())
}

fn map_io_error(error: io::Error, location: &str) -> VfsError {
    match error.kind() {
        io::ErrorKind::NotFound => VfsError::NotFound {
            location: location.to_owned(),
        },
        io::ErrorKind::PermissionDenied => VfsError::PermissionDenied {
            location: location.to_owned(),
        },
        io::ErrorKind::AlreadyExists => VfsError::AlreadyExists {
            location: location.to_owned(),
        },
        io::ErrorKind::NotADirectory => VfsError::NotADirectory {
            location: location.to_owned(),
        },
        _ => VfsError::Io {
            message: error.to_string(),
        },
    }
}

fn unsupported<T>(capability: ProviderCapabilities) -> Result<T, VfsError> {
    Err(VfsError::UnsupportedCapability { capability })
}
