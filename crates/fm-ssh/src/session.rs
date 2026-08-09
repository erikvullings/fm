//! One authenticated SSH session and lazily-opened SFTP subsystem (task
//! 0104).

use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use russh::client::{self, AuthResult};
use russh::keys::{PrivateKeyWithHashAlg, PublicKey};
use russh_sftp::client::SftpSession;
use tokio::sync::Mutex as AsyncMutex;

use crate::error::SshError;
use crate::fingerprint::fingerprint_of;
use crate::known_hosts::{HostKeyVerification, KnownHostsStore, verify_host_key};
use crate::types::{SshConnectTarget, SshConnectionParameters, SshCredential};

/// How long a connection attempt (transport + host-key exchange) may take
/// before it is treated as failed (spec §6.8 "timeouts").
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// An authenticated SSH session, with a lazily-opened, cached SFTP
/// subsystem.
pub struct SshSession {
    handle: client::Handle<ClientHandler>,
    sftp: AsyncMutex<Option<Arc<SftpSession>>>,
}

impl std::fmt::Debug for SshSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SshSession")
            .field("is_closed", &self.is_closed())
            .finish_non_exhaustive()
    }
}

impl SshSession {
    /// Establishes a new authenticated SSH session, verifying the host key
    /// through `known_hosts` under `known_hosts_key` (spec §6.4).
    ///
    /// Never auto-accepts an unverified or changed host key: both are
    /// reported as a distinct [`SshError`] variant before any credential is
    /// even sent, and no entry is written to `known_hosts` by this call -
    /// only [`crate::KnownHostsStore::accept`] does that, and only a caller
    /// explicitly invokes it.
    pub async fn connect(
        params: &SshConnectionParameters,
        known_hosts: Arc<dyn KnownHostsStore>,
        known_hosts_key: &str,
    ) -> Result<Self, SshError> {
        let mut handle = establish_transport(
            &params.target,
            params.keepalive,
            known_hosts,
            known_hosts_key,
        )
        .await?
        .handle;

        authenticate(&mut handle, &params.target.username, &params.credential).await?;

        Ok(Self {
            handle,
            sftp: AsyncMutex::new(None),
        })
    }

    /// Connects and verifies the host key only, without authenticating, then
    /// immediately disconnects (spec §6.4's explicit host-key confirmation
    /// flow, used before a caller necessarily has a working credential).
    ///
    /// Unlike [`Self::connect`], an unverified or changed host key is not an
    /// error here - it *is* the answer to "what is this host presenting
    /// right now", returned as [`HostKeyVerification::Unverified`]/
    /// [`HostKeyVerification::Mismatch`]. `Err` is reserved for a genuine
    /// transport failure (unreachable host, timeout).
    pub async fn probe_host_key(
        target: &SshConnectTarget,
        known_hosts: Arc<dyn KnownHostsStore>,
        known_hosts_key: &str,
    ) -> Result<HostKeyVerification, SshError> {
        match establish_transport(target, None, known_hosts, known_hosts_key).await {
            Ok(established) => {
                let _ = established
                    .handle
                    .disconnect(
                        russh::Disconnect::ByApplication,
                        "host-key probe complete",
                        "en",
                    )
                    .await;
                Ok(established.verification)
            }
            Err(SshError::HostKeyUnverified { fingerprint }) => {
                Ok(HostKeyVerification::Unverified { fingerprint })
            }
            Err(SshError::HostKeyMismatch {
                fingerprint,
                expected_fingerprint,
            }) => Ok(HostKeyVerification::Mismatch {
                fingerprint,
                expected_fingerprint,
            }),
            Err(other) => Err(other),
        }
    }

    /// Whether the underlying transport has been closed (locally or by the
    /// peer). A dead session should be discarded and reconnected rather than
    /// reused.
    #[must_use]
    pub fn is_closed(&self) -> bool {
        self.handle.is_closed()
    }

    /// Returns the SFTP subsystem for this session, opening it on first use
    /// and reusing it for subsequent calls.
    pub async fn sftp(&self) -> Result<Arc<SftpSession>, SshError> {
        let mut guard = self.sftp.lock().await;
        if let Some(existing) = guard.as_ref() {
            return Ok(existing.clone());
        }
        let channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|error| SshError::Session(error.to_string()))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|error| SshError::Session(error.to_string()))?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|error| SshError::Sftp(error.to_string()))?;
        let sftp = Arc::new(sftp);
        *guard = Some(sftp.clone());
        Ok(sftp)
    }
}

struct EstablishedTransport {
    handle: client::Handle<ClientHandler>,
    /// Always [`HostKeyVerification::Trusted`] - `establish_transport` never
    /// returns `Ok` otherwise.
    verification: HostKeyVerification,
}

/// Connects and verifies the host key, stopping short of authentication.
///
/// Shared by [`SshSession::connect`] (which authenticates immediately after)
/// and [`SshSession::probe_host_key`] (which disconnects immediately after).
/// Only ever returns `Ok` when the key was trusted; an unverified or changed
/// key surfaces as the matching [`SshError`] variant, never a bare
/// `HostKeyVerification` the caller could accidentally treat as success.
async fn establish_transport(
    target: &SshConnectTarget,
    keepalive: Option<Duration>,
    known_hosts: Arc<dyn KnownHostsStore>,
    known_hosts_key: &str,
) -> Result<EstablishedTransport, SshError> {
    let outcome: Arc<StdMutex<Option<HostKeyVerification>>> = Arc::new(StdMutex::new(None));
    let handler = ClientHandler {
        known_hosts,
        known_hosts_key: known_hosts_key.to_owned(),
        outcome: outcome.clone(),
    };
    let config = Arc::new(client::Config {
        keepalive_interval: keepalive,
        ..Default::default()
    });
    let address = (target.host.as_str(), target.port);

    let connect_result =
        tokio::time::timeout(CONNECT_TIMEOUT, client::connect(config, address, handler)).await;
    match connect_result {
        Err(_) => Err(SshError::Timeout {
            host: target.host.clone(),
            port: target.port,
        }),
        Ok(Err(_)) => Err(host_key_or_connect_error(
            &outcome,
            &target.host,
            target.port,
        )),
        Ok(Ok(handle)) => {
            let verification = outcome
                .lock()
                .expect("host-key outcome lock poisoned")
                .take()
                .unwrap_or(HostKeyVerification::Unverified {
                    fingerprint: String::new(),
                });
            Ok(EstablishedTransport {
                handle,
                verification,
            })
        }
    }
}

fn host_key_or_connect_error(
    outcome: &StdMutex<Option<HostKeyVerification>>,
    host: &str,
    port: u16,
) -> SshError {
    match outcome
        .lock()
        .expect("host-key outcome lock poisoned")
        .take()
    {
        Some(HostKeyVerification::Unverified { fingerprint }) => {
            SshError::HostKeyUnverified { fingerprint }
        }
        Some(HostKeyVerification::Mismatch {
            fingerprint,
            expected_fingerprint,
        }) => SshError::HostKeyMismatch {
            fingerprint,
            expected_fingerprint,
        },
        _ => SshError::Connect {
            host: host.to_owned(),
            port,
            message: "connection rejected during transport or key exchange".to_owned(),
        },
    }
}

async fn authenticate(
    handle: &mut client::Handle<ClientHandler>,
    username: &str,
    credential: &SshCredential,
) -> Result<(), SshError> {
    let result = match credential {
        SshCredential::None => handle
            .authenticate_none(username)
            .await
            .map_err(|error| SshError::Session(error.to_string()))?,
        SshCredential::Password(password) => handle
            .authenticate_password(username, password.as_str())
            .await
            .map_err(|error| SshError::Session(error.to_string()))?,
        SshCredential::PrivateKey { key, passphrase } => {
            let private_key = russh::keys::decode_secret_key(
                key.as_str(),
                passphrase.as_ref().map(|value| value.as_str()),
            )
            .map_err(|error| SshError::InvalidPrivateKey(error.to_string()))?;
            let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(private_key), None);
            handle
                .authenticate_publickey(username, key_with_hash)
                .await
                .map_err(|error| SshError::Session(error.to_string()))?
        }
        SshCredential::Agent => {
            return Err(SshError::UnsupportedAuthenticationMethod(
                "ssh-agent authentication is not implemented yet",
            ));
        }
    };

    if matches!(result, AuthResult::Success) {
        Ok(())
    } else {
        Err(SshError::AuthenticationFailed)
    }
}

struct ClientHandler {
    known_hosts: Arc<dyn KnownHostsStore>,
    known_hosts_key: String,
    outcome: Arc<StdMutex<Option<HostKeyVerification>>>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = fingerprint_of(server_public_key);
        // A known-hosts store failure must never be treated as trust: fail
        // closed as "unverified" rather than silently accepting.
        let verification = verify_host_key(
            self.known_hosts.as_ref(),
            &self.known_hosts_key,
            &fingerprint,
        )
        .await
        .unwrap_or(HostKeyVerification::Unverified {
            fingerprint: fingerprint.clone(),
        });
        let trusted = matches!(verification, HostKeyVerification::Trusted { .. });
        *self.outcome.lock().expect("host-key outcome lock poisoned") = Some(verification);
        Ok(trusted)
    }
}
