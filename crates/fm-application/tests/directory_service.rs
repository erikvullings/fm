//! Integration coverage for authoritative directory listing behavior.

use std::sync::Arc;

use fm_application::DirectoryService;
use fm_domain::{Location, PaneId};
use fm_transport_dto::{ListDirectoryRequest, LocationDto, SortDescriptorDto, SortDirectionDto};
use fm_vfs::ProviderRegistry;
use fm_vfs_local::LocalFileSystemProvider;
use uuid::Uuid;

fn service() -> DirectoryService {
    let mut providers = ProviderRegistry::new();
    providers.register(Arc::new(LocalFileSystemProvider));
    DirectoryService::new(providers)
}

fn request(pane_id: PaneId, location: &Location) -> ListDirectoryRequest {
    ListDirectoryRequest {
        pane_id: pane_id.into(),
        request_id: Uuid::new_v4(),
        location: LocationDto::from(location.clone()),
        continuation_token: None,
        sort: Vec::new(),
        show_hidden: true,
        folders_first: false,
    }
}

#[tokio::test]
async fn listing_a_directory_produces_a_loaded_snapshot_for_the_request() {
    let root = tempfile::tempdir().expect("must create a temp directory");
    std::fs::write(root.path().join("report.txt"), b"contents").expect("must create fixture");
    let location =
        Location::from_native_path(root.path()).expect("temp path must be representable");
    let pane_id = PaneId::new();
    let request = request(pane_id, &location);
    let request_id = request.request_id;

    let snapshot = service().list(request).await.expect("listing must succeed");

    assert_eq!(snapshot.pane_id, pane_id);
    assert_eq!(snapshot.request_id, request_id);
    assert_eq!(snapshot.revision, 1);
    assert_eq!(snapshot.location, location);
    assert_eq!(snapshot.entries.len(), 1);
    assert_eq!(snapshot.entries[0].name, "report.txt");
    assert!(!snapshot.has_more);
    assert!(snapshot.continuation_token.is_none());
    assert_eq!(snapshot.loading_state, fm_domain::LoadingState::Loaded);
}

#[tokio::test]
async fn successful_snapshots_have_monotonic_revisions_per_pane() {
    let root = tempfile::tempdir().expect("must create a temp directory");
    let location =
        Location::from_native_path(root.path()).expect("temp path must be representable");
    let pane_id = PaneId::new();
    let service = service();

    let first = service
        .list(request(pane_id, &location))
        .await
        .expect("first listing must succeed");
    let second = service
        .list(request(pane_id, &location))
        .await
        .expect("second listing must succeed");

    assert_eq!(first.revision, 1);
    assert_eq!(second.revision, 2);
}

#[tokio::test]
async fn listing_filters_hidden_entries_and_sorts_folders_first_then_by_name() {
    let root = tempfile::tempdir().expect("must create a temp directory");
    std::fs::write(root.path().join(".hidden"), b"hidden").expect("must create fixture");
    std::fs::write(root.path().join("zeta.txt"), b"zeta").expect("must create fixture");
    std::fs::create_dir(root.path().join("beta")).expect("must create fixture directory");
    std::fs::create_dir(root.path().join("alpha")).expect("must create fixture directory");
    let location =
        Location::from_native_path(root.path()).expect("temp path must be representable");
    let mut request = request(PaneId::new(), &location);
    request.show_hidden = false;
    request.folders_first = true;
    request.sort = vec![SortDescriptorDto {
        column_id: "core.name".to_owned(),
        direction: SortDirectionDto::Ascending,
    }];

    let snapshot = service().list(request).await.expect("listing must succeed");
    let names: Vec<&str> = snapshot
        .entries
        .iter()
        .map(|entry| entry.name.as_str())
        .collect();

    assert_eq!(names, ["alpha", "beta", "zeta.txt"]);
}

#[tokio::test]
async fn paging_a_large_directory_returns_every_entry_without_duplicates() {
    let root = tempfile::tempdir().expect("must create a temp directory");
    for index in 0..600 {
        std::fs::write(root.path().join(format!("entry-{index:04}")), b"x")
            .expect("must create fixture");
    }
    let location =
        Location::from_native_path(root.path()).expect("temp path must be representable");
    let pane_id = PaneId::new();
    let service = service();
    let mut token = None;
    let mut names = std::collections::HashSet::new();

    loop {
        let mut request = request(pane_id, &location);
        request.continuation_token = token;
        let snapshot = service.list(request).await.expect("page must load");
        names.extend(snapshot.entries.into_iter().map(|entry| entry.name));
        if !snapshot.has_more {
            break;
        }
        token = snapshot.continuation_token;
    }

    assert_eq!(names.len(), 600);
}

#[tokio::test]
async fn a_non_existent_directory_maps_to_not_found_without_exposing_an_os_error() {
    let root = tempfile::tempdir().expect("must create a temp directory");
    let missing = root.path().join("missing");
    let location = Location::from_native_path(&missing).expect("temp path must be representable");

    let error = service()
        .list(request(PaneId::new(), &location))
        .await
        .expect_err("missing directory must fail");

    assert_eq!(error, fm_application::ApplicationError::NotFound);
    let dto = error.into_dto(Uuid::new_v4());
    assert_eq!(dto.message, "resource not found");
    assert!(!dto.message.contains(missing.to_string_lossy().as_ref()));
}

#[cfg(unix)]
#[tokio::test]
async fn an_unreadable_directory_maps_to_permission_denied_where_enforced() {
    use std::os::unix::fs::PermissionsExt;

    let root = tempfile::tempdir().expect("must create a temp directory");
    let blocked = root.path().join("blocked");
    std::fs::create_dir(&blocked).expect("must create fixture directory");
    std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(0o000))
        .expect("must remove permissions");
    let location = Location::from_native_path(&blocked).expect("temp path must be representable");
    let result = service().list(request(PaneId::new(), &location)).await;
    std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(0o700))
        .expect("must restore permissions");

    match result {
        Err(fm_application::ApplicationError::PermissionDenied) => {}
        Ok(_) => eprintln!("filesystem/user does not enforce mode-based read denial"),
        Err(error) => panic!("unexpected unreadable-directory result: {error}"),
    }
}
