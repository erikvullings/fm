//! Backend-to-frontend events.
//!
//! The envelope and payload types are defined in task 0014 and the bus itself
//! in task 0031. The SSE endpoint (task 0032) and the Tauri channel
//! (task 0034) are both thin adapters over this crate, which is what keeps the
//! two transports at parity.
