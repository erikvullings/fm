import { describe, expect, it, vi } from 'vitest';

import type { EntrySummary } from '../../models';
import {
  createFileViewerController,
  type FileViewerClient,
  type FileViewerState,
  TEXT_WINDOW_BYTES,
} from './file-viewer-controller';

function entry(overrides: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id: 'entry-report.txt',
    location: { providerId: 'local', uri: 'file:///tmp/report.txt' },
    name: 'report.txt',
    kind: 'file',
    hidden: false,
    readOnly: false,
    metadataRevision: 1,
    ...overrides,
  };
}

function setup(): {
  readonly client: FileViewerClient;
  readonly states: FileViewerState[];
} {
  return {
    client: { readFileRange: vi.fn(), searchInFile: vi.fn() },
    states: [],
  };
}

function textOf(state: FileViewerState | undefined): string | undefined {
  return state !== undefined && state.status === 'ready' && state.content.kind === 'text'
    ? state.content.text
    : undefined;
}

describe('file viewer controller', () => {
  it('loads the first text window immediately on creation', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: [104, 105],
      offset: 0,
      length: 2,
      eof: true,
    });
    createFileViewerController({
      client: context.client,
      entry: entry(),
      update: (state) => context.states.push(state),
    });

    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));
    expect(context.states[0]).toEqual({ status: 'loading', entry: entry() });
    expect(textOf(context.states.at(-1))).toBe('hi');
    expect(context.states.at(-1)).toMatchObject({
      content: { kind: 'text', windowOffset: 0, atStart: true, atEnd: true },
    });
  });

  it('publishes unsupported when the first chunk sniffs as binary', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: [0, 1, 2],
      offset: 0,
      length: 3,
      eof: true,
      probablyBinary: true,
    });
    createFileViewerController({
      client: context.client,
      entry: entry(),
      update: (state) => context.states.push(state),
    });

    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('unsupported'));
  });

  it('loads a full image as a data URI regardless of size', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange)
      .mockResolvedValueOnce({ data: [1, 2, 3], offset: 0, length: 3, eof: false })
      .mockResolvedValueOnce({ data: [4, 5], offset: 3, length: 2, eof: true });
    createFileViewerController({
      client: context.client,
      entry: entry({ name: 'photo.png', extension: 'png' }),
      update: (state) => context.states.push(state),
    });

    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));
    expect(context.states.at(-1)).toMatchObject({
      content: { kind: 'image', zoom: 1, fitToContainer: true },
    });
  });

  it('appends the next window via loadMore, without re-fetching from the start', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValueOnce({
      data: [104],
      offset: 0,
      length: 1,
      eof: false,
    });
    const controller = createFileViewerController({
      client: context.client,
      entry: entry(),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));

    vi.mocked(context.client.readFileRange).mockResolvedValueOnce({
      data: [105],
      offset: 1,
      length: 1,
      eof: true,
    });
    await controller.loadMore();

    expect(context.client.readFileRange).toHaveBeenLastCalledWith(
      { location: entry().location, offset: 1, length: TEXT_WINDOW_BYTES },
      expect.any(AbortSignal),
    );
    expect(textOf(context.states.at(-1))).toBe('hi');
    expect(context.states.at(-1)).toMatchObject({ content: { atEnd: true } });
  });

  it('does not loadMore past the end of the file', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: [104],
      offset: 0,
      length: 1,
      eof: true,
    });
    const controller = createFileViewerController({
      client: context.client,
      entry: entry(),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));

    await controller.loadMore();

    expect(context.client.readFileRange).toHaveBeenCalledTimes(1);
  });

  it('runs a search and jumps to the first match', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValueOnce({
      data: Array.from('start\n', (char) => char.charCodeAt(0)),
      offset: 0,
      length: 6,
      eof: false,
    });
    const controller = createFileViewerController({
      client: context.client,
      entry: entry(),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));

    vi.mocked(context.client.searchInFile).mockResolvedValue({
      matches: [{ offset: 40_000, length: 3, lineNumber: 1200 }],
      truncated: false,
    });
    const expectedWindowOffset = 40_000 - TEXT_WINDOW_BYTES / 2;
    vi.mocked(context.client.readFileRange).mockResolvedValueOnce({
      data: Array.from('...cat...', (char) => char.charCodeAt(0)),
      offset: expectedWindowOffset,
      length: 9,
      eof: false,
    });
    controller.setSearchOptions({ query: 'cat' });
    await controller.runSearch();

    expect(context.client.searchInFile).toHaveBeenCalledWith(
      {
        location: entry().location,
        query: 'cat',
        regex: false,
        caseSensitive: false,
        wholeWord: false,
      },
      expect.any(AbortSignal),
    );
    const last = context.states.at(-1);
    expect(last).toMatchObject({
      status: 'ready',
      content: { windowOffset: expectedWindowOffset, highlightOffset: 40_000, highlightLength: 3 },
      search: {
        matches: [{ offset: 40_000, length: 3, lineNumber: 1200 }],
        currentMatchIndex: 0,
      },
    });
  });

  it('runs a debounced search automatically as the query is edited, without requiring runSearch', async () => {
    vi.useFakeTimers();
    try {
      const context = setup();
      vi.mocked(context.client.readFileRange).mockResolvedValueOnce({
        data: Array.from('start\n', (char) => char.charCodeAt(0)),
        offset: 0,
        length: 6,
        eof: false,
      });
      const controller = createFileViewerController({
        client: context.client,
        entry: entry(),
        update: (state) => context.states.push(state),
      });
      await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'), {
        timeout: 1000,
        interval: 1,
      });

      vi.mocked(context.client.searchInFile).mockResolvedValue({ matches: [], truncated: false });
      controller.setSearchOptions({ query: 'cat' });
      expect(context.client.searchInFile).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);
      expect(context.client.searchInFile).toHaveBeenCalledTimes(1);
      expect(context.client.searchInFile).toHaveBeenCalledWith(
        {
          location: entry().location,
          query: 'cat',
          regex: false,
          caseSensitive: false,
          wholeWord: false,
        },
        expect.any(AbortSignal),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears stale matches immediately once the query is emptied, without waiting on the debounce', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValueOnce({
      data: Array.from('start\n', (char) => char.charCodeAt(0)),
      offset: 0,
      length: 6,
      eof: false,
    });
    const controller = createFileViewerController({
      client: context.client,
      entry: entry(),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));

    controller.setSearchOptions({
      query: '',
    });
    const last = context.states.at(-1);
    expect(last).toMatchObject({ search: { query: '', matches: [] } });
  });

  it('wraps around when navigating past the last match', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValueOnce({
      data: [1],
      offset: 0,
      length: 1,
      eof: true,
    });
    const controller = createFileViewerController({
      client: context.client,
      entry: entry(),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));

    vi.mocked(context.client.searchInFile).mockResolvedValue({
      matches: [
        { offset: 10, length: 1, lineNumber: 1 },
        { offset: 20, length: 1, lineNumber: 2 },
      ],
      truncated: false,
    });
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: [1],
      offset: 0,
      length: 1,
      eof: true,
    });
    controller.setSearchOptions({ query: 'x' });
    await controller.runSearch();
    expect(context.states.at(-1)).toMatchObject({ search: { currentMatchIndex: 0 } });

    await controller.goToNextMatch();
    expect(context.states.at(-1)).toMatchObject({ search: { currentMatchIndex: 1 } });

    await controller.goToNextMatch();
    expect(context.states.at(-1)).toMatchObject({ search: { currentMatchIndex: 0 } });

    await controller.goToPreviousMatch();
    expect(context.states.at(-1)).toMatchObject({ search: { currentMatchIndex: 1 } });
  });

  it('zooms an image in, out, and resets to fit-to-container', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: [1],
      offset: 0,
      length: 1,
      eof: true,
    });
    const controller = createFileViewerController({
      client: context.client,
      entry: entry({ name: 'photo.png', extension: 'png' }),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));

    controller.zoomIn();
    expect(context.states.at(-1)).toMatchObject({ content: { fitToContainer: false, zoom: 1.25 } });

    controller.zoomOut();
    expect(context.states.at(-1)).toMatchObject({ content: { zoom: 1 } });

    controller.zoomIn();
    controller.resetZoom();
    expect(context.states.at(-1)).toMatchObject({ content: { fitToContainer: true, zoom: 1 } });
  });

  it('publishes an error state when the initial load rejects', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockRejectedValue(new Error('boom'));
    createFileViewerController({
      client: context.client,
      entry: entry(),
      update: (state) => context.states.push(state),
    });

    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('error'));
    expect(context.states.at(-1)).toEqual({ status: 'error', entry: entry(), message: 'boom' });
  });

  it('stops publishing after dispose', async () => {
    const context = setup();
    const pending = new Promise<never>(() => undefined);
    vi.mocked(context.client.readFileRange).mockReturnValue(pending);
    const controller = createFileViewerController({
      client: context.client,
      entry: entry(),
      update: (state) => context.states.push(state),
    });
    const countBeforeDispose = context.states.length;
    controller.dispose();

    await controller.loadMore();

    expect(context.states.length).toBe(countBeforeDispose);
  });
});
