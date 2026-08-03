//! Application-wide settings wire contract (specification §26).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

/// Application colour theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ThemeDto {
    /// Follow the operating system.
    Auto,
    /// Light colours.
    Light,
    /// Dark colours.
    Dark,
}

/// Timestamp presentation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum DateFormatDto {
    /// Compact locale-aware format.
    Short,
    /// Descriptive locale-aware format.
    Medium,
    /// ISO-8601.
    Iso,
}

/// File-size presentation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum SizeFormatDto {
    /// Powers of 1024.
    Binary,
    /// Powers of 1000.
    Decimal,
    /// Raw bytes.
    Bytes,
}

/// Default operation conflict choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicyDto {
    /// Ask the user.
    Ask,
    /// Replace the destination.
    Overwrite,
    /// Keep both entries.
    KeepBoth,
    /// Skip the source.
    Skip,
}

/// Layout inherited by a new workspace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum DefaultPaneLayoutDto {
    /// Two panes.
    Dual,
    /// One pane.
    Single,
}

/// Versioned global settings. Live workspace content is deliberately absent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    /// On-disk schema version.
    pub schema_version: u32,
    /// Application theme.
    pub theme: ThemeDto,
    /// Base font size in CSS pixels.
    pub font_size: u16,
    /// Directory row height in CSS pixels.
    pub row_height: u16,
    /// Timestamp presentation.
    pub date_format: DateFormatDto,
    /// Size presentation.
    pub size_format: SizeFormatDto,
    /// Show hidden entries by default.
    pub show_hidden_files: bool,
    /// Confirm permanent deletion.
    pub confirm_permanent_delete: bool,
    /// Default operation conflict policy.
    pub default_conflict_policy: ConflictPolicyDto,
    /// Maximum concurrent operations.
    pub operation_concurrency: u16,
    /// Layout inherited by new workspaces.
    pub default_pane_layout: DefaultPaneLayoutDto,
    /// Columns inherited by new tabs.
    pub default_columns: Vec<String>,
    /// Action-to-shortcut mappings.
    pub keybindings: BTreeMap<String, String>,
    /// Enabled plugin identifiers.
    pub enabled_plugins: Vec<String>,
    /// Non-secret plugin settings keyed by plugin identifier.
    #[schema(value_type = Object)]
    pub plugin_settings: Value,
    /// Optional terminal command.
    pub terminal_command: Option<String>,
    /// Locations inherited by new panes.
    pub default_start_locations: Vec<String>,
    /// Directory-entry icon set: `"generic"` for the built-in glyphs, or a discovered plugin's id.
    pub icon_theme: String,
}
