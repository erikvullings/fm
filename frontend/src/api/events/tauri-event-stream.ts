import {
  BackendEventListenerRegistry,
  type EventStream,
  EventStreamSignalRegistry,
  MutableEventStreamStatus,
} from './event-stream';

/**
 * Tauri transport implementation of `EventStream` (spec §11, §12, task
 * 0015). This is a minimal skeleton: `connect()` marks the stream open and
 * `listeners` is ready to receive `BackendEvent`s, but nothing forwards the
 * backend `EventBus` yet. Wiring a Tauri channel/event subscription that
 * parses each payload with `parseBackendEvent` and dispatches it via
 * `listeners`, plus documenting the "disconnect" status semantics for a
 * channel that cannot truly disconnect, is task 0034's scope (depends on
 * 0033's SSE parity work landing first).
 */
export class TauriEventStream implements EventStream {
  readonly status = new MutableEventStreamStatus();
  readonly listeners = new BackendEventListenerRegistry();
  readonly resynchronise = new EventStreamSignalRegistry();

  // TODO(0034): subscribe to the Tauri channel/event forwarding the backend
  // `EventBus` and dispatch parsed envelopes via `this.listeners`.
  async connect(): Promise<void> {
    this.status.set('open');
  }

  close(): void {
    this.status.set('closed');
  }
}
