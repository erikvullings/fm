use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use fm_domain::Location;
use thiserror::Error;

/// Filesystem entry shape used by replacement safety checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryType {
    /// Regular file.
    File,
    /// Directory.
    Directory,
    /// Symbolic link or platform equivalent.
    Symlink,
}

/// A shared preflight check rejected an unsafe operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum SafetyError {
    /// Source and destination identify the same entry.
    #[error("source and destination are the same entry")]
    SameEntry,
    /// Destination is nested beneath the source.
    #[error("destination is inside source")]
    DestinationInsideSource,
    /// Names differ only by case on a case-insensitive filesystem.
    #[error("source and destination differ only by case")]
    CaseOnlyDifference,
    /// Recursive traversal revisited a filesystem identity.
    #[error("symbolic-link cycle detected")]
    SymlinkCycle,
    /// Replacement would exchange a file and a directory.
    #[error("cannot replace a file with a directory or a directory with a file")]
    EntryTypeMismatch,
    /// Locations cannot be safely compared.
    #[error("locations use different providers or invalid local paths")]
    IncomparableLocations,
}

/// Validates shared source/destination path invariants.
pub fn validate_paths(
    source: &Location,
    destination: &Location,
    case_sensitive: bool,
) -> Result<(), SafetyError> {
    if source.provider_id != destination.provider_id {
        return Err(SafetyError::IncomparableLocations);
    }
    let source_path = normalized_path(source)?;
    let destination_path = normalized_path(destination)?;
    if source_path == destination_path {
        return Err(SafetyError::SameEntry);
    }
    if !case_sensitive {
        let source_folded = source_path.to_string_lossy().to_lowercase();
        let destination_folded = destination_path.to_string_lossy().to_lowercase();
        if source_folded == destination_folded {
            return Err(SafetyError::CaseOnlyDifference);
        }
    }
    if destination_path.starts_with(&source_path) {
        return Err(SafetyError::DestinationInsideSource);
    }
    Ok(())
}

/// Refuses replacement when one side is a directory and the other is not.
pub const fn validate_replacement(
    source: EntryType,
    destination: EntryType,
) -> Result<(), SafetyError> {
    match (source, destination) {
        (EntryType::Directory, EntryType::File | EntryType::Symlink)
        | (EntryType::File | EntryType::Symlink, EntryType::Directory) => {
            Err(SafetyError::EntryTypeMismatch)
        }
        _ => Ok(()),
    }
}

/// Cycle guard keyed by provider-supplied filesystem identity (device, inode/file id).
#[derive(Debug, Default)]
pub struct CycleDetector {
    visited: HashSet<(u64, u128)>,
}

impl CycleDetector {
    /// Records an identity, rejecting a repeated visit.
    pub fn observe(&mut self, filesystem: u64, file_id: u128) -> Result<(), SafetyError> {
        if self.visited.insert((filesystem, file_id)) {
            Ok(())
        } else {
            Err(SafetyError::SymlinkCycle)
        }
    }
}

fn normalized_path(location: &Location) -> Result<PathBuf, SafetyError> {
    let path = location
        .to_native_path()
        .map_err(|_| SafetyError::IncomparableLocations)?;
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(Path::new(other.as_os_str())),
        }
    }
    Ok(normalized)
}
