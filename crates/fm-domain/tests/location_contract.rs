//! Public contract tests for location parsing and native path conversion.

use std::path::Path;

use fm_domain::{Location, LocationError, ProviderId};
use proptest::prelude::*;

#[test]
fn parses_local_uri_and_rejects_reserved_and_unknown_providers() {
    let location = Location::parse("file:///Users/erik/Documents").unwrap();
    assert_eq!(location.provider_id, ProviderId::new("local"));

    assert_eq!(
        Location::parse("archive:///tmp/example.zip!/docs"),
        Err(LocationError::UnsupportedProvider("archive".to_owned()))
    );
    assert_eq!(
        Location::parse("search://local?query=report"),
        Err(LocationError::UnsupportedProvider("search".to_owned()))
    );
    assert_eq!(
        Location::parse("sftp://example.test/home"),
        Err(LocationError::UnsupportedProvider("sftp".to_owned()))
    );
    assert_eq!(
        Location::parse("https://example.test"),
        Err(LocationError::UnknownProvider("https".to_owned()))
    );
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

proptest! {
    #[test]
    fn native_path_location_round_trip_is_lossless(
        segments in prop::collection::vec(
            "[A-Za-z0-9 _.$()é]{1,20}"
                .prop_filter("path components cannot be traversal tokens", |name| name != "." && name != ".."),
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
