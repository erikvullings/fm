//! Request DTOs for the milestone-1 navigation and metadata endpoints
//! (spec §8, §12).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::location::LocationDto;
use crate::workspace::SortDescriptorDto;

/// Requests the entries of a directory (`POST /api/v1/directories/list`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "workspaceId": "7136d9bc-90f1-4c67-8527-9d30683167ec",
    "paneId": "5b1b6b1e-9b1b-4b1b-8b1b-1b1b1b1b1b1b",
    "requestId": "e1ce66cc-64a8-4ae7-9cc1-2882bc80de4e",
    "location": {"providerId": "local", "uri": "file:///Users/erik"},
    "continuationToken": null,
    "sort": [{"columnId": "core.name", "direction": "ascending"}],
    "showHidden": false,
    "foldersFirst": true
}))]
pub struct ListDirectoryRequest {
    /// Workspace that owns the pane and receives its events.
    pub workspace_id: Uuid,
    /// The pane the resulting snapshot will be shown in.
    pub pane_id: Uuid,
    /// Client-generated identifier, echoed back so a superseded request's
    /// late response can be recognised and dropped.
    pub request_id: Uuid,
    /// The location to list.
    pub location: LocationDto,
    /// An opaque token requesting the next page of a prior listing.
    pub continuation_token: Option<String>,
    /// Sort descriptors applied by the backend to the returned page.
    #[serde(default)]
    pub sort: Vec<SortDescriptorDto>,
    /// Whether hidden entries should be included.
    #[serde(default)]
    pub show_hidden: bool,
    /// Whether directories should sort before non-directories.
    #[serde(default)]
    pub folders_first: bool,
}

/// Requests navigation to a new location (`POST /api/v1/navigation/open`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "workspaceId": "7136d9bc-90f1-4c67-8527-9d30683167ec",
    "paneId": "5b1b6b1e-9b1b-4b1b-8b1b-1b1b1b1b1b1b",
    "requestId": "e1ce66cc-64a8-4ae7-9cc1-2882bc80de4e",
    "location": {"providerId": "local", "uri": "file:///Users/erik/Documents"}
}))]
pub struct NavigateRequest {
    /// Workspace that owns the pane and receives its events.
    pub workspace_id: Uuid,
    /// The pane to navigate.
    pub pane_id: Uuid,
    /// Client-generated identifier, echoed back so a superseded request's
    /// late response can be recognised and dropped.
    pub request_id: Uuid,
    /// The location to navigate to.
    pub location: LocationDto,
}

/// Requests detailed metadata for a single entry
/// (`POST /api/v1/entries/metadata`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "entryId": "5b1b6b1e-9b1b-4b1b-8b1b-1b1b1b1b1b1b",
    "location": {"providerId": "local", "uri": "file:///Users/erik/report.pdf"}
}))]
pub struct EntryMetadataRequest {
    /// The entry to fetch metadata for.
    pub entry_id: Uuid,
    /// The entry's location, so the request can be dispatched to the owning
    /// provider without a prior lookup.
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
    fn list_directory_request_round_trips_and_uses_camel_case_field_names() {
        let request = ListDirectoryRequest {
            workspace_id: Uuid::new_v4(),
            pane_id: Uuid::new_v4(),
            request_id: Uuid::new_v4(),
            location: sample_location(),
            continuation_token: Some("page-2".to_owned()),
            sort: Vec::new(),
            show_hidden: false,
            folders_first: true,
        };
        let json = serde_json::to_string(&request).expect("serialization must succeed");
        assert!(json.contains("\"paneId\""));
        assert!(json.contains("\"workspaceId\""));
        assert!(json.contains("\"requestId\""));
        assert!(json.contains("\"continuationToken\""));
        let parsed: ListDirectoryRequest =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(request, parsed);
    }

    #[test]
    fn navigate_request_round_trips_and_uses_camel_case_field_names() {
        let request = NavigateRequest {
            workspace_id: Uuid::new_v4(),
            pane_id: Uuid::new_v4(),
            request_id: Uuid::new_v4(),
            location: sample_location(),
        };
        let json = serde_json::to_string(&request).expect("serialization must succeed");
        assert!(json.contains("\"paneId\""));
        assert!(json.contains("\"workspaceId\""));
        assert!(json.contains("\"requestId\""));
        let parsed: NavigateRequest =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(request, parsed);
    }

    #[test]
    fn entry_metadata_request_round_trips_and_uses_camel_case_field_names() {
        let request = EntryMetadataRequest {
            entry_id: Uuid::new_v4(),
            location: sample_location(),
        };
        let json = serde_json::to_string(&request).expect("serialization must succeed");
        assert!(json.contains("\"entryId\""));
        let parsed: EntryMetadataRequest =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(request, parsed);
    }
}
