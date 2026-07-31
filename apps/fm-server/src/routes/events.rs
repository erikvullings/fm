//! Multiplexed browser event stream (task 0032).

use std::time::Duration;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::sse::{Event, KeepAlive};
use axum::response::{IntoResponse, Response, Sse};
use fm_events::{BackendEventPayload, EventAudience, SessionId, SubscriptionEvent};
use futures::stream;

use crate::state::AppState;

const DEVELOPMENT_SESSION_ID: &str = "local-development-session";

/// Streams every event visible to the explicit local development session.
#[utoipa::path(
    get,
    path = "/api/v1/events",
    operation_id = "subscribeEvents",
    responses((status = 200, description = "Multiplexed Server-Sent Events stream"))
)]
pub(crate) async fn get_events(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !origin_is_allowed(&state, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let last_event_id = match parse_last_event_id(&headers) {
        Ok(value) => value,
        Err(status) => return status.into_response(),
    };
    let bus = state.service.event_bus();
    let session_id = SessionId::new(DEVELOPMENT_SESSION_ID);
    let subscription = bus.subscribe_all_workspaces(session_id.clone(), last_event_id);
    let session_end = state.session_end;
    bus.publish(
        EventAudience::Session(session_id),
        BackendEventPayload::RuntimeReady,
    );

    let events = stream::unfold(
        (subscription, session_end),
        |(mut subscription, session_end)| async move {
            let received = tokio::select! {
                () = session_end.cancelled() => return None,
                received = subscription.recv() => received,
            };
            let item = match received {
                Ok(SubscriptionEvent::Event(envelope)) => {
                    let name = envelope.payload.event_name();
                    let id = envelope.event_id.to_string();
                    serde_json::to_string(&envelope)
                        .map(|data| Event::default().event(name).id(id).data(data))
                }
                Ok(SubscriptionEvent::Gap {
                    last_event_id,
                    oldest_available_id,
                    newest_available_id,
                }) => serde_json::to_string(&serde_json::json!({
                    "lastEventId": last_event_id,
                    "oldestAvailableId": oldest_available_id,
                    "newestAvailableId": newest_available_id,
                }))
                .map(|data| Event::default().event("resynchronise").data(data)),
                Err(_) => return None,
            };
            Some((item, (subscription, session_end)))
        },
    );
    Sse::new(events)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("keep-alive"),
        )
        .into_response()
}

fn parse_last_event_id(headers: &HeaderMap) -> Result<Option<u64>, StatusCode> {
    headers.get("last-event-id").map_or(Ok(None), |value| {
        value
            .to_str()
            .ok()
            .and_then(|value| value.parse().ok())
            .map(Some)
            .ok_or(StatusCode::BAD_REQUEST)
    })
}

fn origin_is_allowed(state: &AppState, headers: &HeaderMap) -> bool {
    headers.get(header::ORIGIN).is_none_or(|origin| {
        origin.to_str().is_ok_and(|origin| {
            state
                .cors_allowed_origins
                .iter()
                .any(|allowed| allowed == origin)
        })
    })
}
