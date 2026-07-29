import type { BackendEvent, Unsubscribe } from '../../models';

/** Connection lifecycle shared by HTTP and Tauri event streams. */
export type EventStreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Small observable contract for connection status without coupling to a state library. */
export interface EventStreamStatusObservable {
  get(): EventStreamStatus;
  subscribe(listener: (status: EventStreamStatus) => void): Unsubscribe;
}

/** Logs the discriminator of an event unknown to this frontend version. */
export type UnknownEventLogger = (eventType: string) => void;

/** Options controlling forward-compatibility diagnostics while parsing. */
export interface ParseBackendEventOptions {
  development?: boolean;
  logger?: UnknownEventLogger;
}

/** Registry used by each transport implementation to fan events out to subscribers. */
export class BackendEventListenerRegistry {
  private readonly listeners = new Set<(event: BackendEvent) => void>();

  /** Registers a listener and returns a function that removes it. */
  subscribe(listener: (event: BackendEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Delivers one parsed event to a stable snapshot of current listeners. */
  dispatch(event: BackendEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

/** Transport-neutral lifecycle and listener surface implemented by SSE and Tauri streams. */
export interface EventStream {
  readonly status: EventStreamStatusObservable;
  readonly listeners: BackendEventListenerRegistry;
  connect(): Promise<void>;
  close(): void;
}

const KNOWN_EVENT_TYPES = new Set([
  'runtime.ready',
  'workspace.updated',
  'directory.snapshot',
  'directory.delta',
  'operation.created',
  'operation.progress',
  'operation.stateChanged',
  'operation.conflict',
  'operation.completed',
  'operation.failed',
  'plugin.changed',
  'notification.created',
]);
const loggedUnknownEventTypes = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultUnknownEventLogger(eventType: string): void {
  console.warn(`Ignoring unknown backend event type: ${eventType}`);
}

/**
 * Parses the stable envelope boundary. Unknown future event types and malformed
 * data are ignored so an older frontend can remain connected to a newer backend.
 */
export function parseBackendEvent(
  input: unknown,
  options: ParseBackendEventOptions = {},
): BackendEvent | undefined {
  if (!isRecord(input) || !isRecord(input.payload)) {
    return undefined;
  }
  const { eventId, timestamp, workspaceId, payload } = input;
  const eventType = payload.type;
  if (
    typeof eventId !== 'number' ||
    !Number.isSafeInteger(eventId) ||
    eventId < 0 ||
    typeof timestamp !== 'string' ||
    (workspaceId !== undefined && typeof workspaceId !== 'string') ||
    typeof eventType !== 'string'
  ) {
    return undefined;
  }
  if (!KNOWN_EVENT_TYPES.has(eventType)) {
    const development = options.development ?? import.meta.env.DEV;
    if (development && !loggedUnknownEventTypes.has(eventType)) {
      loggedUnknownEventTypes.add(eventType);
      (options.logger ?? defaultUnknownEventLogger)(eventType);
    }
    return undefined;
  }

  return input as unknown as BackendEvent;
}
