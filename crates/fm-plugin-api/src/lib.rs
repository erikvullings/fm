//! The contract plugins are written against (task 0053).
//!
//! Deliberately free of unstable Rust ABI types so that plugins can later be
//! isolated in WebAssembly without changing the interface they see.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The only plugin ABI revision accepted by this release.
pub const API_VERSION: &str = "1";

/// A versioned plugin manifest, read from `plugin.toml`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PluginManifest {
    /// Stable, reverse-domain-style plugin identifier.
    pub id: String,
    /// Display name shown to users.
    pub name: String,
    /// Plugin package version.
    pub version: String,
    /// Version of this stable plugin API.
    pub api_version: String,
    /// User-facing description.
    pub description: String,
    /// Plugin entrypoint relative to the manifest directory.
    pub entrypoint: PathBuf,
    /// Explicit capability grants; omitted capabilities are denied.
    #[serde(default)]
    pub permissions: PluginPermissions,
    /// Declarative contributions; arbitrary WebView UI is intentionally absent.
    #[serde(default)]
    pub contributions: PluginContributions,
}

impl PluginManifest {
    /// Parses and validates a manifest document.
    pub fn parse(source: &str) -> Result<Self, ManifestError> {
        let manifest: Self = toml::from_str(source).map_err(ManifestError::Toml)?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// Validates stable schema invariants after deserialization.
    pub fn validate(&self) -> Result<(), ManifestError> {
        if self.id.trim().is_empty() || self.id.contains(char::is_whitespace) {
            return Err(ManifestError::InvalidField("id"));
        }
        if self.name.trim().is_empty()
            || self.version.trim().is_empty()
            || self.description.trim().is_empty()
        {
            return Err(ManifestError::InvalidField(
                "name, version, and description",
            ));
        }
        if self.api_version != API_VERSION {
            return Err(ManifestError::UnsupportedApiVersion(
                self.api_version.clone(),
            ));
        }
        if self.entrypoint.as_os_str().is_empty() || self.entrypoint.is_absolute() {
            return Err(ManifestError::InvalidField("entrypoint"));
        }
        Ok(())
    }
}

/// Manifest parsing or validation failure.
#[derive(Debug, Error)]
pub enum ManifestError {
    /// The TOML does not conform to the versioned schema.
    #[error("invalid plugin manifest: {0}")]
    Toml(#[source] toml::de::Error),
    /// The manifest declares an API revision this host does not support.
    #[error("unsupported plugin api_version {0:?}; supported version is {API_VERSION:?}")]
    UnsupportedApiVersion(String),
    /// A required field is empty or unsafe.
    #[error("invalid plugin manifest field: {0}")]
    InvalidField(&'static str),
}

/// Explicit plugin permission grants. Every field defaults to denial.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct PluginPermissions {
    /// Allows metadata for the current selection.
    pub selected_entry_metadata: bool,
    /// Allows bounded content reads for the current selection.
    pub selected_entry_content_read: bool,
    /// Roots the plugin may read from.
    pub filesystem_read: Vec<PathBuf>,
    /// Roots the plugin may write to.
    pub filesystem_write: Vec<PathBuf>,
    /// Allows reading from the clipboard.
    pub clipboard_read: bool,
    /// Allows writing to the clipboard.
    pub clipboard_write: bool,
    /// Network host allow-list.
    pub network: Vec<String>,
    /// Allows process spawning through a future restricted host service.
    pub process_spawn: bool,
    /// Allows non-blocking host notifications.
    pub notifications: bool,
    /// Allows non-secret settings storage under the plugin's identifier.
    pub settings_storage: bool,
}

/// A host operation guarded by the manifest permission model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Permission {
    /// Selected-entry metadata.
    SelectedEntryMetadata,
    /// Selected-entry content.
    SelectedEntryContentRead,
    /// Filesystem reads.
    FilesystemRead,
    /// Filesystem writes.
    FilesystemWrite,
    /// Clipboard reads.
    ClipboardRead,
    /// Clipboard writes.
    ClipboardWrite,
    /// Network requests.
    Network,
    /// Process execution.
    ProcessSpawn,
    /// Host notifications.
    Notifications,
    /// Plugin settings storage.
    SettingsStorage,
}

/// A typed, safe denial returned by the host boundary.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("plugin permission denied: {permission:?}")]
pub struct PermissionDenied {
    /// The capability that was not granted.
    pub permission: Permission,
}

impl PluginPermissions {
    /// Ensures an unscoped host request has been declared by the plugin.
    pub fn require(&self, permission: Permission) -> Result<(), PermissionDenied> {
        let granted = match permission {
            Permission::SelectedEntryMetadata => self.selected_entry_metadata,
            Permission::SelectedEntryContentRead => self.selected_entry_content_read,
            Permission::FilesystemRead => !self.filesystem_read.is_empty(),
            Permission::FilesystemWrite => !self.filesystem_write.is_empty(),
            Permission::ClipboardRead => self.clipboard_read,
            Permission::ClipboardWrite => self.clipboard_write,
            Permission::Network => !self.network.is_empty(),
            Permission::ProcessSpawn => self.process_spawn,
            Permission::Notifications => self.notifications,
            Permission::SettingsStorage => self.settings_storage,
        };
        granted.then_some(()).ok_or(PermissionDenied { permission })
    }
}

/// The only declarative contribution families available in API version 1.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct PluginContributions {
    /// Action, context-menu, and command-palette contributions.
    pub actions: bool,
    /// Custom data columns.
    pub columns: bool,
    /// Metadata extraction fields.
    pub metadata_extraction: bool,
}

/// Plugin action declaration, projected into the host action registry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionContribution {
    /// Plugin-namespaced action identifier.
    pub id: String,
    /// User-facing action label.
    pub title: String,
    /// User-facing action description.
    pub description: String,
}

/// Custom column declaration. Values are data, never JavaScript/UI code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnContribution {
    /// Plugin-namespaced column identifier.
    pub id: String,
    /// User-facing column label.
    pub title: String,
}

/// Metadata extraction declaration, namespaced by plugin identifier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MetadataExtractionContribution {
    /// Plugin-namespaced metadata field.
    pub field: String,
}

/// Narrow services a plugin may request from its host; each method is capability-gated.
pub trait HostServices {
    /// Reads selected-entry metadata only when permitted.
    fn selected_entry_metadata(&self) -> Result<(), PermissionDenied>;
    /// Posts a non-blocking notification only when permitted.
    fn notify(&self, message: &str) -> Result<(), PermissionDenied>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_versioned_manifest_with_explicit_permissions() {
        let manifest = PluginManifest::parse(
            r#"id = "example.copy"
name = "Copy"
version = "0.1.0"
api_version = "1"
description = "Copies a selected path"
entrypoint = "plugin.lua"

[permissions]
selected_entry_metadata = true
clipboard_write = true

[contributions]
actions = true
"#,
        )
        .expect("manifest must be valid");

        assert!(manifest.permissions.selected_entry_metadata);
        assert!(manifest.permissions.clipboard_write);
        assert!(manifest.contributions.actions);
        assert!(!manifest.contributions.columns);
    }

    #[test]
    fn rejects_unknown_api_versions() {
        let error = PluginManifest::parse(
            "id='example.plugin'\nname='Example'\nversion='1'\napi_version='99'\ndescription='Example'\nentrypoint='plugin.lua'",
        )
        .expect_err("unknown API version must be rejected");

        assert!(matches!(error, ManifestError::UnsupportedApiVersion(version) if version == "99"));
    }

    #[test]
    fn rejects_unknown_permission_keys() {
        let error = PluginManifest::parse(
            "id='example.plugin'\nname='Example'\nversion='1'\napi_version='1'\ndescription='Example'\nentrypoint='plugin.lua'\n[permissions]\nall_files=true",
        )
        .expect_err("unknown capability must be rejected");

        assert!(matches!(error, ManifestError::Toml(_)));
    }

    #[test]
    fn permissions_deny_host_calls_by_default() {
        let error = PluginPermissions::default()
            .require(Permission::ClipboardWrite)
            .expect_err("omitted permission must be denied");

        assert_eq!(error.permission, Permission::ClipboardWrite);
    }
}
