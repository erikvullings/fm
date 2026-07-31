//! Operations REST contract and lifecycle integration tests.

mod common;

use fm_events::{BackendEventPayload, OperationStatePayload, SessionId, SubscriptionEvent};
use serde_json::json;

#[tokio::test]
async fn start_retry_uses_stable_id_and_noop_emits_full_lifecycle() {
    let server = common::TestServer::spawn().await;
    let mut events = server
        .event_bus
        .subscribe_all_workspaces(SessionId::new("operations-test"), None);
    let client = reqwest::Client::new();
    let request = json!({
        "type": "copy",
        "sources": [{"providerId":"local","uri":"file:///tmp/source"}],
        "destination": {"providerId":"local","uri":"file:///tmp/destination"},
        "conflictPolicy": "ask"
    });
    let first: serde_json::Value = client
        .post(format!("{}/api/v1/operations", server.base_url))
        .header("Idempotency-Key", "same-request")
        .json(&request)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let retry: serde_json::Value = client
        .post(format!("{}/api/v1/operations", server.base_url))
        .header("Idempotency-Key", "same-request")
        .json(&request)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(first["id"], retry["id"]);

    let listed: Vec<serde_json::Value> = client
        .get(format!("{}/api/v1/operations", server.base_url))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(listed.len(), 1);
    let id = first["id"].as_str().unwrap();
    let fetched: serde_json::Value = client
        .get(format!("{}/api/v1/operations/{id}", server.base_url))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(fetched["id"], first["id"]);

    let mut payloads = Vec::new();
    while !payloads.iter().any(|payload: &BackendEventPayload| {
        matches!(payload, BackendEventPayload::OperationCompleted { .. })
    }) {
        let SubscriptionEvent::Event(event) = events.recv().await.unwrap() else {
            panic!("unexpected replay gap")
        };
        payloads.push(event.payload);
    }
    assert_eq!(
        payloads
            .iter()
            .map(BackendEventPayload::event_name)
            .collect::<Vec<_>>(),
        [
            "operation.created",
            "operation.stateChanged",
            "operation.stateChanged",
            "operation.progress",
            "operation.stateChanged",
            "operation.completed",
        ]
    );
    let states = payloads
        .iter()
        .filter_map(|payload| match payload {
            BackendEventPayload::OperationStateChanged { state, .. } => Some(*state),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        states,
        [
            OperationStatePayload::Planning,
            OperationStatePayload::Running,
            OperationStatePayload::Completed,
        ]
    );
}

#[test]
fn openapi_reserves_all_stable_operation_ids() {
    let document = fm_server::openapi_document();
    let json = serde_json::to_value(document).unwrap();
    let text = json.to_string();
    for operation_id in [
        "listOperations",
        "startOperation",
        "getOperation",
        "cancelOperation",
        "pauseOperation",
        "resumeOperation",
        "resolveOperationConflict",
    ] {
        assert!(text.contains(operation_id), "missing {operation_id}");
    }
}
