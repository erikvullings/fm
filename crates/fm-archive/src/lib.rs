//! Virtual filesystem provider for archive files (task 0076).
//!
//! Archive paths use `archive:///absolute/file.zip!/inner/path`. Codec work is delegated to
//! permissively licensed libraries; this crate owns provider semantics and safety policy only.

use std::{
    collections::{BTreeMap, HashMap},
    fs::File,
    io::{Cursor, Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

use async_trait::async_trait;
use fm_domain::{EntryId, EntryKind, EntryMetadata, EntrySummary, Location, ProviderId};
use fm_vfs::{
    CopyCommitOptions, DirectoryPage, EntryRef, FileSystemProvider, ListOptions,
    ProviderCapabilities, ProviderChangeStream, ProviderReadStream, ProviderWriteStream,
    RemoveOptions, VfsError, WriteOptions,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use zeroize::Zeroizing;

const ARCHIVE_PREFIX: &str = "archive://";
const FILE_PREFIX: &str = "file://";
const ZIP_MAGIC: &[u8] = b"PK";
const SEVEN_Z_MAGIC: &[u8] = b"7z\xBC\xAF\x27\x1C";
const GZIP_MAGIC: &[u8] = b"\x1f\x8b";
const BZIP2_MAGIC: &[u8] = b"BZh";
const XZ_MAGIC: &[u8] = b"\xfd7zXZ\0";
const RAR4_MAGIC: &[u8] = b"Rar!\x1a\x07\0";
const RAR5_MAGIC: &[u8] = b"Rar!\x1a\x07\x01\0";

/// Resource policy applied before an archive entry is expanded.
#[derive(Clone, Copy, Debug)]
pub struct ArchiveLimits {
    /// Largest permitted expanded entry.
    pub max_uncompressed_entry_bytes: u64,
    /// Largest permitted expansion ratio (`uncompressed / compressed`).
    pub max_expansion_ratio: u64,
}

impl Default for ArchiveLimits {
    fn default() -> Self {
        Self {
            max_uncompressed_entry_bytes: 8 * 1024 * 1024 * 1024,
            max_expansion_ratio: 1_000,
        }
    }
}

/// Provider that exposes supported archive entries as virtual directories.
#[derive(Debug, Default)]
pub struct ArchiveFileSystemProvider {
    staged_writes: Mutex<HashMap<String, PathBuf>>,
    passwords: Mutex<HashMap<PathBuf, Zeroizing<String>>>,
    limits: ArchiveLimits,
}

impl ArchiveFileSystemProvider {
    /// Creates an archive provider with an empty backend-session credential cache.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a provider with explicit decompression-bomb limits.
    #[must_use]
    pub fn with_limits(limits: ArchiveLimits) -> Self {
        Self {
            staged_writes: Mutex::new(HashMap::new()),
            passwords: Mutex::new(HashMap::new()),
            limits,
        }
    }

    /// Caches an archive password in owned, zeroizing memory for this provider session.
    pub fn cache_password(&self, location: &Location, password: String) -> Result<(), VfsError> {
        let archive_path = ParsedArchiveLocation::parse(location)?.archive_path;
        self.passwords
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(archive_path, Zeroizing::new(password));
        Ok(())
    }

    fn password_for(&self, archive_path: &Path) -> Option<Zeroizing<String>> {
        self.passwords
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(archive_path)
            .map(|password| Zeroizing::new(password.to_string()))
    }
}

#[async_trait]
impl FileSystemProvider for ArchiveFileSystemProvider {
    fn id(&self) -> ProviderId {
        ProviderId::new("archive")
    }

    fn capabilities(&self) -> ProviderCapabilities {
        // The scheme-level baseline is intentionally read-only. Callers with a location use
        // `capabilities_for`, which adds mutation only for ZIP.
        ProviderCapabilities::LIST | ProviderCapabilities::READ
    }

    fn capabilities_for(&self, location: &Location) -> Result<ProviderCapabilities, VfsError> {
        let archive_path = ParsedArchiveLocation::parse(location)?.archive_path;
        let format = detect_format(&archive_path)?;
        if format == ArchiveFormat::Rar {
            return Ok(ProviderCapabilities::empty());
        }
        let mut capabilities = self.capabilities();
        if format == ArchiveFormat::Zip {
            capabilities |= ProviderCapabilities::WRITE
                | ProviderCapabilities::CREATE_DIRECTORY
                | ProviderCapabilities::DELETE;
        }
        Ok(capabilities)
    }

    async fn list(
        &self,
        location: &Location,
        options: ListOptions,
        cancellation: CancellationToken,
    ) -> Result<DirectoryPage, VfsError> {
        check_request(location, options.page_size, &cancellation)?;
        let parsed = ParsedArchiveLocation::parse(location)?;
        let requested = parsed.inner.clone();
        let archive_path = parsed.archive_path.clone();
        let password = self.password_for(&archive_path);
        let (entries, writable) = tokio::task::spawn_blocking(move || {
            let entries = list_archive(
                &archive_path,
                &requested,
                password.as_ref().map(|value| value.as_str()),
            )?;
            Ok::<_, VfsError>((entries, detect_format(&archive_path)? == ArchiveFormat::Zip))
        })
        .await
        .map_err(join_error)??;
        if cancellation.is_cancelled() {
            return Err(VfsError::Cancelled);
        }
        paginate(entries, options, location, writable)
    }

    async fn metadata(
        &self,
        entry: &EntryRef,
        cancellation: CancellationToken,
    ) -> Result<EntryMetadata, VfsError> {
        let summary = self.inspect(entry, cancellation).await?;
        Ok(EntryMetadata {
            entry_id: summary.id,
            permissions: None,
            ownership: None,
            extended_attributes: BTreeMap::new(),
            checksums: BTreeMap::new(),
            image_dimensions: None,
            media: None,
            archive: None,
            plugin_fields: BTreeMap::new(),
        })
    }

    async fn inspect(
        &self,
        entry: &EntryRef,
        cancellation: CancellationToken,
    ) -> Result<EntrySummary, VfsError> {
        if cancellation.is_cancelled() {
            return Err(VfsError::Cancelled);
        }
        let parent = entry
            .location
            .parent()
            .map_err(|_| invalid(&entry.location))?
            .ok_or_else(|| VfsError::IsADirectory {
                location: entry.location.uri.clone(),
            })?;
        let name = entry
            .location
            .name()
            .map_err(|_| invalid(&entry.location))?;
        self.list(
            &parent,
            ListOptions {
                page_size: usize::MAX,
                continuation_token: None,
            },
            cancellation,
        )
        .await?
        .entries
        .into_iter()
        .find(|candidate| candidate.name == name)
        .ok_or_else(|| VfsError::NotFound {
            location: entry.location.uri.clone(),
        })
    }

    async fn file_size(
        &self,
        entry: &EntryRef,
        cancellation: CancellationToken,
    ) -> Result<u64, VfsError> {
        let summary = self.inspect(entry, cancellation).await?;
        summary.size.ok_or_else(|| VfsError::IsADirectory {
            location: entry.location.uri.clone(),
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
        let destination = location.join(name).map_err(|_| invalid(location))?;
        let parsed = ParsedArchiveLocation::parse(&destination)?;
        let archive_path = parsed.archive_path;
        let inner = format!("{}/", parsed.inner);
        let rewrite_cancellation = cancellation.clone();
        tokio::task::spawn_blocking(move || {
            require_zip_mutation(&archive_path, ProviderCapabilities::CREATE_DIRECTORY)?;
            rewrite_zip(
                &archive_path,
                Rewrite::AddDirectory(&inner),
                &rewrite_cancellation,
            )
        })
        .await
        .map_err(join_error)??;
        Ok(EntryRef {
            id: stable_id(&destination),
            location: destination,
        })
    }

    async fn rename(
        &self,
        _source: &EntryRef,
        _destination: &Location,
        _cancellation: CancellationToken,
    ) -> Result<EntryRef, VfsError> {
        unsupported(ProviderCapabilities::RENAME)
    }

    async fn remove(
        &self,
        entry: &EntryRef,
        options: RemoveOptions,
        cancellation: CancellationToken,
    ) -> Result<(), VfsError> {
        if cancellation.is_cancelled() {
            return Err(VfsError::Cancelled);
        }
        if options.use_trash {
            return unsupported(ProviderCapabilities::TRASH);
        }
        let parsed = ParsedArchiveLocation::parse(&entry.location)?;
        if parsed.inner.is_empty() {
            return Err(invalid(&entry.location));
        }
        let archive_path = parsed.archive_path;
        let inner = parsed.inner;
        let rewrite_cancellation = cancellation.clone();
        tokio::task::spawn_blocking(move || {
            require_zip_mutation(&archive_path, ProviderCapabilities::DELETE)?;
            rewrite_zip(
                &archive_path,
                Rewrite::Remove {
                    inner: &inner,
                    recursive: options.recursive,
                },
                &rewrite_cancellation,
            )
        })
        .await
        .map_err(join_error)??;
        Ok(())
    }

    async fn open_read(
        &self,
        entry: &EntryRef,
        cancellation: CancellationToken,
    ) -> Result<ProviderReadStream, VfsError> {
        if cancellation.is_cancelled() {
            return Err(VfsError::Cancelled);
        }
        let parsed = ParsedArchiveLocation::parse(&entry.location)?;
        if parsed.inner.is_empty() {
            return Err(VfsError::IsADirectory {
                location: entry.location.uri.clone(),
            });
        }
        let archive_path = parsed.archive_path;
        let inner = parsed.inner;
        let password = self.password_for(&archive_path);
        let limits = self.limits;
        let bytes = tokio::task::spawn_blocking(move || {
            read_archive_entry(
                &archive_path,
                &inner,
                limits,
                password.as_ref().map(|value| value.as_str()),
            )
        })
        .await
        .map_err(join_error)??;
        if cancellation.is_cancelled() {
            return Err(VfsError::Cancelled);
        }
        Ok(Box::pin(Cursor::new(bytes)))
    }

    async fn open_write(
        &self,
        destination: &Location,
        _options: WriteOptions,
        cancellation: CancellationToken,
    ) -> Result<ProviderWriteStream, VfsError> {
        if cancellation.is_cancelled() {
            return Err(VfsError::Cancelled);
        }
        let parsed = ParsedArchiveLocation::parse(destination)?;
        let archive_path = parsed.archive_path.clone();
        tokio::task::spawn_blocking(move || {
            require_zip_mutation(&archive_path, ProviderCapabilities::WRITE)
        })
        .await
        .map_err(join_error)??;
        let parent = parsed
            .archive_path
            .parent()
            .ok_or_else(|| invalid(destination))?;
        let staging = parent.join(format!(".fm-archive-entry-{}.tmp", Uuid::new_v4()));
        let file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&staging)
            .await
            .map_err(|error| io_error(error, &staging))?;
        self.staged_writes
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(destination.uri.clone(), staging);
        Ok(Box::pin(file))
    }

    async fn commit_copy(
        &self,
        _source: &EntryRef,
        temporary: &Location,
        destination: &Location,
        options: CopyCommitOptions,
        cancellation: CancellationToken,
    ) -> Result<EntryRef, VfsError> {
        if cancellation.is_cancelled() {
            return Err(VfsError::Cancelled);
        }
        let staging = self
            .staged_writes
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&temporary.uri)
            .ok_or_else(|| invalid(temporary))?;
        let parsed = ParsedArchiveLocation::parse(destination)?;
        let archive_path = parsed.archive_path;
        let inner = parsed.inner;
        let staging_for_worker = staging.clone();
        let rewrite_cancellation = cancellation.clone();
        let result = tokio::task::spawn_blocking(move || {
            require_zip_mutation(&archive_path, ProviderCapabilities::WRITE)?;
            rewrite_zip(
                &archive_path,
                Rewrite::AddFile {
                    inner: &inner,
                    staging: &staging_for_worker,
                    overwrite: options.overwrite,
                },
                &rewrite_cancellation,
            )
        })
        .await
        .map_err(join_error)?;
        if result.is_err() {
            let _ = tokio::fs::remove_file(&staging).await;
        }
        result?;
        Ok(EntryRef {
            id: stable_id(destination),
            location: destination.clone(),
        })
    }

    async fn discard_copy(
        &self,
        temporary: &Location,
        _cancellation: CancellationToken,
    ) -> Result<(), VfsError> {
        let staging = self
            .staged_writes
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&temporary.uri);
        if let Some(staging) = staging {
            match tokio::fs::remove_file(&staging).await {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(io_error(error, &staging)),
            }
        }
        Ok(())
    }

    async fn watch(
        &self,
        _location: &Location,
        _cancellation: CancellationToken,
    ) -> Result<ProviderChangeStream, VfsError> {
        unsupported(ProviderCapabilities::WATCH)
    }
}

#[derive(Debug)]
struct ParsedArchiveLocation {
    archive_path: PathBuf,
    inner: String,
}

impl ParsedArchiveLocation {
    fn parse(location: &Location) -> Result<Self, VfsError> {
        if location.provider_id.as_str() != "archive" {
            return Err(invalid(location));
        }
        let remainder = location
            .uri
            .strip_prefix(ARCHIVE_PREFIX)
            .ok_or_else(|| invalid(location))?;
        let (outer, inner) = remainder.split_once('!').ok_or_else(|| invalid(location))?;
        let local =
            Location::parse(&format!("{FILE_PREFIX}{outer}")).map_err(|_| invalid(location))?;
        let archive_path = local.to_native_path().map_err(|_| invalid(location))?;
        let inner = inner.strip_prefix('/').unwrap_or(inner).to_owned();
        Ok(Self {
            archive_path,
            inner,
        })
    }
}

fn list_zip(archive_path: &Path, requested: &str) -> Result<Vec<RawEntry>, VfsError> {
    let file = File::open(archive_path).map_err(|error| io_error(error, archive_path))?;
    let mut archive = zip::ZipArchive::new(file).map_err(zip_error)?;
    let prefix = if requested.is_empty() {
        String::new()
    } else {
        format!("{requested}/")
    };
    let mut children: HashMap<String, RawEntry> = HashMap::new();
    for index in 0..archive.len() {
        let item = archive.by_index_raw(index).map_err(zip_error)?;
        let path = safe_entry_path(&item)?;
        let Some(remainder) = path.strip_prefix(&prefix) else {
            continue;
        };
        if remainder.is_empty() {
            continue;
        }
        let mut parts = remainder.split('/');
        let name = parts.next().unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let has_descendants = parts.next().is_some();
        let is_directory = has_descendants || item.is_dir();
        let candidate = RawEntry {
            name: name.to_owned(),
            kind: if is_directory {
                EntryKind::Directory
            } else {
                EntryKind::File
            },
            size: (!is_directory).then_some(item.size()),
        };
        match children.get(name) {
            Some(existing) if existing.kind != candidate.kind => {
                return Err(VfsError::Io {
                    message: "archive contains conflicting duplicate entry names".into(),
                });
            }
            Some(_) => {}
            None => {
                children.insert(name.to_owned(), candidate);
            }
        }
    }
    let mut values: Vec<_> = children.into_values().collect();
    values.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(values)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ArchiveFormat {
    Zip,
    SevenZip,
    Gzip,
    Tar(TarCompression),
    Rar,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TarCompression {
    None,
    Gzip,
    Bzip2,
    Xz,
}

fn detect_format(archive_path: &Path) -> Result<ArchiveFormat, VfsError> {
    let mut file = File::open(archive_path).map_err(|error| io_error(error, archive_path))?;
    let mut magic = [0_u8; 512];
    let count = file
        .read(&mut magic)
        .map_err(|error| io_error(error, archive_path))?;
    if magic[..count].starts_with(SEVEN_Z_MAGIC) {
        Ok(ArchiveFormat::SevenZip)
    } else if magic[..count].starts_with(ZIP_MAGIC) {
        Ok(ArchiveFormat::Zip)
    } else if magic[..count].starts_with(GZIP_MAGIC) {
        let file = File::open(archive_path).map_err(|error| io_error(error, archive_path))?;
        let mut decoder = flate2::read::GzDecoder::new(file).take(262);
        let mut decompressed_magic = Vec::with_capacity(262);
        decoder
            .read_to_end(&mut decompressed_magic)
            .map_err(|error| io_error(error, archive_path))?;
        if decompressed_magic.len() >= 262 && &decompressed_magic[257..262] == b"ustar" {
            Ok(ArchiveFormat::Tar(TarCompression::Gzip))
        } else {
            Ok(ArchiveFormat::Gzip)
        }
    } else if magic[..count].starts_with(BZIP2_MAGIC) {
        Ok(ArchiveFormat::Tar(TarCompression::Bzip2))
    } else if magic[..count].starts_with(XZ_MAGIC) {
        Ok(ArchiveFormat::Tar(TarCompression::Xz))
    } else if magic[..count].starts_with(RAR4_MAGIC) || magic[..count].starts_with(RAR5_MAGIC) {
        Ok(ArchiveFormat::Rar)
    } else if count >= 262 && &magic[257..262] == b"ustar" {
        Ok(ArchiveFormat::Tar(TarCompression::None))
    } else {
        Err(VfsError::Io {
            message: "unsupported or unrecognized archive format".into(),
        })
    }
}

fn require_zip_mutation(
    archive_path: &Path,
    capability: ProviderCapabilities,
) -> Result<(), VfsError> {
    if detect_format(archive_path)? == ArchiveFormat::Zip {
        Ok(())
    } else {
        unsupported(capability)
    }
}

fn list_archive(
    archive_path: &Path,
    requested: &str,
    password: Option<&str>,
) -> Result<Vec<RawEntry>, VfsError> {
    match detect_format(archive_path)? {
        ArchiveFormat::Zip => list_zip(archive_path, requested),
        ArchiveFormat::SevenZip => list_seven_zip(archive_path, requested, password),
        ArchiveFormat::Gzip => list_gzip(archive_path, requested),
        ArchiveFormat::Tar(compression) => list_tar(archive_path, requested, compression),
        ArchiveFormat::Rar => unsupported(ProviderCapabilities::LIST),
    }
}

fn gzip_entry_name(archive_path: &Path) -> Result<String, VfsError> {
    let file_name = archive_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| VfsError::Io {
            message: "gzip filename is not valid Unicode".into(),
        })?;
    let name = file_name
        .get(..file_name.len().saturating_sub(3))
        .filter(|_| file_name.to_ascii_lowercase().ends_with(".gz"))
        .filter(|name| !name.is_empty())
        .unwrap_or("content");
    safe_stored_path(name, false)
}

fn gzip_uncompressed_size(archive_path: &Path) -> Result<u64, VfsError> {
    let mut file = File::open(archive_path).map_err(|error| io_error(error, archive_path))?;
    file.seek(SeekFrom::End(-4))
        .map_err(|error| io_error(error, archive_path))?;
    let mut trailer = [0_u8; 4];
    file.read_exact(&mut trailer)
        .map_err(|error| io_error(error, archive_path))?;
    Ok(u64::from(u32::from_le_bytes(trailer)))
}

fn list_gzip(archive_path: &Path, requested: &str) -> Result<Vec<RawEntry>, VfsError> {
    if !requested.is_empty() {
        return Ok(Vec::new());
    }
    Ok(vec![RawEntry {
        name: gzip_entry_name(archive_path)?,
        kind: EntryKind::File,
        size: Some(gzip_uncompressed_size(archive_path)?),
    }])
}

fn tar_reader(archive_path: &Path, compression: TarCompression) -> Result<Box<dyn Read>, VfsError> {
    let file = File::open(archive_path).map_err(|error| io_error(error, archive_path))?;
    Ok(match compression {
        TarCompression::None => Box::new(file),
        TarCompression::Gzip => Box::new(flate2::read::GzDecoder::new(file)),
        TarCompression::Bzip2 => Box::new(bzip2::read::BzDecoder::new(file)),
        TarCompression::Xz => Box::new(xz2::read::XzDecoder::new(file)),
    })
}

fn list_tar(
    archive_path: &Path,
    requested: &str,
    compression: TarCompression,
) -> Result<Vec<RawEntry>, VfsError> {
    let mut archive = tar::Archive::new(tar_reader(archive_path, compression)?);
    let entries = archive
        .entries()
        .map_err(|error| io_error(error, archive_path))?
        .map(|entry| {
            let entry = entry.map_err(|error| io_error(error, archive_path))?;
            let entry_type = entry.header().entry_type();
            if !(entry_type.is_file() || entry_type.is_dir()) {
                return Err(unsafe_entry_error());
            }
            let path = entry
                .path()
                .map_err(|error| io_error(error, archive_path))?;
            let name = safe_stored_path(&path.to_string_lossy(), entry_type.is_dir())?;
            Ok((
                name,
                entry_type.is_dir(),
                entry
                    .header()
                    .size()
                    .map_err(|error| io_error(error, archive_path))?,
            ))
        })
        .collect::<Result<Vec<_>, VfsError>>()?;
    collect_children(entries, requested)
}

fn list_seven_zip(
    archive_path: &Path,
    requested: &str,
    password: Option<&str>,
) -> Result<Vec<RawEntry>, VfsError> {
    let password = password
        .map(sevenz_rust2::Password::from)
        .unwrap_or_else(sevenz_rust2::Password::empty);
    let archive = sevenz_rust2::Archive::open_with_password(archive_path, &password)
        .map_err(seven_zip_error)?;
    let entries = archive
        .files
        .iter()
        .map(|entry| {
            let name = safe_stored_path(&entry.name, entry.is_directory)?;
            Ok((name, entry.is_directory, entry.size))
        })
        .collect::<Result<Vec<_>, VfsError>>()?;
    collect_children(entries, requested)
}

fn collect_children(
    entries: impl IntoIterator<Item = (String, bool, u64)>,
    requested: &str,
) -> Result<Vec<RawEntry>, VfsError> {
    let prefix = if requested.is_empty() {
        String::new()
    } else {
        format!("{requested}/")
    };
    let mut children: HashMap<String, RawEntry> = HashMap::new();
    for (path, stored_directory, size) in entries {
        let Some(remainder) = path.strip_prefix(&prefix) else {
            continue;
        };
        if remainder.is_empty() {
            continue;
        }
        let mut parts = remainder.split('/');
        let name = parts.next().unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let is_directory = parts.next().is_some() || stored_directory;
        let candidate = RawEntry {
            name: name.to_owned(),
            kind: if is_directory {
                EntryKind::Directory
            } else {
                EntryKind::File
            },
            size: (!is_directory).then_some(size),
        };
        match children.get(name) {
            Some(existing) if existing.kind != candidate.kind => {
                return Err(VfsError::Io {
                    message: "archive contains conflicting duplicate entry names".into(),
                });
            }
            Some(_) => {}
            None => {
                children.insert(name.to_owned(), candidate);
            }
        }
    }
    let mut values: Vec<_> = children.into_values().collect();
    values.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(values)
}

fn read_archive_entry(
    archive_path: &Path,
    inner: &str,
    limits: ArchiveLimits,
    password: Option<&str>,
) -> Result<Vec<u8>, VfsError> {
    match detect_format(archive_path)? {
        ArchiveFormat::Zip => read_zip_entry(archive_path, inner, limits, password),
        ArchiveFormat::SevenZip => {
            let password = password
                .map(sevenz_rust2::Password::from)
                .unwrap_or_else(sevenz_rust2::Password::empty);
            let mut reader = sevenz_rust2::ArchiveReader::open(archive_path, password)
                .map_err(seven_zip_error)?;
            let entry = reader
                .archive()
                .files
                .iter()
                .find(|entry| entry.name == inner)
                .ok_or_else(|| VfsError::NotFound {
                    location: inner.to_owned(),
                })?;
            check_limits(entry.size, entry.compressed_size, limits)?;
            reader.read_file(inner).map_err(seven_zip_error)
        }
        ArchiveFormat::Gzip => read_gzip_entry(archive_path, inner, limits),
        ArchiveFormat::Tar(compression) => read_tar_entry(archive_path, inner, limits, compression),
        ArchiveFormat::Rar => unsupported(ProviderCapabilities::READ),
    }
}

fn read_gzip_entry(
    archive_path: &Path,
    inner: &str,
    limits: ArchiveLimits,
) -> Result<Vec<u8>, VfsError> {
    if inner != gzip_entry_name(archive_path)? {
        return Err(VfsError::NotFound {
            location: inner.to_owned(),
        });
    }
    let compressed = std::fs::metadata(archive_path)
        .map_err(|error| io_error(error, archive_path))?
        .len();
    let file = File::open(archive_path).map_err(|error| io_error(error, archive_path))?;
    let limit = limits.max_uncompressed_entry_bytes.saturating_add(1);
    let mut decoder = flate2::read::GzDecoder::new(file).take(limit);
    let mut bytes = Vec::new();
    decoder
        .read_to_end(&mut bytes)
        .map_err(|error| io_error(error, archive_path))?;
    let uncompressed = u64::try_from(bytes.len()).map_err(|_| VfsError::ArchiveResourceLimit {
        kind: "uncompressedEntryBytes",
    })?;
    check_limits(uncompressed, compressed, limits)?;
    Ok(bytes)
}

fn read_tar_entry(
    archive_path: &Path,
    inner: &str,
    limits: ArchiveLimits,
    compression: TarCompression,
) -> Result<Vec<u8>, VfsError> {
    let mut archive = tar::Archive::new(tar_reader(archive_path, compression)?);
    for entry in archive
        .entries()
        .map_err(|error| io_error(error, archive_path))?
    {
        let mut entry = entry.map_err(|error| io_error(error, archive_path))?;
        let entry_type = entry.header().entry_type();
        if !(entry_type.is_file() || entry_type.is_dir()) {
            return Err(unsafe_entry_error());
        }
        let path = entry
            .path()
            .map_err(|error| io_error(error, archive_path))?;
        let name = safe_stored_path(&path.to_string_lossy(), entry_type.is_dir())?;
        if name != inner {
            continue;
        }
        if entry_type.is_dir() {
            return Err(VfsError::IsADirectory {
                location: inner.to_owned(),
            });
        }
        let size = entry
            .header()
            .size()
            .map_err(|error| io_error(error, archive_path))?;
        if size > limits.max_uncompressed_entry_bytes {
            return Err(VfsError::ArchiveResourceLimit {
                kind: "uncompressedEntryBytes",
            });
        }
        let capacity = usize::try_from(size).map_err(|_| VfsError::ArchiveResourceLimit {
            kind: "uncompressedEntryBytes",
        })?;
        let mut bytes = Vec::with_capacity(capacity);
        entry
            .read_to_end(&mut bytes)
            .map_err(|error| io_error(error, archive_path))?;
        return Ok(bytes);
    }
    Err(VfsError::NotFound {
        location: inner.to_owned(),
    })
}

fn read_zip_entry(
    archive_path: &Path,
    inner: &str,
    limits: ArchiveLimits,
    password: Option<&str>,
) -> Result<Vec<u8>, VfsError> {
    let file = File::open(archive_path).map_err(|error| io_error(error, archive_path))?;
    let mut archive = zip::ZipArchive::new(file).map_err(zip_error)?;
    let mut item = match password {
        Some(password) => archive.by_name_decrypt(inner, password.as_bytes()),
        None => archive.by_name(inner),
    }
    .map_err(|error| match error {
        zip::result::ZipError::FileNotFound => VfsError::NotFound {
            location: inner.to_owned(),
        },
        zip::result::ZipError::UnsupportedArchive(message)
            if message == zip::result::ZipError::PASSWORD_REQUIRED =>
        {
            VfsError::CredentialRequired
        }
        zip::result::ZipError::InvalidPassword if password.is_none() => {
            VfsError::CredentialRequired
        }
        zip::result::ZipError::InvalidPassword => VfsError::InvalidCredential,
        other => zip_error(other),
    })?;
    if item.is_dir() {
        return Err(VfsError::IsADirectory {
            location: inner.to_owned(),
        });
    }
    check_limits(item.size(), item.compressed_size(), limits)?;
    let capacity = usize::try_from(item.size()).map_err(|_| VfsError::Io {
        message: "archive entry is too large".into(),
    })?;
    let mut bytes = Vec::with_capacity(capacity);
    item.read_to_end(&mut bytes).map_err(|error| VfsError::Io {
        message: error.to_string(),
    })?;
    Ok(bytes)
}

fn check_limits(uncompressed: u64, compressed: u64, limits: ArchiveLimits) -> Result<(), VfsError> {
    if uncompressed > limits.max_uncompressed_entry_bytes {
        return Err(VfsError::ArchiveResourceLimit {
            kind: "uncompressedEntryBytes",
        });
    }
    if uncompressed > 0
        && (compressed == 0 || uncompressed / compressed.max(1) > limits.max_expansion_ratio)
    {
        return Err(VfsError::ArchiveResourceLimit {
            kind: "expansionRatio",
        });
    }
    Ok(())
}

fn safe_entry_path<R: Read>(entry: &zip::read::ZipFile<'_, R>) -> Result<String, VfsError> {
    let path = entry.enclosed_name().ok_or_else(unsafe_entry_error)?;
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(unsafe_entry_error());
    }
    let mut text = path.to_string_lossy().replace('\\', "/");
    if entry.is_dir() {
        text = text.trim_end_matches('/').to_owned();
    }
    Ok(text)
}

fn safe_stored_path(name: &str, is_directory: bool) -> Result<String, VfsError> {
    let normalized = name.replace('\\', "/");
    let path = Path::new(&normalized);
    if normalized.starts_with('/')
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(unsafe_entry_error());
    }
    Ok(if is_directory {
        normalized.trim_end_matches('/').to_owned()
    } else {
        normalized
    })
}

fn unsafe_entry_error() -> VfsError {
    VfsError::UnsafeArchiveEntry
}

#[derive(Debug)]
struct RawEntry {
    name: String,
    kind: EntryKind,
    size: Option<u64>,
}

#[derive(Clone, Copy)]
enum Rewrite<'a> {
    AddFile {
        inner: &'a str,
        staging: &'a Path,
        overwrite: bool,
    },
    AddDirectory(&'a str),
    Remove {
        inner: &'a str,
        recursive: bool,
    },
}

fn rewrite_zip(
    archive_path: &Path,
    rewrite: Rewrite<'_>,
    cancellation: &CancellationToken,
) -> Result<(), VfsError> {
    let source_file = File::open(archive_path).map_err(|error| io_error(error, archive_path))?;
    let mut source = zip::ZipArchive::new(source_file).map_err(zip_error)?;
    let parent = archive_path
        .parent()
        .ok_or_else(|| VfsError::InvalidLocation {
            location: archive_path.display().to_string(),
        })?;
    let replacement = parent.join(format!(".fm-archive-rewrite-{}.tmp", Uuid::new_v4()));
    let mut replacement_guard = TemporaryFileGuard::new(replacement.clone());
    let replacement_file =
        File::create(&replacement).map_err(|error| io_error(error, &replacement))?;
    let mut writer = zip::ZipWriter::new(replacement_file);
    let mut matched = false;
    let remove_prefix = match &rewrite {
        Rewrite::Remove { inner, .. } => Some(format!("{}/", inner.trim_end_matches('/'))),
        _ => None,
    };
    for index in 0..source.len() {
        if cancellation.is_cancelled() {
            return Err(VfsError::Cancelled);
        }
        let item = source.by_index_raw(index).map_err(zip_error)?;
        let name = safe_entry_path(&item)?;
        let skip = match &rewrite {
            Rewrite::AddFile {
                inner, overwrite, ..
            } if name == *inner => {
                if !overwrite {
                    return Err(VfsError::AlreadyExists {
                        location: (*inner).to_owned(),
                    });
                }
                matched = true;
                true
            }
            Rewrite::AddDirectory(inner)
                if name.trim_end_matches('/') == inner.trim_end_matches('/') =>
            {
                return Err(VfsError::AlreadyExists {
                    location: (*inner).to_owned(),
                });
            }
            Rewrite::Remove { inner, recursive } => {
                let exact = name.trim_end_matches('/') == inner.trim_end_matches('/');
                let descendant = remove_prefix
                    .as_ref()
                    .is_some_and(|prefix| name.starts_with(prefix));
                if descendant && !recursive {
                    return Err(VfsError::Io {
                        message: "archive directory is not empty".into(),
                    });
                }
                matched |= exact || descendant;
                exact || descendant
            }
            _ => false,
        };
        if !skip {
            writer.raw_copy_file(item).map_err(zip_error)?;
        }
    }
    match rewrite {
        Rewrite::AddFile { inner, staging, .. } => {
            if cancellation.is_cancelled() {
                return Err(VfsError::Cancelled);
            }
            writer
                .start_file(inner, zip::write::SimpleFileOptions::default())
                .map_err(zip_error)?;
            let mut input = File::open(staging).map_err(|error| io_error(error, staging))?;
            std::io::copy(&mut input, &mut writer).map_err(|error| VfsError::Io {
                message: error.to_string(),
            })?;
        }
        Rewrite::AddDirectory(inner) => {
            writer
                .add_directory(inner, zip::write::SimpleFileOptions::default())
                .map_err(zip_error)?;
        }
        Rewrite::Remove { inner, .. } if !matched => {
            return Err(VfsError::NotFound {
                location: inner.to_owned(),
            });
        }
        Rewrite::Remove { .. } => {}
    }
    let replacement_file = writer.finish().map_err(zip_error)?;
    replacement_file
        .sync_all()
        .map_err(|error| io_error(error, &replacement))?;
    if cancellation.is_cancelled() {
        return Err(VfsError::Cancelled);
    }
    std::fs::rename(&replacement, archive_path).map_err(|error| {
        let _ = std::fs::remove_file(&replacement);
        io_error(error, archive_path)
    })?;
    replacement_guard.disarm();
    if let Rewrite::AddFile { staging, .. } = rewrite {
        let _ = std::fs::remove_file(staging);
    }
    Ok(())
}

struct TemporaryFileGuard {
    path: PathBuf,
    armed: bool,
}

impl TemporaryFileGuard {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TemporaryFileGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn paginate(
    entries: Vec<RawEntry>,
    options: ListOptions,
    location: &Location,
    writable: bool,
) -> Result<DirectoryPage, VfsError> {
    let offset = match options.continuation_token {
        Some(token) => token.parse::<usize>().map_err(|_| invalid(location))?,
        None => 0,
    };
    if offset > entries.len() {
        return Err(invalid(location));
    }
    let total = entries.len();
    let page: Vec<_> = entries
        .into_iter()
        .skip(offset)
        .take(options.page_size)
        .map(|entry| {
            let child = location.join(&entry.name).map_err(|_| invalid(location))?;
            let extension = (entry.kind == EntryKind::File)
                .then(|| extension(&entry.name))
                .flatten();
            Ok(EntrySummary {
                id: stable_id(&child),
                location: child,
                name: entry.name,
                kind: entry.kind,
                size: entry.size,
                modified_at: None,
                created_at: None,
                hidden: false,
                read_only: !writable,
                extension,
                mime_type: None,
                icon_key: None,
                metadata_revision: 0,
            })
        })
        .collect::<Result<_, VfsError>>()?;
    let next = offset + page.len();
    Ok(DirectoryPage {
        entries: page,
        total_known_entries: Some(total as u64),
        has_more: next < total,
        continuation_token: (next < total).then(|| next.to_string()),
    })
}

fn stable_id(location: &Location) -> EntryId {
    EntryId::from(Uuid::new_v5(&Uuid::NAMESPACE_URL, location.uri.as_bytes()))
}

fn extension(name: &str) -> Option<String> {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_owned)
}

fn check_request(
    location: &Location,
    page_size: usize,
    cancellation: &CancellationToken,
) -> Result<(), VfsError> {
    if cancellation.is_cancelled() {
        return Err(VfsError::Cancelled);
    }
    if page_size == 0 {
        return Err(invalid(location));
    }
    Ok(())
}

fn unsupported<T>(capability: ProviderCapabilities) -> Result<T, VfsError> {
    Err(VfsError::UnsupportedCapability { capability })
}

fn invalid(location: &Location) -> VfsError {
    VfsError::InvalidLocation {
        location: location.uri.clone(),
    }
}
fn join_error(error: tokio::task::JoinError) -> VfsError {
    VfsError::Io {
        message: format!("archive worker failed: {error}"),
    }
}
fn zip_error(error: zip::result::ZipError) -> VfsError {
    VfsError::Io {
        message: format!("invalid ZIP archive: {error}"),
    }
}
fn seven_zip_error(error: sevenz_rust2::Error) -> VfsError {
    match error {
        sevenz_rust2::Error::PasswordRequired => VfsError::CredentialRequired,
        sevenz_rust2::Error::MaybeBadPassword(_) => VfsError::InvalidCredential,
        other => VfsError::Io {
            message: format!("invalid 7z archive: {other}"),
        },
    }
}
fn io_error(error: std::io::Error, path: &Path) -> VfsError {
    match error.kind() {
        std::io::ErrorKind::NotFound => VfsError::NotFound {
            location: path.display().to_string(),
        },
        std::io::ErrorKind::PermissionDenied => VfsError::PermissionDenied {
            location: path.display().to_string(),
        },
        _ => VfsError::Io {
            message: error.to_string(),
        },
    }
}

#[cfg(test)]
mod unit_tests {
    use std::io::Write;

    use super::*;

    #[test]
    fn cancelled_rewrite_preserves_archive_and_removes_temporary_file() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let archive_path = directory.path().join("sample.zip");
        let file = File::create(&archive_path).expect("create ZIP");
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("first.txt", zip::write::SimpleFileOptions::default())
            .expect("start entry");
        writer.write_all(b"first").expect("write entry");
        writer
            .start_file("second.txt", zip::write::SimpleFileOptions::default())
            .expect("start entry");
        writer.write_all(b"second").expect("write entry");
        writer.finish().expect("finish ZIP");
        let before = std::fs::read(&archive_path).expect("read original ZIP");
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        let result = rewrite_zip(
            &archive_path,
            Rewrite::Remove {
                inner: "first.txt",
                recursive: false,
            },
            &cancellation,
        );

        assert!(matches!(result, Err(VfsError::Cancelled)));
        assert_eq!(
            std::fs::read(&archive_path).expect("read preserved ZIP"),
            before
        );
        let leftovers = std::fs::read_dir(directory.path())
            .expect("list temporary directory")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".fm-archive-rewrite-")
            })
            .count();
        assert_eq!(leftovers, 0);
    }
}
