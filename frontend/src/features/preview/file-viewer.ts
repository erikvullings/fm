import m, { type FactoryComponent } from 'mithril';
import { toast } from 'mithril-materialized';
import { closeIcon, copyIcon, infoCircleIcon } from '../../components/tabler-icons';
import { tooltip } from '../../components/tooltip';
import { t } from '../../i18n';
import type { GitLogEntry } from '../../models';
import { CodeMirrorEditor } from '../editor/code-mirror-editor';
import { editableLanguageForExtension, languageExtension } from '../editor/editor-language';
import { safeMarkdownHtml } from '../editor/markdown-preview';
import {
  DEFAULT_ENTRY_FORMAT_SETTINGS,
  formatEntryModifiedAt,
  formatEntrySize,
} from '../entry-formatting/entry-formatting';
import { copyText } from './clipboard';
import { type FileViewerMetadata, mapLinkFor } from './file-metadata';
import type {
  FileViewerPdfSearchState,
  FileViewerSearchState,
  FileViewerState,
} from './file-viewer-controller';
import { type PDFDocumentProxy, renderPdfPageToCanvas } from './pdf-preview';
import './file-viewer.css';

/** Copies `value` to the clipboard and reports success/failure via toast - the same feedback
 * mechanism used elsewhere in the app (e.g. diagnostics' "Copy for Bug Report"), so the F3 viewer
 * doesn't invent a second, silent copy affordance. */
async function copyWithToast(action: () => Promise<void>, successMessage: string): Promise<void> {
  try {
    await action();
    toast({ html: successMessage });
  } catch {
    toast({ html: t('viewer', 'copyFailed') });
  }
}

/** Presentational Lister-style large-file viewer (task 0088); all state/async work lives in
 * `createFileViewerController` - this component only renders `attrs.state` and forwards intent
 * via callbacks, per this repo's convention of keeping application logic out of components. */
export interface FileViewerAttrs {
  readonly state: FileViewerState;
  readonly onLoadMore: () => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onSearchOptionChange: (
    patch: Partial<Pick<FileViewerSearchState, 'regex' | 'caseSensitive' | 'wholeWord'>>,
  ) => void;
  readonly onRunSearch: () => void;
  readonly onNextMatch: () => void;
  readonly onPreviousMatch: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onResetZoom: () => void;
  readonly onCopy: () => Promise<void>;
  readonly onToggleMetadata: () => void;
  readonly onNextPage: () => void;
  readonly onPreviousPage: () => void;
  readonly onPdfSearchQueryChange: (query: string) => void;
  readonly onNextPdfMatch: () => void;
  readonly onPreviousPdfMatch: () => void;
  readonly onClose: () => void;
}

const LOAD_MORE_THRESHOLD_PX = 200;

/** Normalizes the paged content kinds' differing field names (PDF's 1-based `currentPage`;
 * comic/EPUB's 0-based `currentPage`/`currentChapter`) into a single 1-based `{current, total}`
 * for the shared page-controls header UI. */
function pagedContentInfo(
  content: Extract<FileViewerState, { status: 'ready' }>['content'],
): { readonly current: number; readonly total: number } | undefined {
  if (content.kind === 'pdf') return { current: content.currentPage, total: content.pageCount };
  if (content.kind === 'comic')
    return { current: content.currentPage + 1, total: content.pageCount };
  if (content.kind === 'epub')
    return { current: content.currentChapter + 1, total: content.chapterCount };
  return undefined;
}

function metadataField(label: string, value: string, href?: string): m.Children {
  return m('.fm-file-viewer-metadata-field', [
    m('dt', label),
    m('dd', [
      href === undefined
        ? m('span', value)
        : m('a', { href, target: '_blank', rel: 'noopener noreferrer' }, value),
      tooltip(
        `Copy ${label}`,
        m(
          'button.fm-file-viewer-metadata-copy',
          {
            type: 'button',
            'aria-label': `Copy ${label}`,
            onclick: () => void copyWithToast(() => copyText(value), `${label} copied.`),
          },
          copyIcon({ size: 12 }),
        ),
      ),
    ]),
  ]);
}

function renderMetadataPanel(metadata: FileViewerMetadata | 'loading' | undefined): m.Children {
  if (metadata === undefined) return undefined;
  if (metadata === 'loading') {
    return m('.fm-file-viewer-metadata', m('span', t('viewer', 'loadingMetadata')));
  }
  const fields: m.Children[] = [];
  if (metadata.kind === 'image') {
    if (metadata.width !== undefined && metadata.height !== undefined) {
      fields.push(metadataField('Dimensions', `${metadata.width} × ${metadata.height}`));
    }
    fields.push(metadataField('Type', metadata.mimeType));
    if (metadata.sizeBytes !== undefined) {
      fields.push(
        metadataField(
          'Size',
          formatEntrySize(
            { kind: 'file', size: metadata.sizeBytes },
            DEFAULT_ENTRY_FORMAT_SETTINGS,
          ),
        ),
      );
    }
    if (metadata.cameraMake !== undefined || metadata.cameraModel !== undefined) {
      fields.push(
        metadataField(
          'Camera',
          [metadata.cameraMake, metadata.cameraModel].filter(Boolean).join(' '),
        ),
      );
    }
    if (metadata.dateTaken !== undefined) {
      fields.push(metadataField('Date taken', metadata.dateTaken));
    }
    if (metadata.gpsLatitude !== undefined && metadata.gpsLongitude !== undefined) {
      fields.push(
        metadataField(
          'Location',
          `${metadata.gpsLatitude.toFixed(6)}, ${metadata.gpsLongitude.toFixed(6)}`,
          mapLinkFor(metadata.gpsLatitude, metadata.gpsLongitude),
        ),
      );
    }
  } else {
    fields.push(
      m('.fm-file-viewer-metadata-row', [
        metadataField(
          'Size',
          metadata.sizeBytes === undefined
            ? '--'
            : formatEntrySize(
                { kind: 'file', size: metadata.sizeBytes },
                DEFAULT_ENTRY_FORMAT_SETTINGS,
              ),
        ),
        metadataField(
          metadata.windowedCount ? 'Lines (loaded window)' : 'Lines',
          String(metadata.lineCount),
        ),
        metadataField(
          metadata.windowedCount ? 'Characters (loaded window)' : 'Characters',
          String(metadata.characterCount),
        ),
        metadataField('Language', metadata.language),
      ]),
    );
  }
  return m('.fm-file-viewer-metadata', m('dl', fields));
}

/** Renders the info panel's git history section (task 0135): commits touching this file, newest
 * first. Renders nothing while `gitHistory` is unset (panel closed, or the fetch hasn't started
 * yet) and nothing once resolved empty (the file has no history to show) - only a loading state
 * and a populated list are visible, so a plain file never grows an empty "History" heading. */
function renderGitHistorySection(
  gitHistory: readonly GitLogEntry[] | 'loading' | undefined,
): m.Children {
  if (gitHistory === undefined) return undefined;
  if (gitHistory === 'loading') {
    return m('.fm-file-viewer-git-history', m('span', 'Loading history…'));
  }
  if (gitHistory.length === 0) return undefined;
  return m('.fm-file-viewer-git-history', [
    m('h4.fm-file-viewer-git-history-heading', 'History'),
    m(
      'ul.fm-file-viewer-git-history-list',
      gitHistory.map((commit) =>
        m('li.fm-file-viewer-git-history-entry', { key: commit.commitId }, [
          m('span.fm-file-viewer-git-history-summary', commit.summary),
          m(
            'span.fm-file-viewer-git-history-meta',
            `${commit.authorName} · ${formatEntryModifiedAt(commit.committedAt)} · ${commit.shortId}`,
          ),
        ]),
      ),
    ),
  ]);
}

function renderSearchBar(
  attrs: FileViewerAttrs,
  search: FileViewerSearchState | undefined,
): m.Children {
  const query = search?.query ?? '';
  const matches = search?.matches ?? [];
  const currentMatchIndex = search?.currentMatchIndex;
  return m('.fm-file-viewer-search', [
    m('input.fm-file-viewer-search-input', {
      type: 'text',
      placeholder: t('viewer', 'searchPlaceholder'),
      value: query,
      'aria-label': t('viewer', 'searchThisFile'),
      oninput: (event: InputEvent) =>
        attrs.onSearchQueryChange((event.currentTarget as HTMLInputElement).value),
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          attrs.onRunSearch();
        }
      },
    }),
    m(
      'button.fm-file-viewer-search-toggle',
      {
        type: 'button',
        title: t('viewer', 'matchCase'),
        'aria-pressed': search?.caseSensitive === true ? 'true' : 'false',
        onclick: () =>
          attrs.onSearchOptionChange({ caseSensitive: search?.caseSensitive !== true }),
      },
      'Aa',
    ),
    m(
      'button.fm-file-viewer-search-toggle',
      {
        type: 'button',
        title: t('viewer', 'matchWholeWord'),
        'aria-pressed': search?.wholeWord === true ? 'true' : 'false',
        onclick: () => attrs.onSearchOptionChange({ wholeWord: search?.wholeWord !== true }),
      },
      'Ab',
    ),
    m(
      'button.fm-file-viewer-search-toggle',
      {
        type: 'button',
        title: t('viewer', 'useRegex'),
        'aria-pressed': search?.regex === true ? 'true' : 'false',
        onclick: () => attrs.onSearchOptionChange({ regex: search?.regex !== true }),
      },
      '.*',
    ),
    m(
      'span.fm-file-viewer-search-count',
      search === undefined
        ? undefined
        : search.searching
          ? t('viewer', 'searching')
          : search.error !== undefined
            ? search.error
            : matches.length === 0
              ? query.trim() === ''
                ? undefined
                : t('viewer', 'noResults')
              : `${(currentMatchIndex ?? 0) + 1} of ${matches.length}${search.truncated ? '+' : ''}`,
    ),
    m(
      'button.fm-file-viewer-search-nav',
      {
        type: 'button',
        title: t('viewer', 'previousMatch'),
        disabled: matches.length === 0,
        onclick: attrs.onPreviousMatch,
      },
      '▲',
    ),
    m(
      'button.fm-file-viewer-search-nav',
      {
        type: 'button',
        title: t('viewer', 'nextMatch'),
        disabled: matches.length === 0,
        onclick: attrs.onNextMatch,
      },
      '▼',
    ),
  ]);
}

function renderTextBody(
  attrs: FileViewerAttrs,
  state: Extract<FileViewerState, { status: 'ready' }>,
): m.Children {
  const content = state.content;
  if (content.kind !== 'text') return undefined;
  const editableLanguage = editableLanguageForExtension(state.entry.extension, state.entry.name);
  return m(
    '.fm-file-viewer-body.fm-file-viewer-body-text',
    {
      onscroll: (event: Event) => {
        const target = event.currentTarget as HTMLElement;
        if (
          !content.atEnd &&
          !content.loadingMore &&
          target.scrollTop + target.clientHeight >= target.scrollHeight - LOAD_MORE_THRESHOLD_PX
        ) {
          attrs.onLoadMore();
        }
      },
    },
    [
      editableLanguage === 'markdown'
        ? m('.fm-file-viewer-markdown.browser-default', {
            innerHTML: safeMarkdownHtml(content.text),
          })
        : m(CodeMirrorEditor, {
            content: content.text,
            readOnly: true,
            language: languageExtension(editableLanguage),
            ...(content.highlightOffset === undefined || content.highlightLength === undefined
              ? {}
              : {
                  selection: {
                    from: content.highlightOffset,
                    to: content.highlightOffset + content.highlightLength,
                  },
                }),
          }),
      content.loadingMore ? m('.fm-file-viewer-loading-more', 'Loading more…') : undefined,
    ],
  );
}

function renderImageBody(
  attrs: FileViewerAttrs,
  state: Extract<FileViewerState, { status: 'ready' }>,
): m.Children {
  const content = state.content;
  if (content.kind !== 'image') return undefined;
  return m(
    '.fm-file-viewer-body.fm-file-viewer-body-image',
    {
      onwheel: (event: WheelEvent) => {
        event.preventDefault();
        if (event.deltaY < 0) attrs.onZoomIn();
        else if (event.deltaY > 0) attrs.onZoomOut();
      },
    },
    m('img', {
      src: content.dataUri,
      alt: state.entry.name,
      class: content.fitToContainer ? 'fm-file-viewer-image-fit' : undefined,
      style: content.fitToContainer ? undefined : { width: `${content.zoom * 100}%` },
    }),
  );
}

/** Renders one PDF page onto a canvas via pdf.js, scaled to fit the container on both axes.
 * Re-renders whenever `pageNumber` changes - tracked in local component state (`renderedPage`)
 * and checked from both `oncreate` and `onupdate`, rather than relying on Mithril's keyed-vnode
 * remount: a single, non-array child (as this is, inside `.fm-file-viewer-body-pdf`) only calls
 * `onupdate` on prop changes, never a fresh `oncreate`, so a `key`-only approach left page
 * navigation only moving the header's page counter without ever redrawing the canvas. Also
 * re-renders the current page (at the new size) whenever the container is resized, via
 * `ResizeObserver`, so the page keeps fitting the window rather than staying pinned to whatever
 * size the viewer happened to be when the page was first drawn. Surfaces render failures as text
 * instead of silently leaving the canvas blank, since a bad page (or a transient decode error) is
 * otherwise indistinguishable from "still loading". */
const PdfPageCanvas: FactoryComponent<{
  readonly document: PDFDocumentProxy;
  readonly pageNumber: number;
}> = () => {
  let renderedPage: number | undefined;
  let error: string | undefined;
  let resizeObserver: ResizeObserver | undefined;
  // The canvas element itself persists across page navigation (no key remount - see the class
  // doc comment), so `oncreate` only fires once; the resize observer it sets up there must read
  // the *current* attrs on every resize, not the ones captured when it was created.
  let latestAttrs: { document: PDFDocumentProxy; pageNumber: number } | undefined;
  function render(
    canvas: HTMLCanvasElement,
    attrs: { document: PDFDocumentProxy; pageNumber: number },
  ): void {
    renderedPage = attrs.pageNumber;
    error = undefined;
    const container = canvas.parentElement;
    const width = container?.clientWidth ?? 800;
    const height = container?.clientHeight ?? 1000;
    renderPdfPageToCanvas(attrs.document, attrs.pageNumber, canvas, width, height).catch(
      (cause: unknown) => {
        renderedPage = undefined;
        error = cause instanceof Error ? cause.message : 'Failed to render this page.';
        m.redraw();
      },
    );
  }
  function renderIfPageChanged(
    canvas: HTMLCanvasElement,
    attrs: { document: PDFDocumentProxy; pageNumber: number },
  ): void {
    latestAttrs = attrs;
    if (renderedPage === attrs.pageNumber) return;
    render(canvas, attrs);
  }
  return {
    view: ({ attrs }) =>
      error !== undefined
        ? m('.fm-file-viewer-pdf-page-error', `Couldn't render page ${attrs.pageNumber}: ${error}`)
        : m('canvas.fm-file-viewer-pdf-canvas', {
            oncreate: (vnode) => {
              const canvas = vnode.dom as HTMLCanvasElement;
              renderIfPageChanged(canvas, attrs);
              if (typeof ResizeObserver === 'function' && canvas.parentElement !== null) {
                resizeObserver = new ResizeObserver(() => {
                  if (latestAttrs !== undefined) render(canvas, latestAttrs);
                });
                resizeObserver.observe(canvas.parentElement);
              }
            },
            onupdate: (vnode) => renderIfPageChanged(vnode.dom as HTMLCanvasElement, attrs),
            onremove: () => {
              resizeObserver?.disconnect();
              resizeObserver = undefined;
            },
          }),
  };
};

function renderPdfSearchBar(
  attrs: FileViewerAttrs,
  pdfSearch: FileViewerPdfSearchState | undefined,
): m.Children {
  const query = pdfSearch?.query ?? '';
  const matches = pdfSearch?.matches ?? [];
  const currentMatchIndex = pdfSearch?.currentMatchIndex;
  return m('.fm-file-viewer-search', [
    m('input.fm-file-viewer-search-input', {
      type: 'text',
      placeholder: t('viewer', 'searchPdfPlaceholder'),
      value: query,
      'aria-label': t('viewer', 'searchPdfPlaceholder'),
      oninput: (event: InputEvent) =>
        attrs.onPdfSearchQueryChange((event.currentTarget as HTMLInputElement).value),
    }),
    m(
      'span.fm-file-viewer-search-count',
      pdfSearch === undefined
        ? undefined
        : pdfSearch.searching
          ? t('viewer', 'searching')
          : matches.length === 0
            ? query.trim() === ''
              ? undefined
              : t('viewer', 'noResults')
            : `Page ${matches[currentMatchIndex ?? 0]} · ${(currentMatchIndex ?? 0) + 1} of ${matches.length}`,
    ),
    m(
      'button.fm-file-viewer-search-nav',
      {
        type: 'button',
        title: t('viewer', 'previousMatch'),
        disabled: matches.length === 0,
        onclick: attrs.onPreviousPdfMatch,
      },
      '▲',
    ),
    m(
      'button.fm-file-viewer-search-nav',
      {
        type: 'button',
        title: t('viewer', 'nextMatch'),
        disabled: matches.length === 0,
        onclick: attrs.onNextPdfMatch,
      },
      '▼',
    ),
  ]);
}

function renderPdfBody(state: Extract<FileViewerState, { status: 'ready' }>): m.Children {
  const content = state.content;
  if (content.kind !== 'pdf') return undefined;
  return m(
    '.fm-file-viewer-body.fm-file-viewer-body-pdf',
    m(PdfPageCanvas, { document: content.document, pageNumber: content.currentPage }),
  );
}

function renderComicBody(state: Extract<FileViewerState, { status: 'ready' }>): m.Children {
  const content = state.content;
  if (content.kind !== 'comic') return undefined;
  return m(
    '.fm-file-viewer-body.fm-file-viewer-body-image',
    content.currentPageDataUri === undefined
      ? m('span', t('viewer', 'loadingPage'))
      : m('img.fm-file-viewer-image-fit', {
          src: content.currentPageDataUri,
          alt: `Page ${content.currentPage + 1} of ${state.entry.name}`,
        }),
  );
}

function renderEpubBody(state: Extract<FileViewerState, { status: 'ready' }>): m.Children {
  const content = state.content;
  if (content.kind !== 'epub') return undefined;
  return m(
    '.fm-file-viewer-body.fm-file-viewer-body-epub',
    content.currentChapterHtml === undefined
      ? m('span', t('viewer', 'loadingChapter'))
      : m('.fm-file-viewer-epub-chapter.browser-default', {
          innerHTML: content.currentChapterHtml,
        }),
  );
}

function renderAudioBody(state: Extract<FileViewerState, { status: 'ready' }>): m.Children {
  const content = state.content;
  if (content.kind !== 'audio') return undefined;
  return m(
    '.fm-file-viewer-body.fm-file-viewer-body-audio',
    m('audio', {
      controls: true,
      autoplay: false,
      src: content.dataUri,
      'aria-label': state.entry.name,
    }),
  );
}

export const FileViewer: FactoryComponent<FileViewerAttrs> = () => {
  return {
    view: ({ attrs }) => {
      const state = attrs.state;
      const search =
        state.status === 'ready' && state.content.kind === 'text' ? state.search : undefined;
      return m(
        'section.fm-file-viewer',
        { 'aria-label': t('viewer', 'viewing', { name: state.entry.name }) },
        [
          m('.fm-file-viewer-header', [
            m('strong.fm-file-viewer-title', state.entry.name),
            state.status === 'ready' && state.content.kind === 'image'
              ? m('.fm-file-viewer-zoom-controls', [
                  tooltip(
                    t('viewer', 'zoomOut'),
                    m('button', { type: 'button', onclick: attrs.onZoomOut }, '−'),
                  ),
                  m(
                    'span.fm-file-viewer-zoom-level',
                    state.content.fitToContainer
                      ? t('viewer', 'fit')
                      : `${Math.round(state.content.zoom * 100)}%`,
                  ),
                  tooltip(
                    t('viewer', 'zoomIn'),
                    m('button', { type: 'button', onclick: attrs.onZoomIn }, '+'),
                  ),
                  tooltip(
                    t('viewer', 'fitToWindow'),
                    m('button', { type: 'button', onclick: attrs.onResetZoom }, t('viewer', 'fit')),
                  ),
                ])
              : undefined,
            state.status === 'ready' && pagedContentInfo(state.content) !== undefined
              ? (() => {
                  const pageInfo = pagedContentInfo(state.content);
                  if (pageInfo === undefined) return undefined;
                  return m('.fm-file-viewer-page-controls', [
                    tooltip(
                      t('viewer', 'previousPage'),
                      m(
                        'button',
                        {
                          type: 'button',
                          'aria-label': t('viewer', 'previousPage'),
                          disabled: pageInfo.current <= 1,
                          onclick: attrs.onPreviousPage,
                        },
                        '◀',
                      ),
                    ),
                    m('span.fm-file-viewer-page-count', `${pageInfo.current} / ${pageInfo.total}`),
                    tooltip(
                      t('viewer', 'nextPage'),
                      m(
                        'button',
                        {
                          type: 'button',
                          'aria-label': t('viewer', 'nextPage'),
                          disabled: pageInfo.current >= pageInfo.total,
                          onclick: attrs.onNextPage,
                        },
                        '▶',
                      ),
                    ),
                  ]);
                })()
              : undefined,
            state.status === 'ready' &&
            (state.content.kind === 'text' || state.content.kind === 'image')
              ? tooltip(
                  state.content.kind === 'image'
                    ? t('viewer', 'copyImage')
                    : t('viewer', 'copyText'),
                  m(
                    'button.fm-file-viewer-copy',
                    {
                      type: 'button',
                      'aria-label':
                        state.content.kind === 'image'
                          ? t('viewer', 'copyImage')
                          : t('viewer', 'copyText'),
                      onclick: () =>
                        void copyWithToast(
                          attrs.onCopy,
                          state.content.kind === 'image'
                            ? t('viewer', 'imageCopied')
                            : t('viewer', 'textCopied'),
                        ),
                    },
                    copyIcon({ size: 15 }),
                  ),
                )
              : undefined,
            state.status === 'ready' &&
            (state.content.kind === 'text' || state.content.kind === 'image')
              ? tooltip(
                  t('viewer', 'showInfo'),
                  m(
                    'button.fm-file-viewer-metadata-toggle',
                    {
                      type: 'button',
                      'aria-label': t('viewer', 'showInfo'),
                      'aria-pressed': state.metadataPanelOpen === true ? 'true' : 'false',
                      onclick: attrs.onToggleMetadata,
                    },
                    infoCircleIcon({ size: 15 }),
                  ),
                )
              : undefined,
            tooltip(
              t('viewer', 'closeViewer'),
              m(
                'button.fm-file-viewer-close',
                {
                  type: 'button',
                  'aria-label': t('viewer', 'closeViewer'),
                  onclick: attrs.onClose,
                },
                closeIcon({ size: 13 }),
              ),
            ),
          ]),
          state.status === 'ready' && state.content.kind === 'text'
            ? renderSearchBar(attrs, search)
            : undefined,
          state.status === 'ready' && state.content.kind === 'pdf'
            ? renderPdfSearchBar(attrs, state.pdfSearch)
            : undefined,
          state.status === 'loading'
            ? m('.fm-file-viewer-body', m('span', t('shell', 'loading')))
            : state.status === 'unsupported'
              ? m('.fm-file-viewer-body', m('span', t('viewer', 'previewUnavailableGeneric')))
              : state.status === 'error'
                ? m('.fm-file-viewer-body', m('span', state.message))
                : state.content.kind === 'text'
                  ? renderTextBody(attrs, state)
                  : state.content.kind === 'audio'
                    ? renderAudioBody(state)
                    : state.content.kind === 'pdf'
                      ? renderPdfBody(state)
                      : state.content.kind === 'comic'
                        ? renderComicBody(state)
                        : state.content.kind === 'epub'
                          ? renderEpubBody(state)
                          : renderImageBody(attrs, state),
          state.status === 'ready' && state.metadataPanelOpen === true
            ? m('.fm-file-viewer-info-panel', [
                renderMetadataPanel(state.metadata),
                renderGitHistorySection(state.gitHistory),
              ])
            : undefined,
        ],
      );
    },
  };
};
