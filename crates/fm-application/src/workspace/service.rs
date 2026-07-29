//! `WorkspaceService`: workspace startup lifecycle and CRUD orchestration
//! (spec §5.3.7, task 0079).
//!
//! Semantic mutation commands (`WorkspaceCommand`/`apply_command`) and event
//! emission are task 0080/0081's concern; this service only owns the
//! create/load/list/delete lifecycle plus default-workspace startup
//! selection, on top of a [`WorkspaceRepository`].

use std::path::PathBuf;

use fm_domain::{Workspace, WorkspaceId};

use super::default_workspace::{default_workspace, resolve_home_directory};
use super::error::WorkspaceError;
use super::repository::{LastActiveWorkspaceStore, WorkspaceRepository, WorkspaceSummary};

/// Orchestrates workspace persistence and the startup lifecycle (spec
/// §5.3.7) on top of any `R` implementing both [`WorkspaceRepository`] and
/// [`LastActiveWorkspaceStore`].
pub struct WorkspaceService<R> {
    repository: R,
    home_directory: PathBuf,
    secondary_location: Option<PathBuf>,
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

    /// Creates, persists and selects a fresh default workspace (spec §5.3.7's
    /// "Default workspace").
    pub async fn create_default(&self) -> Result<Workspace, WorkspaceError> {
        let workspace = default_workspace(&self.home_directory, self.secondary_location.as_deref());
        validate_or_error(&workspace)?;

        let persisted = self.repository.save(&workspace, None).await?;
        self.repository
            .set_last_active_workspace_id(Some(persisted.id))
            .await?;
        Ok(persisted)
    }

    /// Deletes a workspace.
    pub async fn delete(
        &self,
        id: WorkspaceId,
        expected_revision: Option<u64>,
    ) -> Result<(), WorkspaceError> {
        self.repository.delete(id, expected_revision).await
    }

    /// Runs the startup lifecycle (spec §5.3.7 steps 1-4): select an
    /// explicitly requested workspace, otherwise the last-active one,
    /// otherwise create a default; a missing or corrupt selection is
    /// recovered from by substituting a fresh default rather than failing
    /// startup.
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
                Ok(workspace) => workspace,
                Err(WorkspaceError::NotFound { .. } | WorkspaceError::Corrupt { .. }) => {
                    self.create_default().await?
                }
                Err(error) => return Err(error),
            },
            None => self.create_default().await?,
        };

        self.repository
            .set_last_active_workspace_id(Some(workspace.id))
            .await?;

        Ok(workspace)
    }
}

fn validate_or_error(workspace: &Workspace) -> Result<(), WorkspaceError> {
    workspace.validate().map_err(WorkspaceError::Invalid)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

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
}
