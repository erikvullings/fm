//! Settings persistence (task 0030).
//!
//! Settings are versioned and migrated rather than discarded when the schema
//! changes (specification §26), and are written atomically so a crash cannot
//! leave a half-written configuration behind.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

/// Current on-disk settings schema.
pub const CURRENT_SCHEMA_VERSION: u32 = 2;
/// Stable settings filename within the platform configuration directory.
pub const SETTINGS_FILE_NAME: &str = "settings.json";

/// Application colour theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    /// Follow the operating-system preference.
    #[default]
    Auto,
    /// Light colours.
    Light,
    /// Dark colours.
    Dark,
}

/// Timestamp presentation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DateFormat {
    /// Compact locale-aware date and time.
    Short,
    /// More descriptive locale-aware date and time.
    #[default]
    Medium,
    /// ISO-8601 representation.
    Iso,
}

/// File-size presentation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SizeFormat {
    /// Powers of 1024.
    #[default]
    Binary,
    /// Powers of 1000.
    Decimal,
    /// Unscaled byte count.
    Bytes,
}

/// Directory-entry icon set (task 0092).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum IconTheme {
    /// Built-in hand-drawn generic glyphs.
    #[default]
    Generic,
    /// Vendored Catppuccin (Mocha) per-file-type icon set.
    Catppuccin,
}

/// Default choice for file-operation conflicts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicy {
    /// Ask before resolving.
    #[default]
    Ask,
    /// Replace the destination.
    Overwrite,
    /// Keep both entries.
    KeepBoth,
    /// Skip the source entry.
    Skip,
}

/// Initial pane arrangement inherited by a newly created workspace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DefaultPaneLayout {
    /// Two panes arranged horizontally.
    #[default]
    Dual,
    /// One pane.
    Single,
}

/// Versioned, application-wide settings. Live workspace content is excluded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// On-disk schema version.
    pub schema_version: u32,
    /// Application theme.
    pub theme: Theme,
    /// Base font size in CSS pixels.
    pub font_size: u16,
    /// Directory row height in CSS pixels.
    pub row_height: u16,
    /// Timestamp presentation.
    pub date_format: DateFormat,
    /// File-size presentation.
    pub size_format: SizeFormat,
    /// Whether hidden entries are shown by default.
    pub show_hidden_files: bool,
    /// Whether permanent deletion requires confirmation.
    pub confirm_permanent_delete: bool,
    /// Default operation conflict policy.
    pub default_conflict_policy: ConflictPolicy,
    /// Maximum concurrent operations.
    pub operation_concurrency: u16,
    /// Layout inherited by new workspaces.
    pub default_pane_layout: DefaultPaneLayout,
    /// Columns inherited by new directory tabs.
    pub default_columns: Vec<String>,
    /// Action identifier to shortcut mapping.
    pub keybindings: BTreeMap<String, String>,
    /// Enabled plugin identifiers.
    pub enabled_plugins: Vec<String>,
    /// Non-secret plugin configuration. Secrets must use platform secret storage.
    pub plugin_settings: BTreeMap<String, Value>,
    /// Optional terminal executable or command.
    pub terminal_command: Option<String>,
    /// Locations inherited by newly created panes.
    pub default_start_locations: Vec<String>,
    /// Directory-entry icon set.
    pub icon_theme: IconTheme,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            theme: Theme::Auto,
            font_size: 13,
            row_height: 20,
            date_format: DateFormat::Medium,
            size_format: SizeFormat::Binary,
            show_hidden_files: false,
            confirm_permanent_delete: true,
            default_conflict_policy: ConflictPolicy::Ask,
            operation_concurrency: 2,
            default_pane_layout: DefaultPaneLayout::Dual,
            default_columns: vec![
                "core.name".into(),
                "core.size".into(),
                "core.modified".into(),
            ],
            keybindings: BTreeMap::new(),
            enabled_plugins: Vec::new(),
            plugin_settings: BTreeMap::new(),
            terminal_command: None,
            default_start_locations: Vec::new(),
            icon_theme: IconTheme::Generic,
        }
    }
}

/// Successful load plus a user-visible recovery warning when defaults were used.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadOutcome {
    /// Loaded or default settings.
    pub settings: Settings,
    /// Recovery warning suitable for a frontend notification.
    pub warning: Option<String>,
}

/// Settings storage failure.
#[derive(Debug, Error)]
pub enum SettingsError {
    /// The platform did not expose a user configuration directory.
    #[error("the platform has no user configuration directory")]
    ConfigDirectoryUnavailable,
    /// A filesystem operation failed.
    #[error("settings filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),
    /// Settings serialization failed.
    #[error("settings serialization failed: {0}")]
    Serialize(#[from] serde_json::Error),
}

/// JSON settings repository rooted in one configuration directory.
#[derive(Debug, Clone)]
pub struct SettingsStore {
    directory: PathBuf,
}

impl SettingsStore {
    /// Creates a store rooted in an explicit directory.
    #[must_use]
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }

    /// Creates the production store under the platform-appropriate config directory.
    pub fn platform_default() -> Result<Self, SettingsError> {
        let directory = dirs::config_dir()
            .ok_or(SettingsError::ConfigDirectoryUnavailable)?
            .join("fm");
        Ok(Self::new(directory))
    }

    /// Loads and migrates settings. Invalid/unreadable files are backed up.
    pub fn load(&self) -> Result<LoadOutcome, SettingsError> {
        let path = self.path();
        if !path.exists() {
            return Ok(LoadOutcome {
                settings: Settings::default(),
                warning: None,
            });
        }
        match fs::read(&path).ok().and_then(|bytes| migrate(&bytes).ok()) {
            Some(settings) => Ok(LoadOutcome {
                settings,
                warning: None,
            }),
            None => {
                fs::create_dir_all(&self.directory)?;
                let backup = self
                    .directory
                    .join(format!("{SETTINGS_FILE_NAME}.corrupt-{}", unix_timestamp()));
                fs::rename(&path, &backup)?;
                Ok(LoadOutcome {
                    settings: Settings::default(),
                    warning: Some(format!(
                        "Settings could not be read. Defaults were loaded and the original was backed up to {}.",
                        backup.display()
                    )),
                })
            }
        }
    }

    /// Atomically persists settings using a temporary sibling and rename.
    pub fn save(&self, settings: &Settings) -> Result<(), SettingsError> {
        fs::create_dir_all(&self.directory)?;
        let path = self.path();
        let temporary = self
            .directory
            .join(format!(".{SETTINGS_FILE_NAME}.{}.tmp", std::process::id()));
        let mut current = settings.clone();
        current.schema_version = CURRENT_SCHEMA_VERSION;
        let bytes = serde_json::to_vec_pretty(&current)?;
        {
            let mut file = fs::File::create(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
        }
        fs::rename(&temporary, path)?;
        Ok(())
    }

    fn path(&self) -> PathBuf {
        self.directory.join(SETTINGS_FILE_NAME)
    }
}

fn migrate(bytes: &[u8]) -> Result<Settings, serde_json::Error> {
    let mut value: Value = serde_json::from_slice(bytes)?;
    let version = value
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .unwrap_or(1);
    if version == 1 {
        value["schemaVersion"] = Value::from(CURRENT_SCHEMA_VERSION);
    } else if version != u64::from(CURRENT_SCHEMA_VERSION) {
        return Err(<serde_json::Error as serde::de::Error>::custom(
            "unsupported settings schema version",
        ));
    }
    serde_json::from_value(value)
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn settings_round_trip_every_application_default() {
        let directory = tempdir().expect("temp directory");
        let store = SettingsStore::new(directory.path());
        let settings = Settings {
            theme: Theme::Dark,
            font_size: 15,
            row_height: 31,
            date_format: DateFormat::Iso,
            size_format: SizeFormat::Decimal,
            show_hidden_files: true,
            confirm_permanent_delete: false,
            default_conflict_policy: ConflictPolicy::KeepBoth,
            operation_concurrency: 7,
            default_pane_layout: DefaultPaneLayout::Single,
            default_columns: vec!["core.name".into(), "core.size".into()],
            keybindings: [("copy".into(), "Ctrl+C".into())].into(),
            enabled_plugins: vec!["archive".into()],
            plugin_settings: [("archive".into(), serde_json::json!({"level": 3}))].into(),
            terminal_command: Some("alacritty".into()),
            default_start_locations: vec!["file:///tmp".into()],
            icon_theme: IconTheme::Catppuccin,
            ..Settings::default()
        };

        store.save(&settings).expect("save settings");

        assert_eq!(store.load().expect("load settings").settings, settings);
    }

    #[test]
    fn v1_fixture_migrates_to_the_current_schema_without_losing_values() {
        let directory = tempdir().expect("temp directory");
        fs::write(
            directory.path().join(SETTINGS_FILE_NAME),
            r#"{
              "schemaVersion": 1,
              "theme": "light",
              "fontSize": 16,
              "rowHeight": 30,
              "dateFormat": "iso",
              "sizeFormat": "bytes",
              "showHiddenFiles": true,
              "confirmPermanentDelete": false,
              "defaultConflictPolicy": "overwrite",
              "operationConcurrency": 3
            }"#,
        )
        .expect("write v1 fixture");

        let loaded = SettingsStore::new(directory.path())
            .load()
            .expect("migrate fixture");

        assert_eq!(loaded.settings.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(loaded.settings.theme, Theme::Light);
        assert_eq!(loaded.settings.font_size, 16);
        assert!(loaded.settings.show_hidden_files);
        assert_eq!(
            loaded.settings.default_columns,
            Settings::default().default_columns
        );
        assert!(loaded.warning.is_none());
    }

    #[test]
    fn corrupt_settings_are_backed_up_and_defaults_are_returned_with_a_warning() {
        let directory = tempdir().expect("temp directory");
        fs::write(directory.path().join(SETTINGS_FILE_NAME), "{not json")
            .expect("write corrupt settings");

        let loaded = SettingsStore::new(directory.path())
            .load()
            .expect("recover corrupt settings");

        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.warning.is_some());
        let backups = fs::read_dir(directory.path())
            .expect("read settings directory")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"))
            .count();
        assert_eq!(backups, 1);
        assert!(!directory.path().join(SETTINGS_FILE_NAME).exists());
    }
}
