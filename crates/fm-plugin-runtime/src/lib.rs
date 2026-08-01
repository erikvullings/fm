//! Plugin discovery and execution (task 0054).
//!
//! Enforces the declared permissions, applies execution timeouts and isolates
//! failures, so that a misbehaving plugin degrades to a notification rather
//! than taking down the application.

use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use fm_plugin_api::{ActionContribution, ColumnContribution, Permission, PluginManifest};
use mlua::{Error as LuaError, HookTriggers, Lua, LuaOptions, LuaSerdeExt, StdLib, Table, VmState};
use serde::de::DeserializeOwned;
use thiserror::Error;

const DEFAULT_TIMEOUT: Duration = Duration::from_millis(100);
const DEFAULT_MEMORY_LIMIT_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_INSTRUCTION_LIMIT: usize = 100_000;
const DEFAULT_FAILURE_LIMIT: u8 = 3;
const MAX_LOG_ENTRIES: usize = 100;

/// Bounded diagnostics retained for one plugin execution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginLogEntry {
    /// Stable manifest identifier.
    pub plugin_id: String,
    /// A safe, user-readable failure message.
    pub message: String,
}

/// The reason a plugin call was isolated from the host application.
#[derive(Debug, Error)]
pub enum PluginRuntimeError {
    /// The plugin has been disabled after repeated failures.
    #[error("plugin {plugin_id:?} is disabled: {reason}")]
    Disabled {
        /// Stable manifest identifier.
        plugin_id: String,
        /// Automatic-disable diagnostic.
        reason: String,
    },
    /// The entrypoint could not be loaded.
    #[error("could not load plugin {plugin_id:?}: {source}")]
    Load {
        /// Stable manifest identifier.
        plugin_id: String,
        #[source]
        /// Underlying filesystem failure.
        source: std::io::Error,
    },
    /// Lua execution failed, including denied host calls and malformed results.
    #[error("plugin {plugin_id:?} failed: {message}")]
    Execution {
        /// Stable manifest identifier.
        plugin_id: String,
        /// Safe failure diagnostic.
        message: String,
    },
}

/// Restricted Lua executor for version-one plugin contributions.
///
/// Each call gets a fresh Lua VM containing only table, string, math, and UTF-8
/// helpers. It deliberately omits package, io, os, debug, and all host access
/// except the explicitly permission-checked `host` table.
#[derive(Debug)]
pub struct PluginRuntime {
    timeout: Duration,
    memory_limit_bytes: usize,
    instruction_limit: usize,
    failure_limit: u8,
    state: Mutex<RuntimeState>,
}

#[derive(Debug, Default)]
struct RuntimeState {
    failures: BTreeMap<String, u8>,
    disabled: BTreeMap<String, String>,
    logs: BTreeMap<String, VecDeque<PluginLogEntry>>,
}

impl Default for PluginRuntime {
    fn default() -> Self {
        Self::new(
            DEFAULT_TIMEOUT,
            DEFAULT_MEMORY_LIMIT_BYTES,
            DEFAULT_INSTRUCTION_LIMIT,
            DEFAULT_FAILURE_LIMIT,
        )
    }
}

impl PluginRuntime {
    /// Creates a runtime with explicit per-call resource limits.
    #[must_use]
    pub fn new(
        timeout: Duration,
        memory_limit_bytes: usize,
        instruction_limit: usize,
        failure_limit: u8,
    ) -> Self {
        Self {
            timeout,
            memory_limit_bytes,
            instruction_limit,
            failure_limit,
            state: Mutex::new(RuntimeState::default()),
        }
    }

    /// Executes the declared action contribution function from one plugin.
    ///
    /// A script returns a table whose optional `actions` member is a function
    /// returning an array of `ActionContribution` tables.
    pub fn actions(
        &self,
        manifest: &PluginManifest,
        directory: &Path,
    ) -> Result<Vec<ActionContribution>, PluginRuntimeError> {
        self.ensure_enabled(&manifest.id)?;
        if !manifest.contributions.actions {
            return Ok(Vec::new());
        }
        let result = self.execute_contribution(manifest, directory, "actions");
        match result {
            Ok(actions) => {
                self.reset_failures(&manifest.id);
                Ok(actions)
            }
            Err(message) => Err(self.record_failure(&manifest.id, message)),
        }
    }

    /// Executes declared data-only custom column declarations from one plugin.
    pub fn columns(
        &self,
        manifest: &PluginManifest,
        directory: &Path,
    ) -> Result<Vec<ColumnContribution>, PluginRuntimeError> {
        self.ensure_enabled(&manifest.id)?;
        if !manifest.contributions.columns {
            return Ok(Vec::new());
        }
        match self.execute_contribution(manifest, directory, "columns") {
            Ok(columns) => {
                self.reset_failures(&manifest.id);
                Ok(columns)
            }
            Err(message) => Err(self.record_failure(&manifest.id, message)),
        }
    }

    /// Returns bounded retained diagnostics for a plugin.
    #[must_use]
    pub fn logs(&self, plugin_id: &str) -> Vec<PluginLogEntry> {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .logs
            .get(plugin_id)
            .map(|entries| entries.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Re-enables a plugin after an automatic disablement.
    pub fn reenable(&self, plugin_id: &str) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.disabled.remove(plugin_id);
        state.failures.remove(plugin_id);
    }

    /// Returns the automatic-disable reason, if any.
    #[must_use]
    pub fn disabled_reason(&self, plugin_id: &str) -> Option<String> {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .disabled
            .get(plugin_id)
            .cloned()
    }

    fn execute_contribution<T: DeserializeOwned>(
        &self,
        manifest: &PluginManifest,
        directory: &Path,
        contribution: &str,
    ) -> Result<Vec<T>, String> {
        let source = fs::read_to_string(directory.join(&manifest.entrypoint))
            .map_err(|error| format!("could not load entrypoint: {error}"))?;
        let lua = Lua::new_with(
            StdLib::TABLE | StdLib::STRING | StdLib::MATH | StdLib::UTF8,
            LuaOptions::default(),
        )
        .map_err(|error| error.to_string())?;
        lua.set_memory_limit(self.memory_limit_bytes)
            .map_err(|error| error.to_string())?;
        let deadline = Instant::now() + self.timeout;
        let instructions = AtomicUsize::new(0);
        let instruction_limit = self.instruction_limit;
        lua.set_hook(
            HookTriggers::new().every_nth_instruction(100),
            move |_, _| {
                let executed = instructions.fetch_add(100, Ordering::Relaxed) + 100;
                if Instant::now() >= deadline {
                    return Err(LuaError::RuntimeError(
                        "plugin execution timed out".to_owned(),
                    ));
                }
                if executed > instruction_limit {
                    return Err(LuaError::RuntimeError(
                        "plugin instruction budget exceeded".to_owned(),
                    ));
                }
                Ok(VmState::Continue)
            },
        )
        .map_err(|error| error.to_string())?;
        install_host_services(&lua, manifest).map_err(|error| error.to_string())?;
        let module: Table = lua
            .load(&source)
            .eval()
            .map_err(|error| error.to_string())?;
        let function = module
            .get::<mlua::Function>(contribution)
            .map_err(|error| format!("malformed plugin result: {error}"))?;
        let value: mlua::Value = function.call(()).map_err(|error| error.to_string())?;
        lua.from_value(value)
            .map_err(|error| format!("malformed plugin result: {error}"))
    }

    fn ensure_enabled(&self, plugin_id: &str) -> Result<(), PluginRuntimeError> {
        self.disabled_reason(plugin_id).map_or(Ok(()), |reason| {
            Err(PluginRuntimeError::Disabled {
                plugin_id: plugin_id.to_owned(),
                reason,
            })
        })
    }

    fn reset_failures(&self, plugin_id: &str) {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .failures
            .remove(plugin_id);
    }

    fn record_failure(&self, plugin_id: &str, message: String) -> PluginRuntimeError {
        tracing::warn!(plugin_id, error = %message, "plugin call failed");
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let failure_count = {
            let failures = state.failures.entry(plugin_id.to_owned()).or_default();
            *failures = failures.saturating_add(1);
            *failures
        };
        let disabled = failure_count >= self.failure_limit;
        if disabled {
            state.disabled.insert(
                plugin_id.to_owned(),
                format!("disabled after {failure_count} consecutive failures: {message}"),
            );
        }
        let entries = state.logs.entry(plugin_id.to_owned()).or_default();
        entries.push_back(PluginLogEntry {
            plugin_id: plugin_id.to_owned(),
            message: message.clone(),
        });
        if entries.len() > MAX_LOG_ENTRIES {
            entries.pop_front();
        }
        PluginRuntimeError::Execution {
            plugin_id: plugin_id.to_owned(),
            message,
        }
    }
}

fn install_host_services(lua: &Lua, manifest: &PluginManifest) -> mlua::Result<()> {
    let host = lua.create_table()?;
    let permissions = manifest.permissions.clone();
    host.set(
        "selected_entry_metadata",
        lua.create_function(move |_, ()| {
            permissions
                .require(Permission::SelectedEntryMetadata)
                .map_err(|error| LuaError::RuntimeError(error.to_string()))
        })?,
    )?;
    lua.globals().set("host", host)
}

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
    directories: Vec<PathBuf>,
}

impl PluginDiscovery {
    /// Scans direct child directories of `directory` for `plugin.toml` manifests.
    #[must_use]
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directories: vec![directory.into()],
        }
    }

    /// Adds a read-only bundled plugin directory after the user plugin directory.
    #[must_use]
    pub fn with_bundled_directory(mut self, directory: impl Into<PathBuf>) -> Self {
        self.directories.push(directory.into());
        self
    }

    /// Returns valid and disabled plugin records in deterministic directory order.
    pub fn discover(&self) -> Vec<DiscoveredPlugin> {
        let mut plugins = self
            .directories
            .iter()
            .flat_map(|directory| discover_plugins(directory))
            .collect::<Vec<_>>();
        plugins.sort_by_key(DiscoveredPlugin::id);
        plugins
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

    #[test]
    fn executes_a_plugin_action_declaration_in_the_restricted_lua_runtime() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let plugin = temporary.path().join("copy-path");
        fs::create_dir(&plugin).expect("plugin directory");
        fs::write(
            plugin.join("plugin.toml"),
            "id='example.copy-path'\nname='Copy Path'\nversion='1'\napi_version='1'\ndescription='Copies a path'\nentrypoint='plugin.lua'\n[contributions]\nactions=true",
        )
        .expect("manifest");
        fs::write(
            plugin.join("plugin.lua"),
            "return { actions = function() return {{ id = 'example.copy-path.copy', title = 'Copy Path', description = 'Copies the selected path' }} end }",
        )
        .expect("script");

        let discovered = discover_plugins(temporary.path()).pop().expect("plugin");
        let manifest = discovered.manifest.expect("valid manifest");
        let runtime = PluginRuntime::default();

        let actions = runtime
            .actions(&manifest, &discovered.directory)
            .expect("actions");

        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].id, "example.copy-path.copy");
    }

    #[test]
    fn executes_a_plugin_column_declaration_in_the_restricted_lua_runtime() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        fs::write(
            temporary.path().join("plugin.lua"),
            "return { columns = function() return {{ id = 'sample.fileAge', title = 'Age' }} end }",
        )
        .expect("script");
        let manifest = PluginManifest::parse(
            "id='sample.file-age'\nname='File Age'\nversion='1'\napi_version='1'\ndescription='Shows file age'\nentrypoint='plugin.lua'\n[contributions]\ncolumns=true",
        )
        .expect("manifest");

        let columns = PluginRuntime::default()
            .columns(&manifest, temporary.path())
            .expect("columns");

        assert_eq!(columns[0].id, "sample.fileAge");
    }

    #[test]
    fn isolates_malformed_plugin_column_data() {
        let temporary =
            write_script("return { columns = function() return 'not a column list' end }");
        let manifest = PluginManifest::parse(
            "id='example.columns'\nname='Columns'\nversion='1'\napi_version='1'\ndescription='Columns'\nentrypoint='plugin.lua'\n[contributions]\ncolumns=true",
        )
        .expect("manifest");

        let error = PluginRuntime::default()
            .columns(&manifest, temporary.path())
            .expect_err("malformed columns");

        assert!(error.to_string().contains("malformed plugin result"));
    }

    fn manifest() -> PluginManifest {
        PluginManifest::parse("id='example.plugin'\nname='Example'\nversion='1'\napi_version='1'\ndescription='Example'\nentrypoint='plugin.lua'\n[contributions]\nactions=true")
            .expect("valid manifest")
    }

    fn write_script(source: &str) -> tempfile::TempDir {
        let temporary = tempfile::tempdir().expect("temporary directory");
        fs::write(temporary.path().join("plugin.lua"), source).expect("script");
        temporary
    }

    #[test]
    fn isolates_a_panicking_plugin_and_retains_its_log() {
        let temporary = write_script("error('boom')");
        let runtime = PluginRuntime::default();

        let error = runtime
            .actions(&manifest(), temporary.path())
            .expect_err("plugin failure");

        assert!(error.to_string().contains("example.plugin"));
        assert!(runtime.logs("example.plugin")[0].message.contains("boom"));
    }

    #[test]
    fn aborts_an_infinite_loop_without_disabling_the_host() {
        let temporary = write_script("while true do end");
        let runtime = PluginRuntime::new(Duration::from_millis(5), 1_000_000, 10_000, 3);

        let error = runtime
            .actions(&manifest(), temporary.path())
            .expect_err("loop timeout");

        assert!(error.to_string().contains("budget") || error.to_string().contains("timed out"));
        assert!(runtime.disabled_reason("example.plugin").is_none());
    }

    #[test]
    fn denies_an_undeclared_host_permission() {
        let temporary = write_script(
            "host.selected_entry_metadata()\nreturn { actions = function() return {} end }",
        );
        let runtime = PluginRuntime::default();

        let error = runtime
            .actions(&manifest(), temporary.path())
            .expect_err("permission denial");

        assert!(error.to_string().contains("permission denied"));
    }

    #[test]
    fn isolates_malformed_plugin_data() {
        let temporary =
            write_script("return { actions = function() return 'not an action list' end }");
        let runtime = PluginRuntime::default();

        let error = runtime
            .actions(&manifest(), temporary.path())
            .expect_err("malformed result");

        assert!(error.to_string().contains("malformed plugin result"));
    }

    #[test]
    fn repeatedly_failing_plugin_is_disabled_and_can_be_reenabled() {
        let temporary = write_script("error('boom')");
        let runtime = PluginRuntime::new(Duration::from_millis(100), 1_000_000, 10_000, 2);
        let manifest = manifest();

        runtime
            .actions(&manifest, temporary.path())
            .expect_err("first failure");
        runtime
            .actions(&manifest, temporary.path())
            .expect_err("second failure");

        assert!(runtime.disabled_reason("example.plugin").is_some());
        runtime.reenable("example.plugin");
        assert!(runtime.disabled_reason("example.plugin").is_none());
    }
}
