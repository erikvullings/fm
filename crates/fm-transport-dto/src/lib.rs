//! Wire types for both hosts (task 0007).
//!
//! DTOs are converted explicitly to and from `fm-domain` types; they are never
//! reused as internal domain models (specification §3 rule 5). Keeping them in
//! one crate is what lets the Tauri commands and the REST endpoints stay
//! byte-for-byte compatible.
