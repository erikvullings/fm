import { describe, expect, it, vi } from 'vitest';

import fixture from '../../../../fixtures/events/operation-progress.json';
import type { BackendEvent } from '../../models';
import {
  BackendEventListenerRegistry,
  parseBackendEvent,
  type UnknownEventLogger,
} from './event-stream';

describe('parseBackendEvent', () => {
  it('parses the Rust-generated event envelope fixture', () => {
    const event = parseBackendEvent(fixture);

    expect(event).toEqual(fixture);
  });

  it('ignores a future event type without throwing and logs it once in development', () => {
    const logger = vi.fn<UnknownEventLogger>();
    const futureEvent = {
      eventId: 1043,
      timestamp: '2026-07-29T12:35:00Z',
      payload: { type: 'directory.reindexed', revision: 9 },
    };

    expect(parseBackendEvent(futureEvent, { development: true, logger })).toBeUndefined();
    expect(parseBackendEvent(futureEvent, { development: true, logger })).toBeUndefined();
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith('directory.reindexed');
  });

  it('ignores malformed envelopes without throwing', () => {
    expect(parseBackendEvent({ payload: { type: 'runtime.ready' } })).toBeUndefined();
    expect(parseBackendEvent(null)).toBeUndefined();
  });
});

describe('BackendEventListenerRegistry', () => {
  it('dispatches known events to every listener and supports unsubscribe', () => {
    const registry = new BackendEventListenerRegistry();
    const first = vi.fn<(event: BackendEvent) => void>();
    const second = vi.fn<(event: BackendEvent) => void>();
    const unsubscribeFirst = registry.subscribe(first);
    registry.subscribe(second);
    const event = parseBackendEvent(fixture);
    expect(event).toBeDefined();

    registry.dispatch(event as BackendEvent);
    unsubscribeFirst();
    registry.dispatch(event as BackendEvent);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
