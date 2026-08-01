//! Integration coverage for the plugin discovery and enablement REST surface.

mod common;

use reqwest::StatusCode;

#[tokio::test]
async fn list_plugins_starts_empty_and_unknown_enablement_is_not_found() {
    let server = common::TestServer::spawn().await;
    let client = reqwest::Client::new();

    let plugins = client
        .get(format!("{}/api/v1/plugins", server.base_url))
        .send()
        .await
        .expect("list plugins");
    assert_eq!(plugins.status(), StatusCode::OK);
    assert_eq!(
        plugins
            .json::<Vec<serde_json::Value>>()
            .await
            .expect("plugin JSON")
            .len(),
        0
    );

    let enable = client
        .post(format!("{}/api/v1/plugins/missing/enable", server.base_url))
        .send()
        .await
        .expect("enable missing plugin");
    assert_eq!(enable.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn plugin_logs_are_not_found_for_an_unknown_plugin() {
    let server = common::TestServer::spawn().await;
    let client = reqwest::Client::new();

    let response = client
        .get(format!("{}/api/v1/plugins/missing/logs", server.base_url))
        .send()
        .await
        .expect("get plugin logs");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
