//! Application-level errors shared by every host (specification §7, §8).

use fm_transport_dto::{ApplicationErrorCode, ApplicationErrorDto};
use uuid::Uuid;

/// Failure modes the application service layer can report to a host.
///
/// Hosts translate these into transport-specific responses. The service layer
/// itself never leaks raw OS or filesystem error details (spec §8); each
/// variant carries only a user-readable message.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
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
            Self::Internal => ApplicationErrorCode::Internal,
        }
    }

    /// Builds the transport DTO for this error, tagged with the request that
    /// produced it (spec §8).
    pub fn into_dto(self, request_id: Uuid) -> ApplicationErrorDto {
        ApplicationErrorDto {
            code: self.code(),
            message: self.to_string(),
            request_id,
            details: None,
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
}
