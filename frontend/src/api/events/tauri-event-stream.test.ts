import { describe, expect, it, vi } from 'vitest';

import { TauriEventStream } from './tauri-event-stream';

describe('TauriEventStream', () => {
  it('starts closed and reports open once connected', async () => {
    const stream = new TauriEventStream();

    expect(stream.status.get()).toBe('closed');

    await stream.connect();

    expect(stream.status.get()).toBe('open');
  });

  it('notifies status subscribers on transitions and closes back to closed', async () => {
    const stream = new TauriEventStream();
    const statuses: string[] = [];
    const unsubscribe = stream.status.subscribe((status) => statuses.push(status));

    await stream.connect();
    stream.close();
    unsubscribe();
    stream.close();

    expect(statuses).toEqual(['open', 'closed']);
  });

  it('exposes a listener registry that dispatches to subscribers', () => {
    const stream = new TauriEventStream();
    const listener = vi.fn();
    const unsubscribeListener = stream.listeners.subscribe(listener);

    const event = {
      eventId: 1,
      timestamp: '2026-01-01T00:00:00Z',
      payload: { type: 'runtime.ready' },
    } as never;
    stream.listeners.dispatch(event);
    unsubscribeListener();
    stream.listeners.dispatch(event);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event);
  });
});
