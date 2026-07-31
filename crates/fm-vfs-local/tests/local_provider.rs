//! Public contract tests for the local filesystem provider.

use std::fs;

use fm_domain::{EntryKind, Location, ProviderId};
use fm_vfs::{
    CopyCommitOptions, EntryRef, FileSystemProvider, ListOptions, ProviderCapabilities,
    ProviderChange, VfsError, WriteOptions,
};
use fm_vfs_local::LocalFileSystemProvider;
use futures::StreamExt;
use tempfile::tempdir;
use tokio_util::sync::CancellationToken;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::test]
async fn creates_one_unicode_child_directory_without_creating_parents() {
    let root = tempdir().expect("temporary directory");
    let location = Location::from_native_path(root.path()).expect("local location");
    let provider = LocalFileSystemProvider::new();

    let created = provider
        .create_directory(&location, "資料", CancellationToken::new())
        .await
        .expect("create unicode directory");

    assert!(root.path().join("資料").is_dir());
    assert_eq!(
        created.location,
        location.join("資料").expect("child location")
    );
    assert!(matches!(
        provider
            .create_directory(&location, "missing/child", CancellationToken::new())
            .await,
        Err(VfsError::PathTraversalName)
    ));
    assert!(!root.path().join("missing").exists());
}

#[tokio::test]
async fn create_directory_rejects_typed_invalid_names_and_collisions() {
    let root = tempdir().expect("temporary directory");
    fs::create_dir(root.path().join("existing")).expect("collision fixture");
    let location = Location::from_native_path(root.path()).expect("local location");
    let provider = LocalFileSystemProvider::new();

    assert!(matches!(
        provider
            .create_directory(&location, "existing", CancellationToken::new())
            .await,
        Err(VfsError::AlreadyExists { .. })
    ));
    for name in ["", "bad\0name", "../escape", ".", "CON", "com1.txt"] {
        let error = provider
            .create_directory(&location, name, CancellationToken::new())
            .await
            .expect_err("invalid name must fail");
        assert!(
            matches!(
                (&error, name),
                (VfsError::EmptyName, "")
                    | (VfsError::InvalidNameCharacters, "bad\0name")
                    | (VfsError::PathTraversalName, "../escape" | ".")
                    | (VfsError::ReservedName, "CON" | "com1.txt")
            ),
            "unexpected error for {name:?}: {error}"
        );
    }
}

#[tokio::test]
async fn streams_a_file_to_a_temporary_name_then_commits_it_atomically() {
    let root = tempdir().expect("temporary directory");
    fs::write(root.path().join("source.bin"), b"streamed bytes").expect("source fixture");
    let parent = Location::from_native_path(root.path()).expect("local location");
    let source = EntryRef {
        id: fm_domain::EntryId::new(),
        location: parent.join("source.bin").expect("source location"),
    };
    let temporary = parent.join(".fm-copy-test").expect("temporary location");
    let destination = parent.join("copied.bin").expect("destination location");
    let provider = LocalFileSystemProvider::new();

    let mut reader = provider
        .open_read(&source, CancellationToken::new())
        .await
        .expect("open source");
    let mut writer = provider
        .open_write(&temporary, WriteOptions::default(), CancellationToken::new())
        .await
        .expect("open temporary destination");
    let mut buffer = [0_u8; 4];
    loop {
        let read = reader.read(&mut buffer).await.expect("stream read");
        if read == 0 { break; }
        writer.write_all(&buffer[..read]).await.expect("stream write");
    }
    writer.shutdown().await.expect("flush destination");
    provider
        .commit_copy(
            &source,
            &temporary,
            &destination,
            CopyCommitOptions { overwrite: false, preserve_metadata: true },
            CancellationToken::new(),
        )
        .await
        .expect("commit copy");

    assert_eq!(fs::read(root.path().join("copied.bin")).unwrap(), b"streamed bytes");
    assert!(!root.path().join(".fm-copy-test").exists());
}

#[tokio::test]
async fn rename_preserves_identity_and_never_overwrites() {
    let root = tempdir().expect("temporary directory");
    fs::write(root.path().join("before.txt"), b"source").expect("source fixture");
    fs::write(root.path().join("occupied.txt"), b"destination").expect("collision fixture");
    let parent = Location::from_native_path(root.path()).expect("local location");
    let provider = LocalFileSystemProvider::new();
    let source = provider
        .list(&parent, ListOptions::default(), CancellationToken::new())
        .await
        .expect("list")
        .entries
        .into_iter()
        .find(|entry| entry.name == "before.txt")
        .map(|entry| EntryRef {
            id: entry.id,
            location: entry.location,
        })
        .expect("source entry");

    let collision = parent.join("occupied.txt").expect("collision location");
    assert!(matches!(
        provider
            .rename(&source, &collision, CancellationToken::new())
            .await,
        Err(VfsError::AlreadyExists { .. })
    ));
    assert_eq!(
        fs::read(root.path().join("occupied.txt")).expect("destination intact"),
        b"destination"
    );

    let destination = parent.join("資料.txt").expect("unicode destination");
    let renamed = provider
        .rename(&source, &destination, CancellationToken::new())
        .await
        .expect("rename");
    assert_eq!(renamed.id, source.id);
    assert_eq!(renamed.location, destination);
    assert!(!root.path().join("before.txt").exists());
    assert_eq!(
        fs::read(root.path().join("資料.txt")).expect("renamed contents"),
        b"source"
    );
}

#[tokio::test]
async fn rename_directory_keeps_its_children() {
    let root = tempdir().expect("temporary directory");
    fs::create_dir(root.path().join("before")).expect("directory fixture");
    fs::write(root.path().join("before/child.txt"), b"child").expect("child fixture");
    let parent = Location::from_native_path(root.path()).expect("local location");
    let provider = LocalFileSystemProvider::new();
    let entry = provider
        .list(&parent, ListOptions::default(), CancellationToken::new())
        .await
        .expect("list")
        .entries
        .into_iter()
        .next()
        .expect("entry");
    let source = EntryRef {
        id: entry.id,
        location: entry.location,
    };

    provider
        .rename(
            &source,
            &parent.join("after").expect("destination"),
            CancellationToken::new(),
        )
        .await
        .expect("rename directory");

    assert_eq!(
        fs::read(root.path().join("after/child.txt")).expect("open child"),
        b"child"
    );
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[tokio::test]
async fn case_only_rename_uses_a_safe_intermediate_name() {
    let root = tempdir().expect("temporary directory");
    fs::write(root.path().join("Report.txt"), b"contents").expect("fixture");
    let parent = Location::from_native_path(root.path()).expect("local location");
    let provider = LocalFileSystemProvider::new();
    let entry = provider
        .list(&parent, ListOptions::default(), CancellationToken::new())
        .await
        .expect("list")
        .entries
        .into_iter()
        .next()
        .expect("entry");
    let source = EntryRef {
        id: entry.id,
        location: entry.location,
    };

    provider
        .rename(
            &source,
            &parent.join("report.txt").expect("destination"),
            CancellationToken::new(),
        )
        .await
        .expect("case-only rename");

    assert_eq!(
        fs::read(root.path().join("report.txt")).expect("renamed file"),
        b"contents"
    );
}

#[tokio::test]
async fn entry_id_survives_a_rename() {
    let root = tempdir().expect("temporary directory");
    fs::write(root.path().join("before.txt"), b"same file").expect("create fixture");
    let location = Location::from_native_path(root.path()).expect("local location");
    let provider = LocalFileSystemProvider::new();
    let before = provider
        .list(&location, ListOptions::default(), CancellationToken::new())
        .await
        .expect("initial listing")
        .entries[0]
        .id;

    fs::rename(
        root.path().join("before.txt"),
        root.path().join("after.txt"),
    )
    .expect("rename fixture");
    let after = provider
        .list(&location, ListOptions::default(), CancellationToken::new())
        .await
        .expect("updated listing")
        .entries[0]
        .id;

    assert_eq!(before, after);
}

#[tokio::test]
async fn watches_create_rename_and_delete_as_coalesced_invalidations() {
    let root = tempdir().expect("temporary directory");
    let location = Location::from_native_path(root.path()).expect("local location");
    let cancellation = CancellationToken::new();
    let mut changes = LocalFileSystemProvider::new()
        .watch(&location, cancellation.clone())
        .await
        .expect("start watch");
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;

    fs::write(root.path().join("before.txt"), b"file").expect("create fixture");
    fs::rename(
        root.path().join("before.txt"),
        root.path().join("after.txt"),
    )
    .expect("rename fixture");
    let change = tokio::time::timeout(std::time::Duration::from_secs(3), changes.next())
        .await
        .expect("watch notification timeout")
        .expect("watch stream open")
        .expect("watch notification");
    assert_eq!(change, ProviderChange::Changed);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(250), changes.next())
            .await
            .is_err(),
        "burst must not produce one notification per filesystem event"
    );
    cancellation.cancel();
}

#[tokio::test]
async fn lists_files_and_directories_with_lightweight_summaries() {
    let root = tempdir().expect("temporary directory");
    fs::write(root.path().join("empty.txt"), []).expect("create empty file");
    fs::create_dir(root.path().join("folder")).expect("create directory");
    let location = Location::from_native_path(root.path()).expect("local location");

    let page = LocalFileSystemProvider::new()
        .list(&location, ListOptions::default(), CancellationToken::new())
        .await
        .expect("list directory");

    assert_eq!(page.entries.len(), 2);
    let file = page
        .entries
        .iter()
        .find(|entry| entry.name == "empty.txt")
        .expect("file summary");
    assert_eq!(file.kind, EntryKind::File);
    assert_eq!(file.size, Some(0));
    assert_eq!(file.extension.as_deref(), Some("txt"));
    assert!(file.mime_type.is_none());
    assert!(file.icon_key.is_none());
    assert!(
        page.entries
            .iter()
            .any(|entry| entry.name == "folder" && entry.kind == EntryKind::Directory)
    );
}

#[tokio::test]
async fn pages_without_buffering_or_losing_entries() {
    let root = tempdir().expect("temporary directory");
    for index in 0..1_000 {
        fs::write(root.path().join(format!("entry-{index:04}")), []).expect("create fixture");
    }
    let location = Location::from_native_path(root.path()).expect("local location");
    let provider = LocalFileSystemProvider::new();
    let mut token = None;
    let mut names = std::collections::HashSet::new();

    loop {
        let page = provider
            .list(
                &location,
                ListOptions {
                    page_size: 37,
                    continuation_token: token,
                },
                CancellationToken::new(),
            )
            .await
            .expect("list page");
        assert!(page.entries.len() <= 37);
        names.extend(page.entries.into_iter().map(|entry| entry.name));
        if !page.has_more {
            assert!(page.continuation_token.is_none());
            break;
        }
        token = page.continuation_token;
        assert!(token.is_some());
    }

    assert_eq!(names.len(), 1_000);
}

#[tokio::test]
async fn returns_the_first_page_of_a_hundred_thousand_entry_directory() {
    let root = tempdir().expect("temporary directory");
    let seed = root.path().join("seed");
    fs::write(&seed, []).expect("create hard-link seed");
    for index in 0..100_000 {
        fs::hard_link(&seed, root.path().join(format!("{index:06}")))
            .expect("create large fixture");
    }
    let location = Location::from_native_path(root.path()).expect("local location");

    let started = std::time::Instant::now();
    let page = LocalFileSystemProvider::new()
        .list(
            &location,
            ListOptions {
                page_size: 64,
                continuation_token: None,
            },
            CancellationToken::new(),
        )
        .await
        .expect("list first page");

    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    assert_eq!(page.entries.len(), 64);
    assert!(page.has_more);
    assert!(page.continuation_token.is_some());
    assert_eq!(page.total_known_entries, None);
}

#[tokio::test]
async fn cancellation_and_filesystem_failures_are_typed() {
    let root = tempdir().expect("temporary directory");
    let location = Location::from_native_path(root.path()).expect("local location");
    let cancellation = CancellationToken::new();
    cancellation.cancel();
    let provider = LocalFileSystemProvider::new();

    assert!(matches!(
        provider
            .list(&location, ListOptions::default(), cancellation)
            .await,
        Err(VfsError::Cancelled)
    ));

    let missing = location.join("missing").expect("child location");
    assert!(matches!(
        provider
            .list(&missing, ListOptions::default(), CancellationToken::new())
            .await,
        Err(VfsError::NotFound { .. })
    ));

    let file_path = root.path().join("not-a-directory");
    fs::write(&file_path, []).expect("create file");
    let file = Location::from_native_path(&file_path).expect("file location");
    assert!(matches!(
        provider
            .list(&file, ListOptions::default(), CancellationToken::new())
            .await,
        Err(VfsError::NotADirectory { .. })
    ));
}

#[tokio::test]
async fn lists_hidden_unicode_shell_sensitive_empty_and_sparse_files() {
    let root = tempdir().expect("temporary directory");
    let special = ".résumé $' (draft).txt";
    fs::write(root.path().join(special), []).expect("create special file");
    let sparse_path = root.path().join("sparse.bin");
    let sparse = fs::File::create(&sparse_path).expect("create sparse file");
    sparse.set_len(1_000_000).expect("set sparse logical size");
    let location = Location::from_native_path(root.path()).expect("local location");

    let page = LocalFileSystemProvider::new()
        .list(&location, ListOptions::default(), CancellationToken::new())
        .await
        .expect("list directory");

    let special_entry = page
        .entries
        .iter()
        .find(|entry| entry.name == special)
        .expect("special entry");
    assert!(special_entry.hidden);
    assert_eq!(special_entry.size, Some(0));
    assert_eq!(
        special_entry.location.name().expect("decoded name"),
        special
    );
    assert_eq!(
        page.entries
            .iter()
            .find(|entry| entry.name == "sparse.bin")
            .expect("sparse entry")
            .size,
        Some(1_000_000)
    );
}

#[tokio::test]
async fn metadata_is_separate_and_capabilities_are_truthful() {
    let root = tempdir().expect("temporary directory");
    let path = root.path().join("details.txt");
    fs::write(&path, b"content").expect("create file");
    let location = Location::from_native_path(&path).expect("file location");
    let entry = EntryRef {
        id: fm_domain::EntryId::new(),
        location,
    };
    let provider = LocalFileSystemProvider::new();

    assert_eq!(provider.id(), ProviderId::new("local"));
    assert_eq!(
        provider.capabilities(),
        ProviderCapabilities::LIST
            | ProviderCapabilities::WATCH
            | ProviderCapabilities::CREATE_DIRECTORY
            | ProviderCapabilities::RENAME
    );
    let metadata = provider
        .metadata(&entry, CancellationToken::new())
        .await
        .expect("detailed metadata");
    assert_eq!(metadata.entry_id, entry.id);
    assert!(metadata.permissions.is_some());
    assert!(metadata.checksums.is_empty());
    assert!(metadata.image_dimensions.is_none());
    assert!(metadata.media.is_none());
    assert!(metadata.archive.is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn symbolic_links_are_flagged_and_never_followed() {
    use std::os::unix::fs::symlink;

    let root = tempdir().expect("temporary directory");
    fs::create_dir(root.path().join("target")).expect("create target");
    symlink(root.path().join("target"), root.path().join("link")).expect("create symlink");
    let location = Location::from_native_path(root.path()).expect("local location");

    let page = LocalFileSystemProvider::new()
        .list(&location, ListOptions::default(), CancellationToken::new())
        .await
        .expect("list directory");
    let link = page
        .entries
        .iter()
        .find(|entry| entry.name == "link")
        .expect("link entry");

    assert_eq!(link.kind, EntryKind::Symlink);
    assert_eq!(link.size, None);
}

#[cfg(unix)]
#[tokio::test]
async fn unreadable_directories_return_permission_denied_where_enforced() {
    use std::os::unix::fs::PermissionsExt;

    let root = tempdir().expect("temporary directory");
    let blocked_path = root.path().join("blocked");
    fs::create_dir(&blocked_path).expect("create blocked directory");
    fs::set_permissions(&blocked_path, fs::Permissions::from_mode(0o000))
        .expect("remove permissions");
    let location = Location::from_native_path(&blocked_path).expect("local location");
    let result = LocalFileSystemProvider::new()
        .list(&location, ListOptions::default(), CancellationToken::new())
        .await;
    fs::set_permissions(&blocked_path, fs::Permissions::from_mode(0o700))
        .expect("restore permissions");

    match result {
        Err(VfsError::PermissionDenied { .. }) => {}
        Ok(_) => eprintln!("filesystem/user does not enforce mode-based read denial"),
        Err(error) => panic!("unexpected unreadable-directory result: {error}"),
    }
}

#[cfg(unix)]
#[tokio::test]
async fn lists_a_directory_at_a_very_long_path() {
    let root = tempdir().expect("temporary directory");
    let mut deep = root.path().to_path_buf();
    while deep.as_os_str().len() < 800 {
        deep.push("long-path-segment");
        fs::create_dir(&deep).expect("create long path");
    }
    fs::write(deep.join("leaf.txt"), []).expect("create leaf");
    let location = Location::from_native_path(&deep).expect("long local location");

    let page = LocalFileSystemProvider::new()
        .list(&location, ListOptions::default(), CancellationToken::new())
        .await
        .expect("list long path");

    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.entries[0].name, "leaf.txt");
}

#[cfg(windows)]
#[tokio::test]
async fn windows_hidden_attribute_and_directory_reparse_points_are_flagged() {
    use std::os::windows::fs::symlink_dir;
    use std::process::Command;

    let root = tempdir().expect("temporary directory");
    let hidden_path = root.path().join("hidden.txt");
    fs::write(&hidden_path, []).expect("create hidden fixture");
    let status = Command::new("attrib")
        .arg("+H")
        .arg(&hidden_path)
        .status()
        .expect("run attrib");
    assert!(status.success());
    fs::create_dir(root.path().join("target")).expect("create target");
    if let Err(error) = symlink_dir(root.path().join("target"), root.path().join("link")) {
        eprintln!("reparse-point fixture unsupported in this Windows environment: {error}");
        return;
    }
    let location = Location::from_native_path(root.path()).expect("local location");
    let page = LocalFileSystemProvider::new()
        .list(&location, ListOptions::default(), CancellationToken::new())
        .await
        .expect("list directory");

    assert!(
        page.entries
            .iter()
            .any(|entry| entry.name == "hidden.txt" && entry.hidden)
    );
    assert!(
        page.entries
            .iter()
            .any(|entry| entry.name == "link" && entry.kind == EntryKind::Symlink)
    );
}
