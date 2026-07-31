//! Single-file copy integration tests confined to temporary roots.

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

async fn copy(
    service: &FileManagerService,
    source: Location,
    destination_directory: Location,
    conflict_policy: OperationConflictPolicyDto,
) -> fm_transport_dto::OperationDto {
    let operation = service
        .start_operation(
            StartOperationRequestDto {
                operation_type: OperationKindDto::Copy,
                sources: vec![source.into()],
                destination: Some(destination_directory.into()),
                conflict_policy,
                name: None,
                create_intermediate_directories: false,
                symlink_policy: Default::default(),
                permanent_delete_confirmed: false,
                override_read_only: false,
            },
            None,
        )
        .expect("accepted");
    for _ in 0..200 {
        let current = service
            .get_operation(operation.id.into())
            .expect("operation");
        if matches!(
            current.state,
            OperationStateDto::Completed
                | OperationStateDto::Failed
                | OperationStateDto::WaitingForConflictResolution
        ) {
            return current;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("operation did not finish")
}

#[tokio::test]
async fn copies_zero_and_large_files_with_byte_and_item_totals() {
    let root = tempfile::tempdir().expect("temporary root");
    let destination = root.path().join("destination");
    fs::create_dir(&destination).unwrap();
    fs::write(root.path().join("empty.bin"), []).unwrap();
    fs::write(root.path().join("large.bin"), vec![0x5a; 8 * 1024 * 1024]).unwrap();
    let service = service(&root);

    for (name, size) in [("empty.bin", 0_u64), ("large.bin", 8 * 1024 * 1024)] {
        let operation = copy(
            &service,
            Location::from_native_path(&root.path().join(name)).unwrap(),
            Location::from_native_path(&destination).unwrap(),
            OperationConflictPolicyDto::Ask,
        )
        .await;
        assert_eq!(operation.state, OperationStateDto::Completed);
        assert_eq!(operation.progress.total_items, Some(1));
        assert_eq!(operation.progress.completed_items, 1);
        assert_eq!(operation.progress.total_bytes, Some(size));
        assert_eq!(operation.progress.completed_bytes, size);
        assert_eq!(fs::metadata(destination.join(name)).unwrap().len(), size);
    }
}

#[tokio::test]
async fn ask_collision_waits_without_overwriting_the_destination() {
    let root = tempfile::tempdir().expect("temporary root");
    let destination = root.path().join("destination");
    fs::create_dir(&destination).unwrap();
    fs::write(root.path().join("same.txt"), b"source").unwrap();
    fs::write(destination.join("same.txt"), b"existing").unwrap();
    let service = service(&root);

    let operation = copy(
        &service,
        Location::from_native_path(&root.path().join("same.txt")).unwrap(),
        Location::from_native_path(&destination).unwrap(),
        OperationConflictPolicyDto::Ask,
    )
    .await;

    assert_eq!(
        operation.state,
        OperationStateDto::WaitingForConflictResolution
    );
    assert_eq!(fs::read(destination.join("same.txt")).unwrap(), b"existing");
    service.cancel_operation(operation.id.into()).unwrap();
}

#[tokio::test]
async fn explicit_overwrite_and_rename_new_policies_are_safe() {
    let root = tempfile::tempdir().expect("temporary root");
    let destination = root.path().join("destination");
    fs::create_dir(&destination).unwrap();
    fs::write(root.path().join("same.txt"), b"source").unwrap();
    fs::write(destination.join("same.txt"), b"existing").unwrap();
    let service = service(&root);
    let source = Location::from_native_path(&root.path().join("same.txt")).unwrap();
    let target = Location::from_native_path(&destination).unwrap();

    assert_eq!(
        copy(
            &service,
            source.clone(),
            target.clone(),
            OperationConflictPolicyDto::RenameNew
        )
        .await
        .state,
        OperationStateDto::Completed
    );
    assert_eq!(
        fs::read(destination.join("same (copy 1).txt")).unwrap(),
        b"source"
    );
    assert_eq!(
        copy(
            &service,
            source,
            target,
            OperationConflictPolicyDto::Overwrite
        )
        .await
        .state,
        OperationStateDto::Completed
    );
    assert_eq!(fs::read(destination.join("same.txt")).unwrap(), b"source");
}

#[tokio::test]
async fn preserves_modified_time_and_unix_permissions() {
    let root = tempfile::tempdir().expect("temporary root");
    let destination = root.path().join("destination");
    fs::create_dir(&destination).unwrap();
    let source_path = root.path().join("metadata.bin");
    fs::write(&source_path, b"metadata").unwrap();
    let source_file = fs::OpenOptions::new()
        .write(true)
        .open(&source_path)
        .unwrap();
    let modified = std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    source_file
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&source_path, fs::Permissions::from_mode(0o640)).unwrap();
    }
    let service = service(&root);

    let operation = copy(
        &service,
        Location::from_native_path(&source_path).unwrap(),
        Location::from_native_path(&destination).unwrap(),
        OperationConflictPolicyDto::Ask,
    )
    .await;

    assert_eq!(operation.state, OperationStateDto::Completed);
    let copied = fs::metadata(destination.join("metadata.bin")).unwrap();
    assert_eq!(copied.modified().unwrap(), modified);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(copied.permissions().mode() & 0o777, 0o640);
    }
}

#[tokio::test]
async fn a_missing_source_fails_without_creating_a_destination() {
    let root = tempfile::tempdir().expect("temporary root");
    let destination = root.path().join("destination");
    fs::create_dir(&destination).unwrap();
    let service = service(&root);

    let operation = copy(
        &service,
        Location::from_native_path(&root.path().join("vanished.bin")).unwrap(),
        Location::from_native_path(&destination).unwrap(),
        OperationConflictPolicyDto::Ask,
    )
    .await;

    assert_eq!(operation.state, OperationStateDto::Failed);
    assert_eq!(fs::read_dir(destination).unwrap().count(), 0);
}

#[tokio::test]
async fn cancellation_removes_the_private_partial_destination() {
    let root = tempfile::tempdir().expect("temporary root");
    let destination = root.path().join("destination");
    fs::create_dir(&destination).unwrap();
    let source_path = root.path().join("large-sparse.bin");
    fs::File::create(&source_path)
        .unwrap()
        .set_len(128 * 1024 * 1024)
        .unwrap();
    let service = service(&root);
    let operation = service
        .start_operation(
            StartOperationRequestDto {
                operation_type: OperationKindDto::Copy,
                sources: vec![Location::from_native_path(&source_path).unwrap().into()],
                destination: Some(Location::from_native_path(&destination).unwrap().into()),
                conflict_policy: OperationConflictPolicyDto::Ask,
                name: None,
                create_intermediate_directories: false,
                symlink_policy: Default::default(),
                permanent_delete_confirmed: false,
                override_read_only: false,
            },
            None,
        )
        .unwrap();
    for _ in 0..1_000 {
        if service.get_operation(operation.id.into()).unwrap().state == OperationStateDto::Running {
            service.cancel_operation(operation.id.into()).unwrap();
            break;
        }
        tokio::task::yield_now().await;
    }
    for _ in 0..200 {
        let state = service.get_operation(operation.id.into()).unwrap().state;
        if state == OperationStateDto::Cancelled {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    assert_eq!(
        service.get_operation(operation.id.into()).unwrap().state,
        OperationStateDto::Cancelled
    );
    assert!(!destination.join("large-sparse.bin").exists());
    assert_eq!(fs::read_dir(destination).unwrap().count(), 0);
}
