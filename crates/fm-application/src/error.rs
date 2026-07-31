//! Application-level errors shared by every host (specification §7, §8).

use fm_transport_dto::{ApplicationErrorCode, ApplicationErrorDto};
use fm_vfs::VfsError;
use uuid::Uuid;

use crate::workspace::WorkspaceError;

/// Failure modes the application service layer can report to a host.
///
/// Hosts translate these into transport-specific responses. The service layer
/// itself never leaks raw OS or filesystem error details (spec §8); each
/// variant carries only a user-readable message.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ApplicationError {
    /// The requested resource does not exist.
    #[error("resource not found")]
    NotFound,
    /// The current caller is not permitted to perform this action.
    #[error("permission denied")]
    PermissionDenied,
    /// The request failed validation.
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    /// The operation's destination already exists.
    #[error("destination already exists")]
    DestinationAlreadyExists,
    /// The location's provider is unavailable or not registered.
    #[error("provider unavailable")]
    ProviderUnavailable,
    /// The operation was cancelled by the caller.
    #[error("operation cancelled")]
    OperationCancelled,
    /// A workspace mutation's `expected_revision` no longer matches the
    /// stored revision (spec §5.3.10).
    #[error("The workspace changed after this view was loaded.")]
    WorkspaceRevisionConflict {
        /// The workspace whose revision changed.
        workspace_id: uuid::Uuid,
        /// The revision the caller last observed.
        expected_revision: u64,
        /// The revision actually stored.
        actual_revision: u64,
    },
    /// An unexpected, unclassified failure occurred.
    #[error("internal error")]
    Internal,
}

impl ApplicationError {
    /// The stable, machine-readable code for this error (spec §8).
    pub fn code(&self) -> ApplicationErrorCode {
        match self {
            Self::NotFound => ApplicationErrorCode::NotFound,
            Self::PermissionDenied => ApplicationErrorCode::PermissionDenied,
            Self::InvalidRequest(_) => ApplicationErrorCode::InvalidRequest,
            Self::DestinationAlreadyExists => ApplicationErrorCode::DestinationAlreadyExists,
            Self::ProviderUnavailable => ApplicationErrorCode::ProviderUnavailable,
            Self::OperationCancelled => ApplicationErrorCode::OperationCancelled,
            Self::WorkspaceRevisionConflict { .. } => {
                ApplicationErrorCode::WorkspaceRevisionConflict
            }
            Self::Internal => ApplicationErrorCode::Internal,
        }
    }

    /// Builds the transport DTO for this error, tagged with the request that
    /// produced it (spec §8).
    pub fn into_dto(self, request_id: Uuid) -> ApplicationErrorDto {
        let details = match &self {
            Self::WorkspaceRevisionConflict {
                workspace_id,
                expected_revision,
                actual_revision,
            } => Some(serde_json::json!({
                "workspaceId": workspace_id,
                "expectedRevision": expected_revision,
                "actualRevision": actual_revision,
            })),
            _ => None,
        };
        ApplicationErrorDto {
            code: self.code(),
            message: self.to_string(),
            request_id,
            details,
        }
    }
}

impl From<WorkspaceError> for ApplicationError {
    fn from(error: WorkspaceError) -> Self {
        match error {
            WorkspaceError::NotFound { .. } => Self::NotFound,
            WorkspaceError::RevisionConflict {
                id,
                expected,
                actual,
            } => Self::WorkspaceRevisionConflict {
                workspace_id: id.into(),
                expected_revision: expected.unwrap_or(0),
                actual_revision: actual,
            },
            WorkspaceError::Invalid(details) => {
                Self::InvalidRequest(format!("workspace failed validation: {details:?}"))
            }
            WorkspaceError::UnsupportedSchemaVersion { .. } => Self::Internal,
            WorkspaceError::Corrupt { .. } => Self::Internal,
            WorkspaceError::Io(_) => Self::Internal,
            WorkspaceError::Serialization(_) => Self::Internal,
            WorkspaceError::PaneNotFound { .. } => {
                Self::InvalidRequest("pane does not exist in this workspace".to_owned())
            }
            WorkspaceError::TabNotFound { .. } => {
                Self::InvalidRequest("tab does not exist in this pane".to_owned())
            }
            WorkspaceError::InvalidCommand(message) => Self::InvalidRequest(message),
        }
    }
}

impl From<VfsError> for ApplicationError {
    fn from(error: VfsError) -> Self {
        match error {
            VfsError::NotFound { .. } => Self::NotFound,
            VfsError::PermissionDenied { .. } => Self::PermissionDenied,
            VfsError::AlreadyExists { .. } => Self::DestinationAlreadyExists,
            VfsError::Cancelled => Self::OperationCancelled,
            VfsError::UnknownProvider { .. } => Self::ProviderUnavailable,
            VfsError::InvalidLocation { .. }
            | VfsError::EmptyName
            | VfsError::InvalidNameCharacters
            | VfsError::ReservedName
            | VfsError::PathTraversalName
            | VfsError::NotADirectory { .. }
            | VfsError::IsADirectory { .. }
            | VfsError::UnsupportedCapability { .. } => {
                Self::InvalidRequest("the requested filesystem operation is not valid".to_owned())
            }
            VfsError::Io { .. } => Self::Internal,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_variant_maps_to_its_matching_error_code() {
        let cases = [
            (ApplicationError::NotFound, ApplicationErrorCode::NotFound),
            (
                ApplicationError::PermissionDenied,
                ApplicationErrorCode::PermissionDenied,
            ),
            (
                ApplicationError::InvalidRequest("bad field".to_owned()),
                ApplicationErrorCode::InvalidRequest,
            ),
            (
                ApplicationError::DestinationAlreadyExists,
                ApplicationErrorCode::DestinationAlreadyExists,
            ),
            (
                ApplicationError::ProviderUnavailable,
                ApplicationErrorCode::ProviderUnavailable,
            ),
            (
                ApplicationError::OperationCancelled,
                ApplicationErrorCode::OperationCancelled,
            ),
            (
                ApplicationError::WorkspaceRevisionConflict {
                    workspace_id: uuid::Uuid::new_v4(),
                    expected_revision: 14,
                    actual_revision: 16,
                },
                ApplicationErrorCode::WorkspaceRevisionConflict,
            ),
            (ApplicationError::Internal, ApplicationErrorCode::Internal),
        ];

        for (error, expected_code) in cases {
            assert_eq!(error.code(), expected_code);
        }
    }

    #[test]
    fn into_dto_carries_the_given_request_id_and_never_leaks_raw_errors() {
        let request_id = Uuid::new_v4();
        let dto = ApplicationError::Internal.into_dto(request_id);

        assert_eq!(dto.code, ApplicationErrorCode::Internal);
        assert_eq!(dto.request_id, request_id);
        assert_eq!(dto.message, "internal error");
        assert!(dto.details.is_none());
    }

    #[test]
    fn workspace_revision_conflict_into_dto_matches_the_spec_5_3_10_shape() {
        let workspace_id = uuid::Uuid::new_v4();
        let request_id = Uuid::new_v4();
        let dto = ApplicationError::WorkspaceRevisionConflict {
            workspace_id,
            expected_revision: 14,
            actual_revision: 16,
        }
        .into_dto(request_id);

        assert_eq!(dto.code, ApplicationErrorCode::WorkspaceRevisionConflict);
        assert_eq!(
            dto.message,
            "The workspace changed after this view was loaded."
        );
        let details = dto.details.expect("details must be present");
        assert_eq!(details["workspaceId"], workspace_id.to_string());
        assert_eq!(details["expectedRevision"], 14);
        assert_eq!(details["actualRevision"], 16);
    }

    #[test]
    fn from_workspace_error_maps_revision_conflict_with_its_details() {
        let workspace_id = fm_domain::WorkspaceId::new();
        let error = WorkspaceError::RevisionConflict {
            id: workspace_id,
            expected: Some(14),
            actual: 16,
        };

        let mapped: ApplicationError = error.into();
        assert_eq!(
            mapped,
            ApplicationError::WorkspaceRevisionConflict {
                workspace_id: workspace_id.into(),
                expected_revision: 14,
                actual_revision: 16,
            }
        );
    }
}
