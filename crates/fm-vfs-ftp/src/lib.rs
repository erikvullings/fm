//! Passive FTP and explicit FTPS virtual filesystem provider.
mod provider;
pub use provider::{FtpConnectionParameters, FtpConnectionResolver, FtpFileSystemProvider};
