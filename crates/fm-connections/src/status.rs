//! [`ConnectionStatus`] (task 0103, spec §5.4).

use serde::{Deserialize, Serialize};

/// The current runtime state of a logical connection.
///
/// A connection is a logical saved endpoint/account, not a physical session;
/// a provider may pool physical sessions behind one connection (spec §5.4).
/// Status is process-local runtime state, never persisted alongside the
/// [`crate::ConnectionProfile`] itself - a fresh process starts every
/// connection as [`ConnectionStatus::Disconnected`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ConnectionStatus {
    /// No active or attempted session.
    #[default]
    Disconnected,
    /// A connection attempt is in progress.
    Connecting,
    /// The connection is usable.
    Connected,
    /// A previously connected session is being re-established.
    Reconnecting,
    /// The connection could not authenticate; a valid credential is needed.
    AuthenticationRequired,
    /// The last connection attempt failed for a reason other than
    /// authentication.
    Failed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_disconnected() {
        assert_eq!(ConnectionStatus::default(), ConnectionStatus::Disconnected);
    }

    #[test]
    fn every_status_round_trips_through_serde_json() {
        for status in [
            ConnectionStatus::Disconnected,
            ConnectionStatus::Connecting,
            ConnectionStatus::Connected,
            ConnectionStatus::Reconnecting,
            ConnectionStatus::AuthenticationRequired,
            ConnectionStatus::Failed,
        ] {
            let json = serde_json::to_string(&status).expect("serialization must succeed");
            let parsed: ConnectionStatus =
                serde_json::from_str(&json).expect("deserialization must succeed");
            assert_eq!(parsed, status);
        }
    }
}
