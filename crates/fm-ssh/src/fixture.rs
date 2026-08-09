//! An in-process SSH + SFTP server for tests (task 0104, spec §18 "SFTP").
//!
//! ## Fixture choice
//!
//! Two hermetic options were viable: (a) an in-process `russh`/`russh-sftp`
//! server, or (b) spawning the system `sshd`/`sftp-server` against a
//! generated throwaway config. This module implements (a) because:
//!
//! - it needs no external process, privileged config file, or `sshd`
//!   available on the host, so it works identically in a sandboxed CI
//!   environment or a contributor's machine without local SSH tooling setup;
//! - `russh`/`russh-sftp` are already this crate's real client dependencies
//!   for production code, so the fixture exercises the *actual* wire
//!   protocol end to end (not a mock or stub) - it is an independent server
//!   implementation from the client code under test, so a round trip through
//!   it genuinely verifies wire compatibility, just as connecting to a real
//!   `sshd` would.
//!
//! Exposed unconditionally (not behind `#[cfg(test)]`) so this module is
//! usable as a `dev-dependency` fixture from other crates' tests too (task
//! 0104's `fm-vfs-sftp`, and future SSH-terminal consumers), matching the
//! task's requirement that the fixture be reusable rather than private to
//! one test file.
//!
//! ## Filesystem model
//!
//! The fixture serves real files under a real temporary directory
//! ([`SshFixture::root`]) using the client-presented path *as-is* - no
//! virtual-root translation. Tests address files by joining real paths under
//! `root`, exactly like a real SFTP server rooted at `/`.

use std::collections::HashMap;
use std::io::SeekFrom;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use russh::keys::{Algorithm, PrivateKey, PublicKey};
use russh::server::{
    Auth, ChannelOpenHandle, Config as ServerConfig, Handler as ServerHandler, Msg,
    Server as ServerTrait,
};
use russh::{Channel, ChannelId};
use russh_sftp::protocol::{
    Attrs, Data, File as SftpFile, FileAttributes, Handle as SftpHandle, Name, OpenFlags, Status,
    StatusCode,
};
use tokio::fs::File as TokioFile;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex as AsyncMutex;
use tokio::task::JoinHandle;

/// Username the fixture accepts.
pub const FIXTURE_USERNAME: &str = "fixture-user";
/// Password the fixture accepts when password authentication is enabled.
pub const FIXTURE_PASSWORD: &str = "fixture-password";

/// A running in-process SSH+SFTP fixture server.
pub struct SshFixture {
    /// The loopback address the fixture is listening on.
    pub addr: SocketAddr,
    /// The real temporary directory files are served from/into.
    pub root: tempfile::TempDir,
    /// The fixture's host key.
    pub host_key: PrivateKey,
    /// The fixture host key's SHA-256 fingerprint.
    pub host_key_fingerprint: String,
    /// A client private key the fixture accepts for public-key
    /// authentication.
    pub authorized_client_key: PrivateKey,
    accept_task: JoinHandle<()>,
}

impl Drop for SshFixture {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

impl SshFixture {
    /// Starts a fixture bound to an ephemeral localhost port, with a freshly
    /// generated host key and one authorized client key (for public-key
    /// authentication tests).
    pub async fn start() -> Self {
        let host_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
            .expect("generating a fixture host key must succeed");
        let host_key_fingerprint = crate::fingerprint::fingerprint_of(host_key.public_key());
        let authorized_client_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
            .expect("generating a fixture client key must succeed");

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("binding an ephemeral fixture port must succeed");
        let addr = listener
            .local_addr()
            .expect("a bound listener must have a local address");

        let server_config = Arc::new(ServerConfig {
            keys: vec![host_key.clone()],
            ..Default::default()
        });

        let authorized_public_key = authorized_client_key.public_key().clone();
        let mut server = FixtureServer {
            authorized_public_key,
        };

        let accept_task = tokio::spawn(async move {
            let _ = server.run_on_socket(server_config, &listener).await;
        });

        Self {
            addr,
            root: tempfile::tempdir().expect("creating a fixture root directory must succeed"),
            host_key,
            host_key_fingerprint,
            authorized_client_key,
            accept_task,
        }
    }

    /// A path under the fixture's real root directory.
    #[must_use]
    pub fn path(&self, relative: &str) -> PathBuf {
        self.root.path().join(relative)
    }

    /// The fixture root as a string, for building remote-path text.
    #[must_use]
    pub fn root_path_string(&self) -> String {
        self.root.path().to_string_lossy().into_owned()
    }
}

#[derive(Clone)]
struct FixtureServer {
    authorized_public_key: PublicKey,
}

impl ServerTrait for FixtureServer {
    type Handler = FixtureSshHandler;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> Self::Handler {
        FixtureSshHandler {
            authorized_public_key: self.authorized_public_key.clone(),
            channels: Arc::new(AsyncMutex::new(HashMap::new())),
        }
    }
}

struct FixtureSshHandler {
    authorized_public_key: PublicKey,
    channels: Arc<AsyncMutex<HashMap<ChannelId, Channel<Msg>>>>,
}

impl ServerHandler for FixtureSshHandler {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == FIXTURE_USERNAME && password == FIXTURE_PASSWORD {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn auth_publickey(
        &mut self,
        user: &str,
        public_key: &PublicKey,
    ) -> Result<Auth, Self::Error> {
        if user == FIXTURE_USERNAME && *public_key == self.authorized_public_key {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut russh::server::Session,
    ) -> Result<(), Self::Error> {
        self.channels.lock().await.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        name: &str,
        session: &mut russh::server::Session,
    ) -> Result<(), Self::Error> {
        if name != "sftp" {
            session.channel_failure(channel_id)?;
            return Ok(());
        }
        let Some(channel) = self.channels.lock().await.remove(&channel_id) else {
            session.channel_failure(channel_id)?;
            return Ok(());
        };
        session.channel_success(channel_id)?;
        russh_sftp::server::run(channel.into_stream(), FixtureSftpHandler::default()).await;
        Ok(())
    }
}

enum FixtureHandle {
    File(TokioFile),
    Dir {
        entries: Vec<(String, std::fs::Metadata)>,
        sent: bool,
    },
}

#[derive(Default)]
struct FixtureSftpHandler {
    handles: HashMap<String, FixtureHandle>,
    next_handle_id: u64,
}

impl FixtureSftpHandler {
    fn allocate_handle(&mut self, handle: FixtureHandle) -> String {
        self.next_handle_id += 1;
        let id = self.next_handle_id.to_string();
        self.handles.insert(id.clone(), handle);
        id
    }
}

fn ok_status(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: "Ok".to_owned(),
        language_tag: "en-US".to_owned(),
    }
}

fn map_io_error(error: &std::io::Error) -> StatusCode {
    match error.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NoSuchFile,
        std::io::ErrorKind::PermissionDenied => StatusCode::PermissionDenied,
        _ => StatusCode::Failure,
    }
}

impl russh_sftp::server::Handler for FixtureSftpHandler {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        pflags: OpenFlags,
        _attrs: FileAttributes,
    ) -> Result<SftpHandle, Self::Error> {
        let mut options = tokio::fs::OpenOptions::new();
        options.read(pflags.contains(OpenFlags::READ));
        options.write(pflags.contains(OpenFlags::WRITE) || pflags.contains(OpenFlags::APPEND));
        options.append(pflags.contains(OpenFlags::APPEND));
        if pflags.contains(OpenFlags::CREATE) {
            if pflags.contains(OpenFlags::EXCLUDE) {
                options.create_new(true);
            } else {
                options.create(true);
            }
        }
        options.truncate(pflags.contains(OpenFlags::TRUNCATE));

        let file = options
            .open(&filename)
            .await
            .map_err(|error| map_io_error(&error))?;
        let handle = self.allocate_handle(FixtureHandle::File(file));
        Ok(SftpHandle { id, handle })
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        self.handles.remove(&handle);
        Ok(ok_status(id))
    }

    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, Self::Error> {
        let Some(FixtureHandle::File(file)) = self.handles.get_mut(&handle) else {
            return Err(StatusCode::Failure);
        };
        file.seek(SeekFrom::Start(offset))
            .await
            .map_err(|error| map_io_error(&error))?;
        let mut buffer = vec![0_u8; len as usize];
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| map_io_error(&error))?;
        if read == 0 {
            return Err(StatusCode::Eof);
        }
        buffer.truncate(read);
        Ok(Data { id, data: buffer })
    }

    async fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, Self::Error> {
        let Some(FixtureHandle::File(file)) = self.handles.get_mut(&handle) else {
            return Err(StatusCode::Failure);
        };
        file.seek(SeekFrom::Start(offset))
            .await
            .map_err(|error| map_io_error(&error))?;
        file.write_all(&data)
            .await
            .map_err(|error| map_io_error(&error))?;
        Ok(ok_status(id))
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let metadata = tokio::fs::symlink_metadata(&path)
            .await
            .map_err(|error| map_io_error(&error))?;
        Ok(Attrs {
            id,
            attrs: FileAttributes::from(&metadata),
        })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|error| map_io_error(&error))?;
        Ok(Attrs {
            id,
            attrs: FileAttributes::from(&metadata),
        })
    }

    async fn fstat(&mut self, id: u32, handle: String) -> Result<Attrs, Self::Error> {
        let Some(FixtureHandle::File(file)) = self.handles.get(&handle) else {
            return Err(StatusCode::Failure);
        };
        let metadata = file
            .metadata()
            .await
            .map_err(|error| map_io_error(&error))?;
        Ok(Attrs {
            id,
            attrs: FileAttributes::from(&metadata),
        })
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<SftpHandle, Self::Error> {
        let mut reader = tokio::fs::read_dir(&path)
            .await
            .map_err(|error| map_io_error(&error))?;
        let mut entries = Vec::new();
        while let Some(entry) = reader
            .next_entry()
            .await
            .map_err(|error| map_io_error(&error))?
        {
            let metadata = entry
                .metadata()
                .await
                .map_err(|error| map_io_error(&error))?;
            entries.push((entry.file_name().to_string_lossy().into_owned(), metadata));
        }
        let handle = self.allocate_handle(FixtureHandle::Dir {
            entries,
            sent: false,
        });
        Ok(SftpHandle { id, handle })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        let Some(FixtureHandle::Dir { entries, sent }) = self.handles.get_mut(&handle) else {
            return Err(StatusCode::Failure);
        };
        if *sent {
            return Err(StatusCode::Eof);
        }
        *sent = true;
        let files = entries
            .iter()
            .map(|(name, metadata)| SftpFile::new(name.clone(), FileAttributes::from(metadata)))
            .collect();
        Ok(Name { id, files })
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, Self::Error> {
        tokio::fs::remove_file(&filename)
            .await
            .map_err(|error| map_io_error(&error))?;
        Ok(ok_status(id))
    }

    async fn mkdir(
        &mut self,
        id: u32,
        path: String,
        _attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        tokio::fs::create_dir(&path)
            .await
            .map_err(|error| map_io_error(&error))?;
        Ok(ok_status(id))
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, Self::Error> {
        tokio::fs::remove_dir(&path)
            .await
            .map_err(|error| map_io_error(&error))?;
        Ok(ok_status(id))
    }

    async fn rename(
        &mut self,
        id: u32,
        oldpath: String,
        newpath: String,
    ) -> Result<Status, Self::Error> {
        tokio::fs::rename(&oldpath, &newpath)
            .await
            .map_err(|error| map_io_error(&error))?;
        Ok(ok_status(id))
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        let canonical = tokio::fs::canonicalize(&path)
            .await
            .map(|resolved| resolved.to_string_lossy().into_owned())
            .unwrap_or(path);
        Ok(Name {
            id,
            files: vec![SftpFile::dummy(canonical)],
        })
    }
}
