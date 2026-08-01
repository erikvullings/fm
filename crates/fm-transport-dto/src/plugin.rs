//! Plugin discovery DTOs shared by REST and Tauri.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A declarative custom column made available by an enabled plugin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginColumnDto {
    /// Plugin-namespaced column identifier.
    pub id: String,
    /// User-facing column label.
    pub title: String,
}

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
    /// Data-only column declarations that the host can render safely.
    pub columns: Vec<PluginColumnDto>,
}
