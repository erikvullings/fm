//! Wire types for starting and cancelling a recursive filesystem search
//! (spec §24, task 0068).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::location::LocationDto;

/// Starts a new recursive, cancellable filename search
/// (`POST /api/v1/search`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "workspaceId": "7136d9bc-90f1-4c67-8527-9d30683167ec",
    "roots": [{"providerId": "local", "uri": "file:///Users/erik/Documents"}],
    "query": "report*.pdf"
}))]
pub struct StartSearchRequestDto {
    /// Workspace that owns the search and receives its result-batch events.
    pub workspace_id: Uuid,
    /// One or more roots to search recursively.
    pub roots: Vec<LocationDto>,
    /// Plain filename query. Matched as a case-insensitive substring unless
    /// it contains `*` or `?`, in which case it is treated as a glob
    /// pattern; size/date/type filters and content search are not yet
    /// supported (spec §24).
    pub query: String,
}

/// Identifies a started search and its virtual result location.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "searchId": "5b1b6b1e-9b1b-4b1b-8b1b-1b1b1b1b1b1b",
    "location": {
        "providerId": "search",
        "uri": "search://local/5b1b6b1e-9b1b-4b1b-8b1b-1b1b1b1b1b1b"
    }
}))]
pub struct StartSearchResponseDto {
    /// The started search's identifier, used to cancel it.
    pub search_id: Uuid,
    /// The virtual `search://local/{searchId}` location that lists this
    /// search's streamed results; opening it in a pane renders results
    /// through the existing directory table unchanged (spec §24).
    pub location: LocationDto,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_location() -> LocationDto {
        LocationDto {
            provider_id: "local".to_owned(),
            uri: "file:///Users/erik".to_owned(),
        }
    }

    #[test]
    fn start_search_request_round_trips_and_uses_camel_case_field_names() {
        let request = StartSearchRequestDto {
            workspace_id: Uuid::new_v4(),
            roots: vec![sample_location()],
            query: "report*.pdf".to_owned(),
        };
        let json = serde_json::to_string(&request).expect("serialization must succeed");
        assert!(json.contains("\"workspaceId\""));
        assert!(json.contains("\"roots\""));
        assert!(json.contains("\"query\""));
        let parsed: StartSearchRequestDto =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(request, parsed);
    }

    #[test]
    fn start_search_response_round_trips_and_uses_camel_case_field_names() {
        let response = StartSearchResponseDto {
            search_id: Uuid::new_v4(),
            location: LocationDto {
                provider_id: "search".to_owned(),
                uri: "search://local/5b1b6b1e-9b1b-4b1b-8b1b-1b1b1b1b1b1b".to_owned(),
            },
        };
        let json = serde_json::to_string(&response).expect("serialization must succeed");
        assert!(json.contains("\"searchId\""));
        assert!(json.contains("\"location\""));
        let parsed: StartSearchResponseDto =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(response, parsed);
    }
}
