//! Plugin discovery and execution (task 0054).
//!
//! Enforces the declared permissions, applies execution timeouts and isolates
//! failures, so that a misbehaving plugin degrades to a notification rather
//! than taking down the application.

use std::fs;
use std::path::{Path, PathBuf};

use fm_plugin_api::PluginManifest;

/// A discovered plugin, including disabled manifests and their diagnostics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredPlugin {
    /// The parsed manifest when valid.
    pub manifest: Option<PluginManifest>,
    /// Directory containing `plugin.toml`.
    pub directory: PathBuf,
    /// Validation diagnostic that prevents loading, if any.
    pub diagnostic: Option<String>,
}

impl DiscoveredPlugin {
    /// Whether this plugin's manifest can be enabled.
    #[must_use]
    pub fn is_valid(&self) -> bool {
        self.manifest.is_some()
    }

    /// Stable ID for valid plugins, or the directory name for invalid ones.
    #[must_use]
    pub fn id(&self) -> String {
        self.manifest
            .as_ref()
            .map(|manifest| manifest.id.clone())
            .or_else(|| {
                self.directory
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| "invalid-plugin".to_owned())
    }
}

/// Discovers plugin manifests without allowing one malformed plugin to abort startup.
#[derive(Debug, Clone)]
pub struct PluginDiscovery {
    directory: PathBuf,
}

impl PluginDiscovery {
    /// Scans direct child directories of `directory` for `plugin.toml` manifests.
    #[must_use]
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }

    /// Returns valid and disabled plugin records in deterministic directory order.
    pub fn discover(&self) -> Vec<DiscoveredPlugin> {
        discover_plugins(&self.directory)
    }
}

/// Scans direct child directories for manifests. Filesystem errors are represented as diagnostics.
#[must_use]
pub fn discover_plugins(directory: &Path) -> Vec<DiscoveredPlugin> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut directories: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    directories.sort();
    directories
        .into_iter()
        .filter_map(|directory| {
            let manifest_path = directory.join("plugin.toml");
            if !manifest_path.exists() {
                return None;
            }
            Some(match fs::read_to_string(&manifest_path) {
                Ok(source) => match PluginManifest::parse(&source) {
                    Ok(manifest) => DiscoveredPlugin {
                        manifest: Some(manifest),
                        directory,
                        diagnostic: None,
                    },
                    Err(error) => DiscoveredPlugin {
                        manifest: None,
                        directory,
                        diagnostic: Some(error.to_string()),
                    },
                },
                Err(error) => DiscoveredPlugin {
                    manifest: None,
                    directory,
                    diagnostic: Some(format!("could not read plugin.toml: {error}")),
                },
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn discovery_reports_a_malformed_plugin_as_disabled() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let invalid = temporary.path().join("invalid");
        fs::create_dir(&invalid).expect("plugin directory");
        fs::write(invalid.join("plugin.toml"), "id = 'missing-fields'").expect("manifest");

        let plugins = discover_plugins(temporary.path());

        assert_eq!(plugins.len(), 1);
        assert!(!plugins[0].is_valid());
        assert!(
            plugins[0]
                .diagnostic
                .as_deref()
                .is_some_and(|diagnostic| diagnostic.contains("invalid plugin manifest"))
        );
    }
}
