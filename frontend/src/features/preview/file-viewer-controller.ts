import type { FileManagerClient } from '../../api/client/file-manager-client';
import type { EntrySummary, SearchInFileMatch } from '../../models';
import { readFullImageDataUri, resolvePreviewKind } from './content-preview';

/** Client surface required to drive a Lister-style large-file viewer. */
export type FileViewerClient = Pick<FileManagerClient, 'readFileRange' | 'searchInFile'>;

/** Bytes fetched per text window load (initial load and each "load more" append). */
export const TEXT_WINDOW_BYTES = 64 * 1024;

/** Bytes of context fetched before a search match when jumping to it. */
const JUMP_CONTEXT_BEFORE_BYTES = TEXT_WINDOW_BYTES / 2;

const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;

/** The currently loaded text window, and whether more can be loaded in either direction. */
export interface FileViewerTextContent {
  readonly kind: 'text';
  readonly windowOffset: number;
  readonly windowEnd: number;
  readonly text: string;
  readonly atStart: boolean;
  readonly atEnd: boolean;
  readonly loadingMore: boolean;
  /** Byte offset/length of the active search match within the file, for scroll/highlight. */
  readonly highlightOffset?: number;
  readonly highlightLength?: number;
}

/** The currently loaded (full) image and its zoom state. */
export interface FileViewerImageContent {
  readonly kind: 'image';
  readonly dataUri: string;
  readonly zoom: number;
  readonly fitToContainer: boolean;
}

/** Search bar state for text-mode viewing (task 0088's VS-Code-like content search). */
export interface FileViewerSearchState {
  readonly query: string;
  readonly regex: boolean;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly matches: readonly SearchInFileMatch[];
  readonly truncated: boolean;
  readonly currentMatchIndex: number | undefined;
  readonly searching: boolean;
  readonly error: string | undefined;
}

export type FileViewerState =
  | { readonly status: 'loading'; readonly entry: EntrySummary }
  | { readonly status: 'unsupported'; readonly entry: EntrySummary }
  | { readonly status: 'error'; readonly entry: EntrySummary; readonly message: string }
  | {
      readonly status: 'ready';
      readonly entry: EntrySummary;
      readonly content: FileViewerTextContent | FileViewerImageContent;
      readonly search?: FileViewerSearchState;
    };

export interface FileViewerControllerOptions {
  readonly client: FileViewerClient;
  readonly entry: EntrySummary;
  readonly update: (state: FileViewerState) => void;
}

/** Cancellable operations exposed to the presentational `FileViewer` component. */
export interface FileViewerController {
  loadMore(): Promise<void>;
  setSearchOptions(
    patch: Partial<Pick<FileViewerSearchState, 'query' | 'regex' | 'caseSensitive' | 'wholeWord'>>,
  ): void;
  runSearch(): Promise<void>;
  goToNextMatch(): Promise<void>;
  goToPreviousMatch(): Promise<void>;
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  dispose(): void;
}

const DEFAULT_SEARCH_STATE: FileViewerSearchState = {
  query: '',
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  matches: [],
  truncated: false,
  currentMatchIndex: undefined,
  searching: false,
  error: undefined,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load file';
}

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** Drives a Lister-style viewer session for exactly one entry (task 0088). */
export function createFileViewerController(
  options: FileViewerControllerOptions,
): FileViewerController {
  const { client, entry } = options;
  let disposed = false;
  let activeController: AbortController | undefined;
  let current: FileViewerState = { status: 'loading', entry };
  let search: FileViewerSearchState | undefined;

  function publish(next: FileViewerState): void {
    current = next;
    options.update(current);
  }

  function beginRequest(): AbortController {
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    return controller;
  }

  function isCurrent(controller: AbortController): boolean {
    return activeController === controller && !controller.signal.aborted && !disposed;
  }

  async function loadInitialText(controller: AbortController): Promise<void> {
    const chunk = await client.readFileRange(
      { location: entry.location, offset: 0, length: TEXT_WINDOW_BYTES },
      controller.signal,
    );
    if (!isCurrent(controller)) return;
    if (chunk.probablyBinary === true) {
      publish({ status: 'unsupported', entry });
      return;
    }
    publish({
      status: 'ready',
      entry,
      content: {
        kind: 'text',
        windowOffset: 0,
        windowEnd: chunk.length,
        text: new TextDecoder().decode(new Uint8Array(chunk.data)),
        atStart: true,
        atEnd: chunk.eof,
        loadingMore: false,
      },
      ...(search === undefined ? {} : { search }),
    });
  }

  async function loadImage(controller: AbortController): Promise<void> {
    const dataUri = await readFullImageDataUri(client, entry, controller.signal);
    if (!isCurrent(controller)) return;
    publish({
      status: 'ready',
      entry,
      content: { kind: 'image', dataUri, zoom: 1, fitToContainer: true },
    });
  }

  async function load(): Promise<void> {
    const controller = beginRequest();
    publish({ status: 'loading', entry });
    try {
      const kind = resolvePreviewKind(entry);
      if (kind === 'image') {
        await loadImage(controller);
      } else if (kind === 'text') {
        await loadInitialText(controller);
      } else {
        publish({ status: 'unsupported', entry });
      }
    } catch (error: unknown) {
      if (isCurrent(controller)) {
        publish({ status: 'error', entry, message: errorMessage(error) });
      }
    }
  }

  function textContent(): FileViewerTextContent | undefined {
    return current.status === 'ready' && current.content.kind === 'text'
      ? current.content
      : undefined;
  }

  function imageContent(): FileViewerImageContent | undefined {
    return current.status === 'ready' && current.content.kind === 'image'
      ? current.content
      : undefined;
  }

  async function loadMore(): Promise<void> {
    const content = textContent();
    if (content === undefined || content.atEnd || content.loadingMore) return;
    const readyState = current as Extract<FileViewerState, { status: 'ready' }>;
    publish({ ...readyState, content: { ...content, loadingMore: true } });
    const controller = beginRequest();
    try {
      const chunk = await client.readFileRange(
        { location: entry.location, offset: content.windowEnd, length: TEXT_WINDOW_BYTES },
        controller.signal,
      );
      if (!isCurrent(controller)) return;
      const latest = textContent();
      if (latest === undefined) return;
      publish({
        ...(current as Extract<FileViewerState, { status: 'ready' }>),
        content: {
          ...latest,
          text: latest.text + new TextDecoder().decode(new Uint8Array(chunk.data)),
          windowEnd: latest.windowEnd + chunk.length,
          atEnd: chunk.eof,
          loadingMore: false,
        },
      });
    } catch (error: unknown) {
      if (isCurrent(controller)) {
        publish({ status: 'error', entry, message: errorMessage(error) });
      }
    }
  }

  function setSearchOptions(
    patch: Partial<Pick<FileViewerSearchState, 'query' | 'regex' | 'caseSensitive' | 'wholeWord'>>,
  ): void {
    search = { ...(search ?? DEFAULT_SEARCH_STATE), ...patch };
    if (current.status === 'ready') {
      publish({ ...current, search });
    }
  }

  async function jumpToMatch(index: number): Promise<void> {
    const match = search?.matches[index];
    if (match === undefined) return;
    const windowOffset = Math.max(0, match.offset - JUMP_CONTEXT_BEFORE_BYTES);
    const length = Math.max(TEXT_WINDOW_BYTES, match.offset + match.length - windowOffset);
    const controller = beginRequest();
    search = { ...(search ?? DEFAULT_SEARCH_STATE), currentMatchIndex: index };
    publish({ status: 'loading', entry });
    try {
      const chunk = await client.readFileRange(
        { location: entry.location, offset: windowOffset, length },
        controller.signal,
      );
      if (!isCurrent(controller)) return;
      publish({
        status: 'ready',
        entry,
        content: {
          kind: 'text',
          windowOffset,
          windowEnd: windowOffset + chunk.length,
          text: new TextDecoder().decode(new Uint8Array(chunk.data)),
          atStart: windowOffset === 0,
          atEnd: chunk.eof,
          loadingMore: false,
          highlightOffset: match.offset,
          highlightLength: match.length,
        },
        ...(search === undefined ? {} : { search }),
      });
    } catch (error: unknown) {
      if (isCurrent(controller)) {
        publish({ status: 'error', entry, message: errorMessage(error) });
      }
    }
  }

  async function runSearch(): Promise<void> {
    const options_ = search ?? DEFAULT_SEARCH_STATE;
    if (options_.query.trim() === '') return;
    search = { ...options_, searching: true, error: undefined };
    if (current.status === 'ready') publish({ ...current, search });
    const controller = beginRequest();
    try {
      const result = await client.searchInFile(
        {
          location: entry.location,
          query: options_.query,
          regex: options_.regex,
          caseSensitive: options_.caseSensitive,
          wholeWord: options_.wholeWord,
        },
        controller.signal,
      );
      if (!isCurrent(controller)) return;
      search = {
        ...options_,
        matches: result.matches,
        truncated: result.truncated,
        currentMatchIndex: undefined,
        searching: false,
      };
      if (current.status === 'ready') publish({ ...current, search });
      if (result.matches.length > 0) {
        await jumpToMatch(0);
      }
    } catch (error: unknown) {
      if (!isCurrent(controller)) return;
      search = { ...options_, searching: false, error: errorMessage(error) };
      if (current.status === 'ready') publish({ ...current, search });
    }
  }

  async function goToNextMatch(): Promise<void> {
    if (search === undefined || search.matches.length === 0) return;
    const next = ((search.currentMatchIndex ?? -1) + 1) % search.matches.length;
    await jumpToMatch(next);
  }

  async function goToPreviousMatch(): Promise<void> {
    if (search === undefined || search.matches.length === 0) return;
    const count = search.matches.length;
    const previous = ((search.currentMatchIndex ?? 0) - 1 + count) % count;
    await jumpToMatch(previous);
  }

  function zoomIn(): void {
    const content = imageContent();
    if (content === undefined) return;
    const base = content.fitToContainer ? 1 : content.zoom;
    publish({
      ...(current as Extract<FileViewerState, { status: 'ready' }>),
      content: { ...content, zoom: clampZoom(base * ZOOM_STEP), fitToContainer: false },
    });
  }

  function zoomOut(): void {
    const content = imageContent();
    if (content === undefined) return;
    const base = content.fitToContainer ? 1 : content.zoom;
    publish({
      ...(current as Extract<FileViewerState, { status: 'ready' }>),
      content: { ...content, zoom: clampZoom(base / ZOOM_STEP), fitToContainer: false },
    });
  }

  function resetZoom(): void {
    const content = imageContent();
    if (content === undefined) return;
    publish({
      ...(current as Extract<FileViewerState, { status: 'ready' }>),
      content: { ...content, zoom: 1, fitToContainer: true },
    });
  }

  void load();

  return {
    loadMore,
    setSearchOptions,
    runSearch,
    goToNextMatch,
    goToPreviousMatch,
    zoomIn,
    zoomOut,
    resetZoom,
    dispose: () => {
      disposed = true;
      activeController?.abort();
    },
  };
}
