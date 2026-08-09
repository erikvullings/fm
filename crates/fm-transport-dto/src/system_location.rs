//! Operating-system-discovered filesystem locations (task 0101).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::LocationDto;

/// Presentation category for a system location.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum SystemLocationKindDto {
    /// A cloud-synchronized or cloud-mounted directory.
    Cloud,
    /// A filesystem mounted from another computer by the operating system.
    Network,
}

/// A navigable location discovered by the host operating system.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SystemLocationDto {
    /// Display label supplied by the OS folder.
    pub name: String,
    /// Classification used to group locations in the frontend.
    pub kind: SystemLocationKindDto,
    /// Existing provider-neutral local location.
    pub location: LocationDto,
    /// Optional advisory provider name; navigation never depends on it.
    pub provider_hint: Option<String>,
    /// Optional lower-case mount protocol, for example `smb`.
    pub protocol: Option<String>,
    /// Optional remote server name.
    pub server: Option<String>,
    /// Optional remote share name.
    pub share: Option<String>,
    /// Whether the filesystem is mounted read-only, when detectable.
    pub read_only: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::{SystemLocationDto, SystemLocationKindDto};
    use crate::LocationDto;

    #[test]
    fn serializes_network_mount_metadata_for_both_hosts() {
        let dto = SystemLocationDto {
            name: "Team Files".to_owned(),
            kind: SystemLocationKindDto::Network,
            location: LocationDto {
                provider_id: "local".to_owned(),
                uri: "file:///Volumes/Team%20Files".to_owned(),
            },
            provider_hint: None,
            protocol: Some("smb".to_owned()),
            server: Some("files.example.test".to_owned()),
            share: Some("team".to_owned()),
            read_only: Some(true),
        };

        let value = serde_json::to_value(dto).expect("serializable DTO");
        assert_eq!(value["kind"], "network");
        assert_eq!(value["protocol"], "smb");
        assert_eq!(value["server"], "files.example.test");
        assert_eq!(value["share"], "team");
        assert_eq!(value["readOnly"], true);
    }
}
