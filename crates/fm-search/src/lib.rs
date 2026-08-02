//! Filesystem search (task 0068).
//!
//! Streams results as they are found rather than collecting them, and exposes
//! a completed search as a `search://` virtual location so the existing panes
//! can render it unchanged.

mod engine;
mod matcher;
mod provider;
mod store;

pub use engine::{SearchEngine, SearchError};
pub use matcher::{MatchMode, detect_match_mode, matches_name};
pub use provider::SearchFileSystemProvider;
pub use store::SearchResultsStore;
