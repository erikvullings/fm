//! Settings persistence (task 0030).
//!
//! Settings are versioned and migrated rather than discarded when the schema
//! changes (specification §26), and are written atomically so a crash cannot
//! leave a half-written configuration behind.
