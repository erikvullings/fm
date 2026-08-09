//! Bridges `fm-connections`/`fm-credentials` into `fm-ssh`/`fm-vfs-sftp`'s
//! connection-agnostic types (task 0104).
//!
//! This is the one crate allowed to depend on all four: `fm-ssh` and
//! `fm-vfs-sftp` must not depend on `fm-connections`/`fm-credentials`
//! themselves (see their own crate docs - the workspace's layer-fitness test,
//! `fm-test-support`, would otherwise make it impossible for this same
//! service to both register [`fm_vfs_sftp::SftpFileSystemProvider`] *and*
//! wire an SSH dialer into `ConnectionService`), so the translation lives
//! here instead.

use std::str::FromStr;
use std::sync::Arc;

use async_trait::async_trait;
use fm_connections::{
    ConnectionConfiguration, ConnectionDialer, ConnectionError, ConnectionId, ConnectionProfile,
    ConnectionRepository, HostKeyPolicy, JsonFileConnectionRepository, SshAuthenticationMethod,
    SshConnectionConfiguration,
};
use fm_credentials::{CredentialStore, ResolvedCredential, SecretMaterial};
use fm_ssh::{
    SshConnectTarget, SshConnectionManager, SshConnectionParameters, SshCredential, SshError,
    SshHostKeyPolicy,
};
use fm_vfs::VfsError;
use fm_vfs_sftp::SshConnectionResolver;

/// Translates a resolved SSH configuration + credential into `fm-ssh`'s
/// connection-agnostic parameters.
///
/// `Err(())` means the resolved credential's shape did not match the
/// configured authentication method (or was missing when required) - each
/// caller maps that into its own domain's "not usable" outcome
/// ([`ConnectionError::Invalid`] for the dialer,
/// [`VfsError::CredentialRequired`] for the VFS resolver).
fn ssh_connection_parameters(
    configuration: &SshConnectionConfiguration,
    credential: Option<&ResolvedCredential>,
) -> Result<SshConnectionParameters, ()> {
    let ssh_credential = match configuration.authentication {
        SshAuthenticationMethod::Agent => SshCredential::Agent,
        SshAuthenticationMethod::Password => match credential.map(|resolved| &resolved.secret) {
            Some(SecretMaterial::Password { password }) => {
                SshCredential::Password(password.clone())
            }
            _ => return Err(()),
        },
        SshAuthenticationMethod::PrivateKey => match credential.map(|resolved| &resolved.secret) {
            Some(SecretMaterial::PrivateKey { key, passphrase }) => SshCredential::PrivateKey {
                key: key.clone(),
                passphrase: passphrase.clone(),
            },
            _ => return Err(()),
        },
    };
    Ok(SshConnectionParameters {
        target: SshConnectTarget {
            host: configuration.host.clone(),
            port: configuration.port,
            username: configuration.username.clone(),
        },
        credential: ssh_credential,
        host_key_policy: match configuration.host_key_policy {
            HostKeyPolicy::PromptOnFirstUse => SshHostKeyPolicy::PromptOnFirstUse,
            HostKeyPolicy::RequireKnownHost => SshHostKeyPolicy::RequireKnownHost,
        },
        keepalive: configuration.keepalive,
    })
}

/// Maps an `fm-ssh` failure onto the matching [`ConnectionError`], keeping
/// host-key states distinguishable from a generic dial failure (spec §6.4,
/// task 0104).
fn map_ssh_error(error: SshError) -> ConnectionError {
    match error {
        SshError::HostKeyUnverified { fingerprint } => {
            ConnectionError::HostKeyUnverified { fingerprint }
        }
        SshError::HostKeyMismatch {
            fingerprint,
            expected_fingerprint,
        } => ConnectionError::HostKeyMismatch {
            fingerprint,
            expected_fingerprint,
        },
        other => ConnectionError::Io(other.to_string()),
    }
}

/// [`ConnectionDialer`] for [`fm_connections::ConnectionKind::Ssh`] (task
/// 0104).
///
/// Attempts a real connect + authenticate + host-key-verify without keeping
/// the resulting session - a live browsing session is instead established
/// lazily by [`fm_vfs_sftp::SftpFileSystemProvider`] through the same
/// [`SshConnectionManager`], keyed identically (by connection id text), so a
/// successful `connect`/`test` call and a subsequent browse share the same
/// pooled session rather than dialing twice.
pub(crate) struct SshDialer {
    connections: Arc<SshConnectionManager>,
}

impl SshDialer {
    pub(crate) fn new(connections: Arc<SshConnectionManager>) -> Self {
        Self { connections }
    }
}

#[async_trait]
impl ConnectionDialer for SshDialer {
    async fn dial(
        &self,
        profile: &ConnectionProfile,
        credential: Option<&ResolvedCredential>,
    ) -> Result<(), ConnectionError> {
        let ConnectionConfiguration::Ssh(configuration) = &profile.configuration else {
            return Err(ConnectionError::Invalid(vec![]));
        };
        let Ok(params) = ssh_connection_parameters(configuration, credential) else {
            return Err(ConnectionError::Invalid(vec![]));
        };
        self.connections
            .verify_connectivity(&profile.id.to_string(), &params)
            .await
            .map_err(map_ssh_error)
    }
}

/// [`SshConnectionResolver`] for [`fm_vfs_sftp::SftpFileSystemProvider`]
/// (task 0104).
///
/// Looks up the `ConnectionProfile` and resolves its credential directly,
/// through a second, independent [`JsonFileConnectionRepository`] rooted at
/// the same directory `fm-application` itself uses - safe to construct
/// separately since the repository is a stateless, file-per-connection store
/// with no in-memory cache that a second instance could desynchronize from.
pub(crate) struct SshResolver {
    repository: JsonFileConnectionRepository,
    credential_store: Arc<dyn CredentialStore>,
}

impl SshResolver {
    pub(crate) fn new(
        repository: JsonFileConnectionRepository,
        credential_store: Arc<dyn CredentialStore>,
    ) -> Self {
        Self {
            repository,
            credential_store,
        }
    }
}

#[async_trait]
impl SshConnectionResolver for SshResolver {
    async fn resolve(&self, connection_id: &str) -> Result<SshConnectionParameters, VfsError> {
        let location = format!("sftp://{connection_id}");
        let id = ConnectionId::from_str(connection_id).map_err(|_| VfsError::InvalidLocation {
            location: location.clone(),
        })?;
        let profile = self
            .repository
            .load(id)
            .await
            .map_err(|error| VfsError::Io {
                message: error.to_string(),
            })?
            .ok_or_else(|| VfsError::NotFound {
                location: location.clone(),
            })?;
        let ConnectionConfiguration::Ssh(configuration) = &profile.configuration else {
            return Err(VfsError::InvalidLocation { location });
        };
        let credential = match &profile.credential_ref {
            Some(reference) => Some(
                self.credential_store
                    .resolve(reference)
                    .await
                    .map_err(|_| VfsError::CredentialRequired)?,
            ),
            None => None,
        };
        ssh_connection_parameters(configuration, credential.as_ref())
            .map_err(|()| VfsError::CredentialRequired)
    }
}
