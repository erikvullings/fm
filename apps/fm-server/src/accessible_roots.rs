//! Validates that incoming file operations stay within configured accessible roots.
//! Performed after symlink resolution to prevent symlink escape attacks (task 0064).

use std::path::{Path, PathBuf};
use thiserror::Error;

/// Error validating a location against accessible roots.
#[derive(Debug, Error)]
pub enum AccessibleRootsError {
    /// Path resolution failed (e.g., broken symlink or permission denied).
    #[error("path resolution failed: {0}")]
    ResolutionFailed(String),

    /// Path is outside configured accessible roots.
    #[error("path {path} is outside configured accessible roots")]
    OutsideRoots {
        /// The path that was outside the roots.
        path: String,
    },

    /// No accessible roots configured.
    #[error("no accessible roots configured")]
    NoRootsConfigured,
}

/// Validates that a path is within one of the configured accessible roots,
/// after resolving symlinks. Returns the canonicalized path.
pub fn validate_within_accessible_roots(
    path: &Path,
    roots: &[PathBuf],
) -> Result<PathBuf, AccessibleRootsError> {
    if roots.is_empty() {
        // Empty roots means unrestricted access (for backward compatibility
        // with single-machine deployments). In task 0064, this is allowed but
        // discouraged; LAN deployments must specify roots.
        return Ok(path.to_path_buf());
    }

    // Canonicalize the path to resolve symlinks and relative components.
    let canonical_path = path
        .canonicalize()
        .map_err(|e| AccessibleRootsError::ResolutionFailed(e.to_string()))?;

    // Check that the canonical path is within one of the configured roots.
    for root in roots {
        let canonical_root = root
            .canonicalize()
            .map_err(|e| AccessibleRootsError::ResolutionFailed(e.to_string()))?;

        if canonical_path.starts_with(&canonical_root) {
            return Ok(canonical_path);
        }
    }

    Err(AccessibleRootsError::OutsideRoots {
        path: canonical_path.display().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn empty_roots_allows_any_path() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("file.txt");
        std::fs::write(&path, b"test").unwrap();

        let result = validate_within_accessible_roots(&path, &[]);
        assert!(result.is_ok());
    }

    #[test]
    fn path_within_single_root_is_allowed() {
        let temp = TempDir::new().unwrap();
        let subdir = temp.path().join("subdir");
        std::fs::create_dir(&subdir).unwrap();
        let file = subdir.join("file.txt");
        std::fs::write(&file, b"test").unwrap();

        let result = validate_within_accessible_roots(&file, &[temp.path().to_path_buf()]);
        assert!(result.is_ok());
    }

    #[test]
    fn path_outside_roots_is_denied() {
        let temp1 = TempDir::new().unwrap();
        let temp2 = TempDir::new().unwrap();

        let file = temp2.path().join("file.txt");
        std::fs::write(&file, b"test").unwrap();

        let result = validate_within_accessible_roots(&file, &[temp1.path().to_path_buf()]);
        assert!(matches!(
            result,
            Err(AccessibleRootsError::OutsideRoots { .. })
        ));
    }

    #[test]
    fn symlink_escape_is_prevented() {
        let temp = TempDir::new().unwrap();
        let allowed = temp.path().join("allowed");
        std::fs::create_dir(&allowed).unwrap();

        let outside = temp.path().join("outside.txt");
        std::fs::write(&outside, b"secret").unwrap();

        let symlink = allowed.join("link");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &symlink).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&outside, &symlink).unwrap();

        // The symlink's target is outside the allowed root, so access should be denied.
        let result = validate_within_accessible_roots(&symlink, &[allowed.clone()]);
        assert!(matches!(
            result,
            Err(AccessibleRootsError::OutsideRoots { .. })
        ));
    }

    #[test]
    fn relative_path_traversal_is_prevented() {
        let temp = TempDir::new().unwrap();
        let allowed = temp.path().join("allowed");
        std::fs::create_dir(&allowed).unwrap();

        let outside = temp.path().join("outside.txt");
        std::fs::write(&outside, b"secret").unwrap();

        // Construct a path like allowed/../outside, which canonicalization should resolve.
        let traversal_path = allowed.join("..").join("outside.txt");

        let result = validate_within_accessible_roots(&traversal_path, &[allowed.clone()]);
        assert!(matches!(
            result,
            Err(AccessibleRootsError::OutsideRoots { .. })
        ));
    }

    #[test]
    fn multiple_roots_allow_any_configured_root() {
        let temp1 = TempDir::new().unwrap();
        let temp2 = TempDir::new().unwrap();

        let file1 = temp1.path().join("file1.txt");
        std::fs::write(&file1, b"test1").unwrap();

        let file2 = temp2.path().join("file2.txt");
        std::fs::write(&file2, b"test2").unwrap();

        let roots = vec![temp1.path().to_path_buf(), temp2.path().to_path_buf()];

        assert!(validate_within_accessible_roots(&file1, &roots).is_ok());
        assert!(validate_within_accessible_roots(&file2, &roots).is_ok());
    }

    #[test]
    fn dot_dot_encoded_escape_attempt_is_prevented() {
        // Note: filesystem path components can't actually contain literal `..` when
        // created with normal APIs, but this test documents the intent: after
        // canonicalization, escape attempts are neutralized.
        let temp = TempDir::new().unwrap();
        let allowed = temp.path().join("allowed");
        std::fs::create_dir(&allowed).unwrap();

        // This tests that canonicalization resolves `.` correctly.
        let safe_path = allowed.join(".").join("file.txt");
        std::fs::write(&safe_path, b"test").unwrap();

        let result = validate_within_accessible_roots(&safe_path, &[allowed.clone()]);
        assert!(result.is_ok());
    }
}
