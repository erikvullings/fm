//! Core domain model shared by every other crate.
//!
//! Task 0006 fills this in with strongly typed identifiers, the
//! provider-neutral `Location` type, entry summaries, workspace/pane/tab state
//! and directory snapshots.
//!
//! This crate sits at the bottom of the dependency graph: it must never depend
//! on a transport, a provider or a host.
