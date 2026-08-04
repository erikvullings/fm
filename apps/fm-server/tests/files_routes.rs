//! End-to-end REST coverage for reading byte ranges and searching content
//! within a single file (task 0088).

mod common;

use common::TestServer;
use fm_domain::Location;
use serde_json::{Value, json};

fn location_json(path: &std::path::Path) -> Value {
    let location = Location::from_native_path(path).expect("temp path must be representable");
    json!({
        "providerId": location.provider_id.as_str(),
        "uri": location.uri,
    })
}

#[tokio::test]
async fn reads_a_byte_range_from_a_file() {
    let root = tempfile::tempdir().expect("must create a temp directory");
    let target = root.path().join("report.txt");
    std::fs::write(&target, b"0123456789").expect("must create fixture");
    let server = TestServer::spawn().await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("{}/api/v1/files/range", server.base_url))
        .json(&json!({
            "location": location_json(&target),
            "offset": 4,
            "length": 3,
        }))
        .send()
        .await
        .expect("request must succeed");

    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let body: Value = response.json().await.expect("body must be JSON");
    assert_eq!(body["data"], json!([52, 53, 54]));
    assert_eq!(body["offset"], 4);
    assert_eq!(body["length"], 3);
    assert_eq!(body["eof"], false);
}

/// A large (multi-megabyte) fixture file, created ad hoc since task 0065's
/// shared large-directory-fixture helper does not exist yet.
fn write_large_fixture(path: &std::path::Path) {
    let line = "the quick brown fox jumps over the lazy dog\n";
    let mut contents = String::with_capacity(3 * 1024 * 1024);
    while contents.len() < 3 * 1024 * 1024 {
        contents.push_str(line);
    }
    std::fs::write(path, contents).expect("must create large fixture");
}

#[tokio::test]
async fn reads_a_range_near_the_end_of_a_large_file() {
    let root = tempfile::tempdir().expect("must create a temp directory");
    let target = root.path().join("large.txt");
    write_large_fixture(&target);
    let file_size = std::fs::metadata(&target).expect("fixture metadata").len();
    let server = TestServer::spawn().await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("{}/api/v1/files/range", server.base_url))
        .json(&json!({
            "location": location_json(&target),
            "offset": file_size - 10,
            "length": 1000,
        }))
        .send()
        .await
        .expect("request must succeed");

    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let body: Value = response.json().await.expect("body must be JSON");
    assert_eq!(body["data"].as_array().unwrap().len(), 10);
    assert_eq!(body["eof"], true);
}

#[tokio::test]
async fn rejects_an_oversized_range_length() {
    let root = tempfile::tempdir().expect("must create a temp directory");
    let target = root.path().join("report.txt");
    std::fs::write(&target, b"contents").expect("must create fixture");
    let server = TestServer::spawn().await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("{}/api/v1/files/range", server.base_url))
        .json(&json!({
            "location": location_json(&target),
            "offset": 0,
            "length": 10 * 1024 * 1024,
        }))
        .send()
        .await
        .expect("request must succeed");

    assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn searches_a_file_for_a_case_insensitive_substring() {
    let root = tempfile::tempdir().expect("must create a temp directory");
    let target = root.path().join("log.txt");
    std::fs::write(
        &target,
        b"first line\nsecond ERROR line\nthird error line\n",
    )
    .expect("must create fixture");
    let server = TestServer::spawn().await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("{}/api/v1/files/search", server.base_url))
        .json(&json!({
            "location": location_json(&target),
            "query": "error",
            "regex": false,
            "caseSensitive": false,
        }))
        .send()
        .await
        .expect("request must succeed");

    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let body: Value = response.json().await.expect("body must be JSON");
    let matches = body["matches"].as_array().expect("matches array");
    assert_eq!(matches.len(), 2);
    assert_eq!(matches[0]["lineNumber"], 2);
    assert_eq!(matches[1]["lineNumber"], 3);
    assert_eq!(body["truncated"], false);
}

#[tokio::test]
async fn rejects_an_invalid_regex_query() {
    let root = tempfile::tempdir().expect("must create a temp directory");
    let target = root.path().join("log.txt");
    std::fs::write(&target, b"contents").expect("must create fixture");
    let server = TestServer::spawn().await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("{}/api/v1/files/search", server.base_url))
        .json(&json!({
            "location": location_json(&target),
            "query": "(unclosed",
            "regex": true,
            "caseSensitive": false,
        }))
        .send()
        .await
        .expect("request must succeed");

    assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
}
