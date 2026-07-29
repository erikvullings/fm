//! The virtual filesystem provider abstraction (task 0016).
//!
//! Keeping the engine behind a provider trait is what allows archives, search
//! results and remote filesystems to be added later without redesigning the
//! core. Providers advertise what they can do through capability flags rather
//! than failing at call time.
