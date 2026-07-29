//! macOS platform integration (task 0059).
//!
//! File icons, Finder reveal, Trash, mounted volumes, native menus and
//! terminal integration. The crate is a workspace member everywhere but
//! compiles to nothing off macOS.

#![cfg(target_os = "macos")]
