//! Persistent, location-keyed PTY sessions for the embedded terminal drawer.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::ipc::Channel;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "data")]
pub(crate) enum TerminalEvent {
    Output(Vec<u8>),
    Exited,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum TerminalError {
    #[error("embedded terminals are only available for local locations")]
    UnsupportedLocation,
    #[error("terminal session `{0}` does not exist")]
    UnknownSession(String),
    #[error("terminal backend failed: {0}")]
    Backend(String),
}

impl Serialize for TerminalError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
    subscribers: Arc<Mutex<Vec<Channel<TerminalEvent>>>>,
    history: Arc<Mutex<Vec<u8>>>,
}

/// Owns one live PTY per backing filesystem location, independent of UI panes.
#[derive(Default)]
pub(crate) struct TerminalRegistry {
    sessions: Mutex<HashMap<String, Session>>,
}

impl TerminalRegistry {
    pub(crate) fn open(
        &self,
        location_uri: &str,
        cwd: &Path,
        size: PtySize,
        channel: Channel<TerminalEvent>,
    ) -> Result<String, TerminalError> {
        let key = location_key(location_uri)?;
        let mut sessions = self.sessions.lock().expect("terminal registry poisoned");
        if let Some(session) = sessions.get_mut(&key) {
            let history = session
                .history
                .lock()
                .expect("terminal history poisoned")
                .clone();
            if !history.is_empty() {
                let _ = channel.send(TerminalEvent::Output(history));
            }
            session
                .subscribers
                .lock()
                .expect("terminal subscribers poisoned")
                .push(channel);
            session.master.resize(size).map_err(backend)?;
            return Ok(key);
        }

        let pair = native_pty_system().openpty(size).map_err(backend)?;
        let shell =
            std::env::var(if cfg!(windows) { "COMSPEC" } else { "SHELL" }).unwrap_or_else(|_| {
                if cfg!(windows) {
                    "cmd.exe".into()
                } else {
                    "/bin/sh".into()
                }
            });
        let mut command = CommandBuilder::new(shell);
        command.cwd(cwd);
        let child = pair.slave.spawn_command(command).map_err(backend)?;
        let writer = pair.master.take_writer().map_err(backend)?;
        let mut reader = pair.master.try_clone_reader().map_err(backend)?;
        let subscribers = Arc::new(Mutex::new(vec![channel]));
        let history = Arc::new(Mutex::new(Vec::new()));
        let thread_subscribers = Arc::clone(&subscribers);
        let thread_history = Arc::clone(&history);
        std::thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        let bytes = buffer[..read].to_vec();
                        thread_history
                            .lock()
                            .expect("terminal history poisoned")
                            .extend_from_slice(&bytes);
                        let mut listeners = thread_subscribers
                            .lock()
                            .expect("terminal subscribers poisoned");
                        listeners.retain(|listener| {
                            listener.send(TerminalEvent::Output(bytes.clone())).is_ok()
                        });
                    }
                }
            }
            let mut listeners = thread_subscribers
                .lock()
                .expect("terminal subscribers poisoned");
            listeners.retain(|listener| listener.send(TerminalEvent::Exited).is_ok());
        });
        sessions.insert(
            key.clone(),
            Session {
                master: pair.master,
                writer,
                _child: child,
                subscribers,
                history,
            },
        );
        Ok(key)
    }

    pub(crate) fn write(&self, id: &str, data: &[u8]) -> Result<(), TerminalError> {
        let mut sessions = self.sessions.lock().expect("terminal registry poisoned");
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| TerminalError::UnknownSession(id.into()))?;
        session
            .writer
            .write_all(data)
            .and_then(|_| session.writer.flush())
            .map_err(backend)
    }

    pub(crate) fn resize(&self, id: &str, size: PtySize) -> Result<(), TerminalError> {
        let sessions = self.sessions.lock().expect("terminal registry poisoned");
        sessions
            .get(id)
            .ok_or_else(|| TerminalError::UnknownSession(id.into()))?
            .master
            .resize(size)
            .map_err(backend)
    }
}

fn location_key(uri: &str) -> Result<String, TerminalError> {
    if let Some(path) = uri.strip_prefix("file://") {
        Ok(format!("local:{path}"))
    } else {
        Err(TerminalError::UnsupportedLocation)
    }
}

fn backend(error: impl std::fmt::Display) -> TerminalError {
    TerminalError::Backend(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filesystem_location_is_a_host_agnostic_terminal_key() {
        assert_eq!(
            location_key("file:///projects/foo").unwrap(),
            "local:/projects/foo"
        );
        assert!(matches!(
            location_key("ssh://host/projects/foo"),
            Err(TerminalError::UnsupportedLocation)
        ));
    }
}
