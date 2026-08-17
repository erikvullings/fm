//! Per-directory git working-tree status (task 0135), local provider only.
//!
//! [`GitStatusService`] discovers the git working tree (if any) that owns a
//! listed directory, computes each changed path's status with a single
//! [`git2`] status walk per repository, and caches both the repo-root lookup
//! and the computed status map. Directories that sit outside any working
//! tree are cached as such, so repeatedly listing a large non-git directory
//! tree never re-probes git2.
//!
//! Callers invalidate the cached status for a directory's repository (e.g.
//! on a filesystem-watch event) via [`GitStatusService::invalidate`]; the
//! next [`GitStatusService::annotate`] call recomputes it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use fm_domain::{EntryKind, EntrySummary, GitFileStatus};

/// Computes and caches git working-tree status for directory listings.
#[derive(Default)]
pub struct GitStatusService {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    /// Listed directory -> the working tree root that owns it, or `None`
    /// when the directory is confirmed to sit outside any git working tree.
    repo_roots: HashMap<PathBuf, Option<PathBuf>>,
    /// Working tree root -> its most recently computed status.
    statuses: HashMap<PathBuf, Arc<RepoStatus>>,
}

#[derive(Default)]
struct RepoStatus {
    /// Path (relative to the repo root) -> status, for every non-clean file.
    /// Absent entries are clean (git2 only reports non-current paths).
    files: HashMap<PathBuf, GitFileStatus>,
    /// Path (relative to the repo root) -> aggregated status, for every
    /// ancestor directory of a non-clean file.
    dirs: HashMap<PathBuf, GitFileStatus>,
}

impl GitStatusService {
    /// Creates an empty service with nothing cached yet.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Annotates `entries` (the direct children of `dir`, a native
    /// filesystem path) with their git status.
    ///
    /// A no-op — every entry's `git_status` is left as-is — when `dir` sits
    /// outside any git working tree; that fact is cached, so a directory
    /// tree with no `.git` anywhere never triggers more than one discovery
    /// probe per listed directory.
    pub fn annotate(&self, dir: &Path, entries: &mut [EntrySummary]) {
        let dir = canonical(dir);
        let Some(repo_root) = self.repo_root_for(&dir) else {
            return;
        };
        let Ok(rel_dir) = dir.strip_prefix(&repo_root) else {
            return;
        };
        let status = self.status_for(&repo_root);
        for entry in entries {
            let rel_path = if rel_dir.as_os_str().is_empty() {
                PathBuf::from(&entry.name)
            } else {
                rel_dir.join(&entry.name)
            };
            let found = match entry.kind {
                EntryKind::Directory => status.dirs.get(&rel_path).copied(),
                EntryKind::File | EntryKind::Symlink => status.files.get(&rel_path).copied(),
            };
            entry.git_status = Some(found.unwrap_or(GitFileStatus::Clean));
        }
    }

    /// Drops the cached status for `dir`'s working tree, if one is cached,
    /// so the next [`Self::annotate`] call recomputes it. A no-op when
    /// `dir`'s repo-root membership has not been discovered yet (nothing is
    /// cached to invalidate; the next `annotate` call already computes it
    /// fresh).
    pub fn invalidate(&self, dir: &Path) {
        let dir = canonical(dir);
        let mut inner = self.inner.lock().expect("git status lock poisoned");
        if let Some(Some(root)) = inner.repo_roots.get(&dir).cloned() {
            inner.statuses.remove(&root);
        }
    }

    fn repo_root_for(&self, dir: &Path) -> Option<PathBuf> {
        {
            let inner = self.inner.lock().expect("git status lock poisoned");
            if let Some(cached) = inner.repo_roots.get(dir) {
                return cached.clone();
            }
        }
        let root = discover_repo_root(dir);
        let mut inner = self.inner.lock().expect("git status lock poisoned");
        inner.repo_roots.insert(dir.to_path_buf(), root.clone());
        root
    }

    fn status_for(&self, repo_root: &Path) -> Arc<RepoStatus> {
        {
            let inner = self.inner.lock().expect("git status lock poisoned");
            if let Some(cached) = inner.statuses.get(repo_root) {
                return Arc::clone(cached);
            }
        }
        let computed = Arc::new(compute_repo_status(repo_root).unwrap_or_default());
        let mut inner = self.inner.lock().expect("git status lock poisoned");
        inner
            .statuses
            .insert(repo_root.to_path_buf(), Arc::clone(&computed));
        computed
    }

    #[cfg(test)]
    fn repo_root_is_cached(&self, dir: &Path) -> bool {
        self.inner
            .lock()
            .expect("git status lock poisoned")
            .repo_roots
            .contains_key(&canonical(dir))
    }
}

/// Resolves symlinks (e.g. macOS's `/var` -> `/private/var` `TMPDIR`) so a
/// listed directory's path matches the realpath `git2` reports as a
/// repository's working directory. Falls back to the original path if it no
/// longer exists (e.g. it was just deleted).
fn canonical(dir: &Path) -> PathBuf {
    dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf())
}

/// Finds the working tree that owns `dir`, if any. Bare repositories (no
/// working directory) are treated as "no working tree" — there is nothing
/// to show a status for.
fn discover_repo_root(dir: &Path) -> Option<PathBuf> {
    let repo = git2::Repository::discover(dir).ok()?;
    repo.workdir().map(Path::to_path_buf)
}

/// Walks the whole repository's status once via `git2` and aggregates it
/// both per-file and per-ancestor-directory.
fn compute_repo_status(repo_root: &Path) -> Option<RepoStatus> {
    let repo = git2::Repository::open(repo_root).ok()?;
    let mut options = git2::StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(true)
        .recurse_ignored_dirs(true);
    let statuses = repo.statuses(Some(&mut options)).ok()?;

    let mut files = HashMap::new();
    for entry in statuses.iter() {
        let Some(path) = entry.path() else { continue };
        files.insert(PathBuf::from(path), classify(entry.status()));
    }

    let mut dirs: HashMap<PathBuf, GitFileStatus> = HashMap::new();
    for (path, status) in &files {
        let mut ancestor = path.parent();
        while let Some(parent) = ancestor {
            if parent.as_os_str().is_empty() {
                break;
            }
            dirs.entry(parent.to_path_buf())
                .and_modify(|existing| {
                    if priority(*status) > priority(*existing) {
                        *existing = *status;
                    }
                })
                .or_insert(*status);
            ancestor = parent.parent();
        }
    }

    Some(RepoStatus { files, dirs })
}

/// Maps `git2`'s bitflags onto the single status the column shows,
/// preferring the change most likely to need the user's attention: an
/// unstaged working-tree edit outranks a staged one, which outranks an
/// untracked file, which outranks an ignored one.
fn classify(flags: git2::Status) -> GitFileStatus {
    use git2::Status;
    if flags.intersects(
        Status::WT_MODIFIED
            | Status::WT_DELETED
            | Status::WT_TYPECHANGE
            | Status::WT_RENAMED
            | Status::CONFLICTED,
    ) {
        GitFileStatus::Modified
    } else if flags.intersects(
        Status::INDEX_NEW
            | Status::INDEX_MODIFIED
            | Status::INDEX_DELETED
            | Status::INDEX_RENAMED
            | Status::INDEX_TYPECHANGE,
    ) {
        GitFileStatus::Staged
    } else if flags.contains(Status::WT_NEW) {
        GitFileStatus::Untracked
    } else if flags.contains(Status::IGNORED) {
        GitFileStatus::Ignored
    } else {
        GitFileStatus::Clean
    }
}

fn priority(status: GitFileStatus) -> u8 {
    match status {
        GitFileStatus::Modified => 4,
        GitFileStatus::Staged => 3,
        GitFileStatus::Untracked => 2,
        GitFileStatus::Ignored => 1,
        GitFileStatus::Clean => 0,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use fm_domain::{EntryId, EntryKind, GitFileStatus, Location, ProviderId};

    use super::*;

    fn entry(dir: &Path, name: &str, kind: EntryKind) -> EntrySummary {
        EntrySummary {
            id: EntryId::new(),
            location: Location::new(
                ProviderId::new("local"),
                format!("file://{}", dir.join(name).display()),
            ),
            name: name.to_owned(),
            kind,
            size: Some(0),
            modified_at: None,
            created_at: None,
            hidden: false,
            read_only: false,
            extension: None,
            mime_type: None,
            icon_key: None,
            metadata_revision: 0,
            git_status: None,
        }
    }

    fn init_repo(root: &Path) -> git2::Repository {
        let repo = git2::Repository::init(root).expect("init repo");
        {
            let mut config = repo.config().expect("repo config");
            config.set_str("user.name", "Test").expect("set name");
            config
                .set_str("user.email", "test@example.com")
                .expect("set email");
        }
        repo
    }

    fn commit_all(repo: &git2::Repository, message: &str) {
        let mut index = repo.index().expect("index");
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .expect("stage all");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let signature = repo.signature().expect("signature");
        let parents: Vec<git2::Commit> = repo
            .head()
            .ok()
            .and_then(|head| head.peel_to_commit().ok())
            .into_iter()
            .collect();
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parent_refs,
        )
        .expect("commit");
    }

    #[test]
    fn non_git_directory_is_a_no_op_fast_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("plain.txt"), b"hello").expect("write file");

        let service = GitStatusService::new();
        let mut entries = vec![entry(dir.path(), "plain.txt", EntryKind::File)];
        service.annotate(dir.path(), &mut entries);

        assert_eq!(entries[0].git_status, None);
        assert!(service.repo_root_is_cached(dir.path()));

        // A second call must not re-probe git2 (there is nothing left on
        // disk to discover from) yet must still behave identically.
        fs::remove_dir_all(dir.path()).ok();
        let mut entries = vec![entry(dir.path(), "plain.txt", EntryKind::File)];
        service.annotate(dir.path(), &mut entries);
        assert_eq!(entries[0].git_status, None);
    }

    #[test]
    fn clean_tracked_file_has_clean_status() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.txt"), b"a").expect("write file");
        let repo = init_repo(dir.path());
        commit_all(&repo, "initial");

        let service = GitStatusService::new();
        let mut entries = vec![entry(dir.path(), "a.txt", EntryKind::File)];
        service.annotate(dir.path(), &mut entries);

        assert_eq!(entries[0].git_status, Some(GitFileStatus::Clean));
    }

    #[test]
    fn modified_tracked_file_is_reported_modified() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.txt"), b"a").expect("write file");
        let repo = init_repo(dir.path());
        commit_all(&repo, "initial");
        fs::write(dir.path().join("a.txt"), b"changed").expect("modify file");

        let service = GitStatusService::new();
        let mut entries = vec![entry(dir.path(), "a.txt", EntryKind::File)];
        service.annotate(dir.path(), &mut entries);

        assert_eq!(entries[0].git_status, Some(GitFileStatus::Modified));
    }

    #[test]
    fn staged_file_is_reported_staged() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.txt"), b"a").expect("write file");
        let repo = init_repo(dir.path());
        commit_all(&repo, "initial");
        fs::write(dir.path().join("a.txt"), b"staged change").expect("modify file");
        let mut index = repo.index().expect("index");
        index.add_path(Path::new("a.txt")).expect("stage file");
        index.write().expect("write index");

        let service = GitStatusService::new();
        let mut entries = vec![entry(dir.path(), "a.txt", EntryKind::File)];
        service.annotate(dir.path(), &mut entries);

        assert_eq!(entries[0].git_status, Some(GitFileStatus::Staged));
    }

    #[test]
    fn untracked_file_is_reported_untracked() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = init_repo(dir.path());
        commit_all(&repo, "empty");
        fs::write(dir.path().join("new.txt"), b"new").expect("write file");

        let service = GitStatusService::new();
        let mut entries = vec![entry(dir.path(), "new.txt", EntryKind::File)];
        service.annotate(dir.path(), &mut entries);

        assert_eq!(entries[0].git_status, Some(GitFileStatus::Untracked));
    }

    #[test]
    fn ignored_file_is_reported_ignored() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join(".gitignore"), b"ignored.txt\n").expect("write gitignore");
        let repo = init_repo(dir.path());
        commit_all(&repo, "add gitignore");
        fs::write(dir.path().join("ignored.txt"), b"ignore me").expect("write file");

        let service = GitStatusService::new();
        let mut entries = vec![entry(dir.path(), "ignored.txt", EntryKind::File)];
        service.annotate(dir.path(), &mut entries);

        assert_eq!(entries[0].git_status, Some(GitFileStatus::Ignored));
    }

    #[test]
    fn directory_aggregates_a_modified_descendant() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir(dir.path().join("sub")).expect("mkdir sub");
        fs::write(dir.path().join("sub/nested.txt"), b"a").expect("write nested");
        fs::write(dir.path().join("clean-sub2.txt"), b"b").expect("write sibling");
        let repo = init_repo(dir.path());
        commit_all(&repo, "initial");
        fs::write(dir.path().join("sub/nested.txt"), b"changed").expect("modify nested");

        let service = GitStatusService::new();
        let mut entries = vec![
            entry(dir.path(), "sub", EntryKind::Directory),
            entry(dir.path(), "clean-sub2.txt", EntryKind::File),
        ];
        service.annotate(dir.path(), &mut entries);

        assert_eq!(entries[0].git_status, Some(GitFileStatus::Modified));
        assert_eq!(entries[1].git_status, Some(GitFileStatus::Clean));
    }

    #[test]
    fn directory_aggregate_prefers_highest_priority_descendant_status() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir(dir.path().join("sub")).expect("mkdir sub");
        fs::write(dir.path().join("sub/tracked.txt"), b"a").expect("write tracked");
        let repo = init_repo(dir.path());
        commit_all(&repo, "initial");
        // One descendant is merely untracked, the other is a modified
        // tracked file — the directory must reflect the higher-priority one.
        fs::write(dir.path().join("sub/tracked.txt"), b"changed").expect("modify tracked");
        fs::write(dir.path().join("sub/untracked.txt"), b"new").expect("add untracked");

        let service = GitStatusService::new();
        let mut entries = vec![entry(dir.path(), "sub", EntryKind::Directory)];
        service.annotate(dir.path(), &mut entries);

        assert_eq!(entries[0].git_status, Some(GitFileStatus::Modified));
    }

    #[test]
    fn cached_status_is_reused_until_invalidated() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.txt"), b"a").expect("write file");
        let repo = init_repo(dir.path());
        commit_all(&repo, "initial");

        let service = GitStatusService::new();
        let mut entries = vec![entry(dir.path(), "a.txt", EntryKind::File)];
        service.annotate(dir.path(), &mut entries);
        assert_eq!(entries[0].git_status, Some(GitFileStatus::Clean));

        fs::write(dir.path().join("a.txt"), b"changed").expect("modify file");

        // Without invalidation the stale, cached status is served.
        let mut entries = vec![entry(dir.path(), "a.txt", EntryKind::File)];
        service.annotate(dir.path(), &mut entries);
        assert_eq!(entries[0].git_status, Some(GitFileStatus::Clean));

        service.invalidate(dir.path());

        let mut entries = vec![entry(dir.path(), "a.txt", EntryKind::File)];
        service.annotate(dir.path(), &mut entries);
        assert_eq!(entries[0].git_status, Some(GitFileStatus::Modified));
    }

    #[test]
    fn invalidating_an_unknown_directory_is_a_no_op() {
        let dir = tempfile::tempdir().expect("tempdir");
        let service = GitStatusService::new();
        service.invalidate(dir.path());
    }
}
