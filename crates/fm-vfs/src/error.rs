use fm_domain::ProviderId;

use crate::ProviderCapabilities;

/// Provider-neutral failures exposed by the virtual filesystem boundary.
#[derive(Debug, thiserror::Error)]
pub enum VfsError {
    /// The requested location or entry does not exist.
    #[error("location not found: {location}")]
    NotFound {
        /// Provider-neutral URI that could not be found.
        location: String,
    },
    /// Access to the requested location was denied.
    #[error("permission denied: {location}")]
    PermissionDenied {
        /// Provider-neutral URI that could not be accessed.
        location: String,
    },
    /// Creating or moving an entry would overwrite an existing entry.
    #[error("location already exists: {location}")]
    AlreadyExists {
        /// Provider-neutral URI that already exists.
        location: String,
    },
    /// A directory name was empty.
    #[error("directory name is empty")]
    EmptyName,
    /// A directory name contains characters forbidden by the target platform.
    #[error("directory name contains invalid characters")]
    InvalidNameCharacters,
    /// A directory name is reserved by Windows, including device names with extensions.
    #[error("directory name is reserved")]
    ReservedName,
    /// A directory name attempted to address a parent or nested path.
    #[error("directory name must be one path component")]
    PathTraversalName,
    /// An operation requiring a directory targeted another entry kind.
    #[error("location is not a directory: {location}")]
    NotADirectory {
        /// Provider-neutral URI with the wrong entry kind.
        location: String,
    },
    /// An operation requiring a non-directory targeted a directory.
    #[error("location is a directory: {location}")]
    IsADirectory {
        /// Provider-neutral URI with the wrong entry kind.
        location: String,
    },
    /// The provider does not advertise a required capability.
    #[error("provider does not support capability {capability:?}")]
    UnsupportedCapability {
        /// Capability required by the rejected operation.
        capability: ProviderCapabilities,
    },
    /// The caller cancelled the operation.
    #[error("operation cancelled")]
    Cancelled,
    /// The provider encountered an I/O failure safe to report across layers.
    #[error("provider I/O failed: {message}")]
    Io {
        /// Sanitized failure description; never a raw transport response.
        message: String,
    },
    /// A location is malformed or invalid for its provider.
    #[error("invalid location: {location}")]
    InvalidLocation {
        /// Invalid provider-neutral URI.
        location: String,
    },
    /// No provider is registered for a location's provider id.
    #[error("unknown provider: {provider_id}")]
    UnknownProvider {
        /// Provider id that could not be resolved.
        provider_id: ProviderId,
    },
}

impl VfsError {
    /// Returns the stable machine-readable code used by transport adapters.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::NotFound { .. } => "notFound",
            Self::PermissionDenied { .. } => "permissionDenied",
            Self::AlreadyExists { .. } => "alreadyExists",
            Self::EmptyName => "emptyName",
            Self::InvalidNameCharacters => "invalidNameCharacters",
            Self::ReservedName => "reservedName",
            Self::PathTraversalName => "pathTraversalName",
            Self::NotADirectory { .. } => "notADirectory",
            Self::IsADirectory { .. } => "isADirectory",
            Self::UnsupportedCapability { .. } => "unsupportedCapability",
            Self::Cancelled => "cancelled",
            Self::Io { .. } => "io",
            Self::InvalidLocation { .. } => "invalidLocation",
            Self::UnknownProvider { .. } => "unknownProvider",
        }
    }
}
