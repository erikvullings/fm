//! Backend action registry (spec §18).
//!
//! Pure registration, lookup and availability-evaluation logic, independent
//! of any host. `FileManagerService::invoke_action` couples this registry's
//! availability check with dispatch to the operation engine for actions that
//! mutate files.

use std::collections::BTreeMap;

use fm_domain::{
    ActionContextRequirements, ActionDescriptor, ActionId, ActionInvocationContext, ActionSource,
    KeyChord,
};
use fm_platform::PlatformCapabilities;

use crate::error::ApplicationError;

/// Holds every registered action, keyed by its stable id.
///
/// A `BTreeMap` keeps [`ActionRegistry::list`] output in a stable,
/// deterministic order, which keeps OpenAPI examples and tests reproducible.
#[derive(Debug, Clone, Default)]
pub struct ActionRegistry {
    actions: BTreeMap<ActionId, ActionDescriptor>,
}

/// Registers an action under an id that is already taken.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("an action is already registered with id {0:?}")]
pub struct DuplicateActionId(pub ActionId);

impl ActionRegistry {
    /// Creates an empty registry.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a registry pre-populated with every core action (spec §18),
    /// plus the selection/navigation ids reserved by task 0028.
    ///
    /// `capabilities` is the injected [`fm_platform::PlatformAdapter`]'s
    /// reported capabilities (task 0061): `core.open`, `core.openWith`,
    /// `core.revealInSystemFileManager` and `core.openTerminal` derive their
    /// `feature_available` from it, the same way
    /// [`crate::FileManagerService::runtime_capabilities`] derives its DTO
    /// (task 0058) - so browser/server mode (an empty
    /// [`FallbackPlatformAdapter`](fm_platform::FallbackPlatformAdapter))
    /// reports these actions unavailable, not merely hidden (spec §22).
    #[must_use]
    pub fn with_core_actions(capabilities: PlatformCapabilities) -> Self {
        let mut registry = Self::new();
        for descriptor in core_actions(capabilities) {
            registry
                .register(descriptor)
                .expect("core action ids must be unique");
        }
        registry
    }

    /// Registers a new action, rejecting a duplicate id.
    pub fn register(&mut self, descriptor: ActionDescriptor) -> Result<(), DuplicateActionId> {
        if self.actions.contains_key(&descriptor.id) {
            return Err(DuplicateActionId(descriptor.id));
        }
        self.actions.insert(descriptor.id.clone(), descriptor);
        Ok(())
    }

    /// Looks up one action by id.
    #[must_use]
    pub fn get(&self, id: &ActionId) -> Option<&ActionDescriptor> {
        self.actions.get(id)
    }

    /// Lists every registered action in a stable order.
    #[must_use]
    pub fn list(&self) -> Vec<ActionDescriptor> {
        self.actions.values().cloned().collect()
    }

    /// Confirms `id` is registered and currently available for `context`,
    /// returning the matching descriptor. Never panics: an unknown or
    /// unavailable action is reported as a typed error (spec §18).
    pub fn require_available(
        &self,
        id: &ActionId,
        context: &ActionInvocationContext,
    ) -> Result<&ActionDescriptor, ApplicationError> {
        let descriptor = self
            .actions
            .get(id)
            .ok_or_else(|| ApplicationError::ActionNotFound(id.clone()))?;
        if !descriptor.context_requirements.is_satisfied_by(context) {
            return Err(ApplicationError::ActionUnavailable(id.clone()));
        }
        Ok(descriptor)
    }
}

fn core_action(
    id: &str,
    title: &str,
    category: &str,
    shortcuts: Vec<KeyChord>,
    context_requirements: ActionContextRequirements,
) -> ActionDescriptor {
    ActionDescriptor {
        id: ActionId::new(id),
        title: title.to_owned(),
        description: None,
        category: category.to_owned(),
        default_shortcuts: shortcuts,
        context_requirements,
        parameter_schema: None,
        source: ActionSource::Core,
    }
}

fn key(key: &str) -> KeyChord {
    KeyChord {
        key: key.to_owned(),
        ..KeyChord::default()
    }
}

fn primary(key: &str) -> KeyChord {
    KeyChord {
        key: key.to_owned(),
        ctrl: true,
        ..KeyChord::default()
    }
}

/// Requires exactly one selected entry, like [`ActionContextRequirements::single_selection`],
/// but with `feature_available` computed from the injected platform
/// adapter's capabilities (task 0061) rather than hardcoded `true`.
fn capability_gated_single_selection(feature_available: bool) -> ActionContextRequirements {
    ActionContextRequirements {
        feature_available,
        requires_selection: true,
        requires_single_selection: true,
    }
}

/// No selection requirement, like [`ActionContextRequirements::none`], but
/// with `feature_available` computed from the injected platform adapter's
/// capabilities (task 0061) rather than hardcoded `true`.
fn capability_gated_none(feature_available: bool) -> ActionContextRequirements {
    ActionContextRequirements {
        feature_available,
        requires_selection: false,
        requires_single_selection: false,
    }
}

/// Core actions named by spec §18, plus the selection/navigation ids
/// reserved by task 0028's frontend keybinding table.
///
/// `core.open`, `core.openWith`, `core.revealInSystemFileManager` and
/// `core.openTerminal` derive `feature_available` from `capabilities` (the
/// injected [`fm_platform::PlatformAdapter`]'s reported capabilities, task
/// 0061) rather than a permanent hardcoded value. `core.openWith` is tied to
/// the same [`PlatformCapabilities::OPEN_WITH_DEFAULT_APPLICATION`] flag as
/// `core.open`: no platform adapter exposes a distinct "choose application"
/// binding yet, so it currently behaves identically to `core.open` (opens
/// with the default application) - a documented gap, not silently
/// over-claimed. `core.copyPath` and `core.copyRelativePath` have no backend
/// feature yet (the system-clipboard/relative-path work tracked alongside
/// this task), so they stay registered as permanently unavailable.
fn core_actions(capabilities: PlatformCapabilities) -> Vec<ActionDescriptor> {
    let open_available = capabilities.contains(PlatformCapabilities::OPEN_WITH_DEFAULT_APPLICATION);
    let reveal_available = capabilities.contains(PlatformCapabilities::REVEAL_IN_FILE_MANAGER);
    let open_terminal_available = capabilities.contains(PlatformCapabilities::OPEN_TERMINAL);
    vec![
        core_action(
            "core.open",
            "Open",
            "fileOperations",
            vec![key("Enter")],
            capability_gated_single_selection(open_available),
        ),
        core_action(
            "core.parent",
            "Parent Directory",
            "navigation",
            vec![key("Backspace")],
            ActionContextRequirements::none(),
        ),
        core_action(
            "core.switchPane",
            "Switch Pane",
            "navigation",
            vec![
                key("Tab"),
                KeyChord {
                    key: "Tab".to_owned(),
                    shift: true,
                    ..KeyChord::default()
                },
            ],
            ActionContextRequirements::none(),
        ),
        core_action(
            "core.openWith",
            "Open With…",
            "fileOperations",
            Vec::new(),
            capability_gated_single_selection(open_available),
        ),
        core_action(
            "core.revealInSystemFileManager",
            "Reveal in File Manager",
            "fileOperations",
            Vec::new(),
            capability_gated_single_selection(reveal_available),
        ),
        core_action(
            "core.copy",
            "Copy",
            "fileOperations",
            vec![key("F5")],
            ActionContextRequirements::selection(),
        ),
        core_action(
            "core.move",
            "Move",
            "fileOperations",
            vec![key("F6")],
            ActionContextRequirements::selection(),
        ),
        core_action(
            "core.rename",
            "Rename",
            "fileOperations",
            vec![key("F2")],
            ActionContextRequirements::single_selection(),
        ),
        core_action(
            "core.delete",
            "Delete",
            "fileOperations",
            vec![key("F8"), key("Delete")],
            ActionContextRequirements::selection(),
        ),
        core_action(
            "core.createDirectory",
            "New Folder",
            "fileOperations",
            vec![key("F7")],
            ActionContextRequirements::none(),
        ),
        core_action(
            "core.paste",
            "Paste",
            "fileOperations",
            Vec::new(),
            ActionContextRequirements::none(),
        ),
        core_action(
            "core.refresh",
            "Refresh",
            "navigation",
            vec![primary("r")],
            ActionContextRequirements::none(),
        ),
        core_action(
            "core.palette",
            "Command Palette",
            "navigation",
            vec![primary("p")],
            ActionContextRequirements::unimplemented(),
        ),
        core_action(
            "core.focusLocation",
            "Focus Location",
            "navigation",
            vec![primary("l")],
            ActionContextRequirements::none(),
        ),
        core_action(
            "core.quickFilter",
            "Quick Filter",
            "navigation",
            vec![primary("f")],
            ActionContextRequirements::none(),
        ),
        core_action(
            "core.newTab",
            "New Tab",
            "navigation",
            vec![primary("t")],
            ActionContextRequirements::none(),
        ),
        core_action(
            "core.closeTab",
            "Close Tab",
            "navigation",
            vec![primary("w")],
            ActionContextRequirements::none(),
        ),
        core_action(
            "core.nextTab",
            "Next Tab",
            "navigation",
            vec![KeyChord {
                key: "Tab".to_owned(),
                ctrl: true,
                ..KeyChord::default()
            }],
            ActionContextRequirements::none(),
        ),
        core_action(
            "core.previousTab",
            "Previous Tab",
            "navigation",
            vec![KeyChord {
                key: "Tab".to_owned(),
                ctrl: true,
                shift: true,
                ..KeyChord::default()
            }],
            ActionContextRequirements::none(),
        ),
        core_action(
            "core.reopenClosedTab",
            "Reopen Closed Tab",
            "navigation",
            vec![KeyChord {
                key: "T".to_owned(),
                ctrl: true,
                shift: true,
                ..KeyChord::default()
            }],
            ActionContextRequirements::none(),
        ),
        core_action(
            "core.openTerminal",
            "Open Terminal Here",
            "tools",
            Vec::new(),
            capability_gated_none(open_terminal_available),
        ),
        core_action(
            "core.copyPath",
            "Copy Path",
            "clipboard",
            Vec::new(),
            ActionContextRequirements::unimplemented(),
        ),
        core_action(
            "core.copyRelativePath",
            "Copy Relative Path",
            "clipboard",
            Vec::new(),
            ActionContextRequirements::unimplemented(),
        ),
    ]
    .into_iter()
    .chain(selection_actions())
    .collect()
}

/// Selection/navigation ids reserved by task 0028
/// (`frontend/src/features/selection/keybindings.ts`'s
/// `CORE_SELECTION_ACTION_IDS`). Selection state lives entirely in the
/// frontend reducer, so these have no backend effect to gate; the registry
/// only carries their metadata for menus and the command palette.
fn selection_actions() -> Vec<ActionDescriptor> {
    [
        ("core.moveCursorUp", "Move Cursor Up", vec![key("ArrowUp")]),
        (
            "core.moveCursorDown",
            "Move Cursor Down",
            vec![key("ArrowDown")],
        ),
        (
            "core.moveCursorPageUp",
            "Move Cursor Page Up",
            vec![key("PageUp")],
        ),
        (
            "core.moveCursorPageDown",
            "Move Cursor Page Down",
            vec![key("PageDown")],
        ),
        (
            "core.moveCursorFirst",
            "Move Cursor to First",
            vec![key("Home")],
        ),
        (
            "core.moveCursorLast",
            "Move Cursor to Last",
            vec![key("End")],
        ),
        (
            "core.extendSelectionUp",
            "Extend Selection Up",
            vec![KeyChord {
                key: "ArrowUp".to_owned(),
                shift: true,
                ..KeyChord::default()
            }],
        ),
        (
            "core.extendSelectionDown",
            "Extend Selection Down",
            vec![KeyChord {
                key: "ArrowDown".to_owned(),
                shift: true,
                ..KeyChord::default()
            }],
        ),
        ("core.toggleSelection", "Toggle Selection", vec![key(" ")]),
        ("core.selectAll", "Select All", vec![primary("a")]),
        ("core.invertSelection", "Invert Selection", Vec::new()),
        (
            "core.clearSelection",
            "Clear Selection",
            vec![key("Escape")],
        ),
    ]
    .into_iter()
    .map(|(id, title, shortcuts)| {
        core_action(
            id,
            title,
            "selection",
            shortcuts,
            ActionContextRequirements::none(),
        )
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_descriptor(id: &str) -> ActionDescriptor {
        core_action(
            id,
            "Sample",
            "test",
            Vec::new(),
            ActionContextRequirements::none(),
        )
    }

    #[test]
    fn with_core_actions_registers_every_required_and_reserved_id() {
        let registry = ActionRegistry::with_core_actions(PlatformCapabilities::empty());
        let ids: Vec<String> = registry
            .list()
            .into_iter()
            .map(|action| action.id.as_str().to_owned())
            .collect();

        for expected in [
            "core.open",
            "core.parent",
            "core.switchPane",
            "core.openWith",
            "core.revealInSystemFileManager",
            "core.copy",
            "core.move",
            "core.rename",
            "core.delete",
            "core.createDirectory",
            "core.palette",
            "core.focusLocation",
            "core.quickFilter",
            "core.newTab",
            "core.closeTab",
            "core.nextTab",
            "core.previousTab",
            "core.reopenClosedTab",
            "core.openTerminal",
            "core.copyPath",
            "core.copyRelativePath",
            "core.moveCursorUp",
            "core.moveCursorDown",
            "core.moveCursorPageUp",
            "core.moveCursorPageDown",
            "core.moveCursorFirst",
            "core.moveCursorLast",
            "core.extendSelectionUp",
            "core.extendSelectionDown",
            "core.toggleSelection",
            "core.selectAll",
            "core.invertSelection",
            "core.clearSelection",
        ] {
            assert!(ids.iter().any(|id| id == expected), "missing {expected}");
        }
    }

    #[test]
    fn features_without_an_implementation_are_registered_as_unavailable() {
        let registry = ActionRegistry::with_core_actions(PlatformCapabilities::empty());
        let context = ActionInvocationContext::default();
        for id in ["core.copyPath", "core.copyRelativePath"] {
            let action_id = ActionId::new(id);
            let error = registry
                .require_available(&action_id, &context)
                .expect_err("unimplemented actions must report unavailable");
            assert_eq!(error, ApplicationError::ActionUnavailable(action_id));
        }
    }

    #[test]
    fn capability_gated_actions_are_unavailable_when_the_adapter_reports_no_capabilities() {
        let registry = ActionRegistry::with_core_actions(PlatformCapabilities::empty());
        let mut context = ActionInvocationContext::default();
        context.selected_entry_ids.push(fm_domain::EntryId::new());
        for id in [
            "core.open",
            "core.openWith",
            "core.revealInSystemFileManager",
        ] {
            let action_id = ActionId::new(id);
            let error = registry
                .require_available(&action_id, &context)
                .expect_err("a capability-gated action must be unavailable without the capability");
            assert_eq!(error, ApplicationError::ActionUnavailable(action_id));
        }
        let action_id = ActionId::new("core.openTerminal");
        let error = registry
            .require_available(&action_id, &ActionInvocationContext::default())
            .expect_err("openTerminal must be unavailable without OPEN_TERMINAL");
        assert_eq!(error, ApplicationError::ActionUnavailable(action_id));
    }

    #[test]
    fn capability_gated_actions_are_available_when_the_adapter_reports_the_matching_capability() {
        let registry = ActionRegistry::with_core_actions(
            PlatformCapabilities::OPEN_WITH_DEFAULT_APPLICATION
                | PlatformCapabilities::REVEAL_IN_FILE_MANAGER
                | PlatformCapabilities::OPEN_TERMINAL,
        );
        let mut single_selection = ActionInvocationContext::default();
        single_selection
            .selected_entry_ids
            .push(fm_domain::EntryId::new());
        for id in [
            "core.open",
            "core.openWith",
            "core.revealInSystemFileManager",
        ] {
            let action_id = ActionId::new(id);
            registry
                .require_available(&action_id, &single_selection)
                .expect("the capability is granted and exactly one entry is selected");
        }
        registry
            .require_available(
                &ActionId::new("core.openTerminal"),
                &ActionInvocationContext::default(),
            )
            .expect("openTerminal has no selection requirement");
    }

    #[test]
    fn capability_gating_is_independent_per_action() {
        // Only OPEN_TERMINAL is granted: core.open/openWith/reveal must stay
        // unavailable even though *some* platform capability is present, so
        // gating isn't accidentally coarse-grained to "any capability at all".
        let registry = ActionRegistry::with_core_actions(PlatformCapabilities::OPEN_TERMINAL);
        let mut single_selection = ActionInvocationContext::default();
        single_selection
            .selected_entry_ids
            .push(fm_domain::EntryId::new());
        for id in [
            "core.open",
            "core.openWith",
            "core.revealInSystemFileManager",
        ] {
            let action_id = ActionId::new(id);
            let error = registry
                .require_available(&action_id, &single_selection)
                .expect_err("must not be granted by an unrelated capability");
            assert_eq!(error, ApplicationError::ActionUnavailable(action_id));
        }
        registry
            .require_available(
                &ActionId::new("core.openTerminal"),
                &ActionInvocationContext::default(),
            )
            .expect("OPEN_TERMINAL was granted");
    }

    #[test]
    fn register_rejects_a_duplicate_id() {
        let mut registry = ActionRegistry::new();
        registry
            .register(sample_descriptor("test.sample"))
            .expect("first registration must succeed");

        let error = registry
            .register(sample_descriptor("test.sample"))
            .expect_err("duplicate id must be rejected");
        assert_eq!(error, DuplicateActionId(ActionId::new("test.sample")));
    }

    #[test]
    fn require_available_reports_unknown_actions_without_panicking() {
        let registry = ActionRegistry::new();
        let context = ActionInvocationContext::default();
        let error = registry
            .require_available(&ActionId::new("does.not.exist"), &context)
            .expect_err("an unregistered action must be reported, not panic");
        assert_eq!(
            error,
            ApplicationError::ActionNotFound(ActionId::new("does.not.exist"))
        );
    }

    #[test]
    fn require_available_re_validates_context_requirements() {
        let mut registry = ActionRegistry::new();
        registry
            .register(core_action(
                "test.needsSelection",
                "Needs Selection",
                "test",
                Vec::new(),
                ActionContextRequirements::selection(),
            ))
            .expect("registration must succeed");
        let action_id = ActionId::new("test.needsSelection");

        let empty_context = ActionInvocationContext::default();
        assert_eq!(
            registry
                .require_available(&action_id, &empty_context)
                .expect_err("no selection must be rejected"),
            ApplicationError::ActionUnavailable(action_id.clone())
        );

        let mut selected_context = ActionInvocationContext::default();
        selected_context
            .selected_entry_ids
            .push(fm_domain::EntryId::new());
        assert!(
            registry
                .require_available(&action_id, &selected_context)
                .is_ok()
        );
    }
}
