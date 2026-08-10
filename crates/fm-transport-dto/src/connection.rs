//! Wire types for connection profiles (task 0103, spec §5.2, §16).
//!
//! Response DTOs are structurally unable to carry a secret value: the only
//! credential-related field is [`ConnectionDto::has_credential`], a presence
//! boolean, never a credential reference or its content (spec §16 "Do not
//! expose secrets in response DTOs"). Request DTOs accept secret input
//! through [`ConnectionSecretInputDto`], which is write-only - no response
//! type in this module has a matching field, so a secret a caller submits
//! can never be echoed back.

use std::fmt;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// Protocol/provider family (mirrors `fm_connections::ConnectionKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionKindDto {
    /// SSH.
    Ssh,
    /// Plain FTP.
    Ftp,
    /// FTP over TLS.
    Ftps,
    /// Native OneDrive.
    OneDrive,
    /// WebDAV.
    WebDav,
    /// Amazon S3 or an S3-compatible object store.
    S3,
    /// Native SMB.
    Smb,
}

/// A connection's runtime state (mirrors `fm_connections::ConnectionStatus`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionStatusDto {
    /// No active or attempted session.
    Disconnected,
    /// A connection attempt is in progress.
    Connecting,
    /// The connection is usable.
    Connected,
    /// A previously connected session is being re-established.
    Reconnecting,
    /// The connection could not authenticate; a valid credential is needed.
    AuthenticationRequired,
    /// The remote host presented a key that has never been verified before
    /// (task 0104, spec §6.4); an explicit accept action is required.
    HostKeyUnverified,
    /// The remote host's key changed since it was last accepted (task 0104,
    /// spec §6.4); never silently accepted.
    HostKeyMismatch,
    /// The last connection attempt failed for a reason other than
    /// authentication or a host-key state.
    Failed,
}

/// How an SSH connection authenticates (mirrors
/// `fm_connections::SshAuthenticationMethod`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum SshAuthenticationMethodDto {
    /// Password authentication.
    Password,
    /// Private-key authentication.
    PrivateKey,
    /// Delegates to a running SSH agent.
    Agent,
}

/// SSH host-key verification policy (mirrors `fm_connections::HostKeyPolicy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum HostKeyPolicyDto {
    /// Prompt for confirmation the first time a host key is seen.
    PromptOnFirstUse,
    /// Only connect if the host key was already explicitly accepted.
    RequireKnownHost,
}

/// SSH connection configuration (spec §6.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectionConfigurationDto {
    /// Hostname or IP address.
    pub host: String,
    /// TCP port, conventionally 22.
    pub port: u16,
    /// Remote username.
    pub username: String,
    /// Optional initial remote directory to open when browsing this connection.
    pub start_path: Option<String>,
    /// Authentication method.
    pub authentication: SshAuthenticationMethodDto,
    /// Host-key verification policy.
    pub host_key_policy: HostKeyPolicyDto,
    /// Keepalive interval in seconds, if any.
    pub keepalive_seconds: Option<u64>,
}

/// Minimal FTP/FTPS configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FtpConnectionConfigurationDto {
    /// Hostname or IP address.
    pub host: String,
    /// TCP port, conventionally 21.
    pub port: u16,
    /// Remote username.
    pub username: String,
}

/// Minimal native OneDrive configuration stub.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveConnectionConfigurationDto {
    /// Optional display hint for the target account.
    pub account_hint: Option<String>,
}

/// Minimal WebDAV configuration stub.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WebDavConnectionConfigurationDto {
    /// The WebDAV collection's base URL.
    pub base_url: String,
}

/// Minimal S3-compatible configuration stub.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct S3ConnectionConfigurationDto {
    /// Target bucket name.
    pub bucket: String,
    /// Optional region.
    pub region: Option<String>,
    /// Optional custom endpoint.
    pub endpoint: Option<String>,
}

/// Minimal native SMB configuration stub.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SmbConnectionConfigurationDto {
    /// Server hostname or IP address.
    pub server: String,
    /// Share name.
    pub share: String,
}

/// Tagged, protocol-specific connection configuration (spec §5.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConnectionConfigurationDto {
    /// SSH configuration.
    Ssh(SshConnectionConfigurationDto),
    /// Plain FTP configuration.
    Ftp(FtpConnectionConfigurationDto),
    /// FTP over TLS configuration.
    Ftps(FtpConnectionConfigurationDto),
    /// Native OneDrive configuration.
    OneDrive(OneDriveConnectionConfigurationDto),
    /// WebDAV configuration.
    WebDav(WebDavConnectionConfigurationDto),
    /// S3-compatible configuration.
    S3(S3ConnectionConfigurationDto),
    /// Native SMB configuration.
    Smb(SmbConnectionConfigurationDto),
}

/// Write-only secret input accepted when creating or updating a connection
/// (spec §16 "Credential write requests must never echo secret values
/// back").
///
/// `Debug` is implemented by hand below and never prints secret content, so
/// this type stays safe even if a request is accidentally `{:?}`-logged
/// somewhere upstream of the handler that consumes it.
#[derive(Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConnectionSecretInputDto {
    /// A plain password.
    #[serde(rename_all = "camelCase")]
    Password {
        /// The password itself.
        password: String,
    },
    /// A private key, optionally protected by a passphrase.
    #[serde(rename_all = "camelCase")]
    PrivateKey {
        /// PEM (or provider-specific) private key content.
        key: String,
        /// Passphrase protecting `key`, if any.
        passphrase: Option<String>,
    },
    /// A private key referenced by its filesystem path on the host running
    /// the backend (the local machine for Tauri, or the fm-server host for
    /// browser mode - always a local read, never sent from the browser),
    /// read fresh from disk at dial time rather than stored at rest.
    #[serde(rename_all = "camelCase")]
    PrivateKeyPath {
        /// Absolute or `~`-relative path to a PEM/OpenSSH private key file.
        path: String,
        /// Passphrase protecting the key file, if any.
        passphrase: Option<String>,
    },
    /// An OAuth token pair.
    #[serde(rename_all = "camelCase")]
    OAuthToken {
        /// The current access token.
        access_token: String,
        /// The refresh token, if the provider issued one.
        refresh_token: Option<String>,
    },
}

impl fmt::Debug for ConnectionSecretInputDto {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Password { .. } => f
                .debug_struct("Password")
                .field("password", &"<redacted>")
                .finish(),
            Self::PrivateKey { .. } => f
                .debug_struct("PrivateKey")
                .field("key", &"<redacted>")
                .field("passphrase", &"<redacted>")
                .finish(),
            Self::PrivateKeyPath { path, .. } => f
                .debug_struct("PrivateKeyPath")
                .field("path", path)
                .field("passphrase", &"<redacted>")
                .finish(),
            Self::OAuthToken { .. } => f
                .debug_struct("OAuthToken")
                .field("access_token", &"<redacted>")
                .field("refresh_token", &"<redacted>")
                .finish(),
        }
    }
}

/// A connection profile as returned by the API.
///
/// Structurally unable to carry a secret: `has_credential` is a presence
/// boolean only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDto {
    /// Stable identifier.
    pub id: Uuid,
    /// Display name.
    pub name: String,
    /// Protocol/provider family.
    pub kind: ConnectionKindDto,
    /// Protocol-specific configuration.
    pub configuration: ConnectionConfigurationDto,
    /// Whether a credential is currently stored for this connection. Never
    /// the credential itself or its reference.
    pub has_credential: bool,
    /// Current runtime status.
    pub status: ConnectionStatusDto,
    /// The dialer's failure message from the most recent `connect`/`test`
    /// that ended in `status: "failed"` (task 0104) - `None` whenever
    /// `status` is anything else, or the connection has never failed that
    /// way. Never a secret: dialer failure messages are sanitized connection
    /// diagnostics (unreachable host, rejected credential), not credential
    /// material itself.
    pub last_error: Option<String>,
    /// When this connection was first created.
    pub created_at: DateTime<Utc>,
    /// When this connection was last persisted.
    pub updated_at: DateTime<Utc>,
}

/// Request body for `POST /api/v1/connections`.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateConnectionRequestDto {
    /// Display name.
    pub name: String,
    /// Protocol/provider family.
    pub kind: ConnectionKindDto,
    /// Protocol-specific configuration.
    pub configuration: ConnectionConfigurationDto,
    /// New secret material to store, if this connection needs one.
    pub secret: Option<ConnectionSecretInputDto>,
}

/// Request body for `PUT /api/v1/connections/{connectionId}`.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConnectionRequestDto {
    /// Display name.
    pub name: String,
    /// Protocol/provider family.
    pub kind: ConnectionKindDto,
    /// Protocol-specific configuration.
    pub configuration: ConnectionConfigurationDto,
    /// New secret material to store, replacing any existing credential.
    /// `None` leaves the existing credential untouched - the secret input is
    /// never pre-filled from the stored connection (spec §16, task 0103's
    /// frontend requirement "never pre-filled when editing").
    pub secret: Option<ConnectionSecretInputDto>,
}

/// Result of probing an SSH connection's currently presented host key
/// without authenticating (task 0104, spec §6.4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum HostKeyProbeDto {
    /// The presented fingerprint matches the one already accepted; nothing
    /// to confirm.
    #[serde(rename_all = "camelCase")]
    Trusted {
        /// `SHA256:<base64>` fingerprint the host presented.
        fingerprint: String,
    },
    /// No fingerprint is stored for this connection yet; the caller may
    /// explicitly accept it via `POST .../hostKey/accept`.
    #[serde(rename_all = "camelCase")]
    Unverified {
        /// `SHA256:<base64>` fingerprint the host presented.
        fingerprint: String,
    },
    /// A fingerprint is stored, but it does not match what the host just
    /// presented; never silently accepted.
    #[serde(rename_all = "camelCase")]
    Mismatch {
        /// `SHA256:<base64>` fingerprint the host presented this time.
        fingerprint: String,
        /// `SHA256:<base64>` fingerprint previously accepted and stored.
        expected_fingerprint: String,
    },
}

/// Request body for `POST /api/v1/connections/{connectionId}/hostKey/accept`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AcceptSshHostKeyRequestDto {
    /// The exact fingerprint being accepted; the server re-probes the host
    /// and rejects the request if this no longer matches what is currently
    /// presented (defense against confirming a stale or attacker-supplied
    /// fingerprint).
    pub fingerprint: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_ssh_configuration() -> ConnectionConfigurationDto {
        ConnectionConfigurationDto::Ssh(SshConnectionConfigurationDto {
            host: "example.test".to_owned(),
            port: 22,
            username: "erik".to_owned(),
            start_path: Some("/home/erik".to_owned()),
            authentication: SshAuthenticationMethodDto::Password,
            host_key_policy: HostKeyPolicyDto::PromptOnFirstUse,
            keepalive_seconds: Some(30),
        })
    }

    fn sample_dto() -> ConnectionDto {
        let now = DateTime::<Utc>::from_timestamp(0, 0).expect("fixture timestamp");
        ConnectionDto {
            id: Uuid::nil(),
            name: "Home Server".to_owned(),
            kind: ConnectionKindDto::Ssh,
            configuration: sample_ssh_configuration(),
            has_credential: true,
            status: ConnectionStatusDto::Disconnected,
            last_error: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn connection_dto_serializes_with_camel_case_fields() {
        let value = serde_json::to_value(sample_dto()).expect("serialization must succeed");
        assert_eq!(value["hasCredential"], true);
        assert_eq!(value["kind"], "ssh");
        assert_eq!(value["configuration"]["kind"], "ssh");
        assert_eq!(value["configuration"]["hostKeyPolicy"], "promptOnFirstUse");
    }

    #[test]
    fn connection_dto_round_trips_through_serde_json() {
        let dto = sample_dto();
        let json = serde_json::to_string(&dto).expect("serialization must succeed");
        let parsed: ConnectionDto =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(parsed, dto);
    }

    #[test]
    fn connection_dto_serializes_a_failure_message_under_last_error() {
        let dto = ConnectionDto {
            status: ConnectionStatusDto::Failed,
            last_error: Some(
                "failed to connect to spark-301b:22: name resolution failed".to_owned(),
            ),
            ..sample_dto()
        };
        let value = serde_json::to_value(&dto).expect("serialization must succeed");
        assert_eq!(value["status"], "failed");
        assert_eq!(
            value["lastError"],
            "failed to connect to spark-301b:22: name resolution failed"
        );
    }

    #[test]
    fn secret_input_debug_output_never_contains_the_password() {
        let input = ConnectionSecretInputDto::Password {
            password: "hunter2".to_owned(),
        };
        let formatted = format!("{input:?}");
        assert!(!formatted.contains("hunter2"));
        assert!(formatted.contains("<redacted>"));
    }

    #[test]
    fn secret_input_debug_output_never_contains_private_key_material() {
        let input = ConnectionSecretInputDto::PrivateKey {
            key: "-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----".to_owned(),
            passphrase: Some("swordfish".to_owned()),
        };
        let formatted = format!("{input:?}");
        assert!(!formatted.contains("BEGIN PRIVATE KEY"));
        assert!(!formatted.contains("swordfish"));
    }

    #[test]
    fn secret_input_debug_output_shows_the_path_but_never_the_passphrase() {
        let input = ConnectionSecretInputDto::PrivateKeyPath {
            path: "~/.ssh/id_tno".to_owned(),
            passphrase: Some("swordfish".to_owned()),
        };
        let formatted = format!("{input:?}");
        assert!(formatted.contains("~/.ssh/id_tno"));
        assert!(!formatted.contains("swordfish"));
        assert!(formatted.contains("<redacted>"));
    }

    #[test]
    fn private_key_path_secret_input_serializes_with_a_kind_tag_and_camel_case_fields() {
        let input = ConnectionSecretInputDto::PrivateKeyPath {
            path: "~/.ssh/id_tno".to_owned(),
            passphrase: None,
        };
        let value = serde_json::to_value(input).expect("serialization must succeed");
        assert_eq!(value["kind"], "privateKeyPath");
        assert_eq!(value["path"], "~/.ssh/id_tno");
    }

    #[test]
    fn oauth_token_secret_input_uses_camel_case_field_names() {
        // Regression test: `rename_all` on the enum only renames the `kind`
        // tag values, not each struct-like variant's own fields, so every
        // variant needs its own `rename_all` too - `access_token`/
        // `refresh_token` are the only fields in this DTO with underscores
        // to catch a missed one.
        let input = ConnectionSecretInputDto::OAuthToken {
            access_token: "access".to_owned(),
            refresh_token: Some("refresh".to_owned()),
        };
        let value = serde_json::to_value(input).expect("serialization must succeed");
        assert_eq!(value["accessToken"], "access");
        assert_eq!(value["refreshToken"], "refresh");
        assert!(value.get("access_token").is_none());
        assert!(value.get("refresh_token").is_none());
    }

    /// Task 0103's explicit test requirement: serialize a full write request
    /// containing a password, then assert the response type has no matching
    /// field - not just "we didn't set it" on this particular value, but
    /// structurally, at the JSON level, across every field name the request
    /// used.
    #[test]
    fn create_request_with_a_password_has_no_matching_field_on_the_response_dto() {
        let request = CreateConnectionRequestDto {
            name: "Home Server".to_owned(),
            kind: ConnectionKindDto::Ssh,
            configuration: sample_ssh_configuration(),
            secret: Some(ConnectionSecretInputDto::Password {
                password: "hunter2".to_owned(),
            }),
        };
        let request_json = serde_json::to_value(&request).expect("serialize request");
        let request_object = request_json
            .as_object()
            .expect("request serializes as an object");

        let response_json = serde_json::to_value(sample_dto()).expect("serialize response");
        let response_object = response_json
            .as_object()
            .expect("response serializes as an object");

        // The request's top-level `secret` field (and everything nested
        // under it) must have no counterpart anywhere on the response DTO.
        assert!(request_object.contains_key("secret"));
        assert!(!response_object.contains_key("secret"));
        assert!(!response_object.contains_key("password"));

        let response_text = response_json.to_string();
        assert!(!response_text.contains("hunter2"));
    }

    #[test]
    fn update_request_with_a_password_has_no_matching_field_on_the_response_dto() {
        let request = UpdateConnectionRequestDto {
            name: "Home Server".to_owned(),
            kind: ConnectionKindDto::Ssh,
            configuration: sample_ssh_configuration(),
            secret: Some(ConnectionSecretInputDto::Password {
                password: "hunter2".to_owned(),
            }),
        };
        let request_json = serde_json::to_value(&request).expect("serialize request");
        let response_json = serde_json::to_value(sample_dto()).expect("serialize response");

        assert!(request_json.as_object().unwrap().contains_key("secret"));
        assert!(!response_json.as_object().unwrap().contains_key("secret"));
        assert!(!response_json.to_string().contains("hunter2"));
    }

    #[test]
    fn every_connection_kind_round_trips_through_serde_json() {
        for kind in [
            ConnectionKindDto::Ssh,
            ConnectionKindDto::Ftp,
            ConnectionKindDto::Ftps,
            ConnectionKindDto::OneDrive,
            ConnectionKindDto::WebDav,
            ConnectionKindDto::S3,
            ConnectionKindDto::Smb,
        ] {
            let json = serde_json::to_string(&kind).expect("serialization must succeed");
            let parsed: ConnectionKindDto =
                serde_json::from_str(&json).expect("deserialization must succeed");
            assert_eq!(parsed, kind);
        }
    }

    #[test]
    fn every_connection_status_round_trips_through_serde_json() {
        for status in [
            ConnectionStatusDto::Disconnected,
            ConnectionStatusDto::Connecting,
            ConnectionStatusDto::Connected,
            ConnectionStatusDto::Reconnecting,
            ConnectionStatusDto::AuthenticationRequired,
            ConnectionStatusDto::HostKeyUnverified,
            ConnectionStatusDto::HostKeyMismatch,
            ConnectionStatusDto::Failed,
        ] {
            let json = serde_json::to_string(&status).expect("serialization must succeed");
            let parsed: ConnectionStatusDto =
                serde_json::from_str(&json).expect("deserialization must succeed");
            assert_eq!(parsed, status);
        }
    }

    #[test]
    fn host_key_probe_dto_serializes_with_a_status_tag_and_camel_case_fields() {
        let trusted = HostKeyProbeDto::Trusted {
            fingerprint: "SHA256:abc".to_owned(),
        };
        let value = serde_json::to_value(&trusted).expect("serialization must succeed");
        assert_eq!(value["status"], "trusted");
        assert_eq!(value["fingerprint"], "SHA256:abc");

        let mismatch = HostKeyProbeDto::Mismatch {
            fingerprint: "SHA256:new".to_owned(),
            expected_fingerprint: "SHA256:old".to_owned(),
        };
        let value = serde_json::to_value(&mismatch).expect("serialization must succeed");
        assert_eq!(value["status"], "mismatch");
        assert_eq!(value["fingerprint"], "SHA256:new");
        assert_eq!(value["expectedFingerprint"], "SHA256:old");
    }

    #[test]
    fn host_key_probe_dto_round_trips_through_serde_json_for_every_variant() {
        for probe in [
            HostKeyProbeDto::Trusted {
                fingerprint: "SHA256:abc".to_owned(),
            },
            HostKeyProbeDto::Unverified {
                fingerprint: "SHA256:def".to_owned(),
            },
            HostKeyProbeDto::Mismatch {
                fingerprint: "SHA256:new".to_owned(),
                expected_fingerprint: "SHA256:old".to_owned(),
            },
        ] {
            let json = serde_json::to_string(&probe).expect("serialization must succeed");
            let parsed: HostKeyProbeDto =
                serde_json::from_str(&json).expect("deserialization must succeed");
            assert_eq!(parsed, probe);
        }
    }

    #[test]
    fn accept_ssh_host_key_request_dto_round_trips_through_serde_json() {
        let request = AcceptSshHostKeyRequestDto {
            fingerprint: "SHA256:abc".to_owned(),
        };
        let json = serde_json::to_string(&request).expect("serialization must succeed");
        let parsed: AcceptSshHostKeyRequestDto =
            serde_json::from_str(&json).expect("deserialization must succeed");
        assert_eq!(parsed, request);
    }
}
