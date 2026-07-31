//! Route handlers, kept thin: they only map request -> service call -> DTO
//! (spec §3 rule 2).

pub(crate) mod directory;
pub(crate) mod health;
pub(crate) mod runtime;
pub(crate) mod settings;
pub(crate) mod workspace;

use utoipa::OpenApi;

/// OpenAPI document metadata. Operation schemas are collected automatically
/// from the `#[utoipa::path]` annotations on the handlers above as they are
/// registered with `utoipa_axum::routes!`.
#[derive(OpenApi)]
#[openapi(info(title = "File Manager API", version = "1.0.0"))]
struct ApiDoc;

/// Builds the base OpenAPI document that routes are registered into.
pub(crate) fn api_doc() -> utoipa::openapi::OpenApi {
    ApiDoc::openapi()
}
