//! Public contract tests for location parsing and native path conversion.

use std::path::Path;

use fm_domain::{Location, LocationError, ProviderId};

#[test]
fn ftp_and_ftps_locations_preserve_transport_security() {
    let id = "11111111-1111-4111-8111-111111111111";
    for scheme in ["ftp", "ftps"] {
        let root = Location::parse(&format!("{scheme}://{id}/pub")).unwrap();
        assert_eq!(root.provider_id.as_str(), "ftp");
        assert_eq!(
            root.join("file.txt").unwrap().uri,
            format!("{scheme}://{id}/pub/file.txt")
        );
    }
}
use proptest::prelude::*;

#[test]
fn parses_local_archive_and_search_uris_and_rejects_unknown_providers() {
    let location = Location::parse("file:///Users/erik/Documents").unwrap();
    assert_eq!(location.provider_id, ProviderId::new("local"));

    let archive = Location::parse("archive:///tmp/example.zip!/docs").unwrap();
    assert_eq!(archive.provider_id, ProviderId::new("archive"));
    let search = Location::parse("search://local/11111111-1111-4111-8111-111111111111").unwrap();
    assert_eq!(search.provider_id, ProviderId::new("search"));
    assert_eq!(
        Location::parse("search://local?query=report"),
        Err(LocationError::InvalidUri)
    );
    assert_eq!(
        Location::parse("https://example.test"),
        Err(LocationError::UnknownProvider("https".to_owned()))
    );
}

#[test]
fn sftp_locations_reference_a_connection_id_rather_than_a_host() {
    let connection_id = "11111111-1111-4111-8111-111111111111";
    let location = Location::parse(&format!("sftp://{connection_id}/home/erik")).unwrap();
    assert_eq!(location.provider_id, ProviderId::new("sftp"));

    // A non-UUID authority is not a valid connection id.
    assert_eq!(
        Location::parse("sftp://example.test/home"),
        Err(LocationError::InvalidUri)
    );
    // No path at all (missing the mandatory leading `/`) is invalid.
    assert_eq!(
        Location::parse(&format!("sftp://{connection_id}")),
        Err(LocationError::InvalidUri)
    );
    // The bare root is valid.
    assert!(Location::parse(&format!("sftp://{connection_id}/")).is_ok());
}

#[test]
fn sftp_locations_support_safe_path_navigation() {
    let connection_id = "11111111-1111-4111-8111-111111111111";
    let root = Location::parse(&format!("sftp://{connection_id}/")).unwrap();
    let home = root.join("home").unwrap();
    let user = home.join("erik").unwrap();

    assert_eq!(user.uri, format!("sftp://{connection_id}/home/erik"));
    assert_eq!(user.name().unwrap(), "erik");
    assert_eq!(user.parent().unwrap(), Some(home.clone()));
    assert_eq!(root.parent().unwrap(), None);
    assert_eq!(
        root.join("../escape"),
        Err(LocationError::InvalidName("../escape".to_owned()))
    );

    let with_space = home.join("My Documents").unwrap();
    assert_eq!(
        with_space.uri,
        format!("sftp://{connection_id}/home/My%20Documents")
    );
    assert_eq!(with_space.name().unwrap(), "My Documents");

    assert!(user.to_native_path().is_err());
}

#[test]
fn sftp_locations_reject_traversal_and_reserved_names() {
    let connection_id = "11111111-1111-4111-8111-111111111111";
    assert_eq!(
        Location::parse(&format!("sftp://{connection_id}//double-slash")),
        Err(LocationError::EmptySegment)
    );
    assert_eq!(
        Location::parse(&format!("sftp://{connection_id}/CON.txt")),
        Err(LocationError::ReservedWindowsName("CON.txt".to_owned()))
    );
}

#[test]
fn try_new_validates_the_sftp_provider_matches_the_scheme() {
    let connection_id = "11111111-1111-4111-8111-111111111111";
    assert_eq!(
        Location::try_new(
            ProviderId::new("local"),
            format!("sftp://{connection_id}/home")
        ),
        Err(LocationError::MismatchedProvider {
            provider_id: "local".to_owned(),
            scheme: "sftp".to_owned(),
        })
    );
    assert!(
        Location::try_new(
            ProviderId::new("sftp"),
            format!("sftp://{connection_id}/home")
        )
        .is_ok()
    );
}

#[test]
fn archive_locations_support_safe_inner_path_navigation() {
    let root = Location::parse("archive:///tmp/example.zip!").unwrap();
    let docs = root.join("docs").unwrap();
    let report = docs.join("Q4 report.txt").unwrap();

    assert_eq!(docs.uri, "archive:///tmp/example.zip!/docs");
    assert_eq!(report.name().unwrap(), "Q4 report.txt");
    assert_eq!(report.parent().unwrap(), Some(docs));
    assert_eq!(root.parent().unwrap(), None);
    assert_eq!(
        root.join("../escape"),
        Err(LocationError::InvalidName("../escape".to_owned()))
    );
    assert_eq!(
        Location::parse("archive:///tmp/example.zip!/../escape"),
        Err(LocationError::InvalidName("..".to_owned()))
    );
    assert_eq!(
        Location::parse("archive:///tmp/example.zip/docs"),
        Err(LocationError::InvalidUri)
    );
    assert!(root.to_native_path().is_err());
}

#[test]
fn validates_provider_and_rejects_invalid_segments() {
    assert_eq!(
        Location::try_new(ProviderId::new("archive"), "file:///tmp"),
        Err(LocationError::MismatchedProvider {
            provider_id: "archive".to_owned(),
            scheme: "file".to_owned(),
        })
    );
    assert_eq!(
        Location::parse("file:///tmp/a%00b"),
        Err(LocationError::NullByte)
    );
    assert_eq!(
        Location::parse("file://server%00name/share"),
        Err(LocationError::NullByte)
    );
    assert_eq!(
        Location::parse("file:///tmp//file"),
        Err(LocationError::EmptySegment)
    );
    assert_eq!(
        Location::parse("file:///tmp/CON.txt"),
        Err(LocationError::ReservedWindowsName("CON.txt".to_owned()))
    );
}

#[test]
fn search_locations_parse_but_reject_file_specific_operations() {
    let location = Location::parse("search://local/11111111-1111-4111-8111-111111111111").unwrap();
    assert_eq!(location.provider_id, ProviderId::new("search"));

    assert_eq!(
        Location::parse("search://local/"),
        Err(LocationError::InvalidUri)
    );
    assert_eq!(
        Location::parse("search://other/11111111-1111-4111-8111-111111111111"),
        Err(LocationError::InvalidUri)
    );
    assert_eq!(
        Location::parse("search://local/one/two"),
        Err(LocationError::InvalidUri)
    );

    assert!(location.to_native_path().is_err());
    assert!(location.join("child").is_err());
    assert!(location.name().is_err());
    assert!(location.parent().is_err());
}

#[test]
fn normalizes_lexically_within_a_configured_root() {
    let root = Location::parse("file:///Users/erik").unwrap();
    let location = Location::parse("file:///Users/erik/work/./drafts/../report.txt").unwrap();

    assert_eq!(
        location.normalize_within(&root).unwrap().uri,
        "file:///Users/erik/work/report.txt"
    );
    assert_eq!(
        Location::parse("file:///Users/erik/../../etc")
            .unwrap()
            .normalize_within(&root),
        Err(LocationError::EscapesRoot)
    );
}

#[test]
fn safe_helpers_operate_on_decoded_path_segments() {
    let directory = Location::parse("file:///Users/erik/My%20Documents").unwrap();
    let child = directory.join("Q4 report $(final).txt").unwrap();

    assert_eq!(
        child.uri,
        "file:///Users/erik/My%20Documents/Q4%20report%20%24%28final%29.txt"
    );
    assert_eq!(child.name().unwrap(), "Q4 report $(final).txt");
    assert_eq!(child.parent().unwrap(), Some(directory));
    assert_eq!(
        child.join("../escape"),
        Err(LocationError::InvalidName("../escape".to_owned()))
    );
}

#[cfg(unix)]
#[test]
fn posix_native_paths_preserve_unicode_non_nfc_and_sensitive_characters() {
    let path = Path::new("/tmp/Cafe\u{301}/Q4 report $(final).txt");
    let location = Location::from_native_path(path).unwrap();

    assert_eq!(
        location.uri,
        "file:///tmp/Cafe%CC%81/Q4%20report%20%24%28final%29.txt"
    );
    assert_eq!(location.to_native_path().unwrap(), path);
}

#[cfg(windows)]
#[test]
fn windows_drive_unc_and_long_paths_round_trip() {
    for path in [
        r"C:\Users\Erik\My Documents\report.txt",
        r"\\server\share\dir\report.txt",
    ] {
        let path = Path::new(path);
        let location = Location::from_native_path(path).unwrap();
        assert_eq!(location.to_native_path().unwrap(), path);
    }

    let long = format!(
        r"\\?\C:\{}",
        "long-segment\\".repeat(30).trim_end_matches('\\')
    );
    let location = Location::from_native_path(Path::new(&long)).unwrap();
    assert_eq!(location.to_native_path().unwrap(), Path::new(&long));
}

#[cfg(windows)]
#[test]
fn windows_drive_and_share_roots_are_navigable_locations() {
    let drive = Location::from_native_path(Path::new(r"C:\")).unwrap();
    assert_eq!(drive.uri, "file:///C:");
    assert_eq!(drive.to_native_path().unwrap(), Path::new(r"C:\"));

    let share = Location::from_native_path(Path::new(r"\\server\share")).unwrap();
    assert_eq!(
        share.to_native_path().unwrap(),
        Path::new(r"\\server\share")
    );
}

#[test]
fn a_trailing_slash_addresses_the_same_directory_as_its_bare_form() {
    assert_eq!(Location::parse("file:///C:/").unwrap().uri, "file:///C:");
    assert_eq!(
        Location::parse("file:///home/erik/").unwrap().uri,
        "file:///home/erik"
    );
    assert!(Location::parse("file:///home//erik").is_err());
}

proptest! {
    #[test]
    fn native_path_location_round_trip_is_lossless(
        segments in prop::collection::vec(
            "[A-Za-z0-9 _.$()é]{1,20}"
                .prop_filter("path components cannot be traversal tokens", |name| name != "." && name != "..")
                .prop_filter("path components cannot be reserved Windows device names", |name| {
                    fm_domain::location::validate_name(name).is_ok()
                }),
            1..8
        )
    ) {
        #[cfg(unix)]
        {
            let path = segments.iter().fold(std::path::PathBuf::from("/"), |path, segment| path.join(segment));
            let location = Location::from_native_path(&path).unwrap();
            prop_assert_eq!(location.to_native_path().unwrap(), path);
        }

        #[cfg(windows)]
        {
            let path = segments.iter().fold(std::path::PathBuf::from(r"C:\"), |path, segment| path.join(segment));
            let location = Location::from_native_path(&path).unwrap();
            prop_assert_eq!(location.to_native_path().unwrap(), path);
        }
    }
}
