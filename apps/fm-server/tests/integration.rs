//! Integration test for task 0008: boots the real Axum host on an ephemeral
//! port and exercises it exactly as a client would.

use std::net::{IpAddr, Ipv4Addr};

use fm_server::config::ServerConfig;
use utoipa::openapi::{OpenApi, OpenApiVersion};

async fn spawn_server() -> (String, tokio::task::JoinHandle<()>) {
    let config = ServerConfig {
        bind_address: IpAddr::V4(Ipv4Addr::LOCALHOST),
        port: 0,
        ..ServerConfig::default()
    };
    let router = fm_server::build_router(&config);

    let listener = tokio::net::TcpListener::bind((config.bind_address, config.port))
        .await
        .expect("failed to bind an ephemeral port");
    let addr = listener
        .local_addr()
        .expect("bound listener must have a local address");

    let handle = tokio::spawn(async move {
        axum::serve(listener, router)
            .await
            .expect("test server exited unexpectedly");
    });

    (format!("http://{addr}"), handle)
}

#[tokio::test]
async fn health_endpoint_returns_ok_status() {
    let (base_url, handle) = spawn_server().await;

    let response = reqwest::get(format!("{base_url}/api/v1/health"))
        .await
        .expect("request must succeed");

    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = response.json().await.expect("body must be JSON");
    assert_eq!(body["status"], "ok");

    handle.abort();
}

#[tokio::test]
async fn runtime_endpoint_returns_the_capabilities_shape() {
    let (base_url, handle) = spawn_server().await;

    let response = reqwest::get(format!("{base_url}/api/v1/runtime"))
        .await
        .expect("request must succeed");

    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = response.json().await.expect("body must be JSON");
    assert_eq!(body["runtime"], "browserServer");
    assert!(matches!(
        body["platform"].as_str(),
        Some("macos" | "windows" | "linux" | "unknown")
    ));
    assert_eq!(body["clipboard"], true);
    assert_eq!(body["nativeMenus"], false);
    assert_eq!(body["serverAdministration"], false);

    handle.abort();
}

#[tokio::test]
async fn openapi_document_parses_as_openapi_31() {
    let (base_url, handle) = spawn_server().await;

    let response = reqwest::get(format!("{base_url}/api/v1/openapi.json"))
        .await
        .expect("request must succeed");
    assert_eq!(response.status(), reqwest::StatusCode::OK);

    let text = response.text().await.expect("body must be text");
    let document: OpenApi =
        serde_json::from_str(&text).expect("body must parse as an OpenAPI document");
    assert!(document.openapi == OpenApiVersion::Version31);
    assert!(document.paths.paths.contains_key("/api/v1/health"));
    assert!(document.paths.paths.contains_key("/api/v1/runtime"));

    handle.abort();
}

#[tokio::test]
async fn swagger_ui_is_served_at_docs() {
    let (base_url, handle) = spawn_server().await;

    let response = reqwest::get(format!("{base_url}/api/v1/docs/"))
        .await
        .expect("request must succeed");
    assert_eq!(response.status(), reqwest::StatusCode::OK);

    handle.abort();
}

#[tokio::test]
async fn every_response_carries_a_request_id() {
    let (base_url, handle) = spawn_server().await;

    let response = reqwest::get(format!("{base_url}/api/v1/health"))
        .await
        .expect("request must succeed");
    assert!(response.headers().contains_key("x-request-id"));

    let missing = reqwest::get(format!("{base_url}/api/v1/does-not-exist"))
        .await
        .expect("request must succeed");
    assert_eq!(missing.status(), reqwest::StatusCode::NOT_FOUND);
    assert!(missing.headers().contains_key("x-request-id"));
    let body: serde_json::Value = missing.json().await.expect("body must be JSON");
    assert_eq!(body["code"], "notFound");
    assert!(body["requestId"].is_string());

    handle.abort();
}
