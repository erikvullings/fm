# 0113 Extract EventHandler Registry from AppShell

Status: open
Priority: high
Subsystem: frontend
Depends on: none

## Context
AppShell's `handleBackendEvent` method is a ~100-line switch statement dispatching 25+ backend event types. Each case mixes concerns: directory delta application, operation progress updates, tab state mutation, connection refresh. Adding a new event type means editing AppShell. The deletion test confirms this dispatch logic should be a module — deleting it would scatter event handling across every caller.

## Acceptance Criteria
- Event handler registry module with small interface: `createEventHandlerRegistry(client, actions)` returning `(event) => void`
- Each event type has a registered handler function configured at bootstrap
- Handlers close over only the state slice they need
- AppShell calls the single registry function per incoming event
- Zero change in visible behavior — this is a refactor
- Each handler testable independently with crafted events, no DOM required

## Implementation Notes
- `frontend/src/app/app-shell.ts` — `handleBackendEvent` method (~100 lines switch/case)
- `frontend/src/models/events.ts` — `BackendEventPayload` tagged union (25+ event types)
- New module: `frontend/src/features/events/event-handler-registry.ts` (or adjacent to `api/events/`)
- Handlers depend on `FileManagerClient` and relevant state actions
- Reference: architecture review — deepening opportunity #2

## Agent Notes
-
