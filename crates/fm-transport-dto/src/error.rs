//! The structured error DTO shared by every endpoint (spec §8).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// A closed set of machine-readable error codes.
///
/// Codes are stable and additive: existing variants are never renamed or
/// removed, only appended to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ApplicationErrorCode {
    /// The requested resource does not exist.
    NotFound,
    /// The current user is not permitted to perform this action.
    PermissionDenied,
    /// The request itself was malformed or failed validation.
    InvalidRequest,
    /// The operation's destination already exists.
    DestinationAlreadyExists,
    /// The location's provider is not available or not registered.
    ProviderUnavailable,
    /// The operation was cancelled by the caller.
    OperationCancelled,
    /// An unexpected, unclassified failure occurred.
    Internal,
}

/// A structured, user-facing error, never a raw OS error string (spec §8).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "code": "destinationAlreadyExists",
    "message": "A file named report.pdf already exists.",
    "requestId": "e1ce66cc-64a8-4ae7-9cc1-2882bc80de4e",
    "details": {"destination": "file:///Users/erik/Documents/report.pdf"}
}))]
pub struct ApplicationErrorDto {
    /// A stable, machine-readable error code.
    pub code: ApplicationErrorCode,
    /// A user-readable description, never a raw OS error.
    pub message: String,
    /// Correlates this error with the request that produced it.
    pub request_id: Uuid,
    /// Additional, code-specific structured context.
    pub details: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> ApplicationErrorDto {
        ApplicationErrorDto {
            code: ApplicationErrorCode::DestinationAlreadyExists,
            message: "A file named report.pdf already exists.".to_owned(),
            request_id: Uuid::new_v4(),
            details: Some(
                serde_json::json!({"destination": "file:///Users/erik/Documents/report.pdf"}),
            ),
        }
    }

    #[test]
    fn application_error_dto_round_trips_through_serde_json() {
        let dto = sample();
        let json = serde_json::to_string(&dto).expect("serialization must succeed");
        let parsed: ApplicationErrorDto =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(dto, parsed);
    }

    #[test]
    fn application_error_dto_matches_the_spec_example_shape() {
        let json = serde_json::to_string(&sample()).expect("serialization must succeed");
        assert!(json.contains("\"code\":\"destinationAlreadyExists\""));
        assert!(json.contains("\"requestId\""));
        assert!(json.contains("\"details\""));
    }

    #[test]
    fn application_error_dto_allows_details_to_be_absent() {
        let dto = ApplicationErrorDto {
            code: ApplicationErrorCode::NotFound,
            message: "Not found.".to_owned(),
            request_id: Uuid::new_v4(),
            details: None,
        };
        let json = serde_json::to_string(&dto).expect("serialization must succeed");
        let parsed: ApplicationErrorDto =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(dto, parsed);
    }

    #[test]
    fn application_error_code_never_leaks_raw_os_error_text() {
        for code in [
            ApplicationErrorCode::NotFound,
            ApplicationErrorCode::PermissionDenied,
            ApplicationErrorCode::InvalidRequest,
            ApplicationErrorCode::DestinationAlreadyExists,
            ApplicationErrorCode::ProviderUnavailable,
            ApplicationErrorCode::OperationCancelled,
            ApplicationErrorCode::Internal,
        ] {
            let json = serde_json::to_string(&code).expect("serialization must succeed");
            assert!(json.starts_with('"') && json.ends_with('"'));
        }
    }
}
