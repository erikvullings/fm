//! Axum host for the file manager backend (spec §2.2, §8, §9, §21, §33 step 2).
//!
//! The SSE endpoint arrives in task 0032. Handlers stay thin: all behaviour
//! lives in `fm-application`.

use std::net::IpAddr;
use std::path::PathBuf;

use clap::{Parser, Subcommand};
use fm_server::config::ServerConfig;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

/// Command line and environment configuration for the Axum host.
#[derive(Parser, Debug)]
#[command(name = "fm-server", about = "File manager backend")]
struct Cli {
    /// Subcommand to run instead of serving (task 0009). Absent means "serve".
    #[command(subcommand)]
    command: Option<Command>,
    /// Address to bind to. Defaults to loopback (spec §22).
    #[arg(long, env = "FM_SERVER_BIND", default_value = "127.0.0.1")]
    bind: IpAddr,
    /// Port to bind to.
    #[arg(
        long,
        env = "FM_SERVER_PORT",
        default_value_t = ServerConfig::default().port
    )]
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

/// Subcommands that run instead of serving requests.
#[derive(Subcommand, Debug)]
enum Command {
    /// Writes the deterministic OpenAPI document to `path` and exits without
    /// binding a port (spec §9).
    ExportOpenapi {
        /// Output file path for the exported OpenAPI document.
        path: PathBuf,
    },
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
    let mut cli = Cli::parse();

    if let Some(Command::ExportOpenapi { path }) = std::mem::take(&mut cli.command) {
        fm_server::openapi_export::write_to_file(&path).unwrap_or_else(|err| {
            panic!(
                "failed to export OpenAPI document to {}: {err}",
                path.display()
            )
        });
        println!("wrote OpenAPI document to {}", path.display());
        return;
    }

    // `notify`'s poll watcher (used for cross-platform directory watching, see
    // docs/architecture/filesystem-watching.md) walks the directory tree on every poll and logs a
    // WARN whenever a transient entry vanishes mid-scan (e.g. macOS's `.VolumeIcon.icns` on volume
    // roots). This is a benign race inherent to polling, not an application error, so it is
    // suppressed regardless of the caller's own `RUST_LOG` filter.
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"))
        .add_directive(
            "notify::poll::data=error"
                .parse()
                .expect("static directive is valid"),
        );

    tracing_subscriber::fmt().with_env_filter(filter).init();

    let config: ServerConfig = cli.into();
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
