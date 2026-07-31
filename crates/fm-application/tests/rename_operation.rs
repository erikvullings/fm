//! Rename operation integration tests confined to temporary roots.

use std::{fs, time::Duration};

use fm_application::FileManagerService;
use fm_domain::Location;
use fm_transport_dto::{
    OperationConflictPolicyDto, OperationKindDto, OperationStateDto, RuntimeKindDto,
    StartOperationRequestDto,
};

fn service(root: &tempfile::TempDir) -> FileManagerService {
    FileManagerService::new(
        RuntimeKindDto::BrowserServer,
        root.path().join("workspaces"),
        root.path().join("settings"),
    )
}

async fn wait(service: &FileManagerService, id: uuid::Uuid) -> OperationStateDto {
    for _ in 0..100 {
        let state = service.get_operation(id.into()).expect("operation").state;
        if matches!(
            state,
            OperationStateDto::Completed | OperationStateDto::Failed
        ) {
            return state;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("operation did not finish")
}

async fn rename(
    service: &FileManagerService,
    source: Location,
    destination: Location,
) -> OperationStateDto {
    let operation = service
        .start_operation(
            StartOperationRequestDto {
                operation_type: OperationKindDto::Rename,
                sources: vec![source.into()],
                destination: Some(destination.into()),
                conflict_policy: OperationConflictPolicyDto::Ask,
                name: None,
                create_intermediate_directories: false,
            },
            None,
        )
        .expect("accepted");
    wait(service, operation.id).await
}

#[tokio::test]
async fn renames_plain_unicode_and_non_empty_directory_entries() {
    let root = tempfile::tempdir().expect("temporary root");
    fs::write(root.path().join("plain.txt"), b"plain").expect("fixture");
    fs::create_dir(root.path().join("folder")).expect("folder");
    fs::write(root.path().join("folder/child.txt"), b"child").expect("child");
    let service = service(&root);

    assert_eq!(
        rename(
            &service,
            Location::from_native_path(&root.path().join("plain.txt")).unwrap(),
            Location::from_native_path(&root.path().join("資料.txt")).unwrap()
        )
        .await,
        OperationStateDto::Completed
    );
    assert_eq!(
        rename(
            &service,
            Location::from_native_path(&root.path().join("folder")).unwrap(),
            Location::from_native_path(&root.path().join("renamed-folder")).unwrap()
        )
        .await,
        OperationStateDto::Completed
    );
    assert_eq!(fs::read(root.path().join("資料.txt")).unwrap(), b"plain");
    assert_eq!(
        fs::read(root.path().join("renamed-folder/child.txt")).unwrap(),
        b"child"
    );
}

#[tokio::test]
async fn rename_collision_fails_without_overwriting() {
    let root = tempfile::tempdir().expect("temporary root");
    fs::write(root.path().join("source.txt"), b"source").expect("source");
    fs::write(root.path().join("existing.txt"), b"existing").expect("existing");
    let service = service(&root);

    assert_eq!(
        rename(
            &service,
            Location::from_native_path(&root.path().join("source.txt")).unwrap(),
            Location::from_native_path(&root.path().join("existing.txt")).unwrap()
        )
        .await,
        OperationStateDto::Failed
    );
    assert_eq!(fs::read(root.path().join("source.txt")).unwrap(), b"source");
    assert_eq!(
        fs::read(root.path().join("existing.txt")).unwrap(),
        b"existing"
    );
}
