//! The local filesystem provider (task 0018).
//!
//! Responsible for the awkward cases the rest of the application should never
//! have to think about: hidden entries, symbolic links, Windows reparse points
//! and junctions, unreadable directories, very long paths and Unicode names.
//!
//! Symbolic links are never followed recursively by default.
