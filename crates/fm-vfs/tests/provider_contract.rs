//! Public contract tests for virtual filesystem providers.

use std::sync::Arc;

use async_trait::async_trait;
use fm_domain::{EntryMetadata, Location, ProviderId};
use fm_vfs::{
    DirectoryPage, EntryRef, FileSystemProvider, ListOptions, ProviderCapabilities,
    ProviderChangeStream, ProviderReadStream, ProviderRegistry, ProviderWriteStream, RemoveOptions,
    VfsError, WriteOptions,
};
use tokio_util::sync::CancellationToken;

struct StubProvider {
    id: ProviderId,
    capabilities: ProviderCapabilities,
}

#[async_trait]
impl FileSystemProvider for StubProvider {
    fn id(&self) -> ProviderId {
        self.id.clone()
    }

    fn capabilities(&self) -> ProviderCapabilities {
        self.capabilities
    }

    async fn list(
        &self,
        _location: &Location,
        _options: ListOptions,
        _cancellation: CancellationToken,
    ) -> Result<DirectoryPage, VfsError> {
        unreachable!("registry tests do not perform I/O")
    }

    async fn metadata(
        &self,
        _entry: &EntryRef,
        _cancellation: CancellationToken,
    ) -> Result<EntryMetadata, VfsError> {
        unreachable!("registry tests do not perform I/O")
    }

    async fn create_directory(
        &self,
        _location: &Location,
        _name: &str,
        _cancellation: CancellationToken,
    ) -> Result<EntryRef, VfsError> {
        unreachable!("registry tests do not perform I/O")
    }

    async fn rename(
        &self,
        _source: &EntryRef,
        _destination: &Location,
        _cancellation: CancellationToken,
    ) -> Result<EntryRef, VfsError> {
        unreachable!("registry tests do not perform I/O")
    }

    async fn remove(
        &self,
        _entry: &EntryRef,
        _options: RemoveOptions,
        _cancellation: CancellationToken,
    ) -> Result<(), VfsError> {
        unreachable!("registry tests do not perform I/O")
    }

    async fn open_read(
        &self,
        _entry: &EntryRef,
        _cancellation: CancellationToken,
    ) -> Result<ProviderReadStream, VfsError> {
        unreachable!("registry tests do not perform I/O")
    }

    async fn open_write(
        &self,
        _destination: &Location,
        _options: WriteOptions,
        _cancellation: CancellationToken,
    ) -> Result<ProviderWriteStream, VfsError> {
        unreachable!("registry tests do not perform I/O")
    }

    async fn watch(
        &self,
        _location: &Location,
        _cancellation: CancellationToken,
    ) -> Result<ProviderChangeStream, VfsError> {
        unreachable!("registry tests do not perform I/O")
    }
}

#[test]
fn unsupported_capabilities_are_rejected_before_a_caller_starts_io() {
    let capabilities = ProviderCapabilities::LIST | ProviderCapabilities::READ;
    let mut io_started = false;

    let result = capabilities.require(ProviderCapabilities::WRITE);
    if result.is_ok() {
        io_started = true;
    }

    assert!(matches!(
        result,
        Err(VfsError::UnsupportedCapability { capability })
            if capability == ProviderCapabilities::WRITE
    ));
    assert!(!io_started);
}

#[test]
fn registry_resolves_a_location_to_its_provider() {
    let provider = Arc::new(StubProvider {
        id: ProviderId::new("file"),
        capabilities: ProviderCapabilities::LIST,
    });
    let mut registry = ProviderRegistry::new();
    registry.register(provider);

    let resolved = registry
        .resolve(&Location::new(
            ProviderId::new("file"),
            "file:///Users/erik",
        ))
        .expect("registered provider must resolve");

    assert_eq!(resolved.id(), ProviderId::new("file"));
}

#[test]
fn registry_returns_a_typed_error_for_an_unknown_provider() {
    let registry = ProviderRegistry::new();

    let error = match registry.resolve(&Location::new(
        ProviderId::new("archive"),
        "archive:///example.zip!/",
    )) {
        Ok(_) => panic!("unknown provider must fail"),
        Err(error) => error,
    };

    assert!(matches!(
        &error,
        VfsError::UnknownProvider { provider_id } if provider_id == &ProviderId::new("archive")
    ));
    assert_eq!(error.code(), "unknownProvider");
}

#[test]
fn every_vfs_error_has_a_stable_machine_readable_code() {
    let errors = [
        VfsError::NotFound {
            location: "file:///missing".to_owned(),
        },
        VfsError::PermissionDenied {
            location: "file:///private".to_owned(),
        },
        VfsError::AlreadyExists {
            location: "file:///existing".to_owned(),
        },
        VfsError::NotADirectory {
            location: "file:///file.txt".to_owned(),
        },
        VfsError::IsADirectory {
            location: "file:///folder".to_owned(),
        },
        VfsError::UnsupportedCapability {
            capability: ProviderCapabilities::WATCH,
        },
        VfsError::Cancelled,
        VfsError::Io {
            message: "device unavailable".to_owned(),
        },
        VfsError::InvalidLocation {
            location: "not a URI".to_owned(),
        },
    ];

    assert_eq!(
        errors.map(|error| error.code()),
        [
            "notFound",
            "permissionDenied",
            "alreadyExists",
            "notADirectory",
            "isADirectory",
            "unsupportedCapability",
            "cancelled",
            "io",
            "invalidLocation",
        ]
    );
}

#[test]
fn capabilities_match_the_exact_specification_bits() {
    let capabilities = [
        ProviderCapabilities::LIST,
        ProviderCapabilities::READ,
        ProviderCapabilities::WRITE,
        ProviderCapabilities::CREATE_DIRECTORY,
        ProviderCapabilities::RENAME,
        ProviderCapabilities::MOVE,
        ProviderCapabilities::SERVER_SIDE_COPY,
        ProviderCapabilities::DELETE,
        ProviderCapabilities::TRASH,
        ProviderCapabilities::WATCH,
        ProviderCapabilities::RANDOM_ACCESS,
        ProviderCapabilities::SET_TIMESTAMPS,
        ProviderCapabilities::SET_PERMISSIONS,
        ProviderCapabilities::CHECKSUM,
    ];

    for (index, capability) in capabilities.into_iter().enumerate() {
        assert_eq!(capability.bits(), 1 << index);
    }
}
