import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntrySummary } from '../../models';
import { FileViewer, type FileViewerAttrs } from './file-viewer';
import type { FileViewerState } from './file-viewer-controller';

let root: HTMLElement;

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

function baseAttrs(
  state: FileViewerState,
  overrides: Partial<FileViewerAttrs> = {},
): FileViewerAttrs {
  return {
    state,
    onLoadMore: vi.fn(),
    onSearchQueryChange: vi.fn(),
    onSearchOptionChange: vi.fn(),
    onRunSearch: vi.fn(),
    onNextMatch: vi.fn(),
    onPreviousMatch: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onResetZoom: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

function mount(attrs: FileViewerAttrs): void {
  m.mount(root, { view: () => m(FileViewer, attrs) });
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  m.mount(root, null);
  root.remove();
});

describe('FileViewer', () => {
  it('shows a loading message while loading', () => {
    mount(baseAttrs({ status: 'loading', entry: entry() }));
    expect(root.querySelector('.fm-file-viewer-body')?.textContent).toBe('Loading…');
  });

  it('shows an unsupported message for binary content', () => {
    mount(baseAttrs({ status: 'unsupported', entry: entry() }));
    expect(root.querySelector('.fm-file-viewer-body')?.textContent).toContain(
      'Preview not available',
    );
  });

  it('shows the error message on failure', () => {
    mount(baseAttrs({ status: 'error', entry: entry(), message: 'boom' }));
    expect(root.querySelector('.fm-file-viewer-body')?.textContent).toBe('boom');
  });

  it('renders text content and a search bar', () => {
    mount(
      baseAttrs({
        status: 'ready',
        entry: entry(),
        content: {
          kind: 'text',
          windowOffset: 0,
          windowEnd: 5,
          text: 'hello',
          atStart: true,
          atEnd: true,
          loadingMore: false,
        },
      }),
    );
    expect(root.querySelector('.cm-content')?.textContent).toBe('hello');
    expect(root.querySelector('.fm-file-viewer-search-input')).not.toBeNull();
  });

  it('renders Markdown for F3 instead of showing its source', () => {
    mount(
      baseAttrs({
        status: 'ready',
        entry: entry({ name: 'README.md', extension: 'md' }),
        content: {
          kind: 'text',
          windowOffset: 0,
          windowEnd: 7,
          text: '# Title',
          atStart: true,
          atEnd: true,
          loadingMore: false,
        },
      }),
    );

    expect(root.querySelector('.fm-file-viewer-markdown h1')?.textContent).toBe('Title');
    expect(root.querySelector('.cm-editor')).toBeNull();
  });

  it('highlights the active search match within the loaded window', () => {
    mount(
      baseAttrs({
        status: 'ready',
        entry: entry(),
        content: {
          kind: 'text',
          windowOffset: 0,
          windowEnd: 11,
          text: 'hello world',
          atStart: true,
          atEnd: true,
          loadingMore: false,
          highlightOffset: 6,
          highlightLength: 5,
        },
        search: {
          query: 'world',
          regex: false,
          caseSensitive: false,
          wholeWord: false,
          matches: [{ offset: 6, length: 5, lineNumber: 1 }],
          truncated: false,
          currentMatchIndex: 0,
          searching: false,
          error: undefined,
        },
      }),
    );
    expect(root.querySelector('.cm-content')?.textContent).toBe('hello world');
    expect(root.querySelector('.fm-file-viewer-search-count')?.textContent).toBe('1 of 1');
  });

  it('renders image content sized to fit by default', () => {
    mount(
      baseAttrs({
        status: 'ready',
        entry: entry({ name: 'photo.png', extension: 'png' }),
        content: {
          kind: 'image',
          dataUri: 'data:image/png;base64,AA==',
          zoom: 1,
          fitToContainer: true,
        },
      }),
    );
    const img = root.querySelector<HTMLImageElement>('.fm-file-viewer-body-image img');
    expect(img?.className).toContain('fm-file-viewer-image-fit');
    expect(root.querySelector('.fm-file-viewer-zoom-level')?.textContent).toBe('Fit');
  });

  it('shows the zoom percentage once zoomed and forwards zoom callbacks', () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onResetZoom = vi.fn();
    mount(
      baseAttrs(
        {
          status: 'ready',
          entry: entry({ name: 'photo.png', extension: 'png' }),
          content: {
            kind: 'image',
            dataUri: 'data:image/png;base64,AA==',
            zoom: 1.25,
            fitToContainer: false,
          },
        },
        { onZoomIn, onZoomOut, onResetZoom },
      ),
    );
    expect(root.querySelector('.fm-file-viewer-zoom-level')?.textContent).toBe('125%');
    root.querySelector<HTMLButtonElement>('button[title="Zoom in"]')?.click();
    root.querySelector<HTMLButtonElement>('button[title="Zoom out"]')?.click();
    root.querySelector<HTMLButtonElement>('button[title="Fit to window"]')?.click();
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onResetZoom).toHaveBeenCalledTimes(1);
  });

  it('calls onLoadMore when the text body is scrolled near the bottom', () => {
    const onLoadMore = vi.fn();
    mount(
      baseAttrs(
        {
          status: 'ready',
          entry: entry(),
          content: {
            kind: 'text',
            windowOffset: 0,
            windowEnd: 5,
            text: 'hello',
            atStart: true,
            atEnd: false,
            loadingMore: false,
          },
        },
        { onLoadMore },
      ),
    );
    const body = root.querySelector<HTMLElement>('.fm-file-viewer-body-text');
    if (body === null) throw new Error('viewer body missing');
    Object.defineProperty(body, 'scrollTop', { value: 1000, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(body, 'scrollHeight', { value: 1050, configurable: true });
    body.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('forwards search input, option toggles, and match navigation', () => {
    const onSearchQueryChange = vi.fn();
    const onSearchOptionChange = vi.fn();
    const onRunSearch = vi.fn();
    const onNextMatch = vi.fn();
    const onPreviousMatch = vi.fn();
    mount(
      baseAttrs(
        {
          status: 'ready',
          entry: entry(),
          content: {
            kind: 'text',
            windowOffset: 0,
            windowEnd: 5,
            text: 'hello',
            atStart: true,
            atEnd: true,
            loadingMore: false,
          },
          search: {
            query: '',
            regex: false,
            caseSensitive: false,
            wholeWord: false,
            matches: [{ offset: 0, length: 1, lineNumber: 1 }],
            truncated: false,
            currentMatchIndex: 0,
            searching: false,
            error: undefined,
          },
        },
        { onSearchQueryChange, onSearchOptionChange, onRunSearch, onNextMatch, onPreviousMatch },
      ),
    );

    const input = root.querySelector<HTMLInputElement>('.fm-file-viewer-search-input');
    if (input === null) throw new Error('search input missing');
    input.value = 'cat';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSearchQueryChange).toHaveBeenCalledWith('cat');
    expect(onRunSearch).toHaveBeenCalledTimes(1);

    root.querySelector<HTMLButtonElement>('button[title="Match case"]')?.click();
    expect(onSearchOptionChange).toHaveBeenCalledWith({ caseSensitive: true });

    root.querySelector<HTMLButtonElement>('button[title="Next match"]')?.click();
    root.querySelector<HTMLButtonElement>('button[title="Previous match"]')?.click();
    expect(onNextMatch).toHaveBeenCalledTimes(1);
    expect(onPreviousMatch).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    mount(baseAttrs({ status: 'unsupported', entry: entry() }, { onClose }));
    root.querySelector<HTMLButtonElement>('.fm-file-viewer-close')?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('scrolling the active match into view', () => {
    function stubRects(containerRect: Partial<DOMRect>, highlightRect: Partial<DOMRect>): void {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: Element,
      ) {
        const rect = this.classList.contains('fm-file-viewer-body-text')
          ? containerRect
          : this.classList.contains('fm-file-viewer-highlight')
            ? highlightRect
            : {};
        return {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
          ...rect,
        } as DOMRect;
      });
    }

    function readyTextState(overrides: Partial<FileViewerState> = {}): FileViewerState {
      return {
        status: 'ready',
        entry: entry(),
        content: {
          kind: 'text',
          windowOffset: 0,
          windowEnd: 11,
          text: 'hello world',
          atStart: true,
          atEnd: true,
          loadingMore: false,
          highlightOffset: 6,
          highlightLength: 5,
        },
        search: {
          query: 'world',
          regex: false,
          caseSensitive: false,
          wholeWord: false,
          matches: [{ offset: 6, length: 5, lineNumber: 1 }],
          truncated: false,
          currentMatchIndex: 0,
          searching: false,
          error: undefined,
        },
        ...overrides,
      } as FileViewerState;
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('scrolls a newly highlighted match into view when it is not already visible', () => {
      stubRects({ top: 0, bottom: 100 }, { top: 200, bottom: 220 });
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      mount(baseAttrs(readyTextState()));

      expect(root.querySelector('.cm-editor')).not.toBeNull();
    });

    it('does not scroll when the highlighted match is already visible', () => {
      stubRects({ top: 0, bottom: 100 }, { top: 40, bottom: 60 });
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      mount(baseAttrs(readyTextState()));

      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('does not scroll again on a later re-render of the same match', () => {
      stubRects({ top: 0, bottom: 100 }, { top: 200, bottom: 220 });
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      let currentAttrs = baseAttrs(readyTextState());
      m.mount(root, { view: () => m(FileViewer, currentAttrs) });
      expect(scrollIntoView).not.toHaveBeenCalled();

      // Re-render with the same match highlighted (e.g. the user typed further in the search
      // box without navigating) - the view shouldn't be yanked back into place again.
      currentAttrs = baseAttrs(readyTextState());
      m.redraw.sync();

      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('scrolls again once a different match becomes highlighted', () => {
      stubRects({ top: 0, bottom: 100 }, { top: 200, bottom: 220 });
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      let currentAttrs = baseAttrs(readyTextState());
      m.mount(root, { view: () => m(FileViewer, currentAttrs) });
      expect(scrollIntoView).not.toHaveBeenCalled();

      currentAttrs = baseAttrs(
        readyTextState({
          content: {
            kind: 'text',
            windowOffset: 0,
            windowEnd: 11,
            text: 'hello world',
            atStart: true,
            atEnd: true,
            loadingMore: false,
            highlightOffset: 0,
            highlightLength: 5,
          },
        }),
      );
      m.redraw.sync();

      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });
});
