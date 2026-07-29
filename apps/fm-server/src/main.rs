//! Axum host for the file manager backend.
//!
//! Routing, the runtime capability endpoint and Swagger UI arrive in task 0008,
//! the deterministic OpenAPI export in task 0009, and the SSE endpoint in task
//! 0032. Handlers here stay thin: all behaviour lives in `fm-application`.

fn main() {
    println!("fm-server is not implemented yet; see TASKS/0008-axum-server-runtime-and-docs.md");
}
