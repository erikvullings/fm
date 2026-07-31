import { describe, expect, it, vi } from 'vitest';

import type { EntryMetadata, EntrySummary } from '../../models';
import {
  createEntryMetadataLoader,
  type EntryMetadataClient,
  type EntryMetadataView,
} from './entry-metadata-loader';

function entry(name: string): EntrySummary {
  return {
    id: `entry-${name}`,
    location: { providerId: 'local', uri: `file:///tmp/${name}` },
    name,
    kind: 'file',
    hidden: false,
    readOnly: false,
    metadataRevision: 1,
  };
}

function metadata(entryId: string): EntryMetadata {
  return {
    entryId,
    extendedAttributes: {},
    checksums: {},
    pluginFields: {},
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setup(): {
  readonly client: EntryMetadataClient;
  readonly views: EntryMetadataView[];
} {
  return {
    client: { getEntryMetadata: vi.fn() },
    views: [],
  };
}

describe('entry metadata loader', () => {
  it('fetches metadata only after a cursor entry is selected', async () => {
    const context = setup();
    vi.mocked(context.client.getEntryMetadata).mockResolvedValue(metadata('entry-report.txt'));
    const loader = createEntryMetadataLoader({
      client: context.client,
      update: (view) => context.views.push(view),
    });

    expect(context.client.getEntryMetadata).not.toHaveBeenCalled();
    await loader.select(entry('report.txt'));

    expect(context.client.getEntryMetadata).toHaveBeenCalledWith(
      {
        entryId: 'entry-report.txt',
        location: { providerId: 'local', uri: 'file:///tmp/report.txt' },
      },
      expect.any(AbortSignal),
    );
    expect(context.views.at(-1)).toEqual({
      state: 'loaded',
      entry: entry('report.txt'),
      metadata: metadata('entry-report.txt'),
    });
  });

  it('cancels the previous request when the cursor moves', async () => {
    const context = setup();
    const first = deferred<EntryMetadata>();
    vi.mocked(context.client.getEntryMetadata)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(metadata('entry-second.txt'));
    const loader = createEntryMetadataLoader({
      client: context.client,
      update: (view) => context.views.push(view),
    });

    const firstSelection = loader.select(entry('first.txt'));
    const firstSignal = vi.mocked(context.client.getEntryMetadata).mock.calls[0]?.[1];
    await loader.select(entry('second.txt'));

    expect(firstSignal?.aborted).toBe(true);
    first.resolve(metadata('entry-first.txt'));
    await firstSelection;
  });

  it('ignores a stale response that completes after the current response', async () => {
    const context = setup();
    const first = deferred<EntryMetadata>();
    vi.mocked(context.client.getEntryMetadata)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(metadata('entry-second.txt'));
    const loader = createEntryMetadataLoader({
      client: context.client,
      update: (view) => context.views.push(view),
    });

    const firstSelection = loader.select(entry('first.txt'));
    await loader.select(entry('second.txt'));
    first.resolve(metadata('entry-first.txt'));
    await firstSelection;

    expect(context.views.at(-1)).toMatchObject({
      state: 'loaded',
      entry: { id: 'entry-second.txt' },
      metadata: { entryId: 'entry-second.txt' },
    });
  });

  it('clearing the cursor cancels the request and publishes idle state', async () => {
    const context = setup();
    const pending = deferred<EntryMetadata>();
    vi.mocked(context.client.getEntryMetadata).mockReturnValue(pending.promise);
    const loader = createEntryMetadataLoader({
      client: context.client,
      update: (view) => context.views.push(view),
    });

    const selection = loader.select(entry('report.txt'));
    const signal = vi.mocked(context.client.getEntryMetadata).mock.calls[0]?.[1];
    await loader.select(undefined);

    expect(signal?.aborted).toBe(true);
    expect(context.views.at(-1)).toEqual({ state: 'idle' });
    pending.resolve(metadata('entry-report.txt'));
    await selection;
    expect(context.views.at(-1)).toEqual({ state: 'idle' });
  });

  it('disposal cancels the request and prevents later publications', async () => {
    const context = setup();
    const pending = deferred<EntryMetadata>();
    vi.mocked(context.client.getEntryMetadata).mockReturnValue(pending.promise);
    const loader = createEntryMetadataLoader({
      client: context.client,
      update: (view) => context.views.push(view),
    });

    const selection = loader.select(entry('report.txt'));
    const signal = vi.mocked(context.client.getEntryMetadata).mock.calls[0]?.[1];
    loader.dispose();
    const publicationsAtDisposal = context.views.length;

    expect(signal?.aborted).toBe(true);
    pending.resolve(metadata('entry-report.txt'));
    await selection;
    expect(context.views).toHaveLength(publicationsAtDisposal);
  });
});
