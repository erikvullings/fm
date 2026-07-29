//! Platform adapter traits (task 0058).
//!
//! Platform differences are expressed as explicit capabilities
//! (specification §3 rule 10) rather than as conditional compilation at every
//! call site. A fallback implementation keeps browser/server mode and
//! unsupported platforms working.
