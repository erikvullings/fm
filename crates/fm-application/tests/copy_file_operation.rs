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
            OperationStateDto::Completed | OperationStateDto::Failed
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
async fn destination_collision_is_reported_without_overwriting_or_leaving_a_temporary_file() {
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

    assert_eq!(operation.state, OperationStateDto::Failed);
    assert_eq!(fs::read(destination.join("same.txt")).unwrap(), b"existing");
    assert!(fs::read_dir(&destination)
        .unwrap()
        .all(|entry| !entry.unwrap().file_name().to_string_lossy().starts_with(".fm-copy-")));
}
