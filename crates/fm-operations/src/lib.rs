//! The operation engine (task 0035).
//!
//! Every mutating action - create, rename, copy, move, duplicate, trash and
//! delete - is a cancellable job owned by the backend and reported through
//! progress events. The individual kinds are implemented one at a time in
//! tasks 0037 to 0044.
