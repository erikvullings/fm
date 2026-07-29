//! Windows platform integration (task 0060).
//!
//! Shell icons, Explorer reveal, Recycle Bin, drive listing, UNC and long path
//! handling, junctions and shortcuts. The crate is a workspace member
//! everywhere but compiles to nothing off Windows.

#![cfg(target_os = "windows")]
