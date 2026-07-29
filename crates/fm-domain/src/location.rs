//! Provider-neutral location addressing (spec §5.1).
//!
//! A [`Location`] must be serializable, stable enough to persist in bookmarks
//! and navigation history, able to preserve platform-specific paths (for
//! example a Windows drive letter embedded in a `file://` URI), and able to
//! identify its owning provider without re-parsing the URI text. Parsing an
//! arbitrary URI string into a validated `Location` is task 0017; this task
//! only defines the type and the invariant that both fields are always
//! populated together by whoever constructs it.

use serde::{Deserialize, Serialize};

use crate::ids::ProviderId;

/// A provider-neutral pointer to a location, for example a directory, an
/// archive entry or a saved search.
///
/// `uri` is the full, provider-specific URI text (`file:///Users/erik`,
/// `archive:///a.zip!/docs`, `search://local?query=report`); `provider_id`
/// duplicates the scheme so callers can dispatch to the owning
/// `FileSystemProvider` without re-parsing `uri`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Location {
    /// The virtual filesystem provider that owns this location.
    pub provider_id: ProviderId,
    /// The full, provider-specific URI text.
    pub uri: String,
}

impl Location {
    /// Creates a location from a provider id and a URI.
    pub fn new(provider_id: ProviderId, uri: impl Into<String>) -> Self {
        Self {
            provider_id,
            uri: uri.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn location_round_trips_through_serde_json() {
        let location = Location::new(ProviderId::new("file"), "file:///Users/erik/Documents");
        let json = serde_json::to_string(&location).expect("serialization must succeed");
        let parsed: Location = serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(location, parsed);
    }

    #[test]
    fn location_preserves_windows_style_paths() {
        let location = Location::new(ProviderId::new("file"), "file:///C:/Users/Erik/Documents");
        let json = serde_json::to_string(&location).expect("serialization must succeed");
        let parsed: Location = serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(parsed.uri, "file:///C:/Users/Erik/Documents");
    }

    #[test]
    fn location_identifies_its_provider_without_reparsing_the_uri() {
        let location = Location::new(ProviderId::new("archive"), "archive:///a.zip!/docs");
        assert_eq!(location.provider_id, ProviderId::new("archive"));
    }

    #[test]
    fn distinct_uris_are_not_equal_locations() {
        let a = Location::new(ProviderId::new("file"), "file:///a");
        let b = Location::new(ProviderId::new("file"), "file:///b");
        assert_ne!(a, b);
    }
}
