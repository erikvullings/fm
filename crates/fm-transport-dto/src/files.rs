//! Wire types for reading byte ranges from a single file and searching its
//! content (task 0088).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::location::LocationDto;

/// Supplies a password for one archive to the current backend session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveCredentialRequestDto {
    /// Any location within the target archive; only the outer archive identity is cached.
    pub location: LocationDto,
    /// Password to cache in backend memory. Transport adapters must not log request bodies.
    #[schema(value_type = String, format = Password)]
    pub password: String,
}

/// Requests a byte range from a single file (`POST /api/v1/files/range`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "location": {"providerId": "local", "uri": "file:///Users/erik/report.txt"},
    "offset": 0,
    "length": 65536
}))]
pub struct ReadFileRangeRequestDto {
    /// The file to read from.
    pub location: LocationDto,
    /// The zero-based byte offset to start reading at.
    pub offset: u64,
    /// The number of bytes to read, capped server-side to a maximum chunk
    /// size; requesting more than remains in the file returns fewer bytes.
    pub length: u64,
}

/// One chunk of a file's content, starting at `offset`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "data": [72, 101, 108, 108, 111],
    "offset": 0,
    "length": 5,
    "eof": true,
    "probablyBinary": false
}))]
pub struct ReadFileRangeResponseDto {
    /// The chunk's raw bytes.
    pub data: Vec<u8>,
    /// The byte offset the chunk starts at (echoes the request).
    pub offset: u64,
    /// The number of bytes actually returned; may be less than requested if
    /// the file ends before `offset + length`.
    pub length: u64,
    /// Whether this chunk reached the end of the file.
    pub eof: bool,
    /// A NUL-byte sniff of the file's start, only populated when `offset`
    /// is `0`; `None` for later chunks of the same file.
    pub probably_binary: Option<bool>,
}

/// Searches for a substring or regex within a single file's content
/// (`POST /api/v1/files/search`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "location": {"providerId": "local", "uri": "file:///Users/erik/report.txt"},
    "query": "error",
    "regex": false,
    "caseSensitive": false,
    "wholeWord": false
}))]
pub struct SearchInFileRequestDto {
    /// The file to search within.
    pub location: LocationDto,
    /// The substring or regex pattern to search for.
    pub query: String,
    /// Whether `query` is a regular expression rather than a plain substring.
    pub regex: bool,
    /// Whether the match is case-sensitive.
    pub case_sensitive: bool,
    /// Whether a match must be flanked by non-word characters (or line start/end), like an
    /// editor's "whole word" search toggle. Defaults to `false` for older clients that omit it.
    #[serde(default)]
    pub whole_word: bool,
}

/// One match found by a [`SearchInFileRequestDto`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({"lineNumber": 12, "offset": 34, "length": 5}))]
pub struct SearchInFileMatchDto {
    /// The one-based line number the match starts on.
    pub line_number: u64,
    /// The byte offset within the file the match starts at.
    pub offset: u64,
    /// The match's length in bytes.
    pub length: u32,
}

/// The result of a content search within a single file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({"matches": [], "truncated": false}))]
pub struct SearchInFileResponseDto {
    /// Matches found, in file order, up to a server-side cap.
    pub matches: Vec<SearchInFileMatchDto>,
    /// Whether the result was cut off before scanning the whole file because
    /// the match cap was reached.
    pub truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_location() -> LocationDto {
        LocationDto {
            provider_id: "local".to_owned(),
            uri: "file:///Users/erik/report.txt".to_owned(),
        }
    }

    #[test]
    fn read_file_range_request_round_trips_and_uses_camel_case_field_names() {
        let request = ReadFileRangeRequestDto {
            location: sample_location(),
            offset: 128,
            length: 65536,
        };
        let json = serde_json::to_string(&request).expect("serialization must succeed");
        assert!(json.contains("\"location\""));
        assert!(json.contains("\"offset\""));
        assert!(json.contains("\"length\""));
        let parsed: ReadFileRangeRequestDto =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(request, parsed);
    }

    #[test]
    fn read_file_range_response_round_trips_and_uses_camel_case_field_names() {
        let response = ReadFileRangeResponseDto {
            data: vec![72, 101, 108, 108, 111],
            offset: 0,
            length: 5,
            eof: true,
            probably_binary: Some(false),
        };
        let json = serde_json::to_string(&response).expect("serialization must succeed");
        assert!(json.contains("\"data\""));
        assert!(json.contains("\"eof\""));
        assert!(json.contains("\"probablyBinary\""));
        let parsed: ReadFileRangeResponseDto =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(response, parsed);
    }

    #[test]
    fn read_file_range_response_serializes_data_as_a_plain_byte_array() {
        let response = ReadFileRangeResponseDto {
            data: vec![1, 2, 3],
            offset: 0,
            length: 3,
            eof: true,
            probably_binary: None,
        };
        let value = serde_json::to_value(&response).expect("serialization must succeed");
        assert_eq!(value["data"], serde_json::json!([1, 2, 3]));
        assert_eq!(value["probablyBinary"], serde_json::Value::Null);
    }

    #[test]
    fn search_in_file_request_round_trips_and_uses_camel_case_field_names() {
        let request = SearchInFileRequestDto {
            location: sample_location(),
            query: "error".to_owned(),
            regex: false,
            case_sensitive: false,
            whole_word: false,
        };
        let json = serde_json::to_string(&request).expect("serialization must succeed");
        assert!(json.contains("\"query\""));
        assert!(json.contains("\"regex\""));
        assert!(json.contains("\"caseSensitive\""));
        assert!(json.contains("\"wholeWord\""));
        let parsed: SearchInFileRequestDto =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(request, parsed);
    }

    #[test]
    fn search_in_file_request_defaults_whole_word_to_false_when_omitted() {
        let json = serde_json::json!({
            "location": sample_location(),
            "query": "error",
            "regex": false,
            "caseSensitive": false,
        });
        let parsed: SearchInFileRequestDto =
            serde_json::from_value(json).expect("deserialization must succeed");
        assert!(!parsed.whole_word);
    }

    #[test]
    fn search_in_file_response_round_trips_and_uses_camel_case_field_names() {
        let response = SearchInFileResponseDto {
            matches: vec![SearchInFileMatchDto {
                line_number: 12,
                offset: 34,
                length: 5,
            }],
            truncated: false,
        };
        let json = serde_json::to_string(&response).expect("serialization must succeed");
        assert!(json.contains("\"lineNumber\""));
        assert!(json.contains("\"truncated\""));
        let parsed: SearchInFileResponseDto =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(response, parsed);
    }
}
