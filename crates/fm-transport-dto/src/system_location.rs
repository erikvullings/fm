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
}
