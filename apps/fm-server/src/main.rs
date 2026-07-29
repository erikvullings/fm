//! Axum host for the file manager backend (spec §2.2, §8, §9, §21, §33 step 2).
//!
//! The deterministic OpenAPI export command arrives in task 0009, and the SSE
//! endpoint in task 0032. Handlers stay thin: all behaviour lives in
//! `fm-application`.

use std::net::IpAddr;
use std::path::PathBuf;

use clap::Parser;
use fm_server::config::ServerConfig;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

/// Command line and environment configuration for the Axum host.
#[derive(Parser, Debug)]
#[command(name = "fm-server", about = "File manager backend")]
struct Cli {
    /// Address to bind to. Defaults to loopback (spec §22).
    #[arg(long, env = "FM_SERVER_BIND", default_value = "127.0.0.1")]
    bind: IpAddr,
    /// Port to bind to.
    #[arg(long, env = "FM_SERVER_PORT", default_value_t = 4180)]
    port: u16,
    /// Origins allowed to make cross-origin requests. Repeat to allow several;
    /// omit to allow none (spec §22, no wildcard CORS).
    #[arg(
        long = "cors-origin",
        env = "FM_SERVER_CORS_ORIGIN",
        value_delimiter = ','
    )]
    cors_origin: Vec<String>,
    /// Filesystem roots the server is permitted to expose (task 0064).
    #[arg(long = "root", env = "FM_SERVER_ROOT", value_delimiter = ',')]
    root: Vec<PathBuf>,
}

impl From<Cli> for ServerConfig {
    fn from(cli: Cli) -> Self {
        Self {
            bind_address: cli.bind,
            port: cli.port,
            cors_allowed_origins: cli.cors_origin,
            roots: cli.root,
            ..Self::default()
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config: ServerConfig = Cli::parse().into();
    let router = fm_server::build_router(&config);

    let listener = TcpListener::bind((config.bind_address, config.port))
        .await
        .expect("failed to bind fm-server listener");

    tracing::info!(
        bind = %config.bind_address,
        port = config.port,
        roots = ?config.roots,
        "starting fm-server"
    );

    axum::serve(listener, router)
        .await
        .expect("fm-server exited unexpectedly");
}
