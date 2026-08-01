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
    /// Capabilities the manifest requests; ungranted capabilities are denied (spec §19).
    pub permissions: PluginPermissionsDto,
}

/// The manifest-declared capability grants for one plugin (spec §19), mirroring
/// `fm_plugin_api::PluginPermissions`. A field is denied when it is `false` or empty.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginPermissionsDto {
    /// Allows metadata for the current selection.
    pub selected_entry_metadata: bool,
    /// Allows bounded content reads for the current selection.
    pub selected_entry_content_read: bool,
    /// Roots the plugin may read from; denied when empty.
    pub filesystem_read: Vec<String>,
    /// Roots the plugin may write to; denied when empty.
    pub filesystem_write: Vec<String>,
    /// Allows reading from the clipboard.
    pub clipboard_read: bool,
    /// Allows writing to the clipboard.
    pub clipboard_write: bool,
    /// Network host allow-list; denied when empty.
    pub network: Vec<String>,
    /// Allows process spawning through a future restricted host service.
    pub process_spawn: bool,
    /// Allows non-blocking host notifications.
    pub notifications: bool,
    /// Allows non-secret settings storage under the plugin's identifier.
    pub settings_storage: bool,
}

/// One bounded diagnostic log entry retained for a plugin (spec §19.4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginLogEntryDto {
    /// A safe, user-readable failure message.
    pub message: String,
}
