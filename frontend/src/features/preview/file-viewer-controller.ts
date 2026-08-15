import type { FileManagerClient } from '../../api/client/file-manager-client';
import type { EntrySummary, Location, SearchInFileMatch } from '../../models';
import { IMAGE_EXTENSIONS } from '../directory-table/entry-icons';
import { editableLanguageForExtension } from '../editor/editor-language';
import { archiveEntryLocation, archiveRootForEntry } from '../navigation/archive-location';
import { copyImageDataUri, copyText } from './clipboard';
import {
  bytesToDataUri,
  imageMimeTypeFor,
  readEntireFileBytes,
  readFullAudioDataUri,
  readFullImageDataUri,
  resolvePreviewKind,
} from './content-preview';
import { parseEpubContainer, parseEpubPackage, sanitizeEpubChapterHtml } from './epub-preview';
import {
  type FileViewerMetadata,
  readImageDimensions,
  readImageExif,
  textMetadataFor,
} from './file-metadata';
import { loadPdfDocument, type PDFDocumentProxy } from './pdf-preview';

/** Client surface required to drive a Lister-style large-file viewer. `listDirectory` is only
 * used for comic (.cbz/.cbr) page listing. */
export type FileViewerClient = Pick<
  FileManagerClient,
  'readFileRange' | 'searchInFile' | 'listDirectory'
>;

/** Bytes fetched per text window load (initial load and each "load more" append). */
export const TEXT_WINDOW_BYTES = 64 * 1024;

/** Bytes of context fetched before a search match when jumping to it. */
const JUMP_CONTEXT_BEFORE_BYTES = TEXT_WINDOW_BYTES / 2;

const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;

/** Delay before an edit to the search query/options triggers a search, so rapid typing doesn't
 * fire one request per keystroke. */
const SEARCH_DEBOUNCE_MS = 200;

/** The currently loaded text window, and whether more can be loaded in either direction. */
export interface FileViewerTextContent {
  readonly kind: 'text';
  readonly windowOffset: number;
  readonly windowEnd: number;
  readonly text: string;
  readonly atStart: boolean;
  readonly atEnd: boolean;
  readonly loadingMore: boolean;
  /**
   * Character offset/length of the active search match within `text`, for scroll/highlight.
   *
   * The backend reports match positions as UTF-8 BYTE offsets (`SearchInFileMatch.offset`), which
   * do not equal JS string (UTF-16 code unit) offsets once any multi-byte character precedes the
   * match - using the raw byte offset directly made the highlight drift later and later into the
   * file, worsening with every prior non-ASCII character. These fields are already converted to
   * `text`-relative character positions (see `jumpToMatch`), so no further conversion is needed.
   */
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

/** The currently loaded (full) audio file, played back via the native `<audio>` element - which
 * reports its own duration/position, so no metadata needs fetching separately. */
export interface FileViewerAudioContent {
  readonly kind: 'audio';
  readonly dataUri: string;
}

/** A loaded PDF document, rendered page-by-page onto a canvas by `PdfPageCanvas` (`file-viewer.ts`)
 * - the document proxy itself lives here so the view can call `document.getPage()` without the
 * controller owning canvas/DOM concerns. */
export interface FileViewerPdfContent {
  readonly kind: 'pdf';
  readonly document: PDFDocumentProxy;
  readonly pageCount: number;
  readonly currentPage: number;
}

/** A comic archive (.cbz/.cbr), paginated as its image entries in name order. Only the current
 * page's bytes are fetched (matching Total Commander's Lister, which never extracts a whole
 * archive just to view it) - `currentPageDataUri` is `undefined` while `loadingPage` is true. */
export interface FileViewerComicContent {
  readonly kind: 'comic';
  readonly pageCount: number;
  readonly currentPage: number;
  readonly currentPageDataUri: string | undefined;
  readonly loadingPage: boolean;
}

/** An EPUB, paginated as its spine's XHTML chapters in reading order. Only the current chapter's
 * sanitized HTML is kept (matching the comic/PDF "one page's worth of content at a time"
 * approach) - `currentChapterHtml` is `undefined` while `loadingChapter` is true. Relative
 * image/CSS references inside a chapter are left unresolved (a "quick view" reader limitation,
 * not a full EPUB renderer - see `epub-preview.ts`). */
export interface FileViewerEpubContent {
  readonly kind: 'epub';
  readonly title: string | undefined;
  readonly chapterCount: number;
  readonly currentChapter: number;
  readonly currentChapterHtml: string | undefined;
  readonly loadingChapter: boolean;
}

/** Simple "does any page contain this text" PDF search (`page.getTextContent()`, no per-match
 * highlight - matching the pages a query appears on is the whole feature). */
export interface FileViewerPdfSearchState {
  readonly query: string;
  /** 1-based page numbers containing `query`, in ascending order. */
  readonly matches: readonly number[];
  readonly currentMatchIndex: number | undefined;
  readonly searching: boolean;
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
      readonly content:
        | FileViewerTextContent
        | FileViewerImageContent
        | FileViewerAudioContent
        | FileViewerPdfContent
        | FileViewerComicContent
        | FileViewerEpubContent;
      readonly search?: FileViewerSearchState;
      /** Simple PDF text search state (`pdf` content only). */
      readonly pdfSearch?: FileViewerPdfSearchState;
      /** Alt+Space info sub-panel (image/text technical metadata - task 0071). Absent/`false`
       * means closed - optional so callers/tests that never touch the panel don't need to set it. */
      readonly metadataPanelOpen?: boolean;
      /** `'loading'` while EXIF/dimensions are being parsed for an image; absent for content kinds
       * with no metadata view (audio) until/unless one is added. */
      readonly metadata?: FileViewerMetadata | 'loading';
    };

export interface FileViewerControllerOptions {
  readonly client: FileViewerClient;
  readonly entry: EntrySummary;
  /** Needed only to list a comic archive's pages via `listDirectory` - a comic opened without this
   * shows a friendly error rather than crashing. Deliberately NOT threaded through as the caller's
   * real, active `paneId`: the backend's `list()` keys live per-pane navigation/watch state by
   * `paneId` and tears down the previous request's file-watch subscription on a mismatch, so
   * reusing the real pane here would silently corrupt that pane's own directory listing. The
   * controller mints its own throwaway pane id for this one-off request instead (see `loadComic`). */
  readonly workspaceId?: string;
  readonly update: (state: FileViewerState) => void;
  /** Pre-populated search query to run as soon as text content is ready (task 0089). */
  readonly initialSearch?: {
    readonly query: string;
    readonly regex: boolean;
    readonly caseSensitive: boolean;
    readonly wholeWord: boolean;
  };
  /** Opens the Alt+Space metadata/info panel immediately once content loads, so Alt+Space works
   * even when no viewer was already open (it opens one, with the panel visible). */
  readonly initialMetadataPanelOpen?: boolean;
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
  /** Copies the currently loaded text window or image to the system clipboard. No-op for audio
   * (played back, not copyable) or non-`ready` states. */
  copyContent(): Promise<void>;
  /** Opens/closes the Alt+Space metadata/info sub-panel, computing its content on first open. */
  toggleMetadataPanel(): void;
  /** Advances to the next PDF/comic page. No-op for other content kinds or at the last page. */
  nextPage(): void;
  /** Returns to the previous PDF/comic page. No-op for other content kinds or at the first page. */
  previousPage(): void;
  /** Sets the PDF search query, debounced (`pdf` content only). */
  setPdfSearchQuery(query: string): void;
  goToNextPdfMatch(): void;
  goToPreviousPdfMatch(): void;
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
  // If an initial search query was provided, pre-populate the search state so it
  // runs as soon as text content is ready.
  if (options.initialSearch) {
    search = {
      ...DEFAULT_SEARCH_STATE,
      ...options.initialSearch,
    };
  }
  let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  const initialMetadataOpen = options.initialMetadataPanelOpen === true;
  /** The comic's page locations in order, populated once by `loadComic`. Kept out of published
   * state since `Location[]` is controller-internal - the view only ever sees the current page's
   * already-decoded `dataUri`. */
  let comicPageLocations: readonly Location[] = [];
  /** The EPUB's chapter locations in reading order, populated once by `loadEpub`. */
  let epubChapterLocations: readonly Location[] = [];
  /** Per-page extracted text, cached lazily by `runPdfSearch` (1-based page number -> lowercased
   * text) so repeated searches on the same document don't re-extract every page each time. */
  const pdfPageTextCache = new Map<number, string>();
  let pdfSearchDebounceTimer: ReturnType<typeof setTimeout> | undefined;

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
      metadataPanelOpen: initialMetadataOpen,
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
      metadataPanelOpen: initialMetadataOpen,
    });
  }

  async function loadAudio(controller: AbortController): Promise<void> {
    const dataUri = await readFullAudioDataUri(client, entry, controller.signal);
    if (!isCurrent(controller)) return;
    publish({
      status: 'ready',
      entry,
      metadataPanelOpen: initialMetadataOpen,
      content: { kind: 'audio', dataUri },
    });
  }

  async function loadPdf(controller: AbortController): Promise<void> {
    const bytes = await readEntireFileBytes(client, entry, controller.signal);
    if (!isCurrent(controller)) return;
    const document = await loadPdfDocument(bytes);
    if (!isCurrent(controller)) return;
    publish({
      status: 'ready',
      entry,
      metadataPanelOpen: initialMetadataOpen,
      content: { kind: 'pdf', document, pageCount: document.numPages, currentPage: 1 },
    });
  }

  /** Fetches and decodes one comic page's image bytes, publishing it as the current page. */
  async function loadComicPage(controller: AbortController, pageIndex: number): Promise<void> {
    const location = comicPageLocations[pageIndex];
    if (location === undefined) return;
    const bytes = await readEntireFileBytes(client, { ...entry, location }, controller.signal);
    if (!isCurrent(controller)) return;
    const extension = location.uri.split('.').pop()?.toLowerCase();
    const mimeType = imageMimeTypeFor({
      ...entry,
      ...(extension === undefined ? {} : { extension }),
    });
    const dataUri = bytesToDataUri(bytes, mimeType);
    if (current.status !== 'ready' || current.content.kind !== 'comic') return;
    publish({
      ...current,
      content: {
        ...current.content,
        currentPage: pageIndex,
        currentPageDataUri: dataUri,
        loadingPage: false,
      },
    });
  }

  /** Lists one archive folder and recursively descends into any subfolders, collecting every
   * image entry - some CBR/CBZ archives (notably ones exported as "one folder per volume" scans)
   * wrap their pages in a single top-level directory instead of placing them at the archive root,
   * so listing only the root would find zero pages and wrongly report the comic as unsupported.
   * Depth is capped defensively; archive trees are shallow in practice (0-2 levels). */
  async function collectComicPages(
    controller: AbortController,
    location: Location,
    depth: number,
  ): Promise<EntrySummary[]> {
    if (options.workspaceId === undefined) return [];
    const snapshot = await client.listDirectory(
      {
        workspaceId: options.workspaceId,
        // A fresh, throwaway pane id - see `FileViewerControllerOptions.workspaceId`'s doc
        // comment for why this must never be the viewer's real active pane id.
        paneId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        location,
      },
      controller.signal,
    );
    if (!isCurrent(controller)) return [];
    const images = snapshot.entries.filter((candidate) => {
      const extension = candidate.extension?.toLowerCase();
      return (
        candidate.kind === 'file' && extension !== undefined && IMAGE_EXTENSIONS.includes(extension)
      );
    });
    if (images.length > 0 || depth >= 4) return images;
    const subdirectories = snapshot.entries.filter((candidate) => candidate.kind === 'directory');
    const nested: EntrySummary[] = [];
    for (const subdirectory of subdirectories) {
      nested.push(...(await collectComicPages(controller, subdirectory.location, depth + 1)));
      if (!isCurrent(controller)) return [];
    }
    return nested;
  }

  async function loadComic(controller: AbortController): Promise<void> {
    const archiveRoot = archiveRootForEntry(entry);
    if (archiveRoot === undefined || options.workspaceId === undefined) {
      publish({ status: 'error', entry, message: 'Comic preview is unavailable for this entry.' });
      return;
    }
    const pageEntries = (await collectComicPages(controller, archiveRoot, 0)).sort((a, b) =>
      a.location.uri.localeCompare(b.location.uri, undefined, { numeric: true }),
    );
    if (!isCurrent(controller)) return;
    if (pageEntries.length === 0) {
      publish({ status: 'unsupported', entry });
      return;
    }
    comicPageLocations = pageEntries.map((pageEntry) => pageEntry.location);
    publish({
      status: 'ready',
      entry,
      metadataPanelOpen: initialMetadataOpen,
      content: {
        kind: 'comic',
        pageCount: comicPageLocations.length,
        currentPage: 0,
        currentPageDataUri: undefined,
        loadingPage: true,
      },
    });
    await loadComicPage(controller, 0);
  }

  /** Fetches and sanitizes one EPUB chapter's XHTML, publishing it as the current chapter. */
  async function loadEpubChapter(controller: AbortController, chapterIndex: number): Promise<void> {
    const location = epubChapterLocations[chapterIndex];
    if (location === undefined) return;
    const bytes = await readEntireFileBytes(client, { ...entry, location }, controller.signal);
    if (!isCurrent(controller)) return;
    const html = sanitizeEpubChapterHtml(new TextDecoder().decode(bytes));
    if (current.status !== 'ready' || current.content.kind !== 'epub') return;
    publish({
      ...current,
      content: {
        ...current.content,
        currentChapter: chapterIndex,
        currentChapterHtml: html,
        loadingChapter: false,
      },
    });
  }

  async function loadEpub(controller: AbortController): Promise<void> {
    const archiveRoot = archiveRootForEntry(entry);
    if (archiveRoot === undefined) {
      publish({ status: 'error', entry, message: 'EPUB preview is unavailable for this entry.' });
      return;
    }
    const containerBytes = await readEntireFileBytes(
      client,
      { ...entry, location: archiveEntryLocation(archiveRoot, 'META-INF/container.xml') },
      controller.signal,
    );
    if (!isCurrent(controller)) return;
    const opfPath = parseEpubContainer(new TextDecoder().decode(containerBytes));
    if (opfPath === undefined) {
      publish({ status: 'error', entry, message: "Couldn't find this EPUB's package document." });
      return;
    }
    const opfBytes = await readEntireFileBytes(
      client,
      { ...entry, location: archiveEntryLocation(archiveRoot, opfPath) },
      controller.signal,
    );
    if (!isCurrent(controller)) return;
    const book = parseEpubPackage(new TextDecoder().decode(opfBytes), opfPath);
    if (book.chapterPaths.length === 0) {
      publish({ status: 'unsupported', entry });
      return;
    }
    epubChapterLocations = book.chapterPaths.map((path) => archiveEntryLocation(archiveRoot, path));
    publish({
      status: 'ready',
      entry,
      metadataPanelOpen: initialMetadataOpen,
      content: {
        kind: 'epub',
        title: book.title,
        chapterCount: epubChapterLocations.length,
        currentChapter: 0,
        currentChapterHtml: undefined,
        loadingChapter: true,
      },
    });
    await loadEpubChapter(controller, 0);
  }

  async function load(): Promise<void> {
    const controller = beginRequest();
    publish({ status: 'loading', entry });
    try {
      const kind = resolvePreviewKind(entry);
      if (kind === 'image') {
        await loadImage(controller);
      } else if (kind === 'audio') {
        await loadAudio(controller);
      } else if (kind === 'pdf') {
        await loadPdf(controller);
      } else if (kind === 'comic') {
        await loadComic(controller);
      } else if (kind === 'epub') {
        await loadEpub(controller);
      } else if (kind === 'text') {
        await loadInitialText(controller);
        // Run initial search if pre-populated from content search results.
        if (search?.query.trim()) {
          await runSearch();
        }
      } else {
        publish({ status: 'unsupported', entry });
      }
      if (initialMetadataOpen && current.status === 'ready') void computeMetadata();
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
    if (searchDebounceTimer !== undefined) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = undefined;
    }
    if (search.query.trim() === '') {
      // Nothing to search - clear stale results and highlight immediately rather than waiting on the debounce.
      search = {
        ...search,
        matches: [],
        truncated: false,
        currentMatchIndex: undefined,
        searching: false,
        error: undefined,
      };
      if (current.status === 'ready') {
        const readyState = current as Extract<FileViewerState, { status: 'ready' }>;
        // Also clear any stale highlight from the content state.
        if (
          readyState.content.kind === 'text' &&
          (readyState.content.highlightOffset !== undefined ||
            readyState.content.highlightLength !== undefined)
        ) {
          const { highlightOffset, highlightLength, ...contentRest } = readyState.content;
          publish({
            ...readyState,
            content: contentRest,
            search,
          });
        } else {
          publish({ ...current, search });
        }
      }
      return;
    }
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = undefined;
      void runSearch();
    }, SEARCH_DEBOUNCE_MS);
  }

  async function jumpToMatch(index: number): Promise<void> {
    const match = search?.matches[index];
    if (match === undefined) return;
    const windowOffset = Math.max(0, match.offset - JUMP_CONTEXT_BEFORE_BYTES);
    const length = Math.max(TEXT_WINDOW_BYTES, match.offset + match.length - windowOffset);
    search = { ...(search ?? DEFAULT_SEARCH_STATE), currentMatchIndex: index };
    // Stay in the 'ready' status while fetching (rather than bouncing through 'loading') so the
    // search bar/input never unmounts - that would drop keyboard focus and flicker the viewer.
    if (current.status === 'ready') publish({ ...current, search });
    const controller = beginRequest();
    try {
      const chunk = await client.readFileRange(
        { location: entry.location, offset: windowOffset, length },
        controller.signal,
      );
      if (!isCurrent(controller)) return;
      const bytes = new Uint8Array(chunk.data);
      // Convert the match's byte offset/length (relative to this window) into character offsets by
      // decoding only the bytes before/within the match - see `FileViewerTextContent`'s doc comment.
      const matchStartInChunk = match.offset - windowOffset;
      const highlightOffset = new TextDecoder().decode(bytes.subarray(0, matchStartInChunk)).length;
      const highlightLength = new TextDecoder().decode(
        bytes.subarray(matchStartInChunk, matchStartInChunk + match.length),
      ).length;
      publish({
        status: 'ready',
        entry,
        content: {
          kind: 'text',
          windowOffset,
          windowEnd: windowOffset + chunk.length,
          text: new TextDecoder().decode(bytes),
          atStart: windowOffset === 0,
          atEnd: chunk.eof,
          loadingMore: false,
          highlightOffset,
          highlightLength,
        },
        metadataPanelOpen: current.status === 'ready' && (current.metadataPanelOpen ?? false),
        ...(search === undefined ? {} : { search }),
      });
      if (current.status === 'ready' && current.metadataPanelOpen === true) void computeMetadata();
    } catch (error: unknown) {
      if (isCurrent(controller)) {
        publish({ status: 'error', entry, message: errorMessage(error) });
      }
    }
  }

  async function runSearch(): Promise<void> {
    if (searchDebounceTimer !== undefined) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = undefined;
    }
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
      } else {
        // No matches - clear stale highlight from the content state.
        const content = textContent();
        if (
          content !== undefined &&
          (content.highlightOffset !== undefined || content.highlightLength !== undefined)
        ) {
          const { highlightOffset, highlightLength, ...contentRest } = content;
          publish({
            ...(current as Extract<FileViewerState, { status: 'ready' }>),
            content: contentRest,
          });
        }
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

  async function copyContent(): Promise<void> {
    if (current.status !== 'ready') return;
    if (current.content.kind === 'text') {
      await copyText(current.content.text);
    } else if (current.content.kind === 'image') {
      await copyImageDataUri(current.content.dataUri);
    }
  }

  /** Computes (or recomputes) the info panel's metadata for the currently loaded content. Marks
   * the state `metadata: 'loading'` immediately for image content (EXIF parsing is async);
   * text metadata is derived synchronously from the already-loaded window. */
  async function computeMetadata(): Promise<void> {
    if (current.status !== 'ready') return;
    const ready = current as Extract<FileViewerState, { status: 'ready' }>;
    if (ready.content.kind === 'text') {
      publish({
        ...ready,
        metadata: textMetadataFor(
          entry,
          ready.content.text,
          !ready.content.atStart || !ready.content.atEnd,
          editableLanguageForExtension(entry.extension, entry.name),
        ),
      });
      return;
    }
    if (ready.content.kind !== 'image') return;
    const dataUri = ready.content.dataUri;
    publish({ ...ready, metadata: 'loading' });
    const [dimensions, exif] = await Promise.all([
      readImageDimensions(dataUri),
      readImageExif(dataUri),
    ]);
    if (current.status !== 'ready' || current.content.kind !== 'image') return;
    publish({
      ...(current as Extract<FileViewerState, { status: 'ready' }>),
      metadata: {
        kind: 'image',
        width: dimensions?.width,
        height: dimensions?.height,
        sizeBytes: entry.size,
        mimeType: imageMimeTypeFor(entry),
        ...exif,
      },
    });
  }

  function toggleMetadataPanel(): void {
    if (current.status !== 'ready') return;
    const ready = current as Extract<FileViewerState, { status: 'ready' }>;
    const open = !(ready.metadataPanelOpen ?? false);
    publish({ ...ready, metadataPanelOpen: open });
    if (open && ready.metadata === undefined) void computeMetadata();
  }

  function nextPage(): void {
    if (current.status !== 'ready') return;
    if (current.content.kind === 'pdf') {
      if (current.content.currentPage >= current.content.pageCount) return;
      publish({
        ...current,
        content: { ...current.content, currentPage: current.content.currentPage + 1 },
      });
    } else if (current.content.kind === 'comic') {
      const nextIndex = current.content.currentPage + 1;
      if (nextIndex >= current.content.pageCount) return;
      publish({
        ...current,
        content: {
          ...current.content,
          currentPage: nextIndex,
          currentPageDataUri: undefined,
          loadingPage: true,
        },
      });
      void loadComicPage(beginRequest(), nextIndex);
    } else if (current.content.kind === 'epub') {
      const nextIndex = current.content.currentChapter + 1;
      if (nextIndex >= current.content.chapterCount) return;
      publish({
        ...current,
        content: {
          ...current.content,
          currentChapter: nextIndex,
          currentChapterHtml: undefined,
          loadingChapter: true,
        },
      });
      void loadEpubChapter(beginRequest(), nextIndex);
    }
  }

  function previousPage(): void {
    if (current.status !== 'ready') return;
    if (current.content.kind === 'pdf') {
      if (current.content.currentPage <= 1) return;
      publish({
        ...current,
        content: { ...current.content, currentPage: current.content.currentPage - 1 },
      });
    } else if (current.content.kind === 'comic') {
      const previousIndex = current.content.currentPage - 1;
      if (previousIndex < 0) return;
      publish({
        ...current,
        content: {
          ...current.content,
          currentPage: previousIndex,
          currentPageDataUri: undefined,
          loadingPage: true,
        },
      });
      void loadComicPage(beginRequest(), previousIndex);
    } else if (current.content.kind === 'epub') {
      const previousIndex = current.content.currentChapter - 1;
      if (previousIndex < 0) return;
      publish({
        ...current,
        content: {
          ...current.content,
          currentChapter: previousIndex,
          currentChapterHtml: undefined,
          loadingChapter: true,
        },
      });
      void loadEpubChapter(beginRequest(), previousIndex);
    }
  }

  async function pdfPageText(document: PDFDocumentProxy, pageNumber: number): Promise<string> {
    const cached = pdfPageTextCache.get(pageNumber);
    if (cached !== undefined) return cached;
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .toLowerCase();
    pdfPageTextCache.set(pageNumber, text);
    return text;
  }

  async function runPdfSearch(): Promise<void> {
    if (current.status !== 'ready' || current.content.kind !== 'pdf') return;
    const document = current.content.document;
    const query = current.pdfSearch?.query.trim().toLowerCase() ?? '';
    if (query === '') return;
    publish({
      ...current,
      pdfSearch: { ...current.pdfSearch, query, searching: true } as FileViewerPdfSearchState,
    });
    const matches: number[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (current.status !== 'ready' || current.content.kind !== 'pdf') return;
      const text = await pdfPageText(document, pageNumber);
      if (text.includes(query)) matches.push(pageNumber);
    }
    if (current.status !== 'ready' || current.content.kind !== 'pdf') return;
    publish({
      ...current,
      pdfSearch: {
        query,
        matches,
        currentMatchIndex: matches.length > 0 ? 0 : undefined,
        searching: false,
      },
    });
    if (matches.length > 0) {
      publish({
        ...(current as Extract<FileViewerState, { status: 'ready' }>),
        content: { ...current.content, currentPage: matches[0] as number },
      });
    }
  }

  function setPdfSearchQuery(query: string): void {
    if (current.status !== 'ready' || current.content.kind !== 'pdf') return;
    publish({
      ...current,
      pdfSearch: {
        query,
        matches: current.pdfSearch?.matches ?? [],
        currentMatchIndex: current.pdfSearch?.currentMatchIndex,
        searching: false,
      },
    });
    if (pdfSearchDebounceTimer !== undefined) clearTimeout(pdfSearchDebounceTimer);
    if (query.trim() === '') {
      publish({
        ...(current as Extract<FileViewerState, { status: 'ready' }>),
        pdfSearch: { query: '', matches: [], currentMatchIndex: undefined, searching: false },
      });
      return;
    }
    pdfSearchDebounceTimer = setTimeout(() => {
      pdfSearchDebounceTimer = undefined;
      void runPdfSearch();
    }, SEARCH_DEBOUNCE_MS);
  }

  function goToPdfMatch(index: number): void {
    if (
      current.status !== 'ready' ||
      current.content.kind !== 'pdf' ||
      current.pdfSearch === undefined
    )
      return;
    const page = current.pdfSearch.matches[index];
    if (page === undefined) return;
    publish({
      ...current,
      content: { ...current.content, currentPage: page },
      pdfSearch: { ...current.pdfSearch, currentMatchIndex: index },
    });
  }

  function goToNextPdfMatch(): void {
    if (
      current.status !== 'ready' ||
      current.pdfSearch === undefined ||
      current.pdfSearch.matches.length === 0
    )
      return;
    goToPdfMatch(
      ((current.pdfSearch.currentMatchIndex ?? -1) + 1) % current.pdfSearch.matches.length,
    );
  }

  function goToPreviousPdfMatch(): void {
    if (
      current.status !== 'ready' ||
      current.pdfSearch === undefined ||
      current.pdfSearch.matches.length === 0
    )
      return;
    const count = current.pdfSearch.matches.length;
    goToPdfMatch(((current.pdfSearch.currentMatchIndex ?? 0) - 1 + count) % count);
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
    copyContent,
    toggleMetadataPanel,
    nextPage,
    previousPage,
    setPdfSearchQuery,
    goToNextPdfMatch,
    goToPreviousPdfMatch,
    dispose: () => {
      disposed = true;
      activeController?.abort();
      if (searchDebounceTimer !== undefined) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = undefined;
      }
      if (pdfSearchDebounceTimer !== undefined) {
        clearTimeout(pdfSearchDebounceTimer);
        pdfSearchDebounceTimer = undefined;
      }
    },
  };
}
