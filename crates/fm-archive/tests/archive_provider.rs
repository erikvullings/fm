//! Public archive-provider behavior for task 0076.

use std::io::Write;

use fm_archive::{ArchiveFileSystemProvider, ArchiveLimits};
use fm_domain::{EntryKind, Location};
use fm_vfs::{FileSystemProvider, ListOptions, ProviderCapabilities, VfsError};
use tempfile::tempdir;
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use zip::{ZipWriter, write::SimpleFileOptions};

fn zip_location(path: &std::path::Path) -> Location {
    let file = Location::from_native_path(path).expect("temporary path is absolute");
    Location::parse(&format!("archive://{}!", &file.uri["file://".len()..]))
        .expect("archive URI is valid")
}

fn tar_bytes() -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut builder = tar::Builder::new(&mut bytes);
        let content = b"tar report";
        let mut header = tar::Header::new_gnu();
        header.set_size(content.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, "docs/report.txt", content.as_slice())
            .expect("append tar entry");
        builder.finish().expect("finish tar fixture");
    }
    bytes
}

#[tokio::test]
async fn tar_family_is_detected_by_content_and_navigable_read_only() {
    let root = tempdir().expect("temporary root");
    let tar = tar_bytes();
    let mut fixtures: Vec<(&str, Vec<u8>)> = vec![("raw.bin", tar.clone())];

    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(&tar).expect("write gzip fixture");
    fixtures.push(("gzip.bin", gzip.finish().expect("finish gzip fixture")));

    let mut bzip = bzip2::write::BzEncoder::new(Vec::new(), bzip2::Compression::default());
    bzip.write_all(&tar).expect("write bzip2 fixture");
    fixtures.push(("bzip.bin", bzip.finish().expect("finish bzip2 fixture")));

    let mut xz = xz2::write::XzEncoder::new(Vec::new(), 6);
    xz.write_all(&tar).expect("write xz fixture");
    fixtures.push(("xz.bin", xz.finish().expect("finish xz fixture")));

    let provider = ArchiveFileSystemProvider::new();
    for (name, bytes) in fixtures {
        let archive_path = root.path().join(name);
        std::fs::write(&archive_path, bytes).expect("write tar-family fixture");
        let docs = zip_location(&archive_path)
            .join("docs")
            .expect("safe child");
        let page = provider
            .list(&docs, ListOptions::default(), CancellationToken::new())
            .await
            .expect("list tar-family directory");
        assert_eq!(page.entries[0].name, "report.txt", "fixture {name}");
        assert_eq!(page.entries[0].size, Some(10), "fixture {name}");
        let capabilities = provider
            .capabilities_for(&docs)
            .expect("detect tar capabilities");
        assert!(capabilities.contains(fm_vfs::ProviderCapabilities::READ));
        assert!(!capabilities.contains(fm_vfs::ProviderCapabilities::WRITE));

        let mut reader = provider
            .open_read(
                &fm_vfs::EntryRef {
                    id: fm_domain::EntryId::new(),
                    location: docs.join("report.txt").expect("entry location"),
                },
                CancellationToken::new(),
            )
            .await
            .expect("read tar-family entry");
        let mut content = Vec::new();
        reader
            .read_to_end(&mut content)
            .await
            .expect("read content");
        assert_eq!(content, b"tar report", "fixture {name}");
    }
}

#[tokio::test]
async fn rar_is_recognized_but_advertises_no_unsupported_features() {
    let root = tempdir().expect("temporary root");
    let archive_path = root.path().join("archive.bin");
    std::fs::write(&archive_path, b"Rar!\x1a\x07\x01\0fixture").expect("write RAR signature");
    let provider = ArchiveFileSystemProvider::new();
    let location = zip_location(&archive_path);

    assert_eq!(
        provider
            .capabilities_for(&location)
            .expect("detect RAR capabilities"),
        ProviderCapabilities::empty()
    );
    let result = provider
        .list(&location, ListOptions::default(), CancellationToken::new())
        .await;
    assert!(matches!(
        result,
        Err(VfsError::UnsupportedCapability { capability })
            if capability == ProviderCapabilities::LIST
    ));
}

#[tokio::test]
async fn committing_a_staged_file_transactionally_adds_it_to_a_zip() {
    let root = tempdir().expect("temporary root");
    let archive_path = root.path().join("sample.zip");
    ZipWriter::new(std::fs::File::create(&archive_path).expect("create fixture"))
        .finish()
        .expect("finish fixture");
    let provider = ArchiveFileSystemProvider::new();
    let archive_root = zip_location(&archive_path);
    let temporary = archive_root
        .join(".fm-copy-test")
        .expect("temporary location");
    let destination = archive_root
        .join("report.txt")
        .expect("destination location");
    let mut stream = provider
        .open_write(
            &temporary,
            fm_vfs::WriteOptions::default(),
            CancellationToken::new(),
        )
        .await
        .expect("open staged write");
    stream
        .write_all(b"quarterly report")
        .await
        .expect("write staged content");
    stream.shutdown().await.expect("flush staged content");
    drop(stream);

    provider
        .commit_copy(
            &fm_vfs::EntryRef {
                id: fm_domain::EntryId::new(),
                location: destination.clone(),
            },
            &temporary,
            &destination,
            fm_vfs::CopyCommitOptions::default(),
            CancellationToken::new(),
        )
        .await
        .expect("publish archive rewrite");

    let page = provider
        .list(
            &archive_root,
            ListOptions::default(),
            CancellationToken::new(),
        )
        .await
        .expect("list rewritten archive");
    assert_eq!(
        page.entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>(),
        vec!["report.txt"]
    );
}

#[tokio::test]
async fn zip_entry_can_be_streamed_through_the_provider_interface() {
    let root = tempdir().expect("temporary root");
    let archive_path = root.path().join("sample.zip");
    let file = std::fs::File::create(&archive_path).expect("create fixture");
    let mut writer = ZipWriter::new(file);
    writer
        .start_file("report.txt", SimpleFileOptions::default())
        .expect("start fixture entry");
    writer
        .write_all(b"quarterly report")
        .expect("write fixture");
    writer.finish().expect("finish fixture");

    let location = zip_location(&archive_path)
        .join("report.txt")
        .expect("entry location");
    let mut reader = ArchiveFileSystemProvider::new()
        .open_read(
            &fm_vfs::EntryRef {
                id: fm_domain::EntryId::new(),
                location,
            },
            CancellationToken::new(),
        )
        .await
        .expect("open archive entry");
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .await
        .expect("read archive entry");

    assert_eq!(bytes, b"quarterly report");
}

#[tokio::test]
async fn encrypted_zip_distinguishes_missing_wrong_and_cached_correct_passwords() {
    let root = tempdir().expect("temporary root");
    let archive_path = root.path().join("encrypted.zip");
    let file = std::fs::File::create(&archive_path).expect("create fixture");
    let mut writer = ZipWriter::new(file);
    writer
        .start_file(
            "secret.txt",
            SimpleFileOptions::default().with_aes_encryption(zip::AesMode::Aes256, "correct"),
        )
        .expect("start encrypted entry");
    writer.write_all(b"classified").expect("write fixture");
    writer.finish().expect("finish fixture");
    let provider = ArchiveFileSystemProvider::new();
    let root_location = zip_location(&archive_path);
    let entry_location = root_location.join("secret.txt").expect("entry location");
    let entry = fm_vfs::EntryRef {
        id: fm_domain::EntryId::new(),
        location: entry_location,
    };

    let missing = provider.open_read(&entry, CancellationToken::new()).await;
    assert!(matches!(missing, Err(VfsError::CredentialRequired)));

    provider
        .cache_password(&root_location, "wrong".to_owned())
        .expect("cache wrong password for this backend session");
    let wrong = provider.open_read(&entry, CancellationToken::new()).await;
    assert!(matches!(wrong, Err(VfsError::InvalidCredential)));

    provider
        .cache_password(&root_location, "correct".to_owned())
        .expect("replace cached password");
    let mut reader = provider
        .open_read(&entry, CancellationToken::new())
        .await
        .expect("retry with cached correct password");
    let mut content = Vec::new();
    reader.read_to_end(&mut content).await.expect("read secret");
    assert_eq!(content, b"classified");
}

#[tokio::test]
async fn zip_archive_is_navigable_as_directories_without_extracting_it() {
    let root = tempdir().expect("temporary root");
    let archive_path = root.path().join("sample.zip");
    let file = std::fs::File::create(&archive_path).expect("create fixture");
    let mut writer = ZipWriter::new(file);
    writer
        .start_file("docs/report.txt", SimpleFileOptions::default())
        .expect("start fixture entry");
    writer
        .write_all(b"quarterly report")
        .expect("write fixture");
    writer.finish().expect("finish fixture");

    let provider = ArchiveFileSystemProvider::new();
    let archive_root = zip_location(&archive_path);
    let root_page = provider
        .list(
            &archive_root,
            ListOptions::default(),
            CancellationToken::new(),
        )
        .await
        .expect("list archive root");
    assert_eq!(root_page.entries.len(), 1);
    assert_eq!(root_page.entries[0].name, "docs");
    assert_eq!(root_page.entries[0].kind, EntryKind::Directory);

    let docs_page = provider
        .list(
            &archive_root.join("docs").expect("safe child"),
            ListOptions::default(),
            CancellationToken::new(),
        )
        .await
        .expect("list virtual directory");
    assert_eq!(docs_page.entries.len(), 1);
    assert_eq!(docs_page.entries[0].name, "report.txt");
    assert_eq!(docs_page.entries[0].kind, EntryKind::File);
    assert_eq!(docs_page.entries[0].size, Some(16));
}

#[tokio::test]
async fn seven_zip_archive_is_detected_by_content_and_navigable() {
    let root = tempdir().expect("temporary root");
    // Deliberately avoid a `.7z` suffix: provider format detection must inspect content.
    let archive_path = root.path().join("archive.bin");
    let mut writer = sevenz_rust2::ArchiveWriter::create(&archive_path).expect("create 7z fixture");
    writer
        .push_archive_entry(
            sevenz_rust2::ArchiveEntry::new_file("docs/über.txt"),
            Some(b"seven zip".as_slice()),
        )
        .expect("write 7z fixture entry");
    writer.finish().expect("finish 7z fixture");

    let provider = ArchiveFileSystemProvider::new();
    let docs = zip_location(&archive_path)
        .join("docs")
        .expect("safe child");
    let page = provider
        .list(&docs, ListOptions::default(), CancellationToken::new())
        .await
        .expect("list 7z directory");

    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.entries[0].name, "über.txt");
    assert_eq!(page.entries[0].size, Some(9));
    let capabilities = provider
        .capabilities_for(&docs)
        .expect("detect 7z capabilities");
    assert!(capabilities.contains(fm_vfs::ProviderCapabilities::READ));
    assert!(!capabilities.contains(fm_vfs::ProviderCapabilities::WRITE));
}

#[tokio::test]
async fn deleting_a_non_empty_zip_directory_rewrites_the_archive_tree() {
    let root = tempdir().expect("temporary root");
    let archive_path = root.path().join("delete.zip");
    let file = std::fs::File::create(&archive_path).expect("create fixture");
    let mut writer = ZipWriter::new(file);
    writer
        .start_file("keep.txt", SimpleFileOptions::default())
        .expect("start keep entry");
    writer.write_all(b"keep").expect("write keep entry");
    writer
        .start_file("docs/one.txt", SimpleFileOptions::default())
        .expect("start first child");
    writer.write_all(b"one").expect("write first child");
    writer
        .start_file("docs/nested/two.txt", SimpleFileOptions::default())
        .expect("start nested child");
    writer.write_all(b"two").expect("write nested child");
    writer.finish().expect("finish fixture");
    let provider = ArchiveFileSystemProvider::new();
    let archive_root = zip_location(&archive_path);
    let docs = archive_root.join("docs").expect("directory location");

    provider
        .remove(
            &fm_vfs::EntryRef {
                id: fm_domain::EntryId::new(),
                location: docs,
            },
            fm_vfs::RemoveOptions {
                recursive: true,
                use_trash: false,
            },
            CancellationToken::new(),
        )
        .await
        .expect("delete archive tree");

    let page = provider
        .list(
            &archive_root,
            ListOptions::default(),
            CancellationToken::new(),
        )
        .await
        .expect("list rewritten archive");
    assert_eq!(
        page.entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>(),
        vec!["keep.txt"]
    );
}

#[tokio::test]
async fn opening_an_entry_over_the_uncompressed_limit_is_rejected_before_expansion() {
    let root = tempdir().expect("temporary root");
    let archive_path = root.path().join("bomb.zip");
    let file = std::fs::File::create(&archive_path).expect("create fixture");
    let mut writer = ZipWriter::new(file);
    writer
        .start_file("large.txt", SimpleFileOptions::default())
        .expect("start entry");
    writer.write_all(b"five!").expect("write entry");
    writer.finish().expect("finish fixture");
    let provider = ArchiveFileSystemProvider::with_limits(ArchiveLimits {
        max_uncompressed_entry_bytes: 4,
        max_expansion_ratio: 1_000,
    });
    let location = zip_location(&archive_path)
        .join("large.txt")
        .expect("entry location");

    let error = match provider
        .open_read(
            &fm_vfs::EntryRef {
                id: fm_domain::EntryId::new(),
                location,
            },
            CancellationToken::new(),
        )
        .await
    {
        Ok(_) => panic!("oversized expansion must be rejected"),
        Err(error) => error,
    };

    assert!(matches!(
        error,
        fm_vfs::VfsError::ArchiveResourceLimit {
            kind: "uncompressedEntryBytes"
        }
    ));
}

#[tokio::test]
async fn unsafe_archive_entry_paths_are_rejected_during_browsing() {
    let root = tempdir().expect("temporary root");
    let archive_path = root.path().join("unsafe.zip");
    let file = std::fs::File::create(&archive_path).expect("create fixture");
    let mut writer = ZipWriter::new(file);
    writer
        .start_file("../escape.txt", SimpleFileOptions::default())
        .expect("start unsafe entry");
    writer.write_all(b"escape").expect("write entry");
    writer.finish().expect("finish fixture");

    let error = ArchiveFileSystemProvider::new()
        .list(
            &zip_location(&archive_path),
            ListOptions::default(),
            CancellationToken::new(),
        )
        .await
        .expect_err("unsafe path must reject archive");

    assert!(matches!(error, fm_vfs::VfsError::UnsafeArchiveEntry));
}

#[tokio::test]
async fn corrupt_zip_returns_a_typed_error_without_extracting_or_panicking() {
    let root = tempdir().expect("temporary root");
    let archive_path = root.path().join("corrupt.bin");
    std::fs::write(&archive_path, b"PK\x03\x04truncated").expect("write corrupt fixture");

    let result = ArchiveFileSystemProvider::new()
        .list(
            &zip_location(&archive_path),
            ListOptions::default(),
            CancellationToken::new(),
        )
        .await;

    assert!(matches!(result, Err(VfsError::Io { .. })));
}

#[tokio::test]
async fn tar_link_entries_are_rejected_instead_of_being_followed() {
    let root = tempdir().expect("temporary root");
    let archive_path = root.path().join("links.tar");
    let file = std::fs::File::create(&archive_path).expect("create tar fixture");
    let mut builder = tar::Builder::new(file);
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(tar::EntryType::Symlink);
    header.set_size(0);
    header.set_mode(0o777);
    header
        .set_link_name("../../outside")
        .expect("set link target");
    header.set_cksum();
    builder
        .append_data(&mut header, "escape-link", std::io::empty())
        .expect("append symlink");
    builder.finish().expect("finish tar fixture");

    let result = ArchiveFileSystemProvider::new()
        .list(
            &zip_location(&archive_path),
            ListOptions::default(),
            CancellationToken::new(),
        )
        .await;

    assert!(matches!(result, Err(VfsError::UnsafeArchiveEntry)));
}
