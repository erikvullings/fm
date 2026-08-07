//! Wire types for starting and cancelling a recursive filesystem search
//! (spec §24, task 0068/0089).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::location::LocationDto;

/// Starts a new recursive, cancellable search (filename and/or content)
/// (`POST /api/v1/search`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "workspaceId": "7136d9bc-90f1-4c67-8527-9d30683167ec",
    "roots": [{"providerId": "local", "uri": "file:///Users/erik/Documents"}],
    "query": "report*.pdf",
    "contentQuery": "TODO",
    "recurse": true
}))]
pub struct StartSearchRequestDto {
    /// Workspace that owns the search and receives its result-batch events.
    pub workspace_id: Uuid,
    /// One or more roots to search.
    pub roots: Vec<LocationDto>,
    /// Filename query. Matched as a case-insensitive substring unless it
    /// contains `*` or `?`, in which case it is treated as a glob pattern.
    /// Empty string means "match all filenames".
    pub query: String,
    /// Optional content-search query. When present, files that pass the
    /// filename filter (or all files if `query` is empty) are scanned for
    /// this content pattern (task 0089).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_query: Option<String>,
    /// Treat `content_query` as a regular expression. Defaults to `false`.
    #[serde(default)]
    pub content_regex: bool,
    /// Make the content search case-sensitive. Defaults to `false` (case-insensitive).
    #[serde(default)]
    pub content_case_sensitive: bool,
    /// Only match `content_query` at word boundaries. Defaults to `false`.
    #[serde(default)]
    pub content_whole_word: bool,
    /// Recurse into subdirectories. Defaults to `true`. When `false`, only
    /// the root directories' immediate children are scanned.
    #[serde(default = "default_recurse")]
    pub recurse: bool,
}

fn default_recurse() -> bool {
    true
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
            content_query: None,
            content_regex: false,
            content_case_sensitive: false,
            content_whole_word: false,
            recurse: true,
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
    fn start_search_request_with_content_query_round_trips() {
        let request = StartSearchRequestDto {
            workspace_id: Uuid::new_v4(),
            roots: vec![sample_location()],
            query: String::new(),
            content_query: Some("TODO".to_owned()),
            content_regex: true,
            content_case_sensitive: false,
            content_whole_word: true,
            recurse: false,
        };
        let json = serde_json::to_string(&request).expect("serialization must succeed");
        assert!(json.contains("\"contentQuery\""));
        assert!(json.contains("\"contentRegex\""));
        assert!(json.contains("\"recurse\""));
        let parsed: StartSearchRequestDto =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(request, parsed);
    }

    #[test]
    fn start_search_request_defaults_are_correct_for_back_compat() {
        let json =
            r#"{"workspaceId":"00000000-0000-0000-0000-000000000000","roots":[],"query":"x"}"#;
        let parsed: StartSearchRequestDto =
            serde_json::from_str(json).expect("defaults must fill in missing fields");
        assert_eq!(parsed.query, "x");
        assert!(parsed.content_query.is_none());
        assert!(!parsed.content_regex);
        assert!(!parsed.content_case_sensitive);
        assert!(!parsed.content_whole_word);
        assert!(parsed.recurse, "recurse defaults to true");
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
