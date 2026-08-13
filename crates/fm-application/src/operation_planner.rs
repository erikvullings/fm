//! Operation planning: resolve providers, check capabilities, construct executors.
//!
//! Concentrates all provider resolution and executor construction logic that was
//! previously inline in `FileManagerService::start_operation()`. The planner is
//! stateless per-call and testable without bootstrapping the full service.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use fm_archive::{create_7z_archive, create_zip_archive};
use fm_domain::{EntryId, EntryKind, Location, ProviderId};
use fm_operations::{
    ConflictResolution, ExecutionError, ExecutionOutcome, Operation, OperationExecutor,
    OperationPlan, PauseToken, PlanItem,
};
use fm_platform::{PlatformAdapter, PlatformCapabilities};
use fm_settings::Settings;
use fm_transport_dto::{
    ArchiveFormatDto, OperationKindDto, StartOperationRequestDto, SymlinkPolicyDto,
};
use fm_vfs::{
    CopyCommitOptions, EntryRef, FileSystemProvider, ListOptions, ProviderCapabilities,
    ProviderRegistry, RemoveOptions, WriteOptions,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::ApplicationError;

pub(crate) struct OperationPlanner {
    providers: ProviderRegistry,
    platform: Arc<dyn PlatformAdapter>,
    settings: Arc<Mutex<Settings>>,
    audit_log_path: PathBuf,
    force_cross_volume_moves: Arc<AtomicBool>,
}

impl OperationPlanner {
    pub(crate) fn new(
        providers: ProviderRegistry,
        platform: Arc<dyn PlatformAdapter>,
        settings: Arc<Mutex<Settings>>,
        audit_log_path: PathBuf,
        force_cross_volume_moves: Arc<AtomicBool>,
    ) -> Self {
        Self {
            providers,
            platform,
            settings,
            audit_log_path,
            force_cross_volume_moves,
        }
    }

    pub(crate) fn plan(
        &self,
        kind: OperationKindDto,
        request: &StartOperationRequestDto,
    ) -> Result<Arc<dyn OperationExecutor>, ApplicationError> {
        let destination = request.destination.clone().map(Into::into);
        Ok(match kind {
            OperationKindDto::CreateArchive | OperationKindDto::MoveToArchive => {
                if request.sources.is_empty() {
                    return Err(ApplicationError::InvalidRequest(
                        "createArchive requires at least one source".into(),
                    ));
                }
                let destination: Location = destination.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest(
                        "createArchive requires an archive destination".into(),
                    )
                })?;
                let destination_path = destination
                    .to_native_path()
                    .map_err(|error| ApplicationError::InvalidRequest(error.to_string()))?;
                let format =
                    ArchiveCreationFormat::from_request(&destination_path, request.archive_format)?;
                let compression_level = match format {
                    ArchiveCreationFormat::Zip => {
                        let level = request.archive_compression_level.unwrap_or(6);
                        if !(0..=9).contains(&level) {
                            return Err(ApplicationError::InvalidRequest(
                                "archive compression level must be between 0 and 9".into(),
                            ));
                        }
                        level
                    }
                    ArchiveCreationFormat::SevenZip
                        if request.archive_compression_level.is_some() =>
                    {
                        return Err(ApplicationError::InvalidRequest(
                            "7z compression level is not supported by this backend".into(),
                        ));
                    }
                    ArchiveCreationFormat::SevenZip => 6,
                };
                let sources = request
                    .sources
                    .iter()
                    .map(|source| {
                        let source: Location = source.clone().into();
                        source
                            .to_native_path()
                            .map_err(|error| ApplicationError::InvalidRequest(error.to_string()))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                Arc::new(CreateArchiveExecutor {
                    destination: destination_path,
                    sources,
                    format,
                    compression_level,
                    remove_sources: kind == OperationKindDto::MoveToArchive,
                })
            }
            OperationKindDto::CreateDirectory => {
                let parent = destination.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest(
                        "createDirectory requires a destination directory".into(),
                    )
                })?;
                let name = request.name.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest("createDirectory requires a name".into())
                })?;
                let provider = self
                    .providers
                    .resolve(&parent)
                    .map_err(ApplicationError::from)?;
                provider
                    .capabilities_for(&parent)
                    .map_err(ApplicationError::from)?
                    .require(ProviderCapabilities::CREATE_DIRECTORY)
                    .map_err(ApplicationError::from)?;
                Arc::new(CreateDirectoryExecutor {
                    provider,
                    parent,
                    name,
                    create_intermediates: request.create_intermediate_directories,
                })
            }
            OperationKindDto::CreateFile => {
                let parent = destination.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest(
                        "createFile requires a destination directory".into(),
                    )
                })?;
                let name = request.name.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest("createFile requires a name".into())
                })?;
                let provider = self
                    .providers
                    .resolve(&parent)
                    .map_err(ApplicationError::from)?;
                // Reuses the WRITE capability rather than a dedicated CREATE_FILE bit: creating an
                // empty file is just opening a writer and immediately shutting it down with no
                // bytes written, so every provider that can write a file can already do this.
                provider
                    .capabilities_for(&parent)
                    .map_err(ApplicationError::from)?
                    .require(ProviderCapabilities::WRITE)
                    .map_err(ApplicationError::from)?;
                Arc::new(CreateFileExecutor {
                    provider,
                    parent,
                    name,
                })
            }
            OperationKindDto::Rename if request.destinations.is_empty() => {
                if request.sources.len() != 1 {
                    return Err(ApplicationError::InvalidRequest(
                        "rename requires exactly one source, or a destinations entry per source"
                            .into(),
                    ));
                }
                let destination = destination.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest("rename requires a destination".into())
                })?;
                let source: Location = request.sources[0].clone().into();
                let provider = self
                    .providers
                    .resolve(&source)
                    .map_err(ApplicationError::from)?;
                if source.provider_id != destination.provider_id {
                    return Err(ApplicationError::InvalidRequest(
                        "rename cannot cross providers".into(),
                    ));
                }
                provider
                    .capabilities_for(&source)
                    .map_err(ApplicationError::from)?
                    .require(ProviderCapabilities::RENAME)
                    .map_err(ApplicationError::from)?;
                Arc::new(RenameExecutor {
                    provider,
                    source,
                    destination,
                })
            }
            OperationKindDto::Rename => {
                if request.sources.is_empty() {
                    return Err(ApplicationError::InvalidRequest(
                        "rename requires at least one source".into(),
                    ));
                }
                if request.destinations.len() != request.sources.len() {
                    return Err(ApplicationError::InvalidRequest(
                        "rename destinations must include exactly one entry per source".into(),
                    ));
                }
                let mut renames = Vec::with_capacity(request.sources.len());
                for (source_dto, destination_dto) in
                    request.sources.iter().zip(request.destinations.iter())
                {
                    let source: Location = source_dto.clone().into();
                    let destination: Location = destination_dto.clone().into();
                    let provider = self
                        .providers
                        .resolve(&source)
                        .map_err(ApplicationError::from)?;
                    if source.provider_id != destination.provider_id {
                        return Err(ApplicationError::InvalidRequest(
                            "rename cannot cross providers".into(),
                        ));
                    }
                    provider
                        .capabilities_for(&source)
                        .map_err(ApplicationError::from)?
                        .require(ProviderCapabilities::RENAME)
                        .map_err(ApplicationError::from)?;
                    renames.push(RenameExecutor {
                        provider,
                        source,
                        destination,
                    });
                }
                Arc::new(RenameGroupExecutor { renames })
            }
            OperationKindDto::Copy => {
                if request.sources.is_empty() {
                    return Err(ApplicationError::InvalidRequest(
                        "copy requires at least one source".into(),
                    ));
                }
                let destination_directory = destination.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest("copy requires a destination directory".into())
                })?;
                let destination_provider = self
                    .providers
                    .resolve(&destination_directory)
                    .map_err(ApplicationError::from)?;
                destination_provider
                    .capabilities_for(&destination_directory)
                    .map_err(ApplicationError::from)?
                    .require(ProviderCapabilities::WRITE)
                    .map_err(ApplicationError::from)?;
                let mut copies = Vec::new();
                for source_dto in &request.sources {
                    let source: Location = source_dto.clone().into();
                    let source_provider = self
                        .providers
                        .resolve(&source)
                        .map_err(ApplicationError::from)?;
                    source_provider
                        .capabilities_for(&source)
                        .map_err(ApplicationError::from)?
                        .require(ProviderCapabilities::READ)
                        .map_err(ApplicationError::from)?;
                    copies.push(CopyExecutor {
                        source_provider,
                        destination_provider: Arc::clone(&destination_provider),
                        destination_directory: destination_directory.clone(),
                        temporary: Mutex::new(None),
                        planned: Mutex::new(HashMap::new()),
                        directories: Mutex::new(Vec::new()),
                        symlink_policy: request.symlink_policy,
                        root_name: Mutex::new(None),
                        source_override: Some(source),
                        continue_on_error: true,
                        completed_root_destination: Mutex::new(None),
                    });
                }
                Arc::new(CopyGroupExecutor {
                    copies,
                    stale_sources: Mutex::new(HashMap::new()),
                })
            }
            OperationKindDto::Move => {
                if request.sources.is_empty() {
                    return Err(ApplicationError::InvalidRequest(
                        "move requires at least one source".into(),
                    ));
                }
                let destination_directory = destination.clone().ok_or_else(|| {
                    ApplicationError::InvalidRequest("move requires a destination directory".into())
                })?;
                let destination_provider = self
                    .providers
                    .resolve(&destination_directory)
                    .map_err(ApplicationError::from)?;
                let mut moves = Vec::new();
                for source_dto in &request.sources {
                    let source: Location = source_dto.clone().into();
                    let source_provider = self
                        .providers
                        .resolve(&source)
                        .map_err(ApplicationError::from)?;
                    let copy = CopyExecutor {
                        source_provider: Arc::clone(&source_provider),
                        destination_provider: Arc::clone(&destination_provider),
                        destination_directory: destination_directory.clone(),
                        temporary: Mutex::new(None),
                        planned: Mutex::new(HashMap::new()),
                        directories: Mutex::new(Vec::new()),
                        symlink_policy: request.symlink_policy,
                        root_name: Mutex::new(None),
                        source_override: Some(source.clone()),
                        continue_on_error: false,
                        completed_root_destination: Mutex::new(None),
                    };
                    moves.push(MoveExecutor {
                        source,
                        source_provider,
                        destination_provider: Arc::clone(&destination_provider),
                        destination_directory: destination_directory.clone(),
                        copy,
                        fallback: Mutex::new(false),
                        force_fallback: self.force_cross_volume_moves.load(Ordering::Relaxed),
                    });
                }
                Arc::new(MoveGroupExecutor {
                    moves,
                    stale_sources: Mutex::new(HashMap::new()),
                })
            }
            OperationKindDto::Duplicate => {
                if request.sources.is_empty() {
                    return Err(ApplicationError::InvalidRequest(
                        "duplicate requires at least one source".into(),
                    ));
                }
                let mut copies = Vec::new();
                for source_dto in &request.sources {
                    let source: Location = source_dto.clone().into();
                    let parent = source
                        .parent()
                        .map_err(|error| ApplicationError::InvalidRequest(error.to_string()))?
                        .ok_or_else(|| {
                            ApplicationError::InvalidRequest(
                                "cannot duplicate a filesystem root".into(),
                            )
                        })?;
                    let provider = self
                        .providers
                        .resolve(&source)
                        .map_err(ApplicationError::from)?;
                    copies.push(CopyExecutor {
                        source_provider: Arc::clone(&provider),
                        destination_provider: provider,
                        destination_directory: parent,
                        temporary: Mutex::new(None),
                        planned: Mutex::new(HashMap::new()),
                        directories: Mutex::new(Vec::new()),
                        symlink_policy: request.symlink_policy,
                        root_name: Mutex::new(None),
                        source_override: Some(source),
                        continue_on_error: true,
                        completed_root_destination: Mutex::new(None),
                    });
                }
                Arc::new(DuplicateExecutor { copies })
            }
            OperationKindDto::Delete => {
                if request.sources.is_empty() {
                    return Err(ApplicationError::InvalidRequest(
                        "delete requires at least one source".into(),
                    ));
                }
                let requires_confirmation = self
                    .settings
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .confirm_permanent_delete;
                let mut providers = HashMap::new();
                for source in &request.sources {
                    let location: Location = source.clone().into();
                    let provider = self
                        .providers
                        .resolve(&location)
                        .map_err(ApplicationError::from)?;
                    provider
                        .capabilities_for(&location)
                        .map_err(ApplicationError::from)?
                        .require(ProviderCapabilities::DELETE)
                        .map_err(ApplicationError::from)?;
                    providers.insert(location.provider_id.clone(), provider);
                }
                Arc::new(DeleteExecutor {
                    providers,
                    override_read_only: request.override_read_only,
                    audit_log_path: self.audit_log_path.clone(),
                    deleted: AtomicU64::new(0),
                    audited: AtomicBool::new(false),
                    requires_confirmation: requires_confirmation
                        && !request.permanent_delete_confirmed,
                })
            }
            OperationKindDto::Trash => {
                if request.sources.is_empty() {
                    return Err(ApplicationError::InvalidRequest(
                        "trash requires at least one source".into(),
                    ));
                }
                if !self
                    .platform
                    .capabilities()
                    .contains(PlatformCapabilities::TRASH)
                {
                    return Err(ApplicationError::PlatformOperationFailed(
                        fm_platform::PlatformError::Unsupported {
                            capability: PlatformCapabilities::TRASH,
                        }
                        .to_string(),
                    ));
                }
                Arc::new(TrashExecutor {
                    platform: Arc::clone(&self.platform),
                })
            }
            OperationKindDto::Search => {
                return Err(ApplicationError::InvalidRequest(
                    "search is handled via start_search, not the operation executor".into(),
                ));
            }
            OperationKindDto::Compare => {
                return Err(ApplicationError::InvalidRequest(
                    "compare is handled via start_comparison, not the operation executor".into(),
                ));
            }
        })
    }
}

/* -------------------------------------------------------------------------- */
/*  Executor structs                                                          */
/* -------------------------------------------------------------------------- */

struct CreateDirectoryExecutor {
    provider: Arc<dyn FileSystemProvider>,
    parent: Location,
    name: String,
    create_intermediates: bool,
}

struct CreateFileExecutor {
    provider: Arc<dyn FileSystemProvider>,
    parent: Location,
    name: String,
}

struct RenameExecutor {
    provider: Arc<dyn FileSystemProvider>,
    source: Location,
    destination: Location,
}

/// Batch rename (task 0072 multi-rename): one [`RenameExecutor`] per source/destination pair,
/// executed as a single cancellable operation. Never falls back to copy+delete.
struct RenameGroupExecutor {
    renames: Vec<RenameExecutor>,
}

#[derive(Clone)]
struct PlannedCopyEntry {
    kind: EntryKind,
    destination: Location,
    source: EntryRef,
    is_root: bool,
}

struct CopyExecutor {
    source_provider: Arc<dyn FileSystemProvider>,
    destination_provider: Arc<dyn FileSystemProvider>,
    destination_directory: Location,
    temporary: Mutex<Option<Location>>,
    planned: Mutex<HashMap<String, PlannedCopyEntry>>,
    directories: Mutex<Vec<(EntryRef, EntryRef)>>,
    symlink_policy: SymlinkPolicyDto,
    root_name: Mutex<Option<String>>,
    source_override: Option<Location>,
    continue_on_error: bool,
    completed_root_destination: Mutex<Option<Location>>,
}

struct CopyGroupExecutor {
    copies: Vec<CopyExecutor>,
    stale_sources: Mutex<HashMap<String, EntryRef>>,
}

/// One atomic archive-creation job.  The codec implementation lives in
/// `fm-archive`; this adapter only gives it normal operation lifecycle and
/// cancellation semantics.
struct CreateArchiveExecutor {
    destination: PathBuf,
    sources: Vec<PathBuf>,
    format: ArchiveCreationFormat,
    compression_level: i64,
    remove_sources: bool,
}

struct DuplicateExecutor {
    copies: Vec<CopyExecutor>,
}

struct DeleteExecutor {
    providers: HashMap<ProviderId, Arc<dyn FileSystemProvider>>,
    override_read_only: bool,
    audit_log_path: PathBuf,
    deleted: AtomicU64,
    audited: AtomicBool,
    requires_confirmation: bool,
}

struct TrashExecutor {
    platform: Arc<dyn PlatformAdapter>,
}

struct MoveExecutor {
    source: Location,
    source_provider: Arc<dyn FileSystemProvider>,
    destination_provider: Arc<dyn FileSystemProvider>,
    destination_directory: Location,
    copy: CopyExecutor,
    fallback: Mutex<bool>,
    force_fallback: bool,
}

struct MoveGroupExecutor {
    moves: Vec<MoveExecutor>,
    stale_sources: Mutex<HashMap<String, EntryRef>>,
}

/* -------------------------------------------------------------------------- */
/*  Archive format inference                                                  */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArchiveCreationFormat {
    Zip,
    SevenZip,
}

impl ArchiveCreationFormat {
    fn from_request(
        path: &Path,
        requested: Option<ArchiveFormatDto>,
    ) -> Result<Self, ApplicationError> {
        let inferred = match path.extension().and_then(|extension| extension.to_str()) {
            Some(extension) if extension.eq_ignore_ascii_case("zip") => Ok(Self::Zip),
            Some(extension) if extension.eq_ignore_ascii_case("7z") => Ok(Self::SevenZip),
            _ => Err(ApplicationError::InvalidRequest(
                "archive destination must end in .zip or .7z".into(),
            )),
        }?;
        let requested = match requested {
            Some(ArchiveFormatDto::Zip) => Self::Zip,
            Some(ArchiveFormatDto::SevenZip) => Self::SevenZip,
            None => inferred,
        };
        if requested != inferred {
            return Err(ApplicationError::InvalidRequest(
                "archive format must match the destination extension".into(),
            ));
        }
        Ok(requested)
    }
}

/* -------------------------------------------------------------------------- */
/*  OperationExecutor implementations                                         */
/* -------------------------------------------------------------------------- */

#[async_trait]
impl OperationExecutor for CreateArchiveExecutor {
    async fn plan(
        &self,
        _operation: &Operation,
        _cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        Ok(OperationPlan::new(vec![PlanItem::new(
            EntryRef {
                id: EntryId::new(),
                location: Location::from_native_path(&self.destination)
                    .map_err(|error| ExecutionError::Failed(error.to_string()))?,
            },
            0,
        )]))
    }

    async fn execute(
        &self,
        _operation: &Operation,
        _item: &PlanItem,
        _resolution: Option<ConflictResolution>,
        _pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        let destination = self.destination.clone();
        let sources = self.sources.clone();
        let sources_for_archive = sources.clone();
        let format = self.format;
        let compression_level = self.compression_level;
        let remove_sources = self.remove_sources;
        let cancellation = cancellation.clone();
        let archive_cancellation = cancellation.clone();
        tokio::task::spawn_blocking(move || match format {
            ArchiveCreationFormat::Zip => create_zip_archive(
                &destination,
                &sources_for_archive,
                Some(compression_level),
                &archive_cancellation,
            ),
            ArchiveCreationFormat::SevenZip => {
                create_7z_archive(&destination, &sources_for_archive, &archive_cancellation)
            }
        })
        .await
        .map_err(|error| ExecutionError::Failed(error.to_string()))??;
        if remove_sources {
            for source in sources {
                if cancellation.is_cancelled() {
                    return Err(fm_vfs::VfsError::Cancelled.into());
                }
                let metadata = std::fs::symlink_metadata(&source)
                    .map_err(|error| ExecutionError::Failed(error.to_string()))?;
                if metadata.is_dir() {
                    std::fs::remove_dir_all(&source)
                } else {
                    std::fs::remove_file(&source)
                }
                .map_err(|error| ExecutionError::Failed(error.to_string()))?;
            }
        }
        Ok(ExecutionOutcome::Completed)
    }

    async fn cleanup_partial(&self, _operation: &Operation) -> Result<(), ExecutionError> {
        Ok(())
    }
}

impl DeleteExecutor {
    async fn write_audit(&self, operation: &Operation) -> Result<(), ExecutionError> {
        if self.audited.load(Ordering::Acquire) {
            return Ok(());
        }
        if let Some(parent) = self.audit_log_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(copy_stream_error)?;
        }
        let record = serde_json::json!({
            "timestamp": chrono::Utc::now(),
            "operationId": operation.id.to_string(),
            "kind": "permanentDelete",
            "sources": operation.sources.iter().map(|entry| &entry.location.uri).collect::<Vec<_>>(),
            "deletedItems": self.deleted.load(Ordering::Acquire),
        });
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.audit_log_path)
            .await
            .map_err(copy_stream_error)?;
        file.write_all(format!("{record}\n").as_bytes())
            .await
            .map_err(copy_stream_error)?;
        self.audited.store(true, Ordering::Release);
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for DeleteExecutor {
    fn requires_confirmation(&self) -> bool {
        self.requires_confirmation
    }
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let mut items = Vec::new();
        for source in &operation.sources {
            let provider = self
                .providers
                .get(&source.location.provider_id)
                .ok_or_else(|| ExecutionError::Failed("delete provider is missing".into()))?;
            let root = provider.inspect(source, cancellation.clone()).await?;
            let mut stack = vec![(root, false)];
            while let Some((summary, visited)) = stack.pop() {
                if cancellation.is_cancelled() {
                    return Err(fm_vfs::VfsError::Cancelled.into());
                }
                if summary.read_only && !self.override_read_only {
                    return Err(ExecutionError::Failed(format!(
                        "read-only entry requires explicit override: {}",
                        summary.location.uri
                    )));
                }
                let entry = EntryRef {
                    id: summary.id,
                    location: summary.location.clone(),
                };
                if summary.kind == EntryKind::Directory && !visited {
                    stack.push((summary.clone(), true));
                    let mut continuation_token = None;
                    loop {
                        let page = provider
                            .list(
                                &summary.location,
                                ListOptions {
                                    page_size: 512,
                                    continuation_token,
                                },
                                cancellation.clone(),
                            )
                            .await?;
                        for child in page.entries.into_iter().rev() {
                            stack.push((child, false));
                        }
                        if !page.has_more {
                            break;
                        }
                        continuation_token = page.continuation_token;
                    }
                } else {
                    items.push(PlanItem::new(entry, summary.size.unwrap_or(0)));
                }
            }
        }
        Ok(OperationPlan::new(items))
    }

    async fn execute(
        &self,
        _operation: &Operation,
        item: &PlanItem,
        _resolution: Option<fm_operations::ConflictResolution>,
        _pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<fm_operations::ExecutionOutcome, ExecutionError> {
        let provider = self
            .providers
            .get(&item.entry.location.provider_id)
            .ok_or_else(|| ExecutionError::Failed("delete provider is missing".into()))?;
        match provider
            .remove(
                &item.entry,
                RemoveOptions {
                    recursive: false,
                    use_trash: false,
                },
                cancellation.clone(),
            )
            .await
        {
            Ok(()) => {
                self.deleted.fetch_add(1, Ordering::Relaxed);
                Ok(ExecutionOutcome::Completed)
            }
            Err(error) => Err(ExecutionError::Warning {
                entry: item.entry.clone(),
                message: error.to_string(),
            }),
        }
    }

    async fn cleanup_partial(&self, operation: &Operation) -> Result<(), ExecutionError> {
        self.write_audit(operation).await
    }

    async fn finish(
        &self,
        operation: &Operation,
        _cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        self.write_audit(operation).await
    }
}

/// Moves entries to the platform trash (task 0043). Unlike [`DeleteExecutor`],
/// this bypasses [`FileSystemProvider`] entirely: the platform adapter
/// natively relocates the whole entry (file or directory tree) in one call,
/// mirroring how `core.open`/`core.revealInSystemFileManager` dispatch
/// directly to `self.platform` (task 0061). Trash is reversible, so unlike
/// permanent delete there is no mandatory confirmation, read-only override,
/// or audit log.
#[async_trait]
impl OperationExecutor for TrashExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        _cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        Ok(OperationPlan::new(
            operation
                .sources
                .iter()
                .cloned()
                .map(|entry| PlanItem::new(entry, 0))
                .collect(),
        ))
    }

    async fn execute(
        &self,
        _operation: &Operation,
        item: &PlanItem,
        _resolution: Option<ConflictResolution>,
        _pause: &PauseToken,
        _cancellation: &CancellationToken,
    ) -> Result<fm_operations::ExecutionOutcome, ExecutionError> {
        let path = item
            .entry
            .location
            .to_native_path()
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        self.platform
            .trash(&path)
            .map_err(|error| ExecutionError::Warning {
                entry: item.entry.clone(),
                message: error.to_string(),
            })?;
        Ok(ExecutionOutcome::Completed)
    }

    async fn cleanup_partial(&self, _operation: &Operation) -> Result<(), ExecutionError> {
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for CopyGroupExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let mut items = Vec::new();
        for executor in &self.copies {
            match executor.plan(operation, cancellation).await {
                Ok(plan) => items.extend(plan.items),
                Err(ExecutionError::Provider(fm_vfs::VfsError::NotFound { .. })) => {
                    let source = executor.source_override.clone().ok_or_else(|| {
                        ExecutionError::Failed("copy source is missing from its plan".into())
                    })?;
                    let entry = EntryRef {
                        id: EntryId::new(),
                        location: source,
                    };
                    self.stale_sources
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(entry.location.uri.clone(), entry.clone());
                    items.push(PlanItem::new(entry, 0));
                }
                Err(error) => return Err(error),
            }
        }
        Ok(OperationPlan::new(items))
    }

    async fn execute(
        &self,
        operation: &Operation,
        item: &PlanItem,
        resolution: Option<ConflictResolution>,
        pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        if self
            .stale_sources
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(&item.entry.location.uri)
        {
            return Err(ExecutionError::Warning {
                entry: item.entry.clone(),
                message: "Source no longer exists; skipped.".into(),
            });
        }
        for executor in &self.copies {
            if executor
                .planned
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .contains_key(&item.entry.location.uri)
            {
                return executor
                    .execute(operation, item, resolution, pause, cancellation)
                    .await;
            }
        }
        Err(ExecutionError::Failed("copy plan entry is missing".into()))
    }

    async fn cleanup_partial(&self, operation: &Operation) -> Result<(), ExecutionError> {
        for executor in &self.copies {
            executor.cleanup_partial(operation).await?;
        }
        Ok(())
    }

    async fn finish(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        for executor in &self.copies {
            executor.finish(operation, cancellation).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for MoveGroupExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let mut items = Vec::new();
        for executor in &self.moves {
            match executor.plan(operation, cancellation).await {
                Ok(plan) => items.extend(plan.items),
                Err(ExecutionError::Provider(fm_vfs::VfsError::NotFound { .. })) => {
                    let entry = EntryRef {
                        id: EntryId::new(),
                        location: executor.source.clone(),
                    };
                    self.stale_sources
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(entry.location.uri.clone(), entry.clone());
                    items.push(PlanItem::new(entry, 0));
                }
                Err(error) => return Err(error),
            }
        }
        Ok(OperationPlan::new(items))
    }

    async fn execute(
        &self,
        operation: &Operation,
        item: &PlanItem,
        resolution: Option<ConflictResolution>,
        pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        if self
            .stale_sources
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(&item.entry.location.uri)
        {
            return Err(ExecutionError::Warning {
                entry: item.entry.clone(),
                message: "Source no longer exists; skipped.".into(),
            });
        }
        for executor in &self.moves {
            if item.entry.location == executor.source
                || executor
                    .copy
                    .planned
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .contains_key(&item.entry.location.uri)
            {
                return executor
                    .execute(operation, item, resolution, pause, cancellation)
                    .await;
            }
        }
        Err(ExecutionError::Failed("move plan entry is missing".into()))
    }

    async fn cleanup_partial(&self, operation: &Operation) -> Result<(), ExecutionError> {
        for executor in &self.moves {
            executor.cleanup_partial(operation).await?;
        }
        Ok(())
    }

    async fn finish(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        for executor in &self.moves {
            executor.finish(operation, cancellation).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for DuplicateExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let mut items = Vec::new();
        for copy in &self.copies {
            let source_location = copy
                .source_override
                .as_ref()
                .ok_or_else(|| ExecutionError::Failed("duplicate source is missing".into()))?;
            let source_name = source_location
                .name()
                .map_err(|error| ExecutionError::Failed(error.to_string()))?;
            let mut index = 1_u32;
            loop {
                let candidate = fm_operations::duplicate_name(&source_name, index);
                let destination = copy
                    .destination_directory
                    .join(&candidate)
                    .map_err(|error| ExecutionError::Failed(error.to_string()))?;
                let probe = EntryRef {
                    id: EntryId::new(),
                    location: destination,
                };
                match copy
                    .destination_provider
                    .inspect(&probe, cancellation.clone())
                    .await
                {
                    Err(fm_vfs::VfsError::NotFound { .. }) => {
                        *copy.root_name.lock().unwrap_or_else(|e| e.into_inner()) = Some(candidate);
                        break;
                    }
                    Ok(_) => index = index.saturating_add(1),
                    Err(error) => return Err(error.into()),
                }
            }
            items.extend(copy.plan(operation, cancellation).await?.items);
        }
        Ok(OperationPlan::new(items))
    }

    async fn execute(
        &self,
        operation: &Operation,
        item: &PlanItem,
        resolution: Option<ConflictResolution>,
        pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        for copy in &self.copies {
            if copy
                .planned
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .contains_key(&item.entry.location.uri)
            {
                return copy
                    .execute(operation, item, resolution, pause, cancellation)
                    .await;
            }
        }
        Err(ExecutionError::Failed(
            "duplicate plan entry is missing".into(),
        ))
    }

    async fn cleanup_partial(&self, operation: &Operation) -> Result<(), ExecutionError> {
        for copy in &self.copies {
            copy.cleanup_partial(operation).await?;
        }
        Ok(())
    }

    async fn finish(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        for copy in &self.copies {
            copy.finish(operation, cancellation).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for MoveExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let source = EntryRef {
            id: EntryId::new(),
            location: self.source.clone(),
        };
        let name = source
            .location
            .name()
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        let destination = self
            .destination_directory
            .join(&name)
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        fm_operations::validate_paths(&source.location, &destination, cfg!(not(windows)))
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        let same_provider = self.source_provider.id() == self.destination_provider.id();
        let same_filesystem = !self.force_fallback
            && same_provider
            && self
                .source_provider
                .same_filesystem(&source, &self.destination_directory, cancellation.clone())
                .await?;
        *self.fallback.lock().unwrap_or_else(|e| e.into_inner()) = !same_filesystem;
        if same_filesystem {
            Ok(OperationPlan::new(vec![PlanItem::new(source, 0)]))
        } else {
            self.copy.plan(operation, cancellation).await
        }
    }

    async fn execute(
        &self,
        operation: &Operation,
        item: &PlanItem,
        resolution: Option<ConflictResolution>,
        pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        if *self.fallback.lock().unwrap_or_else(|e| e.into_inner()) {
            return self
                .copy
                .execute(operation, item, resolution, pause, cancellation)
                .await;
        }
        let name = item
            .entry
            .location
            .name()
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        let mut destination = self
            .destination_directory
            .join(&name)
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        let destination_entry = EntryRef {
            id: EntryId::new(),
            location: destination.clone(),
        };
        if let Ok(existing) = self
            .destination_provider
            .inspect(&destination_entry, cancellation.clone())
            .await
        {
            let source = self
                .source_provider
                .inspect(&item.entry, cancellation.clone())
                .await?;
            if source.kind != existing.kind {
                return Err(ExecutionError::Failed(
                    "a file and directory cannot replace one another".into(),
                ));
            }
            match effective_resolution(operation.conflict_policy, resolution) {
                None => return Err(conflict_error(&source, &existing)),
                Some(ConflictResolution::Skip) => return Ok(ExecutionOutcome::Skipped),
                Some(ConflictResolution::Overwrite) => {
                    self.destination_provider
                        .remove(
                            &destination_entry,
                            RemoveOptions {
                                recursive: existing.kind == EntryKind::Directory,
                                use_trash: false,
                            },
                            cancellation.clone(),
                        )
                        .await?;
                }
                Some(ConflictResolution::RenameNew) => {
                    destination = self
                        .copy
                        .next_copy_destination(&destination, cancellation)
                        .await?;
                }
            }
        }
        self.source_provider
            .rename(&item.entry, &destination, cancellation.clone())
            .await?;
        Ok(ExecutionOutcome::Completed)
    }

    async fn cleanup_partial(&self, operation: &Operation) -> Result<(), ExecutionError> {
        self.copy.cleanup_partial(operation).await
    }

    async fn finish(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        if !*self.fallback.lock().unwrap_or_else(|e| e.into_inner()) {
            return Ok(());
        }
        self.copy.finish(operation, cancellation).await?;
        if cancellation.is_cancelled() {
            return Ok(());
        }
        let source = EntryRef {
            id: EntryId::new(),
            location: self.source.clone(),
        };
        let Some(destination) = self
            .copy
            .completed_root_destination
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        else {
            return Ok(());
        };
        self.destination_provider
            .inspect(
                &EntryRef {
                    id: EntryId::new(),
                    location: destination,
                },
                cancellation.clone(),
            )
            .await?;
        self.source_provider
            .remove(
                &source,
                RemoveOptions {
                    recursive: true,
                    use_trash: false,
                },
                cancellation.clone(),
            )
            .await?;
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for CopyExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let source = if let Some(location) = &self.source_override {
            EntryRef {
                id: EntryId::new(),
                location: location.clone(),
            }
        } else {
            operation
                .sources
                .first()
                .cloned()
                .ok_or_else(|| ExecutionError::Failed("copy source is missing".into()))?
        };
        let summary = self
            .source_provider
            .inspect(&source, cancellation.clone())
            .await?;
        let root_name = self
            .root_name
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .unwrap_or(summary.name.clone());
        let root_destination = self
            .destination_directory
            .join(&root_name)
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        // Descendant/same-entry checks are meaningful only within one provider. Cross-provider
        // copies (including local ↔ archive) have disjoint namespaces by construction.
        if source.location.provider_id == root_destination.provider_id {
            fm_operations::validate_paths(&source.location, &root_destination, cfg!(not(windows)))
                .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        }
        let root_source_uri = source.location.uri.clone();
        let mut stack = vec![(summary, root_destination)];
        let mut items = Vec::new();
        let mut planned = HashMap::new();
        let mut directories = Vec::new();
        let mut followed_directories = HashSet::new();
        while let Some((summary, destination)) = stack.pop() {
            if cancellation.is_cancelled() {
                return Err(fm_vfs::VfsError::Cancelled.into());
            }
            let plan_entry = EntryRef {
                id: summary.id,
                location: summary.location.clone(),
            };
            let (summary, followed_target) = if summary.kind == EntryKind::Symlink
                && self.symlink_policy == SymlinkPolicyDto::CopyTarget
            {
                let target = self
                    .source_provider
                    .resolve_symlink(&plan_entry, cancellation.clone())
                    .await?;
                if target.kind == EntryKind::Directory && !followed_directories.insert(target.id) {
                    continue;
                }
                (target, true)
            } else {
                (summary, false)
            };
            if summary.kind == EntryKind::Directory
                && !followed_target
                && self.symlink_policy == SymlinkPolicyDto::CopyTarget
            {
                followed_directories.insert(summary.id);
            }
            let source_entry = EntryRef {
                id: summary.id,
                location: summary.location.clone(),
            };
            let bytes = summary.size.unwrap_or(0);
            planned.insert(
                plan_entry.location.uri.clone(),
                PlannedCopyEntry {
                    kind: summary.kind,
                    destination: destination.clone(),
                    source: source_entry.clone(),
                    is_root: plan_entry.location.uri == root_source_uri,
                },
            );
            items.push(PlanItem::new(plan_entry, bytes));
            if summary.kind == EntryKind::Directory {
                directories.push((
                    source_entry,
                    EntryRef {
                        id: EntryId::new(),
                        location: destination.clone(),
                    },
                ));
                let mut continuation_token = None;
                loop {
                    let page = self
                        .source_provider
                        .list(
                            &summary.location,
                            ListOptions {
                                page_size: 512,
                                continuation_token,
                            },
                            cancellation.clone(),
                        )
                        .await?;
                    for child in page.entries.into_iter().rev() {
                        let child_destination = destination
                            .join(&child.name)
                            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
                        stack.push((child, child_destination));
                    }
                    if !page.has_more {
                        break;
                    }
                    continuation_token = page.continuation_token;
                }
            }
        }
        *self.planned.lock().unwrap_or_else(|e| e.into_inner()) = planned;
        *self.directories.lock().unwrap_or_else(|e| e.into_inner()) = directories;
        Ok(OperationPlan::new(items))
    }

    async fn execute(
        &self,
        operation: &Operation,
        item: &PlanItem,
        resolution: Option<ConflictResolution>,
        pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        let mut planned = self
            .planned
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&item.entry.location.uri)
            .cloned()
            .ok_or_else(|| ExecutionError::Failed("copy plan entry is missing".into()))?;
        let destination_entry = EntryRef {
            id: EntryId::new(),
            location: planned.destination.clone(),
        };
        let mut reuse_destination_directory = false;
        if let Ok(destination) = self
            .destination_provider
            .inspect(&destination_entry, cancellation.clone())
            .await
        {
            let source = self
                .source_provider
                .inspect(&planned.source, cancellation.clone())
                .await?;
            if source.kind != destination.kind {
                return Err(ExecutionError::Failed(
                    "a file and directory cannot replace one another".into(),
                ));
            }
            match effective_resolution(operation.conflict_policy, resolution) {
                None => return Err(conflict_error(&source, &destination)),
                Some(ConflictResolution::Skip) => return Ok(ExecutionOutcome::Skipped),
                Some(ConflictResolution::Overwrite) => {
                    if planned.kind == EntryKind::Directory {
                        reuse_destination_directory = true;
                    }
                    if planned.kind != EntryKind::File && !reuse_destination_directory {
                        self.destination_provider
                            .remove(
                                &destination_entry,
                                RemoveOptions {
                                    recursive: planned.kind == EntryKind::Directory,
                                    use_trash: false,
                                },
                                cancellation.clone(),
                            )
                            .await?;
                    }
                }
                Some(ConflictResolution::RenameNew) => {
                    let renamed = self
                        .next_copy_destination(&planned.destination, cancellation)
                        .await?;
                    if planned.is_root && planned.kind == EntryKind::Directory {
                        self.rebase_planned_destinations(&planned.destination, &renamed);
                    }
                    planned.destination = renamed;
                }
            }
        }
        let result = if reuse_destination_directory {
            Ok(ExecutionOutcome::Completed)
        } else if planned.kind == EntryKind::Directory {
            let parent = planned
                .destination
                .parent()
                .map_err(|error| ExecutionError::Failed(error.to_string()))?
                .ok_or_else(|| ExecutionError::Failed("copy destination has no parent".into()))?;
            let name = planned
                .destination
                .name()
                .map_err(|error| ExecutionError::Failed(error.to_string()))?;
            self.destination_provider
                .create_directory(&parent, &name, cancellation.clone())
                .await
                .map(|_| ExecutionOutcome::Completed)
                .map_err(ExecutionError::from)
        } else if planned.kind == EntryKind::Symlink {
            self.destination_provider
                .copy_symlink(&item.entry, &planned.destination, cancellation.clone())
                .await
                .map(|_| ExecutionOutcome::Completed)
                .map_err(ExecutionError::from)
        } else {
            let source_item = PlanItem::new(planned.source.clone(), item.bytes);
            self.copy_file(
                operation,
                &source_item,
                &planned.destination,
                resolution,
                pause,
                cancellation,
            )
            .await
        };
        let outcome = match result {
            Err(error) if self.continue_on_error && !planned.is_root => {
                Err(ExecutionError::Warning {
                    entry: item.entry.clone(),
                    message: error.to_string(),
                })
            }
            other => other,
        };
        if outcome.is_ok() && planned.is_root {
            *self
                .completed_root_destination
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(planned.destination);
        }
        outcome
    }

    async fn cleanup_partial(&self, _operation: &Operation) -> Result<(), ExecutionError> {
        let temporary = self
            .temporary
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(temporary) = temporary {
            self.destination_provider
                .discard_copy(&temporary, CancellationToken::new())
                .await?;
        }
        Ok(())
    }

    async fn finish(
        &self,
        _operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError> {
        let mut directories = self
            .directories
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        directories.reverse();
        for (source, destination) in directories {
            if source.location.provider_id == destination.location.provider_id
                && self
                    .destination_provider
                    .capabilities_for(&destination.location)?
                    .contains(ProviderCapabilities::SET_TIMESTAMPS)
            {
                self.destination_provider
                    .preserve_metadata(&source, &destination, cancellation.clone())
                    .await?;
            }
        }
        Ok(())
    }
}

impl CopyExecutor {
    fn rebase_planned_destinations(&self, old_root: &Location, new_root: &Location) {
        let rebase = |location: &Location| {
            location.uri.strip_prefix(&old_root.uri).map(|suffix| {
                Location::new(
                    location.provider_id.clone(),
                    format!("{}{suffix}", new_root.uri),
                )
            })
        };
        for planned in self
            .planned
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values_mut()
        {
            if let Some(destination) = rebase(&planned.destination) {
                planned.destination = destination;
            }
        }
        for (_, destination) in self
            .directories
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter_mut()
        {
            if let Some(location) = rebase(&destination.location) {
                destination.location = location;
            }
        }
    }

    async fn next_copy_destination(
        &self,
        original: &Location,
        cancellation: &CancellationToken,
    ) -> Result<Location, ExecutionError> {
        let parent = original
            .parent()
            .map_err(|error| ExecutionError::Failed(error.to_string()))?
            .ok_or_else(|| ExecutionError::Failed("copy destination has no parent".into()))?;
        let name = original
            .name()
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        for suffix in 1_u32.. {
            let candidate = parent
                .join(&copy_name(&name, suffix))
                .map_err(|error| ExecutionError::Failed(error.to_string()))?;
            let probe = EntryRef {
                id: EntryId::new(),
                location: candidate.clone(),
            };
            match self
                .destination_provider
                .inspect(&probe, cancellation.clone())
                .await
            {
                Err(fm_vfs::VfsError::NotFound { .. }) => return Ok(candidate),
                Ok(_) => {}
                Err(error) => return Err(error.into()),
            }
        }
        unreachable!("u32 suffix iterator is non-empty")
    }

    async fn copy_file(
        &self,
        operation: &Operation,
        item: &PlanItem,
        final_destination: &Location,
        resolution: Option<ConflictResolution>,
        pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        let destination_directory = final_destination
            .parent()
            .map_err(|error| ExecutionError::Failed(error.to_string()))?
            .ok_or_else(|| ExecutionError::Failed("copy destination has no parent".into()))?;
        let temporary = self
            .destination_directory
            .join(&format!(".fm-copy-{}", Uuid::new_v4()))
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        *self.temporary.lock().unwrap_or_else(|e| e.into_inner()) = Some(temporary.clone());
        let cloned = self.source_provider.id() == self.destination_provider.id()
            && self
                .source_provider
                .capabilities()
                .contains(ProviderCapabilities::SERVER_SIDE_COPY)
            && self
                .source_provider
                .server_side_copy(&item.entry, &temporary, cancellation.clone())
                .await?;
        pause.checkpoint().await;
        if !cloned {
            let mut reader = self
                .source_provider
                .open_read(&item.entry, cancellation.clone())
                .await?;
            let mut writer = self
                .destination_provider
                .open_write(&temporary, WriteOptions::default(), cancellation.clone())
                .await?;
            let mut buffer = vec![0_u8; 128 * 1024];
            loop {
                pause.checkpoint().await;
                if cancellation.is_cancelled() {
                    return Err(fm_vfs::VfsError::Cancelled.into());
                }
                let read = tokio::select! {
                    () = cancellation.cancelled() => return Err(fm_vfs::VfsError::Cancelled.into()),
                    result = reader.read(&mut buffer) => result.map_err(copy_stream_error)?,
                };
                if read == 0 {
                    break;
                }
                tokio::select! {
                    () = cancellation.cancelled() => return Err(fm_vfs::VfsError::Cancelled.into()),
                    result = writer.write_all(&buffer[..read]) => result.map_err(copy_stream_error)?,
                }
            }
            writer.shutdown().await.map_err(copy_stream_error)?;
            drop(writer);
        }
        pause.checkpoint().await;
        if cancellation.is_cancelled() {
            return Err(fm_vfs::VfsError::Cancelled.into());
        }

        let effective = effective_resolution(operation.conflict_policy, resolution);
        let overwrite = effective == Some(ConflictResolution::Overwrite);
        let mut destination = final_destination.clone();
        let mut suffix = 1_u32;
        loop {
            match self
                .destination_provider
                .commit_copy(
                    &item.entry,
                    &temporary,
                    &destination,
                    CopyCommitOptions {
                        overwrite,
                        preserve_metadata: self.source_provider.id()
                            == self.destination_provider.id()
                            && self
                                .destination_provider
                                .capabilities_for(&destination)?
                                .contains(ProviderCapabilities::SET_TIMESTAMPS),
                    },
                    cancellation.clone(),
                )
                .await
            {
                Ok(_) => break,
                Err(fm_vfs::VfsError::AlreadyExists { .. })
                    if effective == Some(ConflictResolution::RenameNew) =>
                {
                    let name = final_destination
                        .name()
                        .map_err(|error| ExecutionError::Failed(error.to_string()))?;
                    destination = destination_directory
                        .join(&copy_name(&name, suffix))
                        .map_err(|error| ExecutionError::Failed(error.to_string()))?;
                    suffix = suffix.saturating_add(1);
                }
                Err(fm_vfs::VfsError::AlreadyExists { .. }) if effective.is_none() => {
                    self.destination_provider
                        .discard_copy(&temporary, CancellationToken::new())
                        .await?;
                    *self.temporary.lock().unwrap_or_else(|e| e.into_inner()) = None;
                    let source = self
                        .source_provider
                        .inspect(&item.entry, cancellation.clone())
                        .await?;
                    let destination_summary = self
                        .destination_provider
                        .inspect(
                            &EntryRef {
                                id: EntryId::new(),
                                location: destination,
                            },
                            cancellation.clone(),
                        )
                        .await?;
                    if source.kind != destination_summary.kind {
                        return Err(ExecutionError::Failed(
                            "a file and directory cannot replace one another".into(),
                        ));
                    }
                    return Err(conflict_error(&source, &destination_summary));
                }
                Err(error) => return Err(error.into()),
            }
        }
        *self.temporary.lock().unwrap_or_else(|e| e.into_inner()) = None;
        Ok(ExecutionOutcome::Completed)
    }
}

#[async_trait]
impl OperationExecutor for RenameExecutor {
    async fn plan(
        &self,
        operation: &Operation,
        _cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        let entry = operation
            .sources
            .first()
            .cloned()
            .ok_or_else(|| ExecutionError::Failed("rename source is missing".into()))?;
        Ok(OperationPlan::new(vec![PlanItem::new(entry, 0)]))
    }

    async fn execute(
        &self,
        _operation: &Operation,
        item: &PlanItem,
        _resolution: Option<ConflictResolution>,
        _pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        let source = EntryRef {
            id: item.entry.id,
            location: self.source.clone(),
        };
        self.provider
            .rename(&source, &self.destination, cancellation.clone())
            .await?;
        Ok(ExecutionOutcome::Completed)
    }

    async fn cleanup_partial(&self, _operation: &Operation) -> Result<(), ExecutionError> {
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for RenameGroupExecutor {
    async fn plan(
        &self,
        _operation: &Operation,
        _cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        Ok(OperationPlan::new(
            self.renames
                .iter()
                .map(|executor| {
                    PlanItem::new(
                        EntryRef {
                            id: EntryId::new(),
                            location: executor.source.clone(),
                        },
                        0,
                    )
                })
                .collect(),
        ))
    }

    async fn execute(
        &self,
        operation: &Operation,
        item: &PlanItem,
        resolution: Option<ConflictResolution>,
        pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        for executor in &self.renames {
            if executor.source == item.entry.location {
                return executor
                    .execute(operation, item, resolution, pause, cancellation)
                    .await;
            }
        }
        Err(ExecutionError::Failed(
            "rename plan entry is missing".into(),
        ))
    }

    async fn cleanup_partial(&self, _operation: &Operation) -> Result<(), ExecutionError> {
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for CreateDirectoryExecutor {
    async fn plan(
        &self,
        _operation: &Operation,
        _cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        Ok(OperationPlan::new(vec![PlanItem::new(
            EntryRef {
                id: EntryId::new(),
                location: self.parent.clone(),
            },
            0,
        )]))
    }

    async fn execute(
        &self,
        _operation: &Operation,
        _item: &PlanItem,
        _resolution: Option<ConflictResolution>,
        _pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        if !self.create_intermediates {
            self.provider
                .create_directory(&self.parent, &self.name, cancellation.clone())
                .await?;
            return Ok(ExecutionOutcome::Completed);
        }
        let mut parent = self.parent.clone();
        for component in self.name.split(['/', '\\']) {
            let created = self
                .provider
                .create_directory(&parent, component, cancellation.clone())
                .await?;
            parent = created.location;
        }
        Ok(ExecutionOutcome::Completed)
    }

    async fn cleanup_partial(&self, _operation: &Operation) -> Result<(), ExecutionError> {
        Ok(())
    }
}

#[async_trait]
impl OperationExecutor for CreateFileExecutor {
    async fn plan(
        &self,
        _operation: &Operation,
        _cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError> {
        Ok(OperationPlan::new(vec![PlanItem::new(
            EntryRef {
                id: EntryId::new(),
                location: self.parent.clone(),
            },
            0,
        )]))
    }

    async fn execute(
        &self,
        _operation: &Operation,
        _item: &PlanItem,
        _resolution: Option<ConflictResolution>,
        _pause: &PauseToken,
        cancellation: &CancellationToken,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        let destination = self
            .parent
            .join(&self.name)
            .map_err(|error| ExecutionError::Failed(error.to_string()))?;
        // Creating an empty file is just opening a writer and shutting it down without
        // writing any bytes, so this reuses the same streaming primitive `copy_file` uses
        // rather than requiring a dedicated provider capability/method.
        let mut writer = self
            .provider
            .open_write(&destination, WriteOptions::default(), cancellation.clone())
            .await?;
        writer.shutdown().await.map_err(copy_stream_error)?;
        drop(writer);
        Ok(ExecutionOutcome::Completed)
    }

    async fn cleanup_partial(&self, _operation: &Operation) -> Result<(), ExecutionError> {
        Ok(())
    }
}

/* -------------------------------------------------------------------------- */
/*  Helper functions                                                          */
/* -------------------------------------------------------------------------- */

fn copy_name(name: &str, suffix: u32) -> String {
    let path = std::path::Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(name);
    match path.extension().and_then(|value| value.to_str()) {
        Some(extension) => format!("{stem} (copy {suffix}).{extension}"),
        None => format!("{stem} (copy {suffix})"),
    }
}

fn effective_resolution(
    policy: fm_operations::ConflictPolicy,
    resolution: Option<ConflictResolution>,
) -> Option<ConflictResolution> {
    resolution.or(match policy {
        fm_operations::ConflictPolicy::Ask => None,
        fm_operations::ConflictPolicy::Skip => Some(ConflictResolution::Skip),
        fm_operations::ConflictPolicy::Overwrite => Some(ConflictResolution::Overwrite),
        fm_operations::ConflictPolicy::RenameNew => Some(ConflictResolution::RenameNew),
        fm_operations::ConflictPolicy::KeepNewer => None,
    })
}

fn conflict_error(
    source: &fm_domain::EntrySummary,
    destination: &fm_domain::EntrySummary,
) -> ExecutionError {
    ExecutionError::Conflict(fm_operations::OperationConflict {
        id: Uuid::new_v4().to_string(),
        source: conflict_entry(source),
        destination: conflict_entry(destination),
    })
}

fn conflict_entry(entry: &fm_domain::EntrySummary) -> fm_operations::ConflictEntry {
    fm_operations::ConflictEntry {
        name: entry.name.clone(),
        kind: entry.kind,
        size: entry.size,
        modified_at: entry.modified_at,
    }
}

fn copy_stream_error(error: std::io::Error) -> ExecutionError {
    fm_vfs::VfsError::Io {
        message: error.to_string(),
    }
    .into()
}

/* -------------------------------------------------------------------------- */
/*  Tests                                                                     */
/* -------------------------------------------------------------------------- */

#[cfg(test)]
mod tests {
    use super::*;

    struct NoTrashPlatform;

    impl fm_platform::PlatformAdapter for NoTrashPlatform {
        fn capabilities(&self) -> PlatformCapabilities {
            PlatformCapabilities::empty()
        }
    }

    fn make_planner() -> (OperationPlanner, ProviderRegistry) {
        let providers = ProviderRegistry::new();
        let platform: Arc<dyn fm_platform::PlatformAdapter> = Arc::new(NoTrashPlatform);
        let settings = Arc::new(Mutex::new(Settings::default()));
        let planner = OperationPlanner::new(
            providers.clone(),
            platform,
            settings,
            PathBuf::from("/tmp/audit.jsonl"),
            Arc::new(AtomicBool::new(false)),
        );
        (planner, providers)
    }

    fn empty_request() -> StartOperationRequestDto {
        StartOperationRequestDto {
            operation_type: OperationKindDto::Copy,
            sources: Vec::new(),
            destination: None,
            name: None,
            conflict_policy: fm_transport_dto::OperationConflictPolicyDto::Ask,
            symlink_policy: SymlinkPolicyDto::CopyLink,
            archive_format: None,
            archive_compression_level: None,
            create_intermediate_directories: false,
            override_read_only: false,
            permanent_delete_confirmed: false,
            destinations: Vec::new(),
        }
    }

    #[test]
    fn archive_zip_format_inferred_from_extension() {
        assert_eq!(
            ArchiveCreationFormat::from_request(Path::new("/tmp/archive.zip"), None).ok(),
            Some(ArchiveCreationFormat::Zip),
        );
    }

    #[test]
    fn archive_7z_format_inferred_from_extension() {
        assert_eq!(
            ArchiveCreationFormat::from_request(Path::new("/tmp/archive.7z"), None).ok(),
            Some(ArchiveCreationFormat::SevenZip),
        );
    }

    #[test]
    fn archive_format_mismatch_is_rejected() {
        let result = ArchiveCreationFormat::from_request(
            Path::new("/tmp/archive.zip"),
            Some(ArchiveFormatDto::SevenZip),
        );
        assert!(result.is_err());
    }

    #[test]
    fn archive_unknown_extension_is_rejected() {
        let result = ArchiveCreationFormat::from_request(Path::new("/tmp/archive.tar"), None);
        assert!(result.is_err());
    }

    #[test]
    fn empty_sources_rejected_for_each_operation() {
        let (planner, _) = make_planner();
        let request = empty_request();
        for kind in [
            OperationKindDto::Copy,
            OperationKindDto::Move,
            OperationKindDto::Duplicate,
            OperationKindDto::Delete,
            OperationKindDto::Trash,
            OperationKindDto::CreateArchive,
        ] {
            let mut req = request.clone();
            req.operation_type = kind;
            let result = planner.plan(kind, &req);
            assert!(result.is_err(), "{:?} should reject empty sources", kind);
        }
    }

    #[test]
    fn search_returns_error() {
        let (planner, _) = make_planner();
        let request = empty_request();
        let result = planner.plan(OperationKindDto::Search, &request);
        match result {
            Err(e) => assert!(e.to_string().contains("start_search")),
            Ok(_) => panic!("expected error"),
        }
    }

    #[test]
    fn trash_platform_capability_rejected() {
        let (planner, _) = make_planner();
        let mut request = empty_request();
        request.sources = vec![fm_transport_dto::LocationDto {
            provider_id: "file".into(),
            uri: "file:///some/file".into(),
        }];
        let result = planner.plan(OperationKindDto::Trash, &request);
        match result {
            Err(e) => assert!(e.to_string().contains("TRASH")),
            Ok(_) => panic!("expected error"),
        }
    }
}
