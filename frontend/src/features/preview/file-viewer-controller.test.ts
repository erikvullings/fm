import { describe, expect, it, vi } from 'vitest';

import type { EntrySummary, PaneId } from '../../models';
import {
  createFileViewerController,
  type FileViewerClient,
  type FileViewerState,
  TEXT_WINDOW_BYTES,
} from './file-viewer-controller';
import { loadPdfDocument } from './pdf-preview';

vi.mock('./pdf-preview', () => ({
  loadPdfDocument: vi.fn().mockResolvedValue({ numPages: 3 }),
}));

/** Builds a fake pdf.js document whose pages' text content is `pageText[pageNumber - 1]`. */
function fakePdfDocument(pageText: readonly string[]): {
  readonly numPages: number;
  readonly getPage: (
    pageNumber: number,
  ) => Promise<{ getTextContent: () => Promise<{ items: { str: string }[] }> }>;
} {
  return {
    numPages: pageText.length,
    getPage: (pageNumber: number) =>
      Promise.resolve({
        getTextContent: () => Promise.resolve({ items: [{ str: pageText[pageNumber - 1] ?? '' }] }),
      }),
  };
}

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
    client: { readFileRange: vi.fn(), searchInFile: vi.fn(), listDirectory: vi.fn() },
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
      content: { windowOffset: expectedWindowOffset, highlightOffset: 9, highlightLength: 0 },
      search: {
        matches: [{ offset: 40_000, length: 3, lineNumber: 1200 }],
        currentMatchIndex: 0,
      },
    });
  });

  it('converts the match byte offset to a character offset when multi-byte text precedes it', async () => {
    // "café — cat": byte offset of "cat" is 10 (é=2 bytes, — =3 bytes), but its character offset
    // is only 7 - using the raw byte offset directly (the bug) would highlight 3 characters late.
    const fileText = 'café — cat';
    const fileBytes = new TextEncoder().encode(fileText);
    const matchOffset = fileBytes.indexOf('c'.charCodeAt(0), 8); // byte offset of "cat"
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValueOnce({
      data: Array.from(fileBytes),
      offset: 0,
      length: fileBytes.length,
      eof: true,
    });
    const controller = createFileViewerController({
      client: context.client,
      entry: entry(),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));

    vi.mocked(context.client.searchInFile).mockResolvedValue({
      matches: [{ offset: matchOffset, length: 3, lineNumber: 1 }],
      truncated: false,
    });
    vi.mocked(context.client.readFileRange).mockResolvedValueOnce({
      data: Array.from(fileBytes),
      offset: 0,
      length: fileBytes.length,
      eof: true,
    });
    controller.setSearchOptions({ query: 'cat' });
    await controller.runSearch();

    const last = context.states.at(-1);
    expect(last).toMatchObject({
      status: 'ready',
      content: {
        windowOffset: 0,
        highlightOffset: fileText.indexOf('cat'),
        highlightLength: 3,
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

  it('copies the loaded text window to the clipboard', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: [104, 105],
      offset: 0,
      length: 2,
      eof: true,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const controller = createFileViewerController({
      client: context.client,
      entry: entry(),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));

    await controller.copyContent();

    expect(writeText).toHaveBeenCalledWith('hi');
    vi.unstubAllGlobals();
  });

  it('copies the loaded image to the clipboard as image bytes', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: [1, 2, 3],
      offset: 0,
      length: 3,
      eof: true,
    });
    const write = vi.fn().mockResolvedValue(undefined);
    class FakeClipboardItem {
      constructor(readonly items: Record<string, Blob>) {}
    }
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const controller = createFileViewerController({
      client: context.client,
      entry: entry({ name: 'photo.png', extension: 'png' }),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));

    await controller.copyContent();

    expect(write).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('computes text metadata (size/lines/characters/language) when the panel is opened', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: [104, 105, 10, 104, 105],
      offset: 0,
      length: 5,
      eof: true,
    });
    const controller = createFileViewerController({
      client: context.client,
      entry: entry({ extension: 'ts', name: 'report.ts', size: 5 }),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));

    controller.toggleMetadataPanel();

    const state = context.states.at(-1);
    expect(state).toMatchObject({
      metadataPanelOpen: true,
      metadata: {
        kind: 'text',
        sizeBytes: 5,
        lineCount: 2,
        characterCount: 5,
        language: 'typescript',
      },
    });
  });

  it('toggles the metadata panel closed again without discarding the computed metadata', async () => {
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

    controller.toggleMetadataPanel();
    controller.toggleMetadataPanel();

    const state = context.states.at(-1);
    expect(state).toMatchObject({ metadataPanelOpen: false });
    expect((state as { metadata?: unknown }).metadata).toBeDefined();
  });

  it('loads a PDF and exposes page count/current page, navigable via next/previousPage', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: [1, 2, 3],
      offset: 0,
      length: 3,
      eof: true,
    });
    const controller = createFileViewerController({
      client: context.client,
      entry: entry({ name: 'report.pdf', extension: 'pdf' }),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));
    expect(context.states.at(-1)).toMatchObject({
      content: { kind: 'pdf', pageCount: 3, currentPage: 1 },
    });

    controller.nextPage();
    expect(context.states.at(-1)).toMatchObject({ content: { currentPage: 2 } });
    controller.previousPage();
    controller.previousPage();
    expect(context.states.at(-1)).toMatchObject({ content: { currentPage: 1 } });

    controller.nextPage();
    controller.nextPage();
    controller.nextPage();
    expect(context.states.at(-1)).toMatchObject({ content: { currentPage: 3 } });
  });

  it('finds matching PDF pages via simple text search and jumps between them', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: [1, 2, 3],
      offset: 0,
      length: 3,
      eof: true,
    });
    vi.mocked(loadPdfDocument).mockResolvedValueOnce(
      fakePdfDocument(['apple pie', 'banana bread', 'apple crumble']) as never,
    );
    const controller = createFileViewerController({
      client: context.client,
      entry: entry({ name: 'report.pdf', extension: 'pdf' }),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));

    controller.setPdfSearchQuery('apple');
    await vi.waitFor(() =>
      expect(context.states.at(-1)).toMatchObject({
        pdfSearch: { matches: [1, 3], currentMatchIndex: 0 },
        content: { currentPage: 1 },
      }),
    );

    controller.goToNextPdfMatch();
    expect(context.states.at(-1)).toMatchObject({
      content: { currentPage: 3 },
      pdfSearch: { currentMatchIndex: 1 },
    });

    controller.goToPreviousPdfMatch();
    expect(context.states.at(-1)).toMatchObject({
      content: { currentPage: 1 },
      pdfSearch: { currentMatchIndex: 0 },
    });
  });

  it('clears PDF search matches when the query is emptied', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: [1, 2, 3],
      offset: 0,
      length: 3,
      eof: true,
    });
    vi.mocked(loadPdfDocument).mockResolvedValueOnce(fakePdfDocument(['apple', 'banana']) as never);
    const controller = createFileViewerController({
      client: context.client,
      entry: entry({ name: 'report.pdf', extension: 'pdf' }),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('ready'));

    controller.setPdfSearchQuery('apple');
    await vi.waitFor(() =>
      expect(context.states.at(-1)).toMatchObject({ pdfSearch: { matches: [1] } }),
    );

    controller.setPdfSearchQuery('');
    expect(context.states.at(-1)).toMatchObject({ pdfSearch: { query: '', matches: [] } });
  });

  it('loads an EPUB, parsing container.xml/OPF and rendering the first chapter', async () => {
    const context = setup();
    const containerXml =
      '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>';
    const opfXml =
      '<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Book</dc:title></metadata>' +
      '<manifest>' +
      '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>' +
      '</manifest>' +
      '<spine><itemref idref="c1"/><itemref idref="c2"/></spine>' +
      '</package>';
    const chapterHtml: Record<string, string> = {
      'archive:///tmp/report.txt!/OEBPS/c1.xhtml': '<p>Chapter one</p>',
      'archive:///tmp/report.txt!/OEBPS/c2.xhtml': '<p>Chapter two</p>',
    };
    vi.mocked(context.client.readFileRange).mockImplementation(async (request) => {
      const uri = request.location.uri;
      const text = uri.endsWith('META-INF/container.xml')
        ? containerXml
        : uri.endsWith('OEBPS/content.opf')
          ? opfXml
          : (chapterHtml[uri] ?? '');
      const data = Array.from(new TextEncoder().encode(text));
      return { data, offset: 0, length: data.length, eof: true };
    });
    const controller = createFileViewerController({
      client: context.client,
      entry: entry({ name: 'book.epub', extension: 'epub' }),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() =>
      expect(context.states.at(-1)).toMatchObject({
        content: { kind: 'epub', currentChapterHtml: expect.any(String) },
      }),
    );
    expect(context.states.at(-1)).toMatchObject({
      content: { title: 'Book', chapterCount: 2, currentChapter: 0, loadingChapter: false },
    });
    expect(
      (context.states.at(-1) as { content: { currentChapterHtml: string } }).content
        .currentChapterHtml,
    ).toContain('Chapter one');

    controller.nextPage();
    await vi.waitFor(() =>
      expect(
        (context.states.at(-1) as { content: { currentChapterHtml?: string } }).content
          .currentChapterHtml,
      ).toContain('Chapter two'),
    );
    expect(context.states.at(-1)).toMatchObject({ content: { currentChapter: 1 } });
  });

  it('shows an error for an EPUB without a locatable OPF package document', async () => {
    const context = setup();
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: Array.from(new TextEncoder().encode('<container><rootfiles/></container>')),
      offset: 0,
      length: 10,
      eof: true,
    });
    createFileViewerController({
      client: context.client,
      entry: entry({ name: 'book.epub', extension: 'epub' }),
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('error'));
  });

  it('loads a comic archive, fetching the first page and paginating on demand', async () => {
    const context = setup();
    const paneId = 'pane-a' as PaneId;
    vi.mocked(context.client.listDirectory).mockResolvedValue({
      paneId,
      requestId: 'req-1',
      revision: 1,
      location: { providerId: 'archive', uri: 'archive:///tmp/book.cbz!/' },
      writable: false,
      hasMore: false,
      loadingState: { type: 'loaded' },
      entries: [
        entry({
          id: 'page-2',
          name: 'page02.jpg',
          extension: 'jpg',
          location: { providerId: 'archive', uri: 'archive:///tmp/book.cbz!/page02.jpg' },
        }),
        entry({
          id: 'page-1',
          name: 'page01.jpg',
          extension: 'jpg',
          location: { providerId: 'archive', uri: 'archive:///tmp/book.cbz!/page01.jpg' },
        }),
      ],
    });
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: [1, 2, 3],
      offset: 0,
      length: 3,
      eof: true,
    });
    const controller = createFileViewerController({
      client: context.client,
      entry: entry({ name: 'book.cbz', extension: 'cbz' }),
      workspaceId: 'workspace-1',
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() =>
      expect(context.states.at(-1)).toMatchObject({
        content: { kind: 'comic', currentPageDataUri: expect.any(String) },
      }),
    );
    expect(context.states.at(-1)).toMatchObject({
      content: { pageCount: 2, currentPage: 0, loadingPage: false },
    });

    controller.nextPage();
    await vi.waitFor(() =>
      expect(context.states.at(-1)).toMatchObject({
        content: { currentPage: 1, loadingPage: false },
      }),
    );
  });

  it('finds comic pages nested inside a single wrapper folder at the archive root', async () => {
    // Some CBR/CBZ archives (e.g. "one folder per volume" scans) wrap their pages in a top-level
    // directory instead of placing them at the archive root - the root listing alone finds no
    // images, so the controller must descend into subdirectories before giving up.
    const context = setup();
    vi.mocked(context.client.listDirectory).mockImplementation(async (request) => {
      const atRoot = request.location.uri === 'archive:///tmp/book.cbr!/';
      return {
        paneId: 'pane-a' as PaneId,
        requestId: 'req-1',
        revision: 1,
        location: request.location,
        writable: false,
        hasMore: false,
        loadingState: { type: 'loaded' },
        entries: atRoot
          ? [
              entry({
                id: 'wrapper',
                name: 'Volume 1',
                kind: 'directory',
                location: { providerId: 'archive', uri: 'archive:///tmp/book.cbr!/Volume 1' },
              }),
            ]
          : [
              entry({
                id: 'page-1',
                name: 'page01.jpg',
                extension: 'jpg',
                location: {
                  providerId: 'archive',
                  uri: 'archive:///tmp/book.cbr!/Volume 1/page01.jpg',
                },
              }),
            ],
      };
    });
    vi.mocked(context.client.readFileRange).mockResolvedValue({
      data: [1, 2, 3],
      offset: 0,
      length: 3,
      eof: true,
    });
    createFileViewerController({
      client: context.client,
      entry: entry({ name: 'book.cbr', extension: 'cbr' }),
      workspaceId: 'workspace-1',
      update: (state) => context.states.push(state),
    });
    await vi.waitFor(() =>
      expect(context.states.at(-1)).toMatchObject({
        content: { kind: 'comic', pageCount: 1, currentPageDataUri: expect.any(String) },
      }),
    );
  });

  it('shows an error for a comic opened without workspace context', async () => {
    const context = setup();
    const controller = createFileViewerController({
      client: context.client,
      entry: entry({ name: 'book.cbz', extension: 'cbz' }),
      update: (state) => context.states.push(state),
    });
    void controller;
    await vi.waitFor(() => expect(context.states.at(-1)?.status).toBe('error'));
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
