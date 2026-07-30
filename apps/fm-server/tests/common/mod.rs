//! Shared test helpers: spawns the real Axum host on an ephemeral port with
//! workspace storage isolated to a temp directory, so integration tests
//! never touch the developer's real platform config directory.

use std::net::{IpAddr, Ipv4Addr};

use fm_server::config::ServerConfig;

/// A spawned test server plus the `TempDir` its workspace storage lives in.
///
/// The `TempDir` must be kept alive for the duration of the test (dropping it
/// deletes the directory), so it is returned alongside the server handle
/// rather than being an internal detail.
pub(crate) struct TestServer {
    pub(crate) base_url: String,
    pub(crate) handle: tokio::task::JoinHandle<()>,
    _workspace_directory: tempfile::TempDir,
}

impl TestServer {
    pub(crate) async fn spawn() -> Self {
        let workspace_directory =
            tempfile::tempdir().expect("must create a temp workspace directory");
        let config = ServerConfig {
            bind_address: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: 0,
            workspace_directory: workspace_directory.path().to_path_buf(),
            ..ServerConfig::default()
        };
        let router = fm_server::build_router(&config);

        let listener = tokio::net::TcpListener::bind((config.bind_address, config.port))
            .await
            .expect("failed to bind an ephemeral port");
        let addr = listener
            .local_addr()
            .expect("bound listener must have a local address");

        let handle = tokio::spawn(async move {
            axum::serve(listener, router)
                .await
                .expect("test server exited unexpectedly");
        });

        Self {
            base_url: format!("http://{addr}"),
            handle,
            _workspace_directory: workspace_directory,
        }
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.handle.abort();
    }
}
