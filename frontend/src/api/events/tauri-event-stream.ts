import type { Unsubscribe } from '../../models';
import {
  BackendEventListenerRegistry,
  type EventStream,
  type EventStreamStatus,
  type EventStreamStatusObservable,
} from './event-stream';

/** Minimal mutable status observable shared by both transport implementations. */
class MutableEventStreamStatus implements EventStreamStatusObservable {
  private current: EventStreamStatus = 'closed';
  private readonly listeners = new Set<(status: EventStreamStatus) => void>();

  get(): EventStreamStatus {
    return this.current;
  }

  subscribe(listener: (status: EventStreamStatus) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  set(next: EventStreamStatus): void {
    if (this.current === next) {
      return;
    }
    this.current = next;
    for (const listener of [...this.listeners]) {
      listener(next);
    }
  }
}

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

  // TODO(0034): subscribe to the Tauri channel/event forwarding the backend
  // `EventBus` and dispatch parsed envelopes via `this.listeners`.
  async connect(): Promise<void> {
    this.status.set('open');
  }

  close(): void {
    this.status.set('closed');
  }
}
