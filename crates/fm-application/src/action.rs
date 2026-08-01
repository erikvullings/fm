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
    #[must_use]
    pub fn with_core_actions() -> Self {
        let mut registry = Self::new();
        for descriptor in core_actions() {
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

/// Core actions named by spec §18, plus the selection/navigation ids
/// reserved by task 0028's frontend keybinding table.
///
/// `core.open`, `core.openWith`, `core.openTerminal`, `core.copyPath` and
/// `core.copyRelativePath` have no backend feature yet (tasks 0061 and the
/// system-clipboard/relative-path work tracked alongside it), so they are
/// registered as unavailable rather than omitted.
fn core_actions() -> Vec<ActionDescriptor> {
    vec![
        core_action(
            "core.open",
            "Open",
            "fileOperations",
            vec![key("Enter")],
            ActionContextRequirements::unimplemented(),
        ),
        core_action(
            "core.openWith",
            "Open With…",
            "fileOperations",
            Vec::new(),
            ActionContextRequirements::unimplemented(),
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
            vec![key("F8")],
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
            "core.openTerminal",
            "Open Terminal Here",
            "tools",
            Vec::new(),
            ActionContextRequirements::unimplemented(),
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
        ("core.moveCursorUp", "Move Cursor Up"),
        ("core.moveCursorDown", "Move Cursor Down"),
        ("core.moveCursorPageUp", "Move Cursor Page Up"),
        ("core.moveCursorPageDown", "Move Cursor Page Down"),
        ("core.moveCursorFirst", "Move Cursor to First"),
        ("core.moveCursorLast", "Move Cursor to Last"),
        ("core.extendSelectionUp", "Extend Selection Up"),
        ("core.extendSelectionDown", "Extend Selection Down"),
        ("core.toggleSelection", "Toggle Selection"),
        ("core.selectAll", "Select All"),
        ("core.invertSelection", "Invert Selection"),
        ("core.clearSelection", "Clear Selection"),
    ]
    .into_iter()
    .map(|(id, title)| {
        core_action(
            id,
            title,
            "selection",
            Vec::new(),
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
        let registry = ActionRegistry::with_core_actions();
        let ids: Vec<String> = registry
            .list()
            .into_iter()
            .map(|action| action.id.as_str().to_owned())
            .collect();

        for expected in [
            "core.open",
            "core.openWith",
            "core.copy",
            "core.move",
            "core.rename",
            "core.delete",
            "core.createDirectory",
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
        let registry = ActionRegistry::with_core_actions();
        let context = ActionInvocationContext::default();
        for id in [
            "core.open",
            "core.openWith",
            "core.openTerminal",
            "core.copyPath",
            "core.copyRelativePath",
        ] {
            let action_id = ActionId::new(id);
            let error = registry
                .require_available(&action_id, &context)
                .expect_err("unimplemented actions must report unavailable");
            assert_eq!(error, ApplicationError::ActionUnavailable(action_id));
        }
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
