//! Plugin discovery DTOs shared by REST and Tauri.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A discovered plugin, including disabled plugins with safe diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginDescriptorDto {
    /// Stable manifest identifier, or a directory-derived identifier when invalid.
    pub id: String,
    /// User-facing name when available.
    pub name: String,
    /// Package version when available.
    pub version: String,
    /// Manifest description when available.
    pub description: String,
    /// Whether the valid plugin is enabled in persisted settings.
    pub enabled: bool,
    /// Validation or discovery diagnostic for disabled plugins.
    pub diagnostic: Option<String>,
}
