//! `WorkspaceService`: workspace startup lifecycle, CRUD orchestration and
//! semantic mutation commands (spec §5.3.7, §5.3.9, tasks 0079, 0080).

use std::path::PathBuf;

use fm_domain::{Workspace, WorkspaceCommand, WorkspaceId};

use super::command;
use super::default_workspace::{default_workspace, resolve_home_directory};
use super::error::WorkspaceError;
use super::events;
use super::publisher::{NoopWorkspaceCommandPublisher, WorkspaceCommandPublisher};
use super::repository::{LastActiveWorkspaceStore, WorkspaceRepository, WorkspaceSummary};

/// Orchestrates workspace persistence, the startup lifecycle (spec §5.3.7)
/// and semantic mutation commands (spec §5.3.9) on top of any `R`
/// implementing both [`WorkspaceRepository`] and [`LastActiveWorkspaceStore`].
pub struct WorkspaceService<R> {
    repository: R,
    home_directory: PathBuf,
    secondary_location: Option<PathBuf>,
    publisher: Box<dyn WorkspaceCommandPublisher>,
}

impl<R> WorkspaceService<R>
where
    R: WorkspaceRepository + LastActiveWorkspaceStore,
{
    /// Builds a service backed by `repository`, resolving the home directory
    /// through the platform seam (spec §5.3.7) rather than a hard-coded path.
    pub fn new(repository: R) -> Self {
        Self {
            repository,
            home_directory: resolve_home_directory(),
            secondary_location: None,
            publisher: Box::new(NoopWorkspaceCommandPublisher),
        }
    }

    /// Overrides the second pane's initial location for newly created
    /// default workspaces (spec §5.3.7's "or a configured secondary location
    /// for the right pane").
    #[must_use]
    pub fn with_secondary_location(mut self, secondary_location: PathBuf) -> Self {
        self.secondary_location = Some(secondary_location);
        self
    }

    /// Overrides the publisher notified after every successful
    /// [`WorkspaceCommand`] (spec §5.3.9 step 7). Defaults to a no-op until a
    /// host wires in the real event bus (task 0081).
    #[must_use]
    pub fn with_publisher(mut self, publisher: impl WorkspaceCommandPublisher + 'static) -> Self {
        self.publisher = Box::new(publisher);
        self
    }

    /// Lists every stored workspace as a lightweight summary.
    pub async fn list(&self) -> Result<Vec<WorkspaceSummary>, WorkspaceError> {
        self.repository.list().await
    }

    /// Loads and validates a single workspace by id.
    pub async fn load(&self, id: WorkspaceId) -> Result<Workspace, WorkspaceError> {
        let workspace = self
            .repository
            .load(id)
            .await?
            .ok_or(WorkspaceError::NotFound { id })?;
        validate_or_error(&workspace)?;
        Ok(workspace)
    }

    /// Creates and persists a fresh workspace shaped like the default
    /// workspace (spec §5.3.7's "Default workspace"), optionally overriding
    /// its name. Does not mark it as the last-active workspace; callers
    /// wanting that should call [`WorkspaceService::open`] afterwards.
    pub async fn create(&self, name: Option<String>) -> Result<Workspace, WorkspaceError> {
        let mut workspace =
            default_workspace(&self.home_directory, self.secondary_location.as_deref());
        if let Some(name) = name {
            workspace.name = name;
        }
        validate_or_error(&workspace)?;
        let persisted = self.repository.save(&workspace, None).await?;
        self.publisher
            .publish(persisted.id, events::workspace_created(&persisted));
        Ok(persisted)
    }

    /// Creates, persists and selects a fresh default workspace (spec §5.3.7's
    /// "Default workspace"), emitting both `workspace.created` and
    /// `workspace.opened` (creating a workspace this way always also selects
    /// it as active).
    pub async fn create_default(&self) -> Result<Workspace, WorkspaceError> {
        let persisted = self.create(None).await?;
        self.repository
            .set_last_active_workspace_id(Some(persisted.id))
            .await?;
        self.publisher
            .publish(persisted.id, events::workspace_opened(&persisted));
        Ok(persisted)
    }

    /// Deletes a workspace.
    pub async fn delete(
        &self,
        id: WorkspaceId,
        expected_revision: Option<u64>,
    ) -> Result<(), WorkspaceError> {
        // A corrupt or already-vanished workspace can still be deleted; only
        // the event's revision field defaults to 0 in that edge case, not
        // the deletion's own revision-conflict check below.
        let revision = self
            .repository
            .load(id)
            .await
            .ok()
            .flatten()
            .map(|workspace| workspace.revision)
            .unwrap_or_default();

        self.repository.delete(id, expected_revision).await?;
        self.publisher
            .publish(id, events::workspace_deleted(revision));
        Ok(())
    }

    /// Selects an existing workspace as the last-active workspace and
    /// returns its current projection (spec §5.3.12's `openWorkspace`).
    ///
    /// Unlike [`WorkspaceService::start`], a missing or corrupt workspace is
    /// reported rather than silently replaced with a fresh default: that
    /// recovery behaviour is specific to application startup, not to an
    /// explicit request to open a named workspace.
    pub async fn open(&self, id: WorkspaceId) -> Result<Workspace, WorkspaceError> {
        let previous_active_id = self.repository.last_active_workspace_id().await?;

        let workspace = self.load(id).await?;
        self.repository
            .set_last_active_workspace_id(Some(id))
            .await?;

        if let Some(previous_id) = previous_active_id
            && previous_id != id
            && let Ok(Some(previous)) = self.repository.load(previous_id).await
        {
            self.publisher
                .publish(previous_id, events::workspace_closed(previous.revision));
        }
        self.publisher
            .publish(workspace.id, events::workspace_opened(&workspace));

        Ok(workspace)
    }

    /// Applies a semantic mutation command (spec §5.3.9): verifies the
    /// expected revision, validates and applies the mutation, persists the
    /// result (which increments the revision) and notifies the configured
    /// publisher with the focused event describing the change, returning the
    /// changed projection.
    ///
    /// Runtime-session updates (spec §5.3.9 step 6) are deferred: no
    /// runtime-session concept exists yet.
    pub async fn apply_command(
        &self,
        command: WorkspaceCommand,
    ) -> Result<Workspace, WorkspaceError> {
        let workspace_id = command.workspace_id();
        let expected_revision = command.expected_revision();

        let mut workspace = self.load(workspace_id).await?;
        if workspace.revision != expected_revision {
            return Err(WorkspaceError::RevisionConflict {
                id: workspace_id,
                expected: Some(expected_revision),
                actual: workspace.revision,
            });
        }

        command::apply(&mut workspace, command.clone(), &self.home_directory)?;

        let persisted = self
            .repository
            .save(&workspace, Some(expected_revision))
            .await?;

        let event = events::command_event(&command, &persisted)?;
        self.publisher.publish(persisted.id, event);

        Ok(persisted)
    }

    /// Runs the startup lifecycle (spec §5.3.7 steps 1-4): select an
    /// explicitly requested workspace, otherwise the last-active one,
    /// otherwise create a default; a missing or corrupt selection is
    /// recovered from by substituting a fresh default rather than failing
    /// startup. Emits `workspace.opened` (spec §5.3.7 step 8) exactly once:
    /// [`WorkspaceService::create_default`] already emits it when a fresh
    /// default is selected, so this only emits it itself when reselecting an
    /// existing workspace.
    pub async fn start(
        &self,
        requested_workspace_id: Option<WorkspaceId>,
    ) -> Result<Workspace, WorkspaceError> {
        let selected_id = match requested_workspace_id {
            Some(id) => Some(id),
            None => self.repository.last_active_workspace_id().await?,
        };

        let workspace = match selected_id {
            Some(id) => match self.load(id).await {
                Ok(workspace) => {
                    self.repository
                        .set_last_active_workspace_id(Some(workspace.id))
                        .await?;
                    self.publisher
                        .publish(workspace.id, events::workspace_opened(&workspace));
                    workspace
                }
                Err(WorkspaceError::NotFound { .. } | WorkspaceError::Corrupt { .. }) => {
                    self.create_default().await?
                }
                Err(error) => return Err(error),
            },
            None => self.create_default().await?,
        };

        Ok(workspace)
    }
}

fn validate_or_error(workspace: &Workspace) -> Result<(), WorkspaceError> {
    workspace.validate().map_err(WorkspaceError::Invalid)
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    use fm_domain::{Location, PaneId, ProviderId};
    use fm_events::BackendEventPayload;

    use super::super::memory::InMemoryWorkspaceRepository;
    use super::*;

    fn service() -> WorkspaceService<InMemoryWorkspaceRepository> {
        WorkspaceService::new(InMemoryWorkspaceRepository::new())
            .with_secondary_location(PathBuf::from("/Users/erik/Downloads"))
    }

    #[tokio::test]
    async fn start_with_no_stored_workspace_creates_a_valid_default() {
        let service = service();

        let workspace = service.start(None).await.expect("start must succeed");

        assert_eq!(workspace.name, "Default");
        assert_eq!(workspace.panes.len(), 2);
        assert!(workspace.validate().is_ok());
        assert_eq!(service.list().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn start_reselects_the_last_active_workspace_on_a_second_call() {
        let service = service();
        let first_start = service.start(None).await.expect("first start must succeed");

        // A second "restart" with no explicit request must reselect the same
        // workspace rather than creating another default.
        let second_start = service
            .start(None)
            .await
            .expect("second start must succeed");

        assert_eq!(first_start.id, second_start.id);
        assert_eq!(service.list().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn start_honours_an_explicitly_requested_workspace_id() {
        let service = service();
        let default_workspace = service.start(None).await.expect("start must succeed");

        let explicit = default_workspace_service_second_workspace(&service).await;

        let selected = service
            .start(Some(explicit.id))
            .await
            .expect("start with an explicit id must succeed");
        assert_eq!(selected.id, explicit.id);
        assert_ne!(selected.id, default_workspace.id);
    }

    async fn default_workspace_service_second_workspace(
        service: &WorkspaceService<InMemoryWorkspaceRepository>,
    ) -> Workspace {
        // Build a second, distinct workspace directly through the repository
        // to exercise "explicitly requested" selection.
        let mut workspace = default_workspace(Path::new("/Users/erik"), None);
        workspace.name = "Photos".to_owned();
        service.repository.save(&workspace, None).await.unwrap()
    }

    #[tokio::test]
    async fn start_recovers_from_a_missing_last_active_workspace_by_creating_a_default() {
        let service = service();
        service
            .repository
            .set_last_active_workspace_id(Some(WorkspaceId::new()))
            .await
            .unwrap();

        let workspace = service
            .start(None)
            .await
            .expect("start must recover, not fail");
        assert_eq!(workspace.name, "Default");
    }

    #[tokio::test]
    async fn load_returns_not_found_for_an_unknown_id() {
        let service = service();
        let error = service.load(WorkspaceId::new()).await.unwrap_err();
        assert!(matches!(error, WorkspaceError::NotFound { .. }));
    }

    #[tokio::test]
    async fn start_recovers_from_a_corrupt_last_active_workspace_file_by_creating_a_default() {
        use super::super::persistent::JsonFileWorkspaceRepository;

        let dir = tempfile::TempDir::new().expect("temp dir");
        let repository = JsonFileWorkspaceRepository::new(dir.path());
        let service = WorkspaceService::new(repository);
        let original = service.create_default().await.expect("create must succeed");

        std::fs::write(
            dir.path().join(format!("{}.json", original.id)),
            b"{ not json",
        )
        .expect("overwrite with corrupt bytes");

        let workspace = service
            .start(None)
            .await
            .expect("start must recover from a corrupt file, not fail");
        assert_eq!(workspace.name, "Default");
        assert_ne!(workspace.id, original.id);
    }

    #[tokio::test]
    async fn delete_removes_a_workspace() {
        let service = service();
        let workspace = service.create_default().await.unwrap();

        service
            .delete(workspace.id, Some(workspace.revision))
            .await
            .expect("delete must succeed");
        assert!(matches!(
            service.load(workspace.id).await.unwrap_err(),
            WorkspaceError::NotFound { .. }
        ));
    }

    #[tokio::test]
    async fn create_persists_a_named_workspace_without_marking_it_last_active() {
        let service = service();

        let workspace = service
            .create(Some("Photos".to_owned()))
            .await
            .expect("create must succeed");

        assert_eq!(workspace.name, "Photos");
        assert!(
            service
                .repository
                .last_active_workspace_id()
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn open_selects_an_existing_workspace_as_last_active() {
        let service = service();
        let workspace = service.create(None).await.unwrap();

        let opened = service.open(workspace.id).await.expect("open must succeed");

        assert_eq!(opened.id, workspace.id);
        assert_eq!(
            service.repository.last_active_workspace_id().await.unwrap(),
            Some(workspace.id)
        );
    }

    #[tokio::test]
    async fn open_reports_not_found_rather_than_substituting_a_default() {
        let service = service();

        let error = service.open(WorkspaceId::new()).await.unwrap_err();

        assert!(matches!(error, WorkspaceError::NotFound { .. }));
    }

    #[tokio::test]
    async fn apply_command_renames_the_workspace_and_increments_the_revision() {
        let service = service();
        let workspace = service.create_default().await.unwrap();

        let renamed = service
            .apply_command(WorkspaceCommand::RenameWorkspace {
                workspace_id: workspace.id,
                name: "Photos".to_owned(),
                expected_revision: workspace.revision,
            })
            .await
            .expect("apply_command must succeed");

        assert_eq!(renamed.name, "Photos");
        assert_eq!(renamed.revision, workspace.revision + 1);
    }

    #[tokio::test]
    async fn apply_command_reports_a_stale_expected_revision_as_a_conflict() {
        let service = service();
        let workspace = service.create_default().await.unwrap();

        let error = service
            .apply_command(WorkspaceCommand::RenameWorkspace {
                workspace_id: workspace.id,
                name: "Photos".to_owned(),
                expected_revision: workspace.revision + 1,
            })
            .await
            .unwrap_err();

        assert_eq!(
            error,
            WorkspaceError::RevisionConflict {
                id: workspace.id,
                expected: Some(workspace.revision + 1),
                actual: workspace.revision,
            }
        );
    }

    #[tokio::test]
    async fn apply_command_closing_a_panes_last_tab_creates_a_replacement() {
        let service = service();
        let workspace = service.create_default().await.unwrap();
        let pane_id = workspace.active_pane_id;
        let tab_id = workspace
            .panes
            .iter()
            .find(|pane| pane.id == pane_id)
            .unwrap()
            .tabs[0]
            .id;

        let mutated = service
            .apply_command(WorkspaceCommand::CloseTab {
                workspace_id: workspace.id,
                pane_id,
                tab_id,
                expected_revision: workspace.revision,
            })
            .await
            .expect("apply_command must succeed");

        let pane = mutated
            .panes
            .iter()
            .find(|pane| pane.id == pane_id)
            .unwrap();
        assert_eq!(pane.tabs.len(), 1);
        assert_ne!(pane.tabs[0].id, tab_id);
    }

    #[tokio::test]
    async fn apply_command_rejects_an_unknown_pane() {
        let service = service();
        let workspace = service.create_default().await.unwrap();

        let error = service
            .apply_command(WorkspaceCommand::SetActivePane {
                workspace_id: workspace.id,
                pane_id: PaneId::new(),
                expected_revision: workspace.revision,
            })
            .await
            .unwrap_err();

        assert!(matches!(error, WorkspaceError::PaneNotFound { .. }));
    }

    #[tokio::test]
    async fn apply_command_notifies_the_configured_publisher() {
        #[derive(Default)]
        struct RecordingPublisher {
            events: Mutex<Vec<(WorkspaceId, BackendEventPayload)>>,
        }

        impl WorkspaceCommandPublisher for Arc<RecordingPublisher> {
            fn publish(&self, workspace_id: WorkspaceId, payload: BackendEventPayload) {
                self.events
                    .lock()
                    .expect("mutex must not be poisoned")
                    .push((workspace_id, payload));
            }
        }

        let publisher = Arc::new(RecordingPublisher::default());
        let service = WorkspaceService::new(InMemoryWorkspaceRepository::new())
            .with_secondary_location(PathBuf::from("/Users/erik/Downloads"))
            .with_publisher(Arc::clone(&publisher));
        let workspace = service.create_default().await.unwrap();

        service
            .apply_command(WorkspaceCommand::RenameWorkspace {
                workspace_id: workspace.id,
                name: "Photos".to_owned(),
                expected_revision: workspace.revision,
            })
            .await
            .expect("apply_command must succeed");

        let events = publisher.events.lock().expect("mutex must not be poisoned");
        let (workspace_id, payload) = events.last().expect("a rename event must be published");
        assert_eq!(*workspace_id, workspace.id);
        assert_eq!(
            *payload,
            BackendEventPayload::WorkspaceRenamed {
                revision: workspace.revision + 1,
                name: "Photos".to_owned(),
            }
        );
    }

    #[tokio::test]
    async fn create_publishes_workspace_created() {
        #[derive(Default)]
        struct RecordingPublisher {
            events: Mutex<Vec<(WorkspaceId, BackendEventPayload)>>,
        }

        impl WorkspaceCommandPublisher for Arc<RecordingPublisher> {
            fn publish(&self, workspace_id: WorkspaceId, payload: BackendEventPayload) {
                self.events
                    .lock()
                    .expect("mutex must not be poisoned")
                    .push((workspace_id, payload));
            }
        }

        let publisher = Arc::new(RecordingPublisher::default());
        let service = WorkspaceService::new(InMemoryWorkspaceRepository::new())
            .with_publisher(Arc::clone(&publisher));

        let workspace = service.create(None).await.expect("create must succeed");

        let events = publisher.events.lock().expect("mutex must not be poisoned");
        assert_eq!(
            *events,
            vec![(
                workspace.id,
                BackendEventPayload::WorkspaceCreated {
                    revision: workspace.revision,
                }
            )]
        );
    }

    #[tokio::test]
    async fn create_default_publishes_created_then_opened() {
        #[derive(Default)]
        struct RecordingPublisher {
            events: Mutex<Vec<(WorkspaceId, BackendEventPayload)>>,
        }

        impl WorkspaceCommandPublisher for Arc<RecordingPublisher> {
            fn publish(&self, workspace_id: WorkspaceId, payload: BackendEventPayload) {
                self.events
                    .lock()
                    .expect("mutex must not be poisoned")
                    .push((workspace_id, payload));
            }
        }

        let publisher = Arc::new(RecordingPublisher::default());
        let service = WorkspaceService::new(InMemoryWorkspaceRepository::new())
            .with_publisher(Arc::clone(&publisher));

        let workspace = service
            .create_default()
            .await
            .expect("create_default must succeed");

        let events = publisher.events.lock().expect("mutex must not be poisoned");
        assert_eq!(
            *events,
            vec![
                (
                    workspace.id,
                    BackendEventPayload::WorkspaceCreated {
                        revision: workspace.revision,
                    }
                ),
                (
                    workspace.id,
                    BackendEventPayload::WorkspaceOpened {
                        revision: workspace.revision,
                    }
                ),
            ]
        );
    }

    #[tokio::test]
    async fn delete_publishes_workspace_deleted_with_the_pre_deletion_revision() {
        #[derive(Default)]
        struct RecordingPublisher {
            events: Mutex<Vec<(WorkspaceId, BackendEventPayload)>>,
        }

        impl WorkspaceCommandPublisher for Arc<RecordingPublisher> {
            fn publish(&self, workspace_id: WorkspaceId, payload: BackendEventPayload) {
                self.events
                    .lock()
                    .expect("mutex must not be poisoned")
                    .push((workspace_id, payload));
            }
        }

        let publisher = Arc::new(RecordingPublisher::default());
        let service = WorkspaceService::new(InMemoryWorkspaceRepository::new())
            .with_publisher(Arc::clone(&publisher));
        let workspace = service.create_default().await.unwrap();

        service
            .delete(workspace.id, Some(workspace.revision))
            .await
            .expect("delete must succeed");

        let events = publisher.events.lock().expect("mutex must not be poisoned");
        assert_eq!(
            events.last(),
            Some(&(
                workspace.id,
                BackendEventPayload::WorkspaceDeleted {
                    revision: workspace.revision,
                }
            ))
        );
    }

    #[tokio::test]
    async fn open_publishes_closed_for_the_previous_workspace_then_opened_for_the_new_one() {
        #[derive(Default)]
        struct RecordingPublisher {
            events: Mutex<Vec<(WorkspaceId, BackendEventPayload)>>,
        }

        impl WorkspaceCommandPublisher for Arc<RecordingPublisher> {
            fn publish(&self, workspace_id: WorkspaceId, payload: BackendEventPayload) {
                self.events
                    .lock()
                    .expect("mutex must not be poisoned")
                    .push((workspace_id, payload));
            }
        }

        let publisher = Arc::new(RecordingPublisher::default());
        let service = WorkspaceService::new(InMemoryWorkspaceRepository::new())
            .with_publisher(Arc::clone(&publisher));
        let first = service.create_default().await.unwrap();
        let second = service.create(None).await.unwrap();

        publisher
            .events
            .lock()
            .expect("mutex must not be poisoned")
            .clear();

        let opened = service.open(second.id).await.expect("open must succeed");

        let events = publisher.events.lock().expect("mutex must not be poisoned");
        assert_eq!(
            *events,
            vec![
                (
                    first.id,
                    BackendEventPayload::WorkspaceClosed {
                        revision: first.revision,
                    }
                ),
                (
                    second.id,
                    BackendEventPayload::WorkspaceOpened {
                        revision: opened.revision,
                    }
                ),
            ]
        );
    }

    #[tokio::test]
    async fn apply_command_add_tab_uses_the_given_location() {
        let service = service();
        let workspace = service.create_default().await.unwrap();
        let pane_id = workspace.active_pane_id;

        let mutated = service
            .apply_command(WorkspaceCommand::AddTab {
                workspace_id: workspace.id,
                pane_id,
                location: Location::new(ProviderId::new("file"), "file:///Users/erik/Music"),
                expected_revision: workspace.revision,
            })
            .await
            .expect("apply_command must succeed");

        let pane = mutated
            .panes
            .iter()
            .find(|pane| pane.id == pane_id)
            .unwrap();
        assert_eq!(pane.tabs.len(), 2);
        assert_eq!(pane.tabs[1].location.uri, "file:///Users/erik/Music");
    }
}
