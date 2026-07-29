//! Plugin discovery and execution (task 0054).
//!
//! Enforces the declared permissions, applies execution timeouts and isolates
//! failures, so that a misbehaving plugin degrades to a notification rather
//! than taking down the application.
