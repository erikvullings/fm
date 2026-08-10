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
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

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
    /// DEVELOPMENT ONLY: Disable authentication checks. Logged at startup
    /// and impossible when binding to non-loopback addresses (task 0064).
    #[arg(long, env = "FM_SERVER_DEV_MODE_AUTH_DISABLED")]
    dev_mode_auth_disabled: bool,
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
        // Validate that non-loopback binding doesn't enable dev-mode auth disable.
        let is_loopback = matches!(
            cli.bind,
            IpAddr::V4(addr) if addr.octets()[0] == 127,
        ) || matches!(cli.bind, IpAddr::V6(addr) if addr.is_loopback());

        let dev_mode_auth_disabled = if cli.dev_mode_auth_disabled {
            if !is_loopback {
                panic!(
                    "dev-mode auth disable is not allowed when binding to non-loopback addresses"
                );
            }
            true
        } else {
            false
        };

        Self {
            bind_address: cli.bind,
            port: cli.port,
            cors_allowed_origins: cli.cors_origin,
            roots: cli.root,
            dev_mode_auth_disabled,
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

    init_tracing();

    let config: ServerConfig = cli.into();
    let router = fm_server::build_router(&config);

    let listener = TcpListener::bind((config.bind_address, config.port))
        .await
        .expect("failed to bind fm-server listener");

    // Log security configuration at startup.
    let is_loopback = matches!(
        config.bind_address,
        IpAddr::V4(addr) if addr.octets()[0] == 127,
    ) || matches!(config.bind_address, IpAddr::V6(addr) if addr.is_loopback());

    if !is_loopback {
        tracing::warn!(
            bind = %config.bind_address,
            "binding to non-loopback address; ensure TLS and authentication are configured"
        );
    }

    if config.dev_mode_auth_disabled {
        tracing::warn!("DEVELOPMENT MODE: authentication disabled; do not use in production");
    }

    if config.roots.is_empty() {
        tracing::warn!("no accessible roots configured; server can access entire filesystem");
    }

    tracing::info!(
        bind = %config.bind_address,
        port = config.port,
        loopback_only = is_loopback,
        auth_required = !config.dev_mode_auth_disabled,
        num_roots = config.roots.len(),
        "starting fm-server"
    );

    axum::serve(listener, router)
        .await
        .expect("fm-server exited unexpectedly");
}

/// Initialises structured tracing.
///
/// - `RUST_LOG` controls the level filter (default: `info,notify::poll=error`).
/// - `FM_LOG_FORMAT` controls the output format: `compact` (default), `pretty`, or `json`.
/// - `FM_LOG_FILE` redirects output to a rolling daily log file at the given path prefix (spec §30).
fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,notify::poll=error"));

    let format = std::env::var("FM_LOG_FORMAT").unwrap_or_default();
    let log_file = std::env::var("FM_LOG_FILE").ok();

    match log_file {
        Some(path) => {
            let dir = std::path::Path::new(&path)
                .parent()
                .unwrap_or(std::path::Path::new("."));
            let prefix = std::path::Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("fm-server");
            let file_appender = tracing_appender::rolling::daily(dir, prefix);
            let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
            // _guard must live for the program's lifetime; leak it intentionally.
            std::mem::forget(_guard);
            tracing_subscriber::registry()
                .with(filter)
                .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
                .init();
        }
        None => match format.as_str() {
            "pretty" => tracing_subscriber::registry()
                .with(filter)
                .with(tracing_subscriber::fmt::layer().pretty())
                .init(),
            _ => tracing_subscriber::registry()
                .with(filter)
                .with(tracing_subscriber::fmt::layer().compact())
                .init(),
        },
    }
}
