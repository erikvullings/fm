use async_trait::async_trait;
use fm_domain::{EntryMetadata, EntrySummary, Location, ProviderId};
use tokio_util::sync::CancellationToken;

use crate::{
    CopyCommitOptions, DirectoryPage, EntryRef, ListOptions, ProviderCapabilities,
    ProviderChangeStream, ProviderReadStream, ProviderWriteStream, RemoveOptions, VfsError,
    WriteOptions,
};

/// Provider-neutral asynchronous filesystem interface.
///
/// Implementations may represent local files, archives, remote stores or
/// virtual result sets. Callers must check [`Self::capabilities`] before
/// invoking a capability-gated operation.
#[async_trait]
pub trait FileSystemProvider: Send + Sync {
    /// Returns the stable id used by owned [`Location`] values.
    fn id(&self) -> ProviderId;

    /// Reports the operations this provider currently supports.
    fn capabilities(&self) -> ProviderCapabilities;

    /// Lists one page of a directory.
    async fn list(
        &self,
        location: &Location,
        options: ListOptions,
        cancellation: CancellationToken,
    ) -> Result<DirectoryPage, VfsError>;

    /// Fetches detailed metadata for an entry.
    async fn metadata(
        &self,
        entry: &EntryRef,
        cancellation: CancellationToken,
    ) -> Result<EntryMetadata, VfsError>;

    /// Inspects one entry without following symbolic links.
    async fn inspect(
        &self,
        entry: &EntryRef,
        cancellation: CancellationToken,
    ) -> Result<EntrySummary, VfsError> {
        let _ = (entry, cancellation);
        Err(VfsError::UnsupportedCapability {
            capability: ProviderCapabilities::LIST,
        })
    }

    /// Returns a regular file's logical byte length for operation planning.
    async fn file_size(
        &self,
        entry: &EntryRef,
        cancellation: CancellationToken,
    ) -> Result<u64, VfsError> {
        let _ = (entry, cancellation);
        Err(VfsError::UnsupportedCapability {
            capability: ProviderCapabilities::READ,
        })
    }

    /// Creates a child directory at a location.
    async fn create_directory(
        &self,
        location: &Location,
        name: &str,
        cancellation: CancellationToken,
    ) -> Result<EntryRef, VfsError>;

    /// Renames or moves an entry to a destination location.
    async fn rename(
        &self,
        source: &EntryRef,
        destination: &Location,
        cancellation: CancellationToken,
    ) -> Result<EntryRef, VfsError>;

    /// Removes an entry according to the supplied safety options.
    async fn remove(
        &self,
        entry: &EntryRef,
        options: RemoveOptions,
        cancellation: CancellationToken,
    ) -> Result<(), VfsError>;

    /// Opens an entry as a streaming reader.
    async fn open_read(
        &self,
        entry: &EntryRef,
        cancellation: CancellationToken,
    ) -> Result<ProviderReadStream, VfsError>;

    /// Opens a destination as a streaming writer.
    async fn open_write(
        &self,
        destination: &Location,
        options: WriteOptions,
        cancellation: CancellationToken,
    ) -> Result<ProviderWriteStream, VfsError>;

    /// Attempts a provider-native clone into a private temporary destination.
    ///
    /// `false` requests the caller's streaming fallback without exposing a destination.
    async fn server_side_copy(
        &self,
        source: &EntryRef,
        temporary: &Location,
        cancellation: CancellationToken,
    ) -> Result<bool, VfsError> {
        let _ = (source, temporary, cancellation);
        Ok(false)
    }

    /// Atomically publishes a completed temporary copy and applies supported source metadata.
    async fn commit_copy(
        &self,
        source: &EntryRef,
        temporary: &Location,
        destination: &Location,
        options: CopyCommitOptions,
        cancellation: CancellationToken,
    ) -> Result<EntryRef, VfsError> {
        let _ = (source, temporary, destination, options, cancellation);
        Err(VfsError::UnsupportedCapability {
            capability: ProviderCapabilities::WRITE,
        })
    }

    /// Removes a provider-private temporary copy after failure or cancellation.
    async fn discard_copy(
        &self,
        temporary: &Location,
        cancellation: CancellationToken,
    ) -> Result<(), VfsError> {
        let _ = (temporary, cancellation);
        Err(VfsError::UnsupportedCapability {
            capability: ProviderCapabilities::WRITE,
        })
    }

    /// Copies a symbolic link itself rather than following its target.
    async fn copy_symlink(
        &self,
        source: &EntryRef,
        destination: &Location,
        cancellation: CancellationToken,
    ) -> Result<EntryRef, VfsError> {
        let _ = (source, destination, cancellation);
        Err(VfsError::UnsupportedCapability {
            capability: ProviderCapabilities::WRITE,
        })
    }

    /// Resolves a symbolic link for an explicit copy-target request.
    async fn resolve_symlink(
        &self,
        source: &EntryRef,
        cancellation: CancellationToken,
    ) -> Result<EntrySummary, VfsError> {
        let _ = (source, cancellation);
        Err(VfsError::UnsupportedCapability {
            capability: ProviderCapabilities::READ,
        })
    }

    /// Applies supported timestamps and permissions from one entry to another.
    async fn preserve_metadata(
        &self,
        source: &EntryRef,
        destination: &EntryRef,
        cancellation: CancellationToken,
    ) -> Result<(), VfsError> {
        let _ = (source, destination, cancellation);
        Err(VfsError::UnsupportedCapability {
            capability: ProviderCapabilities::SET_TIMESTAMPS,
        })
    }

    /// Reports whether an atomic rename can span the two locations.
    async fn same_filesystem(
        &self,
        source: &EntryRef,
        destination_directory: &Location,
        cancellation: CancellationToken,
    ) -> Result<bool, VfsError> {
        let _ = (source, destination_directory, cancellation);
        Ok(false)
    }

    /// Watches a location for incremental directory changes.
    async fn watch(
        &self,
        location: &Location,
        cancellation: CancellationToken,
    ) -> Result<ProviderChangeStream, VfsError>;
}
